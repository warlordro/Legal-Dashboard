// Dosare PDF + XLSX exports. Extracted from lib/export.ts (F11-F3) so the
// jsPDF rendering layout for the dosare report lives next to its consumers
// in Dosare.tsx / DosareTable.tsx, and so export.ts is removed in favor of
// per-domain modules.
//
// The builder (`buildDosarePdf`) runs in export.worker.ts on demand. The
// orchestrator (`exportDosarePDF`) wraps it via `runExportInWorker` and
// triggers the download from the main thread. XLSX export is delegated to
// the backend (`api.dosare.exportXlsxBlob`).

import type { Dosar } from "@/types";
import { getDosarExternalUrl } from "@/components/dosare-table-helpers";
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

function dosareFilename(dosare: Dosar[], ext: "xlsx" | "pdf"): string {
  if (dosare.length === 1) return `dosar_${sanitizeNr(dosare[0].numar)}.${ext}`;
  return `dosare_${todayRo()}.${ext}`;
}

function formatInstitutie(raw: string): string {
  if (!raw) return "-";
  return normalizeInstitutie(raw);
}

function formatPartiPDF(parti: Dosar["parti"]): string {
  if (parti.length === 0) return "-";
  // Guard empty calitateParte (ICCJ list rows before enrichment) so we don't render ": NUME".
  return parti
    .map((p) => [stripDiacritics(p.calitateParte), stripDiacritics(p.nume)].filter(Boolean).join(": "))
    .join("\n");
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
    // Source-aware: ICCJ dosare link to scj.ro, PortalJust to portal.just.ro.
    if (d.numar) dosarLinks.set(i, getDosarExternalUrl(d));
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

export async function exportDosareExcel(dosare: Dosar[]): Promise<void> {
  const { blob, filename } = await api.dosare.exportXlsxBlob(dosare);
  triggerBlobDownload(blob, filename);
}

export async function exportDosarePDF(dosare: Dosar[]): Promise<void> {
  const result = await runExportInWorker({ kind: "dosarePdf", data: dosare });
  triggerDownload(result.buffer, result.filename, result.mime);
}
