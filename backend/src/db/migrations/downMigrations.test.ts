// Executie efectiva a .down.sql pentru 0040 si 0042 pe un DB migrat real.
// 0041 are testul lui dedicat (0041_unified_ai_quota.test.ts) — aici doar
// verificam ca down-ul ruleaza curat si sterge ce trebuie.

import fsPromises from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../schema.ts";

// ESM: __dirname nu exista — deriva-l din import.meta.url.
const migrationsDir = path.dirname(fileURLToPath(import.meta.url));

let tmpRoot: string;
const originalDbPath = process.env.LEGAL_DASHBOARD_DB_PATH;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-down-mig-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  getDb(); // aplica toate migratiile up
});

afterEach(async () => {
  closeDb();
  if (originalDbPath === undefined) {
    // biome-ignore lint/performance/noDelete: env trebuie unset real
    delete process.env.LEGAL_DASHBOARD_DB_PATH;
  } else process.env.LEGAL_DASHBOARD_DB_PATH = originalDbPath;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function runDown(version: string): void {
  const file = fs.readdirSync(migrationsDir).find((f) => f.startsWith(version) && f.endsWith(".down.sql"));
  if (!file) throw new Error(`down file missing for ${version}`);
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
  getDb().exec(sql);
}

describe("down migrations 0040/0042 se executa curat pe un DB migrat", () => {
  it("0040 down sterge indexul NOCASE si versiunea", () => {
    runDown("0040");
    const idx = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_email_nocase'")
      .get();
    expect(idx).toBeUndefined();
    const ver = getDb().prepare("SELECT version FROM _schema_versions WHERE version = 40").get();
    expect(ver).toBeUndefined();
  });

  it("0042 down sterge doar versiunea (backfill-ul UTC e ireversibil prin design)", () => {
    runDown("0042");
    const ver = getDb().prepare("SELECT version FROM _schema_versions WHERE version = 42").get();
    expect(ver).toBeUndefined();
  });
});
