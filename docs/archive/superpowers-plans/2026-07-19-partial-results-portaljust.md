# Rezultate partiale la cautarea PortalJust (instante cazute) — Implementation Plan REV3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**REV3 (post review adversarial Codex, pe deasupra REV2):** plafon GLOBAL pe fallback-uri concurente (max 2 per proces; peste = 500 ca azi, fara fanout); helper-ul foloseste `Promise.allSettled` + rethrow abia dupa stabilizarea tuturor worker-ilor (fara apeluri orfane dupa abort); contract PAT/MCP actualizat OBLIGATORIU (API.md L50-60 si `backend/src/routes/openapi.ts` documenteaza raspunsul — se adauga `failedInstitutii` + semantica de rezultat partial); testul existent `soap-too-large.test.ts` „generic SOAP failure → 500" se aliniaza (dupa fallback ar trece fals-verde); test nou „fallback fara esecuri omite campul"; `App.tsx` numit explicit in Task 4 (acolo traieste state-ul autoritativ); limitare asumata: fara buton de cancel in UI (asteptarea e marginita de bugetul de 120s).

**REV2 (post review adversarial panel 5 modele):** corectii integrate: path-ul real al rutei e `/api/dosare` (NU `/api/v1/dosare`); fan-out-ul respecta `MAX_SOAP_FANOUT` printr-un assert la load; acumularea e oprita incremental la `MAX_DOSARE_RESPONSE`; fallback-ul are buget total de timp (fara el, worst-case ~24 min la portal agatat); ordinea rezultatelor e determinista (per index, nu completion-order); selectia multipla pastreaza paralelismul complet de azi (fara regresie de latenta); teste intarite (concurenta exacta cu bariere, dedup pe cheia compusa, all-fail dovedeste executia fallback-ului, filtre propagate); banner-ul se curata la fiecare cautare noua si e gate-uit pe `!loading`; tipul frontend se extinde complet; export XLSX cere confirmare cand rezultatele sunt partiale; log agregat unic pe calea degradata.

**Goal:** Cand una sau mai multe instante PortalJust sunt cazute, cautarea de dosare intoarce rezultatele de la instantele sanatoase plus lista instantelor care nu au raspuns, in loc de eroare totala.

**Architecture:** Cautarea fara filtru ramane un singur apel SOAP agregat (neschimbat cand portalul e sanatos); cand acel apel esueaza, backend-ul face fallback la fan-out per instanta (catalog ~231 token-uri, concurenta 10, buget total 120s, esecuri tolerate per instanta). Cautarea cu ≥2 instante selectate refoloseste acelasi helper cu paralelism complet (ca azi) si raporteaza instantele picate in loc sa le inghita ca `[]`. Raspunsul se extinde aditiv cu `failedInstitutii: string[]` (token-uri SOAP); frontend-ul traduce token-urile in etichete si afiseaza banner amber.

**Tech Stack:** Hono (backend), vitest, SOAP XML manual (`backend/src/soap.ts`), React 18 + Tailwind (frontend).

## Global Constraints

