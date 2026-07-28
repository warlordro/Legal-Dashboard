import { useState, useCallback, useEffect } from "react";
import type { SearchHistoryEntry, SearchParams } from "@/types";
import { useCurrentUser } from "./useCurrentUser";
import { clearList, readList, scopedKey, writeList } from "./_localStorageList";

export const PORTALJUST_HISTORY_KEY = "portaljust-search-history";
const MAX_ENTRIES = 15;

function buildLabel(params: SearchParams): string {
  const parts: string[] = [];
  if (params.numeParte) parts.push(params.numeParte);
  if (params.numarDosar) parts.push(params.numarDosar);
  if (params.obiectDosar) parts.push(params.obiectDosar);
  // Date-only ICCJ dosare search (no text fields) — label by date so multiple
  // day-searches stay distinct in the history.
  if (parts.length === 0 && params.dataStart) parts.push(`Sedinte ${params.dataStart}`);
  return parts.join(" · ") || "Cautare";
}

export function useSearchHistory() {
  const { user } = useCurrentUser();
  const ownerId = user?.id ?? null;
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);

  // Istoricul se incarca abia dupa ce stim cine e utilizatorul. Pana atunci
  // ramane in memorie si NU se scrie nimic: o scriere "orfana" ar ateriza in
  // partitia gresita la urmatorul login.
  useEffect(() => {
    if (ownerId === null) {
      setHistory([]);
      return;
    }
    // Cheia veche, nescopata, e stearsa la prima incarcare: continutul ei apartine
    // sesiunii dinaintea fixului si nu poate fi atribuit unui utilizator anume.
    clearList(PORTALJUST_HISTORY_KEY);
    setHistory(readList<SearchHistoryEntry>(scopedKey(PORTALJUST_HISTORY_KEY, ownerId)));
  }, [ownerId]);

  const saveHistory = useCallback(
    (entries: SearchHistoryEntry[]) => {
      if (ownerId === null) return;
      writeList(scopedKey(PORTALJUST_HISTORY_KEY, ownerId), entries);
    },
    [ownerId]
  );

  const addEntry = useCallback(
    (
      type: "dosare" | "termene",
      params: SearchParams,
      resultCount: number,
      meta?: { categoriesCount: number; institutiiCount: number }
    ) => {
      const entry: SearchHistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        params,
        label: buildLabel(params),
        resultCount,
        timestamp: Date.now(),
        ...(meta ? { meta } : {}),
      };

      setHistory((prev) => {
        // Remove duplicates with same label+type+source. Source is part of the
        // key so the same query on PortalJust and on ICCJ are kept as distinct
        // entries (clicking each must re-run against its own source).
        const srcOf = (e: SearchHistoryEntry) => e.params.source ?? "portaljust";
        const filtered = prev.filter(
          (e) => !(e.label === entry.label && e.type === entry.type && srcOf(e) === srcOf(entry))
        );
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
    if (ownerId !== null) clearList(scopedKey(PORTALJUST_HISTORY_KEY, ownerId));
  }, [ownerId]);

  return { history, addEntry, removeEntry, clearHistory };
}
