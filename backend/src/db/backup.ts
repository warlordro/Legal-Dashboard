import { spawn } from "node:child_process";
import path from "node:path";
import fsPromises from "node:fs/promises";
import Database from "better-sqlite3";
import { getDb, getDbPath, closeDb } from "./schema.ts";
import { RWLock } from "../util/rwlock.ts";

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
// Production callers are restoreFromBackup() and runDailyBackup() below.
//
// Tier 3 #17: previously exported as the test-only `_withMaintenanceWriteForTest`
// alongside a private `withMaintenanceWrite`. The two were the same primitive —
// only naming made one "test-only". Promoted to a single public symbol so the
// production module no longer carries test-marked API.
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

// Daily snapshot of legal-dashboard.db, kept in a sibling "backups/" folder.
// Uses SQLite's online backup API (better-sqlite3 db.backup) — safe while the
// DB is in use; respects WAL without requiring a checkpoint or exclusive lock.
const BACKUP_RETAIN_COUNT = 7;
// Pre-restore snapshots are the user's only rollback path after a restore. Keep
// a separate retention bucket so a burst of restores can't evict all the dated
// daily backups (or vice versa). Lex sort on ISO timestamps = chronological.
const PRE_RESTORE_RETAIN = 5;
// Pre-migration snapshots (e.g. `legal-dashboard.pre-descriere-dedup-<stamp>.db`,
// produced from `backend/src/db/schema.ts` before destructive ALTERs). Kept in a
// third pool so retention of one pool never starves another. Conservative cap —
// these only fire on schema upgrades, so 5 covers multiple major versions.
const PRE_MIGRATION_RETAIN = 5;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_PREFIX = "legal-dashboard.";
const BACKUP_SUFFIX = ".db";
// Daily backup: `legal-dashboard.YYYY-MM-DD.db`
const DATED_BACKUP_RE = /^legal-dashboard\.\d{4}-\d{2}-\d{2}\.db$/;
// Pre-restore snapshot: `legal-dashboard.pre-restore-<ISO-with-dashes>.db`
const PRE_RESTORE_RE = /^legal-dashboard\.pre-restore-/;
// Pre-migration snapshot: `legal-dashboard.pre-<label>-<stamp>.db` for any
// label except `restore`. Negative lookahead keeps the two `pre-*` buckets
// disjoint so pruning logic is unambiguous.
const PRE_MIGRATION_RE = /^legal-dashboard\.pre-(?!restore-)[^.]+\.db$/;

export function getBackupDir(): string {
  return path.join(path.dirname(getDbPath()), "backups");
}

