import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuditEvents } from "../db/auditRepository.ts";
import { insertAiUsage } from "../db/aiUsageRepository.ts";
import { getEmailSettings, upsertEmailSettings } from "../db/ownerEmailSettingsRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { invalidateCache, setCaptchaSettings, setTenantKey } from "../db/tenantKeysRepository.ts";
import { createGrant } from "../db/userQuotaGrantsRepository.ts";
import { upsertOverride } from "../db/userQuotaRepository.ts";
import { insertUser } from "../db/userRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { resetMasterKeyCacheForTests } from "../util/tenantKeyCrypto.ts";
import { emailTestCooldownHasOwnerForTests, meRouter, resetEmailTestCooldownForTests } from "./me.ts";
import { isMailerConfigured, sendTestEmail } from "../services/email/mailer.ts";

vi.mock("../services/email/mailer.ts", () => ({
  isMailerConfigured: vi.fn(),
  sendTestEmail: vi.fn(),
}));

const isMailerConfiguredMock = vi.mocked(isMailerConfigured);
const sendTestEmailMock = vi.mocked(sendTestEmail);
let tmpRoot: string;
const originalDbPath = process.env.LEGAL_DASHBOARD_DB_PATH;
const originalAuthMode = process.env.LEGAL_DASHBOARD_AUTH_MODE;
const originalSecret = process.env.TENANT_KEY_ENCRYPTION_SECRET;

function buildApp(ownerId = "local") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", ownerId);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/v1/me", meRouter);
  return app;
}

async function jsonOf(res: Response): Promise<{
  data: any;
  error?: { code: string; message: string; details?: unknown };
  requestId: string;
}> {
  return (await res.json()) as never;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-me-route-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  process.env.TENANT_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
  resetMasterKeyCacheForTests();
  const seed = new Database(dbPath);
  seed.close();
  getDb();
  invalidateCache();
  isMailerConfiguredMock.mockReset();
  sendTestEmailMock.mockReset();
  isMailerConfiguredMock.mockReturnValue(false);
  resetEmailTestCooldownForTests();
});

afterEach(async () => {
  closeDb();
  invalidateCache();
  resetMasterKeyCacheForTests();
  restoreEnv("LEGAL_DASHBOARD_DB_PATH", originalDbPath);
  restoreEnv("LEGAL_DASHBOARD_AUTH_MODE", originalAuthMode);
  restoreEnv("TENANT_KEY_ENCRYPTION_SECRET", originalSecret);
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe("/api/v1/me/key-status", () => {
  it("returns desktop mode with tenant status disabled", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const res = await buildApp().request("/api/v1/me/key-status");

    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toEqual({
      authMode: "desktop",
      tenantKeysConfigured: {
        anthropic: false,
        openai: false,
        google: false,
        openrouter: false,
        captcha: false,
      },
    });
  });

  it("returns tenant key status in web mode without exposing values", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    setTenantKey("anthropic", "sk-ant-secret", "admin");
    setTenantKey("capsolver", "cap-secret", "admin");
    setCaptchaSettings({ provider: "capsolver", mode: "race", updatedBy: "admin" });

    const res = await buildApp().request("/api/v1/me/key-status");

    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(body.data).toEqual({
      authMode: "web",
      tenantKeysConfigured: {
        anthropic: true,
        openai: false,
        google: false,
        openrouter: false,
        captcha: true,
      },
    });
  });
});

describe("/api/v1/me/budget", () => {
  it("returns usage plus configured limits for the current user", async () => {
    upsertOverride({ userId: "local", feature: "ai.single", period: "day", limitUsdMilli: 50, updatedBy: "admin" });
    insertAiUsage({
      ownerId: "local",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 12,
      ts: new Date().toISOString(),
    });

    const res = await buildApp().request("/api/v1/me/budget");

    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feature: "ai.single",
          usedMilli: 12,
          limitMilli: 50,
          period: "day",
          baseLimitMilli: 50,
          extraFromGrantsMilli: 0,
          effectiveLimitMilli: 50,
        }),
        expect.objectContaining({
          feature: "ai.multi",
          usedMilli: 0,
          limitMilli: null,
          period: "day",
          baseLimitMilli: null,
          extraFromGrantsMilli: 0,
          effectiveLimitMilli: null,
        }),
      ])
    );
    expect(body.data.fx).toMatchObject({ pair: "USD/EUR" });
  });

  it("adds active grants into effectiveLimit", async () => {
    upsertOverride({ userId: "local", feature: "ai.single", period: "day", limitUsdMilli: 50, updatedBy: "admin" });
    createGrant({
      userId: "local",
      feature: "ai.single",
      extraUsdMilli: 30,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      reason: "test",
      grantedBy: "admin",
    });

    const res = await buildApp().request("/api/v1/me/budget");
    const body = await jsonOf(res);
    const single = body.data.items.find((it: { feature: string }) => it.feature === "ai.single");
    expect(single).toMatchObject({
      baseLimitMilli: 50,
      extraFromGrantsMilli: 30,
      effectiveLimitMilli: 80,
      limitMilli: 80,
    });
  });

  it("reports rolling-window usage when period=week", async () => {
    upsertOverride({ userId: "local", feature: "ai.single", period: "week", limitUsdMilli: 100, updatedBy: "admin" });
    insertAiUsage({
      ownerId: "local",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 30,
      ts: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });

    const res = await buildApp().request("/api/v1/me/budget");
    const body = await jsonOf(res);
    const single = body.data.items.find((it: { feature: string }) => it.feature === "ai.single");
    expect(single).toMatchObject({ period: "week", usedMilli: 30, baseLimitMilli: 100 });
  });
});

