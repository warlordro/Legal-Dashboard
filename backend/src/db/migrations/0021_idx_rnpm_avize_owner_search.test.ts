import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration 0021_idx_rnpm_avize_owner_search", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Minimum schema necesar pentru index - doar tabela rnpm_avize.
    db.exec(`
      CREATE TABLE rnpm_avize (
        id INTEGER PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT 'local',
        search_id INTEGER
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  function readSql(name: string): string {
    return readFileSync(resolve(__dirname, name), "utf8");
  }

  it("UP creeaza indexul idx_rnpm_avize_owner_search", () => {
    db.exec(readSql("0021_idx_rnpm_avize_owner_search.up.sql"));
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_rnpm_avize_owner_search'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("idx_rnpm_avize_owner_search");
  });

  it("UP este idempotent (IF NOT EXISTS) - a doua aplicare nu arunca", () => {
    db.exec(readSql("0021_idx_rnpm_avize_owner_search.up.sql"));
    expect(() => db.exec(readSql("0021_idx_rnpm_avize_owner_search.up.sql"))).not.toThrow();
  });

  it("DOWN sterge indexul", () => {
    db.exec(readSql("0021_idx_rnpm_avize_owner_search.up.sql"));
    db.exec(readSql("0021_idx_rnpm_avize_owner_search.down.sql"));
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_rnpm_avize_owner_search'")
      .get();
    expect(row).toBeUndefined();
  });

  it("DOWN este idempotent (IF EXISTS) - a doua aplicare nu arunca", () => {
    db.exec(readSql("0021_idx_rnpm_avize_owner_search.down.sql"));
    expect(() => db.exec(readSql("0021_idx_rnpm_avize_owner_search.down.sql"))).not.toThrow();
  });
});
