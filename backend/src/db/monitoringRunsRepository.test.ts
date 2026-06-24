// monitoringRunsRepository — per-run audit rows for the scheduler.
//
// The scheduler creates a `running` row at tick start, then transitions it to
// a terminal status (ok/error/timeout/aborted) at end. On boot, the scheduler
// blanket-marks any leftover `running` rows from a previous process as
// `aborted` so a crashed run can't hold a pseudo-lease forever.
//
// Tests below pin those three operations and the owner-scoping discipline
// shared with the rest of the repos. Pure SQLite; no scheduler glue here.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  insertRunning,
  finalize,
  purgeOldRuns,
  recoverOrphanRuns,
  type MonitoringRunRow,
} from "./monitoringRunsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;
let dbPath: string;

const OWNER = "local";
const NOW = "2026-04-28T10:00:00.000Z";

function seedJob(): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at)
       VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', ?)`
    )
    .run(OWNER, `hash-${Math.random()}`, NOW);
  return info.lastInsertRowid as number;
}

function seedTerminalRuns(jobId: number, count: number, startedAt: string): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO monitoring_runs
       (owner_id, job_id, started_at, ended_at, status, duration_ms)
     VALUES (?, ?, ?, ?, 'ok', 100)`
  );
  const run = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      insert.run(OWNER, jobId, startedAt, startedAt);
    }
  });
  run();
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-runs-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("insertRunning", () => {
  it("inserts a row with status='running' and returns its id", () => {
    const jobId = seedJob();
    const runId = insertRunning({ ownerId: OWNER, jobId, startedAt: NOW });
    expect(runId).toBeGreaterThan(0);

    const row = getDb().prepare("SELECT * FROM monitoring_runs WHERE id = ?").get(runId) as MonitoringRunRow;
    expect(row.status).toBe("running");
    expect(row.owner_id).toBe(OWNER);
    expect(row.job_id).toBe(jobId);
    expect(row.started_at).toBe(NOW);
    expect(row.ended_at).toBeNull();
    expect(row.duration_ms).toBeNull();
  });

  // Constatare adversiala #2 — tenant-isolation guard simetric cu insertAlert.
  // Fara guard, un caller care primeste un job_id al altui tenant ar putea
  // atasa un run row in numele lui, contaminand query-urile owner-scoped pe
  // runs (audit, purgeOldRuns by owner, viitor UI alerts run filter).
  it("refuses to insert when (jobId, ownerId) belong to different tenants", () => {
    const ownerA = "tenant-a";
    const ownerB = "tenant-b";
    const jobIdA = getDb()
      .prepare(
        `INSERT INTO monitoring_jobs
           (owner_id, kind, target_json, target_hash, cadence_sec,
            alert_config_json, next_run_at)
         VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', ?)`
      )
      .run(ownerA, "hA", NOW).lastInsertRowid as number;

    expect(() =>
      insertRunning({
        ownerId: ownerB, // wrong owner for jobIdA
        jobId: jobIdA,
        startedAt: NOW,
      })
    ).toThrow(/not found for owner/);

    const count = (getDb().prepare("SELECT COUNT(*) AS n FROM monitoring_runs").get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it("refuses to insert when jobId does not exist at all", () => {
    expect(() =>
      insertRunning({
        ownerId: OWNER,
        jobId: 99999,
        startedAt: NOW,
      })
    ).toThrow(/not found for owner/);
  });
});

describe("finalize", () => {
  it("transitions running → ok with duration & alerts_created", () => {
    const jobId = seedJob();
    const runId = insertRunning({ ownerId: OWNER, jobId, startedAt: NOW });

    const ok = finalize(runId, {
      status: "ok",
      endedAt: "2026-04-28T10:00:05.000Z",
      durationMs: 5000,
      alertsCreated: 2,
    });
    expect(ok).toBe(true);

    const row = getDb().prepare("SELECT * FROM monitoring_runs WHERE id = ?").get(runId) as MonitoringRunRow;
    expect(row.status).toBe("ok");
    expect(row.ended_at).toBe("2026-04-28T10:00:05.000Z");
    expect(row.duration_ms).toBe(5000);
    expect(row.alerts_created).toBe(2);
    expect(row.alerts_patched).toBe(0);
    expect(row.error_code).toBeNull();
    expect(row.error_message).toBeNull();
  });

  // F10 audit hardening: alerts_patched tracks enrichment patches applied to
  // existing alerts (e.g. solutie_aparuta backfill). Tracked separately from
  // alerts_created so an enrichment-only tick is observable, not invisible.
  it("persists alerts_patched independently from alerts_created (F10)", () => {
    const jobId = seedJob();
    const runId = insertRunning({ ownerId: OWNER, jobId, startedAt: NOW });

    const ok = finalize(runId, {
      status: "ok",
      endedAt: "2026-04-28T10:00:05.000Z",
      durationMs: 5000,
      alertsCreated: 0,
      alertsPatched: 3,
    });
    expect(ok).toBe(true);

    const row = getDb().prepare("SELECT * FROM monitoring_runs WHERE id = ?").get(runId) as MonitoringRunRow;
    expect(row.alerts_created).toBe(0);
    expect(row.alerts_patched).toBe(3);
  });

  it("transitions running → error with error_code/error_message", () => {
    const jobId = seedJob();
    const runId = insertRunning({ ownerId: OWNER, jobId, startedAt: NOW });

    finalize(runId, {
      status: "error",
      endedAt: "2026-04-28T10:00:02.000Z",
      durationMs: 2000,
      errorCode: "SOAP_TIMEOUT",
      errorMessage: "PortalJust did not respond within 45s",
      httpStatus: 504,
    });

    const row = getDb().prepare("SELECT * FROM monitoring_runs WHERE id = ?").get(runId) as MonitoringRunRow;
    expect(row.status).toBe("error");
    expect(row.error_code).toBe("SOAP_TIMEOUT");
    expect(row.error_message).toBe("PortalJust did not respond within 45s");
    expect(row.http_status).toBe(504);
  });

  it("transitions running → timeout", () => {
    const jobId = seedJob();
    const runId = insertRunning({ ownerId: OWNER, jobId, startedAt: NOW });

    finalize(runId, {
      status: "timeout",
      endedAt: "2026-04-28T10:10:00.000Z",
      durationMs: 600_000,
    });

    const row = getDb().prepare("SELECT status FROM monitoring_runs WHERE id = ?").get(runId) as { status: string };
    expect(row.status).toBe("timeout");
  });

  it("returns false when finalize is called on non-existent run", () => {
    const ok = finalize(999_999, {
      status: "ok",
      endedAt: NOW,
      durationMs: 0,
    });
    expect(ok).toBe(false);
  });

  it("rejects invalid status values via CHECK constraint", () => {
    const jobId = seedJob();
    const runId = insertRunning({ ownerId: OWNER, jobId, startedAt: NOW });

    expect(() =>
      finalize(runId, {
        // @ts-expect-error — testing CHECK constraint enforcement
        status: "bogus",
        endedAt: NOW,
        durationMs: 0,
      })
    ).toThrow();
  });
});

