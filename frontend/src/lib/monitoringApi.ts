// Monitoring + name-list API surface (PR-3 .. PR-5). Split from lib/api.ts
// (Stage 8) so each domain owns its types, requests, and helpers without
// growing api.ts past ~700 LOC. Calls go through `apiFetch` exported from
// api.ts — that wrapper is the single audited fetch site and keeps the
// renderer-fetch hook satisfied without a per-file allowlist entry.

import { apiFetch, MonitoringApiError, unwrapMonitoring } from "./api";

// Re-export so existing imports `import { MonitoringApiError } from "@/lib/monitoringApi"`
// could work; today consumers still import from "@/lib/api" — keep both paths
// resolvable for forward flexibility.
export { MonitoringApiError };

// ─── Monitoring jobs ─────────────────────────────────────────────────────────

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

export interface CreateDosarMonitoringInput {
  numar_dosar: string;
  cadence_sec?: number;
  notes?: string;
  client_request_id?: string;
}

export interface MonitoringCreateResult {
  job: MonitoringJob;
  created: boolean;
}

export interface CreateNameMonitoringInput {
  name_normalized: string;
  institutie?: string[];
  cadence_sec?: number;
  notes?: string;
  client_request_id?: string;
}

export interface BulkDeleteResult {
  deleted_ids: number[];
  inflight_ids: number[];
  not_found_ids: number[];
  total_deleted: number;
}

export const monitoring = {
  list: async (params: {
    page?: number;
    pageSize?: number;
    kind?: MonitoringJobKind;
    active?: boolean;
  } = {}): Promise<MonitoringListResult> => {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    if (params.kind) search.set("kind", params.kind);
    if (params.active !== undefined) search.set("active", String(params.active));
    const qs = search.toString();
    const res = await apiFetch(`/api/v1/monitoring/jobs${qs ? "?" + qs : ""}`);
    return unwrapMonitoring<MonitoringListResult>(res);
  },

  createDosar: async (input: CreateDosarMonitoringInput): Promise<MonitoringJob> => {
    const result = await monitoring.createDosarWithResult(input);
    return result.job;
  },

  createDosarWithResult: async (input: CreateDosarMonitoringInput): Promise<MonitoringCreateResult> => {
    const res = await apiFetch(`/api/v1/monitoring/jobs`, {
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
    const created = res.status === 201;
    const job = await unwrapMonitoring<MonitoringJob>(res);
    return { job, created };
  },

  createName: async (input: CreateNameMonitoringInput): Promise<MonitoringJob> => {
    const target: Record<string, string | string[]> = {
      name_normalized: input.name_normalized,
    };
    if (input.institutie && input.institutie.length > 0) {
      target.institutie = input.institutie;
    }
    const res = await apiFetch(`/api/v1/monitoring/jobs`, {
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
    const res = await apiFetch(`/api/v1/monitoring/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return unwrapMonitoring<MonitoringJob>(res);
  },

  deleteJob: async (id: number): Promise<void> => {
    const res = await apiFetch(`/api/v1/monitoring/jobs/${id}`, { method: "DELETE" });
    await unwrapMonitoring<{ deleted: boolean }>(res);
  },

  bulkDeleteJobs: async (ids: number[]): Promise<BulkDeleteResult> => {
    const res = await apiFetch(`/api/v1/monitoring/jobs/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    return unwrapMonitoring<BulkDeleteResult>(res);
  },
};

// ─── Name lists (bulk import) ────────────────────────────────────────────────

export type NameListValidation = "ok" | "warn" | "rejected";

export interface NameListPreviewRow {
  rowIndex: number;
  nameRaw: string;
  nameNormalized: string;
  cnp?: string | null;
  cui?: string | null;
  cadenceSec?: number | null;
  notes?: string | null;
  validation: NameListValidation;
  validationMsg?: string | null;
}

export interface NameListTotals {
  total: number;
  ok: number;
  warn: number;
  rejected: number;
}

export interface NameListPreviewResult {
  rows: NameListPreviewRow[];
  totals: NameListTotals;
  sha256: string;
  sourceFilename: string | null;
}

export interface NameListCommitInput {
  title: string;
  sourceFilename?: string | null;
  sourceSha256: string;
  items: Array<{
    nameRaw: string;
    cnp?: string | null;
    cui?: string | null;
    cadenceSec?: number | null;
    notes?: string | null;
  }>;
  autoCreateJobs?: boolean;
  maxJobs?: number;
}

export interface NameListCommitResult {
  list: {
    id: number;
    title: string;
    source_filename: string | null;
    source_sha256: string;
    total_rows: number;
    valid_rows: number;
    created_at: string;
    archived_at: string | null;
  };
  duplicate: boolean;
  totals: NameListTotals;
  jobsCreated: number;
  jobsTotal: number;
  partial: boolean;
}

export const nameLists = {
  preview: async (file: File): Promise<NameListPreviewResult> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await apiFetch(`/api/v1/name-lists/preview`, {
      method: "POST",
      body: fd,
    });
    return unwrapMonitoring<NameListPreviewResult>(res);
  },

  commit: async (input: NameListCommitInput): Promise<NameListCommitResult> => {
    const res = await apiFetch(`/api/v1/name-lists/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return unwrapMonitoring<NameListCommitResult>(res);
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
