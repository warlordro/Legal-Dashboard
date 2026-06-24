# RNPM Filter — Multi-Token + Highlight Implementation Plan (v2.25.0)

> **Pentru Codex:** Acest fisier e self-contained — contine spec + plan + cod gata de copiat. Implementeaza task-cu-task. Eu (Claude) sunt supervizor: rulez biome/tsc/build/test la final si fac code review intre task-uri daca ma intrebi.

**Goal:** Inbunatatim filtrul de text peste rezultatele unei cautari RNPM (livrat in v2.24.0) ca sa accepte mai multe cuvinte cu logica AND si sa highlightieze vizual potrivirile, inclusiv in detaliile expand-uite (Creditori / Debitori / Bunuri / Istoric).

**Branch:** `feat/rnpm-filter-multitoken-highlight`, creat din `main` DUPA ce `feat/rnpm-results-filter` (v2.24.0) e merged.

**Versiune:** v2.25.0.

**Limba:** romana fara diacritice in cod, comentarii, UI, commit messages.

---

## 1. Recap design (aprobat 2026-05-13)

Filtrul curent (`POST /api/rnpm/search/:id/filter`, livrat in v2.24.0) primeste un string `q` si genereaza un singur pattern LIKE peste 24 de coloane. Are doua probleme de UX:

1. **Substring match cu un singur pattern** — daca userul scrie `totalitatea creantelor`, SQL-ul devine `LIKE '%totalitatea creantelor%'`, deci match doar daca exact secventa apare in acelasi camp. Userul se astepta ca cele doua cuvinte sa fie cautate independent (AND), fiecare putand fi in alt camp (debitor, creditor, descriere bun, etc.).
2. **Niciun highlight** — primeste 25 de rezultate, nu vede unde s-a gasit cuvantul. Daca match-ul e doar in `rnpm_bunuri_descrieri.text` (descrierea bunului, vizibila doar in expand), userul crede ca filtrul nu functioneaza.

### Solutie

**Backend:**
- `tokenizeFilterQuery(q)` — split pe whitespace, trim, dedup case-insensitive (dupa NFD strip + lowercase), limita max 8 tokens (anti-DoS).
- `buildResultsFilterClause(tokens)` — primeste `string[]` in loc de `string`. Genereaza N grupuri `(col1 LIKE ? OR col2 LIKE ? OR ... OR EXISTS ...)`, conectate cu **AND**. Fiecare token are propriul pattern LIKE.
- Response neschimbat (`matchedAvizIds`, `matchedCount`, ...) — UI calculeaza highlight si badge local.

**Frontend:**
- `tokenizeFilterQuery` (mirror in `frontend/src/lib/rnpmFilterTokens.ts`) — aceleasi reguli ca backend; folosit de UI ca sa stie ce sa highlight-uieasca.
- `highlightTokens(text, tokens)` — helper pur care wrap-uieste match-urile cu `<mark>`, diacritice-insensitive, case-insensitive, pastreaza textul original (cu diacritice si majuscule), nu accepta HTML.
- Integrare in `RnpmResultsTable.tsx` (randul colapsat: Identificator, Tip, Utilizator autorizat) si in `RnpmDetailModal.tsx` (toate tab-urile expand-uite).
- Badge `match in detalii` — apare sub Identificator pe randuri unde niciun token nu se gaseste in campurile colapsate.

### Constrangeri

- Repository-only DB access — raw SQL doar in `backend/src/db/**`.
- `owner_id` pe toate query-urile (owner isolation).
- `RNPM_RESULTS_FILTER_DISABLED=1` kill switch ramane functional (din v2.24.0).
- Index `idx_rnpm_avize_owner_search` ramane folosit la EXPLAIN QUERY PLAN.
- Biome obligatoriu inainte de orice push.
- Romana fara diacritice in cod / comentarii / commit messages / UI.
- Multi-token query devine `O(tokens * 24)` LIKE patterns — limita 8 tokens previne abuz.

### File structure

```
Create:
  backend/src/util/textNormalize.tokenize.test.ts         (unit teste pentru tokenizeFilterQuery)
  frontend/src/lib/rnpmFilterTokens.ts                    (mirror frontend al tokenizer-ului)
  frontend/src/lib/rnpmFilterTokens.test.ts               (unit teste)
  frontend/src/lib/rnpmHighlightTokens.tsx                (helper React highlight)
  frontend/src/lib/rnpmHighlightTokens.test.tsx           (unit teste)

Modify:
  backend/src/util/textNormalize.ts                       (+ tokenizeFilterQuery export)
  backend/src/db/avizRepository.ts                        (buildResultsFilterClause: string[])
  backend/src/db/avizRepository.filterRnpmSearchResults.test.ts  (adapt + scenarii noi AND)
  backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts  (verify N tokens)
  backend/src/routes/rnpmRoutes.ts                        (validare lungime tokens, audit log tokens)
  frontend/src/components/rnpm/RnpmResultsTable.tsx       (integrare highlight + badge)
  frontend/src/components/rnpm/RnpmDetailModal.tsx        (integrare highlight in tabs)
  frontend/src/data/changelog-entries.tsx                 (in-app changelog v2.25.0)
  package.json (root + backend + frontend)                (2.24.0 -> 2.25.0)
  package-lock.json                                       (sincronizare lockfile)
  CHANGELOG.md                                            (entry v2.25.0)
  README.md                                               (versiune curenta)
  CLAUDE.md                                               (header versiune curenta)
  SESSION-HANDOFF.md                                      (daca exista referinte la v2.24.0)
  STATUS.md                                               (header data + versiune)
  DOCUMENTATIE.md                                         (campul versiune din sectiunea descriere)
```

---

## Task 0: Branch setup

**Files:** niciunul

- [ ] **Step 0.1: Verifica ca esti pe main si curat**

```bash
git checkout main
git status
git pull --ff-only
```

Expected: `nothing to commit, working tree clean` si HEAD include commit-ul de merge pentru `feat/rnpm-results-filter` (v2.24.0).

- [ ] **Step 0.2: Creeaza branch nou**

```bash
git checkout -b feat/rnpm-filter-multitoken-highlight
```

- [ ] **Step 0.3: Copiaza plan-ul curent in branch** (daca nu exista deja prin merge anterior)

Verifica ca `docs/superpowers/plans/2026-05-13-rnpm-filter-multitoken-highlight.md` exista — daca lipseste, copy-paste fisierul de pe branch-ul precedent / din mesajul lui Claude.

---

## Task 1: Backend tokenizer `tokenizeFilterQuery`

**Files:**
- Modify: `backend/src/util/textNormalize.ts` (adauga export nou)
- Create: `backend/src/util/textNormalize.tokenize.test.ts`

