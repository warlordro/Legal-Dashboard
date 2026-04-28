// Scheduler tests — drives the full tick lifecycle through FakeClock + a
// NoopJobRunner so the integration is verified without SOAP I/O.
//
// What's covered here:
//   - On start(): recoverOrphanRuns runs first (orphan running rows → aborted)
//   - tick() claims due jobs, calls runner, finalizes runs, recomputes next_run_at
//   - Success path: last_status='ok', fail_streak=0, next_run_at += cadence
//   - Error path:   last_status='error', fail_streak++, next_run_at += backoff
//   - stop() drains in-flight runners and cancels their AbortControllers
//   - getInflightAbortController() lets routes cancel a specific in-flight job
//
// SOAP-specific behavior (timeout/wallclock budget) lives in C3 once the
// real runner ships; C2 ships only the orchestration shell.

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../../db/schema.ts";
import { FakeClock } from "./clock.ts";
import {
  Scheduler,
  type JobRunner,
  type RunOutcome,
  type ScheduledJob,
} from "./scheduler.ts";

let tmpRoot: string;

const OWNER = "local";

function seedJob(opts: {
  cadenceSec?: number;
  nextRunAt: string;
  failStreak?: number;
  hashSeed?: string;
}): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at, fail_streak)
       VALUES (?, 'dosar_soap', '{}', ?, ?, '{}', ?, ?)`,
    )
    .run(
      OWNER,
      opts.hashSeed ?? `hash-${Math.random()}`,
      opts.cadenceSec ?? 14400,
      opts.nextRunAt,
      opts.failStreak ?? 0,
    );
  return info.lastInsertRowid as number;
}

function readJob(id: number) {
  return getDb()
    .prepare(`SELECT * FROM monitoring_jobs WHERE id = ?`)
    .get(id) as {
      id: number;
      next_run_at: string;
      last_status: string | null;
      fail_streak: number;
      last_run_at: string | null;
    };
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-sched-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

class NoopOkRunner implements JobRunner {
  calls: ScheduledJob[] = [];
  async run(input: { job: ScheduledJob; runId: number; signal: AbortSignal }): Promise<RunOutcome> {
    this.calls.push(input.job);
    return { status: "ok", alertsCreated: 0 };
  }
}

class NoopErrorRunner implements JobRunner {
  async run(): Promise<RunOutcome> {
    return {
      status: "error",
      errorCode: "TEST_FAIL",
      errorMessage: "synthetic failure",
    };
  }
}

const T0 = "2026-04-28T10:00:00.000Z";
const T0_DATE = new Date(T0);

describe("Scheduler — crash recovery", () => {
  it("flips orphan running runs to aborted on start()", async () => {
    const jobId = seedJob({ nextRunAt: "2026-04-28T11:00:00.000Z" });
    // Simulate a leftover from a previous process.
    getDb()
      .prepare(
        `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
         VALUES (?, ?, '2026-04-28T09:00:00.000Z', 'running')`,
      )
      .run(OWNER, jobId);

    const sch = new Scheduler({
      clock: new FakeClock(T0_DATE),
      runner: new NoopOkRunner(),
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });
    await sch.start();
    await sch.stop();

    const orphan = getDb()
      .prepare(`SELECT status FROM monitoring_runs WHERE job_id = ?`)
      .get(jobId) as { status: string };
    expect(orphan.status).toBe("aborted");
  });
});

describe("Scheduler — tick success path", () => {
  it("claims a due job, runs it, finalizes ok, advances next_run_at by cadence", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
    });
    const clock = new FakeClock(T0_DATE);
    const runner = new NoopOkRunner();
    const sch = new Scheduler({
      clock,
      runner,
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    await sch.start();
    await sch.tickOnce();
    await sch.stop();

    expect(runner.calls.length).toBe(1);
    expect(runner.calls[0]!.id).toBe(jobId);

    const job = readJob(jobId);
    expect(job.last_status).toBe("ok");
    expect(job.fail_streak).toBe(0);
    expect(job.last_run_at).toBe(T0);
    expect(job.next_run_at).toBe("2026-04-28T10:10:00.000Z"); // T0 + 600s

    const run = getDb()
      .prepare(
        `SELECT status, ended_at, duration_ms FROM monitoring_runs WHERE job_id = ?`,
      )
      .get(jobId) as { status: string; ended_at: string; duration_ms: number };
    expect(run.status).toBe("ok");
    expect(run.ended_at).toBe(T0);
  });
});

describe("Scheduler — tick error path", () => {
  it("on first failure: last_status='error', fail_streak=1, next_run_at=now+120s", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
    });
    const clock = new FakeClock(T0_DATE);
    const sch = new Scheduler({
      clock,
      runner: new NoopErrorRunner(),
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    await sch.start();
    await sch.tickOnce();
    await sch.stop();

    const job = readJob(jobId);
    expect(job.last_status).toBe("error");
    expect(job.fail_streak).toBe(1);
    expect(job.next_run_at).toBe("2026-04-28T10:02:00.000Z"); // T0 + 120s
  });

  it("on third failure: fail_streak=3, next_run_at=now+480s", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
      failStreak: 2, // already failed twice
    });
    const sch = new Scheduler({
      clock: new FakeClock(T0_DATE),
      runner: new NoopErrorRunner(),
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    await sch.start();
    await sch.tickOnce();
    await sch.stop();

    const job = readJob(jobId);
    expect(job.fail_streak).toBe(3);
    expect(job.next_run_at).toBe("2026-04-28T10:08:00.000Z"); // T0 + 480s
  });
});

describe("Scheduler — getInflightAbortController", () => {
  it("returns the live AbortController during a runner call", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
    });

    let resolveRun: (() => void) | undefined;
    const slowRunner: JobRunner = {
      run: async () => {
        await new Promise<void>((r) => {
          resolveRun = r;
        });
        return { status: "ok", alertsCreated: 0 };
      },
    };

    const sch = new Scheduler({
      clock: new FakeClock(T0_DATE),
      runner: slowRunner,
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    await sch.start();
    const tickPromise = sch.tickOnce();
    // give the runner a chance to start
    await new Promise((r) => setImmediate(r));

    const controller = sch.getInflightAbortController(jobId);
    expect(controller).toBeDefined();
    expect(controller!.signal.aborted).toBe(false);

    resolveRun!();
    await tickPromise;
    await sch.stop();

    // After completion, controller is cleared.
    expect(sch.getInflightAbortController(jobId)).toBeUndefined();
  });
});

describe("Scheduler — stop() drain", () => {
  it("aborts in-flight runners and waits for them to finalize", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
    });

    let sawAbort = false;
    let resolveRun: (() => void) | undefined;
    const slowRunner: JobRunner = {
      run: async (input) => {
        input.signal.addEventListener("abort", () => {
          sawAbort = true;
        });
        await new Promise<void>((r) => {
          resolveRun = r;
        });
        return { status: "aborted", errorCode: "DRAINED" };
      },
    };

    const sch = new Scheduler({
      clock: new FakeClock(T0_DATE),
      runner: slowRunner,
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    await sch.start();
    const tickPromise = sch.tickOnce();
    await new Promise((r) => setImmediate(r));

    const stopPromise = sch.stop();
    // stop() triggers abort on the in-flight runner immediately
    await new Promise((r) => setImmediate(r));
    expect(sawAbort).toBe(true);

    resolveRun!();
    await tickPromise;
    await stopPromise;

    const run = getDb()
      .prepare(
        `SELECT status FROM monitoring_runs WHERE job_id = ? AND status != 'running'`,
      )
      .get(jobId) as { status: string };
    expect(run.status).toBe("aborted");
  });
});
