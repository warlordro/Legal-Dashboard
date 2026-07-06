import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [state, setState] = useState<TenantKeyState>(() =>
    isDesktopRuntime() ? { state: "desktop" } : { state: "loading" }
  );
  // Guard de secventa: doar raspunsul celui mai recent request scrie starea,
  // altfel un fetch lent aterizat tarziu ar suprascrie unul proaspat.
  const requestSeq = useRef(0);
  const lastFocusFetch = useRef(0);

  const refresh = useCallback(() => {
    if (isDesktopRuntime()) {
      setState({ state: "desktop" });
      return;
    }
    const seq = ++requestSeq.current;
    setState((prev) => (prev.state === "ready" ? prev : { state: "loading" }));
    me.keyStatus()
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setState({
          state: "ready",
          serverAuthMode: res.authMode,
          configured: res.tenantKeysConfigured,
        });
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setState({ state: "error" });
      });
  }, []);

  useEffect(() => {
    if (isDesktopRuntime()) return;
    refresh();
    // Refetch la revenirea in tab (adminul poate seta cheile intre timp), dar
    // cu throttle 5s: fara el, alt-tab rapid spameaza backend-ul.
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusFetch.current < FOCUS_THROTTLE_MS) return;
      lastFocusFetch.current = now;
      refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const tenantMode = state.state === "ready" && state.serverAuthMode === "web";
  const configured = state.state === "ready" ? state.configured : null;

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
    state,
    tenantMode,
    hasTenantAiKey: derived.hasTenantAiKey,
    tenantAiKeysMissing: derived.tenantAiKeysMissing,
    tenantCaptchaMissing: derived.tenantCaptchaMissing,
    configured,
    refresh,
  };
}
