// Monitoring scheduler — orchestration shell over claimDueJobs / runner /
// finalize / next_run_at recompute. The runner itself is injected (DI) so:
//   - tests can supply NoopRunners and assert orchestration deterministically
//   - C3 swaps in the SOAP runner without touching this file
//   - C5's manual /run route reuses the same runner via the scheduler instance
//
// State the scheduler owns:
//   - Per-tick claim → runner → finalize → reschedule loop
//   - Per-job AbortController map (singleton scope, so the manual /run route
//     can cancel a specific in-flight job)
//   - tick re-entrancy guard (a long tick won't get clobbered by the next
//     tick's setTimeout firing)
//   - graceful drain on stop() — aborts every in-flight controller and
//     awaits the existing run promises before resolving
//
// Wallclock budget per run (10min) and SOAP signal composition land in C3.

import { computeNextRunAt } from "./backoff.ts";
import type { Clock, TimerHandle } from "./clock.ts";
import {
  claimDueJobs,
  markJobOutcome,
  type MonitoringJobRow,
} from "../../db/monitoringJobsRepository.ts";
import {
  finalize,
  insertRunning,
  recoverOrphanRuns,
  type TerminalRunStatus,
} from "../../db/monitoringRunsRepository.ts";
import { insertAlert } from "../../db/monitoringAlertsRepository.ts";
import { withMaintenanceRead } from "../../db/backup.ts";
import { getDb } from "../../db/schema.ts";

// 5 consecutive failures = the source is broken, not flaky. Spec
// PLAN-monitoring-webmode.md L390: emit one source_error alert and slow the
// job to once-per-hour to spare upstream and ourselves.
const SOURCE_ERROR_THRESHOLD = 5;
const SOURCE_ERROR_BACKOFF_SEC = 3600;

export type ScheduledJob = MonitoringJobRow;

export interface RunOutcome {
  status: TerminalRunStatus;
  alertsCreated?: number;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface JobRunner {
  run(input: {
    job: ScheduledJob;
    runId: number;
    // ISO timestamp captured by the scheduler at claim time. Runners must
    // use this (not their own Date.now()) when persisting snapshots / dedup
    // keys / alert payload timestamps so the diff math, run row timestamps,
    // and next_run_at recompute all anchor to the same instant.
    nowIso: string;
    signal: AbortSignal;
  }): Promise<RunOutcome>;
}

export interface SchedulerOptions {
  clock: Clock;
  runner: JobRunner;
  tickIntervalMs: number;
  claimLimit: number;
  // Max steady-state jitter in seconds; 0 disables for tests.
  jitterSecMax: number;
}

interface InflightEntry {
  controller: AbortController;
  promise: Promise<void>;
}

export class Scheduler {
  private readonly opts: SchedulerOptions;
  private running = false;
  private tickInProgress = false;
  private timerHandle: TimerHandle | undefined;
  private readonly inflight = new Map<number, InflightEntry>();

  constructor(opts: SchedulerOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    if (this.running) return;
    // Crash recovery FIRST — orphan running rows would otherwise be excluded
    // from claimDueJobs forever. See monitoringRunsRepository.recoverOrphanRuns.
    // NOTE: not wrapped in withMaintenanceRead because start() runs once at
    // boot, before the listen handler that ever fires the daily backup; a
    // restore at this exact instant is also implausible (UI route is mounted
    // later). If web-mode reorders boot so this becomes possible, wrap it.
    recoverOrphanRuns();
    this.running = true;
    // First tick fires after one interval; callers can also invoke tickOnce()
    // explicitly (tests do).
    this.scheduleNextTick();
  }

  // Single tick — claim, run, finalize. Public for test ergonomics; production
  // path goes through scheduleNextTick → setTimeout → tick().
  //
  // The lock split (C1 hardening): the brief outer read lock covers only the
  // claim step (sub-millisecond DB write that flips next_run_at); each runOne
  // then acquires its OWN read lock for its run body. This means a queued
  // backup waits at most for the *longest in-flight run*, not the entire
  // cohort (Top-8 #7). It also closes the runJobNow void-runOne lock leak —
  // every run, manual or scheduled, executes inside a maintenance read.
  async tickOnce(): Promise<void> {
    if (!this.running) return;
    if (this.tickInProgress) return;
    this.tickInProgress = true;
    try {
      const now = this.opts.clock.now().toISOString();
      let claimed: ReturnType<typeof claimDueJobs> = [];
      await withMaintenanceRead(async () => {
        // Re-check after the lock acquires. If a writer was holding the lock
        // when this tick was queued and stop() ran in the meantime, we'd
        // otherwise wake up here and proceed to claim/run AFTER shutdown.
        if (!this.running) return;
        claimed = claimDueJobs({ now, limit: this.opts.claimLimit });
      });

      if (claimed.length === 0) return;

      // Each claimed job runs concurrently; the SOAP runner in C3 adds
      // its own PARALLEL_BATCH_SIZE=3 cap. runOne is responsible for taking
      // its own withMaintenanceRead for the run duration.
      const promises = claimed.map(({ job, runId }) =>
        this.runOne(job, runId, now),
      );
      await Promise.all(promises);
    } finally {
      this.tickInProgress = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.timerHandle !== undefined) {
      this.opts.clock.clearTimeout(this.timerHandle);
      this.timerHandle = undefined;
    }

    // Signal cancellation to every in-flight runner, then wait for them all
    // to finalize their run rows.
    const drains: Promise<void>[] = [];
    for (const entry of this.inflight.values()) {
      entry.controller.abort();
      drains.push(entry.promise);
    }
    await Promise.all(drains);
  }

