// PR-8 admin router — /api/v1/admin/{users,audit,users/:id/quota}.
//
// All routes are gated by requireRole('admin') so the frontend can render the
// Admin section conditionally without leaking the API surface to non-admins.
// Until PR-9 wires real auth, the local desktop user is 'user' role by default;
// admins promote themselves manually (see ACCEPTANCE-PR-8.md), at which point
// the Admin sidebar appears.
//
// Audit semantics:
//   - Reads (GET) do not record audit events. They are bounded and would
//     produce noise; the frontend already logs the page view.
//   - Writes (PATCH/PUT/DELETE) record one audit event per action with a
//     `before/after` diff in detail_json so an auditor can see exactly what
//     the admin changed without re-running queries.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import { recordAudit } from "../db/auditRepository.ts";
import { listAuditEvents } from "../db/auditRepository.ts";
import { requireRole } from "../middleware/requireRole.ts";
import {
  getUserById,
  listUsers,
  updateUserRole,
  updateUserStatus,
  USER_ROLES,
  USER_STATUSES,
  type UserRole,
  type UserStatus,
} from "../db/userRepository.ts";
import {
  deleteOverride,
  listOverridesForUser,
  upsertOverride,
} from "../db/userQuotaRepository.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { fail, ok } from "../util/envelope.ts";

// 4 KiB on bodies — admin payloads are tiny ({role}, {status}, {feature, dailyLimitUsdMilli}).
const ADMIN_BODY_LIMIT = 4096;
const limitAdminBody = bodyLimit({
  maxSize: ADMIN_BODY_LIMIT,
  onError: (c) => c.json(fail("payload_too_large", "Payload prea mare", c), 413),
});

const ListUsersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(200).optional(),
    role: z.enum(USER_ROLES as readonly [UserRole, ...UserRole[]]).optional(),
    status: z.enum(USER_STATUSES as readonly [UserStatus, ...UserStatus[]]).optional(),
  })
  .strict();

const UpdateRoleSchema = z
  .object({
    role: z.enum(USER_ROLES as readonly [UserRole, ...UserRole[]]),
  })
  .strict();

const UpdateStatusSchema = z
  .object({
    status: z.enum(USER_STATUSES as readonly [UserStatus, ...UserStatus[]]),
  })
  .strict();

const ListAuditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    ownerId: z.string().trim().min(1).max(200).optional(),
    actorId: z.string().trim().min(1).max(200).optional(),
    action: z.string().trim().min(1).max(200).optional(),
    actionLike: z.string().trim().min(1).max(200).optional(),
    targetKind: z.string().trim().min(1).max(80).optional(),
    targetId: z.string().trim().min(1).max(200).optional(),
    outcome: z.enum(["ok", "denied", "error"]).optional(),
    since: z.string().datetime({ offset: true }).optional(),
    until: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const UpsertQuotaSchema = z
  .object({
    feature: z.string().trim().min(1).max(80),
    // Integer milli-USD aligned with ai_usage.cost_usd_milli precision.
    dailyLimitUsdMilli: z.number().int().min(0).max(1_000_000_000),
  })
  .strict();

export const adminRouter = new Hono();

// All admin routes require admin role.
adminRouter.use("*", requireRole("admin"));

// ---------- Users ----------

adminRouter.get("/users", (c) => {
  const parsed = ListUsersQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return c.json(fail("invalid_query", "Query invalid", c, parsed.error.issues), 400);
  }
  const { page, pageSize, search, role, status } = parsed.data;
  const result = listUsers({
    search,
    role,
    status,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return c.json(
    ok(
      {
        rows: result.rows.map(toUserDto),
        page,
        pageSize,
        total: result.total,
      },
      c,
    ),
    200,
  );
});

adminRouter.get("/users/:id", (c) => {
  const id = c.req.param("id");
  const user = getUserById(id);
  if (user === null) {
    return c.json(fail("not_found", "Utilizatorul nu exista", c), 404);
  }
  return c.json(ok(toUserDto(user), c), 200);
});

adminRouter.patch("/users/:id/role", limitAdminBody, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = UpdateRoleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
  }

  const before = getUserById(id);
  if (before === null) {
    return c.json(fail("not_found", "Utilizatorul nu exista", c), 404);
  }

  // Self-demotion guardrail: refuse to remove the last admin's own role. Avoids
  // the foot-gun where an admin demotes themselves and locks the org out of
  // admin surfaces. If multiple admins exist the demotion is allowed because
  // the org still has at least one admin.
  if (
    id === getOwnerId(c)
    && before.role === "admin"
    && parsed.data.role !== "admin"
  ) {
    const otherAdmins = listUsers({ role: "admin" }).rows.filter((u) => u.id !== id);
    if (otherAdmins.length === 0) {
      recordAudit(c, "admin.users.demote_blocked", {
        outcome: "denied",
        targetKind: "user",
        targetId: id,
        detail: { reason: "last_admin", from: before.role, to: parsed.data.role },
      });
      return c.json(
        fail(
          "last_admin",
          "Nu te poti demota — esti singurul admin. Promoveaza un alt utilizator inainte.",
          c,
        ),
        409,
      );
    }
  }

  const updated = updateUserRole(id, parsed.data.role);
  recordAudit(c, "admin.users.update_role", {
    targetKind: "user",
    targetId: id,
    detail: { before: before.role, after: updated.role },
  });
  return c.json(ok(toUserDto(updated), c), 200);
});

