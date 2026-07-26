// v2.43.3: un model care intoarce continut gol nu mai iese ca 200 {"analysis":""}.
// Pe Claude 5 thinking-ul consuma din acelasi buget ca textul, deci raspunsul gol e
// semnal de trunchiere sau de refuz, nu un rezultat valid.
//
// Fisier separat de ai.contract.test.ts intentionat: acolo nu exista niciun mock, iar
// un vi.mock la nivel de modul ar intra in graful tuturor testelor din fisier. Aici
// mock-ul e partial (importOriginal + spread), deci doar callModel e inlocuit.
import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/ai.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai.ts")>();
  return { ...actual, callModel: vi.fn(async () => "   ") };
});

import { closeDb, getDb } from "../db/schema.ts";
import { insertUser } from "../db/userRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
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

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-ai-empty-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
  insertUser({ id: "alice", email: "alice@x.ro", displayName: "Alice" });
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

describe("POST /api/ai/analyze — raspuns gol de la model", () => {
  it("intoarce 502 AI_EMPTY_RESPONSE in loc de 200 cu analiza goala", async () => {
    const res = await buildApp("alice").request("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet",
        dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
        apiKeys: { anthropic: "k".repeat(20) },
      }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { data: null; error: { code: string }; requestId: string };
    expect(body.error.code).toBe("AI_EMPTY_RESPONSE");
    expect(body.requestId.length).toBeGreaterThan(0);
  });
});
