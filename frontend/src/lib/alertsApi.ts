import { MonitoringApiError, alertsSeenBulkRequest } from "@/lib/api";

export type AlertKind =
  | "dosar_new"
  | "termen_new"
  | "termen_changed"
  | "solutie_aparuta"
  | "dosar_disappeared"
  | "stadiu_changed"
  | "categorie_changed"
  | "dosar_relevant_now"
  | "dosar_no_longer_relevant"
  | "aviz_changed"
  | "source_error";

export type AlertSeverity = "info" | "warning" | "critical";

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
}

export interface AlertsListResult {
  rows: MonitoringAlert[];
  total: number;
  page: number;
  pageSize: number;
  unread: number;
}

interface EnvelopeOk<T> { data: T; requestId: string; error?: undefined }
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
      err?.details,
    );
  }
  return (body as EnvelopeOk<T>).data;
}

export const alertKindLabels: Record<AlertKind, string> = {
  dosar_new: "Dosar nou",
  termen_new: "Termen nou",
  termen_changed: "Termen modificat",
  solutie_aparuta: "Solutie aparuta",
  dosar_disappeared: "Dosar disparut",
  stadiu_changed: "Stadiu modificat",
  categorie_changed: "Categorie modificata",
  dosar_relevant_now: "Relevant acum",
  dosar_no_longer_relevant: "Nu mai este relevant",
  aviz_changed: "Aviz modificat",
  source_error: "Eroare sursa",
};

export const severityLabels: Record<AlertSeverity, string> = {
  info: "Info",
  warning: "Atentie",
  critical: "Critic",
};

export const alertsApi = {
  list: async (params: {
    page?: number;
    pageSize?: number;
    kind?: AlertKind | "all";
    severity?: AlertSeverity | "all";
    onlyUnread?: boolean;
    includeDismissed?: boolean;
    from?: string;
    to?: string;
  } = {}): Promise<AlertsListResult> => {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    if (params.kind && params.kind !== "all") search.set("kind", params.kind);
    if (params.severity && params.severity !== "all") search.set("severity", params.severity);
    if (params.onlyUnread !== undefined) search.set("onlyUnread", String(params.onlyUnread));
    if (params.includeDismissed !== undefined) search.set("includeDismissed", String(params.includeDismissed));
    if (params.from) search.set("from", params.from);
    if (params.to) search.set("to", params.to);
    const qs = search.toString();
    const res = await fetch(`/api/v1/alerts${qs ? `?${qs}` : ""}`);
    return unwrapAlerts<AlertsListResult>(res);
  },

  markSeen: async (id: number): Promise<MonitoringAlert> => {
    const res = await fetch(`/api/v1/alerts/${id}/seen`, { method: "PATCH" });
    return unwrapAlerts<MonitoringAlert>(res);
  },

  markAlertsSeen: async (ids: number[]): Promise<MonitoringAlert[]> => {
    const res = await alertsSeenBulkRequest(ids);
    return unwrapAlerts<MonitoringAlert[]>(res);
  },

  dismiss: async (id: number): Promise<MonitoringAlert> => {
    const res = await fetch(`/api/v1/alerts/${id}/dismissed`, { method: "PATCH" });
    return unwrapAlerts<MonitoringAlert>(res);
  },
};