describe("recoverOrphanRuns", () => {
  it("flips orphaned running rows to aborted and returns the count", () => {
    const jobA = seedJob();
    const jobB = seedJob();

    // r3 este deja terminal — recovery NU trebuie sa-l atinga. Il inseram
    // PRIMUL si-l finalizam astfel incat indexul partial unic
    // idx_one_running_per_job sa permita ulterior un nou running pe jobA.
    const r3 = insertRunning({ ownerId: OWNER, jobId: jobA, startedAt: NOW });
    finalize(r3, { status: "ok", endedAt: NOW, durationMs: 100 });
    const r1 = insertRunning({ ownerId: OWNER, jobId: jobA, startedAt: NOW });
    const r2 = insertRunning({ ownerId: OWNER, jobId: jobB, startedAt: NOW });

    const recovered = recoverOrphanRuns();
    expect(recovered).toBe(2);

    const rows = getDb()
      .prepare("SELECT id, status, ended_at FROM monitoring_runs WHERE id IN (?, ?, ?) ORDER BY id")
      .all(r1, r2, r3) as { id: number; status: string; ended_at: string | null }[];

    expect(rows.find((r) => r.id === r1)?.status).toBe("aborted");
    expect(rows.find((r) => r.id === r1)?.ended_at).not.toBeNull();
    expect(rows.find((r) => r.id === r2)?.status).toBe("aborted");
    expect(rows.find((r) => r.id === r3)?.status).toBe("ok");
  });

  it("returns 0 when no running rows exist", () => {
    expect(recoverOrphanRuns()).toBe(0);
  });
});

describe("purgeOldRuns", () => {
  it("deletes only runs older than the retention window", () => {
    const jobId = seedJob();
    const oldStartedAt = new Date(Date.now() - 91 * 86_400_000).toISOString();
    const freshStartedAt = new Date(Date.now() - 89 * 86_400_000).toISOString();

    // idx_one_running_per_job permite un singur run `running` per job_id, deci
    // finalizam fiecare run inainte de a-l insera pe urmatorul.
    const oldRun = insertRunning({ ownerId: OWNER, jobId, startedAt: oldStartedAt });
    finalize(oldRun, { status: "ok", endedAt: oldStartedAt, durationMs: 100 });
    const freshRun = insertRunning({ ownerId: OWNER, jobId, startedAt: freshStartedAt });
    finalize(freshRun, { status: "ok", endedAt: freshStartedAt, durationMs: 100 });

    const deleted = purgeOldRuns(90);
    expect(deleted).toBe(1);

    const rows = getDb().prepare("SELECT id FROM monitoring_runs ORDER BY id").all() as { id: number }[];
    expect(rows.map((r) => r.id)).toEqual([freshRun]);
  });

  it("deletes old runs in chunks and leaves fresh rows intact", () => {
    const jobId = seedJob();
    const oldStartedAt = new Date(Date.now() - 91 * 86_400_000).toISOString();
    const freshStartedAt = new Date(Date.now() - 1 * 86_400_000).toISOString();
    seedTerminalRuns(jobId, 2500, oldStartedAt);
    seedTerminalRuns(jobId, 100, freshStartedAt);

    const deleted = purgeOldRuns(90, 500);
    expect(deleted).toBe(2500);

    const remaining = (getDb().prepare("SELECT COUNT(*) AS n FROM monitoring_runs").get() as { n: number }).n;
    expect(remaining).toBe(100);
  });

  it("returns 0 without crashing when the table is empty", () => {
    expect(purgeOldRuns(0, 500)).toBe(0);
  });

  it.skipIf(process.env.RUN_SLOW_PURGE_TESTS !== "1")("stops at the 1M safety cap", () => {
    const jobId = seedJob();
    const oldStartedAt = new Date(Date.now() - 91 * 86_400_000).toISOString();
    seedTerminalRuns(jobId, 1_000_001, oldStartedAt);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const deleted = purgeOldRuns(90, 100_000);

    expect(deleted).toBe(1_000_000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("safety cap 1M"));
  });
});
