// v2.32.0 fxRatesRepository tests.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLatest, isStale, upsertFxRate } from "./fxRatesRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-fx-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("fxRatesRepository", () => {
  it("getLatest returns null when empty", () => {
    expect(getLatest("USD/EUR")).toBeNull();
  });

  it("upsertFxRate inserts then getLatest returns the row", () => {
    const row = upsertFxRate({ pair: "USD/EUR", rate: 0.923456, rateDate: "2026-05-19" });
    expect(row.pair).toBe("USD/EUR");
    expect(row.rate).toBeCloseTo(0.923456, 6);
    expect(row.source).toBe("ecb");
    expect(row.rate_date).toBe("2026-05-19");

    const latest = getLatest("USD/EUR");
    expect(latest?.rate).toBeCloseTo(0.923456, 6);
  });

  it("upsertFxRate is idempotent per (pair, rate_date)", () => {
    upsertFxRate({ pair: "USD/EUR", rate: 0.92, rateDate: "2026-05-19" });
    upsertFxRate({ pair: "USD/EUR", rate: 0.925, rateDate: "2026-05-19" });
    const rows = getDb().prepare("SELECT COUNT(*) AS n FROM fx_rates").get() as { n: number };
    expect(rows.n).toBe(1);
    expect(getLatest("USD/EUR")?.rate).toBeCloseTo(0.925, 6);
  });

  it("getLatest returns the row with the newest rate_date", () => {
    upsertFxRate({ pair: "USD/EUR", rate: 0.9, rateDate: "2026-05-17" });
    upsertFxRate({ pair: "USD/EUR", rate: 0.93, rateDate: "2026-05-19" });
    upsertFxRate({ pair: "USD/EUR", rate: 0.92, rateDate: "2026-05-18" });
    expect(getLatest("USD/EUR")?.rate_date).toBe("2026-05-19");
  });

  it("rejects non-positive rate", () => {
    expect(() => upsertFxRate({ pair: "USD/EUR", rate: 0, rateDate: "2026-05-19" })).toThrow(/invalid rate/);
    expect(() => upsertFxRate({ pair: "USD/EUR", rate: -0.5, rateDate: "2026-05-19" })).toThrow(/invalid rate/);
  });

  it("rejects malformed rate_date", () => {
    expect(() => upsertFxRate({ pair: "USD/EUR", rate: 0.9, rateDate: "2026/05/19" })).toThrow(/invalid rate_date/);
    expect(() => upsertFxRate({ pair: "USD/EUR", rate: 0.9, rateDate: "" })).toThrow(/invalid rate_date/);
  });

  it("rejects empty pair", () => {
    expect(() => upsertFxRate({ pair: "", rate: 0.9, rateDate: "2026-05-19" })).toThrow(/invalid pair/);
  });

  it("isStale: true when empty", () => {
    expect(isStale("USD/EUR", 48)).toBe(true);
  });

  it("isStale: false when latest is fresh", () => {
    const today = new Date().toISOString().slice(0, 10);
    upsertFxRate({ pair: "USD/EUR", rate: 0.92, rateDate: today });
    expect(isStale("USD/EUR", 48)).toBe(false);
  });

  it("isStale: true when latest is older than threshold", () => {
    const longAgo = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    upsertFxRate({ pair: "USD/EUR", rate: 0.92, rateDate: longAgo });
    expect(isStale("USD/EUR", 48)).toBe(true);
  });
});
