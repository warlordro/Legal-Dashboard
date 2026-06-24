import ExcelJS from "exceljs";
import { unlink } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { Dosar } from "../soap.ts";
import { buildDosareXlsx } from "./dosareExportXlsx.ts";

const generatedFiles: string[] = [];

function makeDosar(overrides: Partial<Dosar> = {}): Dosar {
  return {
    numar: "123/3/2026",
    data: "2026-05-12",
    institutie: "Tribunalul Bucuresti",
    departament: "Sectia civila",
    categorieCaz: "civil",
    stadiuProcesual: "Fond",
    obiect: "pretentii",
    parti: [{ calitateParte: "Reclamant", nume: "ACME SRL" }],
    sedinte: [
      {
        complet: "C1",
        data: "2026-05-13",
        ora: "09:00",
        solutie: "Amanare",
        solutieSumar: "Lipsa procedura",
        documentSedinta: "Incheiere",
        numarDocument: "1",
        dataPronuntare: "2026-05-13",
      },
    ],
    ...overrides,
  };
}

afterEach(async () => {
  const files = generatedFiles.splice(0);
  await Promise.all(files.map((file) => unlink(file).catch(() => {})));
});

describe("buildDosareXlsx", () => {
  it("produce workbook valid cu sheet Dosare si Sedinte", async () => {
    const result = await buildDosareXlsx([makeDosar()]);
    generatedFiles.push(result.filepath);

    expect(result.mime).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(result.byteLength).toBeGreaterThan(1000);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.filepath);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Dosare", "Sedinte"]);
    expect(workbook.getWorksheet("Dosare")?.getCell("B5").text).toBe("123/3/2026");
    expect(workbook.getWorksheet("Sedinte")?.getCell("A5").text).toContain("Dosar: 123/3/2026");
  });

  it("sanitizeaza formule in celulele string", async () => {
    const result = await buildDosareXlsx([makeDosar({ obiect: "=SUM(A1)" })]);
    generatedFiles.push(result.filepath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.filepath);
    expect(workbook.getWorksheet("Dosare")?.getCell("G5").value).toBe("'=SUM(A1)");
  });
});
