// AlertEventService — verifies the persistence-vs-fanout seam.
//
// Contract under test (v2.34.0 P1-6 — split persist vs dispatch):
//   - recordAndDispatchAlert returns the same shape as insertAlert and writes
//     a monitoring.alert.emitted audit row when the row is freshly inserted.
//   - recordAndDispatchAlert DOES NOT trigger email dispatch on its own.
//   - dispatchInsertedAlertEmails(results) schedules an email dispatch per
//     inserted=true row via queueMicrotask. The dispatcher is mocked at the
//     mailer boundary so the test exercises the wire-up without spinning up
//     SMTP.
//   - On a dedup hit (inserted=false) dispatchInsertedAlertEmails skips the
//     row — no SMTP send.
//   - Regression: when recordAndDispatchAlert is called inside a SQLite
//     transaction that subsequently rolls back, no email is dispatched
//     (phantom-email bug from pre-P1-6 queueMicrotask-inside-tx pattern).

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../../db/schema.ts";
import { upsertEmailSettings } from "../../db/ownerEmailSettingsRepository.ts";
import { drainEmailDispatches } from "../email/alertEmailDispatcher.ts";
import { dispatchInsertedAlertEmails, recordAndDispatchAlert } from "./alertEventService.ts";

vi.mock("../email/mailer.ts", () => ({
  isMailerConfigured: vi.fn(() => true),
  sendAlertEmail: vi.fn(async () => ({ ok: true })),
}));

import { sendAlertEmail } from "../email/mailer.ts";

const sendAlertEmailMock = vi.mocked(sendAlertEmail);

let tmpRoot: string;

function seedJob(ownerId: string): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at)
       VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', '2026-04-28T12:00:00.000Z')`
    )
    .run(ownerId, `seed-${ownerId}-${Date.now()}`);
  return info.lastInsertRowid as number;
}

