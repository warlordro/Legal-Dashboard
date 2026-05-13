// Helpers TZ-safe pentru formatare data/ora in export-urile RNPM, PortalJust si
// Alerte. Evitam `new Date(yyyy-mm-dd).toLocaleDateString()` pentru ca date-only
// strings sunt parsate ca UTC midnight si shift-uite la TZ-ul masinii — pe un
// laptop in `Pacific/Honolulu` (UTC-10) data 2026-05-13 ar deveni 2026-05-12.
//
// SOAP PortalJust livreaza date-only ("YYYY-MM-DD"); SQLite stocheaza timestamps
// ISO 8601 cu TZ. Pentru date-only extragem direct campurile din string fara
// Date object. Pentru timestamps cu TZ folosim Intl cu `Europe/Bucharest` ca
// referinta legala (toata aplicatia e ro-only).

const RO_TZ = "Europe/Bucharest";
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatRoDate(input: string | null | undefined): string {
  if (!input) return "-";
  const match = DATE_ONLY_RE.exec(input);
  if (!match) return input;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("ro-RO", {
  timeZone: RO_TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatRoDateTime(input: string | null | undefined): string {
  if (!input) return "-";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return dateTimeFormatter.format(d);
}
