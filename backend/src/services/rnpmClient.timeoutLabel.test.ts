// Eticheta pe expirari: care sub-cerere a cazut.
//
// Investigatia incidentului din 2026-08-01 a durat o zi in mare parte pentru ca
// toate cauzele posibile produceau text identic in log — "The operation was
// aborted due to timeout" — fara sa spuna daca a cazut o parte sau istoricul.
//
// Capcana (semnalata la review): impachetarea trebuie sa acopere DOAR
// `TimeoutError`. Daca ar prinde orice DOMException, `AbortError` s-ar
// transforma in esec obisnuit, iar bucla de detalii ar continua sa lucreze dupa
// ce clientul a plecat — regresie pe gardul de abort livrat separat.
import { afterEach, describe, expect, it, vi } from "vitest";

import { RnpmClient } from "./rnpmClient.ts";
import { drippingStream } from "./rnpmClient.testStreams.ts";

function hungFetch(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
  });
}

// Raspuns cu headerele primite, dar body care picura la nesfarsit: bugetul
// acopera si citirea, deci expirarea poate cadea in faza de body, nu de fetch.
function drippingResponse(): Response {
  return new Response(drippingStream(), { status: 200 });
}

afterEach(() => {
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.RNPM_TIMEOUT_MS;
});

describe("etichetarea expirarilor pe cererile de detaliu", () => {
  it("expirarea unei parti spune care parte a cazut", async () => {
    process.env.RNPM_TIMEOUT_MS = "80";
    const client = new RnpmClient({
      requestDelayMs: 0,
      fetchImpl: ((_u: unknown, init?: RequestInit) => hungFetch(init?.signal)) as unknown as typeof fetch,
    });

    await expect(client.fetchPart("44444444-4444-4444-4444-444444444444", 3)).rejects.toThrow(/part=3/);
  });

  it("expirarea istoricului spune ca a cazut istoricul", async () => {
    process.env.RNPM_TIMEOUT_MS = "80";
    const client = new RnpmClient({
      requestDelayMs: 0,
      fetchImpl: ((_u: unknown, init?: RequestInit) => hungFetch(init?.signal)) as unknown as typeof fetch,
    });

    await expect(client.fetchIstoric("55555555-5555-5555-5555-555555555555")).rejects.toThrow(/istoric/i);
  });

  it("abortul de client NU e impachetat — ramane AbortError", async () => {
    process.env.RNPM_TIMEOUT_MS = "60000";
    const client = new RnpmClient({
      requestDelayMs: 0,
      fetchImpl: ((_u: unknown, init?: RequestInit) => hungFetch(init?.signal)) as unknown as typeof fetch,
    });

    const controller = new AbortController();
    const run = client.fetchPart("66666666-6666-6666-6666-666666666666", 1, controller.signal);
    controller.abort();

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });

  it("expirarea la CITIREA body-ului e etichetata, nu generica", async () => {
    // Bugetul acopera cererea intreaga. Daca eticheta acopera doar faza de fetch,
    // o expirare aparuta in timpul citirii iese negeneric si nespus.
    process.env.RNPM_TIMEOUT_MS = "80";
    const client = new RnpmClient({
      requestDelayMs: 0,
      fetchImpl: (async () => drippingResponse()) as unknown as typeof fetch,
    });

    await expect(client.fetchPart("77777777-7777-7777-7777-777777777777", 2)).rejects.toThrow(/part=2/);
  });

  it("expirarea la reincercarea de dupa 400 spune tot ca a cazut istoricul", async () => {
    process.env.RNPM_TIMEOUT_MS = "80";
    let calls = 0;
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ error: "" }), { status: 400 });
      return hungFetch(init?.signal);
    }) as unknown as typeof fetch;
    const client = new RnpmClient({ requestDelayMs: 0, fetchImpl });

    await expect(client.fetchIstoric("88888888-8888-8888-8888-888888888888")).rejects.toThrow(/istoric/i);
  });

  it("timeout-ul APELANTULUI nu e reetichetat ca expirare RNPM", async () => {
    // Daca apelantul impune propriul termen, expirarea lui trebuie sa iasa ca
    // atare: altfel un termen extern devine "esec de detaliu" si bucla continua
    // ca si cum ar mai fi timp.
    process.env.RNPM_TIMEOUT_MS = "60000";
    const client = new RnpmClient({
      requestDelayMs: 0,
      fetchImpl: ((_u: unknown, init?: RequestInit) => hungFetch(init?.signal)) as unknown as typeof fetch,
    });

    const run = client.fetchPart("99999999-9999-9999-9999-999999999999", 1, AbortSignal.timeout(60));

    await expect(run).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
