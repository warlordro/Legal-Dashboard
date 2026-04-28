// Monitorizare — minimal read-only + add/delete UI for /api/v1/monitoring/jobs
// (PR-3 surface). Cron scheduling lands in PR-4; this page exists so the user
// has a way to seed the queue and verify writes today.

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Plus, Trash2, RefreshCw, Pause, Play, Upload, Download, FileSpreadsheet, FileText, User } from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InstitutieSelect } from "@/components/InstitutieSelect";
import {
  monitoring,
  formatMonitoringTarget,
  MonitoringApiError,
  type MonitoringJob,
} from "@/lib/api";
import { parseSqliteUtc } from "@/lib/utils";

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

// Bulk-import row shape — supports both dosar_soap and name_soap kinds.
// Required column: `kind` (dosar | nume). Per-kind columns:
//   kind=dosar: numar_dosar required
//   kind=nume:  name_normalized required, name_kind required (fizic|juridic),
//               institutie optional
// Common: cadence_sec (optional, secunde — sugestii: 14400/28800/43200/86400), notes (optional).
type BulkKind = "dosar" | "nume";

interface BulkRowDosar {
  rowNumber: number;
  kind: "dosar";
  numar_dosar: string;
  cadence_sec?: number;
  notes?: string;
}

interface BulkRowName {
  rowNumber: number;
  kind: "nume";
  name_normalized: string;
  name_kind: "fizic" | "juridic";
  institutie?: string[];
  cadence_sec?: number;
  notes?: string;
}

type BulkRow = BulkRowDosar | BulkRowName;

