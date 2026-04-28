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
import { withMaintenanceWrite } from "../../db/backup.ts";
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
  calls: { job: ScheduledJob; nowIso: string }[] = [];
  async run(input: {
    job: ScheduledJob;
    runId: number;
    nowIso: string;
    signal: AbortSignal;
  }): Promise<RunOutcome> {
    this.calls.push({ job: input.job, nowIso: input.nowIso });
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
    expect(runner.calls[0]!.job.id).toBe(jobId);
    // Runner receives the tick's nowIso (rather than calling clock.now itself)
    // so the diff/snapshot timestamps line up with the run row's started_at
    // and the next_run_at math is anchored to the same instant.
    expect(runner.calls[0]!.nowIso).toBe(T0);

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

  // 5 consecutive failures = "the source is broken, not transient flake".
  // Spec PLAN-monitoring-webmode.md L390:
  //   - emit source_error alert (severity=warning, NOT critical)
  //   - override next_run_at = now + 1h regardless of standard backoff
  //
  // We emit ONLY at the transition 4 → 5 (not on every subsequent fail) so
  // a chronically-broken source doesn't spam one alert per tick. The job's
  // fail_streak keeps growing on later fails but the alert is dedup'd.
  it("on fifth consecutive failure: emits source_error alert + 1h backoff", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
      failStreak: 4,
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
    expect(job.fail_streak).toBe(5);
    // T0 + 3600s, NOT computeNextRunAt(failStreak=5)=min(60*32,3600)=1920s.
    expect(job.next_run_at).toBe("2026-04-28T11:00:00.000Z");

    const alerts = getDb()
      .prepare(
        `SELECT kind, severity FROM monitoring_alerts WHERE job_id = ?`,
      )
      .all(jobId) as { kind: string; severity: string }[];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe("source_error");
    expect(alerts[0]!.severity).toBe("warning");
  });

  // Once the streak is past 5, no further source_error alerts should fire.
  // The job stays on the +1h cadence (3600s == standard cap) until recovery.
  it("on sixth consecutive failure: no new source_error alert", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
      failStreak: 5, // already past the threshold
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
    expect(job.fail_streak).toBe(6);
    // Standard backoff would also be 3600s here (capped) but the override is
    // the protected contract — lock it so a regression that drops the cap on
    // failStreak>=6 would still be caught.
    expect(job.next_run_at).toBe("2026-04-28T11:00:00.000Z");

    const alertCount = (
      getDb()
        .prepare(`SELECT COUNT(*) AS n FROM monitoring_alerts WHERE job_id = ?`)
        .get(jobId) as { n: number }
    ).n;
    expect(alertCount).toBe(0);
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

// stop()-race: a tick can park inside withMaintenanceRead while a writer
// (daily backup / restore) holds the lock. If stop() runs while parked, the
// reader still wakes up after the writer drains. Without a re-check, that
// reader would proceed to claimDueJobs + runOne AFTER stop() returned —
// leaking work past shutdown and racing the next process boot.
describe("Scheduler — stop() race against parked tick", () => {
  it("a tick parked behind a writer must NOT run after stop() returns", async () => {
    seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
    });
    const runner = new NoopOkRunner();
    const sch = new Scheduler({
      clock: new FakeClock(T0_DATE),
      runner,
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    await sch.start();

    // Hold the writer lock open. Tick that we fire next will park inside
    // withMaintenanceRead until releaseWriter() is called.
    let releaseWriter: (() => void) | undefined;
    const writerHeld = withMaintenanceWrite(
      () =>
        new Promise<void>((r) => {
          releaseWriter = r;
        }),
    );
    // Yield once so the writer is actually active before we queue the tick.
    await new Promise((r) => setImmediate(r));

    const tickPromise = sch.tickOnce();
    // Yield so the tick's withMaintenanceRead enqueues (writer is active).
    await new Promise((r) => setImmediate(r));

    // stop() should return promptly even with a parked tick.
    await sch.stop();

    // Now release the writer. The previously-parked reader will wake up.
    releaseWriter!();
    await writerHeld;
    await tickPromise;
    // Drain microtasks so the (now-awake) reader has every chance to
    // claim+run before we assert.
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));

    // The runner must NOT have been called — stop() returning is the
    // contract that no further runner work executes.
    expect(runner.calls.length).toBe(0);
  });
});

