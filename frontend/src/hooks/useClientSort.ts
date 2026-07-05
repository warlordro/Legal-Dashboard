import { useMemo, useRef, useState } from "react";

// v2.42.0 (Nivel 2 UX): sortare client-side pe coloane pentru tabelele care nu
// au sortare server-side. Pe tabelele paginate pe server sorteaza PAGINA
// CURENTA (header-ul o spune in title); pe seturile incarcate complet
// (ex. Consum per utilizator) sorteaza tot setul.
//
// Accessors: per cheie de coloana, o functie care extrage valoarea comparabila
// (string | number | null). null/undefined se aseaza mereu la coada, indiferent
// de directie. Stringurile se compara cu localeCompare (ro diacritics-safe).

export type SortDir = "asc" | "desc";

export interface ClientSort<K extends string> {
  sortKey: K | null;
  sortDir: SortDir;
  toggle: (key: K) => void;
}

function compareValues(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const aMissing = a === null || a === undefined || a === "";
  const bMissing = b === null || b === undefined || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1; // lipsurile la coada
  if (bMissing) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "ro", { numeric: true, sensitivity: "base" });
}

export function useClientSort<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => string | number | null | undefined>
): { sorted: T[] } & ClientSort<K> {
  const [sortKey, setSortKey] = useState<K | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Review-panel: caller-ele paseaza obiecte inline (identitate noua la fiecare
  // render). Ref-ul tine mereu ultima versiune fara sa intre in deps — memo-ul
  // ramane pe [rows, sortKey, sortDir] si nu re-sorteaza degeaba, dar nici nu
  // poate folosi accessors "inghetati".
  const accessorsRef = useRef(accessors);
  accessorsRef.current = accessors;

  // Ciclu: neactiv -> asc -> desc -> neactiv (revine la ordinea serverului).
  const toggle = (key: K) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const accessor = accessorsRef.current[sortKey];
    if (!accessor) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    const isMissing = (v: string | number | null | undefined) => v === null || v === undefined || v === "";
    // Sort stabil: la egalitate pastreaza ordinea venita de la server.
    // Valoarea se extrage O SINGURA data per rand (review-panel: accessor-ul
    // era apelat de pana la 8 ori per comparatie).
    return rows
      .map((row, i) => [accessor(row), row, i] as const)
      .sort(([av, , ai], [bv, , bi]) => {
        const cmp = compareValues(av, bv);
        // Lipsurile raman la coada si pe desc: cmp-ul lor nu se inverseaza.
        if (isMissing(av) || isMissing(bv)) return cmp !== 0 ? cmp : ai - bi;
        return cmp !== 0 ? cmp * dir : ai - bi;
      })
      .map(([, row]) => row);
  }, [rows, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggle };
}
