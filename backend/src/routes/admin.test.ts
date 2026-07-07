// PR-8 admin router — gate, CRUD, audit semantics.

import Database from "better-sqlite3";
import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adminRouter } from "./admin.ts";
import { meRouter } from "./me.ts";
import { ownerContext } from "../middleware/owner.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { getUserByEmail, insertUser, updateUserRole, updateUserStatus, getUserById } from "../db/userRepository.ts";
import { listOverridesForUser, upsertOverride } from "../db/userQuotaRepository.ts";
import { insertAiUsage } from "../db/aiUsageRepository.ts";
import { recordCaptchaUsage } from "../db/captchaUsageRepository.ts";
import { listGrantsForUser, sumActiveExtraMilli } from "../db/userQuotaGrantsRepository.ts";
import { getAuditEvents } from "../db/auditRepository.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-admin-route-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function buildApp(actAs = "local") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", actAs);
    await next();
  });
  app.use("*", requestIdContext);
  app.route("/api/v1/me", meRouter);
  app.route("/api/v1/admin", adminRouter);
  return app;
}

async function jsonOf(res: Response): Promise<{
  data: unknown;
  error?: { code: string; message: string; details?: unknown };
  requestId: string;
}> {
  return (await res.json()) as never;
}

// ---------------------------------------------------------------------------
// /me
// ---------------------------------------------------------------------------

describe("/api/v1/me", () => {
  it("returns the current user envelope", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/me");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({
      id: "local",
      email: "local@desktop",
      role: "user",
      status: "active",
    });
    expect(body.requestId).toMatch(/.+/);
  });

  it("returns 401 when ownerId resolves to nothing", async () => {
    const app = buildApp("ghost");
    const res = await app.request("/api/v1/me");
    expect(res.status).toBe(401);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("unauthorized");
  });
});

// ---------------------------------------------------------------------------
// admin gate
// ---------------------------------------------------------------------------

describe("/api/v1/admin — role gate", () => {
  it("non-admin gets 403 on every admin route", async () => {
    const app = buildApp(); // local user is role 'user'
    const r1 = await app.request("/api/v1/admin/users");
    expect(r1.status).toBe(403);
    const r2 = await app.request("/api/v1/admin/audit");
    expect(r2.status).toBe(403);
  });

  it("admin role gets 200", async () => {
    updateUserRole("local", "admin");
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users");
    expect(res.status).toBe(200);
  });

  it("suspended admin gets 403 (status check)", async () => {
    updateUserRole("local", "admin");
    updateUserStatus("local", "suspended");
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users");
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

describe("/api/v1/admin/users — list + filters + pagination", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
    insertUser({ id: "u-1", email: "alice@x", displayName: "Alice", role: "admin" });
    insertUser({ id: "u-2", email: "bob@x", displayName: "Bob", role: "user" });
    insertUser({ id: "u-3", email: "carol@x", displayName: "Carol Support", role: "support" });
    updateUserStatus("u-2", "suspended");
  });

  it("returns paginated rows + total", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users?page=1&pageSize=2");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as { rows: unknown[]; total: number; page: number; pageSize: number };
    expect(data.total).toBe(4);
    expect(data.rows).toHaveLength(2);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(2);
  });

  it("filters by role", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users?role=support");
    const body = await jsonOf(res);
    const rows = (body.data as { rows: { id: string }[] }).rows;
    expect(rows.map((r) => r.id)).toEqual(["u-3"]);
  });

  it("filters by status", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users?status=suspended");
    const body = await jsonOf(res);
    const rows = (body.data as { rows: { id: string }[] }).rows;
    expect(rows.map((r) => r.id)).toEqual(["u-2"]);
  });

  it("search matches email or display_name", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users?search=Support");
    const body = await jsonOf(res);
    const rows = (body.data as { rows: { id: string }[] }).rows;
    expect(rows.map((r) => r.id)).toEqual(["u-3"]);
  });

  it("rejects invalid role with 400", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users?role=owner");
    expect(res.status).toBe(400);
  });
});

