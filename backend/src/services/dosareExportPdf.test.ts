import { readFile, unlink } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { Dosar } from "../soap.ts";
import { buildDosarePdf } from "./dosareExportPdf.ts";

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

describe("buildDosarePdf", () => {
  it("produce PDF valid", async () => {
    const result = await buildDosarePdf([makeDosar()]);
    generatedFiles.push(result.filepath);

    expect(result.mime).toBe("application/pdf");
    expect(result.byteLength).toBeGreaterThan(1000);
    const bytes = await readFile(result.filepath);
    expect(bytes.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(result.filename).toBe("dosar_123-3-2026.pdf");
  });
});
