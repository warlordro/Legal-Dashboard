import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetSessionForTests,
  buildSearchBody,
  classifyEnvelope,
  decodeHtmlEntities,
  iccjDateToIso,
  IccjParseError,
  isoToIccjDate,
  parseDetail,
  parseDetailSedinte,
  parseResultCount,
  parseSearchItems,
  parseSedinteItems,
  searchIccjEnriched,
} from "./iccjClient.ts";

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

describe("decodeHtmlEntities", () => {
  it("decodes numeric and named entities", () => {
    expect(decodeHtmlEntities("&#206;nalta &amp; &#238;n")).toBe("Înalta & în");
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a b");
  });
});

describe("iccjDateToIso / isoToIccjDate", () => {
  it("converts DD.MM.YYYY to ISO and passes through everything else", () => {
    expect(iccjDateToIso("04.06.2026")).toBe("2026-06-04");
    expect(iccjDateToIso("20.08.2019")).toBe("2019-08-20");
    expect(iccjDateToIso("")).toBe("");
    expect(iccjDateToIso("-")).toBe("-");
    expect(iccjDateToIso("2026-06-04")).toBe("2026-06-04"); // already ISO
  });
  it("isoToIccjDate is the inverse for ISO and passes through DD.MM.YYYY", () => {
    expect(isoToIccjDate("2026-06-04")).toBe("04.06.2026");
    expect(isoToIccjDate("04.06.2026")).toBe("04.06.2026");
    expect(isoToIccjDate("")).toBe("");
  });
});

describe("parseSedinteItems", () => {
  it("flattens hearings into Termen rows (numar, data ISO, ora, complet, sectie, parti)", () => {
    const env = JSON.parse(fixture("sedinte-04-06-2026.json")) as { Items: string };
    const termene = parseSedinteItems(env.Items);
    expect(termene.length).toBeGreaterThan(10);
    const t = termene[0];
    expect(t.numarDosar).toMatch(/^\d+\/\d+\/\d+/);
    expect(t.iccjId).toMatch(/^\d+$/);
    expect(t.data).toBe("2026-06-04"); // ISO-normalized from the hearing date
    expect(t.ora).toMatch(/^\d{1,2}:\d{2}$/);
    expect(t.complet.toLowerCase()).toContain("complet");
    expect(t.categorieCaz.toLowerCase()).toContain("sec"); // sectie label
    expect(t.categorieCaz).not.toMatch(/→|&rarr;/); // arrow stripped/decoded
    expect(t.institutie).toContain("Casatie");
    expect(t.source).toBe("iccj");
    expect(t.parti.length).toBeGreaterThan(0);
    expect(t.parti[0].nume).not.toMatch(/^-/); // leading "-" stripped
    // No row should leak the "Vezi mai multe parti" pseudo-party.
    expect(termene.every((r) => r.parti.every((p) => !/^Vezi mai multe/i.test(p.nume)))).toBe(true);
  });
});

describe("parseSearchItems", () => {
  it("parses a real single-result row from the live envelope", () => {
    const itemsJson = JSON.parse(fixture("search-1result.json")) as { Items: string };
    const dosare = parseSearchItems(itemsJson.Items);
    expect(dosare).toHaveLength(1);
    const d = dosare[0];
    expect(d.numar).toBe("1085/1/2026");
    expect(d.iccjId).toBe("100000000360872");
    expect(d.data).toBe("2026-06-04"); // DD.MM.YYYY normalized to ISO at parse
    expect(d.obiect).toBe("calcul drepturi salariale");
    expect(d.stadiuProcesual).toBe("Sesizare prealabilă");
    expect(d.departament).toBe("Completul pentru dezlegarea unor chestiuni de drept");
    expect(d.source).toBe("iccj");
    expect(d.parti.map((p) => p.nume)).toEqual(["POPESCU CORNELIU-LIVIU", "UNIVERSITATEA DIN BUCUREŞTI"]);
  });

  it("returns [] for empty items string", () => {
    expect(parseSearchItems("")).toEqual([]);
  });

  it("throws IccjParseError when a row drifts (missing link/id)", () => {
    const drifted = "<tr><td>1</td><td>no link</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td></tr>";
    expect(() => parseSearchItems(drifted)).toThrow(IccjParseError);
  });
});

