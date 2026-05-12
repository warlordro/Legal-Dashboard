import type { Dosar, SearchParams, Termen } from "@/types";

const BASE = "/api";

// Single audited fetch site for the renderer. Per-domain modules
// (monitoringApi, adminApi, dashboardApi, aiUsageApi, alertsApi) import this
// instead of calling fetch() directly — that keeps the renderer-fetch hook
// (.claude/hooks/block-renderer-fetch.mjs) satisfied without a per-file
// allowlist entry. Pass-through today; future cross-cutting concerns (auth
// header injection, request-id propagation, web-mode origin pinning) land here.
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

async function get<T>(url: string, params: Record<string, string | string[] | undefined>): Promise<T> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue;
    if (Array.isArray(v)) {
      for (const item of v) search.append(k, item);
    } else {
      search.set(k, v);
    }
  }
  const res = await apiFetch(`${BASE}${url}?${search.toString()}`);
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      res.ok ? "Raspuns invalid de la server." : "Eroare la comunicarea cu serviciul PortalJust. Incercati din nou."
    );
  }
  if (!res.ok) throw new Error(json.error ?? "Eroare necunoscuta");
  return json;
}

// SSE load-more helper — streams progress events, returns final data
export interface LoadMoreProgress {
  processed: number;
  total: number;
  found: number;
  currentInterval: string;
}

interface LoadMoreResult<T> {
  data: T[];
  total: number;
  warnings: string[];
  partial?: boolean; // true if stopped before completion
}

// Marker pentru erorile raportate explicit de server prin `event: error`.
// Outer catch-ul re-arunca aceste erori ca atare in loc sa le inlocuiasca cu
// mesajul generic "Conexiunea a fost intrerupta..." (HIGH-7, Stage 2a).
class SseExplicitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SseExplicitError";
  }
}

