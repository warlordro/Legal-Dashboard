import type { Dosar, Termen } from "@/types";
import { formatDate } from "./utils";
import { getInstitutieLabel, normalizeInstitutie } from "./institutii";
import { formatMonitoringTarget, getNameSoapInstitutie, type MonitoringJob } from "./api";
import { api } from "./api";
import {
  cellAddr,
  ensureCell,
  mergeRow,
  ROW_ALT,
  sanitizeFormulaCells,
  styleCell,
  styleDataCell,
  styleHeader,
  styleRow,
  styleStats,
  styleTitle,
  todayRo,
  WHITE,
} from "./excel-helpers";
import { MIME_PDF, stripDiacritics, type ExportResult } from "./pdf-helpers";
import { getPortalJustUrl } from "@/components/dosare-table-helpers";
import type { AnalysisPdfArgs } from "./export-analysis";

// Re-export so existing consumers (export.worker.ts, callers of export.ts) keep
// working without churn after the Stage 7 split. The canonical homes are
// pdf-helpers.ts (ExportResult) and export-analysis.ts (AnalysisPdfArgs).
export type { ExportResult, AnalysisPdfArgs };

// ─── Worker helpers (orchestratori) ───────────────────────────────────────────
// Builderii (build*) sunt pure si pot rula in worker; orchestratorii (export*)
// fac round-trip prin worker si declanseaza download-ul din main thread.

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type ExportJob =
  | { kind: "dosarePdf"; data: Dosar[] }
  | { kind: "termenePdf"; data: Termen[] }
  | { kind: "monitoringXlsx"; data: MonitoringJob[] }
  | { kind: "monitoringPdf"; data: MonitoringJob[] }
  | { kind: "analysisPdf"; data: AnalysisPdfArgs }
  | { kind: "manualPdf"; data: null }
  | { kind: "reportXlsx"; data: import("./dashboardApi").DashboardReportPayload }
  | { kind: "reportPdf"; data: import("./dashboardApi").DashboardReportPayload };

