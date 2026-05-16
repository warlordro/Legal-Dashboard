import { useCallback, useState } from "react";

const STORAGE_KEY = "viewedDosare";

export interface UseViewedDosareSessionResult {
  viewedDosare: Set<string>;
  markAsViewed: (numar: string) => void;
}

export function useViewedDosareSession(): UseViewedDosareSessionResult {
  const [viewedDosare, setViewedDosare] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const markAsViewed = useCallback((numar: string) => {
    setViewedDosare((prev) => {
      if (prev.has(numar)) return prev;
      const next = new Set(prev);
      next.add(numar);
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* sessionStorage unavailable; visited-markers are best-effort */
      }
      return next;
    });
  }, []);

  return { viewedDosare, markAsViewed };
}
