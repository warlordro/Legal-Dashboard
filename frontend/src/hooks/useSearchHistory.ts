import { useState, useCallback } from "react";
import type { SearchHistoryEntry, SearchParams } from "@/types";
import { clearList, readList, writeList } from "./_localStorageList";

const STORAGE_KEY = "portaljust-search-history";
const MAX_ENTRIES = 15;

const loadHistory = (): SearchHistoryEntry[] => readList<SearchHistoryEntry>(STORAGE_KEY);
const saveHistory = (entries: SearchHistoryEntry[]) => writeList(STORAGE_KEY, entries);

function buildLabel(params: SearchParams): string {
  const parts: string[] = [];
  if (params.numeParte) parts.push(params.numeParte);
  if (params.numarDosar) parts.push(params.numarDosar);
  if (params.obiectDosar) parts.push(params.obiectDosar);
  return parts.join(" · ") || "Cautare";
}

export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryEntry[]>(loadHistory);

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
        // Remove duplicates with same label+type
        const filtered = prev.filter((e) => !(e.label === entry.label && e.type === entry.type));
        const next = [entry, ...filtered].slice(0, MAX_ENTRIES);
        saveHistory(next);
        return next;
      });
    },
    []
  );

  const removeEntry = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    clearList(STORAGE_KEY);
  }, []);

  return { history, addEntry, removeEntry, clearHistory };
}