function triggerDownload(buffer: ArrayBuffer, filename: string, mime: string): void {
  const blob = new Blob([buffer], { type: mime });
  triggerBlobDownload(blob, filename);
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

async function runExportInWorker(job: ExportJob): Promise<ExportResult> {
  const ExportWorker = (await import("./export.worker.ts?worker")).default;
  return new Promise<ExportResult>((resolve, reject) => {
    const worker = new ExportWorker();
    worker.onmessage = (
      e: MessageEvent<{ ok: true; buffer: ArrayBuffer; filename: string; mime: string } | { ok: false; error: string }>
    ) => {
      worker.terminate();
      if (!e.data.ok) {
        reject(new Error(e.data.error));
        return;
      }
      resolve({ buffer: e.data.buffer, filename: e.data.filename, mime: e.data.mime });
    };
    worker.onerror = (err: ErrorEvent) => {
      worker.terminate();
      reject(err.error ?? new Error(err.message || "Worker export error"));
    };
    worker.postMessage(job);
  });
}

// xlsx-js-style@1.2.0 returneaza ArrayBuffer pentru type:"array" (nu Uint8Array
// ca documenteaza SheetJS upstream); `Uint8Array.set(ArrayBuffer)` se evalueaza
// silentios la no-op (ArrayBuffer nu are .length) si rezulta un fisier plin de
// zerouri. Acceptam ambele forme si producem un ArrayBuffer transferabil.
function toTransferableBuffer(out: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (out instanceof ArrayBuffer) return out;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function formatInstitutie(raw: string): string {
  if (!raw) return "-";
  return normalizeInstitutie(raw);
}

// ─── Filename helpers ─────────────────────────────────────────────────────────

function sanitizeNr(nr: string): string {
  return (nr || "").replace(/[/\\:*?"<>|]/g, "-").trim() || "dosar";
}

function dosareFilename(dosare: Dosar[], ext: "xlsx" | "pdf"): string {
  if (dosare.length === 1) return `dosar_${sanitizeNr(dosare[0].numar)}.${ext}`;
  return `dosare_${todayRo()}.${ext}`;
}

function termeneFilename(termene: Termen[], ext: "xlsx" | "pdf"): string {
  if (termene.length === 1) return `termen_${sanitizeNr(termene[0].numarDosar)}.${ext}`;
  return `termene_${todayRo()}.${ext}`;
}

function formatPartiPDF(parti: Dosar["parti"]): string {
  if (parti.length === 0) return "-";
  return parti.map((p) => `${stripDiacritics(p.calitateParte)}: ${stripDiacritics(p.nume)}`).join("\n");
}

function formatSedintePDF(sedinte: Dosar["sedinte"]): string {
  if (sedinte.length === 0) return "-";
  return sedinte
    .map((s) => {
      const parts = [formatDate(s.data)];
      if (s.ora) parts.push(s.ora);
      if (s.solutie) parts.push("- " + stripDiacritics(s.solutie));
      if (s.solutieSumar) parts.push("(" + stripDiacritics(s.solutieSumar) + ")");
      return parts.join(" ");
    })
    .join("\n");
}

export async function buildDosarePdf(dosare: Dosar[]): Promise<ExportResult> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Legal Dashboard - Dosare", 14, 16);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const totalSedinte = dosare.reduce((sum, d) => sum + d.sedinte.length, 0);
  doc.text(
    `Generat: ${new Date().toLocaleDateString("ro-RO")}  |  Total: ${dosare.length} dosare, ${totalSedinte} sedinte`,
    14,
    22
  );

  // Side-band: row index → portal.just.ro URL pentru coloana "Numar Dosar"
  // (autotable nu are acces la valoarea originala in didDrawCell, doar la
  // textul rendat).
  const dosarLinks = new Map<number, string>();
  dosare.forEach((d, i) => {
    if (d.numar) dosarLinks.set(i, getPortalJustUrl(d.numar));
  });

  autoTable(doc, {
    startY: 28,
    head: [["#", "Numar Dosar", "Data", "Institutie", "Categorie / Stadiu", "Obiect", "Parti", "Sedinte"]],
    body: dosare.map((d, i) => [
      String(i + 1),
      d.numar || "-",
      formatDate(d.data),
      stripDiacritics(formatInstitutie(d.institutie)),
      stripDiacritics([d.categorieCaz, d.stadiuProcesual].filter(Boolean).join(" / ")),
      stripDiacritics(d.obiect || "-"),
      formatPartiPDF(d.parti),
      formatSedintePDF(d.sedinte),
    ]),
    styles: {
      fontSize: 7,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      overflow: "linebreak",
      font: "helvetica",
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: 255,
      fontSize: 7.5,
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: 24, fontStyle: "bold", textColor: [29, 78, 216] },
      2: { cellWidth: 16 },
      3: { cellWidth: 28 },
      4: { cellWidth: 24 },
      5: { cellWidth: 32 },
      6: { cellWidth: 50 },
      7: { cellWidth: "auto" },
    },
    margin: { left: 10, right: 10 },
    didDrawCell: (data: {
      section: string;
      column: { index: number };
      row: { index: number };
      cell: { x: number; y: number; width: number; height: number };
    }) => {
      if (data.section !== "body") return;
      if (data.column.index !== 1) return;
      const url = dosarLinks.get(data.row.index);
      if (!url) return;
      doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
    },
    didDrawPage: (data: { pageNumber: number }) => {
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Pagina ${data.pageNumber}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 7,
        { align: "center" }
      );
    },
  });
  return {
    buffer: doc.output("arraybuffer") as ArrayBuffer,
    filename: dosareFilename(dosare, "pdf"),
    mime: MIME_PDF,
  };
}

export async function buildTermenePdf(termene: Termen[]): Promise<ExportResult> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Legal Dashboard - Termene", 14, 16);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Generat: ${new Date().toLocaleDateString("ro-RO")}  |  Total: ${termene.length} termene`, 14, 22);

  const dosarLinks = new Map<number, string>();
  termene.forEach((t, i) => {
    if (t.numarDosar) dosarLinks.set(i, getPortalJustUrl(t.numarDosar));
  });

  autoTable(doc, {
    startY: 28,
    head: [["#", "Numar Dosar", "Data", "Ora", "Institutie", "Complet", "Solutie", "Sumar"]],
    body: termene.map((t, i) => [
      String(i + 1),
      t.numarDosar || "-",
      formatDate(t.data),
      t.ora || "-",
      stripDiacritics(formatInstitutie(t.institutie)),
      stripDiacritics(t.complet || "-"),
      stripDiacritics(t.solutie || "-"),
      stripDiacritics(t.solutieSumar || "-"),
    ]),
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      overflow: "linebreak",
      font: "helvetica",
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: 255,
      fontSize: 8,
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 28, fontStyle: "bold", textColor: [29, 78, 216] },
      2: { cellWidth: 18 },
      3: { cellWidth: 12 },
      4: { cellWidth: 32 },
      5: { cellWidth: 25 },
      6: { cellWidth: 30 },
      7: { cellWidth: "auto" },
    },
    margin: { left: 14, right: 14 },
    didDrawCell: (data: {
      section: string;
      column: { index: number };
      row: { index: number };
      cell: { x: number; y: number; width: number; height: number };
    }) => {
      if (data.section !== "body") return;
      if (data.column.index !== 1) return;
      const url = dosarLinks.get(data.row.index);
      if (!url) return;
      doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
    },
    didDrawPage: (data: { pageNumber: number }) => {
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Pagina ${data.pageNumber}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 7,
        { align: "center" }
      );
    },
  });
  return {
    buffer: doc.output("arraybuffer") as ArrayBuffer,
    filename: termeneFilename(termene, "pdf"),
    mime: MIME_PDF,
  };
}

