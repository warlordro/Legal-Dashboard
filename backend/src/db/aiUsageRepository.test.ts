import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  earliestAiUsageTsInWindow,
  getAiUsageByFeature,
  getAiUsageByProvider,
  getAiUsageTotals,
  insertAiUsage,
  listAiUsageLastDays,
  sumAiUsageMilliInWindow,
  sumAiUsageMilliToday,
} from "./aiUsageRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;
let dbPath: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-ai-usage-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
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

describe("insertAiUsage", () => {
  it("persists a normalized owner-scoped usage row", () => {
    const row = insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4-mini",
      feature: "dosar_summary",
      inputTokens: 120.9,
      outputTokens: -5,
      costUsdMilli: 2.2,
      httpStatus: 200,
      requestId: "req-ai-1",
      routingTag: "openrouter:western",
      ts: "2026-04-30T10:00:00.000Z",
    });

    expect(row.owner_id).toBe("alice");
    expect(row.input_tokens).toBe(120);
    expect(row.output_tokens).toBe(0);
    expect(row.cost_usd_milli).toBe(2);
    expect(row.was_aborted).toBe(0);
    expect(row.request_id).toBe("req-ai-1");
    expect(row.routing_tag).toBe("openrouter:western");
  });

  it("accepts openrouter as a provider after migration 0024", () => {
    const row = insertAiUsage({
      ownerId: "alice",
      provider: "openrouter",
      model: "qwen/qwen3.7-max",
      feature: "dosar_summary",
      inputTokens: 10,
      outputTokens: 20,
      costUsdMilli: 30,
      routingTag: "openrouter:chinese",
    });

    expect(row.provider).toBe("openrouter");
    expect(row.routing_tag).toBe("openrouter:chinese");
  });
});

describe("AI usage queries", () => {
  beforeEach(() => {
    insertAiUsage({
      ownerId: "alice",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      feature: "dosar_summary",
      inputTokens: 100,
      outputTokens: 20,
      costUsdMilli: 1,
      ts: "2026-04-29T08:00:00.000Z",
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4-mini",
      feature: "dosar_multi_judge",
      inputTokens: 300,
      outputTokens: 40,
      costUsdMilli: 3,
      ts: "2026-04-30T08:00:00.000Z",
    });
    insertAiUsage({
      ownerId: "bob",
      provider: "openai",
      model: "gpt-5.4-mini",
      feature: "dosar_summary",
      inputTokens: 999,
      outputTokens: 999,
      costUsdMilli: 999,
      ts: "2026-04-30T09:00:00.000Z",
    });
  });

  it("returns rolling-window totals scoped to the owner", () => {
    const totals = getAiUsageTotals({
      ownerId: "alice",
      since: "2026-04-30T00:00:00.000Z",
    });

    expect(totals).toEqual({
      calls: 1,
      inputTokens: 300,
      outputTokens: 40,
      costUsdMilli: 3,
    });
  });

  it("returns provider and feature breakdowns scoped to the owner", () => {
    const window = {
      ownerId: "alice",
      since: "2026-04-28T00:00:00.000Z",
    };

    expect(getAiUsageByProvider(window).map((row) => [row.key, row.calls, row.costUsdMilli])).toEqual([
      ["openai", 1, 3],
      ["anthropic", 1, 1],
    ]);
    expect(getAiUsageByFeature(window).map((row) => [row.key, row.calls])).toEqual([
      ["dosar_multi_judge", 1],
      ["dosar_summary", 1],
    ]);
  });

  it("groups last-days usage without leaking another owner", () => {
    const result = listAiUsageLastDays({
      ownerId: "alice",
      days: 30,
      now: new Date("2026-04-30T12:00:00.000Z"),
    });

    expect(result.rows.map((row) => [row.day, row.calls, row.costUsdMilli])).toEqual([
      ["2026-04-29", 1, 1],
      ["2026-04-30", 1, 3],
    ]);
    expect(result.since).toBe("2026-04-01T00:00:00.000Z");
    expect(result.until).toBe("2026-04-30T12:00:00.000Z");
  });

  it("includes rows whose ts equals the window start (closed lower bound)", () => {
    insertAiUsage({
      ownerId: "alice",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      feature: "dosar_summary",
      inputTokens: 1,
      outputTokens: 1,
      costUsdMilli: 1,
      ts: "2026-04-30T00:00:00.000Z",
    });

    const totals = getAiUsageTotals({
      ownerId: "alice",
      since: "2026-04-30T00:00:00.000Z",
    });

    expect(totals.calls).toBe(2);
  });

  it("sums today's quota aliases for AI features", () => {
    const today = new Date().toISOString();
    insertAiUsage({
      ownerId: "alice",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      feature: "dosar_summary",
      costUsdMilli: 7,
      ts: today,
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_multi_analyst",
      costUsdMilli: 11,
      ts: today,
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "google",
      model: "gemini-pro-3",
      feature: "dosar_multi_judge",
      costUsdMilli: 13,
      ts: today,
    });

    expect(sumAiUsageMilliToday("alice", "ai.single")).toBe(7);
    expect(sumAiUsageMilliToday("alice", "ai.multi")).toBe(24);
  });
});

describe("sumAiUsageMilliInWindow", () => {
  it("includes only rows inside the rolling window", () => {
    const now = new Date();
    const inside = new Date(now.getTime() - 30 * 60_000).toISOString(); // 30 min ago
    const outside = new Date(now.getTime() - 5 * 3_600_000).toISOString(); // 5h ago

    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 4,
      ts: inside,
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 9,
      ts: outside,
    });

    // 1h window includes only the 30-min row.
    expect(sumAiUsageMilliInWindow("alice", "ai.single", 3600)).toBe(4);
    // 24h window includes both.
    expect(sumAiUsageMilliInWindow("alice", "ai.single", 86_400)).toBe(13);
  });

  it("expands ai.multi aliases (dosar_multi_analyst / dosar_multi_judge)", () => {
    const now = new Date();
    const ts = new Date(now.getTime() - 60_000).toISOString();
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt",
      feature: "dosar_multi_analyst",
      costUsdMilli: 5,
      ts,
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "google",
      model: "gemini",
      feature: "dosar_multi_judge",
      costUsdMilli: 7,
      ts,
    });
    expect(sumAiUsageMilliInWindow("alice", "ai.multi", 3600)).toBe(12);
  });

  it("rejects non-positive windowSeconds", () => {
    expect(() => sumAiUsageMilliInWindow("alice", "ai.single", 0)).toThrow();
    expect(() => sumAiUsageMilliInWindow("alice", "ai.single", -1)).toThrow();
  });
});

describe("earliestAiUsageTsInWindow", () => {
  it("returns the oldest ts inside the window or null when empty", () => {
    expect(earliestAiUsageTsInWindow("alice", "ai.single", 3600)).toBeNull();

    const now = Date.now();
    const tA = new Date(now - 50 * 60_000).toISOString(); // 50 min ago
    const tB = new Date(now - 20 * 60_000).toISOString(); // 20 min ago
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "x",
      feature: "dosar_summary",
      costUsdMilli: 1,
      ts: tA,
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "x",
      feature: "dosar_summary",
      costUsdMilli: 1,
      ts: tB,
    });

    const earliest = earliestAiUsageTsInWindow("alice", "ai.single", 3600);
    // SQLite stores ISO strings; lexicographic order matches chronological.
    expect(earliest).toBe(tA);
  });
});
