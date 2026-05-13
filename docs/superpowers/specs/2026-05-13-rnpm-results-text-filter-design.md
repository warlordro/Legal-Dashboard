# RNPM Results Text Filter — Design Spec

**Versiune target**: v2.24.0 (minor bump)
**Data**: 2026-05-13
**Status**: APPROVED — gata de implementare prin Codex sub supervizare.
**Scope**: filtru text incremental peste rezultatele unei cautari RNPM, executat pe server, fara modificari de schema RNPM si fara regresii pe `/saved?q=`.

---

## 1. Context si motivatie

Modulul RNPM intoarce rezultate dintr-un `searchId`. Userul vrea sa caute text incremental in randurile rezultate (debitori, creditori, bunuri, descrieri, identificator) fara sa retrimita o cautare RNPM (care costa captcha si timp).

Spec-ul vechi `PLAN-rnpm-results-filter.md` (commit `3208782`, branch `feat/rnpm-results-filter`) este STALE — face referinte la structuri si nume care nu mai exista (`rnpm_parties`, `requireOwner`, `searchLimiter`, envelope wrap). Codebase-ul curent are deja infrastructura partiala in `getAvize()` (text search pe 12 coloane via `rnpm_norm()` + `EXISTS` pentru creditori/debitori).

**Decizie aprobata**: Optiune 2 (refoloseste pattern-ul din `getAvize()`) + Strategie A (transparent missingDetails counter pentru avize fara `detail_fetched=1`).

---

## 2. Constrangeri non-negotiable

1. **Limba**: surse cod si UI in **romana fara diacritice** (constraint CLAUDE.md L194).
2. **Zero regresii**: NU se modifica `getAvize()`, NU se atinge schema RNPM existenta, NU se schimba rute existente, NU se modifica `executeSearch()` / `executeBulkSearch()`.
3. **Owner isolation**: orice query trece prin `getOwnerId(c)` din `ownerContext` (NU `requireOwner`, care nu exista).
4. **Repository-only DB access**: SQL raw nou DOAR in `backend/src/db/avizRepository.ts` (sau helper nou alaturi).
5. **Response shape**: rutele RNPM existente folosesc `c.json()` flat (nu envelope `{data, error, requestId}` care e doar pentru `/api/v1/*`). Pastreaza pattern-ul flat pentru consistenta cu `rnpmRouter`.
6. **Biome + tsc + tests verzi** inainte de orice push (CLAUDE.md L57-67).
7. **Kill switch operational** obligatoriu pentru feature nou de search backend.
8. **Backup-safe**: orice cale de read DB trece prin `withMaintenanceRead`.
9. **Cancellation-safe**: ruta accepta `AbortSignal` client + timeout intern 5s combinat via `AbortSignal.any`.

---

## 3. Decizii arhitecturale

### 3.1 Functie repository noua (NU extensie `getAvize`)

`getAvize().searchText` acopera doar 6 coloane aviz + creditori + debitori (12 LIKE-uri). Filtrul nou trebuie sa acopere si:
- `rnpm_avize.tip_act`, `alte_mentiuni`, `detalii_comune`
- `rnpm_bunuri.descriere_proprie` + `rnpm_bunuri_descrieri.text` (JOIN content-addressable)

Daca am extinde `getAvize()`, am regresa endpoint-ul `/api/rnpm/saved?q=` (care expune deja UI cu UX dedicat). Creem functie noua:

```ts
// backend/src/db/avizRepository.ts
export function filterRnpmSearchResults(opts: {
  ownerId: string;
  searchId: number;
  q: string;
  limit?: number;
  signal?: AbortSignal;
}): {
  matchedAvizIds: number[];
  matchedCount: number;
  totalInSearch: number;
  missingDetails: number;
  truncated: boolean;
};
```

Functia returneaza **doar ID-uri** + counters. UI le foloseste pentru a filtra `result.documents` deja in-memory in `RnpmResultsTable.tsx`. **Nu se intorc randuri full** — economie pe payload + zero schimbari pe shape-ul `RnpmDocument`.

### 3.2 Helper SQL clause — fara refactor pe `getAvize()`

**DECIZIE FERMA**: NU se atinge `getAvize()` (lines 422-506). Pentru `filterRnpmSearchResults()` se creeaza un helper PRIVAT NOU `buildResultsFilterClause()`, distinct de clauza din `getAvize().searchText`. Duplicare minima acceptata in favoarea zero-regresie pe ruta `/api/rnpm/saved?q=`.

Continutul helperului apare in sectiunea 5.2. Scope: 17 LIKE-uri (9 coloane aviz + 3 creditori + 3 debitori + 2 bunuri).

### 3.3 Schema constraint si index

`rnpm_avize` are deja `search_id` (FK la `rnpm_searches.id`). Adaugam **index nou** doar daca lipseste:

```sql
-- backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.up.sql
CREATE INDEX IF NOT EXISTS idx_rnpm_avize_owner_search
  ON rnpm_avize(owner_id, search_id);
```

`IF NOT EXISTS` previne fail in caz ca exista deja (pe DB-uri vechi). **Down migration**:

```sql
-- 0021_idx_rnpm_avize_owner_search.down.sql
DROP INDEX IF EXISTS idx_rnpm_avize_owner_search;
```

