import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { getDb } from "./schema.ts";
import { getActorId, getOwnerId } from "../middleware/owner.ts";
import { getRequestId } from "../middleware/requestId.ts";
import { escapeLikeMeta } from "../util/textNormalize.ts";

// Audit outcomes per PLAN-monitoring-webmode.md §2.4. Stored as TEXT with a
// CHECK constraint on the column, so divergence here vs DDL would surface as a
// SqliteError rather than silent garbage data.
export type AuditOutcome = "ok" | "denied" | "error";

export interface AuditOptions {
  outcome?: AuditOutcome;
  targetKind?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
  // Overrides for system / cross-user events. When `c` is provided these are
  // populated automatically; explicit values here win.
  ownerId?: string | null;
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  // v2.20.3 Grupul J — corelare audit_log <-> envelope `{data, error, requestId}`.
  // Cand `c` e prezent, e populat automat din `getRequestId(c)`.
  requestId?: string | null;
}

// Shape stored in detail_json. Routes/services that record audit events build
// a plain object; we serialize once at write time and rely on the column's
// JSON-text contract (no CHECK json_valid — see PLAN §2.2 header).
//
// v2.34.0 P0-2: cap 16KB pe payload. Fara cap, un caller (sau attacker) care
// pompeaza un blob mare in `detail` (de ex. monitoring snapshot diff) ar fi
// putut umfla DB-ul rapid — SQLite single-writer => coada blocata + disk fill
// DoS. Cand depasim limita, scriem un marker explicit cu lungimea originala
// si head-ul truncat (pastreaza vizibilitate operationala fara amplificare).
export const AUDIT_DETAIL_MAX_BYTES = 16 * 1024;

function serializeDetail(detail: Record<string, unknown> | null | undefined): string {
  if (detail == null) return "{}";
  let raw: string;
  try {
    raw = JSON.stringify(detail);
  } catch {
    // Circular ref or BigInt — log loudly, never throw out of an audit path.
    return JSON.stringify({ _audit_serialize_error: true });
  }
  if (raw.length > AUDIT_DETAIL_MAX_BYTES) {
    return JSON.stringify({
      _truncated: true,
      _originalLength: raw.length,
      _maxBytes: AUDIT_DETAIL_MAX_BYTES,
      head: raw.slice(0, AUDIT_DETAIL_MAX_BYTES - 200),
    });
  }
  return raw;
}

// Best-effort context extraction. Returns null fields rather than throwing so
// audit writes never block the actual user request.
function readContext(c: Context): {
  ownerId: string;
  actorId: string;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
} {
  const ownerId = getOwnerId(c);
  const actorId = getActorId(c);
  let ip: string | null = null;
  try {
    ip = getConnInfo(c).remote.address ?? null;
  } catch {
    ip = null;
  }
  const userAgent = c.req.header("user-agent") ?? null;
  // requestId middleware ruleaza inainte de orice audit write; daca lipseste
  // (de ex. tests care apeleaza recordAudit fara stack-ul middleware), normalizam
  // la null in loc de string gol.
  const ridRaw = getRequestId(c);
  const requestId = ridRaw && ridRaw.length > 0 ? ridRaw : null;
  return { ownerId, actorId, ip, userAgent, requestId };
}