// C5: manual trigger. runJobNow is what the POST /jobs/:id/run route calls
// once it has resolved the job by id. Contract:
//   - if scheduler is not running → throw { code: "not_running" }
//   - if a runner is already in flight for this job → throw { code: "in_flight" }
//   - otherwise allocate a run row, kick off the runner, return { runId }
//     synchronously once insertRunning has happened (route returns 202).
describe("Scheduler — runJobNow (manual trigger)", () => {
  it("kicks off a run and returns the runId, finalizing on completion", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      // Make next_run_at in the future so the regular tick loop wouldn't
      // pick this up — we want to prove runJobNow runs it anyway.
      nextRunAt: "2026-04-29T00:00:00.000Z",
    });
    const runner = new NoopOkRunner();
    const sch = new Scheduler({
      clock: new FakeClock(T0_DATE),
      runner,
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    await sch.start();
    const job = getDb()
      .prepare(`SELECT * FROM monitoring_jobs WHERE id = ?`)
      .get(jobId) as ScheduledJob;
    const { runId } = await sch.runJobNow(job);
    await sch.stop();

    expect(runId).toBeGreaterThan(0);
    expect(runner.calls.length).toBe(1);
    expect(runner.calls[0]!.job.id).toBe(jobId);

    const run = getDb()
      .prepare(`SELECT id, status FROM monitoring_runs WHERE id = ?`)
      .get(runId) as { id: number; status: string };
    expect(run.status).toBe("ok");
  });

  it("throws { code: 'not_running' } if scheduler hasn't started", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
    });
    const sch = new Scheduler({
      clock: new FakeClock(T0_DATE),
      runner: new NoopOkRunner(),
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });
    const job = getDb()
      .prepare(`SELECT * FROM monitoring_jobs WHERE id = ?`)
      .get(jobId) as ScheduledJob;

    await expect(sch.runJobNow(job)).rejects.toMatchObject({
      code: "not_running",
    });
  });

  it("throws { code: 'in_flight' } if a runner is already running for the job", async () => {
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
    // Prime the inflight Map via the regular tick path.
    const tickPromise = sch.tickOnce();
    await new Promise((r) => setImmediate(r));

    const job = getDb()
      .prepare(`SELECT * FROM monitoring_jobs WHERE id = ?`)
      .get(jobId) as ScheduledJob;
    await expect(sch.runJobNow(job)).rejects.toMatchObject({
      code: "in_flight",
    });

    resolveRun!();
    await tickPromise;
    await sch.stop();
  });

  // C1 regression: prior to the lock split, runJobNow wrapped insertRunning
  // in withMaintenanceRead and then `void runOne(...)`'d outside the lock,
  // so a backup writer could race the runner's snapshot/alert/finalize
  // writes. After C1, runOne acquires its own withMaintenanceRead — a
  // queued backup must wait for the manual run to drain before proceeding.
  //
  // Tier 3 #11 INVERTED this contract: the scheduler no longer holds the read
  // lock during the runner body. The runner is responsible for acquiring its
  // own withMaintenanceRead around its DB persistence (dosarSoapRunner does).
  // The scheduler then takes a SECOND brief read lock for finalize +
  // applyJobOutcome. Net effect: a backup queued during a mid-SOAP run is
  // NOT pinned by upstream PortalJust latency — it can interleave during the
  // lock-free SOAP phase.
  it("manual runJobNow does NOT hold maintenance read across runner.run() (#11)", async () => {
    seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-29T00:00:00.000Z",
    });

    let resolveRun: (() => void) | undefined;
    // Mock runner with NO DB ops (so it acquires no internal read lock).
    // In production dosarSoapRunner takes withMaintenanceRead around its
    // own snapshot+alerts transaction; here we're asserting the SCHEDULER
    // layer doesn't hold the lock during runner.run().
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
    const job = getDb()
      .prepare(`SELECT * FROM monitoring_jobs WHERE id = ?`)
      .get(1) as ScheduledJob;

    // Kick off the manual run; runJobNow's brief read lock around
    // insertRunning has already released by the time it returns.
    await sch.runJobNow(job);
    // Yield so the runner is definitely parked inside its body.
    await new Promise((r) => setImmediate(r));

    // Queue a writer. With the #11 change, the scheduler holds NO read lock
    // during the runner body, so the writer should enter immediately.
    let writerEntered = false;
    const writerPromise = withMaintenanceWrite(async () => {
      writerEntered = true;
    });

    // Yield several times — the writer should drain and enter while the
    // runner is still parked. This is the #11 contract: lock-free SOAP.
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    expect(writerEntered).toBe(true);
    await writerPromise;

    // Release the runner so finalize completes; without this the runOne
    // promise leaks past the test boundary.
    resolveRun!();
    await sch.stop();
  });

  // Tier 3 #11 — the scheduler MUST still hold a read lock around the
  // finalize transaction (finalize + markJobOutcome). Backup running mid-
  // finalize would split that atomic boundary across the snapshot file.
  it("runOne holds maintenance read around the finalize transaction (#11)", async () => {
    seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-29T00:00:00.000Z",
    });

    // Hold a writer FIRST. Any reader queued behind it parks until the
    // writer drains — including the scheduler's finalize-time read lock.
    let releaseWriter: (() => void) | undefined;
    const writerHeld = withMaintenanceWrite(async () => {
      await new Promise<void>((r) => {
        releaseWriter = r;
      });
    });
    // Wait for the writer to actually be inside its critical section.
    await new Promise((r) => setImmediate(r));

    let runnerReturned = false;
    const fastRunner: JobRunner = {
      run: async () => {
        runnerReturned = true;
        return { status: "ok", alertsCreated: 0 };
      },
    };

    const sch = new Scheduler({
      clock: new FakeClock(T0_DATE),
      runner: fastRunner,
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    // Don't start() (would call recoverOrphanRuns, which acquires no lock
    // but is unnecessary noise here). Manually flip running=true via start
    // so runJobNow accepts. We also need to skip waiting on insertRunning
    // since it would be parked behind the writer too — instead, kick a
    // tickOnce path which is what production uses 99% of the time.
    await sch.start();
    // The runner.run() itself is lock-free (mock has no DB ops), so it
    // returns quickly; finalize then waits for the writer to release.
    const job = getDb()
      .prepare(`SELECT * FROM monitoring_jobs WHERE id = ?`)
      .get(1) as ScheduledJob;

    // Fire the manual run — it parks at insertRunning's read lock first
    // (which is queued behind the writer). Once the writer releases, the
    // run proceeds; runner returns immediately, then finalize tries to
    // re-acquire the read lock.
    let runJobResolved = false;
    const runPromise = sch
      .runJobNow(job)
      .then(() => { runJobResolved = true; });

    // Yield several times — runJobNow's insertRunning is queued behind
    // the writer and should NOT have resolved yet.
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    expect(runJobResolved).toBe(false);
    expect(runnerReturned).toBe(false);

    // Release the writer. Now insertRunning can acquire, runJobNow returns,
    // runner runs (no lock), finalize acquires read lock again → completes.
    releaseWriter!();
    await writerHeld;
    await runPromise;
    expect(runnerReturned).toBe(true);
    expect(runJobResolved).toBe(true);

    await sch.stop();
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

  // 'aborted' is a graceful-shutdown outcome, NOT a retry-able failure. If we
  // counted it toward fail_streak, every clean stop() would inflate the streak
  // and eventually trip the 5-fail source_error alert on perfectly healthy
  // jobs. Drain must leave job state (fail_streak, next_run_at, last_status,
  // last_run_at) untouched so the next boot picks the job up where it was.
  it("stop() drain leaves fail_streak and next_run_at unchanged", async () => {
    const ORIGINAL_NEXT_RUN = "2026-04-28T09:00:00.000Z";
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: ORIGINAL_NEXT_RUN,
      failStreak: 2,
    });

    let resolveRun: (() => void) | undefined;
    const slowRunner: JobRunner = {
      run: async (input) => {
        await new Promise<void>((r) => {
          resolveRun = r;
        });
        // Simulate the runner observing the abort and reporting 'aborted'.
        if (input.signal.aborted) {
          return { status: "aborted", errorCode: "DRAINED" };
        }
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
    await new Promise((r) => setImmediate(r));

    const stopPromise = sch.stop();
    await new Promise((r) => setImmediate(r));

    resolveRun!();
    await tickPromise;
    await stopPromise;

    const job = readJob(jobId);
    expect(job.fail_streak).toBe(2);
    expect(job.next_run_at).toBe(ORIGINAL_NEXT_RUN);
    expect(job.last_status).toBeNull();
    expect(job.last_run_at).toBeNull();
  });
});

