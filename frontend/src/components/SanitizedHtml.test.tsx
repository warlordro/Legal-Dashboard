// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { formatAiMarkdownLine, sanitizeAiHtml } from "./SanitizedHtml";

describe("sanitizeAiHtml", () => {
  it("pastreaza doar tagurile AI permise", () => {
    expect(sanitizeAiHtml("<strong>ok</strong><em>em</em><b>b</b><i>i</i>")).toBe(
      "<strong>ok</strong><em>em</em><b>b</b><i>i</i>"
    );
  });

  it("sterge script tags", () => {
    expect(sanitizeAiHtml("<script>alert(1)</script><strong>ok</strong>")).toBe("<strong>ok</strong>");
  });

  it("sterge atributele de event handler", () => {
    expect(sanitizeAiHtml('<strong onclick="alert(1)">ok</strong>')).toBe("<strong>ok</strong>");
  });

  it("sterge linkurile si pastreaza textul", () => {
    expect(sanitizeAiHtml('<a href="javascript:alert(1)">click</a>')).toBe("click");
  });
});

describe("formatAiMarkdownLine", () => {
  it("converteste bold markdown in strong inainte de sanitizare", () => {
    expect(sanitizeAiHtml(formatAiMarkdownLine("Text **important**"))).toBe("Text <strong>important</strong>");
  });
});
