// PR-8 admin router — gate, CRUD, audit semantics.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ExcelJS from "exceljs";
import { adminRouter } from "./admin.ts";
import { meRouter } from "./me.ts";
import { ownerContext } from "../middleware/owner.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser, updateUserRole, updateUserStatus, getUserById } from "../db/userRepository.ts";
import { listOverridesForUser, upsertOverride } from "../db/userQuotaRepository.ts";
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

  it("GET /quota/overrides returneaza vederea globala cu identitatea userului", async () => {
    const app = buildApp();
    await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "captcha.rnpm", period: "day", limitUsdMilli: 25 }),
    });
    const res = await app.request("/api/v1/admin/quota/overrides");
    expect(res.status).toBe(200);
    const data = (await jsonOf(res)).data as { overrides: Array<Record<string, unknown>> };
    expect(data.overrides).toHaveLength(1);
    expect(data.overrides[0]).toMatchObject({
      userId: "u-1",
      userEmail: "a@x",
      userDisplayName: "A",
      feature: "captcha.rnpm",
      period: "day",
      limitUsdMilli: 25,
    });
  });

  it("GET /quota/overrides returneaza lista goala fara override-uri", async () => {
    const res = await buildApp().request("/api/v1/admin/quota/overrides");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toEqual({ overrides: [] });
  });

  it("PUT upserts an override + records audit", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", dailyLimitUsdMilli: 5000 }),
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
      body: JSON.stringify({ feature: "ai.single", period: "week", limitUsdMilli: 25000 }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({
      feature: "ai.single",
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
      body: JSON.stringify({ feature: "ai.single", period: "day", limitUsdMilli: null }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({
      feature: "ai.single",
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
      body: JSON.stringify({ feature: "ai.single", period: "day" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET exposes legacy dailyLimitUsdMilli only when period=day", async () => {
    const app = buildApp();
    await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", period: "week", limitUsdMilli: 25000 }),
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
      body: JSON.stringify({ feature: "ai.single", dailyLimitUsdMilli: 1000 }),
    });
    const res = await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", dailyLimitUsdMilli: 7500 }),
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
      body: JSON.stringify({ feature: "ai.single", dailyLimitUsdMilli: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT returns 404 for missing user", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/ghost/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", dailyLimitUsdMilli: 1000 }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE removes existing override + records audit", async () => {
    const app = buildApp();
    await app.request("/api/v1/admin/users/u-1/quota", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", dailyLimitUsdMilli: 1000 }),
    });
    const res = await app.request("/api/v1/admin/users/u-1/quota/ai.single", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({ feature: "ai.single", removed: true });
    expect(listOverridesForUser("u-1")).toEqual([]);
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.quota_delete" });
    expect(events).toHaveLength(1);
  });

  it("DELETE is idempotent (no row → no audit, still 200)", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/u-1/quota/ai.single", {
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
    // v2.42.0: grant si nelimitat se exclud — grantul cere o limita existenta.
    upsertOverride({ userId: "u-1", feature: "ai.single", period: "day", limitUsdMilli: 10_000 });
  });

  it("refuza grantul cu 422 cand bugetul pe feature e nelimitat (fara override)", async () => {
    insertUser({ id: "u-unlim", email: "unlim@x", displayName: "U" });
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.request("/api/v1/admin/users/u-unlim/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", extraUsdMilli: 2500, expiresAt }),
    });
    expect(res.status).toBe(422);
    expect((await jsonOf(res)).error?.code).toBe("unlimited_budget");
    expect(listGrantsForUser("u-unlim")).toHaveLength(0);
  });

  it("refuza grantul cu 422 si cand override-ul e explicit NULL (nelimitat)", async () => {
    insertUser({ id: "u-null", email: "null@x", displayName: "N" });
    upsertOverride({ userId: "u-null", feature: "ai.single", period: "day", limitUsdMilli: null });
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.request("/api/v1/admin/users/u-null/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", extraUsdMilli: 2500, expiresAt }),
    });
    expect(res.status).toBe(422);
    expect((await jsonOf(res)).error?.code).toBe("unlimited_budget");
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
        feature: "ai.single",
        extraUsdMilli: 2500,
        expiresAt,
        reason: "boost vineri",
      }),
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.data).toMatchObject({
      userId: "u-1",
      feature: "ai.single",
      extraUsdMilli: 2500,
      expiresAt,
      reason: "boost vineri",
      revokedAt: null,
    });
    const stored = listGrantsForUser("u-1");
    expect(stored).toHaveLength(1);
    expect(sumActiveExtraMilli("u-1", "ai.single")).toBe(2500);
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.grant_create" });
    expect(events).toHaveLength(1);
  });

  it("GET /grants/active returneaza vederea globala cu identitatea userului", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", extraUsdMilli: 2500, expiresAt }),
    });
    const res = await app.request("/api/v1/admin/grants/active");
    expect(res.status).toBe(200);
    const data = (await jsonOf(res)).data as { grants: Array<Record<string, unknown>> };
    expect(data.grants).toHaveLength(1);
    expect(data.grants[0]).toMatchObject({
      userId: "u-1",
      userEmail: "a@x",
      userDisplayName: "A",
      feature: "ai.single",
      extraUsdMilli: 2500,
      revokedAt: null,
    });
  });

  it("GET /grants/active exclude granturile revocate", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const createRes = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", extraUsdMilli: 2500, expiresAt }),
    });
    const grantId = ((await jsonOf(createRes)) as { data: { id: number } }).data.id;
    await app.request(`/api/v1/admin/grants/${grantId}`, { method: "DELETE" });
    const res = await app.request("/api/v1/admin/grants/active");
    const data = (await jsonOf(res)).data as { grants: unknown[] };
    expect(data.grants).toHaveLength(0);
  });

  it("POST rejects expiresAt in the past with 400", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    const res = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", extraUsdMilli: 1000, expiresAt }),
    });
    expect(res.status).toBe(400);
  });

  it("POST rejects extraUsdMilli=0 with 400", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", extraUsdMilli: 0, expiresAt }),
    });
    expect(res.status).toBe(400);
  });

  it("POST returns 404 for missing user", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.request("/api/v1/admin/users/ghost/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", extraUsdMilli: 1000, expiresAt }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE revokes grant + records audit", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const createRes = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", extraUsdMilli: 3000, expiresAt }),
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
    expect(sumActiveExtraMilli("u-1", "ai.single")).toBe(0);
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.grant_revoke" });
    expect(events).toHaveLength(1);
  });

  it("DELETE second time returns 200 + revoked:false (idempotent)", async () => {
    const app = buildApp();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const createRes = await app.request("/api/v1/admin/users/u-1/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "ai.single", extraUsdMilli: 3000, expiresAt }),
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
});

// ---------------------------------------------------------------------------
// v2.42.0 — raport audit exportabil (xlsx)
// ---------------------------------------------------------------------------

describe("GET /api/v1/admin/audit/export", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
  });

  it("genereaza xlsx valid si inregistreaza exportul in audit", async () => {
    const app = buildApp();
    // Produce macar un eveniment auditat inainte de export.
    await app.request("/api/v1/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "audit@firma.ro", displayName: "Audit", role: "user" }),
    });
    const res = await app.request("/api/v1/admin/audit/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(getAuditEvents({ ownerId: "local", action: "admin.audit.export" })).toHaveLength(1);
    // Actorul apare cu eticheta umana (email — nume), nu cu ID-ul brut.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Audit");
    let foundHumanActor = false;
    ws?.eachRow((row) => {
      const actor = String(row.getCell(5).value ?? "");
      if (actor.includes("local@desktop")) foundHumanActor = true;
    });
    expect(foundHumanActor).toBe(true);
  });

  it("listarea audit ataseaza emailul owner/actor (rezolvat server-side)", async () => {
    const app = buildApp();
    await app.request("/api/v1/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "lista@firma.ro", displayName: "Lista", role: "user" }),
    });
    const res = await app.request("/api/v1/admin/audit?action=admin.users.create");
    const data = (await jsonOf(res)).data as { rows: Array<{ actorEmail: string | null }> };
    expect(data.rows[0].actorEmail).toBe("local@desktop");
  });

  it("interval fara evenimente: raport valid (gol), nu eroare", async () => {
    const res = await buildApp().request("/api/v1/admin/audit/export?until=2000-01-01T00:00:00.000Z");
    expect(res.status).toBe(200);
  });

  it("query invalid => 400", async () => {
    const res = await buildApp().request("/api/v1/admin/audit/export?since=nu-e-data");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// v2.42.0 — creare useri (individual + import bulk din xlsx)
// ---------------------------------------------------------------------------

async function xlsxOf(rows: Array<Array<string>>, sheetName = "Utilizatori"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(["Email", "Nume afisat", "Rol"]);
  for (const r of rows) ws.addRow(r);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as unknown as ArrayBuffer);
}

function postImport(app: Hono, buf: Buffer) {
  return app.request("/api/v1/admin/users/import", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array(buf),
  });
}

