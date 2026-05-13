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
//   3. In-flight GET aborts on unmount AND on `refresh()` — same race-window
//      reasoning as `useMonitoringJobs`: a stale GET landing after a fresh
//      one would clobber the current state.
//   4. `MonitoringApiError` is a subclass of `Error`, so the generic
//      `e instanceof Error` narrowing covers both shapes cleanly.

import { useCallback, useEffect, useRef, useState } from "react";
import { monitoringMasterSwitch } from "@/lib/api";

export interface UseMonitoringMasterSwitchResult {
  enabled: boolean | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  toggle: (next: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMonitoringMasterSwitch(): UseMonitoringMasterSwitchResult {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAbortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    getAbortRef.current?.abort();
    const ctrl = new AbortController();
    getAbortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const result = await monitoringMasterSwitch.get({ signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setEnabled(result.enabled);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof Error && e.name === "AbortError") return;
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Eroare la incarcarea master switch-ului.");
    } finally {
      if (getAbortRef.current === ctrl) {
        setLoading(false);
        getAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    refresh();
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
      setError(null);
      try {
        const result = await monitoringMasterSwitch.set(next);
        // Sync to server-reported value — defensive, in case backend rejects
        // a no-op or clamps in an unexpected way.
        setEnabled(result.enabled);
      } catch (e) {
        setEnabled(previous);
        const msg = e instanceof Error ? e.message : "Eroare la actualizarea master switch-ului.";
        setError(msg);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [enabled]
  );

  return { enabled, loading, saving, error, toggle, refresh };
}
