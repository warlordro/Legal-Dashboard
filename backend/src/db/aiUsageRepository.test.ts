import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getAiUsageByFeature,
  getAiUsageByProvider,
  getAiUsageTotals,
  insertAiUsage,
  listAiUsageLastDays,
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
      ts: "2026-04-30T10:00:00.000Z",
    });

    expect(row.owner_id).toBe("alice");
    expect(row.input_tokens).toBe(120);
    expect(row.output_tokens).toBe(0);
    expect(row.cost_usd_milli).toBe(2);
    expect(row.was_aborted).toBe(0);
    expect(row.request_id).toBe("req-ai-1");
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
    const rows = listAiUsageLastDays({
      ownerId: "alice",
      days: 30,
      now: new Date("2026-04-30T12:00:00.000Z"),
    });

    expect(rows.map((row) => [row.day, row.calls, row.costUsdMilli])).toEqual([
      ["2026-04-29", 1, 1],
      ["2026-04-30", 1, 3],
    ]);
  });
});
