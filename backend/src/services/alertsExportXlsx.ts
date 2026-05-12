import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MonitoringAlertRow } from "../db/monitoringAlertsRepository.ts";
import { todayRo } from "../util/xlsxHelpers.ts";

export interface AlertExportDecoratedRow {
  alert: MonitoringAlertRow;
  numarDosar: string | null;
  dosarLink: string | null;
  kindLabel: string;
  severityLabel: string;
  nameMonitored: string | null;
}

export interface AlertsXlsxResult {
  filepath: string;
  filename: string;
  mime: string;
  byteLength: number;
}

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const HEADERS = ["Data", "Severitate", "Tip eveniment", "Titlu", "Dosar", "Nume monitorizat", "Status"];
const WIDTHS = [17, 10, 18, 50, 28, 28, 11];
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

function alertsFilename(ext: "xlsx" | "pdf", count: number): string {
  return `alerte_${count}_${todayRo().replace(/\./g, "-")}.${ext}`;
}

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

function statusLabel(row: MonitoringAlertRow): string {
  if (row.dismissed_at) return "Dismissed";
  if (row.read_at) return "Citita";
  return "Necitita";
}

function safeCell<T>(value: T): T | string {
  if (typeof value === "string" && FORMULA_PREFIX.test(value)) return `'${value}`;
  return value;
}

function safeValues(values: ExcelJS.CellValue[]): ExcelJS.CellValue[] {
  return values.map((value) => safeCell(value) as ExcelJS.CellValue);
}

function dataStyle(rowIdx: number, link = false): CellStyle {
  return {
    font: { size: 9, color: { argb: link ? "1D4ED8" : TEXT_DARK }, underline: link || undefined },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: rowIdx % 2 === 1 ? ROW_ALT : WHITE } },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
  };
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

function addMetaRows(worksheet: ExcelJS.Worksheet, rows: AlertExportDecoratedRow[], contextLabel?: string) {
  worksheet.columns = WIDTHS.map((width) => ({ width }));
  const dateStr = todayRo();
  const titleRow = worksheet.addRow(safeValues(["Legal Dashboard - Alerte"]));
  styleRow(titleRow, HEADERS.length, titleStyle);
  worksheet.mergeCells(1, 1, 1, HEADERS.length);
  titleRow.height = 22;
  titleRow.commit();

  const statsBits = [`Generat: ${dateStr}`, `Total: ${rows.length}`];
  if (contextLabel) statsBits.push(contextLabel);
  const statsRow = worksheet.addRow(safeValues([statsBits.join("  |  ")]));
  styleRow(statsRow, HEADERS.length, statsStyle);
  worksheet.mergeCells(2, 1, 2, HEADERS.length);
  statsRow.height = 16;
  statsRow.commit();

  const gapRow = worksheet.addRow(Array(HEADERS.length).fill(null));
  gapRow.height = 6;
  gapRow.commit();

  const headerRow = worksheet.addRow(safeValues(HEADERS));
  styleRow(headerRow, HEADERS.length, headerStyle);
  headerRow.height = 18;
  headerRow.commit();
}

export async function buildAlertsXlsx(
  rows: AlertExportDecoratedRow[],
  contextLabel?: string
): Promise<AlertsXlsxResult> {
  const tmpPath = join(tmpdir(), `alerts-xlsx-${randomUUID()}.xlsx`);
  let committed = false;

  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: tmpPath,
      useStyles: true,
      useSharedStrings: false,
    });
    const worksheet = workbook.addWorksheet("Alerte");
    addMetaRows(worksheet, rows, contextLabel);

    rows.forEach((row, index) => {
      const values: ExcelJS.CellValue[] = [
        formatDateTime(row.alert.created_at),
        row.severityLabel,
        row.kindLabel,
        row.alert.title,
        row.numarDosar ?? "-",
        row.nameMonitored ?? "-",
        statusLabel(row.alert),
      ];
      const xlsxRow = worksheet.addRow(safeValues(values));
      for (let col = 1; col <= HEADERS.length; col += 1) {
        applyStyle(xlsxRow.getCell(col), dataStyle(index, col === 5 && row.dosarLink != null));
      }
      if (row.dosarLink) {
        xlsxRow.getCell(5).value = {
          text: String(safeCell(row.numarDosar ?? "-")),
          hyperlink: row.dosarLink,
          tooltip: "Deschide pe portal.just.ro",
        };
      }
      xlsxRow.commit();
    });
    worksheet.commit();
    await workbook.commit();
    committed = true;

    const stat = await fs.stat(tmpPath);
    return { filepath: tmpPath, filename: alertsFilename("xlsx", rows.length), mime: MIME_XLSX, byteLength: stat.size };
  } catch (err) {
    if (!committed) await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
