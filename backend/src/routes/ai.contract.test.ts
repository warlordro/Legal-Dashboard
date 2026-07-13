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
import { requestIdContext } from "../middleware/requestId.ts";
import { aiRouter } from "./ai.ts";

type EnvelopeErrorBody = {
  data: null;
  error: { code: string; message: string };
  requestId: string;
};

function buildApp(ownerId?: string) {
  const app = new Hono();
  if (ownerId) {
    app.use("*", async (c, next) => {
      c.set("ownerId", ownerId);
      await next();
    });
  }
  app.use("*", requestIdContext);
  app.route("/api/ai", aiRouter);
  return app;
}

async function expectEnvelope(res: Response, code: string) {
  const body = (await res.json()) as EnvelopeErrorBody;
  expect(body).toMatchObject({
    data: null,
    error: { code, message: expect.any(String) },
    requestId: expect.any(String),
  });
  expect(body.requestId.length).toBeGreaterThan(0);
}

describe("AI routes - envelope shape", () => {
  it("POST /api/ai/analyze fara body returneaza INVALID_JSON 400 envelope", async () => {
    const res = await buildApp().request("/api/ai/analyze", { method: "POST" });
    expect(res.status).toBe(400);
    await expectEnvelope(res, "INVALID_JSON");
  });

  it("POST /api/ai/analyze cu model necunoscut returneaza UNKNOWN_MODEL 400", async () => {
    const res = await buildApp().request("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "model-care-nu-exista",
        dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
        apiKeys: { anthropic: "sk-test" },
      }),
    });
    expect(res.status).toBe(400);
    await expectEnvelope(res, "UNKNOWN_MODEL");
  });

  it("POST /api/ai/analyze cu cheia veche gpt-5.4 returneaza UNKNOWN_MODEL 400 (migrare GPT-5.6)", async () => {
    const res = await buildApp().request("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
        apiKeys: { openai: "sk-test" },
      }),
    });
    expect(res.status).toBe(400);
    await expectEnvelope(res, "UNKNOWN_MODEL");
  });

  it("POST /api/ai/analyze cu model valid dar fara apiKeys returneaza MISSING_API_KEY", async () => {
    const res = await buildApp().request("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet",
        dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
        apiKeys: {},
      }),
    });
    expect(res.status).toBe(400);
    await expectEnvelope(res, "MISSING_API_KEY");
  });

  it("POST /api/ai/analyze-multi cu mai putin de 2 modele analist returneaza INVALID_PARAMS", async () => {
    const res = await buildApp().request("/api/ai/analyze-multi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        analysts: ["claude-sonnet"],
        judge: "claude-opus",
        dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
        apiKeys: { anthropic: "sk-test" },
      }),
    });
    expect(res.status).toBe(400);
    await expectEnvelope(res, "INVALID_PARAMS");
  });
});

// §9 web-mode contract: quota enforcement + admin-pointer MISSING_API_KEY message.
// Validate the wire contract the frontend depends on so we cannot accidentally
// regress to "NO_API_KEY" (desktop-style sentinel) for web users.
describe("AI routes - web mode contract (§9)", () => {
  let tmpRoot: string;
  const originalDbPath = process.env.LEGAL_DASHBOARD_DB_PATH;
  const originalAuthMode = process.env.LEGAL_DASHBOARD_AUTH_MODE;

  beforeEach(async () => {
    // The sibling "AI routes - envelope shape" describe block above doesn't set
    // LEGAL_DASHBOARD_DB_PATH, so its first test caches a getDb() singleton on
    // the cwd default path. Close that singleton before pointing the env var at
    // our isolated tmpRoot so getDb() actually re-opens against the new path.
    closeDb();
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-ai-contract-"));
    process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
    const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
    seed.close();
    getDb();
    insertUser({ id: "alice", email: "alice@firma.ro", displayName: "Alice" });
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
  });

  afterEach(async () => {
    closeDb();
    restoreEnv("LEGAL_DASHBOARD_DB_PATH", originalDbPath);
    restoreEnv("LEGAL_DASHBOARD_AUTH_MODE", originalAuthMode);
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  });

  it("POST /api/ai/analyze returneaza 429 QUOTA_EXCEEDED cu Retry-After cand override-ul e atins", async () => {
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 10 });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 10,
      ts: new Date().toISOString(),
    });

    const res = await buildApp("alice").request("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet",
        dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
      }),
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    await expectEnvelope(res, "QUOTA_EXCEEDED");
  });

  it("POST /api/ai/analyze in web mode fara cheia configurata trimite mesaj catre admin", async () => {
    const res = await buildApp("alice").request("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet",
        dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("MISSING_API_KEY");
    expect(body.error.message).toMatch(/admin/i);
    expect(body.error.message).toMatch(/\/admin\/keys/);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
