// AlertEventService — verifies the persistence-vs-fanout seam.
//
// Contract under test:
//   - recordAndDispatchAlert returns the same shape as insertAlert.
//   - On a fresh insert (inserted=true) it schedules an email dispatch via
//     queueMicrotask. The dispatcher is mocked at the mailer boundary so the
//     test exercises the wire-up without spinning up SMTP.
//   - On a dedup hit (inserted=false) the dispatch is NOT scheduled.
//
// Why this exists: until v2.11.x, `insertAlert` itself reached into the email
// dispatcher inside the repo module. The seam moved that hand-off into
// services/alerts so the repo stays pure persistence + in-process listeners.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../../db/schema.ts";
import { upsertEmailSettings } from "../../db/ownerEmailSettingsRepository.ts";
import { drainEmailDispatches } from "../email/alertEmailDispatcher.ts";
import { recordAndDispatchAlert } from "./alertEventService.ts";

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

  it("dispatches email exactly once when the row is freshly inserted", async () => {
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
    await drainEmailDispatches(2_000);
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
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

  it("does not dispatch email on a dedup hit (inserted=false)", async () => {
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
      severity: "info",
      title: "Dosar nou",
      detail: {},
      dedupKey: "evt-k3",
    });
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
    await drainEmailDispatches(2_000);
    expect(second.inserted).toBe(false);
    // Still 1 — the dedup hit must not trigger a second SMTP send.
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
  });
});
