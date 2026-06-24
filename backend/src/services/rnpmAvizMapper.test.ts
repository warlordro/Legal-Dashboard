import { describe, expect, it } from "vitest";

import type { RnpmDocument, RnpmFullDetail } from "./rnpmClient.ts";
import { buildSaveAvizInput } from "./rnpmAvizMapper.ts";

const baseDoc: RnpmDocument = {
  no: 1,
  identificator: { v: "2026-AV-1", k: "uuid-1" },
  utilizatorAutorizat: "operator",
  data: "2026-05-12",
  tip: "Aviz initial",
  needsActualizare: false,
};

function detailWithActiv(part1Activ?: boolean | null): RnpmFullDetail {
  return {
    part1: part1Activ === undefined ? {} : { activ: part1Activ },
    part2: {},
    part3: {},
    part4: {},
    istoric: [],
  };
}

function mapActiv(docActiv?: boolean | null, part1Activ?: boolean | null): unknown {
  const doc = docActiv === undefined ? baseDoc : { ...baseDoc, activ: docActiv };
  return buildSaveAvizInput(doc, detailWithActiv(part1Activ), "creante", "local", 1).activ;
}

describe("buildSaveAvizInput activ mapping", () => {
  it("returneaza null cand nici part1 nici doc nu au activ boolean", () => {
    expect(mapActiv()).toBeNull();
    expect(mapActiv(null, null)).toBeNull();
  });

  it("returneaza true cand part1.activ este true", () => {
    expect(mapActiv(false, true)).toBe(true);
  });

  it("returneaza false cand part1.activ este false si nu cade prin la doc.activ", () => {
    expect(mapActiv(true, false)).toBe(false);
  });

  it("foloseste doc.activ cand part1.activ lipseste si doc.activ este boolean", () => {
    expect(mapActiv(true)).toBe(true);
    expect(mapActiv(false)).toBe(false);
  });
});
