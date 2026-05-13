// Per-owner monitoring master switch — global pause/resume for the scheduler.
// Lives outside monitoringApi.ts because the surface is a different domain:
// monitoringApi.ts covers per-job CRUD, while this module touches a single
// per-owner setting (table `monitoring_master_switch`, default enabled=true).
// Splitting keeps the import names clean (`monitoringMasterSwitch.get/set` vs
// adding yet another verb onto the already-busy `monitoring` namespace).
// Calls go through `apiFetch` exported from api.ts — that wrapper is the
// single audited fetch site, satisfying the renderer-fetch hook without a
// per-file allowlist entry. Envelope unwrap + MonitoringApiError reused
// from api.ts so the contract stays consistent across monitoring modules.

import { apiFetch, unwrapMonitoring } from "./api";

export interface MasterSwitchGetResult {
  enabled: boolean;
}

export interface MasterSwitchSetResult {
  enabled: boolean;
  changed: boolean;
}

export const monitoringMasterSwitch = {
  get: async (opts: { signal?: AbortSignal } = {}): Promise<MasterSwitchGetResult> => {
    const res = await apiFetch("/api/v1/monitoring/master-switch", { signal: opts.signal });
    return unwrapMonitoring<MasterSwitchGetResult>(res);
  },

  set: async (enabled: boolean): Promise<MasterSwitchSetResult> => {
    const res = await apiFetch("/api/v1/monitoring/master-switch", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    return unwrapMonitoring<MasterSwitchSetResult>(res);
  },
};