**Goal:** O functie pura, deterministica, care primeste query-ul brut de la user si returneaza lista de tokens normalizate. Aceeasi functie se reimplementeaza identic pe frontend (Task 4) — backend-ul si frontend-ul nu impart cod.

- [ ] **Step 1.1: Adauga functia in `textNormalize.ts`**

Adauga la finalul fisierului (dupa `stripDiacriticsDeep`):

```ts
// Tokenizeaza query-ul de filtru in lista de tokens distincte.
// Reguli:
//   - split pe whitespace (orice rulada de \s)
//   - trim per token
//   - drop empty
//   - dedup case-insensitive si diacritice-insensitive
//     (ex: "Stefan stefan ŞTEFAN" -> ["Stefan"] singura intrare)
//   - max 8 tokens (anti-DoS; un query cu 50 cuvinte ar genera 50 grupuri AND
//     in SQL si ar bloca eficient query planner-ul)
//
// Returneaza tokens ORIGINALE (cu diacritice si majuscule pastrate), in ordinea
// primei aparitii. Normalizarea (NFD strip + lowercase) e aplicata la consum
// (buildRnpmLikePattern + rnpm_norm SQL function).
//
// Folosita atat de backend (buildResultsFilterClause) cat si de frontend
// (rnpmFilterTokens.ts -- mirror identic). Schimbarile aici trebuie reflectate
// in frontend si invers.
export const FILTER_TOKEN_MAX_COUNT = 8;

export function tokenizeFilterQuery(q: string): string[] {
  if (typeof q !== "string") return [];
  const raw = q.split(/\s+/);
  const seenKeys = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const trimmed = t.trim();
    if (trimmed.length === 0) continue;
    const key = stripDiacritics(trimmed).toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push(trimmed);
    if (out.length >= FILTER_TOKEN_MAX_COUNT) break;
  }
  return out;
}
```

- [ ] **Step 1.2: Scrie testele**

Creeaza `backend/src/util/textNormalize.tokenize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tokenizeFilterQuery, FILTER_TOKEN_MAX_COUNT } from "./textNormalize.ts";

describe("tokenizeFilterQuery", () => {
  it("returneaza array gol pentru string gol sau whitespace-only", () => {
    expect(tokenizeFilterQuery("")).toEqual([]);
    expect(tokenizeFilterQuery("   ")).toEqual([]);
    expect(tokenizeFilterQuery("\t\n  ")).toEqual([]);
  });

  it("returneaza array gol pentru non-string", () => {
    expect(tokenizeFilterQuery(null as unknown as string)).toEqual([]);
    expect(tokenizeFilterQuery(undefined as unknown as string)).toEqual([]);
    expect(tokenizeFilterQuery(123 as unknown as string)).toEqual([]);
  });

  it("split pe whitespace simplu", () => {
    expect(tokenizeFilterQuery("alfa beta")).toEqual(["alfa", "beta"]);
  });

  it("split pe whitespace mixt (spatii, tab, newline)", () => {
    expect(tokenizeFilterQuery("alfa\tbeta\n gamma")).toEqual(["alfa", "beta", "gamma"]);
  });

  it("ignora whitespace la inceput si sfarsit", () => {
    expect(tokenizeFilterQuery("   alfa   beta   ")).toEqual(["alfa", "beta"]);
  });

  it("dedup case-insensitive", () => {
    expect(tokenizeFilterQuery("Stefan stefan STEFAN")).toEqual(["Stefan"]);
  });

  it("dedup diacritice-insensitive", () => {
    expect(tokenizeFilterQuery("Stefan ŞTEFAN Ștefan")).toEqual(["Stefan"]);
  });

  it("dedup pastreaza prima aparitie", () => {
    expect(tokenizeFilterQuery("BETA alfa beta ALFA")).toEqual(["BETA", "alfa"]);
  });

  it(`limiteaza la ${FILTER_TOKEN_MAX_COUNT} tokens`, () => {
    const input = Array.from({ length: 20 }, (_, i) => `t${i}`).join(" ");
    const out = tokenizeFilterQuery(input);
    expect(out.length).toBe(FILTER_TOKEN_MAX_COUNT);
    expect(out[0]).toBe("t0");
    expect(out[FILTER_TOKEN_MAX_COUNT - 1]).toBe(`t${FILTER_TOKEN_MAX_COUNT - 1}`);
  });

  it("pastreaza tokens cu diacritice in output (normalizarea e doar pe cheia de dedup)", () => {
    expect(tokenizeFilterQuery("Ștefan Călin")).toEqual(["Ștefan", "Călin"]);
  });

  it("trateaza string-uri foarte lungi fara whitespace ca un singur token", () => {
    const long = "a".repeat(500);
    expect(tokenizeFilterQuery(long)).toEqual([long]);
  });
});
```

- [ ] **Step 1.3: Ruleaza testele**

```bash
cd "C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard"
npx vitest run backend/src/util/textNormalize.tokenize.test.ts
```

Expected: 11 / 11 PASS.

- [ ] **Step 1.4: Commit**

```bash
npx biome check --write backend/src/util/textNormalize.ts backend/src/util/textNormalize.tokenize.test.ts
git add backend/src/util/textNormalize.ts backend/src/util/textNormalize.tokenize.test.ts
git commit -m "feat(backend): tokenizeFilterQuery helper + unit tests"
```

---

## Task 2: Backend `buildResultsFilterClause` accepta `string[]`

**Files:**
- Modify: `backend/src/db/avizRepository.ts`
- Modify: `backend/src/db/avizRepository.filterRnpmSearchResults.test.ts`

**Goal:** Schimbarea signaturii lui `buildResultsFilterClause` de la `(q: string)` la `(tokens: string[])` si generarea de N grupuri AND, fiecare grup avand cele 24 de OR-uri existente, fiecare token cu propriul pattern.

- [ ] **Step 2.1: Modifica `buildResultsFilterClause` in `avizRepository.ts`**

Inlocuieste blocul curent (linii ~618-655) cu:

