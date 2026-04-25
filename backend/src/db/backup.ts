import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { getDb, getDbPath, closeDb } from "./schema.ts";

// Daily snapshot of legal-dashboard.db, kept in a sibling "backups/" folder.
// Uses SQLite's online backup API (better-sqlite3 db.backup) — safe while the
// DB is in use; respects WAL without requiring a checkpoint or exclusive lock.
const BACKUP_RETAIN_COUNT = 7;
// Pre-restore snapshots are the user's only rollback path after a restore. Keep
// a separate retention bucket so a burst of restores can't evict all the dated
// daily backups (or vice versa). Lex sort on ISO timestamps = chronological.
const PRE_RESTORE_RETAIN = 5;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_PREFIX = "legal-dashboard.";
const BACKUP_SUFFIX = ".db";
// Daily backup: `legal-dashboard.YYYY-MM-DD.db`
const DATED_BACKUP_RE = /^legal-dashboard\.\d{4}-\d{2}-\d{2}\.db$/;
// Pre-restore snapshot: `legal-dashboard.pre-restore-<ISO-with-dashes>.db`
const PRE_RESTORE_RE = /^legal-dashboard\.pre-restore-/;

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
    } catch { /* file vanished between readdir and stat */ }
  }
  return max || null;
}

async function pruneOld(dir: string): Promise<number> {
  const all = await listBackups(dir);
  // Two separate pools so the retention cap of one cannot starve the other.
  // Pre-restore filenames embed an ISO timestamp; lex sort = chronological.
  const dated = all.filter((f) => DATED_BACKUP_RE.test(f)).sort().reverse();
  const preRestore = all.filter((f) => PRE_RESTORE_RE.test(f)).sort().reverse();
  const toDelete = [
    ...dated.slice(BACKUP_RETAIN_COUNT),
    ...preRestore.slice(PRE_RESTORE_RETAIN),
  ];
  for (const f of toDelete) {
    await fsPromises.unlink(path.join(dir, f)).catch(() => { /* best-effort */ });
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
    } catch { /* vanished between readdir and stat */ }
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
  const dir = getBackupDir();
  const src = path.join(dir, name);
  try {
    await fsPromises.access(src);
  } catch {
    throw new Error("Backup inexistent");
  }

  const dbPath = getDbPath();

  // Close the active handle so we can overwrite the file on Windows (which locks open files).
  closeDb();

  // Preventive snapshot of the current DB into backups/ so the user can roll the restore back.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const preRestoreName = `${BACKUP_PREFIX}pre-restore-${ts}${BACKUP_SUFFIX}`;
  const preRestorePath = path.join(dir, preRestoreName);
  try {
    if (fs.existsSync(dbPath)) {
      await fsPromises.copyFile(dbPath, preRestorePath);
    }
  } catch (e) {
    throw new Error(
      `Nu am putut salva snapshot-ul pre-restore: ${e instanceof Error ? e.message : String(e)}`,
    );
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
    await fsPromises.unlink(tmpPath).catch(() => { /* missing is fine */ });
    throw new Error(
      `Restore esuat: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Stale WAL/SHM sidecars belong to the old DB; removing them forces a clean open.
  for (const suffix of ["-wal", "-shm"]) {
    try { await fsPromises.unlink(dbPath + suffix); } catch { /* missing is fine */ }
  }

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
    } catch { /* best-effort */ }
  }
  return deleted;
}

export async function runDailyBackup(): Promise<void> {
  const dir = getBackupDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn("[backup] cannot create backup dir:", e instanceof Error ? e.message : e);
    return;
  }

  const lastMtime = await latestBackupMtime(dir);
  if (lastMtime && Date.now() - lastMtime < BACKUP_INTERVAL_MS) return;

  const dest = path.join(dir, todayBackupName());
  try {
    await getDb().backup(dest);
    const pruned = await pruneOld(dir);
    console.log(`[backup] saved ${path.basename(dest)}${pruned > 0 ? ` (pruned ${pruned} old)` : ""}`);
  } catch (e) {
    console.warn("[backup] failed:", e instanceof Error ? e.message : e);
  }
}
