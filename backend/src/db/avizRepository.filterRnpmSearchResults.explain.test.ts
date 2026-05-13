import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { closeDb, getDb } from "./schema.ts";

describe("filterRnpmSearchResults - EXPLAIN QUERY PLAN", () => {
  let tmpRoot: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(async () => {
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-explain-"));
    dbPath = path.join(tmpRoot, "legal-dashboard.db");
    process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
    const seed = new Database(dbPath);
    seed.close();
    db = getDb();
  });

  afterEach(async () => {
    closeDb();
    Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DB_PATH");
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  });

  it("query principal foloseste idx_rnpm_avize_owner_search", () => {
    const sql = `SELECT a.id FROM rnpm_avize a WHERE a.owner_id = 'local' AND a.search_id = 1
      ORDER BY a.id ASC LIMIT 1500`;
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
    const detail = plan.map((p) => p.detail).join(" | ");
    // SQLite poate alege owner_id, search_id index sau primary key; verificam ca nu avem full scan.
    expect(detail).toMatch(/USING (INDEX idx_rnpm_avize_owner_search|COVERING INDEX|INTEGER PRIMARY KEY)/);
    expect(detail).not.toMatch(/SCAN rnpm_avize\b(?!.*USING)/);
  });
});
