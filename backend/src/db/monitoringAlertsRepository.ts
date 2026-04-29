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
  | "stadiu_changed"
  | "categorie_changed"
  | "dosar_relevant_now"
  | "dosar_no_longer_relevant"
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

export interface ListAlertsOptions {
  ownerId: string;
  page: number;
  pageSize: number;
  jobId?: number;
  kind?: AlertKind;
  severity?: AlertSeverity;
  isNew?: boolean;
  onlyUnread?: boolean;
  dismissed?: boolean;
  includeDismissed?: boolean;
  from?: string;
  to?: string;
}

export interface ListAlertsResult {
  rows: MonitoringAlertRow[];
  total: number;
  page: number;
  pageSize: number;
  unread: number;
}

export type AlertListener = (alert: MonitoringAlertRow) => void;

const alertListenersByOwner = new Map<string, Set<AlertListener>>();

export function subscribeToNewAlerts(
  ownerId: string,
  listener: AlertListener,
): () => void {
  let listeners = alertListenersByOwner.get(ownerId);
  if (!listeners) {
    listeners = new Set();
    alertListenersByOwner.set(ownerId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      alertListenersByOwner.delete(ownerId);
    }
  };
}

export function getAlertSubscriberCount(ownerId?: string): number {
  if (ownerId) return alertListenersByOwner.get(ownerId)?.size ?? 0;
  let count = 0;
  for (const listeners of alertListenersByOwner.values()) count += listeners.size;
  return count;
}

function notifyNewAlert(row: MonitoringAlertRow): void {
  const listeners = alertListenersByOwner.get(row.owner_id);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    listener(row);
  }
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

  const info = db
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
  if (info.changes > 0) {
    notifyNewAlert(row);
  }
  return row;
}

export function listAlerts(opts: ListAlertsOptions): ListAlertsResult {
  const db = getDb();
  const where: string[] = ["owner_id = ?"];
  const params: (string | number | null)[] = [opts.ownerId];

  if (opts.jobId !== undefined) {
    where.push("job_id = ?");
    params.push(opts.jobId);
  }
  if (opts.kind) {
    where.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.severity) {
    where.push("severity = ?");
    params.push(opts.severity);
  }
  if (opts.isNew !== undefined) {
    where.push("is_new = ?");
    params.push(opts.isNew ? 1 : 0);
  }
  if (opts.onlyUnread) {
    where.push("read_at IS NULL");
  }
  if (opts.dismissed !== undefined) {
    where.push(opts.dismissed ? "dismissed_at IS NOT NULL" : "dismissed_at IS NULL");
  } else if (!opts.includeDismissed) {
    where.push("dismissed_at IS NULL");
  }
  if (opts.from) {
    where.push("created_at >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    where.push("created_at <= ?");
    params.push(opts.to);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM monitoring_alerts ${whereSql}`)
      .get(...params) as { n: number }
  ).n;

  const offset = (opts.page - 1) * opts.pageSize;
  const rows = db
    .prepare(
      `SELECT * FROM monitoring_alerts
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.pageSize, offset) as MonitoringAlertRow[];

  return {
    rows,
    total,
    page: opts.page,
    pageSize: opts.pageSize,
    unread: countUnreadAlerts(opts.ownerId),
  };
}

export function countUnreadAlerts(ownerId: string): number {
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n
         FROM monitoring_alerts
         WHERE owner_id = ?
           AND read_at IS NULL
           AND dismissed_at IS NULL`,
      )
      .get(ownerId) as { n: number }
  ).n;
}

export function getAlertById(
  ownerId: string,
  id: number,
): MonitoringAlertRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM monitoring_alerts WHERE id = ? AND owner_id = ?`)
    .get(id, ownerId) as MonitoringAlertRow | undefined;
  return row ?? null;
}

export function markAlertSeen(
  ownerId: string,
  id: number,
): MonitoringAlertRow | null {
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE monitoring_alerts
       SET is_new = 0,
           read_at = COALESCE(read_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       WHERE id = ? AND owner_id = ?`,
    )
    .run(id, ownerId);
  if (info.changes === 0) return null;
  return getAlertById(ownerId, id);
}

export function dismissAlert(
  ownerId: string,
  id: number,
): MonitoringAlertRow | null {
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE monitoring_alerts
       SET is_new = 0,
           read_at = COALESCE(read_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           dismissed_at = COALESCE(dismissed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       WHERE id = ? AND owner_id = ?`,
    )
    .run(id, ownerId);
  if (info.changes === 0) return null;
  return getAlertById(ownerId, id);
}

