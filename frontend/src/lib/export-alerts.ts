// v2.13.0: export XLSX + PDF pentru pagina Alerte. Backend-ul (POST
// /api/v1/alerts/export) intoarce randuri deja decorate cu numarDosar +
// dosarLink (calculate via deriveAlertDigestRow). Aici nu re-implementam
// extractia din detail_json — doar randam.
//
// XLSX: hyperlink pe celula "Dosar" via xlsx-js-style `.l = { Target, Tooltip }`.
// PDF: link clickabil via jspdf-autotable hook `didDrawCell` care apeleaza
// `doc.link(x, y, w, h, { url })` doar pe coloana dosar.

import type { AlertExportRow } from "./alertsApi";
import {
  cellAddr,
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

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatDateTime(iso: string | null | undefined): string {
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

export type AlertExportFormat = "xlsx" | "pdf";

export interface BuildAlertsExportInput {
  rows: AlertExportRow[];
  // Eticheta scurta pentru titlu — "Selectie", "Filtre active", "Interval ...".
  // Optional; daca lipseste, doar data exportului apare.
  contextLabel?: string;
}

function alertsFilename(ext: AlertExportFormat, count: number): string {
  return `alerte_${count}_${todayRo().replace(/\./g, "-")}.${ext}`;
}

// ─── XLSX builder ──────────────────────────────────────────────────────────

const HEADERS = [
  "Data",
  "Severitate",
  "Tip eveniment",
  "Titlu",
  "Dosar",
  "Nume monitorizat",
  "Status",
];

export async function buildAlertsXlsx(
  input: BuildAlertsExportInput,
): Promise<ExportResult> {
  const XLSX = await import("xlsx-js-style");
  const { rows, contextLabel } = input;

  const dateStr = todayRo();
  const ws: Record<string, unknown> = {};
  ws["!ref"] = "A1";

  // Title row (merged across all columns)
  ws[cellAddr(0, 0)] = { t: "s", v: "Legal Dashboard - Alerte" };
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: HEADERS.length - 1 } }];
  styleRow(ws, 0, HEADERS.length, styleTitle);

  // Stats row
  const statsBits = [`Generat: ${dateStr}`, `Total: ${rows.length}`];
  if (contextLabel) statsBits.push(contextLabel);
  ws[cellAddr(1, 0)] = { t: "s", v: statsBits.join("  |  ") };
  (ws["!merges"] as unknown[]).push({ s: { r: 1, c: 0 }, e: { r: 1, c: HEADERS.length - 1 } });
  styleRow(ws, 1, HEADERS.length, styleStats);

  // Gap row
  styleRow(ws, 2, HEADERS.length, { fill: { patternType: "solid", fgColor: { rgb: WHITE } } });

  // Header row
  HEADERS.forEach((h, i) => {
    const addr = cellAddr(3, i);
    ws[addr] = { t: "s", v: h };
    styleCell(ws, 3, i, styleHeader);
  });

  // Data rows
  rows.forEach((row, idx) => {
    const r = 4 + idx;
    const dataStyle = styleDataCell(idx);
    const linkStyle = {
      ...dataStyle,
      font: { ...(dataStyle.font as Record<string, unknown>), color: { rgb: "1D4ED8" }, underline: true },
    } as Record<string, unknown>;

    const status = row.alert.dismissed_at
      ? "Dismissed"
      : row.alert.read_at
        ? "Citita"
        : "Necitita";

    const cells: Array<string | null> = [
      formatDateTime(row.alert.created_at),
      row.severityLabel,
      row.kindLabel,
      row.alert.title,
      row.numarDosar ?? "-",
      row.nameMonitored ?? "-",
      status,
    ];
    cells.forEach((value, c) => {
      const addr = cellAddr(r, c);
      ws[addr] = { t: "s", v: value ?? "-" };
      styleCell(ws, r, c, c === 4 && row.dosarLink ? linkStyle : dataStyle);
      if (c === 4 && row.dosarLink) {
        (ws[addr] as Record<string, unknown>).l = {
          Target: row.dosarLink,
          Tooltip: "Deschide pe portal.just.ro",
        };
      }
    });
  });

  ws["!ref"] = `A1:${cellAddr(Math.max(3, 3 + rows.length), HEADERS.length - 1)}`;
  ws["!cols"] = [
    { wch: 17 }, // Data
    { wch: 10 }, // Severitate
    { wch: 18 }, // Tip
    { wch: 50 }, // Titlu
    { wch: 28 }, // Dosar
    { wch: 28 }, // Nume
    { wch: 11 }, // Status
  ];

  sanitizeFormulaCells(ws);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws as import("xlsx").WorkSheet, "Alerte");

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer | Uint8Array;
  const buffer =
    out instanceof ArrayBuffer
      ? out
      : (out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer);

  return {
    buffer,
    filename: alertsFilename("xlsx", rows.length),
    mime: MIME_XLSX,
  };
}

