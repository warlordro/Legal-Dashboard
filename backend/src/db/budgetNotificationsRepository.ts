import { createHash } from "node:crypto";
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
  email_attempts: number;
  last_email_attempted_at: string | null;
}

const COLUMNS =
  "user_id, feature, threshold_pct, above_threshold_since, fired_at, email_sent_at, cleared_at, updated_at, email_attempts, last_email_attempted_at";

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

export function incrementEmailAttempt(userId: string, feature: string, thresholdPct: number): boolean {
  assertFeature(feature);
  assertThreshold(thresholdPct);
  const info = getDb()
    .prepare(
      `UPDATE budget_notifications
         SET email_attempts = email_attempts + 1,
             last_email_attempted_at = datetime('now'),
             updated_at = datetime('now')
       WHERE user_id = ? AND feature = ? AND threshold_pct = ?
         AND fired_at IS NOT NULL AND cleared_at IS NULL`
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

export const EMAIL_RETRY_BACKOFF_SECONDS = [60, 300, 900, 3600] as const;
export const EMAIL_MAX_ATTEMPTS = EMAIL_RETRY_BACKOFF_SECONDS.length;
// Per-user, per-attempt jitter added on top of the base backoff so that 50
// users hitting 80% in the same scheduling tick do not retry the SMTP relay in
// lockstep. Deterministic (hash-derived) so the same row produces the same
// delay between observations; spread caps at JITTER_MAX_MS regardless of base.
export const EMAIL_RETRY_JITTER_MAX_MS = 30_000;

export interface PendingEmailRetry {
  userId: string;
  feature: string;
  thresholdPct: number;
}

export function computeEmailRetryJitterMs(userId: string, feature: string, attempt: number): number {
  const hash = createHash("sha256").update(`${userId}::${feature}::${attempt}`).digest();
  // First 4 bytes as uint32 -> modulo into [0, JITTER_MAX_MS). Avoids needing
  // a PRNG and matches across processes (multi-replica deploys).
  const bucket = hash.readUInt32BE(0);
  return bucket % EMAIL_RETRY_JITTER_MAX_MS;
}

export function selectPendingEmailRetries(now: Date = new Date()): PendingEmailRetry[] {
  const rows = getDb()
    .prepare(
      `SELECT user_id, feature, threshold_pct, email_attempts, last_email_attempted_at
       FROM budget_notifications
       WHERE fired_at IS NOT NULL
         AND cleared_at IS NULL
         AND email_sent_at IS NULL
         AND email_attempts < ?
       ORDER BY fired_at ASC
       LIMIT 50`
    )
    .all(EMAIL_MAX_ATTEMPTS) as Array<{
    user_id: string;
    feature: string;
    threshold_pct: number;
    email_attempts: number;
    last_email_attempted_at: string | null;
  }>;

  const nowMs = now.getTime();
  return rows
    .filter((row) => {
      if (row.last_email_attempted_at === null) return true;
      const lastMs = Date.parse(row.last_email_attempted_at);
      if (Number.isNaN(lastMs)) return true;
      const backoffIdx = Math.min(row.email_attempts - 1, EMAIL_RETRY_BACKOFF_SECONDS.length - 1);
      const baseMs = EMAIL_RETRY_BACKOFF_SECONDS[backoffIdx] * 1000;
      const jitterMs = computeEmailRetryJitterMs(row.user_id, row.feature, row.email_attempts);
      return nowMs - lastMs >= baseMs + jitterMs;
    })
    .map((row) => ({
      userId: row.user_id,
      feature: row.feature,
      thresholdPct: row.threshold_pct,
    }));
}
