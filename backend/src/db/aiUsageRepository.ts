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

function nonNegativeInteger(value: number | null | undefined): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : 0;
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
      nonNegativeInteger(input.inputTokens),
      nonNegativeInteger(input.outputTokens),
      nonNegativeInteger(input.costUsdMilli),
      input.httpStatus ?? null,
      input.wasAborted ? 1 : 0,
      input.requestId || null,
      input.feature,
    );

  return db
    .prepare(`SELECT * FROM ai_usage WHERE id = ?`)
    .get(info.lastInsertRowid) as AiUsageRow;
}

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
       WHERE owner_id = ? AND ts > ?${untilClause}`,
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
       WHERE owner_id = ? AND ts > ?${untilClause}
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
       WHERE owner_id = ? AND ts > ?${untilClause}
       GROUP BY feature
       ORDER BY costUsdMilli DESC, key ASC`,
    )
    .all(...params) as AiUsageBreakdownRow[];
}

export function listAiUsageLastDays(input: {
  ownerId: string;
  days: number;
  now?: Date;
}): AiUsageDailyRow[] {
  const days = Math.max(1, Math.min(90, Math.floor(input.days)));
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();

  return getDb()
    .prepare(
      `SELECT
         substr(ts, 1, 10) AS day,
         COUNT(*) AS calls,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cost_usd_milli), 0) AS costUsdMilli
       FROM ai_usage
       WHERE owner_id = ? AND ts > ? AND ts <= ?
       GROUP BY substr(ts, 1, 10)
       ORDER BY day ASC`,
    )
    .all(input.ownerId, since, now.toISOString()) as AiUsageDailyRow[];
}
