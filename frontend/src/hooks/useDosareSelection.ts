import { useCallback, useMemo, useState } from "react";
import type { Dosar } from "@/types";

export interface UseDosareSelectionResult {
  selected: Set<string>;
  toggleSelect: (numar: string) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;
  allPageSelected: boolean;
}

export function useDosareSelection(paged: Dosar[]): UseDosareSelectionResult {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((numar: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(numar)) next.delete(numar);
      else next.add(numar);
      return next;
    });
  }, []);

  const allPageSelected = useMemo(
    () => paged.length > 0 && paged.every((d) => selected.has(d.numar)),
    [paged, selected]
  );

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const d of paged) next.delete(d.numar);
      } else {
        for (const d of paged) next.add(d.numar);
      }
      return next;
    });
  }, [allPageSelected, paged]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  return { selected, toggleSelect, toggleSelectAll, clearSelection, allPageSelected };
}
