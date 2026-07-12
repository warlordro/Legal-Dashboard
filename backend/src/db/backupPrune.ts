import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

const BYTES_PER_MIB = 1024 * 1024;
const DEFAULT_RNPM_BACKUP_CAP_MB = 500;
const RNPM_PREFIX = "rnpm.";

const MAIN_RETAIN = { dated: 7, preRestore: 5, manual: 5, preMigration: 5, preSplit: 3 } as const;
const RNPM_RETAIN = { dated: 3, preRestore: 2, manual: 2, preMigration: 2, preSplit: 0 } as const;

type PoolName = keyof typeof MAIN_RETAIN;
type LogEvent = (entry: Record<string, unknown>) => void;

export interface BackupPruneOptions {
  protectedNames?: string[];
  logEvent?: LogEvent;
}

export interface BackupPruneResult {
  pruned: number;
  capSatisfied: boolean;
}

let warnedInvalidRnpmBackupCap = false;

export function readRnpmBackupCapBytes(): number | null {
  const raw = process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB;
  if (raw === undefined || raw === "") return DEFAULT_RNPM_BACKUP_CAP_MB * BYTES_PER_MIB;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    if (!warnedInvalidRnpmBackupCap) {
      warnedInvalidRnpmBackupCap = true;
      console.warn(
        `[backupPrune] LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB invalid ("${raw}") — folosesc default ${DEFAULT_RNPM_BACKUP_CAP_MB} MB.`
      );
    }
    return DEFAULT_RNPM_BACKUP_CAP_MB * BYTES_PER_MIB;
  }
  if (parsed <= 0) return null;
  return Math.round(parsed * BYTES_PER_MIB);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function poolRegexes(prefix: string): Record<PoolName, RegExp> {
  const escaped = escapeRegExp(prefix);
  return {
    dated: new RegExp(`^${escaped}\\d{4}-\\d{2}-\\d{2}\\.db$`),
    preRestore: new RegExp(`^${escaped}pre-restore-[^\\/]+\\.db$`),
    manual: new RegExp(`^${escaped}manual-[^\\/]+\\.db$`),
    preMigration: new RegExp(`^${escaped}pre-(?!restore-|rnpm-split-)[^\\/]+\\.db$`),
    preSplit: new RegExp(`^${escaped}pre-rnpm-split-[^\\/]+\\.db$`),
  };
}

function isPrimaryBackup(name: string, prefix: string): boolean {
  return name.startsWith(prefix) && name.endsWith(".db");
}

async function unlinkBundle(dir: string, name: string, logEvent: LogEvent): Promise<boolean> {
  try {
    await fsPromises.unlink(path.join(dir, name));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      logEvent({ action: "backup_prune_failed", file: name, errnoCode: code ?? null });
      return false;
    }
  }
  for (const suffix of ["-wal", "-shm"] as const) {
    try {
      await fsPromises.unlink(path.join(dir, name + suffix));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        logEvent({ action: "backup_prune_failed", file: name + suffix, errnoCode: code ?? null });
      }
    }
  }
  return true;
}

function unlinkBundleSync(dir: string, name: string, logEvent: LogEvent): boolean {
  try {
    fs.unlinkSync(path.join(dir, name));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      logEvent({ action: "backup_prune_failed", file: name, errnoCode: code ?? null });
      return false;
    }
  }
  for (const suffix of ["-wal", "-shm"] as const) {
    try {
      fs.unlinkSync(path.join(dir, name + suffix));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") logEvent({ action: "backup_prune_failed", file: name + suffix, errnoCode: code ?? null });
    }
  }
  return true;
}

function isAccountedName(name: string, prefix: string): boolean {
  return (
    name.startsWith(prefix) &&
    (name.endsWith(".db") || name.endsWith(".db-wal") || name.endsWith(".db-shm") || name.endsWith(".db.tmp"))
  );
}

async function measureJail(
  dir: string,
  prefix: string,
  logEvent: LogEvent
): Promise<{ bytes: number; reliable: boolean }> {
  let entries: string[];
  try {
    entries = await fsPromises.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { bytes: 0, reliable: true };
    logEvent({
      action: "backup_prune_failed",
      stage: "readdir",
      errnoCode: (error as NodeJS.ErrnoException)?.code ?? null,
    });
    return { bytes: 0, reliable: false };
  }
  let bytes = 0;
  let reliable = true;
  for (const name of entries.filter((entry) => isAccountedName(entry, prefix))) {
    try {
      bytes += (await fsPromises.stat(path.join(dir, name))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        reliable = false;
        logEvent({ action: "backup_prune_failed", stage: "stat", file: name });
      }
    }
  }
  return { bytes, reliable };
}