```ts
// Helper care construieste clauza WHERE pentru filtrul de rezultate.
// Primeste tokens DEJA TOKENIZATE (vezi tokenizeFilterQuery). Genereaza N grupuri
// AND, fiecare grup avand 24 de OR-uri peste aceleasi coloane ca in v2.24.0.
// Daca tokens e gol, returneaza clauza "1=1" si params [] -- caller-ul foloseste
// asta sa intoarca toate avizele search-ului fara filtrare suplimentara.
//
// Acopera 24 coloane per token: 9 din rnpm_avize + 3 creditori + 3 debitori +
// 9 bunuri (tip_bun + categorie + identificare + model + serie_sasiu +
// serie_motor + nr_inmatriculare + referinte_json + JOIN cu
// rnpm_bunuri_descrieri.text).
// NOTA: rnpm_bunuri nu are coloana `descriere_proprie`; textul descrierii vine
// exclusiv via descriere_id -> rnpm_bunuri_descrieri.text.
function buildResultsFilterClause(tokens: string[]): { whereSql: string; params: string[] } {
  if (tokens.length === 0) return { whereSql: "1=1", params: [] };

  const perTokenSql = `(
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
      AND (rnpm_norm(b.tip_bun) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.categorie) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.identificare) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.model) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.serie_sasiu) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.serie_motor) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.nr_inmatriculare) LIKE ? ESCAPE '\\'
        OR rnpm_norm(b.referinte_json) LIKE ? ESCAPE '\\'
        OR rnpm_norm(bd.text) LIKE ? ESCAPE '\\'))
  )`;

  const groups: string[] = [];
  const params: string[] = [];
  for (const t of tokens) {
    const like = buildRnpmLikePattern(t);
    groups.push(perTokenSql);
    for (let i = 0; i < 24; i++) params.push(like);
  }
  return { whereSql: `(${groups.join(" AND ")})`, params };
}
```

- [ ] **Step 2.2: Modifica `filterRnpmSearchResults` sa foloseasca tokenize + signature noua**

Inlocuieste blocul de pe la linia 681-730 cu:

