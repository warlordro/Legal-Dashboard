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

// GET /api/v1/me/key-status — flag-uri boolean per cheie tenant (NU valorile).
// `captcha` reflecta cheia PROVIDER-ULUI ACTIV al tenantului (2captcha SAU
// capsolver, dupa captchaProvider), aliniat cu resolveCaptchaKeyForRoute.
export interface TenantKeysConfigured {
  anthropic: boolean;
  openai: boolean;
  google: boolean;
  openrouter: boolean;
  captcha: boolean;
}

export interface KeyStatusResult {
  authMode: "web" | "desktop";
  tenantKeysConfigured: TenantKeysConfigured;
}

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
  // v2.42.0 (5.4): enrichment server-side — email pentru useri cunoscuti,
  // "system" pentru NULL, id-ul brut ca fallback.
  ownerEmail: string;
  actorEmail: string;
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

// v2.41.0: vederile globale (toate override-urile / granturile active, cu
// identitate user). `truncated` = capul de 500 randuri a fost atins.
// Fara alias-ul legacy dailyLimitUsdMilli — endpointul global e post-v2.32.
export interface GlobalQuotaOverride {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  feature: string;
  period: QuotaPeriod;
  limitUsdMilli: number | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface GlobalQuotaOverridesResult {
  overrides: GlobalQuotaOverride[];
  truncated: boolean;
}

export interface GlobalQuotaGrant extends QuotaGrant {
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
}

export interface GlobalActiveGrantsResult {
  grants: GlobalQuotaGrant[];
  truncated: boolean;
}

// v2.42.0 (5.3): consum per utilizator — cifrele vin din aceleasi functii ca
// guard-urile de cota (limitSource: override/default env/none).
export type UsageLimitSource = "override" | "default" | "none";

// v2.42.0: totaluri rolling (24h/7 zile) + tot istoricul, din acelasi query
// set-based (sumAiUsageWindowsByOwner) folosit si pentru tenantTotals.
export interface AiUsageWindows {
  dayMilli: number;
  weekMilli: number;
  totalMilli: number;
}

export interface UsageOverviewAiItem {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  feature: "ai";
  period: QuotaPeriod;
  usedMilli: number;
  baseLimitMilli: number | null;
  extraFromGrantsMilli: number;
  effectiveLimitMilli: number | null;
  limitSource: UsageLimitSource;
  windows: AiUsageWindows;
}

export interface UsageOverviewCaptchaItem {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  feature: "captcha.rnpm";
  period: QuotaPeriod;
  usedCount: number;
  baseLimitCount: number | null;
  effectiveLimitCount: number | null;
  limitSource: UsageLimitSource;
}

export interface UsageOverviewResult {
  items: UsageOverviewAiItem[];
  captcha: UsageOverviewCaptchaItem[];
  truncated: boolean;
  // Agregat pe tot tenantul (TOTI ownerii cu istoric in ai_usage, inclusiv
  // conturi inactive care nu mai apar in `items`).
  tenantTotals: AiUsageWindows;
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
  // v2.42.0 (Task 15): de unde vine limita afisata — override per utilizator,
  // default din env (doar "ai" in web mode) sau none (nelimitat).
  limitSource: UsageLimitSource;
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

// Contract EXACT cu GET /api/v1/me/budget-warnings (backend/src/routes/me.ts):
// { items: [{ feature, thresholdPct, firedAt, aboveSince, emailSentAt }] }.
// Vechiul shape { warnings, aboveThresholdSince } nu a existat niciodata pe
// backend si crapa pagina Consum (undefined.length in render).
export interface MeBudgetWarning {
  feature: string;
  thresholdPct: number;
  firedAt: string;
  aboveSince: string;
  emailSentAt: string | null;
}

export interface MeBudgetWarningsResult {
  items: MeBudgetWarning[];
}

// v2.42.0 (4.2/4.3): creare individuala + import Excel.
export interface CreateUserInput {
  email: string;
  displayName: string;
  role: "user" | "admin";
}

export interface UserImportIssue {
  rowNumber: number;
  email: string | null;
  code: "invalid_row" | "duplicate_in_file" | "duplicate_in_db";
  message: string;
}

export interface ImportUsersResult {
  created: Array<{ rowNumber: number; email: string; role: string }>;
  issues: UserImportIssue[];
  summary: { created: number; duplicates: number; invalid: number };
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

// v2.42.0 (4.3): descarcari de atasamente (template import, raport audit) prin
// fetch + blob — NU window.location.assign: o eroare 4xx/5xx ar naviga
// browserul pe un JSON brut in loc sa apara in pagina.
export async function fetchBlobOrThrow(path: string, init?: RequestInit): Promise<Blob> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    let code = "download_failed";
    let message = `Descarcare esuata (HTTP ${res.status}).`;
    let requestId: string | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string }; requestId?: string };
      if (body?.error?.message) {
        message = body.error.message;
        code = body.error.code ?? code;
        requestId = body.requestId;
      }
    } catch {
      // corp non-JSON — pastram mesajul generic
    }
    throw new MonitoringApiError(code, message, res.status, undefined, requestId);
  }
  return await res.blob();
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

  keyStatus: async (signal?: AbortSignal): Promise<KeyStatusResult> => {
    const res = await apiFetch("/api/v1/me/key-status", { signal });
    return unwrapMonitoring<KeyStatusResult>(res);
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

  createUser: async (input: CreateUserInput): Promise<AdminUser> => {
    const res = await apiFetch("/api/v1/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return unwrapMonitoring<AdminUser>(res);
  },

  downloadUsersImportTemplate: async (): Promise<Blob> => {
    return fetchBlobOrThrow("/api/v1/admin/users/import-template");
  },

  usageOverview: async (signal?: AbortSignal): Promise<UsageOverviewResult> => {
    const res = await apiFetch("/api/v1/admin/usage/overview", { signal });
    return unwrapMonitoring<UsageOverviewResult>(res);
  },

  importUsers: async (file: ArrayBuffer): Promise<ImportUsersResult> => {
    const res = await apiFetch("/api/v1/admin/users/import", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    return unwrapMonitoring<ImportUsersResult>(res);
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

  listAllQuotaOverrides: async (signal?: AbortSignal): Promise<GlobalQuotaOverridesResult> => {
    const res = await apiFetch("/api/v1/admin/quota/overrides", { signal });
    return unwrapMonitoring<GlobalQuotaOverridesResult>(res);
  },

  listActiveGrants: async (signal?: AbortSignal): Promise<GlobalActiveGrantsResult> => {
    const res = await apiFetch("/api/v1/admin/grants/active", { signal });
    return unwrapMonitoring<GlobalActiveGrantsResult>(res);
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
