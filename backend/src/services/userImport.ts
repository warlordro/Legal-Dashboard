// v2.42.0 (4.3): parsarea importului de utilizatori din xlsx — TOATA
// server-side. Fisierul vine raw (octet-stream) pe o ruta admin-only cu
// bodyLimit dedicat de 512KB; aici validam continutul si intoarcem randuri
// curate + issues per rand, fara sa atingem DB-ul (pre-check-ul de duplicate
// in DB si insertul tranzactional raman in ruta).

import ExcelJS from "exceljs";
import { z } from "zod";
import { canonicalizeEmail, type CreatableUserRole } from "../db/userRepository.ts";

export const MAX_IMPORT_BYTES = 512 * 1024;
export const MAX_IMPORT_ROWS = 500;
const PARSE_TIMEOUT_MS = 30_000;

export interface ParsedUserRow {
  rowNumber: number;
  email: string; // canonic
  displayName: string;
  role: CreatableUserRole;
}

export interface ImportIssue {
  rowNumber: number;
  email: string | null;
  code: "invalid_row" | "duplicate_in_file" | "duplicate_in_db";
  message: string;
}

export type ParseImportResult =
  | { ok: true; rows: ParsedUserRow[]; issues: ImportIssue[] }
  | { ok: false; code: "invalid_file" | "too_many_rows"; message: string };

// Etichete umane SI token-uri, case-insensitive; gol = user. Orice altceva e
// invalid (nu ghicim — support/readonly nu sunt creabile din import).
export function parseRoleInput(raw: string): CreatableUserRole | null {
  const v = raw.trim().toLowerCase();
  if (v === "" || v === "user" || v === "utilizator") return "user";
  if (v === "admin" || v === "administrator") return "admin";
  return null;
}

const ImportRowSchema = z.object({
  email: z.string().trim().max(254).email().transform(canonicalizeEmail),
  displayName: z.string().trim().min(1).max(120),
});

// Celulele exceljs pot fi string, numar, data, richText, hyperlink (mailto pe
// emailuri lipite din Outlook) sau formula cu result — normalizam totul la text.
// `preferMailto` (doar coloana de email): celulele-hyperlink au INTOTDEAUNA
// { text, hyperlink }, deci ramura de hyperlink de mai jos era de neatins cand
// textul exista — un paste Outlook cu text afisat NON-email ("Ion Popescu" ->
// mailto:ion@firma.ro) importa numele si pica la validare (fix duel-review
// 2026-07-09). Contractul "textul afisat castiga" se pastreaza cand textul
// arata a email (contine @) — vezi testul de contract din userImport.test.ts.
function cellToString(value: ExcelJS.CellValue, preferMailto = false): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (
      preferMailto &&
      "hyperlink" in value &&
      typeof value.hyperlink === "string" &&
      /^mailto:/i.test(value.hyperlink)
    ) {
      const displayed = "text" in value ? cellToString(value.text as ExcelJS.CellValue) : "";
      if (!displayed.includes("@")) {
        // Adresa reala e in hyperlink; parametrii mailto (?subject=...) si
        // fragmentul (#...) se taie, iar percent-encoding-ul RFC 6068 se
        // decodeaza (audit advers 2026-07-09) — best-effort, un encoding
        // invalid pastreaza stringul brut si pica la validarea de email.
        const raw = value.hyperlink.replace(/^mailto:/i, "").split(/[?#]/)[0] ?? "";
        try {
          return decodeURIComponent(raw);
        } catch {
          return raw;
        }
      }
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("");
    }
    if ("text" in value && value.text !== undefined) return cellToString(value.text as ExcelJS.CellValue);
    if ("result" in value && value.result !== undefined) return cellToString(value.result as ExcelJS.CellValue);
    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      return value.hyperlink.replace(/^mailto:/i, "");
    }
  }
  return "";
}

