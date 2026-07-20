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

// Nota: `app.request(path, { signal })` propaga semnalul la `c.req.raw.signal`
// (verificat de testul „abort de client in timpul fanout-ului" de mai jos, care
// scurteaza catalogul cand semnalul rutei se aborteaza). Randul de matrice
// pentru abort la nivel de helper ramane in dosareFanout.test.ts.
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
    // Capturam parametrii si asertam DUPA await: un `expect` aruncat AICI ar fi
    // inghitit de try/catch-ul fan-out-ului (ar deveni „institutie failed") — false green.
    const seenDataStart: Array<string | undefined> = [];
    mockCautare.mockImplementation(async ({ institutie, dataStart }) => {
      seenDataStart.push(dataStart);
      if (institutie === "JudecatoriaPLOIESTI") throw new Error("fault");
      return institutie === "TribunalulCLUJ" ? [dosar("77/2026", institutie)] : [];
    });
    const res = await app.request("/api/dosare?numarDosar=77/2026&dataStart=2026-01-01");
    const body = (await res.json()) as DosareBody;
    expect(res.status).toBe(200);
    expect(body.failedInstitutii).toEqual(["JudecatoriaPLOIESTI"]);
    expect(body.exactMatch).toBe(true); // exactMatch functioneaza si pe drumul de fallback
    expect(mockCautare.mock.calls.length).toBe(1 + allInstitutionTokens().length); // fallback-ul a rulat tot catalogul
    // filtrele se propaga in FIECARE apel per instanta (asertat dupa await, nu inghitit de catch)
    expect(seenDataStart.length).toBe(allInstitutionTokens().length);
    expect(seenDataStart.every((d) => d === "2026-01-01")).toBe(true);
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

  it("fallback cu >MAX_DOSARE_RESPONSE randuri BRUTE dar unice <=MAX dupa dedup: 413 (limitHit), NU 200", async () => {
    mockCautare.mockRejectedValueOnce(new Error("fault"));
    // Fiecare instanta intoarce 3000 randuri IDENTICE (dedup pe institutie|numar le colapseaza la 1),
    // dar `collected` numara randurile BRUTE → dupa cateva instante depaseste plafonul. Fara fix,
    // dosare.length post-dedup (~cateva) < MAX → 200 „complet" cu gauri; cu limitHit → 413.
    mockCautare.mockImplementation(async ({ institutie }) =>
      Array.from({ length: 3000 }, () => dosar("1/2026", institutie ?? ""))
    );
    const res = await app.request("/api/dosare?numeParte=POPESCU");
    expect(res.status).toBe(413);
  });

  it("token-uri institutie duplicate in query: un singur apel per token unic, failedInstitutii fara duplicate", async () => {
    const seen: string[] = [];
    mockCautare.mockImplementation(async ({ institutie }) => {
      seen.push(institutie ?? "");
      if (institutie === "TribunalulPRAHOVA") throw new Error("fault");
      return [dosar(`5/${institutie}/2026`, institutie ?? "")];
    });
    const res = await app.request(
      "/api/dosare?numeParte=X&institutie=TribunalulPRAHOVA&institutie=TribunalulPRAHOVA&institutie=TribunalulCLUJ"
    );
    const body = (await res.json()) as DosareBody;
    expect(res.status).toBe(200);
    // un singur apel per token unic (nu 3)
    expect(seen.sort()).toEqual(["TribunalulCLUJ", "TribunalulPRAHOVA"]);
    // failedInstitutii fara duplicate si fara contradictii (PRAHOVA doar in failed, nu si in date)
    expect(body.failedInstitutii).toEqual(["TribunalulPRAHOVA"]);
    expect(body.data).toHaveLength(1);
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

  it("abort de client in timpul fanout-ului (semnal de ruta): scurteaza catalogul, nu ruleaza tot", async () => {
    // Agregatul pica (semnal INCA ne-abortat) → fallback porneste. Prima instanta
    // din fanout aborteaza semnalul rutei. Daca `app.request` propaga semnalul la
    // `c.req.raw.signal`, workerii se opresc → total apeluri << 1 + catalog.
    const ac = new AbortController();
    mockCautare.mockRejectedValueOnce(new Error("fault"));
    let fanoutCalls = 0;
    mockCautare.mockImplementation(async ({ institutie: _institutie }) => {
      fanoutCalls++;
      if (fanoutCalls === 1) {
        ac.abort();
        throw new DOMException("Aborted", "AbortError");
      }
      return [];
    });
    const res = await app.request("/api/dosare?numeParte=X", { signal: ac.signal });
    expect(res.status).toBe(500);
    // scurtat de abort: mult sub catalogul complet (regresie la propagarea semnalului = tot catalogul)
    expect(mockCautare.mock.calls.length).toBeLessThan(1 + allInstitutionTokens().length);
  });

  it("plafonul global de fallback-uri: al doilea fallback E permis (MAX=2), al treilea primeste 500 fara fanout", async () => {
    // Agregatele pica mereu; apelurile de fanout atarna controlat. Fiecare fallback
    // dispecerizeaza pana la 10 apeluri concurente (default), deci >10 in zbor = al
    // doilea fallback a pornit → bariera reala inainte de request-ul 3.
    const releases: Array<() => void> = [];
    let inFlight = 0;
    mockCautare.mockImplementation(({ institutie }) => {
      if (institutie === undefined) return Promise.reject(new Error("fault")); // agregat
      inFlight++;
      return new Promise((resolve) =>
        releases.push(() => {
          inFlight--;
          resolve([]);
        })
      );
    });
    const first = app.request("/api/dosare?numeParte=A");
    const second = app.request("/api/dosare?numeParte=B");
    // bariera: AMBELE fallback-uri au dispecerizat (>10 concurente = al doilea a pornit).
    // O regresie MAX_CONCURRENT_FALLBACKS=1 ar bloca al doilea aici (inFlight ramane <=10).
    await vi.waitFor(() => expect(inFlight).toBeGreaterThan(10));
    const callsBeforeThird = mockCautare.mock.calls.length;
    const third = app.request("/api/dosare?numeParte=C"); // peste MAX_CONCURRENT_FALLBACKS=2
    const resThird = await third;
    expect(resThird.status).toBe(500); // plafon atins
    // al treilea a facut EXACT 1 apel (agregatul), fara fanout
    expect(mockCautare.mock.calls.length - callsBeforeThird).toBe(1);
    // elibereaza si dreneaza pana se inchid primele doua
    const drain = setInterval(() => {
      for (const r of releases.splice(0)) r();
    }, 5);
    const [resFirst, resSecond] = await Promise.all([first, second]);
    clearInterval(drain);
    expect(resFirst.status).toBe(200);
    expect(resSecond.status).toBe(200); // al doilea fallback a fost PERMIS (nu 500)
  });
});