function measureJailSync(dir: string, prefix: string, logEvent: LogEvent): { bytes: number; reliable: boolean } {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { bytes: 0, reliable: true };
    logEvent({
      action: "backup_prune_failed",
      stage: "readdir",
      errnoCode: (error as NodeJS.ErrnoException)?.code ?? null,
    });
    return { bytes: 0, reliable: false };
  }
  let bytes = 0;
  let reliable = true;
  for (const name of entries.filter((entry) => isAccountedName(entry, prefix))) {
    try {
      bytes += fs.statSync(path.join(dir, name)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        reliable = false;
        logEvent({ action: "backup_prune_failed", stage: "stat", file: name });
      }
    }
  }
  return { bytes, reliable };
}

async function cleanupTmp(dir: string, prefix: string, logEvent: LogEvent): Promise<void> {
  let entries: string[];
  try {
    entries = await fsPromises.readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      logEvent({ action: "backup_prune_failed", stage: "tmp_list", errnoCode: code ?? null });
    }
    return;
  }
  for (const name of entries.filter((entry) => entry.startsWith(prefix) && entry.endsWith(".db.tmp"))) {
    try {
      await fsPromises.unlink(path.join(dir, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        logEvent({ action: "backup_prune_failed", stage: "tmp_cleanup", file: name });
      }
    }
  }
}

function cleanupTmpSync(dir: string, prefix: string, logEvent: LogEvent): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      logEvent({ action: "backup_prune_failed", stage: "tmp_list", errnoCode: code ?? null });
    }
    return;
  }
  for (const name of entries.filter((entry) => entry.startsWith(prefix) && entry.endsWith(".db.tmp"))) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        logEvent({ action: "backup_prune_failed", stage: "tmp_cleanup", file: name });
      }
    }
  }
}

function numberCandidates(
  names: string[],
  prefix: string,
  protectedNames: Set<string>
): { candidates: string[]; pools: Map<PoolName, string[]> } {
  const regexes = poolRegexes(prefix);
  const retention = prefix === RNPM_PREFIX ? RNPM_RETAIN : MAIN_RETAIN;
  const pools = new Map<PoolName, string[]>();
  const candidates: string[] = [];
  for (const pool of Object.keys(regexes) as PoolName[]) {
    const sorted = names
      .filter((name) => regexes[pool].test(name))
      .sort()
      .reverse();
    pools.set(pool, sorted);
    for (const name of sorted.slice(retention[pool])) {
      if (!protectedNames.has(name)) candidates.push(name);
    }
  }
  return { candidates, pools };
}

async function byteCandidates(
  dir: string,
  names: string[],
  prefix: string,
  protectedNames: Set<string>
): Promise<string[]> {
  const regexes = poolRegexes(prefix);
  const floor = new Set<string>();
  for (const pool of ["dated", "preRestore", "manual", "preMigration"] as const) {
    const newest = names
      .filter((name) => regexes[pool].test(name))
      .sort()
      .reverse()[0];
    if (newest) floor.add(newest);
  }
  const candidates = names.filter((name) => !floor.has(name) && !protectedNames.has(name));
  const withMtime = await Promise.all(
    candidates.map(async (name) => {
      try {
        return { name, mtimeMs: (await fsPromises.stat(path.join(dir, name))).mtimeMs };
      } catch {
        return { name, mtimeMs: Number.POSITIVE_INFINITY };
      }
    })
  );
  return withMtime.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name)).map((entry) => entry.name);
}

function byteCandidatesSync(dir: string, names: string[], prefix: string, protectedNames: Set<string>): string[] {
  const regexes = poolRegexes(prefix);
  const floor = new Set<string>();
  for (const pool of ["dated", "preRestore", "manual", "preMigration"] as const) {
    const newest = names
      .filter((name) => regexes[pool].test(name))
      .sort()
      .reverse()[0];
    if (newest) floor.add(newest);
  }
  return names
    .filter((name) => !floor.has(name) && !protectedNames.has(name))
    .map((name) => {
      try {
        return { name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs };
      } catch {
        return { name, mtimeMs: Number.POSITIVE_INFINITY };
      }
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))
    .map((entry) => entry.name);
}

