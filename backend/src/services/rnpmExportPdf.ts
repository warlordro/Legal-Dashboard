import PDFDocument from "pdfkit";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AvizFull, BunPartyRef, BunRecord, PartyRecord } from "../db/avizRepository.ts";
import { sanitizeFilename, todayRo } from "../util/xlsxHelpers.ts";

export interface RnpmPdfResult {
  filepath: string;
  filename: string;
  mime: string;
  byteLength: number;
}

const MIME_PDF = "application/pdf";
const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BLUE_MAIN = "#2563EB";
const ROW_ALT = "#EFF6FF";
const TEXT_DARK = "#111827";
const TEXT_MID = "#374151";
const FONT_SIZE_TABLE = 7;
const FONT_SIZE_BODY = 8;
const MAX_ROW_HEIGHT = 72;

function stripDiacritics(s: string): string {
  return (s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function text(v: unknown): string {
  if (v == null) return "";
  return stripDiacritics(String(v));
}

function estimateTextHeight(value: string, width: number, fontSize: number): number {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return fontSize + 3;
  const approxCharsPerLine = Math.max(8, Math.floor(width / (fontSize * 0.48)));
  const lines = normalized.split(/\s+/).reduce((count, word) => {
    return count + Math.max(1, Math.ceil((word.length + 1) / approxCharsPerLine));
  }, 0);
  return Math.max(fontSize + 3, lines * (fontSize + 2));
}

function formatActivLabel(activ: number | null): string {
  if (activ === 1) return "Activ";
  if (activ === 0) return "Stins";
  return "Necunoscut";
}

function subscriptorLabel(v: number | null): string {
  if (v === 1) return "Da";
  if (v === 0) return "Nu";
  return "";
}

function partyLabel(p: PartyRecord): string {
  if (p.tip_persoana === "PF") return [p.denumire, p.prenume].filter(Boolean).join(" ");
  return p.denumire ?? "";
}

function partyId(p: PartyRecord): string {
  return p.cnp ?? p.cod ?? p.nr_identificare ?? "";
}

function bunLabel(b: BunRecord): string {
  return [b.model, b.identificare, b.descriere, b.serie_sasiu, b.nr_inmatriculare].filter(Boolean).join(" - ");
}

function refLabel(r: BunPartyRef): string {
  const name = r.tip_persoana === "PF" ? [r.denumire, r.prenume].filter(Boolean).join(" ") : (r.denumire ?? "");
  return `${r.rol}:${r.tip_persoana}:${name}`;
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed <= PAGE_HEIGHT - MARGIN) return y;
  doc.addPage();
  return MARGIN;
}

function writeTitle(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.rect(0, 0, PAGE_WIDTH, 54).fill("#1E40AF");
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(14).text(text(title), MARGIN, 16, { width: CONTENT_WIDTH });
  doc.fillColor("#DBEAFE").font("Helvetica").fontSize(9).text(text(subtitle), MARGIN, 36, { width: CONTENT_WIDTH });
  doc.fillColor(TEXT_DARK);
}

function writeSectionTitle(doc: PDFKit.PDFDocument, title: string, y: number): number {
  y = ensureSpace(doc, y, 22);
  doc.fillColor(BLUE_MAIN).font("Helvetica-Bold").fontSize(10).text(text(title), MARGIN, y);
  doc.fillColor(TEXT_DARK);
  return y + 16;
}

function writeKeyValues(doc: PDFKit.PDFDocument, rows: [string, string][], y: number): number {
  for (const [label, value] of rows.filter(([, value]) => value !== "")) {
    const body = text(value);
    const h = Math.max(15, estimateTextHeight(body, CONTENT_WIDTH - 130, FONT_SIZE_BODY) + 6);
    y = ensureSpace(doc, y, h);
    doc
      .font("Helvetica-Bold")
      .fontSize(FONT_SIZE_BODY)
      .fillColor(TEXT_MID)
      .text(text(label), MARGIN, y + 3, { width: 120 });
    doc
      .font("Helvetica")
      .fontSize(FONT_SIZE_BODY)
      .fillColor(TEXT_DARK)
      .text(body, MARGIN + 130, y + 3, {
        width: CONTENT_WIDTH - 130,
      });
    y += h;
  }
  return y + 4;
}

function writeTable(doc: PDFKit.PDFDocument, headers: string[], rows: string[][], widths: number[], y: number): number {
  if (rows.length === 0) return y;
  y = ensureSpace(doc, y, 28);

  doc.rect(MARGIN, y, CONTENT_WIDTH, 18).fill(BLUE_MAIN);
  let x = MARGIN;
  headers.forEach((header, index) => {
    doc
      .fillColor("#FFFFFF")
      .font("Helvetica-Bold")
      .fontSize(FONT_SIZE_TABLE)
      .text(text(header), x + 3, y + 5, {
        width: widths[index] - 6,
        height: 10,
      });
    x += widths[index];
  });
  y += 18;

  rows.forEach((row, rowIndex) => {
    const renderedCells = row.map((cell) => text(cell));
    const cellHeights = renderedCells.map(
      (cell, index) => estimateTextHeight(cell, widths[index] - 6, FONT_SIZE_TABLE) + 8
    );
    const rowHeight = Math.max(18, Math.min(MAX_ROW_HEIGHT, Math.max(...cellHeights)));
    y = ensureSpace(doc, y, rowHeight);
    if (rowIndex % 2 === 1) doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill(ROW_ALT);

    x = MARGIN;
    renderedCells.forEach((cell, index) => {
      doc
        .fillColor(TEXT_DARK)
        .font("Helvetica")
        .fontSize(FONT_SIZE_TABLE)
        .text(cell, x + 3, y + 4, {
          width: widths[index] - 6,
          height: rowHeight - 8,
          ellipsis: true,
        });
      x += widths[index];
    });
    doc
      .moveTo(MARGIN, y + rowHeight)
      .lineTo(MARGIN + CONTENT_WIDTH, y + rowHeight)
      .strokeColor("#E5E7EB")
      .stroke();
    y += rowHeight;
  });

  return y + 8;
}

function writeAvizPage(doc: PDFKit.PDFDocument, full: AvizFull, isSpecifice: boolean) {
  const a = full.aviz;
  doc.addPage();
  writeTitle(doc, `Aviz ${a.identificator}`, `${a.tip} | ${a.data}`);
  let y = 70;

  y = writeKeyValues(
    doc,
    [
      ["Activ", formatActivLabel(a.activ)],
      ["Destinatie", a.destinatie ?? ""],
      ["Tip act", a.tip_act ?? ""],
      ["Numar act", a.numar_act ?? ""],
      ["Data inregistrare", a.data_inreg ?? ""],
      ["Data expirare", a.data_expirare ?? ""],
      ["Inscriere initiala", a.inscriere_initiala_id ?? ""],
      ["Inscriere modificata", a.inscriere_modificata_id ?? ""],
      ["Alte mentiuni", a.alte_mentiuni ?? ""],
      ["Detalii comune", a.detalii_comune ?? ""],
    ],
    y
  );

  if (!isSpecifice && full.creditori.length > 0) {
    y = writeSectionTitle(doc, "Creditori", y);
    y = writeTable(
      doc,
      ["Nr", "Tip", "Subscr.", "Denumire", "Tip ent.", "Identificator", "Sediu"],
      full.creditori.map((p) => [
        p.nr_ordine != null ? String(p.nr_ordine) : "",
        p.tip_persoana,
        subscriptorLabel(p.subscriptor),
        partyLabel(p),
        p.tip_entitate ?? "",
        partyId(p),
        p.sediu ?? "",
      ]),
      [34, 34, 52, 180, 82, 104, 284],
      y
    );
  }

  if (full.debitori.length > 0) {
    y = writeSectionTitle(doc, "Parti", y);
    y = writeTable(
      doc,
      ["Nr", "Tip", "Calitate", "Subscr.", "Denumire", "Tip ent.", "Identificator", "Sediu"],
      full.debitori.map((p) => [
        p.nr_ordine != null ? String(p.nr_ordine) : "",
        p.tip_persoana,
        p.calitate ?? "",
        subscriptorLabel(p.subscriptor),
        partyLabel(p),
        p.tip_entitate ?? "",
        partyId(p),
        p.sediu ?? "",
      ]),
      [34, 34, 72, 52, 160, 76, 94, 248],
      y
    );
  }

  if (full.bunuri.length > 0) {
    y = writeSectionTitle(doc, "Bunuri", y);
    y = writeTable(
      doc,
      ["Tip", "Categorie", "Detalii", "Referinte"],
      full.bunuri.map((b) => [b.tip_bun, b.categorie ?? "", bunLabel(b), b.referinte.map(refLabel).join(" | ")]),
      [78, 118, 294, 280],
      y
    );
  }

  if (full.istoric.length > 0) {
    y = writeSectionTitle(doc, "Istoric", y);
    writeTable(
      doc,
      ["Identificator", "Data", "Tip"],
      full.istoric.map((h) => [h.identificator, h.data, h.tip]),
      [220, 90, 460],
      y
    );
  }
}

export async function buildRnpmPdf(items: AvizFull[], searchType?: string): Promise<RnpmPdfResult> {
  const tmpPath = join(tmpdir(), `rnpm-pdf-${randomUUID()}.pdf`);
  const output = createWriteStream(tmpPath);
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: MARGIN, autoFirstPage: false });

  try {
    doc.pipe(output);
    const dateStr = todayRo();
    const isSpecifice = searchType === "specifice";
    const totalCred = items.reduce((sum, item) => sum + item.creditori.length, 0);
    const totalDeb = items.reduce((sum, item) => sum + item.debitori.length, 0);
    const totalBun = items.reduce((sum, item) => sum + item.bunuri.length, 0);

    doc.addPage();
    writeTitle(
      doc,
      `Legal Dashboard - RNPM${searchType ? ` / ${searchType.toUpperCase()}` : ""}`,
      isSpecifice
        ? `Generat: ${dateStr} | ${items.length} avize | ${totalDeb} parti | ${totalBun} bunuri`
        : `Generat: ${dateStr} | ${items.length} avize | ${totalCred} creditori | ${totalDeb} parti | ${totalBun} bunuri`
    );
    writeTable(
      doc,
      ["Nr", "Identificator", "Data", "Tip", "Utilizator autorizat", "Activ", "Necesita act."],
      items.map((full, index) => [
        String(index + 1),
        full.aviz.identificator,
        full.aviz.data,
        full.aviz.tip,
        full.aviz.utilizator_autorizat ?? "",
        formatActivLabel(full.aviz.activ),
        full.aviz.needs_actualizare === 1 ? "Da" : "Nu",
      ]),
      [36, 140, 70, 180, 210, 60, 74],
      70
    );

    for (const full of items) {
      writeAvizPage(doc, full, isSpecifice);
    }

    doc.end();
    await once(output, "finish");
    const stat = await fs.stat(tmpPath);
    const fileBase =
      items.length === 1
        ? sanitizeFilename(items[0].aviz.identificator)
        : sanitizeFilename(`rnpm${searchType ? `_${searchType}` : ""}_${dateStr}`);

    return {
      filepath: tmpPath,
      filename: `${fileBase}.pdf`,
      mime: MIME_PDF,
      byteLength: stat.size,
    };
  } catch (err) {
    doc.destroy();
    output.destroy();
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
