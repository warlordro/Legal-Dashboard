import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { insertAiUsage } from "../db/aiUsageRepository.ts";
import { fireWarning, isWarningActive } from "../db/budgetNotificationsRepository.ts";
import { upsertEmailSettings } from "../db/ownerEmailSettingsRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { createGrant } from "../db/userQuotaGrantsRepository.ts";
import { upsertOverride } from "../db/userQuotaRepository.ts";
import { insertUser } from "../db/userRepository.ts";
import { checkBudgetWarning, checkBudgetWarningRetry, quotaFeatureOf } from "./budgetWarningService.ts";

let tmpRoot: string;
const originalDbPath = process.env.LEGAL_DASHBOARD_DB_PATH;
const originalDefault = process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI;
const originalAuthMode = process.env.LEGAL_DASHBOARD_AUTH_MODE;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-bw-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  insertUser({ id: "alice", email: "alice@firma.ro", displayName: "Alice" });
});

afterEach(async () => {
  closeDb();
  if (originalDbPath === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
    delete process.env.LEGAL_DASHBOARD_DB_PATH;
  } else {
    process.env.LEGAL_DASHBOARD_DB_PATH = originalDbPath;
  }
  if (originalDefault === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
    delete process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI;
  } else {
    process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI = originalDefault;
  }
  if (originalAuthMode === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
    delete process.env.LEGAL_DASHBOARD_AUTH_MODE;
  } else {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = originalAuthMode;
  }
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("quotaFeatureOf", () => {
  // v2.42.0 (5.2): toate usage-urile AI se mapeaza pe pool-ul unic "ai".
  it("maps usage feature codes to quota features", () => {
    expect(quotaFeatureOf("dosar_summary")).toBe("ai");
    expect(quotaFeatureOf("ai.single")).toBe("ai");
    expect(quotaFeatureOf("dosar_multi_analyst")).toBe("ai");
    expect(quotaFeatureOf("dosar_multi_judge")).toBe("ai");
    expect(quotaFeatureOf("ai.multi")).toBe("ai");
  });

  it("returns null for unknown features", () => {
    expect(quotaFeatureOf("rnpm_search")).toBeNull();
    expect(quotaFeatureOf("")).toBeNull();
  });

  // v2.42.0 (5.2): retry-ul de email (index.ts) paseaza item.feature citit din
  // budget_notifications, care stocheaza deja quota feature-ul normalizat.
  it("accepts the already-normalized quota feature 'ai'", () => {
    expect(quotaFeatureOf("ai")).toBe("ai");
  });
});

describe("checkBudgetWarningRetry", () => {
  it("does not skip a fired episode stored with feature 'ai'", async () => {
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 100 });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 85,
      ts: new Date().toISOString(),
    });
    // Arm the episode directly (fired, email not yet sent) — same shape a real
    // retry candidate from selectPendingEmailRetries would have.
    fireWarning({ userId: "alice", feature: "ai", thresholdPct: 80 });
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    const result = await checkBudgetWarningRetry("alice", "ai", 80, { sendEmail });
    expect(result).not.toEqual({ state: "skipped", reason: "not_quota_feature" });
  });
});

