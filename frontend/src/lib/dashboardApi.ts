// Dashboard API surface. Split from lib/api.ts (Stage 8) alongside
// monitoring/admin so each page has a small, self-contained module.
// Owner-scoped server-side. Three endpoints:
//   - summary: 4-block KPI strip (PR-A v2.7.0), polled at 30s
//   - timeline: cursor-paginated activity stream (PR-B v2.8.0)
//   - charts: 7d/30d series for alerts/runs/aiCost (PR-B v2.8.0)

import { apiFetch, MonitoringApiError, unwrapMonitoring } from "./api";

export { MonitoringApiError };

export interface DashboardJobsBlock {
  active: number;
  byKind: { dosar_soap: number; name_soap: number };
}

export interface DashboardAlertsBlock {
  unseen: number;
  last24h: number;
}

export interface DashboardRunsBlock {
  ok: number;
  error: number;
  timeout: number;
  aborted: number;
  total: number;
}

export interface DashboardAiBlock {
  costUsd: number;
  calls: number;
  tokens: number;
}

export interface DashboardSummary {
  jobs: DashboardJobsBlock;
  alerts: DashboardAlertsBlock;
  runs: DashboardRunsBlock;
  ai: DashboardAiBlock;
  generatedAt: string;
}

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

// PR-C v2.9.0 — report payload (one-shot aggregation for the Export raport flow).
export interface ReportTimelineBlock {
  events: TimelineEvent[];
  truncated: boolean;
  limitPerSource: number;
}

export interface DashboardReportPayload {
  range: ChartsRange;
  since: string;
  until: string;
  summary: DashboardSummary;
  charts: ChartsPayload;
  timeline: ReportTimelineBlock;
  generatedAt: string;
}

export const dashboardApi = {
  summary: async (signal?: AbortSignal): Promise<DashboardSummary> => {
    const res = await apiFetch("/api/v1/dashboard/summary", { signal });
    return unwrapMonitoring<DashboardSummary>(res);
  },
  timeline: async (
    opts: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
  ): Promise<TimelinePayload> => {
    const params = new URLSearchParams();
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const url = `/api/v1/dashboard/timeline${qs ? `?${qs}` : ""}`;
    const res = await apiFetch(url, { signal: opts.signal });
    return unwrapMonitoring<TimelinePayload>(res);
  },
  charts: async (
    opts: { range?: ChartsRange; signal?: AbortSignal } = {},
  ): Promise<ChartsPayload> => {
    const params = new URLSearchParams();
    if (opts.range) params.set("range", opts.range);
    const qs = params.toString();
    const url = `/api/v1/dashboard/charts${qs ? `?${qs}` : ""}`;
    const res = await apiFetch(url, { signal: opts.signal });
    return unwrapMonitoring<ChartsPayload>(res);
  },
  report: async (
    opts: { range?: ChartsRange; signal?: AbortSignal } = {},
  ): Promise<DashboardReportPayload> => {
    const params = new URLSearchParams();
    if (opts.range) params.set("range", opts.range);
    const qs = params.toString();
    const url = `/api/v1/dashboard/report${qs ? `?${qs}` : ""}`;
    const res = await apiFetch(url, { signal: opts.signal });
    return unwrapMonitoring<DashboardReportPayload>(res);
  },
};