// Primary write path. Two call shapes:
//   recordAudit(c, "monitoring.create", { targetKind: "monitoring_job", ... })
//   recordAudit(null, "system.boot", { detail: { version } })
// Synchronous because audit_log writes are infrequent (one per mutation, not
// per query) and we want callers to be able to record from any context without
// awaiting. Errors propagate — caller decides whether to swallow or surface.
export function recordAudit(c: Context | null, action: string, options: AuditOptions = {}): void {
  let ownerId: string | null = options.ownerId ?? null;
  let actorId: string | null = options.actorId ?? null;
  let ip: string | null = options.ip ?? null;
  let userAgent: string | null = options.userAgent ?? null;
  let requestId: string | null = options.requestId ?? null;

  if (c !== null) {
    const ctx = readContext(c);
    if (ownerId === null) ownerId = ctx.ownerId;
    if (actorId === null) actorId = ctx.actorId;
    if (ip === null) ip = ctx.ip;
    if (userAgent === null) userAgent = ctx.userAgent;
    if (requestId === null) requestId = ctx.requestId;
  }

  getDb()
    .prepare(
      `INSERT INTO audit_log
         (owner_id, actor_id, action, target_kind, target_id, outcome, ip, user_agent, detail_json, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ownerId,
      actorId,
      action,
      options.targetKind ?? null,
      options.targetId ?? null,
      options.outcome ?? "ok",
      ip,
      userAgent,
      serializeDetail(options.detail),
      requestId
    );
}

// Read helpers — used by tests today, by future admin UI later. Owner-scoped
// by default; `null` ownerId returns system-level events (matches DDL where
// owner_id is nullable for system events like 'system.boot').
export interface AuditRow {
  id: number;
  owner_id: string | null;
  actor_id: string | null;
  ts: string;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  outcome: AuditOutcome;
  ip: string | null;
  user_agent: string | null;
  detail_json: string;
  // v2.20.3: nullable pe randuri legacy (dinainte de migration 0017).
  request_id: string | null;
}

export function getAuditEvents(
  opts: {
    ownerId?: string | null;
    action?: string;
    limit?: number;
  } = {}
): AuditRow[] {
  const db = getDb();
  const where: string[] = [];
  const params: (string | number | null)[] = [];
  if (opts.ownerId !== undefined) {
    if (opts.ownerId === null) {
      where.push("owner_id IS NULL");
    } else {
      where.push("owner_id = ?");
      params.push(opts.ownerId);
    }
  }
  if (opts.action) {
    where.push("action = ?");
    params.push(opts.action);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
  return db
    .prepare(`SELECT * FROM audit_log ${whereSql} ORDER BY ts DESC, id DESC LIMIT ?`)
    .all(...params, limit) as AuditRow[];
}

// PR-8 admin viewer. Returns rows + total for pagination, supports filters used
// by the admin Audit page: time window (since / until, ISO strings), action
// substring, target kind/id, owner, actor. The "ownerId: undefined" case
// returns events from ALL owners (admin scope), distinct from "ownerId: null"
// which returns only system-level events.
export interface ListAuditEventsOpts {
  ownerId?: string | null | undefined;
  actorId?: string;
  action?: string;
  actionLike?: string;
  targetKind?: string;
  targetId?: string;
  outcome?: AuditOutcome;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  // v2.20.3: filtru exact pe request_id (admin Audit page poate jumpui de la
  // un envelope `{requestId}` la randul de audit corespunzator).
  requestId?: string;
}

export interface ListAuditEventsResult {
  rows: AuditRow[];
  total: number;
}

function clampAuditLimit(limit: number | undefined): number {
  const n = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : 50;
  if (n < 1) return 1;
  if (n > 500) return 500;
  return n;
}

function clampAuditOffset(offset: number | undefined): number {
  const n = typeof offset === "number" && Number.isFinite(offset) ? Math.floor(offset) : 0;
  return n < 0 ? 0 : n;
}

function buildAuditWhere(opts: ListAuditEventsOpts): {
  sql: string;
  params: (string | number | null)[];
} {
  const where: string[] = [];
  const params: (string | number | null)[] = [];
  if (opts.ownerId !== undefined) {
    if (opts.ownerId === null) {
      where.push("owner_id IS NULL");
    } else {
      where.push("owner_id = ?");
      params.push(opts.ownerId);
    }
  }
  if (opts.actorId) {
    where.push("actor_id = ?");
    params.push(opts.actorId);
  }
  if (opts.action) {
    where.push("action = ?");
    params.push(opts.action);
  }
  if (opts.actionLike) {
    // Escape user-controlled LIKE meta (% _ \) so admin search by "monitoring"
    // doesn't surface the entire table when somebody pastes "%". `action`
    // values are static identifiers — no diacritic handling needed here.
    where.push("action LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLikeMeta(opts.actionLike)}%`);
  }
  if (opts.targetKind) {
    where.push("target_kind = ?");
    params.push(opts.targetKind);
  }
  if (opts.targetId) {
    where.push("target_id = ?");
    params.push(opts.targetId);
  }
  if (opts.outcome) {
    where.push("outcome = ?");
    params.push(opts.outcome);
  }
  if (opts.since) {
    // Closed lower bound (ts >= since) — matches the AI usage windowing
    // convention (PR-7 hardening) so admins comparing audit events to AI
    // usage windows see consistent intervals.
    where.push("ts >= ?");
    params.push(opts.since);
  }
  if (opts.until) {
    // Open upper bound (ts < until) so successive windows tile without overlap.
    where.push("ts < ?");
    params.push(opts.until);
  }
  if (opts.requestId) {
    where.push("request_id = ?");
    params.push(opts.requestId);
  }
  return {
    sql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

// v2.20.3: retention purge — analog `purgeOldRuns` / `purgeOldAiUsage`.
// `audit_log` creste monoton pe productie cu ~1 INSERT per request mutant.
// Sterge randurile mai vechi de `retentionDays` (default 90, in scheduler).
// Window-ul e generos: pentru desktop e suficient (audit util operational
// ramane vizibil); pentru deploy web cu cerinte legale mai stricte, tuneaza
// constanta din `services/monitoring/scheduler.ts:AUDIT_LOG_RETENTION_DAYS`.
export function purgeOldAuditLog(retentionDays = 90): number {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  // v2.37.1 (review cluster 5): chunked ca purgeOldRuns — DELETE-ul unbounded
  // tinea write lock-ul pe un scan complet la primul purge pe instalari vechi.
  // Cu idx_audit_log_ts (0035) + LIMIT, fiecare batch elibereaza lock-ul rapid.
  const stmt = getDb().prepare(
    "DELETE FROM audit_log WHERE rowid IN (SELECT rowid FROM audit_log WHERE ts < ? LIMIT 1000)"
  );
  let total = 0;
  for (;;) {
    const info = stmt.run(cutoff);
    total += info.changes;
    if (info.changes < 1000) break;
  }
  return total;
}

export function listAuditEvents(opts: ListAuditEventsOpts = {}): ListAuditEventsResult {
  const db = getDb();
  const { sql: whereSql, params } = buildAuditWhere(opts);
  const limit = clampAuditLimit(opts.limit);
  const offset = clampAuditOffset(opts.offset);

  const rows = db
    .prepare(
      `SELECT * FROM audit_log ${whereSql}
       ORDER BY ts DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as AuditRow[];

  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${whereSql}`).get(...params) as { n: number };

  return { rows, total: totalRow.n };
}
