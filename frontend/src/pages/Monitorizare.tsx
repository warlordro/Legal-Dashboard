// Monitorizare — minimal read-only + add/delete UI for /api/v1/monitoring/jobs
// (PR-3 surface). Cron scheduling lands in PR-4; this page exists so the user
// has a way to seed the queue and verify writes today.

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Trash2, RefreshCw, Pause, Play, Upload, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { MonitoringAddForm } from "@/components/monitoring/MonitoringAddForm";
import {
  monitoring,
  formatMonitoringTarget,
  MonitoringApiError,
  type MonitoringJob,
} from "@/lib/api";
import { parseSqliteUtc } from "@/lib/utils";
import { downloadBulkTemplate, parseBulkFile } from "@/lib/monitoringBulkTemplate";

const NUMAR_DOSAR_RE = /^\d{1,7}\/\d{1,5}\/\d{4}(?:\/[A-Za-z0-9]+)?$/;
const CADENCE_OPTIONS: { label: string; sec: number }[] = [
  { label: "4h", sec: 14400 },
  { label: "8h", sec: 28800 },
  { label: "12h", sec: 43200 },
  { label: "24h", sec: 86400 },
];
const DEFAULT_CADENCE_SEC = 14400;

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

interface BulkResultItem {
  rowNumber: number;
  display: string;
  status: "added" | "exists" | "error";
  message?: string;
}

interface BulkResult {
  total: number;
  added: number;
  exists: number;
  errors: number;
  items: BulkResultItem[];
}

