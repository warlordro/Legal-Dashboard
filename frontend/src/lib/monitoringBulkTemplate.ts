// Bulk-import template + parser shared by the Monitorizare bulk-upload UI.
// Acepta `dosar_soap` si `name_soap` in acelasi fisier — kind-ul este derivat
// din coloana populata (numar_dosar vs nume), nu este declarat explicit.
//
// Decizii (2026-04-29):
//   * Doar 2 coloane functionale: `numar_dosar` SAU `nume`. Rinduri cu
//     numar_dosar populat → dosar_soap. Rinduri cu nume populat → name_soap.
//     Daca ambele sunt populate, e ambiguu si e flag-uit ca eroare.
//   * Drop `name_kind` (PF/PJ): PortalJust SOAP CautareDosare primeste doar
//     `numeParte` ca string raw, deci distinctia nu schimba query-ul.
//   * Drop `institutie` din template — ramane in UI ca filter global.
//   * `cadence_sec` accepta label-uri ("4h"/"8h"/"12h"/"24h") via dropdown
//     XLSX (matches in-app `MonitoringAddForm`). Numericele in secunde raman
//     acceptate pentru backward-compat cu fisiere vechi.
//   * `notes` cosmetic.
//
// Design (2026-05-01): template-ul foloseste acelasi stil vizual cu celelalte
// export-uri din aplicatie (titlu BLUE_DARK, header BLUE_MAIN, randuri
// alternante) prin `xlsx-js-style` + helperii din `excel-helpers.ts`. Parser-ul
// detecteaza automat rândul de header astfel încât atât template-ul nou (cu
// titlu+stats deasupra) cât si fisierele vechi (header pe randul 1) sunt
// acceptate.
//
// XLSX dropdown: nici SheetJS Community (`xlsx` 0.18.5) nici `xlsx-js-style`
// nu scriu dataValidations, deci post-procesam fisierul: unzip → injecteaza
// <dataValidations> in xl/worksheets/sheet1.xml → rezip. Folosim `fflate`
// (~8KB, tree-shakeable), deja prezent ca tranzitiv via xlsx-js-style.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import * as XLSX from "xlsx";
import {
  BLUE_DARK,
  BLUE_MAIN,
  cellAddr,
  mergeRow,
  ROW_ALT,
  sanitizeFormulaCells,
  styleCell,
  styleRow,
  TEXT_DARK,
  TEXT_MID,
  todayRo,
  WHITE,
} from "./excel-helpers";

// Stiluri locale clonate din excel-helpers cu font sz: 10 (vs default 9 la
// celelalte export-uri). Template-ul are mai putine date decat exporturile de
// dosare/termene, deci putem permite text mai mare fara sa stricam aspectul.
const TEMPLATE_FONT_SIZE = 10;

const tplStyleTitle = {
  font: { bold: true, sz: 13, color: { rgb: WHITE } },
  fill: { patternType: "solid", fgColor: { rgb: BLUE_DARK } },
  alignment: { horizontal: "center", vertical: "center" },
};

const tplStyleStats = {
  font: { sz: TEMPLATE_FONT_SIZE, italic: true, color: { rgb: TEXT_MID } },
  fill: { patternType: "solid", fgColor: { rgb: "F1F5F9" } },
  alignment: { horizontal: "left", vertical: "center" },
};

const tplStyleHeader = {
  font: { bold: true, sz: TEMPLATE_FONT_SIZE, color: { rgb: WHITE } },
  fill: { patternType: "solid", fgColor: { rgb: BLUE_MAIN } },
  alignment: { horizontal: "left", vertical: "center", wrapText: true },
  border: { bottom: { style: "thin", color: { rgb: "1D4ED8" } } },
};

function tplStyleDataCell(rowIdx: number, bold = false): Record<string, unknown> {
  const alt = rowIdx % 2 === 1;
  return {
    font: { sz: TEMPLATE_FONT_SIZE, bold, color: { rgb: TEXT_DARK } },
    fill: { patternType: "solid", fgColor: { rgb: alt ? ROW_ALT : WHITE } },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
  };
}