describe("/api/v1/me/email-settings", () => {
  it("GET returns defaults for a new owner", async () => {
    const res = await buildApp().request("/api/v1/me/email-settings");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({
      ownerId: "local",
      enabled: false,
      toAddress: null,
      minSeverity: "info",
      mailerConfigured: false,
    });
  });

  it("GET pre-fills a real login email without enabling notifications", async () => {
    insertUser({ id: "alice", email: "alice@firma.ro", displayName: "Alice" });
    const res = await buildApp("alice").request("/api/v1/me/email-settings");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({
      ownerId: "alice",
      enabled: false,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
    });
  });

  it("GET returns saved settings", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "critical",
    });
    isMailerConfiguredMock.mockReturnValue(true);
    const res = await buildApp().request("/api/v1/me/email-settings");
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "critical",
      mailerConfigured: true,
    });
  });

  it("PUT saves settings si scrie audit cu whitelist (fara email plaintext)", async () => {
    const res = await buildApp().request("/api/v1/me/email-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        toAddress: "alerts@firma.ro",
      }),
    });
    expect(res.status).toBe(200);
    expect(getEmailSettings("local")?.toAddress).toBe("alerts@firma.ro");
    const events = getAuditEvents({ ownerId: "local", action: "me.email_settings.update" });
    expect(events).toHaveLength(1);
    const detailJson = events[0].detail_json;
    // P0-1: audit NU mai contine email plaintext, doar hash + last4.
    expect(detailJson).not.toContain("alerts@firma.ro");
    const detail = JSON.parse(detailJson);
    expect(detail).toMatchObject({
      enabledBefore: null,
      enabledAfter: true,
      toAddressHadPrevious: false,
      toAddressHashBefore: null,
      toAddressLast4After: "a.ro",
      toAddressChanged: true,
    });
    expect(detail.toAddressHashAfter).toMatch(/^[0-9a-f]{16}$/);
  });

  it("PUT rejects enabled without toAddress", async () => {
    const res = await buildApp().request("/api/v1/me/email-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, toAddress: null, minSeverity: "warning" }),
    });
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("missing_to_address");
  });

  it("PUT rejects invalid email and severity", async () => {
    const invalidEmail = await buildApp().request("/api/v1/me/email-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, toAddress: "not-email", minSeverity: "warning" }),
    });
    expect(invalidEmail.status).toBe(400);

    const invalidSeverity = await buildApp().request("/api/v1/me/email-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, toAddress: null, minSeverity: "debug" }),
    });
    expect(invalidSeverity.status).toBe(400);
  });

  it("keeps owners isolated", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
    });
    const res = await buildApp("bob").request("/api/v1/me/email-settings");
    const body = await jsonOf(res);
    expect(body.data.toAddress).toBeNull();
  });
});

describe("POST /api/v1/me/email-settings/test", () => {
  it("returns 400 when no address is saved", async () => {
    const res = await buildApp().request("/api/v1/me/email-settings/test", { method: "POST" });
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("missing_to_address");
  });

  it("returns 503 when SMTP is not configured", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "warning",
    });
    const res = await buildApp().request("/api/v1/me/email-settings/test", { method: "POST" });
    expect(res.status).toBe(503);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("mailer_disabled");
  });

  it("returns 200 and audits ok for a successful test email", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "warning",
    });
    isMailerConfiguredMock.mockReturnValue(true);
    sendTestEmailMock.mockResolvedValue({ ok: true });
    const res = await buildApp().request("/api/v1/me/email-settings/test", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toEqual({ ok: true });
    expect(sendTestEmailMock).toHaveBeenCalledWith("alerts@firma.ro");
    const events = getAuditEvents({ ownerId: "local", action: "me.email_settings.test" });
    expect(events[0].outcome).toBe("ok");
  });

  it("prunes expired cooldown entries on access so the map stays bounded", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "warning",
    });
    upsertEmailSettings("bob", {
      enabled: true,
      toAddress: "bob@firma.ro",
      minSeverity: "warning",
    });
    isMailerConfiguredMock.mockReturnValue(true);
    sendTestEmailMock.mockResolvedValue({ ok: true });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-14T00:00:00.000Z"));
      const first = await buildApp("alice").request("/api/v1/me/email-settings/test", { method: "POST" });
      expect(first.status).toBe(200);
      expect(emailTestCooldownHasOwnerForTests("alice")).toBe(true);

      // Avans peste cooldown (60s); o cerere de la alt owner declanseaza prune-ul.
      vi.setSystemTime(new Date("2026-06-14T00:01:01.000Z"));
      const second = await buildApp("bob").request("/api/v1/me/email-settings/test", { method: "POST" });
      expect(second.status).toBe(200);

      expect(emailTestCooldownHasOwnerForTests("alice")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 200 and audits error for a failed test email", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "warning",
    });
    isMailerConfiguredMock.mockReturnValue(true);
    sendTestEmailMock.mockResolvedValue({ ok: false, reason: "send_failed" });
    const res = await buildApp().request("/api/v1/me/email-settings/test", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toEqual({ ok: false, reason: "send_failed" });
    const events = getAuditEvents({ ownerId: "local", action: "me.email_settings.test" });
    expect(events[0].outcome).toBe("error");
  });
});
