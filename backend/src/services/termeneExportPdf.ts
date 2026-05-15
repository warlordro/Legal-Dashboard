import PDFDocument from "pdfkit";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TermenExportRow } from "./termeneExportXlsx.ts";
import { todayRo } from "../util/xlsxHelpers.ts";
import { finishWriteStream } from "../util/pdfStream.ts";
import { formatRoDate } from "../util/dateFormat.ts";

export interface TermenePdfResult {
  filepath: string;
  filename: string;
  mime: string;
  byteLength: number;
}

const MIME_PDF = "application/pdf";
const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 40;
const MARGIN_TOP = 28;
const MARGIN_BOTTOM = 34;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const BLUE_MAIN = "#2563EB";
const ROW_ALT = "#EFF6FF";
const TEXT_DARK = "#111827";
const FONT_SIZE = 7.5;
const LINE_HEIGHT = FONT_SIZE + 2;
const CELL_PAD_X = 3;
const CELL_PAD_Y = 4;

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

function wrapText(value: string, width: number): string[] {
  const maxChars = Math.max(5, Math.floor((width - CELL_PAD_X * 2) / (FONT_SIZE * 0.48)));
  const out: string[] = [];
  for (const source of text(value || "-").split(/\r?\n/)) {
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
    .text(`Pagina ${pageNumber}`, 0, PAGE_HEIGHT - 18, {
      width: PAGE_WIDTH,
      align: "center",
    });
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
      .fontSize(8)
      .text(text(header), x + CELL_PAD_X, y + 5, {
        width: widths[index] - CELL_PAD_X * 2,
      });
    x += widths[index];
  });
  return y + 18;
}

function drawTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  widths: number[],
  links: Map<number, string>,
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
        const link = col === 1 ? links.get(rowIndex) : undefined;
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

export async function buildTermenePdf(termene: TermenExportRow[]): Promise<TermenePdfResult> {
  const tmpPath = join(tmpdir(), `termene-pdf-${randomUUID()}.pdf`);
  const stream = createWriteStream(tmpPath);
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, autoFirstPage: true });
  doc.pipe(stream);

  doc.fillColor(TEXT_DARK).font("Helvetica-Bold").fontSize(16).text("Legal Dashboard - Termene", 40, 45);
  doc.font("Helvetica").fontSize(9).text(`Generat: ${todayRo()}  |  Total: ${termene.length} termene`, 40, 64);

  const headers = ["#", "Numar Dosar", "Data", "Ora", "Institutie", "Complet", "Solutie", "Sumar"];
  const widths = [22, 80, 50, 34, 90, 70, 85, CONTENT_WIDTH - 22 - 80 - 50 - 34 - 90 - 70 - 85];
  const links = new Map<number, string>();
  const rows = termene.map((termen, index) => {
    if (termen.numarDosar) links.set(index, getPortalJustUrl(termen.numarDosar));
    return [
      String(index + 1),
      termen.numarDosar || "-",
      formatRoDate(termen.data),
      termen.ora || "-",
      termen.institutie || "-",
      termen.complet || "-",
      termen.solutie || "-",
      termen.solutieSumar || "-",
    ];
  });

  drawTable(doc, headers, rows, widths, links, 82, 1);
  doc.end();
  await finishWriteStream(stream, tmpPath);

  const stat = await fs.stat(tmpPath);
  const filename =
    termene.length === 1 ? `termen_${sanitizeNr(termene[0].numarDosar)}.pdf` : `termene_${todayRo()}.pdf`;
  return { filepath: tmpPath, filename, mime: MIME_PDF, byteLength: stat.size };
}
