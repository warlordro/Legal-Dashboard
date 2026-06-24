import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isJtiRevoked, purgeExpiredJti, revokeJti } from "./jwtDenylistRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-jwt-denylist-"));
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

describe("jwtDenylistRepository", () => {
  it("revoke + lookup + idempotent conflict", () => {
    expect(isJtiRevoked("abc")).toBe(false);
    revokeJti("abc", 9999999999, "local");
    revokeJti("abc", 9999999999, "local"); // ON CONFLICT DO NOTHING
    expect(isJtiRevoked("abc")).toBe(true);
  });
  it("purge sterge doar intrarile expirate", () => {
    revokeJti("expired", 1000, "local");
    revokeJti("alive", 9999999999, "local");
    expect(purgeExpiredJti(2000)).toBe(1);
    expect(isJtiRevoked("expired")).toBe(false);
    expect(isJtiRevoked("alive")).toBe(true);
  });
});
