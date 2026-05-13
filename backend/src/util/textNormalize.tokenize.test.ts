import { describe, it, expect } from "vitest";
import { tokenizeFilterQuery, FILTER_TOKEN_MAX_COUNT } from "./textNormalize.ts";

describe("tokenizeFilterQuery", () => {
  it("returneaza array gol pentru string gol sau whitespace-only", () => {
    expect(tokenizeFilterQuery("")).toEqual([]);
    expect(tokenizeFilterQuery("   ")).toEqual([]);
    expect(tokenizeFilterQuery("\t\n  ")).toEqual([]);
  });

  it("returneaza array gol pentru non-string", () => {
    expect(tokenizeFilterQuery(null as unknown as string)).toEqual([]);
    expect(tokenizeFilterQuery(undefined as unknown as string)).toEqual([]);
    expect(tokenizeFilterQuery(123 as unknown as string)).toEqual([]);
  });

  it("split pe whitespace simplu", () => {
    expect(tokenizeFilterQuery("alfa beta")).toEqual(["alfa", "beta"]);
  });

  it("split pe whitespace mixt (spatii, tab, newline)", () => {
    expect(tokenizeFilterQuery("alfa\tbeta\n gamma")).toEqual(["alfa", "beta", "gamma"]);
  });

  it("ignora whitespace la inceput si sfarsit", () => {
    expect(tokenizeFilterQuery("   alfa   beta   ")).toEqual(["alfa", "beta"]);
  });

  it("dedup case-insensitive", () => {
    expect(tokenizeFilterQuery("Stefan stefan STEFAN")).toEqual(["Stefan"]);
  });

  it("dedup diacritice-insensitive", () => {
    expect(tokenizeFilterQuery("Stefan \u0218TEFAN \u015Etefan")).toEqual(["Stefan"]);
  });

  it("dedup pastreaza prima aparitie", () => {
    expect(tokenizeFilterQuery("BETA alfa beta ALFA")).toEqual(["BETA", "alfa"]);
  });

  it(`limiteaza la ${FILTER_TOKEN_MAX_COUNT} tokens`, () => {
    const input = Array.from({ length: 20 }, (_, i) => `t${i}`).join(" ");
    const out = tokenizeFilterQuery(input);
    expect(out.length).toBe(FILTER_TOKEN_MAX_COUNT);
    expect(out[0]).toBe("t0");
    expect(out[FILTER_TOKEN_MAX_COUNT - 1]).toBe(`t${FILTER_TOKEN_MAX_COUNT - 1}`);
  });

  it("pastreaza tokens cu diacritice in output", () => {
    expect(tokenizeFilterQuery("\u0218tefan C\u0103lin")).toEqual(["\u0218tefan", "C\u0103lin"]);
  });

  it("trateaza string-uri foarte lungi fara whitespace ca un singur token", () => {
    const long = "a".repeat(500);
    expect(tokenizeFilterQuery(long)).toEqual([long]);
  });
});