// ─── PDF builder ───────────────────────────────────────────────────────────

const DOSAR_COLUMN_INDEX = 4;

export async function buildAlertsPdf(
  input: BuildAlertsExportInput,
): Promise<ExportResult> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const { rows, contextLabel } = input;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const dateStr = new Date().toLocaleDateString("ro-RO");

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Legal Dashboard - Alerte", 14, 16);

  const headerLine = stripDiacritics(
    `Generat: ${dateStr}  |  Total: ${rows.length}${contextLabel ? `  |  ${contextLabel}` : ""}`,
  );
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(headerLine, 14, 22);

  // Track which row has a dosar link so didDrawCell can click-decorate just
  // the dosar column. We can't read row.dosarLink inside the hook (autotable
  // gives us only the rendered string), so we keep a side-band index.
  const linkIndex = new Map<number, string>();
  rows.forEach((row, i) => {
    if (row.dosarLink) linkIndex.set(i, row.dosarLink);
  });

  autoTable(doc, {
    startY: 28,
    head: [
      [
        "Data",
        "Severitate",
        "Tip",
        "Titlu",
        "Dosar",
        "Nume monitorizat",
        "Status",
      ],
    ],
    body: rows.map((row) => {
      const status = row.alert.dismissed_at
        ? "Dismissed"
        : row.alert.read_at
          ? "Citita"
          : "Necitita";
      return [
        stripDiacritics(formatDateTime(row.alert.created_at)),
        stripDiacritics(row.severityLabel),
        stripDiacritics(row.kindLabel),
        stripDiacritics(row.alert.title),
        stripDiacritics(row.numarDosar ?? "-"),
        stripDiacritics(row.nameMonitored ?? "-"),
        stripDiacritics(status),
      ];
    }),
    styles: {
      fontSize: 7.5,
      cellPadding: 1.5,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      font: "helvetica",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: 255,
      fontSize: 8,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 18 },
      2: { cellWidth: 28 },
      3: { cellWidth: 75 },
      4: { cellWidth: 38, textColor: [29, 78, 216] },
      5: { cellWidth: 38 },
      6: { cellWidth: 18 },
    },
    margin: { left: 14, right: 14 },
    didDrawCell: (data: {
      section: string;
      column: { index: number };
      row: { index: number };
      cell: { x: number; y: number; width: number; height: number };
    }) => {
      if (data.section !== "body") return;
      if (data.column.index !== DOSAR_COLUMN_INDEX) return;
      const url = linkIndex.get(data.row.index);
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
        { align: "center" },
      );
    },
  });

  const arrayBuffer = doc.output("arraybuffer") as ArrayBuffer;
  return {
    buffer: arrayBuffer,
    filename: alertsFilename("pdf", rows.length),
    mime: MIME_PDF,
  };
}

// ─── Orchestrator + downloader ─────────────────────────────────────────────

export async function exportAlertsToFile(
  format: AlertExportFormat,
  input: BuildAlertsExportInput,
): Promise<void> {
  const result =
    format === "xlsx" ? await buildAlertsXlsx(input) : await buildAlertsPdf(input);
  const blob = new Blob([result.buffer], { type: result.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
