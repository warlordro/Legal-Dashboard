import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuditEvents } from "../db/auditRepository.ts";
import { getEmailSettings, upsertEmailSettings } from "../db/ownerEmailSettingsRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser } from "../db/userRepository.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { meRouter, resetEmailTestCooldownForTests } from "./me.ts";
import { isMailerConfigured, sendTestEmail } from "../services/email/mailer.ts";

vi.mock("../services/email/mailer.ts", () => ({
  isMailerConfigured: vi.fn(),
  sendTestEmail: vi.fn(),
}));

const isMailerConfiguredMock = vi.mocked(isMailerConfigured);
const sendTestEmailMock = vi.mocked(sendTestEmail);
let tmpRoot: string;

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
  const seed = new Database(dbPath);
  seed.close();
  getDb();
  isMailerConfiguredMock.mockReset();
  sendTestEmailMock.mockReset();
  isMailerConfiguredMock.mockReturnValue(false);
  resetEmailTestCooldownForTests();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
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

  it("PUT saves settings and records audit before/after", async () => {
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
    const detail = JSON.parse(events[0].detail_json);
    expect(detail.before).toBeNull();
    expect(detail.after.toAddress).toBe("alerts@firma.ro");
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
