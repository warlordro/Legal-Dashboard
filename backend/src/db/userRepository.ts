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

// v2.42.0 (4.1): support/readonly raman in enum (randuri istorice valide) dar
// NU pot fi create din UI/import.
export const CREATABLE_USER_ROLES = ["user", "admin"] as const;
export type CreatableUserRole = (typeof CREATABLE_USER_ROLES)[number];

// UNICUL normalizator de email — folosit IDENTIC la creare individuala, import,
// seed si in bridge-ul oauth2 (lookup pe X-Forwarded-Email). Divergenta intre
// cai = useri creati care nu se pot loga.
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
    // v2.42.0 (4.1): fara filtru explicit de status, soft-deleted NU apar in
    // listari (raman in DB pentru audit). Efect corect in lant: guard-ul
    // "ultimul admin" nu numara adminii stersi.
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
  // COLLATE NOCASE: aceeasi semantica cu indexul unic idx_users_email_nocase
  // (0040) — lookup-ul si garantia de unicitate nu pot diverge.
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM users WHERE email = ? COLLATE NOCASE`).get(email) as
    | UserRow
    | undefined;
  return row ?? null;
}

// v2.43.x (admin rnpm storage): identitatile tuturor userilor pentru join-ul
// cu dimensiunile fisierelor rnpm/<stem>.db — fara paginare (lista e mica,
// conventia UserPicker), toate statusurile (fisierul unui user suspendat/sters
// ocupa disc la fel de mult). Ordinea (email ASC) e CONTRACT: UI nu re-sorteaza.
export function listAllUserIdentities(): Array<{
  id: string;
  email: string;
  display_name: string;
  status: UserStatus;
}> {
  const db = getDb();
  return db.prepare("SELECT id, email, display_name, status FROM users ORDER BY email ASC").all() as Array<{
    id: string;
    email: string;
    display_name: string;
    status: UserStatus;
  }>;
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

// Fix review v2.42.0: invariantul ">=1 admin activ" se verifica IN ACEEASI
// tranzactie cu write-ul si acopera ORICE admin, nu doar self. Guard-ul vechi
// de ruta avea doua lipsuri: (1) nu exista deloc check pe actiunile cross-admin
// si (2) intre requireRole (autorizarea actorului) si write sta await-ul de
// body — doua cereri reciproce (A suspenda B, B suspenda A) treceau amandoua
// de autorizare cand ambii erau inca activi si comiteau ambele write-uri =>
// 0 admini activi (lockout pe toata suprafata admin). Numaratoarea in
// tranzactie sincrona better-sqlite3 inchide ambele.
export class LastAdminError extends Error {
  constructor(id: string) {
    super(`last active admin: ${id}`);
    this.name = "LastAdminError";
  }
}

function assertNotLastActiveAdmin(id: string): void {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND id != ?")
    .get(id) as { n: number };
  if (row.n === 0) throw new LastAdminError(id);
}

export function updateUserRoleChecked(id: string, role: UserRole): UserRow {
  if (!USER_ROLES.includes(role)) throw new Error(`invalid role: ${role}`);
  const db = getDb();
  db.transaction(() => {
    const before = getUserById(id);
    if (before === null) throw new Error(`user not found: ${id}`);
    if (before.role === "admin" && before.status === "active" && role !== "admin") {
      assertNotLastActiveAdmin(id);
    }
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  }).immediate();
  return getUserById(id) as UserRow;
}

export function updateUserStatusChecked(id: string, status: UserStatus): UserRow {
  if (!USER_STATUSES.includes(status)) throw new Error(`invalid status: ${status}`);
  const db = getDb();
  db.transaction(() => {
    const before = getUserById(id);
    if (before === null) throw new Error(`user not found: ${id}`);
    if (before.role === "admin" && before.status === "active" && status !== "active") {
      assertNotLastActiveAdmin(id);
    }
    db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, id);
  }).immediate();
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

// v2.42.0 (4.1): creare in masa (import Excel) — o singura tranzactie sincrona
// better-sqlite3: ori intra toate randurile, ori niciunul. Rolul se re-valideaza
// contra CREATABLE in interior (defensiv fata de orice apelant viitor).
export interface BulkUserInput {
  id: string;
  email: string;
  displayName: string;
  role: CreatableUserRole;
}

// v2.42.0: soft-delete NU blocheaza re-provisionarea. Indexul unic NOCASE
// interzice un rand nou cu acelasi email, deci "re-adaugarea" unui email sters
// = reactivarea randului existent (status -> active, nume/rol din input,
// password_hash curatat — fara credentiale vechi reziduale). Identitatea (id)
// se pastreaza, deci istoricul de audit/cote/granturi ramane legat de cont.
// Statusurile activ/suspendat raman duplicate — doar "sters" e re-provisionabil.
export interface ReactivateUserInput {
  id: string;
  displayName: string;
  role: CreatableUserRole;
}

const REACTIVATE_SQL = `UPDATE users SET status = 'active', display_name = ?, role = ?, password_hash = NULL
   WHERE id = ? AND status = 'deleted'`;

export function reactivateDeletedUser(input: ReactivateUserInput): UserRow {
  if (!CREATABLE_USER_ROLES.includes(input.role)) {
    throw new Error(`invalid creatable role: ${input.role}`);
  }
  const result = getDb().prepare(REACTIVATE_SQL).run(input.displayName, input.role, input.id);
  if (result.changes === 0) {
    // Statusul s-a schimbat intre check si update (alt admin) — apelantul
    // trateaza ca duplicat.
    throw new Error(`user not deleted: ${input.id}`);
  }
  return getUserById(input.id) as UserRow;
}

// Import: insert-urile si reactivarile intr-O SINGURA tranzactie — ori intra
// tot raportul, ori nimic (promisiunea rutei la coliziune concurenta).
export function provisionUsersBulk(input: {
  inserts: readonly BulkUserInput[];
  reactivations: readonly ReactivateUserInput[];
}): void {
  const db = getDb();
  const insertStmt = db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, status)
     VALUES (?, ?, NULL, ?, ?, 'active')`
  );
  const reactivateStmt = db.prepare(REACTIVATE_SQL);
  const runAll = db.transaction(() => {
    for (const row of input.inserts) {
      if (!CREATABLE_USER_ROLES.includes(row.role)) {
        throw new Error(`invalid creatable role: ${row.role}`);
      }
      insertStmt.run(row.id, canonicalizeEmail(row.email), row.displayName, row.role);
    }
    for (const row of input.reactivations) {
      if (!CREATABLE_USER_ROLES.includes(row.role)) {
        throw new Error(`invalid creatable role: ${row.role}`);
      }
      const result = reactivateStmt.run(row.displayName, row.role, row.id);
      if (result.changes === 0) {
        throw new Error(`user not deleted: ${row.id}`);
      }
    }
  });
  runAll();
}

// Colisiune pe unicitatea emailului — apelantul o mapeaza pe 409. Doua surse:
// UNIQUE-ul case-sensitive din DDL-ul tabelei (0002, "users.email") si indexul
// case-insensitive idx_users_email_nocase (0040).
export function isUniqueEmailViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code ?? "";
  return (
    code.startsWith("SQLITE_CONSTRAINT") &&
    (err.message.includes("idx_users_email_nocase") || err.message.includes("users.email"))
  );
}