function seedRun(ownerId: string, jobId: number): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`
    )
    .run(ownerId, jobId, "2026-04-28T10:00:00.000Z");
  return info.lastInsertRowid as number;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-alert-evt-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  sendAlertEmailMock.mockReset();
  sendAlertEmailMock.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  await drainEmailDispatches(2_000);
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("recordAndDispatchAlert", () => {
  it("persists the row and returns the same shape as insertAlert", () => {
    const jobId = seedJob("local");
    const runId = seedRun("local", jobId);
    const { row, inserted } = recordAndDispatchAlert({
      ownerId: "local",
      jobId,
      runId,
      kind: "dosar_new",
      severity: "info",
      title: "Dosar nou",
      detail: { foo: "bar" },
      dedupKey: "evt-k1",
    });
    expect(inserted).toBe(true);
    expect(row.id).toBeGreaterThan(0);
    expect(row.owner_id).toBe("local");
    expect(row.dedup_key).toBe("evt-k1");
  });

  it("does NOT dispatch email on its own (split persist vs dispatch)", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "info",
    });
    const jobId = seedJob("local");
    const runId = seedRun("local", jobId);
    recordAndDispatchAlert({
      ownerId: "local",
      jobId,
      runId,
      kind: "dosar_new",
      severity: "warning",
      title: "Dosar nou",
      detail: {},
      dedupKey: "evt-k2",
    });
    // Without dispatchInsertedAlertEmails(...), no email should ever fire.
    await drainEmailDispatches(2_000);
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(0);
  });

  it("writes a monitoring.alert.emitted audit row on fresh insert", () => {
    const jobId = seedJob("local");
    const runId = seedRun("local", jobId);
    const before = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'monitoring.alert.emitted'`)
      .get() as { n: number };
    const { row, inserted } = recordAndDispatchAlert({
      ownerId: "local",
      jobId,
      runId,
      kind: "termen_new",
      severity: "info",
      title: "Termen nou",
      detail: {},
      dedupKey: "evt-audit-1",
    });
    expect(inserted).toBe(true);
    const after = getDb()
      .prepare(
        `SELECT owner_id, target_kind, target_id, action, detail_json
           FROM audit_log
          WHERE action = 'monitoring.alert.emitted'
          ORDER BY id DESC
          LIMIT 1`
      )
      .get() as {
      owner_id: string;
      target_kind: string;
      target_id: string;
      action: string;
      detail_json: string;
    };
    const total = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'monitoring.alert.emitted'`)
      .get() as { n: number };
    expect(total.n).toBe(before.n + 1);
    expect(after.owner_id).toBe("local");
    expect(after.target_kind).toBe("monitoring_alert");
    expect(after.target_id).toBe(String(row.id));
    const detail = JSON.parse(after.detail_json) as {
      kind: string;
      severity: string;
      jobId: number;
      runId: number;
      dedupKey: string;
    };
    expect(detail.kind).toBe("termen_new");
    expect(detail.severity).toBe("info");
    expect(detail.jobId).toBe(jobId);
    expect(detail.runId).toBe(runId);
    expect(detail.dedupKey).toBe("evt-audit-1");
  });

  it("does not write an audit row on a dedup hit (inserted=false)", () => {
    const jobId = seedJob("local");
    const runId = seedRun("local", jobId);
    recordAndDispatchAlert({
      ownerId: "local",
      jobId,
      runId,
      kind: "termen_new",
      severity: "info",
      title: "Termen nou",
      detail: {},
      dedupKey: "evt-audit-dup",
    });
    const after1 = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'monitoring.alert.emitted'`)
      .get() as { n: number };
    recordAndDispatchAlert({
      ownerId: "local",
      jobId,
      runId,
      kind: "termen_new",
      severity: "info",
      title: "Termen nou (dup)",
      detail: {},
      dedupKey: "evt-audit-dup",
    });
    const after2 = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'monitoring.alert.emitted'`)
      .get() as { n: number };
    expect(after2.n).toBe(after1.n);
  });
});

describe("dispatchInsertedAlertEmails", () => {
  it("dispatches email exactly once for each inserted=true row", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "info",
    });
    const jobId = seedJob("local");
    const runId = seedRun("local", jobId);
    const result = recordAndDispatchAlert({
      ownerId: "local",
      jobId,
      runId,
      kind: "dosar_new",
      severity: "warning",
      title: "Dosar nou",
      detail: {},
      dedupKey: "evt-k2-dispatch",
    });
    dispatchInsertedAlertEmails([result]);
    await drainEmailDispatches(2_000);
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch email on a dedup hit (inserted=false)", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "info",
    });
    const jobId = seedJob("local");
    const runId = seedRun("local", jobId);
    const first = recordAndDispatchAlert({
      ownerId: "local",
      jobId,
      runId,
      kind: "dosar_new",
      severity: "info",
      title: "Dosar nou",
      detail: {},
      dedupKey: "evt-k3",
    });
    dispatchInsertedAlertEmails([first]);
    await drainEmailDispatches(2_000);
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);

    const second = recordAndDispatchAlert({
      ownerId: "local",
      jobId,
      runId,
      kind: "dosar_new",
      severity: "info",
      title: "Dosar nou (duplicate)",
      detail: {},
      dedupKey: "evt-k3",
    });
    dispatchInsertedAlertEmails([second]);
    await drainEmailDispatches(2_000);
    expect(second.inserted).toBe(false);
    // Still 1 — the dedup hit must not trigger a second SMTP send.
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
  });

  // v2.34.0 P1-6 regression: pre-fix, `recordAndDispatchAlert` queued the
  // email via queueMicrotask immediately after `insertAlert`. If the caller
  // wrapped the call in `getDb().transaction(() => { ... })` and the
  // transaction subsequently rolled back, the alert row was gone but the
  // microtask still ran → phantom email. The split-persist-vs-dispatch
  // contract forbids this: the dispatch site lives AFTER the transaction
  // returns, so a rollback aborts the dispatch path entirely.
  it("does not dispatch email when the wrapping transaction rolls back", async () => {
    upsertEmailSettings("local", {
      enabled: true,
      toAddress: "alerts@firma.ro",
      minSeverity: "info",
    });
    const jobId = seedJob("local");
    const runId = seedRun("local", jobId);

    const insertedResults: ReturnType<typeof recordAndDispatchAlert>[] = [];
    const alertsBefore = getDb().prepare("SELECT COUNT(*) AS n FROM monitoring_alerts").get() as { n: number };

    expect(() => {
      getDb().transaction(() => {
        const result = recordAndDispatchAlert({
          ownerId: "local",
          jobId,
          runId,
          kind: "dosar_new",
          severity: "warning",
          title: "Dosar nou (rolled back)",
          detail: {},
          dedupKey: "evt-rollback",
        });
        insertedResults.push(result);
        // Simulate a later step in the transaction throwing (e.g.
        // enrichSolutieAlertsForJob blowing up after the alert insert).
        throw new Error("simulated rollback");
      })();
    }).toThrow(/simulated rollback/);

    // Sanity: the alert row was rolled back.
    const alertsAfter = getDb().prepare("SELECT COUNT(*) AS n FROM monitoring_alerts").get() as { n: number };
    expect(alertsAfter.n).toBe(alertsBefore.n);

    // Because the throw aborted the call stack BEFORE we reached
    // dispatchInsertedAlertEmails, no email is sent — even though
    // `insertedResults` was populated inside the transaction.
    await drainEmailDispatches(2_000);
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(0);
  });
});
