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
// XLSX dropdown: SheetJS Community (`xlsx` 0.18.5) nu scrie dataValidations,
// deci post-procesam fisierul: unzip → injecteaza <dataValidations> in
// xl/worksheets/sheet1.xml → rezip. Folosim `fflate` (~8KB, tree-shakeable),
// deja prezent ca tranzitiv via xlsx-js-style.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import * as XLSX from "xlsx";

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

// Injecteaza un <dataValidation type="list"> peste C2:C1000 (coloana cadence)
// in sheet1.xml. OOXML cere ca <dataValidations> sa apara DUPA <sheetData> /
// <conditionalFormatting>, dar INAINTE de <pageMargins>; fallback la inainte
// de </worksheet> daca <pageMargins> lipseste.
function injectCadenceDropdown(xlsxBytes: Uint8Array): Uint8Array {
  const unzipped = unzipSync(xlsxBytes);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const sheetBytes = unzipped[sheetPath];
  if (!sheetBytes) return xlsxBytes; // unexpected — fail soft

  const sheetXml = strFromU8(sheetBytes);
  const formula = CADENCE_LABELS.join(",");
  // Quotes in <formula1> sunt escaped ca &quot; — lista in-cell e
  // `"4h,8h,12h,24h"` (cu ghilimele literale incluse).
  const dv =
    '<dataValidations count="1">' +
    '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="C2:C1000">' +
    `<formula1>&quot;${formula}&quot;</formula1>` +
    "</dataValidation>" +
    "</dataValidations>";

  let modified: string;
  if (sheetXml.includes("<pageMargins")) {
    modified = sheetXml.replace("<pageMargins", `${dv}<pageMargins`);
  } else {
    modified = sheetXml.replace("</worksheet>", `${dv}</worksheet>`);
  }

  unzipped[sheetPath] = strToU8(modified);
  return zipSync(unzipped);
}

export function downloadBulkTemplate(): void {
  const data: (string | number)[][] = [
    ["numar_dosar", "nume", "cadence_sec", "notes"],
    ["1234/180/2024", "", "4h", "Client X — apel"],
    ["9012/3/2024/a1", "", "24h", "Verificare zilnica"],
    ["", "POPESCU ION", "24h", "Subiect — alerta dosare noi"],
    ["", "SC EXAMPLE SRL BUCURESTI", "24h", "Mai multe variante de scriere → alerta agregata"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    { wch: 22 },
    { wch: 32 },
    { wch: 14 },
    { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Monitorizare");

  const arrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const withDropdown = injectCadenceDropdown(new Uint8Array(arrayBuffer));
  // Copy into a fresh ArrayBuffer (not SharedArrayBuffer) to satisfy Blob's
  // BlobPart type — fflate's Uint8Array can be backed by ArrayBufferLike.
  const out = new Uint8Array(withDropdown.byteLength);
  out.set(withDropdown);

  const blob = new Blob([out.buffer], {
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

export function parseBulkFile(buffer: ArrayBuffer, fileName: string): ParseResult {
  const isCsv = /\.csv$/i.test(fileName);
  const wb = isCsv
    ? XLSX.read(new TextDecoder("utf-8").decode(new Uint8Array(buffer)), { type: "string" })
    : XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const valid: BulkRow[] = [];
  const invalid: BulkRowInvalid[] = [];
  if (!sheet) return { valid, invalid };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  rows.forEach((r, idx) => {
    const rowNumber = idx + 2;
    const cadenceFinal = parseCadence(r.cadence_sec);
    const notes = String(r.notes ?? "").trim() || undefined;

    const numarDosar = String(r.numar_dosar ?? "").trim();
    // Sinonime tolerante pentru coloana de nume (template nostru = "nume",
    // dar acceptam si "name_normalized" / "denumire" ca user-ii sa nu fie
    // blocati daca refolosesc un export vechi).
    const nameNorm = String(
      r.nume ?? r.name_normalized ?? r.denumire ?? "",
    ).trim();

    if (!numarDosar && !nameNorm) {
      return; // empty row — skip silently
    }

    if (numarDosar && nameNorm) {
      invalid.push({
        rowNumber,
        display: `${numarDosar} / ${nameNorm}`,
        message:
          "Ambele coloane sunt populate. Un rand = un job: pune numar_dosar SAU nume, nu ambele.",
      });
      return;
    }

    if (numarDosar) {
      valid.push({
        rowNumber,
        kind: "dosar",
        numar_dosar: numarDosar,
        cadence_sec: cadenceFinal,
        notes,
      });
      return;
    }

    valid.push({
      rowNumber,
      kind: "nume",
      name_normalized: nameNorm,
      cadence_sec: cadenceFinal,
      notes,
    });
  });
  return { valid, invalid };
}
