// PR-8 userRepository — list/get/update on the users table seeded by 0002.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canonicalizeEmail,
  getUserByEmail,
  getUserById,
  insertUser,
  insertUsersBulk,
  isUniqueEmailViolation,
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
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
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

// ---------------------------------------------------------------------------
// v2.42.0 (4.1) — email canonic unic + bulk insert
// ---------------------------------------------------------------------------

describe("userRepository — canonicalizeEmail", () => {
  it("face trim + lowercase", () => {
    expect(canonicalizeEmail("  Alice@Example.TEST  ")).toBe("alice@example.test");
  });

  it("e idempotent", () => {
    expect(canonicalizeEmail(canonicalizeEmail("A@B.C"))).toBe("a@b.c");
  });
});

describe("userRepository — unicitate case-insensitive (0040)", () => {
  it("getUserByEmail gaseste indiferent de casing", () => {
    insertUser({ id: "u-1", email: "alice@firma.ro", displayName: "Alice" });
    expect(getUserByEmail("ALICE@FIRMA.RO")?.id).toBe("u-1");
    expect(getUserByEmail("Alice@Firma.Ro")?.id).toBe("u-1");
  });

  it("indexul unic respinge dublura care difera doar prin casing", () => {
    insertUser({ id: "u-1", email: "alice@firma.ro", displayName: "Alice" });
    let caught: unknown = null;
    try {
      insertUser({ id: "u-2", email: "ALICE@firma.ro", displayName: "Alice 2" });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(isUniqueEmailViolation(caught)).toBe(true);
  });

  it("isUniqueEmailViolation nu se declanseaza pe erori nelegate", () => {
    expect(isUniqueEmailViolation(new Error("boom"))).toBe(false);
    expect(isUniqueEmailViolation(null)).toBe(false);
  });
});

describe("userRepository — insertUsersBulk", () => {
  it("insereaza toate randurile intr-o tranzactie, cu email canonicalizat", () => {
    const created = insertUsersBulk([
      { id: "b-1", email: "  X@Firma.RO ", displayName: "X", role: "user" },
      { id: "b-2", email: "y@firma.ro", displayName: "Y", role: "admin" },
    ]);
    expect(created).toHaveLength(2);
    expect(created[0].email).toBe("x@firma.ro");
    expect(created[1].role).toBe("admin");
    expect(created.every((u) => u.status === "active")).toBe(true);
  });

  it("rollback complet: o coliziune de email anuleaza TOT batch-ul", () => {
    insertUser({ id: "u-1", email: "dublura@firma.ro", displayName: "Existent" });
    expect(() =>
      insertUsersBulk([
        { id: "b-1", email: "nou@firma.ro", displayName: "Nou", role: "user" },
        { id: "b-2", email: "DUBLURA@firma.ro", displayName: "Coliziune", role: "user" },
      ])
    ).toThrow();
    // Primul rand din batch NU a ramas in DB.
    expect(getUserByEmail("nou@firma.ro")).toBeNull();
  });

  it("respinge rolurile necreabile (support/readonly)", () => {
    expect(() =>
      insertUsersBulk([{ id: "b-1", email: "s@firma.ro", displayName: "S", role: "support" as never }])
    ).toThrow(/invalid creatable role/);
  });
});

describe("userRepository — soft-deleted exclusi din listari (4.1)", () => {
  beforeEach(() => {
    insertUser({ id: "u-del", email: "sters@firma.ro", displayName: "Sters" });
    updateUserStatus("u-del", "deleted");
  });

  it("listUsers fara filtru de status NU intoarce userii stersi", () => {
    const r = listUsers();
    expect(r.rows.map((u) => u.id)).not.toContain("u-del");
    expect(r.total).toBe(1); // doar seed-ul 'local'
  });

  it("filtrul explicit status=deleted ii intoarce (audit/debug)", () => {
    const r = listUsers({ status: "deleted" });
    expect(r.rows.map((u) => u.id)).toEqual(["u-del"]);
  });

  it("getUserByEmail ii vede in continuare (emailul ramane ocupat)", () => {
    expect(getUserByEmail("sters@firma.ro")?.id).toBe("u-del");
  });
});
