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

// Escape user-supplied SQL LIKE meta characters (%, _, \) so the bound value
// matches as a literal. Pair every consumer with `ESCAPE '\\'` in SQL.
//
// CONTRACT: omitting `ESCAPE '\\'` makes SQLite treat the literal backslash
// as a normal character, which leaves `%` and `_` active as wildcards.
//
// @example
//   const where = "email LIKE ? ESCAPE '\\\\'";
//   stmt.all(`%${escapeLikeMeta(userInput)}%`);
export function escapeLikeMeta(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

// Build a contains-match pattern for SQLite `... LIKE ? ESCAPE '\\'` clauses
// that use `rnpm_norm(col)` on the column side. Mirrors that normalization on
// the RHS (NFD strip + lowercase) and escapes user-supplied LIKE meta (% _ \)
// so e.g. "50%" matches the literal string instead of a wildcard.
//
// CONTRACT: every call site MUST pair the bound parameter with `ESCAPE '\\'`,
// otherwise the leading `\` in escaped meta becomes a literal match and SQLite
// treats `%`/`_` as wildcards again.
//
// @example
//   const where = "rnpm_norm(name) LIKE ? ESCAPE '\\\\'";
//   stmt.all(buildRnpmLikePattern(userInput));  // safe vs wildcard injection
export function buildRnpmLikePattern(q: string): string {
  return `%${escapeLikeMeta(stripDiacritics(q).toLowerCase())}%`;
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
