import { readFile, unlink } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { buildTermenePdf } from "./termeneExportPdf.ts";
import type { TermenExportRow } from "./termeneExportXlsx.ts";

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

describe("buildTermenePdf", () => {
  it("produce PDF valid", async () => {
    const result = await buildTermenePdf([makeTermen()]);
    generatedFiles.push(result.filepath);

    expect(result.mime).toBe("application/pdf");
    expect(result.byteLength).toBeGreaterThan(1000);
    const bytes = await readFile(result.filepath);
    expect(bytes.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(result.filename).toBe("termen_123-3-2026.pdf");
  });
});
