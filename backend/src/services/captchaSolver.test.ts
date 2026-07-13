import { afterEach, describe, expect, it, vi } from "vitest";

// SDK-ul 2Captcha nu accepta AbortSignal; solver-ul nostru il race-uieste cu
// un abortPromise. Aici il tinem suspendat ca abort-ul sa fie singurul care
// decide soarta slotului.
vi.mock("@2captcha/captcha-solver", () => ({
  Solver: class {
    recaptcha(): Promise<never> {
      return new Promise<never>(() => {});
    }
  },
}));

import { solveRnpmCaptcha } from "./captchaSolver.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("solveRnpmCaptcha — race mode si abort", () => {
  it("abort-ul clientului in timpul race-ului se propaga ca AbortError, nu CaptchaError generic", async () => {
    // fetch-ul CapSolver ramane suspendat si rejecteaza DOAR la abort — mimic
    // al comportamentului fetch real cu AbortSignal.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, opts?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
              once: true,
            });
          })
      )
    );

    const controller = new AbortController();
    const pending = solveRnpmCaptcha("k".repeat(32), "capsolver", "f".repeat(32), controller.signal, "race");
    const assertion = expect(pending).rejects.toSatisfy(
      (e: unknown) => e instanceof DOMException && e.name === "AbortError",
      "asteptat DOMException AbortError"
    );
    setTimeout(() => controller.abort(), 20);
    await assertion;
  });
});
