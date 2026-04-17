// Romanian text normalization — RNPM use only.
// RNPM's backend doesn't match diacritics (ex: "Stefan" vs "Ștefan"), so we
// strip them before sending search params. Also used for the local "Baza locala"
// filter so a user can find "Ștefan" by typing "stefan".
//
// Pattern: Unicode NFD decomposes letter+diacritic into base + combining marks,
// then we drop the combining range (U+0300..U+036F).

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Walk a params-shaped object and strip diacritics from every string leaf.
// Used on RNPM /search + /bulk bodies: guarantees any backend path (bulk, future
// obligatiuni, etc.) benefits without needing frontend changes.
export function stripDiacriticsDeep<T>(value: T): T {
  if (typeof value === "string") return stripDiacritics(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => stripDiacriticsDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripDiacriticsDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
