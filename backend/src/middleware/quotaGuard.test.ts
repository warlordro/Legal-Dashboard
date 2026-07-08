import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  confirmAiUsageReservation,
  insertAiUsage,
  releaseAiUsageReservation,
  sumAiUsageMilliInWindow,
} from "../db/aiUsageRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { createGrant } from "../db/userQuotaGrantsRepository.ts";
import { upsertOverride } from "../db/userQuotaRepository.ts";
import { insertUser } from "../db/userRepository.ts";
import { requestIdContext } from "./requestId.ts";
import { quotaGuard, reserveQuotaBudget } from "./quotaGuard.ts";

let tmpRoot: string;
const originalDbPath = process.env.LEGAL_DASHBOARD_DB_PATH;
const originalAuthMode = process.env.LEGAL_DASHBOARD_AUTH_MODE;
const originalDefaultQuota = process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-quota-guard-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  insertUser({ id: "alice", email: "alice@firma.ro", displayName: "Alice" });
});

afterEach(async () => {
  closeDb();
  restoreEnv("LEGAL_DASHBOARD_DB_PATH", originalDbPath);
  restoreEnv("LEGAL_DASHBOARD_AUTH_MODE", originalAuthMode);
  restoreEnv("LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI", originalDefaultQuota);
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function buildApp(ownerId = "alice") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", ownerId);
    await next();
  });
  app.use("*", requestIdContext);
  app.post("/probe", quotaGuard("ai.single"), (c) => c.json({ ok: true }));
  return app;
}

function buildReserveApp(ownerId = "alice") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", ownerId);
    await next();
  });
  app.use("*", requestIdContext);
  app.post("/reserve", (c) => {
    const r = reserveQuotaBudget(c, "ai.single", "anthropic");
    if (!r.ok) return r.response;
    return c.json({ reservationId: r.reservationId });
  });
  return app;
}

describe("quotaGuard", () => {
  it("bypasses enforcement in desktop mode", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 0 });

    const res = await buildApp().request("/probe", { method: "POST" });

    expect(res.status).toBe(200);
  });

  it("allows web requests without override", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";

    const res = await buildApp().request("/probe", { method: "POST" });

    expect(res.status).toBe(200);
  });

  it("allows web requests below the daily limit", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 10 });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 9,
      ts: new Date().toISOString(),
    });

    const res = await buildApp().request("/probe", { method: "POST" });

    expect(res.status).toBe(200);
  });

  it("returns 429 and Retry-After when the daily limit is reached", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 10 });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 10,
      ts: new Date().toISOString(),
    });

    const res = await buildApp().request("/probe", { method: "POST" });
    const body = (await res.json()) as {
      error: { code: string; details: { usedMilli: number; limitMilli: number; source: string } };
    };

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(body.error.code).toBe("QUOTA_EXCEEDED");
    expect(body.error.details).toMatchObject({ usedMilli: 10, limitMilli: 10, source: "override" });
  });

  it("returns 429 when no override exists and the tenant default cap is reached", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI = "500";
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 500,
      ts: new Date().toISOString(),
    });

    const res = await buildApp().request("/probe", { method: "POST" });
    const body = (await res.json()) as {
      error: { code: string; details: { source: string; limitMilli: number } };
    };

    expect(res.status).toBe(429);
    expect(body.error.code).toBe("QUOTA_EXCEEDED");
    expect(body.error.details).toMatchObject({ source: "default", limitMilli: 500 });
  });

  it("allows requests under the tenant default cap when no override exists", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI = "500";

    const res = await buildApp().request("/probe", { method: "POST" });

    expect(res.status).toBe(200);
  });

  it("blocks every web request when override.limit_usd_milli is 0 (deny-all)", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 0 });

    const res = await buildApp().request("/probe", { method: "POST" });
    const body = (await res.json()) as { error: { code: string; details: { limitMilli: number } } };

    expect(res.status).toBe(429);
    expect(body.error.code).toBe("QUOTA_EXCEEDED");
    expect(body.error.details).toMatchObject({ limitMilli: 0 });
  });

  it("blocks every web request when default cap is 0 and no override exists", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI = "0";

    const res = await buildApp().request("/probe", { method: "POST" });

    expect(res.status).toBe(429);
  });

  it("treats limit_usd_milli=NULL as unlimited (bypass)", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: null });
    // Insert a lot of usage to confirm the gate doesn't fire.
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 1_000_000,
      ts: new Date().toISOString(),
    });

    const res = await buildApp().request("/probe", { method: "POST" });

    expect(res.status).toBe(200);
  });

  it("uses rolling 7-day window when period=week", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "week", limitUsdMilli: 100 });
    const now = Date.now();
    // 5 days ago: inside the 7-day rolling window.
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 100,
      ts: new Date(now - 5 * 86_400_000).toISOString(),
    });

    const res = await buildApp().request("/probe", { method: "POST" });
    const body = (await res.json()) as { error: { details: { period: string; limitMilli: number } } };

    expect(res.status).toBe(429);
    expect(body.error.details).toMatchObject({ period: "week", limitMilli: 100 });
  });

  it("does not count usage older than the rolling window (week)", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "week", limitUsdMilli: 100 });
    const now = Date.now();
    // 10 days ago: outside the 7-day window.
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 100,
      ts: new Date(now - 10 * 86_400_000).toISOString(),
    });

    const res = await buildApp().request("/probe", { method: "POST" });

    expect(res.status).toBe(200);
  });

  it("adds active grants to the effective limit", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 50 });
    // Grant adds +30 -> effective limit = 80. Usage 70 < 80 -> pass.
    createGrant({
      userId: "alice",
      feature: "ai",
      extraUsdMilli: 30,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      reason: "test",
      grantedBy: "admin",
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 70,
      ts: new Date().toISOString(),
    });

    const res = await buildApp().request("/probe", { method: "POST" });

    expect(res.status).toBe(200);
  });

  it("emits effective vs base limit and grants extra in the error envelope", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 50 });
    createGrant({
      userId: "alice",
      feature: "ai",
      extraUsdMilli: 20,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      reason: "boost",
      grantedBy: "admin",
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 70,
      ts: new Date().toISOString(),
    });

    const res = await buildApp().request("/probe", { method: "POST" });
    const body = (await res.json()) as {
      error: { details: { limitMilli: number; baseLimitMilli: number; extraFromGrantsMilli: number } };
    };

    expect(res.status).toBe(429);
    expect(body.error.details).toMatchObject({
      limitMilli: 70,
      baseLimitMilli: 50,
      extraFromGrantsMilli: 20,
    });
  });

  // v2.42.0 (5.2): pool unic — consumul de pe TOATE feature-urile AI istorice
  // se insumeaza contra aceleiasi limite "ai".
  it("pool unic: usage-ul single + multi se insumeaza contra limitei 'ai'", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 10 });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 6,
      ts: new Date().toISOString(),
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "anthropic",
      model: "claude-sonnet",
      feature: "dosar_multi_judge",
      costUsdMilli: 4,
      ts: new Date().toISOString(),
    });

    const res = await buildApp().request("/probe", { method: "POST" });
    const body = (await res.json()) as { error: { details: { usedMilli: number; feature: string } } };

    expect(res.status).toBe(429);
    expect(body.error.details).toMatchObject({ usedMilli: 10, feature: "ai" });
  });

  it("pool unic: override-ul legacy ai.single NU mai limiteaza (limita e doar pe 'ai')", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    // Rand legacy ramas ne-migrat (post-0041 nu ar trebui sa existe, dar
    // guard-ul citeste DOAR 'ai' — randul legacy e inert).
    upsertOverride({ userId: "alice", feature: "ai.single", period: "day", limitUsdMilli: 1 });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 999,
      ts: new Date().toISOString(),
    });

    const res = await buildApp().request("/probe", { method: "POST" });

    expect(res.status).toBe(200);
  });

  it("computes Retry-After from earliest usage ts + window", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 10 });
    // Usage 1h ago -> Retry-After ~ 23h.
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 10,
      ts: new Date(Date.now() - 3_600_000).toISOString(),
    });

    const res = await buildApp().request("/probe", { method: "POST" });
    const retryAfter = Number(res.headers.get("Retry-After"));

    expect(res.status).toBe(429);
    // 24h - 1h = 23h = 82_800s. Allow some jitter for the test execution.
    expect(retryAfter).toBeGreaterThan(82_000);
    expect(retryAfter).toBeLessThanOrEqual(86_400);
  });
});

