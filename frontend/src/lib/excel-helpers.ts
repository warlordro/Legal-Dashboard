// Shared XLSX styling + safety helpers used by export.ts (PortalJust dosare/termene)
// and rnpmExport.ts (RNPM avize). Single source of truth for `sanitizeFormulaCells`,
// the formula-injection guard relied on by every styled export path.

export function todayRo(): string {
  return new Date().toLocaleDateString("ro-RO");
}

// Converts a 0-based column index to a letter (0→A, 25→Z, 26→AA …)
export function colLetter(col: number): string {
  let letter = "";
  let n = col + 1;
  while (n > 0) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

export function cellAddr(r: number, c: number): string {
  return `${colLetter(c)}${r + 1}`;
}

// Ensure a cell exists in the worksheet before styling it. Numeric values get
// `t: "n"`; strings (and the empty default) get `t: "s"`.
export function ensureCell(ws: Record<string, unknown>, addr: string, value: string | number = "") {
  if (!ws[addr]) ws[addr] = { t: typeof value === "number" ? "n" : "s", v: value };
}

// SECURITY: prevent CSV/formula injection — a string cell starting with =, +, -, @ or a
// leading tab/CR is treated as a formula by Excel/LibreOffice. Prefix with a single quote
// so the value is rendered as plain text (Excel strips the quote on display).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
export function sanitizeFormulaCells(ws: Record<string, unknown>) {
  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue;
    const cell = ws[key] as { t?: string; v?: unknown } | undefined;
    if (cell && cell.t === "s" && typeof cell.v === "string" && FORMULA_PREFIX.test(cell.v)) {
      cell.v = `'${cell.v}`;
    }
  }
}

// Apply a style object to every cell in a row
export function styleRow(ws: Record<string, unknown>, r: number, numCols: number, style: Record<string, unknown>) {
  for (let c = 0; c < numCols; c++) {
    const addr = cellAddr(r, c);
    ensureCell(ws, addr);
    (ws[addr] as Record<string, unknown>).s = style;
  }
}

// Apply individual style to a single cell
export function styleCell(ws: Record<string, unknown>, r: number, c: number, style: Record<string, unknown>) {
  const addr = cellAddr(r, c);
  ensureCell(ws, addr);
  (ws[addr] as Record<string, unknown>).s = style;
}

// Merge a row across all columns
export function mergeRow(ws: Record<string, unknown>, r: number, numCols: number) {
  if (!ws["!merges"]) ws["!merges"] = [];
  (ws["!merges"] as unknown[]).push({ s: { r, c: 0 }, e: { r, c: numCols - 1 } });
}

// ─── Style palette + base styles ──────────────────────────────────────────────

export const BLUE_DARK = "1E40AF"; // title background
export const BLUE_MAIN = "2563EB"; // header row
export const BLUE_LIGHT = "DBEAFE"; // section group header
export const ROW_ALT = "EFF6FF"; // alternating data row tint
export const WHITE = "FFFFFF";
export const TEXT_DARK = "111827";
export const TEXT_MID = "374151";

export const styleTitle = {
  font: { bold: true, sz: 13, color: { rgb: WHITE } },
  fill: { patternType: "solid", fgColor: { rgb: BLUE_DARK } },
  alignment: { horizontal: "center", vertical: "center" },
};

export const styleStats = {
  font: { sz: 9, italic: true, color: { rgb: TEXT_MID } },
  fill: { patternType: "solid", fgColor: { rgb: "F1F5F9" } },
  alignment: { horizontal: "left", vertical: "center" },
};

export const styleHeader = {
  font: { bold: true, sz: 9, color: { rgb: WHITE } },
  fill: { patternType: "solid", fgColor: { rgb: BLUE_MAIN } },
  alignment: { horizontal: "left", vertical: "center", wrapText: true },
  border: { bottom: { style: "thin", color: { rgb: "1D4ED8" } } },
};

export function styleDataCell(rowIdx: number, bold = false): Record<string, unknown> {
  const alt = rowIdx % 2 === 1;
  return {
    font: { sz: 9, bold, color: { rgb: TEXT_DARK } },
    fill: { patternType: "solid", fgColor: { rgb: alt ? ROW_ALT : WHITE } },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
  };
}
