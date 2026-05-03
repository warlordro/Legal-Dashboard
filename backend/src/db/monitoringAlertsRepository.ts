// Repository for monitoring_alerts.
//
// Owner_id scoping is enforced on every query, same posture as the jobs repo.
// Read-side helpers (listByJob, markRead) were removed in the post-v2.2.0
// cleanup; reintroduce them when an alerts UI lands (PR-5/PR-6 timeline).

import { getDb } from "./schema.ts";
import { dispatchAlertEmail } from "../services/email/alertEmailDispatcher.ts";
import { buildRnpmLikePattern } from "../util/textNormalize.ts";

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
  // v2.6.2 — joined from monitoring_jobs in listAlerts to backfill numar_dosar /
  // name_normalized when an old alert (pre-runner-enrichment) lacks them in
  // detail_json. Optional: insertAlert / getAlertById do not populate it; only
  // listAlerts (the only consumer of the alerts UI) emits these fields.
  job_target_json?: string | null;
  job_kind?: string | null;
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
  jobKind?: "dosar_soap" | "name_soap" | "aviz_rnpm";
  q?: string;
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

// Per-owner SSE subscriber cap. Desktop multi-window scenarios (one renderer
// per BrowserWindow + an occasional dev-tools reload) realistically need 2-3;
// 5 leaves headroom without letting a bug spawn unbounded EventSource handles
// that would each hold a SQLite handle + listener slot in memory.
export const MAX_ALERT_SUBSCRIBERS_PER_OWNER = 5;

export class TooManyAlertSubscribersError extends Error {
  readonly code = "too_many_streams" as const;
  constructor(ownerId: string) {
    super(
      `Owner ${ownerId} has reached the alert subscriber cap of ${MAX_ALERT_SUBSCRIBERS_PER_OWNER}.`,
    );
    this.name = "TooManyAlertSubscribersError";
  }
}

