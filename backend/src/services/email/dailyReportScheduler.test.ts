import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertAlert } from "../../db/monitoringAlertsRepository.ts";
import { markDailyReportSent, upsertEmailSettings, type EmailSettings } from "../../db/ownerEmailSettingsRepository.ts";
import { closeDb, getDb } from "../../db/schema.ts";
import { runDailyReportTick } from "./dailyReportScheduler.ts";

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
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  delete process.env.DAILY_REPORT_HOUR;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
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
