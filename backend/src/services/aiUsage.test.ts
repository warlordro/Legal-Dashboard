import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb, closeDb } from "../db/schema.ts";
import { estimateAiCostUsdMilli, recordAiUsageSafely } from "./aiUsage.ts";
import { withAiLogging, AI_MODELS } from "./ai.ts";

let tmpRoot: string;
let dbPath: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-ai-telemetry-"));
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

describe("estimateAiCostUsdMilli", () => {
  it("calculates integer milli-USD for a known provider/model", () => {
    expect(
      estimateAiCostUsdMilli({
        provider: "anthropic",
        model: "claude-sonnet-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })
    ).toBe(12_000);
  });

  it("falls back to zero when model or tokens are missing", () => {
    // qwen/qwen3.7-max a fost delistat in v2.38.0 (stack chinese eliminat) —
    // model fara intrare de pret = cost 0 + warn one-shot, nu throw.
    expect(
      estimateAiCostUsdMilli({
        provider: "openrouter",
        model: "qwen/qwen3.7-max",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })
    ).toBe(0);
    expect(
      estimateAiCostUsdMilli({
        provider: "openai",
        model: "gpt-5.4-mini",
      })
    ).toBe(0);
  });
});

describe("AI_MODELS price table coverage", () => {
  // Every modelId registered in AI_MODELS must have a matching entry in the
  // price table — otherwise a successful AI call lands a row with cost=0,
  // which the user-facing summary card hides under the empty-state branch.
  // This test fails loudly the moment a new model is added without its
  // pricing.
  it("has a non-zero price entry for every registered AI_MODELS modelId", () => {
    for (const [, model] of Object.entries(AI_MODELS)) {
      const cost = estimateAiCostUsdMilli({
        provider: model.provider,
        model: model.modelId,
        inputTokens: 1_000_000,
        outputTokens: 0,
      });
      expect(cost, `missing price entry for ${model.provider}/${model.modelId}`).toBeGreaterThan(0);
    }
  });
});

describe("AI service usage tracking", () => {
  it("writes usage only after the AI call resolves", async () => {
    let rowsBeforeResolve = -1;
    const result = await withAiLogging(
      "openai",
      "gpt-5.4-mini",
      async () => {
        rowsBeforeResolve = (getDb().prepare("SELECT COUNT(*) AS n FROM ai_usage").get() as { n: number }).n;
        return {
          value: "analysis text",
          meta: { usageInput: 1_000_000, usageOutput: 1_000_000, httpStatus: 200 },
        };
      },
      {
        ownerId: "alice",
        feature: "dosar_summary",
        requestId: "req-write-after-call",
      }
    );

    expect(result).toBe("analysis text");
    expect(rowsBeforeResolve).toBe(0);

    const row = getDb().prepare("SELECT * FROM ai_usage").get() as {
      owner_id: string;
      provider: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd_milli: number;
      request_id: string;
      feature: string;
    };

    expect(row.owner_id).toBe("alice");
    expect(row.provider).toBe("openai");
    expect(row.model).toBe("gpt-5.4-mini");
    expect(row.input_tokens).toBe(1_000_000);
    expect(row.output_tokens).toBe(1_000_000);
    expect(row.cost_usd_milli).toBe(2_250);
    expect(row.request_id).toBe("req-write-after-call");
    expect(row.feature).toBe("dosar_summary");
  });

  it("uses direct OpenRouter cost and persists routing_tag when provided", async () => {
    const result = await withAiLogging(
      "openrouter",
      "anthropic/claude-opus-4.8",
      async () => ({
        value: "analysis text",
        meta: {
          usageInput: 1_000_000,
          usageOutput: 1_000_000,
          costUsdMilli: 123,
          routingTag: "openrouter:western",
        },
      }),
      {
        ownerId: "alice",
        feature: "dosar_summary",
        requestId: "req-openrouter-cost",
      }
    );

    expect(result).toBe("analysis text");
    await Promise.resolve();
    await Promise.resolve();

    const row = getDb().prepare("SELECT provider, model, cost_usd_milli, routing_tag FROM ai_usage").get() as {
      provider: string;
      model: string;
      cost_usd_milli: number;
      routing_tag: string | null;
    };

    expect(row).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-opus-4.8",
      cost_usd_milli: 123,
      routing_tag: "openrouter:western",
    });
  });

  it("writes a row on the failure path with the SDK status code and aborted flag", async () => {
    const sdkError = Object.assign(new Error("rate limited"), {
      name: "APIError",
      status: 429,
      usage: { input_tokens: 7, output_tokens: 0 },
    });

    await expect(
      withAiLogging(
        "anthropic",
        "claude-sonnet-4-6",
        async () => {
          throw sdkError;
        },
        { ownerId: "alice", feature: "dosar_summary", requestId: "req-error" }
      )
    ).rejects.toBe(sdkError);

    // Microtask defer in recordAiUsageSafely lands the row after the rejection
    // returns. One queueMicrotask flush is enough — no event-loop yield needed.
    await Promise.resolve();
    await Promise.resolve();

    const row = getDb().prepare("SELECT * FROM ai_usage").get() as {
      owner_id: string;
      http_status: number | null;
      was_aborted: number;
      input_tokens: number;
      request_id: string;
    };
    expect(row.owner_id).toBe("alice");
    expect(row.http_status).toBe(429);
    expect(row.was_aborted).toBe(0);
    expect(row.input_tokens).toBe(7);
    expect(row.request_id).toBe("req-error");
  });

  it("clamps an out-of-range http_status to null", async () => {
    const sdkError = Object.assign(new Error("upstream weirdness"), { status: 999 });
    await expect(
      withAiLogging(
        "openai",
        "gpt-5.4-mini",
        async () => {
          throw sdkError;
        },
        { ownerId: "alice", feature: "dosar_summary" }
      )
    ).rejects.toBe(sdkError);
    await Promise.resolve();
    await Promise.resolve();

    const row = getDb().prepare("SELECT http_status FROM ai_usage").get() as { http_status: number | null };
    expect(row.http_status).toBeNull();
  });

  it("sanitizes a negative latencyMs to null before persist", async () => {
    recordAiUsageSafely({
      tracking: { ownerId: "alice", feature: "dosar_summary", requestId: "req-neg-latency" },
      provider: "openai",
      model: "gpt-5.4-mini",
      meta: { latencyMs: -5 },
    });
    await Promise.resolve();
    await Promise.resolve();

    const row = getDb().prepare("SELECT latency_ms FROM ai_usage").get() as { latency_ms: number | null };
    expect(row.latency_ms).toBeNull();
  });

  it("sanitizes a NaN latencyMs to null before persist", async () => {
    recordAiUsageSafely({
      tracking: { ownerId: "alice", feature: "dosar_summary", requestId: "req-nan-latency" },
      provider: "openai",
      model: "gpt-5.4-mini",
      meta: { latencyMs: Number.NaN },
    });
    await Promise.resolve();
    await Promise.resolve();

    const row = getDb().prepare("SELECT latency_ms FROM ai_usage").get() as { latency_ms: number | null };
    expect(row.latency_ms).toBeNull();
  });

  it("truncates an over-length errorType to 128 chars before persist", async () => {
    recordAiUsageSafely({
      tracking: { ownerId: "alice", feature: "dosar_summary", requestId: "req-long-error" },
      provider: "openai",
      model: "gpt-5.4-mini",
      meta: { errorType: "x".repeat(200) },
    });
    await Promise.resolve();
    await Promise.resolve();

    const row = getDb().prepare("SELECT error_type FROM ai_usage").get() as { error_type: string | null };
    expect(row.error_type).toBe("x".repeat(128));
  });

  it("passes normal latencyMs and errorType through unchanged", async () => {
    recordAiUsageSafely({
      tracking: { ownerId: "alice", feature: "dosar_summary", requestId: "req-normal-telemetry" },
      provider: "openai",
      model: "gpt-5.4-mini",
      meta: { latencyMs: 1234, errorType: "timeout" },
    });
    await Promise.resolve();
    await Promise.resolve();

    const row = getDb().prepare("SELECT latency_ms, error_type FROM ai_usage").get() as {
      latency_ms: number | null;
      error_type: string | null;
    };
    expect(row.latency_ms).toBe(1234);
    expect(row.error_type).toBe("timeout");
  });

  it("does not write a row when tracking context is omitted", async () => {
    const value = await withAiLogging(
      "openai",
      "gpt-5.4-mini",
      async () => ({ value: "x", meta: { usageInput: 5, usageOutput: 0, httpStatus: 200 } })
      // tracking deliberately undefined
    );
    expect(value).toBe("x");
    await Promise.resolve();
    await Promise.resolve();

    const count = (getDb().prepare("SELECT COUNT(*) AS n FROM ai_usage").get() as { n: number }).n;
    expect(count).toBe(0);
  });
});
