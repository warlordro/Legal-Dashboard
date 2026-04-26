import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { getDb } from "./schema.ts";
import { getOwnerId } from "../middleware/owner.ts";

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
}

// Shape stored in detail_json. Routes/services that record audit events build
// a plain object; we serialize once at write time and rely on the column's
// JSON-text contract (no CHECK json_valid — see PLAN §2.2 header).
function serializeDetail(detail: Record<string, unknown> | null | undefined): string {
  if (detail == null) return "{}";
  try {
    return JSON.stringify(detail);
  } catch {
    // Circular ref or BigInt — log loudly, never throw out of an audit path.
    return JSON.stringify({ _audit_serialize_error: true });
  }
}

// Best-effort context extraction. Returns null fields rather than throwing so
// audit writes never block the actual user request.
function readContext(c: Context): {
  ownerId: string;
  actorId: string;
  ip: string | null;
  userAgent: string | null;
} {
  const ownerId = getOwnerId(c);
  // Until PR-9 wires real auth, actor === owner. Spec for PR-9: actor_id is the
  // authenticated user id (which may differ from owner_id when an admin
  // operates on another tenant).
  const actorId = ownerId;
  let ip: string | null = null;
  try {
    ip = getConnInfo(c).remote.address ?? null;
  } catch {
    ip = null;
  }
  const userAgent = c.req.header("user-agent") ?? null;
  return { ownerId, actorId, ip, userAgent };
}

// Primary write path. Two call shapes:
//   recordAudit(c, "monitoring.create", { targetKind: "monitoring_job", ... })
//   recordAudit(null, "system.boot", { detail: { version } })
// Synchronous because audit_log writes are infrequent (one per mutation, not
// per query) and we want callers to be able to record from any context without
// awaiting. Errors propagate — caller decides whether to swallow or surface.
export function recordAudit(
  c: Context | null,
  action: string,
  options: AuditOptions = {},
): void {
  let ownerId: string | null = options.ownerId ?? null;
  let actorId: string | null = options.actorId ?? null;
  let ip: string | null = options.ip ?? null;
  let userAgent: string | null = options.userAgent ?? null;

  if (c !== null) {
    const ctx = readContext(c);
    if (ownerId === null) ownerId = ctx.ownerId;
    if (actorId === null) actorId = ctx.actorId;
    if (ip === null) ip = ctx.ip;
    if (userAgent === null) userAgent = ctx.userAgent;
  }

  getDb()
    .prepare(
      `INSERT INTO audit_log
         (owner_id, actor_id, action, target_kind, target_id, outcome, ip, user_agent, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
}

export function getAuditEvents(opts: {
  ownerId?: string | null;
  action?: string;
  limit?: number;
} = {}): AuditRow[] {
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