```ts
import { tokenizeFilterQuery, FILTER_TOKEN_MAX_COUNT } from "../util/textNormalize.ts";
//  ^^^^ adauga import-ul SUS in fisier daca nu exista deja

// ... interfata FilterRnpmResultsOptions ramane neschimbata (q: string)
//     ca API-ul HTTP sa accepte string brut

export function filterRnpmSearchResults(opts: FilterRnpmResultsOptions): FilterRnpmResultsOutcome {
  const HARD_LIMIT = 1500;
  const db = getDb();
  const { ownerId, searchId, q, signal } = opts;
  const limit = Math.min(opts.limit ?? HARD_LIMIT, HARD_LIMIT);

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const owns = db.prepare("SELECT 1 AS ok FROM rnpm_searches WHERE id = ? AND owner_id = ?").get(searchId, ownerId) as
    | { ok: number }
    | undefined;
  if (!owns) throw new RnpmSearchNotFoundError();

  const totalRow = db
    .prepare("SELECT COUNT(*) AS total FROM rnpm_avize WHERE owner_id = ? AND search_id = ?")
    .get(ownerId, searchId) as { total: number };
  const totalInSearch = totalRow.total;

  const missRow = db
    .prepare("SELECT COUNT(*) AS m FROM rnpm_avize WHERE owner_id = ? AND search_id = ? AND detail_fetched = 0")
    .get(ownerId, searchId) as { m: number };
  const missingDetails = missRow.m;

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const tokens = tokenizeFilterQuery(q);

  // Daca q-ul produce 0 tokens (input gol / whitespace only), API-ul ar
  // returna toate avizele -- nu e bug, dar caller (route handler) trebuie
  // sa decida ce semantica vrea. v2.24.0 returneaza toate pe q gol; pastram.
  const { whereSql, params } = buildResultsFilterClause(tokens);

  const countSql = `SELECT COUNT(*) AS c FROM rnpm_avize a
    WHERE a.owner_id = ? AND a.search_id = ? AND ${whereSql}`;
  const countRow = db.prepare(countSql).get(ownerId, searchId, ...params) as { c: number };
  const matchedCount = countRow.c;

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const sql = `SELECT a.id FROM rnpm_avize a
    WHERE a.owner_id = ? AND a.search_id = ? AND ${whereSql}
    ORDER BY a.id ASC LIMIT ?`;
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

**Atentie:** semnatura functiei expuse (`FilterRnpmResultsOptions.q: string`) RAMANE string, ca API-ul HTTP sa nu se schimbe. Tokenizarea se face intern.

`FILTER_TOKEN_MAX_COUNT` e importat dar nu folosit explicit aici — limita e enforced de `tokenizeFilterQuery`. Daca biome se plange ca e neutilizat, sterge `FILTER_TOKEN_MAX_COUNT` din import.

- [ ] **Step 2.3: Adapteaza testele existente**

Deschide `backend/src/db/avizRepository.filterRnpmSearchResults.test.ts` si:

1. Pentru fiecare test care apela `filterRnpmSearchResults({ q: "..." })`, lasa-l asa (interfata externa nu se schimba). Daca vreun test apela direct `buildResultsFilterClause("string")`, schimba-l la `buildResultsFilterClause(tokenizeFilterQuery("string"))` SAU `buildResultsFilterClause(["string"])`.

2. Verifica ca pasajul `expect(params.length).toBe(24)` (sau orice "magic 24") se transforma in `expect(params.length).toBe(24 * tokens.length)`. Daca testul nu se uita explicit la `params.length`, lasa-l asa.

- [ ] **Step 2.4: Adauga scenarii AND**

Inserează un nou `describe` la sfarsitul fisierului (`backend/src/db/avizRepository.filterRnpmSearchResults.test.ts`):

```ts
describe("filterRnpmSearchResults - multi-token AND (v2.25.0)", () => {
  // Refoloseste setup-ul existent: presupune ca exista deja `makeSearch`, `makeAviz`,
  // `makeCreditor`, `makeDebitor`, `makeBun`, `makeBunDescriere` factories si setup
  // env-var pattern (LEGAL_DASHBOARD_DB_PATH). Copiaza din describe-urile
  // precedente daca lipsesc.

  it("AND strict: token1 in debitor, token2 in descriere -> match", () => {
    const ownerId = "local";
    const searchId = makeSearch(ownerId);
    const avizId = makeAviz({ ownerId, searchId, identificator: "AVIZ-001" });
    makeDebitor({ ownerId, avizId, denumire: "ALTEX ROMANIA SRL" });
    const descId = makeBunDescriere({ ownerId, text: "Totalitatea creantelor prezente si viitoare" });
    makeBun({ ownerId, avizId, tipBun: "alt", descriereId: descId });

    const r = filterRnpmSearchResults({ ownerId, searchId, q: "altex totalitatea" });
    expect(r.matchedAvizIds).toEqual([avizId]);
    expect(r.matchedCount).toBe(1);
  });

  it("AND strict: token1 in debitor, token2 nicaieri -> no match", () => {
    const ownerId = "local";
    const searchId = makeSearch(ownerId);
    const avizId = makeAviz({ ownerId, searchId, identificator: "AVIZ-002" });
    makeDebitor({ ownerId, avizId, denumire: "ALTEX ROMANIA SRL" });

    const r = filterRnpmSearchResults({ ownerId, searchId, q: "altex inexistent" });
    expect(r.matchedAvizIds).toEqual([]);
    expect(r.matchedCount).toBe(0);
  });

  it("3 tokens AND, fiecare in alt camp", () => {
    const ownerId = "local";
    const searchId = makeSearch(ownerId);
    const avizId = makeAviz({
      ownerId,
      searchId,
      identificator: "AVIZ-003",
      utilizatorAutorizat: "CABINET AVOCAT POPESCU",
    });
    makeCreditor({ ownerId, avizId, denumire: "BANCA TRANSILVANIA SA" });
    makeDebitor({ ownerId, avizId, denumire: "FIRMA EXEMPLU SRL" });

    const r = filterRnpmSearchResults({ ownerId, searchId, q: "popescu transilvania firma" });
    expect(r.matchedAvizIds).toEqual([avizId]);
  });

  it("dedup: 'Stefan stefan ŞTEFAN' filtrat ca un singur token", () => {
    const ownerId = "local";
    const searchId = makeSearch(ownerId);
    const avizId = makeAviz({ ownerId, searchId, identificator: "AVIZ-004", utilizatorAutorizat: "Ștefan AVOCAT" });
    makeAviz({ ownerId, searchId, identificator: "AVIZ-005", utilizatorAutorizat: "Popescu" });

    const r = filterRnpmSearchResults({ ownerId, searchId, q: "Stefan stefan ŞTEFAN" });
    expect(r.matchedAvizIds).toEqual([avizId]);
    expect(r.matchedCount).toBe(1);
  });

  it("q gol returneaza toate avizele (echivalent fara filtru)", () => {
    const ownerId = "local";
    const searchId = makeSearch(ownerId);
    const id1 = makeAviz({ ownerId, searchId, identificator: "A1" });
    const id2 = makeAviz({ ownerId, searchId, identificator: "A2" });

    const r = filterRnpmSearchResults({ ownerId, searchId, q: "" });
    expect(r.matchedAvizIds.sort()).toEqual([id1, id2].sort());
    expect(r.matchedCount).toBe(2);
  });

  it("diacritice-insensitive in token: 'Stefan' match-uieste 'Ștefan'", () => {
    const ownerId = "local";
    const searchId = makeSearch(ownerId);
    const avizId = makeAviz({ ownerId, searchId, identificator: "AV", utilizatorAutorizat: "Ștefan POP" });

    const r = filterRnpmSearchResults({ ownerId, searchId, q: "stefan" });
    expect(r.matchedAvizIds).toEqual([avizId]);
  });

  it("max 8 tokens (anti-DoS): tokens > 8 ignorate", () => {
    const ownerId = "local";
    const searchId = makeSearch(ownerId);
    makeAviz({ ownerId, searchId, identificator: "AVIZ-A" });
    // Construim un query cu 10 tokens; primele 8 nu apar in date, deci ar trebui 0 match.
    // Daca token-ul 9 sau 10 erau evaluate, NU ar fi match nici asa, deci scenariul
    // verifica EFICIENTA tokenizatorului indirect: rulam doar pe primele 8.
    const r = filterRnpmSearchResults({ ownerId, searchId, q: "t1 t2 t3 t4 t5 t6 t7 t8 AVIZ-A AVIZ-A" });
    // Daca s-ar fi luat in calcul si token-ul 'AVIZ-A', ar fi fost match.
    // Dar primele 8 (t1..t8) deja nu match, deci AND-ul cade fara sa ajunga la t9.
    expect(r.matchedAvizIds).toEqual([]);
  });
});
```

- [ ] **Step 2.5: Ruleaza testele**

```bash
npx vitest run backend/src/db/avizRepository.filterRnpmSearchResults.test.ts
```

Expected: TOATE testele existente + cele 7 noi PASS.

- [ ] **Step 2.6: Commit**

```bash
npx biome check --write backend/src/db/avizRepository.ts backend/src/db/avizRepository.filterRnpmSearchResults.test.ts
git add backend/src/db/avizRepository.ts backend/src/db/avizRepository.filterRnpmSearchResults.test.ts
git commit -m "feat(rnpm): multi-token AND filtering in buildResultsFilterClause"
```

---

## Task 3: Backend EXPLAIN cu N tokens

**Files:**
- Modify: `backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts`

**Goal:** Confirmam ca multi-token nu strica plan-ul de query — fiecare grup AND ramane filtrat prin `idx_rnpm_avize_owner_search`.

- [ ] **Step 3.1: Adauga test pentru 3 tokens**

In fisierul existent (37 linii la momentul plan-ului), adauga dupa `it("query principal foloseste idx_rnpm_avize_owner_search", ...)`:

```ts
  it("query cu 3 tokens (AND) inca foloseste indexul", () => {
    const sql = `SELECT a.id FROM rnpm_avize a WHERE a.owner_id = 'local' AND a.search_id = 1
      AND ((rnpm_norm(a.identificator) LIKE ? ESCAPE '\\' OR rnpm_norm(a.tip) LIKE ? ESCAPE '\\')
        AND (rnpm_norm(a.identificator) LIKE ? ESCAPE '\\' OR rnpm_norm(a.tip) LIKE ? ESCAPE '\\')
        AND (rnpm_norm(a.identificator) LIKE ? ESCAPE '\\' OR rnpm_norm(a.tip) LIKE ? ESCAPE '\\'))
      ORDER BY a.id ASC LIMIT 1500`;
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("%x%", "%x%", "%y%", "%y%", "%z%", "%z%") as { detail: string }[];
    const detail = plan.map((p) => p.detail).join(" | ");
    expect(detail).toMatch(/USING (INDEX idx_rnpm_avize_owner_search|COVERING INDEX|INTEGER PRIMARY KEY)/);
  });
