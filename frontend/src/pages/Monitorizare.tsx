// Monitorizare — minimal read-only + add/delete UI for /api/v1/monitoring/jobs
// (PR-3 surface). Cron scheduling lands in PR-4; this page exists so the user
// has a way to seed the queue and verify writes today.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Trash2,
  RefreshCw,
  Pause,
  Play,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  Building2,
  Info,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TablePagination } from "@/components/table-pagination";
import { JobKindTabs } from "@/components/monitoring/JobKindTabs";
import { MonitoringAddForm } from "@/components/monitoring/MonitoringAddForm";
import { MonitoringBulkImportCard } from "@/components/monitoring/MonitoringBulkImportCard";
import { NoteEditor } from "@/components/monitoring/NoteEditor";
import { monitoring, formatMonitoringTarget, getNameSoapInstitutie, getIccjId, type MonitoringJob } from "@/lib/api";
import { getInstitutieLabel } from "@/lib/institutii";
import { exportMonitoringExcel, exportMonitoringPDF } from "@/lib/export-monitoring";
import { formatIsoDateTime, formatCadence } from "@/lib/datetime-formatters";
import { runStatusLabel } from "@/lib/monitoringRunStatus";
import { useClientSort } from "@/hooks/useClientSort";
import { SortableTh } from "@/components/ui/sortable-th";
import { cn } from "@/lib/utils";
import { useMonitoringJobs } from "@/hooks/useMonitoringJobs";
import { useMonitoringMasterSwitch } from "@/hooks/useMonitoringMasterSwitch";
import { getIccjUrl, getPortalJustUrl } from "@/components/dosare-table-helpers";

const CADENCE_OPTIONS: { label: string; sec: number }[] = [
  { label: "4h", sec: 14400 },
  { label: "8h", sec: 28800 },
  { label: "12h", sec: 43200 },
  { label: "24h", sec: 86400 },
];

