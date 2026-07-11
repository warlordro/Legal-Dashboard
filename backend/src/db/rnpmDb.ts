// v2.43.0 (rnpm-split): registry de handle-uri better-sqlite3 per owner pentru
// fisierele RNPM separate fizic (<dataDir>/rnpm/<stem>.db). Provisioning lazy
// prin runner-ul de migrations existent, pe chain-ul separat migrations-rnpm/.
// Paritate de pragmas cu schema.ts (WAL, NORMAL, busy_timeout, WAL-truncate).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { stripDiacritics } from "../util/textNormalize.ts";
import { discoverMigrations, runMigrations } from "./migrations/runner.ts";
import { isRnpmRestoreInProgress, RnpmRestoreInProgressError } from "./rnpmActivity.ts";
import { getDbPath } from "./schema.ts";

const __rnpmDir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_RNPM_DIR = path.join(__rnpmDir, "migrations-rnpm");

const OWNER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const handles = new Map<string, Database.Database>();
let shuttingDown = false;

export function assertValidOwnerId(ownerId: string): void {
  if (!OWNER_ID_RE.test(ownerId)) {
    throw new Error(`ownerId invalid pentru operatii pe fisiere: ${JSON.stringify(ownerId)}`);
  }
}

// Nume de fisier collision-safe: lowercase + hash scurt al ID-ului EXACT.
// Injectiv si pe filesystem-uri case-insensitive (Windows/macOS) si imun la
// numele rezervate Windows (CON, NUL, COM1...) datorita sufixului.
export function rnpmFileStem(ownerId: string): string {
  assertValidOwnerId(ownerId);
  const hash = createHash("sha256").update(ownerId, "utf8").digest("hex").slice(0, 10);
  return `${ownerId.toLowerCase()}-${hash}`;
}

export function getRnpmDataDir(): string {
  return path.join(path.dirname(getDbPath()), "rnpm");
}

export function getRnpmDbPath(ownerId: string): string {
  return path.join(getRnpmDataDir(), `${rnpmFileStem(ownerId)}.db`);
}

export function getRnpmBackupJail(ownerId: string): string {
  return path.join(path.dirname(getDbPath()), "backups", "rnpm", rnpmFileStem(ownerId));
}

export function registerRnpmNorm(db: Database.Database): void {
  db.function("rnpm_norm", { deterministic: true }, (s) => (s == null ? "" : stripDiacritics(String(s)).toLowerCase()));
}

// Pre-migration backup per fisier user — SELF-CONTAINED prin VACUUM INTO
// (snapshot atomic, include tot ce e comis, fara sidecars), in jail-ul
// ownerului; best-effort cu warn (paritate cu schema.ts).
function preRnpmMigrationBackup(ownerId: string, src: string, label: string): void {
  try {
    const dir = getRnpmBackupJail(ownerId);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = path.join(dir, `rnpm.pre-${label}-${stamp}.db`);
    const tmp = new Database(src, { readonly: true, fileMustExist: true });
    try {
      tmp.prepare("VACUUM INTO ?").run(dest);
    } finally {
      tmp.close();
    }
    console.log(`[rnpmDb] pre-migration backup -> ${dest}`);
  } catch (e) {
    console.warn("[rnpmDb] pre-migration backup failed (continuing):", e instanceof Error ? e.message : e);
  }
}

// Probe readonly pe fisier EXISTENT: are chain-ul rnpm migrations pending?
// Fail-closed ca in schema.ts: orice eroare de citire => "ar putea avea
// pending" => backup (un backup inutil e ieftin; unul ratat inainte de un
// ALTER destructiv inseamna pierdere de date).
function hasPendingRnpmMigrations(dbPath: string): boolean {
  try {
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const hasVersionsTable = probe
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_versions'`)
        .get();
      const files = discoverMigrations(MIGRATIONS_RNPM_DIR);
      if (!hasVersionsTable) return files.length > 0;
      const stored = new Set<number>(
        (probe.prepare("SELECT version FROM _schema_versions").all() as { version: number }[]).map((r) => r.version)
      );
      return files.some((f) => !stored.has(f.version));
    } finally {
      probe.close();
    }
  } catch {
    return true;
  }
}

// v2.43.x (EXT-M-01, corectie Codex HIGH): pragmas-urile de conexiune intr-un
// singur loc — orice handle pe un fisier RNPM (registry SAU direct, sub latch
// de restore) are nevoie de ACELASI set; in special foreign_keys=ON, fara de
// care DELETE pe rnpm_avize nu executa cascadele si lasa tabelele copil
// (creditori/debitori/bunuri/istoric) orfane.
function applyRnpmConnectionPragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
}

