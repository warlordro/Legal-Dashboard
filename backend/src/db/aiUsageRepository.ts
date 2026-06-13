import { getDb } from "./schema.ts";
import { assertOwnerIdForMutation } from "../util/ownerGuard.ts";

export type AiUsageProvider = "anthropic" | "openai" | "google" | "openrouter";
// v2.38.0: stack-ul chinese a fost eliminat — scrierile noi emit doar
// "native" / "openrouter:western". Randurile istorice cu "openrouter:chinese"
// raman in DB (coloana e TEXT fara CHECK) si sunt doar citite, niciodata validate.
export type AiUsageRoutingTag = "native" | "openrouter:western";

export interface AiUsageRow {
  id: number;
  owner_id: string;
  ts: string;
  provider: AiUsageProvider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd_milli: number;
  http_status: number | null;
  was_aborted: 0 | 1;
  request_id: string | null;
  feature: string;
  routing_tag: AiUsageRoutingTag | null;
  status: "pending" | "confirmed";
  estimated_cost_usd_milli: number | null;
}

export interface InsertAiUsageInput {
  ownerId: string;
  provider: AiUsageProvider;
  model: string;
  feature: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsdMilli?: number | null;
  httpStatus?: number | null;
  wasAborted?: boolean;
  requestId?: string | null;
  routingTag?: AiUsageRoutingTag | null;
  ts?: string;
}

export interface AiUsageWindow {
  ownerId: string;
  since: string;
  until?: string;
}

export interface AiUsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMilli: number;
}

export interface AiUsageBreakdownRow extends AiUsageTotals {
  key: string;
}

export interface AiUsageDailyRow extends AiUsageTotals {
  day: string;
}

// Token / cost columns are CHECK >= 0 in 0010_ai_usage.up.sql, so this clamp
// must accept zero (a function-calling round trip with 0 input is legal). The
// previous predicate (`> 0`) excluded valid zeros and silently turned them
// into stored zeros anyway — same effect at runtime, but a misleading name.
function clampToNonNegativeInteger(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function insertAiUsage(input: InsertAiUsageInput): AiUsageRow {
  assertOwnerIdForMutation(input.ownerId, "insertAiUsage");
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO ai_usage
         (owner_id, ts, provider, model, input_tokens, output_tokens,
          cost_usd_milli, http_status, was_aborted, request_id, feature, routing_tag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.ownerId,
      input.ts ?? new Date().toISOString(),
      input.provider,
      input.model,
      clampToNonNegativeInteger(input.inputTokens),
      clampToNonNegativeInteger(input.outputTokens),
      clampToNonNegativeInteger(input.costUsdMilli),
      input.httpStatus ?? null,
      input.wasAborted ? 1 : 0,
      input.requestId || null,
      input.feature,
      input.routingTag ?? null
    );

  return db.prepare("SELECT * FROM ai_usage WHERE id = ?").get(info.lastInsertRowid) as AiUsageRow;
}

export interface InsertReservationInput {
  ownerId: string;
  provider: AiUsageProvider;
  feature: string;
  estimatedCostUsdMilli: number;
  requestId?: string | null;
}

export const RESERVATION_EXPIRE_SECONDS = 300;

export function insertAiUsageReservation(input: InsertReservationInput): number {
  assertOwnerIdForMutation(input.ownerId, "insertAiUsageReservation");
  const estimatedCost = clampToNonNegativeInteger(input.estimatedCostUsdMilli);
  const info = getDb()
    .prepare(
      `INSERT INTO ai_usage
         (owner_id, ts, provider, model, feature, input_tokens, output_tokens,
          cost_usd_milli, estimated_cost_usd_milli, status, request_id)
       VALUES (?, ?, ?, 'pending', ?, 0, 0, ?, ?, 'pending', ?)`
    )
    .run(
      input.ownerId,
      new Date().toISOString(),
      input.provider,
      input.feature,
      estimatedCost,
      estimatedCost,
      input.requestId ?? null
    );
  return Number(info.lastInsertRowid);
}

export function confirmAiUsageReservation(
  reservationId: number,
  real: {
    provider: AiUsageProvider;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsdMilli: number;
    httpStatus: number | null;
    wasAborted: boolean;
    routingTag: AiUsageRoutingTag | null;
    feature?: string;
  }
): boolean {
  const info = getDb()
    .prepare(
      `UPDATE ai_usage
       SET status = 'confirmed',
           provider = ?,
           model = ?,
           input_tokens = ?,
           output_tokens = ?,
           cost_usd_milli = ?,
           http_status = ?,
           was_aborted = ?,
           routing_tag = ?,
           feature = COALESCE(?, feature)
       WHERE id = ? AND status = 'pending'`
    )
    .run(
      real.provider,
      real.model,
      clampToNonNegativeInteger(real.inputTokens),
      clampToNonNegativeInteger(real.outputTokens),
      clampToNonNegativeInteger(real.costUsdMilli),
      real.httpStatus,
      real.wasAborted ? 1 : 0,
      real.routingTag ?? null,
      real.feature ?? null,
      reservationId
    );
  return info.changes > 0;
}

export function releaseAiUsageReservation(reservationId: number): boolean {
  const info = getDb().prepare("DELETE FROM ai_usage WHERE id = ? AND status = 'pending'").run(reservationId);
  return info.changes > 0;
}

export function purgeExpiredReservations(now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - RESERVATION_EXPIRE_SECONDS * 1000).toISOString();
  const info = getDb()
    .prepare(
      `DELETE FROM ai_usage
       WHERE status = 'pending' AND ts < ?`
    )
    .run(cutoff);
  return info.changes;
}

