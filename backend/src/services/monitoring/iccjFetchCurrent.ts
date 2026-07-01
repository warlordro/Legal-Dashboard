// iccjFetchCurrent — identitatea "dosarul ICCJ mai exista?" pentru runner-ul de
// monitoring, extrasa din closure-ul inline din index.ts (v2.37.1, review
// cluster 8: glue-ul anti-alerte-false nu avea niciun test).
//
// Contract (vezi IccjRunnerDeps.fetchCurrentDosar): ARUNCA pe esec de
// sursa/parsare (IccjSourceError/IccjParseError) si returneaza `null` DOAR
// pentru un "not found" genuin — runner-ul trateaza orice throw ca outcome de
// eroare si NU scrie snapshot, deci un hop tranzitoriu de upstream nu poate fi
// confundat cu "dosar disparut".

import { IccjSourceError, type fetchIccjDetail, type searchIccj } from "../iccj/iccjClient.ts";

export interface IccjFetchCurrentDeps {
  searchIccj: typeof searchIccj;
  fetchIccjDetail: typeof fetchIccjDetail;
}

// Strip marker-ele scj.ro `*`/`**`: trailing ("1783/1/2023*") SI mid-string
// inainte de un separator `/` ("1859/107/2009**/a3.1"). Conservativ — atinge
// doar secvente de asteriscuri lipite de sfarsit sau de un slash, nu alte
// caractere din docket.
export function normalizeIccjNumar(s: string): string {
  return s.replace(/\*+(?=\/|\s*$)/g, "").trim();
}

export function makeIccjFetchCurrentDosar(deps: IccjFetchCurrentDeps) {
  return async (
    { numarDosar, iccjId }: { numarDosar: string; iccjId?: string },
    { signal }: { signal: AbortSignal }
  ) => {
    // Identitate prin `iccjId` stabil cand jobul l-a stocat: scj.ro decoreaza
    // docket-ul cu markeri `*`/`**`, deci match-ul exact pe string produce
    // false "not found" (Codex F1). Detail-ul care arunca (IccjParseError) e
    // tratat de runner ca source error, niciodata "disparut".
    if (iccjId) return deps.fetchIccjDetail(iccjId, { signal, callerClass: "monitoring" });
    // Fallback (joburi legacy fara id): cautam cu numarul NORMALIZAT — inainte
    // trimiteam string-ul decorat ("107/213/2017**") si un match literal pe
    // scj.ro putea intoarce 0 randuri => baseline fals "absent".
    const wanted = normalizeIccjNumar(numarDosar);
    const res = await deps.searchIccj({ numarDosar: wanted }, { signal, callerClass: "monitoring" });
    const matches = res.dosare.filter((d) => normalizeIccjNumar(d.numar) === wanted);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      // Multi-match ambiguu => source error (nu ghicim), NU null — altfel am
      // urmari silentios dosarul gresit sau am emite dosar_disappeared fals.
      throw new IccjSourceError(`ambiguous ICCJ match for "${numarDosar}" (${matches.length} dosare)`);
    }
    return deps.fetchIccjDetail(matches[0].iccjId, { signal, callerClass: "monitoring" });
  };
}