describe("parseDetail", () => {
  it("parses a case in preliminary procedure (no sedinte)", () => {
    const d = parseDetail(fixture("detaliu-1085-1-2026.html"), "100000000360872");
    expect(d.numar).toBe("1085/1/2026");
    expect(d.numarVechi).toBeUndefined(); // "-" -> omitted
    expect(d.dataInitiala).toBe("2023-12-27");
    expect(d.categorieCaz).toBe("Litigii de muncă");
    expect(d.departament).toBe("Completul pentru dezlegarea unor chestiuni de drept");
    expect(d.obiect).toBe("calcul drepturi salariale");
    expect(d.stadiuProcesual).toBe("Sesizare prealabilă");
    expect(d.parti).toEqual([
      { nume: "POPESCU CORNELIU-LIVIU", calitateParte: "Apelant" },
      { nume: "UNIVERSITATEA DIN BUCUREŞTI", calitateParte: "Intimat" },
    ]);
    expect(d.sedinte).toEqual([]); // "procedura prealabila" -> no termene table
  });

  it("parses a resolved historical case with sedinte and cai de atac", () => {
    const d = parseDetail(fixture("detaliu-istoric-termene.html"), "200000000370871");
    expect(d.numar).toBe("1093/2/2019");
    expect(d.data).toBe("2019-09-04");
    expect(d.dataInitiala).toBe("2019-02-22");
    expect(d.categorieCaz).toBe("Contencios administrativ şi fiscal");
    expect(d.stadiuProcesual).toBe("Recurs");
    // parties carry calitate parsed from "NAME - Calitate"
    expect(d.parti.length).toBeGreaterThan(5);
    expect(d.parti[0].calitateParte).toContain("Intimat");
    expect(d.parti[0].nume).not.toContain(" - ");
    // sedinte parsed from the table; at least one carries a solutie
    expect(d.sedinte.length).toBeGreaterThan(0);
    expect(d.sedinte.some((s) => s.solutie.length > 0 && s.data.length > 0)).toBe(true);
    // cai de atac table
    expect(d.caiAtac?.length).toBeGreaterThan(0);
    expect(d.caiAtac?.[0]).toMatchObject({ dataDeclarare: "2019-08-20", tipCaleAtac: "Recurs" });
  });

  it("throws IccjParseError when the docket_details dl is absent", () => {
    expect(() => parseDetail("<html><body>nope</body></html>", "1")).toThrow(IccjParseError);
  });
});

describe("classifyEnvelope (false-empty guard)", () => {
  it("classifies real results", () => {
    expect(classifyEnvelope({ Status: 1, Keywords: "136 rezultate", Items: "<tr></tr>" })).toBe("results");
  });

  it("classifies a TRUE empty only with the exact marker", () => {
    expect(classifyEnvelope({ Status: 1, Keywords: "Nu sunt rezultate.", Items: null })).toBe("empty");
  });

  it("treats null Items with an unexpected Keywords as an error (false-empty)", () => {
    expect(classifyEnvelope({ Status: 1, Keywords: "", Items: null })).toBe("error");
    expect(classifyEnvelope({ Status: 0, Keywords: "Nu sunt rezultate.", Items: null })).toBe("error");
  });

  it("F8: classifies singular-template and thousands-separated counts as results", () => {
    expect(classifyEnvelope({ Status: 1, Keywords: "1 rezultate", Items: "<tr></tr>" })).toBe("results");
    expect(classifyEnvelope({ Status: 1, Keywords: "1.234 rezultate", Items: "<tr></tr>" })).toBe("results");
  });
});