export default function Monitorizare({
  onOpenDosar,
  onOpenName,
}: {
  onOpenDosar?: (numarDosar: string, source?: "portaljust" | "iccj") => void;
  onOpenName?: (nume: string) => void;
} = {}) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  // Data-fetch + paging/filter state lives in the hook; this page owns
  // selection, modals, mutations, and the export pipeline.
  const {
    jobs,
    total,
    totalPages,
    loading,
    error,
    page,
    pageSize,
    kindFilter,
    searchInput,
    debouncedQuery,
    setPage,
    setPageSize,
    setKindFilter,
    setSearchInput,
    flushQuery,
    refresh,
    setError,
    setJobs,
  } = useMonitoringJobs();
  // v2.42.0 (Nivel 2): sortare client-side pe pagina curenta de joburi.
  const { sorted: sortedJobs, ...jobSort } = useClientSort(jobs, {
    target: (j) => formatMonitoringTarget(j),
    cadence: (j) => j.cadence_sec,
    lastRun: (j) => j.last_run_at,
    nextRun: (j) => j.next_run_at,
    status: (j) => `${j.active ? "activ" : "pauza"} ${j.last_status ? runStatusLabel(j.last_status) : ""}`,
  });
  const masterSwitch = useMonitoringMasterSwitch();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [openInstantePopover, setOpenInstantePopover] = useState<number | null>(null);
  // v2.10.1 #12: focus restoration — store the element that opened the modal
  // so we can return focus to it on close (a11y: tab order continuity).
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const modalCloseRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (openInstantePopover === null) return;
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenInstantePopover(null);
    };
    document.addEventListener("keydown", handleEsc);
    // Move focus into the modal after mount so SR users land inside the dialog.
    queueMicrotask(() => modalCloseRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", handleEsc);
      // Restore focus only if the previously-focused element is still in the DOM.
      const prev = lastFocusedRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [openInstantePopover]);

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
        parts.push(
          `${result.not_found_ids.length} ${result.not_found_ids.length === 1 ? "inexistent" : "inexistente"}`
        );
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

  // Cand exista selectie -> exporta doar randurile bifate (sunt pe pagina curenta).
  // Altfel -> fetch toate paginile (cu filtrele kind/q active aplicate) ca user-ul
  // sa nu primeasca doar randurile vizibile pe pagina afisata.
  const fetchAllJobsForExport = async (): Promise<MonitoringJob[]> => {
    const PAGE_SIZE = 100;
    const collected: MonitoringJob[] = [];
    let pageNum = 1;
    while (true) {
      const result = await monitoring.list({
        page: pageNum,
        pageSize: PAGE_SIZE,
        kind: kindFilter === "all" ? undefined : kindFilter,
        q: debouncedQuery || undefined,
      });
      collected.push(...result.rows);
      if (collected.length >= result.total || result.rows.length === 0) break;
      pageNum += 1;
      // Hard guard impotriva loop-ului infinit pe un total nestabil intre cereri.
      if (pageNum > 1000) break;
    }
    return collected;
  };

  const handleExport = async (kind: "xlsx" | "pdf") => {
    setExporting(kind);
    setError(null);
    try {
      const data = selectedIds.size > 0 ? jobs.filter((j) => selectedIds.has(j.id)) : await fetchAllJobsForExport();
      if (data.length === 0) return;
      if (kind === "xlsx") await exportMonitoringExcel(data);
      else await exportMonitoringPDF(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la export.");
    } finally {
      setExporting(null);
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
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, cadence_sec: newSec } : j)));
    try {
      await monitoring.patch(job.id, { cadence_sec: newSec });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la actualizarea cadentei.");
      await refresh();
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Monitorizare</h1>
            <p className="text-sm text-muted-foreground">
              Joburi recurente — verificare automata pe PortalJust si ICCJ (scj.ro) pentru dosare existente sau subiecti
              (alerta dosare noi).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Reincarca
          </Button>
        </div>
      </div>

      <MonitoringAddForm onJobAdded={refresh} />

      <MonitoringBulkImportCard onJobsCreated={refresh} />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">
              Monitorizari active{total > 0 ? ` (${total})` : ""}
              {selectedIds.size > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">· {selectedIds.size} selectate</span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {masterSwitch.enabled === null ? (
                masterSwitch.loadError ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      masterSwitch.refresh().catch(() => {});
                    }}
                  >
                    Reincearca incarcarea
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Se incarca...
                  </Button>
                )
              ) : masterSwitch.enabled ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await masterSwitch.toggle(false);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Eroare la oprirea monitorizarii.");
                    }
                  }}
                  disabled={masterSwitch.saving}
                  aria-busy={masterSwitch.saving}
                >
                  {masterSwitch.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
                  Opreste monitorizarea
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={async () => {
                    try {
                      await masterSwitch.toggle(true);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Eroare la reluarea monitorizarii.");
                    }
                  }}
                  disabled={masterSwitch.saving}
                  aria-busy={masterSwitch.saving}
                >
                  {masterSwitch.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Reia monitorizarea
                </Button>
              )}
              {jobs.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exporting !== null}
                    onClick={() => handleExport("xlsx")}
                    title={
                      selectedIds.size > 0
                        ? `Export Excel pentru ${selectedIds.size} joburi selectate`
                        : `Export Excel pentru toate cele ${total} joburi (toate paginile)`
                    }
                  >
                    {exporting === "xlsx" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}{" "}
                    Excel {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exporting !== null}
                    onClick={() => handleExport("pdf")}
                    title={
                      selectedIds.size > 0
                        ? `Export PDF pentru ${selectedIds.size} joburi selectate`
                        : `Export PDF pentru toate cele ${total} joburi (toate paginile)`
                    }
                  >
                    {exporting === "pdf" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}{" "}
                    PDF {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                  </Button>
                </>
              )}
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
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <JobKindTabs
              value={kindFilter}
              onChange={(k) => {
                setKindFilter(k);
                setPage(0);
              }}
              ariaLabel="Filtreaza joburile dupa tip"
            />
            <div className="relative min-w-[260px] flex-1 max-w-md">
              <Input
                type="text"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setPage(0);
                }}
                placeholder="Cauta dupa nume sau numar dosar..."
                className="pr-8"
                aria-label="Cautare in lista de monitorizari"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    flushQuery("");
                    setSearchInput("");
                    setPage(0);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Sterge cautarea"
                  title="Sterge cautarea"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {(kindFilter !== "all" || debouncedQuery) && (
              <span className="text-xs text-muted-foreground">
                {total} {total === 1 ? "rezultat" : "rezultate"}
              </span>
            )}
          </div>
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}
          {total > jobs.length && (
            <div className="mb-3 text-xs text-muted-foreground">
              Selectia opereaza doar pe pagina vizibila ({jobs.length} din {total}).
            </div>
          )}
          {loading && jobs.length === 0 && <div className="text-sm text-muted-foreground">Se incarca...</div>}
          {!loading && jobs.length === 0 && !error && (kindFilter !== "all" || debouncedQuery) && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Niciun rezultat pentru filtrele aplicate.</span>
              <button
                type="button"
                onClick={() => {
                  flushQuery("");
                  setKindFilter("all");
                  setSearchInput("");
                  setPage(0);
                }}
                className="text-xs text-primary hover:underline"
              >
                Reseteaza filtrele
              </button>
            </div>
          )}
          {!loading && jobs.length === 0 && !error && kindFilter === "all" && !debouncedQuery && (
            <div className="text-sm text-muted-foreground">
              Niciun job activ. Adauga primul dosar sau subiect mai sus, incarca un fisier bulk, sau marcheaza un dosar
              din pagina <strong>Cautare Dosare</strong>.
            </div>
          )}
          {jobs.length > 0 &&
            (() => {
              // Show "Detalii" column only when at least one job has scoped instances
              // to surface (Info modal). Otherwise the column header occupies horizontal
              // space without ever rendering content for any row.
              const showDetailsColumn = jobs.some(
                (job) => job.kind === "name_soap" && (getNameSoapInstitutie(job)?.length ?? 0) > 0
              );
              return (
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
                        <SortableTh sort={jobSort} sortKeyName="target" scopeNote="Sorteaza pagina curenta">
                          Tinta
                        </SortableTh>
                        {showDetailsColumn && <th className="px-3 py-2 text-center">Detalii</th>}
                        <SortableTh sort={jobSort} sortKeyName="cadence" scopeNote="Sorteaza pagina curenta">
                          Cadenta
                        </SortableTh>
                        <SortableTh sort={jobSort} sortKeyName="lastRun" scopeNote="Sorteaza pagina curenta">
                          Ultima rulare
                        </SortableTh>
                        <SortableTh sort={jobSort} sortKeyName="nextRun" scopeNote="Sorteaza pagina curenta">
                          Urmatoarea verif.
                        </SortableTh>
                        <SortableTh sort={jobSort} sortKeyName="status" scopeNote="Sorteaza pagina curenta">
                          Status
                        </SortableTh>
                        <th className="px-3 py-2 text-right">Actiuni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedJobs.map((job) => {
                        const target = formatMonitoringTarget(job);
                        const iccjId = getIccjId(job);
                        const isDosar = job.kind === "dosar_soap";
                        // Source badge (parity across kinds): PortalJust rows get "PJ", ICCJ rows "ICCJ".
                        const pjBadge = (
                          <span className="shrink-0 rounded border border-border bg-muted px-1 text-[9px] font-semibold uppercase leading-tight text-muted-foreground">
                            PJ
                          </span>
                        );
                        const noteEditor = (
                          <NoteEditor
                            jobId={job.id}
                            initialNote={job.notes}
                            onSaved={(next) => {
                              setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, notes: next } : j)));
                            }}
                          />
                        );
                        return (
                          <tr
                            key={job.id}
                            className={cn(
                              "border-b hover:bg-accent/30 [&>td]:align-middle",
                              selectedIds.has(job.id) && "bg-accent/40"
                            )}
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
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0">
                                  <span className="inline-flex min-w-0 items-center gap-1.5">
                                    {pjBadge}
                                    <a
                                      href={getPortalJustUrl(target)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={`Deschide ${target} pe portal.just.ro`}
                                      className="inline-flex items-center gap-1 truncate font-bold text-primary hover:text-primary/80 hover:underline"
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
                                      className="col-start-2 row-start-1 row-end-3 self-center h-7 gap-1.5 px-2.5 text-[10.5px]"
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                      Dosare
                                    </Button>
                                  )}
                                  <div className="col-start-1 min-w-0">{noteEditor}</div>
                                </div>
                              ) : job.kind === "name_soap" ? (
                                (() => {
                                  return (
                                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0">
                                      <span className="inline-flex min-w-0 items-center gap-1.5">
                                        {pjBadge}
                                        <span className="min-w-0 break-words font-bold leading-tight">{target}</span>
                                      </span>
                                      {onOpenName && (
                                        <Button
                                          variant="default"
                                          size="sm"
                                          onClick={() => {
                                            onOpenName(target);
                                            navigate("/dosare");
                                          }}
                                          title={`Cauta dosare pentru ${target}`}
                                          className="col-start-2 row-start-1 row-end-3 self-center h-7 shrink-0 gap-1.5 px-2.5 text-[10.5px]"
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                          Dosare
                                        </Button>
                                      )}
                                      <div className="col-start-1 min-w-0">{noteEditor}</div>
                                    </div>
                                  );
                                })()
                              ) : job.kind === "iccj" ? (
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0">
                                  <span className="inline-flex min-w-0 items-center gap-1.5">
                                    <span className="shrink-0 rounded border border-amber-300 bg-amber-50 px-1 text-[9px] font-semibold uppercase leading-tight text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                                      ICCJ
                                    </span>
                                    {iccjId ? (
                                      <a
                                        href={getIccjUrl(iccjId)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={`Deschide ${target} pe ICCJ (scj.ro)`}
                                        className="inline-flex items-center gap-1 truncate font-bold text-primary hover:text-primary/80 hover:underline"
                                      >
                                        {target}
                                        <ExternalLink className="h-3 w-3 shrink-0" />
                                      </a>
                                    ) : onOpenDosar ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onOpenDosar(target, "iccj");
                                          navigate("/dosare");
                                        }}
                                        title={`Cauta ${target} pe ICCJ (scj.ro)`}
                                        className="truncate font-bold text-primary hover:text-primary/80 hover:underline"
                                      >
                                        {target}
                                      </button>
                                    ) : (
                                      <span className="truncate font-bold">{target}</span>
                                    )}
                                  </span>
                                  {onOpenDosar && (
                                    <Button
                                      variant="default"
                                      size="sm"
                                      onClick={() => {
                                        onOpenDosar(target, "iccj");
                                        navigate("/dosare");
                                      }}
                                      title={`Cauta ${target} in Dosare (ICCJ)`}
                                      className="col-start-2 row-start-1 row-end-3 self-center h-7 shrink-0 gap-1.5 px-2.5 text-[10.5px]"
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                      Dosare
                                    </Button>
                                  )}
                                  <div className="col-start-1 min-w-0">{noteEditor}</div>
                                </div>
                              ) : (
                                <div className="min-w-0">
                                  <span>{target}</span>
                                  {noteEditor}
                                </div>
                              )}
                            </td>
                            {showDetailsColumn && (
                              <td className="px-3 py-2 text-center">
                                {job.kind === "name_soap" &&
                                  (() => {
                                    const scope = getNameSoapInstitutie(job) ?? [];
                                    if (scope.length === 0) return null;
                                    return (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenInstantePopover(job.id);
                                        }}
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-yellow-500 hover:bg-yellow-100 hover:text-yellow-600 dark:text-yellow-400 dark:hover:bg-yellow-950 dark:hover:text-yellow-300"
                                        title={`${scope.length} ${scope.length === 1 ? "instanta monitorizata" : "instante monitorizate"} — click pentru detalii`}
                                        aria-label={`Vezi ${scope.length} ${scope.length === 1 ? "instanta" : "instante"}`}
                                      >
                                        <Info className="h-4 w-4" />
                                      </button>
                                    );
                                  })()}
                              </td>
                            )}
                            <td className="px-3 py-2">
                              {(() => {
                                const isStandard = CADENCE_OPTIONS.some((o) => o.sec === job.cadence_sec);
                                return (
                                  <Select
                                    value={String(job.cadence_sec)}
                                    onValueChange={(v) => handleCadenceChange(job, Number(v))}
                                  >
                                    <SelectTrigger
                                      className={cn(
                                        "h-8 px-2 text-xs",
                                        !isStandard && "border-amber-500 text-amber-700 dark:text-amber-400"
                                      )}
                                      title={
                                        isStandard
                                          ? "Modifica intervalul de verificare"
                                          : `Cadenta non-standard (${formatCadence(job.cadence_sec)}). Alege o optiune din lista pentru a o normaliza.`
                                      }
                                    >
                                      <SelectValue placeholder="-" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {!isStandard && (
                                        <SelectItem value={String(job.cadence_sec)}>
                                          {formatCadence(job.cadence_sec)} (custom)
                                        </SelectItem>
                                      )}
                                      {CADENCE_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.sec} value={String(opt.sec)}>
                                          {opt.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                );
                              })()}
                            </td>
                            <td className="px-3 py-2">{formatIsoDateTime(job.last_run_at)}</td>
                            <td className="px-3 py-2">{formatIsoDateTime(job.next_run_at)}</td>
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
                                  className={cn(
                                    "ml-1 text-xs rounded-md px-2 py-0.5",
                                    job.last_status === "ok" &&
                                      "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                                    job.last_status === "error" &&
                                      "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                                    (job.last_status === "partial" || job.last_status === "skipped") &&
                                      "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                  )}
                                >
                                  {runStatusLabel(job.last_status)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title={
                                    masterSwitch.enabled === false
                                      ? "Monitorizarea este oprita global"
                                      : job.active
                                        ? "Pauza"
                                        : "Reia"
                                  }
                                  onClick={() => handleToggleActive(job)}
                                >
                                  {masterSwitch.enabled === false || !job.active ? (
                                    <Play className="h-4 w-4" />
                                  ) : (
                                    <Pause className="h-4 w-4" />
                                  )}
                                </Button>
                                <Button variant="ghost" size="icon" title="Sterge" onClick={() => handleDelete(job)}>
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
              );
            })()}
          {total > 0 && (
            <TablePagination
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              pageSizes={[10, 25, 50, 100]}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              disabled={loading}
            />
          )}
        </CardContent>
      </Card>
      {openInstantePopover !== null &&
        (() => {
          const job = jobs.find((j) => j.id === openInstantePopover);
          if (!job || job.kind !== "name_soap") return null;
          const scope = getNameSoapInstitutie(job) ?? [];
          const labels = scope.map(getInstitutieLabel);
          if (labels.length === 0) return null;
          return (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setOpenInstantePopover(null);
              }}
            >
              <div
                className="w-full max-w-md rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xl"
                // biome-ignore lint/a11y/useSemanticElements: <dialog> nativ ar necesita showModal + focus trap nativ, pattern portal cu role="dialog"+aria-modal e standard React.
                role="dialog"
                aria-modal="true"
                aria-labelledby="instante-modal-title"
              >
                <div className="mb-3 flex items-start justify-between gap-3 border-b border-border pb-2">
                  <div className="min-w-0">
                    <h3 id="instante-modal-title" className="text-[15px] font-semibold text-foreground">
                      Instante monitorizate ({labels.length})
                    </h3>
                    <p className="mt-0.5 truncate text-[13px] font-medium text-foreground/80">
                      {formatMonitoringTarget(job)}
                    </p>
                  </div>
                  <button
                    ref={modalCloseRef}
                    type="button"
                    onClick={() => setOpenInstantePopover(null)}
                    className="rounded p-1 text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    title="Inchide"
                    aria-label="Inchide"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <ul className="max-h-[60vh] space-y-1 overflow-y-auto text-[13px] text-foreground">
                  {labels.map((label) => (
                    <li key={label} className="flex items-start gap-2 py-1">
                      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span>{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
