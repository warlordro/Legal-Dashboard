import { MonitoringApiError, apiFetch } from "@/lib/api";

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

interface EnvelopeOk<T> {
  data: T;
  requestId: string;
  error?: undefined;
}
interface EnvelopeError {
  data: null;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

async function unwrapAiUsage<T>(res: Response): Promise<T> {
  let body: EnvelopeOk<T> | EnvelopeError;
  try {
    body = (await res.json()) as EnvelopeOk<T> | EnvelopeError;
  } catch {
    throw new MonitoringApiError("invalid_response", "Raspuns invalid de la server.", res.status);
  }

  if (!res.ok || (body as EnvelopeError).error) {
    const err = (body as EnvelopeError).error;
    throw new MonitoringApiError(
      err?.code ?? "unknown_error",
      err?.message ?? "Eroare necunoscuta",
      res.status,
      err?.details
    );
  }

  return (body as EnvelopeOk<T>).data;
}

export const aiUsageApi = {
  summary: async (signal?: AbortSignal): Promise<AiUsageSummaryResult> => {
    const res = await apiFetch("/api/v1/ai-usage/summary", { signal });
    return unwrapAiUsage<AiUsageSummaryResult>(res);
  },
};
