// v2.42.0 (5.4/6.5): outcome-ul de audit (ok/denied/error) se afiseaza tradus
// in badge, sumar si filtrul din Audit.tsx. Pure helper — testat unit, fara
// dependinte UI. Pattern: rnpmGapReason.ts (mapa + fallback localizat
// "Necunoscut (token)" care pastreaza token-ul brut pentru diagnosticare).
export const OUTCOME_OPTIONS: ReadonlyArray<{ value: "all" | "ok" | "denied" | "error"; label: string }> = [
  { value: "all", label: "Toate rezultatele" },
  { value: "ok", label: "OK" },
  { value: "denied", label: "Refuzat" },
  { value: "error", label: "Eroare" },
];

export function outcomeLabel(outcome: "ok" | "denied" | "error"): string {
  return OUTCOME_OPTIONS.find((o) => o.value === outcome)?.label ?? `Necunoscut (${outcome})`;
}