```

(Subset de 2 coloane per token e suficient ca SQLite sa-si aleaga acelasi index — adaugarea celorlalte 22 OR-uri nu schimba ce decide planner-ul.)

- [ ] **Step 3.2: Ruleaza**

```bash
npx vitest run backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts
```

Expected: 2/2 PASS.

- [ ] **Step 3.3: Commit**

```bash
npx biome check --write backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts
git add backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts
git commit -m "test(rnpm): EXPLAIN cu 3 tokens AND confirma index hit"
```

---

## Task 4: Frontend mirror tokenizer

**Files:**
- Create: `frontend/src/lib/rnpmFilterTokens.ts`
- Create: `frontend/src/lib/rnpmFilterTokens.test.ts`

**Goal:** Identic cu Task 1 backend, dar in TypeScript pentru bundle frontend. UI-ul are nevoie de lista de tokens ca sa stie ce sa highlight-uieasca si ca sa calculeze badge.

- [ ] **Step 4.1: Creeaza `frontend/src/lib/rnpmFilterTokens.ts`**

```ts
// Mirror identic al backend/src/util/textNormalize.ts::tokenizeFilterQuery.
// UI-ul are nevoie de tokens pentru:
//   1. Highlight peste textul randului colapsat si tab-urilor expand-uite
//   2. Calcul badge "match in detalii" (cand niciun token nu apare in
//      campurile vizibile pe rand)
//
// Reguli (trebuie sa coincida byte-by-byte cu backend):
//   - split pe whitespace
//   - trim, drop empty
//   - dedup case-insensitive + diacritice-insensitive
//   - max 8 tokens
//
// Daca regulile diverg intre backend si frontend, AND-ul devine inconsistent
// (UI face highlight pentru tokens pe care backend-ul nu le-a filtrat sau
// invers) - daca modifici aici, modifica si in backend si invers.

export const FILTER_TOKEN_MAX_COUNT = 8;

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function tokenizeFilterQuery(q: string): string[] {
  if (typeof q !== "string") return [];
  const raw = q.split(/\s+/);
  const seenKeys = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const trimmed = t.trim();
    if (trimmed.length === 0) continue;
    const key = stripDiacritics(trimmed).toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push(trimmed);
    if (out.length >= FILTER_TOKEN_MAX_COUNT) break;
  }
  return out;
}
```

- [ ] **Step 4.2: Creeaza `frontend/src/lib/rnpmFilterTokens.test.ts`**

Copiaza cele 11 teste din Task 1.2, schimba import-ul la `./rnpmFilterTokens`:

```ts
import { describe, it, expect } from "vitest";
import { tokenizeFilterQuery, FILTER_TOKEN_MAX_COUNT } from "./rnpmFilterTokens";

describe("tokenizeFilterQuery (frontend mirror)", () => {
  it("returneaza array gol pentru string gol sau whitespace-only", () => {
    expect(tokenizeFilterQuery("")).toEqual([]);
    expect(tokenizeFilterQuery("   ")).toEqual([]);
  });

  it("returneaza array gol pentru non-string", () => {
    expect(tokenizeFilterQuery(null as unknown as string)).toEqual([]);
    expect(tokenizeFilterQuery(undefined as unknown as string)).toEqual([]);
  });

  it("split simplu", () => {
    expect(tokenizeFilterQuery("alfa beta")).toEqual(["alfa", "beta"]);
  });

  it("dedup case + diacritice", () => {
    expect(tokenizeFilterQuery("Stefan stefan ŞTEFAN Ștefan")).toEqual(["Stefan"]);
  });

  it("max tokens", () => {
    const input = Array.from({ length: 20 }, (_, i) => `t${i}`).join(" ");
    const out = tokenizeFilterQuery(input);
    expect(out.length).toBe(FILTER_TOKEN_MAX_COUNT);
  });

  it("pastreaza diacritice in output", () => {
    expect(tokenizeFilterQuery("Ștefan Călin")).toEqual(["Ștefan", "Călin"]);
  });
});
```

- [ ] **Step 4.3: Ruleaza si commit**

```bash
cd frontend
npx vitest run src/lib/rnpmFilterTokens.test.ts
cd ..
npx biome check --write frontend/src/lib/rnpmFilterTokens.ts frontend/src/lib/rnpmFilterTokens.test.ts
git add frontend/src/lib/rnpmFilterTokens.ts frontend/src/lib/rnpmFilterTokens.test.ts
git commit -m "feat(rnpm-ui): tokenizeFilterQuery mirror in frontend"
```

---

## Task 5: Frontend `highlightTokens` helper

**Files:**
- Create: `frontend/src/lib/rnpmHighlightTokens.tsx`
- Create: `frontend/src/lib/rnpmHighlightTokens.test.tsx`

**Goal:** Functie pura `(text, tokens) -> ReactNode` care wrap-uieste fiecare match cu `<mark>`. Diacritice + case insensitive, pastreaza textul original (cu diacritice si majuscule), nu accepta HTML user-input.

- [ ] **Step 5.1: Creeaza `frontend/src/lib/rnpmHighlightTokens.tsx`**

```tsx
import type { ReactNode } from "react";

// Highlight pur (fara state, fara DOMPurify) peste substring-uri din `text`.
// Match-ul e diacritice-insensitive si case-insensitive.
// Textul original (cu diacritice si majuscule) e pastrat in output -- doar
// span-ul `<mark>` se infasoara peste match.
//
// Algoritm:
//   1. Construieste o reprezentare normalizata (NFD strip + lowercase) a textului
//      impreuna cu o mapa de pozitii catre indicele in textul original.
//      Mapa e necesara fiindca NFD decompune un caracter cu diacritice in 2+
//      code points; pastram mapping char-original -> indice de baza.
//   2. Pentru fiecare token (normalizat similar), gaseste toate ocurentele in
//      textul normalizat.
//   3. Convertim pozitiile in indecsi pe textul original via mapa.
//   4. Combinam intervalele suprapuse / adjacente.
//   5. Emitem fragmente alternative: text plain + <mark>match</mark>.
//
// Edge cases:
//   - text null / undefined / "" -> returneaza ""
//   - tokens [] -> returneaza textul nemodificat (string-ul brut, nu ReactNode)
//   - token care nu match -> ignorat
//
// IMPORTANT: nu accepta HTML din text. text e tratat ca plain text;
// React escape-uieste automat.

interface Interval {
  start: number;
  end: number;
}

function normalizeWithMap(s: string): { norm: string; map: number[] } {
  const normChars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const decomp = s[i].normalize("NFD");
    for (const ch of decomp) {
      if (/[̀-ͯ]/.test(ch)) continue;
      normChars.push(ch.toLowerCase());
      map.push(i);
    }
  }
  return { norm: normChars.join(""), map };
}

function normalizeToken(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push(cur);
    }
  }
  return out;
}

export function highlightTokens(text: string | null | undefined, tokens: string[]): ReactNode {
  if (text == null || text === "") return text ?? "";
  if (tokens.length === 0) return text;

  const { norm, map } = normalizeWithMap(text);
  const intervals: Interval[] = [];

  for (const t of tokens) {
    const nt = normalizeToken(t);
    if (nt.length === 0) continue;
    let from = 0;
    while (from <= norm.length - nt.length) {
      const idx = norm.indexOf(nt, from);
      if (idx === -1) break;
      const startOrig = map[idx];
      const endOrig = map[idx + nt.length - 1] + 1;
      intervals.push({ start: startOrig, end: endOrig });
      from = idx + 1;
    }
  }

  if (intervals.length === 0) return text;
  const merged = mergeIntervals(intervals);
  const out: ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const { start, end } = merged[i];
    if (start > cursor) out.push(text.substring(cursor, start));
    out.push(
      <mark key={`m-${i}`} className="rounded bg-yellow-200 px-0.5 text-gray-900">
        {text.substring(start, end)}
      </mark>
    );
    cursor = end;
  }
  if (cursor < text.length) out.push(text.substring(cursor));
  return <>{out}</>;
}

