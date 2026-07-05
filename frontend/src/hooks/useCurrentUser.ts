import { useEffect, useSyncExternalStore } from "react";
import { me, type MeProfile } from "@/lib/api";

export interface UseCurrentUserResult {
  user: MeProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// PR-8 hook, refacut in v2.42.0 ca STORE PARTAJAT la nivel de modul: hook-ul e
// consumat din multe locuri (Sidebar, AdminGate per tab/pagina, Setari, dialog),
// iar varianta veche facea cate un fetch /me la FIECARE montare — cu tab-urile
// mount-on-demand din /setari, cateva click-uri loveau rate limiter-ul si un
// 429 se afisa ca "403 Acces interzis" pentru un admin real (incident testare
// 2026-07-04; problema era notata in SESSION-HANDOFF ca risc cunoscut).
// Acum: UN fetch la primul consumator, toate instantele impart snapshotul;
// refresh() forteaza refetch si actualizeaza toti abonatii (ex. schimbarea
// propriului rol updateaza si Sidebar-ul, nu doar pagina curenta).

interface Snapshot {
  user: MeProfile | null;
  loading: boolean;
  error: string | null;
}

let snapshot: Snapshot = { user: null, loading: true, error: null };
const listeners = new Set<() => void>();
let started = false;
let inflight: Promise<void> | null = null;

function emit(next: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Snapshot {
  return snapshot;
}

function doFetch(): Promise<void> {
  return me
    .get()
    .then((u) => {
      emit({ user: u, error: null, loading: false });
    })
    .catch((e: unknown) => {
      // 401 / network / etc — surface message but don't throw. Consumatorii
      // trateaza user === null gratios (Sidebar ascunde, AdminGate afiseaza 403).
      emit({ user: null, error: e instanceof Error ? e.message : "Eroare la /me", loading: false });
    });
}

// Dedup pentru rafalele de mount: toate instantele asteapta ACELASI fetch.
function fetchMe(): Promise<void> {
  inflight ??= doFetch().finally(() => {
    inflight = null;
  });
  return inflight;
}

// Refresh = date PROASPETE garantat (CodeRabbit: reutilizarea fetch-ului
// in-flight putea servi raspunsul de dinaintea mutatiei, ex. schimbarea
// propriului rol). Daca exista un fetch in curs, il asteptam si pornim unul
// nou dupa; noul promise devine inflight ca mount-urile ulterioare sa se
// agate de cel proaspat.
// Returneaza promise-ul (review-panel): caller-ii care fac o mutatie pot
// astepta refetch-ul inainte sa navigheze/afiseze confirmarea.
function refresh(): Promise<void> {
  emit({ loading: true });
  const guarded: Promise<void> = (inflight ?? Promise.resolve())
    .then(() => doFetch())
    .finally(() => {
      // Curata doar daca intre timp nu a pornit alt refresh (care a
      // suprascris inflight cu propriul promise).
      if (inflight === guarded) inflight = null;
    });
  inflight = guarded;
  return guarded;
}

// Doar pentru teste: reseteaza store-ul intre cazuri (module state persista).
export function __resetCurrentUserStoreForTests(): void {
  snapshot = { user: null, loading: true, error: null };
  started = false;
  inflight = null;
  listeners.clear(); // altfel callback-uri din testele precedente raman abonate
}

export function useCurrentUser(): UseCurrentUserResult {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    // Retry la montare daca fetch-ul initial a ESUAT (review-panel: `started`
    // ramanea true si eroarea devenea permanenta pana la un refresh manual).
    if (!started || (snapshot.error !== null && inflight === null)) {
      started = true;
      void fetchMe();
    }
  }, []);

  return {
    user: snap.user,
    loading: snap.loading,
    error: snap.error,
    refresh,
  };
}
