import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import fsPromises from "node:fs/promises";
import Database from "better-sqlite3";
import { RWLock } from "../util/rwlock.ts";
import { discoverMigrations } from "./migrations/runner.ts";
import { beginRnpmRestore, endRnpmRestore } from "./rnpmActivity.ts";
import {
  closeRnpmDb,
  getRnpmBackupJail,
  getRnpmDataDir,
  getRnpmDb,
  getRnpmDbPath,
  MIGRATIONS_RNPM_DIR,
  openRnpmDbRaw,
} from "./rnpmDb.ts";
import { closeDb, getDb, getDbPath } from "./schema.ts";

// Single in-process maintenance gate. Restore + daily backup acquire WRITE
// (exclusive — restore closes the DB handle and atomically renames the file;
// daily backup snapshots the live DB). The monitoring scheduler acquires
// READ (shared) around each tick so concurrent ticks interleave but cannot
// straddle a restore that would invalidate their handle. Writer preference
// prevents a steady reader stream from starving the daily backup. Promise
// chain is enough for single-process scope; web-mode would replace this
// with a row-lock or advisory lock in the gateway.
const maintenanceLock = new RWLock();

// Exclusive writer for restore + daily backup. Public: tests need to hold
// the writer side to assert reader/writer interleaving (without spinning the
// real runDailyBackup, which does I/O and can't be paused mid-flight).
export function withMaintenanceWrite<T>(fn: () => Promise<T>): Promise<T> {
  return maintenanceLock.withWrite(fn);
}

// Shared reader. Used by the monitoring scheduler to coordinate with the
// maintenance gate — multiple ticks may run in parallel, but a queued
// writer (backup/restore) blocks new readers from cutting in.
export function withMaintenanceRead<T>(fn: () => Promise<T>): Promise<T> {
  return maintenanceLock.withRead(fn);
}

// Single-line JSON audit lines on stdout. Same shape as `restore` /
// `ai_call` so log scrapers can grep `"action":"daily_backup"` etc.
function logBackupEvent(entry: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      ...entry,
      ts: new Date().toISOString(),
    })
  );
}

// v2.43.0 (rnpm-split): erorile de VALIDARE la restore (nume invalid, iesire
// din jail, backup inexistent, versiune de schema mai noua) primesc cod masina
// ca rutele sa raspunda 400 INVALID_PARAMS, nu 500 (clasificarea conteaza
// pentru alerting).
export class BackupValidationError extends Error {
  readonly code = "INVALID_PARAMS";
}

// ---------------------------------------------------------------------------
// Retentie: 4 pool-uri DISJUNCTE per target (daily/pre-restore/pre-migration/
// manual), fiecare cu cap propriu ca un burst intr-un pool sa nu evacueze alt
// pool. Numele pool-urilor: `<prefix>YYYY-MM-DD.db`, `<prefix>pre-restore-*.db`,
// `<prefix>pre-<label>-*.db` (label cu puncte acceptat), `<prefix>manual-*.db`.
// ---------------------------------------------------------------------------
const BACKUP_RETAIN_COUNT = 7;
const PRE_RESTORE_RETAIN = 5;
const PRE_MIGRATION_RETAIN = 5;
const MANUAL_RETAIN = 5;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const MAIN_PREFIX = "legal-dashboard.";
const RNPM_PREFIX = "rnpm.";
const BACKUP_SUFFIX = ".db";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface PoolRegexes {
  dated: RegExp;
  preRestore: RegExp;
  manual: RegExp;
  preMigration: RegExp;
}

function poolRegexes(prefix: string): PoolRegexes {
  const p = escapeRegExp(prefix);
  return {
    dated: new RegExp(`^${p}\\d{4}-\\d{2}-\\d{2}\\.db$`),
    preRestore: new RegExp(`^${p}pre-restore-[^\\\\/]+\\.db$`),
    manual: new RegExp(`^${p}manual-[^\\\\/]+\\.db$`),
    // Orice `pre-<label>-...` cu exceptia `pre-restore-` (pool separat).
    preMigration: new RegExp(`^${p}pre-(?!restore-)[^\\\\/]+\\.db$`),
  };
}

