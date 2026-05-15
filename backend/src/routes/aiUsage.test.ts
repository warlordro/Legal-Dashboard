// Integration tests for /api/v1/ai-usage/summary.
//
// Coverage:
//   - envelope shape: { data: { summary24h, summary30d, daily[30], generatedAt }, requestId }
//   - owner isolation: rows for another owner do not leak into the summary
//   - daily series length is exactly 30 entries with consecutive UTC dates
//   - 30-day card equals the sum of the 30 daily bars (regression for the
//     pre-fix mismatch where summary30d used `now − 30×24h` while daily used
//     UTC-midnight−29d)
//   - empty state — no rows returns all-zero summaries

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../db/schema.ts";
import { insertAiUsage } from "../db/aiUsageRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { aiUsageRouter } from "./aiUsage.ts";

let tmpRoot: string;
let dbPath: string;

function buildTestApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const fakeOwner = c.req.header("x-test-owner") ?? "local";
    c.set("ownerId", fakeOwner);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/v1/ai-usage", aiUsageRouter);
  return app;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-ai-usage-routes-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

interface SummaryResponse {
  data: {
    summary24h: { costUsd: number; calls: number; inputTokens: number; outputTokens: number };
    summary30d: { costUsd: number; calls: number; inputTokens: number; outputTokens: number };
    daily: Array<{ date: string; costUsd: number; calls: number; inputTokens: number; outputTokens: number }>;
    generatedAt: string;
  };
  requestId: string;
}

describe("GET /api/v1/ai-usage/summary", () => {
  it("returns the v1 envelope with all expected fields and a 30-entry daily series", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/v1/ai-usage/summary", {
      headers: { "x-test-owner": "alice", "x-request-id": "req-summary-1" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SummaryResponse;
    expect(body.requestId).toBe("req-summary-1");
    expect(body.data).toBeDefined();
    expect(body.data.daily).toHaveLength(30);
    expect(body.data.summary24h).toEqual({ costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 });
    expect(body.data.summary30d).toEqual({ costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 });
    expect(typeof body.data.generatedAt).toBe("string");
  });

  it("does not leak another owner's usage into the summary", async () => {
    insertAiUsage({
      ownerId: "alice",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      feature: "dosar_summary",
      inputTokens: 100,
      outputTokens: 20,
      costUsdMilli: 1_000,
    });
    insertAiUsage({
      ownerId: "bob",
      provider: "openai",
      model: "gpt-5.4-mini",
      feature: "dosar_summary",
      inputTokens: 999,
      outputTokens: 999,
      costUsdMilli: 999_999,
    });

    const app = buildTestApp();
    const aliceRes = await app.request("/api/v1/ai-usage/summary", {
      headers: { "x-test-owner": "alice" },
    });
    const aliceBody = (await aliceRes.json()) as SummaryResponse;

    expect(aliceBody.data.summary30d.calls).toBe(1);
    expect(aliceBody.data.summary30d.costUsd).toBeCloseTo(1, 3);
    // Bob's 999_999 milli-USD must not appear anywhere in alice's series.
    for (const point of aliceBody.data.daily) {
      expect(point.costUsd).toBeLessThan(2);
    }
  });

  it("daily series sum matches summary30d.calls (no off-by-one window mismatch)", async () => {
    // Drop a row in each of three different UTC days within the last 30 days.
    // The previous bug used a sliding 30×24h totals window vs UTC-midnight
    // daily buckets — totals could exceed the bar sum by one day's worth of
    // rows. With the fix both windows share the same start so they must agree.
    const today = new Date();
    const days = [0, 5, 29].map((daysBack) => {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      d.setUTCDate(d.getUTCDate() - daysBack);
      return d.toISOString();
    });

    for (const ts of days) {
      insertAiUsage({
        ownerId: "alice",
        provider: "openai",
        model: "gpt-5.4-mini",
        feature: "dosar_summary",
        inputTokens: 10,
        outputTokens: 5,
        costUsdMilli: 100,
        ts,
      });
    }

    const app = buildTestApp();
    const res = await app.request("/api/v1/ai-usage/summary", {
      headers: { "x-test-owner": "alice" },
    });
    const body = (await res.json()) as SummaryResponse;

    const dailyCalls = body.data.daily.reduce((sum, point) => sum + point.calls, 0);
    expect(dailyCalls).toBe(body.data.summary30d.calls);
    expect(dailyCalls).toBe(3);
  });
});
