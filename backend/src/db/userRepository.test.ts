// PR-8 userRepository — list/get/update on the users table seeded by 0002.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getUserByEmail,
  getUserById,
  insertUser,
  listUsers,
  updateUserRole,
  updateUserStatus,
} from "./userRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-user-repo-"));
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

describe("userRepository — read paths", () => {
  it("getUserById returns the seeded local user", () => {
    const u = getUserById("local");
    expect(u).not.toBeNull();
    expect(u?.email).toBe("local@desktop");
    expect(u?.role).toBe("user");
    expect(u?.status).toBe("active");
  });

  it("getUserById returns null for missing id", () => {
    expect(getUserById("nope")).toBeNull();
  });

  it("getUserByEmail finds by email", () => {
    const u = getUserByEmail("local@desktop");
    expect(u?.id).toBe("local");
  });

  it("listUsers returns the seed row with total=1", () => {
    const r = listUsers();
    expect(r.total).toBe(1);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].id).toBe("local");
  });
});

describe("userRepository — list filters", () => {
  beforeEach(() => {
    insertUser({ id: "u-admin", email: "alice@firma.ro", displayName: "Alice", role: "admin" });
    insertUser({ id: "u-supp", email: "bob@firma.ro", displayName: "Bob Support", role: "support" });
    insertUser({ id: "u-user", email: "carol@firma.ro", displayName: "Carol", role: "user" });
    updateUserStatus("u-supp", "suspended");
  });

  it("filters by role", () => {
    const r = listUsers({ role: "admin" });
    expect(r.rows.map((x) => x.id)).toEqual(["u-admin"]);
    expect(r.total).toBe(1);
  });

  it("filters by status", () => {
    const r = listUsers({ status: "suspended" });
    expect(r.rows.map((x) => x.id)).toEqual(["u-supp"]);
  });

  it("search matches email substring", () => {
    const r = listUsers({ search: "alice" });
    expect(r.rows.map((x) => x.id)).toEqual(["u-admin"]);
  });

  it("search matches display_name substring", () => {
    const r = listUsers({ search: "Support" });
    expect(r.rows.map((x) => x.id)).toEqual(["u-supp"]);
  });

  it("limit + offset paginate without dropping total", () => {
    const page1 = listUsers({ limit: 2, offset: 0 });
    const page2 = listUsers({ limit: 2, offset: 2 });
    expect(page1.total).toBe(4);
    expect(page2.total).toBe(4);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);
    const ids = [...page1.rows, ...page2.rows].map((u) => u.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("userRepository — write paths", () => {
  it("updateUserRole changes role and echoes new state", () => {
    const updated = updateUserRole("local", "admin");
    expect(updated.role).toBe("admin");
    expect(getUserById("local")?.role).toBe("admin");
  });

  it("updateUserRole rejects unknown role", () => {
    expect(() => updateUserRole("local", "owner" as never)).toThrow(/invalid role/);
  });

  it("updateUserRole throws on missing user", () => {
    expect(() => updateUserRole("nope", "admin")).toThrow(/user not found/);
  });

  it("updateUserStatus changes status", () => {
    const updated = updateUserStatus("local", "suspended");
    expect(updated.status).toBe("suspended");
  });

  it("updateUserStatus rejects unknown status", () => {
    expect(() => updateUserStatus("local", "banned" as never)).toThrow(/invalid status/);
  });

  it("insertUser respects role + status defaults", () => {
    const u = insertUser({ id: "u-1", email: "x@y", displayName: "X" });
    expect(u.role).toBe("user");
    expect(u.status).toBe("active");
  });

  it("insertUser rejects unknown role at the type boundary", () => {
    expect(() => insertUser({ id: "u-2", email: "x@y", displayName: "X", role: "owner" as never })).toThrow(
      /invalid role/
    );
  });
});
