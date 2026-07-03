import { getDb } from "./schema.ts";

// v2.32.0 quota extension. Tabel extins prin migration 0027 cu:
//   - period (day | week | month) - rolling window 24h / 7d / 30d
//   - limit_usd_milli NULLABLE - NULL inseamna unlimited (orice admin poate seta)
// Pastreaza cheia (user_id, feature) si CRUD-ul stabilit in PR-8.
// quotaGuard consuma rolling window din ai_usage in functie de period.

export type QuotaPeriod = "day" | "week" | "month";

export interface QuotaOverrideRow {
  user_id: string;
  feature: string;
  period: QuotaPeriod;
  limit_usd_milli: number | null;
  updated_at: string;
  updated_by: string | null;
}

export interface UpsertOverrideInput {
  userId: string;
  feature: string;
  period: QuotaPeriod;
  limitUsdMilli: number | null;
  updatedBy?: string | null;
}

const COLUMNS = "user_id, feature, period, limit_usd_milli, updated_at, updated_by";

const VALID_PERIODS: ReadonlySet<QuotaPeriod> = new Set(["day", "week", "month"]);

function assertFeature(feature: string): void {
  if (typeof feature !== "string" || feature.length === 0) {
    throw new Error("invalid feature: must be non-empty string");
  }
}

function assertPeriod(period: string): asserts period is QuotaPeriod {
  if (!VALID_PERIODS.has(period as QuotaPeriod)) {
    throw new Error("invalid period: must be day | week | month");
  }
}

// NULL = unlimited; orice numar trebuie sa fie integer non-negativ.
function assertLimit(milli: number | null): void {
  if (milli === null) return;
  if (typeof milli !== "number" || !Number.isFinite(milli) || !Number.isInteger(milli) || milli < 0) {
    throw new Error("invalid limit_usd_milli: must be null or non-negative integer");
  }
}

export function listOverridesForUser(userId: string, limit = 200): QuotaOverrideRow[] {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  return getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM user_quota_overrides
       WHERE user_id = ?
       ORDER BY feature ASC
       LIMIT ?`
    )
    .all(userId, boundedLimit) as QuotaOverrideRow[];
}

// v2.41.0: vedere globala pentru pagina admin Cote — toate override-urile
// active, cu identitatea userului atasata (fara sa fie nevoie de cautare).
export interface QuotaOverrideWithUserRow extends QuotaOverrideRow {
  user_email: string | null;
  user_display_name: string | null;
}

export function listAllOverrides(limit = 500): QuotaOverrideWithUserRow[] {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return getDb()
    .prepare(
      `SELECT o.user_id, o.feature, o.period, o.limit_usd_milli, o.updated_at, o.updated_by,
              u.email AS user_email, u.display_name AS user_display_name
       FROM user_quota_overrides o
       LEFT JOIN users u ON u.id = o.user_id
       ORDER BY o.updated_at DESC
       LIMIT ?`
    )
    .all(boundedLimit) as QuotaOverrideWithUserRow[];
}

export function getOverride(userId: string, feature: string): QuotaOverrideRow | null {
  const row = getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM user_quota_overrides
       WHERE user_id = ? AND feature = ?`
    )
    .get(userId, feature) as QuotaOverrideRow | undefined;
  return row ?? null;
}

// Upsert: admin UI e "set the limit" si nu "create vs edit". updated_at refresh
// la fiecare apel da audit timeline rapid; modificarile concrete merg in
// audit_log (diff). Acum accepta period si NULL limit (unlimited).
export function upsertOverride(input: UpsertOverrideInput): QuotaOverrideRow {
  assertFeature(input.feature);
  assertPeriod(input.period);
  assertLimit(input.limitUsdMilli);

  const db = getDb();
  db.prepare(
    `INSERT INTO user_quota_overrides
       (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(user_id, feature) DO UPDATE SET
       period = excluded.period,
       limit_usd_milli = excluded.limit_usd_milli,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`
  ).run(input.userId, input.feature, input.period, input.limitUsdMilli, input.updatedBy ?? null);

  return getOverride(input.userId, input.feature) as QuotaOverrideRow;
}

export function deleteOverride(userId: string, feature: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM user_quota_overrides WHERE user_id = ? AND feature = ?")
    .run(userId, feature);
  return result.changes > 0;
}
