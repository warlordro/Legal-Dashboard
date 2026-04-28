import type { Dosar, SearchParams, Termen } from "@/types";

const BASE = "/api";

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
  const res = await fetch(`${BASE}${url}?${search.toString()}`);
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(res.ok ? "Raspuns invalid de la server." : "Eroare la comunicarea cu serviciul PortalJust. Incercati din nou.");
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

async function loadMoreSSE<T>(
  url: string,
  params: Record<string, string | string[] | undefined>,
  onProgress?: (progress: LoadMoreProgress) => void,
  signal?: AbortSignal,
  onBatch?: (items: T[]) => void,
  existingNumere?: string[],
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

  const res = await fetch(`${BASE}${url}?${search.toString()}`, {
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
          try {
            const parsed = JSON.parse(data);
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
              throw new Error(parsed.error || "Eroare la incarcarea extinsa.");
            }
          } catch (e) {
            if (e instanceof Error && e.message !== "Eroare la incarcarea extinsa.") {
              // JSON parse error, ignore
            } else {
              throw e;
            }
          }
          currentEvent = "";
        }
      }
    }
  } catch {
    // On any error (including abort), return what we have so far
    if (accumulated.length > 0) {
      return { data: accumulated, total: accumulated.length, warnings: [], partial: true };
    }
    if (signal?.aborted) {
      throw new DOMException("Anulat de utilizator", "AbortError");
    }
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
    loadMore: (params: SearchParams, onProgress?: (p: LoadMoreProgress) => void, signal?: AbortSignal, onBatch?: (items: Dosar[]) => void, existingNumere?: string[]) =>
      loadMoreSSE<Dosar>("/dosare/load-more", params as Record<string, string | string[] | undefined>, onProgress, signal, onBatch, existingNumere),
  },
  termene: {
    search: (params: SearchParams) =>
      get<{ data: Termen[]; total: number }>("/termene", params as Record<string, string | string[] | undefined>),
    loadMore: (params: SearchParams, onProgress?: (p: LoadMoreProgress) => void, signal?: AbortSignal, onBatch?: (items: Termen[]) => void, existingNumere?: string[]) =>
      loadMoreSSE<Termen>("/termene/load-more", params as Record<string, string | string[] | undefined>, onProgress, signal, onBatch, existingNumere),
  },
  ai: {
    analyze: async (dosar: Dosar, model: string = "claude-sonnet", apiKeys?: { anthropic?: string; openai?: string; google?: string }): Promise<{ analysis: string }> => {
      const res = await fetch(`${BASE}/ai/analyze`, {
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
      onPhase?: (phase: "analyst1_done" | "analyst2_done" | "judge_started") => void,
    ): Promise<{
      analyses: { analyst1: { model: string; text: string }; analyst2: { model: string; text: string } };
      judge: { model: string; text: string };
      final: string;
    }> => {
      const res = await fetch(`${BASE}/ai/analyze-multi`, {
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

// ===== Monitoring (PR-3) ====================================================
// /api/v1/monitoring uses the v1 envelope shape `{data, error?, requestId}`.
// Different from the legacy endpoints above, so it has its own helper. All
// fetches live here so the renderer-fetch lint hook stays satisfied.

export type MonitoringJobKind = "dosar_soap" | "name_soap" | "aviz_rnpm";
export type MonitoringJobStatus = "ok" | "error" | "partial" | "skipped";

export interface MonitoringJob {
  id: number;
  owner_id: string;
  kind: MonitoringJobKind;
  target_json: string;
  target_hash: string;
  cadence_sec: number;
  active: number;
  paused_until: string | null;
  alert_config_json: string;
  next_run_at: string;
  last_run_at: string | null;
  last_status: MonitoringJobStatus | null;
  fail_streak: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonitoringListResult {
  rows: MonitoringJob[];
  total: number;
  page: number;
  pageSize: number;
}

interface MonitoringEnvelopeOk<T> { data: T; requestId: string; error?: undefined }
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

async function unwrapMonitoring<T>(res: Response): Promise<T> {
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
      e?.details,
    );
  }
  return (body as MonitoringEnvelopeOk<T>).data;
}

export interface CreateDosarMonitoringInput {
  numar_dosar: string;
  cadence_sec?: number;
  notes?: string;
  client_request_id?: string;
}

export interface CreateNameMonitoringInput {
  name_normalized: string;
  name_kind: "fizic" | "juridic";
  institutie?: string[];
  cadence_sec?: number;
  notes?: string;
  client_request_id?: string;
}

export const monitoring = {
  list: async (params: {
    page?: number;
    pageSize?: number;
    kind?: MonitoringJobKind;
    active?: boolean;
  } = {}): Promise<MonitoringListResult> => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.pageSize) search.set("pageSize", String(params.pageSize));
    if (params.kind) search.set("kind", params.kind);
    if (params.active !== undefined) search.set("active", String(params.active));
    const qs = search.toString();
    const res = await fetch(`/api/v1/monitoring/jobs${qs ? "?" + qs : ""}`);
    return unwrapMonitoring<MonitoringListResult>(res);
  },

  createDosar: async (input: CreateDosarMonitoringInput): Promise<MonitoringJob> => {
    const res = await fetch(`/api/v1/monitoring/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "dosar_soap",
        target: { numar_dosar: input.numar_dosar },
        cadence_sec: input.cadence_sec ?? 14400,
        notes: input.notes,
        client_request_id: input.client_request_id,
      }),
    });
    return unwrapMonitoring<MonitoringJob>(res);
  },

  createName: async (input: CreateNameMonitoringInput): Promise<MonitoringJob> => {
    const target: Record<string, string | string[]> = {
      name_normalized: input.name_normalized,
      name_kind: input.name_kind,
    };
    if (input.institutie && input.institutie.length > 0) {
      target.institutie = input.institutie;
    }
    const res = await fetch(`/api/v1/monitoring/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "name_soap",
        target,
        cadence_sec: input.cadence_sec ?? 86400,
        notes: input.notes,
        client_request_id: input.client_request_id,
      }),
    });
    return unwrapMonitoring<MonitoringJob>(res);
  },

  patch: async (
    id: number,
    patch: { active?: boolean; cadence_sec?: number; notes?: string | null },
  ): Promise<MonitoringJob> => {
    const res = await fetch(`/api/v1/monitoring/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return unwrapMonitoring<MonitoringJob>(res);
  },

  deleteJob: async (id: number): Promise<void> => {
    const res = await fetch(`/api/v1/monitoring/jobs/${id}`, { method: "DELETE" });
    await unwrapMonitoring<{ deleted: boolean }>(res);
  },
};

export function formatMonitoringTarget(job: MonitoringJob): string {
  try {
    const t = JSON.parse(job.target_json) as Record<string, unknown>;
    if (job.kind === "dosar_soap" && typeof t.numar_dosar === "string") return t.numar_dosar;
    if (job.kind === "name_soap" && typeof t.name_normalized === "string") return t.name_normalized;
    if (job.kind === "aviz_rnpm" && typeof t.identificator === "string") return t.identificator;
    return job.target_json;
  } catch {
    return job.target_json;
  }
}
