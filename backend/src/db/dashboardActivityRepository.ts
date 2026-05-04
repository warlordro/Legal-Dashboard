// PR-B v2.8.0 — Dashboard timeline + charts repository.
//
// Read-only helpers used exclusively by /api/v1/dashboard/{timeline,charts}.
// Kept separate from the per-table CRUD repos because:
//   1. The timeline merges three sources (alerts, runs, curated audit_log) and
//      its SQL shapes are not reusable elsewhere.
//   2. The charts series produce daily-aggregated rows for a fixed window, also
//      consumed only by the dashboard endpoint.
// Splitting it here keeps the per-table repos focused on row CRUD and avoids
// dragging dashboard-shaped types into them.
//
// Owner-scoped on every query — same posture as auditRepository / avizRepository.
// All queries are bounded by `ts < cursor LIMIT N` (timeline) or windowed by a
// closed lower bound `ts >= since AND ts <= until` (charts), so they can never
// scan the entire table.

import { getDb } from "./schema.ts";

// ────────────────────────────────────────────────────────────────────────────
// Curated audit actions surfaced in the dashboard timeline.
//
// The full audit_log is chatty (every alert seen, every API auth check) and
// would drown the timeline. We surface only events that a user looking at the
// dashboard actually cares about:
//   - auth.denied: security signal, regardless of source.
//   - monitoring destructive ops: deletes (single + bulk + denied/inflight).
//   - monitoring lineage: name list commits create jobs in bulk.
//   - admin user/quota writes (any change worth showing alongside operational
//     events).
//   - aviz/search/backup destructive ops (data loss surface).
//   - backup.restore (recovery action).
//
// Plus a catch-all: any audit row with `outcome != 'ok'` is included even if
// its action is not on the list, because a denied/error event is interesting
// regardless of which subsystem produced it.
// ────────────────────────────────────────────────────────────────────────────
export const CURATED_AUDIT_ACTIONS: readonly string[] = [
  "auth.denied",
  "monitoring.job.deleted",
  "monitoring.job.bulk_deleted",
  "monitoring.job.delete_inflight",
  "monitoring.job.delete_denied",
  "monitoring.name_list.committed",
  "admin.users.update_role",
  "admin.users.update_status",
  "admin.users.demote_blocked",
  "admin.users.deactivate_blocked",
  "admin.users.quota_upsert",
  "admin.users.quota_delete",
  "aviz.delete_all",
  "aviz.delete_batch",
  "aviz.delete",
  "backup.delete_all",
  "backup.restore",
  "search.delete",
];

// ────────────────────────────────────────────────────────────────────────────
// Timeline rows. Three sources, each shaped to a common envelope before being
// merged in the route layer (so SQL stays simple and the JS merge is trivial).
// ────────────────────────────────────────────────────────────────────────────

export interface TimelineAlertRow {
  id: number;
  ts: string;
  kind: string;
  severity: string;
  title: string;
  detail_json: string;
  job_id: number;
  job_kind: string | null;
  job_target_json: string | null;
}

export interface TimelineRunRow {
  id: number;
  ts: string;
  status: string;
  job_id: number;
  job_kind: string | null;
  duration_ms: number | null;
  alerts_created: number;
  alerts_patched: number;
  error_code: string | null;
  error_message: string | null;
  http_status: number | null;
}

export interface TimelineAuditRow {
  id: number;
  ts: string;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  outcome: string;
  detail_json: string;
  actor_id: string | null;
}

// `before` is exclusive: rows strictly older than the cursor. Same pattern used
// by /api/v1/alerts to paginate descending — strict `<` keeps the cursor stable
// when two events share a millisecond (id DESC tiebreak inside the source).
//
// We over-fetch up to `limit` rows from each source independently and let the
// route layer merge + slice. Worst case the route loads 3*limit rows for one
// page, which is acceptable for limit ≤ 100 (the route clamps it).