export type BulkKind = "dosar" | "nume";

export interface BulkRowDosar {
  rowNumber: number;
  kind: "dosar";
  numar_dosar: string;
  cadence_sec?: number;
  notes?: string;
}

export interface BulkRowName {
  rowNumber: number;
  kind: "nume";
  name_normalized: string;
  cadence_sec?: number;
  notes?: string;
}

export type BulkRow = BulkRowDosar | BulkRowName;

export interface BulkRowInvalid {
  rowNumber: number;
  display: string;
  message: string;
}

export interface ParseResult {
  valid: BulkRow[];
  invalid: BulkRowInvalid[];
}

// Match dropdown din `MonitoringAddForm` (label → secunde).
const CADENCE_LABEL_MAP: Record<string, number> = {
  "4h": 14400,
  "8h": 28800,
  "12h": 43200,
  "24h": 86400,
};

const CADENCE_LABELS = ["4h", "8h", "12h", "24h"] as const;

// Layout constants pentru template stilizat.
const HEADERS = ["numar_dosar", "nume", "cadence_sec", "notes"] as const;
const COL_WIDTHS = [22, 32, 14, 40];
const NUM_COLS = HEADERS.length;
const TITLE_ROW = 0;
const STATS_ROW = 1;
const HEADER_ROW = 3;
const DATA_START_ROW = 4;

