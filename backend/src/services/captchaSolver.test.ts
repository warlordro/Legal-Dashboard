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

// F12-F5 (2026-07-26): SDK-ul 2Captcha pune cheia in query string-ul requestului,
// iar node-fetch include URL-ul intreg in mesajul FetchError. Mesajul ajungea
// verbatim la client (corp 500, evenimente SSE bulk/split, corp 400 pe balance).
// In web mode cheia e a TENANTULUI. Testele de mai jos re-mock-uiesc SDK-ul cu un
// Solver care rejecteaza exact ca node-fetch si verifica pe modulul reimportat.
describe("F12-F5 — cheia captcha nu ajunge in mesajele de eroare", () => {
  const KEY = "abcdef0123456789abcdef0123456789";

  afterEach(() => {
    vi.doUnmock("@2captcha/captcha-solver");
    vi.resetModules();
  });

  it("solveRnpmCaptcha redacteaza cheia dintr-o eroare de transport a SDK-ului 2Captcha", async () => {
    vi.doMock("@2captcha/captcha-solver", () => ({
      Solver: class {
        constructor(private readonly apikey: string) {}
        recaptcha(): Promise<never> {
          return Promise.reject(
            new Error(`request to https://2captcha.com/in.php?key=${this.apikey}&json=1 failed, reason: ECONNREFUSED`)
          );
        }
      },
    }));
    vi.resetModules();
    const { solveRnpmCaptcha: solve } = await import("./captchaSolver.ts");

    await expect(solve(KEY, "2captcha")).rejects.toSatisfy((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      return !msg.includes(KEY) && msg.includes("***");
    }, "asteptat mesaj fara cheie, cu ***");
  });

  it("getCaptchaBalance redacteaza cheia dintr-o eroare de transport", async () => {
    vi.doMock("@2captcha/captcha-solver", () => ({
      Solver: class {
        constructor(private readonly apikey: string) {}
        balance(): Promise<never> {
          return Promise.reject(
            new Error(
              `request to https://2captcha.com/res.php?key=${this.apikey}&action=getbalance failed, reason: ENOTFOUND`
            )
          );
        }
      },
    }));
    vi.resetModules();
    const { getCaptchaBalance: balance } = await import("./captchaSolver.ts");

    await expect(balance(KEY, "2captcha")).rejects.toSatisfy((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      return !msg.includes(KEY) && msg.includes("***");
    }, "asteptat mesaj fara cheie, cu ***");
  });
});
