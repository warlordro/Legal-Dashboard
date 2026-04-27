// Stub repository for monitoring_alerts (PR-3).
//
// The schema lands in PR-3 so the diff engine in PR-4 has a stable insert
// surface to write against. We expose the minimal API needed for the PR-3
// frontend to render an empty alerts list and mark items read — no diff
// generation logic here. PR-4 fleshes out richer reads (group-by-job,
// severity filters) and the actual `insertFromDiff()` path.
//
// Owner_id scoping is enforced on every query, same posture as the jobs repo.

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
}

export interface InsertAlertInput {
  ownerId: string;
  jobId: number;
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

  db
    .prepare(
      `INSERT INTO monitoring_alerts
         (owner_id, job_id, kind, severity, title, detail_json, dedup_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id, dedup_key) DO NOTHING`,
    )
    .run(
      input.ownerId,
      input.jobId,
      input.kind,
      input.severity ?? "info",
      input.title,
      detailJson,
      input.dedupKey,
    );

  const row = db
    .prepare(
      `SELECT * FROM monitoring_alerts
       WHERE job_id = ? AND dedup_key = ?`,
    )
    .get(input.jobId, input.dedupKey) as MonitoringAlertRow | undefined;

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

export interface ListAlertsByJobOptions {
  ownerId: string;
  jobId: number;
  unreadOnly?: boolean;
  limit?: number;
}

export function listByJob(opts: ListAlertsByJobOptions): MonitoringAlertRow[] {
  const where: string[] = ["owner_id = ?", "job_id = ?"];
  const params: (string | number)[] = [opts.ownerId, opts.jobId];
  if (opts.unreadOnly) where.push("read_at IS NULL");
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000));

  return getDb()
    .prepare(
      `SELECT * FROM monitoring_alerts
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(...params, limit) as MonitoringAlertRow[];
}

// Mark alert read — clears `is_new` badge and sets `read_at`. Returns true on
// success, false when the alert doesn't exist or doesn't belong to ownerId.
export function markRead(ownerId: string, id: number): boolean {
  const info = getDb()
    .prepare(
      `UPDATE monitoring_alerts
       SET read_at = COALESCE(read_at, datetime('now')), is_new = 0
       WHERE id = ? AND owner_id = ?`,
    )
    .run(id, ownerId);
  return info.changes > 0;
}