// Convert a 0-based column index to an Excel column letter (A, B, ..., Z, AA, ...).
function colIndexToLetter(idx: number): string {
  let n = idx;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// Derivat din HEADERS ca reordonarea coloanelor sa nu desincronizeze
// dropdown-ul de cadenta din Excel.
const CADENCE_COL_INDEX = HEADERS.indexOf("cadence_sec" as (typeof HEADERS)[number]);
if (CADENCE_COL_INDEX < 0) {
  throw new Error("monitoringBulkTemplate: HEADERS must include 'cadence_sec'");
}
const CADENCE_COL_LETTER = colIndexToLetter(CADENCE_COL_INDEX);
// 1000 randuri de date in plus (sufficient pentru cazuri uzuale).
const CADENCE_DV_RANGE_END = DATA_START_ROW + 1000;

// Injecteaza un <dataValidation type="list"> peste C{DATA_START}:C{END} in
// sheet1.xml. OOXML cere ca <dataValidations> sa apara DUPA <sheetData> /
// <conditionalFormatting>, dar INAINTE de <pageMargins>; fallback la inainte
// de </worksheet> daca <pageMargins> lipseste.
function injectCadenceDropdown(xlsxBytes: Uint8Array): Uint8Array {
  const unzipped = unzipSync(xlsxBytes);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const sheetBytes = unzipped[sheetPath];
  if (!sheetBytes) return xlsxBytes; // unexpected — fail soft

  const sheetXml = strFromU8(sheetBytes);
  if (sheetXml.includes("<dataValidations")) return xlsxBytes;
  const formula = CADENCE_LABELS.join(",");
  // Quotes in <formula1> sunt escaped ca &quot; — lista in-cell e
  // `"4h,8h,12h,24h"` (cu ghilimele literale incluse).
  // sqref foloseste numerotare 1-based (Excel), deci DATA_START_ROW (=4) → randul 5 in Excel.
  const sqref = `${CADENCE_COL_LETTER}${DATA_START_ROW + 1}:${CADENCE_COL_LETTER}${CADENCE_DV_RANGE_END + 1}`;
  const dv =
    '<dataValidations count="1">' +
    `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${sqref}">` +
    `<formula1>&quot;${formula}&quot;</formula1>` +
    "</dataValidation>" +
    "</dataValidations>";

  let modified: string;
  const finalAnchors = [
    "<hyperlinks",
    "<printOptions",
    "<pageMargins",
    "<pageSetup",
    "<headerFooter",
    "<rowBreaks",
    "<colBreaks",
    "<customProperties",
    "<cellWatches",
    "<ignoredErrors",
    "<smartTags",
    "<drawing",
    "<legacyDrawing",
    "<picture",
    "<oleObjects",
    "<controls",
    "<webPublishItems",
    "<tableParts",
    "<extLst",
  ];
  const anchor = finalAnchors.find((token) => sheetXml.includes(token));
  if (anchor) {
    modified = sheetXml.replace(anchor, `${dv}${anchor}`);
  } else if (sheetXml.includes("</sheetData>")) {
    modified = sheetXml.replace("</sheetData>", `</sheetData>${dv}`);
  } else {
    modified = sheetXml.replace("</worksheet>", `${dv}</worksheet>`);
  }

  unzipped[sheetPath] = strToU8(modified);
  return zipSync(unzipped, { level: 6 });
}

// Pre-stylate empty data rows pentru ca utilizatorul sa aiba un spatiu de
// completat cu fundal alternativ ROW_ALT/WHITE deja aplicat. Anterior aceasta
// zona continea exemple ("1234/180/2024", "POPESCU ION", "Client X — apel"
// etc.) — eliminate la cerere ca sa nu fie nevoie sa fie sterse manual.
const EMPTY_DATA_ROWS_COUNT = 4;

export async function downloadBulkTemplate(): Promise<void> {
  const StyledXLSX = await import("xlsx-js-style");

  const aoa: (string | number | null)[][] = [
    ["LEGAL DASHBOARD — TEMPLATE MONITORIZARE", ...Array(NUM_COLS - 1).fill(null)],
    [
      `Generat: ${todayRo()}  |  Completeaza UNA din coloanele numar_dosar SAU nume per rand. Cadenta: 4h / 8h / 12h / 24h (dropdown).`,
      ...Array(NUM_COLS - 1).fill(null),
    ],
    Array(NUM_COLS).fill(null),
    [...HEADERS],
    ...Array.from({ length: EMPTY_DATA_ROWS_COUNT }, () =>
      Array(NUM_COLS).fill("") as (string | number | null)[],
    ),
  ];

  const ws = StyledXLSX.utils.aoa_to_sheet(aoa) as Record<string, unknown>;
  ws["!cols"] = COL_WIDTHS.map((w) => ({ wch: w }));
  ws["!rows"] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 6 }, { hpt: 18 }];

  mergeRow(ws, TITLE_ROW, NUM_COLS);
  mergeRow(ws, STATS_ROW, NUM_COLS);
  styleRow(ws, TITLE_ROW, NUM_COLS, tplStyleTitle);
  styleRow(ws, STATS_ROW, NUM_COLS, tplStyleStats);
  styleRow(ws, HEADER_ROW, NUM_COLS, tplStyleHeader);

  // Empty data rows — fundal alternativ ROW_ALT/WHITE pe celulele goale ca
  // utilizatorul sa aiba o zona vizibila de completat. Cellele goale primesc
  // string vid (`""`) ca sa fie randate si stilizate (altfel xlsx-js-style le
  // sare in aoa_to_sheet).
  for (let i = 0; i < EMPTY_DATA_ROWS_COUNT; i++) {
    const r = DATA_START_ROW + i;
    for (let c = 0; c < NUM_COLS; c++) {
      const addr = cellAddr(r, c);
      if (!ws[addr]) ws[addr] = { t: "s", v: "" };
      styleCell(ws, r, c, tplStyleDataCell(i, false));
    }
  }

  sanitizeFormulaCells(ws);

  const wb = StyledXLSX.utils.book_new();
  StyledXLSX.utils.book_append_sheet(wb, ws as import("xlsx").WorkSheet, "Monitorizare");

  const out = StyledXLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer | Uint8Array;
  const bytes = out instanceof ArrayBuffer ? new Uint8Array(out) : out;
  const withDropdown = injectCadenceDropdown(bytes);
  // Copy into a fresh ArrayBuffer (not SharedArrayBuffer) to satisfy Blob's
  // BlobPart type — fflate's Uint8Array can be backed by ArrayBufferLike.
  const finalBytes = new Uint8Array(withDropdown.byteLength);
  finalBytes.set(withDropdown);

  const blob = new Blob([finalBytes.buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "monitorizare-template.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseCadence(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw).trim().toLowerCase();
  if (!s) return undefined;
  if (s in CADENCE_LABEL_MAP) return CADENCE_LABEL_MAP[s];
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// Detecteaza randul de header cautand celule care contin "numar_dosar" /
// "nume" / "name_normalized" / "denumire". Suporta atat template-ul nou (header
// pe randul 4 = index 3) cat si fisiere flat (header pe randul 1 = index 0).
function findHeaderRow(rows: unknown[][]): number {
  const targets = new Set(["numar_dosar", "nume", "name_normalized", "denumire"]);
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] ?? [];
    for (const cell of row) {
      const s = String(cell ?? "").trim().toLowerCase();
      if (targets.has(s)) return i;
    }
  }
  return -1;
}

