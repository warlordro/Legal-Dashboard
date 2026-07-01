// Teste pentru identitatea ICCJ a runner-ului de monitoring (v2.37.1, review
// cluster 8 — closure-ul din index.ts nu avea niciun test; un regres aici
// inseamna alerte false "dosar disparut" pe termene legale).
import { describe, expect, it, vi } from "vitest";
import { IccjSourceError, type IccjDosar, type IccjSearchResult } from "../iccj/iccjClient.ts";
import { makeIccjFetchCurrentDosar, normalizeIccjNumar } from "./iccjFetchCurrent.ts";

function dosar(numar: string, iccjId: string): IccjDosar {
  return {
    numar,
    data: "2023-01-01",
    institutie: "Inalta Curte de Casatie si Justitie",
    departament: "Sectia Penala",
    obiect: "test",
    categorieCaz: "Penal",
    stadiuProcesual: "Recurs",
    parti: [],
    sedinte: [],
    source: "iccj",
    iccjId,
  };
}

function searchReturning(dosare: IccjDosar[]) {
  return vi.fn(async (): Promise<IccjSearchResult> => ({ dosare, total: dosare.length, page: 1 }));
}

const SIGNAL = { signal: new AbortController().signal };
// Optiunile propagate downstream: monitoring adauga callerClass pentru breaker (piesa A).
const MON_OPTS = { ...SIGNAL, callerClass: "monitoring" as const };

describe("normalizeIccjNumar", () => {
  it("strip-uieste markerii trailing si mid-string, dar nu alte caractere", () => {
    expect(normalizeIccjNumar("1783/1/2023*")).toBe("1783/1/2023");
    expect(normalizeIccjNumar("1783/1/2023**")).toBe("1783/1/2023");
    expect(normalizeIccjNumar("1859/107/2009**/a3.1")).toBe("1859/107/2009/a3.1");
    expect(normalizeIccjNumar("1783/1/2023")).toBe("1783/1/2023");
  });
});

describe("makeIccjFetchCurrentDosar", () => {
  it("cu iccjId stocat: fetch direct pe detail, fara search", async () => {
    const detail = dosar("1783/1/2023*", "42");
    const searchIccj = searchReturning([]);
    const fetchIccjDetail = vi.fn(async () => detail);
    const fetchCurrent = makeIccjFetchCurrentDosar({
      searchIccj: searchIccj as never,
      fetchIccjDetail: fetchIccjDetail as never,
    });

    const out = await fetchCurrent({ numarDosar: "1783/1/2023", iccjId: "42" }, SIGNAL);

    expect(out).toBe(detail);
    expect(searchIccj).not.toHaveBeenCalled();
    expect(fetchIccjDetail).toHaveBeenCalledWith("42", MON_OPTS);
  });

  it("fallback id-less: query-ul pleaca NORMALIZAT si match-ul tolereaza sufixul **", async () => {
    const row = dosar("107/213/2017**", "77");
    const searchIccj = searchReturning([row]);
    const fetchIccjDetail = vi.fn(async () => row);
    const fetchCurrent = makeIccjFetchCurrentDosar({
      searchIccj: searchIccj as never,
      fetchIccjDetail: fetchIccjDetail as never,
    });

    const out = await fetchCurrent({ numarDosar: "107/213/2017**" }, SIGNAL);

    expect(searchIccj).toHaveBeenCalledWith({ numarDosar: "107/213/2017" }, MON_OPTS);
    expect(fetchIccjDetail).toHaveBeenCalledWith("77", MON_OPTS);
    expect(out).toBe(row);
  });

  it("0 match => null (genuin not found, nu eroare)", async () => {
    const fetchCurrent = makeIccjFetchCurrentDosar({
      searchIccj: searchReturning([]) as never,
      fetchIccjDetail: vi.fn() as never,
    });

    await expect(fetchCurrent({ numarDosar: "1/1/2020" }, SIGNAL)).resolves.toBeNull();
  });

  it("2 match-uri => IccjSourceError (nu ghiceste, nu intoarce null)", async () => {
    const fetchCurrent = makeIccjFetchCurrentDosar({
      searchIccj: searchReturning([dosar("1/1/2020*", "1"), dosar("1/1/2020**", "2")]) as never,
      fetchIccjDetail: vi.fn() as never,
    });

    await expect(fetchCurrent({ numarDosar: "1/1/2020" }, SIGNAL)).rejects.toBeInstanceOf(IccjSourceError);
  });
});