// Handle DIRECT pe un fisier RNPM, in afara registry-ului — folosit de
// backup.ts sub maintenance write + latch de owner (registry-ul e inchis si
// getRnpmDb ar refuza cu RESTORE_IN_PROGRESS). Callerul detine ciclul de
// viata (close in finally).
export function openRnpmDbHandleDirect(dbPath: string): Database.Database {
  const db = new Database(dbPath, { fileMustExist: true });
  applyRnpmConnectionPragmas(db);
  return db;
}

export function getRnpmDb(ownerId: string): Database.Database {
  if (shuttingDown) throw new Error("RNPM DB closed; refusing to reopen during shutdown");
  assertValidOwnerId(ownerId);
  // Gardul de restore la NIVELUL DB layer-ului: acopera TOATE operatiile repository
  // (nu doar search) — fara el, un GET /stats in timpul swap-ului ar redeschide lazy
  // fisierul vechi (EBUSY pe Windows la rename; scrieri pierdute pe POSIX).
  if (isRnpmRestoreInProgress(ownerId)) throw new RnpmRestoreInProgressError();
  const existing = handles.get(ownerId);
  if (existing) return existing;

  const dbPath = getRnpmDbPath(ownerId);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath) && hasPendingRnpmMigrations(dbPath)) {
    preRnpmMigrationBackup(ownerId, dbPath, "schema-upgrade");
  }

  // Orice esec dupa open inchide handle-ul (altfel ramane lock nativ orfan pe
  // Windows care blocheaza retry-ul/rename-ul urmator).
  const db = new Database(dbPath);
  try {
    applyRnpmConnectionPragmas(db);
    // WAL-truncate >32MB la deschidere (paritate schema.ts).
    try {
      const walSize = fs.statSync(`${dbPath}-wal`).size;
      if (walSize > 32 * 1024 * 1024) {
        db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
        console.log(`[rnpmDb] ${ownerId}: WAL era ${(walSize / 1024 / 1024).toFixed(1)}MB; truncat la open`);
      }
    } catch {
      /* -wal absent e ok */
    }
    registerRnpmNorm(db);
    const result = runMigrations(db, MIGRATIONS_RNPM_DIR);
    if (result.applied.length > 0) console.log(`[rnpmDb] ${ownerId}: applied migrations ${result.applied.join(", ")}`);
  } catch (e) {
    try {
      db.close();
    } catch {
      /* best-effort */
    }
    throw e;
  }
  handles.set(ownerId, db);
  return db;
}

// Handle temporar FARA provisioning si FARA registry — pentru backup-ul fisierelor
// userilor inactivi si pentru snapshot-ul pre-restore. Callerul inchide.
export function openRnpmDbRaw(ownerId: string): Database.Database | null {
  const dbPath = getRnpmDbPath(ownerId);
  if (!fs.existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

export function closeRnpmDb(ownerId: string): void {
  const db = handles.get(ownerId);
  if (db) {
    db.close();
    handles.delete(ownerId);
  }
}

export function closeAllRnpmDbs(): void {
  for (const [ownerId, db] of handles) {
    try {
      db.close();
    } catch (e) {
      console.warn(`[rnpmDb] close ${ownerId} failed:`, e instanceof Error ? e.message : e);
    }
  }
  handles.clear();
}

export function markRnpmShuttingDown(): void {
  shuttingDown = true;
  closeAllRnpmDbs();
}

export function __resetRnpmDbForTests(): void {
  shuttingDown = false;
  closeAllRnpmDbs();
}

export function checkpointRnpmWal(ownerId: string): void {
  getRnpmDb(ownerId).prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
}

// DEPRECATED (Task 7, fixuri post-review): rutele folosesc
// compactRnpmDbViaWorker (backup.ts) — VACUUM in worker + swap sub maintenance
// lock, nu VACUUM blocant pe handle-ul viu (SQLITE_BUSY intermitent cu un
// worker pe acelasi fisier + event loop blocat). Ramane pentru teste
// (schimbare chirurgicala — nu se sterge in acest batch).
export function compactRnpmDb(ownerId: string): { beforeBytes: number; afterBytes: number; durationMs: number } {
  const db = getRnpmDb(ownerId);
  const dbPath = getRnpmDbPath(ownerId);
  const sizeOf = (p: string): number => {
    try {
      return fs.statSync(p).size;
    } catch {
      return 0;
    }
  };
  const before = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`) + sizeOf(`${dbPath}-shm`);
  const t0 = Date.now();
  db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  db.exec("VACUUM");
  db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  const durationMs = Date.now() - t0;
  const after = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`) + sizeOf(`${dbPath}-shm`);
  return { beforeBytes: before, afterBytes: after, durationMs };
}
