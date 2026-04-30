import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb, closeDb } from "../db/schema.ts";
import { estimateAiCostUsdMilli } from "./aiUsage.ts";
import { withAiLogging } from "./ai.ts";

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
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("estimateAiCostUsdMilli", () => {
  it("calculates integer milli-USD for a known provider/model", () => {
    expect(
      estimateAiCostUsdMilli({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(18_000);
  });

  it("falls back to zero when model or tokens are missing", () => {
    expect(
      estimateAiCostUsdMilli({
        provider: "anthropic",
        model: "unknown-model",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(0);
    expect(
      estimateAiCostUsdMilli({
        provider: "openai",
        model: "gpt-5.4-mini",
      }),
    ).toBe(0);
  });
});

describe("AI service usage tracking", () => {
  it("writes usage only after the AI call resolves", async () => {
    let rowsBeforeResolve = -1;
    const result = await withAiLogging(
      "openai",
      "gpt-5.4-mini",
      async () => {
        rowsBeforeResolve = (
          getDb().prepare(`SELECT COUNT(*) AS n FROM ai_usage`).get() as { n: number }
        ).n;
        return {
          value: "analysis text",
          meta: { usageInput: 1_000_000, usageOutput: 1_000_000, httpStatus: 200 },
        };
      },
      {
        ownerId: "alice",
        feature: "dosar_summary",
        requestId: "req-write-after-call",
      },
    );

    expect(result).toBe("analysis text");
    expect(rowsBeforeResolve).toBe(0);

    const row = getDb()
      .prepare(`SELECT * FROM ai_usage`)
      .get() as {
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
});
