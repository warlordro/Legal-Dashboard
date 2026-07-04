import { getDb } from "./schema.ts";

// v2.32.0 user_quota_grants - one-shot extra over base cap, per (user, feature).
// effectiveLimit in quotaGuard = baseLimit + sumActiveGrants(user, feature)
//   unde sumActiveGrants ignora revocate (revoked_at IS NULL) si expirate
//   (expires_at > now). Tabela e append-only pe acordari; revocare se face cu
//   SET revoked_at + revoked_by + revoked_reason fara DELETE - audit trail.

export interface QuotaGrantRow {
  id: number;
  user_id: string;
  feature: string;
  extra_usd_milli: number;
  expires_at: string;
  reason: string | null;
  granted_at: string;
  granted_by: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
}

export interface CreateGrantInput {
  userId: string;
  feature: string;
  extraUsdMilli: number;
  expiresAt: string;
  reason?: string | null;
  grantedBy: string;
}

const COLUMNS =
  "id, user_id, feature, extra_usd_milli, expires_at, reason, granted_at, granted_by, revoked_at, revoked_by, revoked_reason";

function assertFeature(feature: string): void {
  if (typeof feature !== "string" || feature.length === 0) {
    throw new Error("invalid feature: must be non-empty string");
  }
}

function assertPositiveInt(label: string, n: number): void {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`invalid ${label}: must be positive integer`);
  }
}

function assertIsoString(label: string, value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`invalid ${label}: must be non-empty ISO 8601 string`);
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`invalid ${label}: not a parseable date`);
  }
}

// v2.41.0: vedere globala pentru pagina admin Granturi — toate granturile
// ACTIVE (nerevocate, neexpirate), cu identitatea userului atasata, ca pagina
// sa le arate la deschidere fara cautarea prealabila a unui user.
export interface QuotaGrantWithUserRow extends QuotaGrantRow {
  user_email: string | null;
  user_display_name: string | null;
}

export function listAllActiveGrants(limit = 500): QuotaGrantWithUserRow[] {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return getDb()
    .prepare(
      `SELECT g.id, g.user_id, g.feature, g.extra_usd_milli, g.expires_at, g.reason,
              g.granted_at, g.granted_by, g.revoked_at, g.revoked_by, g.revoked_reason,
              u.email AS user_email, u.display_name AS user_display_name
       FROM user_quota_grants g
       LEFT JOIN users u ON u.id = g.user_id
       WHERE g.revoked_at IS NULL
         AND g.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       ORDER BY g.expires_at ASC, g.id ASC
       LIMIT ?`
    )
    .all(boundedLimit) as QuotaGrantWithUserRow[];
}

export function listGrantsForUser(userId: string, limit = 200): QuotaGrantRow[] {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  return getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM user_quota_grants
       WHERE user_id = ?
       ORDER BY granted_at DESC, id DESC
       LIMIT ?`
    )
    .all(userId, boundedLimit) as QuotaGrantRow[];
}

// SQLite quirk: datetime('now') returneaza 'YYYY-MM-DD HH:MM:SS' (spatiu);
// expires_at e stocat ISO 8601 ('YYYY-MM-DDTHH:MM:SS.sssZ'). Spatiul (0x20) <
// 'T' (0x54) face ca orice expires_at ISO sa fie mereu > datetime('now')
// lexicografic, indiferent de timpul real. Folosim strftime cu format ISO ca
// sa comparam coerent.
export function listActiveGrants(userId: string, feature: string): QuotaGrantRow[] {
  assertFeature(feature);
  return getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM user_quota_grants
       WHERE user_id = ? AND feature = ?
         AND revoked_at IS NULL
         AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       ORDER BY expires_at ASC, id ASC`
    )
    .all(userId, feature) as QuotaGrantRow[];
}

export function getGrant(id: number): QuotaGrantRow | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM user_quota_grants WHERE id = ?`).get(id) as
    | QuotaGrantRow
    | undefined;
  return row ?? null;
}

export function createGrant(input: CreateGrantInput): QuotaGrantRow {
  assertFeature(input.feature);
  assertPositiveInt("extra_usd_milli", input.extraUsdMilli);
  assertIsoString("expires_at", input.expiresAt);
  if (!input.grantedBy || input.grantedBy.length === 0) {
    throw new Error("invalid granted_by: must be non-empty string");
  }
  // CodeRabbit (confirmat): schema API accepta ISO cu offset (+02:00), dar
  // predicatele de "grant activ" compara stringuri cu boundary UTC — un
  // offset ne-normalizat ar strica comparatia lexicografica. Stocam mereu
  // forma UTC canonica.
  const expiresAtUtc = new Date(input.expiresAt).toISOString();
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO user_quota_grants
         (user_id, feature, extra_usd_milli, expires_at, reason, granted_at, granted_by)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`
    )
    .run(input.userId, input.feature, input.extraUsdMilli, expiresAtUtc, input.reason ?? null, input.grantedBy);
  return getGrant(Number(info.lastInsertRowid)) as QuotaGrantRow;
}

// revoke: idempotent — daca grant-ul e deja revocat sau lipsa, returnam false
// fara sa modificam nimic. Operatii de admin sunt de obicei sigure la dublu-clic.
export function revokeGrant(id: number, revokedBy: string, reason: string | null): boolean {
  if (!revokedBy || revokedBy.length === 0) {
    throw new Error("invalid revoked_by: must be non-empty string");
  }
  const info = getDb()
    .prepare(
      `UPDATE user_quota_grants
       SET revoked_at = datetime('now'),
           revoked_by = ?,
           revoked_reason = ?
       WHERE id = ? AND revoked_at IS NULL`
    )
    .run(revokedBy, reason, id);
  return info.changes > 0;
}

// sumActiveExtraMilli: suma cumulata de extra grant-uri active pentru
// (user, feature). Folosita de quotaGuard pentru effectiveLimit. Returneaza 0
// cand nu sunt rows active (NULL safe via COALESCE).
export function sumActiveExtraMilli(userId: string, feature: string): number {
  assertFeature(feature);
  // Vezi nota din listActiveGrants - acelasi fix pentru lexicographic ISO vs space.
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(extra_usd_milli), 0) AS total
       FROM user_quota_grants
       WHERE user_id = ? AND feature = ?
         AND revoked_at IS NULL
         AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
    .get(userId, feature) as { total: number };
  return row.total;
}
