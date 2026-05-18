import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { insertAiUsage } from "../db/aiUsageRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { upsertOverride } from "../db/userQuotaRepository.ts";
import { insertUser } from "../db/userRepository.ts";
import { requestIdContext } from "./requestId.ts";
import { quotaGuard } from "./quotaGuard.ts";

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

describe("quotaGuard", () => {
  it("bypasses enforcement in desktop mode", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    upsertOverride({ userId: "alice", feature: "ai.single", dailyLimitUsdMilli: 0 });

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
    upsertOverride({ userId: "alice", feature: "ai.single", dailyLimitUsdMilli: 10 });
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
    upsertOverride({ userId: "alice", feature: "ai.single", dailyLimitUsdMilli: 10 });
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

  it("blocks every web request when override.daily_limit_usd_milli is 0 (deny-all)", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai.single", dailyLimitUsdMilli: 0 });

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
});
