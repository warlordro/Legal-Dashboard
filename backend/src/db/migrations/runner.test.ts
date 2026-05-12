import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { runMigrations, discoverMigrations, BACKFILL_SENTINEL } from "./runner.ts";

let tmpRoot: string;
let migrationsDir: string;
let db: Database.Database;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-migrations-test-"));
  migrationsDir = path.join(tmpRoot, "migrations");
  await fsPromises.mkdir(migrationsDir, { recursive: true });
  db = new Database(path.join(tmpRoot, "test.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
});

afterEach(async () => {
  db.close();
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function writeMigration(version: string, name: string, sql: string): string {
  const file = path.join(migrationsDir, version + "_" + name + ".up.sql");
  fs.writeFileSync(file, sql);
  return file;
}

function sha256(s: string): string {
  // Reflecta normalizarea din runner.ts (CRLF -> LF + BOM scos) ca testele sa
  // ramana valide indiferent de line-endings-ul fisierelor scrise temporar.
  const normalized = s.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function runDdl(d: Database.Database, sql: string): void {
  d.prepare(sql).run();
}

describe("runMigrations - fresh DB path", () => {
  it("applies migrations in numeric order and records real sha256", () => {
    const sql1 = "CREATE TABLE t1 (id INTEGER PRIMARY KEY)";
    const sql2 = "CREATE TABLE t2 (id INTEGER PRIMARY KEY)";
    writeMigration("0001", "first", sql1);
    writeMigration("0002", "second", sql2);

    const result = runMigrations(db, migrationsDir);

    expect(result.applied).toEqual([1, 2]);
    expect(result.skipped).toEqual([]);
    expect(result.backfilled).toBe(false);
    expect(result.totalKnown).toBe(2);

    const rows = db.prepare("SELECT version, sha256_up FROM _schema_versions ORDER BY version").all() as {
      version: number;
      sha256_up: string;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ version: 1, sha256_up: sha256(sql1) });
    expect(rows[1]).toEqual({ version: 2, sha256_up: sha256(sql2) });

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_schema_versions' ORDER BY name"
      )
      .all();
    expect(tables).toEqual([{ name: "t1" }, { name: "t2" }]);
  });

  it("is idempotent on second run", () => {
    writeMigration("0001", "first", "CREATE TABLE t1 (id INTEGER)");

    const r1 = runMigrations(db, migrationsDir);
    const r2 = runMigrations(db, migrationsDir);

    expect(r1.applied).toEqual([1]);
    expect(r2.applied).toEqual([]);
    expect(r2.skipped).toEqual([1]);
    expect(r2.backfilled).toBe(false);

    const count = (db.prepare("SELECT COUNT(*) AS n FROM _schema_versions").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("applies new migration on top of previously-applied set", () => {
    writeMigration("0001", "first", "CREATE TABLE t1 (id INTEGER)");
    runMigrations(db, migrationsDir);

    writeMigration("0002", "second", "CREATE TABLE t2 (id INTEGER)");
    const r2 = runMigrations(db, migrationsDir);

    expect(r2.applied).toEqual([2]);
    expect(r2.skipped).toEqual([1]);
  });

  it("rolls back the row insert when SQL fails (single transaction)", () => {
    writeMigration("0001", "first", "CREATE TABLE t1 (id INTEGER)");
    writeMigration("0002", "broken", "CREATE TABLE t2 (id INTEGER); SELECT this_function_does_not_exist()");

    expect(() => runMigrations(db, migrationsDir)).toThrow();

    const versions = db.prepare("SELECT version FROM _schema_versions ORDER BY version").all() as { version: number }[];
    expect(versions.map((r) => r.version)).toEqual([1]);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t2'").all();
    expect(tables).toEqual([]);
  });
});

describe("runMigrations - drift detection", () => {
  it("throws when stored hash does not match file content", () => {
    writeMigration("0001", "first", "CREATE TABLE t1 (id INTEGER)");
    runMigrations(db, migrationsDir);

    fs.writeFileSync(path.join(migrationsDir, "0001_first.up.sql"), "CREATE TABLE t1_renamed (id INTEGER)");

    expect(() => runMigrations(db, migrationsDir)).toThrow(/hash mismatch for 0001_first.up.sql/);
  });

  it("self-heals legacy raw-hash DBs (pre-normalization) by rewriting stored hash", () => {
    const sql = "CREATE TABLE t1 (id INTEGER);\r\nCREATE TABLE t2 (id INTEGER);\r\n";
    writeMigration("0001", "first", sql);
    runMigrations(db, migrationsDir);

    // Simulez un DB vechi: rescriu stored la hash-ul raw (CRLF inclus, ne-normalizat).
    const rawHash = createHash("sha256").update(sql, "utf8").digest("hex");
    db.prepare("UPDATE _schema_versions SET sha256_up = ? WHERE version = 1").run(rawHash);

    const r = runMigrations(db, migrationsDir);
    expect(r.selfHealed).toEqual([1]);
    expect(r.skipped).toEqual([]);

    const row = db.prepare("SELECT sha256_up FROM _schema_versions WHERE version = 1").get() as { sha256_up: string };
    expect(row.sha256_up).toBe(sha256(sql));
  });

  it("self-heals via CRLF-hash direction (LF on disk, stored hash was on CRLF version)", () => {
    const sqlLf = "CREATE TABLE t1 (id INTEGER);\nCREATE TABLE t2 (id INTEGER);\n";
    writeMigration("0001", "first", sqlLf);
    runMigrations(db, migrationsDir);

    const sqlCrlf = sqlLf.replace(/\n/g, "\r\n");
    const crlfHash = createHash("sha256").update(sqlCrlf, "utf8").digest("hex");
    db.prepare("UPDATE _schema_versions SET sha256_up = ? WHERE version = 1").run(crlfHash);

    const r = runMigrations(db, migrationsDir);
    expect(r.selfHealed).toEqual([1]);

    const row = db.prepare("SELECT sha256_up FROM _schema_versions WHERE version = 1").get() as { sha256_up: string };
    expect(row.sha256_up).toBe(sha256(sqlLf));
  });

  it("self-heal does not re-run the migration SQL (legacy table not duplicated)", () => {
    const sql = "CREATE TABLE legacy_table (id INTEGER PRIMARY KEY)";
    writeMigration("0001", "first", sql);
    runMigrations(db, migrationsDir);

    const rawHash = createHash("sha256").update(sql, "utf8").digest("hex");
    db.prepare("UPDATE _schema_versions SET sha256_up = ? WHERE version = 1").run(rawHash);

    expect(() => runMigrations(db, migrationsDir)).not.toThrow();
    const cols = db.prepare("PRAGMA table_info(legacy_table)").all();
    expect(cols.length).toBeGreaterThan(0);
  });

  it("self-heals multiple versions in one call", () => {
    // SQL multiliniu cu CRLF ca raw-hash sa difere de cel normalizat.
    const sql1 = "CREATE TABLE t1 (id INTEGER);\r\nCREATE INDEX i1 ON t1(id);\r\n";
    const sql2 = "CREATE TABLE t2 (id INTEGER);\r\nCREATE INDEX i2 ON t2(id);\r\n";
    writeMigration("0001", "first", sql1);
    writeMigration("0002", "second", sql2);
    runMigrations(db, migrationsDir);

    const raw1 = createHash("sha256").update(sql1, "utf8").digest("hex");
    const raw2 = createHash("sha256").update(sql2, "utf8").digest("hex");
    db.prepare("UPDATE _schema_versions SET sha256_up = ? WHERE version = 1").run(raw1);
    db.prepare("UPDATE _schema_versions SET sha256_up = ? WHERE version = 2").run(raw2);

    const r = runMigrations(db, migrationsDir);
    expect(r.selfHealed).toEqual([1, 2]);
    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it("self-heal + new migration coexist in same call (PR-5+ legacy boot path)", () => {
    const sql1 = "CREATE TABLE t1 (id INTEGER);\r\nCREATE INDEX i1 ON t1(id);\r\n";
    writeMigration("0001", "first", sql1);
    runMigrations(db, migrationsDir);

    const raw1 = createHash("sha256").update(sql1, "utf8").digest("hex");
    db.prepare("UPDATE _schema_versions SET sha256_up = ? WHERE version = 1").run(raw1);

    writeMigration("0002", "second", "CREATE TABLE t2 (id INTEGER)");
    const r = runMigrations(db, migrationsDir);

    expect(r.selfHealed).toEqual([1]);
    expect(r.applied).toEqual([2]);
    expect(r.skipped).toEqual([]);
  });

  it("self-heal is idempotent on second run (UPDATE only fires once)", () => {
    const sql = "CREATE TABLE t1 (id INTEGER);\r\nCREATE INDEX i1 ON t1(id);\r\n";
    writeMigration("0001", "first", sql);
    runMigrations(db, migrationsDir);

    const raw = createHash("sha256").update(sql, "utf8").digest("hex");
    db.prepare("UPDATE _schema_versions SET sha256_up = ? WHERE version = 1").run(raw);

    const r1 = runMigrations(db, migrationsDir);
    const r2 = runMigrations(db, migrationsDir);

    expect(r1.selfHealed).toEqual([1]);
    expect(r2.selfHealed).toEqual([]);
    expect(r2.skipped).toEqual([1]);
  });

  it("MIGRATIONS_STRICT=1 disables self-heal and throws on otherwise-healable mismatch", () => {
    const sql = "CREATE TABLE t1 (id INTEGER);\r\nCREATE INDEX i1 ON t1(id);\r\n";
    writeMigration("0001", "first", sql);
    runMigrations(db, migrationsDir);

    const raw = createHash("sha256").update(sql, "utf8").digest("hex");
    db.prepare("UPDATE _schema_versions SET sha256_up = ? WHERE version = 1").run(raw);

    const previous = process.env.MIGRATIONS_STRICT;
    process.env.MIGRATIONS_STRICT = "1";
    try {
      expect(() => runMigrations(db, migrationsDir)).toThrow(/MIGRATIONS_STRICT=1/);
    } finally {
      if (previous === undefined) process.env.MIGRATIONS_STRICT = undefined;
      else process.env.MIGRATIONS_STRICT = previous;
    }
  });

  it("true drift (neither raw, nor crlf, nor normalized matches) still throws", () => {
    writeMigration("0001", "first", "CREATE TABLE t1 (id INTEGER)");
    runMigrations(db, migrationsDir);

    db.prepare("UPDATE _schema_versions SET sha256_up = ? WHERE version = 1").run(
      "0000000000000000000000000000000000000000000000000000000000000000"
    );

    expect(() => runMigrations(db, migrationsDir)).toThrow(/hash mismatch for 0001_first.up.sql/);
  });

  it("throws when DB has version greater than any file on disk (downgrade guard)", () => {
    writeMigration("0001", "first", "CREATE TABLE t1 (id INTEGER)");
    writeMigration("0002", "second", "CREATE TABLE t2 (id INTEGER)");
    runMigrations(db, migrationsDir);

    fs.unlinkSync(path.join(migrationsDir, "0002_second.up.sql"));

    expect(() => runMigrations(db, migrationsDir)).toThrow(/no migration file matches/);
  });
});

describe("runMigrations - legacy backfill path", () => {
  it("backfills version=1 with sentinel when DB has user tables but empty _schema_versions", () => {
    runDdl(db, "CREATE TABLE preexisting (id INTEGER PRIMARY KEY, label TEXT)");
    db.prepare("INSERT INTO preexisting(label) VALUES (?)").run("legacy-data");
    writeMigration("0001", "baseline", "CREATE TABLE preexisting (id INTEGER PRIMARY KEY, label TEXT)");

    const result = runMigrations(db, migrationsDir);

    expect(result.backfilled).toBe(true);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([1]);

    const row = db.prepare("SELECT version, sha256_up FROM _schema_versions").get() as {
      version: number;
      sha256_up: string;
    };
    expect(row).toEqual({ version: 1, sha256_up: BACKFILL_SENTINEL });

    const data = db.prepare("SELECT label FROM preexisting").get() as { label: string };
    expect(data.label).toBe("legacy-data");
  });

  it("does not backfill on a truly fresh DB (no user tables yet)", () => {
    writeMigration("0001", "baseline", "CREATE TABLE t1 (id INTEGER)");

    const result = runMigrations(db, migrationsDir);

    expect(result.backfilled).toBe(false);
    expect(result.applied).toEqual([1]);
  });

  it("backfilled DB skips hash check on version=1 even if file content differs later", () => {
    runDdl(db, "CREATE TABLE preexisting (id INTEGER)");
    writeMigration("0001", "baseline", "CREATE TABLE preexisting (id INTEGER)");
    runMigrations(db, migrationsDir);

    fs.writeFileSync(path.join(migrationsDir, "0001_baseline.up.sql"), "CREATE TABLE different (id INTEGER)");
    expect(() => runMigrations(db, migrationsDir)).not.toThrow();
  });

  it("backfilled DB still applies later migrations normally (PR-2+ flow)", () => {
    runDdl(db, "CREATE TABLE preexisting (id INTEGER)");
    writeMigration("0001", "baseline", "CREATE TABLE preexisting (id INTEGER)");
    runMigrations(db, migrationsDir);

    writeMigration("0002", "users", "CREATE TABLE users (id TEXT PRIMARY KEY)");
    const r2 = runMigrations(db, migrationsDir);

    expect(r2.applied).toEqual([2]);
    expect(r2.skipped).toEqual([1]);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").all();
    expect(tables).toHaveLength(1);
  });
});

describe("discoverMigrations - file validation", () => {
  it("0001_baseline.down.sql exists in the real repo migrations directory", () => {
    const baselineDown = path.join(__dirname, "0001_baseline.down.sql");
    expect(fs.existsSync(baselineDown)).toBe(true);
  });

  it("ignores non-migration files in the directory", () => {
    writeMigration("0001", "first", "CREATE TABLE t1 (id INTEGER)");
    fs.writeFileSync(path.join(migrationsDir, "README.md"), "notes");
    fs.writeFileSync(path.join(migrationsDir, "0001_first.down.sql"), "DROP TABLE t1");

    const files = discoverMigrations(migrationsDir);
    expect(files.map((f) => f.name)).toEqual(["0001_first.up.sql"]);
  });

  it("ignores real repo .down.sql files at boot discovery", () => {
    const files = discoverMigrations(__dirname);
    expect(files.some((f) => f.name.endsWith(".down.sql"))).toBe(false);
    expect(files.some((f) => f.name === "0019_idx_monitoring_runs_started_at.up.sql")).toBe(true);
  });

  it("throws on duplicate version numbers", () => {
    writeMigration("0001", "first", "CREATE TABLE t1 (id INTEGER)");
    writeMigration("0001", "duplicate", "CREATE TABLE t1d (id INTEGER)");

    expect(() => discoverMigrations(migrationsDir)).toThrow(/duplicate version 1/);
  });

  it("throws on non-contiguous version numbers (gap detection)", () => {
    writeMigration("0001", "first", "CREATE TABLE t1 (id INTEGER)");
    writeMigration("0003", "third", "CREATE TABLE t3 (id INTEGER)");

    expect(() => discoverMigrations(migrationsDir)).toThrow(/non-contiguous/);
  });

  it("throws when migrations directory does not exist", () => {
    const missing = path.join(tmpRoot, "does-not-exist");
    expect(() => discoverMigrations(missing)).toThrow(/directory missing/);
  });
});

describe("runMigrations - real repo migrations integration", () => {
  it("baseline + later migrations apply cleanly on a fresh DB and record correct hashes", () => {
    const repoMigrationsDir = __dirname;
    const baselinePath = path.join(repoMigrationsDir, "0001_baseline.up.sql");
    const baselineSql = fs.readFileSync(baselinePath, "utf8");

    const result = runMigrations(db, repoMigrationsDir);

    // Iterating tracks every committed migration in repo order; assert version 1
    // is among them (and is the first applied) without hardcoding the count, so
    // adding 0003+ in a later PR doesn't require touching this test.
    expect(result.applied[0]).toBe(1);
    expect(result.applied.length).toBeGreaterThanOrEqual(1);
    expect(result.backfilled).toBe(false);

    const row = db.prepare("SELECT version, sha256_up FROM _schema_versions WHERE version=1").get() as {
      version: number;
      sha256_up: string;
    };
    expect(row.sha256_up).toBe(sha256(baselineSql));

    const tableNames = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    ).map((r) => r.name);
    for (const expected of [
      "rnpm_avize",
      "rnpm_bunuri",
      "rnpm_bunuri_descrieri",
      "rnpm_creditori",
      "rnpm_debitori",
      "rnpm_istoric",
      "rnpm_searches",
    ]) {
      expect(tableNames).toContain(expected);
    }
  });
});
