// v2.42.0 (6.5): eticheta umana pentru statusul rularilor de monitoring.
// Conventia cross-stack: enum-urile backend nu se afiseaza raw in DOM.

const LABELS: Record<string, string> = {
  ok: "OK",
  partial: "Partial",
  error: "Eroare",
  skipped: "Omis",
};

export function monitoringRunStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return LABELS[status] ?? `Necunoscut (${status})`;
}
