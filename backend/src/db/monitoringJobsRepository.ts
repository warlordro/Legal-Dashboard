// Repository layer for monitoring_jobs (PR-3).
//
// CRUD with strict owner_id scoping on every read AND write — same posture as
// auditRepository / avizRepository. Idempotency on create is provided via the
// `client_request_id` UNIQUE partial index: a retry with the same client id
// returns the original row instead of inserting a duplicate or 409-ing.
//
// PR-4 (scheduler) will add `claimDueJobs(now, limit)` here. We deliberately
// don't pre-build that surface in PR-3 — the schema is ready (idx_monitoring_due
// is the partial index used) but the scheduler logic itself ships in PR-4.

import { getDb } from "./schema.ts";
import { canonicalSha256 } from "../util/canonicalJson.ts";
import type { JobCreateBody, JobKind, JobUpdateBody } from "../schemas/monitoring.ts";

export type JobStatus = "ok" | "error" | "partial" | "skipped";

export interface MonitoringJobRow {
  id: number;
  owner_id: string;
  kind: JobKind;
  target_json: string;
  target_hash: string;
  cadence_sec: number;
  active: number;
  paused_until: string | null;
  alert_config_json: string;
  next_run_at: string;
  last_run_at: string | null;
  last_status: JobStatus | null;
  fail_streak: number;
  notes: string | null;
  client_request_id: string | null;
  // Lineage catre name_lists (PR-5): NULL pentru joburi create manual via
  // /api/v1/monitoring/jobs; setat pentru joburi create automat de
  // /api/v1/name-lists?autoCreateJobs=true. archiveList foloseste asta ca
  // sa refuze archivarea cand exista joburi inca legate.
  name_list_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateJobInput {
  ownerId: string;
  body: JobCreateBody;
  /**
   * Lineage opcional pentru joburi auto-create-d dintr-o lista de nume
   * (PR-5). Setat doar de /api/v1/name-lists pe path-ul autoCreateJobs;
   * /api/v1/monitoring/jobs il lasa undefined (NULL in DB), pentru ca un
   * user nu trebuie sa poata atribui un job la o name_list arbitrar via API.
   */
  nameListId?: number;
}

// Insert a new job. If client_request_id is provided AND a row already exists
// for (owner_id, client_request_id), return that row unchanged (idempotent).
// On (owner_id, target_hash, kind) collision *without* a matching
// client_request_id we return the existing row and signal `duplicate: true` so
// the route layer can decide whether to 200 or 409.
export interface CreateJobResult {
  job: MonitoringJobRow;
  /** true when the row already existed (target_hash collision OR client id replay) */
  duplicate: boolean;
  /** true specifically when reused via client_request_id idempotency */
  idempotentReplay: boolean;
}

export function createJob(input: CreateJobInput): CreateJobResult {
  const db = getDb();
  const { ownerId, body } = input;
  const targetJson = JSON.stringify(body.target);
  const targetHash = canonicalSha256(body.target);
  const alertConfigJson = JSON.stringify(body.alert_config);
  // C6 hardening (smoke finding): freshly-created job runs on the NEXT
  // scheduler tick, not after a full cadence. The previous now+cadence math
  // meant a user creating a daily monitor saw "Niciodata" for 24h with no
  // baseline snapshot, no UI feedback that the job was wired correctly.
  // After the first run finalizes, markJobOutcome → computeNextRunAt aligns
  // future ticks to the requested cadence, so the cadence contract still
  // holds — only the FIRST tick is accelerated.
  const nextRunAt = new Date().toISOString();

  // 1) client_request_id replay path — return existing row unchanged.
  if (body.client_request_id) {
    const existing = db
      .prepare(
        `SELECT * FROM monitoring_jobs
         WHERE owner_id = ? AND client_request_id = ?`,
      )
      .get(ownerId, body.client_request_id) as MonitoringJobRow | undefined;
    if (existing) {
      return { job: existing, duplicate: true, idempotentReplay: true };
    }
  }

  // 2) target_hash collision — same target already watched, distinct or null
  //    client_request_id. Don't insert; return existing.
  const existingByTarget = db
    .prepare(
      `SELECT * FROM monitoring_jobs
       WHERE owner_id = ? AND target_hash = ? AND kind = ?`,
    )
    .get(ownerId, targetHash, body.kind) as MonitoringJobRow | undefined;
  if (existingByTarget) {
    return { job: existingByTarget, duplicate: true, idempotentReplay: false };
  }

  // 3) Fresh insert.
  const result = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at, notes, client_request_id,
          name_list_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ownerId,
      body.kind,
      targetJson,
      targetHash,
      body.cadence_sec,
      alertConfigJson,
      nextRunAt,
      body.notes ?? null,
      body.client_request_id ?? null,
      input.nameListId ?? null,
    );

