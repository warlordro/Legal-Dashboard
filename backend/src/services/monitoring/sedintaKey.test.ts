// Tests for the deterministic sedinta key — the foundation of PR-4 diff.
// If any of these fail, the PR-4 diff engine could either miss real changes
// or fire false positives.

import { describe, expect, it } from "vitest";
import {
  buildSedintaKey,
  buildSedintaKeyWithoutSolutie,
  normalizeData,
  normalizeOra,
  normalizeStadiu,
} from "./sedintaKey.ts";

describe("normalizeData", () => {
  it("strips ISO time component", () => {
    expect(normalizeData("2026-04-19T00:00:00")).toBe("2026-04-19");
  });
  it("strips trailing space + time", () => {
    expect(normalizeData("2026-04-19 10:00")).toBe("2026-04-19");
  });
  it("passes a clean date through", () => {
    expect(normalizeData("2026-04-19")).toBe("2026-04-19");
  });
  it("handles empty + null + undefined", () => {
    expect(normalizeData("")).toBe("");
    expect(normalizeData(null)).toBe("");
    expect(normalizeData(undefined)).toBe("");
  });
});

describe("normalizeOra", () => {
  it("pads single-digit minutes", () => {
    expect(normalizeOra("10:0")).toBe("10:00");
  });
  it("pads single-digit hours", () => {
    expect(normalizeOra("8:30")).toBe("08:30");
  });
  it("preserves canonical HH:MM", () => {
    expect(normalizeOra("10:00")).toBe("10:00");
  });
  it("handles whitespace", () => {
    expect(normalizeOra("  10:00  ")).toBe("10:00");
  });
  it("handles empty + null + undefined", () => {
    expect(normalizeOra("")).toBe("");
    expect(normalizeOra(null)).toBe("");
    expect(normalizeOra(undefined)).toBe("");
  });
  it("passes through unrecognized formats unchanged", () => {
    expect(normalizeOra("noon")).toBe("noon");
    expect(normalizeOra("10h00")).toBe("10h00");
  });
});

describe("normalizeStadiu", () => {
  it("lowercases", () => {
    expect(normalizeStadiu("APEL")).toBe("apel");
  });
  it("strips diacritics", () => {
    expect(normalizeStadiu("Recurs în interesul legii")).toBe("recurs in interesul legii");
  });
  it("trims whitespace", () => {
    expect(normalizeStadiu("  Fond  ")).toBe("fond");
  });
  it("handles empty + null + undefined", () => {
    expect(normalizeStadiu("")).toBe("");
    expect(normalizeStadiu(null)).toBe("");
    expect(normalizeStadiu(undefined)).toBe("");
  });
});

describe("buildSedintaKey — determinism across cosmetic drift", () => {
  const base = {
    stadiuProcesual: "Apel",
    data: "2026-04-19",
    ora: "10:00",
    complet: "C5",
    solutie: "",
  };

  it("same fields → same key", () => {
    expect(buildSedintaKey(base)).toBe(buildSedintaKey({ ...base }));
  });

  it("ISO date variant produces same key as date-only", () => {
    expect(buildSedintaKey({ ...base, data: "2026-04-19T00:00:00" })).toBe(
      buildSedintaKey(base),
    );
  });

  it("ora '10:0' produces same key as '10:00'", () => {
    expect(buildSedintaKey({ ...base, ora: "10:0" })).toBe(buildSedintaKey(base));
  });

  it("stadiu case + diacritics don't change key", () => {
    expect(buildSedintaKey({ ...base, stadiuProcesual: "APEL" })).toBe(
      buildSedintaKey(base),
    );
  });
});

describe("buildSedintaKey — segment integrity", () => {
  it("different stadii produce different keys (the critical PJI fix)", () => {
    const fond = buildSedintaKey({
      stadiuProcesual: "Fond",
      data: "2026-04-19",
      ora: "10:00",
      complet: "C5",
      solutie: "",
    });
    const apel = buildSedintaKey({
      stadiuProcesual: "Apel",
      data: "2026-04-19",
      ora: "10:00",
      complet: "C5",
      solutie: "",
    });
    expect(fond).not.toBe(apel);
  });

  it("solutie change creates a different key", () => {
    const without = buildSedintaKey({
      stadiuProcesual: "Apel",
      data: "2026-04-19",
      ora: "10:00",
      complet: "C5",
      solutie: "",
    });
    const withSol = buildSedintaKey({
      stadiuProcesual: "Apel",
      data: "2026-04-19",
      ora: "10:00",
      complet: "C5",
      solutie: "Admite apelul",
    });
    expect(without).not.toBe(withSol);
  });

  it("data change creates a different key (termen_changed signal)", () => {
    const a = buildSedintaKey({
      stadiuProcesual: "Apel",
      data: "2026-04-19",
      ora: "10:00",
      complet: "C5",
      solutie: "",
    });
    const b = buildSedintaKey({
      stadiuProcesual: "Apel",
      data: "2026-04-26",
      ora: "10:00",
      complet: "C5",
      solutie: "",
    });
    expect(a).not.toBe(b);
  });
});

describe("buildSedintaKeyWithoutSolutie", () => {
  it("strips solutie segment so two sedinte differing only by solutie collide", () => {
    const a = buildSedintaKeyWithoutSolutie({
      stadiuProcesual: "Apel",
      data: "2026-04-19",
      ora: "10:00",
      complet: "C5",
      solutie: "",
    });
    const b = buildSedintaKeyWithoutSolutie({
      stadiuProcesual: "Apel",
      data: "2026-04-19",
      ora: "10:00",
      complet: "C5",
      solutie: "Admite",
    });
    expect(a).toBe(b);
  });

  it("data change still distinguishes", () => {
    const a = buildSedintaKeyWithoutSolutie({
      stadiuProcesual: "Apel",
      data: "2026-04-19",
      ora: "10:00",
      complet: "C5",
      solutie: "",
    });
    const b = buildSedintaKeyWithoutSolutie({
      stadiuProcesual: "Apel",
      data: "2026-04-26",
      ora: "10:00",
      complet: "C5",
      solutie: "",
    });
    expect(a).not.toBe(b);
  });
});
