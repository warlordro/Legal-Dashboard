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
// import"). xlsx@0.18.5 are CVE-uri cunoscute pentru fisiere malicioase;
// caps-urile sunt mitigarea documentata. Migration la exceljs sta inca in
// roadmap pentru PR-7+, dar pana atunci aceste limite sunt LINIA DE GARDA:
//   * MAX_FILE_BYTES — primul guard, inainte de orice parsing
//   * MAX_ROWS / MAX_COLS — al doilea guard, dupa ce header-ul e citit
//   * MAX_NAME_LEN — al treilea guard, per-rind, sa nu pierdem un buffer
//                    cand un user copiaza tot un articol legal in coloana
//
// Validation rules:
//   * name_normalized = lowercase + diacritic strip + collapse whitespace
//   * Reject: nume empty, < 2 chars, > 200 chars, contine doar cifre
//   * Dedup intra-fisier: name_normalized apare 1×; duplicatele primesc
//                         validation='warn' cu msg='duplicate_in_file'
//
// PF/PJ (name_kind) a fost scos din model: PortalJust SOAP CautareDosare
// primeste doar `numeParte` ca string (vezi backend/src/soap.ts:186), deci
// distinctia nu schimba query-ul si ar dubla joburile cu zero efect functional.

import crypto from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
// xlsx 0.18.5 expune o suprafata de tip module dar are issue-uri cu ESM
// strict. Importul cu * as ne lasa sa apelam .read direct (este pe modul).
import * as XLSX from "xlsx";

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
}

// Cauta coloana "nume" in headere; daca lipseste → ParseError. Restul sunt
// optionale. Acceptam cateva sinonime ca toleranta de input:
//   nume ← "nume", "name", "denumire"
//   cnp  ← "cnp"
//   cui  ← "cui", "cif"
//
// Coloana "tip" / "categorie" / "kind" e ignorata daca apare — kept-for-
// backward-compat: fisiere vechi cu coloana tip nu sunt rejectate, doar
// coloana e skipped.
function buildHeaderMap(headers: string[]): HeaderMap {
  let nume = -1;
  let cnp: number | undefined;
  let cui: number | undefined;
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeader(headers[i] ?? "");
    if (nume === -1 && (h === "nume" || h === "name" || h === "denumire")) {
      nume = i;
    } else if (cnp === undefined && h === "cnp") {
      cnp = i;
    } else if (cui === undefined && (h === "cui" || h === "cif")) {
      cui = i;
    }
  }
  if (nume === -1) {
    throw new ParseError(
      "MISSING_NAME_COLUMN",
      "Coloana 'nume' lipseste din header. Acceptate: 'nume', 'name', 'denumire'.",
    );
  }
  return { nume, cnp, cui };
}