describe("POST /api/v1/admin/users (individual)", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
  });

  it("creeaza userul (email canonicalizat), 201 + audit cu targetId", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "  Ana@Firma.RO ", displayName: "Ana Pop", role: "user" }),
    });
    expect(res.status).toBe(201);
    const data = (await jsonOf(res)).data as { id: string; email: string };
    expect(data.email).toBe("ana@firma.ro");
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.create" });
    expect(events).toHaveLength(1);
    expect(events[0].target_id).toBe(data.id);
  });

  it("refuza duplicatul cu 409 si include statusul existent (mixed-case inclus)", async () => {
    insertUser({ id: "u-dup", email: "ana@firma.ro", displayName: "Ana", status: "suspended" });
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ANA@FIRMA.RO", displayName: "Ana 2", role: "user" }),
    });
    expect(res.status).toBe(409);
    const body = await jsonOf(res);
    expect(body.error?.code).toBe("email_exists");
    expect(String(body.error?.message)).toContain("suspended");
  });

  it("respinge rol necreabil (readonly/support) si body invalid cu 400", async () => {
    const app = buildApp();
    for (const role of ["readonly", "support", "bogus"]) {
      const res = await app.request("/api/v1/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "x@y.ro", displayName: "X", role }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("indexul unique 0040 respinge dublura case-different la nivel de DB", async () => {
    insertUser({ id: "u-1", email: "dublu@firma.ro", displayName: "A" });
    expect(() => insertUser({ id: "u-2", email: "DUBLU@firma.ro", displayName: "B" })).toThrowError(/UNIQUE/i);
  });
});