- Branch: `feat/v2.43.0-rnpm-split`, commit-uri locale, FARA push (push doar la comanda userului).
- UI in romana, FARA diacritice in cod sursa.
- **Ruta reala: `GET /api/dosare`** (montata in `backend/src/index.ts:452` — `app.route("/api/dosare", dosareRouter)`); doar exportul e sub `/api/v1/dosare` (`dosareExportRouter`). TOATE testele de ruta folosesc `/api/dosare`.
- Ruta foloseste envelope-ul LEGACY `{ error: string }` la esec si `{ data, total, exactMatch }` la succes — NU `fail()`. Extensia e ADITIVA: `failedInstitutii` apare doar cand e nevida.
- Conventie cross-stack: token-urile backend (`JudecatoriaPLOIESTI`) NU se afiseaza brute in DOM — frontend le traduce prin `getInstitutieLabel` din `frontend/src/lib/institutii.ts` (export existent, L26).
- Valori confirmate pe cod: `MAX_INSTITUTII = 50`, `MAX_SOAP_FANOUT = 500`, `MAX_DOSARE_RESPONSE = 5000` (`backend/src/util/validation.ts:5-7`), `SOAP_TIMEOUT_MS = 60000` (`backend/src/soap.ts:94`).
- `better-sqlite3` pe ABI Node pentru vitest (`npm rebuild better-sqlite3` daca pica pe NODE_MODULE_VERSION). NU rula `npm run rebuild:electron`.
- Inainte de fiecare commit: `npx biome check --write <fisierele atinse>` si re-add.
- Comportamente care NU se schimba: cautarea sanatoasa fara filtru = UN apel SOAP; `SoapResponseTooLargeError` pe apelul agregat = 413 identic (fara fallback — query determinist); abort de client = fara fallback; cap `MAX_DOSARE_RESPONSE` aplicat pe agregat; ruta SSE `/load-more` neatinsa (are deja warnings per institutie); `Termene.tsx` out of scope (follow-up separat).
- **Schimbare de contract documentata:** la ≥2 institutii selectate cu TOATE picate, raspunsul devine 500 (azi: 200 cu `{data:[], total:0}` — silentios fals). Nota se adauga in API.md DOAR daca API.md documenteaza ruta de cautare (verifica la Task 0).

---

### Task 0: Pre-flight (verificari, fara cod)

- [ ] **Step 1:** Confirma ca `validateParams({ institutie: <token> })` din `backend/src/util/validation.ts` accepta token-urile din catalog (citeste functia; testele de la Task 3 folosesc token-uri reale ca `TribunalulPRAHOVA` si trebuie sa treaca de validare).
- [ ] **Step 2:** Verifica daca raspunsul `GET /api/dosare` e documentat in `API.md` sau in generatorul OpenAPI (`grep -rn "dosare" backend/src/routes/openapi* API.md`). Daca schema raspunsului e stricta (`additionalProperties: false`) sau documentata, adauga campul `failedInstitutii` acolo in Task 3; daca ruta nu apare (PAT acopera alte path-uri), noteaza in raport si mergi mai departe.
- [ ] **Step 3:** Confirma harness-ul din `backend/src/routes/dosareExactMatch.test.ts`: cum monteaza router-ul, la ce path face `app.request`, cum mock-uieste `../soap.ts`. Task 3 copiaza EXACT acest pattern.

---

### Task 1: Catalogul de token-uri de instante exportat din institutionLabel

**Files:**
- Modify: `backend/src/util/institutionLabel.ts` (ENTRIES exista, L7-254; adauga export la finalul fisierului)
- Test: `backend/src/util/institutionLabel.test.ts` (exista; adauga un describe)

**Interfaces:**
- Produces: `export function allInstitutionTokens(): readonly string[]` — token-urile SOAP (primul element al fiecarui ENTRY), lista inghetata, fara duplicate.

- [ ] **Step 1: Write the failing test** — in `backend/src/util/institutionLabel.test.ts`:

```ts
describe("allInstitutionTokens", () => {
  it("returns the full frozen SOAP token catalog", () => {
    const tokens = allInstitutionTokens();
    expect(tokens.length).toBeGreaterThan(200);
    expect(tokens).toContain("CurteadeApelPLOIESTI");
    expect(tokens).toContain("JudecatoriaPLOIESTI");
    expect(tokens).toContain("TribunalulPRAHOVA");
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(Object.isFrozen(tokens)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npm test --workspace=backend -- institutionLabel --run` → FAIL (`allInstitutionTokens` inexistent).

- [ ] **Step 3: Implementation** — la finalul `backend/src/util/institutionLabel.ts`:

```ts
// Catalogul complet de token-uri SOAP (enum-ul WSDL), pentru fan-out-ul tolerant
// din cautarea de dosare cand apelul agregat PortalJust esueaza. Inghetat: e
// sursa unica, nimeni nu are voie sa-l mute la runtime.
const _tokens: readonly string[] = Object.freeze(ENTRIES.map(([value]) => value));

export function allInstitutionTokens(): readonly string[] {
  return _tokens;
}
```