// Closed interval `[since, until]`. The previous version used a strict lower
// bound which silently dropped a row landing exactly at `since` and produced
// an asymmetric mismatch with `listAiUsageLastDays` below — `summary30d.calls`
// and the rightmost daily bar could differ by 1 for the same instant. Always
// pick `since` from the same source as the daily series so the totals card
// equals the sum of the bars.
export function getAiUsageTotals(input: AiUsageWindow): AiUsageTotals {
  const params: (string | number)[] = [input.ownerId, input.since];
  let untilClause = "";
  if (input.until) {
    untilClause = " AND ts <= ?";
    params.push(input.until);
  }

  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS calls,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cost_usd_milli), 0) AS costUsdMilli
       FROM ai_usage
       WHERE owner_id = ? AND ts >= ?${untilClause}`
    )
    .get(...params) as AiUsageTotals;

  return row;
}

export function getAiUsageByProvider(input: AiUsageWindow): AiUsageBreakdownRow[] {
  const params: (string | number)[] = [input.ownerId, input.since];
  let untilClause = "";
  if (input.until) {
    untilClause = " AND ts <= ?";
    params.push(input.until);
  }

  return getDb()
    .prepare(
      `SELECT
         provider AS key,
         COUNT(*) AS calls,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cost_usd_milli), 0) AS costUsdMilli
       FROM ai_usage
       WHERE owner_id = ? AND ts >= ?${untilClause}
       GROUP BY provider
       ORDER BY costUsdMilli DESC, key ASC`
    )
    .all(...params) as AiUsageBreakdownRow[];
}

export function getAiUsageByFeature(input: AiUsageWindow): AiUsageBreakdownRow[] {
  const params: (string | number)[] = [input.ownerId, input.since];
  let untilClause = "";
  if (input.until) {
    untilClause = " AND ts <= ?";
    params.push(input.until);
  }

  return getDb()
    .prepare(
      `SELECT
         feature AS key,
         COUNT(*) AS calls,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cost_usd_milli), 0) AS costUsdMilli
       FROM ai_usage
       WHERE owner_id = ? AND ts >= ?${untilClause}
       GROUP BY feature
       ORDER BY costUsdMilli DESC, key ASC`
    )
    .all(...params) as AiUsageBreakdownRow[];
}

export function sumAiUsageMilliToday(ownerId: string, feature: string): number {
  const features = quotaFeatureAliases(feature);
  const placeholders = features.map(() => "?").join(", ");
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(cost_usd_milli), 0) AS total
       FROM ai_usage
       WHERE owner_id = ?
         AND feature IN (${placeholders})
         AND date(ts) = date('now')`
    )
    .get(ownerId, ...features) as { total: number };
  return row.total;
}

