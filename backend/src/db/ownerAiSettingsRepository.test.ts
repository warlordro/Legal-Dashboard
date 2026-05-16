import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSettings, upsertSettings } from "./ownerAiSettingsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-ai-settings-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("ownerAiSettingsRepository", () => {
  it("getSettings returns native/western defaults when row is absent", () => {
    expect(getSettings("local")).toEqual({
      owner_id: "local",
      mode: "native",
      openrouter_stack: "western",
      updated_at: 0,
    });
  });

  it("upsertSettings inserts and echoes the saved settings", () => {
    const row = upsertSettings("local", {
      mode: "openrouter",
      openrouter_stack: "chinese",
    });

    expect(row).toMatchObject({
      owner_id: "local",
      mode: "openrouter",
      openrouter_stack: "chinese",
    });
    expect(row.updated_at).toEqual(expect.any(Number));
    expect(row.updated_at).toBeGreaterThan(0);
  });

  it("upsertSettings updates the same owner row in place", () => {
    upsertSettings("local", {
      mode: "openrouter",
      openrouter_stack: "chinese",
    });
    const updated = upsertSettings("local", {
      mode: "native",
      openrouter_stack: "western",
    });

    const rows = getDb().prepare("SELECT owner_id, mode, openrouter_stack FROM owner_ai_settings").all();
    expect(rows).toHaveLength(1);
    expect(updated).toMatchObject({
      owner_id: "local",
      mode: "native",
      openrouter_stack: "western",
    });
  });

  it("keeps owners isolated", () => {
    upsertSettings("local", {
      mode: "openrouter",
      openrouter_stack: "chinese",
    });
    upsertSettings("other", {
      mode: "openrouter",
      openrouter_stack: "western",
    });

    expect(getSettings("local")).toMatchObject({
      owner_id: "local",
      mode: "openrouter",
      openrouter_stack: "chinese",
    });
    expect(getSettings("other")).toMatchObject({
      owner_id: "other",
      mode: "openrouter",
      openrouter_stack: "western",
    });
  });

  it("rejects invalid values before they reach SQLite", () => {
    expect(() =>
      upsertSettings("local", {
        mode: "bad" as "native",
        openrouter_stack: "western",
      })
    ).toThrow(/invalid ai settings mode/);
    expect(() =>
      upsertSettings("local", {
        mode: "openrouter",
        openrouter_stack: "bad" as "western",
      })
    ).toThrow(/invalid openrouter stack/);
  });
});
