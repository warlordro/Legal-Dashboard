// v2.13.0 — modal pentru "Export alerte" din pagina /alerts.
//
// Trei moduri de export:
//   - "ids":    folosesti checkbox-urile din lista (max 10k randuri).
//   - "filters":exact filtrele din toolbar (jobKind, q, severity, kind,
//               onlyUnread, includeDismissed, from, to). 413 daca total > 10k.
//   - "range":  doar interval custom (subset al "filters" cu includeDismissed
//               implicit pentru ca user-ul cere explicit "totul din interval").
//
// Backend-ul construieste direct XLSX/PDF si intoarce blob cu hyperlink-uri
// catre portal.just.ro pe coloana Dosar.

import { useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, FileText, Loader2, X } from "lucide-react";
import { useDialog } from "@/hooks/useDialog";

import { Button } from "@/components/ui/button";
import { MonitoringApiError } from "@/lib/api";
import {
  alertsApi,
  type AlertExportRequest,
  type AlertJobKind,
  type AlertKind,
  type AlertSeverity,
} from "@/lib/alertsApi";
import { cn } from "@/lib/utils";

type AlertExportFormat = "xlsx" | "pdf";

type ExportMode = "ids" | "filters" | "range";

export interface AlertsExportModalProps {
  open: boolean;
  onClose: () => void;
  // Selectia curenta din lista (max 10k id-uri).
  selectedIds: number[];
  // Snapshot al filtrelor din toolbar — folosit pentru mode="filters".
  currentFilters: {
    jobKind?: AlertJobKind;
    q?: string;
    kind?: AlertKind;
    severity?: AlertSeverity;
    onlyUnread?: boolean;
    includeDismissed?: boolean;
    from?: string;
    to?: string;
  };
  // Total randuri returnate de listAlerts cu filtrele curente — folosit pentru
  // hint UI "Toate cele filtrate (X total)".
  filteredTotal: number;
}

