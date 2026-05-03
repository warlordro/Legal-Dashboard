import { describe, expect, it } from "vitest";
import {
  buildRnpmLikePattern,
  stripDiacritics,
  stripDiacriticsDeep,
} from "./textNormalize.js";

describe("stripDiacritics", () => {
  it("strips Romanian diacritics from common letters", () => {
    expect(stripDiacritics("Ștefan Țăran")).toBe("Stefan Taran");
    expect(stripDiacritics("ăîâșț")).toBe("aiast");
    expect(stripDiacritics("ĂÎÂȘȚ")).toBe("AIAST");
  });

  it("is a no-op on plain ASCII", () => {
    expect(stripDiacritics("PLAIN STRING 123")).toBe("PLAIN STRING 123");
  });

  it("preserves the empty string", () => {
    expect(stripDiacritics("")).toBe("");
  });
});

describe("buildRnpmLikePattern", () => {
  // Wildcard escaping is the security-relevant property: a regression here
  // would let a user pass `%` and get the entire table back from any LIKE
  // search. All assertions assume the call site pairs the bound parameter
  // with `ESCAPE '\\'` (see helper contract).

  it("escapes the SQL LIKE wildcard `%`", () => {
    expect(buildRnpmLikePattern("50%")).toBe("%50\\%%");
  });

  it("escapes the SQL LIKE wildcard `_`", () => {
    expect(buildRnpmLikePattern("a_b")).toBe("%a\\_b%");
  });

  it("escapes a literal backslash before SQLite parses it", () => {
    expect(buildRnpmLikePattern("c:\\path")).toBe("%c:\\\\path%");
  });

  it("escapes all three meta characters in one input", () => {
    expect(buildRnpmLikePattern("a%b_c\\d")).toBe("%a\\%b\\_c\\\\d%");
  });

  it("strips diacritics and lowercases (RNPM column normalization parity)", () => {
    expect(buildRnpmLikePattern("ȘTEFAN")).toBe("%stefan%");
    expect(buildRnpmLikePattern("ăîș")).toBe("%ais%");
  });

  it("returns just the wildcard wrapper for empty input", () => {
    // Note: callers should normally guard against empty `q` before calling
    // this helper — `%%` matches everything. Test asserts current behavior;
    // the trim-guard in repositories (M-4 fix) prevents this from being a
    // SELECT-all in production.
    expect(buildRnpmLikePattern("")).toBe("%%");
  });

  it("preserves whitespace inside the pattern (no implicit trim)", () => {
    // Whitespace handling is the caller's responsibility — repositories now
    // guard with `q?.trim()` so this branch is unreachable from HTTP, but the
    // helper itself stays pure.
    expect(buildRnpmLikePattern("   ")).toBe("%   %");
  });

  it("is case-insensitive vs uppercase ASCII", () => {
    expect(buildRnpmLikePattern("ABC")).toBe("%abc%");
  });
});

describe("stripDiacriticsDeep", () => {
  it("walks objects, arrays, and primitives", () => {
    const input = {
      name: "Ștefan",
      address: { city: "Iași", zip: 700100 },
      tags: ["ură", "țară", null],
      active: true,
    };
    expect(stripDiacriticsDeep(input)).toEqual({
      name: "Stefan",
      address: { city: "Iasi", zip: 700100 },
      tags: ["ura", "tara", null],
      active: true,
    });
  });

  it("returns non-string primitives unchanged", () => {
    expect(stripDiacriticsDeep(42)).toBe(42);
    expect(stripDiacriticsDeep(null)).toBe(null);
    expect(stripDiacriticsDeep(undefined)).toBe(undefined);
  });
});
