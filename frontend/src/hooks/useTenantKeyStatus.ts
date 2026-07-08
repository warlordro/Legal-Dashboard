import { useMemo, useSyncExternalStore } from "react";
import { me } from "@/lib/api";
import type { TenantKeysConfigured } from "@/lib/api";

// v2.41.0 (P3): sursa de adevar pentru politica de chei in web mode. Backend-ul
// tine cheile tenant criptate; frontend-ul NU are cheile, doar flag-uri boolean
// prin GET /api/v1/me/key-status. Pe desktop nu se apeleaza endpointul —
// window.desktopApi = chrome Electron, cheile vin din safeStorage (BYOK).
//
// Fail-open pe client: cand starea e loading/error, guardurile de UI NU
// blocheaza actiuni (serverul e sursa de adevar si respinge el daca lipseste
// cheia). Vezi consumatorii: useDosareAi, RnpmSearch.
//
// v2.42.0 (audit, finding #3): STORE PARTAJAT la nivel de modul, pe modelul
// useCurrentUser. Hook-ul e consumat din mai multe locuri montate simultan
// (sidebar-footer + Dosare + RNPM + Setari); cu fetch per instanta, boot-ul
// lansa 3-4 request-uri identice, iar fiecare instanta avea propriul throttle
// de focus — un singur re-focus producea o rafala de apeluri duplicate.
// Acum: UN fetch pentru toate instantele, UN listener de focus per aplicatie.

export type TenantKeyState =
  | { state: "desktop" }
  | { state: "loading" }
  | { state: "error" }
  | {
      state: "ready";
      serverAuthMode: "web" | "desktop";
      configured: TenantKeysConfigured;
    };

const FOCUS_THROTTLE_MS = 5000;

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && window.desktopApi !== undefined;
}

let state: TenantKeyState = { state: "loading" };
// Guard de secventa: doar raspunsul celui mai recent request scrie starea,
// altfel un fetch lent aterizat tarziu ar suprascrie unul proaspat.
let requestSeq = 0;
let inflight = false;
let lastFocusFetch = 0;
let bootstrapped = false;
const listeners = new Set<() => void>();

function emit(next: TenantKeyState): void {
  state = next;
  for (const listener of listeners) listener();
}

function doFetch(): void {
  const seq = ++requestSeq;
  inflight = true;
  // Pastreaza "ready" la refetch (fara flicker de loading peste date valide).
  if (state.state !== "ready") emit({ state: "loading" });
  me.keyStatus()
    .then((res) => {
      if (seq !== requestSeq) return;
      inflight = false;
      emit({
        state: "ready",
        serverAuthMode: res.authMode,
        configured: res.tenantKeysConfigured,
      });
    })
    .catch(() => {
      if (seq !== requestSeq) return;
      inflight = false;
      emit({ state: "error" });
    });
}

function onFocus(): void {
  // Refetch la revenirea in tab (adminul poate seta cheile intre timp), dar
  // cu throttle GLOBAL 5s: fara el, alt-tab rapid spameaza backend-ul.
  const now = Date.now();
  if (now - lastFocusFetch < FOCUS_THROTTLE_MS) return;
  lastFocusFetch = now;
  doFetch();
}

function ensureBootstrapped(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  if (isDesktopRuntime()) {
    state = { state: "desktop" };
    return;
  }
  doFetch();
  // Listener unic per aplicatie, atasat la primul abonat si pastrat pe durata
  // vietii aplicatiei (sidebar-footer e montat permanent, deci store-ul nu
  // ramane niciodata fara consumatori in practica).
  window.addEventListener("focus", onFocus);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureBootstrapped();
  // Retry la mount daca starea anterioara e eroare — gardat de inflight ca o
  // rafala de mount-uri simultane sa nu lanseze N fetch-uri.
  if (state.state === "error" && !inflight) doFetch();
  return () => listeners.delete(listener);
}

function getSnapshot(): TenantKeyState {
  return state;
}

function refresh(): void {
  if (isDesktopRuntime()) {
    emit({ state: "desktop" });
    return;
  }
  doFetch();
}

// Reset pentru teste: stare initiala + listeners curatati + listener de focus
// scos (fara el, un test anterior lasa abonati morti si fetch-uri fantoma).
export function __resetTenantKeyStatusStoreForTests(): void {
  state = { state: "loading" };
  requestSeq += 1;
  inflight = false;
  lastFocusFetch = 0;
  if (bootstrapped && typeof window !== "undefined") {
    window.removeEventListener("focus", onFocus);
  }
  bootstrapped = false;
  listeners.clear();
}

export interface UseTenantKeyStatusResult {
  state: TenantKeyState;
  // ready + serverul e in web mode: politica de chei tenant e activa.
  tenantMode: boolean;
  hasTenantAiKey: boolean;
  tenantAiKeysMissing: boolean;
  tenantCaptchaMissing: boolean;
  configured: TenantKeysConfigured | null;
  refresh: () => void;
}

export function useTenantKeyStatus(): UseTenantKeyStatusResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const tenantMode = snapshot.state === "ready" && snapshot.serverAuthMode === "web";
  const configured = snapshot.state === "ready" ? snapshot.configured : null;

  const derived = useMemo(() => {
    if (!tenantMode || configured === null) {
      return { hasTenantAiKey: false, tenantAiKeysMissing: false, tenantCaptchaMissing: false };
    }
    const hasTenantAiKey = configured.anthropic || configured.openai || configured.google || configured.openrouter;
    return {
      hasTenantAiKey,
      tenantAiKeysMissing: !hasTenantAiKey,
      tenantCaptchaMissing: !configured.captcha,
    };
  }, [tenantMode, configured]);

  return {
    state: snapshot,
    tenantMode,
    hasTenantAiKey: derived.hasTenantAiKey,
    tenantAiKeysMissing: derived.tenantAiKeysMissing,
    tenantCaptchaMissing: derived.tenantCaptchaMissing,
    configured,
    refresh,
  };
}
