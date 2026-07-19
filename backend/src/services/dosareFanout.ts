import type { Dosar, SearchParams } from "../soap.ts";
import { cautareDosare } from "../soap.ts";

export interface PartialSearchResult {
  dosare: Dosar[];
  failedInstitutii: string[];
}

const DEFAULT_CONCURRENCY = 10;

// DOAR abort-ul de client e fatal. TimeoutError (timeout intern SOAP 60s /
// bugetul fan-out-ului) e esec de instanta si intra in failedInstitutii —
// asimetrie deliberata; NU extinde functia asta la TimeoutError.
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

// Fan-out tolerant per instanta: o instanta cazuta la PortalJust nu mai omoara
// intreaga cautare. Ordinea rezultatelor e determinista (ordinea listei de
// institutii, nu completion-order); dedup pe institutie|numar la aplatizare
// (numar gol NU se dedup-uieste — cheia ar coliziona).
export async function searchInstitutiiTolerant(
  base: Omit<SearchParams, "institutie">,
  institutii: readonly string[],
  options: {
    signal?: AbortSignal;
    concurrency?: number;
    soapSearch?: typeof cautareDosare;
    maxResults?: number;
    budgetMs?: number;
  } = {}
): Promise<PartialSearchResult> {
  const soapSearch = options.soapSearch ?? cautareDosare;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, institutii.length));
  const { signal, maxResults, budgetMs } = options;
  const deadlineAt = budgetMs !== undefined ? Date.now() + budgetMs : Number.POSITIVE_INFINITY;
  const perInst: (Dosar[] | null)[] = institutii.map(() => null);
  const failedSet = new Set<number>();
  let collected = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (maxResults !== undefined && collected > maxResults) return; // stop, fara failed
      const idx = next++;
      if (idx >= institutii.length) return;
      const msLeft = deadlineAt - Date.now();
      if (msLeft <= 0) {
        failedSet.add(idx); // buget epuizat: neinterogat = lipseste din rezultate = failed
        continue;
      }
      const callSignal =
        budgetMs === undefined
          ? signal
          : signal
            ? AbortSignal.any([signal, AbortSignal.timeout(msLeft)])
            : AbortSignal.timeout(msLeft);
      try {
        const rows = await soapSearch({ ...base, institutie: institutii[idx] }, { signal: callSignal });
        perInst[idx] = rows;
        collected += rows.length;
      } catch (err) {
        if (isAbortError(err) && signal?.aborted) throw err; // DOAR clientul anuleaza tot
        failedSet.add(idx);
      }
    }
  }

  // allSettled, NU all: la abort de client vrem ca TOTI worker-ii sa se fi
  // stabilizat (fara apeluri SOAP orfane inca in zbor) inainte sa aruncam.
  const settled = await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
  const aborted = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (aborted) throw aborted.reason;

  const dosare: Dosar[] = [];
  const seen = new Set<string>();
  for (const rows of perInst) {
    if (rows === null) continue;
    for (const d of rows) {
      if (d.numar) {
        const key = `${d.institutie}|${d.numar}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      dosare.push(d);
    }
  }
  const failedInstitutii = [...failedSet].sort((a, b) => a - b).map((i) => institutii[i]);
  if (failedInstitutii.length > 0) {
    console.error(
      `[dosare.fanout] ${failedInstitutii.length}/${institutii.length} institutii fara raspuns: ${failedInstitutii.slice(0, 20).join(", ")}${failedInstitutii.length > 20 ? " ..." : ""}`
    );
  }
  return { dosare, failedInstitutii };
}
