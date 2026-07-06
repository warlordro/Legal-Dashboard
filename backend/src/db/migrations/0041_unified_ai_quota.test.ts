// v2.42.0: testul consolidarii pool-ului "ai" (0041) + backfill UTC (0042).
// Migrations ruleaza la getDb(); logica de consolidare se testeaza re-executand
// SQL-ul up pe randuri legacy inserate ulterior (up-ul e idempotent prin
// NOT EXISTS pe 'ai').

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../schema.ts";
import { insertUser } from "../userRepository.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UP_0041 = fs.readFileSync(path.join(HERE, "0041_unified_ai_quota.up.sql"), "utf8");
const UP_0042 = fs.readFileSync(path.join(HERE, "0042_grants_expires_utc.up.sql"), "utf8");

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-mig41-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
  insertUser({ id: "u1", email: "u1@x", displayName: "U1" });
  insertUser({ id: "u2", email: "u2@x", displayName: "U2" });
  insertUser({ id: "u3", email: "u3@x", displayName: "U3" });
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: env trebuie unset real
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function insertLegacyOverride(userId: string, feature: string, period: string, limit: number | null): void {
  getDb()
    .prepare(
      `INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
       VALUES (?, ?, ?, ?, 1000, 'admin')`
    )
    .run(userId, feature, period, limit);
}

function overridesOf(userId: string): Array<{ feature: string; period: string; limit_usd_milli: number | null }> {
  return getDb()
    .prepare("SELECT feature, period, limit_usd_milli FROM user_quota_overrides WHERE user_id = ? ORDER BY feature")
    .all(userId) as never;
}

describe("migration 0041 — consolidarea pool-ului ai", () => {
  it("promoveaza randul cu RATA ZILNICA cea mai restrictiva (nu numarul brut)", () => {
    // 1000/zi (rata 1000) vs 900/luna (rata 30) — 900/luna e mai restrictiv.
    insertLegacyOverride("u1", "ai.single", "day", 1000);
    insertLegacyOverride("u1", "ai.multi", "month", 900);

    getDb().exec(UP_0041);

    expect(overridesOf("u1")).toEqual([{ feature: "ai", period: "month", limit_usd_milli: 900 }]);
  });

  it("NULL (nelimitat) pierde mereu in fata unei limite numerice", () => {
    insertLegacyOverride("u2", "ai.single", "day", null);
    insertLegacyOverride("u2", "ai.multi", "day", 500);

    getDb().exec(UP_0041);

    expect(overridesOf("u2")).toEqual([{ feature: "ai", period: "day", limit_usd_milli: 500 }]);
  });

  it("nu suprascrie un rand 'ai' existent (idempotenta prin NOT EXISTS)", () => {
    insertLegacyOverride("u3", "ai", "day", 42);
    insertLegacyOverride("u3", "ai.single", "day", 1);

    getDb().exec(UP_0041);

    expect(overridesOf("u3")).toEqual([{ feature: "ai", period: "day", limit_usd_milli: 42 }]);
  });

  it("muta granturile legacy pe 'ai' si sterge notificarile legacy", () => {
    getDb()
      .prepare(
        `INSERT INTO user_quota_grants (user_id, feature, extra_usd_milli, expires_at, granted_at, granted_by)
         VALUES ('u1', 'ai.single', 500, '2099-01-01T00:00:00.000Z', datetime('now'), 'admin')`
      )
      .run();
    getDb()
      .prepare(
        `INSERT INTO budget_notifications (user_id, feature, threshold_pct, fired_at)
         VALUES ('u1', 'ai.multi', 80, datetime('now'))`
      )
      .run();

    getDb().exec(UP_0041);

    const grant = getDb().prepare("SELECT feature FROM user_quota_grants WHERE user_id = 'u1'").get() as {
      feature: string;
    };
    expect(grant.feature).toBe("ai");
    const notif = getDb().prepare("SELECT COUNT(*) AS n FROM budget_notifications WHERE user_id = 'u1'").get() as {
      n: number;
    };
    expect(notif.n).toBe(0);
  });
});

describe("migration 0042 — backfill expires_at la UTC", () => {
  it("converteste ISO cu offset la boundary Z si lasa restul neatins", () => {
    getDb()
      .prepare(
        `INSERT INTO user_quota_grants (user_id, feature, extra_usd_milli, expires_at, granted_at, granted_by)
         VALUES ('u1', 'ai', 100, '2026-07-06T10:00:00+03:00', datetime('now'), 'admin')`
      )
      .run();
    getDb()
      .prepare(
        `INSERT INTO user_quota_grants (user_id, feature, extra_usd_milli, expires_at, granted_at, granted_by)
         VALUES ('u2', 'ai', 100, '2026-07-06T10:00:00.000Z', datetime('now'), 'admin')`
      )
      .run();

    getDb().exec(UP_0042);

    const rows = getDb().prepare("SELECT user_id, expires_at FROM user_quota_grants ORDER BY user_id").all() as Array<{
      user_id: string;
      expires_at: string;
    }>;
    expect(rows[0].expires_at).toBe("2026-07-06T07:00:00.000Z"); // +03:00 -> UTC
    expect(rows[1].expires_at).toBe("2026-07-06T10:00:00.000Z"); // deja Z, neatins
  });
});
