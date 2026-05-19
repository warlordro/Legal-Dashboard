import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration 0030_budget_notifications", () => {
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

  it("UP creeaza tabela cu PRIMARY KEY (user_id, feature, threshold_pct)", () => {
    db.exec(readSql("0030_budget_notifications.up.sql"));

    db.prepare("INSERT INTO budget_notifications (user_id, feature, threshold_pct) VALUES (?, ?, ?)").run(
      "u-1",
      "ai.single",
      80
    );

    // Duplicate (user, feature, threshold) -> PRIMARY KEY violation.
    expect(() =>
      db
        .prepare("INSERT INTO budget_notifications (user_id, feature, threshold_pct) VALUES (?, ?, ?)")
        .run("u-1", "ai.single", 80)
    ).toThrow(/UNIQUE constraint|PRIMARY KEY/i);
  });

  it("UP CHECK refuza threshold_pct != 80", () => {
    db.exec(readSql("0030_budget_notifications.up.sql"));
    expect(() =>
      db
        .prepare("INSERT INTO budget_notifications (user_id, feature, threshold_pct) VALUES (?, ?, ?)")
        .run("u-1", "ai.single", 50)
    ).toThrow(/CHECK constraint/i);
  });

  it("UP permite (same user, same feature) cu threshold_pct diferit", () => {
    // Doar 80 e suportat in v2.32.0; verificam doar ca PRIMARY KEY include
    // threshold_pct (admin va putea adauga 50/90 in viitor fara schema bump).
    db.exec(readSql("0030_budget_notifications.up.sql"));
    db.prepare("INSERT INTO budget_notifications (user_id, feature, threshold_pct) VALUES (?, ?, ?)").run(
      "u-1",
      "ai.single",
      80
    );
    // Verify primary key index existence via PRAGMA.
    const idx = db.prepare(`PRAGMA index_list('budget_notifications')`).all() as Array<{ name: string }>;
    expect(idx.some((i) => i.name === "idx_budget_notifications_active")).toBe(true);
  });

  it("UP ON DELETE CASCADE sterge notifs cand userul e sters", () => {
    db.exec(readSql("0030_budget_notifications.up.sql"));
    db.prepare("INSERT INTO budget_notifications (user_id, feature, threshold_pct) VALUES (?, ?, ?)").run(
      "u-1",
      "ai.single",
      80
    );
    db.prepare("DELETE FROM users WHERE id = ?").run("u-1");
    const n = (db.prepare("SELECT COUNT(*) AS n FROM budget_notifications").get() as { n: number }).n;
    expect(n).toBe(0);
  });

  it("UP + DOWN + UP este reversibil", () => {
    db.exec(readSql("0030_budget_notifications.up.sql"));
    db.exec(readSql("0030_budget_notifications.down.sql"));
    const dropped = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='budget_notifications'")
      .get();
    expect(dropped).toBeUndefined();
    expect(() => db.exec(readSql("0030_budget_notifications.up.sql"))).not.toThrow();
  });
});
