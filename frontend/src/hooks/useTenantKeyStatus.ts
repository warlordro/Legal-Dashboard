import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface TenantKeysConfigured {
  anthropic: boolean;
  openai: boolean;
  google: boolean;
  openrouter: boolean;
  captcha: boolean;
}

// Starea cheilor la nivel de tenant, vazuta de userul curent (GET /me/key-status).
// - "desktop": Electron — BYOK local prin safeStorage, nu se face niciun fetch.
// - "loading" / "error": browser, raspunsul inca nu a sosit / a esuat. Politica
//   de consum e FAIL-OPEN: guard-urile client NU blocheaza pe aceste stari;
//   backend-ul ramane sursa de adevar si intoarce el erorile corecte (501/429).
// - "ready": serverAuthMode e modul REAL de auth al backend-ului (spre deosebire
//   de useAuthMode(), care e doar detectie de platforma). In combinatia de dev
//   "browser + backend desktop-auth" serverAuthMode e "desktop" si politica de
//   chei ramane BYOK — vezi invariantul din PLAN-web-ux-fixes.md.
export type TenantKeyStatusState =
  | { state: "desktop" }
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; serverAuthMode: "desktop" | "web"; configured: TenantKeysConfigured };

export interface TenantKeys {
  status: TenantKeyStatusState;
  /** true doar cand serverul a confirmat auth_mode=web (cheile tenant guverneaza). */
  tenantMode: boolean;
  /** tenantMode si cel putin o cheie AI tenant setata. */
  hasTenantAiKey: boolean;
  /** tenantMode si captcha lipsa — singura stare in care UI-ul blocheaza definitiv RNPM. */
  tenantCaptchaMissing: boolean;
  /** tenantMode si nicio cheie AI — singura stare in care prompt-ul de chei AI e definitiv. */
  tenantAiKeysMissing: boolean;
  refresh: () => void;
}

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && !!window.desktopApi;
}

export function useTenantKeyStatus(): TenantKeys {
  const [status, setStatus] = useState<TenantKeyStatusState>(() =>
    isDesktopRuntime() ? { state: "desktop" } : { state: "loading" }
  );
  // Doua fetch-uri suprapuse (mount + focus imediat) pot rezolva in ordine
  // inversa; doar raspunsul celui mai recent request are voie sa scrie starea.
  const requestSeq = useRef(0);

  const refresh = useCallback(() => {
    if (isDesktopRuntime()) return;
    requestSeq.current += 1;
    const seq = requestSeq.current;
    const apply = (next: TenantKeyStatusState) => {
      if (requestSeq.current === seq) setStatus(next);
    };
    void (async () => {
      try {
        const res = await apiFetch("/api/v1/me/key-status");
        if (!res.ok) {
          apply({ state: "error" });
          return;
        }
        const json = (await res.json()) as {
          data?: { authMode?: unknown; tenantKeysConfigured?: Partial<TenantKeysConfigured> };
        };
        const data = json?.data;
        if (!data || typeof data !== "object") {
          apply({ state: "error" });
          return;
        }
        apply({
          state: "ready",
          serverAuthMode: data.authMode === "web" ? "web" : "desktop",
          configured: {
            anthropic: data.tenantKeysConfigured?.anthropic === true,
            openai: data.tenantKeysConfigured?.openai === true,
            google: data.tenantKeysConfigured?.google === true,
            openrouter: data.tenantKeysConfigured?.openrouter === true,
            captcha: data.tenantKeysConfigured?.captcha === true,
          },
        });
      } catch {
        apply({ state: "error" });
      }
    })();
  }, []);

  // Refetch la focus: adminul poate schimba cheile in alt tab (/admin/keys);
  // statusul stale nu trebuie sa blocheze sau sa arate "Activ" fals la revenire.
  useEffect(() => {
    if (isDesktopRuntime()) return;
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Referinta stabila per stare — consumatorii (useDosareAi, props memo) nu
  // primesc un obiect nou la fiecare render.
  return useMemo(() => {
    const tenantMode = status.state === "ready" && status.serverAuthMode === "web";
    const configured = status.state === "ready" && tenantMode ? status.configured : null;
    const hasTenantAiKey =
      configured !== null && (configured.anthropic || configured.openai || configured.google || configured.openrouter);

    return {
      status,
      tenantMode,
      hasTenantAiKey,
      tenantCaptchaMissing: configured !== null && !configured.captcha,
      tenantAiKeysMissing: configured !== null && !hasTenantAiKey,
      refresh,
    };
  }, [status, refresh]);
}
