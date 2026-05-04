// Admin + /me API surface (PR-8). Split from lib/api.ts (Stage 8) so admin
// pages depend only on this module instead of the full api.ts barrel. Calls
// route through `apiFetch` from api.ts; envelope shape matches monitoring.

import { apiFetch, MonitoringApiError, unwrapMonitoring } from "./api";

export { MonitoringApiError };

export type UserRole = "user" | "admin" | "support" | "readonly";
export type UserStatus = "active" | "suspended" | "deleted";

export interface MeProfile {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string | null;
}

export type EmailMinSeverity = "info" | "warning" | "critical";

export interface EmailSettings {
  ownerId: string;
  enabled: boolean;
  toAddress: string | null;
  minSeverity: EmailMinSeverity;
  dailyReportEnabled: boolean;
  lastDailyReportSentFor: string | null;
  createdAt: string;
  updatedAt: string;
  mailerConfigured: boolean;
}

export interface UpsertEmailSettingsInput {
  enabled: boolean;
  toAddress: string | null;
  minSeverity?: EmailMinSeverity;
  dailyReportEnabled?: boolean;
}

export type TestEmailResult =
  | { ok: true }
  | { ok: false; reason: "mailer_disabled" | "no_recipient" | "send_failed" | string };

export interface AdminUser extends MeProfile {}

export interface PaginatedUsers {
  rows: AdminUser[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuditEvent {
  id: number;
  ts: string;
  ownerId: string | null;
  actorId: string | null;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  outcome: "ok" | "denied" | "error";
  ip: string | null;
  userAgent: string | null;
  detail: unknown;
}

export interface PaginatedAudit {
  rows: AuditEvent[];
  page: number;
  pageSize: number;
  total: number;
}

export interface QuotaOverride {
  feature: string;
  dailyLimitUsdMilli: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface QuotaListResult {
  userId: string;
  overrides: QuotaOverride[];
}

export interface ListUsersOpts {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  signal?: AbortSignal;
}

export interface ListAuditOpts {
  page?: number;
  pageSize?: number;
  ownerId?: string;
  actorId?: string;
  action?: string;
  actionLike?: string;
  targetKind?: string;
  targetId?: string;
  outcome?: "ok" | "denied" | "error";
  // ISO timestamps. since is closed lower bound, until is open upper bound.
  since?: string;
  until?: string;
  signal?: AbortSignal;
}

function adminQs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const me = {
  get: async (signal?: AbortSignal): Promise<MeProfile> => {
    const res = await apiFetch("/api/v1/me", { signal });
    return unwrapMonitoring<MeProfile>(res);
  },

  emailSettings: {
    get: async (signal?: AbortSignal): Promise<EmailSettings> => {
      const res = await apiFetch("/api/v1/me/email-settings", { signal });
      return unwrapMonitoring<EmailSettings>(res);
    },

    put: async (
      input: UpsertEmailSettingsInput,
      signal?: AbortSignal,
    ): Promise<EmailSettings> => {
      const res = await apiFetch("/api/v1/me/email-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });
      return unwrapMonitoring<EmailSettings>(res);
    },

    test: async (signal?: AbortSignal): Promise<TestEmailResult> => {
      const res = await apiFetch("/api/v1/me/email-settings/test", {
        method: "POST",
        signal,
      });
      return unwrapMonitoring<TestEmailResult>(res);
    },
  },
};

export const admin = {
  listUsers: async (opts: ListUsersOpts = {}): Promise<PaginatedUsers> => {
    const { signal, ...params } = opts;
    const res = await apiFetch(`/api/v1/admin/users${adminQs(params)}`, { signal });
    return unwrapMonitoring<PaginatedUsers>(res);
  },

  getUser: async (id: string, signal?: AbortSignal): Promise<AdminUser> => {
    const res = await apiFetch(`/api/v1/admin/users/${encodeURIComponent(id)}`, { signal });
    return unwrapMonitoring<AdminUser>(res);
  },

  updateRole: async (id: string, role: UserRole): Promise<AdminUser> => {
    const res = await apiFetch(`/api/v1/admin/users/${encodeURIComponent(id)}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    return unwrapMonitoring<AdminUser>(res);
  },

  updateStatus: async (id: string, status: UserStatus): Promise<AdminUser> => {
    const res = await apiFetch(`/api/v1/admin/users/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return unwrapMonitoring<AdminUser>(res);
  },

  listAudit: async (opts: ListAuditOpts = {}): Promise<PaginatedAudit> => {
    const { signal, ...params } = opts;
    const res = await apiFetch(`/api/v1/admin/audit${adminQs(params)}`, { signal });
    return unwrapMonitoring<PaginatedAudit>(res);
  },

  listQuota: async (userId: string, signal?: AbortSignal): Promise<QuotaListResult> => {
    const res = await apiFetch(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/quota`,
      { signal },
    );
    return unwrapMonitoring<QuotaListResult>(res);
  },

  upsertQuota: async (
    userId: string,
    feature: string,
    dailyLimitUsdMilli: number,
  ): Promise<QuotaOverride> => {
    const res = await apiFetch(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/quota`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature, dailyLimitUsdMilli }),
      },
    );
    return unwrapMonitoring<QuotaOverride>(res);
  },

  deleteQuota: async (
    userId: string,
    feature: string,
  ): Promise<{ feature: string; removed: boolean }> => {
    const res = await apiFetch(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/quota/${encodeURIComponent(feature)}`,
      { method: "DELETE" },
    );
    return unwrapMonitoring<{ feature: string; removed: boolean }>(res);
  },
};
