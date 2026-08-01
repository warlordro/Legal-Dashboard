// Bugetul de timp la `fetchIstoric`.
//
// Incident 2026-08-01: 12 avize pierdute integral pentru ca istoricul a ars
// bugetul. Doua defecte distincte in acelasi loc:
//   (a) ambele incercari impart UN SINGUR buget — daca prima consuma aproape tot,
//       a doua porneste cu semnalul deja expirat si nu are nicio sansa;
//   (b) reincercarea exista doar pe raspuns 400. O prima incercare AGATATA arunca
//       direct, fara a doua sansa — exact profilul observat in incident.
//
// Istoricul e date optionale, dar cand cade ia cu el si partile 1-4 ale avizului
// (`Promise.all` in `fetchFullDetail`), deci avizul se pierde complet.
import { afterEach, describe, expect, it, vi } from "vitest";

import { RnpmClient } from "./rnpmClient.ts";

const ISTORIC_OK = { inscriere: "x", istoric: [{ tip: "initial" }] };

function jsonResponse(status: number, payload: unknown = {}) {
  return new Response(JSON.stringify(payload), { status });
}

// Fetch care nu rezolva niciodata, dar respecta semnalul — un socket agatat.
function hungFetch(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.RNPM_TIMEOUT_MS;
});

describe("fetchIstoric — buget per incercare", () => {
  it("a doua incercare dupa 400 primeste buget nou, nu resturile primei", async () => {
    // Bugetul e mai scurt decat pauza de backoff. Cu buget PARTAJAT, semnalul
    // expira in timpul pauzei si a doua incercare porneste moarta.
    process.env.RNPM_TIMEOUT_MS = "1000";
    let calls = 0;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      calls++;
      if (calls === 1) return jsonResponse(400, { error: "" });
      if (init?.signal?.aborted) throw init.signal.reason ?? new Error("aborted");
      return jsonResponse(200, ISTORIC_OK);
    }) as unknown as typeof fetch;

    const client = new RnpmClient({ requestDelayMs: 0, fetchImpl });
    const out = await client.fetchIstoric("11111111-1111-1111-1111-111111111111");

    expect(calls).toBe(2);
    expect(out).toEqual(ISTORIC_OK.istoric);
  });

  it("o prima incercare agatata pana la timeout primeste totusi o a doua sansa", async () => {
    // Azi `fetchIstoric` reincearca DOAR pe status 400; un fetch care expira
    // arunca direct. Exact cazul din incident.
    process.env.RNPM_TIMEOUT_MS = "150";
    let calls = 0;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      calls++;
      if (calls === 1) return hungFetch(init?.signal);
      return jsonResponse(200, ISTORIC_OK);
    }) as unknown as typeof fetch;

    const client = new RnpmClient({ requestDelayMs: 0, fetchImpl });
    const out = await client.fetchIstoric("22222222-2222-2222-2222-222222222222");

    expect(calls).toBe(2);
    expect(out).toEqual(ISTORIC_OK.istoric);
  });

  it("abortul extern in timpul primei incercari NU declanseaza a doua", async () => {
    process.env.RNPM_TIMEOUT_MS = "60000";
    let calls = 0;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      calls++;
      return hungFetch(init?.signal);
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    const client = new RnpmClient({ requestDelayMs: 0, fetchImpl });
    const run = client.fetchIstoric("33333333-3333-3333-3333-333333333333", controller.signal);
    await vi.waitFor(() => expect(calls).toBe(1));
    controller.abort();

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
});