// C4 regression: a transient throw inside tickOnce (e.g. claimDueJobs hits a
// momentarily-locked DB, clock fault, RWLock corruption) must NOT kill the
// scheduler loop. Pre-C4 the await rejection silently dropped the chained
// scheduleNextTick and monitoring went dark until process restart.
describe("Scheduler — tick error survival (C4)", () => {
  it("throw inside tickOnce does not kill the loop; next tick still fires", async () => {
    // Subclass FakeClock so the first now() throws once, then succeeds.
    // tickOnce calls clock.now() at the very top, so this propagates up
    // through `await this.tickOnce()` in the timer callback.
    class ThrowOnceClock extends FakeClock {
      private armed = true;
      now(): Date {
        if (this.armed) {
          this.armed = false;
          throw new Error("transient clock fault");
        }
        return super.now();
      }
    }

    const jobId = seedJob({
      cadenceSec: 600,
      // Past — claimDueJobs will pick it up on the SECOND (recovered) tick.
      nextRunAt: "2026-04-28T09:00:00.000Z",
    });

    const clock = new ThrowOnceClock(T0_DATE);
    const runner = new NoopOkRunner();
    const sch = new Scheduler({
      clock,
      runner,
      tickIntervalMs: 1_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    // Suppress the structured error console.error from C4's catch so test
    // output stays clean; the assertion below is what proves the catch ran.
    const origError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    try {
      await sch.start();
      // First scheduled tick fires → clock.now() throws → C4 catch logs +
      // scheduleNextTick fires the NEXT timer despite the rejection.
      await clock.advance(1_000);
      // Second scheduled tick fires → clock.now() succeeds → job runs.
      await clock.advance(1_000);
      await sch.stop();
    } finally {
      console.error = origError;
    }

    // The throw was logged exactly once (proves C4's catch was reached).
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);
    expect(String(errorCalls[0]![0])).toContain("tickOnce threw");

    // The job ran on the recovered tick — proves the loop survived.
    expect(runner.calls.length).toBe(1);
    expect(runner.calls[0]!.job.id).toBe(jobId);
    const job = readJob(jobId);
    expect(job.last_status).toBe("ok");
  });
});

// Tier 5 #T3 — runner.run() rejecting must surface as RUNNER_THREW (not crash
// the scheduler). Regression for the try/catch in runOne: a runner that throws
// a non-Error value (or a synchronous throw mid-Promise) still has to produce
// a terminal run row + advance fail_streak so the loop stays self-healing.
describe("Scheduler — runner reject becomes RUNNER_THREW (#T3)", () => {
  it("runner throws synchronously → finalize as error/RUNNER_THREW + fail_streak++", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
    });
    const throwingRunner: JobRunner = {
      run: async () => {
        throw new Error("runner kaboom");
      },
    };
    const sch = new Scheduler({
      clock: new FakeClock(T0_DATE),
      runner: throwingRunner,
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

    const run = getDb()
      .prepare(
        `SELECT status, error_code, error_message
           FROM monitoring_runs WHERE job_id = ?`,
      )
      .get(jobId) as {
        status: string;
        error_code: string;
        error_message: string;
      };
    expect(run.status).toBe("error");
    expect(run.error_code).toBe("RUNNER_THREW");
    expect(run.error_message).toContain("runner kaboom");
  });

  it("runner throws non-Error value → error_message stringified", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
    });
    const oddRunner: JobRunner = {
      // Reject with a non-Error so the `instanceof Error` branch falls through
      // to String(err). Real-world: a third-party SDK rejecting with a plain
      // object {code, message} or a number.
      run: async () => {
        throw { weird: true, code: 42 };
      },
    };
    const sch = new Scheduler({
      clock: new FakeClock(T0_DATE),
      runner: oddRunner,
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    await sch.start();
    await sch.tickOnce();
    await sch.stop();

    const run = getDb()
      .prepare(
        `SELECT status, error_code, error_message
           FROM monitoring_runs WHERE job_id = ?`,
      )
      .get(jobId) as {
        status: string;
        error_code: string;
        error_message: string;
      };
    expect(run.status).toBe("error");
    expect(run.error_code).toBe("RUNNER_THREW");
    expect(typeof run.error_message).toBe("string");
    expect(run.error_message.length).toBeGreaterThan(0);
  });
});

