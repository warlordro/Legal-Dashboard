import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { hostname as osHostname } from "node:os";
import { recordAudit } from "./auditRepository.ts";

const HEARTBEAT_MS = 5_000;
const STALE_FACTOR = 6;
const LOCK_NAME = ".instance.lock";

interface LockRecord {
  pid: number;
  hostname: string;
  startedAt: string;
  heartbeatAt: number;
  nonce: string;
  appVersion?: string;
}

let current: LockRecord | null = null;
let heartbeat: NodeJS.Timeout | null = null;
let dataDirForRelease: string | null = null;
let pendingReclaimAudit: Record<string, unknown> | null = null;

function lockPath(dataDir: string): string {
  return join(dataDir, LOCK_NAME);
}

function buildRecord(appVersion?: string): LockRecord {
  return {
    pid: process.pid,
    hostname: osHostname(),
    startedAt: new Date().toISOString(),
    heartbeatAt: Date.now(),
    nonce: crypto.randomUUID(),
    appVersion,
  };
}

function writeNewLock(path: string, record: LockRecord): void {
  let fd: number | null = null;
  try {
    fd = openSync(path, "wx");
    writeSync(fd, JSON.stringify(record));
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function readLock(path: string): LockRecord | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LockRecord;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireInstanceLock(dataDir: string, appVersion?: string): void {
  mkdirSync(dataDir, { recursive: true });
  const path = lockPath(dataDir);
  const record = buildRecord(appVersion);

  if (process.env.LEGAL_DASHBOARD_FORCE_BOOT === "1" && existsSync(path)) {
    const existing = readLock(path);
    const deadPath = `${path}.dead-force-${Date.now()}`;
    try {
      renameSync(path, deadPath);
    } catch {
      // Continue into atomic claim; if a peer wins, writeNewLock throws.
    }
    pendingReclaimAudit = {
      forced: true,
      previousPid: existing?.pid ?? null,
      previousHostname: existing?.hostname ?? null,
    };
  }

  try {
    writeNewLock(path, record);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const existing = readLock(path);
    if (existing) {
      const heartbeatAge = Date.now() - existing.heartbeatAt;
      const sameHost = existing.hostname === osHostname();
      const stale = heartbeatAge > STALE_FACTOR * HEARTBEAT_MS;
      const alive = sameHost ? processAlive(existing.pid) : !stale;
      if (alive && !stale) {
        throw new Error(
          `Alt proces Legal Dashboard detine lock-ul SQLite (pid=${existing.pid}, host=${existing.hostname}).`
        );
      }
      const deadPath = `${path}.dead-${existing.pid}-${Date.now()}`;
      renameSync(path, deadPath);
      pendingReclaimAudit = {
        forced: false,
        previousPid: existing.pid,
        previousHostname: existing.hostname,
        previousHeartbeatAgeMs: heartbeatAge,
      };
      writeNewLock(path, record);
    } else {
      const deadPath = `${path}.dead-invalid-${Date.now()}`;
      renameSync(path, deadPath);
      pendingReclaimAudit = { forced: false, invalidPrevious: true };
      writeNewLock(path, record);
    }
  }

  current = record;
  dataDirForRelease = dataDir;
  cleanupDeadSidecars(dataDir);
  heartbeat = setInterval(() => {
    if (!current) return;
    const latest = readLock(path);
    if (
      !latest ||
      latest.pid !== current.pid ||
      latest.hostname !== current.hostname ||
      latest.nonce !== current.nonce
    ) {
      throw new Error("[instanceLock] ownership lost; shutting down to protect SQLite");
    }
    current.heartbeatAt = Date.now();
    const tempPath = `${path}.heartbeat-${current.pid}-${Date.now()}`;
    writeFileSync(tempPath, JSON.stringify(current));
    renameSync(tempPath, path);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}

export function flushPendingReclaimAudit(): void {
  if (!pendingReclaimAudit) return;
  recordAudit(null, "instance.lock.reclaimed", {
    ownerId: null,
    actorId: "system",
    detail: pendingReclaimAudit,
  });
  pendingReclaimAudit = null;
}

export function releaseInstanceLock(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  if (dataDirForRelease && current) {
    const path = lockPath(dataDirForRelease);
    const latest = readLock(path);
    if (latest?.nonce === current.nonce) {
      try {
        unlinkSync(path);
      } catch {
        // best-effort
      }
    }
  }
  current = null;
  dataDirForRelease = null;
}

function cleanupDeadSidecars(dataDir: string): void {
  try {
    for (const entry of readdirSync(dataDir)
      .filter((name) => name.startsWith(`${LOCK_NAME}.dead-`))
      .slice(0, 50)) {
      try {
        unlinkSync(join(dataDir, entry));
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
}