// `before` is exclusive by default (`ts < ?`). Pass `inclusive: true` when the
// caller plans to apply a per-source-id tie-breaker post-merge — that pulls
// rows at and below the cursor ts so the merge step can deterministically
// drop the boundary events using a composite (ts, id) cursor. Without the
// inclusive switch a row sharing the boundary ts in another source would be
// permanently lost between pages.
export function listAlertsBefore(opts: {
  ownerId: string;
  before: string;
  limit: number;
  inclusive?: boolean;
}): TimelineAlertRow[] {
  const cmp = opts.inclusive ? "<=" : "<";
  return getDb()
    .prepare(
      `SELECT a.id, a.created_at AS ts, a.kind, a.severity, a.title, a.detail_json,
              a.job_id, j.kind AS job_kind, j.target_json AS job_target_json
       FROM monitoring_alerts a
       LEFT JOIN monitoring_jobs j ON j.id = a.job_id AND j.owner_id = a.owner_id
       WHERE a.owner_id = ? AND a.created_at ${cmp} ?
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
    )
    .all(opts.ownerId, opts.before, opts.limit) as TimelineAlertRow[];
}

export function listFinalizedRunsBefore(opts: {
  ownerId: string;
  before: string;
  limit: number;
  inclusive?: boolean;
}): TimelineRunRow[] {
  const cmp = opts.inclusive ? "<=" : "<";
  return getDb()
    .prepare(
      `SELECT r.id, r.ended_at AS ts, r.status, r.job_id, r.duration_ms,
              r.alerts_created, r.alerts_patched, r.error_code, r.error_message,
              r.http_status, j.kind AS job_kind
       FROM monitoring_runs r
       LEFT JOIN monitoring_jobs j ON j.id = r.job_id AND j.owner_id = r.owner_id
       WHERE r.owner_id = ?
         AND r.ended_at IS NOT NULL
         AND r.ended_at ${cmp} ?
       ORDER BY r.ended_at DESC, r.id DESC
       LIMIT ?`,
    )
    .all(opts.ownerId, opts.before, opts.limit) as TimelineRunRow[];
}

export function listCuratedAuditBefore(opts: {
  ownerId: string;
  before: string;
  limit: number;
  inclusive?: boolean;
}): TimelineAuditRow[] {
  // Curated set is small (≤ 20 actions) so an inline IN(...) keeps the planner
  // happy without needing a temp table. The OR `outcome != 'ok'` catches
  // denied/error events that fall outside the explicit list (defense in depth).
  const placeholders = CURATED_AUDIT_ACTIONS.map(() => "?").join(",");
  const cmp = opts.inclusive ? "<=" : "<";
  return getDb()
    .prepare(
      `SELECT id, ts, action, target_kind, target_id, outcome, detail_json, actor_id
       FROM audit_log
       WHERE owner_id = ?
         AND ts ${cmp} ?
         AND (action IN (${placeholders}) OR outcome != 'ok')
       ORDER BY ts DESC, id DESC
       LIMIT ?`,
    )
    .all(opts.ownerId, opts.before, ...CURATED_AUDIT_ACTIONS, opts.limit) as TimelineAuditRow[];
}

// ────────────────────────────────────────────────────────────────────────────
// PR-C v2.9.0 — Report endpoint timeline rows in a closed window.
//
// Same shape as the *Before helpers above, but bounded by [since, until]
// instead of `< cursor`. Used by /api/v1/dashboard/report which returns the
// full event list inside the requested 7d/30d range so the report builder
// can render it in one pass without paging.
//
// LIMIT is enforced by the caller (route clamps to a hard cap, default 500
// per source) to keep the payload bounded if a noisy owner has thousands of
// events per week.
// ────────────────────────────────────────────────────────────────────────────

export function listAlertsInRange(opts: {
  ownerId: string;
  since: string;
  until: string;
  limit: number;
}): TimelineAlertRow[] {
  return getDb()
    .prepare(
      `SELECT a.id, a.created_at AS ts, a.kind, a.severity, a.title, a.detail_json,
              a.job_id, j.kind AS job_kind, j.target_json AS job_target_json
       FROM monitoring_alerts a
       LEFT JOIN monitoring_jobs j ON j.id = a.job_id AND j.owner_id = a.owner_id
       WHERE a.owner_id = ?
         AND a.created_at >= ?
         AND a.created_at <= ?
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
    )
    .all(opts.ownerId, opts.since, opts.until, opts.limit) as TimelineAlertRow[];
}

export function listFinalizedRunsInRange(opts: {
  ownerId: string;
  since: string;
  until: string;
  limit: number;
}): TimelineRunRow[] {
  return getDb()
    .prepare(
      `SELECT r.id, r.ended_at AS ts, r.status, r.job_id, r.duration_ms,
              r.alerts_created, r.alerts_patched, r.error_code, r.error_message,
              r.http_status, j.kind AS job_kind
       FROM monitoring_runs r
       LEFT JOIN monitoring_jobs j ON j.id = r.job_id AND j.owner_id = r.owner_id
       WHERE r.owner_id = ?
         AND r.ended_at IS NOT NULL
         AND r.ended_at >= ?
         AND r.ended_at <= ?
       ORDER BY r.ended_at DESC, r.id DESC
       LIMIT ?`,
    )
    .all(opts.ownerId, opts.since, opts.until, opts.limit) as TimelineRunRow[];
}

export function listCuratedAuditInRange(opts: {
  ownerId: string;
  since: string;
  until: string;
  limit: number;
}): TimelineAuditRow[] {
  const placeholders = CURATED_AUDIT_ACTIONS.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT id, ts, action, target_kind, target_id, outcome, detail_json, actor_id
       FROM audit_log
       WHERE owner_id = ?
         AND ts >= ?
         AND ts <= ?
         AND (action IN (${placeholders}) OR outcome != 'ok')
       ORDER BY ts DESC, id DESC
       LIMIT ?`,
    )
    .all(opts.ownerId, opts.since, opts.until, ...CURATED_AUDIT_ACTIONS, opts.limit) as TimelineAuditRow[];
}

// ────────────────────────────────────────────────────────────────────────────
// Charts: daily aggregations for [since, until], anchored to UTC-midnight by
// the caller (uses utcDayStart from aiUsageRepository so all three series share
// the same X-axis). substr(ts, 1, 10) buckets by `YYYY-MM-DD` (the ISO date
// portion); valid because every column is stored as ISO string with `Z` suffix.
// ────────────────────────────────────────────────────────────────────────────

export interface AlertsDailyRow {
  day: string;
  count: number;
}

export function aggregateAlertsByDayInRange(opts: {
  ownerId: string;
  since: string;
  until: string;
}): AlertsDailyRow[] {
  return getDb()
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
       FROM monitoring_alerts
       WHERE owner_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY day
       ORDER BY day ASC`,
    )
    .all(opts.ownerId, opts.since, opts.until) as AlertsDailyRow[];
}

export interface RunsByDayStatusRow {
  day: string;
  status: string;
  n: number;
}

export function aggregateFinalizedRunsByDayAndStatusInRange(opts: {
  ownerId: string;
  since: string;
  until: string;
}): RunsByDayStatusRow[] {
  return getDb()
    .prepare(
      `SELECT substr(ended_at, 1, 10) AS day, status, COUNT(*) AS n
       FROM monitoring_runs
       WHERE owner_id = ?
         AND ended_at IS NOT NULL
         AND ended_at >= ?
         AND ended_at <= ?
       GROUP BY day, status
       ORDER BY day ASC`,
    )
    .all(opts.ownerId, opts.since, opts.until) as RunsByDayStatusRow[];
}