// Tier 5 #T4 — lease semantics: claimDueJobs is the only thing keeping two
// concurrent ticks from running the same job twice. The lease is the row in
// monitoring_runs with status='running'; tick #2 must NOT pick the job up
// while tick #1 is still inflight, even if next_run_at is past.
describe("Scheduler — concurrent tick lease semantics (#T4)", () => {
  it("two overlapping ticks don't double-run the same job", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
    });

    // Park the runner so tick #1 stays in-flight while tick #2 runs.
    let resolveRun: (() => void) | undefined;
    const calls: number[] = [];
    const slowRunner: JobRunner = {
      run: async (input) => {
        calls.push(input.job.id);
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
    const tick1 = sch.tickOnce();
    // Yield so tick1 has time to claim + enter runner.run before tick2 starts.
    await new Promise((r) => setImmediate(r));

    // tick #2 starts while tick #1's runner is parked. claimDueJobs must
    // exclude this job because its monitoring_runs row is still 'running'.
    await sch.tickOnce();

    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(jobId);

    resolveRun!();
    await tick1;
    await sch.stop();

    // After both ticks complete, exactly one terminal run + the job advanced
    // its schedule once.
    const runs = getDb()
      .prepare(
        `SELECT status FROM monitoring_runs WHERE job_id = ? ORDER BY id`,
      )
      .all(jobId) as { status: string }[];
    expect(runs.length).toBe(1);
    expect(runs[0]!.status).toBe("ok");

    const job = readJob(jobId);
    expect(job.last_status).toBe("ok");
  });
});

