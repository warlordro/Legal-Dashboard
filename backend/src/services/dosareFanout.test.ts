import { describe, expect, it, vi } from "vitest";
import type { Dosar } from "../soap.ts";
import { searchInstitutiiTolerant } from "./dosareFanout.ts";

function dosar(numar: string, institutie: string): Dosar {
  return { numar, institutie } as Dosar;
}

describe("searchInstitutiiTolerant", () => {
  it("collects successes and reports failed institutii without failing the whole search", async () => {
    const soapSearch = vi.fn(async ({ institutie }: { institutie?: string }) => {
      if (institutie === "TribunalulPRAHOVA") throw new Error("Eroare la comunicarea cu serviciul PortalJust.");
      return [dosar(`1/${institutie}/2026`, institutie ?? "")];
    });
    const r = await searchInstitutiiTolerant(
      { numeParte: "MAZILU" },
      ["JudecatoriaPLOIESTI", "TribunalulPRAHOVA", "TribunalulBUCURESTI"],
      {
        soapSearch: soapSearch as never,
        concurrency: 2,
      }
    );
    expect(r.failedInstitutii).toEqual(["TribunalulPRAHOVA"]);
    expect(r.dosare.map((d) => d.institutie)).toEqual(["JudecatoriaPLOIESTI", "TribunalulBUCURESTI"]); // ordinea listei, NU completion-order
    expect(soapSearch).toHaveBeenCalledTimes(3);
  });

  it("propagates the base filters (dataStart/dataStop) into every per-court call", async () => {
    const soapSearch = vi.fn(async (_p: { numeParte?: string }) => []);
    await searchInstitutiiTolerant({ numeParte: "X", dataStart: "2026-01-01", dataStop: "2026-02-01" }, ["A", "B"], {
      soapSearch: soapSearch as never,
    });
    for (const call of soapSearch.mock.calls) {
      expect(call[0]).toMatchObject({ numeParte: "X", dataStart: "2026-01-01", dataStop: "2026-02-01" });
    }
  });

  it("dedupes on institutie|numar: same numar in different courts survives, identical pair collapses", async () => {
    const soapSearch = vi.fn(async ({ institutie }: { institutie?: string }) =>
      institutie === "TribunalulCLUJ"
        ? [dosar("99/2026", "TribunalulCLUJ"), dosar("99/2026", "TribunalulCLUJ")]
        : [
            dosar("99/2026", "JudecatoriaCLUJNAPOCA"),
            dosar("", "JudecatoriaCLUJNAPOCA"),
            dosar("", "JudecatoriaCLUJNAPOCA"),
          ]
    );
    const r = await searchInstitutiiTolerant({ numeParte: "X" }, ["TribunalulCLUJ", "JudecatoriaCLUJNAPOCA"], {
      soapSearch: soapSearch as never,
    });
    // 99/CLUJ (dedup intern), 99/CLUJNAPOCA (alt tribunal — ramane), 2x numar gol (nededupat)
    expect(r.dosare).toHaveLength(4);
  });

  it("runs exactly `concurrency` calls in parallel (barrier test, not <=)", async () => {
    let inFlight = 0;
    const releases: Array<() => void> = [];
    const soapSearch = vi.fn(async () => {
      inFlight++;
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight--;
      return [];
    });
    const p = searchInstitutiiTolerant(
      { numeParte: "X" },
      Array.from({ length: 12 }, (_, i) => `Inst${i}`),
      {
        soapSearch: soapSearch as never,
        concurrency: 3,
      }
    );
    await vi.waitFor(() => expect(inFlight).toBe(3)); // exact 3, nu <=3 (o implementare seriala ar avea 1)
    // dreneaza in valuri pana toate cele 12 instante au fost dispecerizate; guard
    // pe numarul de apeluri, NU pe releases.length (care e capat la concurrency=3)
    while (soapSearch.mock.calls.length < 12) {
      for (const release of releases.splice(0)) release();
      await new Promise((r) => setTimeout(r, 1));
    }
    for (const release of releases.splice(0)) release();
    await p;
    expect(soapSearch).toHaveBeenCalledTimes(12);
  });

  it("stops scheduling new courts once maxResults is exceeded (unqueried courts NOT marked failed)", async () => {
    const soapSearch = vi.fn(async ({ institutie }: { institutie?: string }) =>
      Array.from({ length: 3 }, (_, i) => dosar(`${i}/${institutie}`, institutie ?? ""))
    );
    const r = await searchInstitutiiTolerant({ numeParte: "X" }, ["A", "B", "C", "D", "E", "F"], {
      soapSearch: soapSearch as never,
      concurrency: 1,
      maxResults: 4,
    });
    expect(soapSearch.mock.calls.length).toBeLessThan(6); // s-a oprit devreme
    expect(r.failedInstitutii).toEqual([]); // neinterogat != esuat
    expect(r.dosare.length).toBeGreaterThan(4);
  });

  it("budget exhaustion marks unqueried courts as failed instead of hanging", async () => {
    const soapSearch = vi.fn(
      ({ institutie }: { institutie?: string }, opts?: { signal?: AbortSignal }) =>
        new Promise<Dosar[]>((resolve, reject) => {
          if (institutie === "SLOW") {
            opts?.signal?.addEventListener("abort", () => reject(opts.signal?.reason));
            return; // atarna pana la timeout-ul de buget
          }
          resolve([]);
        })
    );
    const r = await searchInstitutiiTolerant({ numeParte: "X" }, ["SLOW", "B", "C"], {
      soapSearch: soapSearch as never,
      concurrency: 1,
      budgetMs: 50,
    });
    expect(r.failedInstitutii).toContain("SLOW");
    expect(r.failedInstitutii).toEqual(expect.arrayContaining(["B", "C"])); // neinterogate din cauza bugetului = failed
  });

  it("client abort propagates as AbortError; a TimeoutError alone does NOT abort the fanout", async () => {
    const ac = new AbortController();
    const abortingSearch = vi.fn(async () => {
      ac.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(
      searchInstitutiiTolerant({ numeParte: "X" }, ["A", "B"], {
        soapSearch: abortingSearch as never,
        signal: ac.signal,
        concurrency: 1,
      })
    ).rejects.toMatchObject({ name: "AbortError" });

    const timeoutSearch = vi.fn(async ({ institutie }: { institutie?: string }) => {
      if (institutie === "A") throw new DOMException("timed out", "TimeoutError");
      return [dosar("1/B", "B")];
    });
    const r = await searchInstitutiiTolerant({ numeParte: "X" }, ["A", "B"], {
      soapSearch: timeoutSearch as never,
      concurrency: 1,
    });
    expect(r.failedInstitutii).toEqual(["A"]);
    expect(r.dosare).toHaveLength(1);
  });
});
