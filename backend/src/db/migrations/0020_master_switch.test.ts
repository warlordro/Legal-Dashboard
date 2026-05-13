import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import Database from "better-sqlite3";

// Faza A — testeaza in izolare DDL-ul migrarii 0020_master_switch.
// Nu folosim runner-ul: vrem sa verificam continutul fisierului asa cum sta pe
// disk, sa nu depindem de eventuale rescrieri viitoare ale runner-ului.

const UP_FILE = path.join(__dirname, "0020_master_switch.up.sql");
const DOWN_FILE = path.join(__dirname, "0020_master_switch.down.sql");

let tmpRoot: string;
let db: Database.Database;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-mig-0020-"));
  db = new Database(path.join(tmpRoot, "test.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Tabelul _schema_versions e creat de runner; aici il pre-cream ca down-ul
  // (care face DELETE FROM _schema_versions) sa nu pice pe "no such table".
  db.exec(`
    CREATE TABLE _schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      sha256_up  TEXT NOT NULL
    )
  `);
});

afterEach(async () => {
  db.close();
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function readUp(): string {
  return fs.readFileSync(UP_FILE, "utf8");
}

function readDown(): string {
  return fs.readFileSync(DOWN_FILE, "utf8");
}

describe("migration 0020_master_switch", () => {
  it("up creates owner_monitoring_settings table and partial index", () => {
    db.exec(readUp());

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='owner_monitoring_settings'")
      .all() as { name: string }[];
    expect(tables).toHaveLength(1);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_owner_monitoring_disabled'")
      .all() as { name: string }[];
    expect(indexes).toHaveLength(1);

    const columns = db.prepare("PRAGMA table_info(owner_monitoring_settings)").all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];
    const byName = new Map(columns.map((c) => [c.name, c]));
    expect(byName.get("owner_id")?.pk).toBe(1);
    expect(byName.get("monitoring_enabled")?.notnull).toBe(1);
    expect(byName.get("monitoring_enabled")?.dflt_value).toBe("1");
    expect(byName.get("created_at")?.notnull).toBe(1);
    expect(byName.get("updated_at")?.notnull).toBe(1);
  });

  it("up + down + up is idempotent (no orphan objects)", () => {
    db.exec(readUp());
    // Simulam ce face runner-ul atunci cand inregistreaza versiunea aplicata,
    // ca DELETE FROM _schema_versions WHERE version = 20 din down sa fie un
    // no-op detectabil prin count corect inainte/dupa.
    db.prepare("INSERT INTO _schema_versions(version, sha256_up) VALUES (20, 'dummy')").run();

    db.exec(readDown());

    const tablesAfterDown = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='owner_monitoring_settings'")
      .all();
    expect(tablesAfterDown).toHaveLength(0);
    const indexesAfterDown = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_owner_monitoring_disabled'")
      .all();
    expect(indexesAfterDown).toHaveLength(0);
    const versionRow = db.prepare("SELECT version FROM _schema_versions WHERE version = 20").get();
    expect(versionRow).toBeUndefined();

    // Re-aplicarea up-ului pe DB curatat trebuie sa treaca fara erori.
    expect(() => db.exec(readUp())).not.toThrow();
    const tablesAfterSecondUp = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='owner_monitoring_settings'")
      .all();
    expect(tablesAfterSecondUp).toHaveLength(1);
  });

  it("INSERT without monitoring_enabled defaults to 1", () => {
    db.exec(readUp());

    db.prepare("INSERT INTO owner_monitoring_settings (owner_id) VALUES (?)").run("test_owner");

    const row = db
      .prepare("SELECT owner_id, monitoring_enabled, created_at, updated_at FROM owner_monitoring_settings")
      .get() as {
      owner_id: string;
      monitoring_enabled: number;
      created_at: string;
      updated_at: string;
    };
    expect(row.owner_id).toBe("test_owner");
    expect(row.monitoring_enabled).toBe(1);
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