// Tier 5 #T5 — source_error recovery cycle: after the 5-fail trip + alert,
// a single success must reset fail_streak to 0. The next failing streak
// should be free to re-trip and emit a fresh source_error alert (anchored
// to the new runId, so dedup_key doesn't suppress it).
describe("Scheduler — source_error recovery cycle (#T5)", () => {
  it("ok run resets fail_streak; next 5-fail streak emits a fresh alert", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
      failStreak: 4,
    });

    // First scheduler instance: fail #5 trips the alert, +1h backoff applied.
    {
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
    }

    let job = readJob(jobId);
    expect(job.fail_streak).toBe(5);
    let alerts = getDb()
      .prepare(`SELECT id FROM monitoring_alerts WHERE job_id = ?`)
      .all(jobId) as { id: number }[];
    expect(alerts.length).toBe(1);

    // Move the clock past +1h and align next_run_at so the second scheduler
    // can reclaim. Then run a successful tick to reset the streak.
    const T_RECOVERY = "2026-04-28T11:30:00.000Z";
    getDb()
      .prepare(`UPDATE monitoring_jobs SET next_run_at = ? WHERE id = ?`)
      .run(T_RECOVERY, jobId);

    {
      const sch = new Scheduler({
        clock: new FakeClock(new Date(T_RECOVERY)),
        runner: new NoopOkRunner(),
        tickIntervalMs: 60_000,
        claimLimit: 10,
        jitterSecMax: 0,
      });
      await sch.start();
      await sch.tickOnce();
      await sch.stop();
    }

    job = readJob(jobId);
    expect(job.fail_streak).toBe(0);
    expect(job.last_status).toBe("ok");

    // Now drive the job into a fresh failing streak: 4 errors, then on the
    // 5th the alert must fire AGAIN (different runId → different dedup_key).
    let nextDue = job.next_run_at;
    for (let i = 0; i < 4; i++) {
      const t = new Date(new Date(nextDue).getTime() + 60_000).toISOString();
      const sch = new Scheduler({
        clock: new FakeClock(new Date(t)),
        runner: new NoopErrorRunner(),
        tickIntervalMs: 60_000,
        claimLimit: 10,
        jitterSecMax: 0,
      });
      await sch.start();
      await sch.tickOnce();
      await sch.stop();
      nextDue = readJob(jobId).next_run_at;
    }
    expect(readJob(jobId).fail_streak).toBe(4);

    // 5th fresh failure → second source_error alert.
    const t5 = new Date(new Date(nextDue).getTime() + 60_000).toISOString();
    const sch = new Scheduler({
      clock: new FakeClock(new Date(t5)),
      runner: new NoopErrorRunner(),
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });
    await sch.start();
    await sch.tickOnce();
    await sch.stop();

    alerts = getDb()
      .prepare(`SELECT id FROM monitoring_alerts WHERE job_id = ?`)
      .all(jobId) as { id: number }[];
    expect(alerts.length).toBe(2);
  });
});