**NU adaugam** index pe coloanele text — toate query-urile sunt LIKE pe `rnpm_norm()` (function call), deci index pe coloana brut nu ar fi folosit. Optimizarea reala vine din restrictia pe `(owner_id, search_id)` care reduce searchspace-ul la O(rezultate aviz din search), nu O(total avize).

### 3.4 Kill switch

```
RNPM_RESULTS_FILTER_DISABLED=1
```

Cand setat, ruta intoarce `503` cu body `{ error: "Filtrul de rezultate RNPM este dezactivat temporar.", code: "FILTER_DISABLED" }`. UI ascunde input-ul si afiseaza inline banner.

**Logging**: log mesajul EXACT din body (nu include numele variabilei in body — `code: "FILTER_DISABLED"` e suficient pentru UI; numele env-ului ramane doar in cod si docs).

### 3.5 Strategie missingDetails (Strategie A — transparent)

Fetch-ul detaliilor (`detalii_comune`, `tip_act`, `alte_mentiuni`, `rnpm_bunuri_descrieri.text`) ruleaza **eager** in `rnpmSearchService.executeSearch()` cu concurency=5 dupa list-ul de avize. Daca un user filtreaza dupa ce fetch-ul s-a terminat partial (cancel mid-search, eroare upstream pe sub-set), avizele fara `detail_fetched=1` nu sunt complet indexate.

**Comportament**:
- Functia COUNTUIESTE separat `missingDetails = COUNT(*) FROM rnpm_avize WHERE owner_id=? AND search_id=? AND detail_fetched=0`.
- Returneaza counter-ul in response.
- UI afiseaza inline non-blocant: `"{matchedCount} / {totalInSearch} — N avize fara detalii incomplete pot ascunde rezultate"`.
- **NU se retrimite fetch**, NU se blocheaza UI, NU se ofera buton de retry (out of scope; rezolvarea reala e re-run search RNPM).

### 3.6 Truncare

Pentru a evita response-uri uriase pe search-uri cu ~10k avize unde aproape toti matchuiesc, cap-uim la 1500 ID-uri.

```ts
const HARD_LIMIT = 1500;
const truncated = matchedCount > HARD_LIMIT;
const matchedAvizIds = ids.slice(0, HARD_LIMIT);
```

UI afiseaza: `"Filtrul a returnat peste {HARD_LIMIT} avize — afisez primele {HARD_LIMIT}. Restrange textul pentru rezultate complete."`

---

## 4. API contract

### 4.1 Endpoint

**METHOD/PATH**: `POST /api/rnpm/search/:searchId/filter`

**De ce POST si nu GET**: Hono `logger()` middleware (mountat global in `backend/src/index.ts`) loghea `URL` cu query string. Daca `q` ar fi in query, ar leak in stdout, audit log, fisier de logging. Body POST nu e logat. **NU folosim GET cu query**.

**De ce `/api/rnpm/` si nu `/api/v1/rnpm/`**: ruta de productie e mountata la `/api/rnpm` (`backend/src/index.ts:242`); doar fixturile de test folosesc `/api/v1/rnpm`. Codex DOAR pe `/api/rnpm/search/:searchId/filter`.

### 4.2 Request

```jsonc
// Body
{
  "q": "string"           // OBLIGATORIU; trim apoi min 2 caractere; max 200 caractere
}
```

**Validare Zod**:

```ts
const FilterSchema = z.object({
  q: z
    .string()
    .max(200, "Termen prea lung")
    .transform((s) => s.trim())
    .refine((s) => s.length >= 2, "Minim 2 caractere dupa trim")
    .transform((s) => s.replace(/[\u0000-\u001F\u200B-\u200F\uFEFF]/g, "")), // strip control + zero-width
});
const searchIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
```

Param `:searchId` din URL e parsed cu `searchIdSchema`.

### 4.3 Response — success (200)

```jsonc
{
  "matchedAvizIds": [12, 34, 56],   // number[], max 1500
  "matchedCount": 87,                // count REAL (poate fi > matchedAvizIds.length cand truncated=true)
  "totalInSearch": 432,              // total avize din searchId pentru owner
  "missingDetails": 5,               // avize cu detail_fetched=0
  "truncated": false                 // true daca matchedCount > 1500
}
```

### 4.4 Response — errori

| Status | Body | Cand |
|---|---|---|
| 400 | `{ "error": "JSON invalid" }` | body parse fail |
| 400 | `{ "error": "Mesaj specific" }` | Zod validation fail (mesajul din schema) |
| 404 | `{ "error": "Search inexistent" }` | searchId nu apartine ownerId SAU searchId nu exista. **Acelasi mesaj** — previne enumerare. |
| 499 | (fara body sau body minimal) | client abort (AbortSignal canceled) |
| 503 | `{ "error": "Filtrul de rezultate RNPM este dezactivat temporar.", "code": "FILTER_DISABLED" }` | kill switch activ |
| 503 | `{ "error": "Timeout filtrare", "code": "FILTER_TIMEOUT" }` | timeout 5s atins |
| 500 | `{ "error": "Eroare interna filtrare" }` | exceptii necunoscute (logate intern cu requestId) |

**NU exista 403** — collapse-uit la 404 (anti-enumeration).

### 4.5 Middleware chain

```ts
rnpmRouter.post(
  "/search/:searchId/filter",
  limitSearch,                       // body limit existent (bodyLimit, NU searchLimiter)
  async (c) => { /* handler */ }
);
```