async function loadMoreSSE<T>(
  url: string,
  params: Record<string, string | string[] | undefined>,
  onProgress?: (progress: LoadMoreProgress) => void,
  signal?: AbortSignal,
  onBatch?: (items: T[]) => void,
  existingNumere?: string[]
): Promise<LoadMoreResult<T>> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue;
    if (Array.isArray(v)) {
      for (const item of v) search.append(k, item);
    } else {
      search.set(k, v);
    }
  }

  const res = await apiFetch(`${BASE}${url}?${search.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ existing: existingNumere ?? [] }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let serverMessage: string | null = null;
    try {
      const json = JSON.parse(text);
      if (json && typeof json.error === "string") serverMessage = json.error;
    } catch {
      // body wasn't JSON — fall through to generic message
    }
    throw new Error(serverMessage ?? "Eroare la incarcarea extinsa.");
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const accumulated: T[] = []; // accumulate batch results progressively
  let doneResult: { total: number; warnings: string[] } | null = null;

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let currentEvent = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const data = line.slice(6);
          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch (parseErr) {
            // JSON malformed pe linia data: — logam structurat si continuam
            // (Stage 2a: inainte era silent catch indistinct de erorile reale).
            console.warn("[loadMoreSSE] linie data: cu JSON malformed, ignorata:", parseErr);
            currentEvent = "";
            continue;
          }
          if (currentEvent === "progress" && onProgress) {
            onProgress(parsed as LoadMoreProgress);
          } else if (currentEvent === "batch") {
            // Accumulate new items from this interval
            if (parsed.data && Array.isArray(parsed.data)) {
              accumulated.push(...parsed.data);
              onBatch?.(parsed.data as T[]);
            }
          } else if (currentEvent === "done") {
            doneResult = parsed;
          } else if (currentEvent === "error") {
            throw new SseExplicitError(parsed.error || "Eroare la incarcarea extinsa.");
          }
          currentEvent = "";
        }
      }
    }
  } catch (e) {
    if (e instanceof SseExplicitError) {
      // Eroare raportata explicit de server prin event: error — propagam
      // mesajul as-is in loc sa-l inlocuim cu generic "Conexiunea intrerupta".
      throw new Error(e.message);
    }
    // On any other error (including abort), return what we have so far
    if (accumulated.length > 0) {
      return { data: accumulated, total: accumulated.length, warnings: [], partial: true };
    }
    if (signal?.aborted) {
      throw new DOMException("Anulat de utilizator", "AbortError");
    }
    console.warn("[loadMoreSSE] stream intrerupt fara done si fara batch:", e);
    throw new Error("Conexiunea a fost intrerupta inainte de finalizare.");
  }

  // If aborted but we have data, return partial results
  if (signal?.aborted && accumulated.length > 0) {
    return { data: accumulated, total: accumulated.length, warnings: [], partial: true };
  }

  if (doneResult) {
    return { data: accumulated, total: accumulated.length, warnings: doneResult.warnings || [] };
  }

  // Stream ended without "done" event but we have data
  if (accumulated.length > 0) {
    return { data: accumulated, total: accumulated.length, warnings: [], partial: true };
  }

  throw new Error("Conexiunea a fost intrerupta inainte de finalizare.");
}

export const api = {
  dosare: {
    search: (params: SearchParams) =>
      get<{ data: Dosar[]; total: number }>("/dosare", params as Record<string, string | string[] | undefined>),
    loadMore: (
      params: SearchParams,
      onProgress?: (p: LoadMoreProgress) => void,
      signal?: AbortSignal,
      onBatch?: (items: Dosar[]) => void,
      existingNumere?: string[]
    ) =>
      loadMoreSSE<Dosar>(
        "/dosare/load-more",
        params as Record<string, string | string[] | undefined>,
        onProgress,
        signal,
        onBatch,
        existingNumere
      ),
  },
  termene: {
    search: (params: SearchParams) =>
      get<{ data: Termen[]; total: number }>("/termene", params as Record<string, string | string[] | undefined>),
    loadMore: (
      params: SearchParams,
      onProgress?: (p: LoadMoreProgress) => void,
      signal?: AbortSignal,
      onBatch?: (items: Termen[]) => void,
      existingNumere?: string[]
    ) =>
      loadMoreSSE<Termen>(
        "/termene/load-more",
        params as Record<string, string | string[] | undefined>,
        onProgress,
        signal,
        onBatch,
        existingNumere
      ),
  },
  ai: {
    analyze: async (
      dosar: Dosar,
      model = "claude-sonnet",
      apiKeys?: { anthropic?: string; openai?: string; google?: string }
    ): Promise<{ analysis: string }> => {
      const res = await apiFetch(`${BASE}/ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dosar, model, apiKeys }),
        signal: AbortSignal.timeout(180000), // 3 min — increased for large dosare
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Eroare AI");
      return json;
    },
    analyzeMulti: async (
      dosar: Dosar,
      analysts: [string, string],
      judge: string,
      apiKeys?: { anthropic?: string; openai?: string; google?: string },
      onPhase?: (phase: "analyst1_done" | "analyst2_done" | "judge_started") => void
    ): Promise<{
      analyses: { analyst1: { model: string; text: string }; analyst2: { model: string; text: string } };
      judge: { model: string; text: string };
      final: string;
    }> => {
      const res = await apiFetch(`${BASE}/ai/analyze-multi`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ dosar, analysts, judge, apiKeys }),
        signal: AbortSignal.timeout(300000), // 5 min — multi-agent has 3 sequential AI calls
      });
      if (!res.ok) {
        // Validation/size/rate-limit errors still come back as JSON with a non-2xx status.
        const errJson = await res.json().catch(() => ({ error: "Eroare AI Multi" }));
        throw new Error(errJson.error ?? "Eroare AI Multi");
      }
      if (!res.body) throw new Error("Raspuns streaming indisponibil");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let final: {
        analyses: { analyst1: { model: string; text: string }; analyst2: { model: string; text: string } };
        judge: { model: string; text: string };
        final: string;
      } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          let eventName = "";
          let dataStr = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!eventName || !dataStr) continue;
          const data = JSON.parse(dataStr);
          if (eventName === "done") final = data.result;
          else if (eventName === "error") throw new Error(data.error ?? "Eroare AI Multi");
          else if (eventName === "analyst_done") onPhase?.(data.which === 1 ? "analyst1_done" : "analyst2_done");
          else if (eventName === "judge_started") onPhase?.("judge_started");
        }
      }
      if (!final) throw new Error("Analiza nu s-a incheiat");
      return final;
    },
  },
};

