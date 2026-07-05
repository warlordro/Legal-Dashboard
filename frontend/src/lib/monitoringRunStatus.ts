// Traducerea enum-ului backend `monitoring_runs.status` (si `jobs.last_status`)
// in etichete pentru UI. Conventie cross-stack (CLAUDE.md): token-urile backend
// nu se afiseaza raw in DOM — pattern identic cu rnpmGapReason / rnpmProgressPhase.
const RUN_STATUS_LABELS: Record<string, string> = {
  ok: "OK",
  partial: "Partial",
  error: "Eroare",
  skipped: "Omis",
};

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status;
}