`ownerContext` e deja mountat global (`app.use("*", ownerContext)` in `backend/src/index.ts:196`) si acopera toate rutele incluzand `/api/rnpm/*`. NU se aplica per-route.

**Nota**: `limitSearch` e local in `backend/src/routes/rnpm.ts:35` ca `bodyLimit({ maxSize: SEARCH_BODY_LIMIT, onError: bodyTooLarge })`. E aceeasi instanta folosita de `/search`, `/search-split`. NU este rate limiter, ci body size cap. Pentru filter, body-ul e ~250 bytes (max 200 chars `q`) — limita e ok.

### 4.6 Logging (audit-safe)

`logRnpmEvent` din `backend/src/services/rnpmSearchService.ts:85` este PRIVAT (nu exportat). In `backend/src/routes/rnpm.ts` se creeaza un helper local identic, sau se foloseste `console.log(JSON.stringify({...}))` direct:

```ts
function logFilterEvent(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...entry, ts: new Date().toISOString() }));
}

logFilterEvent({
  action: "rnpm.results.filter",
  ownerId,
  searchId,
  qLen: q.length,            // niciodata raw q
  matchedCount,
  truncated,
  missingDetails,
  latencyMs,
  status: "ok" | "error" | "abort" | "timeout" | "not_found"
});
```

**Niciodata** nu se loghea raw `q` (PII risk). UI nu trimite token de auth in body. Audit log respecta same convention.

---

## 5. Implementare backend pas cu pas

### 5.1 Migration (Pasul 1)

Creeaza:
- `backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.up.sql`
- `backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.down.sql`

Continut UP (sectiunea 3.3). Pre-migration backup ruleaza automat (v2.16.1 generic).

### 5.2 Helper repository (Pasul 2)

In `backend/src/db/avizRepository.ts`, dupa `getAvize()`, adauga:

```ts
function buildResultsFilterClause(q: string): { whereSql: string; params: string[] } {
  const like = buildRnpmLikePattern(q);
  const whereSql = `(
    rnpm_norm(a.identificator) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.tip) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.utilizator_autorizat) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.numar_act) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.tip_act) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.alte_mentiuni) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.detalii_comune) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.inscriere_initiala_id) LIKE ? ESCAPE '\\'
    OR rnpm_norm(a.inscriere_modificata_id) LIKE ? ESCAPE '\\'
    OR EXISTS (SELECT 1 FROM rnpm_creditori c
      WHERE c.aviz_id = a.id AND c.owner_id = a.owner_id
      AND (rnpm_norm(c.denumire) LIKE ? ESCAPE '\\'
        OR rnpm_norm(c.cod) LIKE ? ESCAPE '\\'
        OR rnpm_norm(c.cnp) LIKE ? ESCAPE '\\'))
    OR EXISTS (SELECT 1 FROM rnpm_debitori d
      WHERE d.aviz_id = a.id AND d.owner_id = a.owner_id
      AND (rnpm_norm(d.denumire) LIKE ? ESCAPE '\\'
        OR rnpm_norm(d.cod) LIKE ? ESCAPE '\\'
        OR rnpm_norm(d.cnp) LIKE ? ESCAPE '\\'))
    OR EXISTS (SELECT 1 FROM rnpm_bunuri b
      LEFT JOIN rnpm_bunuri_descrieri bd ON bd.id = b.descriere_id
      WHERE b.aviz_id = a.id AND b.owner_id = a.owner_id
      AND (rnpm_norm(b.descriere_proprie) LIKE ? ESCAPE '\\'
        OR rnpm_norm(bd.text) LIKE ? ESCAPE '\\'))
  )`;
  const params: string[] = Array(17).fill(like);
  return { whereSql, params };
}

export interface FilterRnpmResultsOptions {
  ownerId: string;
  searchId: number;
  q: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface FilterRnpmResultsOutcome {
  matchedAvizIds: number[];
  matchedCount: number;
  totalInSearch: number;
  missingDetails: number;
  truncated: boolean;
}

export function filterRnpmSearchResults(opts: FilterRnpmResultsOptions): FilterRnpmResultsOutcome {
  const HARD_LIMIT = 1500;
  const db = getDb();
  const { ownerId, searchId, q, signal } = opts;
  const limit = Math.min(opts.limit ?? HARD_LIMIT, HARD_LIMIT);

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Ownership precheck (anti-enumeration).
  const owns = db
    .prepare(`SELECT 1 AS ok FROM rnpm_searches WHERE id = ? AND owner_id = ?`)
    .get(searchId, ownerId) as { ok: number } | undefined;
  if (!owns) {
    const err = new Error("Search inexistent");
    (err as Error & { code: string }).code = "SEARCH_NOT_FOUND";
    throw err;
  }

  // Total in search (denominator pentru UI).
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS total FROM rnpm_avize WHERE owner_id = ? AND search_id = ?`)
    .get(ownerId, searchId) as { total: number };
  const totalInSearch = totalRow.total;

  // Missing details counter.
  const missRow = db
    .prepare(
      `SELECT COUNT(*) AS m FROM rnpm_avize WHERE owner_id = ? AND search_id = ? AND detail_fetched = 0`
    )
    .get(ownerId, searchId) as { m: number };
  const missingDetails = missRow.m;

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const { whereSql, params } = buildResultsFilterClause(q);

  // Count (real, fara LIMIT) pentru a sti daca truncam.
  const countSql = `SELECT COUNT(*) AS c FROM rnpm_avize a WHERE a.owner_id = ? AND a.search_id = ? AND ${whereSql}`;
  const countRow = db.prepare(countSql).get(ownerId, searchId, ...params) as { c: number };
  const matchedCount = countRow.c;

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Selectie ID-uri (capped la HARD_LIMIT).
  const sql = `
    SELECT a.id FROM rnpm_avize a
    WHERE a.owner_id = ? AND a.search_id = ? AND ${whereSql}
    ORDER BY a.id ASC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(ownerId, searchId, ...params, limit) as { id: number }[];
  const matchedAvizIds = rows.map((r) => r.id);

  return {
    matchedAvizIds,
    matchedCount,
    totalInSearch,
    missingDetails,
    truncated: matchedCount > limit,
  };
}
```

