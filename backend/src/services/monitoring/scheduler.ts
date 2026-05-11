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
import type { JobKind } from "../../schemas/monitoring.ts";
import { claimDueJobs, markJobOutcome, type MonitoringJobRow } from "../../db/monitoringJobsRepository.ts";
import {
  finalize,
  insertRunning,
  purgeOldRuns,
  recoverOrphanRuns,
  type TerminalRunStatus,
} from "../../db/monitoringRunsRepository.ts";
import { recordAndDispatchAlert as insertAlert } from "../alerts/alertEventService.ts";
import { purgeOldAiUsage } from "../../db/aiUsageRepository.ts";
import { purgeOldAuditLog } from "../../db/auditRepository.ts";
import { withMaintenanceRead } from "../../db/backup.ts";
import { getDb } from "../../db/schema.ts";
import { isLikelyTooLongForPortalJust } from "../nameListParser.ts";

// 5 consecutive failures = the source is broken, not flaky. Spec
// PLAN-monitoring-webmode.md L390: emit one source_error alert and slow the
// job to once-per-hour to spare upstream and ourselves.
const SOURCE_ERROR_THRESHOLD = 5;
const SOURCE_ERROR_BACKOFF_SEC = 3600;
const RUN_RETENTION_DAYS = 90;
const RUN_PURGE_INTERVAL_MS = 86_400_000;
// ai_usage retention mirrors monitoring_runs: 90 days, purged on the same
// daily timer. PR-7 logs every AI call; without this, the table grows
// monotonically and the /summary card ranges (24h / 30d) are unaffected
// while disk and SQLite scan time creep up indefinitely.
const AI_USAGE_RETENTION_DAYS = 90;
// audit_log retention. v2.20.3 inchide o buclă de crestere monotona: orice
// request mutant scrie cel putin un row in audit_log (recordAudit), iar
// rnpm.cap_hit + monitoring.* genereaza zeci de events/zi pe productie.
// 90 zile pastreaza fereastra de observabilitate a Hardening §17 fara sa
// permita tabela sa creasca indefinit. Pentru deploy web cu cerinte legale
// mai stricte (audit trail >= 1 an), urca aici la 365.
const AUDIT_LOG_RETENTION_DAYS = 90;

export type ScheduledJob = MonitoringJobRow;

// Inferenta best-effort a cauzei probabile cand un job trips source_error.
// Pentru name_soap cu SOAP_FAIL pe un nume normalizat care depaseste limitele
// empirice PortalJust → flag pentru UI ca utilizatorul sa stie ca trebuie sa
// scurteze numele, nu ca PortalJust e jos efectiv.
function computeProbableCause(job: MonitoringJobRow, outcome: RunOutcome): string | null {
  if (job.kind !== "name_soap") return null;
  if (outcome.errorCode !== "SOAP_FAIL") return null;
  try {
    const target = JSON.parse(job.target_json) as { name_normalized?: string };
    if (target?.name_normalized && isLikelyTooLongForPortalJust(target.name_normalized)) {
      return "nume_prea_lung_pentru_portaljust";
    }
  } catch {
    // target_json malformat — nu blocam alerta de baza pentru asta.
  }
  return null;
}