export async function parseUserImport(buffer: Buffer): Promise<ParseImportResult> {
  // 1. Magic bytes ZIP (xlsx = arhiva ZIP): respinge devreme CSV/HTML/binaruri
  //    redenumite, inainte sa atingem exceljs.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    return { ok: false, code: "invalid_file", message: "Fisierul nu este un .xlsx valid." };
  }
  if (buffer.length > MAX_IMPORT_BYTES) {
    return { ok: false, code: "invalid_file", message: "Fisierul depaseste limita de 512KB." };
  }

  const workbook = new ExcelJS.Workbook();
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    // Comentariu onest: race-ul elibereaza handlerul HTTP dupa 30s, dar NU
    // opreste parsarea exceljs pornita in fundal. Apararea reala impotriva
    // fisierelor ostile e capul de 512KB + ruta admin-only.
    await Promise.race([
      workbook.xlsx.load(buffer as unknown as ArrayBuffer),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("parse timeout")), PARSE_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    // O linie de diagnostic server-side — altfel "user a trimis junk" si
    // "regresie de parser" sunt indistinguibile din raspunsul sanitizat.
    console.error("[userImport] xlsx parse failed:", err instanceof Error ? err.message : err);
    return { ok: false, code: "invalid_file", message: "Fisierul nu a putut fi citit ca .xlsx." };
  } finally {
    clearTimeout(timeoutHandle);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { ok: false, code: "invalid_file", message: "Fisierul nu contine niciun sheet." };
  }

  // Colectam randurile non-goale in ordinea din sheet (eachRow sare peste cele
  // complet goale), pastrand numarul de rand din Excel pentru raportare.
  const rawRows: { rowNumber: number; cells: string[] }[] = [];
  sheet.eachRow((row, rowNumber) => {
    const cells: string[] = [];
    for (let col = 1; col <= 3; col++) {
      // preferMailto DOAR pe coloana 1 (email) — un "Nume afisat" cu link nu
      // trebuie inlocuit cu adresa/URL-ul.
      cells.push(cellToString(row.getCell(col).value, col === 1).trim());
    }
    if (cells.some((cell) => cell !== "")) {
      rawRows.push({ rowNumber, cells });
    }
  });

  // Detectia headerului: prima celula EXACT egala cu "email" dupa canonicalize.
  // NU `.includes("email")` — un prim rand de date cu "contact@email.com" ar fi
  // aruncat silentios (capcana confirmata in review 5/5).
  const hasHeader = rawRows.length > 0 && canonicalizeEmail(rawRows[0].cells[0]) === "email";
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;

  // Cap de randuri DATE — verificat DUPA slice, ca headerul sa nu se numere.
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      code: "too_many_rows",
      message: `Fisierul are ${dataRows.length} randuri de date; maximul este ${MAX_IMPORT_ROWS}.`,
    };
  }

  const rows: ParsedUserRow[] = [];
  const issues: ImportIssue[] = [];
  const seenEmails = new Set<string>();

  for (const { rowNumber, cells } of dataRows) {
    const [rawEmail, rawName, rawRole] = cells;

    const role = parseRoleInput(rawRole);
    if (role === null) {
      issues.push({
        rowNumber,
        email: rawEmail || null,
        code: "invalid_row",
        message: `Rol necunoscut: "${rawRole}". Foloseste "Utilizator" sau "Admin".`,
      });
      continue;
    }

    const parsed = ImportRowSchema.safeParse({ email: rawEmail, displayName: rawName });
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const field = firstIssue?.path[0] === "displayName" ? "Nume afisat" : "Email";
      issues.push({
        rowNumber,
        email: rawEmail || null,
        code: "invalid_row",
        message: `${field} invalid.`,
      });
      continue;
    }

    // Dedup in-fisier pe email canonic: primul rand castiga, restul devin issues.
    if (seenEmails.has(parsed.data.email)) {
      issues.push({
        rowNumber,
        email: parsed.data.email,
        code: "duplicate_in_file",
        message: "Email duplicat in fisier (primul rand a fost pastrat).",
      });
      continue;
    }
    seenEmails.add(parsed.data.email);

    rows.push({ rowNumber, email: parsed.data.email, displayName: parsed.data.displayName, role });
  }

  return { ok: true, rows, issues };
}

// Template-ul de import: sheet "Utilizatori" cu header + validare LIST pe
// coloana Rol (etichete umane) si sheet "Instructiuni".
export async function buildImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet("Utilizatori");
  sheet.columns = [
    { header: "Email", key: "email", width: 36 },
    { header: "Nume afisat", key: "displayName", width: 28 },
    { header: "Rol", key: "role", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (let rowNumber = 2; rowNumber <= MAX_IMPORT_ROWS + 1; rowNumber++) {
    sheet.getCell(`C${rowNumber}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Utilizator,Admin"'],
      showErrorMessage: true,
      errorTitle: "Rol invalid",
      error: "Alege Utilizator sau Admin.",
    };
  }

  const info = workbook.addWorksheet("Instructiuni");
  info.getColumn(1).width = 90;
  const lines = [
    'Completeaza sheet-ul "Utilizatori" — un rand per utilizator.',
    "Email: adresa Google Workspace cu care utilizatorul se va loga (obligatoriu).",
    "Nume afisat: numele afisat in aplicatie (obligatoriu, 1-120 caractere).",
    "Rol: Utilizator sau Admin. Gol = Utilizator.",
    `Maxim ${MAX_IMPORT_ROWS} randuri de date per fisier; dimensiune maxima 512KB.`,
    "Emailurile duplicate (in fisier sau deja existente) sunt raportate si sarite.",
  ];
  lines.forEach((line, idx) => {
    info.getCell(`A${idx + 1}`).value = line;
  });

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
