import ExcelJS from "exceljs";
import { z } from "zod";
import { CREATABLE_USER_ROLES, canonicalizeEmail, type UserRole } from "../db/userRepository.ts";
import { cellToString } from "./nameListParser.ts";

// v2.42.0 (PLAN-web-ux-etapa2.md, E2-A2): template + parsare pentru importul
// de utilizatori din xlsx. Parsarea e server-side (nu avem incredere in parser
// client pe fisiere de la useri — acelasi motiv ca nameListParser).

export const MAX_IMPORT_BYTES = 512 * 1024;
export const MAX_IMPORT_ROWS = 500;
const PARSE_TIMEOUT_MS = 30_000;
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DATA_SHEET = "Utilizatori";
const INSTRUCTIONS_SHEET = "Instructiuni";

// Schema COMUNA de creare user — folosita de POST /admin/users (individual)
// si de fiecare rand din import. Un singur loc pentru email/nume/rol.
export const CreateUserSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(254, "Emailul depaseste 254 de caractere.")
      .email("Email invalid.")
      .transform(canonicalizeEmail),
    displayName: z
      .string()
      .trim()
      .min(1, "Numele afisat este obligatoriu.")
      .max(120, "Numele depaseste 120 caractere."),
    role: z.enum(CREATABLE_USER_ROLES),
  })
  .strict();

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// UI-ul afiseaza rolurile ca "Utilizator"/"Admin" — template-ul si importul
// vorbesc aceeasi limba: acceptam si etichetele umane, si token-urile interne
// (case-insensitive), gol = Utilizator. Dropdown-ul din template foloseste
// etichetele umane.
export const ROLE_LABELS: Record<(typeof CREATABLE_USER_ROLES)[number], string> = {
  user: "Utilizator",
  admin: "Admin",
};

const ROLE_ALIASES: Record<string, UserRole> = {
  user: "user",
  utilizator: "user",
  admin: "admin",
  administrator: "admin",
};

export function parseRoleInput(raw: string): UserRole | null {
  const key = canonicalizeEmail(raw); // trim + lowercase (refolosim normalizatorul)
  if (key === "") return "user";
  return ROLE_ALIASES[key] ?? null;
}

export class UserImportError extends Error {
  readonly code: "invalid_file" | "too_many_rows" | "empty_file";
  constructor(code: "invalid_file" | "too_many_rows" | "empty_file", message: string) {
    super(message);
    this.name = "UserImportError";
    this.code = code;
  }
}

export interface ImportRowValid {
  rowNumber: number; // randul din sheet (1-based, asa cum il vede userul in Excel)
  email: string; // canonic
  displayName: string;
  role: UserRole;
}

export interface ImportRowIssue {
  rowNumber: number;
  email: string; // ce s-a putut citi (canonic daca parsabil), pentru raport
  // duplicate_in_db se adauga la nivel de ruta (check-ul DB nu e treaba parserului).
  status: "duplicate_in_file" | "duplicate_in_db" | "invalid";
  reason: string;
}

export interface ParsedImport {
  valid: ImportRowValid[];
  issues: ImportRowIssue[];
}