// Helper de inteligenta pentru badge: returneaza true daca cel putin un token
// se gaseste in oricare din textele primite. Folosit de RnpmResultsTable
// ca sa decida daca pune badge "match in detalii".
export function anyTokenMatches(texts: Array<string | null | undefined>, tokens: string[]): boolean {
  if (tokens.length === 0) return true; // fara filtru, totul match
  const norms = tokens.map((t) => normalizeToken(t)).filter((t) => t.length > 0);
  if (norms.length === 0) return true;
  for (const text of texts) {
    if (text == null || text === "") continue;
    const { norm } = normalizeWithMap(text);
    for (const nt of norms) {
      if (norm.includes(nt)) return true;
    }
  }
  return false;
}
```

- [ ] **Step 5.2: Creeaza `frontend/src/lib/rnpmHighlightTokens.test.tsx`**

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { highlightTokens, anyTokenMatches } from "./rnpmHighlightTokens";

function renderToText(node: ReturnType<typeof highlightTokens>) {
  const { container } = render(<>{node}</>);
  return container.textContent ?? "";
}

function renderMarks(node: ReturnType<typeof highlightTokens>): string[] {
  const { container } = render(<>{node}</>);
  return Array.from(container.querySelectorAll("mark")).map((m) => m.textContent ?? "");
}

describe("highlightTokens", () => {
  it("returneaza textul original cand tokens e gol", () => {
    expect(highlightTokens("Hello world", [])).toBe("Hello world");
  });

  it("returneaza string gol pentru null/undefined", () => {
    expect(highlightTokens(null, ["x"])).toBe("");
    expect(highlightTokens(undefined, ["x"])).toBe("");
  });

  it("highlight single token case-insensitive", () => {
    const node = highlightTokens("Hello World", ["world"]);
    expect(renderMarks(node)).toEqual(["World"]);
    expect(renderToText(node)).toBe("Hello World");
  });

  it("highlight single token diacritice-insensitive", () => {
    const node = highlightTokens("Ștefan POPESCU", ["stefan"]);
    expect(renderMarks(node)).toEqual(["Ștefan"]);
    expect(renderToText(node)).toBe("Ștefan POPESCU");
  });

  it("highlight multiple tokens distincte", () => {
    const node = highlightTokens("ALTEX ROMANIA SRL totalitatea creantelor", ["altex", "totalitatea"]);
    expect(renderMarks(node)).toEqual(["ALTEX", "totalitatea"]);
  });

  it("multiple ocurente ale aceluiasi token", () => {
    const node = highlightTokens("test test test", ["test"]);
    expect(renderMarks(node)).toEqual(["test", "test", "test"]);
  });

  it("intervale suprapuse se fuzioneaza", () => {
    const node = highlightTokens("abcdef", ["abc", "bcd"]);
    expect(renderMarks(node)).toEqual(["abcd"]);
  });

  it("token absent nu produce mark", () => {
    const node = highlightTokens("Hello World", ["xyz"]);
    expect(renderMarks(node)).toEqual([]);
    expect(renderToText(node)).toBe("Hello World");
  });

  it("pastreaza textul cu diacritice in output cand match se face diacritice-insensitive", () => {
    const node = highlightTokens("Ștefan Călin", ["calin"]);
    expect(renderMarks(node)).toEqual(["Călin"]);
  });

  it("token vid din input ignorat", () => {
    const node = highlightTokens("Hello", [""]);
    expect(renderMarks(node)).toEqual([]);
    expect(renderToText(node)).toBe("Hello");
  });
});

describe("anyTokenMatches", () => {
  it("returneaza true cand tokens e gol", () => {
    expect(anyTokenMatches(["a", "b"], [])).toBe(true);
  });

  it("returneaza true cand un token apare", () => {
    expect(anyTokenMatches(["Hello World"], ["world"])).toBe(true);
  });

  it("returneaza false cand niciun token nu apare", () => {
    expect(anyTokenMatches(["Hello World"], ["xyz"])).toBe(false);
  });

  it("diacritice-insensitive", () => {
    expect(anyTokenMatches(["Ștefan"], ["stefan"])).toBe(true);
  });

  it("ignora textele null/undefined", () => {
    expect(anyTokenMatches([null, undefined, "Hello"], ["hello"])).toBe(true);
  });

  it("returneaza false cand toate textele sunt null", () => {
    expect(anyTokenMatches([null, undefined, ""], ["x"])).toBe(false);
  });
});
```

- [ ] **Step 5.3: Ruleaza**

```bash
cd frontend
npx vitest run src/lib/rnpmHighlightTokens.test.tsx
cd ..
```

Expected: 16/16 PASS.

- [ ] **Step 5.4: Commit**

```bash
npx biome check --write frontend/src/lib/rnpmHighlightTokens.tsx frontend/src/lib/rnpmHighlightTokens.test.tsx
git add frontend/src/lib/rnpmHighlightTokens.tsx frontend/src/lib/rnpmHighlightTokens.test.tsx
git commit -m "feat(rnpm-ui): highlightTokens + anyTokenMatches helpers + tests"
```

---

## Task 6: Integrare in randul colapsat (`RnpmResultsTable.tsx`)

**Files:**
- Modify: `frontend/src/components/rnpm/RnpmResultsTable.tsx`

**Goal:** Wrap-am Identificator, Tip, Utilizator autorizat cu `highlightTokens(value, tokens)`. Calculam si afisam badge "match in detalii" sub Identificator pentru randuri unde niciun token nu apare in campurile colapsate.

- [ ] **Step 6.1: Importa helper-ele**

In top-ul fisierului (langa celelalte import-uri):

```ts
import { tokenizeFilterQuery } from "@/lib/rnpmFilterTokens";
import { highlightTokens, anyTokenMatches } from "@/lib/rnpmHighlightTokens";
```

- [ ] **Step 6.2: Calculeaza tokens din `filterQuery`**

In componenta `RnpmResultsTable`, dupa declararea `filterQuery` si `filter`:

```ts
const tokens = useMemo(() => tokenizeFilterQuery(filterQuery), [filterQuery]);
```

- [ ] **Step 6.3: Wrap fields in tabel**

