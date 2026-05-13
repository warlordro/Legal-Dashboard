import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Download, FileSpreadsheet, ChevronDown, ChevronRight, X, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TablePagination } from "@/components/table-pagination";
import {
  monitoring,
  nameLists,
  type NameListPreviewResult,
  type NameListCommitResult,
  type NameListValidation,
  MonitoringApiError,
} from "@/lib/api";
import { downloadBulkTemplate, parseBulkFile, type BulkRowDosar } from "@/lib/monitoringBulkTemplate";

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
  // Paginare client-side: lista poate avea mii de randuri, randam doar pagina
  // curenta. Pe filter/load resetam la pagina 0 (vezi useEffect de mai jos).
  const [bulkPage, setBulkPage] = useState(0);
  const [bulkPageSize, setBulkPageSize] = useState(100);
  // Set de rowIndex (din NameListPreviewRow) excluse manual de utilizator
  // inainte de commit. NU se trimit la server; "exclude" inseamna pur si
  // simplu "nu trimite acest rand in body.items".
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  // Toggle global: exclude automat toate randurile cu validation='warn'.
  // Util pentru cazul "vreau doar nume curate, sar peste duplicate + nume lungi".
  const [excludeWarnsAuto, setExcludeWarnsAuto] = useState(false);

  const handleBulkUpload = async (file: File) => {
    setBulkBusy(true);
    setBulkError(null);
    setBulkPreview(null);
    setBulkCommit(null);
    setBulkDosarRows([]);
    setBulkDosarResult(null);
    setBulkCommitProgress({ created: 0, remaining: 0 });
    setExcludedRows(new Set());
    setExcludeWarnsAuto(false);
    setBulkPage(0);
    try {
      const buffer = await file.arrayBuffer();
      const parsedBulk = parseBulkFile(buffer, file.name);
      const dosarRows = parsedBulk.valid.filter((row): row is BulkRowDosar => row.kind === "dosar");
      const nameRows = parsedBulk.valid.filter((row) => row.kind === "nume");
      setBulkDosarRows(dosarRows);

      if (parsedBulk.invalid.length > 0) {
        setBulkError(
          `${parsedBulk.invalid.length} randuri din XLSX au fost ignorate: ${parsedBulk.invalid[0]?.message ?? "format invalid"}`
        );
      }

      if (nameRows.length > 0) {
        const csv = [
          "nume,cadence_sec,notes",
          ...nameRows.map((row) =>
            [
              csvCell(row.name_normalized),
              row.cadence_sec ? String(row.cadence_sec) : "",
              csvCell(row.notes ?? ""),
            ].join(",")
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
      .filter((row) => !excludedRows.has(row.rowIndex))
      .filter((row) => !(excludeWarnsAuto && row.validation === "warn"))
      .map((row) => ({
        nameRaw: row.nameRaw,
        cadenceSec: row.cadenceSec ?? null,
        notes: row.notes ?? null,
      }));
    if (committable.length === 0 && bulkDosarRows.length === 0) {
      setBulkError("Nu exista randuri de importat (ai exclus toate randurile valide).");
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
      // Chunk parallelism: 5 in flight at a time. Sequential per-row was the
      // dominant bottleneck on lists with 50+ dosare (each round-trip ~80ms);
      // pure Promise.all on 100+ requests risks 429 from the small-mutation
      // rate limit. Five strikes the balance — 5x faster than sequential
      // while staying well under the per-IP minute budget.
      const CHUNK = 5;
      let processed = 0;
      for (let start = 0; start < bulkDosarRows.length; start += CHUNK) {
        const slice = bulkDosarRows.slice(start, start + CHUNK);
        const results = await Promise.all(
          slice.map(async (row, idx) => {
            try {
              const result = await monitoring.createDosarWithResult({
                numar_dosar: row.numar_dosar,
                cadence_sec: row.cadence_sec,
                notes: row.notes,
                client_request_id: `bulk-dosar-${row.numar_dosar}-${start + idx}`,
              });
              return { ok: true as const, created: result.created };
            } catch (err) {
              if (err instanceof MonitoringApiError) {
                console.warn("[monitoring] bulk dosar row failed", {
                  row: row.rowNumber,
                  code: err.code,
                  message: err.message,
                });
              }
              return { ok: false as const };
            }
          })
        );
        for (const r of results) {
          if (!r.ok) dosarErrors++;
          else if (r.created) dosarAdded++;
          else dosarExists++;
        }
        processed += slice.length;
        setBulkCommitProgress({
          created: dosarAdded,
          remaining: bulkDosarRows.length - processed + committable.length,
        });
      }
      if (bulkDosarRows.length > 0) {
        setBulkDosarResult({ added: dosarAdded, exists: dosarExists, errors: dosarErrors });
      }

      let last: NameListCommitResult | null = null;
      let createdTotal = 0;
      if (bulkPreview && committable.length > 0) {
        // Server-side commit is paginated via maxJobs=100. We iterate until
        // partial=false. Two guards keep this from spinning forever if the
        // backend ever stops making progress (idempotency dedup mismatch,
        // server-side rate-limit, etc.):
        //  - hard iteration cap MAX_ITERATIONS bounds total calls;
        //  - inner check breaks out the loop if jobsCreated===0 means we did
        //    a full round-trip without advancing.
        const MAX_ITERATIONS = 50;
        let iteration = 0;
        do {
          if (iteration >= MAX_ITERATIONS) {
            throw new Error(
              `Import oprit dupa ${MAX_ITERATIONS} cereri partiale fara finalizare. Reincearca sau contacteaza suportul.`
            );
          }
          iteration += 1;
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
          if (last.partial && last.jobsCreated === 0) {
            throw new Error(
              "Importul nu mai progreseaza (0 joburi noi intr-o cerere partiala). Reincearca mai tarziu."
            );
          }
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

  const handleBulkCancel = () => {
    setBulkPreview(null);
    setBulkCommit(null);
    setBulkDosarRows([]);
    setBulkDosarResult(null);
    setBulkCommitProgress({ created: 0, remaining: 0 });
    setBulkError(null);
    setBulkTitle("");
    setBulkFilter("all");
    setExcludedRows(new Set());
    setExcludeWarnsAuto(false);
    setBulkPage(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toggleRowExclusion = (rowIndex: number) => {
    setExcludedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  const visiblePreviewRows = useMemo(
    () => (bulkPreview ? bulkPreview.rows.filter((row) => bulkFilter === "all" || row.validation === bulkFilter) : []),
    [bulkPreview, bulkFilter]
  );

  // Reset paginare cand filtrul / lista se schimba — altfel utilizatorul
  // ramane pe pagina N a unei liste vechi.
  // biome-ignore lint/correctness/useExhaustiveDependencies: bulkFilter/bulkPreview sunt declansatorii reset-ului, nu sunt citite in body.
  useEffect(() => {
    setBulkPage(0);
  }, [bulkFilter, bulkPreview]);

  const totalPages = Math.max(1, Math.ceil(visiblePreviewRows.length / bulkPageSize));
  const safePage = Math.min(bulkPage, totalPages - 1);
  const pageStart = safePage * bulkPageSize;
  const pageRows = visiblePreviewRows.slice(pageStart, pageStart + bulkPageSize);
  const longNameNoteCount = useMemo(
    () => bulkPreview?.rows.filter((row) => (row.notes?.length ?? 0) > 200).length ?? 0,
    [bulkPreview]
  );
  const longDosarNoteCount = useMemo(
    () => bulkDosarRows.filter((row) => (row.notes?.length ?? 0) > 200).length,
    [bulkDosarRows]
  );

  // Numar randuri care vor ajunge efectiv la commit dupa toate filtrele
  // (rejected scos automat, manual excluse, +/- warn-uri auto-excluse).
  const effectiveCommittableCount = useMemo(() => {
    if (!bulkPreview) return 0;
    let n = 0;
    for (const row of bulkPreview.rows) {
      if (row.validation === "rejected") continue;
      if (excludedRows.has(row.rowIndex)) continue;
      if (excludeWarnsAuto && row.validation === "warn") continue;
      n++;
    }
    return n;
  }, [bulkPreview, excludedRows, excludeWarnsAuto]);

  return (
    <Card>
      <CardHeader className="p-0">
        <button
          type="button"
          onClick={() => setBulkOpen((v) => !v)}
          aria-expanded={bulkOpen}
          aria-controls="bulk-import-content"
          className="w-full cursor-pointer px-6 py-4 text-left transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CardTitle className="text-base flex items-center gap-2">
            {bulkOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <FileSpreadsheet className="h-4 w-4" />
            Adaugare bulk din fisier
          </CardTitle>
        </button>
      </CardHeader>
      {bulkOpen && (
        <CardContent id="bulk-import-content">
          <p className="text-sm text-foreground mb-3">
            Adauga in masa mai multe dosare sau nume dintr-un fisier Excel (XLSX) sau CSV. Descarca mai intai
            template-ul ca sa vezi ce coloane trebuie completate, apoi incarca-l inapoi cu randurile tale. Aplicatia
            adauga automat fiecare rand in monitorizare cu cadenta pe care o pui in fisier.
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
            <Button variant="default" size="sm" onClick={() => fileInputRef.current?.click()} disabled={bulkBusy}>
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
                <div className="space-y-2">
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
                    {(excludedRows.size > 0 || excludeWarnsAuto) && (
                      <span className="rounded-md bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        {bulkPreview.totals.total - bulkPreview.totals.rejected - effectiveCommittableCount} excluse
                        manual {effectiveCommittableCount} de importat
                      </span>
                    )}
                  </div>
                  <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer text-foreground">Ce inseamna fiecare status?</summary>
                    <ul className="mt-2 space-y-1.5 leading-relaxed">
                      <li>
                        <span className="rounded-md bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          ok
                        </span>{" "}
                        Numele e valid si va fi importat ca job de monitorizare.
                      </li>
                      <li>
                        <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                          warn
                        </span>{" "}
                        Numele e valid dar are o particularitate. Vezi coloana "Mesaj" pentru motiv. Cele doua tipuri de
                        warn sunt:
                        <ul className="mt-1 ml-4 list-disc space-y-0.5">
                          <li>
                            <strong>Duplicat in fisier</strong> — sigur de importat. Sistemul deduplica automat: NU se
                            creeaza un job in plus.
                          </li>
                          <li>
                            <strong>Nume lung pentru PortalJust</strong> — risc real ca PortalJust sa raspunda cu eroare
                            la cautare. Considera sa-l excluzi sau sa scurtezi numele in fisier.
                          </li>
                        </ul>
                      </li>
                      <li>
                        <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          respinse
                        </span>{" "}
                        Numele e invalid (gol, sub 2 caractere, peste 200 caractere, doar cifre). NU se va importa,
                        indiferent de selectia ta.
                      </li>
                      <li>
                        Butonul <strong>Exclude</strong> de pe fiecare rand permite sa scoti manual orice rand inainte
                        de import (util pentru nume lungi sau introduse din greseala).
                      </li>
                    </ul>
                  </details>
                </div>
              )}
              {bulkDosarRows.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  {bulkDosarRows.length} randuri cu numar_dosar vor fi create ca joburi dosar_soap.
                </div>
              )}
              {longNameNoteCount + longDosarNoteCount > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                  {longNameNoteCount + longDosarNoteCount} randuri au notite mai lungi de 200 caractere si vor fi
                  respinse la salvare. Verifica coloana notes.
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
                <div className="grid gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">Filtru preview</span>
                  <Select value={bulkFilter} onValueChange={(v) => setBulkFilter(v as NameListValidation | "all")}>
                    <SelectTrigger>
                      <SelectValue placeholder="Filtru" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">toate</SelectItem>
                      <SelectItem value="ok">ok</SelectItem>
                      <SelectItem value="warn">warn</SelectItem>
                      <SelectItem value="rejected">respinse</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {bulkPreview && bulkPreview.totals.warn > 0 && (
                  <label className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-sm">
                    <input
                      type="checkbox"
                      checked={excludeWarnsAuto}
                      onChange={(e) => setExcludeWarnsAuto(e.target.checked)}
                    />
                    <span>Exclude warn-urile automat</span>
                  </label>
                )}
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
                  {bulkBusy ? `Import... ${bulkCommitProgress.created} create` : "Confirma import"}
                </Button>
                <Button variant="outline" size="sm" onClick={handleBulkCancel} disabled={bulkBusy}>
                  <X className="h-4 w-4" />
                  Anuleaza
                </Button>
              </div>

              {bulkPreview && (
                <div className="rounded-md border">
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                          <th className="px-3 py-2">Rand</th>
                          <th className="px-3 py-2">Nume</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Mesaj</th>
                          <th className="px-3 py-2 text-right">Actiune</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                              Niciun rand pentru filtrul curent.
                            </td>
                          </tr>
                        ) : (
                          pageRows.map((row) => {
                            const isExcluded = excludedRows.has(row.rowIndex);
                            const isAutoExcluded = excludeWarnsAuto && row.validation === "warn";
                            const isRejected = row.validation === "rejected";
                            const skipped = isExcluded || isAutoExcluded || isRejected;
                            return (
                              <tr
                                key={row.rowIndex}
                                className={cn("border-b last:border-b-0", skipped && "bg-muted/30")}
                              >
                                <td
                                  className={cn(
                                    "px-3 py-2 text-muted-foreground",
                                    skipped && "line-through opacity-60"
                                  )}
                                >
                                  {row.rowIndex + 1}
                                </td>
                                <td className={cn("px-3 py-2 font-mono", skipped && "line-through opacity-60")}>
                                  {row.nameRaw || "(gol)"}
                                </td>
                                <td className="px-3 py-2">
                                  <span
                                    className={cn(
                                      "rounded-md px-2 py-0.5 text-xs",
                                      row.validation === "ok" &&
                                        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                                      row.validation === "warn" &&
                                        "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
                                      row.validation === "rejected" &&
                                        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                    )}
                                  >
                                    {row.validation}
                                  </span>
                                  {isExcluded && (
                                    <span className="ml-1 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                      exclus
                                    </span>
                                  )}
                                  {isAutoExcluded && !isExcluded && (
                                    <span className="ml-1 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                      auto-exclus
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {(row.notes?.length ?? 0) > 200
                                    ? "Notita > 200 chars - va fi respinsa la salvare"
                                    : (row.validationMsg ?? "-")}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {row.validation === "rejected" ? (
                                    <span className="text-xs text-muted-foreground">-</span>
                                  ) : isExcluded ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => toggleRowExclusion(row.rowIndex)}
                                      className="h-7 px-2 text-xs"
                                    >
                                      <Undo2 className="h-3 w-3" /> Include
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => toggleRowExclusion(row.rowIndex)}
                                      className="h-7 px-2 text-xs"
                                      disabled={isAutoExcluded}
                                      title={isAutoExcluded ? "Deja auto-exclus prin toggle-ul global" : undefined}
                                    >
                                      <Trash2 className="h-3 w-3" /> Exclude
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  {visiblePreviewRows.length > 0 && (
                    <TablePagination
                      page={safePage}
                      totalPages={totalPages}
                      pageSize={bulkPageSize}
                      onPageChange={setBulkPage}
                      onPageSizeChange={(size) => {
                        setBulkPageSize(size);
                        setBulkPage(0);
                      }}
                      pageSizes={[25, 50, 100, 250]}
                    />
                  )}
                </div>
              )}
              {bulkCommit && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-400">
                  Lista #{bulkCommit.list.id} salvata. Joburi noi create: {bulkCommitProgress.created}. Duplicate:{" "}
                  {bulkCommit.duplicate ? "da" : "nu"}.
                </div>
              )}
              {bulkDosarResult && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-400">
                  Dosare bulk: {bulkDosarResult.added} adaugate, {bulkDosarResult.exists} deja existente,{" "}
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
