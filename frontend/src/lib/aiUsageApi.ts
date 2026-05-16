import { apiFetch, unwrapMonitoring } from "@/lib/api";

export interface AiUsageSummaryWindow {
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AiUsageDailyPoint {
  date: string;
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AiUsageSummaryResult {
  summary24h: AiUsageSummaryWindow;
  summary30d: AiUsageSummaryWindow;
  daily: AiUsageDailyPoint[];
  generatedAt?: string;
}

export const aiUsageApi = {
  summary: async (signal?: AbortSignal): Promise<AiUsageSummaryResult> => {
    const res = await apiFetch("/api/v1/ai-usage/summary", { signal });
    return unwrapMonitoring<AiUsageSummaryResult>(res);
  },
};
