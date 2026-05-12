// PR-C v2.9.0 — modal pentru "Export raport" din Quick Actions.
//
// Selectie interval (7d/30d) + format (XLSX/PDF). La generare:
//   1. cere snapshot-ul atomic /api/v1/dashboard/report (un singur round-trip
//      sub withMaintenanceRead — summary + charts + timeline consistente).
//   2. delega builder-ul reportXlsx / reportPdf in worker (export.worker.ts).
//   3. triggerDownload pe main thread.
//
// Modalul este controlat de parent (open/onClose) ca QuickActions sa poata
// inchide modalul la sfarsit fara state global.

import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, FileText, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { dashboardApi, type ChartsRange, MonitoringApiError } from "@/lib/api";
import { exportReportPdf, exportReportXlsx } from "@/lib/export";
import { cn } from "@/lib/utils";

interface ReportExportModalProps {
  open: boolean;
  onClose: () => void;
}

type ReportFormat = "xlsx" | "pdf";

export function ReportExportModal({ open, onClose }: ReportExportModalProps) {
  const [range, setRange] = useState<ChartsRange>("7d");
  const [format, setFormat] = useState<ReportFormat>("xlsx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset transient state cand modalul redeschide.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    setRange("7d");
    setFormat("xlsx");
  }, [open]);

  // Escape inchide modalul cand nu e in lucru.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  // Anuleaza request-ul in curs cand modalul se inchide forced (unmount).
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

  async function handleGenerate() {
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const payload = await dashboardApi.report({ range, signal: controller.signal });
      if (format === "xlsx") {
        await exportReportXlsx(payload);
      } else {
        await exportReportPdf(payload);
      }
      // Inchide modalul dupa download.
      onClose();
    } catch (err) {
      // Aborted = utilizatorul a inchis dialog-ul; nu il chinuim cu mesaje.
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof MonitoringApiError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg || "Eroare la generarea raportului.");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-export-title"
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h3 id="report-export-title" className="text-base font-semibold text-foreground">
              Export raport dashboard
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Snapshot consistent (KPI 24h + activitate zilnica + cronologie) intr-un singur fisier.
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
              Interval
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(["7d", "30d"] as ChartsRange[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  disabled={busy}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    range === r
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  {r === "7d" ? "Ultimele 7 zile" : "Ultimele 30 zile"}
                </button>
              ))}
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
                Generare...
              </>
            ) : (
              "Genereaza raport"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
