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
  recoverOrphanRuns,
  type TerminalRunStatus,
} from "../../db/monitoringRunsRepository.ts";

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
    recoverOrphanRuns();
    this.running = true;
    // First tick fires after one interval; callers can also invoke tickOnce()
    // explicitly (tests do).
    this.scheduleNextTick();
  }

  // Single tick — claim, run, finalize. Public for test ergonomics; production
  // path goes through scheduleNextTick → setTimeout → tick().
  async tickOnce(): Promise<void> {
    if (!this.running) return;
    if (this.tickInProgress) return;
    this.tickInProgress = true;
    try {
      const now = this.opts.clock.now().toISOString();
      const claimed = claimDueJobs({ now, limit: this.opts.claimLimit });

      // Each claimed job runs concurrently; the SOAP runner in C3 will add
      // its own PARALLEL_BATCH_SIZE=3 cap. For C2's NoopRunner this is fine.
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

  private scheduleNextTick(): void {
    if (!this.running) return;
    this.timerHandle = this.opts.clock.setTimeout(async () => {
      await this.tickOnce();
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

    const work = (async () => {
      let outcome: RunOutcome;
      try {
        outcome = await this.opts.runner.run({
          job,
          runId,
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

      finalize(runId, {
        status: outcome.status,
        endedAt: endIso,
        durationMs,
        httpStatus: outcome.httpStatus,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
        alertsCreated: outcome.alertsCreated ?? 0,
      });

      this.applyJobOutcome(job, outcome, nowIso);
    })().finally(() => {
      this.inflight.delete(job.id);
    });

    this.inflight.set(job.id, { controller, promise: work });
    await work;
  }

  private applyJobOutcome(
    job: ScheduledJob,
    outcome: RunOutcome,
    nowIso: string,
  ): void {
    const success = outcome.status === "ok";
    const failStreak = success ? 0 : job.fail_streak + 1;
    const lastStatus: "ok" | "error" = success ? "ok" : "error";

    const jitterSec = this.opts.jitterSecMax === 0
      ? 0
      : Math.floor(Math.random() * (this.opts.jitterSecMax + 1));

    const nextRunAt = computeNextRunAt({
      now: new Date(nowIso),
      cadenceSec: job.cadence_sec,
      failStreak,
      jitterSec,
    });

    markJobOutcome({
      jobId: job.id,
      lastRunAt: nowIso,
      lastStatus,
      failStreak,
      nextRunAt: nextRunAt.toISOString(),
    });
  }
}
