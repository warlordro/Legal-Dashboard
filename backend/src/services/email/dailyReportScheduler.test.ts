import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertAlert } from "../../db/monitoringAlertsRepository.ts";
import { markDailyReportSent, upsertEmailSettings, type EmailSettings } from "../../db/ownerEmailSettingsRepository.ts";
import { closeDb, getDb } from "../../db/schema.ts";
import { _resetDailyReportRetryStateForTest, runDailyReportTick } from "./dailyReportScheduler.ts";

let tmpRoot: string;

function seedJob(ownerId: string, hashSeed: string): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at)
       VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', '2026-04-28T12:00:00.000Z')`
    )
    .run(ownerId, hashSeed);
  return info.lastInsertRowid as number;
}

function seedRun(ownerId: string, jobId: number): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`
    )
    .run(ownerId, jobId, "2026-05-02T10:00:00.000Z");
  return info.lastInsertRowid as number;
}

function seedAlertAt(ownerId: string, createdAtIso: string, dedupKey: string): void {
  const jobId = seedJob(ownerId, `${ownerId}-${dedupKey}-${Math.random()}`);
  const runId = seedRun(ownerId, jobId);
  insertAlert({
    ownerId,
    jobId,
    runId,
    kind: "dosar_new",
    severity: "info",
    title: `alerta-${dedupKey}`,
    dedupKey,
  });
  // The alert was just inserted with a CURRENT_TIMESTAMP server clock. Force
  // its created_at to the test-controlled UTC instant so we can validate the
  // yesterday-window selection.
  getDb()
    .prepare("UPDATE monitoring_alerts SET created_at = ? WHERE dedup_key = ? AND owner_id = ?")
    .run(createdAtIso, dedupKey, ownerId);
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-daily-report-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  _resetDailyReportRetryStateForTest();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.DAILY_REPORT_HOUR;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  _resetDailyReportRetryStateForTest();
});

const MAY_3_AT_9 = new Date(2026, 4, 3, 9, 30, 0); // local 09:30 May 3 2026
const MAY_3_AT_10 = new Date(2026, 4, 3, 10, 0, 0); // local 10:00 May 3 2026
const YESTERDAY_NOON_UTC = "2026-05-02T12:00:00.000Z";

describe("runDailyReportTick — fire window", () => {
  it("does not fire outside the configured hour", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_10,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    expect(result.fired).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("fires at the configured hour even if there are no candidates", async () => {
    const send = vi.fn();
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    expect(result.fired).toBe(true);
    expect(result.ownersConsidered).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("fires=true but skips send when SMTP is not configured", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    const send = vi.fn();
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => false,
      send,
    });
    expect(result.fired).toBe(true);
    expect(result.ownersConsidered).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("runDailyReportTick — owner selection", () => {
  it("selects only owners with daily_report_enabled=1 and unsent today", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    upsertEmailSettings("bob", {
      enabled: true,
      toAddress: "bob@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: false,
    });
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-1");
    seedAlertAt("bob", YESTERDAY_NOON_UTC, "bob-1");

    const send = vi.fn().mockResolvedValue({ ok: true });
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });

    expect(result.ownersConsidered).toBe(1);
    expect(result.emailsSent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("alice@firma.ro");
  });

  it("dedups same-day re-runs via last_daily_report_sent_for", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-1");
    markDailyReportSent("alice", "2026-05-03");

    const send = vi.fn().mockResolvedValue({ ok: true });
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });

    expect(result.ownersConsidered).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips owners whose enabled=false even when daily flag is on", async () => {
    upsertEmailSettings("alice", {
      enabled: false,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-1");
    const send = vi.fn().mockResolvedValue({ ok: true });
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });

    expect(result.ownersConsidered).toBe(1);
    expect(result.emailsSent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips owners with null toAddress even when both flags are on", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: null,
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-1");
    const send = vi.fn().mockResolvedValue({ ok: true });
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });

    expect(result.ownersConsidered).toBe(1);
    expect(result.emailsSent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("runDailyReportTick — zero-alert path", () => {
  it("marks the day as sent but does NOT call send when no alerts in window", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    // No alerts seeded.

    const send = vi.fn();
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });

    expect(result.ownersConsidered).toBe(1);
    expect(result.emailsSent).toBe(0);
    expect(result.emailsSkippedNoAlerts).toBe(1);
    expect(send).not.toHaveBeenCalled();

    // last_daily_report_sent_for should now be set to today, so the next tick
    // is a no-op.
    const row = getDb()
      .prepare("SELECT last_daily_report_sent_for FROM owner_email_settings WHERE owner_id = ?")
      .get("alice") as { last_daily_report_sent_for: string };
    expect(row.last_daily_report_sent_for).toBe("2026-05-03");
  });
});

describe("runDailyReportTick — send outcomes", () => {
  it("marks day sent and audits success on ok send", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-1");
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-2");

    const send = vi.fn().mockResolvedValue({ ok: true });
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });

    expect(result.emailsSent).toBe(1);
    const composed = send.mock.calls[0][1] as { subject: string; html: string };
    expect(composed.subject).toContain("Raport zilnic 02.05.2026");
    expect(composed.subject).toContain("2 alerte");

    const row = getDb()
      .prepare("SELECT last_daily_report_sent_for FROM owner_email_settings WHERE owner_id = ?")
      .get("alice") as { last_daily_report_sent_for: string };
    expect(row.last_daily_report_sent_for).toBe("2026-05-03");

    const audit = getDb()
      .prepare("SELECT action, outcome FROM audit_log WHERE owner_id = ? ORDER BY id DESC LIMIT 1")
      .get("alice") as { action: string; outcome: string } | undefined;
    expect(audit?.action).toBe("email.daily_report.sent");
    expect(audit?.outcome).toBe("ok");
  });

  it("does NOT mark day sent on send failure (best-effort retry next day)", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-1");

    const send = vi.fn().mockResolvedValue({ ok: false, reason: "send_failed" });
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });

    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(1);
    const row = getDb()
      .prepare("SELECT last_daily_report_sent_for FROM owner_email_settings WHERE owner_id = ?")
      .get("alice") as { last_daily_report_sent_for: string | null };
    expect(row.last_daily_report_sent_for).toBeNull();

    const audit = getDb()
      .prepare("SELECT action, outcome FROM audit_log WHERE owner_id = ? ORDER BY id DESC LIMIT 1")
      .get("alice") as { action: string; outcome: string } | undefined;
    expect(audit?.action).toBe("email.daily_report.failed");
    expect(audit?.outcome).toBe("error");
  });

  it("isolates exception thrown by send and audits as exception", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-1");

    const send = vi.fn().mockRejectedValue(new Error("SMTP down"));
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });

    expect(result.emailsFailed).toBe(1);
    const audit = getDb()
      .prepare("SELECT action, outcome, detail_json FROM audit_log WHERE owner_id = ? ORDER BY id DESC LIMIT 1")
      .get("alice") as { action: string; outcome: string; detail_json: string };
    expect(audit.action).toBe("email.daily_report.failed");
    const detail = JSON.parse(audit.detail_json) as { reason: string; message: string };
    expect(detail.reason).toBe("exception");
    expect(detail.message).toBe("SMTP down");
  });
});

describe("runDailyReportTick — retry backoff (Batch 4.4)", () => {
  it("does NOT mark day sent after a single failure (within backoff window)", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-1");

    const send = vi.fn().mockResolvedValue({ ok: false, reason: "send_failed" });
    const result = await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    expect(result.emailsFailed).toBe(1);
    const row = getDb()
      .prepare("SELECT last_daily_report_sent_for FROM owner_email_settings WHERE owner_id = ?")
      .get("alice") as { last_daily_report_sent_for: string | null };
    expect(row.last_daily_report_sent_for).toBeNull();
  });

  it("skips owner during active backoff window after a failure", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-1");

    const send = vi.fn().mockResolvedValue({ ok: false, reason: "send_failed" });
    // First tick at 09:30 -> failure -> sets nextAttemptAt = 09:30 + 5min.
    await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    // Second tick at 09:32 (still within 5min backoff) -> should skip.
    const result = await runDailyReportTick({
      now: () => new Date(2026, 4, 3, 9, 32, 0),
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.emailsFailed).toBe(0);
  });

  it("retries after backoff window elapses", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-1");

    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "send_failed" })
      .mockResolvedValueOnce({ ok: true });
    // First tick at 09:30 -> failure -> nextAttemptAt = 09:35.
    await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    // Second tick at 09:36 (past backoff) -> retry, this time succeed.
    const result = await runDailyReportTick({
      now: () => new Date(2026, 4, 3, 9, 36, 0),
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.emailsSent).toBe(1);
    const row = getDb()
      .prepare("SELECT last_daily_report_sent_for FROM owner_email_settings WHERE owner_id = ?")
      .get("alice") as { last_daily_report_sent_for: string };
    expect(row.last_daily_report_sent_for).toBe("2026-05-03");
  });

  it("marks day sent with retry_exhausted audit after 3 failures", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-1");

    const send = vi.fn().mockResolvedValue({ ok: false, reason: "send_failed" });

    // Tick 1 @ 09:30 → fail #1, nextAttemptAt = 09:35.
    await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    // Tick 2 @ 09:36 → fail #2, nextAttemptAt = 09:51.
    await runDailyReportTick({
      now: () => new Date(2026, 4, 3, 9, 36, 0),
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    // Tick 3 @ 09:52 → fail #3, attempts = MAX(3).
    await runDailyReportTick({
      now: () => new Date(2026, 4, 3, 9, 52, 0),
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    // Tick 4 @ 09:57 — still in reportHour=9 window. attempts>=MAX
    // is checked before nextAttemptAt, so exhausted branch fires here.
    const finalResult = await runDailyReportTick({
      now: () => new Date(2026, 4, 3, 9, 57, 0),
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(finalResult.emailsFailed).toBe(0);
    expect(finalResult.emailsSent).toBe(0);

    const row = getDb()
      .prepare("SELECT last_daily_report_sent_for FROM owner_email_settings WHERE owner_id = ?")
      .get("alice") as { last_daily_report_sent_for: string };
    expect(row.last_daily_report_sent_for).toBe("2026-05-03");

    const audit = getDb()
      .prepare(
        "SELECT action, outcome, detail_json FROM audit_log WHERE owner_id = ? AND action = 'email.daily_report.failed' ORDER BY id DESC LIMIT 1"
      )
      .get("alice") as { action: string; outcome: string; detail_json: string };
    const detail = JSON.parse(audit.detail_json) as { reason?: string; attempts?: number };
    expect(detail.reason).toBe("retry_exhausted");
    expect(detail.attempts).toBe(3);
  });
});

describe("runDailyReportTick — off-hour retry (BUG-04)", () => {
  it("runs a due retry off-hour but does NOT send to owners without a pending retry", async () => {
    _resetDailyReportRetryStateForTest();
    // owner-A and owner-B both enabled with a yesterday alert (fresh, no retry).
    upsertEmailSettings("owner-A", {
      enabled: true,
      toAddress: "a@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    upsertEmailSettings("owner-B", {
      enabled: true,
      toAddress: "b@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("owner-A", YESTERDAY_NOON_UTC, "a-1");
    seedAlertAt("owner-B", YESTERDAY_NOON_UTC, "b-1");

    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "smtp" }) // first owner @ 09:30 fails
      .mockResolvedValue({ ok: true });
    const at930 = new Date(2026, 4, 3, 9, 30, 0);
    const at1005 = new Date(2026, 4, 3, 10, 5, 0); // off-hour, failing owner retry due (09:35)
    await runDailyReportTick({
      now: () => at930,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    // owner-C is enabled with a yesterday alert but is activated ONLY AFTER the
    // 09:30 tick — so it was never sent and holds no retry entry. A weakened
    // implementation that opens the off-hour window GLOBALLY (instead of gating
    // per-owner on a pending retry) would send to owner-C at 10:05; the strict
    // gate must skip it. owner-B alone cannot prove this (it was already marked
    // sent at 09:30, so the candidate query filters it out regardless).
    upsertEmailSettings("owner-C", {
      enabled: true,
      toAddress: "c@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("owner-C", YESTERDAY_NOON_UTC, "c-1");
    send.mockClear();
    const r = await runDailyReportTick({
      now: () => at1005,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    // Only the owner with a due retry is sent off-hour; owner-B (already sent)
    // and owner-C (activated post-tick, no retry) are not touched.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("a@firma.ro");
    expect(r.emailsSent).toBe(1);
  });

  it("clears an exhausted retry off-hour (retry_exhausted audit)", async () => {
    _resetDailyReportRetryStateForTest();
    upsertEmailSettings("owner-A", {
      enabled: true,
      toAddress: "a@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("owner-A", YESTERDAY_NOON_UTC, "a-1");

    const send = vi.fn().mockResolvedValue({ ok: false, reason: "send_failed" });
    // Tick 1 @ 09:30 → fail #1, nextAttemptAt = 09:35.
    await runDailyReportTick({
      now: () => new Date(2026, 4, 3, 9, 30, 0),
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    // Tick 2 @ 09:36 → fail #2, nextAttemptAt = 09:51.
    await runDailyReportTick({
      now: () => new Date(2026, 4, 3, 9, 36, 0),
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    // Tick 3 @ 09:52 → fail #3, attempts = MAX(3).
    await runDailyReportTick({
      now: () => new Date(2026, 4, 3, 9, 52, 0),
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });
    // Tick 4 @ 10:05 is OFF-HOUR: the exhausted branch must still run here.
    const finalResult = await runDailyReportTick({
      now: () => new Date(2026, 4, 3, 10, 5, 0),
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(finalResult.emailsFailed).toBe(0);
    expect(finalResult.emailsSent).toBe(0);

    const row = getDb()
      .prepare("SELECT last_daily_report_sent_for FROM owner_email_settings WHERE owner_id = ?")
      .get("owner-A") as { last_daily_report_sent_for: string };
    expect(row.last_daily_report_sent_for).toBe("2026-05-03");

    const audit = getDb()
      .prepare(
        "SELECT action, outcome, detail_json FROM audit_log WHERE owner_id = ? AND action = 'email.daily_report.failed' ORDER BY id DESC LIMIT 1"
      )
      .get("owner-A") as { action: string; outcome: string; detail_json: string };
    const detail = JSON.parse(audit.detail_json) as { reason?: string; attempts?: number };
    expect(detail.reason).toBe("retry_exhausted");
    expect(detail.attempts).toBe(3);
  });
});

describe("runDailyReportTick — cross-midnight retry (FIX C)", () => {
  // reportHour=23; a send that fails at 23:55 on day D backs off past midnight.
  const D_2355 = () => new Date(2026, 4, 2, 23, 55, 0); // 23:55 May 2 (day D)
  const D1_0005 = () => new Date(2026, 4, 3, 0, 5, 0); // 00:05 May 3 (day D+1)
  const D1_2300 = () => new Date(2026, 4, 3, 23, 0, 0); // 23:00 May 3 (day D+1)
  const D_MINUS1_NOON_UTC = "2026-05-01T12:00:00.000Z"; // firmly in local May 1 (D-1)
  const D_NOON_UTC = "2026-05-02T12:00:00.000Z"; // firmly in local May 2 (D)

  it("resends the ORIGINAL day's report when a retry crosses midnight", async () => {
    _resetDailyReportRetryStateForTest();
    upsertEmailSettings("owner-A", {
      enabled: true,
      toAddress: "a@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("owner-A", D_MINUS1_NOON_UTC, "cm-1"); // alert belongs to D-1 report

    const send = vi.fn().mockResolvedValueOnce({ ok: false, reason: "smtp" }).mockResolvedValue({ ok: true });

    // Tick 1 @ 23:55 D (at reportHour) → report for D-1, send fails, retry armed.
    await runDailyReportTick({ now: D_2355, reportHour: () => 23, mailerConfigured: () => true, send });
    send.mockClear();
    // Tick 2 @ 00:05 D+1 (off-hour) → cross-midnight retry resends the D-1 report.
    const r = await runDailyReportTick({ now: D1_0005, reportHour: () => 23, mailerConfigured: () => true, send });

    expect(send).toHaveBeenCalledTimes(1);
    const composed = send.mock.calls[0][1] as { subject: string; html: string };
    expect(composed.subject).toContain("01.05.2026"); // original day D-1, not previousDay(today)
    expect(composed.html).toContain("alerta-cm-1");
    expect(r.emailsSent).toBe(1);

    const row = getDb()
      .prepare("SELECT last_daily_report_sent_for FROM owner_email_settings WHERE owner_id = ?")
      .get("owner-A") as { last_daily_report_sent_for: string };
    expect(row.last_daily_report_sent_for).toBe("2026-05-01"); // D-1
  });

  it("does NOT send to owners without a retry at the cross-midnight tick", async () => {
    _resetDailyReportRetryStateForTest();
    upsertEmailSettings("owner-A", {
      enabled: true,
      toAddress: "a@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    upsertEmailSettings("owner-B", {
      enabled: true,
      toAddress: "b@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("owner-A", D_MINUS1_NOON_UTC, "cm-a");
    seedAlertAt("owner-B", D_MINUS1_NOON_UTC, "cm-b");

    // Address-aware so the outcome does not depend on candidate ordering:
    // owner-A fails its first attempt (arming a cross-midnight retry), owner-B
    // always succeeds (marked sent at 23:55, no retry).
    let aAttempts = 0;
    const send = vi.fn(async (to: string) => {
      if (to === "a@firma.ro") {
        aAttempts++;
        return aAttempts === 1 ? { ok: false, reason: "smtp" } : { ok: true };
      }
      return { ok: true };
    });

    await runDailyReportTick({ now: D_2355, reportHour: () => 23, mailerConfigured: () => true, send });
    send.mockClear();
    const r = await runDailyReportTick({ now: D1_0005, reportHour: () => 23, mailerConfigured: () => true, send });

    // Only owner-A (cross-midnight retry) is resent; owner-B holds no retry.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("a@firma.ro");
    expect(r.emailsSent).toBe(1);
  });

  it("still fires the next day's normal send after a cross-midnight success", async () => {
    _resetDailyReportRetryStateForTest();
    upsertEmailSettings("owner-A", {
      enabled: true,
      toAddress: "a@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    seedAlertAt("owner-A", D_MINUS1_NOON_UTC, "cm-d1"); // D-1 report content
    seedAlertAt("owner-A", D_NOON_UTC, "cm-d"); // D report content

    const send = vi.fn().mockResolvedValueOnce({ ok: false, reason: "smtp" }).mockResolvedValue({ ok: true });

    // Tick 1 @ 23:55 D → report D-1, fails.
    await runDailyReportTick({ now: D_2355, reportHour: () => 23, mailerConfigured: () => true, send });
    // Tick 2 @ 00:05 D+1 → cross-midnight resend of D-1 report, succeeds.
    const r2 = await runDailyReportTick({ now: D1_0005, reportHour: () => 23, mailerConfigured: () => true, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[1][1] as { subject: string }).subject).toContain("01.05.2026");
    expect(r2.emailsSent).toBe(1);

    send.mockClear();
    // Tick 3 @ 23:00 D+1 (configured hour) → normal send for D (the day that ended).
    const r3 = await runDailyReportTick({ now: D1_2300, reportHour: () => 23, mailerConfigured: () => true, send });

    expect(send).toHaveBeenCalledTimes(1);
    const composed = send.mock.calls[0][1] as { subject: string; html: string };
    expect(composed.subject).toContain("02.05.2026"); // report for D
    expect(composed.html).toContain("alerta-cm-d");
    expect(composed.html).not.toContain("alerta-cm-d1");
    expect(r3.emailsSent).toBe(1);

    const row = getDb()
      .prepare("SELECT last_daily_report_sent_for FROM owner_email_settings WHERE owner_id = ?")
      .get("owner-A") as { last_daily_report_sent_for: string };
    expect(row.last_daily_report_sent_for).toBe("2026-05-03"); // D+1 tick marks todayLocal
  });
});

describe("runDailyReportTick — yesterday window correctness", () => {
  it("only includes alerts whose created_at falls in the previous local day", async () => {
    upsertEmailSettings("alice", {
      enabled: true,
      toAddress: "alice@firma.ro",
      minSeverity: "info",
      dailyReportEnabled: true,
    });
    // Alert from 2 days ago — should NOT be included.
    seedAlertAt("alice", "2026-05-01T12:00:00.000Z", "alice-old");
    // Alert from yesterday noon UTC — SHOULD be included (depends on local TZ
    // but UTC noon is firmly in May 2 in any timezone east of UTC-12).
    seedAlertAt("alice", YESTERDAY_NOON_UTC, "alice-yest");
    // Alert from today (May 3 local AM) — should NOT be included.
    seedAlertAt("alice", "2026-05-03T08:00:00.000Z", "alice-today");

    const send = vi.fn().mockResolvedValue({ ok: true });
    await runDailyReportTick({
      now: () => MAY_3_AT_9,
      reportHour: () => 9,
      mailerConfigured: () => true,
      send,
    });

    const composed = send.mock.calls[0][1] as { html: string; subject: string };
    expect(composed.subject).toContain("1 alerta");
    expect(composed.html).toContain("alerta-alice-yest");
    expect(composed.html).not.toContain("alerta-alice-old");
    expect(composed.html).not.toContain("alerta-alice-today");
  });
});
