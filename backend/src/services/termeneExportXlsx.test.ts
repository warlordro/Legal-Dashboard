import ExcelJS from "exceljs";
import { unlink } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { buildTermeneXlsx, type TermenExportRow } from "./termeneExportXlsx.ts";

const generatedFiles: string[] = [];

function makeTermen(overrides: Partial<TermenExportRow> = {}): TermenExportRow {
  return {
    numarDosar: "123/3/2026",
    institutie: "Tribunalul Bucuresti",
    data: "2026-05-13",
    ora: "09:00",
    complet: "C1",
    solutie: "Amanare",
    solutieSumar: "Lipsa procedura",
    ...overrides,
  };
}

afterEach(async () => {
  const files = generatedFiles.splice(0);
  await Promise.all(files.map((file) => unlink(file).catch(() => {})));
});

describe("buildTermeneXlsx", () => {
  it("produce workbook valid cu sheet Termene", async () => {
    const result = await buildTermeneXlsx([makeTermen()]);
    generatedFiles.push(result.filepath);

    expect(result.mime).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(result.byteLength).toBeGreaterThan(1000);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.filepath);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Termene"]);
    expect(workbook.getWorksheet("Termene")?.getCell("B5").text).toBe("123/3/2026");
  });

  it("sanitizeaza formule in celulele string", async () => {
    const result = await buildTermeneXlsx([makeTermen({ solutie: "=SUM(A1)" })]);
    generatedFiles.push(result.filepath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.filepath);
    expect(workbook.getWorksheet("Termene")?.getCell("G5").value).toBe("'=SUM(A1)");
  });
});
