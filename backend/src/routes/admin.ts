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
import {
  getTenantKeys,
  isTenantKeyField,
  setCaptchaSettings,
  setTenantKey,
  type CaptchaMode,
  type CaptchaProvider,
  type TenantKeyField,
} from "../db/tenantKeysRepository.ts";
import { requireRole } from "../middleware/requireRole.ts";
import { QUOTA_FEATURES } from "../middleware/quotaGuard.ts";
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
  ALL_OVERRIDES_CAP,
  deleteOverride,
  listAllOverrides,
  listOverridesForUser,
  upsertOverride,
  type QuotaPeriod,
} from "../db/userQuotaRepository.ts";
import {
  ALL_ACTIVE_GRANTS_CAP,
  createGrant,
  getGrant,
  listAllActiveGrants,
  listGrantsForUser,
  revokeGrant,
  type QuotaGrantRow,
} from "../db/userQuotaGrantsRepository.ts";
import { getActorId, getOwnerId } from "../middleware/owner.ts";
import { validateKey } from "../services/keyValidation.ts";
import { truncateAuditText } from "../util/auditSanitize.ts";
import { ErrorCodes, fail, ok } from "../util/envelope.ts";

// 4 KiB on bodies — admin payloads are tiny ({role}, {status}, {feature, dailyLimitUsdMilli}).
const ADMIN_BODY_LIMIT = 4096;
const limitAdminBody = bodyLimit({
  maxSize: ADMIN_BODY_LIMIT,
  onError: (c) => c.json(fail(ErrorCodes.PAYLOAD_TOO_LARGE, "Payload prea mare", c), 413),
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
    // v2.20.3 Grupul J: filtru exact pe request_id pentru jump direct de la
    // envelope `{requestId}` la randul de audit. 8-128 chars per VALID_RID.
    requestId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_\-]{8,128}$/)
      .optional(),
  })
  .strict();

// v2.32.0: period + nullable limit. `limitUsdMilli` e canonical (null =
// unlimited). `dailyLimitUsdMilli` ramane acceptat ca alias legacy pentru
// clientii care nu au migrat inca; il mapam la limitUsdMilli + period='day'.
const UpsertQuotaSchema = z
  .object({
    feature: z.enum(QUOTA_FEATURES),
    period: z.enum(["day", "week", "month"]).optional(),
    limitUsdMilli: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    dailyLimitUsdMilli: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .strict()
  .refine((v) => v.limitUsdMilli !== undefined || v.dailyLimitUsdMilli !== undefined, {
    message: "limitUsdMilli sau dailyLimitUsdMilli sunt obligatorii",
    path: ["limitUsdMilli"],
  });

// v2.32.0 grant: one-shot extra over base cap. `extraUsdMilli` must be >0
// (refacing un grant cu 0 ar fi no-op). `expiresAt` ISO 8601 cu offset; tot
// stricteneste la "in viitor" (un grant care expira in trecut nu produce
// effect, doar audit noise).
const CreateGrantSchema = z
  .object({
    feature: z.enum(QUOTA_FEATURES),
    extraUsdMilli: z.number().int().min(1).max(1_000_000_000),
    expiresAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((v) => Date.parse(v.expiresAt) > Date.now(), {
    message: "expiresAt trebuie sa fie in viitor",
    path: ["expiresAt"],
  })
  .refine((v) => Date.parse(v.expiresAt) <= Date.now() + 365 * 86_400_000, {
    message: "expiresAt nu poate depasi 365 zile de la creare",
    path: ["expiresAt"],
  });

const RevokeGrantSchema = z
  .object({
    reason: z.string().trim().max(200).optional(),
  })
  .strict();

const PutTenantKeySchema = z
  .object({
    // Trim before persistence so paste-copies with trailing whitespace either
    // collapse to "" (clear path) or store the canonical key. Without the
    // transform, "   " bypassed the empty-string clear branch and got encrypted
    // verbatim, breaking AI calls at runtime.
    value: z
      .string()
      .max(4096)
      .transform((v) => v.trim()),
  })
  .strict();

const CaptchaSettingsSchema = z
  .object({
    provider: z.enum(["2captcha", "capsolver"]),
    mode: z.enum(["sequential", "race"]),
  })
  .strict();

export const adminRouter = new Hono();

// All admin routes require admin role.
adminRouter.use("*", requireRole("admin"));

// ---------- Users ----------

adminRouter.get("/users", (c) => {
  const parsed = ListUsersQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams.entries()));
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
      c
    ),
    200
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
  if (id === getOwnerId(c) && before.role === "admin" && parsed.data.role !== "admin") {
    const otherAdmins = listUsers({ role: "admin" }).rows.filter((u) => u.id !== id);
    if (otherAdmins.length === 0) {
      recordAudit(c, "admin.users.demote_blocked", {
        outcome: "denied",
        targetKind: "user",
        targetId: id,
        detail: { reason: "last_admin", from: before.role, to: parsed.data.role },
      });
      return c.json(
        fail("last_admin", "Nu te poti demota — esti singurul admin. Promoveaza un alt utilizator inainte.", c),
        409
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
    return c.json(fail("self_deactivation", "Nu iti poti dezactiva propriul cont", c), 409);
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
  const parsed = ListAuditQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams.entries()));
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
    requestId,
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
    requestId,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  if (shouldAuditAuditView(parsed.data)) {
    recordAudit(c, "audit.viewed", {
      targetKind: "audit_log",
      detail: {
        ownerId: ownerId ?? null,
        actorId: actorId ?? null,
        action: action ?? null,
        actionLike: actionLike ?? null,
        targetKind: targetKind ?? null,
        targetId: targetId ?? null,
        outcome: outcome ?? null,
        since: since ?? null,
        until: until ?? null,
        requestId: requestId ?? null,
        count: result.rows.length,
        total: result.total,
      },
    });
  }
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
          requestId: r.request_id,
        })),
        page,
        pageSize,
        total: result.total,
      },
      c
    ),
    200
  );
});

