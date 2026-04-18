import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { getDb, getDbPath, closeDb } from "./schema.ts";

// Daily snapshot of legal-dashboard.db, kept in a sibling "backups/" folder.
// Uses SQLite's online backup API (better-sqlite3 db.backup) — safe while the
// DB is in use; respects WAL without requiring a checkpoint or exclusive lock.
const BACKUP_RETAIN_COUNT = 7;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_PREFIX = "legal-dashboard.";
const BACKUP_SUFFIX = ".db";

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
  const backups = await listBackups(dir);
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
  const backups = await listBackups(dir);
  // Filename contains YYYY-MM-DD, so lexicographic sort = chronological.
  const sorted = backups.sort().reverse();
  const toDelete = sorted.slice(BACKUP_RETAIN_COUNT);
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

  // Overwrite the active DB file.
  await fsPromises.copyFile(src, dbPath);

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
