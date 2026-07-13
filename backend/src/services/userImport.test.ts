// v2.42.0 (4.3) — parsarea importului de utilizatori (server-side, exceljs).

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildImportTemplate, MAX_IMPORT_ROWS, parseRoleInput, parseUserImport } from "./userImport.ts";

async function xlsxOf(rows: ExcelJS.CellValue[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Utilizatori");
  for (const row of rows) {
    ws.addRow(row);
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

describe("parseRoleInput", () => {
  it("accepta etichete umane si token-uri, case-insensitive", () => {
    expect(parseRoleInput("Utilizator")).toBe("user");
    expect(parseRoleInput("user")).toBe("user");
    expect(parseRoleInput("ADMIN")).toBe("admin");
    expect(parseRoleInput("Administrator")).toBe("admin");
  });

  it("gol = user; necunoscut = null", () => {
    expect(parseRoleInput("")).toBe("user");
    expect(parseRoleInput("   ")).toBe("user");
    expect(parseRoleInput("support")).toBeNull();
    expect(parseRoleInput("readonly")).toBeNull();
    expect(parseRoleInput("sef")).toBeNull();
  });
});

describe("parseUserImport", () => {
  it("respinge fisierele care nu sunt xlsx (magic bytes)", async () => {
    const res = await parseUserImport(Buffer.from("email,nume\na@b.c,Test", "utf8"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_file");
  });

  it("parseaza randuri valide cu header si canonicalizeaza emailul", async () => {
    const buf = await xlsxOf([
      ["Email", "Nume afisat", "Rol"],
      ["  Alice@Firma.RO ", "Alice", "Admin"],
      ["bob@firma.ro", "Bob", ""],
    ]);
    const res = await parseUserImport(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([
      { rowNumber: 2, email: "alice@firma.ro", displayName: "Alice", role: "admin" },
      { rowNumber: 3, email: "bob@firma.ro", displayName: "Bob", role: "user" },
    ]);
    expect(res.issues).toHaveLength(0);
  });

  it("headerul se detecteaza DOAR pe egalitate exacta cu 'email' — un rand de date cu contact@email.com NU e aruncat", async () => {
    const buf = await xlsxOf([
      ["contact@email.com", "Contact", ""],
      ["alt@firma.ro", "Alt", ""],
    ]);
    const res = await parseUserImport(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.email)).toEqual(["contact@email.com", "alt@firma.ro"]);
  });

  it("functioneaza si fara header (toate randurile sunt date)", async () => {
    const buf = await xlsxOf([["a@b.ro", "A", "Utilizator"]]);
    const res = await parseUserImport(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].rowNumber).toBe(1);
  });

  it("dedup in-fisier pe email canonic: primul castiga, restul devin issues", async () => {
    const buf = await xlsxOf([
      ["Email", "Nume afisat", "Rol"],
      ["dub@firma.ro", "Primul", ""],
      ["DUB@FIRMA.RO", "Al doilea", ""],
    ]);
    const res = await parseUserImport(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.displayName)).toEqual(["Primul"]);
    expect(res.issues).toEqual([
      expect.objectContaining({ rowNumber: 3, email: "dub@firma.ro", code: "duplicate_in_file" }),
    ]);
  });

  it("rol necunoscut si email invalid devin issues invalid_row, restul randurilor trec", async () => {
    const buf = await xlsxOf([
      ["Email", "Nume afisat", "Rol"],
      ["ok@firma.ro", "Ok", "Utilizator"],
      ["rau@firma.ro", "Rau", "sef"],
      ["nu-e-email", "Fara arond", ""],
      ["fara-nume@firma.ro", "", ""],
    ]);
    const res = await parseUserImport(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.email)).toEqual(["ok@firma.ro"]);
    expect(res.issues.map((i) => [i.rowNumber, i.code])).toEqual([
      [3, "invalid_row"],
      [4, "invalid_row"],
      [5, "invalid_row"],
    ]);
  });

  it("cap de randuri DATE: headerul nu se numara", async () => {
    const rows: (string | null)[][] = [["Email", "Nume afisat", "Rol"]];
    for (let i = 0; i < MAX_IMPORT_ROWS; i++) {
      rows.push([`u${i}@firma.ro`, `U ${i}`, ""]);
    }
    const exact = await parseUserImport(await xlsxOf(rows));
    expect(exact.ok).toBe(true);

    rows.push(["peste@firma.ro", "Peste", ""]);
    const over = await parseUserImport(await xlsxOf(rows));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe("too_many_rows");
  });

  it("template-ul generat e el insusi parsabil (header detectat, zero randuri)", async () => {
    const template = await buildImportTemplate();
    const res = await parseUserImport(template);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(0);
    expect(res.issues).toHaveLength(0);
  });

  it("celula hyperlink cu text: textul afisat castiga (contractul cellToString)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Utilizatori");
    ws.addRow(["email", "nume", "rol"]);
    const row = ws.addRow([]);
    row.getCell(1).value = { text: "ana@firma.ro", hyperlink: "mailto:altceva@firma.ro" };
    row.getCell(2).value = "Ana Pop";
    row.getCell(3).value = "user";
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await parseUserImport(buffer);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].email).toBe("ana@firma.ro");
    }
  });

  it("celula hyperlink FARA text: se extrage adresa din mailto (branch-ul hyperlink)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Utilizatori");
    ws.addRow(["email", "nume", "rol"]);
    const row = ws.addRow([]);
    const cell = row.getCell(1);
    // ExcelJS.Cell.value= detecteaza tipul Hyperlink doar cand `text` E SETAT
    // ("value.text && value.hyperlink" in Value.getType) — fara text, valoarea
    // e serializata generic si relatia de hyperlink se pierde la scriere.
    // Setarea directa pe `.model` ocoleste heuristica si produce un xlsx real
    // cu hyperlink pe o celula fara text afisat (cazul pe care userImport.ts
    // il trateaza defensiv).
    cell.model = {
      address: cell.address,
      type: ExcelJS.ValueType.Hyperlink,
      hyperlink: "mailto:ana@firma.ro",
    } as unknown as ExcelJS.CellModel;
    row.getCell(2).value = "Ana Pop";
    row.getCell(3).value = "user";
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await parseUserImport(buffer);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].email).toBe("ana@firma.ro");
    }
  });

  // Fix duel-review 2026-07-09: paste din Outlook cu text afisat diferit de
  // adresa ("Ion Popescu" -> mailto:ion@firma.ro). Ramura mailto era de neatins
  // (text-ul, mereu prezent pe hyperlink, era verificat primul) si randul pica
  // la validare. Contractul existent "textul afisat castiga" (testul de mai
  // sus) se pastreaza cand textul arata a email.
  it("email ca hyperlink Outlook cu text NON-email: adresa se ia din mailto", async () => {
    const buf = await xlsxOf([
      ["Email", "Nume afisat", "Rol"],
      [{ text: "Ion Popescu", hyperlink: "mailto:ion@firma.ro" }, "Ion Popescu", "Utilizator"],
    ]);
    const res = await parseUserImport(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.issues).toHaveLength(0);
    expect(res.rows).toEqual([{ rowNumber: 2, email: "ion@firma.ro", displayName: "Ion Popescu", role: "user" }]);
  });

  it("parametrii mailto (?subject=...) se taie din adresa", async () => {
    const buf = await xlsxOf([
      ["Email", "Nume afisat", "Rol"],
      [{ text: "Ion Popescu", hyperlink: "mailto:ion@firma.ro?subject=Salut" }, "Ion", ""],
    ]);
    const res = await parseUserImport(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]?.email).toBe("ion@firma.ro");
  });

  it("mailto cu percent-encoding si fragment se normalizeaza (audit 2026-07-09)", async () => {
    const buf = await xlsxOf([
      ["Email", "Nume afisat", "Rol"],
      [{ text: "Ion Plus", hyperlink: "mailto:ion%2Btag@firma.ro#sectiune" }, "Ion Plus", ""],
    ]);
    const res = await parseUserImport(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]?.email).toBe("ion+tag@firma.ro");
  });

  it("REGRESIE: numele afisat cu hyperlink NU se inlocuieste cu URL-ul", async () => {
    const buf = await xlsxOf([
      ["Email", "Nume afisat", "Rol"],
      ["ion@firma.ro", { text: "Ion Popescu", hyperlink: "https://firma.ro/ion" }, ""],
    ]);
    const res = await parseUserImport(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]?.displayName).toBe("Ion Popescu");
  });

  it("email cu hyperlink NON-mailto pastreaza textul afisat", async () => {
    const buf = await xlsxOf([
      ["Email", "Nume afisat", "Rol"],
      [{ text: "ion@firma.ro", hyperlink: "https://firma.ro" }, "Ion", ""],
    ]);
    const res = await parseUserImport(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]?.email).toBe("ion@firma.ro");
  });

  it("celula Date pe coloana de nume nu arunca si nu produce [object Object]", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Utilizatori");
    ws.addRow(["email", "nume", "rol"]);
    ws.addRow(["d@firma.ro", new Date("2026-01-15T00:00:00Z"), "user"]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await parseUserImport(buffer);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Data devine string ISO — rand valid (nume ne-gol), fara crash.
      expect(result.rows[0]?.displayName).toContain("2026-01-15");
    }
  });
});