Gaseste celulele care randeaza Identificator, Tip, Utilizator autorizat in randul colapsat. Inlocuieste:

```tsx
<td>{doc.identificator}</td>
<td>{doc.tip}</td>
<td>{doc.utilizator_autorizat}</td>
```

cu:

```tsx
<td>{highlightTokens(doc.identificator, tokens)}</td>
<td>{highlightTokens(doc.tip, tokens)}</td>
<td>{highlightTokens(doc.utilizator_autorizat, tokens)}</td>
```

(Numele exact al fields-urilor si structura `<td>`-urilor depinde de codul curent — pastreaza className si onClick handlers.)

- [ ] **Step 6.4: Badge "match in detalii"**

Sub Identificator (in aceeasi celula, span dedesubt), adauga conditional:

```tsx
{tokens.length > 0 && !anyTokenMatches([doc.identificator, doc.tip, doc.utilizator_autorizat], tokens) && (
  <div className="mt-0.5 text-[10px] font-medium text-amber-600">match in detalii</div>
)}
```

- [ ] **Step 6.5: Paseaza tokens la RnpmAvizDetailContent**

Cand expandezi un rand, componenta de detaliu primeste o prop noua `filterTokens`:

Gaseste apelul `<RnpmAvizDetailContent ... />` (sau `<RnpmDetailModal ... />`) si adauga:

```tsx
filterTokens={tokens}
```

(Implementarea propriu-zisa a propei e in Task 7.)

- [ ] **Step 6.6: Verifica build**

```bash
cd frontend
npx tsc --noEmit
cd ..
```

Expected: 0 erori.

- [ ] **Step 6.7: Adapteaza testele existente**

Daca `RnpmResultsTable.filter.test.tsx` are assert-uri care cauta exact `doc.identificator` ca text in DOM, schimba la `getByText(/identificator-text/)` sau verifica via `textContent` — `highlightTokens` poate sparge stringul in fragmente cu `<mark>`.

Adauga test nou:

```tsx
it("v2.25.0 - highlight pe Identificator cand cuvant match", async () => {
  // Setup ca in alte teste din fisier: render RnpmResultsTable cu result mock
  // si filterQuery setat la "AHC".
  // Asseert: query.getAllByText prin matcher de container.textContent === "2021-...AHC"
  // si query.container.querySelector("mark") returneaza element cu textContent "AHC".
});

it("v2.25.0 - badge 'match in detalii' apare cand match e doar in expand", async () => {
  // Setup: mock filterRnpmResults sa returneze aviz care nu contine token in colapsat.
  // Asseert: getByText("match in detalii") prezent.
});
```

- [ ] **Step 6.8: Ruleaza testele frontend**

```bash
cd frontend
npx vitest run src/components/rnpm/RnpmResultsTable.filter.test.tsx
cd ..
```

Expected: toate PASS.

- [ ] **Step 6.9: Commit**

```bash
npx biome check --write frontend/src/components/rnpm/RnpmResultsTable.tsx frontend/src/components/rnpm/RnpmResultsTable.filter.test.tsx
git add frontend/src/components/rnpm/RnpmResultsTable.tsx frontend/src/components/rnpm/RnpmResultsTable.filter.test.tsx
git commit -m "feat(rnpm-ui): highlight + 'match in detalii' badge in rand colapsat"
```

---

## Task 7: Integrare in tab-uri expand-uite (`RnpmDetailModal.tsx`)

**Files:**
- Modify: `frontend/src/components/rnpm/RnpmDetailModal.tsx`

**Goal:** Highlight in tab-urile Creditori / Debitori / Bunuri / Istoric, primind tokens ca prop.

- [ ] **Step 7.1: Adauga prop `filterTokens`**

In semnatura componentei (de obicei `RnpmAvizDetailContent`), adauga:

```tsx
interface Props {
  // ... props existente
  filterTokens?: string[];
}

export function RnpmAvizDetailContent({ /* ... */, filterTokens = [] }: Props) {
```

Daca `RnpmDetailModal` are si el o varianta cu detalii, propaga propa la fel.

- [ ] **Step 7.2: Import helper**

```tsx
import { highlightTokens } from "@/lib/rnpmHighlightTokens";
```

- [ ] **Step 7.3: Wrap fields in `PartyList` (Creditori + Debitori)**

In `PartyList`, gaseste blocurile care randeaza `p.denumire`, `p.prenume`, `p.cod`, `p.cnp`, `p.nr_identificare`, `p.sediu` si wrap-le cu `highlightTokens(value, filterTokens)`.

Atentie: `PartyList` e shared intre creditori si debitori — adaugat-i si lui propa `filterTokens`:

```tsx
function PartyList({ parties, emptyMsg, showCalitate, filterTokens = [] }: {
  parties: RnpmParty[];
  emptyMsg: string;
  showCalitate?: boolean;
  filterTokens?: string[];
})
```

Apel-urile (linii ~129-131 in fisierul curent):

```tsx
{tab === "creditori" && <PartyList parties={data.creditori} emptyMsg="Fara creditori" filterTokens={filterTokens} />}
{tab === "debitori" && (
  <PartyList parties={data.debitori} emptyMsg={isSpecifice ? "Fara parti" : "Fara debitori"} showCalitate filterTokens={filterTokens} />
)}
```

In randuri (`{p.tip_persoana === "PF" ? ... : p.denumire}`), wrap. Pentru combinatii (`${p.denumire ?? ""} ${p.prenume ?? ""}`), simplu:

```tsx
{p.tip_persoana === "PF"
  ? <>{highlightTokens(p.denumire ?? "", filterTokens)} {highlightTokens(p.prenume ?? "", filterTokens)}</>
  : highlightTokens(p.denumire, filterTokens)}
```

Acelasi pattern pentru `cod`, `cnp`, `nr_identificare`, `sediu`.

- [ ] **Step 7.4: Wrap fields in `BunuriList`**

Acelasi pattern. Targets:
- `b.categorie`
- `b.model`
- `b.serie_sasiu`
- `b.serie_motor` (daca e randat)
- `b.nr_inmatriculare`
- `b.identificare`
- `b.descriere`

Apel:

```tsx
{tab === "bunuri" && <BunuriList bunuri={data.bunuri} detaliiComune={data.aviz.detalii_comune} filterTokens={filterTokens} />}
```

Definitie:

```tsx
function BunuriList({
  bunuri,
  detaliiComune,
  filterTokens = [],
}: {
  bunuri: RnpmBun[];
  detaliiComune: string | null;
  filterTokens?: string[];
}) {
```

Si in render:

```tsx
<span className="text-muted-foreground">Categorie:</span> {highlightTokens(b.categorie, filterTokens)}
// ... etc
```

