// Task 7 (PAT piesa A) — regresie: page-size cap server-side pe rutele de citire
// accesibile unui PAT. `/api/rnpm/saved` clampeaza pageSize atat la nivel de ruta
// (clampPageSize -> 200) cat si in getAvize (linia 431), deci un PAT nu poate cere
// pageSize=1000000 ca sa goleasca DB-ul ocolind decizia "fara export". Ruta dosare
// (SOAP) NU are parametru de marime controlat de client -> nimic de clampat acolo.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./schema.ts";
import { __resetRnpmDbForTests } from "./rnpmDb.ts";
import { getAvize } from "./avizRepository.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-pagesize-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
});
afterEach(async () => {
  __resetRnpmDbForTests();
  closeDb();
  // biome-ignore lint/performance/noDelete: env trebuie unset real
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("getAvize page-size cap (PAT unbounded-dump guard)", () => {
  it("clamps an oversized pageSize to the server-side maximum (200)", () => {
    const result = getAvize({ ownerId: "alice", page: 0, pageSize: 1_000_000 });
    expect(result.pageSize).toBe(200);
  });

  it("clamps a non-positive pageSize up to at least 1", () => {
    expect(getAvize({ ownerId: "alice", page: 0, pageSize: 0 }).pageSize).toBeGreaterThanOrEqual(1);
    expect(getAvize({ ownerId: "alice", page: 0, pageSize: -50 }).pageSize).toBeGreaterThanOrEqual(1);
  });

  it("preserves a reasonable pageSize under the cap", () => {
    expect(getAvize({ ownerId: "alice", page: 0, pageSize: 50 }).pageSize).toBe(50);
  });
});
