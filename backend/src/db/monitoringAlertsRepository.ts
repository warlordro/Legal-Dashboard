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

// F7 — Enrichment publisher hook. listAlerts updates detail_json in place
// when a new ruling is published for an existing solutie_aparuta alert; the
// SSE channel needs a separate "alert was patched" event so the inbox can
// refresh its row without a manual reconnect. We mirror the new-alert
// listener pattern (per-owner Set, isolated dispatch, no SQLite work in the
// callback path) and let routes/alerts.ts wire it into the SSE writer.
export interface AlertEnrichmentPayload {
  id: number;
  ownerId: string;
  jobId: number;
  detail: Record<string, unknown>;
}

export type AlertEnrichmentListener = (payload: AlertEnrichmentPayload) => void;

const alertEnrichmentListenersByOwner = new Map<
  string,
  Set<AlertEnrichmentListener>
>();

export function addAlertEnrichmentListener(
  ownerId: string,
  listener: AlertEnrichmentListener,
): () => void {
  let listeners = alertEnrichmentListenersByOwner.get(ownerId);
  if (!listeners) {
    listeners = new Set();
    alertEnrichmentListenersByOwner.set(ownerId, listeners);
  }
  listeners.add(listener);
  return () => removeAlertEnrichmentListener(ownerId, listener);
}

export function removeAlertEnrichmentListener(
  ownerId: string,
  listener: AlertEnrichmentListener,
): void {
  const listeners = alertEnrichmentListenersByOwner.get(ownerId);
  if (!listeners) return;
  listeners.delete(listener);
  if (listeners.size === 0) {
    alertEnrichmentListenersByOwner.delete(ownerId);
  }
}

function notifyAlertEnriched(payload: AlertEnrichmentPayload): void {
  const listeners = alertEnrichmentListenersByOwner.get(payload.ownerId);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch (err) {
      console.error("[alerts] enrichment listener threw, isolating", err);
    }
  }
}

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
  }
  return { row, inserted };
}

