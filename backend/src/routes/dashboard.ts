import { Hono } from "hono";

import { withMaintenanceRead } from "../db/backup.ts";
import { aggregateActiveJobsByKindForOwner } from "../db/monitoringJobsRepository.ts";
import {
  countAlertsCreatedSince,
  countUnreadAlerts,
} from "../db/monitoringAlertsRepository.ts";
import { aggregateFinalizedRunsByStatusSince } from "../db/monitoringRunsRepository.ts";
import {
  getAiUsageTotals,
  listAiUsageLastDays,
  utcDayStart,
} from "../db/aiUsageRepository.ts";
import {
  aggregateAlertsByDayInRange,
  aggregateFinalizedRunsByDayAndStatusInRange,
  listAlertsBefore,
  listCuratedAuditBefore,
  listFinalizedRunsBefore,
  type TimelineAlertRow,
  type TimelineAuditRow,
  type TimelineRunRow,
} from "../db/dashboardActivityRepository.ts";
import { getOwnerId } from "../middleware/owner.ts";
import { fail, ok } from "../util/envelope.ts";

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

// ────────────────────────────────────────────────────────────────────────────
// PR-B (v2.8.0) — Dashboard timeline endpoint.
//
// GET /api/v1/dashboard/timeline?cursor=<isoTs>&limit=<n>
//
// Returns a unified, descending stream of operational events: alerts emitted
// by monitoring runs, finalized runs themselves, and a curated subset of
// audit_log (security/destructive ops, see CURATED_AUDIT_ACTIONS). Three
// sources are queried independently with `ts < cursor LIMIT N` and merged in
// JS — the bounded per-source limit means worst-case fetch is 3*N rows for
// one page (cheap for N ≤ 100, indexed on each source).
//
// Cursor: opaque ISO timestamp; clients pass back nextCursor verbatim. The
// strict `<` keeps the cursor stable when two events share a millisecond
// (per-source id DESC tiebreak collapses ties inside a source; the merged
// stream uses ts then source-id sort).
//
// Why merge in JS rather than UNION ALL: clearer code, easier to attach
// source-specific projections (alert detail vs run error_code vs audit
// action). The merged payload is small (≤ ~3*limit), no perf concern.
// ────────────────────────────────────────────────────────────────────────────

export type TimelineEventKind = "alert" | "run" | "audit";
export type TimelineEventSeverity = "info" | "warning" | "critical";

export interface TimelineEvent {
  id: string;
  ts: string;
  kind: TimelineEventKind;
  severity: TimelineEventSeverity;
  title: string;
  detail: Record<string, unknown>;
}

export interface TimelinePayload {
  events: TimelineEvent[];
  nextCursor: string | null;
  generatedAt: string;
}

const TIMELINE_DEFAULT_LIMIT = 30;
const TIMELINE_MAX_LIMIT = 100;

