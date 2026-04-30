import { Hono } from "hono";

import {
  getAiUsageTotals,
  listAiUsageLastDays,
  utcDayStart,
  type AiUsageDailyRow,
  type AiUsageTotals,
} from "../db/aiUsageRepository.ts";
import { withMaintenanceRead } from "../db/backup.ts";
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

// `since` here is the same UTC-midnight−(days−1) instant the repo used to
// build the daily series. Reusing it for the totals card guarantees the
// 30-day card equals the sum of the 30 bars (the previous `now − 30×24h`
// shaved an extra partial day onto the totals window only).
function buildDailySeries(rows: AiUsageDailyRow[], since: Date, days: number): AiUsageDailyPoint[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const points: AiUsageDailyPoint[] = [];

  for (let i = 0; i < days; i += 1) {
    const day = new Date(since);
    day.setUTCDate(since.getUTCDate() + i);
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

aiUsageRouter.get("/summary", async (c) => {
  const ownerId = getOwnerId(c);
  const now = new Date();
  const since24h = new Date(now.getTime() - 86_400_000).toISOString();
  const since30dStart = utcDayStart(now, 29);
  const since30d = since30dStart.toISOString();
  const until = now.toISOString();

  const payload = await withMaintenanceRead(async () => {
    const summary24h = toSummary(getAiUsageTotals({ ownerId, since: since24h, until }));
    const summary30d = toSummary(getAiUsageTotals({ ownerId, since: since30d, until }));
    const daily = buildDailySeries(
      listAiUsageLastDays({ ownerId, days: 30, now }).rows,
      since30dStart,
      30,
    );
    return { summary24h, summary30d, daily };
  });

  return c.json(ok({
    ...payload,
    generatedAt: until,
  }, c));
});
