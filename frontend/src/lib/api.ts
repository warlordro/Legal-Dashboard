import type { Dosar, SearchParams, Termen } from "@/types";

const BASE = "/api";

type EnvelopeError = { code?: string; message?: string };

export function extractErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      const msg = (err as EnvelopeError).message;
      if (typeof msg === "string") return msg;
    }
  }
  return fallback;
}

// Single audited fetch site for the renderer. Per-domain modules
// (monitoringApi, adminApi, dashboardApi, aiUsageApi, alertsApi) import this
// instead of calling fetch() directly — that keeps the renderer-fetch hook
// (.claude/hooks/block-renderer-fetch.mjs) satisfied without a per-file
// allowlist entry.
//
// F11-F1 Stage 3: injecteaza X-Legal-Dashboard-Desktop: 1 pe toate
// request-urile. Backend-ul (requireDesktopHeader middleware) gateaza
// POST/DELETE-urile admin body-less ca defensa in depth peste originGuard.
// In web mode, backend-ul ignora headerul (autentificarea SSO + CSRF token
// preiau rolul). Pe browser ostil, simple-POST cross-origin nu poate seta
// header custom -> declanseaza preflight CORS care esueaza pe configul
// existent.
const DESKTOP_HEADER_NAME = "X-Legal-Dashboard-Desktop";
const DESKTOP_HEADER_VALUE = "1";
const SYNC_PATH = "/api/v1/auth/oauth2/sync";

function isWebRuntime(): boolean {
  return typeof window !== "undefined" && (window as { desktopApi?: unknown }).desktopApi === undefined;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has(DESKTOP_HEADER_NAME)) {
    headers.set(DESKTOP_HEADER_NAME, DESKTOP_HEADER_VALUE);
  }
  const finalInit: RequestInit = { ...init, headers };
  const res = await fetch(input, finalInit);

  // Web-mode session recovery. A 401 means the session cookie expired (TTL ~1h)
  // or was never minted; re-mint once via the oauth2-proxy bridge and retry the
  // request a single time so the user is never blocked mid-session. Skip auth
  // endpoints (no recursion) and desktop (auth is local, never 401s). The retry
  // uses raw fetch so it cannot re-enter this interceptor.
  if (res.status === 401 && isWebRuntime() && !String(input).includes("/api/v1/auth/")) {
    const outcome = await reSyncSession();
    if (outcome === "ok") {
      return fetch(input, finalInit);
    }
  }
  return res;
}

export type SyncSessionResult = "ok" | "not_provisioned" | "unavailable" | "error";

// Web-mode session bridge. In auth_mode=web the cookie legal_dashboard_session
// is minted ONLY by POST /api/v1/auth/oauth2/sync: oauth2-proxy injects
// X-Auth-Request-Email + the shared-secret X-Proxy-Auth on every upstream
// request, and the backend turns that into our native HS256 cookie. Called on
// app bootstrap, on the periodic keep-alive (cookie TTL is ~1h), and on 401
// recovery above. Best-effort: never throws. /auth/refresh only rotates an
// already-valid cookie, so it cannot bootstrap — the bridge always can, as long
// as the oauth2-proxy Google session is alive (~7 days).
export async function syncWebSession(signal?: AbortSignal): Promise<SyncSessionResult> {
  let res: Response;
  try {
    res = await apiFetch(SYNC_PATH, { method: "POST", signal: signal ?? AbortSignal.timeout(10_000) });
  } catch (err) {
    console.warn("[syncWebSession] bridge sync failed:", err);
    return "error";
  }
  if (res.ok) return "ok";
  if (res.status === 403) return "not_provisioned"; // not_provisioned / forbidden / account_inactive
  if (res.status === 400 || res.status === 503) return "unavailable"; // desktop_only / missing_identity / bridge_disabled
  return "error";
}

// Dedupe concurrent re-syncs: a burst of requests can 401 at once, but only one
// bridge POST should be in flight; every retry awaits the same promise.
let reSyncInFlight: Promise<SyncSessionResult> | null = null;
function reSyncSession(): Promise<SyncSessionResult> {
  reSyncInFlight ??= syncWebSession().finally(() => {
    reSyncInFlight = null;
  });
  return reSyncInFlight;
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
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      res.ok ? "Raspuns invalid de la server." : "Eroare la comunicarea cu serviciul PortalJust. Incercati din nou."
    );
  }
  if (!res.ok) throw new Error(extractErrorMessage(json, "Eroare necunoscuta"));
  return json as T;
}

function parseFilenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // fall through to ascii branch
    }
  }
  const ascii = /filename="([^"]+)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header);
  if (ascii) return ascii[1].trim();
  return fallback;
}