// ---------- Tenant API keys ----------

adminRouter.get("/keys", (c) => {
  const keys = getTenantKeys();
  return c.json(
    ok(
      {
        keys: {
          anthropic: toKeyStatus(keys.anthropic),
          openai: toKeyStatus(keys.openai),
          google: toKeyStatus(keys.google),
          openrouter: toKeyStatus(keys.openrouter),
          twocaptcha: toKeyStatus(keys.twocaptcha),
          capsolver: toKeyStatus(keys.capsolver),
        },
        captcha: {
          provider: keys.captchaProvider,
          mode: keys.captchaMode,
        },
        updatedAt: keys.updatedAt,
        updatedBy: keys.updatedBy,
      },
      c
    ),
    200
  );
});

adminRouter.put("/keys/captcha", limitAdminBody, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CaptchaSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
  }
  // Capture before-state for audit so an auditor can diff provider/mode without
  // querying a sibling row. Captcha key values stay redacted: only the
  // provider/mode strings (non-secret enums) appear in the audit detail.
  const prevKeys = getTenantKeys();
  const adminId = getActorId(c);
  setCaptchaSettings({
    provider: parsed.data.provider as CaptchaProvider,
    mode: parsed.data.mode as CaptchaMode,
    updatedBy: adminId,
  });
  recordAudit(c, "admin.tenantKeys.captchaSettings.update", {
    targetKind: "tenant_keys",
    targetId: "captcha",
    detail: {
      provider: parsed.data.provider,
      mode: parsed.data.mode,
      previous: { provider: prevKeys.captchaProvider, mode: prevKeys.captchaMode },
    },
  });
  return c.json(ok({ provider: parsed.data.provider, mode: parsed.data.mode }, c), 200);
});