  // Exposed so the manual-trigger route (C5) can cancel a specific in-flight
  // job without reaching into scheduler internals.
  getInflightAbortController(jobId: number): AbortController | undefined {
    return this.inflight.get(jobId)?.controller;
  }

  // /health snapshot. Cheap and side-effect free — read of two fields.
  getStatus(): { running: boolean; inflight: number } {
    return { running: this.running, inflight: this.inflight.size };
  }

  // Manual trigger from POST /jobs/:id/run (C5). Allocates a fresh run row
  // and runs the job immediately, bypassing the next_run_at gate. Refuses if
  // the scheduler isn't running or if a runner is already in flight for the
  // same job (we don't want concurrent runs writing the same dedup_keys).
  //
  // Lock split (C1 hardening): only the insertRunning step is wrapped in
  // withMaintenanceRead at this layer. runOne then acquires its OWN read
  // lock around the actual SOAP + diff + finalize body. This closes the
  // previous bug where `void runOne(...)` ran outside any lock, letting a
  // backup writer race against in-flight snapshot/alert/finalize writes.
  async runJobNow(job: ScheduledJob): Promise<{ runId: number }> {
    if (!this.running) {
      const err = new Error("scheduler not running") as Error & {
        code?: string;
      };
      err.code = "not_running";
      throw err;
    }
    if (this.inflight.has(job.id)) {
      const err = new Error("already in flight") as Error & { code?: string };
      err.code = "in_flight";
      throw err;
    }

    const nowIso = this.opts.clock.now().toISOString();
    let runId = 0;
    await withMaintenanceRead(async () => {
      // Re-check after lock acquires (same reason as tickOnce).
      if (!this.running) {
        const err = new Error("scheduler not running") as Error & {
          code?: string;
        };
        err.code = "not_running";
        throw err;
      }
      if (this.inflight.has(job.id)) {
        const err = new Error("already in flight") as Error & { code?: string };
        err.code = "in_flight";
        throw err;
      }
      runId = insertRunning({
        ownerId: job.owner_id,
        jobId: job.id,
        startedAt: nowIso,
      });
    });

    // Fire and forget: runOne acquires its OWN withMaintenanceRead and runs
    // asynchronously to completion. The route returns 202 + runId so the
    // caller can poll. Synchronous portion of runOne (inflight.set) executes
    // before this function returns, so a duplicate runJobNow on the same job
    // sees the in_flight entry and 409s.
    void this.runOne(job, runId, nowIso);
    return { runId };
  }