export default function Monitorizare() {
  const confirm = useConfirm();
  const [jobs, setJobs] = useState<MonitoringJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bulk-upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await monitoring.list({ pageSize: 100 });
      setJobs(result.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare la incarcarea jobs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
    setBulkResult(null);
    setBulkProgress({ done: 0, total: 0 });
    try {
      const buffer = await file.arrayBuffer();
      const { valid, invalid } = parseBulkFile(buffer, file.name);
      if (valid.length === 0 && invalid.length === 0) {
        setBulkError("Fisierul nu contine randuri valide.");
        return;
      }
      const items: BulkResultItem[] = invalid.map((it) => ({
        rowNumber: it.rowNumber,
        display: it.display,
        status: "error" as const,
        message: it.message,
      }));
      let added = 0;
      let exists = 0;
      let errors = invalid.length;
      const total = valid.length + invalid.length;
      setBulkProgress({ done: invalid.length, total });

      for (let i = 0; i < valid.length; i++) {
        const row = valid[i];
        const display = row.kind === "dosar" ? row.numar_dosar : row.name_normalized;
        if (row.kind === "dosar" && !NUMAR_DOSAR_RE.test(row.numar_dosar)) {
          items.push({
            rowNumber: row.rowNumber,
            display,
            status: "error",
            message: "Format numar_dosar invalid",
          });
          errors++;
          setBulkProgress({ done: invalid.length + i + 1, total });
          continue;
        }
        try {
          // Idempotent per row — re-uploading same file skips duplicates.
          const reqId = `bulk-${display}-${Date.now()}-${i}`;
          const job = row.kind === "dosar"
            ? await monitoring.createDosar({
                numar_dosar: row.numar_dosar,
                cadence_sec: row.cadence_sec,
                notes: row.notes,
                client_request_id: reqId,
              })
            : await monitoring.createName({
                name_normalized: row.name_normalized,
                cadence_sec: row.cadence_sec,
                notes: row.notes,
                client_request_id: reqId,
              });
          const wasJustCreated = Date.now() - parseSqliteUtc(job.created_at).getTime() < 5000;
          items.push({
            rowNumber: row.rowNumber,
            display,
            status: wasJustCreated ? "added" : "exists",
          });
          if (wasJustCreated) added++;
          else exists++;
        } catch (err) {
          const msg = err instanceof MonitoringApiError
            ? `${err.message} (${err.code})`
            : err instanceof Error
              ? err.message
              : "Eroare";
          items.push({
            rowNumber: row.rowNumber,
            display,
            status: "error",
            message: msg,
          });
          errors++;
        }
        setBulkProgress({ done: invalid.length + i + 1, total });
      }
      setBulkResult({ total, added, exists, errors, items });
      await refresh();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Eroare la procesare fisier.");
    } finally {
      setBulkBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Adaugare bulk din fisier
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Descarca template-ul, completeaza{" "}
            <code className="px-1 rounded bg-muted">numar_dosar</code> SAU{" "}
            <code className="px-1 rounded bg-muted">nume</code> pe fiecare rand (nu ambele),
            optional <code className="px-1 rounded bg-muted">cadence_sec</code> (dropdown:{" "}
            <code className="px-1 rounded bg-muted">4h</code>/<code className="px-1 rounded bg-muted">8h</code>/
            <code className="px-1 rounded bg-muted">12h</code>/<code className="px-1 rounded bg-muted">24h</code>)
            si <code className="px-1 rounded bg-muted">notes</code>, apoi incarca-l inapoi.
            Format: XLSX sau CSV.
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
              {bulkBusy
                ? `Se proceseaza... ${bulkProgress.done}/${bulkProgress.total}`
                : "Incarca fisier"}
            </Button>
          </div>
          {bulkError && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {bulkError}
            </div>
          )}
          {bulkResult && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-md bg-green-100 px-2 py-0.5 text-green-700">
                  {bulkResult.added} adaugate
                </span>
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-800">
                  {bulkResult.exists} deja existente
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 ${
                    bulkResult.errors > 0
                      ? "bg-red-100 text-red-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {bulkResult.errors} erori
                </span>
                <span className="text-muted-foreground">din {bulkResult.total} randuri</span>
              </div>
              {bulkResult.errors > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Detalii erori ({bulkResult.errors})
                  </summary>
                  <ul className="mt-2 space-y-1 pl-4 list-disc">
                    {bulkResult.items
                      .filter((it) => it.status === "error")
                      .map((it, i) => (
                        <li key={i}>
                          rand {it.rowNumber} —{" "}
                          <span className="font-mono">{it.display || "(gol)"}</span> —{" "}
                          <span className="text-red-600">{it.message}</span>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Joburi active{jobs.length > 0 ? ` (${jobs.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
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
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b hover:bg-accent/30">
                      <td className="px-3 py-2 font-mono">{formatMonitoringTarget(job)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {job.kind === "dosar_soap" ? "Dosar"
                          : job.kind === "name_soap" ? "Subiect"
                          : job.kind === "aviz_rnpm" ? "Aviz RNPM"
                          : job.kind}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={
                            CADENCE_OPTIONS.some((o) => o.sec === job.cadence_sec)
                              ? job.cadence_sec
                              : DEFAULT_CADENCE_SEC
                          }
                          onChange={(e) => handleCadenceChange(job, Number(e.target.value))}
                          title="Modifica intervalul de verificare"
                        >
                          {CADENCE_OPTIONS.map((opt) => (
                            <option key={opt.sec} value={opt.sec}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDateTime(job.next_run_at)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDateTime(job.last_run_at)}
                      </td>
                      <td className="px-3 py-2">
                        {job.active ? (
                          <span className="text-xs rounded-md bg-green-100 px-2 py-0.5 text-green-700">
                            activ
                          </span>
                        ) : (
                          <span className="text-xs rounded-md bg-gray-100 px-2 py-0.5 text-gray-600">
                            pauza
                          </span>
                        )}
                        {job.last_status && (
                          <span
                            className={`ml-1 text-xs rounded-md px-2 py-0.5 ${
                              job.last_status === "ok"
                                ? "bg-green-50 text-green-700"
                                : job.last_status === "error"
                                ? "bg-red-50 text-red-700"
                                : "bg-amber-50 text-amber-700"
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