- [ ] **Step 4: Run** → PASS (tot fisierul de test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/util/institutionLabel.ts backend/src/util/institutionLabel.test.ts
git commit -m "feat(dosare): exporta catalogul de token-uri de instante pentru fan-out tolerant"
```

---

### Task 2: Serviciul de fan-out tolerant per instanta

**Files:**
- Create: `backend/src/services/dosareFanout.ts`
- Test: `backend/src/services/dosareFanout.test.ts`

**Interfaces:**
- Consumes: `cautareDosare(params, options?: { signal }): Promise<Dosar[]>`, tipurile `SearchParams`, `Dosar` din `../soap.ts`.
- Produces:
  - `export interface PartialSearchResult { dosare: Dosar[]; failedInstitutii: string[] }`
  - `export async function searchInstitutiiTolerant(base: Omit<SearchParams, "institutie">, institutii: readonly string[], options?: { signal?: AbortSignal; concurrency?: number; soapSearch?: typeof cautareDosare; maxResults?: number; budgetMs?: number }): Promise<PartialSearchResult>`
- Semantici (toate obligatorii):
  1. Esecul unui apel per instanta NU opreste restul; instanta intra in `failedInstitutii`.
  2. Abort-ul CLIENTULUI (`options.signal.aborted === true`) opreste tot si arunca `AbortError`. ATENTIE (decizie deliberata, NU o „repara" nimeni): `TimeoutError` (timeout-ul intern de 60s al `cautareDosare` sau bugetul local) NU e abort de client — cade in `failedInstitutii`. Verificarea de rethrow e `isAbortError(err) && signal?.aborted`, nu doar numele erorii.
  3. Ordine DETERMINISTA: rezultatele se colecteaza per index si se aplatizeaza in ordinea `institutii` DUPA terminarea worker-ilor; dedup pe cheia `institutie|numar` aplicat la aplatizare (primul castiga = ordinea listei); randurile cu `numar` gol NU se dedup-uiesc (cheia ar coliziona pe `institutie|`).
  4. `maxResults` (optional): cand totalul colectat depaseste pragul, worker-ii NU mai programeaza instante noi; instantele neinterogate NU se marcheaza failed (nu au esuat) — bucla se opreste si aplatizarea returneaza ce s-a strans (ruta va da 413 pe `> MAX_DOSARE_RESPONSE`).
  5. `budgetMs` (optional): buget TOTAL. Fiecare apel primeste `AbortSignal.any([signal, AbortSignal.timeout(msRamas)])` (sau doar timeout daca nu e signal); cand bugetul e epuizat, instantele neinterogate se marcheaza failed (utilizatorul trebuie sa stie ca lipsesc), iar cele in zbor pica cu `TimeoutError` → failed.
  6. Concurenta default 10, clamp [1, institutii.length].
  7. Un SINGUR log agregat la final cand exista esecuri (numar + token-uri, cap 20 in log), nu un log per instanta.

- [ ] **Step 1: Write the failing tests** — `backend/src/services/dosareFanout.test.ts`:

```ts
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
    const r = await searchInstitutiiTolerant({ numeParte: "MAZILU" }, ["JudecatoriaPLOIESTI", "TribunalulPRAHOVA", "TribunalulBUCURESTI"], {
      soapSearch: soapSearch as never,
      concurrency: 2,
    });
    expect(r.failedInstitutii).toEqual(["TribunalulPRAHOVA"]);
    expect(r.dosare.map((d) => d.institutie)).toEqual(["JudecatoriaPLOIESTI", "TribunalulBUCURESTI"]); // ordinea listei, NU completion-order
    expect(soapSearch).toHaveBeenCalledTimes(3);
  });

  it("propagates the base filters (dataStart/dataStop) into every per-court call", async () => {
    const soapSearch = vi.fn(async () => []);
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
        : [dosar("99/2026", "JudecatoriaCLUJNAPOCA"), dosar("", "JudecatoriaCLUJNAPOCA"), dosar("", "JudecatoriaCLUJNAPOCA")]
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
    const p = searchInstitutiiTolerant({ numeParte: "X" }, Array.from({ length: 12 }, (_, i) => `Inst${i}`), {
      soapSearch: soapSearch as never,
      concurrency: 3,
    });
    await vi.waitFor(() => expect(inFlight).toBe(3)); // exact 3, nu <=3 (o implementare seriala ar avea 1)
    while (releases.length < 12) {
      releases.splice(0).forEach((r) => r());
      await new Promise((r) => setTimeout(r, 1));
    }
    releases.splice(0).forEach((r) => r());
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
      searchInstitutiiTolerant({ numeParte: "X" }, ["A", "B"], { soapSearch: abortingSearch as never, signal: ac.signal, concurrency: 1 })
    ).rejects.toMatchObject({ name: "AbortError" });

    const timeoutSearch = vi.fn(async ({ institutie }: { institutie?: string }) => {
      if (institutie === "A") throw new DOMException("timed out", "TimeoutError");
      return [dosar("1/B", "B")];
    });
    const r = await searchInstitutiiTolerant({ numeParte: "X" }, ["A", "B"], { soapSearch: timeoutSearch as never, concurrency: 1 });
    expect(r.failedInstitutii).toEqual(["A"]);
    expect(r.dosare).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run** `npm test --workspace=backend -- dosareFanout --run` → FAIL (modul inexistent).

- [ ] **Step 3: Implementation** — `backend/src/services/dosareFanout.ts`:

```ts
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
```

- [ ] **Step 4: Run** → PASS (7 teste).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dosareFanout.ts backend/src/services/dosareFanout.test.ts
git commit -m "feat(dosare): fan-out tolerant per instanta cu ordine determinista, buget total si cap de rezultate"
```

---

### Task 3: Integrarea in ruta GET /api/dosare (fallback + raportare)

**Files:**
- Modify: `backend/src/routes/dosare.ts` (importuri L1-10; inlocuieste STRICT L142-162 — snippet-ul de mai jos NU include `}`-ul de la L163, care ramane; comentariul de la L113-115 despre fanout cap se actualizeaza)
- Test: `backend/src/routes/dosarePartial.test.ts` (NOU; harness-ul EXACT din `dosareExactMatch.test.ts`, path `/api/dosare`)

**Interfaces:**
- Consumes: `searchInstitutiiTolerant` (Task 2); `allInstitutionTokens` (Task 1).
- Produces: raspunsul devine `{ data, total, exactMatch, failedInstitutii?: string[] }` — `failedInstitutii` DOAR cand e nevid, token-uri SOAP brute.

**Matricea de comportament:**
1. 0 institutii, agregat OK → identic azi (UN apel, fara `failedInstitutii`).
2. 0 institutii, agregat esueaza cu `SoapResponseTooLargeError` → 413 identic azi, FARA fallback.
3. 0 institutii, agregat esueaza cu abort de client (`signal.aborted`) → rethrow identic azi, FARA fallback.
4. 0 institutii, agregat esueaza altfel → fallback pe catalog (concurenta 10, `budgetMs=120_000`, `maxResults=MAX_DOSARE_RESPONSE`); TOATE picate → 500 cu mesajul existent; altfel 200 + `failedInstitutii`.
5. EXACT 1 institutie esuata → ca azi: 413 pentru `SoapResponseTooLargeError`, 500 pentru rest (matricea NU promite „500 mereu").
6. ≥2 institutii → `searchInstitutiiTolerant` pe selectie cu `concurrency: institutii.length` (paralelism COMPLET, ca `Promise.all`-ul de azi — fara regresie de latenta; ≤50 via MAX_INSTITUTII), fara buget; TOATE picate → 500 (schimbare de contract documentata in Global Constraints); altfel 200 + `failedInstitutii`.
7. `MAX_DOSARE_RESPONSE` (413) si `exactMatch` se aplica pe agregat DUPA oricare drum.

- [ ] **Step 1: Write the failing tests** — `backend/src/routes/dosarePartial.test.ts`, harness copiat din `dosareExactMatch.test.ts` (mock `../soap.ts` cu `importActual` pentru `SoapResponseTooLargeError`), plus `vi.mock` NU pe `../services/dosareFanout.ts` (ruleaza real, doar soap-ul e mock). Cazuri obligatorii (toate pe `/api/dosare`):

```ts
it("agregat OK: un singur apel, fara failedInstitutii", async () => {
  mockCautare.mockResolvedValueOnce([dosar("1/2026", "TribunalulCLUJ")]);
  const res = await app.request("/api/dosare?numeParte=MAZILU");
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(mockCautare).toHaveBeenCalledTimes(1);
  expect(body.failedInstitutii).toBeUndefined();
});