// Tier 5 #T7 — boot ordering: recoverOrphanRuns MUST run before the first
// tick. If tick #1 sees a stale `running` row from a prior crash, claimDueJobs
// excludes the legitimately-due job from the cohort and the job stays dark
// until the row times out (which never happens — there's no timeout). Recover
// flips orphan rows to 'aborted' so the cohort is clean for tick #1.
describe("Scheduler — recoverOrphanRuns runs before tick #1 (#T7)", () => {
  it("orphan running row from prior crash → first tick still claims the job", async () => {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2026-04-28T09:00:00.000Z",
    });
    // Simulate prior-process crash: a `running` row with no terminal status.
    getDb()
      .prepare(
        `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
         VALUES (?, ?, '2026-04-28T08:30:00.000Z', 'running')`,
      )
      .run(OWNER, jobId);

    const runner = new NoopOkRunner();
    const sch = new Scheduler({
      clock: new FakeClock(T0_DATE),
      runner,
      tickIntervalMs: 60_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    await sch.start();
    await sch.tickOnce();
    await sch.stop();

    // Orphan row is now aborted with CRASH_RECOVERY signal (Tier 4 #20).
    const allRuns = getDb()
      .prepare(
        `SELECT status, error_code FROM monitoring_runs
           WHERE job_id = ? ORDER BY id`,
      )
      .all(jobId) as { status: string; error_code: string | null }[];
    expect(allRuns.length).toBe(2);
    expect(allRuns[0]!.status).toBe("aborted");
    expect(allRuns[0]!.error_code).toBe("CRASH_RECOVERY");
    // Tick #1 produced a fresh ok run — proves recover ran first AND the
    // claim wasn't blocked by the leftover lease.
    expect(allRuns[1]!.status).toBe("ok");
    expect(runner.calls.length).toBe(1);
  });
});

