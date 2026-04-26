import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

// Sentinel hash recorded for legacy DBs (pre-PR-0) that already contain the schema
// but were never tracked by _schema_versions. Detected at boot when the table is
// empty AND user tables exist; baseline migration is then SKIPPED, not re-applied.
export const BACKFILL_SENTINEL = "__backfilled_v1__";

const MIGRATION_FILE_RE = /^(\d{4})_[a-z0-9_-]+\.up\.sql$/i;

export interface MigrationFile {
  version: number;
  name: string;
  fullPath: string;
  sql: string;
  sha256: string;
}

export interface RunMigrationsResult {
  applied: number[];
  skipped: number[];
  backfilled: boolean;
  totalKnown: number;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// Synchronous on purpose - runs once at boot, never inside a request handler (CQ-6).
export function discoverMigrations(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`[migrations] directory missing: ${migrationsDir}`);
  }
  const entries = fs.readdirSync(migrationsDir);
  const files: MigrationFile[] = [];
  for (const name of entries) {
    const m = name.match(MIGRATION_FILE_RE);
    if (!m) continue; // ignore .down.sql, README, sidecar files
    const version = Number(m[1]);
    const fullPath = path.join(migrationsDir, name);
    const sql = fs.readFileSync(fullPath, "utf8");
    files.push({ version, name, fullPath, sql, sha256: sha256Hex(sql) });
  }
  files.sort((a, b) => a.version - b.version);

  for (let i = 1; i < files.length; i++) {
    if (files[i].version === files[i - 1].version) {
      throw new Error(
        `[migrations] duplicate version ${files[i].version}: ${files[i - 1].name} vs ${files[i].name}`,
      );
    }
  }
  // Versions must be contiguous starting at 1. A gap means a file was deleted or
  // a future PR was merged out of order - refuse to boot rather than guess.
  files.forEach((f, idx) => {
    if (f.version !== idx + 1) {
      throw new Error(
        `[migrations] non-contiguous: expected version ${idx + 1}, got ${f.version} (${f.name})`,
      );
    }
  });
  return files;
}

export function runMigrations(
  db: Database.Database,
  migrationsDir: string,
): RunMigrationsResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      sha256_up  TEXT NOT NULL
    )
  `);

  const files = discoverMigrations(migrationsDir);
  const appliedRows = db
    .prepare("SELECT version, sha256_up FROM _schema_versions ORDER BY version")
    .all() as { version: number; sha256_up: string }[];
  const applied = new Map<number, string>(appliedRows.map((r) => [r.version, r.sha256_up]));

  // Backfill: legacy install with full schema but empty _schema_versions.
  // Mark version=1 with sentinel so the runner does NOT execute 0001_baseline.up.sql
  // against an already-populated DB (would fail on duplicate CREATE TABLE).
  let backfilled = false;
  if (applied.size === 0) {
    const userTables = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master
           WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name != '_schema_versions'`,
        )
        .get() as { n: number }
    ).n;
    if (userTables > 0) {
      db
        .prepare("INSERT INTO _schema_versions(version, sha256_up) VALUES (1, ?)")
        .run(BACKFILL_SENTINEL);
      applied.set(1, BACKFILL_SENTINEL);
      backfilled = true;
    }
  }

  // Sanity: if the DB has a tracked version not represented by a file on disk,
  // the code is older than the DB - refuse to downgrade silently.
  const maxFileVersion = files.length === 0 ? 0 : files[files.length - 1].version;
  for (const v of applied.keys()) {
    if (v > maxFileVersion) {
      throw new Error(
        `[migrations] DB has version ${v} but no migration file matches (max on disk: ${maxFileVersion}). ` +
          `Did you check out an older commit against a newer DB?`,
      );
    }
  }

  const result: RunMigrationsResult = {
    applied: [],
    skipped: [],
    backfilled,
    totalKnown: files.length,
  };

  for (const file of files) {
    const stored = applied.get(file.version);
    if (stored !== undefined) {
      if (stored === BACKFILL_SENTINEL) {
        // Legacy DB: schema already in place; skip without hash check.
        result.skipped.push(file.version);
        continue;
      }
      if (stored !== file.sha256) {
        throw new Error(
          `[migrations] hash mismatch for ${file.name}: stored=${stored} computed=${file.sha256}. ` +
            `Migration files are immutable once applied - create a new ${String(file.version + 1).padStart(4, "0")}_*.up.sql to evolve the schema.`,
        );
      }
      result.skipped.push(file.version);
      continue;
    }

    // New migration -> execute SQL + record version atomically.
    const apply = db.transaction(() => {
      db.exec(file.sql);
      db
        .prepare("INSERT INTO _schema_versions(version, sha256_up) VALUES (?, ?)")
        .run(file.version, file.sha256);
    });
    apply();
    result.applied.push(file.version);
  }

  return result;
}
