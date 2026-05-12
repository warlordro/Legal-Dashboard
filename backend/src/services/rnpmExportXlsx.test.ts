import ExcelJS from "exceljs";
import { unlink } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AvizFull, AvizRecord, BunRecord, IstoricRecord, PartyRecord } from "../db/avizRepository.ts";
import { buildRnpmXlsx } from "./rnpmExportXlsx.ts";

const generatedFiles: string[] = [];

async function buildAndTrack(items: AvizFull[], searchType?: string) {
  const result = await buildRnpmXlsx(items, searchType);
  generatedFiles.push(result.filepath);
  return result;
}

async function readWorkbook(filepath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filepath);
  return workbook;
}

afterEach(async () => {
  const files = generatedFiles.splice(0);
  await Promise.all(files.map((file) => unlink(file).catch(() => {})));
});

function makeAviz(overrides: Partial<AvizRecord> = {}): AvizRecord {
  return {
    id: 1,
    owner_id: "local",
    uuid: "uuid-1",
    identificator: "2026-AV-1",
    search_type: "ipoteci",
    tip: "Aviz initial",
    data: "2026-05-12",
    utilizator_autorizat: "Operator",
    activ: 1,
    needs_actualizare: 0,
    destinatie: "Constituire",
    tip_act: "Contract",
    numar_act: "123",
    data_inreg: "2026-05-12",
    data_expirare: "2031-05-12",
    alte_mentiuni: null,
    detalii_comune: "detalii",
    inscriere_initiala_id: null,
    inscriere_initiala_uuid: null,
    inscriere_modificata_id: null,
    inscriere_modificata_uuid: null,
    detail_fetched: 1,
    search_id: null,
    created_at: "2026-05-12T00:00:00Z",
    updated_at: "2026-05-12T00:00:00Z",
    ...overrides,
  };
}

function makeParty(overrides: Partial<PartyRecord> = {}): PartyRecord {
  return {
    id: 1,
    owner_id: "local",
    aviz_id: 1,
    tip_persoana: "PJ",
    calitate: null,
    denumire: "ACME SRL",
    prenume: null,
    tip_entitate: "SRL",
    sediu: "Bucuresti",
    nr_identificare: null,
    cod: null,
    cnp: null,
    tara: "RO",
    localitate: "Bucuresti",
    judet: "B",
    cod_postal: "010101",
    alte_date: null,
    subscriptor: 1,
    nr_ordine: 1,
    ...overrides,
  };
}

function makeBun(overrides: Partial<BunRecord> = {}): BunRecord {
  return {
    id: 1,
    owner_id: "local",
    aviz_id: 1,
    tip_bun: "vehicul",
    categorie: null,
    identificare: "DACIA LOGAN",
    descriere: null,
    model: "LOGAN",
    serie_sasiu: "UU1XYZ123",
    serie_motor: null,
    nr_inmatriculare: "B 01 ABC",
    referinte: [],
    ...overrides,
  };
}

function makeIstoric(overrides: Partial<IstoricRecord> = {}): IstoricRecord {
  return {
    id: 1,
    owner_id: "local",
    aviz_id: 1,
    identificator: "2026-AV-1-MOD",
    uuid: "uuid-mod",
    data: "2026-05-12",
    tip: "Modificare",
    inscriere_m_v: null,
    inscriere_m_k: null,
    ...overrides,
  };
}

function makeFull(overrides: Partial<AvizFull> = {}): AvizFull {
  return {
    aviz: makeAviz(),
    creditori: [makeParty({ id: 10 })],
    debitori: [makeParty({ id: 11, calitate: "Debitor" })],
    bunuri: [makeBun()],
    istoric: [makeIstoric()],
    ...overrides,
  };
}

describe("buildRnpmXlsx", () => {
  it("produce un workbook XLSX valid pentru 1 aviz", async () => {
    const result = await buildAndTrack([makeFull()], "ipoteci");
    expect(result.mime).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(result.byteLength).toBeGreaterThan(1000);

    const workbook = await readWorkbook(result.filepath);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Avize",
      "Creditori",
      "Parti",
      "Bunuri",
      "Istoric",
    ]);
    expect(workbook.getWorksheet("Avize")?.getCell("B5").text).toBe("2026-AV-1");
  });

  it("omite sheet-ul Creditori pentru searchType specifice", async () => {
    const result = await buildAndTrack([makeFull()], "specifice");
    const workbook = await readWorkbook(result.filepath);
    expect(workbook.getWorksheet("Creditori")).toBeUndefined();
    expect(workbook.getWorksheet("Parti")).toBeDefined();
    expect(workbook.getWorksheet("Bunuri")).toBeDefined();
  });

  it("omite sheet-urile copil cand avizul nu are copii", async () => {
    const result = await buildAndTrack([
      makeFull({
        creditori: [],
        debitori: [],
        bunuri: [],
        istoric: [],
      }),
    ]);
    const workbook = await readWorkbook(result.filepath);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Avize"]);
  });

  it("sanitizeaza prefixele de formula in celulele string", async () => {
    const result = await buildAndTrack([
      makeFull({
        creditori: [],
        debitori: [makeParty({ denumire: "=SUM(A1)" })],
        bunuri: [],
        istoric: [],
      }),
    ]);
    const workbook = await readWorkbook(result.filepath);
    expect(workbook.getWorksheet("Parti")?.getCell("F5").value).toBe("'=SUM(A1)");
  });

  it("scrie hyperlink-uri cross-sheet pentru identificatorul avizului", async () => {
    const result = await buildAndTrack([makeFull()], "ipoteci");
    const workbook = await readWorkbook(result.filepath);
    const value = workbook.getWorksheet("Avize")?.getCell("B5").value as ExcelJS.CellFormulaValue | undefined;
    expect(value?.formula).toBe(`HYPERLINK("#'Bunuri'!A5","2026-AV-1")`);
    expect(value?.result).toBe("2026-AV-1");
  });

  it("calculeaza filename-ul pentru export single si multiplu", async () => {
    const single = await buildAndTrack([makeFull()], "ipoteci");
    expect(single.filename).toBe("2026-AV-1.xlsx");

    const multiple = await buildAndTrack([
      makeFull(),
      makeFull({ aviz: makeAviz({ id: 2, identificator: "2026-AV-2", uuid: "uuid-2" }) }),
    ]);
    expect(multiple.filename).toMatch(/^rnpm_.+\.xlsx$/);
  });
});
