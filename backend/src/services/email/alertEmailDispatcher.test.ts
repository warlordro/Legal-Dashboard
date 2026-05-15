import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitoringAlertRow } from "../../db/monitoringAlertsRepository.ts";
import { upsertEmailSettings } from "../../db/ownerEmailSettingsRepository.ts";
import { closeDb, getDb } from "../../db/schema.ts";
import { dispatchAlertEmail, drainEmailDispatches, pendingDispatchCountForTests } from "./alertEmailDispatcher.ts";
import { isMailerConfigured, sendAlertEmail } from "./mailer.ts";

vi.mock("./mailer.ts", () => ({
  sendAlertEmail: vi.fn(),
  isMailerConfigured: vi.fn(() => true),
}));

const sendAlertEmailMock = vi.mocked(sendAlertEmail);
const isMailerConfiguredMock = vi.mocked(isMailerConfigured);
let tmpRoot: string;

function alert(overrides: Partial<MonitoringAlertRow> = {}): MonitoringAlertRow {
  return {
    id: 42,
    owner_id: "local",
    job_id: 7,
    run_id: 9,
    kind: "termen_new",
    severity: "warning",
    title: "Termen nou",
    detail_json: "{}",
    dedup_key: "job-7|termen",
    is_new: 1,
    created_at: "2026-05-03T10:00:00.000Z",
    read_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-email-dispatch-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
  sendAlertEmailMock.mockReset();
  sendAlertEmailMock.mockResolvedValue({ ok: true });
  isMailerConfiguredMock.mockReset();
  isMailerConfiguredMock.mockReturnValue(true);
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("dispatchAlertEmail", () => {
  it("does nothing without settings", async () => {
    await dispatchAlertEmail(alert());
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", async () => {
    upsertEmailSettings("local", {
      enabled: false,
      toAddress: "alerts@firma.ro",
      minSeverity: "info",
    });
    await dispatchAlertEmail(alert());
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
  });

  it("does nothing without recipient", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: null,
      minSeverity: "info",
    });
    await dispatchAlertEmail(alert());
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
  });

  it("sends monitoring alerts regardless of the legacy stored minSeverity", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "critical",
    });
    await dispatchAlertEmail(alert({ severity: "warning" }));
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
  });

  it("sends when settings match", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "warning",
    });
    await dispatchAlertEmail(alert({ severity: "critical" }));
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
  });

  it("isolates mailer failures", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "info",
    });
    sendAlertEmailMock.mockRejectedValue(new Error("boom"));
    await expect(dispatchAlertEmail(alert())).resolves.toBeUndefined();
  });

  it("does not use severity as an email gate", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "warning",
    });
    await dispatchAlertEmail(alert({ severity: "debug" as never }));
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
  });

  // v2.10.1 #9: short-circuit when SMTP is not configured. When mailer is
  // disabled, dispatcher must skip even the DB read for owner_email_settings —
  // checking SMTP env is cheaper than a SELECT per insertAlert.
  it("short-circuits before reading DB when mailer is unconfigured", async () => {
    isMailerConfiguredMock.mockReturnValue(false);
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "info",
    });
    await dispatchAlertEmail(alert());
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
  });

  // v2.10.1 #13: send_failed must produce an audit row so silent SMTP outages
  // surface in the audit trail.
  it("writes an audit row when sendAlertEmail returns send_failed", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "info",
    });
    sendAlertEmailMock.mockResolvedValue({ ok: false, reason: "send_failed" });
    await dispatchAlertEmail(alert({ id: 99 }));
    const row = getDb()
      .prepare(
        `SELECT action, outcome, target_kind, target_id, detail_json
         FROM audit_log
         WHERE action = 'email.dispatch.failed'
         ORDER BY id DESC LIMIT 1`
      )
      .get() as
      | {
          action: string;
          outcome: string;
          target_kind: string | null;
          target_id: string | null;
          detail_json: string;
        }
      | undefined;
    expect(row).toBeTruthy();
    expect(row?.outcome).toBe("error");
    expect(row?.target_kind).toBe("monitoring_alert");
    expect(row?.target_id).toBe("99");
    const detail = row ? JSON.parse(row.detail_json) : {};
    expect(detail.reason).toBe("send_failed");
  });

  // v2.10.1 #7: drainEmailDispatches must wait for queued sends to settle
  // (used by gracefulShutdown so the DB doesn't close mid-write).
  it("drainEmailDispatches resolves once pending tasks settle", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "info",
    });
    let resolveSend: (value: { ok: true }) => void = () => {};
    sendAlertEmailMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        })
    );
    const dispatchPromise = dispatchAlertEmail(alert());
    // give the microtask a chance to enter the queue
    await Promise.resolve();
    expect(pendingDispatchCountForTests()).toBeGreaterThan(0);
    const drainPromise = drainEmailDispatches(2_000);
    resolveSend({ ok: true });
    await dispatchPromise;
    await drainPromise;
    expect(pendingDispatchCountForTests()).toBe(0);
  });
});
