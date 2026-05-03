import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitoringAlertRow } from "../../db/monitoringAlertsRepository.ts";
import type { EmailSettings } from "../../db/ownerEmailSettingsRepository.ts";
import {
  buildHtmlBody,
  buildSubject,
  buildTextBody,
  isMailerConfigured,
  readMailerConfig,
  resetMailerForTests,
  sendAlertEmail,
  sendTestEmail,
} from "./mailer.ts";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  createTransport: mocks.createTransport,
}));

const SMTP_ENV = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_SECURE"];

function clearSmtpEnv() {
  for (const key of SMTP_ENV) delete process.env[key];
}

function setSmtpEnv() {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass";
  process.env.SMTP_FROM = "alerts@firma.ro";
  process.env.SMTP_SECURE = "false";
}

function alert(overrides: Partial<MonitoringAlertRow> = {}): MonitoringAlertRow {
  return {
    id: 42,
    owner_id: "local",
    job_id: 7,
    run_id: 9,
    kind: "solutie_aparuta",
    severity: "critical",
    title: "Solutie noua",
    detail_json: JSON.stringify({ numar_dosar: "1/1/2024", raw: "<script>alert(1)</script>" }),
    dedup_key: "job-7|solutie",
    is_new: 1,
    created_at: "2026-05-03T10:00:00.000Z",
    read_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

const settings: EmailSettings = {
  ownerId: "local",
  enabled: true,
  toAddress: "user@firma.ro",
  minSeverity: "warning",
  createdAt: "2026-05-03T10:00:00.000Z",
  updatedAt: "2026-05-03T10:00:00.000Z",
};

beforeEach(() => {
  clearSmtpEnv();
  resetMailerForTests();
  mocks.sendMail.mockReset();
  mocks.createTransport.mockReset();
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
});

afterEach(() => {
  clearSmtpEnv();
  vi.restoreAllMocks();
});

describe("mailer config", () => {
  it("reads complete SMTP env", () => {
    setSmtpEnv();
    expect(readMailerConfig()).toMatchObject({
      host: "smtp.example.com",
      port: 587,
      user: "smtp-user",
      from: "alerts@firma.ro",
      secure: false,
    });
    expect(isMailerConfigured()).toBe(true);
  });

  it("returns null when SMTP env is incomplete", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    expect(readMailerConfig()).toBeNull();
    expect(isMailerConfigured()).toBe(false);
  });
});

describe("email builders", () => {
  it("builds Romanian subject from severity and kind", () => {
    expect(buildSubject(alert())).toBe("[Legal Dashboard] Critic: Solutie aparuta");
    expect(buildSubject(alert({ severity: "warning", kind: "termen_new" }))).toBe(
      "[Legal Dashboard] Avertisment: Termen nou",
    );
  });

  it("escapes HTML payload in the HTML body", () => {
    const html = buildHtmlBody(alert());
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("builds plain text without HTML tags", () => {
    const text = buildTextBody(alert());
    expect(text).toContain("legal-dashboard://alerts/42");
    expect(text).not.toContain("<h2>");
  });
});

describe("send email", () => {
  it("returns mailer_disabled when SMTP is not configured", async () => {
    await expect(sendAlertEmail(alert(), settings)).resolves.toEqual({
      ok: false,
      reason: "mailer_disabled",
    });
  });

  it("returns no_recipient when settings has no toAddress", async () => {
    setSmtpEnv();
    await expect(sendAlertEmail(alert(), { ...settings, toAddress: null })).resolves.toEqual({
      ok: false,
      reason: "no_recipient",
    });
  });

  it("sends alert email with expected envelope", async () => {
    setSmtpEnv();
    mocks.sendMail.mockResolvedValue({ messageId: "m-1" });
    await expect(sendAlertEmail(alert(), settings)).resolves.toEqual({ ok: true });
    expect(mocks.createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: { user: "smtp-user", pass: "smtp-pass" },
    });
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "alerts@firma.ro",
        to: "user@firma.ro",
        subject: "[Legal Dashboard] Critic: Solutie aparuta",
      }),
    );
  });

  it("isolates sendMail failures", async () => {
    setSmtpEnv();
    mocks.sendMail.mockRejectedValue(new Error("SMTP down"));
    await expect(sendAlertEmail(alert(), settings)).resolves.toEqual({
      ok: false,
      reason: "send_failed",
    });
  });

  it("sends test email", async () => {
    setSmtpEnv();
    mocks.sendMail.mockResolvedValue({ messageId: "test" });
    await expect(sendTestEmail("test@firma.ro")).resolves.toEqual({ ok: true });
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "test@firma.ro",
        subject: "[Legal Dashboard] Test notificari email",
      }),
    );
  });
});
