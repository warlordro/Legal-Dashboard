import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HighlightName } from "./dosare-table-highlight";

function renderHighlight(text: string, search?: string): string {
  return renderToStaticMarkup(<HighlightName text={text} search={search} />);
}

function highlightedParts(markup: string): string[] {
  return Array.from(markup.matchAll(/class="[^"]*bg-yellow-200[^"]*"[^>]*>(.*?)<\/span>/g)).map((m) => m[1] ?? "");
}

describe("HighlightName", () => {
  it("highlights only identity tokens when search includes legal forms", () => {
    const markup = renderHighlight("SC ACME SRL", "SC ACME SRL");
    expect(highlightedParts(markup)).toEqual(["ACME"]);
    expect(highlightedParts(markup)).not.toContain("SC");
    expect(highlightedParts(markup)).not.toContain("SRL");
  });

  it("highlights identity words but not SA suffix", () => {
    const markup = renderHighlight("BANCA COMERCIALA TRANSILVANIA SA", "BANCA TRANSILVANIA SA");
    expect(highlightedParts(markup)).toEqual(["BANCA", "TRANSILVANIA"]);
    expect(highlightedParts(markup)).not.toContain("SA");
  });

  it("matches identity across punctuation in party name", () => {
    const markup = renderHighlight("S.C. Acme S.R.L.", "acme");
    expect(highlightedParts(markup)).toEqual(["Acme"]);
  });

  it("renders plain text when search is empty", () => {
    expect(renderHighlight("SC ACME SRL", "")).toBe("SC ACME SRL");
    expect(renderHighlight("SC ACME SRL", undefined)).toBe("SC ACME SRL");
  });

  it("falls back to highlighting legal-form tokens when search is only legal forms", () => {
    const markup = renderHighlight("SC SRL", "SC SRL");
    expect(highlightedParts(markup)).toEqual(["SC", "SRL"]);
  });
});
