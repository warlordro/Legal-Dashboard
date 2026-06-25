import { useEffect } from "react";
import { ensureWebSession } from "@/lib/api";

// Keep the web session alive for as long as the app is open, so a user is never
// blocked and never has to refresh. Three triggers, all routed through the
// deduped ensureWebSession():
//   - interval: re-mint every 50min (< 1h cookie TTL) while the tab is active;
//   - visibilitychange: re-mint when the tab regains focus (the timer is
//     unreliable while backgrounded / after the machine sleeps);
//   - online: re-mint when the network comes back.
// Re-minting before the next request also lets the alerts SSE stream reconnect
// with a fresh cookie. Desktop: no-op (auth is local).
const REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50 min < 1h cookie TTL

export function useSessionKeepAlive(): void {
  useEffect(() => {
    if (typeof window === "undefined" || window.desktopApi !== undefined) return;
    const id = window.setInterval(() => {
      void ensureWebSession();
    }, REFRESH_INTERVAL_MS);
    const wake = () => {
      if (document.visibilityState === "visible") void ensureWebSession();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, []);
}
