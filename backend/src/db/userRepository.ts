import { getDb } from "./schema.ts";
import { escapeLikeMeta } from "../util/textNormalize.ts";
import { clampInt } from "../util/validation.ts";

// Roles and statuses must match the CHECK constraints from
// 0002_users_sessions_audit.up.sql. Drift here vs DDL would be caught by
// SqliteError on UPDATE rather than silent garbage.
export type UserRole = "user" | "admin" | "support" | "readonly";
export type UserStatus = "active" | "suspended" | "deleted";

export const USER_ROLES: readonly UserRole[] = ["user", "admin", "support", "readonly"];
export const USER_STATUSES: readonly UserStatus[] = ["active", "suspended", "deleted"];

// v2.42.0: rolurile care pot fi CREATE din UI (individual + import bulk).
// support/readonly exista in enum dar nu au consumatori la creare — un rand de
// import cu alt rol e respins ca invalid, nu acceptat silentios.
export const CREATABLE_USER_ROLES = ["user", "admin"] as const satisfies readonly UserRole[];

// Canonicalizatorul UNIC de email — folosit identic la creare (individual +
// import), la seed si in lookup-ul bridge-ului oauth2. Divergenta intre cai ar
// insemna useri creati corect care nu se pot loga.
export function canonicalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  last_login_at: string | null;
  meta_json: string;
}

export interface ListUsersOpts {
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  limit?: number;
  offset?: number;
}

export interface ListUsersResult {
  rows: UserRow[];
  total: number;
}

const COLUMNS = "id, email, display_name, role, status, created_at, last_login_at, meta_json";

// Caps mirror PR-3 conventions for paginated list endpoints. The 200 ceiling is
// generous for an admin UI; total count is returned separately so the UI can
// render pagination without re-querying.
function clampLimit(limit: number | undefined): number {
  return clampInt(limit, { min: 1, max: 200, def: 50 });
}

function clampOffset(offset: number | undefined): number {
  return clampInt(offset, { min: 0, max: Number.MAX_SAFE_INTEGER, def: 0 });
}

function buildWhere(opts: ListUsersOpts): { sql: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.search) {
    // Case-insensitive prefix-or-substring match across email + display_name.
    // SQLite LIKE is case-insensitive for ASCII by default, which covers all
    // Workspace addresses we'll see. Escape user-supplied LIKE meta (% _ \)
    // so an admin searching "%" doesn't surface every row in the table.
    const like = `%${escapeLikeMeta(opts.search)}%`;
    where.push("(email LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  if (opts.role) {
    where.push("role = ?");
    params.push(opts.role);
  }
  if (opts.status) {
    where.push("status = ?");
    params.push(opts.status);
  } else {
    // v2.42.0: fara filtru explicit, userii stersi (soft delete) NU apar —
    // raman in DB pentru audit/cote si se vad doar cerand status=deleted.
    // Efect secundar corect: guard-ul "ultimul admin" nu mai numara adminii
    // stersi ca admini ramasi (inainte, un rand deleted putea debloca gresit
    // demotarea ultimului admin real).
    where.push("status != 'deleted'");
  }
  return {
    sql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

export function listUsers(opts: ListUsersOpts = {}): ListUsersResult {
  const db = getDb();
  const { sql: whereSql, params } = buildWhere(opts);
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);

  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM users ${whereSql}
       ORDER BY created_at DESC, id ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as UserRow[];

  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM users ${whereSql}`).get(...params) as { n: number };

  return { rows, total: totalRow.n };
}

export function getUserById(id: string): UserRow | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return row ?? null;
}

export function getUserByEmail(email: string): UserRow | null {
  // COLLATE NOCASE: defense-in-depth peste canonicalizeEmail — un rand istoric
  // mixed-case nu poate ocoli lookup-ul (indexul unique 0040 e tot NOCASE).
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM users WHERE email = ? COLLATE NOCASE`).get(email) as
    | UserRow
    | undefined;
  return row ?? null;
}

// Returns the row AFTER the update so the route can echo the new state without
// a second SELECT. Throws if the user does not exist (caller maps to 404).
export function updateUserRole(id: string, role: UserRole): UserRow {
  if (!USER_ROLES.includes(role)) {
    throw new Error(`invalid role: ${role}`);
  }
  const db = getDb();
  const result = db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  if (result.changes === 0) {
    throw new Error(`user not found: ${id}`);
  }
  return getUserById(id) as UserRow;
}

export function updateUserStatus(id: string, status: UserStatus): UserRow {
  if (!USER_STATUSES.includes(status)) {
    throw new Error(`invalid status: ${status}`);
  }
  const db = getDb();
  const result = db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, id);
  if (result.changes === 0) {
    throw new Error(`user not found: ${id}`);
  }
  return getUserById(id) as UserRow;
}

// Convenience for tests / first-login flows. Caller is responsible for ID
// generation policy (today: 'local' on desktop; PR-9 will mint UUIDs).
export interface InsertUserInput {
  id: string;
  email: string;
  displayName: string;
  role?: UserRole;
  status?: UserStatus;
  passwordHash?: string | null;
}

export function insertUser(input: InsertUserInput): UserRow {
  const role: UserRole = input.role ?? "user";
  const status: UserStatus = input.status ?? "active";
  if (!USER_ROLES.includes(role)) throw new Error(`invalid role: ${role}`);
  if (!USER_STATUSES.includes(status)) throw new Error(`invalid status: ${status}`);
  getDb()
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(input.id, input.email, input.passwordHash ?? null, input.displayName, role, status);
  return getUserById(input.id) as UserRow;
}

// v2.42.0: violarea indexului unique 0040 (email NOCASE) — folosita de rutele
// de creare ca sa mapeze race-ul concurent la "duplicat" (409), nu la 500.
export function isUniqueEmailViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE" &&
    err.message.includes("users.email")
  );
}

// v2.42.0: insert bulk pentru importul din xlsx — O SINGURA tranzactie
// sincrona (fara await inauntru). Orice eroare (inclusiv UNIQUE pe un race
// concurent) face rollback complet: raportul nu minte cu `created` partial.
export function insertUsersBulk(rows: InsertUserInput[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, status)
     VALUES (?, ?, NULL, ?, ?, 'active')`
  );
  const run = db.transaction((batch: InsertUserInput[]) => {
    for (const r of batch) {
      const role: UserRole = r.role ?? "user";
      if (!USER_ROLES.includes(role)) throw new Error(`invalid role: ${role}`);
      stmt.run(r.id, r.email, r.displayName, role);
    }
  });
  run(rows);
}
