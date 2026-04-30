import { Hono } from "hono";

import {
  getAiUsageTotals,
  listAiUsageLastDays,
  type AiUsageDailyRow,
  type AiUsageTotals,
} from "../db/aiUsageRepository.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { ok } from "../util/envelope.ts";

export const aiUsageRouter = new Hono();

interface AiUsageSummaryWindow {
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

interface AiUsageDailyPoint extends AiUsageSummaryWindow {
  date: string;
}

function costUsd(costUsdMilli: number): number {
  return Math.max(0, costUsdMilli) / 1_000;
}

function toSummary(row: AiUsageTotals): AiUsageSummaryWindow {
  return {
    costUsd: costUsd(row.costUsdMilli),
    calls: row.calls,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDailySeries(rows: AiUsageDailyRow[], now: Date, days: number): AiUsageDailyPoint[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const points: AiUsageDailyPoint[] = [];
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));

  for (let i = 0; i < days; i += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    const date = isoDate(day);
    const row = byDay.get(date);
    points.push({
      date,
      calls: row?.calls ?? 0,
      inputTokens: row?.inputTokens ?? 0,
      outputTokens: row?.outputTokens ?? 0,
      costUsd: costUsd(row?.costUsdMilli ?? 0),
    });
  }
  return points;
}

aiUsageRouter.get("/summary", (c) => {
  const ownerId = getOwnerId(c);
  const now = new Date();
  const since24h = new Date(now.getTime() - 86_400_000).toISOString();
  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  const summary24h = toSummary(getAiUsageTotals({ ownerId, since: since24h, until: now.toISOString() }));
  const summary30d = toSummary(getAiUsageTotals({ ownerId, since: since30d, until: now.toISOString() }));
  const daily = buildDailySeries(listAiUsageLastDays({ ownerId, days: 30, now }), now, 30);

  return c.json(ok({
    summary24h,
    summary30d,
    daily,
    generatedAt: now.toISOString(),
  }, c));
});