function todayBackupName(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${BACKUP_PREFIX}${y}-${m}-${d}${BACKUP_SUFFIX}`;
}

async function listBackups(dir: string): Promise<string[]> {
  try {
    const entries = await fsPromises.readdir(dir);
    return entries.filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(BACKUP_SUFFIX));
  } catch {
    return [];
  }
}

// Half-written backups left by a prior crash / SIGTERM / power loss between
// `db.backup(tmp)` and the atomic rename below. Filter is strict (`.db.tmp`
// suffix on a backup-prefixed name) so we never touch unrelated files even if
// the user drops them into the backups folder.
async function cleanupOrphanTmp(dir: string): Promise<void> {
  try {
    const entries = await fsPromises.readdir(dir);
    for (const f of entries) {
      if (f.startsWith(BACKUP_PREFIX) && f.endsWith(`${BACKUP_SUFFIX}.tmp`)) {
        await fsPromises.unlink(path.join(dir, f)).catch(() => {
          /* best-effort */
        });
      }
    }
  } catch {
    /* dir missing — runDailyBackup will mkdir before us */
  }
}

async function latestBackupMtime(dir: string): Promise<number | null> {
  // Only count dated daily backups for "should I skip today's snapshot" — a recent
  // pre-restore snapshot was triggered by a user-initiated restore and does not
  // mean the daily snapshot has already happened.
  const backups = (await listBackups(dir)).filter((f) => DATED_BACKUP_RE.test(f));
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

async function pruneOld(dir: string): Promise<number> {
  const all = await listBackups(dir);
  // Three disjoint pools so the retention cap of one cannot starve the others.
  // Pre-* filenames embed an ISO timestamp; lex sort = chronological.
  const dated = all
    .filter((f) => DATED_BACKUP_RE.test(f))
    .sort()
    .reverse();
  const preRestore = all
    .filter((f) => PRE_RESTORE_RE.test(f))
    .sort()
    .reverse();
  const preMigration = all
    .filter((f) => PRE_MIGRATION_RE.test(f))
    .sort()
    .reverse();
  const toDelete = [
    ...dated.slice(BACKUP_RETAIN_COUNT),
    ...preRestore.slice(PRE_RESTORE_RETAIN),
    ...preMigration.slice(PRE_MIGRATION_RETAIN),
  ];
  for (const f of toDelete) {
    await fsPromises.unlink(path.join(dir, f)).catch(() => {
      /* best-effort */
    });
  }
  return toDelete.length;
}

export interface BackupEntry {
  name: string;
  sizeBytes: number;
  mtime: number;
}

export async function listBackupsWithMeta(): Promise<BackupEntry[]> {
  const dir = getBackupDir();
  const names = await listBackups(dir);
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

// Accept only our own backup-file pattern; blocks path traversal and arbitrary files.
const RESTORE_NAME_RE = /^legal-dashboard\.[A-Za-z0-9._-]+\.db$/;

export async function restoreFromBackup(name: string): Promise<{ preRestoreName: string }> {
  if (!RESTORE_NAME_RE.test(name) || name.includes("/") || name.includes("\\")) {
    throw new Error("Nume backup invalid");
  }
  return withMaintenanceWrite(() => restoreFromBackupImpl(name));
}

async function restoreFromBackupImpl(name: string): Promise<{ preRestoreName: string }> {
  const dir = getBackupDir();
  const src = path.join(dir, name);
  try {
    await fsPromises.access(src);
  } catch {
    throw new Error("Backup inexistent");
  }

  const dbPath = getDbPath();

  // Async existence probe — sync `fs.existsSync` here would block the event loop
  // for the duration of the stat call (visible on AV-locked DB files), and the
  // rest of this function is async-only.
  let dbExists = true;
  try {
    await fsPromises.access(dbPath);
  } catch {
    dbExists = false;
  }

  // Force WAL frames into the main DB BEFORE closing. better-sqlite3 does not
  // guarantee a TRUNCATE checkpoint on close, so without this the pre-restore
  // copyFile below would capture only the .db file and lose any uncommitted
  // WAL frames — making rollback to "moments before the restore" silently
  // incomplete. Best-effort: a checkpoint failure means the snapshot is
  // slightly stale, which is the same failure mode as before this fix.
  if (dbExists) {
    try {
      getDb().prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    } catch (e) {
      logBackupEvent({
        action: "restore",
        stage: "checkpoint_failed",
        source: name,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Close the active handle so we can overwrite the file on Windows (which locks open files).
  closeDb();

  // Preventive snapshot of the current DB into backups/ so the user can roll the restore back.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const preRestoreName = `${BACKUP_PREFIX}pre-restore-${ts}${BACKUP_SUFFIX}`;
  const preRestorePath = path.join(dir, preRestoreName);
  if (dbExists) {
    try {
      await fsPromises.copyFile(dbPath, preRestorePath);
    } catch (e) {
      logBackupEvent({
        action: "restore_failed",
        source: name,
        stage: "pre_restore_snapshot",
        reason: e instanceof Error ? e.message : String(e),
      });
      throw new Error(`Nu am putut salva snapshot-ul pre-restore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Stale WAL/SHM sidecars belong to the OLD DB. Remove them BEFORE the rename
  // so there's no window where the new DB at `dbPath` is paired with WAL/SHM
  // pointing at the previous snapshot — opening that combination merges stale
  // WAL frames into the restored data and produces silent corruption. Order
  // matters even on single-instance desktop because better-sqlite3's lazy open
  // can race with any post-rename code path.
  for (const suffix of ["-wal", "-shm"]) {
    try {
      await fsPromises.unlink(dbPath + suffix);
    } catch (e) {
      // ENOENT is benign — the sidecar legitimately does not exist. Anything
      // else (EBUSY on Windows from AV / open handle, EACCES, etc.) means the
      // file survived and will pair with the new DB after rename → silent
      // corruption risk on next open. Audit 2026-04-29 #2: flipped to throw —
      // a partial cleanup must abort the restore, not proceed silently. The
      // user retries after closing the offending process (AV scanner / external
      // sqlite client). Active DB handle is already closed (closeDb() above),
      // so the only realistic culprits are external readers.
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        logBackupEvent({
          action: "restore_failed",
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

  // Atomic replace: stage to a temp sibling, then rename onto the active DB path.
  // copyFile is non-atomic — a crash mid-copy would leave a half-written DB at
  // dbPath with stale WAL/SHM pointing at the old snapshot. Rename onto an
  // existing path is atomic same-volume on POSIX and on Windows (MoveFileEx
  // with MOVEFILE_REPLACE_EXISTING, which Node uses internally).
  const tmpPath = dbPath + ".restore.tmp";
  try {
    await fsPromises.copyFile(src, tmpPath);
    await fsPromises.rename(tmpPath, dbPath);
  } catch (e) {
    // Stale tmp may remain if the copy failed midway — best-effort cleanup so the
    // next restore attempt does not race a half-written sibling.
    await fsPromises.unlink(tmpPath).catch(() => {
      /* missing is fine */
    });
    logBackupEvent({
      action: "restore_failed",
      source: name,
      stage: "rename",
      reason: e instanceof Error ? e.message : String(e),
    });
    throw new Error(`Restore esuat: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Audit 2026-04-29 #2: confirma integritatea fisierului restaurat inainte
  // de a-l accepta. Daca backup-ul sursa era corupt (bit-rot pe disk, scriere
  // incompleta in trecut) restore-ul nu trebuie sa il puna in productie.
  // Deschidem un handle temporar (closeDb() s-a apelat mai sus, deci singleton-ul
  // e free) si rulam integrity_check; orice rezultat != "ok" abort-eaza.
  try {
    const verifyDb = new Database(dbPath, { readonly: true });
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
          source: name,
          stage: "integrity_check",
          rows: rows.length,
          summary,
        });
        throw new Error(`integrity_check pe DB-ul restaurat a esuat: ${summary}`);
      }
    } finally {
      verifyDb.close();
    }
  } catch (e) {
    // Best-effort revert: incercam sa restauram pre-restore snapshot-ul
    // automat, ca sa nu ramana userul cu un DB nepornibil. Daca revertul
    // esueaza, mesajul indica explicit fisierul de recuperare.
    if (dbExists) {
      try {
        await fsPromises.copyFile(preRestorePath, dbPath);
        // v2.20.8: dupa auto-revert trebuie sa stergem -wal/-shm pentru ca
        // sidecar-urile create de integrity_check (sau de scrierea/rename-ul
        // anterior) apartin DB-ului corupt. Daca le lasam, urmatorul open pe
        // dbPath ar putea merge frames stale → silent corruption pe DB-ul
        // care tocmai a fost revert-uit. Best-effort: ENOENT e benign;
        // orice alta eroare e logata dar nu blocheaza eroarea originala
        // (userul stie deja ca restore-ul a esuat).
        for (const suffix of ["-wal", "-shm"]) {
          try {
            await fsPromises.unlink(dbPath + suffix);
          } catch (sidecarErr) {
            const code = (sidecarErr as NodeJS.ErrnoException)?.code;
            if (code !== "ENOENT") {
              logBackupEvent({
                action: "restore_failed",
                source: name,
                stage: "auto_revert_sidecar_unlink",
                sidecar: suffix,
                errnoCode: code,
                reason: sidecarErr instanceof Error ? sidecarErr.message : String(sidecarErr),
              });
            }
          }
        }
      } catch (revertErr) {
        logBackupEvent({
          action: "restore_failed",
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
    source: name,
    preRestore: preRestoreName,
    preRestoreCreated: dbExists,
  });

  return { preRestoreName };
}

export async function deleteAllBackups(): Promise<number> {
  const dir = getBackupDir();
  const backups = await listBackups(dir);
  let deleted = 0;
  for (const f of backups) {
    try {
      await fsPromises.unlink(path.join(dir, f));
      deleted++;
    } catch {
      /* best-effort */
    }
  }
  // Audit line: mass-delete is a destructive op the user can trigger from the
  // UI. Logging count + total lets ops correlate "all backups gone" reports
  // with the actual click. No throw — partial failures already swallowed
  // above by design (one stuck file should not block the rest).
  logBackupEvent({
    action: "delete_all_backups",
    deleted,
    total: backups.length,
  });
  return deleted;
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

export async function runDailyBackup(): Promise<void> {
  // Serialize with restoreFromBackup so a user-triggered restore that closes
  // the DB cannot interleave with `db.backup()` running from this scheduler.
  // Lock is fast-path on desktop (no contention in practice).
  return withMaintenanceWrite(runDailyBackupImpl);
}

async function runDailyBackupImpl(): Promise<void> {
  const dir = getBackupDir();
  try {
    await fsPromises.mkdir(dir, { recursive: true });
  } catch (e) {
    logBackupEvent({
      action: "daily_backup_failed",
      stage: "mkdir",
      reason: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  // SQLite's online backup writes incrementally to its destination file. A
  // SIGTERM / power loss / crash mid-`db.backup()` would leave a partial file
  // at today's filename, which `latestBackupMtime` would then accept as
  // "fresh enough" and `restoreFromBackup` would silently corrupt the live
  // DB from on the next manual restore. Stage to a sibling `.tmp` and rename
  // atomically — incomplete writes leave only the `.tmp`, cleaned at the
  // next boot and skipped by the freshness check (different suffix).
  await cleanupOrphanTmp(dir);

  const lastMtime = await latestBackupMtime(dir);
  if (lastMtime && Date.now() - lastMtime < BACKUP_INTERVAL_MS) return;

  const dest = path.join(dir, todayBackupName());
  const tmp = `${dest}.tmp`;
  try {
    // Defensive: an extra orphan can survive cleanupOrphanTmp if mkdirSync above
    // raced with another writer; ensure tmp slot is empty before db.backup.
    await fsPromises.unlink(tmp).catch(() => {
      /* missing is fine */
    });
    await getDb().backup(tmp);
    await fsPromises.rename(tmp, dest);
    const pruned = await pruneOld(dir);
    logBackupEvent({
      action: "daily_backup",
      file: path.basename(dest),
      pruned,
    });
    // v2.34.0 P1-8: optional offsite upload hook. Configured via env so the
    // user can plug in rclone / aws s3 cp / az storage blob upload / scp /
    // any other transport without recompiling. Hook receives the absolute
    // path to the freshly-written backup via env `LEGAL_DASHBOARD_BACKUP_PATH`;
    // non-zero exit is logged but
    // does NOT fail the local backup (offsite is a redundancy layer, the
    // local snapshot already succeeded by this point).
    await runOffsiteBackupHook(dest);
  } catch (e) {
    // Best-effort cleanup so the next attempt does not race a half-written sibling.
    await fsPromises.unlink(tmp).catch(() => {
      /* missing is fine */
    });
    logBackupEvent({
      action: "daily_backup_failed",
      stage: "backup",
      file: path.basename(dest),
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}