adminRouter.put("/keys/:field", limitAdminBody, async (c) => {
  const field = c.req.param("field");
  if (!isTenantKeyField(field)) {
    return c.json(fail("invalid_field", "Camp cheie invalid", c), 404);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = PutTenantKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
  }

  const before = getTenantKeys()[field];
  const validation = await validateKey(field, parsed.data.value);
  if (!validation.valid) {
    return c.json(fail("INVALID_KEY", validation.reason ?? "Cheie invalida", c), 422);
  }

  const adminId = getActorId(c);
  setTenantKey(field, parsed.data.value, adminId);
  const after = getTenantKeys()[field];
  // `cleared: true` distinguishes an intentional delete (paste-empty / explicit
  // clear) from a save-empty-on-already-absent. Without it, an audit row for
  // an accidental deletion is indistinguishable from a benign "was never set".
  const cleared = parsed.data.value === "";
  const detail: Record<string, unknown> = {
    field,
    hadPrevious: before.length > 0,
    cleared,
    last4After: last4(after),
  };
  if (validation.validationSkipped) {
    detail.validationSkipped = true;
    if (validation.reason) detail.validationSkipReason = validation.reason;
  }
  recordAudit(c, "admin.tenantKeys.update", {
    targetKind: "tenant_keys",
    targetId: field,
    detail,
  });
  return c.json(ok({ field, ...toKeyStatus(after), validationSkipped: validation.validationSkipped === true }, c), 200);
});

// ---------- Quota ----------

// v2.41.0 (P5): vederea globala a paginii Cote — toate override-urile cu
// identitate user, fara selectie prealabila. `truncated` semnaleaza atingerea
// capului (500); UI-ul afiseaza o nota vizibila in acest caz.
adminRouter.get("/quota/overrides", (c) => {
  const rows = listAllOverrides();
  const overrides = rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    status: r.status,
    feature: r.feature,
    period: r.period,
    limitUsdMilli: r.limit_usd_milli,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
  return c.json(ok({ overrides, truncated: rows.length >= ALL_OVERRIDES_CAP }, c), 200);
});

