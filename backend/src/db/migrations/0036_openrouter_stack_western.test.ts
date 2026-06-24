import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration 0036_openrouter_stack_western", () => {
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

  it("UP coercseaza openrouter_stack='chinese' la 'western', lasa restul neatins", () => {
    db.exec(readSql("0023_owner_ai_settings.up.sql"));

    // Seed: un rand chinese (legacy) si unul western (deja migrat).
    db.prepare("INSERT INTO owner_ai_settings (owner_id, mode, openrouter_stack, updated_at) VALUES (?, ?, ?, ?)").run(
      "owner-chinese",
      "openrouter",
      "chinese",
      1
    );
    db.prepare("INSERT INTO owner_ai_settings (owner_id, mode, openrouter_stack, updated_at) VALUES (?, ?, ?, ?)").run(
      "owner-western",
      "native",
      "western",
      2
    );

    db.exec(readSql("0036_openrouter_stack_western.up.sql"));

    const chinese = db
      .prepare("SELECT openrouter_stack FROM owner_ai_settings WHERE owner_id = ?")
      .get("owner-chinese") as { openrouter_stack: string };
    const western = db
      .prepare("SELECT openrouter_stack FROM owner_ai_settings WHERE owner_id = ?")
      .get("owner-western") as { openrouter_stack: string };

    expect(chinese.openrouter_stack).toBe("western"); // coercit
    expect(western.openrouter_stack).toBe("western"); // neatins
  });
});