interface BulkRowInvalid {
  rowNumber: number;
  display: string;
  message: string;
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

function downloadBulkTemplate() {
  const data: (string | number)[][] = [
    ["kind", "numar_dosar", "name_normalized", "name_kind", "institutie", "cadence_sec", "notes"],
    ["dosar", "1234/180/2024", "", "", "", 14400, "Client X — apel"],
    ["dosar", "9012/3/2024/a1", "", "", "", 86400, "Verificare zilnica"],
    ["nume", "", "POPESCU ION", "fizic", "", 86400, "Subiect — alerta dosare noi"],
    ["nume", "", "SC EXAMPLE SRL BUCURESTI", "juridic", "CurteadeApelBUCURESTI, TribunalulBucuresti", 86400, "Mai multe institutii separate prin virgula"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    { wch: 8 },
    { wch: 22 },
    { wch: 32 },
    { wch: 12 },
    { wch: 28 },
    { wch: 14 },
    { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Monitorizare");
  XLSX.writeFile(wb, "monitorizare-template.xlsx");
}

function parseBulkFile(
  buffer: ArrayBuffer,
  fileName: string,
): { valid: BulkRow[]; invalid: BulkRowInvalid[] } {
  const isCsv = /\.csv$/i.test(fileName);
  const wb = isCsv
    ? XLSX.read(new TextDecoder("utf-8").decode(new Uint8Array(buffer)), { type: "string" })
    : XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const valid: BulkRow[] = [];
  const invalid: BulkRowInvalid[] = [];
  if (!sheet) return { valid, invalid };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  rows.forEach((r, idx) => {
    const rowNumber = idx + 2;
    const cadenceRaw = r.cadence_sec;
    const cadence_sec = typeof cadenceRaw === "number"
      ? cadenceRaw
      : cadenceRaw && String(cadenceRaw).trim()
        ? Number(String(cadenceRaw).trim())
        : undefined;
    const cadenceFinal = Number.isFinite(cadence_sec) ? cadence_sec : undefined;
    const notes = String(r.notes ?? "").trim() || undefined;

    // Backward compat: if `kind` column is missing, treat as dosar (matches v1 template).
    const kindRaw = String(r.kind ?? "").trim().toLowerCase();
    const numarDosar = String(r.numar_dosar ?? "").trim();
    const nameNorm = String(r.name_normalized ?? "").trim();

    let kind: BulkKind;
    if (kindRaw === "dosar" || kindRaw === "nume") {
      kind = kindRaw;
    } else if (kindRaw === "" && numarDosar) {
      kind = "dosar";
    } else if (kindRaw === "" && nameNorm) {
      kind = "nume";
    } else if (kindRaw === "" && !numarDosar && !nameNorm) {
      return; // empty row — skip silently
    } else {
      invalid.push({
        rowNumber,
        display: numarDosar || nameNorm || "(gol)",
        message: `kind invalid: '${kindRaw}' (asteptat: dosar / nume)`,
      });
      return;
    }

    if (kind === "dosar") {
      if (!numarDosar) {
        invalid.push({ rowNumber, display: "(gol)", message: "numar_dosar lipseste" });
        return;
      }
      valid.push({
        rowNumber,
        kind: "dosar",
        numar_dosar: numarDosar,
        cadence_sec: cadenceFinal,
        notes,
      });
    } else {
      if (!nameNorm) {
        invalid.push({ rowNumber, display: "(gol)", message: "name_normalized lipseste" });
        return;
      }
      const nameKindRaw = String(r.name_kind ?? "").trim().toLowerCase();
      if (nameKindRaw !== "fizic" && nameKindRaw !== "juridic") {
        invalid.push({
          rowNumber,
          display: nameNorm,
          message: `name_kind invalid: '${nameKindRaw}' (asteptat: fizic / juridic)`,
        });
        return;
      }
      // Bulk-template institutie cell: comma-separated codes (e.g.
      // "CurteadeApelBUCURESTI, TribunalulBucuresti"). Empty cell = all institutii.
      const institutieRaw = String(r.institutie ?? "").trim();
      const institutie = institutieRaw
        ? institutieRaw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : undefined;
      valid.push({
        rowNumber,
        kind: "nume",
        name_normalized: nameNorm,
        name_kind: nameKindRaw as "fizic" | "juridic",
        institutie: institutie && institutie.length > 0 ? institutie : undefined,
        cadence_sec: cadenceFinal,
        notes,
      });
    }
  });
  return { valid, invalid };
}

export default function Monitorizare() {
  const confirm = useConfirm();
  const [jobs, setJobs] = useState<MonitoringJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-job form — supports both dosar and nume kinds via toggle.
  const [formKind, setFormKind] = useState<"dosar" | "nume">("dosar");
  const [numarDosar, setNumarDosar] = useState("");
  const [nameValue, setNameValue] = useState("");
  const [nameKind, setNameKind] = useState<"fizic" | "juridic">("fizic");
  const [institutie, setInstitutie] = useState<string[]>([]);
  const [cadenceSec, setCadenceSec] = useState(DEFAULT_CADENCE_SEC);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

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

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setSubmitting(true);
    try {
      let job: MonitoringJob;
      if (formKind === "dosar") {
        const trimmed = numarDosar.trim();
        if (!NUMAR_DOSAR_RE.test(trimmed)) {
          setFormError("Format invalid (asteptat: 1234/180/2024)");
          setSubmitting(false);
          return;
        }
        job = await monitoring.createDosar({
          numar_dosar: trimmed,
          cadence_sec: cadenceSec,
          notes: notes.trim() || undefined,
        });
        setNumarDosar("");
      } else {
        const trimmedName = nameValue.trim();
        if (trimmedName.length < 2) {
          setFormError("Numele trebuie sa aiba minim 2 caractere");
          setSubmitting(false);
          return;
        }
        job = await monitoring.createName({
          name_normalized: trimmedName,
          name_kind: nameKind,
          institutie: institutie.length > 0 ? institutie : undefined,
          cadence_sec: cadenceSec,
          notes: notes.trim() || undefined,
        });
        setNameValue("");
        setInstitutie([]);
      }
      setFormSuccess(`Adaugat: ${formatMonitoringTarget(job)} (id ${job.id})`);
      setNotes("");
      await refresh();
    } catch (err) {
      if (err instanceof MonitoringApiError) {
        setFormError(`${err.message} (${err.code})`);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError("Eroare necunoscuta.");
      }
    } finally {
      setSubmitting(false);
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
                name_kind: row.name_kind,
                institutie: row.institutie,
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Adauga in monitorizare
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="flex gap-1 border-b border-border">
              <button
                type="button"
                onClick={() => { setFormKind("dosar"); setFormError(null); setFormSuccess(null); }}
                className={`flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                  formKind === "dosar"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                disabled={submitting}
              >
                <FileText className="h-4 w-4" />
                Nr. Dosar
              </button>
              <button
                type="button"
                onClick={() => { setFormKind("nume"); setFormError(null); setFormSuccess(null); }}
                className={`flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                  formKind === "nume"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                disabled={submitting}
              >
                <User className="h-4 w-4" />
                Nume
              </button>
            </div>

            {formKind === "dosar" ? (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr,140px] gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block">Numar dosar</label>
                  <Input
                    type="text"
                    placeholder="1234/180/2024"
                    value={numarDosar}
                    onChange={(e) => setNumarDosar(e.target.value)}
                    disabled={submitting}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Cadenta</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    value={cadenceSec}
                    onChange={(e) => setCadenceSec(Number(e.target.value))}
                    disabled={submitting}
                  >
                    {CADENCE_OPTIONS.map((opt) => (
                      <option key={opt.sec} value={opt.sec}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr,140px,140px] gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Nume subiect</label>
                    <Input
                      type="text"
                      placeholder="ex: POPESCU ION sau SC EXAMPLE SRL"
                      value={nameValue}
                      onChange={(e) => setNameValue(e.target.value)}
                      disabled={submitting}
                      required
                      minLength={2}
                      maxLength={200}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Tip</label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={nameKind}
                      onChange={(e) => setNameKind(e.target.value as "fizic" | "juridic")}
                      disabled={submitting}
                      title="PF = Persoana fizica, PJ = Persoana juridica"
                    >
                      <option value="fizic">PF</option>
                      <option value="juridic">PJ</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Cadenta</label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={cadenceSec}
                      onChange={(e) => setCadenceSec(Number(e.target.value))}
                      disabled={submitting}
                    >
                      {CADENCE_OPTIONS.map((opt) => (
                        <option key={opt.sec} value={opt.sec}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Institutii (optional)</label>
                  <InstitutieSelect value={institutie} onChange={setInstitutie} />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Lasa gol pentru cautare in toate institutiile.
                  </p>
                </div>
              </>
            )}

            <div>
              <label className="text-xs font-medium mb-1 block">Note (optional)</label>
              <Input
                type="text"
                placeholder="ex: Client X — apel"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={submitting}
                maxLength={2000}
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={submitting || (formKind === "dosar" ? !numarDosar.trim() : !nameValue.trim())}
              >
                {submitting ? "Se adauga..." : "Adauga"}
              </Button>
              {formError && <span className="text-sm text-red-600">{formError}</span>}
              {formSuccess && <span className="text-sm text-green-600">{formSuccess}</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Adaugare bulk din fisier
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Descarca template-ul, completeaza coloana <code className="px-1 rounded bg-muted">kind</code>{" "}
            (<code className="px-1 rounded bg-muted">dosar</code> sau{" "}
            <code className="px-1 rounded bg-muted">nume</code>) plus campurile relevante
            (<code className="px-1 rounded bg-muted">numar_dosar</code> pentru dosar,{" "}
            <code className="px-1 rounded bg-muted">name_normalized</code> +{" "}
            <code className="px-1 rounded bg-muted">name_kind</code> pentru subiecti), apoi incarca-l inapoi.
            Pentru subiecti, coloana <code className="px-1 rounded bg-muted">institutie</code> accepta mai multe
            coduri separate prin virgula (ex: <code className="px-1 rounded bg-muted">CurteadeApelBUCURESTI, TribunalulBucuresti</code>).
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

      <p className="text-xs text-muted-foreground">
        Scheduler-ul automat soseste in PR-4. In acest moment poti adauga / sterge / pune in pauza
        joburi; verificarile se vor relua automat odata cu urmatorul release.
      </p>
    </div>
  );
}
