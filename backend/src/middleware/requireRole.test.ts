// PR-8 requireRole — role guard for admin surfaces.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { requireRole } from "./requireRole.ts";
import { ownerContext } from "./owner.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { insertUser, updateUserRole, updateUserStatus } from "../db/userRepository.ts";
import { getAuditEvents } from "../db/auditRepository.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-require-role-"));
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

function buildApp(roles: ("user" | "admin" | "support" | "readonly")[]) {
  const app = new Hono();
  app.use("*", ownerContext);
  app.get("/admin", requireRole(...roles), (c) => c.json({ ok: true, role: c.get("role") }));
  return app;
}

interface ErrorBody {
  error: { code: string; message: string };
}
interface OkBody {
  ok: boolean;
  role?: string;
}
async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("requireRole — gate behavior", () => {
  it("allows the seeded local user when role 'user' is allowed", async () => {
    const app = buildApp(["user", "admin"]);
    const res = await app.request("/admin");
    expect(res.status).toBe(200);
    const body = await jsonOf<OkBody>(res);
    expect(body).toEqual({ ok: true, role: "user" });
  });

  it("denies 403 when the user's role is not in the allowed list", async () => {
    const app = buildApp(["admin"]);
    const res = await app.request("/admin");
    expect(res.status).toBe(403);
    const body = await jsonOf<ErrorBody>(res);
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toMatch(/role/i);
  });

  it("allows after promoting the local user to admin", async () => {
    updateUserRole("local", "admin");
    const app = buildApp(["admin"]);
    const res = await app.request("/admin");
    expect(res.status).toBe(200);
  });

  it("denies 403 when the user is suspended", async () => {
    updateUserRole("local", "admin");
    updateUserStatus("local", "suspended");
    const app = buildApp(["admin"]);
    const res = await app.request("/admin");
    expect(res.status).toBe(403);
    const body = await jsonOf<ErrorBody>(res);
    expect(body.error.message).toMatch(/active/i);
  });

  it("denies 403 when the user is soft-deleted", async () => {
    updateUserRole("local", "admin");
    updateUserStatus("local", "deleted");
    const app = buildApp(["admin"]);
    const res = await app.request("/admin");
    expect(res.status).toBe(403);
  });

  it("supports a multi-role allowlist (admin OR support)", async () => {
    insertUser({ id: "supp", email: "s@x", displayName: "S", role: "support" });
    // Override ownerContext for this app so the request resolves to 'supp'.
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("ownerId", "supp");
      await next();
    });
    app.get("/admin", requireRole("admin", "support"), (c) => c.json({ ok: true, role: c.get("role") }));
    const res = await app.request("/admin");
    expect(res.status).toBe(200);
    const body = await jsonOf<OkBody>(res);
    expect(body.role).toBe("support");
  });

  it("returns 401 when the resolved user does not exist in DB", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("ownerId", "ghost-user");
      await next();
    });
    app.get("/admin", requireRole("admin"), (c) => c.json({ ok: true }));
    const res = await app.request("/admin");
    expect(res.status).toBe(401);
    const body = await jsonOf<ErrorBody>(res);
    expect(body.error.code).toBe("unauthorized");
  });

  it("throws at construction time when no roles are passed", () => {
    expect(() => requireRole()).toThrow(/at least one role/);
  });
});

describe("requireRole — audit trail on denial", () => {
  it("records auth.denied audit event when role mismatches", async () => {
    const app = buildApp(["admin"]);
    await app.request("/admin");
    const events = getAuditEvents({ ownerId: "local", action: "auth.denied" });
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("denied");
    const detail = JSON.parse(events[0].detail_json);
    expect(detail.reason).toBe("role_mismatch");
    expect(detail.role).toBe("user");
    expect(detail.required).toEqual(["admin"]);
  });

  it("records auth.denied audit event when user is inactive", async () => {
    updateUserRole("local", "admin");
    updateUserStatus("local", "suspended");
    const app = buildApp(["admin"]);
    await app.request("/admin");
    const events = getAuditEvents({ ownerId: "local", action: "auth.denied" });
    expect(events).toHaveLength(1);
    const detail = JSON.parse(events[0].detail_json);
    expect(detail.reason).toBe("user_inactive");
    expect(detail.status).toBe("suspended");
  });
});
