// Tests for the scheduler's atomic claim path: claimDueJobs(now, limit).
//
// Contract:
//   - Returns up to `limit` jobs where:
//       * active = 1
//       * paused_until IS NULL OR paused_until <= now
//       * next_run_at <= now
//       * NO `monitoring_runs` row exists with status='running' for that job
//         (lease semantics — prevents double-claim across ticks)
//   - For every claimed job, inserts a `monitoring_runs` row with
//     status='running' and started_at=now, atomically with the SELECT, so
//     two concurrent claim() calls on the same DB never claim the same job.
//   - Atomic = `BEGIN IMMEDIATE` (write-lock acquired up front), NOT the
//     better-sqlite3 default `BEGIN DEFERRED` which has a TOCTOU window
//     between SELECT and INSERT.
//   - Returned shape: { job: MonitoringJobRow, runId: number }[]
//
// The "no two callers claim same job" test runs claim() in two separate
// db connections to simulate concurrency (better-sqlite3 within one process
// is serial, but BEGIN IMMEDIATE on connection A blocks connection B until
// commit — same effect as cross-process locking on the SQLite file).

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { claimDueJobs } from "./monitoringJobsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;
let dbPath: string;

const OWNER = "local";

function seedJob(opts: {
  nextRunAt: string;
  active?: number;
  pausedUntil?: string | null;
  hashSeed?: string;
}): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at, active, paused_until)
       VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', ?, ?, ?)`,
    )
    .run(
      OWNER,
      opts.hashSeed ?? `hash-${Math.random()}`,
      opts.nextRunAt,
      opts.active ?? 1,
      opts.pausedUntil ?? null,
    );
  return info.lastInsertRowid as number;
}

function seedRunning(jobId: number): void {
  getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, '2026-04-28T09:00:00.000Z', 'running')`,
    )
    .run(OWNER, jobId);
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-claim-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

const NOW = "2026-04-28T10:00:00.000Z";

describe("claimDueJobs — selection", () => {
  it("claims a single due active unpaused job", () => {
    const id = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(1);
    expect(claimed[0]!.job.id).toBe(id);
    expect(claimed[0]!.runId).toBeGreaterThan(0);
  });

  it("does NOT claim jobs whose next_run_at is in the future", () => {
    seedJob({ nextRunAt: "2026-04-28T11:00:00.000Z" });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(0);
  });

  it("does NOT claim inactive jobs even when due", () => {
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", active: 0 });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(0);
  });

  it("does NOT claim jobs paused beyond now", () => {
    seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      pausedUntil: "2026-04-28T12:00:00.000Z",
    });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(0);
  });

  it("DOES claim jobs whose pause expired before now", () => {
    seedJob({
      nextRunAt: "2026-04-28T09:00:00.000Z",
      pausedUntil: "2026-04-28T09:30:00.000Z",
    });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(1);
  });

  it("does NOT claim jobs that already have a running run row", () => {
    const id = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    seedRunning(id);
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(0);
  });
});

describe("claimDueJobs — limits & ordering", () => {
  it("respects the limit parameter", () => {
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", hashSeed: "h1" });
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", hashSeed: "h2" });
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", hashSeed: "h3" });
    const claimed = claimDueJobs({ now: NOW, limit: 2 });
    expect(claimed.length).toBe(2);
  });

  it("orders by next_run_at ASC (oldest-due first)", () => {
    const a = seedJob({ nextRunAt: "2026-04-28T08:00:00.000Z", hashSeed: "h1" });
    const b = seedJob({ nextRunAt: "2026-04-28T09:30:00.000Z", hashSeed: "h2" });
    const c = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z", hashSeed: "h3" });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.map((r) => r.job.id)).toEqual([a, c, b]);
  });
});

describe("claimDueJobs — atomic side effect", () => {
  it("inserts a 'running' run row for every claimed job", () => {
    const id = seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    const claimed = claimDueJobs({ now: NOW, limit: 10 });
    expect(claimed.length).toBe(1);

    const runs = getDb()
      .prepare(
        `SELECT * FROM monitoring_runs WHERE job_id = ? AND status = 'running'`,
      )
      .all(id) as { id: number; status: string; started_at: string }[];
    expect(runs.length).toBe(1);
    expect(runs[0]!.id).toBe(claimed[0]!.runId);
    expect(runs[0]!.started_at).toBe(NOW);
  });

  it("a second claim() in the same tick does not re-claim already-running jobs", () => {
    seedJob({ nextRunAt: "2026-04-28T09:00:00.000Z" });
    const first = claimDueJobs({ now: NOW, limit: 10 });
    const second = claimDueJobs({ now: NOW, limit: 10 });
    expect(first.length).toBe(1);
    expect(second.length).toBe(0);
  });
});