// Normalizare interna a numelui: lowercase + diacritic strip + collapse
// whitespace. Folosita ATAT pentru CHECK-ul de min/max chars CAT si pentru
// dedup-ul intra-fisier. Pastram name_raw exact cum a fost in fisier ca sa-l
// putem afisa in UI / log-uri.
export function normalizeName(s: string): string {
  return stripDiacritics(String(s ?? ""))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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

function rowsFromXlsx(buf: Buffer): RawRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buf, {
      type: "buffer",
      // Disable formula calc (we only read values) si codepage 1252 ca
      // fallback — fisierele export-ate din Excel ro-RO uneori sunt CP1252.
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      sheetRows: MAX_ROWS,
    });
  } catch (e) {
    throw new ParseError(
      "PARSE_ERROR",
      `Eroare parse XLSX: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new ParseError("EMPTY_FILE", "Fisierul XLSX nu contine niciun sheet.");
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new ParseError("EMPTY_FILE", "Sheet-ul principal este gol.");
  }

  // sheet_to_json cu header:1 returneaza array-of-arrays (nu obiecte). Mai
  // robust pentru fisiere cu headere ne-uniforme (lipsesc, dubluri etc).
  // raw:false → toate valorile vin ca string (nu mixed number/boolean).
  // defval:"" → celulele goale → "" (in loc de undefined, care strica index).
  const arr = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  return arr.map((cells, i) => ({
    cells: Array.isArray(cells) ? cells.map((c) => String(c ?? "")) : [],
    rowIndex: i,
  }));
}

// Principalul entry point. Distribuie pe XLSX vs CSV in functie de magic
// bytes; aplica capurile; ruleaza validation per rind; returneaza preview-ul.
export function parseNameList(buf: Buffer, opts: ParseOptions = {}): ParseResult {
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

  const rawRows = isXlsxBuffer(buf) ? rowsFromXlsx(buf) : rowsFromCsv(buf);
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

    const nameNormalized = normalizeName(nameRaw);

    let validation: NameListItemValidation = "ok";
    let validationMsg: string | null = null;

    // 1. Reject conditions (cea mai stricta categorie).
    if (!nameRaw || nameNormalized.length === 0) {
      validation = "rejected";
      validationMsg = "nume_gol";
    } else if (nameNormalized.length < MIN_NAME_LEN) {
      validation = "rejected";
      validationMsg = `nume_prea_scurt (min ${MIN_NAME_LEN})`;
    } else if (nameRaw.length > MAX_NAME_LEN) {
      validation = "rejected";
      validationMsg = `nume_prea_lung (max ${MAX_NAME_LEN})`;
    } else if (/^\d+$/.test(nameNormalized.replace(/\s+/g, ""))) {
      validation = "rejected";
      validationMsg = "nume_doar_cifre";
    }

    // 2. Daca a trecut de reject, verificam dedup intra-fisier dupa
    //    name_normalized. Aceeasi denumire la doua randuri = duplicat,
    //    indiferent de capitalizare/diacritice (normalize aplica fold).
    if (validation !== "rejected") {
      const prevIdx = seen.get(nameNormalized);
      if (prevIdx !== undefined) {
        validation = "warn";
        validationMsg = `duplicate_in_file (apare prima data la randul ${prevIdx + 1})`;
      } else {
        seen.set(nameNormalized, i);
      }
    }

    if (validation === "ok") okCount++;
    else if (validation === "warn") warnCount++;
    else rejectedCount++;

    rows.push({
      rowIndex: i,
      nameRaw,
      nameNormalized,
      cnp: cnpRaw,
      cui: cuiRaw,
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

    let validation: NameListItemValidation = "ok";
    let validationMsg: string | null = null;

    // 1. Reject conditions — match exact fata de parseNameList.
    if (!nameRaw || nameNormalized.length === 0) {
      validation = "rejected";
      validationMsg = "nume_gol";
    } else if (nameNormalized.length < MIN_NAME_LEN) {
      validation = "rejected";
      validationMsg = `nume_prea_scurt (min ${MIN_NAME_LEN})`;
    } else if (nameRaw.length > MAX_NAME_LEN) {
      validation = "rejected";
      validationMsg = `nume_prea_lung (max ${MAX_NAME_LEN})`;
    } else if (/^\d+$/.test(nameNormalized.replace(/\s+/g, ""))) {
      validation = "rejected";
      validationMsg = "nume_doar_cifre";
    }

    // 2. Dedup intra-batch — cheie identica cu parseNameList: name_normalized.
    //    Asta garanteaza ca daca userul re-trimite acelasi fisier (parsat →
    //    JSON → POST), dedup-ul produce acelasi efect ca preview-ul.
    if (validation !== "rejected") {
      const prevIdx = seen.get(nameNormalized);
      if (prevIdx !== undefined) {
        validation = "warn";
        validationMsg = `duplicate_in_batch (apare prima data la index ${prevIdx})`;
      } else {
        seen.set(nameNormalized, i);
      }
    }

    if (validation === "ok") okCount++;
    else if (validation === "warn") warnCount++;
    else rejectedCount++;

    rows.push({
      inputIndex: i,
      nameRaw,
      nameNormalized,
      cnp,
      cui,
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
