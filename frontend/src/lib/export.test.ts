import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildDosareXlsx } from "./export";
import type { Dosar } from "@/types";

// Caracterizeaza buildDosareXlsx — protejaza Stage 7 (split lib/export.ts).
// Asertiile sunt structurale (numar de sheet-uri, prezenta sanitize, filename
// determinist) ca refactorul sa nu poata silentios sa schimbe forma fisierului.
// Folosim parsing pe arhiva XLSX rezultata (xlsx returneaza ZIP cu OOXML).

function makeDosar(overrides: Partial<Dosar> = {}): Dosar {
  return {
    numar: "1234/180/2024",
    data: "2024-05-12T00:00:00",
    institutie: "Tribunalul Bacau",
    departament: "Sectia I civila",
    obiect: "Pretentii",
    categorieCaz: "Civil",
    stadiuProcesual: "Fond",
    parti: [{ calitateParte: "Reclamant", nume: "Ion Popescu" }],
    sedinte: [
      {
        complet: "Complet C1",
        data: "2024-05-15T00:00:00",
        ora: "09:00",
        solutie: "Admis",
        solutieSumar: "Admite cererea",
        documentSedinta: "hot.pdf",
        numarDocument: "123",
        dataPronuntare: "2024-05-15T00:00:00",
      },
    ],
    ...overrides,
  };
}

describe("buildDosareXlsx — golden master structural", () => {
  beforeAll(() => {
    // Inghet timpul ca filename + titlu sa fie deterministe.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T10:00:00Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("returneaza un ArrayBuffer non-zero cu mime XLSX", async () => {
    const result = await buildDosareXlsx([makeDosar()]);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.buffer.byteLength).toBeGreaterThan(1000); // ~minim pentru XLSX cu doua sheet-uri
    expect(result.mime).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("filename single-dosar foloseste numarul sanitized cu / inlocuit cu -", async () => {
    const result = await buildDosareXlsx([makeDosar()]);
    expect(result.filename).toBe("dosar_1234-180-2024.xlsx");
  });

  it("filename multi-dosar foloseste data RO (timpul inghetat aici)", async () => {
    const result = await buildDosareXlsx([
      makeDosar({ numar: "1/1/2024" }),
      makeDosar({ numar: "2/1/2024" }),
    ]);
    // Localizarea ro-RO produce dd.mm.yyyy in Node 22.
    expect(result.filename).toMatch(/^dosare_\d{2}\.\d{2}\.\d{4}\.xlsx$/);
  });

  it("contine sheet-urile Dosare si Sedinte cand exista sedinte", async () => {
    const result = await buildDosareXlsx([makeDosar()]);
    // Re-parsam workbook-ul ca sa verificam sheet-urile generate.
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(result.buffer), { type: "array" });
    expect(wb.SheetNames).toEqual(["Dosare", "Sedinte"]);
  });

  it("omite sheet-ul Sedinte cand niciun dosar nu are sedinte", async () => {
    const result = await buildDosareXlsx([makeDosar({ sedinte: [] })]);
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(result.buffer), { type: "array" });
    expect(wb.SheetNames).toEqual(["Dosare"]);
  });

  it("aplica sanitizeFormulaCells inainte de write — formula-injection in obiect e prefixata", async () => {
    // Injectia trebuie sa fie la INCEPUTUL valorii cell-ului (nu in mijlocul
    // unui string concat-uit). Coloana obiect e ideala — singura sursa.
    const evil = makeDosar({ obiect: "=cmd|' /C calc'!A0" });
    const result = await buildDosareXlsx([evil]);
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(result.buffer), { type: "array" });
    const sheet = wb.Sheets["Dosare"];
    // Coloana G (obiect) este la indexul 6. Randul 0-bazat 4 (titlu+stats+gol+header+data 0).
    const cell = sheet["G5"]; // Excel 1-bazat: G5 = (row 4, col 6) zero-based
    expect(cell).toBeDefined();
    // sanitizeFormulaCells prefixeaza cu ' valorile incepand cu = / + / - / @ / \t / \r
    expect(typeof cell.v).toBe("string");
    expect((cell.v as string).startsWith("'=")).toBe(true);
  });

  it("titlul randul 1 contine PORTALJUST DASHBOARD — DOSARE", async () => {
    const result = await buildDosareXlsx([makeDosar()]);
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(result.buffer), { type: "array" });
    const sheet = wb.Sheets["Dosare"];
    expect(sheet["A1"]?.v).toContain("PORTALJUST DASHBOARD");
    expect(sheet["A1"]?.v).toContain("DOSARE");
  });

  it("randul de header are 9 coloane in ordinea documentata", async () => {
    const result = await buildDosareXlsx([makeDosar()]);
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(result.buffer), { type: "array" });
    const sheet = wb.Sheets["Dosare"];
    // Headerele sunt pe randul 4 (index 3 zero-based).
    expect(sheet["A4"]?.v).toBe("#");
    expect(sheet["B4"]?.v).toBe("Numar Dosar");
    expect(sheet["C4"]?.v).toBe("Data");
    expect(sheet["D4"]?.v).toBe("Institutie");
    expect(sheet["E4"]?.v).toBe("Departament");
    expect(sheet["F4"]?.v).toBe("Categorie / Stadiu");
    expect(sheet["G4"]?.v).toBe("Obiect");
    expect(sheet["H4"]?.v).toBe("Parti");
    expect(sheet["I4"]?.v).toBe("Nr. Sedinte");
  });
});