describe("GET /api/v1/admin/users/import-template + POST /users/import", () => {
  beforeEach(() => {
    updateUserRole("local", "admin");
  });

  it("template-ul e xlsx valid, header-only pe sheet-ul de date", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/import-template");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const data = wb.getWorksheet("Utilizatori");
    expect(data).toBeDefined();
    expect(data?.actualRowCount).toBe(1); // doar header — fara rand exemplu importabil
    expect(wb.getWorksheet("Instructiuni")).toBeDefined();
  });

  it("importa randurile valide si claseaza restul (invalid / dup-fisier / dup-db)", async () => {
    insertUser({ id: "u-db", email: "existent@firma.ro", displayName: "Vechi" });
    const app = buildApp();
    const buf = await xlsxOf([
      ["ana@firma.ro", "Ana Pop", "user"],
      ["Dan@Firma.ro", "Dan Ion", ""], // rol gol => user; email canonicalizat
      ["ana@firma.ro", "Ana Dublura", "user"], // duplicate_in_file
      ["existent@firma.ro", "Exista", "user"], // duplicate_in_db
      ["fara-arond", "Nume", "user"], // invalid email
      ["rol@firma.ro", "Rol Gresit", "readonly"], // rol necreabil => invalid
    ]);
    const res = await postImport(app, buf);
    expect(res.status).toBe(200);
    const data = (await jsonOf(res)).data as {
      created: Array<{ email: string }>;
      issues: Array<{ status: string; email: string }>;
      summary: { created: number; duplicates: number; invalid: number };
    };
    expect(data.summary).toEqual({ created: 2, duplicates: 2, invalid: 2 });
    expect(data.created.map((c) => c.email).sort()).toEqual(["ana@firma.ro", "dan@firma.ro"]);
    // Userii chiar exista si sunt logabili prin bridge (status active).
    const dan = (await jsonOf(await app.request("/api/v1/admin/users?search=dan%40firma.ro"))).data as {
      rows: Array<{ email: string; status: string }>;
    };
    expect(dan.rows[0]).toMatchObject({ email: "dan@firma.ro", status: "active" });
    // Audit: 2 x create + 1 x import summary.
    expect(getAuditEvents({ ownerId: "local", action: "admin.users.create" })).toHaveLength(2);
    expect(getAuditEvents({ ownerId: "local", action: "admin.users.import" })).toHaveLength(1);
  });

  it("accepta etichetele umane de rol din template (Utilizator/Admin, case-insensitive)", async () => {
    const app = buildApp();
    const buf = await xlsxOf([
      ["eticheta1@firma.ro", "Eticheta Unu", "Utilizator"],
      ["eticheta2@firma.ro", "Eticheta Doi", "ADMIN"],
    ]);
    const res = await postImport(app, buf);
    expect(res.status).toBe(200);
    const data = (await jsonOf(res)).data as { summary: { created: number; invalid: number } };
    expect(data.summary).toMatchObject({ created: 2, invalid: 0 });
    const rows = (await jsonOf(await app.request("/api/v1/admin/users?search=eticheta2"))).data as {
      rows: Array<{ role: string }>;
    };
    expect(rows.rows[0].role).toBe("admin");
  });

  it("template-ul are dropdown de rol (data validation lista) pe coloana C", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/admin/users/import-template");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const dv = wb.getWorksheet("Utilizatori")?.getCell("C2").dataValidation;
    expect(dv?.type).toBe("list");
    expect(String(dv?.formulae?.[0])).toContain("Utilizator");
    expect(String(dv?.formulae?.[0])).toContain("Admin");
  });

  it("respinge non-xlsx cu 400 (magic bytes), nu 500", async () => {
    const app = buildApp();
    const res = await postImport(app, Buffer.from("email,nume,rol\nana@firma.ro,Ana,user\n", "utf8"));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error?.code).toBe("invalid_file");
  });

  it("respinge fisierul fara randuri de date cu 400", async () => {
    const app = buildApp();
    const res = await postImport(app, await xlsxOf([]));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error?.code).toBe("empty_file");
  });

  it("respinge peste 500 de randuri cu 413", async () => {
    const app = buildApp();
    const rows = Array.from({ length: 501 }, (_, i) => [`u${i}@firma.ro`, `User ${i}`, "user"]);
    const res = await postImport(app, await xlsxOf(rows));
    expect(res.status).toBe(413);
    expect((await jsonOf(res)).error?.code).toBe("too_many_rows");
  });

  it("sheet-ul Instructiuni e ignorat cand exista sheet-ul Utilizatori", async () => {
    const app = buildApp();
    const wb = new ExcelJS.Workbook();
    const instr = wb.addWorksheet("Instructiuni");
    instr.addRow(["exemplu@firma.ro", "Exemplu", "user"]);
    const data = wb.addWorksheet("Utilizatori");
    data.addRow(["Email", "Nume afisat", "Rol"]);
    data.addRow(["real@firma.ro", "Real", "user"]);
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
    const res = await postImport(app, buf);
    const parsed = (await jsonOf(res)).data as { created: Array<{ email: string }> };
    expect(parsed.created.map((c) => c.email)).toEqual(["real@firma.ro"]);
  });
});
