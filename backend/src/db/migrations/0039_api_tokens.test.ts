import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-mig39-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
});
afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: env trebuie unset real
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("migration 0039", () => {
  it("creates api_tokens with the expected columns", () => {
    const cols = getDb().prepare("PRAGMA table_info(api_tokens)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "owner_id",
        "name",
        "token_hash",
        "token_prefix",
        "scopes",
        "captcha_daily_cap",
        "created_at",
        "expires_at",
        "last_used_at",
        "last_used_ip",
        "last_used_ua",
        "revoked_at",
      ])
    );
  });

  it("adds token_id to captcha_usage", () => {
    const cols = getDb().prepare("PRAGMA table_info(captcha_usage)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("token_id");
  });

  it("creates the partial new-IP detection index on audit_log", () => {
    const idx = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_audit_log_token_use'")
      .get() as { name: string } | undefined;
    expect(idx?.name).toBe("idx_audit_log_token_use");
  });
});
