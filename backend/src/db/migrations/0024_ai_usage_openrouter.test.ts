import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration 0024_ai_usage_openrouter", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE ai_usage (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id        TEXT NOT NULL,
        ts              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        provider        TEXT NOT NULL CHECK(provider IN ('anthropic','openai','google')),
        model           TEXT NOT NULL CHECK(length(model) > 0),
        input_tokens    INTEGER NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
        output_tokens   INTEGER NOT NULL DEFAULT 0 CHECK(output_tokens >= 0),
        cost_usd_milli  INTEGER NOT NULL DEFAULT 0 CHECK(cost_usd_milli >= 0),
        http_status     INTEGER CHECK(http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
        was_aborted     INTEGER NOT NULL DEFAULT 0 CHECK(was_aborted IN (0,1)),
        request_id      TEXT,
        feature         TEXT NOT NULL CHECK(length(feature) > 0)
      );

      CREATE INDEX idx_ai_usage_owner_time ON ai_usage(owner_id, ts DESC);
      CREATE INDEX idx_ai_usage_global_time ON ai_usage(ts DESC);
      CREATE INDEX idx_ai_usage_owner_feature_time ON ai_usage(owner_id, feature, ts DESC);
    `);
  });

  afterEach(() => {
    db.close();
  });

  function readSql(name: string): string {
    return readFileSync(resolve(__dirname, name), "utf8");
  }

  function insertUsage(provider: string, model = "model-a"): void {
    db.prepare(
      `INSERT INTO ai_usage
        (owner_id, provider, model, input_tokens, output_tokens, cost_usd_milli, feature)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("owner-a", provider, model, 10, 20, 30, "dosare");
  }

  function expectOwnerDefaultLocal(): void {
    const ownerColumn = db
      .prepare("PRAGMA table_info(ai_usage)")
      .all()
      .find((column) => (column as { name: string }).name === "owner_id") as { dflt_value: string | null } | undefined;
    expect(ownerColumn?.dflt_value).toBe("'local'");
  }

  it("UP extinde CHECK provider la openrouter si adauga routing_tag", () => {
    db.exec(readSql("0024_ai_usage_openrouter.up.sql"));
    expectOwnerDefaultLocal();

    insertUsage("openrouter", "qwen/qwen3.6-max-preview");

    const row = db.prepare("SELECT provider, model, routing_tag FROM ai_usage WHERE provider = 'openrouter'").get() as {
      provider: string;
      model: string;
      routing_tag: string | null;
    };
    expect(row).toEqual({
      provider: "openrouter",
      model: "qwen/qwen3.6-max-preview",
      routing_tag: null,
    });
  });

  it("DOWN restrange CHECK provider si refuza openrouter", () => {
    db.exec(readSql("0024_ai_usage_openrouter.up.sql"));
    db.exec(readSql("0024_ai_usage_openrouter.down.sql"));
    expectOwnerDefaultLocal();

    expect(() => insertUsage("openrouter")).toThrow(/CHECK constraint/i);
    expect(() => insertUsage("anthropic", "claude-haiku")).not.toThrow();
  });

  it("DOWN pierde randurile openrouter si pastreaza randurile native", () => {
    db.exec(readSql("0024_ai_usage_openrouter.up.sql"));
    insertUsage("openrouter", "z-ai/glm-5.1");
    insertUsage("openai", "gpt-5.4-mini");

    db.exec(readSql("0024_ai_usage_openrouter.down.sql"));

    const rows = db.prepare("SELECT provider, model FROM ai_usage ORDER BY id").all() as {
      provider: string;
      model: string;
    }[];
    expect(rows).toEqual([{ provider: "openai", model: "gpt-5.4-mini" }]);
  });

  it("UP + DOWN + UP este reversibil", () => {
    db.exec(readSql("0024_ai_usage_openrouter.up.sql"));
    db.exec(readSql("0024_ai_usage_openrouter.down.sql"));
    db.exec(readSql("0024_ai_usage_openrouter.up.sql"));

    expect(() => insertUsage("openrouter", "moonshotai/kimi-k2.6")).not.toThrow();
  });
});