**Note**:
- `signal.aborted` check inainte si dupa fiecare query (sync sqlite, deci doar inainte/dupa).
- COUNT separat de SELECT — necesar pentru `truncated` flag.
- ORDER BY `a.id ASC` — deterministic; UI filtreaza local pe ID, nu depinde de ordine.

### 5.3 Route handler (Pasul 3)

In `backend/src/routes/rnpm.ts`:

```ts
import { z } from "zod";
import { filterRnpmSearchResults } from "../db/avizRepository.ts";
import { withMaintenanceRead } from "../db/backup.ts";
// logRnpmEvent din rnpmSearchService.ts e PRIVAT — pentru filter folosim un
// helper local identic (vezi sectiunea 4.6).
function logFilterEvent(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...entry, ts: new Date().toISOString() }));
}

const FilterBodySchema = z.object({
  q: z
    .string()
    .max(200, "Termen prea lung (max 200 caractere)")
    .transform((s) => s.trim())
    .refine((s) => s.length >= 2, "Minim 2 caractere dupa trim")
    .transform((s) => s.replace(/[\u0000-\u001F\u007F\u200B-\u200F\uFEFF]/g, "")), // strip control + zero-width
});

rnpmRouter.post("/search/:searchId/filter", limitSearch, async (c) => {
  if (process.env.RNPM_RESULTS_FILTER_DISABLED === "1") {
    return c.json(
      { error: "Filtrul de rezultate RNPM este dezactivat temporar.", code: "FILTER_DISABLED" },
      503
    );
  }

  const sidRaw = c.req.param("searchId");
  const sidParsed = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).safeParse(sidRaw);
  if (!sidParsed.success) {
    return c.json({ error: "searchId invalid" }, 400);
  }
  const searchId = sidParsed.data;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON invalid" }, 400);
  }
  const parsed = FilterBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Body invalid" }, 400);
  }
  const { q } = parsed.data;

  const ownerId = getOwnerId(c);
  const t0 = Date.now();

  const timeoutSignal = AbortSignal.timeout(5000);
  const signal = AbortSignal.any([c.req.raw.signal, timeoutSignal]);

  try {
    const result = withMaintenanceRead(() =>
      filterRnpmSearchResults({ ownerId, searchId, q, signal })
    );

    logFilterEvent({
      action: "rnpm.results.filter",
      ownerId,
      searchId,
      qLen: q.length,
      matchedCount: result.matchedCount,
      truncated: result.truncated,
      missingDetails: result.missingDetails,
      latencyMs: Date.now() - t0,
      status: "ok",
    });

    return c.json(result, 200);
  } catch (err) {
    const latencyMs = Date.now() - t0;
    if (err instanceof Error && (err as Error & { code?: string }).code === "SEARCH_NOT_FOUND") {
      logFilterEvent({ action: "rnpm.results.filter", ownerId, searchId, qLen: q.length, latencyMs, status: "not_found" });
      return c.json({ error: "Search inexistent" }, 404);
    }
    if (err instanceof Error && err.name === "AbortError") {
      // Daca timeout-ul intern e cauza:
      if (timeoutSignal.aborted) {
        logFilterEvent({ action: "rnpm.results.filter", ownerId, searchId, qLen: q.length, latencyMs, status: "timeout" });
        return c.json({ error: "Timeout filtrare", code: "FILTER_TIMEOUT" }, 503);
      }
      // Daca client a anulat:
      logFilterEvent({ action: "rnpm.results.filter", ownerId, searchId, qLen: q.length, latencyMs, status: "abort" });
      return new Response(null, { status: 499 });
    }
    logFilterEvent({ action: "rnpm.results.filter", ownerId, searchId, qLen: q.length, latencyMs, status: "error" });
    console.error("[rnpm.filter] eroare neasteptata", err);
    return c.json({ error: "Eroare interna filtrare" }, 500);
  }
});
```

**Nota 5.4 — status 499 (DECIZIE FERMA)**: Hono types nu includ 499 in StatusCode union. **Codex foloseste `new Response(null, { status: 499 })` returnat direct din handler** (Hono accepta orice `Response` instance ca return value). Asta evita cast-ul si pastreaza semantica corecta (Client Closed Request). Important: NU se intoarce 200 cu payload partial sau gol — clientul anulat trebuie sa primeasca 499 explicit.

```ts
// in catch block, pentru AbortError din partea clientului:
return new Response(null, { status: 499 });
```

### 5.5 Boot-time probe pentru index (Pasul 4)

