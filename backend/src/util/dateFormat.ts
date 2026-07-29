// Helpers TZ-safe pentru formatare data/ora in export-urile RNPM, PortalJust si
// Alerte. Evitam `new Date(yyyy-mm-dd).toLocaleDateString()` pentru ca date-only
// strings sunt parsate ca UTC midnight si shift-uite la TZ-ul masinii — pe un
// laptop in `Pacific/Honolulu` (UTC-10) data 2026-05-13 ar deveni 2026-05-12.
//
// SOAP PortalJust livreaza date-only ("YYYY-MM-DD"). Pentru ele extragem direct
// campurile din string, fara Date object. Timestampurile din SQLite sunt scrise
// de `datetime('now')`, deci UTC in formatul "YYYY-MM-DD HH:MM:SS" — FARA marcaj
// de zona (corectie 2026-07-30: comentariul de aici spunea "ISO 8601 cu TZ", ce
// nu e adevarat). `new Date(...)` pe un asemenea sir il interpreteaza ca ora
// LOCALA A PROCESULUI: pe containerul de productie, care ruleaza in UTC, iesea
// corect din intamplare, dar un `TZ=Europe/Bucharest` in compose ar fi deplasat
// toate exporturile cu 3 ore. Marcam zona explicit inainte de parsare.
// Formatarea foloseste Intl cu `Europe/Bucharest` ca referinta legala (aplicatia
// e ro-only), independent de TZ-ul masinii.

import { parseDbTimestamp } from "./dbTimestamp.ts";

const RO_TZ = "Europe/Bucharest";
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatRoDate(input: string | null | undefined): string {
  if (!input) return "-";
  const match = DATE_ONLY_RE.exec(input);
  if (!match) return input;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

const DATE_TIME_PARTS = {
  timeZone: RO_TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} as const;

const dateTimeFormatter = new Intl.DateTimeFormat("ro-RO", DATE_TIME_PARTS);
// Auditul are nevoie de secunde: doua evenimente din aceeasi rafala (401 + sync)
// se distingeau doar prin secunda, iar precizia la minut le-ar face identice.
const dateTimeSecondsFormatter = new Intl.DateTimeFormat("ro-RO", { ...DATE_TIME_PARTS, second: "2-digit" });

export function formatRoDateTime(input: string | null | undefined, opts?: { seconds?: boolean }): string {
  if (!input) return "-";
  const d = parseDbTimestamp(input);
  if (Number.isNaN(d.getTime())) return input;
  return (opts?.seconds ? dateTimeSecondsFormatter : dateTimeFormatter).format(d);
}