it("agregat esuat: fallback per instanta intoarce partial + failedInstitutii + exactMatch", async () => {
  mockCautare.mockRejectedValueOnce(new Error("Eroare la comunicarea cu serviciul PortalJust."));
  mockCautare.mockImplementation(async ({ institutie, numarDosar, numeParte, dataStart }) => {
    expect(dataStart).toBe("2026-01-01"); // filtrele se propaga in fiecare apel per instanta
    if (institutie === "JudecatoriaPLOIESTI") throw new Error("fault");
    return institutie === "TribunalulCLUJ" ? [dosar("77/2026", institutie)] : [];
  });
  const res = await app.request("/api/dosare?numarDosar=77/2026&dataStart=2026-01-01");
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.failedInstitutii).toEqual(["JudecatoriaPLOIESTI"]);
  expect(body.exactMatch).toBe(true); // exactMatch functioneaza si pe drumul de fallback
  expect(mockCautare.mock.calls.length).toBe(1 + allInstitutionTokens().length); // fallback-ul chiar a rulat, tot catalogul
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
  const body = await res.json();
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
    institutie === "TribunalulPRAHOVA" ? Promise.reject(new Error("fault")) : [dosar(`3/${institutie}/2026`, institutie)]
  );
  const res = await app.request("/api/dosare?numeParte=X&institutie=TribunalulPRAHOVA&institutie=TribunalulCLUJ");
  const body = await res.json();
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
  const body = await res.json();
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
  releases.splice(0).forEach((r) => r()); // elibereaza si dreneaza
  const drain = setInterval(() => releases.splice(0).forEach((r) => r()), 5);
  await Promise.all([first, second]);
  clearInterval(drain);
});
```

(Nota la testul de plafon: al 2-lea fallback e permis (MAX=2), al 3-lea refuzat; daca sincronizarea per-request se dovedeste fragila in harness, e acceptabil sa testezi plafonul la nivel de unitate exportand un helper `_fallbackGateForTest` — dar incearca intai varianta de ruta.)

(`dosar(...)` helper local; importa `allInstitutionTokens` in test. Abort-ul de client — randul 3 din matrice — ramane acoperit la nivel de helper in Task 2; la nivel de ruta `app.request` nu expune un signal controlabil, noteaza asta intr-un comentariu in fisierul de test.)

- [ ] **Step 2: Run** `npm test --workspace=backend -- dosarePartial --run` → FAIL.

- [ ] **Step 3: Implementation** — in `backend/src/routes/dosare.ts`:

(a) Importuri noi: `import { searchInstitutiiTolerant } from "../services/dosareFanout.ts";` si `import { allInstitutionTokens } from "../util/institutionLabel.ts";`.

(b) Assert la load, lânga importuri (documenteaza exceptia de la MAX_SOAP_FANOUT — invariantul „hard upper bound on upstream SOAP calls" ramane adevarat, doar ca marginea e catalogul + 1), PLUS plafonul global pe fallback-uri concurente (Codex HIGH: fara el, N cautari degradate simultane = N x 10 apeluri paralele spre portal — aplicatia ar amplifica exact pana pe care o tolereaza):

```ts
// Fallback-ul per instanta (apel agregat esuat) genereaza pana la
// allInstitutionTokens().length + 1 apeluri SOAP server-side. Invariantul
// MAX_SOAP_FANOUT ramane global: verificat static aici, nu per request.
if (allInstitutionTokens().length + 1 > MAX_SOAP_FANOUT) {
  throw new Error(
    `Catalogul de institutii (${allInstitutionTokens().length}) + 1 depaseste MAX_SOAP_FANOUT (${MAX_SOAP_FANOUT}).`
  );
}

