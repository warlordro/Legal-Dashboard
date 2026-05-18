import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuditEvents } from "../db/auditRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { getDecryptedKey, invalidateCache } from "../db/tenantKeysRepository.ts";
import { updateUserRole } from "../db/userRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { resetMasterKeyCacheForTests } from "../util/tenantKeyCrypto.ts";
import { adminRouter } from "./admin.ts";

let tmpRoot: string;
const originalDbPath = process.env.LEGAL_DASHBOARD_DB_PATH;
const originalSecret = process.env.TENANT_KEY_ENCRYPTION_SECRET;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-admin-keys-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  process.env.TENANT_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
  resetMasterKeyCacheForTests();
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  invalidateCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 }))
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  closeDb();
  invalidateCache();
  resetMasterKeyCacheForTests();
  if (originalDbPath === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real intre teste.
    delete process.env.LEGAL_DASHBOARD_DB_PATH;
  } else {
    process.env.LEGAL_DASHBOARD_DB_PATH = originalDbPath;
  }
  if (originalSecret === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real intre teste.
    delete process.env.TENANT_KEY_ENCRYPTION_SECRET;
  } else {
    process.env.TENANT_KEY_ENCRYPTION_SECRET = originalSecret;
  }
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function buildApp(actAs = "local") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", actAs);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/v1/admin", adminRouter);
  return app;
}

async function jsonOf(res: Response): Promise<{
  data: unknown;
  error?: { code: string; message: string; details?: unknown };
  requestId: string;
}> {
  return (await res.json()) as never;
}

describe("/api/v1/admin/keys", () => {
  it("returns key status without plaintext or ciphertext", async () => {
    updateUserRole("local", "admin");
    const app = buildApp();
    await app.request("/api/v1/admin/keys/openai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "sk-test-secret-1234" }),
    });

    const res = await app.request("/api/v1/admin/keys");

    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(JSON.stringify(body)).not.toContain("sk-test-secret");
    expect(JSON.stringify(body)).not.toContain("cipher");
    expect(body.data).toMatchObject({
      keys: {
        openai: { set: true, last4: "1234" },
        anthropic: { set: false, last4: null },
      },
      captcha: { provider: "2captcha", mode: "sequential" },
    });
  });

  it("rejects non-admin callers", async () => {
    const res = await buildApp().request("/api/v1/admin/keys");

    expect(res.status).toBe(403);
  });

  it("persists a key and records redacted audit detail", async () => {
    updateUserRole("local", "admin");
    const app = buildApp();

    const res = await app.request("/api/v1/admin/keys/anthropic", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "sk-ant-secret-abcd" }),
    });

    expect(res.status).toBe(200);
    expect(getDecryptedKey("anthropic")).toBe("sk-ant-secret-abcd");
    const events = getAuditEvents({ ownerId: "local", action: "admin.tenantKeys.update" });
    expect(events).toHaveLength(1);
    expect(events[0].detail_json).not.toContain("sk-ant-secret");
    expect(JSON.parse(events[0].detail_json)).toEqual({
      field: "anthropic",
      hadPrevious: false,
      cleared: false,
      last4After: "abcd",
    });
  });

  it("returns 422 and does not persist when provider rejects a key", async () => {
    updateUserRole("local", "admin");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 }))
    );
    const app = buildApp();

    const res = await app.request("/api/v1/admin/keys/openai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "bad-key" }),
    });

    expect(res.status).toBe(422);
    expect(getDecryptedKey("openai")).toBe("");
  });

  it("accepts save with validationSkipped audit when network validation fails", async () => {
    updateUserRole("local", "admin");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    const app = buildApp();

    const res = await app.request("/api/v1/admin/keys/openrouter", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "sk-or-v1-secret-wxyz" }),
    });

    expect(res.status).toBe(200);
    expect(getDecryptedKey("openrouter")).toBe("sk-or-v1-secret-wxyz");
    const events = getAuditEvents({ ownerId: "local", action: "admin.tenantKeys.update" });
    expect(JSON.parse(events[0].detail_json)).toMatchObject({ validationSkipped: true, last4After: "wxyz" });
  });

  it("clears a key with an empty value", async () => {
    updateUserRole("local", "admin");
    const app = buildApp();
    await app.request("/api/v1/admin/keys/google", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "AIza-secret" }),
    });

    const res = await app.request("/api/v1/admin/keys/google", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "" }),
    });

    expect(res.status).toBe(200);
    expect(getDecryptedKey("google")).toBe("");
  });

  it("updates captcha provider settings", async () => {
    updateUserRole("local", "admin");
    const app = buildApp();

    const res = await app.request("/api/v1/admin/keys/captcha", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "capsolver", mode: "race" }),
    });

    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toEqual({ provider: "capsolver", mode: "race" });
    const events = getAuditEvents({ ownerId: "local", action: "admin.tenantKeys.captchaSettings.update" });
    expect(events).toHaveLength(1);
  });

  it("rejects PUT /keys/:field with an unknown field as invalid_field 404", async () => {
    updateUserRole("local", "admin");

    const res = await buildApp().request("/api/v1/admin/keys/unknown_provider", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "irrelevant" }),
    });

    expect(res.status).toBe(404);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("invalid_field");
  });

  it("returns PAYLOAD_TOO_LARGE 413 when admin PUT body exceeds the limit", async () => {
    updateUserRole("local", "admin");
    // ADMIN_BODY_LIMIT is 4096 bytes; pad value to push the raw JSON well over.
    const oversizedValue = "x".repeat(5000);

    const res = await buildApp().request("/api/v1/admin/keys/openai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: oversizedValue }),
    });

    expect(res.status).toBe(413);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("clears a tenant key via empty value and records cleared:true in audit detail", async () => {
    updateUserRole("local", "admin");
    const app = buildApp();
    await app.request("/api/v1/admin/keys/openai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "sk-existing-value-abcd" }),
    });

    const res = await app.request("/api/v1/admin/keys/openai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "" }),
    });

    expect(res.status).toBe(200);
    const events = getAuditEvents({ ownerId: "local", action: "admin.tenantKeys.update" });
    const last = events[0];
    expect(JSON.parse(last.detail_json)).toMatchObject({
      field: "openai",
      cleared: true,
      hadPrevious: true,
    });
  });
});
