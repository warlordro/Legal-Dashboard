// Determinism tests for canonicalJson — the basis of monitoring_jobs.target_hash.
// If any of these fail, two clients with logically-identical targets could
// produce different hashes and bypass the UNIQUE(owner_id, target_hash, kind)
// guard, allowing duplicate watch jobs.

import { describe, expect, it } from "vitest";
import { canonicalJson, canonicalSha256 } from "./canonicalJson.ts";

describe("canonicalJson — key ordering", () => {
  it("sorts top-level keys alphabetically", () => {
    expect(canonicalJson({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it("produces identical output regardless of insertion order", () => {
    const a = canonicalJson({ kind: "dosar_soap", numar: "1234/180/2024" });
    const b = canonicalJson({ numar: "1234/180/2024", kind: "dosar_soap" });
    expect(a).toBe(b);
  });

  it("sorts nested object keys recursively", () => {
    const out = canonicalJson({ outer: { z: 1, a: 2 }, b: { y: 3, x: 4 } });
    expect(out).toBe('{"b":{"x":4,"y":3},"outer":{"a":2,"z":1}}');
  });

  it("deeply nested 3+ levels", () => {
    const a = canonicalJson({ a: { b: { c: { z: 1, a: 2 } } } });
    const b = canonicalJson({ a: { b: { c: { a: 2, z: 1 } } } });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"b":{"c":{"a":2,"z":1}}}}');
  });
});

describe("canonicalJson — array semantics", () => {
  it("preserves array order (semantically meaningful)", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("does NOT sort arrays of objects", () => {
    const out = canonicalJson([{ z: 1 }, { a: 2 }]);
    expect(out).toBe('[{"z":1},{"a":2}]');
  });

  it("sorts keys inside array elements", () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("array of mixed scalars + objects keeps order, sorts inside objects", () => {
    const out = canonicalJson([1, { z: 9, a: 0 }, "x", null]);
    expect(out).toBe('[1,{"a":0,"z":9},"x",null]');
  });
});

describe("canonicalJson — primitive handling", () => {
  it("handles null", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  it("drops undefined values (matching JSON.stringify)", () => {
    expect(canonicalJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it("handles strings, numbers, booleans", () => {
    expect(canonicalJson("hello")).toBe('"hello"');
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
  });

  it("escapes special chars same as JSON.stringify", () => {
    expect(canonicalJson({ s: 'a"b' })).toBe('{"s":"a\\"b"}');
    expect(canonicalJson({ s: "line\nbreak" })).toBe('{"s":"line\\nbreak"}');
  });
});

describe("canonicalJson — no whitespace", () => {
  it("emits zero-whitespace output", () => {
    const out = canonicalJson({ a: 1, b: { c: 2 } });
    expect(out).not.toContain(" ");
    expect(out).not.toContain("\n");
  });
});

describe("canonicalSha256 — deterministic hash", () => {
  it("returns 64-char hex digest", () => {
    const h = canonicalSha256({ a: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("identical objects with different key order → same hash", () => {
    const h1 = canonicalSha256({ kind: "dosar_soap", numar: "1234/180/2024" });
    const h2 = canonicalSha256({ numar: "1234/180/2024", kind: "dosar_soap" });
    expect(h1).toBe(h2);
  });

  it("different content → different hash", () => {
    const h1 = canonicalSha256({ numar: "1234/180/2024" });
    const h2 = canonicalSha256({ numar: "1234/180/2025" });
    expect(h1).not.toBe(h2);
  });
});
