import { describe, expect, it } from "vitest";
import { dropLegalFormTokens, isLegalFormToken } from "./legalSuffix";

describe("isLegalFormToken", () => {
  it("recognises Romanian forms case-insensitively", () => {
    for (const t of ["SC", "sc", "Srl", "SA", "pfa"]) {
      expect(isLegalFormToken(t)).toBe(true);
    }
  });

  it("recognises common foreign forms", () => {
    for (const t of ["LLC", "Ltd", "GmbH", "SARL"]) {
      expect(isLegalFormToken(t)).toBe(true);
    }
  });

  it("rejects identity tokens", () => {
    for (const t of ["acme", "banca", "transilvania", "dacia", "auto"]) {
      expect(isLegalFormToken(t)).toBe(false);
    }
  });

  it("handles empty input", () => {
    expect(isLegalFormToken("")).toBe(false);
  });
});

describe("dropLegalFormTokens", () => {
  it("drops SC prefix and SRL suffix from a tokenised query", () => {
    expect(dropLegalFormTokens(["sc", "acme", "srl"])).toEqual(["acme"]);
  });

  it("keeps multi-word identities intact", () => {
    expect(dropLegalFormTokens(["banca", "transilvania", "sa"])).toEqual(["banca", "transilvania"]);
  });

  it("returns empty array when input is only legal forms", () => {
    expect(dropLegalFormTokens(["sc", "srl"])).toEqual([]);
  });

  it("passes through queries without legal forms", () => {
    expect(dropLegalFormTokens(["dacia"])).toEqual(["dacia"]);
  });
});
