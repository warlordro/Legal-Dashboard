// Monitorizare — minimal read-only + add/delete UI for /api/v1/monitoring/jobs
// (PR-3 surface). Cron scheduling lands in PR-4; this page exists so the user
// has a way to seed the queue and verify writes today.

import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { MonitoringAddForm } from "@/components/monitoring/MonitoringAddForm";
import { MonitoringBulkImportCard } from "@/components/monitoring/MonitoringBulkImportCard";
import {
  monitoring,
  formatMonitoringTarget,
  type MonitoringJob,
} from "@/lib/api";
import { exportMonitoringExcel, exportMonitoringPDF } from "@/lib/export";
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

export default function Monitorizare({
  onOpenDosar,
  onOpenName,
}: {
  onOpenDosar?: (numarDosar: string) => void;
  onOpenName?: (nume: string) => void;
} = {}) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<MonitoringJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

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

  const getExportJobs = (): MonitoringJob[] =>
    selectedIds.size === 0 ? jobs : jobs.filter((j) => selectedIds.has(j.id));

  const handleExport = async (kind: "xlsx" | "pdf") => {
    const data = getExportJobs();
    if (data.length === 0) return;
    setExporting(kind);
    setError(null);
    try {
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

      <MonitoringBulkImportCard onJobsCreated={refresh} />

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
            <div className="flex items-center gap-2">
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
                        : `Export Excel pentru toate cele ${jobs.length} joburi`
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
                        : `Export PDF pentru toate cele ${jobs.length} joburi`
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
                    <th className="px-3 py-2">Ultima rulare</th>
                    <th className="px-3 py-2">Urmatoarea verif.</th>
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
                        ) : job.kind === "name_soap" ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex w-[180px] items-center font-bold">
                              {target}
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
                          : job.kind === "name_soap" ? "Nume"
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
                        {formatDateTime(job.last_run_at)}
                      </td>
                      <td className="px-3 py-2">
                        {formatDateTime(job.next_run_at)}
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
