// Mirror al backend/src/util/textNormalize.ts::tokenizeFilterQuery.
// UI-ul are nevoie de tokens pentru highlight si badge "match in detalii".
// Daca regulile se schimba aici, actualizeaza si backend-ul.
export const FILTER_TOKEN_MAX_COUNT = 8;

const COMBINING_MARKS_RE = /\p{M}/gu;

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(COMBINING_MARKS_RE, "");
}

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
