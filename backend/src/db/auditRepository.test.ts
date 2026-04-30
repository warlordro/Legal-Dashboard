// PR-2 verification suite for the auth shadow tables + audit_log + recordAudit().
//
// Coverage:
//   1. Migration 0002 actually creates `users`, `user_sessions`, `audit_log`.
//   2. Seed user 'local' exists post-migration.
//   3. CHECK constraints on role/status/outcome reject bad values.
//   4. user_sessions FK ON DELETE CASCADE removes sessions when user is deleted.
//   5. recordAudit (no context) writes a system-level event with NULL owner_id.
//   6. recordAudit (with Hono context) auto-fills owner_id, actor_id, ip, ua.
//   7. recordAudit explicit overrides win over context-derived fields.
//   8. recordAudit serializes detail_json safely (incl. circular fallback).
//   9. getAuditEvents owner-scoped read + system-event query (owner_id IS NULL).

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getAuditEvents,
  listAuditEvents,
  recordAudit,
  type AuditOutcome,
} from "./auditRepository.ts";
import { closeDb, getDb } from "./schema.ts";
import { ownerContext } from "../middleware/owner.ts";

let tmpRoot: string;
let dbPath: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-audit-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  // Touch the DB so getDb() takes the existing-file branch consistently with
  // the production path; the migration runner is what actually creates schema.
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("PR-2 migration 0002 — schema shape", () => {
  it("creates users / user_sessions / audit_log tables", () => {
    const db = getDb();
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name IN ('users','user_sessions','audit_log')
         ORDER BY name`,
      )
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(["audit_log", "user_sessions", "users"]);
  });

  it("seeds the synthetic 'local' user", () => {
    const db = getDb();
    const row = db
      .prepare(`SELECT id, email, display_name, role, status FROM users WHERE id = 'local'`)
      .get() as { id: string; email: string; display_name: string; role: string; status: string } | undefined;
    expect(row).toEqual({
      id: "local",
      email: "local@desktop",
      display_name: "Local User",
      role: "user",
      status: "active",
    });
  });

  it("records 0002 in _schema_versions with a real (non-sentinel) hash", () => {
    const db = getDb();
    const v2 = db
      .prepare(`SELECT version, sha256_up FROM _schema_versions WHERE version = 2`)
      .get() as { version: number; sha256_up: string } | undefined;
    expect(v2?.version).toBe(2);
    expect(v2?.sha256_up).toMatch(/^[0-9a-f]{64}$/);
    expect(v2?.sha256_up).not.toBe("__backfilled_v1__");
  });

  it("rejects invalid role / status on users via CHECK", () => {
    const db = getDb();
    expect(() =>
      db
        .prepare(`INSERT INTO users(id,email,display_name,role) VALUES (?,?,?,?)`)
        .run("u1", "u1@x", "U1", "BAD_ROLE"),
    ).toThrow(/CHECK/);

    expect(() =>
      db
        .prepare(`INSERT INTO users(id,email,display_name,status) VALUES (?,?,?,?)`)
        .run("u2", "u2@x", "U2", "BAD_STATUS"),
    ).toThrow(/CHECK/);
  });

  it("rejects invalid audit outcome via CHECK", () => {
    const db = getDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO audit_log(owner_id, actor_id, action, outcome) VALUES (?,?,?,?)`,
        )
        .run("local", "local", "test.bad", "MAYBE"),
    ).toThrow(/CHECK/);
  });

  it("user_sessions cascades on user delete", () => {
    const db = getDb();
    db
      .prepare(`INSERT INTO users(id,email,display_name) VALUES (?,?,?)`)
      .run("u1", "u1@x", "U1");
    db
      .prepare(
        `INSERT INTO user_sessions(id, user_id, token_hash, expires_at) VALUES (?,?,?,?)`,
      )
      .run("s1", "u1", "h1", "2099-01-01T00:00:00Z");

    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM user_sessions WHERE user_id='u1'`).get() as { n: number }).n,
    ).toBe(1);

    db.prepare(`DELETE FROM users WHERE id = 'u1'`).run();

    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM user_sessions WHERE user_id='u1'`).get() as { n: number }).n,
    ).toBe(0);
  });

  it("0002 is idempotent on a second runMigrations call", async () => {
    // Re-opening the same DB simulates an app restart. The runner must NOT try
    // to re-execute 0002 (would fail on duplicate CREATE TABLE).
    closeDb();
    delete process.env.LEGAL_DASHBOARD_DB_PATH;
    process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
    const db = getDb();
    const v2 = db
      .prepare(`SELECT COUNT(*) AS n FROM _schema_versions WHERE version = 2`)
      .get() as { n: number };
    expect(v2.n).toBe(1);
    // Local user was inserted exactly once across both boots.
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE id='local'`).get() as { n: number }).n,
    ).toBe(1);
  });
});

describe("recordAudit() — write paths", () => {
  it("writes a system-level event when context is null", () => {
    recordAudit(null, "system.boot", { detail: { version: "2.0.13" } });
    const events = getAuditEvents({ ownerId: null });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      owner_id: null,
      actor_id: null,
      action: "system.boot",
      outcome: "ok",
      ip: null,
      user_agent: null,
    });
    expect(JSON.parse(events[0].detail_json)).toEqual({ version: "2.0.13" });
  });

  it("auto-fills owner / actor / user-agent from Hono context", async () => {
    // Build a real Hono app + run a single request through ownerContext so the
    // c.get('ownerId') path is exercised end-to-end.
    const app = new Hono();
    app.use("*", ownerContext);
    app.post("/test", (c) => {
      recordAudit(c, "monitoring.create", {
        targetKind: "monitoring_job",
        targetId: "42",
        detail: { kind: "dosar_soap" },
      });
      return c.text("ok");
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: { "user-agent": "vitest/1.0" },
    });
    expect(res.status).toBe(200);

    const events = getAuditEvents({ ownerId: "local" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      owner_id: "local",
      actor_id: "local",
      action: "monitoring.create",
      target_kind: "monitoring_job",
      target_id: "42",
      outcome: "ok",
      user_agent: "vitest/1.0",
    });
    expect(JSON.parse(events[0].detail_json)).toEqual({ kind: "dosar_soap" });
  });

  it("explicit options override context-derived fields", async () => {
    const app = new Hono();
    app.use("*", ownerContext);
    app.post("/admin", (c) => {
      // Admin acting on tenant 'tenantA': actor stays 'admin-bob' but owner is 'tenantA'.
      recordAudit(c, "admin.suspend_user", {
        ownerId: "tenantA",
        actorId: "admin-bob",
        outcome: "denied",
        targetKind: "user",
        targetId: "victim-1",
      });
      return c.text("ok");
    });
    await app.request("/admin", { method: "POST" });

    const events = getAuditEvents({ ownerId: "tenantA" });
    expect(events).toHaveLength(1);
    expect(events[0].actor_id).toBe("admin-bob");
    expect(events[0].outcome).toBe("denied" satisfies AuditOutcome);
  });

  it("survives unserializable detail (BigInt / circular) via fallback", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    recordAudit(null, "test.circular", { detail: circular });
    const events = getAuditEvents({ ownerId: null, action: "test.circular" });
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].detail_json)).toEqual({ _audit_serialize_error: true });
  });
});

describe("getAuditEvents() — read paths", () => {
  it("scopes by ownerId and returns most recent first", () => {
    recordAudit(null, "evt.a", { ownerId: "alice", detail: { i: 1 } });
    recordAudit(null, "evt.b", { ownerId: "alice", detail: { i: 2 } });
    recordAudit(null, "evt.c", { ownerId: "bob", detail: { i: 3 } });

    const alice = getAuditEvents({ ownerId: "alice" });
    expect(alice).toHaveLength(2);
    expect(alice.map((e) => e.action)).toEqual(["evt.b", "evt.a"]);

    const bob = getAuditEvents({ ownerId: "bob" });
    expect(bob.map((e) => e.action)).toEqual(["evt.c"]);
  });

  it("filters system events with ownerId: null", () => {
    recordAudit(null, "system.boot");
    recordAudit(null, "user.login", { ownerId: "alice" });

    const sysEvents = getAuditEvents({ ownerId: null });
    expect(sysEvents.map((e) => e.action)).toEqual(["system.boot"]);
  });

  it("limit is clamped to a sane range", () => {
    for (let i = 0; i < 5; i++) recordAudit(null, "evt", { ownerId: "x" });
    expect(getAuditEvents({ ownerId: "x", limit: 2 })).toHaveLength(2);
    // limit <= 0 falls back to 1, not 0
    expect(getAuditEvents({ ownerId: "x", limit: 0 })).toHaveLength(1);
  });
});

describe("listAuditEvents() — admin filters + pagination", () => {
  beforeEach(() => {
    // Spread events across multiple owners + outcomes so the admin filters
    // have something to slice. Manually setting ts via raw SQL because
    // recordAudit uses datetime('now') and we need deterministic ordering for
    // the time-window tests.
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO audit_log
         (owner_id, actor_id, action, target_kind, target_id, outcome, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run("alice", "alice", "user.login", null, null, "ok", "2026-04-01T10:00:00Z");
    stmt.run("alice", "alice", "monitoring.create", "monitoring_job", "1", "ok", "2026-04-15T10:00:00Z");
    stmt.run("alice", "admin-bob", "admin.suspend_user", "user", "alice", "ok", "2026-04-20T10:00:00Z");
    stmt.run("bob", "bob", "user.login", null, null, "denied", "2026-04-22T10:00:00Z");
    stmt.run(null, null, "system.boot", null, null, "ok", "2026-04-25T10:00:00Z");
  });

  it("returns all owners + total when ownerId is undefined", () => {
    const r = listAuditEvents();
    expect(r.total).toBe(5);
    expect(r.rows).toHaveLength(5);
  });

  it("scopes to ownerId when provided", () => {
    const r = listAuditEvents({ ownerId: "alice" });
    expect(r.total).toBe(3);
    expect(r.rows.map((e) => e.action)).toEqual([
      "admin.suspend_user",
      "monitoring.create",
      "user.login",
    ]);
  });

  it("filters system events with ownerId: null", () => {
    const r = listAuditEvents({ ownerId: null });
    expect(r.total).toBe(1);
    expect(r.rows[0].action).toBe("system.boot");
  });

  it("filters by actorId (admin acting on tenant)", () => {
    const r = listAuditEvents({ actorId: "admin-bob" });
    expect(r.total).toBe(1);
    expect(r.rows[0].action).toBe("admin.suspend_user");
  });

  it("filters by exact action", () => {
    const r = listAuditEvents({ action: "user.login" });
    expect(r.total).toBe(2);
  });

  it("filters by action substring (LIKE)", () => {
    const r = listAuditEvents({ actionLike: "monitoring" });
    expect(r.total).toBe(1);
    expect(r.rows[0].action).toBe("monitoring.create");
  });

  it("filters by targetKind", () => {
    const r = listAuditEvents({ targetKind: "user" });
    expect(r.total).toBe(1);
    expect(r.rows[0].action).toBe("admin.suspend_user");
  });

  it("filters by outcome", () => {
    const r = listAuditEvents({ outcome: "denied" });
    expect(r.total).toBe(1);
    expect(r.rows[0].owner_id).toBe("bob");
  });

  it("since is a closed lower bound (ts >= since)", () => {
    const r = listAuditEvents({ since: "2026-04-20T10:00:00Z" });
    expect(r.total).toBe(3);
    // Includes the boundary row (admin.suspend_user @ 2026-04-20T10:00:00Z).
    expect(r.rows.some((e) => e.action === "admin.suspend_user")).toBe(true);
  });

  it("until is an open upper bound (ts < until)", () => {
    const r = listAuditEvents({ until: "2026-04-20T10:00:00Z" });
    expect(r.total).toBe(2);
    // Excludes the boundary row.
    expect(r.rows.some((e) => e.action === "admin.suspend_user")).toBe(false);
  });

  it("since + until tile windows without overlap", () => {
    const w1 = listAuditEvents({
      since: "2026-04-01T00:00:00Z",
      until: "2026-04-20T10:00:00Z",
    });
    const w2 = listAuditEvents({
      since: "2026-04-20T10:00:00Z",
      until: "2026-04-26T00:00:00Z",
    });
    const total = w1.total + w2.total;
    expect(total).toBe(5);
    const allIds = new Set([...w1.rows, ...w2.rows].map((e) => e.id));
    expect(allIds.size).toBe(total);
  });

  it("pagination returns total separate from page size", () => {
    const page1 = listAuditEvents({ limit: 2, offset: 0 });
    const page2 = listAuditEvents({ limit: 2, offset: 2 });
    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);
    const ids = new Set([...page1.rows, ...page2.rows].map((e) => e.id));
    expect(ids.size).toBe(4);
  });

  it("limit is clamped to [1, 500]", () => {
    const small = listAuditEvents({ limit: 0 });
    expect(small.rows).toHaveLength(1);
    const big = listAuditEvents({ limit: 99999 });
    expect(big.rows.length).toBeLessThanOrEqual(500);
  });
});
