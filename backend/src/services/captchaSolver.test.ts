import util from "node:util";
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

  // Sink-ul real e logging-ul object-aware (`console.error(e)` = util.inspect),
  // care printeaza message, stack, proprietatile enumerabile SI lantul [cause].
  // Un assert doar pe `.message` ar trece si daca cause-ul brut reapare.
  const fullyRedacted = (e: unknown, secret: string): boolean => {
    const dump = util.inspect(e, { depth: 20 });
    return !dump.includes(secret) && !dump.includes(encodeURIComponent(secret)) && dump.includes("***");
  };

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

    await expect(solve(KEY, "2captcha")).rejects.toSatisfy(
      (e: unknown) => fullyRedacted(e, KEY),
      "asteptat obiect de eroare fara cheie (message, stack, cause), cu ***"
    );
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

    await expect(balance(KEY, "2captcha")).rejects.toSatisfy(
      (e: unknown) => fullyRedacted(e, KEY),
      "asteptat obiect de eroare fara cheie (message, stack, cause), cu ***"
    );
  });

  it("redacteaza si forma percent-encodata a cheii (BYOK cu caractere non-alfanumerice)", async () => {
    // Cheile 2Captcha oficiale sunt alfanumerice, dar validateKey accepta orice
    // string >= 10 caractere (BYOK desktop, CapSolver). Un `+` sau `/` apare in
    // URL codificat, deci o inlocuire doar pe forma bruta ar rata secretul.
    const RAW = "abc+def/ghi=jkl";
    vi.doMock("@2captcha/captcha-solver", () => ({
      Solver: class {
        constructor(private readonly apikey: string) {}
        recaptcha(): Promise<never> {
          return Promise.reject(
            new Error(
              `request to https://2captcha.com/in.php?key=${encodeURIComponent(this.apikey)}&json=1 failed, reason: ECONNRESET`
            )
          );
        }
      },
    }));
    vi.resetModules();
    const { solveRnpmCaptcha: solve } = await import("./captchaSolver.ts");

    await expect(solve(RAW, "2captcha")).rejects.toSatisfy(
      (e: unknown) => fullyRedacted(e, RAW),
      "asteptat obiect de eroare fara cheie in nicio forma, cu ***"
    );
  });

  it("cause-ul se reconstruieste: proprietatile enumerabile extra si cause-ul imbricat al erorii SDK nu scapa cheia", async () => {
    // Mock otravit: FetchError-ul real tine cheia in message si stack, dar un
    // SDK viitor ar putea-o pune si in proprietati enumerabile (`url`) sau intr-un
    // `cause` imbricat. redactCaptchaCause arunca deliberat tot ce nu e
    // name/message/stack — testul pica daca cineva "pastreaza" campurile brute.
    vi.doMock("@2captcha/captcha-solver", () => ({
      Solver: class {
        constructor(private readonly apikey: string) {}
        recaptcha(): Promise<never> {
          const url = `https://2captcha.com/in.php?key=${this.apikey}&json=1`;
          const err = Object.assign(new Error(`request to ${url} failed, reason: ECONNREFUSED`), {
            url,
            cause: new Error(`inner request to ${url} failed`),
          });
          return Promise.reject(err);
        }
      },
    }));
    vi.resetModules();
    const { solveRnpmCaptcha: solve } = await import("./captchaSolver.ts");

    await expect(solve(KEY, "2captcha")).rejects.toSatisfy(
      (e: unknown) => fullyRedacted(e, KEY),
      "asteptat obiect de eroare complet redactat (fara url/cause imbricat brute)"
    );
  });
});
