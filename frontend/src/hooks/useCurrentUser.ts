import { useEffect, useSyncExternalStore } from "react";
import { me, type MeProfile } from "@/lib/api";

export interface UseCurrentUserResult {
  user: MeProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
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

function fetchMe(): Promise<void> {
  inflight ??= me
    .get()
    .then((u) => {
      emit({ user: u, error: null, loading: false });
    })
    .catch((e: unknown) => {
      // 401 / network / etc — surface message but don't throw. Consumatorii
      // trateaza user === null gratios (Sidebar ascunde, AdminGate afiseaza 403).
      emit({ user: null, error: e instanceof Error ? e.message : "Eroare la /me", loading: false });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function refresh(): void {
  emit({ loading: true });
  void fetchMe();
}

// Doar pentru teste: reseteaza store-ul intre cazuri (module state persista).
export function __resetCurrentUserStoreForTests(): void {
  snapshot = { user: null, loading: true, error: null };
  started = false;
  inflight = null;
}

export function useCurrentUser(): UseCurrentUserResult {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!started) {
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