// v2.32.0 rolling window: suma cost intr-o fereastra rolling (secunde inapoi)
// per quotaGuard. Spre deosebire de sumAiUsageMilliToday (date='now', calendar),
// asta foloseste fereastra "-N seconds" pentru a respecta semantica rolling
// (D5/D15). features: aliasele se aplica identic ca la sumToday.
//
// Format-ul timpului boundary trebuie sa fie ISO 8601 ('YYYY-MM-DDTHH:MM:SS.sssZ')
// ca sa fie lexicografic-comparabil cu ts-ul coloanei (default-ul tabelei e
// strftime cu T+Z). datetime('now') returneaza 'YYYY-MM-DD HH:MM:SS' (spatiu),
// iar spatiul (0x20) < 'T' (0x54) face ca orice ts ISO > orice datetime('now'),
// indiferent de timpul real - bug subtle de string comparison.
export function sumAiUsageMilliInWindow(ownerId: string, feature: string, windowSeconds: number): number {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error("windowSeconds must be a positive number");
  }
  const features = quotaFeatureAliases(feature);
  const placeholders = features.map(() => "?").join(", ");
  const modifier = `-${Math.floor(windowSeconds)} seconds`;
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(
         CASE
           WHEN status = 'pending' THEN COALESCE(estimated_cost_usd_milli, cost_usd_milli, 0)
           ELSE cost_usd_milli
         END
       ), 0) AS total
       FROM ai_usage
       WHERE owner_id = ?
         AND feature IN (${placeholders})
         AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`
    )
    .get(ownerId, ...features, modifier) as { total: number };
  return row.total;
}

// earliestAiUsageTsInWindow: timestamp-ul cel mai vechi din fereastra rolling
// care contribuie la suma. Folosit de quotaGuard pentru Retry-After corect
// (Codex C2): retry_after = (earliest_ts + window_seconds) - now. Null cand
// fereastra e goala.
export function earliestAiUsageTsInWindow(ownerId: string, feature: string, windowSeconds: number): string | null {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error("windowSeconds must be a positive number");
  }
  const features = quotaFeatureAliases(feature);
  const placeholders = features.map(() => "?").join(", ");
  const modifier = `-${Math.floor(windowSeconds)} seconds`;
  const row = getDb()
    .prepare(
      `SELECT MIN(ts) AS earliest
       FROM ai_usage
       WHERE owner_id = ?
         AND feature IN (${placeholders})
         AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`
    )
    .get(ownerId, ...features, modifier) as { earliest: string | null };
  return row.earliest ?? null;
}

function quotaFeatureAliases(feature: string): string[] {
  if (feature === "ai.single") return ["ai.single", "dosar_summary"];
  if (feature === "ai.multi") return ["ai.multi", "dosar_multi_analyst", "dosar_multi_judge"];
  return [feature];
}

// Anchor the daily window to UTC-midnight `today − (days − 1)` so the chart's
// leftmost bar is exactly `days` UTC days before today inclusive. Returning
// the start instant here lets the caller use the same `since` for totals so
// the 30-day card equals the sum of the 30 bars (otherwise a sliding 30×24h
// totals window includes a partial-day slice the bars exclude).
export function utcDayStart(now: Date, daysBack: number): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - daysBack);
  return start;
}

export function listAiUsageLastDays(input: {
  ownerId: string;
  days: number;
  now?: Date;
}): { rows: AiUsageDailyRow[]; since: string; until: string } {
  const days = Math.max(1, Math.min(90, Math.floor(input.days)));
  const now = input.now ?? new Date();
  const since = utcDayStart(now, days - 1).toISOString();
  const until = now.toISOString();

  const rows = getDb()
    .prepare(
      `SELECT
         substr(ts, 1, 10) AS day,
         COUNT(*) AS calls,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cost_usd_milli), 0) AS costUsdMilli
       FROM ai_usage
       WHERE owner_id = ? AND ts >= ? AND ts <= ?
       GROUP BY substr(ts, 1, 10)
       ORDER BY day ASC`
    )
    .all(input.ownerId, since, until) as AiUsageDailyRow[];

  return { rows, since, until };
}

// Retention purge — mirrors `purgeOldRuns` for `monitoring_runs`. Wired into
// the scheduler's daily purge timer alongside it. Global (not owner-scoped):
// older-than-N rows are aged out for everyone uniformly. Returns the deleted
// count for audit logging.
export function purgeOldAiUsage(retentionDays: number): number {
  const days = Math.max(1, Math.floor(retentionDays));
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const info = getDb().prepare("DELETE FROM ai_usage WHERE ts < ?").run(cutoff);
  return info.changes;
}
