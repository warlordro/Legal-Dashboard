import { describe, expect, it } from "vitest";
import { normalizeInstitutie } from "./institutionLabel.ts";

describe("normalizeInstitutie", () => {
  it("expands SOAP enum value to spaced label", () => {
    expect(normalizeInstitutie("TribunalulBUCURESTI")).toBe("Tribunalul Bucuresti");
    expect(normalizeInstitutie("CurteadeApelIASI")).toBe("Curtea de Apel Iasi");
    expect(normalizeInstitutie("JudecatoriaCONSTANTA")).toBe("Judecatoria Constanta");
  });

  it("handles spaced raw SOAP variant", () => {
    expect(normalizeInstitutie("Tribunalul BUCURESTI")).toBe("Tribunalul Bucuresti");
    expect(normalizeInstitutie("Judecatoria SATU MARE")).toBe("Judecatoria Satu Mare");
  });

  it("strips diacritics when matching", () => {
    expect(normalizeInstitutie("Tribunalul București")).toBe("Tribunalul Bucuresti");
    expect(normalizeInstitutie("Curtea de Apel Iași")).toBe("Curtea de Apel Iasi");
  });

  it("resolves multi-word city names that would otherwise char-wrap", () => {
    expect(normalizeInstitutie("TribunalulComercialARGES")).toBe("Tribunalul Comercial Arges");
    expect(normalizeInstitutie("JudecatoriaSECTORUL6BUCURESTI")).toBe("Judecatoria Sectorul 6 Bucuresti");
    expect(normalizeInstitutie("TribunalulMilitarTeritorialBUCURESTI")).toBe("Tribunalul Militar Teritorial Bucuresti");
  });

  it("returns raw value when not in catalog", () => {
    expect(normalizeInstitutie("UnknownCourtXYZ")).toBe("UnknownCourtXYZ");
  });

  it("returns empty for empty input", () => {
    expect(normalizeInstitutie("")).toBe("");
  });
});
