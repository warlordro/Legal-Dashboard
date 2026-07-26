// v2.43.3 (finding review): pe /analyze-multi, o cadere a JUDECATORULUI arunca analizele
// celor doi analisti — deja platite — si, in cazul trunchierii, diagnostica gresit
// problema ("Verificati cheile API" pentru un buget de tokeni epuizat).
//
// Testele acopera cele doua cai de degradare: judge trunchiat si judge cu text gol.
// Ambele trebuie sa iasa pe evenimentul `error` CU `result.analyses` atasat.
import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callModelMock } = vi.hoisted(() => ({ callModelMock: vi.fn() }));

vi.mock("../services/ai.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai.ts")>();
  return { ...actual, callModel: callModelMock };
});

import { closeDb, getDb } from "../db/schema.ts";
import { insertUser } from "../db/userRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { AiTruncatedError } from "../services/ai.ts";
import { aiRouter } from "./ai.ts";

let tmpRoot: string;
const originalDbPath = process.env.LEGAL_DASHBOARD_DB_PATH;

function buildApp(ownerId: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", ownerId);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/ai", aiRouter);
  return app;
}

// Analistii livreaza, judecatorul (feature dosar_multi_judge) cade.
function analystsOkJudge(judgeOutcome: () => Promise<string>) {
  callModelMock.mockImplementation(
    async (_model: string, _prompt: string, _keys: unknown, _timeout: number, tracking: { feature?: string }) => {
      if (tracking?.feature === "dosar_multi_judge") return judgeOutcome();
      return "Analiza analistului.";
    }
  );
}

async function runMulti(): Promise<{
  status: number;
  events: Array<{ event: string; data: Record<string, unknown> }>;
}> {
  const res = await buildApp("alice").request("/api/ai/analyze-multi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      analysts: ["claude-sonnet", "gpt-5.6-terra"],
      judge: "claude-opus",
      dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
      apiKeys: { anthropic: "k".repeat(20), openai: "k".repeat(20) },
    }),
  });
  const text = await res.text();
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const chunk of text.split("\n\n")) {
    let event = "";
    let data = "";
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (event && data) events.push({ event, data: JSON.parse(data) });
  }
  return { status: res.status, events };
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-ai-multi-degraded-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
  insertUser({ id: "alice", email: "alice@x.ro", displayName: "Alice" });
  callModelMock.mockReset();
});

afterEach(async () => {
  closeDb();
  if (originalDbPath === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu undefined.
    delete process.env.LEGAL_DASHBOARD_DB_PATH;
  } else {
    process.env.LEGAL_DASHBOARD_DB_PATH = originalDbPath;
  }
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/ai/analyze-multi — degradare cand judecatorul cade", () => {
  it("judge trunchiat: cod AI_TRUNCATED + analizele analistilor pe evenimentul error", async () => {
    analystsOkJudge(() => Promise.reject(new AiTruncatedError("max_tokens")));

    const { events } = await runMulti();
    const err = events.find((e) => e.event === "error");

    expect(err).toBeDefined();
    // Diagnosticul corect: buget de tokeni, NU chei API.
    expect(err?.data.code).toBe("AI_TRUNCATED");
    expect(String(err?.data.error)).not.toMatch(/chei API/i);
    // Analizele platite ajung la client.
    const analyses = (err?.data.result as { analyses?: { analyst1: { text: string } } } | undefined)?.analyses;
    expect(analyses?.analyst1.text).toBe("Analiza analistului.");
  });

  it("judge gol: analizele ies pe error, nu pe done cu final gol", async () => {
    analystsOkJudge(() => Promise.resolve("   "));

    const { events } = await runMulti();
    const err = events.find((e) => e.event === "error");

    expect(events.some((e) => e.event === "done")).toBe(false);
    expect(err?.data.code).toBe("AI_EMPTY_RESPONSE");
    const analyses = (err?.data.result as { analyses?: { analyst2: { text: string } } } | undefined)?.analyses;
    expect(analyses?.analyst2.text).toBe("Analiza analistului.");
  });

  it("trunchiere INAINTE de analisti: fara result, mesaj tot despre buget de tokeni", async () => {
    callModelMock.mockRejectedValue(new AiTruncatedError("max_tokens"));

    const { events } = await runMulti();
    const err = events.find((e) => e.event === "error");

    expect(err?.data.code).toBe("AI_TRUNCATED");
    expect(err?.data.result).toBeUndefined();
  });
});
