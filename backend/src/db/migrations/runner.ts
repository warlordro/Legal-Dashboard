import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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
  sha256Raw: string;
  sha256Crlf: string;
}

export interface RunMigrationsResult {
  applied: number[];
  skipped: number[];
  selfHealed: number[];
  backfilled: boolean;
  totalKnown: number;
}

// Hash este calculat pe continut normalizat (CRLF -> LF + BOM scos) ca sa fie
// stabil intre Windows si Linux. git autocrlf-ul implicit pe Windows poate sa
// flippeze line-endings la checkout: fara normalizare, un checkout fresh ar
// invalida toate hash-urile stocate si ar bloca boot-ul. Migrarile sunt SQL,
// line-endings-ul nu schimba semantica.
function sha256Hex(s: string): string {
  const normalized = s.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

// Hash raw (pre-normalizare) folosit pentru self-heal pe DB-uri vechi care au
// stocat un hash calculat direct pe continutul de pe disk (CRLF inclus). Daca
// raw match dar normalizat nu, rescriem stored la normalized: continutul e
// neschimbat, doar reprezentarea hash-ului s-a stabilizat.
//
// CAVEAT: matching-ul `sha256Raw` depinde de bytes-urile de pe disk; daca
// developerul re-checkout-eaza repo-ul cu git autocrlf setat diferit decat la
// instalarea originala, raw-bytes-ul se schimba si self-heal-ul nu mai apuca
// branch-ul (dar branch-ul `sha256Crlf` de mai jos il prinde in directia LF).
function sha256Raw(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// Hash CRLF (LF -> CRLF) pentru self-heal in directia inversa: DB-uri create pe
// Windows inainte de `.gitattributes text eol=lf` au stocat hash pe continut LF
// (daca rulau intr-un environment fara autocrlf), iar dupa pull cu eol=lf+autocrlf
// continutul de pe disk ramane LF. Caz mai rar: DB stocat cu hash CRLF iar
// continutul curent e LF (autocrlf input + .gitattributes lf forteaza LF). Fara
// branch-ul asta, runner-ul ar arunca "hash mismatch" pe legacy install valid.
function sha256Crlf(s: string): string {
  const stripped = s.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const crlf = stripped.replace(/\n/g, "\r\n");
  return createHash("sha256").update(crlf, "utf8").digest("hex");
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
    files.push({
      version,
      name,
      fullPath,
      sql,
      sha256: sha256Hex(sql),
      sha256Raw: sha256Raw(sql),
      sha256Crlf: sha256Crlf(sql),
    });
  }
  files.sort((a, b) => a.version - b.version);

  for (let i = 1; i < files.length; i++) {
    if (files[i].version === files[i - 1].version) {
      throw new Error(`[migrations] duplicate version ${files[i].version}: ${files[i - 1].name} vs ${files[i].name}`);
    }
  }
  // Versions must be contiguous starting at 1. A gap means a file was deleted or
  // a future PR was merged out of order - refuse to boot rather than guess.
  files.forEach((f, idx) => {
    if (f.version !== idx + 1) {
      throw new Error(`[migrations] non-contiguous: expected version ${idx + 1}, got ${f.version} (${f.name})`);
    }
  });
  return files;
}

export function runMigrations(db: Database.Database, migrationsDir: string): RunMigrationsResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      sha256_up  TEXT NOT NULL
    )
  `);

  const files = discoverMigrations(migrationsDir);
  const appliedRows = db.prepare("SELECT version, sha256_up FROM _schema_versions ORDER BY version").all() as {
    version: number;
    sha256_up: string;
  }[];
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
           WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name != '_schema_versions'`
        )
        .get() as { n: number }
    ).n;
    const legacyAppTables = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master
           WHERE type='table' AND name IN ('rnpm_searches', 'rnpm_avize', 'dosare', 'termeni')`
        )
        .get() as { n: number }
    ).n;
    if (userTables > 0 && legacyAppTables > 0) {
      db.prepare("INSERT INTO _schema_versions(version, sha256_up) VALUES (1, ?)").run(BACKFILL_SENTINEL);
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
          "Did you check out an older commit against a newer DB?"
      );
    }
  }

  // CI-only escape hatch: when MIGRATIONS_STRICT=1, self-heal este dezactivat
  // si orice mismatch arunca - util pentru a prinde drift accidental in pipeline
  // inainte ca un release sa il auto-vindece silentios pe instalarile users.
  // Audit-ul intern (recordAudit) este OMIS deliberat pe self-heal: tabelul
  // audit_log e creat in migration 0002, deci self-heal-ul pe v1 ar genera
  // dependinta circulara. Logging-ul prin result.selfHealed + console in
  // schema.ts e substitutul corect.
  const strictMode = process.env.MIGRATIONS_STRICT === "1";

  const result: RunMigrationsResult = {
    applied: [],
    skipped: [],
    selfHealed: [],
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
        // Self-heal: DB-uri populate inainte de introducerea normalizarii au
        // stocat hash-ul calculat fie pe bytes raw (CRLF de Windows inclus)
        // fie pe LF normalized convertit ulterior la CRLF de git autocrlf.
        // Daca *oricare* dintre cele doua hash-uri match, continutul nu s-a
        // schimbat - rescriem stored la varianta normalizata si continuam.
        // Daca nici unul nu match, e drift real si abortam.
        const healMatch = stored === file.sha256Raw ? "raw" : stored === file.sha256Crlf ? "crlf" : null;
        if (healMatch !== null) {
          if (strictMode) {
            throw new Error(
              `[migrations] hash mismatch for ${file.name} (would self-heal via ${healMatch}, but MIGRATIONS_STRICT=1)`
            );
          }
          db.prepare("UPDATE _schema_versions SET sha256_up = ? WHERE version = ?").run(file.sha256, file.version);
          applied.set(file.version, file.sha256);
          result.selfHealed.push(file.version);
          continue;
        }
        throw new Error(
          `[migrations] hash mismatch for ${file.name}: stored=${stored} computed=${file.sha256}. ` +
            `Migration files are immutable once applied - create a new ${String(file.version + 1).padStart(4, "0")}_*.up.sql to evolve the schema.`
        );
      }
      result.skipped.push(file.version);
      continue;
    }

    // New migration -> execute SQL + record version atomically.
    const apply = db.transaction(() => {
      db.exec(file.sql);
      db.prepare("INSERT INTO _schema_versions(version, sha256_up) VALUES (?, ?)").run(file.version, file.sha256);
    });
    apply();
    result.applied.push(file.version);
  }

  return result;
}