adminRouter.get("/users/:id/quota", (c) => {
  const id = c.req.param("id");
  const user = getUserById(id);
  if (user === null) {
    return c.json(fail("not_found", "Utilizatorul nu exista", c), 404);
  }
  const rows = listOverridesForUser(id).map((r) => ({
    feature: r.feature,
    period: r.period,
    limitUsdMilli: r.limit_usd_milli,
    // Legacy alias: clientii vechi citesc dailyLimitUsdMilli ca numar. Cand
    // perioada nu e "day" nu mai are sens — emitem null ca sa fortam un upgrade
    // de client in loc sa surface-uim un numar inselator.
    dailyLimitUsdMilli: r.period === "day" ? r.limit_usd_milli : null,
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
  // Resolve canonical limit. New clients send limitUsdMilli (nullable=unlimited);
  // legacy clients send dailyLimitUsdMilli (numeric only, period implied 'day').
  // Refine garanteaza ca cel putin unul e definit.
  const usedLegacyAlias = parsed.data.limitUsdMilli === undefined && parsed.data.dailyLimitUsdMilli !== undefined;
  const limitUsdMilli: number | null = usedLegacyAlias
    ? (parsed.data.dailyLimitUsdMilli as number)
    : (parsed.data.limitUsdMilli as number | null);
  const period: QuotaPeriod = parsed.data.period ?? (usedLegacyAlias ? "day" : "day");

  const adminId = getOwnerId(c);
  const row = upsertOverride({
    userId: id,
    feature: parsed.data.feature,
    period,
    limitUsdMilli,
    updatedBy: adminId,
  });
  recordAudit(c, "admin.users.quota_upsert", {
    targetKind: "user",
    targetId: id,
    detail: {
      feature: row.feature,
      period: row.period,
      limitUsdMilli: row.limit_usd_milli,
    },
  });
  return c.json(
    ok(
      {
        feature: row.feature,
        period: row.period,
        limitUsdMilli: row.limit_usd_milli,
        dailyLimitUsdMilli: row.period === "day" ? row.limit_usd_milli : null,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      },
      c
    ),
    200
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

// ---------- Grants ----------

// v2.41.0 (P5): pandantul vederii globale pentru Granturi — doar granturile
// ACTIVE (nerevocate, neexpirate), cu identitate user + truncated la cap.
adminRouter.get("/grants/active", (c) => {
  const rows = listAllActiveGrants();
  const grants = rows.map((r) => ({
    ...toGrantDto(r),
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    status: r.status,
  }));
  return c.json(ok({ grants, truncated: rows.length >= ALL_ACTIVE_GRANTS_CAP }, c), 200);
});

adminRouter.get("/users/:id/grants", (c) => {
  const id = c.req.param("id");
  const user = getUserById(id);
  if (user === null) {
    return c.json(fail("not_found", "Utilizatorul nu exista", c), 404);
  }
  const rows = listGrantsForUser(id).map(toGrantDto);
  return c.json(ok({ userId: id, grants: rows }, c), 200);
});

adminRouter.post("/users/:id/grants", limitAdminBody, async (c) => {
  const id = c.req.param("id");
  const user = getUserById(id);
  if (user === null) {
    return c.json(fail("not_found", "Utilizatorul nu exista", c), 404);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = CreateGrantSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
  }
  const adminId = getOwnerId(c);
  const row = createGrant({
    userId: id,
    feature: parsed.data.feature,
    extraUsdMilli: parsed.data.extraUsdMilli,
    expiresAt: parsed.data.expiresAt,
    reason: parsed.data.reason ?? null,
    grantedBy: adminId,
  });
  recordAudit(c, "admin.users.grant_create", {
    targetKind: "user",
    targetId: id,
    detail: {
      grantId: row.id,
      feature: row.feature,
      extraUsdMilli: row.extra_usd_milli,
      expiresAt: row.expires_at,
      reason: truncateAuditText(row.reason, 200),
    },
  });
  return c.json(ok(toGrantDto(row), c), 201);
});

adminRouter.delete("/grants/:id", limitAdminBody, async (c) => {
  const rawId = c.req.param("id");
  const grantId = Number(rawId);
  if (!Number.isInteger(grantId) || grantId <= 0) {
    return c.json(fail("invalid_id", "ID grant invalid", c), 400);
  }
  const before = getGrant(grantId);
  if (before === null) {
    return c.json(fail("not_found", "Grant inexistent", c), 404);
  }
  const body = await c.req.json().catch(() => null);
  // Body opt: revocarea fara reason e acceptata. Daca body lipseste / e gol,
  // sarim peste parse strict si tratam reason ca undefined.
  let reason: string | null = null;
  if (body !== null && typeof body === "object") {
    const parsed = RevokeGrantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(fail("invalid_body", "Body invalid", c, parsed.error.issues), 400);
    }
    reason = parsed.data.reason ?? null;
  }
  const adminId = getOwnerId(c);
  const revoked = revokeGrant(grantId, adminId, reason);
  if (revoked) {
    recordAudit(c, "admin.users.grant_revoke", {
      targetKind: "user",
      targetId: before.user_id,
      detail: {
        grantId: before.id,
        feature: before.feature,
        extraUsdMilli: before.extra_usd_milli,
        reason: truncateAuditText(reason, 200),
      },
    });
  }
  // 200 in both cases (idempotent at HTTP) so the admin UI nu trebuie sa
  // discrimineze "deja revocat" vs "tocmai revocat".
  return c.json(ok({ id: grantId, revoked }, c), 200);
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

function shouldAuditAuditView(query: z.infer<typeof ListAuditQuerySchema>): boolean {
  if (query.action === "audit.viewed") return false;
  return Boolean(query.actorId || query.targetId || query.since || query.until || query.actionLike || query.requestId);
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { _parse_error: true, raw: s };
  }
}

function toKeyStatus(value: string): { set: boolean; last4: string | null } {
  return {
    set: value.length > 0,
    last4: last4(value),
  };
}

function last4(value: string): string | null {
  return value.length > 0 ? value.slice(-4) : null;
}

function toGrantDto(row: QuotaGrantRow): {
  id: number;
  userId: string;
  feature: string;
  extraUsdMilli: number;
  expiresAt: string;
  reason: string | null;
  grantedAt: string;
  grantedBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
} {
  return {
    id: row.id,
    userId: row.user_id,
    feature: row.feature,
    extraUsdMilli: row.extra_usd_milli,
    expiresAt: row.expires_at,
    reason: row.reason,
    grantedAt: row.granted_at,
    grantedBy: row.granted_by,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revokedReason: row.revoked_reason,
  };
}
