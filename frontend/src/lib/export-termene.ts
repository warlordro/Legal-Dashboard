// Termene PDF + XLSX exports. Extracted from lib/export.ts (F11-F3) so the
// jsPDF rendering layout for the termene report lives next to its consumers
// in Termene.tsx. XLSX export is delegated to the backend
// (`api.termene.exportXlsxBlob`).
//
// The builder (`buildTermenePdf`) runs in export.worker.ts on demand. The
// orchestrator (`exportTermenePDF`) wraps it via `runExportInWorker` and
// triggers the download from the main thread.

import type { Termen } from "@/types";
import { getPortalJustUrl } from "@/components/dosare-table-helpers";
import { api } from "./api";
import { triggerBlobDownload, triggerDownload } from "./download-helpers";
import { runExportInWorker } from "./exportRunner";
import { normalizeInstitutie } from "./institutii";
import { MIME_PDF, stripDiacritics, type ExportResult } from "./pdf-helpers";
import { todayRo } from "./excel-helpers";
import { formatDate } from "./utils";

function sanitizeNr(nr: string): string {
  return (nr || "").replace(/[/\\:*?"<>|]/g, "-").trim() || "dosar";
}

function termeneFilename(termene: Termen[], ext: "xlsx" | "pdf"): string {
  if (termene.length === 1) return `termen_${sanitizeNr(termene[0].numarDosar)}.${ext}`;
  return `termene_${todayRo()}.${ext}`;
}

function formatInstitutie(raw: string): string {
  if (!raw) return "-";
  return normalizeInstitutie(raw);
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

export async function exportTermeneExcel(termene: Termen[]): Promise<void> {
  const { blob, filename } = await api.termene.exportXlsxBlob(termene);
  triggerBlobDownload(blob, filename);
}

export async function exportTermenePDF(termene: Termen[]): Promise<void> {
  const result = await runExportInWorker({ kind: "termenePdf", data: termene });
  triggerDownload(result.buffer, result.filename, result.mime);
}
