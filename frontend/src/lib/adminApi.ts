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

export type QuotaPeriod = "day" | "week" | "month";

export interface QuotaOverride {
  feature: string;
  period: QuotaPeriod;
  // v2.32.0: limita canonica (nullable = unlimited). dailyLimitUsdMilli ramane
  // pentru clientii vechi — null cand period != 'day'.
  limitUsdMilli: number | null;
  dailyLimitUsdMilli: number | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface QuotaListResult {
  userId: string;
  overrides: QuotaOverride[];
}

export interface QuotaGrant {
  id: number;
  userId: string;
  feature: string;
  extraUsdMilli: number;
  expiresAt: string;
  reason: string | null;
  grantedAt: string;
  grantedBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
}

export interface QuotaGrantListResult {
  userId: string;
  grants: QuotaGrant[];
}

export interface CreateGrantInput {
  feature: string;
  extraUsdMilli: number;
  expiresAt: string;
  reason?: string | null;
}

export type TenantKeyField = "anthropic" | "openai" | "google" | "openrouter" | "twocaptcha" | "capsolver";
export type TenantCaptchaProvider = "2captcha" | "capsolver";
export type TenantCaptchaMode = "sequential" | "race";

export interface TenantKeyStatus {
  set: boolean;
  last4: string | null;
}

export interface TenantKeysResult {
  keys: Record<TenantKeyField, TenantKeyStatus>;
  captcha: {
    provider: TenantCaptchaProvider;
    mode: TenantCaptchaMode;
  };
  updatedAt: string;
  updatedBy: string | null;
}

export interface MeBudgetItem {
  feature: string;
  period: QuotaPeriod;
  usedMilli: number;
  baseLimitMilli: number | null;
  extraFromGrantsMilli: number;
  effectiveLimitMilli: number | null;
  // Legacy alias mentinut pentru BudgetIndicator + clienti vechi. Egal cu
  // effectiveLimitMilli; null = unlimited.
  limitMilli: number | null;
}

export interface MeFxRate {
  pair: "USD/EUR";
  rate: number | null;
  rateDate: string | null;
  stale: boolean;
}

export interface MeBudgetResult {
  items: MeBudgetItem[];
  fx: MeFxRate;
}

export interface MeBudgetWarning {
  feature: string;
  thresholdPct: number;
  firedAt: string;
  emailSentAt: string | null;
  aboveThresholdSince: string;
}

export interface MeBudgetWarningsResult {
  warnings: MeBudgetWarning[];
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

    put: async (input: UpsertEmailSettingsInput, signal?: AbortSignal): Promise<EmailSettings> => {
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

  budget: async (signal?: AbortSignal): Promise<MeBudgetResult> => {
    const res = await apiFetch("/api/v1/me/budget", { signal });
    return unwrapMonitoring<MeBudgetResult>(res);
  },

  budgetWarnings: async (signal?: AbortSignal): Promise<MeBudgetWarningsResult> => {
    const res = await apiFetch("/api/v1/me/budget-warnings", { signal });
    return unwrapMonitoring<MeBudgetWarningsResult>(res);
  },

  fxUsdEur: async (signal?: AbortSignal): Promise<MeFxRate> => {
    const res = await apiFetch("/api/v1/me/fx/usd-eur", { signal });
    return unwrapMonitoring<MeFxRate>(res);
  },
};

export type SyncSessionResult = "ok" | "not_provisioned" | "unavailable" | "error";

// Web-mode session bootstrap. In `auth_mode=web` the session cookie
// `legal_dashboard_session` is minted ONLY by POST /api/v1/auth/oauth2/sync:
// oauth2-proxy injects `X-Auth-Request-Email` + the shared-secret `X-Proxy-Auth`
// on every upstream request, and the backend bridge turns that into our native
// HS256 cookie (backend/src/routes/auth.ts). The SPA must trigger it once on
// load — without it every /api call returns 401 "Token de autentificare
// necesar.". `/auth/refresh` only rotates an already-valid cookie, so it cannot
// bootstrap a session from scratch. Best-effort: never throws.
export async function syncWebSession(signal?: AbortSignal): Promise<SyncSessionResult> {
  let res: Response;
  try {
    res = await apiFetch("/api/v1/auth/oauth2/sync", {
      method: "POST",
      signal: signal ?? AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Network failure or 10s timeout — transient. Log it (a stuck "Se
    // conecteaza..." otherwise leaves no trace), then let the caller render the
    // app; per-request error states surface the resulting 401s.
    console.warn("[syncWebSession] bridge sync failed:", err);
    return "error";
  }
  if (res.ok) return "ok";
  if (res.status === 403) return "not_provisioned"; // email not in `users` table
  if (res.status === 400 || res.status === 503) return "unavailable"; // desktop_only / bridge_disabled
  return "error";
}

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
    const res = await apiFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/quota`, { signal });
    return unwrapMonitoring<QuotaListResult>(res);
  },

  upsertQuota: async (
    userId: string,
    input: { feature: string; period: QuotaPeriod; limitUsdMilli: number | null }
  ): Promise<QuotaOverride> => {
    const res = await apiFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/quota`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature: input.feature,
        period: input.period,
        limitUsdMilli: input.limitUsdMilli,
      }),
    });
    return unwrapMonitoring<QuotaOverride>(res);
  },

  deleteQuota: async (userId: string, feature: string): Promise<{ feature: string; removed: boolean }> => {
    const res = await apiFetch(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/quota/${encodeURIComponent(feature)}`,
      { method: "DELETE" }
    );
    return unwrapMonitoring<{ feature: string; removed: boolean }>(res);
  },

  listGrants: async (userId: string, signal?: AbortSignal): Promise<QuotaGrantListResult> => {
    const res = await apiFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/grants`, { signal });
    return unwrapMonitoring<QuotaGrantListResult>(res);
  },

  createGrant: async (userId: string, input: CreateGrantInput): Promise<QuotaGrant> => {
    const res = await apiFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/grants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature: input.feature,
        extraUsdMilli: input.extraUsdMilli,
        expiresAt: input.expiresAt,
        reason: input.reason ?? undefined,
      }),
    });
    return unwrapMonitoring<QuotaGrant>(res);
  },

  revokeGrant: async (grantId: number, reason?: string | null): Promise<{ id: number; revoked: boolean }> => {
    const res = await apiFetch(`/api/v1/admin/grants/${grantId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason ?? undefined }),
    });
    return unwrapMonitoring<{ id: number; revoked: boolean }>(res);
  },

  getTenantKeys: async (signal?: AbortSignal): Promise<TenantKeysResult> => {
    const res = await apiFetch("/api/v1/admin/keys", { signal });
    return unwrapMonitoring<TenantKeysResult>(res);
  },

  setTenantKey: async (
    field: TenantKeyField,
    value: string
  ): Promise<TenantKeyStatus & { field: TenantKeyField; validationSkipped: boolean }> => {
    const res = await apiFetch(`/api/v1/admin/keys/${encodeURIComponent(field)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    return unwrapMonitoring<TenantKeyStatus & { field: TenantKeyField; validationSkipped: boolean }>(res);
  },

  setTenantCaptchaSettings: async (
    provider: TenantCaptchaProvider,
    mode: TenantCaptchaMode
  ): Promise<{ provider: TenantCaptchaProvider; mode: TenantCaptchaMode }> => {
    const res = await apiFetch("/api/v1/admin/keys/captcha", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, mode }),
    });
    return unwrapMonitoring<{ provider: TenantCaptchaProvider; mode: TenantCaptchaMode }>(res);
  },
};
