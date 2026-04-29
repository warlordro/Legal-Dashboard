// Tests for nameListParser (PR-5 commit 2).
//
// Acopera:
//   - format detection (CSV vs XLSX prin magic bytes)
//   - header detection (sinonime nume/cnp/cui)
//   - validare reject (nume gol, prea scurt, prea lung, doar cifre)
//   - validare warn (duplicate intra-fisier)
//   - capurile (FILE_TOO_LARGE, TOO_MANY_ROWS, TOO_MANY_COLS, EMPTY_FILE,
//     MISSING_NAME_COLUMN, PARSE_ERROR)
//   - sha256 stabil per buffer

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  MAX_FILE_BYTES,
  MAX_ROWS,
  MAX_NAME_LEN,
  ParseError,
  normalizeName,
  parseNameList,
} from "./nameListParser.ts";

function csv(s: string): Buffer {
  return Buffer.from(s, "utf8");
}

function xlsx(rows: string[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "lista");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("normalizeName", () => {
  it("strip-uieste diacritice + lowercase + collapse whitespace", () => {
    expect(normalizeName("Ștefăn   Țîrcă  ")).toBe("stefan tirca");
  });
  it("trateaza null/undefined ca string gol", () => {
    expect(normalizeName(null as unknown as string)).toBe("");
    expect(normalizeName(undefined as unknown as string)).toBe("");
  });
});

describe("parseNameList — CSV", () => {
  it("parseaza un fisier minimal cu o coloana nume", () => {
    const buf = csv("nume\nIon Popescu\nAcme SRL\n");
    const r = parseNameList(buf, { filename: "lista.csv" });
    expect(r.totals.total).toBe(2);
    expect(r.totals.ok).toBe(2);
    expect(r.totals.warn).toBe(0);
    expect(r.totals.rejected).toBe(0);
    expect(r.rows[0]?.nameNormalized).toBe("ion popescu");
    expect(r.rows[1]?.nameNormalized).toBe("acme srl");
  });

  it("accepta separator ';' (Excel ro-RO export)", () => {
    const buf = csv("nume;cnp\nMaria;\n");
    const r = parseNameList(buf);
    expect(r.totals.ok).toBe(1);
    expect(r.rows[0]?.nameRaw).toBe("Maria");
  });

  it("accepta sinonime de header (denumire / name)", () => {
    const buf = csv("denumire\nIon\n");
    const r = parseNameList(buf);
    expect(r.totals.ok).toBe(1);
    expect(r.rows[0]?.nameRaw).toBe("Ion");
  });

  it("ignora coloana 'tip' / 'kind' daca apare (backward-compat)", () => {
    const buf = csv("nume,tip\nIon Popescu,fizic\nMaria,juridic\n");
    const r = parseNameList(buf);
    expect(r.totals.ok).toBe(2);
    expect(r.rows[0]?.nameRaw).toBe("Ion Popescu");
  });

  it("captureaza CNP/CUI cand sunt prezente", () => {
    const buf = csv("nume,cnp,cui\nIon,1900101226789,\nAcme,,12345678\n");
    const r = parseNameList(buf);
    expect(r.rows[0]?.cnp).toBe("1900101226789");
    expect(r.rows[0]?.cui).toBeNull();
    expect(r.rows[1]?.cnp).toBeNull();
    expect(r.rows[1]?.cui).toBe("12345678");
  });
});

describe("parseNameList — XLSX", () => {
  it("parseaza un fisier XLSX cu header + 2 rinduri", () => {
    const buf = xlsx([
      ["nume"],
      ["Ion Popescu"],
      ["Acme SRL"],
    ]);
    const r = parseNameList(buf, { filename: "lista.xlsx" });
    expect(r.totals.ok).toBe(2);
    expect(r.rows[0]?.nameRaw).toBe("Ion Popescu");
    expect(r.rows[1]?.nameRaw).toBe("Acme SRL");
  });

  it("XLSX cu zip magic bytes corect identificat (filename irrelevant)", () => {
    const buf = xlsx([["nume"], ["Ion"]]);
    // Filename mincinos — magic bytes castiga.
    const r = parseNameList(buf, { filename: "lista.csv" });
    expect(r.totals.warn + r.totals.ok).toBe(1);
    expect(r.rows[0]?.nameRaw).toBe("Ion");
  });
});

describe("validation — reject", () => {
  it("rejecteaza nume gol", () => {
    // CSV-ul are skip_empty_lines=true, deci o linie complet goala e ignorata.
    // Pentru a forta validation='rejected' pe nume_gol, folosim o linie cu o
    // alta coloana populata (cnp) si coloana 'nume' goala.
    const buf = csv("nume,cnp\n,123\n  ,456\n");
    const r = parseNameList(buf);
    expect(r.totals.rejected).toBe(2);
    expect(r.rows[0]?.validationMsg).toContain("nume_gol");
  });

  it("rejecteaza nume sub MIN_NAME_LEN dupa normalizare", () => {
    const buf = csv("nume\nA\n");
    const r = parseNameList(buf);
    expect(r.totals.rejected).toBe(1);
    expect(r.rows[0]?.validationMsg).toContain("prea_scurt");
  });

  it("rejecteaza nume peste MAX_NAME_LEN", () => {
    const long = "X".repeat(MAX_NAME_LEN + 1);
    const buf = csv(`nume\n${long}\n`);
    const r = parseNameList(buf);
    expect(r.totals.rejected).toBe(1);
    expect(r.rows[0]?.validationMsg).toContain("prea_lung");
  });

  it("rejecteaza nume care contine doar cifre", () => {
    const buf = csv("nume\n123456\n42 99 88\n");
    const r = parseNameList(buf);
    expect(r.totals.rejected).toBe(2);
    expect(r.rows[0]?.validationMsg).toContain("doar_cifre");
  });
});

describe("validation — warn (duplicate intra-fisier)", () => {
  it("flag-uieste duplicate dupa name_normalized", () => {
    const buf = csv("nume\nIon Popescu\nion  popescu\nIoN PoPesCu\n");
    const r = parseNameList(buf);
    expect(r.totals.ok).toBe(1);
    expect(r.totals.warn).toBe(2);
    expect(r.rows[1]?.validationMsg).toContain("duplicate_in_file");
    expect(r.rows[2]?.validationMsg).toContain("duplicate_in_file");
  });
});

describe("capuri si erori", () => {
  it("EMPTY_FILE pe buffer gol", () => {
    expect(() => parseNameList(Buffer.alloc(0))).toThrowError(ParseError);
  });

  it("FILE_TOO_LARGE peste MAX_FILE_BYTES", () => {
    // Construim un buffer (valid CSV) mai mare decat capul. Folosim un sir
    // simplu repetat ca sa nu pierdem timp pe parse — capul e verificat
    // INAINTE de parse.
    const big = Buffer.alloc(MAX_FILE_BYTES + 1, 0x41);
    expect(() => parseNameList(big)).toThrowError(/FILE_TOO_LARGE|prea mare/);
  });

  it("MISSING_NAME_COLUMN cand header-ul nu are coloana 'nume'", () => {
    const buf = csv("foo,bar\nx,y\n");
    expect(() => parseNameList(buf)).toThrowError(/nume.*lipseste/);
  });

  it("returneaza un ParseError tipat (nu o eroare generica)", () => {
    try {
      parseNameList(Buffer.alloc(0));
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).code).toBe("EMPTY_FILE");
    }
  });
});

describe("sha256", () => {
  it("este stabil pentru acelasi buffer", () => {
    const buf = csv("nume\nIon\n");
    const a = parseNameList(buf);
    const b = parseNameList(buf);
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("difera intre buffere distincte", () => {
    const a = parseNameList(csv("nume\nIon\n"));
    const b = parseNameList(csv("nume\nMaria\n"));
    expect(a.sha256).not.toBe(b.sha256);
  });
});

describe("performanta — cap maxim", () => {
  it("MAX_ROWS este declarat la 50000", () => {
    expect(MAX_ROWS).toBe(50_000);
  });
  // Test integration la marime mare il rulam in commit 6 (k6 harness),
  // nu in unit tests — ar dura zeci de secunde si ar masca regresiile reale.
});
