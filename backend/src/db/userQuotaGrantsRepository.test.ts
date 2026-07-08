// v2.32.0 userQuotaGrants repository tests.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createGrant,
  getGrant,
  listActiveGrants,
  listGrantsForUser,
  revokeGrant,
  sumActiveExtraMilli,
} from "./userQuotaGrantsRepository.ts";
import { insertUser } from "./userRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-grants-"));
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
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function future(hoursAhead: number): string {
  return new Date(Date.now() + hoursAhead * 3_600_000).toISOString();
}

function past(hoursBehind: number): string {
  return new Date(Date.now() - hoursBehind * 3_600_000).toISOString();
}

describe("userQuotaGrantsRepository", () => {
  it("createGrant inserts a row and echoes it", () => {
    const row = createGrant({
      userId: "u-1",
      feature: "ai.single",
      extraUsdMilli: 5000,
      expiresAt: future(24),
      reason: "deadline urgent",
      grantedBy: "admin-1",
    });
    expect(row.user_id).toBe("u-1");
    expect(row.feature).toBe("ai.single");
    expect(row.extra_usd_milli).toBe(5000);
    expect(row.granted_by).toBe("admin-1");
    expect(row.reason).toBe("deadline urgent");
    expect(row.revoked_at).toBeNull();
  });

  it("createGrant rejects zero or negative extra", () => {
    expect(() =>
      createGrant({ userId: "u-1", feature: "ai.single", extraUsdMilli: 0, expiresAt: future(24), grantedBy: "x" })
    ).toThrow(/invalid extra_usd_milli/);
    expect(() =>
      createGrant({ userId: "u-1", feature: "ai.single", extraUsdMilli: -1, expiresAt: future(24), grantedBy: "x" })
    ).toThrow(/invalid extra_usd_milli/);
  });

  it("createGrant rejects empty feature or grantedBy", () => {
    expect(() =>
      createGrant({ userId: "u-1", feature: "", extraUsdMilli: 100, expiresAt: future(24), grantedBy: "x" })
    ).toThrow(/invalid feature/);
    expect(() =>
      createGrant({ userId: "u-1", feature: "ai.single", extraUsdMilli: 100, expiresAt: future(24), grantedBy: "" })
    ).toThrow(/invalid granted_by/);
  });

  it("createGrant rejects unparseable expiresAt", () => {
    expect(() =>
      createGrant({
        userId: "u-1",
        feature: "ai.single",
        extraUsdMilli: 100,
        expiresAt: "not-a-date",
        grantedBy: "x",
      })
    ).toThrow(/invalid expires_at/);
  });

  it("listGrantsForUser returns all grants newest-first", () => {
    createGrant({ userId: "u-1", feature: "ai.single", extraUsdMilli: 100, expiresAt: future(24), grantedBy: "a" });
    createGrant({ userId: "u-1", feature: "ai.multi", extraUsdMilli: 200, expiresAt: future(48), grantedBy: "a" });
    createGrant({ userId: "u-2", feature: "ai.single", extraUsdMilli: 300, expiresAt: future(48), grantedBy: "a" });
    const rows = listGrantsForUser("u-1");
    expect(rows).toHaveLength(2);
    expect(rows[0].feature).toBe("ai.multi");
  });

  it("listActiveGrants ignores revoked and expired", () => {
    const active = createGrant({
      userId: "u-1",
      feature: "ai.single",
      extraUsdMilli: 1000,
      expiresAt: future(48),
      grantedBy: "a",
    });
    const expired = createGrant({
      userId: "u-1",
      feature: "ai.single",
      extraUsdMilli: 500,
      expiresAt: past(1),
      grantedBy: "a",
    });
    const revoked = createGrant({
      userId: "u-1",
      feature: "ai.single",
      extraUsdMilli: 700,
      expiresAt: future(72),
      grantedBy: "a",
    });
    revokeGrant(revoked.id, "admin-2", "test");

    const rows = listActiveGrants("u-1", "ai.single");
    expect(rows.map((r) => r.id)).toEqual([active.id]);
    expect(expired.expires_at < new Date().toISOString()).toBe(true);
  });

  it("sumActiveExtraMilli sums only active grants for (user, feature)", () => {
    createGrant({ userId: "u-1", feature: "ai.single", extraUsdMilli: 1000, expiresAt: future(48), grantedBy: "a" });
    createGrant({ userId: "u-1", feature: "ai.single", extraUsdMilli: 2500, expiresAt: future(72), grantedBy: "a" });
    const revoked = createGrant({
      userId: "u-1",
      feature: "ai.single",
      extraUsdMilli: 9000,
      expiresAt: future(96),
      grantedBy: "a",
    });
    revokeGrant(revoked.id, "admin", null);
    createGrant({ userId: "u-1", feature: "ai.single", extraUsdMilli: 300, expiresAt: past(1), grantedBy: "a" });
    createGrant({ userId: "u-1", feature: "ai.multi", extraUsdMilli: 5000, expiresAt: future(48), grantedBy: "a" });

    expect(sumActiveExtraMilli("u-1", "ai.single")).toBe(3500);
    expect(sumActiveExtraMilli("u-1", "ai.multi")).toBe(5000);
    expect(sumActiveExtraMilli("u-2", "ai.single")).toBe(0);
  });

  it("revokeGrant is idempotent (second call returns false)", () => {
    const g = createGrant({
      userId: "u-1",
      feature: "ai.single",
      extraUsdMilli: 100,
      expiresAt: future(24),
      grantedBy: "a",
    });
    expect(revokeGrant(g.id, "admin", "reason1")).toBe(true);
    expect(revokeGrant(g.id, "admin", "reason2")).toBe(false);
    const stored = getGrant(g.id);
    expect(stored?.revoked_reason).toBe("reason1");
  });

  it("revokeGrant rejects empty revokedBy", () => {
    const g = createGrant({
      userId: "u-1",
      feature: "ai.single",
      extraUsdMilli: 100,
      expiresAt: future(24),
      grantedBy: "a",
    });
    expect(() => revokeGrant(g.id, "", "reason")).toThrow(/invalid revoked_by/);
  });

  it("ON DELETE CASCADE removes grants when user is deleted", () => {
    createGrant({ userId: "u-1", feature: "ai.single", extraUsdMilli: 100, expiresAt: future(24), grantedBy: "a" });
    getDb().prepare("DELETE FROM users WHERE id = ?").run("u-1");
    expect(listGrantsForUser("u-1")).toEqual([]);
  });
});