describe("parseResultCount (F8 - locale-tolerant count)", () => {
  it("parses plain, singular/plural, and thousands-separated counts", () => {
    expect(parseResultCount("136 rezultate")).toBe(136);
    expect(parseResultCount("1 rezultate")).toBe(1); // scj.ro ungrammatical plural for 1
    expect(parseResultCount("1 rezultat")).toBe(1); // singular tolerated
    expect(parseResultCount("1.234 rezultate")).toBe(1234); // dot thousands separator
    expect(parseResultCount("1 234 rezultate")).toBe(1234); // space thousands separator
  });
  it("returns null for non-count keyword lines", () => {
    expect(parseResultCount("Nu sunt rezultate.")).toBeNull();
    expect(parseResultCount("Cautare dosare")).toBeNull();
    expect(parseResultCount("")).toBeNull();
  });
});

describe("buildSearchBody (F2 - ISO date conversion)", () => {
  it("converts dataStart/dataStop from ISO to DD.MM.YYYY for scj.ro", () => {
    const body = buildSearchBody({ numarDosar: "1/1/2025", dataStart: "2026-06-04", dataStop: "2026-06-30" });
    const params = new URLSearchParams(body);
    const byKey: Record<string, string> = {};
    for (let i = 0; i < 6; i += 1) {
      const k = params.get(`CustomQuery[${i}].Key`);
      if (k) byKey[k] = params.get(`CustomQuery[${i}].Value`) ?? "";
    }
    expect(byKey.StartDate).toBe("04.06.2026");
    expect(byKey.EndDate).toBe("30.06.2026");
    expect(body).not.toContain("2026-06-04");
  });
});

describe("parseDetailSedinte (F5 - fail loud on table drift)", () => {
  it("returns [] when there is genuinely no <table>", () => {
    expect(parseDetailSedinte("<p>Dosarul nu are sedinte</p>")).toEqual([]);
  });
  it("throws IccjParseError when a <table> is present but has no <tbody> (drift)", () => {
    expect(() => parseDetailSedinte("<table><tr><td>04.06.2026</td></tr></table>")).toThrow(IccjParseError);
  });
  it("parses rows from a <tbody>", () => {
    const dd = "<table><tbody><tr><td>04.06.2026</td><td>09:00</td><td><ul><li>x</li></ul></td></tr></tbody></table>";
    const rows = parseDetailSedinte(dd);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ data: "2026-06-04", ora: "09:00" });
  });
});

describe("searchIccjEnriched (F3 - per-item isolation)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetSessionForTests();
  });
  it("isolates one failing detail fetch; other rows still enrich", async () => {
    const okDetail = fixture("detaliu-1085-1-2026.html");
    const row = (id: string, numar: string) =>
      `<tr><td>1</td><td><a href="/1094/Detalii-dosar?customQuery[0].Value=${id}">${numar}</a></td>` +
      "<td>01.01.2025</td><td>obiect</td><td>Recurs</td><td>Sectia</td><td><ul><li>POPESCU ION</li></ul></td></tr>";
    const envelope = JSON.stringify({
      Status: 1,
      Keywords: "2 rezultate",
      Items: row("100", "1/1/2025") + row("200", "2/1/2025"),
    });
    vi.stubGlobal("fetch", async (url: string | URL, init?: { method?: string }) => {
      const u = String(url);
      if (init?.method === "POST") return new Response(envelope, { status: 200 });
      if (u.includes("Value=100")) return new Response(okDetail, { status: 200 });
      if (u.includes("Value=200")) return new Response("<html><body>no docket details</body></html>", { status: 200 });
      return new Response("", { status: 200 }); // warm-session GET
    });

    const res = await searchIccjEnriched({ numeParte: "popescu" });
    expect(res.dosare).toHaveLength(2);
    const d100 = res.dosare.find((d) => d.iccjId === "100");
    const d200 = res.dosare.find((d) => d.iccjId === "200");
    expect(d100?.parti.some((p) => p.calitateParte.length > 0)).toBe(true); // enriched from detail
    expect(d200?.parti.every((p) => p.calitateParte.length === 0)).toBe(true); // failed enrich → bare list row, isolated
  });
});
