// PR-8 userQuotaRepository — CRUD on the user_quota_overrides table from 0011.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deleteOverride, getOverride, listOverridesForUser, upsertOverride } from "./userQuotaRepository.ts";
import { insertUser } from "./userRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-quota-repo-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
  insertUser({ id: "u-1", email: "u1@firma.ro", displayName: "User One" });
  insertUser({ id: "u-2", email: "u2@firma.ro", displayName: "User Two" });
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("userQuotaRepository — read paths", () => {
  it("listOverridesForUser returns empty when nothing set", () => {
    expect(listOverridesForUser("u-1")).toEqual([]);
  });

  it("getOverride returns null when missing", () => {
    expect(getOverride("u-1", "ai.single")).toBeNull();
  });

  it("listOverridesForUser orders by feature ASC", () => {
    upsertOverride({ userId: "u-1", feature: "ai.single", dailyLimitUsdMilli: 1000 });
    upsertOverride({ userId: "u-1", feature: "ai.multi", dailyLimitUsdMilli: 5000 });
    upsertOverride({ userId: "u-1", feature: "rnpm.daily", dailyLimitUsdMilli: 0 });
    const rows = listOverridesForUser("u-1");
    expect(rows.map((r) => r.feature)).toEqual(["ai.multi", "ai.single", "rnpm.daily"]);
  });

  it("listOverridesForUser is scoped to user_id", () => {
    upsertOverride({ userId: "u-1", feature: "ai.single", dailyLimitUsdMilli: 1000 });
    upsertOverride({ userId: "u-2", feature: "ai.single", dailyLimitUsdMilli: 9000 });
    const u1 = listOverridesForUser("u-1");
    const u2 = listOverridesForUser("u-2");
    expect(u1).toHaveLength(1);
    expect(u1[0].daily_limit_usd_milli).toBe(1000);
    expect(u2).toHaveLength(1);
    expect(u2[0].daily_limit_usd_milli).toBe(9000);
  });
});

describe("userQuotaRepository — write paths", () => {
  it("upsertOverride inserts a new row and echoes it", () => {
    const row = upsertOverride({
      userId: "u-1",
      feature: "ai.single",
      dailyLimitUsdMilli: 2500,
      updatedBy: "u-admin",
    });
    expect(row.user_id).toBe("u-1");
    expect(row.feature).toBe("ai.single");
    expect(row.daily_limit_usd_milli).toBe(2500);
    expect(row.updated_by).toBe("u-admin");
    expect(typeof row.updated_at).toBe("string");
  });

  it("upsertOverride updates existing row in place (no duplicate)", () => {
    upsertOverride({ userId: "u-1", feature: "ai.single", dailyLimitUsdMilli: 1000 });
    upsertOverride({
      userId: "u-1",
      feature: "ai.single",
      dailyLimitUsdMilli: 7500,
      updatedBy: "u-admin",
    });
    const rows = listOverridesForUser("u-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].daily_limit_usd_milli).toBe(7500);
    expect(rows[0].updated_by).toBe("u-admin");
  });

  it("upsertOverride accepts zero as a valid limit (admin opt-out)", () => {
    const row = upsertOverride({ userId: "u-1", feature: "ai.single", dailyLimitUsdMilli: 0 });
    expect(row.daily_limit_usd_milli).toBe(0);
  });

  it("upsertOverride defaults updated_by to null when omitted", () => {
    const row = upsertOverride({ userId: "u-1", feature: "ai.single", dailyLimitUsdMilli: 1000 });
    expect(row.updated_by).toBeNull();
  });

  it("upsertOverride rejects negative limits", () => {
    expect(() => upsertOverride({ userId: "u-1", feature: "ai.single", dailyLimitUsdMilli: -1 })).toThrow(
      /invalid daily_limit_usd_milli/
    );
  });

  it("upsertOverride rejects non-integer limits", () => {
    expect(() => upsertOverride({ userId: "u-1", feature: "ai.single", dailyLimitUsdMilli: 1.5 })).toThrow(
      /invalid daily_limit_usd_milli/
    );
  });

  it("upsertOverride rejects empty feature", () => {
    expect(() => upsertOverride({ userId: "u-1", feature: "", dailyLimitUsdMilli: 1000 })).toThrow(/invalid feature/);
  });

  it("deleteOverride returns true when deleting existing row", () => {
    upsertOverride({ userId: "u-1", feature: "ai.single", dailyLimitUsdMilli: 1000 });
    expect(deleteOverride("u-1", "ai.single")).toBe(true);
    expect(getOverride("u-1", "ai.single")).toBeNull();
  });

  it("deleteOverride returns false when row missing (idempotent)", () => {
    expect(deleteOverride("u-1", "ai.single")).toBe(false);
  });

  it("deleteOverride does not affect other rows", () => {
    upsertOverride({ userId: "u-1", feature: "ai.single", dailyLimitUsdMilli: 1000 });
    upsertOverride({ userId: "u-1", feature: "ai.multi", dailyLimitUsdMilli: 5000 });
    deleteOverride("u-1", "ai.single");
    const rows = listOverridesForUser("u-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].feature).toBe("ai.multi");
  });

  it("ON DELETE CASCADE removes overrides when user is deleted", () => {
    upsertOverride({ userId: "u-1", feature: "ai.single", dailyLimitUsdMilli: 1000 });
    upsertOverride({ userId: "u-1", feature: "ai.multi", dailyLimitUsdMilli: 5000 });
    getDb().prepare("DELETE FROM users WHERE id = ?").run("u-1");
    expect(listOverridesForUser("u-1")).toEqual([]);
  });
});
