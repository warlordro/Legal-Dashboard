import { describe, expect, it } from "vitest";
import type { RnpmDocument } from "@/types/rnpm";
import { appendUniqueDocuments } from "./rnpmDedup";

function doc(v: string, no = 1): RnpmDocument {
  return {
    no,
    identificator: { v, k: null },
    utilizatorAutorizat: "",
    data: "11.05.2022",
    tip: "Aviz initial",
    needsActualizare: false,
    activ: true,
  };
}

describe("appendUniqueDocuments", () => {
  it("arunca randurile repetate de upstream intre batch-uri, pastrand avizIds aliniate", () => {
    const prev = { documents: [doc("A"), doc("B")], avizIds: [1, 2] as (number | null)[] };
    const next = { documents: [doc("B"), doc("C")], avizIds: [9, 3] as (number | null)[] };

    const merged = appendUniqueDocuments(prev, next);

    expect(merged.documents.map((d) => d.identificator.v)).toEqual(["A", "B", "C"]);
    expect(merged.avizIds).toEqual([1, 2, 3]);
  });

  it("deduplica si repetitiile din interiorul aceluiasi batch", () => {
    const prev = { documents: [] as RnpmDocument[], avizIds: [] as (number | null)[] };
    const next = { documents: [doc("A"), doc("A"), doc("B")], avizIds: [1, 1, 2] as (number | null)[] };

    const merged = appendUniqueDocuments(prev, next);

    expect(merged.documents.map((d) => d.identificator.v)).toEqual(["A", "B"]);
    expect(merged.avizIds).toEqual([1, 2]);
  });

  it("batch fara suprapuneri se adauga integral, in ordinea primita", () => {
    const prev = { documents: [doc("A")], avizIds: [1] as (number | null)[] };
    const next = { documents: [doc("B"), doc("C")], avizIds: [null, 3] as (number | null)[] };

    const merged = appendUniqueDocuments(prev, next);

    expect(merged.documents.map((d) => d.identificator.v)).toEqual(["A", "B", "C"]);
    expect(merged.avizIds).toEqual([1, null, 3]);
  });
});
