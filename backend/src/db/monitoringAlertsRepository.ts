// Repository for monitoring_alerts.
//
// Owner_id scoping is enforced on every query, same posture as the jobs repo.
// Read-side helpers (listByJob, markRead) were removed in the post-v2.2.0
// cleanup; reintroduce them when an alerts UI lands (PR-5/PR-6 timeline).

import { getDb } from "./schema.ts";

export type AlertKind =
  | "dosar_new"
  | "termen_new"
  | "termen_changed"
  | "solutie_aparuta"
  | "dosar_disappeared"
  | "aviz_changed"
  | "source_error";

export type AlertSeverity = "info" | "warning" | "critical";

export interface MonitoringAlertRow {
  id: number;
  owner_id: string;
  job_id: number;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail_json: string;
  dedup_key: string;
  is_new: number;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
  // Tier 3 #9 — run_id FK populated by the runner / scheduler. Nullable:
  // rows written before migration 0004 retain NULL; ON DELETE SET NULL on
  // the FK keeps the alert when a run row is purged by retention.
  run_id: number | null;
}

export interface InsertAlertInput {
  ownerId: string;
  jobId: number;
  // The monitoring_runs.id row that produced this alert. Required on every
  // new write — runner-emitted alerts and source_error alerts both have a
  // runId in scope (runner via JobRunner.run input, scheduler via
  // applyJobOutcome's runId param). NULL is reserved for backfill paths.
  runId: number;
  kind: AlertKind;
  severity?: AlertSeverity;
  title: string;
  detail?: Record<string, unknown> | null;
  dedupKey: string;
}

// Idempotent insert keyed by (job_id, dedup_key). Returns the row that was
// inserted OR the existing row when the dedup_key already exists for the job.
// This is the contract PR-4's diff engine relies on: re-running the same diff
// twice is a no-op, never a duplicate alert.
//
// Race-free via `INSERT ... ON CONFLICT(job_id, dedup_key) DO NOTHING` — a
// SELECT-then-INSERT pattern would have a TOCTOU window where two concurrent
// callers (e.g. scheduler tick + manual replay) both see "no row" and race
// into the INSERT, with the loser hitting the UNIQUE constraint. The atomic
// upsert collapses that to a single statement: either we win and the inserted
// row is returned, or someone else won and we return their row. Same logical
// outcome (single alert), no exceptions.
export function insertAlert(input: InsertAlertInput): MonitoringAlertRow {
  const db = getDb();
  const detailJson = input.detail ? JSON.stringify(input.detail) : "{}";

  // Tenant-isolation guard: refuse to write an alert when (jobId, ownerId) do
  // not belong together. UNIQUE(job_id, dedup_key) on monitoring_alerts is NOT
  // owner-scoped, so an inconsistent pair would otherwise let a tenant attach
  // alerts onto another tenant's job (or read back the other tenant's row via
  // the SELECT below). The repo header promises owner_id scoping on every
  // query — this preserves that invariant in code until migration 0005 lands
  // a DB-level trigger.
  const jobOwner = db
    .prepare(`SELECT 1 FROM monitoring_jobs WHERE id = ? AND owner_id = ?`)
    .get(input.jobId, input.ownerId);
  if (!jobOwner) {
    throw new Error(
      `insertAlert: job ${input.jobId} not found for owner ${input.ownerId}`,
    );
  }

  db
    .prepare(
      `INSERT INTO monitoring_alerts
         (owner_id, job_id, run_id, kind, severity, title, detail_json, dedup_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id, dedup_key) DO NOTHING`,
    )
    .run(
      input.ownerId,
      input.jobId,
      input.runId,
      input.kind,
      input.severity ?? "info",
      input.title,
      detailJson,
      input.dedupKey,
    );

  const row = db
    .prepare(
      `SELECT * FROM monitoring_alerts
       WHERE job_id = ? AND dedup_key = ? AND owner_id = ?`,
    )
    .get(input.jobId, input.dedupKey, input.ownerId) as
      | MonitoringAlertRow
      | undefined;

  // ON CONFLICT DO NOTHING guarantees the row exists post-INSERT — either we
  // inserted it or the conflicting row is already there. A missing row here
  // means DB corruption or a concurrent DELETE; surface loudly rather than
  // letting `undefined` propagate as a "cannot read property X of undefined"
  // downstream.
  if (!row) {
    throw new Error(
      `insertAlert: row missing after upsert (job_id=${input.jobId}, dedup_key=${input.dedupKey})`,
    );
  }
  return row;
}

