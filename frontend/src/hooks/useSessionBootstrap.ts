import { useEffect, useRef, useState } from "react";
import { syncWebSession, type SyncSessionResult } from "@/lib/api";

// Establishes the web session before the app makes authenticated calls.
//
// Desktop (Electron): `window.desktopApi` is present, auth is local ("local"
// owner), there is no cookie handshake — mark ready synchronously from the
// initial state so the desktop app renders with zero flash and zero fetch.
//
// Web (browser): mint the session cookie once via syncWebSession(). The render
// gate in App keeps the authenticated shell (Sidebar /me, search, alerts SSE)
// from mounting until this settles, so the first request carries the cookie
// instead of racing it into a 401 "Token de autentificare necesar.". Runs
// exactly once (ref guard, safe under React StrictMode's double-invoke).
export interface SessionBootstrap {
  ready: boolean;
  status: SyncSessionResult;
}

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && window.desktopApi !== undefined;
}

export function useSessionBootstrap(): SessionBootstrap {
  // Desktop-ness is a mount-time invariant (the Electron preload injects
  // window.desktopApi before the bundle runs); capture it once so a late
  // mutation can't re-run the effect and desync `ready`.
  const [desktop] = useState(isDesktopRuntime);
  const [ready, setReady] = useState(desktop);
  const [status, setStatus] = useState<SyncSessionResult>("ok");
  const started = useRef(false);

  useEffect(() => {
    if (desktop || started.current) return;
    started.current = true;
    syncWebSession()
      .then(setStatus)
      .finally(() => setReady(true));
  }, [desktop]);

  return { ready, status };
}
