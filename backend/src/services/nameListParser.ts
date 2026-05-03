// Parser/validator pentru bulk name list import (PR-5).
//
// Surface-ul pentru POST /name-lists/preview: primeste un Buffer (CSV sau
// XLSX) si returneaza un rezumat structurat (rows + totals + sha256) fara sa
// scrie nimic in DB. /commit re-trimite items-ul validat iar repository-ul
// re-aplica validarea (defense-in-depth: clientul nu poate ocoli regulile
// modificand JSON-ul intors).
//
// Format detection: zip magic bytes (PK\003\004) → XLSX; orice altceva →
// tratat ca CSV/UTF-8. Filename-ul e doar hint; magic bytes sunt autoritar
// (cazul "user a redenumit .csv → .xlsx" e gestionat).
//
// Limite (audit plan 2026-04-29 #1 — "pin + plafon strict pe rows/cols la
// import"). Parser-ul XLSX e acum exceljs (F3 audit 2026-05-01: am scos
// `xlsx@0.18.5` din path-ul de read din cauza CVE-urilor active fara patch);
// caps-urile raman LINIA DE GARDA si pentru parser-ul nou:
//   * MAX_FILE_BYTES — primul guard, inainte de orice parsing
//   * MAX_ROWS / MAX_COLS — al doilea guard, dupa ce header-ul e citit
//   * MAX_NAME_LEN — al treilea guard, per-rind, sa nu pierdem un buffer
//                    cand un user copiaza tot un articol legal in coloana
//
// Validation rules:
//   * name_normalized = UPPERCASE + diacritic strip + collapse whitespace.
//     Defense-in-depth: parser-ul aplica UPPERCASE chiar daca clientul
//     transmite mixed-case in /commit.
//   * Reject: nume empty, < 2 chars, > 200 chars, contine doar cifre
//   * Dedup intra-fisier: name_normalized apare 1×; duplicatele primesc
//                         validation='warn' cu msg='duplicate_in_file'
//
// PF/PJ (name_kind) a fost scos din model: PortalJust SOAP CautareDosare
// primeste doar `numeParte` ca string (vezi backend/src/soap.ts:186), deci
// distinctia nu schimba query-ul si ar dubla joburile cu zero efect functional.

import crypto from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
// F3 audit (2026-05-01): migrare de la `xlsx@0.18.5` (CVE-uri active de
// Prototype Pollution + ReDoS, fara patch upstream) la `exceljs@4.x`.
// Suprafata de read e singura mutata; capurile MAX_FILE_BYTES / MAX_ROWS /
// MAX_COLS raman mitigarea principala (parser-ul nou nu schimba acel model).
import ExcelJS from "exceljs";

import { stripDiacritics } from "../util/textNormalize.ts";
import type {
  CreateListItemInput,
  NameListItemValidation,
} from "../db/nameListsRepository.ts";

// 10 MB hard cap inainte de parse (audit plan #1). Multipart layer-ul aplica
// si el limita la 10 MB; redundanta intentionata.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

// 50000 rinduri inclusiv header. ANAF / registru consilieri publica liste
// pana la cateva mii; 50000 e plafon larg cu marja sa nu surprindem.
export const MAX_ROWS = 50_000;

// 20 coloane — fisiere reale au 2-5 (nume, tip, [cnp], [cui], [institutie]).
// Plafonul previne fisierele "weaponized" cu 65k coloane care fac out-of-mem.
export const MAX_COLS = 20;

// 200 chars — match cu zod TargetNameSoap.name_normalized.max(200).
export const MAX_NAME_LEN = 200;
export const MIN_NAME_LEN = 2;

export interface ParsedRow extends CreateListItemInput {
  // Index-ul fizic in fisier (0-based, EXCLUSIV header). UI-ul il afiseaza
  // ca "Rand 42" cu offset-ul de 2 (header + 1-based) ca user-ul sa-l
  // gaseasca usor in fisierul original.
  rowIndex: number;
}

export interface ParseTotals {
  total: number;
  ok: number;
  warn: number;
  rejected: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  totals: ParseTotals;
  sha256: string;
}

export interface ParseOptions {
  /** Filename hint pentru format detection si sourceFilename pe DB. */
  filename?: string;
}

