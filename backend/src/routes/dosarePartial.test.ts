import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock DOAR soap.ts (cautareDosare) — dosareFanout.ts ruleaza REAL, ca sa
// verificam ca fallback-ul chiar face fan-out pe catalog. importActual pastreaza
// SoapResponseTooLargeError typed pentru drumul 413.
vi.mock("../soap.ts", async (orig) => {
  const actual = await orig<typeof import("../soap.ts")>();
  return { ...actual, cautareDosare: vi.fn() };
});

import { allInstitutionTokens } from "../util/institutionLabel.ts";
import { cautareDosare, SoapResponseTooLargeError } from "../soap.ts";
import { dosareRouter } from "./dosare.ts";

const mockCautare = vi.mocked(cautareDosare);

function buildApp() {
  const a = new Hono();
  a.route("/api/dosare", dosareRouter);
  return a;
}

const app = buildApp();

type DosareBody = {
  data?: unknown[];
  total?: number;
  exactMatch?: boolean;
  failedInstitutii?: string[];
  error?: string;
};

// Dosar minimal: exactMatch citeste `numar`, dedup-ul fanout citeste `institutie`.
function dosar(numar: string, institutie: string) {
  return { numar, institutie } as unknown as Awaited<ReturnType<typeof cautareDosare>>[number];
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

// Nota: randul 3 din matrice (abort de client la apelul agregat) e acoperit la
// nivel de helper in dosareFanout.test.ts — la nivel de ruta `app.request` nu
// expune un AbortSignal controlabil, deci nu-l putem reproduce aici.
describe("GET /api/dosare — fallback per instanta + failedInstitutii", () => {
  it("agregat OK: un singur apel, fara failedInstitutii", async () => {
    mockCautare.mockResolvedValueOnce([dosar("1/2026", "TribunalulCLUJ")]);
    const res = await app.request("/api/dosare?numeParte=MAZILU");
    const body = (await res.json()) as DosareBody;
    expect(res.status).toBe(200);
    expect(mockCautare).toHaveBeenCalledTimes(1);
    expect(body.failedInstitutii).toBeUndefined();
  });

  it("agregat esuat: fallback per instanta intoarce partial + failedInstitutii + exactMatch", async () => {
    mockCautare.mockRejectedValueOnce(new Error("Eroare la comunicarea cu serviciul PortalJust."));
    mockCautare.mockImplementation(async ({ institutie, dataStart }) => {
      expect(dataStart).toBe("2026-01-01"); // filtrele se propaga in fiecare apel per instanta
      if (institutie === "JudecatoriaPLOIESTI") throw new Error("fault");
      return institutie === "TribunalulCLUJ" ? [dosar("77/2026", institutie)] : [];
    });
    const res = await app.request("/api/dosare?numarDosar=77/2026&dataStart=2026-01-01");
    const body = (await res.json()) as DosareBody;
    expect(res.status).toBe(200);
    expect(body.failedInstitutii).toEqual(["JudecatoriaPLOIESTI"]);
    expect(body.exactMatch).toBe(true); // exactMatch functioneaza si pe drumul de fallback
    expect(mockCautare.mock.calls.length).toBe(1 + allInstitutionTokens().length); // fallback-ul a rulat tot catalogul
  });

  it("agregat esuat cu SoapResponseTooLargeError: 413, FARA fallback", async () => {
    mockCautare.mockRejectedValueOnce(new SoapResponseTooLargeError(60_000_000));
    const res = await app.request("/api/dosare?numeParte=POPESCU");
    expect(res.status).toBe(413);
    expect(mockCautare).toHaveBeenCalledTimes(1);
  });

  it("fallback cu TOATE instantele picate: 500 cu mesajul existent, dupa ce fallback-ul chiar a incercat", async () => {
    mockCautare.mockRejectedValue(new Error("fault"));
    const res = await app.request("/api/dosare?numeParte=MAZILU");
    const body = (await res.json()) as DosareBody;
    expect(res.status).toBe(500);
    expect(body.error).toMatch(/PortalJust/);
    expect(mockCautare.mock.calls.length).toBe(1 + allInstitutionTokens().length);
  });

  it("fallback care depaseste MAX_DOSARE_RESPONSE: 413 cu mesajul de restrangere", async () => {
    mockCautare.mockRejectedValueOnce(new Error("fault"));
    let i = 0;
    mockCautare.mockImplementation(async ({ institutie }) =>
      Array.from({ length: 3000 }, () => dosar(`${++i}/2026`, institutie ?? ""))
    );
    const res = await app.request("/api/dosare?numeParte=POPESCU");
    expect(res.status).toBe(413);
  });

  it("o singura institutie selectata esuata: 500 ca azi, fara fallback global", async () => {
    mockCautare.mockRejectedValueOnce(new Error("fault"));
    const res = await app.request("/api/dosare?numeParte=X&institutie=TribunalulPRAHOVA");
    expect(res.status).toBe(500);
    expect(mockCautare).toHaveBeenCalledTimes(1);
  });

  it("institutii multiple: partial cu failedInstitutii in loc de inghitire silentioasa", async () => {
    mockCautare.mockImplementation(async ({ institutie }) =>
      institutie === "TribunalulPRAHOVA"
        ? Promise.reject(new Error("fault"))
        : [dosar(`3/${institutie}/2026`, institutie ?? "")]
    );
    const res = await app.request("/api/dosare?numeParte=X&institutie=TribunalulPRAHOVA&institutie=TribunalulCLUJ");
    const body = (await res.json()) as DosareBody;
    expect(res.status).toBe(200);
    expect(body.failedInstitutii).toEqual(["TribunalulPRAHOVA"]);
    expect(body.data).toHaveLength(1);
  });

  it("institutii multiple TOATE picate: 500 (nu 200 cu lista goala ca azi)", async () => {
    mockCautare.mockRejectedValue(new Error("fault"));
    const res = await app.request("/api/dosare?numeParte=X&institutie=TribunalulPRAHOVA&institutie=TribunalulCLUJ");
    expect(res.status).toBe(500);
  });

  it("fallback in care toate instantele raspund: 200 FARA campul failedInstitutii", async () => {
    mockCautare.mockRejectedValueOnce(new Error("fault"));
    mockCautare.mockResolvedValue([]);
    const res = await app.request("/api/dosare?numeParte=MAZILU");
    const body = (await res.json()) as DosareBody;
    expect(res.status).toBe(200);
    expect(body.failedInstitutii).toBeUndefined(); // camp omis cand nu exista esecuri
  });

  it("plafonul global de fallback-uri: a doua cautare degradata concurenta primeste 500 fara fanout", async () => {
    // Primul request: agregatul pica, fanout-ul ramane agatat (promise controlat).
    const releases: Array<() => void> = [];
    mockCautare.mockImplementation(({ institutie }) => {
      if (institutie === undefined) return Promise.reject(new Error("fault")); // agregatele pica mereu
      return new Promise((resolve) => releases.push(() => resolve([]))); // fanout-ul atarna controlat
    });
    const first = app.request("/api/dosare?numeParte=A");
    await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0)); // fanout-ul 1 e pornit
    const second = app.request("/api/dosare?numeParte=B");
    const third = app.request("/api/dosare?numeParte=C"); // al 3-lea: peste MAX_CONCURRENT_FALLBACKS=2
    const resThird = await third;
    expect(resThird.status).toBe(500); // plafon atins: fara fanout nou
    for (const r of releases.splice(0)) r(); // elibereaza si dreneaza
    const drain = setInterval(() => {
      for (const r of releases.splice(0)) r();
    }, 5);
    await Promise.all([first, second]);
    clearInterval(drain);
  });
});