describe("/api/v1/admin/users/:id — get one", () => {
  it("returns 200 + DTO", async () => {
    updateUserRole("local", "admin");
    insertUser({ id: "u-1", email: "a@x", displayName: "A" });
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({ id: "u-1", email: "a@x", displayName: "A" });
  });

  it("returns 404 when missing", async () => {
    updateUserRole("local", "admin");
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/nope");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /users/:id/role", () => {
  it("updates role + records audit with before/after", async () => {
    updateUserRole("local", "admin");
    insertUser({ id: "u-1", email: "a@x", displayName: "A" });
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/role", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "support" }),
    });
    expect(res.status).toBe(200);
    expect(getUserById("u-1")?.role).toBe("support");

    const events = getAuditEvents({ ownerId: "local", action: "admin.users.update_role" });
    expect(events).toHaveLength(1);
    const detail = JSON.parse(events[0].detail_json);
    expect(detail).toEqual({ before: "user", after: "support" });
    expect(events[0].target_kind).toBe("user");
    expect(events[0].target_id).toBe("u-1");
  });

  it("rejects 400 on invalid role", async () => {
    updateUserRole("local", "admin");
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/local/role", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "owner" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when target user missing", async () => {
    updateUserRole("local", "admin");
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/ghost/role", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(404);
  });

  it("blocks self-demotion when caller is the only admin", async () => {
    updateUserRole("local", "admin");
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/local/role", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });
    expect(res.status).toBe(409);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("last_admin");
    expect(getUserById("local")?.role).toBe("admin");
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.demote_blocked" });
    expect(events).toHaveLength(1);
  });

  it("allows self-demotion when another admin exists", async () => {
    updateUserRole("local", "admin");
    insertUser({ id: "u-1", email: "a@x", displayName: "A", role: "admin" });
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/local/role", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });
    expect(res.status).toBe(200);
    expect(getUserById("local")?.role).toBe("user");
  });
});

describe("PATCH /users/:id/status", () => {
  it("updates status + records audit with before/after", async () => {
    updateUserRole("local", "admin");
    insertUser({ id: "u-1", email: "a@x", displayName: "A" });
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/status", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "suspended" }),
    });
    expect(res.status).toBe(200);
    expect(getUserById("u-1")?.status).toBe("suspended");
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.update_status" });
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].detail_json)).toEqual({
      before: "active",
      after: "suspended",
    });
  });

  it("blocks self-deactivation", async () => {
    updateUserRole("local", "admin");
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/local/status", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "suspended" }),
    });
    expect(res.status).toBe(409);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("self_deactivation");
    expect(getUserById("local")?.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

describe("/api/v1/admin/audit", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO audit_log (owner_id, actor_id, action, target_kind, target_id, outcome, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run("alice", "alice", "user.login", null, null, "ok", "2026-04-01T10:00:00Z");
    stmt.run("bob", "bob", "user.login", null, null, "denied", "2026-04-22T10:00:00Z");
    stmt.run(null, null, "system.boot", null, null, "ok", "2026-04-25T10:00:00Z");
  });

  it("returns paginated rows + total across all owners", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/audit?page=1&pageSize=10");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as { rows: unknown[]; total: number };
    // 3 seeded above + auth.denied audit events written by requireRole on the
    // first call (none here — admin passes). Count the seeded set.
    expect(data.total).toBeGreaterThanOrEqual(3);
  });

  it("filters by since (closed lower bound)", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/audit?since=2026-04-22T10:00:00Z&pageSize=50");
    const body = await jsonOf(res);
    const rows = (body.data as { rows: { action: string; ts: string }[] }).rows;
    // Includes the boundary row.
    expect(rows.some((r) => r.action === "user.login" && r.ts.startsWith("2026-04-22"))).toBe(true);
    expect(rows.some((r) => r.ts.startsWith("2026-04-01"))).toBe(false);
  });

  it("filters by outcome", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/audit?outcome=denied");
    const body = await jsonOf(res);
    const rows = (body.data as { rows: { outcome: string }[] }).rows;
    expect(rows.every((r) => r.outcome === "denied")).toBe(true);
  });

  it("rejects malformed datetime with 400", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/audit?since=not-a-date");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// quota
// ---------------------------------------------------------------------------

describe("/api/v1/admin/users/:id/quota", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
    insertUser({ id: "u-1", email: "a@x", displayName: "A" });
  });

  it("GET returns empty overrides initially", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/quota");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toEqual({ userId: "u-1", overrides: [] });
  });

  it("PUT upserts an override + records audit", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", dailyLimitUsdMilli: 5000 }),
    });
    expect(res.status).toBe(200);
    const stored = listOverridesForUser("u-1");
    expect(stored).toHaveLength(1);
    expect(stored[0].limit_usd_milli).toBe(5000);
    expect(stored[0].period).toBe("day");
    expect(stored[0].updated_by).toBe("local");
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.quota_upsert" });
    expect(events).toHaveLength(1);
  });

  it("PUT accepts canonical {period, limitUsdMilli} payload", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", period: "week", limitUsdMilli: 25000 }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({
      feature: "ai",
      period: "week",
      limitUsdMilli: 25000,
      dailyLimitUsdMilli: null,
    });
    const stored = listOverridesForUser("u-1");
    expect(stored[0].period).toBe("week");
    expect(stored[0].limit_usd_milli).toBe(25000);
  });

  it("PUT accepts limitUsdMilli=null (unlimited)", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", period: "day", limitUsdMilli: null }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({
      feature: "ai",
      period: "day",
      limitUsdMilli: null,
      dailyLimitUsdMilli: null,
    });
    const stored = listOverridesForUser("u-1");
    expect(stored[0].limit_usd_milli).toBeNull();
  });

  it("PUT rejects body missing both limitUsdMilli and dailyLimitUsdMilli", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", period: "day" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET exposes legacy dailyLimitUsdMilli only when period=day", async () => {
    const app = buildApp();
    await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", period: "week", limitUsdMilli: 25000 }),
    });
    const res = await app.request("/api/v1/admin/users/u-1/quota");
    const body = await jsonOf(res);
    const overrides = (
      body.data as { overrides: { dailyLimitUsdMilli: number | null; limitUsdMilli: number | null }[] }
    ).overrides;
    expect(overrides[0].dailyLimitUsdMilli).toBeNull();
    expect(overrides[0].limitUsdMilli).toBe(25000);
  });

  it("PUT updates an existing override (idempotent upsert)", async () => {
    const app = buildApp();
    await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", dailyLimitUsdMilli: 1000 }),
    });
    const res = await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", dailyLimitUsdMilli: 7500 }),
    });
    expect(res.status).toBe(200);
    const stored = listOverridesForUser("u-1");
    expect(stored).toHaveLength(1);
    expect(stored[0].limit_usd_milli).toBe(7500);
  });

  it("PUT rejects invalid body (400)", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", dailyLimitUsdMilli: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT returns 404 for missing user", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/ghost/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", dailyLimitUsdMilli: 1000 }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE removes existing override + records audit", async () => {
    const app = buildApp();
    await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", dailyLimitUsdMilli: 1000 }),
    });
    const res = await app.request("/api/v1/admin/users/u-1/quota/ai", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({ feature: "ai", removed: true });
    expect(listOverridesForUser("u-1")).toEqual([]);
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.quota_delete" });
    expect(events).toHaveLength(1);
  });

  it("DELETE is idempotent (no row → no audit, still 200)", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/quota/ai", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect((body.data as { removed: boolean }).removed).toBe(false);
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.quota_delete" });
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// grants (v2.32.0)
// ---------------------------------------------------------------------------

describe("/api/v1/admin/users/:id/grants", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
    insertUser({ id: "u-1", email: "a@x", displayName: "A" });
    // v2.42.0 (5.2): grant vs nelimitat se exclud — grantul cere o baza finita.
    upsertOverride({ userId: "u-1", feature: "ai", period: "day", limitUsdMilli: 10_000 });
  });

  it("GET returns empty list initially", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/grants");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toEqual({ userId: "u-1", grants: [] });
  });

  it("POST creates grant + records audit + 201", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        feature: "ai",
        extraUsdMilli: 2500,
        expiresAt,
        reason: "boost vineri",
      }),
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({
      userId: "u-1",
      feature: "ai",
      extraUsdMilli: 2500,
      expiresAt,
      reason: "boost vineri",
      revokedAt: null,
    });
    const stored = listGrantsForUser("u-1");
    expect(stored).toHaveLength(1);
    expect(sumActiveExtraMilli("u-1", "ai")).toBe(2500);
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.grant_create" });
    expect(events).toHaveLength(1);
  });

  it("POST rejects expiresAt in the past with 400", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    const res = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", extraUsdMilli: 1000, expiresAt }),
    });
    expect(res.status).toBe(400);
  });

  it("POST rejects extraUsdMilli=0 with 400", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", extraUsdMilli: 0, expiresAt }),
    });
    expect(res.status).toBe(400);
  });

  it("POST returns 404 for missing user", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.request("/api/v1/admin/users/ghost/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", extraUsdMilli: 1000, expiresAt }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE revokes grant + records audit", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const createRes = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", extraUsdMilli: 3000, expiresAt }),
    });
    const { data } = await jsonOf(createRes);
    const grantId = (data as { id: number }).id;
    const res = await app.request(`/api/v1/admin/grants/${grantId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "fix typo" }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({ id: grantId, revoked: true });
    expect(sumActiveExtraMilli("u-1", "ai")).toBe(0);
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.grant_revoke" });
    expect(events).toHaveLength(1);
  });

  it("DELETE second time returns 200 + revoked:false (idempotent)", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const createRes = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", extraUsdMilli: 3000, expiresAt }),
    });
    const { data } = await jsonOf(createRes);
    const grantId = (data as { id: number }).id;
    await app.request(`/api/v1/admin/grants/${grantId}`, { method: "DELETE" });
    const res = await app.request(`/api/v1/admin/grants/${grantId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect((body.data as { revoked: boolean }).revoked).toBe(false);
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.grant_revoke" });
    // Audit doar la prima revocare reala; al doilea DELETE e no-op.
    expect(events).toHaveLength(1);
  });

  it("DELETE returns 404 for missing grant", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/grants/9999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("DELETE rejects non-numeric id with 400", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/grants/not-a-number", { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  // v2.42.0 (5.2): grant vs nelimitat se exclud.
  it("POST -> 422 unlimited_budget cand override-ul e explicit nelimitat (NULL)", async () => {
    upsertOverride({ userId: "u-1", feature: "ai", period: "day", limitUsdMilli: null });
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", extraUsdMilli: 1000, expiresAt }),
    });
    expect(res.status).toBe(422);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("unlimited_budget");
  });

  it("POST -> 422 unlimited_budget si pe pass-through (fara override, fara env default)", async () => {
    insertUser({ id: "u-free", email: "free@x", displayName: "Free" });
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.request("/api/v1/admin/users/u-free/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", extraUsdMilli: 1000, expiresAt }),
    });
    expect(res.status).toBe(422);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("unlimited_budget");
  });

  it("POST -> 201 cand baza vine DOAR din env-ul default (fix High din review)", async () => {
    insertUser({ id: "u-env", email: "env@x", displayName: "Env" });
    const original = process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI;
    process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI = "5000";
    try {
      const app = buildApp();
      const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
      const res = await app.request("/api/v1/admin/users/u-env/grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feature: "ai", extraUsdMilli: 1000, expiresAt }),
      });
      expect(res.status).toBe(201);
    } finally {
      if (original === undefined) {
        // biome-ignore lint/performance/noDelete: env-ul trebuie unset real.
        delete process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI;
      } else {
        process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI = original;
      }
    }
  });

  it("POST cu feature captcha.rnpm e respins de schema (granturi doar pe 'ai')", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "captcha.rnpm", extraUsdMilli: 1000, expiresAt }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /grants/:id/revoke revoca la fel ca DELETE (ruta noua, sectiunea 11)", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const createRes = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", extraUsdMilli: 3000, expiresAt }),
    });
    const { data } = await jsonOf(createRes);
    const grantId = (data as { id: number }).id;
    const res = await app.request(`/api/v1/admin/grants/${grantId}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "test revoke" }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({ id: grantId, revoked: true });
    expect(sumActiveExtraMilli("u-1", "ai")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Vederi globale (v2.41.0): GET /quota/overrides + GET /grants/active
// ---------------------------------------------------------------------------

describe("/api/v1/admin/quota/overrides + /grants/active (vederi globale)", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
    insertUser({ id: "u-1", email: "b@x", displayName: "B" });
    insertUser({ id: "u-2", email: "a@x", displayName: "A" });
  });

  it("GET /quota/overrides pe gol -> lista goala si truncated:false", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/quota/overrides");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toEqual({ overrides: [], truncated: false });
  });

  it("GET /quota/overrides intoarce toate override-urile cu identitate user, sortate pe email", async () => {
    const app = buildApp();
    await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", period: "day", limitUsdMilli: 5000 }),
    });
    await app.request("/api/v1/admin/users/u-2/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "captcha.rnpm", period: "week", limitUsdMilli: 50 }),
    });

    const res = await app.request("/api/v1/admin/quota/overrides");
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as {
      data: { overrides: Array<Record<string, unknown>>; truncated: boolean };
    };
    expect(body.data.truncated).toBe(false);
    expect(body.data.overrides).toHaveLength(2);
    // Sortare pe email: a@x (u-2) inaintea lui b@x (u-1).
    expect(body.data.overrides[0]).toMatchObject({
      userId: "u-2",
      email: "a@x",
      displayName: "A",
      feature: "captcha.rnpm",
      period: "week",
      limitUsdMilli: 50,
    });
    expect(body.data.overrides[1]).toMatchObject({ userId: "u-1", email: "b@x", feature: "ai" });
  });

  it("GET /quota/overrides este gate-uit pe admin (403 pentru user)", async () => {
    const app = buildApp("u-1");
    const res = await app.request("/api/v1/admin/quota/overrides");
    expect(res.status).toBe(403);
  });

  it("GET /grants/active intoarce doar granturile active, cu identitate user", async () => {
    const app = buildApp();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    // Baza finita pe ambii useri (grant vs nelimitat se exclud, 5.2).
    upsertOverride({ userId: "u-1", feature: "ai", period: "day", limitUsdMilli: 10_000 });
    upsertOverride({ userId: "u-2", feature: "ai", period: "day", limitUsdMilli: 10_000 });
    // Grant activ pe u-2.
    await app.request("/api/v1/admin/users/u-2/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", extraUsdMilli: 2500, expiresAt: future }),
    });
    // Grant revocat pe u-1 (creat, apoi revocat) — nu trebuie sa apara.
    const created = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai", extraUsdMilli: 1000, expiresAt: future }),
    });
    const createdBody = (await jsonOf(created)) as { data: { id: number } };
    await app.request(`/api/v1/admin/grants/${createdBody.data.id}`, { method: "DELETE" });

    const res = await app.request("/api/v1/admin/grants/active");
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as {
      data: { grants: Array<Record<string, unknown>>; truncated: boolean };
    };
    expect(body.data.truncated).toBe(false);
    expect(body.data.grants).toHaveLength(1);
    expect(body.data.grants[0]).toMatchObject({
      userId: "u-2",
      email: "a@x",
      displayName: "A",
      feature: "ai",
      extraUsdMilli: 2500,
    });
  });

  it("GET /grants/active pe gol -> lista goala si truncated:false", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/grants/active");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toEqual({ grants: [], truncated: false });
  });
});

// ---------------------------------------------------------------------------
// v2.42.0 (4.2/4.3/4.4) — creare individuala, import xlsx, guard last-admin
// ---------------------------------------------------------------------------

async function importXlsxOf(rows: (string | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Utilizatori");
  for (const row of rows) ws.addRow(row);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

describe("v2.42.0 — POST /users (creare individuala)", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
  });

  it("creeaza userul cu email canonicalizat si scrie audit", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "  Alice@Firma.RO ", displayName: "Alice", role: "user" }),
    });
    expect(res.status).toBe(201);
    const body = (await jsonOf(res)) as { data: { email: string; role: string; status: string } };
    expect(body.data).toMatchObject({ email: "alice@firma.ro", role: "user", status: "active" });

    const audits = getAuditEvents({ action: "admin.users.create" });
    expect(audits.some((a) => a.outcome === "ok")).toBe(true);
  });

  it("duplicat (chiar cu alt casing) -> 409 email_exists cu statusul contului in mesaj", async () => {
    const app = buildApp();
    insertUser({ id: "u-dub", email: "dub@firma.ro", displayName: "Dub" });
    updateUserStatus("u-dub", "suspended");

    const res = await app.request("/api/v1/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "DUB@FIRMA.RO", displayName: "Alt", role: "user" }),
    });
    expect(res.status).toBe(409);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("email_exists");
    expect(body.error?.message).toContain("suspendat");
  });

  it("email STERS se reactiveaza: 201, acelasi id, nume/rol din request, status activ", async () => {
    const app = buildApp();
    insertUser({ id: "u-del", email: "del@firma.ro", displayName: "Vechi" });
    updateUserStatus("u-del", "deleted");

    const res = await app.request("/api/v1/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "DEL@FIRMA.RO", displayName: "Nou Nume", role: "admin" }),
    });
    expect(res.status).toBe(201);
    const body = (await jsonOf(res)) as { data: { id: string; role: string; status: string; displayName: string } };
    expect(body.data).toMatchObject({ id: "u-del", role: "admin", status: "active", displayName: "Nou Nume" });

    const after = getUserByEmail("del@firma.ro");
    expect(after?.status).toBe("active");
    const audits = getAuditEvents({ action: "admin.users.create" });
    expect(audits.some((a) => a.outcome === "ok")).toBe(true);
  });

  it("rolurile necreabile (support) sunt respinse de schema", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "s@firma.ro", displayName: "S", role: "support" }),
    });
    expect(res.status).toBe(400);
  });

  it("e gate-uit pe admin (403 pentru user)", async () => {
    insertUser({ id: "u-plain", email: "plain@firma.ro", displayName: "Plain" });
    const app = buildApp("u-plain");
    const res = await app.request("/api/v1/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@firma.ro", displayName: "X", role: "user" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("v2.42.0 — import utilizatori (template + upload)", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
  });

  it("GET /users/import-template intoarce un xlsx attachment", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/import-template");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const bytes = new Uint8Array(await res.arrayBuffer());
    // xlsx = arhiva ZIP.
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it("importa randurile valide si raporteaza duplicate din DB + randuri invalide", async () => {
    const app = buildApp();
    insertUser({ id: "u-exist", email: "existent@firma.ro", displayName: "Existent" });

    const buf = await importXlsxOf([
      ["Email", "Nume afisat", "Rol"],
      ["nou1@firma.ro", "Nou 1", "Utilizator"],
      ["EXISTENT@firma.ro", "Dublura DB", ""],
      ["nou2@firma.ro", "Nou 2", "Admin"],
      ["rol-rau@firma.ro", "Rol rau", "sef"],
    ]);
    const res = await app.request("/api/v1/admin/users/import", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(buf),
    });
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as {
      data: {
        created: Array<{ rowNumber: number; email: string; role: string }>;
        issues: Array<{ rowNumber: number; code: string; message: string }>;
        summary: { created: number; duplicates: number; invalid: number };
      };
    };
    expect(body.data.summary).toEqual({ created: 2, duplicates: 1, invalid: 1 });
    expect(body.data.created.map((r) => r.email)).toEqual(["nou1@firma.ro", "nou2@firma.ro"]);
    // Issues sortate pe rowNumber.
    expect(body.data.issues.map((i) => [i.rowNumber, i.code])).toEqual([
      [3, "duplicate_in_db"],
      [5, "invalid_row"],
    ]);
    // Userii chiar exista, cu rolul cerut.
    expect(getUserByEmail("nou2@firma.ro")?.role).toBe("admin");
    // Audit: per user creat + sumar.
    expect(getAuditEvents({ action: "admin.users.create" }).length).toBe(2);
    expect(getAuditEvents({ action: "admin.users.import" }).length).toBe(1);
  });

  it("email STERS din fisier se reactiveaza si intra la creati, nu la duplicate", async () => {
    const app = buildApp();
    insertUser({ id: "u-del2", email: "sters@firma.ro", displayName: "Sters" });
    updateUserStatus("u-del2", "deleted");

    const buf = await importXlsxOf([
      ["Email", "Nume afisat", "Rol"],
      ["STERS@firma.ro", "Revenit", "Utilizator"],
      ["nou3@firma.ro", "Nou 3", "Admin"],
    ]);
    const res = await app.request("/api/v1/admin/users/import", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(buf),
    });
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as {
      data: {
        created: Array<{ rowNumber: number; email: string; role: string }>;
        issues: Array<{ rowNumber: number; code: string }>;
        summary: { created: number; duplicates: number; invalid: number };
      };
    };
    expect(body.data.summary).toEqual({ created: 2, duplicates: 0, invalid: 0 });
    expect(body.data.issues).toEqual([]);
    // Reactivat: acelasi id, nume/rol din fisier, status activ.
    const revived = getUserByEmail("sters@firma.ro");
    expect(revived).toMatchObject({ id: "u-del2", display_name: "Revenit", role: "user", status: "active" });
  });

  it("fisier care nu e xlsx -> 400 invalid_file", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/import", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: "email,nume\na@b.c,Test",
    });
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("invalid_file");
  });
});

// ---------------------------------------------------------------------------
// v2.42.0 (5.4) — audit: enrichment email + export xlsx
// ---------------------------------------------------------------------------

describe("v2.42.0 (5.4) — audit enrichment + export", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
  });

  it("GET /audit imbogateste owner/actor cu email; NULL devine 'system'", async () => {
    const app = buildApp();
    // Un eveniment cu owner cunoscut + unul de sistem.
    await app.request("/api/v1/admin/users/local/status", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    const { recordAudit } = await import("../db/auditRepository.ts");
    recordAudit(null, "system.test_event", { detail: {} });

    const res = await app.request("/api/v1/admin/audit?pageSize=50");
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as {
      data: { rows: Array<{ action: string; ownerEmail: string; actorEmail: string; ownerId: string | null }> };
    };
    const known = body.data.rows.find((r) => r.action === "admin.users.update_status");
    expect(known?.ownerEmail).toBe("local@desktop");
    const system = body.data.rows.find((r) => r.action === "system.test_event");
    expect(system?.ownerEmail).toBe("system");
    expect(system?.ownerId).toBeNull();
  });

  it("GET /audit/export cu interval invalid -> 400", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/audit/export?since=nu-e-data");
    expect(res.status).toBe(400);
  });

  it("GET /audit/export intoarce xlsx si scrie audit DUPA generare", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/audit/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    expect(getAuditEvents({ action: "admin.audit.export" })).toHaveLength(1);
  });

  it("GET /audit/export -> 413 too_many_rows peste cap, FARA sa incarce randuri", async () => {
    // Insert bulk direct — 10_001 randuri intr-o singura tranzactie.
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO audit_log (owner_id, actor_id, action, outcome, detail_json)
       VALUES ('local', 'local', 'bulk.test', 'ok', '{}')`
    );
    db.transaction(() => {
      for (let i = 0; i < 10_001; i++) stmt.run();
    })();

    const app = buildApp();
    const res = await app.request("/api/v1/admin/audit/export");
    expect(res.status).toBe(413);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("too_many_rows");
    // Evenimentul de export NU s-a scris (generarea nu a avut loc).
    expect(getAuditEvents({ action: "admin.audit.export" })).toHaveLength(0);
  });

  it("GET /audit/export e gate-uit pe admin (403 pentru user)", async () => {
    insertUser({ id: "u-audit-plain", email: "ap@x", displayName: "AP" });
    const app = buildApp("u-audit-plain");
    const res = await app.request("/api/v1/admin/audit/export");
    expect(res.status).toBe(403);
  });

  it("exportul respecta filtrul actorId, nu doar intervalul de date", async () => {
    const { recordAudit } = await import("../db/auditRepository.ts");
    recordAudit(null, "test.export_filter", { actorId: "user-a", ownerId: "user-a" });
    recordAudit(null, "test.export_filter", { actorId: "user-b", ownerId: "user-b" });

    const app = buildApp();
    const res = await app.request("/api/v1/admin/audit/export?actorId=user-a");
    expect(res.status).toBe(200);

    const buf = Buffer.from(await res.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Audit");
    const values: string[][] = [];
    sheet?.eachRow((row) => {
      values.push((row.values as unknown[]).map((v) => String(v ?? "")));
    });
    const filterRows = values.filter((row) => row.some((cell) => cell.includes("test.export_filter")));
    expect(filterRows).toHaveLength(1);
    // Asertie stransa pe coloana de ACTOR exact (nu `some` pe tot randul, care
    // ar trece si daca doar coloana Owner ar contine user-a).
    const headerRow = values[0];
    const actorCol = headerRow.indexOf("Actor");
    expect(actorCol).toBeGreaterThan(-1);
    expect(filterRows[0][actorCol]).toBe("user-a");
  });
});

