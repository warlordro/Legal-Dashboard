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

  it("dosar cu 50+ parti nu spam-uieste rendering-ul si PDF-ul ramane finite", async () => {
    const manyParti = Array.from({ length: 50 }, (_, i) => ({
      calitateParte: i % 2 === 0 ? "Creditor" : "Debitor",
      nume: `Parte ${i + 1} SRL`,
    }));
    const manySedinte = Array.from({ length: 20 }, (_, i) => ({
      complet: `C${i + 1}`,
      data: "2026-05-13",
      ora: "10:00",
      solutie: "Amanare",
      solutieSumar: `Iter ${i + 1}`,
      documentSedinta: "Incheiere",
      numarDocument: String(i + 1),
      dataPronuntare: "2026-05-13",
    }));
    const result = await buildDosarePdf([makeDosar({ parti: manyParti, sedinte: manySedinte })]);
    generatedFiles.push(result.filepath);

    expect(result.mime).toBe("application/pdf");
    // PDF-ul trebuie sa fie finite; vechiul rendering "exploda" cu randuri ce depaseau pagina.
    expect(result.byteLength).toBeGreaterThan(1000);
    expect(result.byteLength).toBeLessThan(200_000);
  });
});
