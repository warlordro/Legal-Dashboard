import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration 0025_ai_usage_owner_default", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Schema after 0024 UP: owner_id NOT NULL (no default), routing_tag present.
    db.exec(`
      CREATE TABLE ai_usage (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id        TEXT NOT NULL,
        ts              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        provider        TEXT NOT NULL CHECK(provider IN ('anthropic','openai','google','openrouter')),
        model           TEXT NOT NULL CHECK(length(model) > 0),
        input_tokens    INTEGER NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
        output_tokens   INTEGER NOT NULL DEFAULT 0 CHECK(output_tokens >= 0),
        cost_usd_milli  INTEGER NOT NULL DEFAULT 0 CHECK(cost_usd_milli >= 0),
        http_status     INTEGER CHECK(http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
        was_aborted     INTEGER NOT NULL DEFAULT 0 CHECK(was_aborted IN (0,1)),
        request_id      TEXT,
        feature         TEXT NOT NULL CHECK(length(feature) > 0),
        routing_tag     TEXT
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

  function ownerColumnDefault(): string | null {
    const row = db
      .prepare("PRAGMA table_info(ai_usage)")
      .all()
      .find((column) => (column as { name: string }).name === "owner_id") as { dflt_value: string | null } | undefined;
    return row?.dflt_value ?? null;
  }

  it("UP adauga DEFAULT 'local' la owner_id", () => {
    expect(ownerColumnDefault()).toBeNull();

    db.exec(readSql("0025_ai_usage_owner_default.up.sql"));

    expect(ownerColumnDefault()).toBe("'local'");
  });

  it("UP pastreaza randurile existente cu owner_id si routing_tag intacte", () => {
    db.prepare(
      `INSERT INTO ai_usage
        (owner_id, provider, model, input_tokens, output_tokens, cost_usd_milli, feature, routing_tag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("owner-a", "openrouter", "anthropic/claude-sonnet-4.6", 10, 20, 30, "dosare", "openrouter:chinese");

    db.exec(readSql("0025_ai_usage_owner_default.up.sql"));

    const row = db.prepare("SELECT owner_id, provider, model, routing_tag FROM ai_usage WHERE id = 1").get() as {
      owner_id: string;
      provider: string;
      model: string;
      routing_tag: string | null;
    };
    expect(row).toEqual({
      owner_id: "owner-a",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
      routing_tag: "openrouter:chinese",
    });
  });

  it("UP permite INSERT fara owner_id explicit si foloseste 'local'", () => {
    db.exec(readSql("0025_ai_usage_owner_default.up.sql"));

    db.prepare(
      `INSERT INTO ai_usage (provider, model, input_tokens, output_tokens, cost_usd_milli, feature)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("openai", "gpt-5.4-mini", 1, 2, 3, "dosare");

    const row = db.prepare("SELECT owner_id FROM ai_usage WHERE id = 1").get() as { owner_id: string };
    expect(row.owner_id).toBe("local");
  });

  it("DOWN scoate DEFAULT 'local' si pastreaza datele", () => {
    db.exec(readSql("0025_ai_usage_owner_default.up.sql"));
    db.prepare(
      `INSERT INTO ai_usage
        (owner_id, provider, model, input_tokens, output_tokens, cost_usd_milli, feature)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("owner-b", "anthropic", "claude-sonnet", 5, 6, 7, "dosare");

    db.exec(readSql("0025_ai_usage_owner_default.down.sql"));

    expect(ownerColumnDefault()).toBeNull();
    const row = db.prepare("SELECT owner_id, provider FROM ai_usage WHERE id = 1").get() as {
      owner_id: string;
      provider: string;
    };
    expect(row).toEqual({ owner_id: "owner-b", provider: "anthropic" });
  });

  it("UP + DOWN + UP este reversibil", () => {
    db.exec(readSql("0025_ai_usage_owner_default.up.sql"));
    db.exec(readSql("0025_ai_usage_owner_default.down.sql"));
    db.exec(readSql("0025_ai_usage_owner_default.up.sql"));

    expect(ownerColumnDefault()).toBe("'local'");
  });
});