export interface RunOutcome {
  status: TerminalRunStatus;
  alertsCreated?: number;
  // F10 audit hardening: enrichment patches applied to existing alerts on this
  // tick (e.g. solutie_aparuta backfill via enrichSolutieAlertsForJob). Tracked
  // separately from alertsCreated so an enrichment-heavy run is not reported as
  // alertsCreated=0. Only dosar_soap currently emits this; name_soap always
  // leaves it undefined → finalize stores 0.
  alertsPatched?: number;
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
  // Registry indexat pe job.kind. Decuplaza scheduler-ul de orice runner
  // specific: PR-4 inregistreaza dosar_soap, PR-5 va adauga name_soap, fara
  // sa atinga aceasta clasa. Kindurile fara intrare in registry sunt
  // excluse din claim (vezi enabledKinds din claimDueJobs) si — daca totusi
  // ajung pe runOne, fie via runJobNow, fie printr-un drift schema/registry —
  // primesc un outcome NO_RUNNER care le marcheaza terminal.
  runners: Partial<Record<JobKind, JobRunner>>;
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
  private purgeTimerHandle: TimerHandle | undefined;
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
    //
    // Tier 4 #20: log the recovered count so a crash-then-restart is visible
    // in the boot log. error_code='CRASH_RECOVERY' is stamped per-row inside
    // recoverOrphanRuns; this log line is the operator-visible signal.
    const recovered = recoverOrphanRuns();
    if (recovered > 0) {
      console.log(
        JSON.stringify({
          action: "monitoring.crash_recovery",
          recovered_count: recovered,
          ts: new Date().toISOString(),
        })
      );
    }
    this.running = true;
    this.scheduleRunPurge();
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
        claimed = claimDueJobs({
          now,
          limit: this.opts.claimLimit,
          enabledKinds: this.enabledKinds(),
        });
      });

      if (claimed.length === 0) return;

      // Each claimed job runs concurrently; the SOAP runner in C3 adds
      // its own PARALLEL_BATCH_SIZE=3 cap. runOne is responsible for taking
      // its own withMaintenanceRead for the run duration.
      const promises = claimed.map(({ job, runId }) => this.runOne(job, runId, now));
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
    if (this.purgeTimerHandle !== undefined) {
      this.opts.clock.clearTimeout(this.purgeTimerHandle);
      this.purgeTimerHandle = undefined;
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
    //
    // v2.20.8 — Batch 4.1: runOne are deja try/catch intern in jurul runner.run(),
    // dar un throw sincron inainte de IIFE-ul de work (ex. clock.now() throws,
    // AbortController constructor throws sub presiune) ar produce un
    // unhandledRejection care, sub `process.on("unhandledRejection")` din
    // index.ts, omoara procesul. Catch-ul aici inchide runId-ul rezervat ca
    // run terminal de error in loc sa-l lase 'running' pana la urmatorul
    // recoverOrphanRuns la boot, si curata inflight in caz ca s-a setat.
    this.runOne(job, runId, nowIso).catch((err) => {
      console.error("[scheduler] runJobNow runOne rejected", {
        jobId: job.id,
        kind: job.kind,
        runId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      this.inflight.delete(job.id);
      try {
        const endIso = this.opts.clock.now().toISOString();
        finalize(runId, {
          status: "error",
          endedAt: endIso,
          durationMs: 0,
          errorCode: "RUNONE_THREW",
          errorMessage: err instanceof Error ? err.message : String(err),
          alertsCreated: 0,
          alertsPatched: 0,
        });
      } catch (finalizeErr) {
        // Daca finalize esueaza (DB inchis, lock spart), nu mai putem face
        // nimic util — recoverOrphanRuns la urmatorul boot va prinde runId-ul
        // ca 'running' si il va converti la 'aborted'/'crash_recovery'.
        console.error("[scheduler] runJobNow finalize after throw failed", {
          jobId: job.id,
          runId,
          error: finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr),
        });
      }
    });
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

  private scheduleRunPurge(): void {
    if (!this.running) return;
    this.purgeTimerHandle = this.opts.clock.setTimeout(() => {
      if (!this.running) return;
      try {
        const deleted = purgeOldRuns(RUN_RETENTION_DAYS);
        if (deleted > 0) {
          console.log(
            JSON.stringify({
              action: "monitoring.runs_purged",
              deleted_count: deleted,
              retention_days: RUN_RETENTION_DAYS,
              ts: this.opts.clock.now().toISOString(),
            })
          );
        }
      } catch (err) {
        console.error("[scheduler] purgeOldRuns threw, continuing loop", {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }

      // AI usage retention runs alongside the run purge so a single daily
      // wakeup handles both. Independent try/catch — a failure in one must
      // not skip the other (monitoring_runs is operational, ai_usage is
      // observability; both matter, neither blocks the loop).
      try {
        const deletedUsage = purgeOldAiUsage(AI_USAGE_RETENTION_DAYS);
        if (deletedUsage > 0) {
          console.log(
            JSON.stringify({
              action: "ai_usage.purged",
              deleted_count: deletedUsage,
              retention_days: AI_USAGE_RETENTION_DAYS,
              ts: this.opts.clock.now().toISOString(),
            })
          );
        }
      } catch (err) {
        console.error("[scheduler] purgeOldAiUsage threw, continuing loop", {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }

      // v2.20.3: audit_log retention purge — independent try/catch ca un fail
      // in oricare branch sa nu blocheze ceilalti. audit_log e mai sensibil
      // decat ai_usage (e log-ul de compliance), dar acelasi window de 90d.
      try {
        const deletedAudit = purgeOldAuditLog(AUDIT_LOG_RETENTION_DAYS);
        if (deletedAudit > 0) {
          console.log(
            JSON.stringify({
              action: "audit_log.purged",
              deleted_count: deletedAudit,
              retention_days: AUDIT_LOG_RETENTION_DAYS,
              ts: this.opts.clock.now().toISOString(),
            })
          );
        }
      } catch (err) {
        console.error("[scheduler] purgeOldAuditLog threw, continuing loop", {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }

      this.purgeTimerHandle = undefined;
      this.scheduleRunPurge();
    }, RUN_PURGE_INTERVAL_MS);
  }

  private async runOne(job: ScheduledJob, runId: number, nowIso: string): Promise<void> {
    const controller = new AbortController();
    // Tier 4 #18: anchor startMs to clock.now() so duration math is
    // deterministic against the same time source as endIso below. Mixing
    // raw Date.now() with the injected clock produced drift-bounded but
    // non-zero noise in fake-clock tests (durationMs ≠ FakeClock advance).
    const startMs = this.opts.clock.now().getTime();

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
      const runner = this.opts.runners[job.kind as JobKind];
      if (!runner) {
        // Defense in depth: claimDueJobs.enabledKinds este filtrul de baza,
        // dar runJobNow primeste joburi direct din DB fara filtrare. Daca
        // un kind ramane in DB fara runner inregistrat (drift schema /
        // misconfigurare la boot), marcam runul terminal in loc sa-l lasam
        // orphan in 'running' pana la urmatorul restart cu recoverOrphanRuns.
        outcome = {
          status: "error",
          errorCode: "NO_RUNNER",
          errorMessage: `No runner registered for kind '${job.kind}'`,
        };
      } else {
        try {
          outcome = await runner.run({
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
      }

      const endIso = this.opts.clock.now().toISOString();
      const durationMs = this.opts.clock.now().getTime() - startMs;

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
            alertsPatched: outcome.alertsPatched ?? 0,
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

  // Lista kindurilor pentru care exista runner in registry. Scheduler-ul
  // o paseaza la claimDueJobs ca sa nu mai consume joburi pe care nu le
  // poate executa. Lista goala = scheduler fara runneri = no-op (vezi
  // claimDueJobs guard).
  private enabledKinds(): JobKind[] {
    return Object.keys(this.opts.runners) as JobKind[];
  }

  private applyJobOutcome(job: ScheduledJob, runId: number, outcome: RunOutcome, nowIso: string): void {
    const success = outcome.status === "ok";
    const failStreak = success ? 0 : job.fail_streak + 1;
    const lastStatus: "ok" | "error" = success ? "ok" : "error";

    let nextRunAt: Date;
    if (failStreak >= SOURCE_ERROR_THRESHOLD) {
      // Force +1h regardless of standard backoff. At failStreak=5 this is
      // a meaningful override (standard would be 1920s); at failStreak>=6
      // standard backoff caps at 3600s so the values converge.
      nextRunAt = new Date(new Date(nowIso).getTime() + SOURCE_ERROR_BACKOFF_SEC * 1000);
    } else {
      const jitterSec = this.opts.jitterSecMax === 0 ? 0 : Math.floor(Math.random() * (this.opts.jitterSecMax + 1));
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
      // Probable-cause enrichment pentru name_soap: daca PortalJust a esuat
      // pe un nume care depaseste pragurile empirice (~107 chars / 13 cuvinte),
      // adaugam motivul probabil + un titlu mai actionabil. Userul vede direct
      // "scurteaza numele" in loc de "sursa indisponibila".
      const probableCause = computeProbableCause(job, outcome);
      const baseTitle = "Sursa indisponibila (5 esecuri consecutive)";
      const enrichedTitle =
        probableCause === "nume_prea_lung_pentru_portaljust"
          ? "Sursa indisponibila — nume prea lung pentru PortalJust (5 esecuri consecutive)"
          : baseTitle;
      insertAlert({
        ownerId: job.owner_id,
        jobId: job.id,
        runId,
        kind: "source_error",
        severity: "warning",
        title: enrichedTitle,
        detail: {
          fail_streak: failStreak,
          last_error_code: outcome.errorCode ?? null,
          last_error_message: outcome.errorMessage ?? null,
          next_run_at: nextRunAt.toISOString(),
          ...(probableCause ? { probable_cause: probableCause } : {}),
        },
        dedupKey: `source_error|${runId}`,
      });
    } else if (failStreak > SOURCE_ERROR_THRESHOLD) {
      // Tier 4 #22: when a chronically broken job keeps failing past the
      // threshold, the alert is intentionally suppressed (one alert per
      // streak, not per tick). Without a log line, ops have no way to tell
      // "no alert because nothing's wrong" from "no alert because we
      // already alerted once". This log gives that visibility without
      // re-tripping the alert dedup.
      console.log(
        JSON.stringify({
          action: "monitoring.source_error_suppressed",
          job_id: job.id,
          run_id: runId,
          fail_streak: failStreak,
          last_error_code: outcome.errorCode ?? null,
          ts: nowIso,
        })
      );
    }
  }
}
