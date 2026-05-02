import { useRef, useState } from "react";
import {
  Upload,
  Download,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  monitoring,
  nameLists,
  type NameListPreviewResult,
  type NameListCommitResult,
  type NameListValidation,
  MonitoringApiError,
} from "@/lib/api";
import {
  downloadBulkTemplate,
  parseBulkFile,
  type BulkRowDosar,
} from "@/lib/monitoringBulkTemplate";

// Stage 4 extract din pages/Monitorizare.tsx — toata starea + handlerele +
// JSX pentru flow-ul "Adaugare bulk din fisier" traieste aici. Page-ul ramane
// orchestrator pentru lista de joburi; cardul comunica inapoi via onJobsCreated
// (refresh-ul listei dupa import). Tot ce e local pentru bulk import (preview,
// commit, dosar rows, csvCell helper) ramane incapsulat.

interface BulkDosarResult {
  added: number;
  exists: number;
  errors: number;
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function MonitoringBulkImportCard({
  onJobsCreated,
}: {
  onJobsCreated: () => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<NameListPreviewResult | null>(null);
  const [bulkTitle, setBulkTitle] = useState("");
  const [bulkFilter, setBulkFilter] = useState<NameListValidation | "all">("all");
  const [bulkCommit, setBulkCommit] = useState<NameListCommitResult | null>(null);
  const [bulkCommitProgress, setBulkCommitProgress] = useState({ created: 0, remaining: 0 });
  const [bulkDosarRows, setBulkDosarRows] = useState<BulkRowDosar[]>([]);
  const [bulkDosarResult, setBulkDosarResult] = useState<BulkDosarResult | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const handleBulkUpload = async (file: File) => {
    setBulkBusy(true);
    setBulkError(null);
    setBulkPreview(null);
    setBulkCommit(null);
    setBulkDosarRows([]);
    setBulkDosarResult(null);
    setBulkCommitProgress({ created: 0, remaining: 0 });
    try {
      const buffer = await file.arrayBuffer();
      const parsedBulk = parseBulkFile(buffer, file.name);
      const dosarRows = parsedBulk.valid.filter((row): row is BulkRowDosar => row.kind === "dosar");
      const nameRows = parsedBulk.valid.filter((row) => row.kind === "nume");
      setBulkDosarRows(dosarRows);

      if (parsedBulk.invalid.length > 0) {
        setBulkError(`${parsedBulk.invalid.length} randuri din XLSX au fost ignorate: ${parsedBulk.invalid[0]?.message ?? "format invalid"}`);
      }

      if (nameRows.length > 0) {
        const csv = [
          "nume,cadence_sec,notes",
          ...nameRows.map((row) =>
            [
              csvCell(row.name_normalized),
              row.cadence_sec ? String(row.cadence_sec) : "",
              csvCell(row.notes ?? ""),
            ].join(","),
          ),
        ].join("\n");
        const nameFile = new File([`${csv}\n`], file.name.replace(/\.[^.]+$/, "-nume.csv"), {
          type: "text/csv",
        });
        const preview = await nameLists.preview(nameFile);
        setBulkPreview(preview);
      } else if (dosarRows.length === 0) {
        const preview = await nameLists.preview(file);
        setBulkPreview(preview);
      }
      setBulkTitle(file.name.replace(/\.[^.]+$/, "") || "Lista nume");
      setBulkFilter("all");
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Eroare la procesare fisier.");
    } finally {
      setBulkBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleBulkCommit = async () => {
    if (!bulkPreview && bulkDosarRows.length === 0) return;
    const title = bulkTitle.trim();
    if (!title) {
      setBulkError("Completeaza un titlu pentru lista.");
      return;
    }

    const committable = (bulkPreview?.rows ?? [])
      .filter((row) => row.validation !== "rejected")
      .map((row) => ({
        nameRaw: row.nameRaw,
        cadenceSec: row.cadenceSec ?? null,
        notes: row.notes ?? null,
      }));
    if (committable.length === 0 && bulkDosarRows.length === 0) {
      setBulkError("Nu exista randuri ok/warn sau dosare de importat.");
      return;
    }

    setBulkBusy(true);
    setBulkError(null);
    setBulkCommit(null);
    setBulkDosarResult(null);
    setBulkCommitProgress({ created: 0, remaining: committable.length + bulkDosarRows.length });
    try {
      let dosarAdded = 0;
      let dosarExists = 0;
      let dosarErrors = 0;
      for (let i = 0; i < bulkDosarRows.length; i++) {
        const row = bulkDosarRows[i]!;
        try {
          const result = await monitoring.createDosarWithResult({
            numar_dosar: row.numar_dosar,
            cadence_sec: row.cadence_sec,
            notes: row.notes,
            client_request_id: `bulk-dosar-${row.numar_dosar}-${i}`,
          });
          if (result.created) dosarAdded++;
          else dosarExists++;
        } catch (err) {
          dosarErrors++;
          if (err instanceof MonitoringApiError) {
            console.warn("[monitoring] bulk dosar row failed", {
              row: row.rowNumber,
              code: err.code,
              message: err.message,
            });
          }
        }
        setBulkCommitProgress({ created: dosarAdded, remaining: bulkDosarRows.length - i - 1 + committable.length });
      }
      if (bulkDosarRows.length > 0) {
        setBulkDosarResult({ added: dosarAdded, exists: dosarExists, errors: dosarErrors });
      }

      let last: NameListCommitResult | null = null;
      let createdTotal = 0;
      if (bulkPreview && committable.length > 0) {
        do {
          last = await nameLists.commit({
            title,
            sourceFilename: bulkPreview.sourceFilename,
            sourceSha256: bulkPreview.sha256,
            items: committable,
            autoCreateJobs: true,
            maxJobs: 100,
          });
          createdTotal += last.jobsCreated;
          setBulkCommitProgress({
            created: dosarAdded + createdTotal,
            remaining: last.partial ? Math.max(last.jobsTotal - 100, 0) : 0,
          });
        } while (last.partial);
        setBulkCommit(last);
      }
      await onJobsCreated();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Eroare la commit import.");
    } finally {
      setBulkBusy(false);
    }
  };

  const visiblePreviewRows = bulkPreview
    ? bulkPreview.rows.filter((row) => bulkFilter === "all" || row.validation === bulkFilter)
    : [];

  return (
    <Card>
      <CardHeader
        role="button"
        tabIndex={0}
        onClick={() => setBulkOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setBulkOpen((v) => !v);
          }
        }}
        aria-expanded={bulkOpen}
        aria-controls="bulk-import-content"
        className="cursor-pointer hover:bg-accent/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardTitle className="text-base flex items-center gap-2">
          {bulkOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <FileSpreadsheet className="h-4 w-4" />
          Adaugare bulk din fisier
        </CardTitle>
      </CardHeader>
      {bulkOpen && (
      <CardContent id="bulk-import-content">
        <p className="text-sm text-foreground mb-3">
          Adauga in masa mai multe dosare sau nume dintr-un fisier Excel (XLSX) sau CSV.
          Descarca mai intai template-ul ca sa vezi ce coloane trebuie completate, apoi
          incarca-l inapoi cu randurile tale. Aplicatia adauga automat fiecare rand in
          monitorizare cu cadenta pe care o pui in fisier.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={downloadBulkTemplate} disabled={bulkBusy}>
            <Download className="h-4 w-4" /> Descarca template XLSX
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleBulkUpload(f);
            }}
          />
          <Button
            variant="default"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={bulkBusy}
          >
            <Upload className="h-4 w-4" />
            {bulkBusy ? "Se proceseaza..." : "Incarca fisier"}
          </Button>
        </div>
        {bulkError && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
            {bulkError}
          </div>
        )}
        {(bulkPreview || bulkDosarRows.length > 0) && (
          <div className="mt-4 space-y-4">
            {bulkPreview && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-md bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  {bulkPreview.totals.ok} nume ok
                </span>
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                  {bulkPreview.totals.warn} warn
                </span>
                <span className="rounded-md bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {bulkPreview.totals.rejected} respinse
                </span>
                <span className="text-muted-foreground">din {bulkPreview.totals.total} randuri nume</span>
              </div>
            )}
            {bulkDosarRows.length > 0 && (
              <div className="text-sm text-muted-foreground">
                {bulkDosarRows.length} randuri cu numar_dosar vor fi create ca joburi dosar_soap.
              </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted-foreground">Titlu lista</span>
                <input
                  className="h-9 min-w-72 rounded-md border border-input bg-background px-3 text-sm"
                  value={bulkTitle}
                  onChange={(e) => setBulkTitle(e.target.value)}
                  disabled={bulkBusy}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-muted-foreground">Filtru preview</span>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={bulkFilter}
                  onChange={(e) => setBulkFilter(e.target.value as NameListValidation | "all")}
                >
                  <option value="all">toate</option>
                  <option value="ok">ok</option>
                  <option value="warn">warn</option>
                  <option value="rejected">respinse</option>
                </select>
              </label>
              <Button
                size="sm"
                onClick={handleBulkCommit}
                disabled={
                  bulkBusy ||
                  ((bulkPreview?.totals.ok ?? 0) + (bulkPreview?.totals.warn ?? 0) === 0 &&
                    bulkDosarRows.length === 0)
                }
              >
                <Upload className="h-4 w-4" />
                {bulkBusy
                  ? `Import... ${bulkCommitProgress.created} create`
                  : "Confirma import"}
              </Button>
            </div>

            {bulkPreview && (
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2">Rand</th>
                    <th className="px-3 py-2">Nume</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Mesaj</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePreviewRows.slice(0, 300).map((row) => (
                    <tr key={row.rowIndex} className="border-b last:border-b-0">
                      <td className="px-3 py-2 text-muted-foreground">{row.rowIndex + 1}</td>
                      <td className="px-3 py-2 font-mono">{row.nameRaw || "(gol)"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs ${
                            row.validation === "ok"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : row.validation === "warn"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          }`}
                        >
                          {row.validation}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.validationMsg ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}

            {visiblePreviewRows.length > 300 && (
              <div className="text-xs text-muted-foreground">
                Afisate primele 300 randuri din filtrul curent.
              </div>
            )}
            {bulkCommit && (
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-400">
                Lista #{bulkCommit.list.id} salvata. Joburi noi create:{" "}
                {bulkCommitProgress.created}. Duplicate: {bulkCommit.duplicate ? "da" : "nu"}.
              </div>
            )}
            {bulkDosarResult && (
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-400">
                Dosare bulk: {bulkDosarResult.added} adaugate, {bulkDosarResult.exists} deja existente,
                {bulkDosarResult.errors} erori.
              </div>
            )}
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}
