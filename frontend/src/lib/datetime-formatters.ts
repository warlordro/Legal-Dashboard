// Stage 5 dedupe — pana acum 5 pagini definea localul lor formatDateTime
// (Alerts, Audit, Quota, Users, Monitorizare) cu micro-diferente: nullable input,
// fallback "-" pentru null, seconds vs minute resolution. Consolidat aici intr-un
// singur helper cu un opt-in `seconds` (audit page singura care vrea precizie de
// secunda). lib/utils.ts are deja un `formatDateTime(dateStr, timeStr?)` unused
// dar cu signatura diferita (combina date+time fragments) — nu-l atingem aici
// ca sa nu introducem noise non-task in stage; cleanup-ul lui e separat.

export function formatIsoDateTime(iso: string | null | undefined, opts?: { seconds?: boolean }): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(opts?.seconds ? { second: "2-digit" as const } : {}),
  });
}

// Cadenta in secunde -> string scurt: "30min", "12h", "2z". Folosita doar in
// Monitorizare (jobs table + custom-cadence option label) dar locuieste tot in
// datetime-formatters ca sa avem un singur fisier de helperi temporali.
export function formatCadence(sec: number): string {
  if (sec >= 86400) return `${Math.round(sec / 86400)}z`;
  if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 60)}min`;
}
