import { getDb } from "./schema.ts";

export type AiUsageProvider = "anthropic" | "openai" | "google";

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
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO ai_usage
         (owner_id, ts, provider, model, input_tokens, output_tokens,
          cost_usd_milli, http_status, was_aborted, request_id, feature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );

  return db
    .prepare(`SELECT * FROM ai_usage WHERE id = ?`)
    .get(info.lastInsertRowid) as AiUsageRow;
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
       WHERE owner_id = ? AND ts >= ?${untilClause}`,
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
       ORDER BY costUsdMilli DESC, key ASC`,
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
       ORDER BY costUsdMilli DESC, key ASC`,
    )
    .all(...params) as AiUsageBreakdownRow[];
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
       ORDER BY day ASC`,
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
  const info = getDb()
    .prepare(`DELETE FROM ai_usage WHERE ts < ?`)
    .run(cutoff);
  return info.changes;
}
