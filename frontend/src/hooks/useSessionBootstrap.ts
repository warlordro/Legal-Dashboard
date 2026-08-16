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

// Reincercari marginite pe esecul TRANZITORIU al handshake-ului.
//
// Cand sync-ul esueaza (blip de retea, bridge picat sau inca nepornit dupa un
// redeploy), shell-ul se monteaza oricum si toate cererile de la pornire iau 401.
// Fiecare se repara singura prin interceptor, deci utilizatorul nu vede nimic —
// dar auditul primeste o rafala, iar `auth.denied` e clasificat "critical" in
// timeline-ul de dashboard, deci fiecare pornire nereusita pune randuri rosii
// false in fata adminului si dilueaza semnalul real de securitate.
//
// DECIZIE A USERULUI (2026-08-16), fixata de testul "GARANTIE": aplicatia trebuie
// sa porneasca INTOTDEAUNA. Varianta care refuza montarea pana la succes a fost
// respinsa explicit — un ecran de asteptare la fiecare intrerupere de retea e mai
// rau decat cateva randuri in jurnal. De aceea plafonul e mic si montarea e
// neconditionata dupa epuizarea lui.
const RETRY_DELAYS_MS = [1000, 2000] as const;

// Doar esecurile tranzitorii se reincearca. `not_provisioned` (cont inexistent
// sau inactiv) si `unavailable` (configurare de server invalida) dau acelasi
// raspuns oricat s-ar reincerca, iar utilizatorul ar astepta degeaba inainte sa
// vada mesajul care ii explica situatia.
function isTransient(result: SyncSessionResult): boolean {
  return result === "error";
}

export function useSessionBootstrap(): SessionBootstrap {
  // Desktop-ness is a mount-time invariant (the Electron preload injects
  // window.desktopApi before the bundle runs); capture it once so a late
  // mutation can't re-run the effect and desync `ready`.
  const [desktop] = useState(isDesktopRuntime);
  const [ready, setReady] = useState(desktop);
  const [status, setStatus] = useState<SyncSessionResult>("ok");
  const started = useRef(false);

  // `cancelled` traieste intr-un ref, nu intr-o variabila locala de efect, si se
  // RE-ARMEAZA la fiecare montare. Sub StrictMode, React invoca efectul de doua
  // ori: prima rulare porneste handshake-ul, cleanup-ul ei l-ar anula, iar a doua
  // nu il reporneste (gardul `started`) — cu o variabila locala, promisiunea in
  // zbor ar ateriza "anulata" si aplicatia nu ar porni NICIODATA in dev. Prins de
  // testul de StrictMode existent.
  const cancelled = useRef(false);
  const retryTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (desktop) return;
    cancelled.current = false;

    const attempt = (index: number): void => {
      void syncWebSession().then((result) => {
        if (cancelled.current) return;
        setStatus(result);
        if (isTransient(result) && index < RETRY_DELAYS_MS.length) {
          retryTimer.current = window.setTimeout(() => attempt(index + 1), RETRY_DELAYS_MS[index]);
          return;
        }
        // Neconditionat: succes, esec definitiv sau plafon atins — aplicatia
        // porneste. Vezi decizia userului de mai sus.
        setReady(true);
      });
    };

    if (!started.current) {
      started.current = true;
      attempt(0);
    }

    return () => {
      cancelled.current = true;
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
    };
  }, [desktop]);

  return { ready, status };
}
