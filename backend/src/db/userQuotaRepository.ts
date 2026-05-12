import { getDb } from "./schema.ts";

// PR-8 admin quota overrides. CRUD only — the AI rate-limit path that consumes
// these values lands in PR-9 alongside the web-mode quota tightening. Values
// are integer milli-USD to match ai_usage.cost_usd_milli precision.
//
// The key is (user_id, feature). `feature` is free-form text on the schema
// side (CHECK length > 0) — today the AI service emits values like
// "ai.single", "ai.multi", and we accept whatever the admin entered without a
// closed enum, so a future feature added in code does not require a DDL bump.

export interface QuotaOverrideRow {
  user_id: string;
  feature: string;
  daily_limit_usd_milli: number;
  updated_at: string;
  updated_by: string | null;
}

export interface UpsertOverrideInput {
  userId: string;
  feature: string;
  dailyLimitUsdMilli: number;
  updatedBy?: string | null;
}

const COLUMNS = "user_id, feature, daily_limit_usd_milli, updated_at, updated_by";

function assertFeature(feature: string): void {
  if (typeof feature !== "string" || feature.length === 0) {
    throw new Error("invalid feature: must be non-empty string");
  }
}

function assertLimit(milli: number): void {
  if (typeof milli !== "number" || !Number.isFinite(milli) || !Number.isInteger(milli) || milli < 0) {
    throw new Error("invalid daily_limit_usd_milli: must be non-negative integer");
  }
}

export function listOverridesForUser(userId: string): QuotaOverrideRow[] {
  return getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM user_quota_overrides
       WHERE user_id = ?
       ORDER BY feature ASC`
    )
    .all(userId) as QuotaOverrideRow[];
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

// Upsert because the admin UI is "set the limit" rather than "create vs edit".
// updated_at is refreshed on every call so the audit trail can show the most
// recent admin action (the audit_log row carries the diff; this column is for
// quick "when did this last change" lookups in admin lists).
export function upsertOverride(input: UpsertOverrideInput): QuotaOverrideRow {
  assertFeature(input.feature);
  assertLimit(input.dailyLimitUsdMilli);

  const db = getDb();
  db.prepare(
    `INSERT INTO user_quota_overrides
       (user_id, feature, daily_limit_usd_milli, updated_at, updated_by)
     VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(user_id, feature) DO UPDATE SET
       daily_limit_usd_milli = excluded.daily_limit_usd_milli,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`
  ).run(input.userId, input.feature, input.dailyLimitUsdMilli, input.updatedBy ?? null);

  return getOverride(input.userId, input.feature) as QuotaOverrideRow;
}

// Returns true if a row was deleted, false if the override did not exist.
// Caller can map false to a 404 if it cares, but DELETE is idempotent at the
// HTTP layer so we don't throw on a missing row.
export function deleteOverride(userId: string, feature: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM user_quota_overrides WHERE user_id = ? AND feature = ?`)
    .run(userId, feature);
  return result.changes > 0;
}
