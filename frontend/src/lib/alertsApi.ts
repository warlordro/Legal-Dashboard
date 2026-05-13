import { MonitoringApiError, alertsSeenBulkRequest, apiFetch } from "@/lib/api";

export type AlertKind =
  | "dosar_new"
  | "termen_new"
  | "termen_changed"
  | "termen_dupa_solutie"
  | "solutie_aparuta"
  | "dosar_disappeared"
  | "stadiu_changed"
  | "categorie_changed"
  | "dosar_relevant_now"
  | "dosar_no_longer_relevant"
  | "aviz_changed"
  | "source_error"
  | "source_partial";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertJobKind = "dosar_soap" | "name_soap" | "aviz_rnpm";

export interface MonitoringAlert {
  id: number;
  owner_id: string;
  job_id: number;
  run_id: number | null;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail_json: string;
  dedup_key: string;
  is_new: number;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
  // v2.6.2 — joined from monitoring_jobs by listAlerts so the UI can backfill
  // numar_dosar / name_normalized for alerts that pre-date runner enrichment
  // (where detail_json lacks the identifying fields). Optional: SSE-pushed
  // alerts and old API responses won't have it.
  job_target_json?: string | null;
  job_kind?: string | null;
  // v2.27.0 - propagated from monitoring_jobs.notes by listAlerts.
  job_notes?: string | null;
}

