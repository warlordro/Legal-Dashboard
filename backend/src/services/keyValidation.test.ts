import { afterEach, describe, expect, it, vi } from "vitest";
import { validateKey } from "./keyValidation.ts";

afterEach(() => vi.restoreAllMocks());

describe("validateKey redirect safety (SEC-04)", () => {
  it("sends redirect:manual and treats a 3xx as validation-skipped (not a hard reject)", async () => {
    const seen: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      seen.push(init as RequestInit);
      return new Response(null, { status: 302 }); // 302 is constructible; hits the 3xx guard
    });
    const r = await validateKey("anthropic", "sk-test");
    expect(seen[0]?.redirect).toBe("manual");
    expect(r.valid).toBe(true);
    expect(r.validationSkipped).toBe(true);
  });
  it("passes redirect:manual for every provider branch", async () => {
    const seen: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      seen.push(init as RequestInit);
      return new Response("{}", { status: 200 });
    });
    // twocaptcha carries the key in the query string (res.php?key=...), so a
    // followed redirect would leak it — it MUST also send redirect:"manual".
    for (const f of ["anthropic", "openai", "google", "openrouter", "capsolver", "twocaptcha"] as const) {
      await validateKey(f, "k");
    }
    expect(seen.every((i) => i.redirect === "manual")).toBe(true);
  });
  it("treats a twocaptcha 3xx as validation-skipped (key in query string, no redirect follow)", async () => {
    const seen: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      seen.push(init as RequestInit);
      return new Response(null, { status: 302 });
    });
    const r = await validateKey("twocaptcha", "k");
    expect(seen[0]?.redirect).toBe("manual");
    expect(r.valid).toBe(true);
    expect(r.validationSkipped).toBe(true);
  });
});
