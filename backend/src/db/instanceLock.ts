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
  } catch (e) {
    // Rev. 4 (panel-pe-plan): DOAR ESRCH inseamna "mort". EPERM = proces VIU
    // sub alta identitate OS; orice alta eroare = necunoscut => fail-closed
    // (posibil viu) — reclaim-ul peste un proces viu inaccesibil ar pune doua
    // procese pe aceleasi fisiere SQLite.
    return (e as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}

export function acquireInstanceLock(dataDir: string, appVersion?: string): void {
  mkdirSync(dataDir, { recursive: true });
  const path = lockPath(dataDir);
  const record = buildRecord(appVersion);

  let forcedReclaim: { previousPid: number | null; previousHostname: string | null } | null = null;
  if (process.env.LEGAL_DASHBOARD_FORCE_BOOT === "1" && existsSync(path)) {
    const existing = readLock(path);
    const deadPath = `${path}.dead-force-${Date.now()}`;
    try {
      renameSync(path, deadPath);
    } catch {
      // Continue into atomic claim; if a peer wins, writeNewLock throws.
    }
    forcedReclaim = {
      previousPid: existing?.pid ?? null,
      previousHostname: existing?.hostname ?? null,
    };
  }

  try {
    writeNewLock(path, record);
    if (forcedReclaim) {
      pendingReclaimAudit = { forced: true, ...forcedReclaim };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const existing = readLock(path);
    if (existing) {
      const heartbeatAge = Date.now() - existing.heartbeatAt;
      const sameHost = existing.hostname === osHostname();
      const stale = heartbeatAge > STALE_FACTOR * HEARTBEAT_MS;
      // Rev. 4 (Codex HIGH): pe ACELASI host, un PID viu nu se recupereaza
      // NICIODATA automat, indiferent de heartbeat — operatiile sincrone de
      // boot (split rnpm, migratii, pre-migration backup) blocheaza legitim
      // event loop-ul (deci si heartbeat-ul setInterval) peste prag, iar un
      // reclaim ar pune DOUA procese pe aceleasi fisiere SQLite. Heartbeat-ul
      // ramane criteriul DOAR cross-host (pid-ul nu e verificabil acolo).
      // Limita asumata: PID reuse de catre un proces strain = refuz
      // fals-pozitiv, deblocabil manual (fail-closed, preferabil coruperii).
      // Break-glass: LEGAL_DASHBOARD_FORCE_BOOT=1 (cu audit).
      const blocked = sameHost ? processAlive(existing.pid) : !stale;
      if (blocked) {
        throw new Error(
          `Alt proces Legal Dashboard detine lock-ul SQLite (pid=${existing.pid}, host=${existing.hostname}` +
            `, heartbeat acum ${Math.round(heartbeatAge / 1000)}s).` +
            (stale
              ? " Heartbeat-ul e vechi dar procesul e VIU (posibil blocat intr-o operatie lunga de boot);" +
                " daca esti sigur ca e mort/blocat definitiv, opreste-l manual sau porneste cu LEGAL_DASHBOARD_FORCE_BOOT=1."
              : "")
        );
      }
      const deadPath = `${path}.dead-${existing.pid}-${Date.now()}`;
      renameSync(path, deadPath);
      writeNewLock(path, record);
      pendingReclaimAudit = {
        forced: false,
        previousPid: existing.pid,
        previousHostname: existing.hostname,
        previousHeartbeatAgeMs: heartbeatAge,
      };
    } else {
      const deadPath = `${path}.dead-invalid-${Date.now()}`;
      renameSync(path, deadPath);
      writeNewLock(path, record);
      pendingReclaimAudit = { forced: false, invalidPrevious: true };
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