// Same as formatMonitoringTarget but for name_soap appends the institutie scope
// so an exported report makes the watch perimeter unambiguous (the question the
// UI table already answers via a Building2 chip subline).
function monitoringTargetCell(job: MonitoringJob): string {
  const base = formatMonitoringTarget(job) || "-";
  if (job.kind !== "name_soap") return base;
  const scope = getNameSoapInstitutie(job) ?? [];
  if (scope.length === 0) return `${base} [Toate instantele]`;
  return `${base} [${scope.map(getInstitutieLabel).join(", ")}]`;
}

function monitoringFilename(jobs: MonitoringJob[], ext: "xlsx" | "pdf"): string {
  if (jobs.length === 1) return `monitorizare_${sanitizeNr(formatMonitoringTarget(jobs[0]))}.${ext}`;
  return `monitorizare_${todayRo()}.${ext}`;
}

function formatMonitoringDateTime(iso: string | null): string {
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

function formatMonitoringCadence(sec: number): string {
  if (sec >= 86400) return `${Math.round(sec / 86400)}z`;
  if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 60)}min`;
}

function monitoringKindLabel(kind: MonitoringJob["kind"]): string {
  if (kind === "dosar_soap") return "Dosar";
  if (kind === "name_soap") return "Nume";
  if (kind === "aviz_rnpm") return "Aviz RNPM";
  return kind;
}

function monitoringStatusLabel(job: MonitoringJob): string {
  const base = job.active ? "activ" : "pauza";
  if (!job.last_status) return base;
  return `${base} / ${job.last_status}`;
}

export async function buildMonitoringXlsx(jobs: MonitoringJob[]): Promise<ExportResult> {
  const XLSX = await import("xlsx-js-style");

  const dateStr = new Date().toLocaleDateString("ro-RO");
  const M_COLS = 8; // A–H
  const M_HEADERS = ["#", "Tinta", "Tip", "Cadenta", "Ultima rulare", "Urmatoarea verif.", "Status", "Note"];
  const M_WIDTHS = [5, 30, 12, 10, 18, 18, 16, 30];

  const monitorAoA: (string | number | null)[][] = [
    ["PORTALJUST DASHBOARD — MONITORIZARE", ...Array(M_COLS - 1).fill(null)],
    [`Generat: ${dateStr}  |  ${jobs.length} joburi`, ...Array(M_COLS - 1).fill(null)],
    Array(M_COLS).fill(null),
    M_HEADERS,
    ...jobs.map((j, i) => [
      i + 1,
      monitoringTargetCell(j),
      monitoringKindLabel(j.kind),
      formatMonitoringCadence(j.cadence_sec),
      formatMonitoringDateTime(j.last_run_at),
      formatMonitoringDateTime(j.next_run_at),
      monitoringStatusLabel(j),
      j.notes || "-",
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(monitorAoA) as Record<string, unknown>;
  ws["!cols"] = M_WIDTHS.map((w) => ({ wch: w }));
  ws["!rows"] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 6 }, { hpt: 18 }];

  mergeRow(ws, 0, M_COLS);
  mergeRow(ws, 1, M_COLS);
  styleRow(ws, 0, M_COLS, styleTitle);
  styleRow(ws, 1, M_COLS, styleStats);
  styleRow(ws, 3, M_COLS, styleHeader);

  jobs.forEach((_, i) => {
    const r = 4 + i;
    for (let c = 0; c < M_COLS; c++) {
      styleCell(ws, r, c, styleDataCell(i, c === 1));
    }
  });

  sanitizeFormulaCells(ws);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws as import("xlsx-js-style").WorkSheet, "Monitorizare");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer | Uint8Array;
  return { buffer: toTransferableBuffer(out), filename: monitoringFilename(jobs, "xlsx"), mime: MIME_XLSX };
}

export async function buildMonitoringPdf(jobs: MonitoringJob[]): Promise<ExportResult> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Legal Dashboard - Monitorizare", 14, 16);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Generat: ${new Date().toLocaleDateString("ro-RO")}  |  Total: ${jobs.length} joburi`, 14, 22);

  // Link pe coloana "Tinta" doar pentru dosar_soap (numar dosar) si name_soap
  // (nume → cautare PortalJust). aviz_rnpm cere alta sursa, deci fara link.
  const tintaLinks = new Map<number, string>();
  jobs.forEach((j, i) => {
    if (j.kind === "dosar_soap" || j.kind === "name_soap") {
      const target = formatMonitoringTarget(j);
      if (target && target !== j.target_json) tintaLinks.set(i, getPortalJustUrl(target));
    }
  });

  autoTable(doc, {
    startY: 28,
    head: [["#", "Tinta", "Tip", "Cadenta", "Ultima rulare", "Urmatoarea verif.", "Status", "Note"]],
    body: jobs.map((j, i) => [
      String(i + 1),
      stripDiacritics(monitoringTargetCell(j)),
      monitoringKindLabel(j.kind),
      formatMonitoringCadence(j.cadence_sec),
      formatMonitoringDateTime(j.last_run_at),
      formatMonitoringDateTime(j.next_run_at),
      monitoringStatusLabel(j),
      stripDiacritics(j.notes || "-"),
    ]),
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      overflow: "linebreak",
      font: "helvetica",
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: 255,
      fontSize: 8,
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 50, fontStyle: "bold", textColor: [29, 78, 216] },
      2: { cellWidth: 18 },
      3: { cellWidth: 16 },
      4: { cellWidth: 30 },
      5: { cellWidth: 30 },
      6: { cellWidth: 24 },
      7: { cellWidth: "auto" },
    },
    margin: { left: 10, right: 10 },
    didDrawCell: (data: {
      section: string;
      column: { index: number };
      row: { index: number };
      cell: { x: number; y: number; width: number; height: number };
    }) => {
      if (data.section !== "body") return;
      if (data.column.index !== 1) return;
      const url = tintaLinks.get(data.row.index);
      if (!url) return;
      doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, {
        url,
      });
    },
    didDrawPage: (data: { pageNumber: number }) => {
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Pagina ${data.pageNumber}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 7,
        { align: "center" }
      );
    },
  });
  return {
    buffer: doc.output("arraybuffer") as ArrayBuffer,
    filename: monitoringFilename(jobs, "pdf"),
    mime: MIME_PDF,
  };
}

