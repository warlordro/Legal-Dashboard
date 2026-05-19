import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration 0027_user_quota_overrides_extension", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    // Schema pre-0027: users + user_quota_overrides legacy (from 0011).
    db.exec(`
      CREATE TABLE users (
        id           TEXT PRIMARY KEY,
        email        TEXT,
        display_name TEXT
      );

      CREATE TABLE user_quota_overrides (
        user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        feature               TEXT NOT NULL CHECK(length(feature) > 0),
        daily_limit_usd_milli INTEGER NOT NULL CHECK(daily_limit_usd_milli >= 0),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by            TEXT,
        PRIMARY KEY (user_id, feature)
      );

      CREATE INDEX idx_user_quota_overrides_user ON user_quota_overrides(user_id);
    `);
    db.prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)").run("u-1", "u1@x", "U1");
  });

  afterEach(() => {
    db.close();
  });

  function readSql(name: string): string {
    return readFileSync(resolve(__dirname, name), "utf8");
  }

  it("UP backfills period='day' on existing rows si pastreaza datele", () => {
    db.prepare(
      `INSERT INTO user_quota_overrides (user_id, feature, daily_limit_usd_milli, updated_by)
       VALUES (?, ?, ?, ?)`
    ).run("u-1", "ai.single", 5000, "admin-1");

    db.exec(readSql("0027_user_quota_overrides_extension.up.sql"));

    const row = db
      .prepare("SELECT user_id, feature, period, limit_usd_milli, updated_by FROM user_quota_overrides WHERE user_id = ?")
      .get("u-1") as {
      user_id: string;
      feature: string;
      period: string;
      limit_usd_milli: number;
      updated_by: string | null;
    };
    expect(row).toEqual({
      user_id: "u-1",
      feature: "ai.single",
      period: "day",
      limit_usd_milli: 5000,
      updated_by: "admin-1",
    });
  });

  it("UP permite NULL pe limit_usd_milli (unlimited)", () => {
    db.exec(readSql("0027_user_quota_overrides_extension.up.sql"));

    db.prepare(
      `INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli)
       VALUES (?, ?, ?, ?)`
    ).run("u-1", "ai.single", "week", null);

    const row = db.prepare("SELECT limit_usd_milli FROM user_quota_overrides WHERE user_id = ?").get("u-1") as {
      limit_usd_milli: number | null;
    };
    expect(row.limit_usd_milli).toBeNull();
  });

  it("UP CHECK refuza period invalid", () => {
    db.exec(readSql("0027_user_quota_overrides_extension.up.sql"));

    expect(() =>
      db
        .prepare("INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli) VALUES (?, ?, ?, ?)")
        .run("u-1", "ai.single", "year", 1000)
    ).toThrow(/CHECK constraint/i);
  });

  it("UP CHECK refuza limit_usd_milli negativ", () => {
    db.exec(readSql("0027_user_quota_overrides_extension.up.sql"));

    expect(() =>
      db
        .prepare("INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli) VALUES (?, ?, ?, ?)")
        .run("u-1", "ai.single", "day", -1)
    ).toThrow(/CHECK constraint/i);
  });

  it("UP + DOWN + UP este reversibil (limita NOT NULL pierde NULL la DOWN)", () => {
    db.prepare(
      `INSERT INTO user_quota_overrides (user_id, feature, daily_limit_usd_milli)
       VALUES (?, ?, ?)`
    ).run("u-1", "ai.single", 4200);

    db.exec(readSql("0027_user_quota_overrides_extension.up.sql"));
    db.exec(readSql("0027_user_quota_overrides_extension.down.sql"));

    const row = db
      .prepare("SELECT user_id, feature, daily_limit_usd_milli FROM user_quota_overrides WHERE user_id = ?")
      .get("u-1") as { user_id: string; feature: string; daily_limit_usd_milli: number };
    expect(row).toEqual({ user_id: "u-1", feature: "ai.single", daily_limit_usd_milli: 4200 });

    expect(() => db.exec(readSql("0027_user_quota_overrides_extension.up.sql"))).not.toThrow();
  });
});