function localDateInputToIso(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return undefined;
  }
  const d = endOfDay ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function AlertsExportModal({
  open,
  onClose,
  selectedIds,
  currentFilters,
  filteredTotal,
}: AlertsExportModalProps) {
  const [mode, setMode] = useState<ExportMode>("filters");
  const [format, setFormat] = useState<AlertExportFormat>("pdf");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    setFormat("pdf");
    // Default mode: daca user-ul are selectie, asuma ca exportul e pentru
    // selectia (cazul cel mai des intalnit dupa multi-select). Altfel,
    // "filtre active" (uzual: vrea sa exporte rezultatul curent al pagininii).
    setMode(selectedIds.length > 0 ? "ids" : "filters");
    setRangeFrom("");
    setRangeTo("");
  }, [open, selectedIds.length]);

  // v2.42.0 (6.4): comportamentul de accesibilitate vine din useDialog
  // (inlocuieste handler-ul ad-hoc); handleClose pastreaza guard-ul pe busy —
  // inchiderea in timpul exportului ramane blocata.
  const dialogRef = useDialog<HTMLDivElement>(open, handleClose);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function handleClose() {
    if (busy) return;
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  }

  const contextLabel = useMemo(() => {
    if (mode === "ids") return `Selectie (${selectedIds.length})`;
    if (mode === "range") {
      if (!rangeFrom && !rangeTo) return "Interval custom";
      return `Interval ${rangeFrom || "..."} → ${rangeTo || "..."}`;
    }
    return "Filtre active";
  }, [mode, rangeFrom, rangeTo, selectedIds.length]);

  async function handleGenerate() {
    setError(null);

    let payload: AlertExportRequest;
    if (mode === "ids") {
      if (selectedIds.length === 0) {
        setError("Nu ai nicio alerta selectata.");
        return;
      }
      payload = { mode: "ids", ids: selectedIds };
    } else if (mode === "range") {
      const fromIso = localDateInputToIso(rangeFrom, false);
      const toIso = localDateInputToIso(rangeTo, true);
      if (!fromIso || !toIso) {
        setError("Selecteaza ambele date pentru intervalul custom.");
        return;
      }
      if (new Date(fromIso).getTime() > new Date(toIso).getTime()) {
        setError("Data de inceput trebuie sa fie inainte de data de sfarsit.");
        return;
      }
      payload = { mode: "range", from: fromIso, to: toIso };
    } else {
      payload = { mode: "filters", filters: currentFilters };
    }

    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result =
        format === "xlsx"
          ? await alertsApi.alertsExportXlsxBlob(payload, controller.signal, contextLabel)
          : await alertsApi.alertsExportPdfBlob(payload, controller.signal, contextLabel);
      if (controller.signal.aborted) return;
      triggerBlobDownload(result.blob, result.filename);
      onClose();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof MonitoringApiError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg || "Eroare la export.");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdropul se inchide via Escape printr-un document-level handler.
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation pe div previne click-through pe backdrop; tastatura via focus trap intern. */}
      <div
        ref={dialogRef}
        // tabIndex -1: fallback de focus cand toate controalele sunt disabled (6.4).
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        // biome-ignore lint/a11y/useSemanticElements: <dialog> nativ ar necesita showModal + focus trap nativ, pattern portal cu role="dialog"+aria-modal e standard React.
        role="dialog"
        aria-modal="true"
        aria-labelledby="alerts-export-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h3 id="alerts-export-title" className="text-base font-semibold text-foreground">
              Export alerte
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Fisierul exportat contine link-uri catre dosare pe portal.just.ro.
            </p>
          </div>
          <button
            type="button"
            aria-label="Inchide"
            onClick={handleClose}
            disabled={busy}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sursa randuri
            </legend>
            <div className="space-y-1.5">
              <label
                className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer",
                  mode === "ids" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40",
                  selectedIds.length === 0 && "opacity-50 cursor-not-allowed"
                )}
              >
                <input
                  type="radio"
                  name="alerts-export-mode"
                  className="mt-0.5"
                  checked={mode === "ids"}
                  disabled={selectedIds.length === 0 || busy}
                  onChange={() => setMode("ids")}
                />
                <span>
                  <span className="font-medium text-foreground">Doar selectia</span>
                  <span className="ml-2 text-muted-foreground">({selectedIds.length})</span>
                </span>
              </label>
              <label
                className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer",
                  mode === "filters" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"
                )}
              >
                <input
                  type="radio"
                  name="alerts-export-mode"
                  className="mt-0.5"
                  checked={mode === "filters"}
                  disabled={busy}
                  onChange={() => setMode("filters")}
                />
                <span>
                  <span className="font-medium text-foreground">Toate cele filtrate</span>
                  <span className="ml-2 text-muted-foreground">
                    ({filteredTotal} {filteredTotal === 1 ? "alerta" : "alerte"})
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Foloseste filtrele din toolbar (chiar daca-s pe alte pagini).
                  </span>
                </span>
              </label>
              <label
                className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer",
                  mode === "range" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"
                )}
              >
                <input
                  type="radio"
                  name="alerts-export-mode"
                  className="mt-0.5"
                  checked={mode === "range"}
                  disabled={busy}
                  onChange={() => setMode("range")}
                />
                <span className="flex-1">
                  <span className="font-medium text-foreground">Interval custom</span>
                  <span className="block text-xs text-muted-foreground">
                    Toate alertele (inclusiv inchise) intr-un interval explicit.
                  </span>
                  {mode === "range" && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={rangeFrom}
                        onChange={(e) => setRangeFrom(e.target.value)}
                        disabled={busy}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        aria-label="De la"
                      />
                      <input
                        type="date"
                        value={rangeTo}
                        onChange={(e) => setRangeTo(e.target.value)}
                        disabled={busy}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        aria-label="Pana la"
                      />
                    </div>
                  )}
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Format
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormat("xlsx")}
                disabled={busy}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  format === "xlsx"
                    ? "border-emerald-500 bg-emerald-500/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/40"
                )}
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                Excel
              </button>
              <button
                type="button"
                onClick={() => setFormat("pdf")}
                disabled={busy}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  format === "pdf"
                    ? "border-red-500 bg-red-500/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/40"
                )}
              >
                <FileText className="h-4 w-4 text-red-600" />
                PDF
              </button>
            </div>
          </fieldset>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <Button variant="outline" size="sm" onClick={handleClose} disabled={busy}>
            Anuleaza
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Export...
              </>
            ) : (
              "Exporta"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