  private scheduleNextTick(): void {
    if (!this.running) return;
    this.timerHandle = this.opts.clock.setTimeout(async () => {
      // C4 hardening: an unhandled throw from tickOnce (e.g. transient DB
      // I/O error from claimDueJobs, RWLock corruption, an exception thrown
      // synchronously before tickOnce's own finally runs) used to kill the
      // setTimeout chain — the next scheduleNextTick never registered and
      // monitoring went silently dark until the next process restart. The
      // catch keeps the loop alive across transient faults; a chronically
      // broken DB will surface via the per-job source_error path instead
      // of as a dead scheduler.
      try {
        await this.tickOnce();
      } catch (err) {
        console.error("[scheduler] tickOnce threw, continuing loop", {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
      this.scheduleNextTick();
    }, this.opts.tickIntervalMs);
  }

  private async runOne(
    job: ScheduledJob,
    runId: number,
    nowIso: string,
  ): Promise<void> {
    const controller = new AbortController();
    const startMs = Date.now();

    // Tier 3 #11: the runner.run() call is INTENTIONALLY outside any
    // maintenance lock at this layer. SOAP I/O can take up to 10min on the
    // wallclock budget, and pinning the read lock that long blocks the daily
    // backup writer behind upstream PortalJust latency. Each runner is
    // responsible for acquiring withMaintenanceRead around its own DB
    // persistence (dosarSoapRunner does — see C2 atomicity comment there).
    // The scheduler then takes a SECOND brief read lock around finalize +
    // applyJobOutcome (sub-millisecond UPDATE/INSERT chain wrapped in
    // db.transaction) — so the per-run lock-hold time collapses from
    // "SOAP+DB" to "DB only" (worst-case ~ms, typical microseconds). Two
    // brief acquisitions are cheaper for the queued backup than one long one.
    const work = (async () => {
      let outcome: RunOutcome;
      try {
        outcome = await this.opts.runner.run({
          job,
          runId,
          nowIso,
          signal: controller.signal,
        });
      } catch (err) {
        outcome = {
          status: "error",
          errorCode: "RUNNER_THREW",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }

      const endIso = this.opts.clock.now().toISOString();
      const durationMs = Date.now() - startMs;

      // C3 hardening: finalize (run row terminal) + markJobOutcome (advances
      // next_run_at + fail_streak) MUST commit together. Without this, a
      // crash between the two leaves monitoring_runs marked terminal while
      // monitoring_jobs.next_run_at stays at its pre-run value — the next
      // tick re-claims the same job and produces duplicate snapshots/alerts.
      // The source_error insertAlert inside applyJobOutcome is part of the
      // same atomic boundary so a half-applied recovery never persists.
      // Tier 3 #11: the lock now only wraps this terminal-commit transaction.
      await withMaintenanceRead(async () => {
        getDb().transaction(() => {
          finalize(runId, {
            status: outcome.status,
            endedAt: endIso,
            durationMs,
            httpStatus: outcome.httpStatus,
            errorCode: outcome.errorCode,
            errorMessage: outcome.errorMessage,
            alertsCreated: outcome.alertsCreated ?? 0,
          });

          // 'aborted' is graceful drain, NOT a retry-able failure. Leave job
          // state (fail_streak, next_run_at, last_*) untouched so the next boot
          // resumes the job at its existing schedule. Counting it would inflate
          // fail_streak on every clean shutdown and trip spurious source_error
          // alerts on healthy jobs.
          if (outcome.status !== "aborted") {
            this.applyJobOutcome(job, runId, outcome, nowIso);
          }
        })();
      });
    })().finally(() => {
      this.inflight.delete(job.id);
    });

    this.inflight.set(job.id, { controller, promise: work });
    await work;
  }

  private applyJobOutcome(
    job: ScheduledJob,
    runId: number,
    outcome: RunOutcome,
    nowIso: string,
  ): void {
    const success = outcome.status === "ok";
    const failStreak = success ? 0 : job.fail_streak + 1;
    const lastStatus: "ok" | "error" = success ? "ok" : "error";

    let nextRunAt: Date;
    if (failStreak >= SOURCE_ERROR_THRESHOLD) {
      // Force +1h regardless of standard backoff. At failStreak=5 this is
      // a meaningful override (standard would be 1920s); at failStreak>=6
      // standard backoff caps at 3600s so the values converge.
      nextRunAt = new Date(
        new Date(nowIso).getTime() + SOURCE_ERROR_BACKOFF_SEC * 1000,
      );
    } else {
      const jitterSec = this.opts.jitterSecMax === 0
        ? 0
        : Math.floor(Math.random() * (this.opts.jitterSecMax + 1));
      nextRunAt = computeNextRunAt({
        now: new Date(nowIso),
        cadenceSec: job.cadence_sec,
        failStreak,
        jitterSec,
      });
    }

    markJobOutcome({
      ownerId: job.owner_id,
      jobId: job.id,
      lastRunAt: nowIso,
      lastStatus,
      failStreak,
      nextRunAt: nextRunAt.toISOString(),
    });

    // Emit source_error EXACTLY at the 4 → 5 transition. Higher streaks
    // still back off to 1h but stay quiet — otherwise a chronically broken
    // upstream produces one alert per tick. dedup_key is anchored to the
    // run id that exposed the trip, so each fresh streak (after a recovery)
    // can re-emit on its next 5th fail with a different runId.
    if (failStreak === SOURCE_ERROR_THRESHOLD) {
      insertAlert({
        ownerId: job.owner_id,
        jobId: job.id,
        runId,
        kind: "source_error",
        severity: "warning",
        title: "Sursa indisponibila (5 esecuri consecutive)",
        detail: {
          fail_streak: failStreak,
          last_error_code: outcome.errorCode ?? null,
          last_error_message: outcome.errorMessage ?? null,
          next_run_at: nextRunAt.toISOString(),
        },
        dedupKey: `source_error|${runId}`,
      });
    }
  }
}