async function postBlob<T>(url: string, body: T, fallbackFilename: string): Promise<{ blob: Blob; filename: string }> {
  const res = await apiFetch(`${BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Eroare server (${res.status})`;
    try {
      const data = await res.json();
      msg = extractErrorMessage(data, msg);
    } catch {
      // Binary/non-JSON error body; keep status fallback.
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const filename = parseFilenameFromContentDisposition(res.headers.get("Content-Disposition"), fallbackFilename);
  return { blob, filename };
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
      const extracted = extractErrorMessage(json, "");
      if (extracted) serverMessage = extracted;
    } catch {
      // body wasn't JSON — fall through to generic message
    }
    throw new Error(serverMessage ?? "Eroare la incarcarea extinsa.");
  }

  if (!res.body) throw new Error("Conexiunea nu a returnat stream.");
  const reader = res.body.getReader();
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
          let parsed: unknown;
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
            const batch = parsed as { data?: unknown };
            if (batch.data && Array.isArray(batch.data)) {
              accumulated.push(...(batch.data as T[]));
              onBatch?.(batch.data as T[]);
            }
          } else if (currentEvent === "done") {
            doneResult = parsed as { total: number; warnings: string[] };
          } else if (currentEvent === "error") {
            throw new SseExplicitError(extractErrorMessage(parsed, "Eroare la incarcarea extinsa."));
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
    // ICCJ live-proxy search (separate endpoint; date-DESC, paginated).
    searchIccj: (params: SearchParams, page = 1) =>
      get<{ data: Dosar[]; total: number; page: number }>("/dosare-iccj", {
        numarDosar: params.numarDosar,
        obiectDosar: params.obiectDosar,
        numeParte: params.numeParte,
        sectie: params.sectie,
        dataStart: params.dataStart,
        dataStop: params.dataStop,
        page: String(page),
      }),
    detaliuIccj: (iccjId: string) => get<{ data: Dosar }>(`/dosare-iccj/detaliu/${encodeURIComponent(iccjId)}`, {}),
    exportXlsxBlob: (dosare: Dosar[]) =>
      postBlob("/v1/dosare/export.xlsx", { dosare }, dosare.length === 1 ? "dosar.xlsx" : "dosare.xlsx"),
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
    // ICCJ termene: search dosare (numar/parte/obiect/sectie) and return ALL their
    // hearings. No date required; dataStart/dataStop are optional result filters.
    searchIccj: (params: SearchParams) =>
      get<{ data: Termen[]; total: number; dosareCount?: number; truncated?: boolean }>("/termene-iccj", {
        numarDosar: params.numarDosar,
        numeParte: params.numeParte,
        obiectDosar: params.obiectDosar,
        sectie: params.sectie,
        dataStart: params.dataStart,
        dataStop: params.dataStop,
      }),
    exportXlsxBlob: (termene: Termen[]) =>
      postBlob("/v1/termene/export.xlsx", { termene }, termene.length === 1 ? "termen.xlsx" : "termene.xlsx"),
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
      apiKeys?: { anthropic?: string; openai?: string; google?: string; openrouter?: string }
    ): Promise<{ analysis: string }> => {
      const res = await apiFetch(`${BASE}/ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dosar, model, apiKeys }),
        signal: AbortSignal.timeout(180000), // 3 min — increased for large dosare
      });
      const json = await res.json();
      if (!res.ok) throw new Error(extractErrorMessage(json, "Eroare AI"));
      return json;
    },
    analyzeMulti: async (
      dosar: Dosar,
      analysts: [string, string],
      judge: string,
      apiKeys?: { anthropic?: string; openai?: string; google?: string; openrouter?: string },
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
        signal: AbortSignal.timeout(420000), // 7 min — analysts in paralel (cap 180s fiecare) + judge dupa (cap 180s) = 360s worst case, plus 60s margine retea
      });
      if (!res.ok) {
        // Validation/size/rate-limit errors still come back as JSON with a non-2xx status.
        const errJson = await res.json().catch(() => ({ error: "Eroare AI Multi" }));
        throw new Error(extractErrorMessage(errJson, "Eroare AI Multi"));
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
          else if (eventName === "error") throw new Error(extractErrorMessage(data, "Eroare AI Multi"));
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
  // requestId vine din envelope ({ data, error, requestId }) si e propagat aici
  // ca bannerele de eroare sa-l poata afisa pentru corelare cu logurile server.
  requestId?: string;
  constructor(code: string, message: string, status: number, details?: unknown, requestId?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
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
    const requestId = (body as MonitoringEnvelopeError).requestId;
    throw new MonitoringApiError(
      e?.code ?? "unknown_error",
      e?.message ?? "Eroare necunoscuta",
      res.status,
      e?.details,
      typeof requestId === "string" ? requestId : undefined
    );
  }
  return (body as MonitoringEnvelopeOk<T>).data;
}

// Bulk mark-seen for alerts. Lives here so the renderer-fetch hook stays happy.
// Coordinated with backend agent: POST /api/v1/alerts/seen-bulk { ids } -> { data: MonitoringAlert[] }.
export async function alertsSeenBulkRequest(ids: number[]): Promise<Response> {
  return apiFetch("/api/v1/alerts/seen-bulk", {
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
  getIccjId,
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
  monitoringMasterSwitch,
  type MasterSwitchGetResult,
  type MasterSwitchSetResult,
} from "./monitoringMasterSwitchApi";

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
  type QuotaPeriod,
  type QuotaGrant,
  type QuotaGrantListResult,
  type CreateGrantInput,
  type TenantKeyField,
  type TenantCaptchaProvider,
  type TenantCaptchaMode,
  type TenantKeyStatus,
  type TenantKeysResult,
  type MeBudgetItem,
  type MeBudgetResult,
  type MeFxRate,
  type MeBudgetWarning,
  type MeBudgetWarningsResult,
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
