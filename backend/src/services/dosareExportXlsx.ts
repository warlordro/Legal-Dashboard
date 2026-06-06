import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Dosar } from "../soap.ts";
import { todayRo } from "../util/xlsxHelpers.ts";
import { formatRoDate } from "../util/dateFormat.ts";
import { normalizeInstitutie } from "../util/institutionLabel.ts";

export interface DosareXlsxResult {
  filepath: string;
  filename: string;
  mime: string;
  byteLength: number;
}

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DATA_START_ROW = 5;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

const BLUE_DARK = "1E40AF";
const BLUE_MAIN = "2563EB";
const BLUE_LIGHT = "DBEAFE";
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

const sectionHeaderStyle: CellStyle = {
  font: { bold: true, size: 9, color: { argb: BLUE_DARK }, underline: true },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: BLUE_LIGHT } },
  alignment: { horizontal: "left", vertical: "middle" },
};

function sanitizeNr(nr: string): string {
  return (nr || "").replace(/[/\\:*?"<>|]/g, "-").trim() || "dosar";
}

function dataStyle(rowIdx: number, bold = false): CellStyle {
  return {
    font: { size: 9, bold, color: { argb: bold ? "1D4ED8" : TEXT_DARK } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: rowIdx % 2 === 1 ? ROW_ALT : WHITE } },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
  };
}

function linkStyle(rowIdx: number): CellStyle {
  return {
    font: { bold: true, size: 9, color: { argb: "1D4ED8" }, underline: true },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: rowIdx % 2 === 1 ? ROW_ALT : WHITE } },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
  };
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

function setHyperlink(cell: ExcelJS.Cell, text: string | number, hyperlink: string) {
  const displayText = String(safeCell(String(text)));
  const match = hyperlink.match(/^#([^!]+)!(.+)$/);
  if (!match) {
    cell.value = displayText;
    return;
  }
  const [, sheetName, cellRef] = match;
  cell.value = {
    formula: `HYPERLINK("#'${sheetName.replace(/'/g, "''")}'!${cellRef}","${displayText.replace(/"/g, '""')}")`,
    result: displayText,
  };
}

export async function buildDosareXlsx(dosare: Dosar[]): Promise<DosareXlsxResult> {
  const tmpPath = join(tmpdir(), `dosare-xlsx-${randomUUID()}.xlsx`);
  let committed = false;

  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: tmpPath,
      useStyles: true,
      useSharedStrings: false,
    });
    const dateStr = todayRo();
    const totalSedinte = dosare.reduce((sum, dosar) => sum + dosar.sedinte.length, 0);
    const hasSedinte = dosare.some((dosar) => dosar.sedinte.length > 0);

    const sedinteRowMap = new Map<string, number>();
    if (hasSedinte) {
      let row = DATA_START_ROW;
      for (const dosar of dosare) {
        if (dosar.sedinte.length === 0) continue;
        sedinteRowMap.set(dosar.numar, row);
        row += 1 + dosar.sedinte.length;
      }
    }

    const dosareHeaders = [
      "#",
      "Numar Dosar",
      "Data",
      "Institutie",
      "Departament",
      "Categorie / Stadiu",
      "Obiect",
      "Parti",
      "Nr. Sedinte",
    ];
    const dosareWidths = [5, 22, 14, 28, 20, 28, 32, 45, 12];
    const wsDosare = workbook.addWorksheet("Dosare");
    addMetaRows(
      wsDosare,
      "LEGAL DASHBOARD - DOSARE",
      `Generat: ${dateStr}  |  ${dosare.length} dosare  |  ${totalSedinte} sedinte`,
      dosareHeaders,
      dosareWidths
    );

    dosare.forEach((dosar, index) => {
      const row = wsDosare.addRow(
        safeValues([
          index + 1,
          dosar.numar || "-",
          formatRoDate(dosar.data),
          dosar.institutie ? normalizeInstitutie(dosar.institutie) : "-",
          dosar.departament || "-",
          [dosar.categorieCaz, dosar.stadiuProcesual].filter(Boolean).join(" / ") || "-",
          dosar.obiect || "-",
          dosar.parti.map((parte) => [parte.calitateParte, parte.nume].filter(Boolean).join(": ")).join("\n") || "-",
          dosar.sedinte.length,
        ])
      );
      const sedinteRow = sedinteRowMap.get(dosar.numar);
      for (let col = 1; col <= dosareHeaders.length; col += 1) {
        applyStyle(row.getCell(col), col === 2 && sedinteRow != null ? linkStyle(index) : dataStyle(index, col === 2));
      }
      if (sedinteRow != null) setHyperlink(row.getCell(2), dosar.numar || "-", `#Sedinte!A${sedinteRow}`);
      row.commit();
    });
    wsDosare.commit();

    if (hasSedinte) {
      const sedinteHeaders = [
        "#",
        "Numar Dosar",
        "Data Sedinta",
        "Ora",
        "Complet",
        "Solutie",
        "Sumar Solutie",
        "Document",
        "Nr. Document",
        "Data Pronuntare",
      ];
      const sedinteWidths = [5, 22, 14, 8, 20, 32, 32, 22, 16, 14];
      const wsSedinte = workbook.addWorksheet("Sedinte");
      addMetaRows(
        wsSedinte,
        "PORTALJUST DASHBOARD - SEDINTE",
        `Generat: ${dateStr}  |  ${totalSedinte} sedinte din ${dosare.length} dosare`,
        sedinteHeaders,
        sedinteWidths
      );

      let sedintaIndex = 0;
      dosare.forEach((dosar, dosarIndex) => {
        if (dosar.sedinte.length === 0) return;
        const sectionRow = wsSedinte.addRow(
          safeValues([`Dosar: ${dosar.numar}  (${dosar.sedinte.length} sedinte)  ^`])
        );
        styleRow(sectionRow, sedinteHeaders.length, sectionHeaderStyle);
        wsSedinte.mergeCells(sectionRow.number, 1, sectionRow.number, sedinteHeaders.length);
        setHyperlink(
          sectionRow.getCell(1),
          `Dosar: ${dosar.numar}  (${dosar.sedinte.length} sedinte)  ^`,
          `#Dosare!B${DATA_START_ROW + dosarIndex}`
        );
        sectionRow.commit();

        for (const sedinta of dosar.sedinte) {
          const row = wsSedinte.addRow(
            safeValues([
              sedintaIndex + 1,
              dosar.numar,
              formatRoDate(sedinta.data),
              sedinta.ora || "-",
              sedinta.complet || "-",
              sedinta.solutie || "-",
              sedinta.solutieSumar || "-",
              sedinta.documentSedinta || "-",
              sedinta.numarDocument || "-",
              formatRoDate(sedinta.dataPronuntare),
            ])
          );
          for (let col = 1; col <= sedinteHeaders.length; col += 1)
            applyStyle(row.getCell(col), dataStyle(sedintaIndex, col === 2));
          row.commit();
          sedintaIndex += 1;
        }
      });
      wsSedinte.commit();
    }

    await workbook.commit();
    committed = true;
    const stat = await fs.stat(tmpPath);
    const filename = dosare.length === 1 ? `dosar_${sanitizeNr(dosare[0].numar)}.xlsx` : `dosare_${dateStr}.xlsx`;
    return { filepath: tmpPath, filename, mime: MIME_XLSX, byteLength: stat.size };
  } catch (err) {
    if (!committed) await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
