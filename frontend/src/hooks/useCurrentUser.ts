import { useEffect, useState } from "react";
import { me, type MeProfile } from "@/lib/api";

export interface UseCurrentUserResult {
  user: MeProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// PR-8 hook used by:
//   - Sidebar (decides whether to render the Admin section)
//   - App.tsx (gates /admin/* routes; shows 403 placeholder otherwise)
//   - Future: header area showing the signed-in user
//
// The fetch happens once on mount + on demand via refresh(). On desktop the
// answer is essentially static (always the seeded `local` user, role updates
// via DB writes), but we still fetch over HTTP so the same hook works
// unchanged in PR-9 web mode where the answer depends on the JWT.

export function useCurrentUser(): UseCurrentUserResult {
  const [user, setUser] = useState<MeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick este trigger explicit pentru refresh, iar me.get este import stabil la nivel de modul.
  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    me.get(ac.signal)
      .then((u) => {
        if (cancelled) return;
        setUser(u);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // 401 / network / etc — surface message but don't throw. Sidebar +
        // App both handle user === null gracefully.
        const msg = e instanceof Error ? e.message : "Eroare la /me";
        setError(msg);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [tick]);

  return {
    user,
    loading,
    error,
    refresh: () => setTick((t) => t + 1),
  };
}
