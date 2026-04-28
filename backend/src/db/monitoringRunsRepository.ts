// Repository for monitoring_runs (PR-4). Per-tick audit/debug rows for the
// scheduler — one row per attempted run, transitioning from `running` to a
// terminal status (ok/error/timeout/aborted) on completion.
//
// recoverOrphanRuns() runs at scheduler boot to mark leftover `running` rows
// as `aborted`. Why: a `running` row is the only signal the scheduler uses to
// avoid re-running a job that's already in flight (lease semantics — see
// monitoringJobsRepository.claimDueJobs in C2). If the previous process
// crashed mid-run, those rows would silently exclude the job from due-claim
// queries forever. The blanket UPDATE is safe because by definition any row
// that's still `running` after a process restart cannot have a live execution.

import { getDb } from "./schema.ts";

export type RunStatus = "running" | "ok" | "error" | "timeout" | "aborted";
export type TerminalRunStatus = Exclude<RunStatus, "running">;

export interface MonitoringRunRow {
  id: number;
  owner_id: string;
  job_id: number;
  started_at: string;
  ended_at: string | null;
  status: RunStatus;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  alerts_created: number;
  duration_ms: number | null;
}

export interface InsertRunningInput {
  ownerId: string;
  jobId: number;
  startedAt: string;
}

// Insert a fresh `running` row at tick start; returns the new id so the
// scheduler can finalize it later.
export function insertRunning(input: InsertRunningInput): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs
         (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`,
    )
    .run(input.ownerId, input.jobId, input.startedAt);
  return info.lastInsertRowid as number;
}

export interface FinalizeInput {
  status: TerminalRunStatus;
  endedAt: string;
  durationMs: number;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  alertsCreated?: number;
}

// Transition a `running` row to a terminal status. Returns true on success,
// false when no row matched (already finalized or never existed). The
// scheduler calls this exactly once per run.
export function finalize(runId: number, input: FinalizeInput): boolean {
  const info = getDb()
    .prepare(
      `UPDATE monitoring_runs
         SET status = ?,
             ended_at = ?,
             duration_ms = ?,
             http_status = ?,
             error_code = ?,
             error_message = ?,
             alerts_created = COALESCE(?, alerts_created)
       WHERE id = ?`,
    )
    .run(
      input.status,
      input.endedAt,
      input.durationMs,
      input.httpStatus ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.alertsCreated ?? null,
      runId,
    );
  return info.changes > 0;
}

// Crash recovery: mark every `running` row as `aborted` and stamp ended_at.
// Called once at scheduler boot, BEFORE the first tick — otherwise tick #1
// would see stale rows and exclude legitimately-due jobs from claim.
//
// Returns the number of rows recovered (useful for boot logs / metrics).
export function recoverOrphanRuns(): number {
  const info = getDb()
    .prepare(
      `UPDATE monitoring_runs
         SET status = 'aborted',
             ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE status = 'running'`,
    )
    .run();
  return info.changes;
}