export async function pruneBackupJail(
  dir: string,
  prefix: string,
  options: BackupPruneOptions = {}
): Promise<BackupPruneResult> {
  const logEvent = options.logEvent ?? (() => undefined);
  const protectedNames = new Set(options.protectedNames ?? []);
  await cleanupTmp(dir, prefix, logEvent);
  let names: string[];
  try {
    names = (await fsPromises.readdir(dir)).filter((name) => isPrimaryBackup(name, prefix));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { pruned: 0, capSatisfied: true };
    logEvent({
      action: "backup_prune_failed",
      stage: "list",
      errnoCode: (error as NodeJS.ErrnoException)?.code ?? null,
    });
    return { pruned: 0, capSatisfied: false };
  }

  let pruned = 0;
  const { candidates } = numberCandidates(names, prefix, protectedNames);
  for (const name of candidates) if (await unlinkBundle(dir, name, logEvent)) pruned++;

  if (prefix !== RNPM_PREFIX) return { pruned, capSatisfied: true };
  const capBytes = readRnpmBackupCapBytes();
  if (capBytes === null) return { pruned, capSatisfied: true };

  try {
    names = (await fsPromises.readdir(dir)).filter((name) => isPrimaryBackup(name, prefix));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { pruned, capSatisfied: true };
    logEvent({ action: "backup_prune_failed", stage: "list_after_count", errnoCode: code ?? null });
    return { pruned, capSatisfied: false };
  }
  let measured = await measureJail(dir, prefix, logEvent);
  if (measured.reliable && measured.bytes <= capBytes) return { pruned, capSatisfied: true };
  for (const name of await byteCandidates(dir, names, prefix, protectedNames)) {
    if (measured.reliable && measured.bytes <= capBytes) break;
    if (await unlinkBundle(dir, name, logEvent)) pruned++;
    measured = await measureJail(dir, prefix, logEvent);
  }
  const capSatisfied = measured.reliable && measured.bytes <= capBytes;
  logEvent({ action: "rnpm_backup_cap", dir: path.basename(dir), usedBytes: measured.bytes, capBytes, capSatisfied });
  return { pruned, capSatisfied };
}

export function pruneBackupJailSync(dir: string, prefix: string, options: BackupPruneOptions = {}): BackupPruneResult {
  const logEvent = options.logEvent ?? (() => undefined);
  const protectedNames = new Set(options.protectedNames ?? []);
  cleanupTmpSync(dir, prefix, logEvent);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => isPrimaryBackup(name, prefix));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { pruned: 0, capSatisfied: true };
    logEvent({ action: "backup_prune_failed", stage: "list" });
    return { pruned: 0, capSatisfied: false };
  }
  let pruned = 0;
  for (const name of numberCandidates(names, prefix, protectedNames).candidates) {
    if (unlinkBundleSync(dir, name, logEvent)) pruned++;
  }
  if (prefix !== RNPM_PREFIX) return { pruned, capSatisfied: true };
  const capBytes = readRnpmBackupCapBytes();
  if (capBytes === null) return { pruned, capSatisfied: true };

  try {
    names = fs.readdirSync(dir).filter((name) => isPrimaryBackup(name, prefix));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { pruned, capSatisfied: true };
    logEvent({ action: "backup_prune_failed", stage: "list_after_count", errnoCode: code ?? null });
    return { pruned, capSatisfied: false };
  }
  let measured = measureJailSync(dir, prefix, logEvent);
  for (const name of byteCandidatesSync(dir, names, prefix, protectedNames)) {
    if (measured.reliable && measured.bytes <= capBytes) break;
    if (unlinkBundleSync(dir, name, logEvent)) pruned++;
    measured = measureJailSync(dir, prefix, logEvent);
  }
  const capSatisfied = measured.reliable && measured.bytes <= capBytes;
  logEvent({ action: "rnpm_backup_cap", dir: path.basename(dir), usedBytes: measured.bytes, capBytes, capSatisfied });
  return { pruned, capSatisfied };
}