In `backend/src/db/schema.ts`, dupa `initSchema(db)`, adauga probe lightweight:

```ts
// Probe lightweight: verifica index-ul filter-ului. NU fail-closed daca
// migration 0021 nu a rulat — doar warn pentru ops.
try {
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_rnpm_avize_owner_search'`)
    .get();
  if (!exists) {
    console.warn("[schema] WARN: idx_rnpm_avize_owner_search lipseste; filtrul RNPM va fi mai lent.");
  }
} catch (e) {
  console.warn(`[schema] index probe failed: ${e instanceof Error ? e.message : "unknown"}`);
}
```

---

## 6. Implementare frontend pas cu pas

### 6.1 API client method (Pasul 5a)

In `frontend/src/lib/rnpmApi.ts`, dupa pattern-ul existent `jsonOrThrow + apiFetch` (NU axios — proiectul foloseste `fetch` via `apiFetch` din `@/lib/api`):

```ts
// frontend/src/lib/rnpmApi.ts
export interface RnpmResultsFilterResponse {
  matchedAvizIds: number[];
  matchedCount: number;
  totalInSearch: number;
  missingDetails: number;
  truncated: boolean;
}

export class RnpmFilterDisabledError extends Error {
  readonly code = "FILTER_DISABLED" as const;
  constructor(message: string) {
    super(message);
    this.name = "RnpmFilterDisabledError";
  }
}

export async function filterRnpmResults(
  searchId: number,
  q: string,
  signal?: AbortSignal
): Promise<RnpmResultsFilterResponse> {
  const res = await apiFetch(`${BASE}/search/${searchId}/filter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q }),
    signal,
  });
  if (!res.ok) {
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Eroare server (${res.status})`);
    }
    const code = (data as { code?: string })?.code;
    const error = (data as { error?: string })?.error ?? "Eroare necunoscuta";
    if (res.status === 503 && code === "FILTER_DISABLED") {
      throw new RnpmFilterDisabledError(error);
    }
    throw new Error(error);
  }
  return res.json() as Promise<RnpmResultsFilterResponse>;
}
```

`BASE` din `rnpmApi.ts` e deja `"/api/rnpm"` (linia 34) — match cu mountul productie.

### 6.2 Hook nou `useRnpmResultsFilter` (Pasul 5b)

`frontend/src/hooks/useRnpmResultsFilter.ts`:

```ts
import { useEffect, useState } from "react";
import { useDebouncedValue } from "./useDebouncedValue";
import { filterRnpmResults, RnpmFilterDisabledError, type RnpmResultsFilterResponse } from "@/lib/rnpmApi";

interface State {
  loading: boolean;
  error: string | null;
  data: RnpmResultsFilterResponse | null;
  disabled: boolean;
}

