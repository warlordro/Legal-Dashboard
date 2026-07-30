// Normalizarea timestampurilor citite din / comparate cu SQLite.
//
// In DB coexista DOUA formate de timp, ambele in UTC:
//   - "YYYY-MM-DD HH:MM:SS" (naiv, fara marcaj de zona) — coloanele cu DEFAULT
//     `datetime('now')`: `audit_log.ts` si celelalte coloane din migrations vechi;
//   - "YYYY-MM-DDTHH:MM:SS.sssZ" (ISO cu Z) — coloanele cu DEFAULT
//     `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, introduse din migration 0003
//     (`monitoring_alerts`, `monitoring_runs`, `ai_usage`, ...).
//
// SQLite compara TEXT lexicografic, iar ' ' (0x20) < 'T' (0x54). Deci un filtru
// exprimat in ISO ("2026-07-29T21:00:00.000Z") pus pe o coloana naiva taie
// fereastra in alt loc decat cere apelantul: TOATE randurile naive din ziua
// limitei se sorteaza inaintea sirului ISO. Simetric, un cursor naiv pus pe o
// coloana ISO pare mai nou decat este. Bugurile sunt silentioase — nu arunca,
// doar returneaza alt set de randuri.
//
// Regula: fiecare query normalizeaza limita la formatul COLOANEI pe care o
// interogheaza. Valorile deja in formatul tinta trec neatinse, ca sa nu depindem
// de TZ-ul procesului pentru un sir care nu are nevoie de parsare.

const NAIVE_UTC = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const COLUMN_NAIVE_UTC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Parseaza un timestamp din DB. Sirurile naive sunt marcate explicit ca UTC
 * (altfel V8 le interpreteaza ca ora locala a procesului); cele cu Z sau offset
 * trec direct. Input invalid -> Date invalid, apelantul verifica isNaN.
 */
export function parseDbTimestamp(value: string): Date {
  return new Date(NAIVE_UTC.test(value) ? `${value.replace(" ", "T")}Z` : value);
}

/** Formatul coloanelor scrise cu `datetime('now')`: "YYYY-MM-DD HH:MM:SS" UTC. */
export function toNaiveUtcTimestamp(value: string): string {
  if (COLUMN_NAIVE_UTC.test(value)) return value;
  const parsed = parseDbTimestamp(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

/** Formatul coloanelor scrise cu `strftime(...Z)`: ISO-8601 cu milisecunde si Z. */
export function toIsoUtcTimestamp(value: string): string {
  const parsed = parseDbTimestamp(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}
