import type { Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./email/mailer.ts", () => ({
  isMailerConfigured: vi.fn(() => true),
  sendComposedEmail: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../db/ownerEmailSettingsRepository.ts", () => ({
  getEmailSettings: vi.fn(() => ({
    ownerId: "alice",
    enabled: true,
    toAddress: "alice@example.com",
    minSeverity: "info",
    dailyReportEnabled: false,
    lastDailyReportSentFor: null,
    createdAt: "",
    updatedAt: "",
  })),
}));

import { isMailerConfigured, sendComposedEmail } from "./email/mailer.ts";
import { getEmailSettings } from "../db/ownerEmailSettingsRepository.ts";
import { _resetTokenAlertsForTest, notifyTokenNewIp } from "./tokenAlerts.ts";

const mockedMailerConfigured = vi.mocked(isMailerConfigured);
const mockedSend = vi.mocked(sendComposedEmail);
const mockedSettings = vi.mocked(getEmailSettings);

const ctx = { get: (k: string) => (k === "ownerId" ? "alice" : undefined) } as unknown as Context;

beforeEach(() => {
  vi.clearAllMocks();
  _resetTokenAlertsForTest();
  mockedMailerConfigured.mockReturnValue(true);
  mockedSend.mockResolvedValue({ ok: true });
  mockedSettings.mockReturnValue({
    ownerId: "alice",
    enabled: true,
    toAddress: "alice@example.com",
    minSeverity: "info",
    dailyReportEnabled: false,
    lastDailyReportSentFor: null,
    createdAt: "",
    updatedAt: "",
  });
});
afterEach(() => vi.restoreAllMocks());

describe("notifyTokenNewIp", () => {
  it("actually sends an email once for a new (token, ip)", async () => {
    await notifyTokenNewIp(ctx, "tok1", "1.2.3.4");
    expect(mockedSend).toHaveBeenCalledTimes(1);
    const [to, composed] = mockedSend.mock.calls[0];
    expect(to).toBe("alice@example.com");
    expect(composed.subject).toMatch(/IP nou/i);
  });

  it("dedups within the window (second identical call does not re-send)", async () => {
    await notifyTokenNewIp(ctx, "tok1", "1.2.3.4");
    await notifyTokenNewIp(ctx, "tok1", "1.2.3.4");
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it("sends again for a different IP", async () => {
    await notifyTokenNewIp(ctx, "tok1", "1.2.3.4");
    await notifyTokenNewIp(ctx, "tok1", "5.6.7.8");
    expect(mockedSend).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when the mailer is not configured", async () => {
    mockedMailerConfigured.mockReturnValue(false);
    await notifyTokenNewIp(ctx, "tok1", "1.2.3.4");
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("is a no-op when no recipient address is configured", async () => {
    mockedSettings.mockReturnValue({
      ownerId: "alice",
      enabled: true,
      toAddress: null,
      minSeverity: "info",
      dailyReportEnabled: false,
      lastDailyReportSentFor: null,
      createdAt: "",
      updatedAt: "",
    });
    await notifyTokenNewIp(ctx, "tok1", "1.2.3.4");
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("resolves without throwing even if the send fails", async () => {
    mockedSend.mockResolvedValue({ ok: false, reason: "send_failed" });
    await expect(notifyTokenNewIp(ctx, "tok1", "1.2.3.4")).resolves.toBeUndefined();
  });
});
