import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration 0023_owner_ai_settings", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function readSql(name: string): string {
    return readFileSync(resolve(__dirname, name), "utf8");
  }

  it("UP creeaza tabela owner_ai_settings cu default native/western", () => {
    db.exec(readSql("0023_owner_ai_settings.up.sql"));

    db.prepare("INSERT INTO owner_ai_settings (owner_id, updated_at) VALUES (?, ?)").run("owner-a", 1);

    const row = db.prepare("SELECT * FROM owner_ai_settings WHERE owner_id = ?").get("owner-a") as {
      owner_id: string;
      mode: string;
      openrouter_stack: string;
      updated_at: number;
    };
    expect(row).toEqual({
      owner_id: "owner-a",
      mode: "native",
      openrouter_stack: "western",
      updated_at: 1,
    });
  });

  it("UP refuza mode si stack invalide", () => {
    db.exec(readSql("0023_owner_ai_settings.up.sql"));

    expect(() =>
      db
        .prepare("INSERT INTO owner_ai_settings (owner_id, mode, openrouter_stack, updated_at) VALUES (?, ?, ?, ?)")
        .run("owner-a", "invalid", "western", 1)
    ).toThrow(/CHECK constraint/i);
    expect(() =>
      db
        .prepare("INSERT INTO owner_ai_settings (owner_id, mode, openrouter_stack, updated_at) VALUES (?, ?, ?, ?)")
        .run("owner-a", "openrouter", "invalid", 1)
    ).toThrow(/CHECK constraint/i);
  });

  it("UP + DOWN + UP este reversibil", () => {
    db.exec(readSql("0023_owner_ai_settings.up.sql"));
    db.exec(readSql("0023_owner_ai_settings.down.sql"));

    const dropped = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='owner_ai_settings'").get();
    expect(dropped).toBeUndefined();

    expect(() => db.exec(readSql("0023_owner_ai_settings.up.sql"))).not.toThrow();
  });
});