adminRouter.patch("/users/:id/status", limitAdminBody, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = UpdateStatusSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
  }

  const before = getUserById(id);
  if (before === null) {
    return c.json(fail("not_found", "Utilizatorul nu exista", c), 404);
  }

  // Self-deactivation guardrail: an admin cannot set their own status to
  // anything but 'active'. They would lock themselves out and require DB
  // surgery to recover.
  if (id === getOwnerId(c) && parsed.data.status !== "active") {
    recordAudit(c, "admin.users.deactivate_blocked", {
      outcome: "denied",
      targetKind: "user",
      targetId: id,
      detail: { reason: "self", from: before.status, to: parsed.data.status },
    });
    return c.json(
      fail("self_deactivation", "Nu iti poti dezactiva propriul cont", c),
      409,
    );
  }

  const updated = updateUserStatus(id, parsed.data.status);
  recordAudit(c, "admin.users.update_status", {
    targetKind: "user",
    targetId: id,
    detail: { before: before.status, after: updated.status },
  });
  return c.json(ok(toUserDto(updated), c), 200);
});

// ---------- Audit ----------

adminRouter.get("/audit", (c) => {
  const parsed = ListAuditQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return c.json(fail("invalid_query", "Query invalid", c, parsed.error.issues), 400);
  }
  const {
    page,
    pageSize,
    ownerId,
    actorId,
    action,
    actionLike,
    targetKind,
    targetId,
    outcome,
    since,
    until,
  } = parsed.data;
  const result = listAuditEvents({
    ownerId,
    actorId,
    action,
    actionLike,
    targetKind,
    targetId,
    outcome,
    since,
    until,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return c.json(
    ok(
      {
        rows: result.rows.map((r) => ({
          id: r.id,
          ts: r.ts,
          ownerId: r.owner_id,
          actorId: r.actor_id,
          action: r.action,
          targetKind: r.target_kind,
          targetId: r.target_id,
          outcome: r.outcome,
          ip: r.ip,
          userAgent: r.user_agent,
          detail: safeJsonParse(r.detail_json),
        })),
        page,
        pageSize,
        total: result.total,
      },
      c,
    ),
    200,
  );
});

// ---------- Quota ----------

adminRouter.get("/users/:id/quota", (c) => {
  const id = c.req.param("id");
  const user = getUserById(id);
  if (user === null) {
    return c.json(fail("not_found", "Utilizatorul nu exista", c), 404);
  }
  const rows = listOverridesForUser(id).map((r) => ({
    feature: r.feature,
    dailyLimitUsdMilli: r.daily_limit_usd_milli,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
  return c.json(ok({ userId: id, overrides: rows }, c), 200);
});

adminRouter.put("/users/:id/quota", limitAdminBody, async (c) => {
  const id = c.req.param("id");
  const user = getUserById(id);
  if (user === null) {
    return c.json(fail("not_found", "Utilizatorul nu exista", c), 404);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = UpsertQuotaSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
  }
  const adminId = getOwnerId(c);
  const row = upsertOverride({
    userId: id,
    feature: parsed.data.feature,
    dailyLimitUsdMilli: parsed.data.dailyLimitUsdMilli,
    updatedBy: adminId,
  });
  recordAudit(c, "admin.users.quota_upsert", {
    targetKind: "user",
    targetId: id,
    detail: {
      feature: row.feature,
      dailyLimitUsdMilli: row.daily_limit_usd_milli,
    },
  });
  return c.json(
    ok(
      {
        feature: row.feature,
        dailyLimitUsdMilli: row.daily_limit_usd_milli,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      },
      c,
    ),
    200,
  );
});

adminRouter.delete("/users/:id/quota/:feature", (c) => {
  const id = c.req.param("id");
  const feature = c.req.param("feature");
  const user = getUserById(id);
  if (user === null) {
    return c.json(fail("not_found", "Utilizatorul nu exista", c), 404);
  }
  const removed = deleteOverride(id, feature);
  // Idempotent at HTTP layer: returning 200 either way keeps the admin UI
  // simple. Audit only records when something actually changed.
  if (removed) {
    recordAudit(c, "admin.users.quota_delete", {
      targetKind: "user",
      targetId: id,
      detail: { feature },
    });
  }
  return c.json(ok({ feature, removed }, c), 200);
});

// ---------- helpers ----------

function toUserDto(u: ReturnType<typeof getUserById>) {
  if (u === null) {
    throw new Error("toUserDto called with null");
  }
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    status: u.status,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { _parse_error: true, raw: s };
  }
}