export function useRnpmResultsFilter(searchId: number | null, query: string): State {
  const [debounced] = useDebouncedValue(query, 300); // hook returneaza tuple [value, flush]
  const [state, setState] = useState<State>({ loading: false, error: null, data: null, disabled: false });

  useEffect(() => {
    if (searchId == null) return;
    const trimmed = debounced.trim();
    if (trimmed.length < 2) {
      setState({ loading: false, error: null, data: null, disabled: false });
      return;
    }

    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    filterRnpmResults(searchId, trimmed, ctl.signal)
      .then((data) => {
        if (ctl.signal.aborted) return;
        setState({ loading: false, error: null, data, disabled: false });
      })
      .catch((err) => {
        if (ctl.signal.aborted) return;
        if (err?.name === "AbortError") return;
        if (err instanceof RnpmFilterDisabledError) {
          setState({ loading: false, error: null, data: null, disabled: true });
          return;
        }
        setState({
          loading: false,
          error: err instanceof Error ? err.message : "Eroare la filtrare",
          data: null,
          disabled: false,
        });
      });

    return () => ctl.abort();
  }, [searchId, debounced]);

  return state;
}
```

**Note**:
- Foloseste `apiFetch` via `filterRnpmResults` helper (NU axios — proiectul nu are axios).
- Reuse `useDebouncedValue` existent — NU crea raw `setTimeout`.
- 300ms debounce — empiric ok pentru search.
- `AbortController` curatat in cleanup pentru a cancela request-uri orfane.
- Verificare `ctl.signal.aborted` in then/catch previne setState pe component unmounted.
- Min 2 caractere — match cu server validation.

### 6.3 UI in `RnpmResultsTable.tsx` (Pasul 6)

In `frontend/src/components/rnpm/RnpmResultsTable.tsx`:

1. Adauga state local `const [filterQuery, setFilterQuery] = useState("")`.
2. Folosesc hook-ul: `const filter = useRnpmResultsFilter(result.searchId ?? null, filterQuery)`.
3. Calculeaza set ID-uri matchate:
   ```ts
   const matchedSet = useMemo(() => {
     if (!filter.data) return null;
     return new Set(filter.data.matchedAvizIds);
   }, [filter.data]);
   ```
4. Filtreaza `result.documents` cand `matchedSet != null`:
   ```ts
   const visibleDocuments = matchedSet
     ? result.documents.filter((d) => matchedSet.has(d.id))
     : result.documents;
   ```
5. Render input deasupra tabelului:
   ```tsx
   <div className="mb-3 flex items-center gap-2">
     <input
       type="text"
       value={filterQuery}
       onChange={(e) => setFilterQuery(e.target.value)}
       placeholder="Filtreaza rezultatele (debitor, creditor, descriere bun, identificator...)"
       aria-label="Filtru text peste rezultatele cautarii RNPM"
       className="..."
       disabled={filter.disabled}
       maxLength={200}
     />
     {filter.loading && <span className="text-xs text-gray-500">Filtrez...</span>}
     {filter.error && <span className="text-xs text-red-600">{filter.error}</span>}
     {filter.disabled && (
       <span className="text-xs text-amber-600">Filtru indisponibil temporar.</span>
     )}
   </div>
   {filter.data && (
     <div className="mb-2 text-xs text-gray-600">
       {filter.data.matchedCount === filter.data.totalInSearch
         ? `${filter.data.totalInSearch} avize`
         : `${filter.data.matchedCount} / ${filter.data.totalInSearch} avize`}
       {filter.data.truncated && (
         <span className="ml-2 text-amber-600">
           Afisez primele {filter.data.matchedAvizIds.length}. Restrange textul.
         </span>
       )}
       {filter.data.missingDetails > 0 && (
         <span className="ml-2 text-amber-600">
           {filter.data.missingDetails} avize fara detalii pot ascunde rezultate.
         </span>
       )}
     </div>
   )}
   ```

6. **Interactiuni cu features existente**:
   - **Pagination**: pagineaza `visibleDocuments`, nu `result.documents`.
   - **Sort**: aplica sort pe `visibleDocuments`.
   - **Selectie (checkbox-uri)**: cand filtrul devine activ, selectia existenta se pastreaza dar e ascunsa pentru randurile non-matched. La clear filter, selectia revine vizibila. **Decizie**: NU sterge selectia la activare filter (UX standard Excel-like).
   - **Export**: butonul export foloseste `visibleDocuments` cand filtru e activ. Adauga label vizibil: `"Exporta {visibleDocuments.length} (filtrate)"`.
   - **Open modal detalii**: ramane identic — modal-ul deschide doc-ul direct, neafectat de filter.

7. **Highlight (V1)**: NU highlight in V1 (out of scope; evita `dangerouslySetInnerHTML` si DOMPurify complexity). UI doar filtreaza randuri.

8. **Romana fara diacritice**: toate string-urile UI conform CLAUDE.md.

---

## 7. Testing — plan complet

### 7.1 Backend unit tests

`backend/src/db/avizRepository.filterRnpmSearchResults.test.ts`:

| # | Test | Setup | Verifica |
|---|---|---|---|
| 1 | Happy path — matchuieste pe debitor.denumire | 3 avize, 1 cu debitor "Popescu" | `matchedAvizIds.length === 1`, `matchedCount === 1`, `totalInSearch === 3` |
| 2 | Diacritic-insensitive — `"stefan"` matchuieste "Ștefan" | aviz cu debitor "Ștefan SRL" | match positiv |
| 3 | DISTINCT — un aviz cu 3 bunuri matchuind nu se duplica | aviz cu 3 bunuri, toate `descriere_proprie="combina"` | `matchedAvizIds.length === 1`, NU 3 |
| 4 | EXISTS pe bunuri_descrieri JOIN — text din `rnpm_bunuri_descrieri.text` | bun cu `descriere_id` -> text "tractor John Deere" | `q="john deere"` matchuieste |
| 5 | Cross-tenant izolation pe avize | 2 owners, fiecare cu avize, search separat | filter pentru owner A NU vede avize owner B |
| 6 | Cross-tenant izolation pe `rnpm_bunuri_descrieri` (content-addressable, NO owner_id) | acelasi text descriere folosit de 2 owners | filter owner A nu lista aviz owner B (verifica `b.owner_id` in EXISTS) |
| 7 | `searchId` neexistent → SEARCH_NOT_FOUND | searchId=99999 fara aviz | functia throw `code: "SEARCH_NOT_FOUND"` |
| 8 | `searchId` apartine altui owner → SEARCH_NOT_FOUND | search owner B, query owner A | acelasi error (anti-enum) |
| 9 | `missingDetails` counter corect | 5 avize, 2 cu `detail_fetched=0` | `missingDetails === 2` |
| 10 | Truncare `truncated=true` | 1600 avize matching, `limit=1500` | `matchedCount===1600`, `matchedAvizIds.length===1500`, `truncated===true` |
| 11 | LIKE meta escapate — `q="%"` literal | aviz cu identificator "AAA", query "%" | 0 matches |
| 12 | LIKE meta escapate — `q="_"` literal | aviz "AAA", "ABA" | doar "_" literal, deci 0 matches |
| 13 | LIKE meta escapate — `q="\"` (backslash) | aviz cu `\` in text | match positiv pe `\` literal |
| 14 | AbortSignal pre-query | signal aborted inainte de call | throw AbortError, fara DB hit |
| 15 | Filter cu `searchId` valid, q gol → caller-ul valideaza in Zod | n/a — validation in route | (test in 7.2 route test) |

### 7.2 Backend route tests

`backend/src/routes/rnpm.filter.test.ts`:

