import { useState, useCallback, useEffect } from "react";
import type { RnpmSearchHistoryEntry, RnpmSearchParams, RnpmSearchType } from "@/types/rnpm";
import { useCurrentUser } from "./useCurrentUser";
import { clearList, readList, scopedKey, writeList } from "./_localStorageList";

export const RNPM_HISTORY_KEY = "legal-dashboard-rnpm-history";
const MAX_ENTRIES = 15;

function buildLabel(type: RnpmSearchType, params: RnpmSearchParams): string {
  const parts: string[] = [];
  if (params.identificatorInscriere) parts.push(params.identificatorInscriere);
  if (params.debitorPJ?.denumire) parts.push(params.debitorPJ.denumire);
  if (params.debitorPJ?.CUI?.value) parts.push(`CUI ${params.debitorPJ.CUI.value}`);
  if (params.debitorPF?.nume) parts.push(params.debitorPF.nume);
  if (params.debitorPF?.CNP?.value) parts.push(`CNP ${params.debitorPF.CNP.value}`);
  if (params.creditorPJ?.denumire) parts.push(params.creditorPJ.denumire);
  if (params.creditorPJ?.CUI?.value) parts.push(`Cr. CUI ${params.creditorPJ.CUI.value}`);
  return parts.length ? `${type} · ${parts.join(" · ")}` : `${type}`;
}

export function useRnpmHistory() {
  const { user } = useCurrentUser();
  const ownerId = user?.id ?? null;
  const [history, setHistory] = useState<RnpmSearchHistoryEntry[]>([]);

  // Vezi useSearchHistory: istoricul e partitionat pe utilizator, iar cheia veche
  // (nescopata) se sterge la prima incarcare, ca sa nu ajunga la alt cont.
  useEffect(() => {
    if (ownerId === null) {
      setHistory([]);
      return;
    }
    clearList(RNPM_HISTORY_KEY);
    setHistory(readList<RnpmSearchHistoryEntry>(scopedKey(RNPM_HISTORY_KEY, ownerId)));
  }, [ownerId]);

  const saveHistory = useCallback(
    (entries: RnpmSearchHistoryEntry[]) => {
      if (ownerId === null) return;
      writeList(scopedKey(RNPM_HISTORY_KEY, ownerId), entries);
    },
    [ownerId]
  );

  const addEntry = useCallback(
    (type: RnpmSearchType, params: RnpmSearchParams, resultCount: number) => {
      const entry: RnpmSearchHistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        params,
        label: buildLabel(type, params),
        resultCount,
        timestamp: Date.now(),
      };

      setHistory((prev) => {
        const filtered = prev.filter((e) => !(e.label === entry.label && e.type === entry.type));
        const next = [entry, ...filtered].slice(0, MAX_ENTRIES);
        saveHistory(next);
        return next;
      });
    },
    [saveHistory]
  );

  const removeEntry = useCallback(
    (id: string) => {
      setHistory((prev) => {
        const next = prev.filter((e) => e.id !== id);
        saveHistory(next);
        return next;
      });
    },
    [saveHistory]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    if (ownerId !== null) clearList(scopedKey(RNPM_HISTORY_KEY, ownerId));
  }, [ownerId]);

  return { history, addEntry, removeEntry, clearHistory };
}
