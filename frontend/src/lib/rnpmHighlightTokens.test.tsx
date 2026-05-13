import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { highlightTokens, anyTokenMatches } from "./rnpmHighlightTokens";

function renderMarkup(node: ReturnType<typeof highlightTokens>): string {
  return renderToStaticMarkup(<span>{node}</span>);
}

function renderToText(node: ReturnType<typeof highlightTokens>): string {
  return renderMarkup(node).replace(/<[^>]+>/g, "");
}

function renderMarks(node: ReturnType<typeof highlightTokens>): string[] {
  return Array.from(renderMarkup(node).matchAll(/<mark[^>]*>(.*?)<\/mark>/g)).map((match) => match[1] ?? "");
}

describe("highlightTokens", () => {
  it("returneaza textul original cand tokens e gol", () => {
    expect(highlightTokens("Hello world", [])).toBe("Hello world");
  });

  it("returneaza string gol pentru null/undefined", () => {
    expect(highlightTokens(null, ["x"])).toBe("");
    expect(highlightTokens(undefined, ["x"])).toBe("");
  });

  it("highlight single token case-insensitive", () => {
    const node = highlightTokens("Hello World", ["world"]);
    expect(renderMarks(node)).toEqual(["World"]);
    expect(renderToText(node)).toBe("Hello World");
  });

  it("highlight single token diacritice-insensitive", () => {
    const node = highlightTokens("\u0218tefan POPESCU", ["stefan"]);
    expect(renderMarks(node)).toEqual(["\u0218tefan"]);
    expect(renderToText(node)).toBe("\u0218tefan POPESCU");
  });

  it("highlight multiple tokens distincte", () => {
    const node = highlightTokens("ALTEX ROMANIA SRL totalitatea creantelor", ["altex", "totalitatea"]);
    expect(renderMarks(node)).toEqual(["ALTEX", "totalitatea"]);
  });

  it("multiple ocurente ale aceluiasi token", () => {
    const node = highlightTokens("test test test", ["test"]);
    expect(renderMarks(node)).toEqual(["test", "test", "test"]);
  });

  it("intervale suprapuse se fuzioneaza", () => {
    const node = highlightTokens("abcdef", ["abc", "bcd"]);
    expect(renderMarks(node)).toEqual(["abcd"]);
  });

  it("token absent nu produce mark", () => {
    const node = highlightTokens("Hello World", ["xyz"]);
    expect(renderMarks(node)).toEqual([]);
    expect(renderToText(node)).toBe("Hello World");
  });

  it("pastreaza textul cu diacritice in output cand match se face diacritice-insensitive", () => {
    const node = highlightTokens("\u0218tefan C\u0103lin", ["calin"]);
    expect(renderMarks(node)).toEqual(["C\u0103lin"]);
  });

  it("token vid din input ignorat", () => {
    const node = highlightTokens("Hello", [""]);
    expect(renderMarks(node)).toEqual([]);
    expect(renderToText(node)).toBe("Hello");
  });
});

describe("anyTokenMatches", () => {
  it("returneaza true cand tokens e gol", () => {
    expect(anyTokenMatches(["a", "b"], [])).toBe(true);
  });

  it("returneaza true cand un token apare", () => {
    expect(anyTokenMatches(["Hello World"], ["world"])).toBe(true);
  });

  it("returneaza false cand niciun token nu apare", () => {
    expect(anyTokenMatches(["Hello World"], ["xyz"])).toBe(false);
  });

  it("diacritice-insensitive", () => {
    expect(anyTokenMatches(["\u0218tefan"], ["stefan"])).toBe(true);
  });

  it("ignora textele null/undefined", () => {
    expect(anyTokenMatches([null, undefined, "Hello"], ["hello"])).toBe(true);
  });

  it("returneaza false cand toate textele sunt null", () => {
    expect(anyTokenMatches([null, undefined, ""], ["x"])).toBe(false);
  });
});
