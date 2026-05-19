import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration 0028_user_quota_grants", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`
      CREATE TABLE users (
        id           TEXT PRIMARY KEY,
        email        TEXT,
        display_name TEXT
      );
    `);
    db.prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)").run("u-1", "u1@x", "U1");
  });

  afterEach(() => {
    db.close();
  });

  function readSql(name: string): string {
    return readFileSync(resolve(__dirname, name), "utf8");
  }

  it("UP creeaza tabela cu PRIMARY KEY autoincrement", () => {
    db.exec(readSql("0028_user_quota_grants.up.sql"));
    const g1 = db
      .prepare(
        `INSERT INTO user_quota_grants (user_id, feature, extra_usd_milli, expires_at, granted_by)
         VALUES (?, ?, ?, ?, ?) RETURNING id`
      )
      .get("u-1", "ai.single", 100, "2099-01-01T00:00:00Z", "admin") as { id: number };
    const g2 = db
      .prepare(
        `INSERT INTO user_quota_grants (user_id, feature, extra_usd_milli, expires_at, granted_by)
         VALUES (?, ?, ?, ?, ?) RETURNING id`
      )
      .get("u-1", "ai.single", 200, "2099-01-01T00:00:00Z", "admin") as { id: number };
    expect(g2.id).toBe(g1.id + 1);
  });

  it("UP CHECK refuza extra_usd_milli <= 0", () => {
    db.exec(readSql("0028_user_quota_grants.up.sql"));
    expect(() =>
      db
        .prepare(
          `INSERT INTO user_quota_grants (user_id, feature, extra_usd_milli, expires_at, granted_by)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run("u-1", "ai.single", 0, "2099-01-01T00:00:00Z", "admin")
    ).toThrow(/CHECK constraint/i);
  });

  it("UP ON DELETE CASCADE sterge grants cand userul e sters", () => {
    db.exec(readSql("0028_user_quota_grants.up.sql"));
    db.prepare(
      `INSERT INTO user_quota_grants (user_id, feature, extra_usd_milli, expires_at, granted_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run("u-1", "ai.single", 100, "2099-01-01T00:00:00Z", "admin");
    db.prepare("DELETE FROM users WHERE id = ?").run("u-1");
    const n = (db.prepare("SELECT COUNT(*) AS n FROM user_quota_grants").get() as { n: number }).n;
    expect(n).toBe(0);
  });

  it("UP + DOWN + UP este reversibil", () => {
    db.exec(readSql("0028_user_quota_grants.up.sql"));
    db.exec(readSql("0028_user_quota_grants.down.sql"));
    const dropped = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_quota_grants'")
      .get();
    expect(dropped).toBeUndefined();
    expect(() => db.exec(readSql("0028_user_quota_grants.up.sql"))).not.toThrow();
  });
});
