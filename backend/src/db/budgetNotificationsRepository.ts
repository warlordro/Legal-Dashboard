import { getDb } from "./schema.ts";

// v2.32.0 budget_notifications - state machine pentru soft warning (80%).
// NU dedup pe (period_start, period_end) pentru ca rolling window misca
// period_start la fiecare request. Episode lifecycle:
//   1. usedPct >= 80 prima oara → fire (set above_threshold_since + fired_at)
//   2. usedPct ramane >= 80 → no-op (fired_at already set, cleared_at NULL)
//   3. usedPct < 80 → clear (set cleared_at, reset above_threshold_since/fired_at)
//   4. Banner visible cand fired_at IS NOT NULL AND cleared_at IS NULL
// Un singur row per (user, feature, threshold_pct).

export interface BudgetNotificationRow {
  user_id: string;
  feature: string;
  threshold_pct: number;
  above_threshold_since: string | null;
  fired_at: string | null;
  email_sent_at: string | null;
  cleared_at: string | null;
  updated_at: string;
}

const COLUMNS =
  "user_id, feature, threshold_pct, above_threshold_since, fired_at, email_sent_at, cleared_at, updated_at";

function assertFeature(feature: string): void {
  if (typeof feature !== "string" || feature.length === 0) {
    throw new Error("invalid feature: must be non-empty string");
  }
}

function assertThreshold(pct: number): void {
  // v2.32.0 doar 80 e suportat; viitor 50/90 vor extinde aici si CHECK-ul SQL.
  if (pct !== 80) {
    throw new Error("invalid threshold_pct: only 80 supported in v2.32.0");
  }
}

export function getState(userId: string, feature: string, thresholdPct: number): BudgetNotificationRow | null {
  assertFeature(feature);
  assertThreshold(thresholdPct);
  const row = getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM budget_notifications
       WHERE user_id = ? AND feature = ? AND threshold_pct = ?`
    )
    .get(userId, feature, thresholdPct) as BudgetNotificationRow | undefined;
  return row ?? null;
}

// Returneaza true daca acesta e fire-ul nou (caller-ul trebuie sa dispatch
// email + banner). false = deja firat in episodul curent (no-op).
export function fireWarning(input: {
  userId: string;
  feature: string;
  thresholdPct: number;
}): boolean {
  assertFeature(input.feature);
  assertThreshold(input.thresholdPct);

  const db = getDb();
  const current = getState(input.userId, input.feature, input.thresholdPct);

  // Episode deja activ: cleared_at NULL si fired_at NOT NULL -> no-op.
  if (current && current.fired_at !== null && current.cleared_at === null) {
    return false;
  }

  if (current === null) {
    // Prima fire vreodata pentru (user, feature, threshold).
    db.prepare(
      `INSERT INTO budget_notifications
         (user_id, feature, threshold_pct, above_threshold_since, fired_at, cleared_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'), NULL, datetime('now'))`
    ).run(input.userId, input.feature, input.thresholdPct);
    return true;
  }

  // Re-fire dupa clear-out anterior: re-armam episodul.
  db.prepare(
    `UPDATE budget_notifications
       SET above_threshold_since = datetime('now'),
           fired_at = datetime('now'),
           email_sent_at = NULL,
           cleared_at = NULL,
           updated_at = datetime('now')
     WHERE user_id = ? AND feature = ? AND threshold_pct = ?`
  ).run(input.userId, input.feature, input.thresholdPct);
  return true;
}

// markEmailSent: rolling drop intre fire si email send poate sa stearga
// episodul (cleared_at devine NOT NULL); intr-un asemenea caz NU mai marcam
// (dispatcher trebuie sa stie ca email-ul nu mai e relevant). Returneaza true
// daca a marcat efectiv.
export function markEmailSent(userId: string, feature: string, thresholdPct: number): boolean {
  assertFeature(feature);
  assertThreshold(thresholdPct);
  const info = getDb()
    .prepare(
      `UPDATE budget_notifications
         SET email_sent_at = datetime('now'),
             updated_at = datetime('now')
       WHERE user_id = ? AND feature = ? AND threshold_pct = ?
         AND fired_at IS NOT NULL AND cleared_at IS NULL
         AND email_sent_at IS NULL`
    )
    .run(userId, feature, thresholdPct);
  return info.changes > 0;
}

// clearWarning: usedPct a scazut sub threshold; inchidem episodul. Idempotent
// (UPDATE prinde doar randuri cu fired_at NOT NULL si cleared_at NULL).
export function clearWarning(userId: string, feature: string, thresholdPct: number): boolean {
  assertFeature(feature);
  assertThreshold(thresholdPct);
  const info = getDb()
    .prepare(
      `UPDATE budget_notifications
         SET cleared_at = datetime('now'),
             above_threshold_since = NULL,
             fired_at = NULL,
             email_sent_at = NULL,
             updated_at = datetime('now')
       WHERE user_id = ? AND feature = ? AND threshold_pct = ?
         AND fired_at IS NOT NULL AND cleared_at IS NULL`
    )
    .run(userId, feature, thresholdPct);
  return info.changes > 0;
}

// isWarningActive: pentru banner. true cand fired_at NOT NULL si cleared_at NULL.
export function isWarningActive(userId: string, feature: string, thresholdPct: number): boolean {
  const row = getState(userId, feature, thresholdPct);
  if (row === null) return false;
  return row.fired_at !== null && row.cleared_at === null;
}