function clampLimit(raw: string | undefined, def: number, max: number): number {
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

function safeJsonParse(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function alertRowToEvent(row: TimelineAlertRow): TimelineEvent {
  // Severity from the alert row maps directly to the timeline severity field.
  // Kind on the timeline is "alert" (the source); the alert's domain kind
  // (termen_new, etc.) lives in detail.alert_kind for client filtering.
  const severity: TimelineEventSeverity =
    row.severity === "warning" || row.severity === "critical" ? row.severity : "info";
  const detail = safeJsonParse(row.detail_json);
  detail.alert_kind = row.kind;
  detail.job_id = row.job_id;
  if (row.job_kind) detail.job_kind = row.job_kind;
  if (row.job_target_json) {
    detail.job_target = safeJsonParse(row.job_target_json);
  }
  return {
    id: `alert:${row.id}`,
    ts: row.ts,
    kind: "alert",
    severity,
    title: row.title,
    detail,
  };
}

function runRowToEvent(row: TimelineRunRow): TimelineEvent {
  // Status maps to severity for the visual pill: ok → info, timeout/error →
  // warning, aborted → info (graceful drain / crash recovery is operational
  // noise, not a source failure).
  let severity: TimelineEventSeverity = "info";
  if (row.status === "error") severity = "critical";
  else if (row.status === "timeout") severity = "warning";
  const titleParts: string[] = [`Run ${row.status}`];
  if (row.job_kind) titleParts.push(`(${row.job_kind})`);
  return {
    id: `run:${row.id}`,
    ts: row.ts,
    kind: "run",
    severity,
    title: titleParts.join(" "),
    detail: {
      run_id: row.id,
      status: row.status,
      job_id: row.job_id,
      job_kind: row.job_kind,
      duration_ms: row.duration_ms,
      alerts_created: row.alerts_created,
      alerts_patched: row.alerts_patched,
      error_code: row.error_code,
      error_message: row.error_message,
      http_status: row.http_status,
    },
  };
}

function auditRowToEvent(row: TimelineAuditRow): TimelineEvent {
  // Outcome drives severity: ok → info, denied/error → warning. Auth.denied
  // gets bumped to critical so it pops on the timeline.
  let severity: TimelineEventSeverity = "info";
  if (row.outcome === "error") severity = "warning";
  if (row.outcome === "denied") severity = "warning";
  if (row.action === "auth.denied") severity = "critical";
  return {
    id: `audit:${row.id}`,
    ts: row.ts,
    kind: "audit",
    severity,
    title: row.action,
    detail: {
      action: row.action,
      target_kind: row.target_kind,
      target_id: row.target_id,
      outcome: row.outcome,
      actor_id: row.actor_id,
      ...safeJsonParse(row.detail_json),
    },
  };
}

function mergeAndSliceTimeline(
  alerts: TimelineEvent[],
  runs: TimelineEvent[],
  audits: TimelineEvent[],
  limit: number,
): TimelineEvent[] {
  // Stable ordering: ts DESC, then id DESC as tiebreaker so two events at the
  // same instant produce a deterministic order across pages (important — the
  // cursor is `ts` only, so ordering ties are resolved here, then the
  // exclusive `<` in the next query keeps progression monotonic).
  const merged = [...alerts, ...runs, ...audits];
  merged.sort((a, b) => {
    if (a.ts === b.ts) return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    return a.ts < b.ts ? 1 : -1;
  });
  return merged.slice(0, limit);
}

dashboardRouter.get("/timeline", async (c) => {
  const ownerId = getOwnerId(c);
  const now = new Date();
  const cursor = c.req.query("cursor") ?? now.toISOString();
  const limit = clampLimit(c.req.query("limit"), TIMELINE_DEFAULT_LIMIT, TIMELINE_MAX_LIMIT);

  const payload: TimelinePayload = await withMaintenanceRead(async () => {
    const [alerts, runs, audits] = [
      listAlertsBefore({ ownerId, before: cursor, limit }).map(alertRowToEvent),
      listFinalizedRunsBefore({ ownerId, before: cursor, limit }).map(runRowToEvent),
      listCuratedAuditBefore({ ownerId, before: cursor, limit }).map(auditRowToEvent),
    ];
    const events = mergeAndSliceTimeline(alerts, runs, audits, limit);
    // nextCursor = ts of the last event so the next page returns events
    // strictly older (ts < nextCursor). null when the last page returned
    // fewer than `limit` events (no more rows available).
    const nextCursor = events.length === limit ? events[events.length - 1].ts : null;
    return { events, nextCursor, generatedAt: now.toISOString() };
  });

  return c.json(ok(payload, c));
});

// ────────────────────────────────────────────────────────────────────────────
// PR-B (v2.8.0) — Dashboard charts endpoint.
//
// GET /api/v1/dashboard/charts?range=7d|30d
//
// Returns three time series for the requested window, all anchored to the
// same UTC-day grid (utcDayStart from aiUsageRepository) so the X-axis lines
// up across charts:
//   - alerts: COUNT per day (created_at)
//   - runs: ok/error/timeout/aborted counts per day (ended_at, terminal only)
//   - aiCost: USD + calls + tokens per day (cost_usd_milli/1000)
//
// Closed lower bound (ts >= since), open upper bound (ts <= until = now), so
// the rightmost bar may be partial-day — same convention as PR-7 daily.
// ────────────────────────────────────────────────────────────────────────────

export type ChartsRange = "7d" | "30d";

export interface ChartsAlertsPoint {
  day: string;
  count: number;
}

export interface ChartsRunsPoint {
  day: string;
  ok: number;
  error: number;
  timeout: number;
  aborted: number;
  total: number;
}

export interface ChartsAiPoint {
  day: string;
  costUsd: number;
  calls: number;
  tokens: number;
}

export interface ChartsPayload {
  range: ChartsRange;
  since: string;
  until: string;
  series: {
    alerts: ChartsAlertsPoint[];
    runs: ChartsRunsPoint[];
    aiCost: ChartsAiPoint[];
  };
  generatedAt: string;
}

function rangeToDays(range: string | undefined): { range: ChartsRange; days: number } | null {
  if (range === "30d") return { range: "30d", days: 30 };
  if (range === "7d" || range === undefined) return { range: "7d", days: 7 };
  return null;
}

function buildDayGrid(since: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

dashboardRouter.get("/charts", async (c) => {
  const parsed = rangeToDays(c.req.query("range"));
  if (!parsed) {
    return c.json(fail("invalid_range", "range must be one of: 7d, 30d", c), 400);
  }
  const { range, days } = parsed;
  const ownerId = getOwnerId(c);
  const now = new Date();
  const sinceDate = utcDayStart(now, days - 1);
  const since = sinceDate.toISOString();
  const until = now.toISOString();

  const payload: ChartsPayload = await withMaintenanceRead(async () => {
    const grid = buildDayGrid(sinceDate, days);

    // Alerts daily: backfill missing days with 0 so the chart shows a flat line
    // instead of gaps where no alerts fired.
    const alertRows = aggregateAlertsByDayInRange({ ownerId, since, until });
    const alertsByDay = new Map(alertRows.map((r) => [r.day, r.count]));
    const alerts: ChartsAlertsPoint[] = grid.map((day) => ({
      day,
      count: alertsByDay.get(day) ?? 0,
    }));

    // Runs daily: pivot per-day-per-status rows into one row per day with the
    // four status columns. Same backfill as alerts.
    const runRows = aggregateFinalizedRunsByDayAndStatusInRange({
      ownerId,
      since,
      until,
    });
    const runsByDay = new Map<string, ChartsRunsPoint>();
    for (const day of grid) {
      runsByDay.set(day, { day, ok: 0, error: 0, timeout: 0, aborted: 0, total: 0 });
    }
    for (const row of runRows) {
      const point = runsByDay.get(row.day);
      if (!point) continue;
      point.total += row.n;
      if (row.status === "ok") point.ok += row.n;
      else if (row.status === "error") point.error += row.n;
      else if (row.status === "timeout") point.timeout += row.n;
      else if (row.status === "aborted") point.aborted += row.n;
    }

    // AI cost daily: reuse listAiUsageLastDays with the matching `days` so the
    // X-axis aligns with the alerts/runs grid above. Convert milli → USD here.
    const aiResp = listAiUsageLastDays({ ownerId, days, now });
    const aiByDay = new Map(aiResp.rows.map((r) => [r.day, r]));
    const aiCost: ChartsAiPoint[] = grid.map((day) => {
      const r = aiByDay.get(day);
      return {
        day,
        costUsd: r ? Math.max(0, r.costUsdMilli) / 1_000 : 0,
        calls: r ? r.calls : 0,
        tokens: r ? r.inputTokens + r.outputTokens : 0,
      };
    });

    return {
      range,
      since,
      until,
      series: {
        alerts,
        runs: Array.from(runsByDay.values()),
        aiCost,
      },
      generatedAt: until,
    };
  });

  return c.json(ok(payload, c));
});