// Template descarcabil: sheet-ul de date DOAR cu header (un rand exemplu ar fi
// importat din greseala — review-panel); exemplul si regulile stau in sheet-ul
// "Instructiuni", pe care importul il ignora complet.
export async function buildUserImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const data = wb.addWorksheet(DATA_SHEET);
  data.columns = [
    { header: "Email", key: "email", width: 36 },
    { header: "Nume afisat", key: "displayName", width: 28 },
    { header: "Rol", key: "role", width: 12 },
  ];
  data.getRow(1).font = { bold: true };

  // Dropdown blocat pe coloana Rol (data validation tip lista, stop pe valori
  // din afara listei) — userul alege dintre etichetele umane, nu tasteaza
  // token-uri interne. Acoperim toate randurile posibile (cap + header).
  const roleList = `"${Object.values(ROLE_LABELS).join(",")}"`;
  for (let r = 2; r <= MAX_IMPORT_ROWS + 1; r++) {
    data.getCell(`C${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [roleList],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Rol invalid",
      error: "Alege din lista: Utilizator sau Admin (gol = Utilizator).",
    };
  }

  const instr = wb.addWorksheet(INSTRUCTIONS_SHEET);
  instr.columns = [{ width: 100 }];
  instr.addRows([
    ["Completeaza sheet-ul 'Utilizatori' incepand cu randul 2. Acest sheet ('Instructiuni') este ignorat la import."],
    ["Email: adresa Google cu care utilizatorul se va loga (obligatoriu)."],
    ["Nume afisat: numele vizibil in aplicatie (obligatoriu)."],
    ['Rol: alege din lista "Utilizator" sau "Admin". Lasat gol = Utilizator.'],
    [""],
    ["Exemplu de rand:  ana@firma.ro  |  Ana Pop  |  Utilizator"],
    [`Limita: maximum ${MAX_IMPORT_ROWS} de randuri per fisier.`],
  ]);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as unknown as ArrayBuffer);
}

async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  if (buf.length < ZIP_MAGIC.length || !buf.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    throw new UserImportError("invalid_file", "Fisierul nu este .xlsx. Foloseste template-ul descarcat din aplicatie.");
  }
  const wb = new ExcelJS.Workbook();
  // Timeout safety belt: elibereaza HANDLER-UL dupa 30s, dar NU opreste
  // parsarea exceljs din fundal (Promise.race nu anuleaza; review-panel) —
  // un zip patologic poate continua sa consume CPU pana termina. Apararea
  // reala e MAX_IMPORT_BYTES (512KB) + ruta admin-only; izolarea in worker
  // terminabil nu-si justifica complexitatea la aceasta suprafata.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new UserImportError("invalid_file", "Parsarea fisierului a expirat.")),
      PARSE_TIMEOUT_MS
    );
  });
  try {
    await Promise.race([
      wb.xlsx.load(buf as unknown as ArrayBuffer).catch((e) => {
        throw new UserImportError(
          "invalid_file",
          `Fisier corupt sau format neasteptat: ${e instanceof Error ? e.message : String(e)}`
        );
      }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return wb;
}

function looksLikeHeader(cells: string[]): boolean {
  // Potrivire EXACTA pe eticheta de header — .includes("email") trata ca
  // header (si arunca silentios) un prim rand de DATE al carui email continea
  // substringul, ex. "contact@email.com" (review-panel, consens 5/5).
  return canonicalizeEmail(cells[0] ?? "") === "email";
}

// Pipeline determinist (plan E2-A2): citire -> canonicalizare -> validare pe
// schema comuna -> dedup in-fisier. Verificarea vs DB si insertul raman la
// ruta (repository-only DB access).
export async function parseUserImportFile(buf: Buffer): Promise<ParsedImport> {
  const wb = await loadWorkbook(buf);
  const sheet =
    wb.getWorksheet(DATA_SHEET) ?? wb.worksheets.find((ws) => ws.name !== INSTRUCTIONS_SHEET) ?? wb.worksheets[0];
  if (!sheet) {
    throw new UserImportError("empty_file", "Fisierul nu contine niciun sheet.");
  }

  const rawRows: Array<{ rowNumber: number; cells: string[] }> = [];
  let exceeded = false;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (exceeded) return;
    // +1 pentru header: capul e pe randurile de DATE.
    if (rawRows.length > MAX_IMPORT_ROWS) {
      exceeded = true;
      return;
    }
    const raw = row.values;
    const cells: string[] = [];
    if (Array.isArray(raw)) {
      // row.values e 1-indexed; index 0 e mereu undefined.
      for (let i = 1; i < raw.length; i++) cells.push(cellToString(raw[i]));
    }
    rawRows.push({ rowNumber, cells });
  });

  // Header-ul (daca exista) nu conteaza la cap.
  const dataRows = rawRows.length > 0 && looksLikeHeader(rawRows[0].cells) ? rawRows.slice(1) : rawRows;
  if (exceeded || dataRows.length > MAX_IMPORT_ROWS) {
    throw new UserImportError("too_many_rows", `Fisierul depaseste limita de ${MAX_IMPORT_ROWS} randuri.`);
  }
  if (dataRows.length === 0) {
    throw new UserImportError("empty_file", "Fisierul nu contine niciun rand de date sub header.");
  }

  const valid: ImportRowValid[] = [];
  const issues: ImportRowIssue[] = [];
  const seen = new Set<string>();

  for (const { rowNumber, cells } of dataRows) {
    const emailRaw = cells[0] ?? "";
    const displayNameRaw = cells[1] ?? "";
    const role = parseRoleInput(cells[2] ?? ""); // accepta "Utilizator"/"Admin" si "user"/"admin"; gol => user
    const emailForReport = canonicalizeEmail(emailRaw);

    if (role === null) {
      issues.push({
        rowNumber,
        email: emailForReport,
        status: "invalid",
        reason: `Rol necunoscut "${cells[2]?.trim()}" — valorile valide sunt: ${Object.values(ROLE_LABELS).join(", ")} (gol = Utilizator).`,
      });
      continue;
    }
    const parsed = CreateUserSchema.safeParse({ email: emailRaw, displayName: displayNameRaw, role });
    if (!parsed.success) {
      issues.push({
        rowNumber,
        email: emailForReport,
        status: "invalid",
        reason: parsed.error.issues.map((i) => i.message).join(" "),
      });
      continue;
    }
    if (seen.has(parsed.data.email)) {
      issues.push({
        rowNumber,
        email: parsed.data.email,
        status: "duplicate_in_file",
        reason: "Email duplicat in fisier — doar prima aparitie se importa.",
      });
      continue;
    }
    seen.add(parsed.data.email);
    valid.push({ rowNumber, ...parsed.data });
  }

  return { valid, issues };
}
