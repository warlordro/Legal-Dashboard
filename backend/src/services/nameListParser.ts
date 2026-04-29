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
// Validation rules (PLAN-monitoring-webmode.md §5.2 L460-464):
//   * name_normalized = lowercase + diacritic strip + collapse whitespace
//   * name_kind: 'fizic' | 'juridic'; lipsa → 'fizic' + validation='warn'
//   * Reject: nume empty, < 2 chars, > 200 chars, contine doar cifre
//   * Dedup intra-fisier: (name_normalized, name_kind) apare 1×; duplicatele
//                         primesc validation='warn' cu msg='duplicate_in_file'

import crypto from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
// xlsx 0.18.5 expune o suprafata de tip module dar are issue-uri cu ESM
// strict. Importul cu * as ne lasa sa apelam .read direct (este pe modul).
import * as XLSX from "xlsx";

import { stripDiacritics } from "../util/textNormalize.ts";
import type {
  CreateListItemInput,
  NameListItemKind,
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
// variante uzuale: "nume", "tip", "categorie", "cnp", "cui", "institutie".
// Rezultatul mapat pe cheile interne ne permite sa dam liber userilor sa
// scrie "Nume Persoana", "Tip persoana" sau "TIP".
function normalizeHeader(h: string): string {
  return stripDiacritics(String(h ?? "")).toLowerCase().trim();
}

interface HeaderMap {
  nume: number;
  tip?: number;
  cnp?: number;
  cui?: number;
}

// Cauta coloana "nume" in headere; daca lipseste → ParseError. Restul sunt
// optionale. Acceptam cateva sinonime ca toleranta de input:
//   nume      ← "nume", "name", "denumire"
//   tip       ← "tip", "categorie", "kind"
//   cnp       ← "cnp"
//   cui       ← "cui", "cif"
function buildHeaderMap(headers: string[]): HeaderMap {
  let nume = -1;
  let tip: number | undefined;
  let cnp: number | undefined;
  let cui: number | undefined;
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeader(headers[i] ?? "");
    if (nume === -1 && (h === "nume" || h === "name" || h === "denumire")) {
      nume = i;
    } else if (tip === undefined && (h === "tip" || h === "categorie" || h === "kind")) {
      tip = i;
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
  return { nume, tip, cnp, cui };
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

// Determina name_kind dintr-o celula text. Acceptam variante uzuale:
// 'fizic' / 'pf' / 'persoana fizica' → fizic
// 'juridic' / 'pj' / 'persoana juridica' / 'societate' → juridic
// Necunoscut sau gol → undefined (caller seteaza default + warn).
function parseTip(raw: string): NameListItemKind | undefined {
  const norm = normalizeHeader(raw);
  if (!norm) return undefined;
  if (norm === "fizic" || norm === "pf" || norm === "persoana fizica" || norm === "persoanafizica") {
    return "fizic";
  }
  if (
    norm === "juridic" || norm === "pj" || norm === "persoana juridica" ||
    norm === "persoanajuridica" || norm === "societate"
  ) {
    return "juridic";
  }
  return undefined;
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
    const tipRaw = headerMap.tip !== undefined
      ? String(cells[headerMap.tip] ?? "")
      : "";
    const cnpRaw = headerMap.cnp !== undefined
      ? String(cells[headerMap.cnp] ?? "").trim() || null
      : null;
    const cuiRaw = headerMap.cui !== undefined
      ? String(cells[headerMap.cui] ?? "").trim() || null
      : null;

    const nameNormalized = normalizeName(nameRaw);
    const tipParsed = parseTip(tipRaw);

    let validation: NameListItemValidation = "ok";
    let validationMsg: string | null = null;
    let nameKind: NameListItemKind = tipParsed ?? "fizic";

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

    // 2. Daca a trecut de reject, verificam dedup intra-fisier. Cheia e
    //    (nameNormalized, nameKind) — duplicate cu acelasi nume dar tip
    //    diferit raman ambele (caz legitim: PF si PJ cu aceeasi denumire,
    //    e.g. "Stefan Ion" PF + "Stefan Ion SRL" PJ ar normaliza altfel,
    //    dar aceeasi denumire fara distinctie SRL ar fi totusi cazuri rare).
    if (validation !== "rejected") {
      const key = `${nameNormalized}|${nameKind}`;
      const prevIdx = seen.get(key);
      if (prevIdx !== undefined) {
        validation = "warn";
        validationMsg = `duplicate_in_file (apare prima data la randul ${prevIdx + 1})`;
      } else {
        seen.set(key, i);
      }
    }

    // 3. Tip lipsa → warn dar nu rejected (default fizic).
    if (validation === "ok" && tipParsed === undefined && tipRaw.trim()) {
      // Header-ul are coloana tip dar valoarea nu se mapeaza pe fizic/juridic.
      validation = "warn";
      validationMsg = `tip_necunoscut (presupus 'fizic')`;
    } else if (validation === "ok" && headerMap.tip === undefined) {
      // Nu exista coloana tip in fisier → warn la fiecare rind.
      validation = "warn";
      validationMsg = "tip_lipsa (presupus 'fizic')";
    } else if (validation === "ok" && tipParsed === undefined) {
      // Coloana tip exista dar e goala pe acest rind.
      validation = "warn";
      validationMsg = "tip_gol (presupus 'fizic')";
    }

    if (validation === "ok") okCount++;
    else if (validation === "warn") warnCount++;
    else rejectedCount++;

    rows.push({
      rowIndex: i,
      nameKind,
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