// v2.42.0 (5.2): reserveQuotaBudget e cost-aware — rezerva ESTIMATUL inainte
// de apel (nu doar verifica used < limit), ca sa nu se poata depasi bugetul
// prin apeluri concurente scapate pe fereastra de check-then-act.
describe("reserveQuotaBudget", () => {
  it("blocheaza cand used + costEstimat depaseste limita desi used e sub limita", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    // limita 2500, folosit 1000: guard-ul threshold-only ar lasa sa treaca,
    // dar 1000 + 2000 (estimat ai.single) > 2500 => rezervarea refuza.
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 2500 });
    insertAiUsage({
      ownerId: "alice",
      provider: "anthropic",
      model: "claude-sonnet-5",
      feature: "dosar_summary",
      costUsdMilli: 1000,
      ts: new Date().toISOString(),
    });

    const res = await buildReserveApp().request("/reserve", { method: "POST" });

    expect(res.status).toBe(429);
    // Nicio rezervare pending nu a ramas in urma refuzului.
    expect(sumAiUsageMilliInWindow("alice", "ai", 86_400)).toBe(1000);
  });

  it("rezerva la estimat, iar release o scoate complet din fereastra", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 10_000 });

    const res = await buildReserveApp().request("/reserve", { method: "POST" });
    expect(res.status).toBe(200);
    const { reservationId } = (await res.json()) as { reservationId: number };

    // Pending-ul conteaza la estimat (2000) in fereastra...
    expect(sumAiUsageMilliInWindow("alice", "ai", 86_400)).toBe(2000);
    // ...iar release (esec de model) il elimina complet — bugetul nu ramane debitat.
    releaseAiUsageReservation(reservationId);
    expect(sumAiUsageMilliInWindow("alice", "ai", 86_400)).toBe(0);
  });

  it("confirm inlocuieste estimatul cu costul real", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 10_000 });

    const res = await buildReserveApp().request("/reserve", { method: "POST" });
    const { reservationId } = (await res.json()) as { reservationId: number };

    confirmAiUsageReservation(reservationId, {
      provider: "anthropic",
      model: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 200,
      costUsdMilli: 137,
      httpStatus: 200,
      wasAborted: false,
      routingTag: "native",
    });
    expect(sumAiUsageMilliInWindow("alice", "ai", 86_400)).toBe(137);
  });
});
