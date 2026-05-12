// PR-8 admin router — gate, CRUD, audit semantics.

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adminRouter } from "./admin.ts";
import { meRouter } from "./me.ts";
import { ownerContext } from "../middleware/owner.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser, updateUserRole, updateUserStatus, getUserById } from "../db/userRepository.ts";
import { listOverridesForUser } from "../db/userQuotaRepository.ts";
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
      body: JSON.stringify({ feature: "ai.single", dailyLimitUsdMilli: 5000 }),
    });
    expect(res.status).toBe(200);
    const stored = listOverridesForUser("u-1");
    expect(stored).toHaveLength(1);
    expect(stored[0].daily_limit_usd_milli).toBe(5000);
    expect(stored[0].updated_by).toBe("local");
    const events = getAuditEvents({ ownerId: "local", action: "admin.users.quota_upsert" });
    expect(events).toHaveLength(1);
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
    expect(stored[0].daily_limit_usd_milli).toBe(7500);
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