// ===== Shared envelope helpers (v1 surface) ===================================
// /api/v1/* uses `{ data, error?, requestId }`. unwrapMonitoring + the matching
// MonitoringApiError live here so per-domain modules (monitoringApi, adminApi,
// dashboardApi, aiUsageApi, alertsApi) can import them without each redefining
// the envelope contract.

interface MonitoringEnvelopeOk<T> {
  data: T;
  requestId: string;
  error?: undefined;
}
interface MonitoringEnvelopeError {
  data: null;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

export class MonitoringApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function unwrapMonitoring<T>(res: Response): Promise<T> {
  let body: MonitoringEnvelopeOk<T> | MonitoringEnvelopeError;
  try {
    body = (await res.json()) as MonitoringEnvelopeOk<T> | MonitoringEnvelopeError;
  } catch {
    throw new MonitoringApiError("invalid_response", "Raspuns invalid de la server.", res.status);
  }
  if (!res.ok || (body as MonitoringEnvelopeError).error) {
    const e = (body as MonitoringEnvelopeError).error;
    throw new MonitoringApiError(
      e?.code ?? "unknown_error",
      e?.message ?? "Eroare necunoscuta",
      res.status,
      e?.details
    );
  }
  return (body as MonitoringEnvelopeOk<T>).data;
}

// Bulk mark-seen for alerts. Lives here so the renderer-fetch hook stays happy.
// Coordinated with backend agent: POST /api/v1/alerts/seen-bulk { ids } -> { data: MonitoringAlert[] }.
export async function alertsSeenBulkRequest(ids: number[]): Promise<Response> {
  return apiFetch(`/api/v1/alerts/seen-bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

// ─── Stage 8 split: per-domain API surface re-exports ────────────────────────
// monitoringApi.ts / adminApi.ts / dashboardApi.ts hold the real bodies after
// the Stage 8 split. Re-export here so existing `import { monitoring, admin,
// dashboardApi, MonitoringJob, ... } from "@/lib/api"` keeps working without
// touching every page/component.

export {
  monitoring,
  nameLists,
  formatMonitoringTarget,
  getNameSoapInstitutie,
  type MonitoringJob,
  type MonitoringJobKind,
  type MonitoringJobStatus,
  type MonitoringListResult,
  type CreateDosarMonitoringInput,
  type MonitoringCreateResult,
  type CreateNameMonitoringInput,
  type BulkDeleteResult,
  type NameListValidation,
  type NameListPreviewRow,
  type NameListTotals,
  type NameListPreviewResult,
  type NameListCommitInput,
  type NameListCommitResult,
} from "./monitoringApi";

export {
  me,
  admin,
  type UserRole,
  type UserStatus,
  type MeProfile,
  type EmailMinSeverity,
  type EmailSettings,
  type UpsertEmailSettingsInput,
  type TestEmailResult,
  type AdminUser,
  type PaginatedUsers,
  type AuditEvent,
  type PaginatedAudit,
  type QuotaOverride,
  type QuotaListResult,
  type ListUsersOpts,
  type ListAuditOpts,
} from "./adminApi";

export {
  dashboardApi,
  type DashboardJobsBlock,
  type DashboardAlertsBlock,
  type DashboardRunsBlock,
  type DashboardAiBlock,
  type DashboardSummary,
  type TimelineEvent,
  type TimelineEventKind,
  type TimelineEventSeverity,
  type TimelinePayload,
  type ChartsRange,
  type ChartsAlertsPoint,
  type ChartsRunsPoint,
  type ChartsAiPoint,
  type ChartsPayload,
  type ReportTimelineBlock,
  type DashboardReportPayload,
} from "./dashboardApi";