export function subscribeToNewAlerts(
  ownerId: string,
  listener: AlertListener,
): () => void {
  let listeners = alertListenersByOwner.get(ownerId);
  if (!listeners) {
    listeners = new Set();
    alertListenersByOwner.set(ownerId, listeners);
  }
  // Cap-check BEFORE inserting so a rejected subscribe leaves the set
  // unchanged; otherwise a throwing path could leave behind a half-registered
  // listener that the SSE handler can't clean up (it never received the
  // unsubscribe callback). Returning a no-op unsubscribe here is harmless
  // because we throw on the same line — the caller never sees it.
  if (listeners.size >= MAX_ALERT_SUBSCRIBERS_PER_OWNER) {
    throw new TooManyAlertSubscribersError(ownerId);
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
  // Isolate per listener: a single SSE writer throwing (closed stream, etc.)
  // must not abort the broadcast or unwind the insertAlert hot path.
  for (const listener of listeners) {
    try {
      listener(row);
    } catch (err) {
      console.error("[alerts] listener threw, isolating", err);
    }
  }
}

// F7 — Solutie enrichment subsystem (types, listener APIs, and the
// `enrichSolutieAlertsForJob` runner-tick hook) moved to
// monitoringAlertsEnrichment.ts (Stage 10) so the row-CRUD repo stays
// focused. Re-exported below at file end for backwards compat with existing
// consumers (routes/alerts.ts and tests).

// Idempotent insert keyed by (job_id, dedup_key). Returns the row that was
// inserted OR the existing row when the dedup_key already exists for the job,
// plus an `inserted` flag so callers (runner stats, scheduler counters) can
// distinguish a real new alert from a dedup no-op (F10). The flag mirrors
// `info.changes > 0` from the upsert: true when we wrote a fresh row, false
// when we returned the existing row that already held the dedup_key.
//
// Race-free via `INSERT ... ON CONFLICT(job_id, dedup_key) DO NOTHING` — a
// SELECT-then-INSERT pattern would have a TOCTOU window where two concurrent
// callers (e.g. scheduler tick + manual replay) both see "no row" and race
// into the INSERT, with the loser hitting the UNIQUE constraint. The atomic
// upsert collapses that to a single statement: either we win and the inserted
// row is returned, or someone else won and we return their row. Same logical
// outcome (single alert), no exceptions.
//
// The INSERT and the readback SELECT run inside a single db.transaction so
// a concurrent DELETE on the just-inserted row can't slip between them and
// turn our success path into the "row missing after upsert" throw. Listener
// notification is deferred via queueMicrotask so callbacks never run inside
// the SQLite write lock — a slow listener would otherwise back-pressure the
// runner that produced the alert.
export interface InsertAlertResult {
  row: MonitoringAlertRow;
  inserted: boolean;
}

export function insertAlert(input: InsertAlertInput): InsertAlertResult {
  const db = getDb();
  const detailJson = input.detail ? JSON.stringify(input.detail) : "{}";

  type InsertResult = { row: MonitoringAlertRow; inserted: boolean };

  const tx = db.transaction((): InsertResult => {
    // Tenant-isolation guard: refuse to write an alert when (jobId, ownerId)
    // do not belong together. UNIQUE(job_id, dedup_key) on monitoring_alerts
    // is NOT owner-scoped, so an inconsistent pair would otherwise let a
    // tenant attach alerts onto another tenant's job (or read back the other
    // tenant's row via the SELECT below). The repo header promises owner_id
    // scoping on every query — this preserves that invariant in code until
    // migration 0005 lands a DB-level trigger.
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

    // ON CONFLICT DO NOTHING guarantees the row exists post-INSERT — either
    // we inserted it or the conflicting row is already there. A missing row
    // here means DB corruption or a foreign-owner row already squatting on
    // the same (job_id, dedup_key) pair (which the readback's owner_id
    // filter excludes). Surface loudly rather than letting `undefined`
    // propagate as a "cannot read property X of undefined" downstream.
    if (!row) {
      throw new Error(
        `insertAlert: row missing after upsert (job_id=${input.jobId}, dedup_key=${input.dedupKey})`,
      );
    }
    return { row, inserted: info.changes > 0 };
  });

  const { row, inserted } = tx();

  if (inserted) {
    // Defer listener fanout off the write path: SSE writers may do network
    // I/O and we don't want them holding (or contending for) the SQLite
    // write lock. queueMicrotask runs before the next macro-task so the
    // observable ordering remains "transaction commits then listeners see
    // the row", just on a fresh tick.
    queueMicrotask(() => notifyNewAlert(row));
    queueMicrotask(() => {
      void dispatchAlertEmail(row);
    });
  }
  return { row, inserted };
}

export function listAlerts(opts: ListAlertsOptions): ListAlertsResult {
  const db = getDb();
  // v2.6.2 — alias monitoring_alerts as `a` so the row SELECT can LEFT JOIN
  // monitoring_jobs without column-name ambiguity (`kind` exists on both).
  // Filters are qualified explicitly here. jobKind/q intentionally filter on
  // the joined job row: alerts whose job was deleted have no target to match,
  // so they are excluded only when those target-based filters are active.
  const where: string[] = ["a.owner_id = ?"];
  const params: (string | number | null)[] = [opts.ownerId];

  if (opts.jobId !== undefined) {
    where.push("a.job_id = ?");
    params.push(opts.jobId);
  }
  if (opts.jobKind) {
    where.push("j.kind = ?");
    params.push(opts.jobKind);
  }
  if (opts.q?.trim()) {
    // Search across both the monitored target (job.target_json) and the alert
    // payload (alert.detail_json + alert.title). The target match keeps the
    // original v2.10.5 semantics ("everything for dosar X / name Y"); the
    // detail/title match catches dosare discovered by name_soap jobs and any
    // other identifiers/text the user can see in the alert card. `trim()` la
    // intrare blocheaza whitespace-only `q` care altfel ar deveni `%   %` si
    // ar match-ui orice rand cu 3 spatii.
    where.push(`(
      rnpm_norm(json_extract(j.target_json, '$.numar_dosar')) LIKE ? ESCAPE '\\'
      OR rnpm_norm(json_extract(j.target_json, '$.name_normalized')) LIKE ? ESCAPE '\\'
      OR rnpm_norm(json_extract(a.detail_json, '$.numar_dosar')) LIKE ? ESCAPE '\\'
      OR rnpm_norm(json_extract(a.detail_json, '$.name_normalized')) LIKE ? ESCAPE '\\'
      OR rnpm_norm(a.title) LIKE ? ESCAPE '\\'
    )`);
    const like = buildRnpmLikePattern(opts.q.trim());
    params.push(like, like, like, like, like);
  }
  if (opts.kind) {
    where.push("a.kind = ?");
    params.push(opts.kind);
  }
  if (opts.severity) {
    where.push("a.severity = ?");
    params.push(opts.severity);
  }
  if (opts.isNew !== undefined) {
    where.push("a.is_new = ?");
    params.push(opts.isNew ? 1 : 0);
  }
  if (opts.onlyUnread) {
    where.push("a.read_at IS NULL");
  }
  if (opts.dismissed !== undefined) {
    where.push(opts.dismissed ? "a.dismissed_at IS NOT NULL" : "a.dismissed_at IS NULL");
  } else if (!opts.includeDismissed) {
    where.push("a.dismissed_at IS NULL");
  }
  if (opts.from) {
    where.push("a.created_at >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    where.push("a.created_at <= ?");
    params.push(opts.to);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const needsJobJoin = opts.jobKind !== undefined || opts.q !== undefined;
  const countJoinSql = needsJobJoin
    ? "LEFT JOIN monitoring_jobs j ON j.id = a.job_id AND j.owner_id = a.owner_id"
    : "";
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM monitoring_alerts a ${countJoinSql} ${whereSql}`)
      .get(...params) as { n: number }
  ).n;

  const offset = (opts.page - 1) * opts.pageSize;
  // LEFT JOIN scoped on (job_id, owner_id) so a misowned job row (shouldn't
  // happen — defensive) cannot leak target_json across tenants. LEFT (not
  // INNER) so an alert whose job was deleted still shows up; the joined
  // columns just come back NULL.
  const rows = db
    .prepare(
      `SELECT a.*,
              j.target_json AS job_target_json,
              j.kind AS job_kind
       FROM monitoring_alerts a
       LEFT JOIN monitoring_jobs j
         ON j.id = a.job_id AND j.owner_id = a.owner_id
       ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC
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

// PR-A v2.7.0: count pentru /api/v1/dashboard/summary (alerts.last24h).
// `since` e ISO string, comparat lexicografic cu created_at — sigur cat timp
// emit-ul ramane format ISO complet (Z-suffix sau offset explicit).
export function countAlertsCreatedSince(ownerId: string, since: string): number {
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n
         FROM monitoring_alerts
         WHERE owner_id = ? AND created_at >= ?`,
      )
      .get(ownerId, since) as { n: number }
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

// Bulk "mark seen" helper. Lets the frontend collapse N PATCH round trips
// (one per alert) into a single request when the user opens the inbox or
// hits "mark all seen". Owner-scoped at every step:
//   - the UPDATE filters by owner_id, so cross-tenant ids in `ids` are
//     silently ignored rather than mutated;
//   - the readback also filters by owner_id, so the response can never
//     surface another tenant's row even if a foreign id is present.
// Wrapped in a transaction so the UPDATE + readback see a consistent
// snapshot under concurrent writes.
export function markAlertsSeen(
  ownerId: string,
  ids: number[],
): MonitoringAlertRow[] {
  if (ids.length === 0) return [];
  // Defensive de-dup + integer coerce — a buggy caller passing the same id
  // twice would otherwise inflate the placeholder list and the IN clause.
  const uniqueIds = Array.from(
    new Set(
      ids.filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
  if (uniqueIds.length === 0) return [];

  const db = getDb();
  const placeholders = uniqueIds.map(() => "?").join(",");

  const tx = db.transaction((): MonitoringAlertRow[] => {
    db
      .prepare(
        `UPDATE monitoring_alerts
         SET is_new = 0,
             read_at = COALESCE(read_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         WHERE owner_id = ? AND id IN (${placeholders})`,
      )
      .run(ownerId, ...uniqueIds);

    return db
      .prepare(
        `SELECT * FROM monitoring_alerts
         WHERE owner_id = ? AND id IN (${placeholders})
         ORDER BY id ASC`,
      )
      .all(ownerId, ...uniqueIds) as MonitoringAlertRow[];
  });

  return tx();
}

// Cross-owner existence probe. Mirrors the helper in the jobs repo: lets the
// alerts router distinguish "row doesn't exist anywhere" (ordinary 404) from
// "row exists but belongs to a different owner" (a probe attempt that should
// be audited as denied access in web mode). Returns only a boolean so it
// can never leak the foreign owner_id back to the caller.
export function alertExistsForAnyOwner(id: number): boolean {
  return (
    getDb()
      .prepare(`SELECT 1 FROM monitoring_alerts WHERE id = ? LIMIT 1`)
      .get(id) !== undefined
  );
}

// Stage 10 — enrichment subsystem split into its own module. Re-exported
// here so existing imports (`import { enrichSolutieAlertsForJob, ... } from
// "./monitoringAlertsRepository"`) keep resolving without consumer churn in
// routes/alerts.ts, runners, and tests.
export {
  addAlertEnrichmentListener,
  removeAlertEnrichmentListener,
  enrichSolutieAlertsForJob,
  type AlertEnrichmentListener,
  type AlertEnrichmentPayload,
  type SolutieEnrichmentDosarContext,
  type SolutieEnrichmentInput,
} from "./monitoringAlertsEnrichment.ts";