// ---------------------------------------------------------------------------
// v2.42.0 (5.3) — GET /usage/overview
// ---------------------------------------------------------------------------

describe("v2.42.0 (5.3) — GET /usage/overview", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
    insertUser({ id: "uo-1", email: "b@x", displayName: "B" });
    insertUser({ id: "uo-2", email: "a@x", displayName: "A" });
  });

  it("itemele AI sunt sortate desc dupa consum, cu limitSource corect", async () => {
    upsertOverride({ userId: "uo-1", feature: "ai", period: "day", limitUsdMilli: 5000 });
    insertAiUsage({
      ownerId: "uo-1",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 100,
      ts: new Date().toISOString(),
    });
    insertAiUsage({
      ownerId: "uo-2",
      provider: "anthropic",
      model: "claude-sonnet",
      feature: "ai.multi",
      costUsdMilli: 900,
      ts: new Date().toISOString(),
    });

    const app = buildApp();
    const res = await app.request("/api/v1/admin/usage/overview");
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as {
      data: { items: Array<Record<string, unknown>>; captcha: Array<Record<string, unknown>>; truncated: boolean };
    };
    expect(body.data.truncated).toBe(false);
    // Sortare desc dupa consum: uo-2 (900) inaintea lui uo-1 (100).
    const idx2 = body.data.items.findIndex((i) => i.userId === "uo-2");
    const idx1 = body.data.items.findIndex((i) => i.userId === "uo-1");
    expect(idx2).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeLessThan(idx1);
    expect(body.data.items[idx2]).toMatchObject({
      email: "a@x",
      feature: "ai",
      usedMilli: 900,
      limitSource: "none",
      effectiveLimitMilli: null,
    });
    expect(body.data.items[idx1]).toMatchObject({
      usedMilli: 100,
      baseLimitMilli: 5000,
      limitSource: "override",
      effectiveLimitMilli: 5000,
    });
  });

  it("fereastra corecta: consum de acum 25h nu apare pe period=day", async () => {
    insertAiUsage({
      ownerId: "uo-1",
      provider: "openai",
      model: "gpt-5.4",
      feature: "dosar_summary",
      costUsdMilli: 777,
      ts: new Date(Date.now() - 25 * 3_600_000).toISOString(),
    });

    const app = buildApp();
    const res = await app.request("/api/v1/admin/usage/overview");
    const body = (await jsonOf(res)) as { data: { items: Array<{ userId: string; usedMilli: number }> } };
    const row = body.data.items.find((i) => i.userId === "uo-1");
    expect(row?.usedMilli).toBe(0);
  });

  it("userii inactivi (suspendati) nu apar", async () => {
    updateUserStatus("uo-2", "suspended");

    const app = buildApp();
    const res = await app.request("/api/v1/admin/usage/overview");
    const body = (await jsonOf(res)) as { data: { items: Array<{ userId: string }> } };
    expect(body.data.items.map((i) => i.userId)).not.toContain("uo-2");
  });

  it("captcha: numara doar source='tenant' (BYOK desktop nu intra)", async () => {
    recordCaptchaUsage({ ownerId: "uo-1", provider: "2captcha", source: "tenant" });
    recordCaptchaUsage({ ownerId: "uo-1", provider: "2captcha", source: "tenant" });
    recordCaptchaUsage({ ownerId: "uo-1", provider: "2captcha", source: "body" });

    const app = buildApp();
    const res = await app.request("/api/v1/admin/usage/overview");
    const body = (await jsonOf(res)) as { data: { captcha: Array<{ userId: string; usedCount: number }> } };
    const row = body.data.captcha.find((i) => i.userId === "uo-1");
    expect(row?.usedCount).toBe(2);
  });

  it("e gate-uit pe admin (403 pentru user)", async () => {
    insertUser({ id: "uo-plain", email: "plain2@x", displayName: "Plain" });
    const app = buildApp("uo-plain");
    const res = await app.request("/api/v1/admin/usage/overview");
    expect(res.status).toBe(403);
  });
});

describe("v2.42.0 (4.4) — last-admin numara doar adminii ACTIVI", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
  });

  it("singurul alt admin e suspendat -> self-demote refuzat cu 409 last_admin", async () => {
    insertUser({ id: "u-adm2", email: "adm2@firma.ro", displayName: "Admin 2", role: "admin" });
    updateUserStatus("u-adm2", "suspended");

    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/local/role", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });
    expect(res.status).toBe(409);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("last_admin");
    expect(getUserById("local")?.role).toBe("admin");
  });

  it("cu un alt admin ACTIV, self-demote e permis", async () => {
    insertUser({ id: "u-adm2", email: "adm2@firma.ro", displayName: "Admin 2", role: "admin" });

    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/local/role", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });
    expect(res.status).toBe(200);
    expect(getUserById("local")?.role).toBe("user");
  });
});
