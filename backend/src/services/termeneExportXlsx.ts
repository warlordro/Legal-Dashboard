import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { todayRo } from "../util/xlsxHelpers.ts";

export interface TermenExportRow {
  numarDosar: string;
  institutie: string;
  data: string;
  ora: string;
  complet: string;
  solutie: string;
  solutieSumar: string;
  categorieCaz?: string;
  stadiuProcesual?: string;
  obiect?: string;
  parti?: { calitateParte: string; nume: string }[];
}

export interface TermeneXlsxResult {
  filepath: string;
  filename: string;
  mime: string;
  byteLength: number;
}

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const BLUE_DARK = "1E40AF";
const BLUE_MAIN = "2563EB";
const ROW_ALT = "EFF6FF";
const WHITE = "FFFFFF";
const TEXT_DARK = "111827";
const TEXT_MID = "374151";

type CellStyle = Partial<ExcelJS.Style>;

const titleStyle: CellStyle = {
  font: { bold: true, size: 13, color: { argb: WHITE } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: BLUE_DARK } },
  alignment: { horizontal: "center", vertical: "middle" },
};
const statsStyle: CellStyle = {
  font: { size: 9, italic: true, color: { argb: TEXT_MID } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "F1F5F9" } },
  alignment: { horizontal: "left", vertical: "middle" },
};
const headerStyle: CellStyle = {
  font: { bold: true, size: 9, color: { argb: WHITE } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: BLUE_MAIN } },
  alignment: { horizontal: "left", vertical: "middle", wrapText: true },
  border: { bottom: { style: "thin", color: { argb: "1D4ED8" } } },
};

function sanitizeNr(nr: string): string {
  return (nr || "").replace(/[/\\:*?"<>|]/g, "-").trim() || "dosar";
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function safeCell<T>(value: T): T | string {
  if (typeof value === "string" && FORMULA_PREFIX.test(value)) return `'${value}`;
  return value;
}

function safeValues(values: ExcelJS.CellValue[]): ExcelJS.CellValue[] {
  return values.map((value) => safeCell(value) as ExcelJS.CellValue);
}

function applyStyle(cell: ExcelJS.Cell, style: CellStyle) {
  if (style.font) cell.font = style.font;
  if (style.fill) cell.fill = style.fill;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.border) cell.border = style.border;
}

function dataStyle(rowIdx: number, bold = false): CellStyle {
  return {
    font: { size: 9, bold, color: { argb: bold ? "1D4ED8" : TEXT_DARK } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: rowIdx % 2 === 1 ? ROW_ALT : WHITE } },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
  };
}

function styleRow(row: ExcelJS.Row, columns: number, style: CellStyle) {
  for (let col = 1; col <= columns; col += 1) applyStyle(row.getCell(col), style);
}

function addMetaRows(worksheet: ExcelJS.Worksheet, title: string, stats: string, headers: string[], widths: number[]) {
  worksheet.columns = widths.map((width) => ({ width }));
  const titleRow = worksheet.addRow(safeValues([title]));
  styleRow(titleRow, headers.length, titleStyle);
  worksheet.mergeCells(1, 1, 1, headers.length);
  titleRow.height = 22;
  titleRow.commit();
  const statsRow = worksheet.addRow(safeValues([stats]));
  styleRow(statsRow, headers.length, statsStyle);
  worksheet.mergeCells(2, 1, 2, headers.length);
  statsRow.height = 16;
  statsRow.commit();
  const spacerRow = worksheet.addRow(Array(headers.length).fill(null));
  spacerRow.height = 6;
  spacerRow.commit();
  const headerRow = worksheet.addRow(safeValues(headers));
  styleRow(headerRow, headers.length, headerStyle);
  headerRow.height = 18;
  headerRow.commit();
}

export async function buildTermeneXlsx(termene: TermenExportRow[]): Promise<TermeneXlsxResult> {
  const tmpPath = join(tmpdir(), `termene-xlsx-${randomUUID()}.xlsx`);
  let committed = false;

  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: tmpPath,
      useStyles: true,
      useSharedStrings: false,
    });
    const dateStr = todayRo();
    const headers = ["#", "Numar Dosar", "Data", "Ora", "Institutie", "Complet", "Solutie", "Sumar Solutie"];
    const widths = [5, 22, 14, 8, 30, 22, 35, 35];
    const worksheet = workbook.addWorksheet("Termene");
    addMetaRows(
      worksheet,
      "PORTALJUST DASHBOARD - TERMENE",
      `Generat: ${dateStr}  |  ${termene.length} termene`,
      headers,
      widths
    );

    termene.forEach((termen, index) => {
      const row = worksheet.addRow(
        safeValues([
          index + 1,
          termen.numarDosar || "-",
          formatDate(termen.data),
          termen.ora || "-",
          termen.institutie || "-",
          termen.complet || "-",
          termen.solutie || "-",
          termen.solutieSumar || "-",
        ])
      );
      for (let col = 1; col <= headers.length; col += 1) applyStyle(row.getCell(col), dataStyle(index, col === 2));
      row.commit();
    });
    worksheet.commit();
    await workbook.commit();
    committed = true;

    const stat = await fs.stat(tmpPath);
    const filename =
      termene.length === 1 ? `termen_${sanitizeNr(termene[0].numarDosar)}.xlsx` : `termene_${dateStr}.xlsx`;
    return { filepath: tmpPath, filename, mime: MIME_XLSX, byteLength: stat.size };
  } catch (err) {
    if (!committed) await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
