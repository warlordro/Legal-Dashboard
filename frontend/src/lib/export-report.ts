// PR-C v2.9.0 — "Export raport" builders for the dashboard.
//
// Builds an XLSX workbook (3 sheets: Sumar, Activitate zilnica, Cronologie) and
// a landscape PDF (Sumar table + daily rollup table + timeline table) from a
// single DashboardReportPayload. The payload is fetched once via
// dashboardApi.report() — backend wraps it in withMaintenanceRead so summary,
// charts, and timeline are a consistent snapshot.
//
// Both builders run inside the export Web Worker (see export.worker.ts) so the
// main thread stays responsive even on 30d ranges with hundreds of timeline
// events.

import type { DashboardReportPayload, TimelineEvent } from "./dashboardApi";
import { triggerDownload } from "./download-helpers";
import {
  BLUE_DARK,
  BLUE_MAIN,
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
import { runExportInWorker } from "./exportRunner";
import { MIME_PDF, stripDiacritics, type ExportResult } from "./pdf-helpers";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function toTransferableBuffer(out: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (out instanceof ArrayBuffer) return out;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function rangeLabel(range: "7d" | "30d"): string {
  return range === "7d" ? "ultimele 7 zile" : "ultimele 30 zile";
}

function reportFilename(range: "7d" | "30d", ext: "xlsx" | "pdf"): string {
  return `raport_dashboard_${range}_${todayRo()}.${ext}`;
}

function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatTs(iso: string): string {
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

function severityLabel(s: TimelineEvent["severity"]): string {
  if (s === "critical") return "Critic";
  if (s === "warning") return "Avertisment";
  return "Info";
}

function kindLabel(k: TimelineEvent["kind"]): string {
  if (k === "alert") return "Alerta";
  if (k === "run") return "Run";
  return "Audit";
}

// ─── XLSX builder ──────────────────────────────────────────────────────────

export async function buildReportXlsx(report: DashboardReportPayload): Promise<ExportResult> {
  const XLSX = await import("xlsx-js-style");
  const dateStr = new Date().toLocaleDateString("ro-RO");
  const rangeStr = rangeLabel(report.range);

  // ── Sheet 1: Sumar (KPI strip + headline metrics) ────────────────────────
  const SUM_COLS = 3;
  const sumAoA: (string | number | null)[][] = [
    ["PORTALJUST DASHBOARD — RAPORT", null, null],
    [`Generat: ${dateStr}  |  Interval: ${rangeStr}`, null, null],
    Array(SUM_COLS).fill(null),
    ["Sectiune", "Indicator", "Valoare"],
    ["Joburi", "Active total", report.summary.jobs.active],
    ["Joburi", "Dosare (dosar_soap)", report.summary.jobs.byKind.dosar_soap],
    ["Joburi", "Subiecti (name_soap)", report.summary.jobs.byKind.name_soap],
    ["Alerte", "Necitite", report.summary.alerts.unseen],
    ["Alerte", "In ultimele 24h", report.summary.alerts.last24h],
    ["Runs 24h", "Total", report.summary.runs.total],
    ["Runs 24h", "OK", report.summary.runs.ok],
    ["Runs 24h", "Eroare", report.summary.runs.error],
    ["Runs 24h", "Timeout", report.summary.runs.timeout],
    ["Runs 24h", "Oprite (aborted)", report.summary.runs.aborted],
    ["AI 24h", "Cost USD", formatUsd(report.summary.ai.costUsd)],
    ["AI 24h", "Apeluri", report.summary.ai.calls],
    ["AI 24h", "Tokens (in+out)", report.summary.ai.tokens],
  ];

  const wsSumar = XLSX.utils.aoa_to_sheet(sumAoA) as Record<string, unknown>;
  wsSumar["!cols"] = [{ wch: 22 }, { wch: 32 }, { wch: 16 }];
  wsSumar["!rows"] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 6 }, { hpt: 18 }];
  mergeRow(wsSumar, 0, SUM_COLS);
  mergeRow(wsSumar, 1, SUM_COLS);
  styleRow(wsSumar, 0, SUM_COLS, styleTitle);
  styleRow(wsSumar, 1, SUM_COLS, styleStats);
  styleRow(wsSumar, 3, SUM_COLS, styleHeader);
  for (let i = 4; i < sumAoA.length; i++) {
    const isAlt = (i - 4) % 2 === 1;
    for (let c = 0; c < SUM_COLS; c++) {
      styleCell(wsSumar, i, c, styleDataCell(i - 4, c === 1));
    }
    void isAlt;
  }

  // ── Sheet 2: Activitate zilnica (charts daily series flattened) ──────────
  const DAY_COLS = 9;
  const DAY_HEADERS = [
    "Zi",
    "Alerte",
    "Runs OK",
    "Runs Eroare",
    "Runs Timeout",
    "Runs Oprite",
    "Cost AI USD",
    "Apeluri AI",
    "Tokens AI",
  ];
  const DAY_WIDTHS = [12, 10, 10, 12, 12, 12, 14, 12, 14];

  // Charts series share the same UTC-day grid (backend builds them aligned).
  // Index into all three by day to assemble one row per day.
  const alertsByDay = new Map(report.charts.series.alerts.map((p) => [p.day, p.count]));
  const aiByDay = new Map(report.charts.series.aiCost.map((p) => [p.day, p]));
  const dayAoA: (string | number | null)[][] = [
    [`PORTALJUST DASHBOARD — ACTIVITATE ${rangeStr.toUpperCase()}`, ...Array(DAY_COLS - 1).fill(null)],
    [`Generat: ${dateStr}  |  ${report.charts.series.runs.length} zile`, ...Array(DAY_COLS - 1).fill(null)],
    Array(DAY_COLS).fill(null),
    DAY_HEADERS,
  ];
  for (const runRow of report.charts.series.runs) {
    const ai = aiByDay.get(runRow.day);
    dayAoA.push([
      runRow.day,
      alertsByDay.get(runRow.day) ?? 0,
      runRow.ok,
      runRow.error,
      runRow.timeout,
      runRow.aborted,
      ai ? formatUsd(ai.costUsd) : "$0.00",
      ai?.calls ?? 0,
      ai?.tokens ?? 0,
    ]);
  }

  const wsZilnic = XLSX.utils.aoa_to_sheet(dayAoA) as Record<string, unknown>;
  wsZilnic["!cols"] = DAY_WIDTHS.map((w) => ({ wch: w }));
  wsZilnic["!rows"] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 6 }, { hpt: 18 }];
  mergeRow(wsZilnic, 0, DAY_COLS);
  mergeRow(wsZilnic, 1, DAY_COLS);
  styleRow(wsZilnic, 0, DAY_COLS, styleTitle);
  styleRow(wsZilnic, 1, DAY_COLS, styleStats);
  styleRow(wsZilnic, 3, DAY_COLS, styleHeader);
  for (let i = 0; i < report.charts.series.runs.length; i++) {
    const r = 4 + i;
    for (let c = 0; c < DAY_COLS; c++) {
      styleCell(wsZilnic, r, c, styleDataCell(i, c === 0));
    }
  }

  // ── Sheet 3: Cronologie (timeline events) ────────────────────────────────
  const TL_COLS = 5;
  const TL_HEADERS = ["Data / Ora", "Tip", "Severitate", "Titlu", "Detalii"];
  const TL_WIDTHS = [18, 12, 14, 50, 50];

  const tlAoA: (string | number | null)[][] = [
    ["PORTALJUST DASHBOARD — CRONOLOGIE", ...Array(TL_COLS - 1).fill(null)],
    [
      `Generat: ${dateStr}  |  ${report.timeline.events.length} evenimente${report.timeline.truncated ? " (truncat)" : ""}`,
      ...Array(TL_COLS - 1).fill(null),
    ],
    Array(TL_COLS).fill(null),
    TL_HEADERS,
  ];
  for (const ev of report.timeline.events) {
    const detailKeys = Object.keys(ev.detail);
    const detailStr =
      detailKeys.length === 0
        ? "-"
        : detailKeys
            .map((k) => `${k}: ${formatDetailValue(ev.detail[k])}`)
            .filter((s) => s.length > 0)
            .join(" | ");
    tlAoA.push([
      formatTs(ev.ts),
      kindLabel(ev.kind),
      severityLabel(ev.severity),
      ev.title || "-",
      detailStr.length > 800 ? `${detailStr.slice(0, 800)}…` : detailStr,
    ]);
  }

  const wsTimeline = XLSX.utils.aoa_to_sheet(tlAoA) as Record<string, unknown>;
  wsTimeline["!cols"] = TL_WIDTHS.map((w) => ({ wch: w }));
  wsTimeline["!rows"] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 6 }, { hpt: 18 }];
  mergeRow(wsTimeline, 0, TL_COLS);
  mergeRow(wsTimeline, 1, TL_COLS);
  styleRow(wsTimeline, 0, TL_COLS, styleTitle);
  styleRow(wsTimeline, 1, TL_COLS, styleStats);
  styleRow(wsTimeline, 3, TL_COLS, styleHeader);
  for (let i = 0; i < report.timeline.events.length; i++) {
    const r = 4 + i;
    for (let c = 0; c < TL_COLS; c++) {
      styleCell(wsTimeline, r, c, styleDataCell(i, c === 3));
    }
  }

  // Sanitize all sheets (formula-injection guard) before writing.
  sanitizeFormulaCells(wsSumar);
  sanitizeFormulaCells(wsZilnic);
  sanitizeFormulaCells(wsTimeline);
  void cellAddr;
  void ensureCell;
  void BLUE_DARK;
  void BLUE_MAIN;
  void ROW_ALT;
  void WHITE;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSumar, "Sumar");
  XLSX.utils.book_append_sheet(wb, wsZilnic, "Activitate zilnica");
  XLSX.utils.book_append_sheet(wb, wsTimeline, "Cronologie");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer | Uint8Array;
  return {
    buffer: toTransferableBuffer(out),
    filename: reportFilename(report.range, "xlsx"),
    mime: MIME_XLSX,
  };
}

function formatDetailValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const json = JSON.stringify(v);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return String(v);
  }
}

// ─── PDF builder ───────────────────────────────────────────────────────────

export async function buildReportPdf(report: DashboardReportPayload): Promise<ExportResult> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const dateStr = new Date().toLocaleDateString("ro-RO");
  const rangeStr = rangeLabel(report.range);

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Legal Dashboard - Raport", 14, 16);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(
    stripDiacritics(
      `Generat: ${dateStr}  |  Interval: ${rangeStr}  |  ${report.timeline.events.length} evenimente${report.timeline.truncated ? " (truncat)" : ""}`
    ),
    14,
    22
  );

  // ── Sumar table ─────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: 28,
    head: [["Sectiune", "Indicator", "Valoare"]],
    body: [
      ["Joburi", "Active total", String(report.summary.jobs.active)],
      ["Joburi", "Dosare (dosar_soap)", String(report.summary.jobs.byKind.dosar_soap)],
      ["Joburi", "Subiecti (name_soap)", String(report.summary.jobs.byKind.name_soap)],
      ["Alerte", "Necitite", String(report.summary.alerts.unseen)],
      ["Alerte", "In ultimele 24h", String(report.summary.alerts.last24h)],
      ["Runs 24h", "Total", String(report.summary.runs.total)],
      ["Runs 24h", "OK", String(report.summary.runs.ok)],
      ["Runs 24h", "Eroare", String(report.summary.runs.error)],
      ["Runs 24h", "Timeout", String(report.summary.runs.timeout)],
      ["Runs 24h", "Oprite", String(report.summary.runs.aborted)],
      ["AI 24h", "Cost USD", formatUsd(report.summary.ai.costUsd)],
      ["AI 24h", "Apeluri", String(report.summary.ai.calls)],
      ["AI 24h", "Tokens", formatTokens(report.summary.ai.tokens)],
    ],
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      font: "helvetica",
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: 255,
      fontSize: 8.5,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 30, fontStyle: "bold" },
      1: { cellWidth: 60 },
      2: { cellWidth: 30, halign: "right" },
    },
    margin: { left: 14 },
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

  // ── Activitate zilnica ──────────────────────────────────────────────────
  const lastY1 = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 80;
  if (lastY1 > 160) doc.addPage();
  const startY2 = lastY1 > 160 ? 16 : lastY1 + 8;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(stripDiacritics(`Activitate zilnica (${rangeStr})`), 14, startY2);

  const alertsByDay = new Map(report.charts.series.alerts.map((p) => [p.day, p.count]));
  const aiByDay = new Map(report.charts.series.aiCost.map((p) => [p.day, p]));
  autoTable(doc, {
    startY: startY2 + 4,
    head: [["Zi", "Alerte", "OK", "Eroare", "Timeout", "Oprite", "Cost USD", "Apeluri AI", "Tokens AI"]],
    body: report.charts.series.runs.map((r) => {
      const ai = aiByDay.get(r.day);
      return [
        r.day,
        String(alertsByDay.get(r.day) ?? 0),
        String(r.ok),
        String(r.error),
        String(r.timeout),
        String(r.aborted),
        ai ? formatUsd(ai.costUsd) : "$0.00",
        String(ai?.calls ?? 0),
        formatTokens(ai?.tokens ?? 0),
      ];
    }),
    styles: {
      fontSize: 7.5,
      cellPadding: 1.5,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      font: "helvetica",
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: 255,
      fontSize: 8,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 22, fontStyle: "bold" },
      1: { cellWidth: 18, halign: "right" },
      2: { cellWidth: 18, halign: "right" },
      3: { cellWidth: 22, halign: "right" },
      4: { cellWidth: 22, halign: "right" },
      5: { cellWidth: 22, halign: "right" },
      6: { cellWidth: 24, halign: "right" },
      7: { cellWidth: 22, halign: "right" },
      8: { cellWidth: 22, halign: "right" },
    },
    margin: { left: 14, right: 14 },
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

  // ── Cronologie ───────────────────────────────────────────────────────────
  const lastY2 = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 100;
  doc.addPage();
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(stripDiacritics("Cronologie evenimente"), 14, 16);
  void lastY2;

  autoTable(doc, {
    startY: 22,
    head: [["Data / Ora", "Tip", "Severitate", "Titlu"]],
    body: report.timeline.events.map((ev) => [
      stripDiacritics(formatTs(ev.ts)),
      kindLabel(ev.kind),
      severityLabel(ev.severity),
      stripDiacritics(ev.title || "-"),
    ]),
    styles: {
      fontSize: 7.5,
      cellPadding: 1.5,
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
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 38 },
      1: { cellWidth: 22 },
      2: { cellWidth: 28 },
      3: { cellWidth: "auto" },
    },
    margin: { left: 14, right: 14 },
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

  if (report.timeline.truncated) {
    const lastY3 = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 200;
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text(
      stripDiacritics(
        `Nota: lista a fost truncata la ${report.timeline.limitPerSource} evenimente per sursa. Vezi cronologia live pentru continuare.`
      ),
      14,
      lastY3 + 6
    );
  }

  return {
    buffer: doc.output("arraybuffer") as ArrayBuffer,
    filename: reportFilename(report.range, "pdf"),
    mime: MIME_PDF,
  };
}

export async function exportReportXlsx(payload: DashboardReportPayload): Promise<void> {
  const result = await runExportInWorker({ kind: "reportXlsx", data: payload });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportReportPdf(payload: DashboardReportPayload): Promise<void> {
  const result = await runExportInWorker({ kind: "reportPdf", data: payload });
  triggerDownload(result.buffer, result.filename, result.mime);
}