describe("checkBudgetWarning", () => {
  it("skips when feature is not a quota feature", async () => {
    const result = await checkBudgetWarning("alice", "rnpm_search", { sendEmail: vi.fn() });
    expect(result.state).toBe("skipped");
  });

  it("skips when no override and no default quota", async () => {
    const result = await checkBudgetWarning("alice", "dosar_summary", { sendEmail: vi.fn() });
    expect(result.state).toBe("skipped");
  });

  // v2.43.0: default-ul din env (LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI) e
  // enforce-uit de quotaGuard DOAR in web mode. Pe desktop nu se impune nicio
  // limita din env, deci nu trebuie sa emita nici avertizari/email-uri pentru o
  // limita care nu exista efectiv. Aliniere cu quotaGuard.ts (getAuthMode).
  it("desktop: env default set, no override -> NO warning (limita din env nu se impune pe desktop)", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI = "100";
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 95,
      ts: new Date().toISOString(),
    });
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    const result = await checkBudgetWarning("alice", "dosar_summary", { sendEmail });
    expect(result.state).toBe("skipped");
    expect(isWarningActive("alice", "ai", 80)).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("web: env default set, no override, usage >=80% -> fires (comportament neschimbat)", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI = "100";
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 95,
      ts: new Date().toISOString(),
    });
    const result = await checkBudgetWarning("alice", "dosar_summary", { sendEmail: vi.fn() });
    expect(result.state).toBe("fired");
    expect(isWarningActive("alice", "ai", 80)).toBe(true);
  });

  it("desktop: override explicit ramane functional (semantica limitelor per user neschimbata)", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 100 });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 95,
      ts: new Date().toISOString(),
    });
    const result = await checkBudgetWarning("alice", "dosar_summary", { sendEmail: vi.fn() });
    expect(result.state).toBe("fired");
  });

  it("skips when limit is NULL (unlimited)", async () => {
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: null });
    const result = await checkBudgetWarning("alice", "dosar_summary", { sendEmail: vi.fn() });
    expect(result.state).toBe("skipped");
  });

  it("noop when usage below 80%", async () => {
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 100 });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 50,
      ts: new Date().toISOString(),
    });
    const result = await checkBudgetWarning("alice", "dosar_summary", { sendEmail: vi.fn() });
    expect(result.state).toBe("noop");
    expect(isWarningActive("alice", "ai", 80)).toBe(false);
  });

  it("fires once at 80% then no-ops on subsequent calls", async () => {
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 100 });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 80,
      ts: new Date().toISOString(),
    });
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    const first = await checkBudgetWarning("alice", "dosar_summary", { sendEmail });
    expect(first.state).toBe("fired");
    expect(isWarningActive("alice", "ai", 80)).toBe(true);
    const second = await checkBudgetWarning("alice", "dosar_summary", { sendEmail });
    expect(second.state).toBe("noop");
  });

  it("dispatches email only when email settings are enabled", async () => {
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 100 });
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: false,
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 80,
      ts: new Date().toISOString(),
    });
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    const result = await checkBudgetWarning("alice", "dosar_summary", { sendEmail });
    expect(result.state).toBe("fired");
    expect(result.emailDispatched).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toBe("alice@firma.ro");
  });

  it("does not dispatch email when minSeverity is critical", async () => {
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 100 });
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "critical",
      dailyReportEnabled: false,
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 90,
      ts: new Date().toISOString(),
    });
    const sendEmail = vi.fn();
    const result = await checkBudgetWarning("alice", "dosar_summary", { sendEmail });
    expect(result.state).toBe("fired");
    expect(result.emailDispatched).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("clears the episode when usage drops below 80%", async () => {
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 100 });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 85,
      ts: new Date().toISOString(),
    });
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    await checkBudgetWarning("alice", "dosar_summary", { sendEmail });
    expect(isWarningActive("alice", "ai", 80)).toBe(true);

    // Admin urca limita -> percent scade sub 80%.
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 200 });
    const cleared = await checkBudgetWarning("alice", "dosar_summary", { sendEmail });
    expect(cleared.state).toBe("cleared");
    expect(isWarningActive("alice", "ai", 80)).toBe(false);
  });

  it("clears the episode when limit is set to NULL (unlimited)", async () => {
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 100 });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 85,
      ts: new Date().toISOString(),
    });
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    await checkBudgetWarning("alice", "dosar_summary", { sendEmail });
    expect(isWarningActive("alice", "ai", 80)).toBe(true);

    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: null });
    const cleared = await checkBudgetWarning("alice", "dosar_summary", { sendEmail });
    expect(cleared.state).toBe("cleared");
    expect(isWarningActive("alice", "ai", 80)).toBe(false);
  });

  it("accounts for grants in the effective limit (delays fire)", async () => {
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 100 });
    createGrant({
      userId: "alice",
      feature: "ai",
      extraUsdMilli: 100,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      reason: "boost",
      grantedBy: "admin",
    });
    insertAiUsage({
      ownerId: "alice",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 90,
      ts: new Date().toISOString(),
    });
    // 90 / (100 + 100) = 45% -> noop.
    const sendEmail = vi.fn();
    const result = await checkBudgetWarning("alice", "dosar_summary", { sendEmail });
    expect(result.state).toBe("noop");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