export function parseBulkFile(buffer: ArrayBuffer, fileName: string): ParseResult {
  const isCsv = /\.csv$/i.test(fileName);
  const wb = isCsv
    ? XLSX.read(new TextDecoder("utf-8").decode(new Uint8Array(buffer)), { type: "string" })
    : XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const valid: BulkRow[] = [];
  const invalid: BulkRowInvalid[] = [];
  if (!sheet) return { valid, invalid };

  // Citim ca matrice raw, gasim randul de header, apoi parsam manual.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const headerIdx = findHeaderRow(matrix);
  if (headerIdx < 0) {
    invalid.push({
      rowNumber: 1,
      display: fileName,
      message:
        "Header lipsa: fisierul nu contine niciuna dintre coloanele recunoscute (numar_dosar, nume, name_normalized, denumire). Descarca template-ul si reincearca.",
    });
    return { valid, invalid };
  }

  const headerRow = (matrix[headerIdx] ?? []).map((c) =>
    String(c ?? "").trim().toLowerCase(),
  );
  const colNumarDosar = headerRow.indexOf("numar_dosar");
  // Acceptam sinonime pentru coloana de nume (template nostru = "nume", dar
  // si "name_normalized" / "denumire" pentru exporturi vechi).
  let colNume = headerRow.indexOf("nume");
  if (colNume < 0) colNume = headerRow.indexOf("name_normalized");
  if (colNume < 0) colNume = headerRow.indexOf("denumire");
  const colCadence = headerRow.indexOf("cadence_sec");
  const colNotes = headerRow.indexOf("notes");

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    // rowNumber este numarul Excel (1-based) — utilizat in mesajele de eroare
    // pentru ca user-ul sa il poata localiza in foaia originala.
    const rowNumber = i + 1;

    const numarDosar =
      colNumarDosar >= 0 ? String(row[colNumarDosar] ?? "").trim() : "";
    const nameNorm = colNume >= 0 ? String(row[colNume] ?? "").trim() : "";
    const cadenceFinal =
      colCadence >= 0 ? parseCadence(row[colCadence]) : undefined;
    const notes =
      colNotes >= 0 ? String(row[colNotes] ?? "").trim() || undefined : undefined;

    if (!numarDosar && !nameNorm) {
      continue; // empty row — skip silently
    }

    if (numarDosar && nameNorm) {
      invalid.push({
        rowNumber,
        display: `${numarDosar} / ${nameNorm}`,
        message:
          "Ambele coloane sunt populate. Un rand = un job: pune numar_dosar SAU nume, nu ambele.",
      });
      continue;
    }

    if (numarDosar) {
      valid.push({
        rowNumber,
        kind: "dosar",
        numar_dosar: numarDosar,
        cadence_sec: cadenceFinal,
        notes,
      });
      continue;
    }

    valid.push({
      rowNumber,
      kind: "nume",
      name_normalized: nameNorm,
      cadence_sec: cadenceFinal,
      notes,
    });
  }
  return { valid, invalid };
}