  const job = db
    .prepare(`SELECT * FROM monitoring_jobs WHERE id = ?`)
    .get(result.lastInsertRowid) as MonitoringJobRow;

  return { job, duplicate: false, idempotentReplay: false };
}

export function getJobById(ownerId: string, id: number): MonitoringJobRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM monitoring_jobs WHERE id = ? AND owner_id = ?`)
    .get(id, ownerId) as MonitoringJobRow | undefined;
  return row ?? null;
}

// Cross-owner existence probe. Returnata explicit ca boolean ca sa nu scurga
// niciodata foreign owner_id catre caller. Folosita de PATCH/DELETE pentru a
// distinge "row inexistent" (nu se auditeaza) de "row exista la alt owner"
// (denied access — trebuie auditat pentru reconstruct antifraud in web mode).
export function jobExistsForAnyOwner(id: number): boolean {
  return (
    getDb()
      .prepare(`SELECT 1 AS one FROM monitoring_jobs WHERE id = ? LIMIT 1`)
      .get(id) !== undefined
  );
}

export interface ListJobsOptions {
  ownerId: string;
  page: number;
  pageSize: number;
  kind?: JobKind;
  active?: boolean;
}

export interface ListJobsResult {
  rows: MonitoringJobRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function listJobs(opts: ListJobsOptions): ListJobsResult {
  const db = getDb();
  const where: string[] = ["owner_id = ?"];
  const params: (string | number)[] = [opts.ownerId];
  if (opts.kind) {
    where.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.active !== undefined) {
    where.push("active = ?");
    params.push(opts.active ? 1 : 0);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM monitoring_jobs ${whereSql}`)
      .get(...params) as { n: number }
  ).n;

  const offset = (opts.page - 1) * opts.pageSize;
  const rows = db
    .prepare(
      `SELECT * FROM monitoring_jobs
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.pageSize, offset) as MonitoringJobRow[];

  return { rows, total, page: opts.page, pageSize: opts.pageSize };
}

// PATCH — owner_id scoped UPDATE; returns the updated row or null when no row
// matched (either because it doesn't exist or it belongs to another owner).
// Only fields present on `patch` are applied; we never let kind/target leak
// through (the JobUpdateBodySchema rejects them at the route layer too).
//
// next_run_at recompute: when cadence/active/paused_until change, the schedule
// implied by the previous values is stale. If we left next_run_at alone, a job
// flipped from inactive→active would still carry the old next_run_at (often
// far in the past) and the scheduler would fire it back-to-back ignoring the
// new cadence. Same for cadence shrink. We recompute it inside the same
// transaction so the row is internally consistent before audit reads it.
export function updateJob(
  ownerId: string,
  id: number,
  patch: JobUpdateBody,
): MonitoringJobRow | null {
  const db = getDb();

  const tx = db.transaction((): MonitoringJobRow | null => {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];

    if (patch.cadence_sec !== undefined) {
      sets.push("cadence_sec = ?");
      params.push(patch.cadence_sec);
    }
    if (patch.active !== undefined) {
      sets.push("active = ?");
      params.push(patch.active ? 1 : 0);
    }
    if (patch.paused_until !== undefined) {
      sets.push("paused_until = ?");
      params.push(patch.paused_until);
    }
    if (patch.notes !== undefined) {
      sets.push("notes = ?");
      params.push(patch.notes);
    }
    if (patch.alert_config !== undefined) {
      // Partial merge against existing JSON so callers can change one key
      // without sending the whole config back.
      const current = db
        .prepare(
          `SELECT alert_config_json FROM monitoring_jobs
           WHERE id = ? AND owner_id = ?`,
        )
        .get(id, ownerId) as { alert_config_json: string } | undefined;
      if (!current) return null;
      const merged = { ...JSON.parse(current.alert_config_json), ...patch.alert_config };
      sets.push("alert_config_json = ?");
      params.push(JSON.stringify(merged));
    }

    if (sets.length === 0) {
      return db
        .prepare(`SELECT * FROM monitoring_jobs WHERE id = ? AND owner_id = ?`)
        .get(id, ownerId) as MonitoringJobRow | null ?? null;
    }

    // Recompute next_run_at when scheduling-relevant fields change.
    const reschedule =
      patch.cadence_sec !== undefined ||
      patch.active !== undefined ||
      patch.paused_until !== undefined;
    if (reschedule) {
      const cadence =
        patch.cadence_sec ??
        (
          db
            .prepare(`SELECT cadence_sec FROM monitoring_jobs WHERE id = ? AND owner_id = ?`)
            .get(id, ownerId) as { cadence_sec: number } | undefined
        )?.cadence_sec;
      if (cadence === undefined) return null;
      sets.push("next_run_at = ?");
      params.push(new Date(Date.now() + cadence * 1000).toISOString());
    }

    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");

    const sql = `UPDATE monitoring_jobs
                 SET ${sets.join(", ")}
                 WHERE id = ? AND owner_id = ?`;
    const info = db.prepare(sql).run(...params, id, ownerId);
    if (info.changes === 0) return null;

    return db
      .prepare(`SELECT * FROM monitoring_jobs WHERE id = ? AND owner_id = ?`)
      .get(id, ownerId) as MonitoringJobRow;
  });

  return tx();
}

// DELETE cascades to snapshots/alerts/runs via FK ON DELETE CASCADE in DDL.
// Returns true when a row was actually deleted (false = not found OR not owned).
export function deleteJob(ownerId: string, id: number): boolean {
  const info = getDb()
    .prepare(`DELETE FROM monitoring_jobs WHERE id = ? AND owner_id = ?`)
    .run(id, ownerId);
  return info.changes > 0;
}

// --- scheduler glue: atomic claim of due jobs ----------------------------
//
// The scheduler tick calls this to pull a batch of due jobs and lease them
// atomically. "Lease" = a `monitoring_runs` row with status='running' is
// inserted in the same transaction as the SELECT, so the next tick (or a
// concurrent manual trigger) sees the job already in flight and skips it.
//
// Why BEGIN IMMEDIATE: better-sqlite3's default transaction mode is DEFERRED,
// which acquires the write lock only at first write. With DEFERRED, two
// callers can both read the same "due" rows before either INSERTs into runs,
// then both INSERT and double-claim. IMMEDIATE acquires the reserved lock at
// BEGIN — the second caller waits until the first commits, then sees the
// just-inserted running rows in its SELECT and skips them.
//
// Eligibility predicate (kept in lock-step with idx_monitoring_due):
//   active = 1
//   AND (paused_until IS NULL OR paused_until <= now)
//   AND next_run_at <= now
//   AND no monitoring_runs row exists with status='running' for this job_id

export interface ClaimDueJobsInput {
  now: string;
  limit: number;
  // Restrange claim-ul la kindurile pentru care scheduler-ul ruleaza un
  // runner inregistrat. Compus cu MONITORING_DISABLED_KINDS din env.
  //   undefined → fara filtru pe kind (toate kindurile, doar env-ul exclude)
  //   []        → claim nul (no-op): un scheduler fara runneri nu trebuie sa
  //               consume joburi din alte kinduri, altfel ar marca runuri
  //               'running' fara sa aiba cine sa le execute
  //   [k1, k2]  → doar kindurile listate (in plus filtrate de env)
  enabledKinds?: JobKind[];
}

export interface ClaimedJob {
  job: MonitoringJobRow;
  runId: number;
}

function getDisabledMonitoringKinds(): string[] {
  return Array.from(
    new Set(
      (process.env.MONITORING_DISABLED_KINDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

// Scheduler-private outcome write. updateJob() deliberately rejects these
// fields (last_run_at/last_status/fail_streak/next_run_at) so user PATCH can't
// mutate the scheduler's internal state. The scheduler uses this write
// instead — single UPDATE, no transaction needed (sole writer for these
// columns is the scheduler itself, ordered by ticks).
//
// Tier 3 #10: ownerId is REQUIRED and added to the WHERE clause as a
// belt-and-braces guard. The scheduler always knows the owner (claim returns
// it on the row), so a defense-in-depth `AND owner_id = ?` ensures that even
// if a future caller passes a jobId from a different owner — or owner_id
// gets corrupted in flight — the UPDATE silently no-ops instead of clobbering
// another owner's row. Returns true when a row was actually updated so callers
// can detect cross-owner attempts at the boundary.
export interface MarkJobOutcomeInput {
  ownerId: string;
  jobId: number;
  lastRunAt: string;
  lastStatus: "ok" | "error";
  failStreak: number;
  nextRunAt: string;
}

export function markJobOutcome(input: MarkJobOutcomeInput): boolean {
  const info = getDb()
    .prepare(
      `UPDATE monitoring_jobs
         SET last_run_at = ?,
             last_status = ?,
             fail_streak = ?,
             next_run_at = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND owner_id = ?`,
    )
    .run(
      input.lastRunAt,
      input.lastStatus,
      input.failStreak,
      input.nextRunAt,
      input.jobId,
      input.ownerId,
    );
  return info.changes > 0;
}

export function claimDueJobs(input: ClaimDueJobsInput): ClaimedJob[] {
  // Caz fail-safe: scheduler fara runneri inregistrati. Daca am lasa
  // claim-ul sa ruleze, am insera randuri 'running' in monitoring_runs pe
  // care n-ar avea cine sa le finalizeze — orphan run pana la
  // recoverOrphanRuns. Mai sigur: return imediat, niciun side-effect.
  const enabledKinds = input.enabledKinds;
  if (enabledKinds !== undefined && enabledKinds.length === 0) {
    return [];
  }

  const db = getDb();
  const tx = db.transaction((now: string, limit: number): ClaimedJob[] => {
    const disabledKinds = getDisabledMonitoringKinds();

    const kindClauses: string[] = [];
    const kindParams: string[] = [];
    if (enabledKinds && enabledKinds.length > 0) {
      kindClauses.push(`AND kind IN (${enabledKinds.map(() => "?").join(", ")})`);
      kindParams.push(...enabledKinds);
    }
    if (disabledKinds.length > 0) {
      kindClauses.push(`AND kind NOT IN (${disabledKinds.map(() => "?").join(", ")})`);
      kindParams.push(...disabledKinds);
    }
    const kindSql = kindClauses.join(" ");

    const selectParams: (string | number)[] = [now, now, ...kindParams, limit];
    const due = db
      .prepare(
        `SELECT * FROM monitoring_jobs
         WHERE active = 1
           AND (paused_until IS NULL OR paused_until <= ?)
           AND next_run_at <= ?
           ${kindSql}
           AND NOT EXISTS (
             SELECT 1 FROM monitoring_runs
             WHERE monitoring_runs.job_id = monitoring_jobs.id
               AND monitoring_runs.status = 'running'
           )
         ORDER BY next_run_at ASC, id ASC
         LIMIT ?`,
      )
      .all(...selectParams) as MonitoringJobRow[];

    const insertRun = db.prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`,
    );

    const claimed: ClaimedJob[] = [];
    for (const job of due) {
      const info = insertRun.run(job.owner_id, job.id, now);
      claimed.push({ job, runId: info.lastInsertRowid as number });
    }
    return claimed;
  });
  // .immediate() runs the transaction with BEGIN IMMEDIATE. See block comment.
  return tx.immediate(input.now, input.limit);
}

// PR-A v2.7.0: aggregare pentru /api/v1/dashboard/summary. Numara joburile
// active grupate pe kind, owner-scoped. Tipurile pe care UI-ul nu le breakdown
// (e.g. aviz_rnpm) sunt incluse in suma totala dar nu separate — caller-ul
// decide cum sa le mapeze in DashboardJobsBlock.byKind.
export interface JobsByKindRow {
  kind: JobKind;
  n: number;
}

export function aggregateActiveJobsByKindForOwner(ownerId: string): JobsByKindRow[] {
  return getDb()
    .prepare(
      `SELECT kind, COUNT(*) AS n
       FROM monitoring_jobs
       WHERE owner_id = ? AND active = 1
       GROUP BY kind`,
    )
    .all(ownerId) as JobsByKindRow[];
}
