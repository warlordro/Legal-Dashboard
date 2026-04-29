// Bulk-import template + parser shared by the Monitorizare bulk-upload UI and
// (later, PR-5) the name-list import flow. Supports both `dosar_soap` and
// `name_soap` rows in a single XLSX/CSV.

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
  name_kind: "fizic" | "juridic";
  institutie?: string[];
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

export function downloadBulkTemplate(): void {
  const data: (string | number)[][] = [
    ["kind", "numar_dosar", "name_normalized", "name_kind", "institutie", "cadence_sec", "notes"],
    ["dosar", "1234/180/2024", "", "", "", 14400, "Client X — apel"],
    ["dosar", "9012/3/2024/a1", "", "", "", 86400, "Verificare zilnica"],
    ["nume", "", "POPESCU ION", "fizic", "", 86400, "Subiect — alerta dosare noi"],
    ["nume", "", "SC EXAMPLE SRL BUCURESTI", "juridic", "CurteadeApelBUCURESTI, TribunalulBucuresti", 86400, "Mai multe institutii separate prin virgula"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    { wch: 8 },
    { wch: 22 },
    { wch: 32 },
    { wch: 12 },
    { wch: 28 },
    { wch: 14 },
    { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Monitorizare");
  XLSX.writeFile(wb, "monitorizare-template.xlsx");
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
    const cadenceRaw = r.cadence_sec;
    const cadence_sec = typeof cadenceRaw === "number"
      ? cadenceRaw
      : cadenceRaw && String(cadenceRaw).trim()
        ? Number(String(cadenceRaw).trim())
        : undefined;
    const cadenceFinal = Number.isFinite(cadence_sec) ? cadence_sec : undefined;
    const notes = String(r.notes ?? "").trim() || undefined;

    // Backward compat: if `kind` column is missing, treat as dosar (matches v1 template).
    const kindRaw = String(r.kind ?? "").trim().toLowerCase();
    const numarDosar = String(r.numar_dosar ?? "").trim();
    const nameNorm = String(r.name_normalized ?? "").trim();

    let kind: BulkKind;
    if (kindRaw === "dosar" || kindRaw === "nume") {
      kind = kindRaw;
    } else if (kindRaw === "" && numarDosar) {
      kind = "dosar";
    } else if (kindRaw === "" && nameNorm) {
      kind = "nume";
    } else if (kindRaw === "" && !numarDosar && !nameNorm) {
      return; // empty row — skip silently
    } else {
      invalid.push({
        rowNumber,
        display: numarDosar || nameNorm || "(gol)",
        message: `kind invalid: '${kindRaw}' (asteptat: dosar / nume)`,
      });
      return;
    }

    if (kind === "dosar") {
      if (!numarDosar) {
        invalid.push({ rowNumber, display: "(gol)", message: "numar_dosar lipseste" });
        return;
      }
      valid.push({
        rowNumber,
        kind: "dosar",
        numar_dosar: numarDosar,
        cadence_sec: cadenceFinal,
        notes,
      });
    } else {
      if (!nameNorm) {
        invalid.push({ rowNumber, display: "(gol)", message: "name_normalized lipseste" });
        return;
      }
      const nameKindRaw = String(r.name_kind ?? "").trim().toLowerCase();
      if (nameKindRaw !== "fizic" && nameKindRaw !== "juridic") {
        invalid.push({
          rowNumber,
          display: nameNorm,
          message: `name_kind invalid: '${nameKindRaw}' (asteptat: fizic / juridic)`,
        });
        return;
      }
      // Bulk-template institutie cell: comma-separated codes (e.g.
      // "CurteadeApelBUCURESTI, TribunalulBucuresti"). Empty cell = all institutii.
      const institutieRaw = String(r.institutie ?? "").trim();
      const institutie = institutieRaw
        ? institutieRaw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : undefined;
      valid.push({
        rowNumber,
        kind: "nume",
        name_normalized: nameNorm,
        name_kind: nameKindRaw as "fizic" | "juridic",
        institutie: institutie && institutie.length > 0 ? institutie : undefined,
        cadence_sec: cadenceFinal,
        notes,
      });
    }
  });
  return { valid, invalid };
}