export type ParseErrorCode =
  | "FILE_TOO_LARGE"
  | "TOO_MANY_ROWS"
  | "TOO_MANY_COLS"
  | "EMPTY_FILE"
  | "MISSING_NAME_COLUMN"
  | "PARSE_ERROR";

export class ParseError extends Error {
  code: ParseErrorCode;
  constructor(code: ParseErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ParseError";
  }
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function isXlsxBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(ZIP_MAGIC);
}

// Header normalization: lowercase + strip diacritics + trim. Acceptam
// variante uzuale: "nume", "cnp", "cui". Rezultatul mapat pe cheile interne
// ne permite sa dam liber userilor sa scrie "Nume Persoana" sau "NUME".
function normalizeHeader(h: string): string {
  return stripDiacritics(String(h ?? "")).toLowerCase().trim();
}

interface HeaderMap {
  nume: number;
  cnp?: number;
  cui?: number;
  cadenceSec?: number;
  notes?: number;
}

// Cauta coloana "nume" in headere; daca lipseste → ParseError. Restul sunt
// optionale. Acceptam cateva sinonime ca toleranta de input:
//   nume ← "nume", "name", "denumire"
//   cnp         ← "cnp"
//   cui         ← "cui", "cif"
//   cadence_sec ← "cadence_sec", "cadenta", "interval"
//   notes       ← "notes", "note", "observatii"
//
// Coloana "tip" / "categorie" / "kind" e ignorata daca apare — kept-for-
// backward-compat: fisiere vechi cu coloana tip nu sunt rejectate, doar
// coloana e skipped.
function buildHeaderMap(headers: string[]): HeaderMap {
  let nume = -1;
  let cnp: number | undefined;
  let cui: number | undefined;
  let cadenceSec: number | undefined;
  let notes: number | undefined;
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeader(headers[i] ?? "");
    if (nume === -1 && (h === "nume" || h === "name" || h === "denumire")) {
      nume = i;
    } else if (cnp === undefined && h === "cnp") {
      cnp = i;
    } else if (cui === undefined && (h === "cui" || h === "cif")) {
      cui = i;
    } else if (
      cadenceSec === undefined &&
      (h === "cadence_sec" || h === "cadenta" || h === "interval")
    ) {
      cadenceSec = i;
    } else if (
      notes === undefined &&
      (h === "notes" || h === "note" || h === "observatii")
    ) {
      notes = i;
    }
  }
  if (nume === -1) {
    throw new ParseError(
      "MISSING_NAME_COLUMN",
      "Coloana 'nume' lipseste din header. Acceptate: 'nume', 'name', 'denumire'.",
    );
  }
  return { nume, cnp, cui, cadenceSec, notes };
}

