import { useCallback, useMemo, useRef, useState } from "react";

// v2.42.0 (6.8): sortare client-side pe coloane. Ciclu: neactiv -> asc ->
// desc -> neactiv (revine la ordinea serverului). null/undefined/"" MEREU la
// coada, indiferent de directie. Sort stabil prin index.
//
// Capcane inchise din review:
//   - accessors se tin intr-un REF actualizat la fiecare render — memo-ul
//     ramane pe [rows, sort] fara biome-ignore fragil, iar closure-ul folosit
//     la sortare e mereu cel proaspat;
//   - valoarea se extrage O DATA per rand (pre-map [valoare, rand, index]),
//     nu de ~8x per comparatie.

export type SortDir = "asc" | "desc";

export interface UseClientSortResult<T> {
  sorted: T[];
  sortKey: string | null;
  sortDir: SortDir | null;
  toggle: (key: string) => void;
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

export function useClientSort<T>(
  rows: readonly T[],
  accessors: Record<string, (row: T) => unknown>
): UseClientSortResult<T> {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);

  const accessorsRef = useRef(accessors);
  accessorsRef.current = accessors;

  const toggle = useCallback((key: string) => {
    setSort((prev) => {
      if (prev === null || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }, []);

  const sorted = useMemo(() => {
    if (sort === null) return [...rows];
    const accessor = accessorsRef.current[sort.key];
    if (!accessor) return [...rows];

    const collator = new Intl.Collator("ro", { numeric: true, sensitivity: "base" });
    const decorated = rows.map((row, index) => [accessor(row), row, index] as const);
    decorated.sort((a, b) => {
      const aEmpty = isEmptyValue(a[0]);
      const bEmpty = isEmptyValue(b[0]);
      if (aEmpty && bEmpty) return a[2] - b[2];
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      let cmp: number;
      if (typeof a[0] === "number" && typeof b[0] === "number") {
        cmp = a[0] - b[0];
      } else {
        cmp = collator.compare(String(a[0]), String(b[0]));
      }
      const oriented = sort.dir === "asc" ? cmp : -cmp;
      return oriented !== 0 ? oriented : a[2] - b[2];
    });
    return decorated.map((d) => d[1]);
  }, [rows, sort]);

  return {
    sorted,
    sortKey: sort?.key ?? null,
    sortDir: sort?.dir ?? null,
    toggle,
  };
}