| # | Test | Verifica |
|---|---|---|
| 16 | POST happy path 200 | response shape conform 4.3 |
| 17 | GET 404/405 | metoda gresita |
| 18 | Body invalid JSON → 400 | `{ error: "JSON invalid" }` |
| 19 | `q` lipsa → 400 | Zod issue surfaceaza |
| 20 | `q="x"` (1 char) → 400 | "Minim 2 caractere" |
| 21 | `q="   "` (whitespace) → 400 | trim apoi min 2 fail |
| 22 | `q` cu control chars → strip, daca ramane >= 2 chars → 200 | sanitization |
| 23 | `q` 201 chars → 400 | max 200 |
| 24 | `searchId` non-numeric → 400 | searchId invalid |
| 25 | `searchId` altui owner → 404 | `{ error: "Search inexistent" }` |
| 26 | `searchId` inexistent → 404 | same message |
| 27 | Kill switch `RNPM_RESULTS_FILTER_DISABLED=1` → 503 cu `code: "FILTER_DISABLED"` | + log NU contine raw q |
| 28 | Timeout (mock query slow) → 503 cu `code: "FILTER_TIMEOUT"` | |
| 29 | Client abort → 499 (sau echivalent) fara payload partial | |
| 30 | Body 503/500 NU contine numele `RNPM_RESULTS_FILTER_DISABLED` | leak check |
| 31 | Log emis cu `qLen`, NU cu raw `q` | snapshot log capture |
| 32 | Status `ok` cu `latencyMs > 0` | structured log |

### 7.3 Backend EXPLAIN QUERY PLAN test

`backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts`:

| # | Test | Verifica |
|---|---|---|
| 33 | `EXPLAIN QUERY PLAN` pe `filterRnpmSearchResults` | output contine `USING INDEX idx_rnpm_avize_owner_search` |

**De ce EXPLAIN si nu wall-clock**: in CI Windows wall-clock e flakey. EXPLAIN garanteaza index utilizat fara dependinta de hardware.

### 7.4 Migration tests

`backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.test.ts`:

| # | Test | Verifica |
|---|---|---|
| 34 | Migration up apply de 2x — idempotenta (IF NOT EXISTS) | a doua aplicare NU throw |
| 35 | Migration down sterge index | sqlite_master fara index |
| 36 | Pre-migration backup automat (v2.16.1) | fisier backup creat |

### 7.5 Frontend tests

`frontend/src/hooks/useRnpmResultsFilter.test.ts`:

| # | Test | Verifica |
|---|---|---|
| 37 | Query gol → no fetch | `filterRnpmResults` NU apelat (mock) |
| 38 | Query 2 chars → debounce 300ms → fetch | timing |
| 39 | Type rapid 5 caractere → un singur fetch dupa debounce | dedup |
| 40 | Schimbare query mid-flight → abort previous fetch | AbortController cleanup |
| 41 | 503 FILTER_DISABLED → state `disabled=true`, `data=null` | UI semaphore |
| 42 | Error generic → state `error` populat | UX feedback |
| 43 | Success → state `data` populat, `loading=false` | happy path |

`frontend/src/components/rnpm/RnpmResultsTable.filter.test.tsx`:

| # | Test | Verifica |
|---|---|---|
| 44 | Input visible cand `result.searchId` exista | render |
| 45 | Type "popescu" → randuri vizibile reduse la cele matched | integration cu mocked hook |
| 46 | Filter activ + pagination → paginate `visibleDocuments` | corect count per pagina |
| 47 | Filter activ + sort → sort aplicat pe `visibleDocuments` | |
| 48 | Filter activ + selectie existing → selectia pastrata (test pe state intern) | |
| 49 | Export click cu filter activ → buton label `"Exporta N (filtrate)"` | UX |
| 50 | `disabled=true` → input disabled + banner "Filtru indisponibil" | |
| 51 | `truncated=true` → banner "Afisez primele 1500..." | |
| 52 | `missingDetails > 0` → banner non-blocant | |

### 7.6 Cross-tenant breach drill (test obligatoriu)

`backend/src/db/repository-isolation.test.ts` — adauga in suita existenta:

| # | Test | Setup | Verifica |
|---|---|---|---|
| 53 | `filterRnpmSearchResults` ownership leak | owner A: search S1 cu 5 avize, owner B: search S2 cu 5 avize cu acelasi text "Popescu" | `filterRnpmSearchResults({ownerId:"A", searchId: S2, q:"popescu"})` returneaza SEARCH_NOT_FOUND, NU rezultatele lui B |
| 54 | `rnpm_bunuri_descrieri` content-addressable izolat prin `b.owner_id` in EXISTS | descriere comuna intre owner A si B (text identic, possibly aceeasi `descriere_id` daca hash colide) | filter owner A vede doar avize A; B nu apare |

### 7.7 Build + lint gates

```bash
npx biome check --write backend/src frontend/src
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit
npm test --workspace=backend
cd frontend && npm test -- --run
```

Toate 4 trebuie verzi inainte de push.

---

## 8. Release bump v2.24.0

### 8.1 Fisiere de actualizat (CLAUDE.md L31-55)

**Mereu**:

1. `package.json` (root + backend + frontend) + `package-lock.json` → `2.24.0`
2. `frontend/src/data/changelog-entries.tsx` — entry nou:
   ```tsx
   {
     version: "2.24.0",
     date: "2026-05-?? (data efectiva)",
     summary: "Filtru text incremental peste rezultatele cautarii RNPM",
     details: [
       "Adaugat POST /api/rnpm/search/:searchId/filter cu owner isolation si timeout 5s",
       "Index nou idx_rnpm_avize_owner_search (migration 0021)",
       "Kill switch RNPM_RESULTS_FILTER_DISABLED pentru oprire de urgenta",
       "UI: filtru live in RnpmResultsTable cu debounce 300ms, counter missingDetails transparent"
     ]
   }
   ```
