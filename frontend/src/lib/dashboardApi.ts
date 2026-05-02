// Dashboard summary API surface (PR-A v2.7.0). Split from lib/api.ts (Stage 8)
// alongside monitoring/admin so each page has a small, self-contained module.
// Owner-scoped server-side, no params expose here. Polled at 30s from
// pages/Dashboard.tsx + on-demand refresh after SSE alert deltas.

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

export const dashboardApi = {
  summary: async (signal?: AbortSignal): Promise<DashboardSummary> => {
    const res = await apiFetch("/api/v1/dashboard/summary", { signal });
    return unwrapMonitoring<DashboardSummary>(res);
  },
};