export interface AlertsListResult {
  rows: MonitoringAlert[];
  total: number;
  page: number;
  pageSize: number;
  unread: number;
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

async function unwrapAlerts<T>(res: Response): Promise<T> {
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

async function unwrapAlertBlob(res: Response, fallbackFilename: string): Promise<{ blob: Blob; filename: string }> {
  if (!res.ok) {
    try {
      const body = (await res.json()) as EnvelopeError | { error?: string };
      if ("error" in body && typeof body.error === "string") {
        throw new MonitoringApiError("unknown_error", body.error, res.status);
      }
      const err = (body as EnvelopeError).error;
      throw new MonitoringApiError(
        err?.code ?? "unknown_error",
        err?.message ?? "Eroare necunoscuta",
        res.status,
        err?.details
      );
    } catch (err) {
      if (err instanceof MonitoringApiError) throw err;
      throw new MonitoringApiError("invalid_response", `Eroare server (${res.status})`, res.status);
    }
  }
  const blob = await res.blob();
  const filename = parseFilenameFromContentDisposition(res.headers.get("Content-Disposition"), fallbackFilename);
  return { blob, filename };
}

export const alertKindLabels: Record<AlertKind, string> = {
  dosar_new: "Dosar nou",
  termen_new: "Termen nou",
  termen_changed: "Termen modificat",
  termen_dupa_solutie: "Termen nou dupa solutie",
  solutie_aparuta: "Solutie aparuta",
  dosar_disappeared: "Dosar disparut",
  stadiu_changed: "Stadiu modificat",
  categorie_changed: "Categorie modificata",
  dosar_relevant_now: "Relevant acum",
  dosar_no_longer_relevant: "Nu mai este relevant",
  aviz_changed: "Aviz modificat",
  source_error: "Eroare sursa",
  source_partial: "Sursa incompleta",
};

export const severityLabels: Record<AlertSeverity, string> = {
  info: "Info",
  warning: "Atentie",
  critical: "Critic",
};

export interface AlertsListParams {
  page?: number;
  pageSize?: number;
  kind?: AlertKind | "all";
  jobKind?: AlertJobKind | "all";
  q?: string;
  severity?: AlertSeverity | "all";
  onlyUnread?: boolean;
  includeDismissed?: boolean;
  from?: string;
  to?: string;
  signal?: AbortSignal;
}

export const alertsApi = {
  list: async (params: AlertsListParams = {}): Promise<AlertsListResult> => {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    if (params.kind && params.kind !== "all") search.set("kind", params.kind);
    if (params.jobKind && params.jobKind !== "all") search.set("jobKind", params.jobKind);
    if (params.q?.trim()) search.set("q", params.q.trim());
    if (params.severity && params.severity !== "all") search.set("severity", params.severity);
    if (params.onlyUnread !== undefined) search.set("onlyUnread", String(params.onlyUnread));
    if (params.includeDismissed !== undefined) search.set("includeDismissed", String(params.includeDismissed));
    if (params.from) search.set("from", params.from);
    if (params.to) search.set("to", params.to);
    const qs = search.toString();
    const res = await apiFetch(`/api/v1/alerts${qs ? `?${qs}` : ""}`, { signal: params.signal });
    return unwrapAlerts<AlertsListResult>(res);
  },

  markSeen: async (id: number): Promise<MonitoringAlert> => {
    const res = await apiFetch(`/api/v1/alerts/${id}/seen`, { method: "PATCH" });
    return unwrapAlerts<MonitoringAlert>(res);
  },

  markUnseen: async (id: number): Promise<MonitoringAlert> => {
    const res = await apiFetch(`/api/v1/alerts/${id}/unseen`, { method: "PATCH" });
    return unwrapAlerts<MonitoringAlert>(res);
  },

  markAlertsSeen: async (ids: number[]): Promise<MonitoringAlert[]> => {
    const res = await alertsSeenBulkRequest(ids);
    return unwrapAlerts<MonitoringAlert[]>(res);
  },

  dismiss: async (id: number): Promise<MonitoringAlert> => {
    const res = await apiFetch(`/api/v1/alerts/${id}/dismissed`, { method: "PATCH" });
    return unwrapAlerts<MonitoringAlert>(res);
  },

  exportAlerts: async (payload: AlertExportRequest, signal?: AbortSignal): Promise<AlertExportResult> => {
    const res = await apiFetch("/api/v1/alerts/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    return unwrapAlerts<AlertExportResult>(res);
  },

  alertsExportXlsxBlob: async (
    payload: AlertExportRequest,
    signal?: AbortSignal,
    contextLabel?: string
  ): Promise<{ blob: Blob; filename: string }> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (contextLabel) headers["x-export-context-label"] = contextLabel;
    const res = await apiFetch("/api/v1/alerts/export.xlsx", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    return unwrapAlertBlob(res, "alerte.xlsx");
  },

  alertsExportPdfBlob: async (
    payload: AlertExportRequest,
    signal?: AbortSignal,
    contextLabel?: string
  ): Promise<{ blob: Blob; filename: string }> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (contextLabel) headers["x-export-context-label"] = contextLabel;
    const res = await apiFetch("/api/v1/alerts/export.pdf", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    return unwrapAlertBlob(res, "alerte.pdf");
  },

  dismissBulk: async (payload: AlertDismissBulkRequest, signal?: AbortSignal): Promise<AlertDismissBulkResult> => {
    const res = await apiFetch("/api/v1/alerts/dismiss-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    return unwrapAlerts<AlertDismissBulkResult>(res);
  },
};

// v2.14.0 — bulk dismiss discriminated union mirrors AlertDismissBulkBodySchema
// in backend/src/routes/alerts.ts. "ids" pentru selectia explicita; "filters"
// pentru aceleasi query params ca lista (fara `includeDismissed` — backend-ul
// l-ar respinge si oricum n-ar avea efect).
export type AlertDismissBulkRequest =
  | { mode: "ids"; ids: number[] }
  | {
      mode: "filters";
      filters?: {
        jobKind?: AlertJobKind;
        q?: string;
        kind?: AlertKind;
        severity?: AlertSeverity;
        onlyUnread?: boolean;
        from?: string;
        to?: string;
      };
    };

export interface AlertDismissBulkResult {
  dismissedCount: number;
  alreadyDismissedCount: number;
  totalMatched: number;
}

// v2.13.0 — export discriminated union mirrors AlertExportBodySchema in
// backend/src/routes/alerts.ts. "ids" pentru selectia explicita, "filters"
// pentru exact aceleasi query params ca lista, "range" pentru export rapid pe
// interval (subset al "filters" cu includeDismissed=true).
export type AlertExportRequest =
  | { mode: "ids"; ids: number[] }
  | {
      mode: "filters";
      filters?: {
        jobKind?: AlertJobKind;
        q?: string;
        kind?: AlertKind;
        severity?: AlertSeverity;
        onlyUnread?: boolean;
        includeDismissed?: boolean;
        from?: string;
        to?: string;
      };
    }
  | { mode: "range"; from: string; to: string };

export interface AlertExportRow {
  alert: MonitoringAlert;
  numarDosar: string | null;
  dosarLink: string | null;
  kindLabel: string;
  severityLabel: string;
  nameMonitored: string | null;
}

export interface AlertExportResult {
  rows: AlertExportRow[];
  count: number;
}
