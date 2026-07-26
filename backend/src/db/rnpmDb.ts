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
import { pruneBackupJailSync } from "./backupPrune.ts";
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
    pruneBackupJailSync(dir, "rnpm.", {
      protectedNames: [path.basename(dest)],
      logEvent: (entry) => console.log(JSON.stringify({ ...entry, ts: new Date().toISOString() })),
    });
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
  try {
    applyRnpmConnectionPragmas(db);
  } catch (e) {
    try {
      db.close();
    } catch {
      /* best-effort */
    }
    throw e;
  }
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

// Test-only: dimensiunea registry-ului de handle-uri. Fara el, un leak in prewarm nu
// poate fi pinat de niciun test — `hasPendingRnpmMigrations` deschide o conexiune
// proprie, deci contoarele lui nu spun nimic despre registry.
export function __rnpmHandleCountForTests(): number {
  return handles.size;
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

// Checkpoint PASSIVE care NU inregistreaza un handle nou. Masuratoarea de storage il
// cere pe calea "peste limita", iar ruta admin /usage o executa pentru TOTI userii:
// cu getRnpmDb, o singura cerere lasa in registry cate un handle permanent per user
// peste limita. Daca userul are deja conexiune vie o refolosim; altfel deschidem una
// temporara si o inchidem. Best-effort: fara fisier sau in timpul unui restore, no-op.
export function passiveCheckpointRnpmWal(ownerId: string): void {
  const existing = handles.get(ownerId);
  if (existing) {
    existing.pragma("wal_checkpoint(PASSIVE)");
    return;
  }
  assertValidOwnerId(ownerId);
  if (shuttingDown || isRnpmRestoreInProgress(ownerId)) return;
  const dbPath = getRnpmDbPath(ownerId);
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    db.pragma("wal_checkpoint(PASSIVE)");
  } finally {
    db.close();
  }
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

// CodeRabbit 1.3 (v2.43.3): pre-migrarea bazei RNPM a unui user e integral SINCRONA
// (mkdirSync + VACUUM INTO + prune), iar `getRnpmDb` are semnatura sincrona, deci nu
// poate astepta workerul din snapshotRunner. Pe desktop e invizibil — un singur user.
// Pe web, prima cerere a fiecarui user dupa un upgrade cu migrari noi ingheata TOT
// serverul cat dureaza (masurat: ~120 ms la 103 MB, creste cu marimea bazei).
//
// Solutia respecta constrangerea de semnatura: nu facem `getRnpmDb` asincron, ci mutam
// munca inaintea serverului. Se apeleaza din blocul de prewarm din index.ts, care ruleaza
// deja INAINTE de `serve()` tocmai ca sa nu se raspunda "ok" la /health cat timp migrarile
// blocheaza event loop-ul.
//
// Atinge DOAR fisierele care exista deja: `getRnpmDb` ar provisiona lazy un fisier nou,
// iar un user care n-a folosit niciodata RNPM nu trebuie sa capete unul la boot.
// Un esec pe un user NU opreste restul si NU trebuie sa cada boot-ul — pre-migrarea are
// deja try/catch propriu care doar avertizeaza.
export function prewarmRnpmMigrations(ownerIds: readonly string[]): {
  warmed: number;
  skipped: number;
  failed: number;
  durationMs: number;
} {
  const t0 = Date.now();
  let warmed = 0;
  let skipped = 0;
  let failed = 0;
  for (const ownerId of ownerIds) {
    try {
      const dbPath = getRnpmDbPath(ownerId);
      // Gate pe migrari PENDING, nu doar pe existenta fisierului (finding review
      // adversarial, convergent pe toate trei reviewurile). Fara el, prewarm-ul ar fi
      // rulat la FIECARE boot, nu doar dupa un upgrade cu migrari noi — cazul majoritar
      // fiind boot fara migrari, unde nu are nimic de facut.
      if (!fs.existsSync(dbPath) || !hasPendingRnpmMigrations(dbPath)) {
        skipped++;
        continue;
      }
      getRnpmDb(ownerId);
      // Handle-ul se INCHIDE imediat: migrarile sunt durabile, iar prima cerere reala
      // il redeschide ieftin. Fara close, boot-ul ar fi tinut deschis permanent cate un
      // handle (fd + wal + shm) pentru fiecare user cu baza RNPM, indiferent daca se mai
      // logheaza vreodata — registry-ul nu are evictie, deci la cateva sute de useri
      // inseamna drum direct spre EMFILE.
      closeRnpmDb(ownerId);
      warmed++;
    } catch (e) {
      failed++;
      console.warn(`[rnpmDb] prewarm esuat pentru ${ownerId} (continuam):`, e instanceof Error ? e.message : e);
    }
  }
  const durationMs = Date.now() - t0;
  // Progresul se logheaza: pe multi useri cu baze mari boot-ul se lungeste proportional,
  // si operatorul trebuie sa vada de ce sta, nu sa para blocat.
  console.log(
    JSON.stringify({ action: "rnpm_prewarm", warmed, skipped, failed, durationMs, ts: new Date().toISOString() })
  );
  return { warmed, skipped, failed, durationMs };
}