// Un "target" de backup = un fisier SQLite viu + directorul lui de backup +
// prefixul de nume. main = monolitul; rnpm:<stem> = fisierul unui user.
interface BackupTarget {
  key: string;
  dir: string;
  prefix: string;
  dbPath: string;
  // Deschide conexiunea pentru snapshot. main: handle-ul viu (nu se inchide);
  // rnpm: conexiune temporara readonly (callerul o inchide) — zero TOCTOU de
  // creare de fisier gol, zero handle persistent in registry.
  openForSnapshot: () => { db: Database.Database; close: boolean };
}

function mainTarget(): BackupTarget {
  return {
    key: "main",
    dir: getBackupDir(),
    prefix: MAIN_PREFIX,
    dbPath: getDbPath(),
    openForSnapshot: () => ({ db: getDb(), close: false }),
  };
}

function rnpmTargetForStemFile(stem: string): BackupTarget {
  const filePath = path.join(getRnpmDataDir(), `${stem}${BACKUP_SUFFIX}`);
  return {
    key: `rnpm:${stem}`,
    dir: path.join(getBackupDir(), "rnpm", stem),
    prefix: RNPM_PREFIX,
    dbPath: filePath,
    openForSnapshot: () => ({
      db: new Database(filePath, { readonly: true, fileMustExist: true }),
      close: true,
    }),
  };
}

export function getBackupDir(): string {
  return path.join(path.dirname(getDbPath()), "backups");
}

// Jail-ul de backup al unui owner (backups/rnpm/<stem>/). Numele vine din
// rnpmFileStem, deci validarea ownerId e implicita.
export function getRnpmBackupDir(ownerId: string): string {
  return getRnpmBackupJail(ownerId);
}

function stampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function todayBackupName(prefix: string, date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${prefix}${y}-${m}-${d}${BACKUP_SUFFIX}`;
}

async function listBackups(dir: string, prefix: string): Promise<string[]> {
  try {
    const entries = await fsPromises.readdir(dir);
    return entries.filter((f) => f.startsWith(prefix) && f.endsWith(BACKUP_SUFFIX));
  } catch {
    return [];
  }
}

// Sterge un backup impreuna cu sidecar-urile lui (bundle) — backup-urile
// legacy (pre-v2.43.0) sunt coerente doar ca triplet .db/-wal/-shm; fara
// curatarea bundle-ului ar ramane sidecars orfane permanente in jail.
async function unlinkBundle(dir: string, name: string): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"] as const) {
    await fsPromises.unlink(path.join(dir, name + suffix)).catch(() => {
      /* best-effort */
    });
  }
}

// Half-written backups left by a prior crash / SIGTERM / power loss between
// `VACUUM INTO tmp` and the atomic rename below. Filter is strict (`.db.tmp`
// suffix on a backup-prefixed name) so we never touch unrelated files even if
// the user drops them into the backups folder.
async function cleanupOrphanTmp(dir: string, prefix: string): Promise<void> {
  try {
    const entries = await fsPromises.readdir(dir);
    for (const f of entries) {
      if (f.startsWith(prefix) && f.endsWith(`${BACKUP_SUFFIX}.tmp`)) {
        await fsPromises.unlink(path.join(dir, f)).catch(() => {
          /* best-effort */
        });
      }
    }
  } catch {
    /* dir missing — mkdir happens before snapshot */
  }
}

async function latestBackupMtime(dir: string, prefix: string): Promise<number | null> {
  // Only count dated daily backups for "should I skip today's snapshot" — a recent
  // pre-restore/manual snapshot was user-initiated and does not mean the daily
  // snapshot has already happened.
  const res = poolRegexes(prefix);
  const backups = (await listBackups(dir, prefix)).filter((f) => res.dated.test(f));
  if (backups.length === 0) return null;
  let max = 0;
  for (const f of backups) {
    try {
      const stat = await fsPromises.stat(path.join(dir, f));
      if (stat.mtimeMs > max) max = stat.mtimeMs;
    } catch {
      /* file vanished between readdir and stat */
    }
  }
  return max || null;
}

async function pruneOld(dir: string, prefix: string): Promise<number> {
  const all = await listBackups(dir, prefix);
  const res = poolRegexes(prefix);
  // Patru pool-uri disjuncte; numele contin timestamp ISO => lex sort = cronologic.
  const dated = all
    .filter((f) => res.dated.test(f))
    .sort()
    .reverse();
  const preRestore = all
    .filter((f) => res.preRestore.test(f))
    .sort()
    .reverse();
  const manual = all
    .filter((f) => res.manual.test(f))
    .sort()
    .reverse();
  const preMigration = all
    .filter((f) => res.preMigration.test(f) && !res.manual.test(f))
    .sort()
    .reverse();
  const toDelete = [
    ...dated.slice(BACKUP_RETAIN_COUNT),
    ...preRestore.slice(PRE_RESTORE_RETAIN),
    ...manual.slice(MANUAL_RETAIN),
    ...preMigration.slice(PRE_MIGRATION_RETAIN),
  ];
  for (const f of toDelete) {
    await unlinkBundle(dir, f);
  }
  return toDelete.length;
}

// Verificare snapshot: exista, size > 0, integrity_check pe o conexiune
// readonly. Orice esec arunca — snapshot-urile sunt promisiunea de rollback.
function verifySnapshot(p: string, label: string): void {
  const size = fs.statSync(p).size;
  if (size <= 0) throw new Error(`[backup] snapshot gol (${label})`);
  const probe = new Database(p, { readonly: true, fileMustExist: true });
  try {
    const rows = probe.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") {
      throw new Error(`[backup] snapshot corupt (integrity_check, ${label})`);
    }
  } finally {
    probe.close();
  }
}

// Snapshot self-contained prin VACUUM INTO (sincron; include tot ce e comis,
// nu depinde de WAL, functioneaza si de pe conexiuni readonly): stage la
// `.tmp`, verificare, rename atomic pe numele final.
function snapshotViaVacuumInto(db: Database.Database, dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  const tmp = `${dest}.tmp`;
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* missing is fine */
  }
  try {
    db.prepare("VACUUM INTO ?").run(tmp);
    verifySnapshot(tmp, name);
    fs.renameSync(tmp, dest);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
    throw e;
  }
  return dest;
}

// rename cu retry pe erorile tranzitorii Windows (AV/indexer tin lock scurt).
async function renameWithRetryAsync(from: string, to: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await fsPromises.rename(from, to);
      return;
    } catch (e) {
      lastErr = e;
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw e;
      logBackupEvent({ action: "backup_rename_retry", attempt, code, from: path.basename(from) });
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw lastErr;
}

export interface BackupEntry {
  name: string;
  sizeBytes: number;
  mtime: number;
}

async function listBackupsWithMetaForDir(dir: string, prefix: string): Promise<BackupEntry[]> {
  const names = await listBackups(dir, prefix);
  const entries: BackupEntry[] = [];
  for (const name of names) {
    try {
      const s = await fsPromises.stat(path.join(dir, name));
      entries.push({ name, sizeBytes: s.size, mtime: s.mtimeMs });
    } catch {
      /* vanished between readdir and stat */
    }
  }
  // Newest first (mtime desc).
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries;
}

export async function listBackupsWithMeta(): Promise<BackupEntry[]> {
  return listBackupsWithMetaForDir(getBackupDir(), MAIN_PREFIX);
}

export async function listRnpmBackups(ownerId: string): Promise<BackupEntry[]> {
  return listBackupsWithMetaForDir(getRnpmBackupDir(ownerId), RNPM_PREFIX);
}

// ---------------------------------------------------------------------------
// Restore generic pe target (monolit / fisier rnpm per user)
// ---------------------------------------------------------------------------

interface RestoreTargetSpec {
  key: string;
  dir: string;
  prefix: string;
  dbPath: string;
  // Conexiunea pentru snapshot-ul pre-restore; null = fisierul viu nu exista
  // (restore la prima instalare) — se sare peste snapshot. close=true inchide
  // conexiunea dupa snapshot (temporara); false o lasa (handle-ul viu al
  // monolitului, inchis separat prin closeLive).
  openLiveForSnapshot: () => { db: Database.Database; close: boolean } | null;
  closeLive: () => void;
}

async function restoreTargetImpl(t: RestoreTargetSpec, name: string): Promise<{ preRestoreName: string }> {
  const src = path.join(t.dir, name);
  try {
    await fsPromises.access(src);
  } catch {
    throw new BackupValidationError("Backup inexistent");
  }

  const dbPath = t.dbPath;
  let dbExists = true;
  try {
    await fsPromises.access(dbPath);
  } catch {
    dbExists = false;
  }

  // Snapshot pre-restore SELF-CONTAINED prin VACUUM INTO, VERIFICAT, INAINTE
  // de close/unlink/swap — e singura cale de rollback promisa userului. Orice
  // esec abort-eaza restore-ul cu fisierul viu neatins.
  const preRestoreName = `${t.prefix}pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}${BACKUP_SUFFIX}`;
  const preRestorePath = path.join(t.dir, preRestoreName);
  if (dbExists) {
    const live = t.openLiveForSnapshot();
    if (live) {
      try {
        snapshotViaVacuumInto(live.db, t.dir, preRestoreName);
      } catch (e) {
        logBackupEvent({
          action: "restore_failed",
          target: t.key,
          source: name,
          stage: "pre_restore_snapshot",
          reason: e instanceof Error ? e.message : String(e),
        });
        throw new Error(`Nu am putut salva snapshot-ul pre-restore: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (live.close) live.db.close();
      }
    }
  }

  // Close the active handle so we can overwrite the file on Windows (which locks open files).
  t.closeLive();

  // Stale WAL/SHM sidecars belong to the OLD DB. Remove them BEFORE the rename
  // so there's no window where the new DB at `dbPath` is paired with WAL/SHM
  // pointing at the previous snapshot — opening that combination merges stale
  // WAL frames into the restored data and produces silent corruption.
  for (const suffix of ["-wal", "-shm"]) {
    try {
      await fsPromises.unlink(dbPath + suffix);
    } catch (e) {
      // ENOENT is benign. Anything else (EBUSY from AV / open handle, EACCES)
      // means the file survived and would pair with the new DB after rename →
      // silent corruption risk. Fail-closed: abort the restore.
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        logBackupEvent({
          action: "restore_failed",
          target: t.key,
          stage: "stale_sidecar_unlink_failed",
          source: name,
          sidecar: suffix,
          errnoCode: code,
          reason: e instanceof Error ? e.message : String(e),
        });
        throw new Error(
          `Nu am putut sterge sidecar-ul ${suffix} (${code}). Inchide programele care tin DB-ul deschis si reincearca.`
        );
      }
    }
  }

  // Atomic replace: stage to a temp sibling, then rename onto the active DB
  // path. BUNDLE-aware: backup-urile legacy (pre-v2.43.0) au fost copiate cu
  // sidecars — snapshot-ul e coerent doar ca triplet, deci copiem si -wal/-shm
  // daca exista langa sursa. Backup-urile noi (VACUUM INTO) nu au sidecars.
  const tmpPath = `${dbPath}.restore.tmp`;
  try {
    await fsPromises.copyFile(src, tmpPath);
    await fsPromises.rename(tmpPath, dbPath);
    for (const suffix of ["-wal", "-shm"] as const) {
      try {
        await fsPromises.access(src + suffix);
      } catch {
        continue;
      }
      await fsPromises.copyFile(src + suffix, dbPath + suffix);
    }
  } catch (e) {
    await fsPromises.unlink(tmpPath).catch(() => {
      /* missing is fine */
    });
    logBackupEvent({
      action: "restore_failed",
      target: t.key,
      source: name,
      stage: "rename",
      reason: e instanceof Error ? e.message : String(e),
    });
    throw new Error(`Restore esuat: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Confirma integritatea fisierului restaurat inainte de a-l accepta.
  // Conexiune read-write ca WAL-ul legacy (bundle) sa fie recuperat si
  // checkpoint-uit in fisierul principal, apoi sidecars dispar la close.
  try {
    const verifyDb = new Database(dbPath);
    try {
      const rows = verifyDb.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
      const allOk = rows.length === 1 && rows[0]?.integrity_check === "ok";
      if (!allOk) {
        const summary = rows
          .slice(0, 5)
          .map((r) => r.integrity_check)
          .join("; ");
        logBackupEvent({
          action: "restore_failed",
          target: t.key,
          source: name,
          stage: "integrity_check",
          rows: rows.length,
          summary,
        });
        throw new Error(`integrity_check pe DB-ul restaurat a esuat: ${summary}`);
      }
      verifyDb.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    } finally {
      verifyDb.close();
    }
  } catch (e) {
    // Auto-revert FAIL-SAFE: copie in `.revert-tmp` + rename cu retry (nu
    // copyFile direct peste fisierul viu). Esecul de unlink pe sidecars in
    // revert e THROW — un revert partial e mai rau decat o eroare explicita.
    if (dbExists) {
      try {
        const revertTmp = `${dbPath}.revert-tmp`;
        await fsPromises.copyFile(preRestorePath, revertTmp);
        await renameWithRetryAsync(revertTmp, dbPath);
        for (const suffix of ["-wal", "-shm"]) {
          try {
            await fsPromises.unlink(dbPath + suffix);
          } catch (sidecarErr) {
            const code = (sidecarErr as NodeJS.ErrnoException)?.code;
            if (code !== "ENOENT") {
              logBackupEvent({
                action: "restore_failed",
                target: t.key,
                source: name,
                stage: "auto_revert_sidecar_unlink",
                sidecar: suffix,
                errnoCode: code,
                reason: sidecarErr instanceof Error ? sidecarErr.message : String(sidecarErr),
              });
              throw new Error(
                `Auto-revert incomplet: sidecar-ul ${suffix} nu a putut fi sters (${code}). ` +
                  `Fisierul de recuperare: ${preRestoreName}`
              );
            }
          }
        }
      } catch (revertErr) {
        logBackupEvent({
          action: "restore_failed",
          target: t.key,
          source: name,
          stage: "auto_revert",
          reason: revertErr instanceof Error ? revertErr.message : String(revertErr),
        });
      }
    }
    throw new Error(e instanceof Error ? e.message : String(e));
  }

  logBackupEvent({
    action: "restore",
    target: t.key,
    source: name,
    preRestore: preRestoreName,
    preRestoreCreated: dbExists,
  });

  return { preRestoreName };
}

// Accept only our own backup-file pattern; blocks path traversal and arbitrary files.
const RESTORE_NAME_RE = /^legal-dashboard\.[A-Za-z0-9._-]+\.db$/;
const RNPM_RESTORE_NAME_RE = /^rnpm\.[A-Za-z0-9._-]+\.db$/;

function assertNameInJail(dir: string, name: string, re: RegExp): void {
  if (!re.test(name) || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new BackupValidationError("Nume backup invalid");
  }
  const resolved = path.resolve(dir, name);
  if (resolved !== path.join(dir, name) || !resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new BackupValidationError("Nume backup invalid (iesire din jail)");
  }
}

export async function restoreFromBackup(name: string): Promise<{ preRestoreName: string }> {
  assertNameInJail(getBackupDir(), name, RESTORE_NAME_RE);
  return withMaintenanceWrite(() =>
    restoreTargetImpl(
      {
        key: "main",
        dir: getBackupDir(),
        prefix: MAIN_PREFIX,
        dbPath: getDbPath(),
        // Snapshot-ul pre-restore vine de pe handle-ul viu; ramane deschis
        // pana la closeLive de mai jos.
        openLiveForSnapshot: () => ({ db: getDb(), close: false }),
        closeLive: () => closeDb(),
      },
      name
    )
  );
}

// Validare de versiune la restore RNPM: un backup produs de o versiune mai
// NOUA de schema ar bloca fisierul la urmatorul getRnpmDb (anti-downgrade-ul
// runner-ului) — reject inainte de swap, cu mesaj clar.
function assertRnpmBackupVersionCompatible(backupPath: string): void {
  const known = discoverMigrations(MIGRATIONS_RNPM_DIR);
  const maxKnown = known.reduce((m, f) => Math.max(m, f.version), 0);
  const probe = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const hasTable = probe
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_versions'")
      .get();
    if (!hasTable) return; // bundle legacy fara tracking — acceptat
    const row = probe.prepare("SELECT MAX(version) AS v FROM _schema_versions").get() as { v: number | null };
    const backupVersion = row.v ?? 0;
    if (backupVersion > maxKnown) {
      throw new BackupValidationError(
        `Backup-ul are o versiune de schema mai noua (${backupVersion}) decat aplicatia (${maxKnown}). ` +
          "Actualizeaza aplicatia inainte de restore."
      );
    }
  } finally {
    probe.close();
  }
}

export async function restoreRnpmFromBackup(ownerId: string, name: string): Promise<{ preRestoreName: string }> {
  const jail = getRnpmBackupDir(ownerId); // valideaza implicit ownerId (stem)
  assertNameInJail(jail, name, RNPM_RESTORE_NAME_RE);
  return withMaintenanceWrite(async () => {
    // Gard de concurenta: arunca SEARCH_ACTIVE daca ownerul are o cautare in
    // zbor; latch-ul (isRnpmRestoreInProgress) tine restul operatiilor
    // ownerului afara pe toata durata (verificat in getRnpmDb).
    beginRnpmRestore(ownerId);
    try {
      const src = path.join(jail, name);
      try {
        await fsPromises.access(src);
      } catch {
        throw new BackupValidationError("Backup inexistent");
      }
      assertRnpmBackupVersionCompatible(src);
      return await restoreTargetImpl(
        {
          key: `rnpm:${ownerId}`,
          dir: jail,
          prefix: RNPM_PREFIX,
          dbPath: getRnpmDbPath(ownerId),
          // Fisierul viu se snapshot-uieste printr-o conexiune temporara
          // readonly (openRnpmDbRaw) — latch-ul de restore e deja activ, deci
          // getRnpmDb ar refuza; null = fisier absent, se sare peste snapshot.
          openLiveForSnapshot: () => {
            const raw = openRnpmDbRaw(ownerId);
            return raw ? { db: raw, close: true } : null;
          },
          closeLive: () => closeRnpmDb(ownerId),
        },
        name
      );
    } finally {
      endRnpmRestore(ownerId);
    }
  });
}

async function deleteAllBackupsInDir(dir: string, prefix: string, logAction: string): Promise<number> {
  const backups = await listBackups(dir, prefix);
  let deleted = 0;
  for (const f of backups) {
    try {
      await fsPromises.unlink(path.join(dir, f));
      deleted++;
      // Bundle-aware: sidecar-urile legacy pleaca odata cu backup-ul.
      for (const suffix of ["-wal", "-shm"] as const) {
        await fsPromises.unlink(path.join(dir, f + suffix)).catch(() => {
          /* best-effort */
        });
      }
    } catch {
      /* best-effort */
    }
  }
  logBackupEvent({
    action: logAction,
    dir: path.basename(dir),
    deleted,
    total: backups.length,
  });
  return deleted;
}

export async function deleteAllBackups(): Promise<number> {
  return deleteAllBackupsInDir(getBackupDir(), MAIN_PREFIX, "delete_all_backups");
}

export async function deleteRnpmBackups(ownerId: string): Promise<number> {
  return deleteAllBackupsInDir(getRnpmBackupDir(ownerId), RNPM_PREFIX, "delete_rnpm_backups");
}

// v2.34.0 P1-8: offsite upload hook. Env `LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD`
// is a shell command (POSIX `sh -c` on linux/darwin, `cmd /c` on win32) that
// receives the absolute backup path via the env var `LEGAL_DASHBOARD_BACKUP_PATH`
// (injected below) — NOT as a positional `$1`/`%1` (POSIX `sh -c` puts the
// first operand in `$0`, and `cmd /c` does not expand positional `%1` for an
// inline command string). Example values:
//   - `rclone copy "$LEGAL_DASHBOARD_BACKUP_PATH" s3:mybucket/legal-dashboard/`
//   - `aws s3 cp "$LEGAL_DASHBOARD_BACKUP_PATH" s3://mybucket/legal-dashboard/`
//   - `scp "$LEGAL_DASHBOARD_BACKUP_PATH" user@offsite.example:/var/backups/legal-dashboard/`
// Unset = no-op (preserves desktop default behavior). Timeout: 10 minutes
// (offsite transports must finish within that window or the run is
// considered failed; the local backup is kept regardless).
//
// SECURITY (audit O3): this value is passed verbatim to `sh -c` / `cmd /c`
// (see the spawn below) and is therefore equivalent to arbitrary code
// execution at the backend's OS-user privilege. It MUST be set only by the
// trusted operator from the shell/orchestrator env, never derived from any
// request or other untrusted input, and never committed to a shipped .env.
const OFFSITE_HOOK_TIMEOUT_MS = 10 * 60 * 1000;
async function runOffsiteBackupHook(backupPath: string): Promise<void> {
  const cmd = process.env.LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD;
  if (!cmd || cmd.trim() === "") return;
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "cmd.exe" : "/bin/sh";
  const shellFlag = isWindows ? "/c" : "-c";
  const startMs = Date.now();
  await new Promise<void>((resolve) => {
    const child = spawn(shell, [shellFlag, cmd, backupPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LEGAL_DASHBOARD_BACKUP_PATH: backupPath },
    });
    let stderr = "";
    child.stdout?.on("data", () => {
      /* discard stdout — hook is fire-and-log */
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });
    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
      logBackupEvent({
        action: "offsite_backup_failed",
        stage: "timeout",
        file: path.basename(backupPath),
        durationMs: Date.now() - startMs,
      });
      resolve();
    }, OFFSITE_HOOK_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(killTimer);
      logBackupEvent({
        action: "offsite_backup_failed",
        stage: "spawn",
        file: path.basename(backupPath),
        reason: err.message,
      });
      resolve();
    });
    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      if (code === 0) {
        logBackupEvent({
          action: "offsite_backup",
          file: path.basename(backupPath),
          durationMs: Date.now() - startMs,
        });
      } else {
        logBackupEvent({
          action: "offsite_backup_failed",
          stage: "exit",
          file: path.basename(backupPath),
          exitCode: code,
          signal,
          stderr: stderr.slice(0, 1024),
          durationMs: Date.now() - startMs,
        });
      }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Backup manual (self-service) — monolit + per user
// ---------------------------------------------------------------------------

async function createManualBackupForTarget(t: BackupTarget): Promise<{ name: string; dest: string }> {
  const name = `${t.prefix}manual-${stampNow()}${BACKUP_SUFFIX}`;
  const dest = await withMaintenanceWrite(async () => {
    const conn = t.openForSnapshot();
    try {
      const out = snapshotViaVacuumInto(conn.db, t.dir, name);
      await pruneOld(t.dir, t.prefix);
      return out;
    } finally {
      if (conn.close) conn.db.close();
    }
  });
  logBackupEvent({ action: "manual_backup", target: t.key, file: name });
  // Offsite in AFARA lock-ului de maintenance (transportul poate dura minute).
  await runOffsiteBackupHook(dest);
  return { name, dest };
}

export async function createManualBackup(): Promise<{ name: string }> {
  const { name } = await createManualBackupForTarget(mainTarget());
  return { name };
}

export async function createRnpmManualBackup(ownerId: string): Promise<{ name: string }> {
  // Daca fisierul nu exista inca, PROVISIONEAZA prin getRnpmDb — un user nou
  // primeste un backup valid al bazei goale (decizie explicita de plan).
  const name = `${RNPM_PREFIX}manual-${stampNow()}${BACKUP_SUFFIX}`;
  const jail = getRnpmBackupDir(ownerId);
  const dest = await withMaintenanceWrite(async () => {
    const db = getRnpmDb(ownerId);
    const out = snapshotViaVacuumInto(db, jail, name);
    await pruneOld(jail, RNPM_PREFIX);
    return out;
  });
  logBackupEvent({ action: "manual_backup", target: `rnpm:${ownerId}`, file: name });
  await runOffsiteBackupHook(dest);
  return { name };
}

// ---------------------------------------------------------------------------
// Daily backup multi-target
// ---------------------------------------------------------------------------

// Promise-ul backup-ului in curs — gracefulShutdown il asteapta cu timeout
// inainte de markRnpmShuttingDown/markShuttingDown (un VACUUM INTO intrerupt
// de close arunca in mijlocul snapshot-ului).
let backupInFlight: Promise<unknown> | null = null;

export async function waitForBackupToSettle(timeoutMs = 10_000): Promise<void> {
  const current = backupInFlight;
  if (!current) return;
  await Promise.race([
    current.catch(() => {
      /* esecul e deja logat de runDailyBackup */
    }),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

// Snapshot-ul zilnic al unui target, cu freshness PER TARGET (main fresh nu
// are voie sa sara peste targeturile rnpm noi/stale). Returneaza path-ul
// fisierului proaspat sau null (fresh / esec logat).
async function dailyBackupTarget(t: BackupTarget): Promise<string | null> {
  try {
    await fsPromises.mkdir(t.dir, { recursive: true });
  } catch (e) {
    logBackupEvent({
      action: "daily_backup_failed",
      target: t.key,
      stage: "mkdir",
      reason: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
  await cleanupOrphanTmp(t.dir, t.prefix);
  const lastMtime = await latestBackupMtime(t.dir, t.prefix);
  if (lastMtime && Date.now() - lastMtime < BACKUP_INTERVAL_MS) return null;

  const name = todayBackupName(t.prefix);
  try {
    const conn = t.openForSnapshot();
    let dest: string;
    try {
      dest = snapshotViaVacuumInto(conn.db, t.dir, name);
    } finally {
      if (conn.close) conn.db.close();
    }
    const pruned = await pruneOld(t.dir, t.prefix);
    logBackupEvent({
      action: "daily_backup",
      target: t.key,
      file: name,
      pruned,
    });
    return dest;
  } catch (e) {
    logBackupEvent({
      action: "daily_backup_failed",
      target: t.key,
      stage: "backup",
      file: name,
      reason: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function runDailyBackupImpl(): Promise<string[]> {
  const fresh: string[] = [];
  const main = await dailyBackupTarget(mainTarget());
  if (main) fresh.push(main);

  // Enumerare DE PE DISC a fisierelor per user (fara provisioning, fara handle
  // persistent in registry): stem-urile vin din numele fisierelor .db.
  let stems: string[] = [];
  try {
    stems = (await fsPromises.readdir(getRnpmDataDir()))
      .filter((f) => f.endsWith(BACKUP_SUFFIX))
      .map((f) => f.slice(0, -BACKUP_SUFFIX.length));
  } catch {
    /* directorul rnpm nu exista inca (pre-split / fara useri) */
  }
  for (const stem of stems) {
    const dest = await dailyBackupTarget(rnpmTargetForStemFile(stem));
    if (dest) fresh.push(dest);
  }
  return fresh;
}

export async function runDailyBackup(): Promise<void> {
  // Serialize with restoreFromBackup so a user-triggered restore that closes
  // the DB cannot interleave with the snapshot running from this scheduler.
  // Offsite hook-urile ruleaza DUPA eliberarea lock-ului — N useri x 10 min
  // timeout de transport nu au voie sa blocheze toate scrierile.
  const run = (async () => {
    const fresh = await withMaintenanceWrite(runDailyBackupImpl);
    for (const f of fresh) {
      await runOffsiteBackupHook(f);
    }
  })();
  backupInFlight = run;
  try {
    await run;
  } finally {
    if (backupInFlight === run) backupInFlight = null;
  }
}