// Normalizare interna a numelui: UPPERCASE + diacritic strip + collapse
// whitespace. Folosita ATAT pentru CHECK-ul de min/max chars CAT si pentru
// dedup-ul intra-fisier. Pastram name_raw exact cum a fost in fisier ca sa-l
// putem afisa in UI / log-uri.
//
// Regula UPPERCASE (2026-05-03): toate numele de monitorizare se stocheaza in
// UPPERCASE — uniform indiferent ca utilizatorul tasteaza "popescu ion" sau
// imports XLSX cu mixed case. PortalJust SOAP CautareDosare e case-insensitive
// pe numeParte, deci schimbarea nu afecteaza match-ul.
export function normalizeName(s: string): string {
  return stripDiacritics(String(s ?? ""))
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const CADENCE_LABEL_MAP: Record<string, number> = {
  "4h": 14400,
  "8h": 28800,
  "12h": 43200,
  "24h": 86400,
};

function parseCadence(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const n = CADENCE_LABEL_MAP[s] ?? Number(s);
  return Number.isInteger(n) && n >= 600 && n <= 86400 ? n : null;
}

// Reguli de validare per-rind impartite intre /preview (parseNameList) si
// /commit (validateRawItems). Reject + dedup sunt identice pe ambele cai;
// difera doar formatul mesajului de duplicat (preview = numar rand 1-based din
// fisier, commit = index 0-based din array-ul JSON).
//
// Side-effect: muteaza `seen` doar cand rindul e acceptat ca "first
// occurrence" — un rind rejected nu blocheaza dedup-ul pentru un duplicat
// valid mai tarziu.
function classifyRawName(
  nameRaw: string,
  nameNormalized: string,
  seen: Map<string, number>,
  currentIdx: number,
  formatDuplicateMsg: (prevIdx: number) => string,
): { validation: NameListItemValidation; validationMsg: string | null } {
  if (!nameRaw || nameNormalized.length === 0) {
    return { validation: "rejected", validationMsg: "nume_gol" };
  }
  if (nameNormalized.length < MIN_NAME_LEN) {
    return {
      validation: "rejected",
      validationMsg: `nume_prea_scurt (min ${MIN_NAME_LEN})`,
    };
  }
  if (nameRaw.length > MAX_NAME_LEN) {
    return {
      validation: "rejected",
      validationMsg: `nume_prea_lung (max ${MAX_NAME_LEN})`,
    };
  }
  if (/^\d+$/.test(nameNormalized.replace(/\s+/g, ""))) {
    return { validation: "rejected", validationMsg: "nume_doar_cifre" };
  }

  const prevIdx = seen.get(nameNormalized);
  if (prevIdx !== undefined) {
    return { validation: "warn", validationMsg: formatDuplicateMsg(prevIdx) };
  }
  seen.set(nameNormalized, currentIdx);
  return { validation: "ok", validationMsg: null };
}

interface RawRow {
  cells: string[];
  rowIndex: number;
}

function rowsFromCsv(buf: Buffer): RawRow[] {
  let parsed: string[][];
  try {
    parsed = parseCsv(buf, {
      // BOM-aware (XLSX-export → CSV adaugа BOM); skip-uim spatii ca user-ii
      // sa nu ne sparga validarea cu " Ion Popescu " in coloana.
      bom: true,
      trim: true,
      // Acceptam atat virgula cat si punct-virgula (Excel localizat ro-RO
      // exporta cu ;). delimiter:[",", ";"] face auto-detect per linie.
      delimiter: [",", ";"],
      // Permite linii cu numar diferit de coloane — mai bine ridicam un
      // warn per-rind decat sa rejectam tot fisierul.
      relax_column_count: true,
      // Skip rows complet goale — Excel salveaza adesea trailing rows.
      skip_empty_lines: true,
      // Hard-cap pe nr de inregistrari ca o a doua linie de aparare;
      // verificarea explicita din dispatchParse() ramane prima linie.
      to: MAX_ROWS,
    }) as string[][];
  } catch (e) {
    throw new ParseError(
      "PARSE_ERROR",
      `Eroare parse CSV: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return parsed.map((cells, i) => ({ cells, rowIndex: i }));
}

// Timeout safety belt: zip-bomb XLSX ar putea stalla parser-ul; capul de 30s
// limiteaza orice scenariu patologic. exceljs e streaming pe Node, dar
// raman guardrail-ul si pentru ca operatia e async.
const XLSX_PARSE_TIMEOUT_MS = 30_000;

// Echivalent al `String(c ?? "")` din vechiul XLSX.utils.sheet_to_json cu
// `raw:false`+`defval:""`: numerele/bool/date devin reprezentarea text a
// celulei, formula -> rezultatul calculat (sau formula stringificata daca
// nu e disponibil), rich text -> concatenarea fragmentelor.
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    // ISO short (yyyy-mm-dd) cand nu are componenta de timp; altfel ISO full.
    // Match cu output-ul "rezonabil" pe care il dadea xlsx cu raw:false: un
    // string lizibil. Header-detection / validation nu depinde de format.
    return value.toISOString();
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // CellRichTextValue: { richText: [{ text: ... }, ...] }
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: unknown }>)
        .map((part) => String(part?.text ?? ""))
        .join("");
    }
    // CellHyperlinkValue: { text, hyperlink }
    if (typeof obj.text === "string") return obj.text;
    // CellFormulaValue: { formula, result } — preferam result (raw:false-style)
    if ("result" in obj) {
      return cellToString(obj.result);
    }
    if (typeof obj.formula === "string") {
      return `=${obj.formula}`;
    }
    // CellErrorValue: { error: '#N/A' | ... }
    if (typeof obj.error === "string") return obj.error;
  }
  return String(value);
}

async function rowsFromXlsxAsync(buf: Buffer): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs declara propriul `interface Buffer extends ArrayBuffer` in
  // tipuri (mismatch cu Node Buffer); runtime-ul accepta Node Buffer fara
  // probleme. Cast-ul aici e doar un type-bridge.
  await workbook.xlsx.load(buf as unknown as ArrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new ParseError("EMPTY_FILE", "Fisierul XLSX nu contine niciun sheet.");
  }

  const out: RawRow[] = [];
  // includeEmpty:false → trimite la callback doar randurile cu macar o celula
  // populata, similar `blankrows:false` din vechiul xlsx.
  let outIdx = 0;
  let exceeded = false;
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    if (exceeded) return;
    if (outIdx >= MAX_ROWS) {
      // Nu rupem din callback (exceljs nu suporta abort), dar marcam plafonul
      // ca sa raporteze TOO_MANY_ROWS in dispatchParse.
      exceeded = true;
      return;
    }
    // row.values e 1-indexed: index 0 e mereu undefined. Convertim la 0-based.
    const raw = row.values;
    const cells: string[] = [];
    if (Array.isArray(raw)) {
      for (let i = 1; i < raw.length; i++) {
        cells.push(cellToString(raw[i]));
      }
    } else if (raw && typeof raw === "object") {
      // Cazul cu chei numeric-string sau named: ne pliem peste cellCount ca
      // sa pastram pozitiile (header indexing depinde de pozitia coloanei).
      const colCount = row.cellCount ?? 0;
      for (let i = 1; i <= colCount; i++) {
        const cell = row.getCell(i);
        cells.push(cellToString(cell.value));
      }
    }
    out.push({ cells, rowIndex: outIdx });
    outIdx++;
  });

  if (exceeded) {
    // Adaugam un sentinel (un rind in plus peste MAX_ROWS) ca dispatchParse
    // sa arunce TOO_MANY_ROWS uniform cu path-ul CSV.
    out.push({ cells: [], rowIndex: out.length });
  }

  return out;
}

function rowsFromXlsx(buf: Buffer): Promise<RawRow[]> {
  // Wrap in timeout (zip-bomb safety belt). exceljs nu expune cancellation,
  // dar promise-ul ramane in flight — este acceptabil: file-size cap-ul (10MB)
  // limiteaza memoria iar timeout-ul evita blocarea handler-ului HTTP.
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ParseError("PARSE_ERROR", "Parsing timeout"));
    }, XLSX_PARSE_TIMEOUT_MS);
  });
  return Promise.race([
    rowsFromXlsxAsync(buf).catch((e) => {
      if (e instanceof ParseError) throw e;
      throw new ParseError(
        "PARSE_ERROR",
        `Eroare parse XLSX: ${e instanceof Error ? e.message : String(e)}`,
      );
    }),
    timeoutPromise,
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Principalul entry point. Distribuie pe XLSX vs CSV in functie de magic
// bytes; aplica capurile; ruleaza validation per rind; returneaza preview-ul.
//
// Async din cauza migrarii la exceljs (F3 audit): parser-ul XLSX e
// streaming-async; CSV path-ul ramane sincron dar e wrap-uit in acelasi
// promise pentru simetrie.
export async function parseNameList(
  buf: Buffer,
  opts: ParseOptions = {},
): Promise<ParseResult> {
  if (buf.length === 0) {
    throw new ParseError("EMPTY_FILE", "Fisier gol.");
  }
  if (buf.length > MAX_FILE_BYTES) {
    throw new ParseError(
      "FILE_TOO_LARGE",
      `Fisier prea mare (${buf.length} bytes, max ${MAX_FILE_BYTES}).`,
    );
  }

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

  const rawRows = isXlsxBuffer(buf)
    ? await rowsFromXlsx(buf)
    : rowsFromCsv(buf);
  if (rawRows.length === 0) {
    throw new ParseError("EMPTY_FILE", "Fisierul nu contine niciun rand.");
  }
  if (rawRows.length > MAX_ROWS) {
    throw new ParseError(
      "TOO_MANY_ROWS",
      `Fisier are ${rawRows.length} randuri, maxim ${MAX_ROWS}.`,
    );
  }

  const headerCells = rawRows[0]?.cells ?? [];
  if (headerCells.length > MAX_COLS) {
    throw new ParseError(
      "TOO_MANY_COLS",
      `Fisier are ${headerCells.length} coloane, maxim ${MAX_COLS}.`,
    );
  }

  const headerMap = buildHeaderMap(headerCells);

  // Map-ul (nameNormalized + kind) → primul rowIndex care l-a folosit. Al
  // doilea rind cu aceeasi cheie primeste validation='warn' cu
  // msg='duplicate_in_file' (NU 'rejected' — rejected ar inseamna invalid;
  // duplicatul e tehnic valid, doar redundant; UI-ul va dezactiva check-ul
  // by default dar user-ul poate forta).
  const seen = new Map<string, number>();
  const rows: ParsedRow[] = [];
  let okCount = 0;
  let warnCount = 0;
  let rejectedCount = 0;

  for (let i = 1; i < rawRows.length; i++) {
    const cells = rawRows[i]!.cells;
    const nameRaw = String(cells[headerMap.nume] ?? "").trim();
    const cnpRaw = headerMap.cnp !== undefined
      ? String(cells[headerMap.cnp] ?? "").trim() || null
      : null;
    const cuiRaw = headerMap.cui !== undefined
      ? String(cells[headerMap.cui] ?? "").trim() || null
      : null;
    const cadenceSec = headerMap.cadenceSec !== undefined
      ? parseCadence(cells[headerMap.cadenceSec])
      : null;
    const notes = headerMap.notes !== undefined
      ? String(cells[headerMap.notes] ?? "").trim() || null
      : null;

    const nameNormalized = normalizeName(nameRaw);

    const { validation, validationMsg } = classifyRawName(
      nameRaw,
      nameNormalized,
      seen,
      i,
      (prev) => `duplicate_in_file (apare prima data la randul ${prev + 1})`,
    );

    if (validation === "ok") okCount++;
    else if (validation === "warn") warnCount++;
    else rejectedCount++;

    rows.push({
      rowIndex: i,
      nameRaw,
      nameNormalized,
      cnp: cnpRaw,
      cui: cuiRaw,
      cadenceSec,
      notes,
      validation,
      validationMsg,
    });
  }

  return {
    rows,
    totals: {
      total: rows.length,
      ok: okCount,
      warn: warnCount,
      rejected: rejectedCount,
    },
    sha256,
  };
}

// Server-side re-validation entry point pentru /commit (defense-in-depth):
// clientul trimite items raw {nameRaw, cnp?, cui?}; aici re-derivam
// name_normalized + validation + dedup independent de orice flag venit din
// UI. Decizia "ce devine job" trebuie sa fie autoritara a serverului, nu a
// clientului — un client compromis nu poate marca un rind 'rejected' ca
// 'ok' modificand JSON-ul din retea.

export interface RawNameItem {
  nameRaw: string;
  cnp?: string | null;
  cui?: string | null;
  cadenceSec?: number | null;
  notes?: string | null;
}

export interface ValidatedItem extends CreateListItemInput {
  /** 0-based pozitia in array-ul de input (NU rowIndex din fisier — clientul
   *  poate trimite items intr-o ordine diferita fata de fisierul original). */
  inputIndex: number;
}

export interface ValidateResult {
  rows: ValidatedItem[];
  totals: ParseTotals;
}

export function validateRawItems(items: RawNameItem[]): ValidateResult {
  const seen = new Map<string, number>();
  const rows: ValidatedItem[] = [];
  let okCount = 0;
  let warnCount = 0;
  let rejectedCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const nameRaw = String(item.nameRaw ?? "").trim();
    const nameNormalized = normalizeName(nameRaw);
    const cnp = item.cnp ?? null;
    const cui = item.cui ?? null;
    const cadenceSec = item.cadenceSec ?? null;
    const notes = item.notes ? String(item.notes).trim() || null : null;

    const { validation, validationMsg } = classifyRawName(
      nameRaw,
      nameNormalized,
      seen,
      i,
      (prev) => `duplicate_in_batch (apare prima data la index ${prev})`,
    );

    if (validation === "ok") okCount++;
    else if (validation === "warn") warnCount++;
    else rejectedCount++;

    rows.push({
      inputIndex: i,
      nameRaw,
      nameNormalized,
      cnp,
      cui,
      cadenceSec,
      notes,
      validation,
      validationMsg,
    });
  }

  return {
    rows,
    totals: {
      total: rows.length,
      ok: okCount,
      warn: warnCount,
      rejected: rejectedCount,
    },
  };
}
