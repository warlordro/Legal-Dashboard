// useMonitoringMasterSwitch — per-owner global pause/resume state for the
// Monitorizare page header button + amber banner.
//
// Non-obvious patterns:
//   1. `enabled = null` initial sentinel — callers render a "Se incarca..."
//      placeholder until the first GET resolves. This avoids a flash of the
//      wrong button state (e.g. "Opreste" while we still don't know the real
//      server value). Backend defaults to `true` when no row exists, so most
//      sessions resolve quickly to `true`.
//   2. Optimistic-with-rollback on toggle — we flip `enabled` immediately so
//      the click feels instant, but if the PUT rejects we revert to the
//      previous value AND rethrow so the page can surface the error via its
//      own `setError`. Mirrors the cadence-patch pattern in Monitorizare.tsx.
//      No internal `error` field is exposed: the page is the single read
//      site for failure UX, and a hidden field invites silent failures if a
//      maintainer ever drops the page-level try/catch.
//   3. In-flight GET aborts on unmount AND on `refresh()` — same race-window
//      reasoning as `useMonitoringJobs`: a stale GET landing after a fresh
//      one would clobber the current state.
//   4. `refresh()` short-circuits while a `toggle()` PUT is in flight. A
//      future focus-refetch or polling caller would otherwise rewind the
//      optimistic flip before the PUT settles. Today only the mount effect
//      calls refresh, but the guard is cheap insurance.
//   5. `mountedRef` gates all post-await state writes so a late PUT response
//      after unmount cannot trigger a React warning or leak state.
//   6. `MonitoringApiError` is a subclass of `Error`, so the generic
//      `e instanceof Error` narrowing covers both shapes cleanly.

import { useCallback, useEffect, useRef, useState } from "react";
import { monitoringMasterSwitch } from "@/lib/api";

export interface UseMonitoringMasterSwitchResult {
  enabled: boolean | null;
  loading: boolean;
  saving: boolean;
  toggle: (next: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMonitoringMasterSwitch(): UseMonitoringMasterSwitchResult {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const getAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (savingRef.current) return;
    getAbortRef.current?.abort();
    const ctrl = new AbortController();
    getAbortRef.current = ctrl;
    setLoading(true);
    try {
      const result = await monitoringMasterSwitch.get({ signal: ctrl.signal });
      if (ctrl.signal.aborted || !mountedRef.current) return;
      setEnabled(result.enabled);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof Error && e.name === "AbortError") return;
      if (ctrl.signal.aborted || !mountedRef.current) return;
      throw e;
    } finally {
      if (mountedRef.current && getAbortRef.current === ctrl) {
        setLoading(false);
        getAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    // Initial mount fetch — has no caller to rethrow to, so we swallow the
    // error here. The page keeps the "Se incarca..." placeholder; user can
    // retry via the Reincarca button which calls refresh() again.
    refresh().catch(() => {});
    return () => {
      getAbortRef.current?.abort();
      getAbortRef.current = null;
    };
  }, [refresh]);

  const toggle = useCallback(
    async (next: boolean) => {
      // Snapshot the previous value so we can revert on failure. Using a
      // local instead of reading state inside the catch avoids stale-closure
      // bugs if a second toggle starts before the first one settles.
      const previous = enabled;
      setEnabled(next);
      setSaving(true);
      savingRef.current = true;
      try {
        const result = await monitoringMasterSwitch.set(next);
        if (!mountedRef.current) return;
        // Sync to server-reported value — defensive, in case backend rejects
        // a no-op or clamps in an unexpected way.
        setEnabled(result.enabled);
      } catch (e) {
        if (mountedRef.current) setEnabled(previous);
        throw e;
      } finally {
        savingRef.current = false;
        if (mountedRef.current) setSaving(false);
      }
    },
    [enabled]
  );

  return { enabled, loading, saving, toggle, refresh };
}