// Plafon GLOBAL per proces pe fallback-urile de catalog: o pana PortalJust
// loveste toti userii simultan; fara plafon, fiecare cautare esuata ar porni
// propriul fanout de ~231 apeluri (10 concurente fiecare). Peste plafon,
// cautarea primeste 500 ca inainte de feature — degradare, nu amplificare.
const MAX_CONCURRENT_FALLBACKS = 2;
let fallbacksInFlight = 0;
```

(c) Inlocuieste L142-162 (de la `try {` inclusiv `let dosare...` pana la `dosare = results.flat();` inclusiv — `}`-ul de la L163 RAMANE) cu:

```ts
  try {
    const base = { numarDosar, obiectDosar, numeParte, dataStart, dataStop };
    let dosare: Awaited<ReturnType<typeof cautareDosare>>;
    let failedInstitutii: string[] = [];

    if (institutii.length >= 2) {
      // Fan-out tolerant pe selectia userului, cu paralelism complet ca
      // Promise.all-ul de dinainte (fara regresie de latenta; <=50 via
      // MAX_INSTITUTII). O instanta cazuta NU mai e inghitita ca "0 rezultate".
      const partial = await searchInstitutiiTolerant(base, institutii, {
        signal,
        concurrency: institutii.length,
      });
      if (partial.failedInstitutii.length === institutii.length) {
        return c.json({ error: "Eroare la comunicarea cu serviciul PortalJust. Incercati din nou." }, 500);
      }
      dosare = partial.dosare;
      failedInstitutii = partial.failedInstitutii;
    } else {
      try {
        dosare = await cautareDosare({ ...base, institutie: institutii[0] }, { signal });
      } catch (err) {
        // Fallback per instanta DOAR pentru cautarea fara filtru: PortalJust
        // agrega server-side si un shard cazut (ex. Prahova) omoara tot apelul.
        // NU pe: >1000 (determinist, 413), abort de client, sau o singura
        // institutie selectata (fallback-ul nu ar aduce nimic in plus).
        if (institutii.length === 1 || err instanceof SoapResponseTooLargeError || signal.aborted) throw err;
        if (fallbacksInFlight >= MAX_CONCURRENT_FALLBACKS) throw err; // plafon global: 500 ca azi
        console.error("[dosare] apel agregat esuat; fallback per instanta:", err instanceof Error ? err.message : err);
        const tokens = allInstitutionTokens();
        fallbacksInFlight++;
        let partial: Awaited<ReturnType<typeof searchInstitutiiTolerant>>;
        try {
          partial = await searchInstitutiiTolerant(base, tokens, {
            signal,
            budgetMs: 120_000,
            maxResults: MAX_DOSARE_RESPONSE,
          });
        } finally {
          fallbacksInFlight--;
        }
        if (partial.failedInstitutii.length === tokens.length) throw err;
        dosare = partial.dosare;
        failedInstitutii = partial.failedInstitutii;
      }
    }
```

(d) Extinde raspunsul de succes (fostul L181):

```ts
    return c.json({
      data: dosare,
      total: dosare.length,
      exactMatch,
      ...(failedInstitutii.length > 0 ? { failedInstitutii } : {}),
    });
```

(e) Actualizeaza comentariul L113-115 (fanout cap): mentioneaza ca fallback-ul server-side e exceptia verificata static la load.

(f) **Aliniaza testul existent** `backend/src/routes/soap-too-large.test.ts` (~L51-58, cazul „generic SOAP failure → 500"): azi foloseste `mockRejectedValueOnce` — dupa fallback ar ramane verde DOAR pentru ca restul apelurilor pica pe mock nedefinit (fals-verde care mascheaza fanout-ul). Fa esecul persistent (`mockRejectedValue`) si asserteaza explicit numarul de apeluri (`1 + allInstitutionTokens().length`), SAU adauga `institutie=` in request ca sa ramana pe drumul fara fallback — alege varianta care pastreaza intentia originala a testului si documenteaz-o in comentariu.

(g) **Contract PAT/MCP (OBLIGATORIU, nu conditional):** `API.md` (sectiunea raspunsului de cautare, ~L50-60) si `backend/src/routes/openapi.ts` (schema raspunsului `/dosare`, ~L66-69) documenteaza azi `{data,total,exactMatch}`. Adauga in AMBELE campul optional `failedInstitutii: string[]` cu semantica explicita: „raspuns 200 cu rezultate PARTIALE — instantele listate nu au raspuns si dosarele lor lipsesc; inainte de v2.44 acest caz era eroare 500". Un consumator PAT/MCP care citeste doar `total` trebuie sa poata afla din documentatie ca 200 nu mai garanteaza completitudine cand campul e prezent.

- [ ] **Step 4: Run** `npm test --workspace=backend -- dosarePartial dosareExactMatch soap-too-large --run` → PASS, zero regresii.

- [ ] **Step 5: Type-check** `npx tsc --noEmit -p backend/tsconfig.json` → PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/dosare.ts backend/src/routes/dosarePartial.test.ts
git commit -m "feat(dosare): fallback per instanta la esecul apelului agregat + failedInstitutii in raspuns"
```

---

### Task 4: Frontend — banner de avertizare + curatare state + export partial

**Files:**
- Modify: `frontend/src/lib/api.ts` (L322-323: tipul `dosare.search` devine `get<{ data: Dosar[]; total: number; exactMatch?: boolean; failedInstitutii?: string[] }>` — atentie: tipul actual NU are `exactMatch`, il adaugi acum ca optional)
- Modify: `frontend/src/App.tsx` (state-ul AUTORITATIV al cautarii traieste AICI: interfata ~L34-43 si initializarile ~L351-360 — campul `failedInstitutii?: string[]` se adauga in interfata din App.tsx, cu `[]` in initializari; confirma cu `grep -rn "searchedName" frontend/src`)
- Modify: `frontend/src/pages/Dosare.tsx` (propagare + banner + confirm la export)
- Test: `cd frontend && npx tsc --noEmit`

**Interfaces:**
- Consumes: `failedInstitutii?: string[]` din raspuns (Task 3); `getInstitutieLabel(val: string): string` din `frontend/src/lib/institutii.ts:26`.
- Produces: camp `failedInstitutii?: string[]` in state-ul de cautare; banner amber; confirmare la export cand rezultatele sunt partiale.

- [ ] **Step 1: Tipul** — extinde raspunsul `dosare.search` in `api.ts` cum e specificat la Files.

- [ ] **Step 2: State** — in `Dosare.tsx`:
  - adauga `failedInstitutii?: string[]` in interfata de state a paginii (acolo unde traieste `searchedName`);
  - calea de succes ne-ICCJ (L219-228): `failedInstitutii: res.failedInstitutii ?? []`;
  - **curatare obligatorie** (banner-ul vechi NU are voie sa persiste sub un spinner nou sau dupa o cautare noua): seteaza `failedInstitutii: []` in TOATE celelalte locuri care construiesc state-ul complet — startul cautarii (obiectul `{ ...state, error: null, searched: true }` din `handleSearch`, daca exista un astfel de reset la start), calea de succes ICCJ (L197-206), calea de eroare (L240-247) si orice reset de formular (~L443-450). Gaseste-le pe toate cu `grep -n "onStateChange" frontend/src/pages/Dosare.tsx` si trateaza fiecare apel.

- [ ] **Step 3: Banner** — imediat DUPA blocul de eroare rosu existent (`Eroare la cautare`, ~L466-472), cu gate pe `!loading`:

```tsx
{state.searched && !loading && !state.error && (state.failedInstitutii?.length ?? 0) > 0 && (
  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
    <p className="text-sm font-medium text-amber-800 dark:text-amber-400">Unele instante nu au raspuns</p>
    <p className="text-sm text-amber-700 dark:text-amber-300">
      {formatFailedInstitutii(state.failedInstitutii ?? [])} — rezultatele acestor instante lipsesc din lista.
      Incercati din nou mai tarziu.
    </p>
  </div>
)}
```

cu helper local (module-level, langa celelalte helpere):

```tsx
function formatFailedInstitutii(tokens: string[]): string {
  const labels = tokens.map((t) => getInstitutieLabel(t));
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} si alte ${labels.length - 3} instante`;
}
```

(Importa `getInstitutieLabel` — importul existent din `../lib/institutii` are deja `INSTITUTII, normalizeInstitutie`; adauga-l acolo. Copiaza structura claselor din banner-ul rosu existent, schimband paleta pe amber. Nota UI: banner-ul si empty-state-ul „Niciun dosar gasit" pot aparea impreuna cand partialul e gol — acceptat, e informativ.)

- [ ] **Step 4: Export partial** — gaseste handler-ul de export XLSX din `Dosare.tsx` (`grep -n "export" frontend/src/pages/Dosare.tsx | grep -i xlsx`); inainte de a porni exportul, daca `(state.failedInstitutii?.length ?? 0) > 0`:

```tsx
if (!window.confirm("Rezultatele sunt PARTIALE (instante fara raspuns la cautare). Exporti totusi lista incompleta?")) return;
```

(Motiv: un XLSX exportat dintr-o cautare partiala nu poarta nicio urma a incompletitudinii — utilizatorul trebuie sa confirme constient.)

- [ ] **Step 5: Type-check** `cd frontend && npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/Dosare.tsx
git commit -m "feat(ui): banner amber cu instantele PortalJust fara raspuns + confirmare la export partial"
```

---

### Task F: Gate complet + verificare functionala

- [ ] **Step 1:** `npx biome check --write .` → re-add daca reformateaza.
- [ ] **Step 2:** `npm run check` → PASS integral.
- [ ] **Step 3:** `npm run build` → PASS.
- [ ] **Step 4 (verificare live, orchestrator):** in mediul web local, cautarea `MAZILU MIHAI CRISTIAN`: daca instantele Prahova sunt inca cazute la PortalJust → rezultate partiale + banner amber; daca portalul s-a insanatosit → cautare normala, un singur apel.
- [ ] **Step 5:** Commit `style: biome format pass` daca biome a reformatat.

## Riscuri cunoscute si limitari asumate

- **Latenta pe calea degradata:** bugetul de 120s pe fanout margineste worst-case-ul fanout-ului (fara el: ceil(231/10) x 60s ≈ 24 min la portal agatat). Worst-case-ul TOTAL al requestului e insa ~180s: 60s timeout intern al apelului agregat esuat, urmat de 120s buget pe fanout. Instantele neatinse in buget apar in `failedInstitutii` — utilizatorul stie ce lipseste. In web mode, un reverse proxy cu timeout <180s (ex. 504 la 60s) taie raspunsul inaintea worst-case-ului — la deploy se dimensioneaza timeout-ul proxy-ului peste ~180s (nota pentru DEPLOY-SERVER.md la momentul deploy-ului real; local si desktop nu au proxy cu timeout).
- **Memorie pe calea degradata:** `maxResults=MAX_DOSARE_RESPONSE` opreste acumularea; raman totusi pana la 10 body-uri SOAP concurente in zbor (cap 50MB fiecare, existent) — identic cu expunerea de azi la `Promise.all` pe 50 de institutii selectate.
- **Presiune pe PortalJust pe calea degradata:** fiecare cautare esuata agregat = fan-out complet. Fara cache/circuit breaker in aceasta iteratie (YAGNI); follow-up natural daca devine problema operationala.
- **`SoapResponseTooLargeError` per instanta** in fan-out cade in `failedInstitutii` (afisata ca „nu a raspuns") — imprecis pentru o instanta sanatoasa cu >cap rezultate, dar cazul e marginal (nume + o singura instanta > 50MB) si preferabil complexitatii unui al doilea camp. Documentat, acceptat.
- **`failedInstitutii` lunga**: colapsata in UI la „primele 3 + si alte N".
- **Fara buton de cancel in UI** (Codex): `get()` din api.ts nu primeste AbortSignal si `handleSearch` nu creeaza AbortController — utilizatorul nu poate anula explicit o cautare degradata; asteptarea e insa MARGINITA de bugetul de 120s al fallback-ului. Limitare asumata; un buton de cancel end-to-end e follow-up separat daca UX-ul o cere.
- **Verificarea live din Task F depinde de pana PortalJust**: daca portalul e sanatos la momentul executiei, comportamentul degradat ramane dovedit DOAR de testele cu mock (acceptat — testele acopera intreaga matrice).
- **Termene.tsx / SSE load-more**: out of scope (SSE are deja toleranta + warnings; Termene = follow-up la cerere).
