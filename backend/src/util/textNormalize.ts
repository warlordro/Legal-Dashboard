// Romanian text normalization — RNPM use only.
// RNPM's backend doesn't match diacritics (ex: "Stefan" vs "Ștefan"), so we
// strip them before sending search params. Also used for the local "Baza locala"
// filter so a user can find "Ștefan" by typing "stefan".
//
// Pattern: Unicode NFD decomposes letter+diacritic into base + combining marks,
// then we drop combining marks with Unicode property matching.
const COMBINING_MARKS_RE = /\p{M}/gu;

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(COMBINING_MARKS_RE, "");
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

// Tokenizeaza query-ul de filtru in lista de tokens distincte.
// Reguli:
//   - split pe whitespace (orice rulada de \s)
//   - trim per token
//   - drop empty
//   - dedup case-insensitive si diacritice-insensitive
//   - max 8 tokens (anti-DoS; fiecare token adauga 24 LIKE-uri in SQL)
//
// Returneaza tokens originale, cu diacritice si majuscule pastrate, in ordinea
// primei aparitii. Normalizarea este aplicata la consum prin buildRnpmLikePattern
// si functia SQL rnpm_norm.
export const FILTER_TOKEN_MAX_COUNT = 8;

export function tokenizeFilterQuery(q: string): string[] {
  if (typeof q !== "string") return [];
  const raw = q.split(/\s+/);
  const seenKeys = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const trimmed = t.trim();
    if (trimmed.length === 0) continue;
    const key = stripDiacritics(trimmed).toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push(trimmed);
    if (out.length >= FILTER_TOKEN_MAX_COUNT) break;
  }
  return out;
}
