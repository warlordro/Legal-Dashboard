import { useSyncExternalStore } from "react";
import { me, type MeProfile } from "@/lib/api";

export interface UseCurrentUserResult {
  user: MeProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// v2.42.0 (3.4): STORE PARTAJAT la nivel de modul. Hook-ul e consumat din multe
// locuri simultan (Sidebar + AdminGate per pagina + tab-urile /setari montate
// on-demand); cu fetch per instanta, mount-urile in rafala loveau rate-limiter-ul
// si 429-ul aparea in UI ca "403 Acces interzis". Un singur fetch /me e
// deduplicat pentru toate instantele prin `inflight`.

interface StoreState {
  user: MeProfile | null;
  loading: boolean;
  error: string | null;
}

let state: StoreState = { user: null, loading: true, error: null };
let fetchedOnce = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: Partial<StoreState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function fetchMe(): Promise<void> {
  const run = me
    .get()
    .then((u) => {
      emit({ user: u, loading: false, error: null });
    })
    .catch((e: unknown) => {
      // 401 / network / etc — mesajul e afisat, nu aruncat. Consumatorii
      // trateaza user === null gratios.
      emit({ user: null, loading: false, error: e instanceof Error ? e.message : "Eroare la /me" });
    })
    .finally(() => {
      // Cleanup GARDAT: un finally negardat ar sterge inflight-ul unui refresh
      // suprapus si ar sparge dedup-ul.
      if (inflight === run) inflight = null;
    });
  inflight = run;
  return run;
}

function ensureFetched(): void {
  if (inflight !== null) return;
  // Retry la mount daca starea anterioara e eroare — cu loading vizibil,
  // altfel UI-ul arata eroarea veche fara indiciu de reincarcare.
  if (fetchedOnce && state.error === null) return;
  if (fetchedOnce && state.error !== null) {
    emit({ loading: true, error: null });
  }
  fetchedOnce = true;
  void fetchMe();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureFetched();
  return () => listeners.delete(listener);
}

function getSnapshot(): StoreState {
  return state;
}

// refresh(): ASTEAPTA fetch-ul curent (poate fi de dinaintea mutatiei — nu-l
// reutilizam ca rezultat) si porneste unul proaspat.
async function refresh(): Promise<void> {
  if (inflight !== null) {
    await inflight.catch(() => {});
  }
  emit({ loading: true, error: null });
  await fetchMe();
}

// Reset pentru teste: stare initiala + listeners curatati (fara el, un test
// anterior lasa abonati morti care primesc emit-uri din testul curent).
export function __resetCurrentUserStoreForTests(): void {
  state = { user: null, loading: true, error: null };
  fetchedOnce = false;
  inflight = null;
  listeners.clear();
}

export function useCurrentUser(): UseCurrentUserResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  return {
    user: snapshot.user,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh,
  };
}