export function listAlerts(opts: ListAlertsOptions): ListAlertsResult {
  const db = getDb();
  // v2.6.2 — alias monitoring_alerts as `a` so the row SELECT can LEFT JOIN
  // monitoring_jobs without column-name ambiguity (`kind` exists on both).
  // Filters all live on monitoring_alerts; qualified explicitly here.
  const where: string[] = ["a.owner_id = ?"];
  const params: (string | number | null)[] = [opts.ownerId];

  if (opts.jobId !== undefined) {
    where.push("a.job_id = ?");
    params.push(opts.jobId);
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
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM monitoring_alerts a ${whereSql}`)
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

// v2.6.4 — enrich existing solutie_aparuta alerts whose detail_json was
// frozen with empty solutie_sumar / numar_document / data_pronuntare because
// PortalJust hadn't yet published the ruling text at the time the alert was
// emitted. The runner calls this on every dosar_soap tick after persisting
// new alerts; for each sedinta with a non-empty ruling, we look up the alert
// emitted for the same (data, ora, complet, solutie) tuple and merge the
// new fields in-place if they were missing. Idempotent: running it again
// when the data is already present is a no-op (only patches when at least
// one target field is currently empty/missing).
export interface SolutieEnrichmentInput {
  data: string;
  ora?: string;
  complet?: string;
  solutie: string;
  solutieSumar?: string;
  numarDocument?: string;
  dataPronuntare?: string;
}

export interface SolutieEnrichmentDosarContext {
  instanta?: string;
  stadiu?: string;
}

export function enrichSolutieAlertsForJob(
  ownerId: string,
  jobId: number,
  sedinte: SolutieEnrichmentInput[],
  dosarContext: SolutieEnrichmentDosarContext = {},
): number {
  const sedintaCandidates = sedinte.filter(
    (s) =>
      (s.solutieSumar?.trim().length ?? 0) > 0 ||
      (s.numarDocument?.trim().length ?? 0) > 0 ||
      (s.dataPronuntare?.trim().length ?? 0) > 0,
  );
  const dosarInstanta = dosarContext.instanta?.trim();
  const dosarStadiu = dosarContext.stadiu?.trim();
  const haveDosarFields =
    (dosarInstanta?.length ?? 0) > 0 || (dosarStadiu?.length ?? 0) > 0;
  if (sedintaCandidates.length === 0 && !haveDosarFields) return 0;

  const db = getDb();
  // F4: alertele vechi pastreaza contextul lor istoric; nu suprascriem
  // stadiul/instanta cu valoarea curenta cand dosarul a tranzitat
  // fond->apel intre timp. Limitam fereastra de backfill la 7 zile, suficient
  // pentru cazul tipic "PortalJust publica hotararea cu cateva zile dupa
  // sedinta" si scurt destul cat sa nu suprascriem context istoric stale.
  // F5: LIMIT 200 ca safety cap imediat pe scan — chiar si pe joburi vechi
  // cu istoric dens, fereastra de 7 zile + cap-ul fac costul O(1) per tick.
  const rows = db
    .prepare(
      `SELECT id, detail_json FROM monitoring_alerts
       WHERE owner_id = ? AND job_id = ? AND kind = 'solutie_aparuta'
         AND created_at >= datetime('now', '-7 days')
       ORDER BY id DESC
       LIMIT 200`,
    )
    .all(ownerId, jobId) as Array<{ id: number; detail_json: string }>;
  if (rows.length === 0) return 0;

  const update = db.prepare(
    `UPDATE monitoring_alerts SET detail_json = ?
     WHERE id = ? AND owner_id = ?`,
  );

  let patched = 0;
  const enrichedNotifications: AlertEnrichmentPayload[] = [];
  const tx = db.transaction(() => {
    for (const row of rows) {
      let detail: Record<string, unknown>;
      try {
        const parsed = JSON.parse(row.detail_json) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        detail = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      const dData = typeof detail.data === "string" ? detail.data : null;
      const dOra = typeof detail.ora === "string" ? detail.ora : null;
      const dComplet = typeof detail.complet === "string" ? detail.complet : null;
      const dSolutie = typeof detail.solutie === "string" ? detail.solutie : null;
      let mutated = false;
      if (dData) {
        // F6: PortalJust poate modifica usor textul solutiei intre alerta
        // initiala si publicarea hotararii (whitespace, accente); fallback-ul
        // pe (data, ora, complet) e suficient sa atribuim hotararea corect.
        // Normalizam ambele parti cu .trim() pentru match-ul strict, apoi
        // cadem pe match-ul fara solutie cand textul a divergat.
        const dSolutieTrim = dSolutie?.trim() ?? "";
        let match = dSolutie
          ? sedintaCandidates.find(
              (s) =>
                s.data === dData &&
                (s.ora ?? "") === (dOra ?? "") &&
                (s.complet ?? "") === (dComplet ?? "") &&
                s.solutie.trim() === dSolutieTrim,
            )
          : undefined;
        if (!match) {
          match = sedintaCandidates.find(
            (s) =>
              s.data === dData &&
              (s.ora ?? "") === (dOra ?? "") &&
              (s.complet ?? "") === (dComplet ?? ""),
          );
        }
        if (match) {
          if (
            (typeof detail.solutie_sumar !== "string" || detail.solutie_sumar.trim().length === 0) &&
            match.solutieSumar &&
            match.solutieSumar.trim().length > 0
          ) {
            detail.solutie_sumar = match.solutieSumar;
            mutated = true;
          }
          if (
            (typeof detail.numar_document !== "string" || detail.numar_document.trim().length === 0) &&
            match.numarDocument &&
            match.numarDocument.trim().length > 0
          ) {
            detail.numar_document = match.numarDocument;
            mutated = true;
          }
          if (
            (typeof detail.data_pronuntare !== "string" || detail.data_pronuntare.trim().length === 0) &&
            match.dataPronuntare &&
            match.dataPronuntare.trim().length > 0
          ) {
            detail.data_pronuntare = match.dataPronuntare;
            mutated = true;
          }
        }
      }
      // Dosar-level fields (instanta, stadiu) apply to every alert for this
      // job regardless of which sedinta matched — they're properties of the
      // case itself. Backfilling them lets old alerts that were emitted when
      // currentDosar was null/empty pick up the court name once it appears.
      // F4 guard: query-ul de mai sus filtreaza deja alertele >7 zile, deci
      // contextul istoric mai vechi nu mai poate fi suprascris cu valoarea
      // curenta dupa o tranzitie fond->apel.
      if (
        dosarInstanta &&
        (typeof detail.instanta !== "string" || detail.instanta.trim().length === 0)
      ) {
        detail.instanta = dosarInstanta;
        mutated = true;
      }
      if (
        dosarStadiu &&
        (typeof detail.stadiu !== "string" || detail.stadiu.trim().length === 0)
      ) {
        detail.stadiu = dosarStadiu;
        mutated = true;
      }
      if (mutated) {
        update.run(JSON.stringify(detail), row.id, ownerId);
        patched += 1;
        // F7: colectam payload-urile pentru SSE; nu emitem din interiorul
        // tranzactiei ca listenerii sa nu ruleze sub write lock.
        enrichedNotifications.push({
          id: row.id,
          ownerId,
          jobId,
          detail: { ...detail },
        });
      }
    }
  });
  tx();
  // F7: defer fanout dupa commit, similar cu pattern-ul din insertAlert.
  if (enrichedNotifications.length > 0) {
    queueMicrotask(() => {
      for (const payload of enrichedNotifications) {
        notifyAlertEnriched(payload);
      }
    });
  }
  return patched;
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
