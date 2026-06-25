import { useEffect } from "react";
import { syncWebSession } from "@/lib/api";

// Keep the web session alive for as long as the app is open. The native cookie
// TTL is ~1h; re-mint via the oauth2-proxy bridge well before that so a tab left
// open all day never gets blocked and never needs a manual refresh. The 401
// interceptor in apiFetch is the reactive safety net (e.g. after the machine
// sleeps past the interval); this timer is the proactive path that also keeps
// the alerts SSE stream authenticated. Desktop: no-op (auth is local).
const REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50 min < 1h cookie TTL

export function useSessionKeepAlive(): void {
  useEffect(() => {
    if (typeof window === "undefined" || window.desktopApi !== undefined) return;
    const id = window.setInterval(() => {
      void syncWebSession();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);
}
