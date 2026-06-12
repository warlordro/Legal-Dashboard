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
  it("getSettings returns native defaults when row is absent", () => {
    expect(getSettings("local")).toEqual({
      owner_id: "local",
      mode: "native",
      updated_at: 0,
    });
  });

  it("upsertSettings inserts and echoes the saved settings", () => {
    const row = upsertSettings("local", { mode: "openrouter" });

    expect(row).toMatchObject({
      owner_id: "local",
      mode: "openrouter",
    });
    expect(row.updated_at).toEqual(expect.any(Number));
    expect(row.updated_at).toBeGreaterThan(0);
  });

  it("upsertSettings updates the same owner row in place", () => {
    upsertSettings("local", { mode: "openrouter" });
    const updated = upsertSettings("local", { mode: "native" });

    const rows = getDb().prepare("SELECT owner_id, mode FROM owner_ai_settings").all();
    expect(rows).toHaveLength(1);
    expect(updated).toMatchObject({
      owner_id: "local",
      mode: "native",
    });
  });

  it("upsertSettings pins the legacy openrouter_stack column to 'western'", () => {
    upsertSettings("local", { mode: "openrouter" });

    const row = getDb().prepare("SELECT openrouter_stack FROM owner_ai_settings WHERE owner_id = ?").get("local") as {
      openrouter_stack: string;
    };
    expect(row.openrouter_stack).toBe("western");

    // si pe update (branch-ul ON CONFLICT) coloana ramane 'western'
    upsertSettings("local", { mode: "native" });
    const afterUpdate = getDb()
      .prepare("SELECT openrouter_stack FROM owner_ai_settings WHERE owner_id = ?")
      .get("local") as { openrouter_stack: string };
    expect(afterUpdate.openrouter_stack).toBe("western");
  });

  it("keeps owners isolated", () => {
    upsertSettings("local", { mode: "openrouter" });
    upsertSettings("other", { mode: "native" });

    expect(getSettings("local")).toMatchObject({
      owner_id: "local",
      mode: "openrouter",
    });
    expect(getSettings("other")).toMatchObject({
      owner_id: "other",
      mode: "native",
    });
  });

  it("rejects invalid values before they reach SQLite", () => {
    expect(() =>
      upsertSettings("local", {
        mode: "bad" as "native",
      })
    ).toThrow(/invalid ai settings mode/);
  });
});
