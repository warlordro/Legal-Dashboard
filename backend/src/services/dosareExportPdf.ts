import PDFDocument from "pdfkit";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Dosar } from "../soap.ts";
import { todayRo } from "../util/xlsxHelpers.ts";
import { finishWriteStream } from "../util/pdfStream.ts";
import { formatRoDate } from "../util/dateFormat.ts";

export interface DosarePdfResult {
  filepath: string;
  filename: string;
  mime: string;
  byteLength: number;
}

const MIME_PDF = "application/pdf";
const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN_LEFT = 28;
const MARGIN_RIGHT = 28;
const MARGIN_TOP = 28;
const MARGIN_BOTTOM = 34;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const BLUE_MAIN = "#2563EB";
const ROW_ALT = "#EFF6FF";
const TEXT_DARK = "#111827";
const FONT_SIZE = 7;
const LINE_HEIGHT = FONT_SIZE + 2;
const CELL_PAD_X = 3;
const CELL_PAD_Y = 4;
const MAX_PARTI_PDF = 8;

function stripDiacritics(value: string): string {
  return (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function text(value: unknown): string {
  if (value == null) return "";
  return stripDiacritics(String(value));
}

function sanitizeNr(nr: string): string {
  return (nr || "").replace(/[/\\:*?"<>|]/g, "-").trim() || "dosar";
}

function getPortalJustUrl(numar: string): string {
  const parent = numar.replace(/\/a\d*$/i, "");
  return `https://portal.just.ro/SitePages/cautare.aspx?k=${encodeURIComponent(parent)}`;
}

function formatParti(parti: Dosar["parti"]): string {
  if (parti.length === 0) return "-";
  const shown = parti.slice(0, MAX_PARTI_PDF);
  const lines = shown.map((parte) => `${stripDiacritics(parte.calitateParte)}: ${stripDiacritics(parte.nume)}`);
  const remaining = parti.length - shown.length;
  if (remaining > 0) lines.push(`(+${remaining} parti — vezi XLSX)`);
  return lines.join("\n");
}

function formatSedinte(sedinte: Dosar["sedinte"]): string {
  if (sedinte.length === 0) return "-";
  return sedinte
    .map((sedinta) => {
      const parts = [formatRoDate(sedinta.data)];
      if (sedinta.ora) parts.push(sedinta.ora);
      if (sedinta.solutie) parts.push("- " + stripDiacritics(sedinta.solutie));
      if (sedinta.solutieSumar) parts.push("(" + stripDiacritics(sedinta.solutieSumar) + ")");
      return parts.join(" ");
    })
    .join("\n");
}

function wrapText(value: string, width: number): string[] {
  const maxChars = Math.max(5, Math.floor((width - CELL_PAD_X * 2) / (FONT_SIZE * 0.48)));
  const sourceLines = text(value || "-").split(/\r?\n/);
  const out: string[] = [];
  for (const source of sourceLines) {
    const words = source.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (word.length > maxChars) {
        if (line) {
          out.push(line);
          line = "";
        }
        for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
        continue;
      }
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out.length > 0 ? out : ["-"];
}

function drawFooter(doc: PDFKit.PDFDocument, pageNumber: number) {
  doc
    .fillColor(TEXT_DARK)
    .font("Helvetica")
    .fontSize(7)
    .text(`Pagina ${pageNumber}`, 0, PAGE_HEIGHT - 18, { width: PAGE_WIDTH, align: "center" });
}

function addPage(doc: PDFKit.PDFDocument, pageNumber: number): number {
  drawFooter(doc, pageNumber);
  doc.addPage();
  return pageNumber + 1;
}

function drawHeader(doc: PDFKit.PDFDocument, headers: string[], widths: number[], y: number): number {
  doc.rect(MARGIN_LEFT, y, CONTENT_WIDTH, 18).fill(BLUE_MAIN);
  let x = MARGIN_LEFT;
  headers.forEach((header, index) => {
    doc
      .fillColor("#FFFFFF")
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(text(header), x + CELL_PAD_X, y + 5, { width: widths[index] - CELL_PAD_X * 2 });
    x += widths[index];
  });
  return y + 18;
}

function drawTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  widths: number[],
  linkColumn: number,
  linkForRow: (rowIndex: number) => string | null,
  y: number,
  pageNumber: number
): number {
  y = drawHeader(doc, headers, widths, y);
  rows.forEach((row, rowIndex) => {
    const wrapped = row.map((cell, col) => wrapText(cell, widths[col]));
    while (wrapped.some((lines) => lines.length > 0)) {
      const availableLines = Math.max(1, Math.floor((PAGE_HEIGHT - MARGIN_BOTTOM - y - CELL_PAD_Y * 2) / LINE_HEIGHT));
      if (availableLines < 2) {
        pageNumber = addPage(doc, pageNumber);
        y = drawHeader(doc, headers, widths, MARGIN_TOP);
        continue;
      }
      const chunkLines = Math.min(
        availableLines,
        Math.max(...wrapped.map((lines) => Math.min(lines.length || 1, availableLines)))
      );
      const rowHeight = Math.max(18, chunkLines * LINE_HEIGHT + CELL_PAD_Y * 2);
      if (rowIndex % 2 === 1) doc.rect(MARGIN_LEFT, y, CONTENT_WIDTH, rowHeight).fill(ROW_ALT);

      let x = MARGIN_LEFT;
      wrapped.forEach((lines, col) => {
        const chunk = lines.splice(0, chunkLines).join("\n") || "";
        const link = col === linkColumn ? linkForRow(rowIndex) : null;
        const isLink = link != null;
        doc
          .fillColor(isLink ? "#1D4ED8" : TEXT_DARK)
          .font(isLink ? "Helvetica-Bold" : "Helvetica")
          .fontSize(FONT_SIZE)
          .text(chunk, x + CELL_PAD_X, y + CELL_PAD_Y, { width: widths[col] - CELL_PAD_X * 2 });
        if (link) doc.link(x, y, widths[col], rowHeight, link);
        x += widths[col];
      });
      doc
        .moveTo(MARGIN_LEFT, y + rowHeight)
        .lineTo(MARGIN_LEFT + CONTENT_WIDTH, y + rowHeight)
        .strokeColor("#E5E7EB")
        .stroke();
      y += rowHeight;
    }
  });
  drawFooter(doc, pageNumber);
  return pageNumber;
}

export async function buildDosarePdf(dosare: Dosar[]): Promise<DosarePdfResult> {
  const tmpPath = join(tmpdir(), `dosare-pdf-${randomUUID()}.pdf`);
  const stream = createWriteStream(tmpPath);
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, autoFirstPage: true });
  doc.pipe(stream);

  doc.fillColor(TEXT_DARK).font("Helvetica-Bold").fontSize(16).text("Legal Dashboard - Dosare", 40, 45);
  doc.font("Helvetica").fontSize(9);
  const totalSedinte = dosare.reduce((sum, dosar) => sum + dosar.sedinte.length, 0);
  doc.text(`Generat: ${todayRo()}  |  Total: ${dosare.length} dosare, ${totalSedinte} sedinte`, 40, 64);

  const headers = ["#", "Numar Dosar", "Data", "Institutie", "Categorie / Stadiu", "Obiect", "Parti", "Sedinte"];
  const widths = [20, 65, 45, 80, 70, 90, 140, CONTENT_WIDTH - 20 - 65 - 45 - 80 - 70 - 90 - 140];
  const links = new Map<number, string>();
  const rows = dosare.map((dosar, index) => {
    if (dosar.numar) links.set(index, getPortalJustUrl(dosar.numar));
    return [
      String(index + 1),
      dosar.numar || "-",
      formatRoDate(dosar.data),
      dosar.institutie || "-",
      [dosar.categorieCaz, dosar.stadiuProcesual].filter(Boolean).join(" / ") || "-",
      dosar.obiect || "-",
      formatParti(dosar.parti),
      formatSedinte(dosar.sedinte),
    ];
  });

  drawTable(doc, headers, rows, widths, 1, (rowIndex) => links.get(rowIndex) ?? null, 82, 1);
  doc.end();
  await finishWriteStream(stream, tmpPath);

  const stat = await fs.stat(tmpPath);
  const filename = dosare.length === 1 ? `dosar_${sanitizeNr(dosare[0].numar)}.pdf` : `dosare_${todayRo()}.pdf`;
  return { filepath: tmpPath, filename, mime: MIME_PDF, byteLength: stat.size };
}