3. `CHANGELOG.md` — sectiune `## v2.24.0 — 2026-05-??`
4. `README.md` — campul "Versiune curenta"
5. `SESSION-HANDOFF.md`:
   - update header `**Versiune curenta**: v2.24.0`
   - adauga row in tabelul "Kill switches operationale":
     ```
     | `RNPM_RESULTS_FILTER_DISABLED=1` | Ruta POST `/api/rnpm/search/:searchId/filter` raspunde 503 cu code FILTER_DISABLED; UI ascunde inputul si arata banner | Stop urgent daca filter-ul provoaca contention DB sau bug regresat |
     ```
   - adauga sectiune "Sprint inchis YYYY-MM-DD — Filtru text RNPM"
6. `STATUS.md` — actualizeaza header
7. `DOCUMENTATIE.md` — campul versiune

**Conditional**:

8. `SECURITY.md` — entry in changelog table: feature nou cu owner isolation, anti-enumeration 404, anti-leak log (qLen vs raw q).

### 8.2 Sanity check pre-push

```bash
cd "c:/Users/Cezar/Desktop/Claude Code/Legal Dashboard"
grep -rni "v2\.23\.0" --include="*.md" . | grep -v node_modules | grep -v CHANGELOG.md
```

Fiecare hit care nu e changelog istoric → update obligatoriu.

### 8.3 Git workflow

```bash
git checkout -b feat/rnpm-results-filter
# ... codex implementeaza pas cu pas ...
npx biome check --write .
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
npm test --workspace=backend
cd frontend && npm test -- --run && cd ..
npm run build
git add -A
git commit -m "feat(rnpm): filtru text incremental peste rezultatele cautarii (v2.24.0)"
git push origin feat/rnpm-results-filter
# PR review + merge in main, apoi tag v2.24.0 si push tag
```

---

## 9. Risk register

| # | Risc | Mitigare |
|---|---|---|
| R1 | Index 0021 nu se aplica pe DB veche → query lent | Boot-time probe warn + EXPLAIN test asigura folosirea indexului dupa migration |
| R2 | `rnpm_bunuri_descrieri` leak cross-tenant (nu are owner_id) | EXISTS-ul filtreaza prin `b.owner_id` din `rnpm_bunuri` care e parent; test 54 valideaza |
| R3 | Log leak PII via raw `q` | Log foloseste `qLen` + structured fields; test 31 enforce |
| R4 | Filter blocheaza main DB writer la search-uri masive (busy_timeout 5s) | Timeout intern 5s + `withMaintenanceRead` + index 0021 reduc query la O(rezultate per search) |
| R5 | UI desincronizare matchedAvizIds vs `result.documents` dupa truncare | UI afiseaza banner truncated; filter local pe Set garantat no false match |
| R6 | Codex modifica accidental `getAvize()` searchText (regresie pe `/saved?q=`) | Spec interzice explicit; PR review verifica diff pe `avizRepository.ts:422-506` |
| R7 | Codex pune `q` in URL (GET) si scapa in log | Spec interzice; review verifica metoda POST |
| R8 | Kill switch leak — env name in body 503 | Spec body fix (sec 4.4 row 503); test 30 enforce |
| R9 | Codex uita `ESCAPE '\\'` pe vreun LIKE → injection pattern | Helper centralizat `buildResultsFilterClause` are 17 LIKE-uri cu ESCAPE uniform; review verifica |
| R10 | Frontend abort race condition | Cleanup AbortController in useEffect return; test 40 enforce |

---

## 10. Acceptance criteria (Definition of Done)

- [ ] Migration 0021 up + down + test idempotenta (3 teste)
- [ ] `filterRnpmSearchResults` cu 15 unit tests verzi
- [ ] Route handler cu 17 route tests verzi
- [ ] 1 EXPLAIN QUERY PLAN test verde
- [ ] 2 cross-tenant breach drill tests verzi
- [ ] 7 frontend hook tests verzi
- [ ] 9 frontend component tests verzi
- [ ] Biome curat pe toate fisierele atinse
- [ ] `tsc --noEmit` curat backend + frontend
- [ ] `npm run build` curat
- [ ] CLAUDE.md release checklist complet (8 fisiere `.md` actualizate)
- [ ] `SESSION-HANDOFF.md` kill switches table contine `RNPM_RESULTS_FILTER_DISABLED`
- [ ] Manual smoke pe Electron: search RNPM real, filter live, verifica counter, truncate, missingDetails, disabled mode (cu env var setat)
- [ ] PR descris cu link la spec si la 7-agent reviews

---

## 11. Out of scope (explicit pentru a evita scope creep)

- Highlight visual al match-ului in row (V2)
- Buton "Reia detalii" pentru avizele cu `detail_fetched=0` (V2)
- Buton "Sterge filtru" (X-ul din input nativ e suficient)
- Server-side highlighting / FTS5 (V3 daca scale-ul cere)
- Search peste history (`rnpm_istoric.text_modificare`) — feature distinct
- Filter persistent in URL params — out of scope
- Export DIRECT al subset-ului filtrat printr-un endpoint dedicat (UI reuse export existent cu visibleDocuments)
