import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
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
// Rev. 5: self-heal-ul gate-ului de reclaim. INVARIANT: fn()-ul rulat sub
// gate ramane DOAR recheck+rename+write (microsecunde) — nu adauga I/O lent
// acolo, altfel expirarea devine atinsa in mod real.
const GATE_STALE_MS = 60_000;

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

// Rev. 5 (Codex HIGH, critic pentru web): reclaim-ul unui lock mort/stale
// trece printr-un GATE creat atomic (O_EXCL) — doua boot-uri concurente care
// citesc acelasi lock mort (docker restart pe acelasi volum; pe web nu exista
// single-instance lock-ul Electron) nu mai pot face AMBELE rename+write;
// pierzatorul refuza fail-closed cu mesaj de retry. Gate-ul orfan (crash
// mid-reclaim) se autovindeca: peste GATE_STALE_MS e sters best-effort si
// pornirea CURENTA tot refuza — urmatoarea il castiga. Exception-safe: un
// singur try acopera open+fn; finally curata fd + gate cu garzi individuale.
// Continutul gate-ului nu e citit de nimeni — nu se scrie nimic in el.
function withReclaimGate(path: string, fn: () => void): void {
  const gate = `${path}.reclaim-gate`;
  let fd: number | null = null;
  try {
    try {
      fd = openSync(gate, "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let orphan = false;
      try {
        orphan = Date.now() - statSync(gate).mtimeMs > GATE_STALE_MS;
      } catch {
        /* gate-ul a disparut intre timp (TOCTOU) — refuz tipat; retry-ul reuseste */
      }
      if (orphan) {
        try {
          unlinkSync(gate);
        } catch {
          /* best-effort */
        }
        throw new Error(
          "Recuperarea lock-ului SQLite a fost intrerupta anterior (gate orfan curatat). Reincearca pornirea."
        );
      }
      throw new Error("Alt proces Legal Dashboard recupereaza lock-ul SQLite chiar acum. Reincearca pornirea.");
    }
    fn();
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* best-effort */
      }
      try {
        unlinkSync(gate);
      } catch {
        /* best-effort */
      }
    }
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
      withReclaimGate(path, () => {
        // Re-evaluare COMPLETA sub gate (fix panel-pe-plan: nonce-ul singur nu
        // ajunge — heartbeat-ul reimprospateaza ACELASI nonce, deci un lock
        // cross-host citit stale in snapshot poate fi din nou viu aici).
        const recheck = readLock(path);
        if (!recheck || recheck.nonce !== existing.nonce) {
          throw new Error("Lock-ul SQLite a fost preluat de alt proces in timpul recuperarii. Reincearca pornirea.");
        }
        const recheckAge = Date.now() - recheck.heartbeatAt;
        const recheckStale = recheckAge > STALE_FACTOR * HEARTBEAT_MS;
        const recheckBlocked = sameHost ? processAlive(recheck.pid) : !recheckStale;
        if (recheckBlocked) {
          throw new Error(
            "Lock-ul SQLite a redevenit activ in timpul recuperarii (heartbeat proaspat). Reincearca pornirea."
          );
        }
        const deadPath = `${path}.dead-${existing.pid}-${Date.now()}`;
        try {
          renameSync(path, deadPath);
        } catch (e) {
          // ENOENT = alt proces (ex. FORCE_BOOT concurent) a mutat lock-ul
          // intre recheck si rename — refuz TIPAT, nu eroare bruta.
          if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
            throw new Error("Lock-ul SQLite a fost preluat de alt proces in timpul recuperarii. Reincearca pornirea.");
          }
          throw e;
        }
        writeNewLock(path, record);
        pendingReclaimAudit = {
          forced: false,
          previousPid: existing.pid,
          previousHostname: existing.hostname,
          previousHeartbeatAgeMs: heartbeatAge,
        };
      });
    } else {
      withReclaimGate(path, () => {
        // Re-validare sub gate: daca intre timp un proces a scris un lock
        // VALID (JSON parseabil), il respectam (nu-l redenumim).
        if (readLock(path) !== null) {
          throw new Error("Lock-ul SQLite a fost preluat de alt proces in timpul recuperarii. Reincearca pornirea.");
        }
        const deadPath = `${path}.dead-invalid-${Date.now()}`;
        try {
          renameSync(path, deadPath);
        } catch (e) {
          if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
            throw new Error("Lock-ul SQLite a fost preluat de alt proces in timpul recuperarii. Reincearca pornirea.");
          }
          throw e;
        }
        writeNewLock(path, record);
        pendingReclaimAudit = { forced: false, invalidPrevious: true };
      });
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
