import Database from "better-sqlite3";
import { Hono } from "hono";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { closeDb, getDb } from "../db/schema.ts";
import { setTenantKey } from "../db/tenantKeysRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { aiRouter } from "./ai.ts";

let tmpRoot: string;
let ownerId = "local";

function buildApp() {
  const app = new Hono();
  app.use("*", requestIdContext);
  app.use("*", async (c, next) => {
    c.set("ownerId", ownerId);
    await next();
  });
  app.route("/api/v1/ai", aiRouter);
  return app;
}

beforeEach(async () => {
  ownerId = "local";
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-ai-route-settings-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_AUTH_MODE;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.TENANT_KEY_ENCRYPTION_SECRET;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("AI settings routes", () => {
  it("GET /api/v1/ai/settings returns native default", async () => {
    const res = await buildApp().request("/api/v1/ai/settings");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "native" });
  });

  it("PUT /api/v1/ai/settings cu doar mode persists openrouter", async () => {
    const res = await buildApp().request("/api/v1/ai/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "openrouter" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "openrouter" });
    const readback = await buildApp().request("/api/v1/ai/settings");
    expect(await readback.json()).toEqual({ mode: "openrouter" });
  });

  it("PUT /api/v1/ai/settings rejects invalid enum values", async () => {
    const res = await buildApp().request("/api/v1/ai/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "invalid" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_PARAMS");
  });

  // v2.42.0: fara alegere explicita, in web modul efectiv urmeaza cheile
  // tenantului — un tenant doar-cu-OpenRouter primeste "openrouter" automat.
  it("web fara alegere explicita: modul efectiv e openrouter cand tenantul are doar cheia OpenRouter", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.TENANT_KEY_ENCRYPTION_SECRET = crypto.randomBytes(32).toString("base64");
    setTenantKey("openrouter", "sk-or-v1-test-1234567890", "local");

    const res = await buildApp().request("/api/v1/ai/settings");
    expect(await res.json()).toEqual({ mode: "openrouter" });
  });

  it("alegerea explicita 'native' castiga peste auto-detect-ul pe cheia tenant", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    // In web, mutatiile ca ownerul santinela "local" sunt blocate — folosim un owner real.
    ownerId = "u-web-1";
    process.env.TENANT_KEY_ENCRYPTION_SECRET = crypto.randomBytes(32).toString("base64");
    setTenantKey("openrouter", "sk-or-v1-test-1234567890", "local");
    const put = await buildApp().request("/api/v1/ai/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "native" }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ mode: "native" });

    const res = await buildApp().request("/api/v1/ai/settings");
    expect(await res.json()).toEqual({ mode: "native" });
  });

  it("keeps settings isolated per owner", async () => {
    await buildApp().request("/api/v1/ai/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "openrouter" }),
    });

    ownerId = "other";
    const res = await buildApp().request("/api/v1/ai/settings");
    expect(await res.json()).toEqual({ mode: "native" });
  });
});

describe("AI route OpenRouter guards", () => {
  it("web mode rejects body-supplied OpenRouter key", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    const res = await buildApp().request("/api/v1/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet",
        dosar: { numar: "123/2024", institutie: "JUDECATORIA BUCURESTI" },
        apiKeys: { openrouter: "sk-or-v1-test" },
      }),
    });

    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("WEB_MODE_NOT_IMPLEMENTED");
    expect(body.error.message).toContain("OPENROUTER_API_KEY");
  });
});