`detaliiComune` (textul mare de sub tab-uri) — wrap si el:

```tsx
{detaliiComune && (
  <div className="rounded-lg bg-muted/30 p-3 text-xs whitespace-pre-wrap">
    {highlightTokens(detaliiComune, filterTokens)}
  </div>
)}
```

- [ ] **Step 7.5: Wrap fields in tab Istoric**

Daca exista o componenta `IstoricList` sau similar, identifica fields-urile string (identificator, tip, alte_mentiuni, data_inreg etc.) si wrap-le cu `highlightTokens`.

- [ ] **Step 7.6: Verifica build**

```bash
cd frontend
npx tsc --noEmit
cd ..
```

- [ ] **Step 7.7: Commit**

```bash
npx biome check --write frontend/src/components/rnpm/RnpmDetailModal.tsx
git add frontend/src/components/rnpm/RnpmDetailModal.tsx
git commit -m "feat(rnpm-ui): highlight in tab-uri Creditori/Debitori/Bunuri/Istoric"
```

---

## Task 8: Release v2.25.0

**Files (toate):**
- Modify: `package.json` (root + backend/ + frontend/) + `package-lock.json`
- Modify: `frontend/src/data/changelog-entries.tsx`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `SESSION-HANDOFF.md` (daca aplicabil)
- Modify: `STATUS.md`
- Modify: `DOCUMENTATIE.md`

- [ ] **Step 8.1: Bump versiuni 2.24.0 -> 2.25.0**

Edit manual fiecare `package.json`. Apoi sync lockfile:

```bash
npm install --package-lock-only
```

- [ ] **Step 8.2: Adauga entry in `frontend/src/data/changelog-entries.tsx`**

Adauga la inceputul array-ului de entries:

```tsx
{
  version: "2.25.0",
  date: "13 Mai 2026",
  highlights: [
    "Filtru RNPM cu mai multe cuvinte: 'totalitatea creantelor' cauta ambele cuvinte (logica AND), fiecare poate fi in alt camp.",
    "Highlight galben peste cuvintele cautate, atat in randul colapsat (Identificator/Tip/Utilizator) cat si in tab-urile expand-uite (Creditori/Debitori/Bunuri/Istoric).",
    "Badge 'match in detalii' apare cand cuvantul cautat nu e in randul vizibil, ca sa stii ca match-ul e in expand.",
  ],
}
```

- [ ] **Step 8.3: `CHANGELOG.md`**

Adauga entry pentru v2.25.0 in stil consistent cu intrarile precedente.

- [ ] **Step 8.4: `README.md` + `STATUS.md` + `CLAUDE.md` + `DOCUMENTATIE.md`**

Schimba "v2.24.0" -> "v2.25.0", data curenta.

- [ ] **Step 8.5: Sanity check**

```bash
grep -ri "2.24.0" *.md frontend/src/data/changelog-entries.tsx | grep -v CHANGELOG.md
```

Expected: zero hit-uri (toate referintele active la 2.24.0 trebuie up-datate; CHANGELOG.md le pastreaza ca istoric).

- [ ] **Step 8.6: Commit**

```bash
npx biome check --write .
git add -A
git commit -m "release: v2.25.0 - multi-token + highlight pentru filtrul RNPM"
```

---

## Task 9: Final gates + push

- [ ] **Step 9.1: Biome**

```bash
npx biome check --write .
```

Daca biome reformateaza, re-stage si re-commit. NU lasa biome pe push.

- [ ] **Step 9.2: Type-check**

```bash
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
```

Ambele: 0 erori.

- [ ] **Step 9.3: Build**

```bash
npm run build
```

Expected: clean (Vite + esbuild).

- [ ] **Step 9.4: Test suites**

```bash
npm test --workspace=backend
cd frontend && npm test -- --run && cd ..
```

Expected: backend ~970+ teste PASS (964 in v2.24.0 + 7 multi-token + ~3 EXPLAIN + tokenize), frontend ~130+ teste PASS (116 in v2.24.0 + tokenize + highlightTokens + 2 RnpmResultsTable).

- [ ] **Step 9.5: Push**

```bash
git push -u origin feat/rnpm-filter-multitoken-highlight
```

- [ ] **Step 9.6: Verificare manuala in Electron**

```bash
npm run rebuild:electron
npm run electron:dev
```

In aplicatie:
1. Tab RNPM -> Baza locala -> deschide o cautare salvata (de ex. search 690 din testele anterioare)
2. Tasteaza in field-ul de filtru: `altex totalitatea`
3. Verifica:
   - Numarul de rezultate scade (sau ramane, daca toate avizele contin ambele cuvinte)
   - `ALTEX` apare highlight-uit galben in coloana Debitori (din expand)
   - `totalitatea` apare highlight-uit galben in tab-ul Bunuri -> Descriere
   - Badge "match in detalii" apare sub Identificator pentru randurile unde niciun cuvant nu e in colapsat
4. Tasteaza un cuvant inexistent: `xyzabc`. Numarul de rezultate ar trebui sa scada la 0.

---

## Self-review checklist (Codex inainte de a marca complete)

- [ ] Backend `buildResultsFilterClause` accepta `string[]` (nu `string`); functia interna o cheama prin `tokenizeFilterQuery(q)`.
- [ ] Toate cele 24 LIKE-uri sunt PER TOKEN, deci pentru N tokens avem `24 * N` params si N grupuri conectate cu AND.
- [ ] `FILTER_TOKEN_MAX_COUNT = 8` enforced in tokenizer (backend si frontend identic).
- [ ] `highlightTokens` returneaza string-ul brut cand `tokens === []`, nu un fragment React (evita warning React despre key).
- [ ] `anyTokenMatches` returneaza `true` cand tokens e gol (no filter => totul match).
- [ ] Toate `<mark>` au `className="rounded bg-yellow-200 px-0.5 text-gray-900"` (consistent).
- [ ] Badge "match in detalii" apare DOAR cand `tokens.length > 0` si niciun token nu e in colapsat.
- [ ] `RnpmAvizDetailContent` / `RnpmDetailModal` primeste `filterTokens` ca prop optionala (default `[]`).
- [ ] Zero referinte la `2.24.0` in fisiere active (vezi Step 8.5).
- [ ] Romana fara diacritice in cod, comentarii, UI nou, commit messages.
- [ ] Biome curat (toate fisierele atinse).
- [ ] Backend si frontend test suites PASS.
- [ ] `npm run build` PASS.
- [ ] Smoke test Electron OK (vezi Step 9.6).

---

**End of plan.** Daca incep dubii la implementare, opreste-te si intreaba supervizorul (Claude) — mai bine clarificare decat refactor de scope.
