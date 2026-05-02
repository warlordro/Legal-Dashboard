import { Hono } from "hono";

import { withMaintenanceRead } from "../db/backup.ts";
import { aggregateActiveJobsByKindForOwner } from "../db/monitoringJobsRepository.ts";
import {
  countAlertsCreatedSince,
  countUnreadAlerts,
} from "../db/monitoringAlertsRepository.ts";
import { aggregateFinalizedRunsByStatusSince } from "../db/monitoringRunsRepository.ts";
import { getAiUsageTotals } from "../db/aiUsageRepository.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { ok } from "../util/envelope.ts";

// PR-A (v2.7.0) — Dashboard summary endpoint.
//
// Single round-trip aggregation for the KPI strip on the redesigned dashboard
// (PLAN-dashboard-redesign §3.1). Frontend polls this every 30s; SSE on
// /api/v1/alerts/stream applies the unseen-alerts delta in between ticks so
// the user sees a new alert before the next poll.
//
// All sub-queries are owner-scoped via getOwnerId(c). The 24h windows use
// ISO strings rather than SQLite's `datetime('now', '-1 day')` so the window
// is anchored to wall-clock time at request time and trivially comparable
// against `created_at`/`started_at`/`ended_at` ISO columns.
//
// Wrapped in withMaintenanceRead: backup.ts exposes a real writer-preference
// RWLock, not a no-op. Keeping the dashboard under the same gate lets backup /
// restore get a clean maintenance window instead of competing with the 30s KPI
// poll stream.

export const dashboardRouter = new Hono();

interface JobsKindBreakdown {
  dosar_soap: number;
  name_soap: number;
}

interface JobsBlock {
  active: number;
  byKind: JobsKindBreakdown;
}

interface AlertsBlock {
  unseen: number;
  last24h: number;
}

interface RunsBlock {
  ok: number;
  error: number;
  timeout: number;
  aborted: number;
  total: number;
}

interface AiBlock {
  costUsd: number;
  calls: number;
  tokens: number;
}

interface DashboardSummaryPayload {
  jobs: JobsBlock;
  alerts: AlertsBlock;
  runs: RunsBlock;
  ai: AiBlock;
  generatedAt: string;
}

function readJobsBlock(ownerId: string): JobsBlock {
  const rows = aggregateActiveJobsByKindForOwner(ownerId);
  let active = 0;
  const byKind: JobsKindBreakdown = { dosar_soap: 0, name_soap: 0 };
  for (const row of rows) {
    active += row.n;
    if (row.kind === "dosar_soap") byKind.dosar_soap = row.n;
    else if (row.kind === "name_soap") byKind.name_soap = row.n;
    // Other kinds (future) are counted in `active` but not surfaced as
    // dedicated breakdown buckets until the UI cares about them.
  }
  return { active, byKind };
}

function readAlertsBlock(ownerId: string, since24h: string): AlertsBlock {
  return {
    unseen: countUnreadAlerts(ownerId),
    last24h: countAlertsCreatedSince(ownerId, since24h),
  };
}

function readRunsBlock(ownerId: string, since24h: string): RunsBlock {
  // Window key is `ended_at` (terminal transition time). `running` rows lack
  // ended_at and are excluded — the KPI is "completed runs in the last 24h",
  // not "started in the last 24h". Aborted is surfaced separately because
  // crash recovery / graceful drain are restart noise, not source failures.
  const rows = aggregateFinalizedRunsByStatusSince(ownerId, since24h);
  let okCount = 0;
  let errorCount = 0;
  let timeoutCount = 0;
  let abortedCount = 0;
  let total = 0;
  for (const row of rows) {
    total += row.n;
    if (row.status === "ok") okCount = row.n;
    else if (row.status === "error") errorCount += row.n;
    else if (row.status === "timeout") timeoutCount = row.n;
    else if (row.status === "aborted") abortedCount = row.n;
  }
  return {
    ok: okCount,
    error: errorCount,
    timeout: timeoutCount,
    aborted: abortedCount,
    total,
  };
}

function readAiBlock(ownerId: string, since24h: string, until: string): AiBlock {
  const totals = getAiUsageTotals({ ownerId, since: since24h, until });
  return {
    costUsd: Math.max(0, totals.costUsdMilli) / 1_000,
    calls: totals.calls,
    tokens: totals.inputTokens + totals.outputTokens,
  };
}

dashboardRouter.get("/summary", async (c) => {
  const ownerId = getOwnerId(c);
  const now = new Date();
  const since24h = new Date(now.getTime() - 86_400_000).toISOString();
  const until = now.toISOString();

  const payload: DashboardSummaryPayload = await withMaintenanceRead(async () => {
    return {
      jobs: readJobsBlock(ownerId),
      alerts: readAlertsBlock(ownerId, since24h),
      runs: readRunsBlock(ownerId, since24h),
      ai: readAiBlock(ownerId, since24h, until),
      generatedAt: until,
    };
  });

  return c.json(ok(payload, c));
});
