import { getInstitutieLabel } from "./institutii";
import { formatMonitoringTarget, getNameSoapInstitutie, type MonitoringJob } from "./api";
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
import { triggerDownload } from "./download-helpers";
import { runExportInWorker } from "./exportRunner";

// ─── Worker helpers (orchestratori) ───────────────────────────────────────────
// Builderii (build*) sunt pure si pot rula in worker; orchestratorii (export*)
// fac round-trip prin worker si declanseaza download-ul din main thread.

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// xlsx-js-style@1.2.0 returneaza ArrayBuffer pentru type:"array" (nu Uint8Array
// ca documenteaza SheetJS upstream); `Uint8Array.set(ArrayBuffer)` se evalueaza
// silentios la no-op (ArrayBuffer nu are .length) si rezulta un fisier plin de
// zerouri. Acceptam ambele forme si producem un ArrayBuffer transferabil.
function toTransferableBuffer(out: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (out instanceof ArrayBuffer) return out;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

// ─── Filename helpers ─────────────────────────────────────────────────────────

function sanitizeNr(nr: string): string {
  return (nr || "").replace(/[/\\:*?"<>|]/g, "-").trim() || "dosar";
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
  if (kind === "iccj") return "ICCJ";
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

export async function exportMonitoringExcel(jobs: MonitoringJob[]): Promise<void> {
  const result = await runExportInWorker({ kind: "monitoringXlsx", data: jobs });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportMonitoringPDF(jobs: MonitoringJob[]): Promise<void> {
  const result = await runExportInWorker({ kind: "monitoringPdf", data: jobs });
  triggerDownload(result.buffer, result.filename, result.mime);
}
