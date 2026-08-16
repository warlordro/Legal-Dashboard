import { useEffect, useRef, useState } from "react";
import { syncWebSession, type SyncSessionResult } from "@/lib/api";

// Establishes the web session before the app makes authenticated calls.
//
// Desktop (Electron): `window.desktopApi` is present, auth is local ("local"
// owner), there is no cookie handshake — mark ready synchronously from the
// initial state so the desktop app renders with zero flash and zero fetch.
//
// Web (browser): mint the session cookie via syncWebSession(). The render gate in
// App keeps the authenticated shell (Sidebar /me, search, alerts SSE) from
// mounting until this settles, so the first request carries the cookie instead of
// racing it into a 401 "Token de autentificare necesar.". Handshake-ul porneste o
// singura data (ref guard, safe under React StrictMode's double-invoke), dar poate
// face pana la trei incercari — vezi reincercarile marginite de mai jos.
//
// INVARIANT de tinut minte: sync-urile de AICI cheama `syncWebSession` direct, deci
// NU sunt urmarite de `beginLogout` si nu vad `logoutInProgress` (acelea gardeaza
// `ensureWebSession`). E sigur doar cat timp ecranele dinainte de `ready` nu au
// nicio actiune de cont: pana atunci se randeaza doar ecranul de conectare, iar
// dupa `ready` bootstrap-ul e inert. Daca vreodata un ecran de boot primeste buton
// de delogare, un sync in zbor ar re-minti cookie-ul DUPA delogare — exact
// resurectia inchisa pe celelalte cai.
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

// Plafoane DETINUTE DE HOOK, nu mostenite de la bridge.
//
// Garantia "aplicatia porneste intotdeauna" nu are voie sa depinda de faptul ca
// `syncWebSession` isi pune singur un plafon intern: azi si-l pune, dar o editare
// viitoare care il scoate ar transforma tacut ecranul de asteptare in permanent,
// si suita ar ramane verde. Trecand un semnal la FIECARE incercare, terminarea e
// o proprietate a acestui hook.
//
// Prima incercare pastreaza 10s (cat plafonul implicit de pana acum); reincercarile
// primesc 3s — daca prima a expirat, upstream-ul atarna in loc sa refuze, si nu are
// rost sa mai astepte inca 10s de doua ori. Fara diferentiere, cazul "backend
// blocat" tinea utilizatorul pe ecran ~33s in loc de ~10s cat era inainte de acest
// pas: o degradare a unui caz-margine, adusa chiar de fixul care trebuia sa ajute.
const FIRST_ATTEMPT_TIMEOUT_MS = 10_000;
const RETRY_ATTEMPT_TIMEOUT_MS = 3000;

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
      const signal = AbortSignal.timeout(index === 0 ? FIRST_ATTEMPT_TIMEOUT_MS : RETRY_ATTEMPT_TIMEOUT_MS);
      void syncWebSession(signal)
        .then((result) => {
          if (cancelled.current) return;
          setStatus(result);
          if (isTransient(result) && index < RETRY_DELAYS_MS.length) {
            retryTimer.current = window.setTimeout(() => attempt(index + 1), RETRY_DELAYS_MS[index]);
            return;
          }
          // Neconditionat: succes, esec definitiv sau plafon atins — aplicatia
          // porneste. Vezi decizia userului de mai sus.
          setReady(true);
        })
        .catch(() => {
          // Aparare in adancime pentru garantia de montare. `syncWebSession` nu
          // arunca azi (toate caile intorc o valoare), dar garantia userului nu are
          // voie sa depinda de un contract pe care o editare viitoare il poate
          // incalca tacut: fara acest catch, o promisiune respinsa ar sari peste
          // `setReady` si ar lasa utilizatorul pe ecranul de asteptare la infinit —
          // exact ce pretinde ca apara testul "GARANTIE".
          if (cancelled.current) return;
          setStatus("error");
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
