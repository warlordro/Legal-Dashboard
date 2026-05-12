import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AvizFull, BunPartyRef, BunRecord, IstoricRecord, PartyRecord } from "../db/avizRepository.ts";
import { sanitizeFilename, todayRo } from "../util/xlsxHelpers.ts";

export interface RnpmXlsxResult {
  filepath: string;
  filename: string;
  mime: string;
  byteLength: number;
}

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PARTY_LABEL = "Parti";
const DATA_START_ROW = 5;
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

function dataStyle(rowIdx: number, bold = false): CellStyle {
  return {
    font: { size: 9, bold, color: { argb: TEXT_DARK } },
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

function refLabel(r: BunPartyRef): string {
  const name = r.tip_persoana === "PF" ? [r.denumire, r.prenume].filter(Boolean).join(" ") : (r.denumire ?? "");
  return `${r.rol}:${r.tip_persoana}:${name}`;
}

function safeCell<T>(v: T): T | string {
  if (typeof v === "string" && FORMULA_PREFIX.test(v)) return `'${v}`;
  return v;
}

function safeValues(values: ExcelJS.CellValue[]): ExcelJS.CellValue[] {
  return values.map((v) => safeCell(v) as ExcelJS.CellValue);
}

function applyStyle(cell: ExcelJS.Cell, style: CellStyle) {
  if (style.font) cell.font = style.font;
  if (style.fill) cell.fill = style.fill;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.border) cell.border = style.border;
}

function styleRow(row: ExcelJS.Row, columns: number, style: CellStyle) {
  for (let col = 1; col <= columns; col += 1) {
    applyStyle(row.getCell(col), style);
  }
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
  headerRow.height = 22;
  headerRow.commit();
}

function setHyperlink(cell: ExcelJS.Cell, text: string | number, hyperlink: string, tooltip: string) {
  // Internal `#Sheet!Cell` links via `cell.value = { hyperlink }` register as
  // EXTERNAL relationships in xl/worksheets/_rels/*.rels, which Excel 365 flags
  // as malformed on open ("We found a problem with some content"). HYPERLINK()
  // formula bypasses the rels chain entirely — executed as a native function
  // by Excel and LibreOffice. Tooltip is dropped (HYPERLINK has no tooltip arg).
  void tooltip;
  const displayText = String(safeCell(String(text)));
  const match = hyperlink.match(/^#([^!]+)!(.+)$/);
  if (!match) {
    cell.value = displayText;
    return;
  }
  const [, sheetName, cellRef] = match;
  const escapedSheet = sheetName.replace(/'/g, "''");
  const escapedText = displayText.replace(/"/g, '""');
  cell.value = {
    formula: `HYPERLINK("#'${escapedSheet}'!${cellRef}","${escapedText}")`,
    result: displayText,
  };
}

function buildOffsets(items: AvizFull[]) {
  const counts = new Map<string, { creditori: number; debitori: number; bunuri: number; istoric: number }>();
  const firstRow = new Map<string, { creditori?: number; debitori?: number; bunuri?: number; istoric?: number }>();
  let credRow = DATA_START_ROW - 1;
  let debRow = DATA_START_ROW - 1;
  let bunRow = DATA_START_ROW - 1;
  let istRow = DATA_START_ROW - 1;

  for (const full of items) {
    const idv = full.aviz.identificator;
    const creditori = full.creditori.length;
    const debitori = full.debitori.length;
    const bunuri = full.bunuri.length;
    const istoric = full.istoric.length;
    counts.set(idv, { creditori, debitori, bunuri, istoric });

    const row: { creditori?: number; debitori?: number; bunuri?: number; istoric?: number } = {};
    if (creditori) {
      credRow += 1;
      row.creditori = credRow;
      credRow += creditori - 1;
    }
    if (debitori) {
      debRow += 1;
      row.debitori = debRow;
      debRow += debitori - 1;
    }
    if (bunuri) {
      bunRow += 1;
      row.bunuri = bunRow;
      bunRow += bunuri - 1;
    }
    if (istoric) {
      istRow += 1;
      row.istoric = istRow;
      istRow += istoric - 1;
    }
    firstRow.set(idv, row);
  }

  return { counts, firstRow };
}

type ChildRow = { aviz: string; values: ExcelJS.CellValue[] };

function addChildSheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  name: string,
  headers: string[],
  widths: number[],
  rows: ChildRow[],
  avizRowOf: Map<string, number>,
  dateStr: string
) {
  if (rows.length === 0) return;

  const worksheet = workbook.addWorksheet(name);
  addMetaRows(
    worksheet,
    `${name.toUpperCase()} - RNPM`,
    `Generat: ${dateStr}  |  ${rows.length} inregistrari`,
    headers,
    widths
  );

  rows.forEach((child, index) => {
    const row = worksheet.addRow(safeValues(child.values));
    const avizRow = avizRowOf.get(child.aviz);
    for (let col = 1; col <= headers.length; col += 1) {
      const isAvizCol = col === 1;
      applyStyle(row.getCell(col), isAvizCol && avizRow != null ? linkStyle(index) : dataStyle(index, isAvizCol));
    }
    if (avizRow != null) {
      setHyperlink(row.getCell(1), child.aviz, `#Avize!B${avizRow}`, "Inapoi la aviz");
    }
    row.commit();
  });

  worksheet.commit();
}

function collectChildRows(items: AvizFull[]) {
  const creditoriRows: ChildRow[] = [];
  const debitoriRows: ChildRow[] = [];
  const bunuriRows: ChildRow[] = [];
  const istoricRows: ChildRow[] = [];

  for (const full of items) {
    const idv = full.aviz.identificator;
    const detaliiComune = full.aviz.detalii_comune ?? "";

    for (const p of full.creditori as PartyRecord[]) {
      creditoriRows.push({
        aviz: idv,
        values: [
          idv,
          p.tip_persoana,
          p.nr_ordine ?? "",
          subscriptorLabel(p.subscriptor),
          p.denumire ?? "",
          p.prenume ?? "",
          p.tip_entitate ?? "",
          p.cnp ?? "",
          p.cod ?? "",
          p.nr_identificare ?? "",
          p.sediu ?? "",
          p.localitate ?? "",
          p.judet ?? "",
          p.cod_postal ?? "",
          p.tara ?? "",
          p.alte_date ?? "",
        ],
      });
    }

    for (const p of full.debitori as PartyRecord[]) {
      debitoriRows.push({
        aviz: idv,
        values: [
          idv,
          p.calitate ?? "",
          p.tip_persoana,
          p.nr_ordine ?? "",
          subscriptorLabel(p.subscriptor),
          p.denumire ?? "",
          p.prenume ?? "",
          p.tip_entitate ?? "",
          p.cnp ?? "",
          p.cod ?? "",
          p.nr_identificare ?? "",
          p.sediu ?? "",
          p.localitate ?? "",
          p.judet ?? "",
          p.cod_postal ?? "",
          p.tara ?? "",
          p.alte_date ?? "",
        ],
      });
    }

    for (const b of full.bunuri as BunRecord[]) {
      bunuriRows.push({
        aviz: idv,
        values: [
          idv,
          b.tip_bun,
          b.categorie ?? "",
          b.identificare ?? "",
          b.descriere ?? "",
          b.model ?? "",
          b.serie_sasiu ?? "",
          b.serie_motor ?? "",
          b.nr_inmatriculare ?? "",
          b.referinte.map(refLabel).join(" | "),
          detaliiComune,
        ],
      });
    }

    for (const h of full.istoric as IstoricRecord[]) {
      istoricRows.push({ aviz: idv, values: [idv, h.identificator, h.data, h.tip, h.inscriere_m_v ?? ""] });
    }
  }

  return { creditoriRows, debitoriRows, bunuriRows, istoricRows };
}

export async function buildRnpmXlsx(items: AvizFull[], searchType?: string): Promise<RnpmXlsxResult> {
  const tmpPath = join(tmpdir(), `rnpm-xlsx-${randomUUID()}.xlsx`);
  let committed = false;

  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: tmpPath,
      useStyles: true,
      useSharedStrings: false,
    });

    const isSpecifice = searchType === "specifice";
    const dateStr = todayRo();
    const { counts, firstRow } = buildOffsets(items);
    const childRows = collectChildRows(items);
    const totalCred = [...counts.values()].reduce((sum, count) => sum + count.creditori, 0);
    const totalDeb = [...counts.values()].reduce((sum, count) => sum + count.debitori, 0);
    const totalBun = [...counts.values()].reduce((sum, count) => sum + count.bunuri, 0);

    const avizeHeaders = [
      "#",
      "Identificator",
      "Data",
      "Tip",
      "Utilizator autorizat",
      "Necesita act.",
      "Activ",
      "Destinatie",
      "Tip act",
      "Numar act",
      "Data inregistrare",
      "Data expirare",
      "Inscriere initiala",
      "Inscriere modificata",
      ...(isSpecifice ? [PARTY_LABEL] : ["Creditori", PARTY_LABEL]),
      "Bunuri",
      "Istoric",
      "Alte mentiuni",
      "Detalii comune",
    ];
    const avizeWidths = [
      5,
      30,
      11,
      30,
      32,
      10,
      6,
      22,
      14,
      16,
      14,
      14,
      26,
      26,
      ...(isSpecifice ? [9] : [10, 9]),
      8,
      8,
      40,
      60,
    ];
    const statsLine = isSpecifice
      ? `Generat: ${dateStr}  |  ${items.length} avize  |  ${totalDeb} parti  |  ${totalBun} bunuri`
      : `Generat: ${dateStr}  |  ${items.length} avize  |  ${totalCred} creditori  |  ${totalDeb} parti  |  ${totalBun} bunuri`;

    const wsAvize = workbook.addWorksheet("Avize");
    addMetaRows(
      wsAvize,
      `LEGAL DASHBOARD - RNPM${searchType ? ` / ${searchType.toUpperCase()}` : ""}`,
      statsLine,
      avizeHeaders,
      avizeWidths
    );

    const navCols: { creditori?: number; debitori: number; bunuri: number; istoric: number } = isSpecifice
      ? { debitori: 15, bunuri: 16, istoric: 17 }
      : { creditori: 15, debitori: 16, bunuri: 17, istoric: 18 };
    const navStart = navCols.creditori ?? navCols.debitori;
    const avizRowOf = new Map<string, number>();

    items.forEach((full, index) => {
      const a = full.aviz;
      const cnt = counts.get(a.identificator) ?? { creditori: 0, debitori: 0, bunuri: 0, istoric: 0 };
      const rowNumber = DATA_START_ROW + index;
      avizRowOf.set(a.identificator, rowNumber);
      const values: ExcelJS.CellValue[] = [
        index + 1,
        a.identificator,
        a.data ?? "",
        a.tip ?? "",
        a.utilizator_autorizat ?? "",
        a.needs_actualizare === 1 ? "Da" : "Nu",
        formatActivLabel(a.activ),
        a.destinatie ?? "",
        a.tip_act ?? "",
        a.numar_act ?? "",
        a.data_inreg ?? "",
        a.data_expirare ?? "",
        a.inscriere_initiala_id ?? "",
        a.inscriere_modificata_id ?? "",
        ...(isSpecifice ? [] : [cnt.creditori || ""]),
        cnt.debitori || "",
        cnt.bunuri || "",
        cnt.istoric || "",
        a.alte_mentiuni ?? "",
        a.detalii_comune ?? "",
      ];
      const row = wsAvize.addRow(safeValues(values));
      const fr = firstRow.get(a.identificator);
      const hasChildren = Boolean(fr && (fr.bunuri || fr.debitori || fr.creditori || fr.istoric));

      for (let col = 1; col <= avizeHeaders.length; col += 1) {
        const isIdent = col === 2;
        const isNav = col >= navStart && col <= navCols.istoric;
        const isLink =
          (isIdent && hasChildren) ||
          (navCols.creditori != null && col === navCols.creditori && fr?.creditori) ||
          (col === navCols.debitori && fr?.debitori) ||
          (col === navCols.bunuri && fr?.bunuri) ||
          (col === navCols.istoric && fr?.istoric);
        const style = isLink ? linkStyle(index) : dataStyle(index, isIdent);
        if (isNav) {
          style.alignment = { horizontal: "center", vertical: "top" };
        }
        applyStyle(row.getCell(col), style);
      }

      if (fr) {
        const primary = fr.bunuri ?? fr.debitori ?? fr.creditori ?? fr.istoric;
        if (primary != null) {
          const sheet = fr.bunuri ? "Bunuri" : fr.debitori ? PARTY_LABEL : fr.creditori ? "Creditori" : "Istoric";
          setHyperlink(row.getCell(2), a.identificator, `#${sheet}!A${primary}`, "Deschide detaliile avizului");
        }
        if (navCols.creditori != null && fr.creditori != null) {
          setHyperlink(row.getCell(navCols.creditori), cnt.creditori, `#Creditori!A${fr.creditori}`, "Vezi creditori");
        }
        if (fr.debitori != null) {
          setHyperlink(row.getCell(navCols.debitori), cnt.debitori, `#${PARTY_LABEL}!A${fr.debitori}`, "Vezi parti");
        }
        if (fr.bunuri != null) {
          setHyperlink(row.getCell(navCols.bunuri), cnt.bunuri, `#Bunuri!A${fr.bunuri}`, "Vezi bunuri");
        }
        if (fr.istoric != null) {
          setHyperlink(row.getCell(navCols.istoric), cnt.istoric, `#Istoric!A${fr.istoric}`, "Vezi istoric");
        }
      }

      row.commit();
    });
    wsAvize.commit();

    if (!isSpecifice) {
      addChildSheet(
        workbook,
        "Creditori",
        [
          "Aviz",
          "Tip",
          "Nr ordine",
          "Subscriptor",
          "Denumire",
          "Prenume",
          "Tip entitate",
          "CNP",
          "Cod fiscal",
          "Nr identificare",
          "Sediu",
          "Localitate",
          "Judet",
          "Cod postal",
          "Tara",
          "Alte date",
        ],
        [30, 5, 9, 11, 34, 18, 16, 16, 16, 18, 36, 18, 14, 10, 10, 30],
        childRows.creditoriRows,
        avizRowOf,
        dateStr
      );
    }
    addChildSheet(
      workbook,
      PARTY_LABEL,
      [
        "Aviz",
        "Calitate",
        "Tip",
        "Nr ordine",
        "Subscriptor",
        "Denumire",
        "Prenume",
        "Tip entitate",
        "CNP",
        "Cod fiscal",
        "Nr identificare",
        "Sediu",
        "Localitate",
        "Judet",
        "Cod postal",
        "Tara",
        "Alte date",
      ],
      [30, 16, 5, 9, 11, 34, 18, 16, 16, 16, 18, 36, 18, 14, 10, 10, 30],
      childRows.debitoriRows,
      avizRowOf,
      dateStr
    );
    addChildSheet(
      workbook,
      "Bunuri",
      [
        "Aviz",
        "Tip bun",
        "Categorie",
        "Identificare",
        "Descriere",
        "Model",
        "Serie sasiu",
        "Serie motor",
        "Nr inmatriculare",
        "Referinte",
        "Detalii comune",
      ],
      [30, 16, 18, 30, 40, 20, 22, 18, 16, 30, 60],
      childRows.bunuriRows,
      avizRowOf,
      dateStr
    );
    addChildSheet(
      workbook,
      "Istoric",
      ["Aviz", "Identificator", "Data", "Tip", "Inscriere modificatoare"],
      [30, 30, 11, 28, 30],
      childRows.istoricRows,
      avizRowOf,
      dateStr
    );

    await workbook.commit();
    committed = true;

    const stat = await fs.stat(tmpPath);
    const fileBase =
      items.length === 1
        ? sanitizeFilename(items[0].aviz.identificator)
        : sanitizeFilename(`rnpm${searchType ? `_${searchType}` : ""}_${dateStr}`);

    return {
      filepath: tmpPath,
      filename: `${fileBase}.xlsx`,
      mime: MIME_XLSX,
      byteLength: stat.size,
    };
  } catch (err) {
    if (!committed) {
      await fs.unlink(tmpPath).catch(() => {});
    }
    throw err;
  }
}