// Tier 6 #34 — monitoring_runs is diagnostic history, not permanent business
// data. The scheduler owns the daily retention timer and must clear it on
// stop() so shutdown does not leave background work queued.
describe("Scheduler — daily monitoring_runs retention purge (#34)", () => {
  function seedTerminalRun(startedAt: string): number {
    const jobId = seedJob({
      cadenceSec: 600,
      nextRunAt: "2099-01-01T00:00:00.000Z",
      hashSeed: `purge-${startedAt}`,
    });
    const info = getDb()
      .prepare(
        `INSERT INTO monitoring_runs
           (owner_id, job_id, started_at, ended_at, status, duration_ms)
         VALUES (?, ?, ?, ?, 'ok', 100)`,
      )
      .run(OWNER, jobId, startedAt, startedAt);
    return info.lastInsertRowid as number;
  }

  it("purges runs older than 90 days when the daily timer fires", async () => {
    const oldRun = seedTerminalRun(new Date(Date.now() - 91 * 86_400_000).toISOString());
    const freshRun = seedTerminalRun(new Date(Date.now() - 89 * 86_400_000).toISOString());
    const clock = new FakeClock(T0_DATE);
    const sch = new Scheduler({
      clock,
      runner: new NoopOkRunner(),
      tickIntervalMs: 2 * 86_400_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    await sch.start();
    await clock.advance(86_400_000);
    await sch.stop();

    const rows = getDb()
      .prepare(`SELECT id FROM monitoring_runs ORDER BY id`)
      .all() as { id: number }[];
    expect(rows.map((r) => r.id)).toEqual([freshRun]);
    expect(rows.find((r) => r.id === oldRun)).toBeUndefined();
  });

  it("cancels the daily purge timer on stop()", async () => {
    const oldRun = seedTerminalRun(new Date(Date.now() - 91 * 86_400_000).toISOString());
    const clock = new FakeClock(T0_DATE);
    const sch = new Scheduler({
      clock,
      runner: new NoopOkRunner(),
      tickIntervalMs: 2 * 86_400_000,
      claimLimit: 10,
      jitterSecMax: 0,
    });

    await sch.start();
    await sch.stop();
    await clock.advance(86_400_000);

    const rows = getDb()
      .prepare(`SELECT id FROM monitoring_runs ORDER BY id`)
      .all() as { id: number }[];
    expect(rows.map((r) => r.id)).toEqual([oldRun]);
  });
});

// Tier 5 #T2 — lock-hold-duration: the per-run maintenance read lock is now
// scoped to the finalize transaction only (Tier 3 #11). A queued backup
// writer must NOT wait on the runner's wallclock — only on the brief DB
// commit. We assert the lock is RELEASED while runner.run is parked.
describe("Scheduler — finalize lock window only (#T2)", () => {
  it("runner.run() does NOT hold the maintenance read lock", async () => {
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

    // Yield once so tick claims the job and enters runner.run (which parks).
    await new Promise((r) => setImmediate(r));

    // While the runner is parked, a writer should be able to acquire the
    // maintenance lock without waiting. Pre-#11 this would deadlock until
    // resolveRun() fired. Use a short timeout race to prove fast acquisition.
    let writerEntered = false;
    const writerPromise = withMaintenanceWrite(async () => {
      writerEntered = true;
    });
    // Give the writer a few microtask hops; if the lock were held it would
    // not enter at all.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await writerPromise;
    expect(writerEntered).toBe(true);

    resolveRun!();
    await tickPromise;
    await sch.stop();
  });
});
