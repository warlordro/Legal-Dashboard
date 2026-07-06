import Database from "better-sqlite3";
import { Hono } from "hono";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/schema.ts";
import { invalidateCache, setTenantKey } from "../db/tenantKeysRepository.ts";
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
  invalidateCache();
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

describe("rutare AI implicita (resolveEffectiveAiMode, v2.41.0)", () => {
  function enableTenantOpenrouter() {
    process.env.TENANT_KEY_ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString("base64");
    invalidateCache();
    setTenantKey("openrouter", "sk-or-v1-tenant-cheie-de-test", "admin-test");
  }

  it("web fara alegere explicita + cheie OpenRouter tenant -> mode efectiv openrouter", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    enableTenantOpenrouter();

    const res = await buildApp().request("/api/v1/ai/settings");
    expect(await res.json()).toEqual({ mode: "openrouter" });
  });

  it("alegerea explicita native are prioritate peste auto-detect", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    // ownerGuard rezerva "local" pentru desktop; in web scriem ca user real.
    ownerId = "user-web-1";
    enableTenantOpenrouter();
    await buildApp().request("/api/v1/ai/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "native" }),
    });

    const res = await buildApp().request("/api/v1/ai/settings");
    expect(await res.json()).toEqual({ mode: "native" });
  });

  it("web fara cheie OpenRouter tenant -> fallback native", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.TENANT_KEY_ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString("base64");
    invalidateCache();

    const res = await buildApp().request("/api/v1/ai/settings");
    expect(await res.json()).toEqual({ mode: "native" });
  });

  it("desktop nu auto-detecteaza (ramane native fara alegere)", async () => {
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
