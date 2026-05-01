// Monitorizare — minimal read-only + add/delete UI for /api/v1/monitoring/jobs
// (PR-3 surface). Cron scheduling lands in PR-4; this page exists so the user
// has a way to seed the queue and verify writes today.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Trash2,
  RefreshCw,
  Pause,
  Play,
  Upload,
  Download,
  FileSpreadsheet,
  ExternalLink,
  Eye,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { MonitoringAddForm } from "@/components/monitoring/MonitoringAddForm";
import {
  monitoring,
  nameLists,
  formatMonitoringTarget,
  type MonitoringJob,
  type NameListPreviewResult,
  type NameListCommitResult,
  type NameListValidation,
  MonitoringApiError,
} from "@/lib/api";
import { downloadBulkTemplate, parseBulkFile, type BulkRowDosar } from "@/lib/monitoringBulkTemplate";
import { getPortalJustUrl } from "@/components/dosare-table-helpers";

const CADENCE_OPTIONS: { label: string; sec: number }[] = [
  { label: "4h", sec: 14400 },
  { label: "8h", sec: 28800 },
  { label: "12h", sec: 43200 },
  { label: "24h", sec: 86400 },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCadence(sec: number): string {
  if (sec >= 86400) return `${Math.round(sec / 86400)}z`;
  if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 60)}min`;
}

interface BulkDosarResult {
  added: number;
  exists: number;
  errors: number;
}

export default function Monitorizare({
  onOpenDosar,
}: {
  onOpenDosar?: (numarDosar: string) => void;
} = {}) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<MonitoringJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Bulk-upload state
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await monitoring.list({ pageSize: 100 });
      setJobs(result.rows);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare la incarcarea jobs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Prune selection of IDs that no longer exist (after refresh / bulk delete)
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(jobs.map((j) => j.id));
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [jobs]);

  const allSelected = jobs.length > 0 && jobs.every((j) => selectedIds.has(j.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(jobs.map((j) => j.id)));
  };

  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Sterge ${ids.length} ${ids.length === 1 ? "monitorizare" : "monitorizari"}?`,
      message: `Stergi ${ids.length} ${ids.length === 1 ? "job monitorizat" : "joburi monitorizate"}. Cele cu rulare in curs vor ramane (le poti retry mai tarziu).`,
      confirmLabel: "Sterge",
      destructive: true,
    });
    if (!ok) return;
    setBulkDeleting(true);
    setError(null);
    try {
      const result = await monitoring.bulkDeleteJobs(ids);
      const deletedSet = new Set(result.deleted_ids);
      // Pastram in selectie ce nu s-a sters (inflight + not_found pentru retry).
      setSelectedIds((prev) => {
        const next = new Set<number>();
        for (const id of prev) if (!deletedSet.has(id)) next.add(id);
        return next;
      });
      const parts: string[] = [];
      if (result.deleted_ids.length > 0) {
        parts.push(`${result.deleted_ids.length} ${result.deleted_ids.length === 1 ? "stersa" : "sterse"}`);
      }
      if (result.inflight_ids.length > 0) {
        parts.push(`${result.inflight_ids.length} in rulare`);
      }
      if (result.not_found_ids.length > 0) {
        parts.push(`${result.not_found_ids.length} ${result.not_found_ids.length === 1 ? "inexistent" : "inexistente"}`);
      }
      if (result.inflight_ids.length > 0 || result.not_found_ids.length > 0) {
        setError(parts.join(", ") + ".");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la stergerea bulk.");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDelete = async (job: MonitoringJob) => {
    const ok = await confirm({
      title: "Sterge monitorizarea?",
      message: `Dosar: ${formatMonitoringTarget(job)} (id ${job.id})`,
      confirmLabel: "Sterge",
      destructive: true,
    });
    if (!ok) return;
    try {
      await monitoring.deleteJob(job.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la stergere.");
    }
  };

  const handleToggleActive = async (job: MonitoringJob) => {
    try {
      await monitoring.patch(job.id, { active: !job.active });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la actualizare.");
    }
  };

  const handleCadenceChange = async (job: MonitoringJob, newSec: number) => {
    if (newSec === job.cadence_sec) return;
    // Optimistic update — patch row in place so the UI feels instant.
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, cadence_sec: newSec } : j)),
    );
    try {
      await monitoring.patch(job.id, { cadence_sec: newSec });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la actualizarea cadentei.");
      await refresh();
    }
  };

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

  function csvCell(value: string): string {
    if (!/[",\n\r]/.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
  }

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
      await refresh();
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
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Monitorizare</h1>
            <p className="text-sm text-muted-foreground">
              Joburi recurente — verificare automata pe PortalJust pentru dosare existente sau subiecti (alerta dosare noi).
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Reincarca
        </Button>
      </div>

      <MonitoringAddForm onJobAdded={refresh} />

      <Card>
        <button
          type="button"
          onClick={() => setBulkOpen((v) => !v)}
          aria-expanded={bulkOpen}
          aria-controls="bulk-import-content"
          className="w-full text-left"
        >
          <CardHeader className="cursor-pointer hover:bg-accent/30 transition-colors">
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
        </button>
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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">
              Joburi active{jobs.length > 0 ? ` (${jobs.length})` : ""}
              {selectedIds.size > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  · {selectedIds.size} selectate
                </span>
              )}
            </CardTitle>
            {selectedIds.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                title={`Sterge ${selectedIds.size} joburi selectate`}
              >
                <Trash2 className="h-4 w-4" />
                {bulkDeleting ? "Se sterg..." : `Sterge selectate (${selectedIds.size})`}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}
          {jobs.length >= 100 && (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-400">
              Sunt cel putin {jobs.length} joburi vizibile{total > jobs.length ? ` (din ${total} total)` : ""}; pot exista mai multe nelistate. Foloseste filtre pentru a reduce setul.
            </div>
          )}
          {total > jobs.length && jobs.length < 100 && (
            <div className="mb-3 text-xs text-muted-foreground">
              Selectia opereaza doar pe pagina vizibila ({jobs.length} din {total}).
            </div>
          )}
          {loading && jobs.length === 0 && (
            <div className="text-sm text-muted-foreground">Se incarca...</div>
          )}
          {!loading && jobs.length === 0 && !error && (
            <div className="text-sm text-muted-foreground">
              Niciun job activ. Adauga primul dosar sau subiect mai sus, incarca un fisier bulk,
              sau marcheaza un dosar din pagina <strong>Cautare Dosare</strong>.
            </div>
          )}
          {jobs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected;
                        }}
                        onChange={toggleAll}
                        aria-label={allSelected ? "Deselecteaza toate" : "Selecteaza toate"}
                        title={allSelected ? "Deselecteaza toate" : "Selecteaza toate"}
                      />
                    </th>
                    <th className="px-3 py-2">Tinta</th>
                    <th className="px-3 py-2">Tip</th>
                    <th className="px-3 py-2">Cadenta</th>
                    <th className="px-3 py-2">Urmatoarea verif.</th>
                    <th className="px-3 py-2">Ultima rulare</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Actiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const target = formatMonitoringTarget(job);
                    const isDosar = job.kind === "dosar_soap";
                    return (
                    <tr
                      key={job.id}
                      className={`border-b hover:bg-accent/30 ${
                        selectedIds.has(job.id) ? "bg-accent/40" : ""
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-primary"
                          checked={selectedIds.has(job.id)}
                          onChange={() => toggleOne(job.id)}
                          aria-label={`Selecteaza ${formatMonitoringTarget(job)}`}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {isDosar ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex w-[180px] items-center">
                              <a
                                href={getPortalJustUrl(target)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Deschide ${target} pe portal.just.ro`}
                                className="inline-flex items-center gap-1 font-bold text-primary hover:text-primary/80 hover:underline"
                              >
                                {target}
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            </span>
                            {onOpenDosar && (
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => {
                                  onOpenDosar(target);
                                  navigate("/dosare");
                                }}
                                title={`Deschide ${target} in lista Dosare`}
                                // Match the visual size of the same button in
                                // Alerts cards. There the parent has CSS
                                // `zoom: ~0.833` (font Normal), so an
                                // unscaled `size="sm" + text-[12.5px]` button
                                // here looks bigger than the equivalent in
                                // Alerts. Compensating with h-7 / px-2.5 /
                                // text-[10.5px] / icon 3.5 keeps the two
                                // pages visually consistent.
                                className="h-7 gap-1.5 px-2.5 text-[10.5px]"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                Dosare
                              </Button>
                            )}
                          </div>
                        ) : (
                          target
                        )}
                        {job.notes && (
                          <div
                            className="mt-1 max-w-[420px] truncate text-xs italic text-muted-foreground font-sans"
                            title={job.notes}
                          >
                            {job.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {job.kind === "dosar_soap" ? "Dosar"
                          : job.kind === "name_soap" ? "Subiect"
                          : job.kind === "aviz_rnpm" ? "Aviz RNPM"
                          : job.kind}
                      </td>
                      <td className="px-3 py-2">
                        {(() => {
                          const isStandard = CADENCE_OPTIONS.some((o) => o.sec === job.cadence_sec);
                          return (
                            <select
                              className={`h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                isStandard ? "" : "border-amber-500 text-amber-700 dark:text-amber-400"
                              }`}
                              value={job.cadence_sec}
                              onChange={(e) => handleCadenceChange(job, Number(e.target.value))}
                              title={
                                isStandard
                                  ? "Modifica intervalul de verificare"
                                  : `Cadenta non-standard (${formatCadence(job.cadence_sec)}). Alege o optiune din lista pentru a o normaliza.`
                              }
                            >
                              {!isStandard && (
                                <option value={job.cadence_sec}>
                                  {formatCadence(job.cadence_sec)} (custom)
                                </option>
                              )}
                              {CADENCE_OPTIONS.map((opt) => (
                                <option key={opt.sec} value={opt.sec}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        {formatDateTime(job.next_run_at)}
                      </td>
                      <td className="px-3 py-2">
                        {formatDateTime(job.last_run_at)}
                      </td>
                      <td className="px-3 py-2">
                        {job.active ? (
                          <span className="text-xs rounded-md bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            activ
                          </span>
                        ) : (
                          <span className="text-xs rounded-md bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            pauza
                          </span>
                        )}
                        {job.last_status && (
                          <span
                            className={`ml-1 text-xs rounded-md px-2 py-0.5 ${
                              job.last_status === "ok"
                                ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : job.last_status === "error"
                                ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            }`}
                          >
                            {job.last_status}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={job.active ? "Pauza" : "Reia"}
                            onClick={() => handleToggleActive(job)}
                          >
                            {job.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Sterge"
                            onClick={() => handleDelete(job)}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
