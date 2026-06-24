import { describe, it, expect } from "vitest";
import { sanitizeFormulaCells, colLetter, cellAddr } from "./excel-helpers";

// Caracterizeaza contractul de securitate a formula-injection guard-ului folosit
// de export.ts (PortalJust dosare/termene/monitorizare) si rnpmExport.ts (avize
// RNPM). Comportament observat in v2.7.0:
//   - cell-uri de tip string ("t":"s") cu prim caracter in [=+-@\t\r] capata
//     prefix `'` (Excel/LibreOffice afiseaza valoarea ca text plain).
//   - alte cell-uri (numerice, sau prefixe sigure) raman intacte.
//   - cheile care incep cu `!` (metadata sheet, ex: "!cols", "!ref") sunt sarite.

describe("sanitizeFormulaCells", () => {
  it("prefixeaza cell-urile cu = la inceput", () => {
    const ws = { A1: { t: "s", v: "=SUM(B1:B5)" } };
    sanitizeFormulaCells(ws);
    expect(ws.A1.v).toBe("'=SUM(B1:B5)");
  });

  it("prefixeaza cell-urile cu + la inceput", () => {
    const ws = { A1: { t: "s", v: "+1" } };
    sanitizeFormulaCells(ws);
    expect(ws.A1.v).toBe("'+1");
  });

  it("prefixeaza cell-urile cu - la inceput", () => {
    const ws = { A1: { t: "s", v: "-1" } };
    sanitizeFormulaCells(ws);
    expect(ws.A1.v).toBe("'-1");
  });

  it("prefixeaza cell-urile cu @ la inceput (Lotus-style call)", () => {
    const ws = { A1: { t: "s", v: "@SUM(B1)" } };
    sanitizeFormulaCells(ws);
    expect(ws.A1.v).toBe("'@SUM(B1)");
  });

  it("prefixeaza cell-urile cu tab la inceput", () => {
    const ws = { A1: { t: "s", v: "\t=evil" } };
    sanitizeFormulaCells(ws);
    expect(ws.A1.v).toBe("'\t=evil");
  });

  it("prefixeaza cell-urile cu CR la inceput", () => {
    const ws = { A1: { t: "s", v: "\r=evil" } };
    sanitizeFormulaCells(ws);
    expect(ws.A1.v).toBe("'\r=evil");
  });

  it("nu modifica cell-urile cu prefix sigur", () => {
    const ws = {
      A1: { t: "s", v: "Bucuresti" },
      A2: { t: "s", v: "Numar dosar 1234/180/2024" },
      A3: { t: "s", v: " =fals positive cu spatiu" },
    };
    sanitizeFormulaCells(ws);
    expect(ws.A1.v).toBe("Bucuresti");
    expect(ws.A2.v).toBe("Numar dosar 1234/180/2024");
    expect(ws.A3.v).toBe(" =fals positive cu spatiu");
  });

  it("nu modifica cell-urile numerice chiar daca par formula in stringificare", () => {
    const ws = { A1: { t: "n", v: 42 } };
    sanitizeFormulaCells(ws);
    expect(ws.A1.v).toBe(42);
  });

  it("sare peste cheile care incep cu ! (metadata sheet)", () => {
    const ws = {
      "!cols": [{ wch: 10 }],
      "!ref": "A1:B2",
      "!merges": [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }],
      A1: { t: "s", v: "=evil" },
    };
    sanitizeFormulaCells(ws);
    expect(ws["!cols"]).toEqual([{ wch: 10 }]);
    expect(ws["!ref"]).toBe("A1:B2");
    expect(ws["!merges"]).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]);
    expect((ws as any).A1.v).toBe("'=evil");
  });

  it("nu re-prefixeaza un cell deja sanitized (idempotent pe a doua rulare)", () => {
    const ws = { A1: { t: "s", v: "=evil" } };
    sanitizeFormulaCells(ws);
    expect(ws.A1.v).toBe("'=evil");
    sanitizeFormulaCells(ws);
    expect(ws.A1.v).toBe("'=evil"); // primul char e ', nu match in regex
  });

  it("ignora cell-uri null/undefined fara crash", () => {
    const ws: Record<string, unknown> = {
      A1: undefined,
      A2: null,
      A3: { t: "s", v: "=evil" },
    };
    expect(() => sanitizeFormulaCells(ws)).not.toThrow();
    expect((ws.A3 as { v: string }).v).toBe("'=evil");
  });
});

describe("colLetter", () => {
  it("0 -> A, 25 -> Z (single letter range)", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
  });

  it("26 -> AA, 27 -> AB (double letter rollover)", () => {
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(27)).toBe("AB");
  });

  it("701 -> ZZ, 702 -> AAA (triple letter rollover)", () => {
    expect(colLetter(701)).toBe("ZZ");
    expect(colLetter(702)).toBe("AAA");
  });
});

describe("cellAddr", () => {
  it("converteste (row, col) 0-based la addresa Excel 1-based", () => {
    expect(cellAddr(0, 0)).toBe("A1");
    expect(cellAddr(3, 1)).toBe("B4");
    expect(cellAddr(10, 25)).toBe("Z11");
  });
});