// ─── Orchestratori (DOM-bound, ruleaza in main thread) ────────────────────────

export async function exportDosareExcel(dosare: Dosar[]): Promise<void> {
  const { blob, filename } = await api.dosare.exportXlsxBlob(dosare);
  triggerBlobDownload(blob, filename);
}

export async function exportTermeneExcel(termene: Termen[]): Promise<void> {
  const { blob, filename } = await api.termene.exportXlsxBlob(termene);
  triggerBlobDownload(blob, filename);
}

export async function exportDosarePDF(dosare: Dosar[]): Promise<void> {
  const result = await runExportInWorker({ kind: "dosarePdf", data: dosare });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportTermenePDF(termene: Termen[]): Promise<void> {
  const result = await runExportInWorker({ kind: "termenePdf", data: termene });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportMonitoringExcel(jobs: MonitoringJob[]): Promise<void> {
  const result = await runExportInWorker({ kind: "monitoringXlsx", data: jobs });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportMonitoringPDF(jobs: MonitoringJob[]): Promise<void> {
  const result = await runExportInWorker({ kind: "monitoringPdf", data: jobs });
  triggerDownload(result.buffer, result.filename, result.mime);
}

// ─── Orchestratori AI / Manual (route prin worker) ────────────────────────────

export async function exportAnalysisPDF(
  dosarNumar: string,
  dosarInstitutie: string,
  dosarObiect: string,
  analysisText: string,
  type: "simple" | "advanced" = "simple",
  judgeModel?: string
): Promise<void> {
  const result = await runExportInWorker({
    kind: "analysisPdf",
    data: { dosarNumar, dosarInstitutie, dosarObiect, analysisText, type, judgeModel },
  });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportManualPDF(): Promise<void> {
  const result = await runExportInWorker({ kind: "manualPdf", data: null });
  triggerDownload(result.buffer, result.filename, result.mime);
}

// ─── Orchestratori raport (PR-C v2.9.0) ──────────────────────────────────────

export async function exportReportXlsx(payload: import("./dashboardApi").DashboardReportPayload): Promise<void> {
  const result = await runExportInWorker({ kind: "reportXlsx", data: payload });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportReportPdf(payload: import("./dashboardApi").DashboardReportPayload): Promise<void> {
  const result = await runExportInWorker({ kind: "reportPdf", data: payload });
  triggerDownload(result.buffer, result.filename, result.mime);
}
