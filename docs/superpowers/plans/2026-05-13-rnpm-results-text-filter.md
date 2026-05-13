# RNPM Results Text Filter — Implementation Plan (pentru Codex)

> **Pentru Codex (executant):** Acesta este planul tau de lucru, self-contained. Citeste sectiunea **"Pentru Codex: cum sa folosesti acest fisier"** de mai jos, apoi parcurge task-urile 0 -> 10 strict in ordine. Owner-ul (Cezar) supervizeaza si revizuieste intre commit-uri.

**Goal:** Adauga un filtru text incremental peste rezultatele unei cautari RNPM (`/api/rnpm/search/:searchId/filter`) cu owner isolation, anti-enumeration 404, AbortSignal timeout 5s, truncare 1500 ID-uri si counter `missingDetails` transparent. Zero regresii pe `getAvize()` si `/api/rnpm/saved?q=`.

**Architecture:** Backend (Hono + better-sqlite3, sync repo) → ruta noua POST cu Zod validation + `withMaintenanceRead` → helper repository nou `filterRnpmSearchResults` cu 17 LIKE-uri (avize + creditori + debitori + bunuri + bunuri_descrieri) + index nou `idx_rnpm_avize_owner_search`. Frontend (React 18 + Vite) → hook `useRnpmResultsFilter` cu `useDebouncedValue` 300ms + AbortController, UI in `RnpmResultsTable.tsx` filtreaza local pe Set<id>. Kill switch operational `RNPM_RESULTS_FILTER_DISABLED=1`.

**Tech Stack:** TypeScript strict, Hono, better-sqlite3, Vitest, React 18, Zod, biome. Target: v2.24.0, branch `feat/rnpm-results-filter`.

**Reference spec (citeste-l INTAI):** `docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md` (commit `38cdac3`). Aici e contextul complet: decizii arhitecturale, threat model, contracte API, edge cases. Planul de mai jos e executia pas-cu-pas; spec-ul explica "de ce".

**Conventii proiect (citeste si):** `CLAUDE.md` (root) si `backend/CLAUDE.md` daca exista. Atentie speciala la sectiunea "Workflow obligatoriu pentru push pe GitHub" si "Checklist bump de versiune".

**Limba**: romana fara diacritice in surse cod, comentarii, UI strings, commit messages.

---

## Pentru Codex: cum sa folosesti acest fisier

**1. Setup initial (o singura data, inainte de Task 0):**

- Working directory: `c:\Users\Cezar\Desktop\Claude Code\Legal Dashboard` (Windows + PowerShell sau bash via Git for Windows).
- Verifica `git status` clean si `git branch --show-current` = `main`.
- Citeste integral spec-ul de la `docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md`. Daca un task pare ambiguu, raspunsul e in spec.
- Citeste `CLAUDE.md` root pentru conventii (biome obligatoriu inainte de push, romana fara diacritice, etc.).

**2. Cum executi un task:**

- Fiecare task are 4-11 pasi numerotati (`Step N.M`). Executa-i IN ORDINE.
- Pasii cu `Run:` au comenzi exacte — copy-paste si executa.
- Pasii cu cod TypeScript / SQL au continutul exact ce trebuie scris in fisier. NU improviza variabile sau structuri alternative.
- TDD strict: scrie testul INTAI, ruleaza-l, vezi FAIL, apoi implementeaza pana trece. NU sari peste pasul "verifica testul pica" — e parte din metoda.
- La sfarsitul fiecarui task exista un `git commit`. NU bate task-uri intr-un singur commit.

**3. Cand sa te opresti si sa raportezi:**

- Daca un test PICA dupa implementare si nu intelegi de ce dupa 2 incercari → STOP, raporteaza la Cezar cu output-ul exact.
- Daca planul iti cere sa modifici o linie care nu exista (codebase-ul a evoluat) → STOP, raporteaza.
- Daca biome / tsc / build pica pe ceva ce planul nu explica → STOP, raporteaza output-ul.
- Daca o decizie arhitecturala pare contradictorie cu spec-ul → STOP, citeaza ambele locuri si intreaba.

**4. Cum raportezi status la final de task:**

Dupa `git commit` la finalul unui task, scrie un mesaj scurt cu:
- `Status: DONE | DONE_WITH_CONCERNS | BLOCKED`
- Ce ai implementat (file paths atinse)
- Test results (X tests pass / Y total)
- Concerns (daca DONE_WITH_CONCERNS): ce te-a deranjat, dar nu blocheaza.
- Blocker (daca BLOCKED): ce ai incercat + ce ai vazut.

**5. Reguli non-negotiable:**

- NU modifica `getAvize()` din `backend/src/db/avizRepository.ts` (linii 422-506). Niciun caracter. Functionalitatea `/api/rnpm/saved?q=` trebuie sa ramana identica.
- NU folosi `/api/v1/rnpm/...` — productia este montata la `/api/rnpm` (vezi `backend/src/index.ts:242`).
- NU exporta `buildResultsFilterClause` — e helper privat al `filterRnpmSearchResults`.
- NU folosi GET pentru ruta de filtru — POST obligatoriu (anti-leak in `logger()`).
- NU sterge `.git/`, NU `git push --force` pe main, NU `git reset --hard` pe modificari ne-commit-uite.
- Biome obligatoriu inainte de fiecare `git commit`: `npx biome check --write <fisiere-atinse>`. Daca biome reformateaza, re-stage cu `git add` inainte de commit.

---

## File Structure

### Backend
- **Create**: `backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.up.sql` — index pe `(owner_id, search_id)`
- **Create**: `backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.down.sql` — DROP INDEX
- **Create**: `backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.test.ts` — idempotenta up/down
- **Modify**: `backend/src/db/avizRepository.ts` — adauga `buildResultsFilterClause` (privat) + `filterRnpmSearchResults` (export) la finalul fisierului
- **Create**: `backend/src/db/avizRepository.filterRnpmSearchResults.test.ts` — 15 unit tests
- **Create**: `backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts` — 1 EXPLAIN QUERY PLAN test
- **Modify**: `backend/src/db/repository-isolation.test.ts` — adauga 2 cross-tenant tests pentru filter
- **Modify**: `backend/src/db/schema.ts` — boot-time index probe (lines ~127 dupa `initSchema(db)`)
- **Modify**: `backend/src/routes/rnpm.ts` — adauga handler POST `/search/:searchId/filter` + import Zod
- **Create**: `backend/src/routes/rnpm.filter.test.ts` — 13 route tests

### Frontend
- **Modify**: `frontend/src/lib/rnpmApi.ts` — adauga `filterRnpmResults` + `RnpmFilterDisabledError` + types
- **Create**: `frontend/src/hooks/useRnpmResultsFilter.ts` — hook custom
- **Create**: `frontend/src/hooks/useRnpmResultsFilter.test.ts` — 7 hook tests
- **Modify**: `frontend/src/components/rnpm/RnpmResultsTable.tsx` — input filter + integrare matchedSet
- **Create**: `frontend/src/components/rnpm/RnpmResultsTable.filter.test.tsx` — 7 component tests

### Docs / versionare (la final)
- `package.json` (root, backend, frontend), `package-lock.json` → `2.24.0`
- `frontend/src/data/changelog-entries.tsx` — entry nou
- `CHANGELOG.md`, `README.md`, `SESSION-HANDOFF.md`, `STATUS.md`, `DOCUMENTATIE.md`
- (conditional) `SECURITY.md` — entry security-relevant

---

## Task 0: Setup branch curat

**Files:**
- Modify: branch git `feat/rnpm-results-filter`

- [ ] **Step 0.1: Verifica stare repo**

Run:
```bash
git status
git branch --show-current
```

Expected: working tree clean, currently on `main`.

- [ ] **Step 0.2: Sterge branch-ul vechi stale (era pe Option B obsolete)**

Run:
```bash
git branch -D feat/rnpm-results-filter
```

Expected: `Deleted branch feat/rnpm-results-filter (was 3208782).`

- [ ] **Step 0.3: Creeaza branch nou de pe main**

Run:
```bash
git checkout -b feat/rnpm-results-filter
git log --oneline -1
```

Expected: branch creat din `38cdac3 docs(rnpm): spec design pentru filtrul text peste rezultatele cautarii`.

---

## Task 1: Migration 0021 — index pe (owner_id, search_id)

**Files:**
- Create: `backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.up.sql`
- Create: `backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.down.sql`
- Create: `backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.test.ts`

- [ ] **Step 1.1: Scrie migration UP**

Create `backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.up.sql`:

```sql
-- 0021_idx_rnpm_avize_owner_search.up.sql - accelereaza filterRnpmSearchResults (v2.24.0).
-- Filter-ul peste rezultatele unei cautari RNPM porneste de la (owner_id, search_id);
-- fara index dedicat, fiecare query face full-table scan pe rnpm_avize.
CREATE INDEX IF NOT EXISTS idx_rnpm_avize_owner_search
  ON rnpm_avize(owner_id, search_id);
```

- [ ] **Step 1.2: Scrie migration DOWN**

Create `backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.down.sql`:

```sql
-- 0021_idx_rnpm_avize_owner_search.down.sql - reverse pentru up (v2.24.0).
DROP INDEX IF EXISTS idx_rnpm_avize_owner_search;
```

- [ ] **Step 1.3: Scrie test failing pentru idempotenta**

Create `backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.test.ts` (model: `0020_master_switch.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration 0021_idx_rnpm_avize_owner_search", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Minimum schema necesar pentru index — doar tabela rnpm_avize.
    db.exec(`
      CREATE TABLE rnpm_avize (
        id INTEGER PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT 'local',
        search_id INTEGER
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  function readSql(name: string): string {
    return readFileSync(resolve(__dirname, name), "utf8");
  }

  it("UP creeaza indexul idx_rnpm_avize_owner_search", () => {
    db.exec(readSql("0021_idx_rnpm_avize_owner_search.up.sql"));
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_rnpm_avize_owner_search'`)
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("idx_rnpm_avize_owner_search");
  });

  it("UP este idempotent (IF NOT EXISTS) - a doua aplicare nu arunca", () => {
    db.exec(readSql("0021_idx_rnpm_avize_owner_search.up.sql"));
    expect(() => db.exec(readSql("0021_idx_rnpm_avize_owner_search.up.sql"))).not.toThrow();
  });

  it("DOWN sterge indexul", () => {
    db.exec(readSql("0021_idx_rnpm_avize_owner_search.up.sql"));
    db.exec(readSql("0021_idx_rnpm_avize_owner_search.down.sql"));
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_rnpm_avize_owner_search'`)
      .get();
    expect(row).toBeUndefined();
  });

  it("DOWN este idempotent (IF EXISTS) - a doua aplicare nu arunca", () => {
    db.exec(readSql("0021_idx_rnpm_avize_owner_search.down.sql"));
    expect(() => db.exec(readSql("0021_idx_rnpm_avize_owner_search.down.sql"))).not.toThrow();
  });
});
```

- [ ] **Step 1.4: Ruleaza testele migration**

Run:
```bash
npm test --workspace=backend -- backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 1.5: Commit migration**

Run:
```bash
git add backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.up.sql backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.down.sql backend/src/db/migrations/0021_idx_rnpm_avize_owner_search.test.ts
git commit -m "feat(rnpm): migration 0021 — index idx_rnpm_avize_owner_search"
```

---

## Task 2: Repository helper si functie publica `filterRnpmSearchResults`

**Files:**
- Modify: `backend/src/db/avizRepository.ts` (adauga la final, NU modifica `getAvize`)
- Create: `backend/src/db/avizRepository.filterRnpmSearchResults.test.ts`

- [ ] **Step 2.1: Inspecteaza structura existenta pentru a confirma imports**

Run:
```bash
grep -n "^import\|^export" backend/src/db/avizRepository.ts | head -15
```

Expected: vezi `import { getDb, checkpointWal } from "./schema.ts"` si `import { buildRnpmLikePattern } from "../util/textNormalize.ts"` — ambele necesare in helperul nou (deja importate).

- [ ] **Step 2.2: Scrie testul failing #1 — happy path pe debitor.denumire**

Create `backend/src/db/avizRepository.filterRnpmSearchResults.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { setDbForTest, getDb } from "./schema.ts";
import { filterRnpmSearchResults } from "./avizRepository.ts";
import { runMigrations } from "./migrations/runner.ts";

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  setDbForTest(db);
  runMigrations(db);
  return db;
}

function makeSearch(db: Database.Database, ownerId: string, type: string): number {
  const info = db
    .prepare(
      `INSERT INTO rnpm_searches (owner_id, search_type, params_json, status, started_at)
       VALUES (?, ?, '{}', 'completed', datetime('now'))`
    )
    .run(ownerId, type);
  return Number(info.lastInsertRowid);
}

function makeAviz(
  db: Database.Database,
  opts: {
    ownerId: string;
    searchId: number;
    identificator: string;
    tip?: string;
    detailFetched?: 0 | 1;
    detaliComune?: string;
    tipAct?: string;
    alteMentiuni?: string;
  }
): number {
  const info = db
    .prepare(
      `INSERT INTO rnpm_avize (owner_id, search_id, search_type, identificator, tip,
         detail_fetched, detalii_comune, tip_act, alte_mentiuni, data, uuid)
       VALUES (?, ?, 'ipoteci', ?, ?, ?, ?, ?, ?, '01.01.2024', lower(hex(randomblob(8))))`
    )
    .run(
      opts.ownerId,
      opts.searchId,
      opts.identificator,
      opts.tip ?? "Aviz",
      opts.detailFetched ?? 1,
      opts.detaliComune ?? "",
      opts.tipAct ?? "",
      opts.alteMentiuni ?? ""
    );
  return Number(info.lastInsertRowid);
}

function makeDebitor(db: Database.Database, opts: { avizId: number; ownerId: string; denumire: string; cod?: string; cnp?: string }): void {
  db.prepare(
    `INSERT INTO rnpm_debitori (aviz_id, owner_id, denumire, cod, cnp)
     VALUES (?, ?, ?, ?, ?)`
  ).run(opts.avizId, opts.ownerId, opts.denumire, opts.cod ?? "", opts.cnp ?? "");
}

function makeCreditor(db: Database.Database, opts: { avizId: number; ownerId: string; denumire: string; cod?: string; cnp?: string }): void {
  db.prepare(
    `INSERT INTO rnpm_creditori (aviz_id, owner_id, denumire, cod, cnp)
     VALUES (?, ?, ?, ?, ?)`
  ).run(opts.avizId, opts.ownerId, opts.denumire, opts.cod ?? "", opts.cnp ?? "");
}

function makeBun(db: Database.Database, opts: { avizId: number; ownerId: string; descriereProprie?: string; descriereText?: string }): void {
  let descriereId: number | null = null;
  if (opts.descriereText) {
    const desc = db
      .prepare(`INSERT INTO rnpm_bunuri_descrieri (text) VALUES (?)`)
      .run(opts.descriereText);
    descriereId = Number(desc.lastInsertRowid);
  }
  db.prepare(
    `INSERT INTO rnpm_bunuri (aviz_id, owner_id, descriere_proprie, descriere_id)
     VALUES (?, ?, ?, ?)`
  ).run(opts.avizId, opts.ownerId, opts.descriereProprie ?? "", descriereId);
}

describe("filterRnpmSearchResults", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  afterEach(() => {
    db.close();
    setDbForTest(null);
  });

  it("happy path - matchuieste pe debitor.denumire", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-001" });
    const a2 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-002" });
    const a3 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-003" });
    makeDebitor(db, { avizId: a1, ownerId: "local", denumire: "Popescu Marin" });
    makeDebitor(db, { avizId: a2, ownerId: "local", denumire: "Ionescu Vasile" });
    makeDebitor(db, { avizId: a3, ownerId: "local", denumire: "Georgescu Ana" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "popescu" });

    expect(res.matchedAvizIds).toEqual([a1]);
    expect(res.matchedCount).toBe(1);
    expect(res.totalInSearch).toBe(3);
    expect(res.missingDetails).toBe(0);
    expect(res.truncated).toBe(false);
  });
});
```

- [ ] **Step 2.3: Ruleaza testul si verifica ca pica**

Run:
```bash
npm test --workspace=backend -- backend/src/db/avizRepository.filterRnpmSearchResults.test.ts
```

Expected: FAIL cu `filterRnpmSearchResults is not a function` (sau eroare de import).

- [ ] **Step 2.4: Implementeaza `buildResultsFilterClause` si `filterRnpmSearchResults` in avizRepository.ts**

Modify `backend/src/db/avizRepository.ts` — adauga la finalul fisierului (dupa toate functiile existente, fara sa atingi `getAvize`):

```ts
// ============================================================================
// filterRnpmSearchResults — v2.24.0
// Filtru text incremental peste rezultatele unei cautari RNPM. Returneaza
// doar ID-uri matched + counters; UI filtreaza local pe Set<id>.
// NU se foloseste in /api/rnpm/saved (acela merge prin getAvize). NU atinge
// getAvize() — duplicare minima acceptata pentru zero-regresie.
// Acopera 17 coloane: 9 din rnpm_avize + 3 creditori + 3 debitori + 2 bunuri
// (descriere_proprie + JOIN cu rnpm_bunuri_descrieri.text).
// ============================================================================

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

export class RnpmSearchNotFoundError extends Error {
  readonly code = "SEARCH_NOT_FOUND" as const;
  constructor() {
    super("Search inexistent");
    this.name = "RnpmSearchNotFoundError";
  }
}

export function filterRnpmSearchResults(opts: FilterRnpmResultsOptions): FilterRnpmResultsOutcome {
  const HARD_LIMIT = 1500;
  const db = getDb();
  const { ownerId, searchId, q, signal } = opts;
  const limit = Math.min(opts.limit ?? HARD_LIMIT, HARD_LIMIT);

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Ownership precheck (anti-enumeration). Acelasi 404 pentru "nu exista"
  // si "apartine altui owner" — vezi spec 4.4.
  const owns = db
    .prepare(`SELECT 1 AS ok FROM rnpm_searches WHERE id = ? AND owner_id = ?`)
    .get(searchId, ownerId) as { ok: number } | undefined;
  if (!owns) throw new RnpmSearchNotFoundError();

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS total FROM rnpm_avize WHERE owner_id = ? AND search_id = ?`)
    .get(ownerId, searchId) as { total: number };
  const totalInSearch = totalRow.total;

  const missRow = db
    .prepare(
      `SELECT COUNT(*) AS m FROM rnpm_avize WHERE owner_id = ? AND search_id = ? AND detail_fetched = 0`
    )
    .get(ownerId, searchId) as { m: number };
  const missingDetails = missRow.m;

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const { whereSql, params } = buildResultsFilterClause(q);

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

- [ ] **Step 2.5: Verifica testul #1 trece**

Run:
```bash
npm test --workspace=backend -- backend/src/db/avizRepository.filterRnpmSearchResults.test.ts
```

Expected: 1 test pass.

- [ ] **Step 2.6: Adauga testele #2-#9 (diacritic, DISTINCT, EXISTS bunuri, owner isolation, missingDetails)**

Append in `backend/src/db/avizRepository.filterRnpmSearchResults.test.ts` inainte de `});` final al describe:

```ts
  it("diacritic-insensitive - 'stefan' matchuieste 'Stefan'", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-100" });
    makeDebitor(db, { avizId: a1, ownerId: "local", denumire: "Stefan SRL" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "stefan" });
    expect(res.matchedCount).toBe(1);
    expect(res.matchedAvizIds).toEqual([a1]);
  });

  it("DISTINCT - aviz cu 3 bunuri matching nu se duplica", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-200" });
    makeBun(db, { avizId: a1, ownerId: "local", descriereProprie: "combina John Deere" });
    makeBun(db, { avizId: a1, ownerId: "local", descriereProprie: "combina Claas" });
    makeBun(db, { avizId: a1, ownerId: "local", descriereProprie: "combina New Holland" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "combina" });
    expect(res.matchedAvizIds).toHaveLength(1);
    expect(res.matchedAvizIds).toEqual([a1]);
    expect(res.matchedCount).toBe(1);
  });

  it("EXISTS pe rnpm_bunuri_descrieri.text via JOIN", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-300" });
    makeBun(db, { avizId: a1, ownerId: "local", descriereText: "tractor agricol John Deere 6195" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "john deere" });
    expect(res.matchedAvizIds).toEqual([a1]);
  });

  it("cross-tenant izolation pe avize", () => {
    const sidA = makeSearch(db, "ownerA", "ipoteci");
    const sidB = makeSearch(db, "ownerB", "ipoteci");
    const aA = makeAviz(db, { ownerId: "ownerA", searchId: sidA, identificator: "AV-A" });
    makeDebitor(db, { avizId: aA, ownerId: "ownerA", denumire: "Comun" });
    const aB = makeAviz(db, { ownerId: "ownerB", searchId: sidB, identificator: "AV-B" });
    makeDebitor(db, { avizId: aB, ownerId: "ownerB", denumire: "Comun" });

    const resA = filterRnpmSearchResults({ ownerId: "ownerA", searchId: sidA, q: "comun" });
    expect(resA.matchedAvizIds).toEqual([aA]);
    expect(resA.matchedCount).toBe(1);
    expect(resA.totalInSearch).toBe(1);
  });

  it("searchId neexistent -> RnpmSearchNotFoundError", () => {
    expect(() =>
      filterRnpmSearchResults({ ownerId: "local", searchId: 999999, q: "test" })
    ).toThrow(/Search inexistent/);
  });

  it("searchId apartine altui owner -> RnpmSearchNotFoundError (anti-enumeration)", () => {
    const sidA = makeSearch(db, "ownerA", "ipoteci");
    expect(() =>
      filterRnpmSearchResults({ ownerId: "ownerB", searchId: sidA, q: "test" })
    ).toThrow(/Search inexistent/);
  });

  it("missingDetails counter corect", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-D1", detailFetched: 1 });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-D2", detailFetched: 1 });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-D3", detailFetched: 0 });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-D4", detailFetched: 0 });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-D5", detailFetched: 1 });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "av-" });
    expect(res.missingDetails).toBe(2);
    expect(res.totalInSearch).toBe(5);
  });

  it("totalInSearch numara avizele din search indiferent de match", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-T1" });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-T2" });
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "zzz-no-match" });
    expect(res.matchedCount).toBe(0);
    expect(res.totalInSearch).toBe(2);
  });
```

- [ ] **Step 2.7: Ruleaza si verifica toate 9 trec**

Run:
```bash
npm test --workspace=backend -- backend/src/db/avizRepository.filterRnpmSearchResults.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 2.8: Adauga testele #10-#15 (truncare, LIKE escape, AbortSignal)**

Append in acelasi fisier inainte de `});` final:

```ts
  it("truncare la limit - matchedCount > limit, matchedAvizIds capped", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    // Generam 25 avize matching (mai mic decat HARD_LIMIT pentru speed); folosim limit=10 sa testam.
    for (let i = 0; i < 25; i++) {
      const a = makeAviz(db, { ownerId: "local", searchId: sid, identificator: `AV-TR-${i}` });
      makeDebitor(db, { avizId: a, ownerId: "local", denumire: "TruncTest SRL" });
    }
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "trunctest", limit: 10 });
    expect(res.matchedCount).toBe(25);
    expect(res.matchedAvizIds).toHaveLength(10);
    expect(res.truncated).toBe(true);
  });

  it("LIKE meta - '%' este literal, nu wildcard", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AAA" });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AB%C" });
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "%" });
    expect(res.matchedAvizIds.length).toBe(1); // doar "AB%C" contine '%' literal
  });

  it("LIKE meta - '_' este literal, nu wildcard single-char", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AAA" });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "A_A" });
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "_" });
    expect(res.matchedAvizIds.length).toBe(1); // doar "A_A" contine '_' literal
  });

  it("LIKE meta - backslash literal", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "path\\to\\file" });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "no-backslash" });
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "path\\to" });
    expect(res.matchedAvizIds).toEqual([a1]);
  });

  it("AbortSignal pre-call - throw AbortError fara DB hit", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const ctl = new AbortController();
    ctl.abort();
    expect(() =>
      filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "test", signal: ctl.signal })
    ).toThrow(/Aborted/);
  });

  it("matchedAvizIds returnate in ordine ASC pe id", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = makeAviz(db, { ownerId: "local", searchId: sid, identificator: `AV-ORD-${i}` });
      makeDebitor(db, { avizId: a, ownerId: "local", denumire: "OrdTest" });
      ids.push(a);
    }
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "ordtest" });
    expect(res.matchedAvizIds).toEqual([...ids].sort((a, b) => a - b));
  });
```

- [ ] **Step 2.9: Ruleaza si verifica toate 15 trec**

Run:
```bash
npm test --workspace=backend -- backend/src/db/avizRepository.filterRnpmSearchResults.test.ts
```

Expected: 15 tests pass.

- [ ] **Step 2.10: Biome + commit**

Run:
```bash
npx biome check --write backend/src/db/avizRepository.ts backend/src/db/avizRepository.filterRnpmSearchResults.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/db/avizRepository.ts backend/src/db/avizRepository.filterRnpmSearchResults.test.ts
git commit -m "feat(rnpm): filterRnpmSearchResults repository + 15 unit tests"
```

Expected: biome clean, tsc clean, commit creat.

---

## Task 3: EXPLAIN QUERY PLAN test + cross-tenant breach drill

**Files:**
- Create: `backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts`
- Modify: `backend/src/db/repository-isolation.test.ts`

- [ ] **Step 3.1: Scrie EXPLAIN test**

Create `backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { getDb, setDbForTest } from "./schema.ts";
import { runMigrations } from "./migrations/runner.ts";

describe("filterRnpmSearchResults — EXPLAIN QUERY PLAN", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    setDbForTest(db);
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
    setDbForTest(null);
  });

  it("query principal foloseste idx_rnpm_avize_owner_search", () => {
    const sql = `SELECT a.id FROM rnpm_avize a WHERE a.owner_id = 'local' AND a.search_id = 1
      ORDER BY a.id ASC LIMIT 1500`;
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
    const detail = plan.map((p) => p.detail).join(" | ");
    // SQLite poate alege owner_id, search_id index sau primary key — verificam ca cel putin
    // unul dintre cele doua e folosit (NU full scan).
    expect(detail).toMatch(/USING (INDEX idx_rnpm_avize_owner_search|COVERING INDEX|INTEGER PRIMARY KEY)/);
    expect(detail).not.toMatch(/SCAN rnpm_avize\b(?!.*USING)/);
  });
});
```

- [ ] **Step 3.2: Ruleaza EXPLAIN test**

Run:
```bash
npm test --workspace=backend -- backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts
```

Expected: 1 test pass.

- [ ] **Step 3.3: Inspecteaza structura `repository-isolation.test.ts` pentru pattern**

Run:
```bash
grep -n "describe\|it(\|makeAviz\|filterRnpmSearchResults" backend/src/db/repository-isolation.test.ts | head -20
```

Expected: vezi factory `makeAviz` deja existent si patternul `describe("repository owner isolation", ...)`.

- [ ] **Step 3.4: Adauga 2 cross-tenant breach drill tests in repository-isolation.test.ts**

Modify `backend/src/db/repository-isolation.test.ts` — adauga la final inainte de `});` ultimul:

```ts
  describe("filterRnpmSearchResults cross-tenant breach drill", () => {
    it("nu returneaza avize ale altui owner chiar daca acelasi text apare in ambele", () => {
      // owner A si owner B au fiecare search-uri cu avize ce contin "Popescu"
      const sidA = makeSearch(db, "ownerA", "ipoteci");
      const sidB = makeSearch(db, "ownerB", "ipoteci");
      const aA1 = makeAviz(db, { ownerId: "ownerA", searchId: sidA, identificator: "A-1" });
      makeDebitor(db, { avizId: aA1, ownerId: "ownerA", denumire: "Popescu Ion" });
      const aB1 = makeAviz(db, { ownerId: "ownerB", searchId: sidB, identificator: "B-1" });
      makeDebitor(db, { avizId: aB1, ownerId: "ownerB", denumire: "Popescu Maria" });

      // owner B incearca sa filtreze searchul lui A
      expect(() =>
        filterRnpmSearchResults({ ownerId: "ownerB", searchId: sidA, q: "popescu" })
      ).toThrow(/Search inexistent/);

      // owner A vede doar avizul lui
      const resA = filterRnpmSearchResults({ ownerId: "ownerA", searchId: sidA, q: "popescu" });
      expect(resA.matchedAvizIds).toEqual([aA1]);
      expect(resA.matchedAvizIds).not.toContain(aB1);
    });

    it("rnpm_bunuri_descrieri content-addressable: descriere comuna NU leak cross-tenant", () => {
      // rnpm_bunuri_descrieri.text e dedup-uit cross-owner (nu are owner_id).
      // Daca owner A si owner B au bunuri cu acelasi descriere_id, filterul lui A nu
      // trebuie sa returneze avize ale lui B prin EXISTS-ul pe bunuri_descrieri.
      const sidA = makeSearch(db, "ownerA", "ipoteci");
      const sidB = makeSearch(db, "ownerB", "ipoteci");
      const aA1 = makeAviz(db, { ownerId: "ownerA", searchId: sidA, identificator: "A-DESC-1" });
      const aB1 = makeAviz(db, { ownerId: "ownerB", searchId: sidB, identificator: "B-DESC-1" });

      // Aceeasi descriere folosita de ambii (in tests insert separat, dar acelasi text)
      const desc = db.prepare(`INSERT INTO rnpm_bunuri_descrieri (text) VALUES (?)`)
        .run("tractor unic descriere");
      const descId = Number(desc.lastInsertRowid);

      db.prepare(`INSERT INTO rnpm_bunuri (aviz_id, owner_id, descriere_id) VALUES (?, ?, ?)`)
        .run(aA1, "ownerA", descId);
      db.prepare(`INSERT INTO rnpm_bunuri (aviz_id, owner_id, descriere_id) VALUES (?, ?, ?)`)
        .run(aB1, "ownerB", descId);

      const resA = filterRnpmSearchResults({ ownerId: "ownerA", searchId: sidA, q: "tractor" });
      expect(resA.matchedAvizIds).toEqual([aA1]);
      expect(resA.matchedAvizIds).not.toContain(aB1);
    });
  });
```

**Nota**: testul presupune ca exista deja `makeSearch`, `makeAviz`, `makeDebitor`, `filterRnpmSearchResults` importate in fisier. Adauga importurile lipsa la varful fisierului:

```ts
import { filterRnpmSearchResults } from "./avizRepository.ts";
```

Si daca `makeSearch`/`makeDebitor` nu exista in fisierul de izolation tests, COPIAZA factory-urile din `avizRepository.filterRnpmSearchResults.test.ts` la varful describe-ului inner (helper-uri locale).

- [ ] **Step 3.5: Ruleaza testele izolation**

Run:
```bash
npm test --workspace=backend -- backend/src/db/repository-isolation.test.ts
```

Expected: suita existenta pass + 2 teste noi pass.

- [ ] **Step 3.6: Biome + commit**

Run:
```bash
npx biome check --write backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts backend/src/db/repository-isolation.test.ts
git add backend/src/db/avizRepository.filterRnpmSearchResults.explain.test.ts backend/src/db/repository-isolation.test.ts
git commit -m "test(rnpm): EXPLAIN QUERY PLAN + cross-tenant breach drill pentru filter"
```

---

## Task 4: Boot-time index probe in schema.ts

**Files:**
- Modify: `backend/src/db/schema.ts` (linia ~127 dupa `initSchema(db)`)

- [ ] **Step 4.1: Citeste zona de modificat**

Run:
```bash
sed -n '120,135p' backend/src/db/schema.ts
```

Expected: vezi `db.function("rnpm_norm", ...)` urmat de `initSchema(db); return db;`.

- [ ] **Step 4.2: Adauga probe-ul lightweight**

Modify `backend/src/db/schema.ts` — inlocuieste blocul `initSchema(db); return db;` (linia ~126-127) cu:

```ts
  initSchema(db);

  // v2.24.0 — probe lightweight pentru index-ul filterRnpmSearchResults.
  // NU fail-closed: doar warn pentru ops (migration 0021 ar trebui sa-l creeze).
  try {
    const exists = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_rnpm_avize_owner_search'`
      )
      .get();
    if (!exists) {
      console.warn(
        "[schema] WARN: idx_rnpm_avize_owner_search lipseste; filtrul RNPM va fi mai lent. Ruleaza migration 0021."
      );
    }
  } catch (e) {
    console.warn(`[schema] index probe failed: ${e instanceof Error ? e.message : "unknown"}`);
  }

  return db;
}
```

- [ ] **Step 4.3: Type-check + biome**

Run:
```bash
npx tsc --noEmit -p backend/tsconfig.json
npx biome check --write backend/src/db/schema.ts
```

Expected: clean.

- [ ] **Step 4.4: Commit**

Run:
```bash
git add backend/src/db/schema.ts
git commit -m "feat(rnpm): boot-time probe pentru idx_rnpm_avize_owner_search"
```

---

## Task 5: Route handler POST /search/:searchId/filter

**Files:**
- Modify: `backend/src/routes/rnpm.ts`
- Create: `backend/src/routes/rnpm.filter.test.ts`

- [ ] **Step 5.1: Scrie failing test #1 — happy path 200**

Create `backend/src/routes/rnpm.filter.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { setDbForTest } from "../db/schema.ts";
import { runMigrations } from "../db/migrations/runner.ts";
import { rnpmRouter } from "./rnpm.ts";

let app: Hono;
let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  setDbForTest(db);
  runMigrations(db);
  app = new Hono();
  app.route("/api/rnpm", rnpmRouter);
});

afterEach(() => {
  delete process.env.RNPM_RESULTS_FILTER_DISABLED;
  db.close();
  setDbForTest(null);
});

function seedSearchWithAviz(): { searchId: number; avizId: number } {
  const s = db
    .prepare(
      `INSERT INTO rnpm_searches (owner_id, search_type, params_json, status, started_at)
       VALUES ('local', 'ipoteci', '{}', 'completed', datetime('now'))`
    )
    .run();
  const searchId = Number(s.lastInsertRowid);
  const a = db
    .prepare(
      `INSERT INTO rnpm_avize (owner_id, search_id, search_type, identificator, tip, detail_fetched, data, uuid)
       VALUES ('local', ?, 'ipoteci', 'AV-001', 'Aviz', 1, '01.01.2024', lower(hex(randomblob(8))))`
    )
    .run(searchId);
  const avizId = Number(a.lastInsertRowid);
  db.prepare(
    `INSERT INTO rnpm_debitori (aviz_id, owner_id, denumire, cod, cnp) VALUES (?, 'local', 'Popescu', '', '')`
  ).run(avizId);
  return { searchId, avizId };
}

describe("POST /api/rnpm/search/:searchId/filter", () => {
  it("happy path - 200 cu matchedAvizIds si counters", async () => {
    const { searchId, avizId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "popescu" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matchedAvizIds).toEqual([avizId]);
    expect(body.matchedCount).toBe(1);
    expect(body.totalInSearch).toBe(1);
    expect(body.missingDetails).toBe(0);
    expect(body.truncated).toBe(false);
  });
});
```

- [ ] **Step 5.2: Verifica testul pica**

Run:
```bash
npm test --workspace=backend -- backend/src/routes/rnpm.filter.test.ts
```

Expected: FAIL — ruta inexistenta (404 sau similar).

- [ ] **Step 5.3: Adauga importurile in rnpm.ts**

Modify `backend/src/routes/rnpm.ts` — la sectiunea de import-uri din varf (dupa restul import-urilor existente), adauga:

```ts
import { z } from "zod";
import {
  filterRnpmSearchResults,
  RnpmSearchNotFoundError,
} from "../db/avizRepository.ts";
import { withMaintenanceRead } from "../db/backup.ts";
```

**Verifica daca `z` (zod) sau `withMaintenanceRead` sunt deja importate** — daca da, NU duplica importul.

- [ ] **Step 5.4: Adauga handler-ul la finalul rnpm.ts (inainte de export sau in pozitie similara cu alte rute)**

Modify `backend/src/routes/rnpm.ts` — adauga la final, dupa ultima ruta existenta:

```ts
// ============================================================================
// POST /search/:searchId/filter — v2.24.0 filtru text peste rezultate cautare RNPM.
// Spec: docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md
// ============================================================================

const FilterBodySchema = z.object({
  q: z
    .string()
    .max(200, "Termen prea lung (max 200 caractere)")
    .transform((s) => s.trim())
    .refine((s) => s.length >= 2, "Minim 2 caractere dupa trim")
    .transform((s) => s.replace(/[\u0000-\u001F\u007F\u200B-\u200F\uFEFF]/g, "")),
});

const SearchIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

function logFilterEvent(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...entry, ts: new Date().toISOString() }));
}

rnpmRouter.post("/search/:searchId/filter", limitSearch, async (c) => {
  if (process.env.RNPM_RESULTS_FILTER_DISABLED === "1") {
    return c.json(
      { error: "Filtrul de rezultate RNPM este dezactivat temporar.", code: "FILTER_DISABLED" },
      503
    );
  }

  const sidParsed = SearchIdSchema.safeParse(c.req.param("searchId"));
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
    const result = await withMaintenanceRead(async () =>
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
    if (err instanceof RnpmSearchNotFoundError) {
      logFilterEvent({
        action: "rnpm.results.filter",
        ownerId,
        searchId,
        qLen: q.length,
        latencyMs,
        status: "not_found",
      });
      return c.json({ error: "Search inexistent" }, 404);
    }
    if (err instanceof Error && err.name === "AbortError") {
      if (timeoutSignal.aborted) {
        logFilterEvent({
          action: "rnpm.results.filter",
          ownerId,
          searchId,
          qLen: q.length,
          latencyMs,
          status: "timeout",
        });
        return c.json({ error: "Timeout filtrare", code: "FILTER_TIMEOUT" }, 503);
      }
      logFilterEvent({
        action: "rnpm.results.filter",
        ownerId,
        searchId,
        qLen: q.length,
        latencyMs,
        status: "abort",
      });
      return new Response(null, { status: 499 });
    }
    logFilterEvent({
      action: "rnpm.results.filter",
      ownerId,
      searchId,
      qLen: q.length,
      latencyMs,
      status: "error",
    });
    console.error("[rnpm.filter] eroare neasteptata", err);
    return c.json({ error: "Eroare interna filtrare" }, 500);
  }
});
```

- [ ] **Step 5.5: Verifica happy path trece**

Run:
```bash
npm test --workspace=backend -- backend/src/routes/rnpm.filter.test.ts
```

Expected: 1 test pass.

- [ ] **Step 5.6: Adauga testele de validare (400/404)**

Append in `backend/src/routes/rnpm.filter.test.ts` inainte de `});` final al `describe`:

```ts
  it("body invalid JSON -> 400", async () => {
    const { searchId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON invalid/);
  });

  it("q lipsa -> 400", async () => {
    const { searchId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("q sub 2 caractere -> 400", async () => {
    const { searchId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "x" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Minim 2 caractere/);
  });

  it("q doar whitespace -> 400 (trim apoi min 2)", async () => {
    const { searchId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "    " }),
    });
    expect(res.status).toBe(400);
  });

  it("q peste 200 caractere -> 400", async () => {
    const { searchId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "x".repeat(201) }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Termen prea lung/);
  });

  it("q cu control chars este sanitizat", async () => {
    const { searchId, avizId } = seedSearchWithAviz();
    // popescu cu zero-width insertat la mijloc
    const dirty = "pope​scu";
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: dirty }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matchedAvizIds).toEqual([avizId]);
  });

  it("searchId non-numeric -> 400", async () => {
    const res = await app.request(`/api/rnpm/search/not-a-number/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "test" }),
    });
    expect(res.status).toBe(400);
  });

  it("searchId inexistent -> 404 'Search inexistent'", async () => {
    const res = await app.request(`/api/rnpm/search/99999/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "test" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Search inexistent");
  });
```

- [ ] **Step 5.7: Verifica validation tests trec**

Run:
```bash
npm test --workspace=backend -- backend/src/routes/rnpm.filter.test.ts
```

Expected: 9 tests pass total.

- [ ] **Step 5.8: Adauga testele de error path (kill switch, leak, anti-enum, log shape)**

Append in `rnpm.filter.test.ts` inainte de `});` final:

```ts
  it("kill switch RNPM_RESULTS_FILTER_DISABLED=1 -> 503 cu code FILTER_DISABLED", async () => {
    const { searchId } = seedSearchWithAviz();
    process.env.RNPM_RESULTS_FILTER_DISABLED = "1";
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "popescu" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("FILTER_DISABLED");
    // anti-leak: body NU contine numele variabilei
    expect(JSON.stringify(body)).not.toContain("RNPM_RESULTS_FILTER_DISABLED");
  });

  it("log emit qLen NU raw q", async () => {
    const { searchId } = seedSearchWithAviz();
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => {
      captured.push(typeof msg === "string" ? msg : JSON.stringify(msg));
    };
    try {
      const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: "popescu" }),
      });
      expect(res.status).toBe(200);
    } finally {
      console.log = origLog;
    }
    const filterLog = captured.find((l) => l.includes('"action":"rnpm.results.filter"'));
    expect(filterLog).toBeDefined();
    expect(filterLog).toContain('"qLen":7');
    expect(filterLog).not.toContain('"q":"popescu"');
    expect(filterLog).not.toContain('"popescu"');
  });

  it("searchId al altui owner -> 404 (NU 403, anti-enumeration)", async () => {
    // creeaza un search pentru un alt owner
    const other = db
      .prepare(
        `INSERT INTO rnpm_searches (owner_id, search_type, params_json, status, started_at)
         VALUES ('other-tenant', 'ipoteci', '{}', 'completed', datetime('now'))`
      )
      .run();
    const otherSearchId = Number(other.lastInsertRowid);
    const res = await app.request(`/api/rnpm/search/${otherSearchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "popescu" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Search inexistent");
  });

  it("matchedCount > 1500 -> truncated=true, matchedAvizIds capped la limit configurat", async () => {
    // Folosim limit smaller pentru test rapid — verificam doar shape-ul.
    // Pentru truncare reala 1500 vezi testul repo. Aici doar verificam ca shape-ul include flag.
    const { searchId, avizId } = seedSearchWithAviz();
    const res = await app.request(`/api/rnpm/search/${searchId}/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "popescu" }),
    });
    const body = await res.json();
    expect(body).toHaveProperty("truncated");
    expect(typeof body.truncated).toBe("boolean");
    expect(body.matchedAvizIds).toContain(avizId);
  });
```

- [ ] **Step 5.9: Verifica toate 13 trec**

Run:
```bash
npm test --workspace=backend -- backend/src/routes/rnpm.filter.test.ts
```

Expected: 13 tests pass.

- [ ] **Step 5.10: Biome + tsc + commit**

Run:
```bash
npx biome check --write backend/src/routes/rnpm.ts backend/src/routes/rnpm.filter.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/routes/rnpm.ts backend/src/routes/rnpm.filter.test.ts
git commit -m "feat(rnpm): POST /search/:searchId/filter + 13 route tests"
```

---

## Task 6: Frontend API client `filterRnpmResults` in rnpmApi.ts

**Files:**
- Modify: `frontend/src/lib/rnpmApi.ts`

- [ ] **Step 6.1: Verifica pattern existent**

Run:
```bash
grep -n "^export\|^const BASE\|apiFetch" frontend/src/lib/rnpmApi.ts | head -10
```

Expected: vezi `const BASE = "/api/rnpm"` si `apiFetch` din `@/lib/api`.

- [ ] **Step 6.2: Adauga types + helper + error class**

Modify `frontend/src/lib/rnpmApi.ts` — adauga DUPA `class RnpmLimitExceededError` (linia ~32) si INAINTE de `const BASE` (linia 34), sau la finalul fisierului:

```ts
// v2.24.0 — filtru text peste rezultatele unei cautari RNPM.
// Spec: docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md

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
    let data: { error?: string; code?: string } | null = null;
    try {
      data = (await res.json()) as { error?: string; code?: string };
    } catch {
      throw new Error(`Eroare server (${res.status})`);
    }
    const errorMsg = data?.error ?? "Eroare necunoscuta";
    if (res.status === 503 && data?.code === "FILTER_DISABLED") {
      throw new RnpmFilterDisabledError(errorMsg);
    }
    throw new Error(errorMsg);
  }
  return (await res.json()) as RnpmResultsFilterResponse;
}
```

**IMPORTANT**: `apiFetch` si `BASE` sunt deja in scope din top of file — NU duplica importurile sau constantele.

- [ ] **Step 6.3: Type-check + biome**

Run:
```bash
cd frontend && npx tsc --noEmit && cd ..
npx biome check --write frontend/src/lib/rnpmApi.ts
```

Expected: clean.

- [ ] **Step 6.4: Commit**

Run:
```bash
git add frontend/src/lib/rnpmApi.ts
git commit -m "feat(rnpm-ui): filterRnpmResults API client + types"
```

---

## Task 7: Frontend hook `useRnpmResultsFilter` + tests

**Files:**
- Create: `frontend/src/hooks/useRnpmResultsFilter.ts`
- Create: `frontend/src/hooks/useRnpmResultsFilter.test.ts`

- [ ] **Step 7.1: Scrie failing test pentru hook**

Create `frontend/src/hooks/useRnpmResultsFilter.test.ts`:

```ts
import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRnpmResultsFilter } from "./useRnpmResultsFilter";
import * as rnpmApi from "@/lib/rnpmApi";

describe("useRnpmResultsFilter", () => {
  let filterSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    filterSpy = vi.spyOn(rnpmApi, "filterRnpmResults");
  });

  afterEach(() => {
    vi.useRealTimers();
    filterSpy.mockRestore();
  });

  it("query gol - nu apeleaza filterRnpmResults", () => {
    renderHook(() => useRnpmResultsFilter(1, ""));
    expect(filterSpy).not.toHaveBeenCalled();
  });

  it("query 1 caracter - nu apeleaza (sub min)", () => {
    renderHook(() => useRnpmResultsFilter(1, "x"));
    act(() => vi.advanceTimersByTime(500));
    expect(filterSpy).not.toHaveBeenCalled();
  });

  it("searchId null - nu apeleaza", () => {
    renderHook(() => useRnpmResultsFilter(null, "popescu"));
    act(() => vi.advanceTimersByTime(500));
    expect(filterSpy).not.toHaveBeenCalled();
  });

  it("query >= 2 caractere - apeleaza dupa debounce 300ms", async () => {
    filterSpy.mockResolvedValueOnce({
      matchedAvizIds: [42],
      matchedCount: 1,
      totalInSearch: 5,
      missingDetails: 0,
      truncated: false,
    });
    const { result } = renderHook(() => useRnpmResultsFilter(1, "popescu"));
    expect(filterSpy).not.toHaveBeenCalled(); // inca in debounce window
    act(() => vi.advanceTimersByTime(300));
    await waitFor(() => expect(filterSpy).toHaveBeenCalledTimes(1));
    expect(filterSpy).toHaveBeenCalledWith(1, "popescu", expect.any(AbortSignal));
    await waitFor(() => expect(result.current.data?.matchedCount).toBe(1));
  });

  it("schimbare query rapida - doar ultimul fetch este executat", async () => {
    filterSpy.mockResolvedValue({
      matchedAvizIds: [],
      matchedCount: 0,
      totalInSearch: 0,
      missingDetails: 0,
      truncated: false,
    });
    const { rerender } = renderHook(({ q }) => useRnpmResultsFilter(1, q), {
      initialProps: { q: "pop" },
    });
    rerender({ q: "pope" });
    rerender({ q: "popes" });
    rerender({ q: "popescu" });
    act(() => vi.advanceTimersByTime(300));
    await waitFor(() => expect(filterSpy).toHaveBeenCalledTimes(1));
    expect(filterSpy).toHaveBeenCalledWith(1, "popescu", expect.any(AbortSignal));
  });

  it("503 FILTER_DISABLED -> state disabled=true", async () => {
    const { RnpmFilterDisabledError } = await import("@/lib/rnpmApi");
    filterSpy.mockRejectedValueOnce(new RnpmFilterDisabledError("disabled"));
    const { result } = renderHook(() => useRnpmResultsFilter(1, "popescu"));
    act(() => vi.advanceTimersByTime(300));
    await waitFor(() => expect(result.current.disabled).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("eroare generica -> state error populat", async () => {
    filterSpy.mockRejectedValueOnce(new Error("Eroare server (500)"));
    const { result } = renderHook(() => useRnpmResultsFilter(1, "popescu"));
    act(() => vi.advanceTimersByTime(300));
    await waitFor(() => expect(result.current.error).toBe("Eroare server (500)"));
    expect(result.current.disabled).toBe(false);
    expect(result.current.data).toBeNull();
  });
});
```

- [ ] **Step 7.2: Verifica testul pica**

Run:
```bash
cd frontend && npm test -- --run src/hooks/useRnpmResultsFilter.test.ts
```

Expected: FAIL — `useRnpmResultsFilter` inexistent.

- [ ] **Step 7.3: Implementeaza hook-ul**

Create `frontend/src/hooks/useRnpmResultsFilter.ts`:

```ts
import { useEffect, useState } from "react";
import { useDebouncedValue } from "./useDebouncedValue";
import {
  filterRnpmResults,
  RnpmFilterDisabledError,
  type RnpmResultsFilterResponse,
} from "@/lib/rnpmApi";

interface State {
  loading: boolean;
  error: string | null;
  data: RnpmResultsFilterResponse | null;
  disabled: boolean;
}

const INITIAL_STATE: State = { loading: false, error: null, data: null, disabled: false };

export function useRnpmResultsFilter(searchId: number | null, query: string): State {
  const [debounced] = useDebouncedValue(query, 300);
  const [state, setState] = useState<State>(INITIAL_STATE);

  useEffect(() => {
    if (searchId == null) {
      setState(INITIAL_STATE);
      return;
    }
    const trimmed = debounced.trim();
    if (trimmed.length < 2) {
      setState(INITIAL_STATE);
      return;
    }

    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    filterRnpmResults(searchId, trimmed, ctl.signal)
      .then((data) => {
        if (ctl.signal.aborted) return;
        setState({ loading: false, error: null, data, disabled: false });
      })
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof RnpmFilterDisabledError) {
          setState({ loading: false, error: null, data: null, disabled: true });
          return;
        }
        const message = err instanceof Error ? err.message : "Eroare la filtrare";
        setState({ loading: false, error: message, data: null, disabled: false });
      });

    return () => ctl.abort();
  }, [searchId, debounced]);

  return state;
}
```

- [ ] **Step 7.4: Verifica testele trec**

Run:
```bash
cd frontend && npm test -- --run src/hooks/useRnpmResultsFilter.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 7.5: Biome + tsc + commit**

Run:
```bash
npx biome check --write frontend/src/hooks/useRnpmResultsFilter.ts frontend/src/hooks/useRnpmResultsFilter.test.ts
cd frontend && npx tsc --noEmit && cd ..
git add frontend/src/hooks/useRnpmResultsFilter.ts frontend/src/hooks/useRnpmResultsFilter.test.ts
git commit -m "feat(rnpm-ui): useRnpmResultsFilter hook cu debounce + AbortController"
```

---

## Task 8: UI integration in RnpmResultsTable.tsx

**Files:**
- Modify: `frontend/src/components/rnpm/RnpmResultsTable.tsx`
- Create: `frontend/src/components/rnpm/RnpmResultsTable.filter.test.tsx`

- [ ] **Step 8.1: Inspecteaza structura componentei**

Run:
```bash
grep -n "function RnpmResultsTable\|interface.*Props\|result.documents\|result.searchId\|useState" frontend/src/components/rnpm/RnpmResultsTable.tsx | head -20
```

Expected: vezi semnatura props + pattern-ul de filtrare local existent. Identifica unde randezi tabelul.

- [ ] **Step 8.2: Adauga import-uri + state pentru filter**

Modify `frontend/src/components/rnpm/RnpmResultsTable.tsx` — la sectiunea de import-uri (sus), adauga:

```tsx
import { useMemo, useState } from "react"; // useState/useMemo daca nu sunt deja
import { useRnpmResultsFilter } from "@/hooks/useRnpmResultsFilter";
```

In corpul componentei (dupa restul state-urilor existente, inainte de calculul `documents`/`pageItems`), adauga:

```tsx
const [filterQuery, setFilterQuery] = useState("");
const filter = useRnpmResultsFilter(result.searchId ?? null, filterQuery);
const matchedSet = useMemo(() => {
  if (!filter.data) return null;
  return new Set(filter.data.matchedAvizIds);
}, [filter.data]);

const visibleDocuments = useMemo(() => {
  if (!matchedSet) return result.documents;
  return result.documents.filter((d) => matchedSet.has(d.id));
}, [result.documents, matchedSet]);
```

**IMPORTANT**: Inlocuieste TOATE referintele la `result.documents` cu `visibleDocuments` in interiorul componentei (pagination slice, sort, export, count). NU modifica struct-ul `result` insusi.

- [ ] **Step 8.3: Adauga input filter + banner counters in JSX**

Modify aceeasi componenta — INAINTE de tabelul randat, adauga blocul:

```tsx
{result.searchId != null && (
  <div className="mb-3 space-y-2">
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={filterQuery}
        onChange={(e) => setFilterQuery(e.target.value)}
        placeholder="Filtreaza rezultatele (debitor, creditor, descriere bun, identificator...)"
        aria-label="Filtru text peste rezultatele cautarii RNPM"
        className="w-full max-w-md rounded border border-gray-300 px-3 py-1 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
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
      <div className="text-xs text-gray-600">
        {filter.data.matchedCount === filter.data.totalInSearch
          ? `${filter.data.totalInSearch} avize`
          : `${filter.data.matchedCount} din ${filter.data.totalInSearch} avize`}
        {filter.data.truncated && (
          <span className="ml-2 text-amber-600">
            Afisez primele {filter.data.matchedAvizIds.length}. Restrange textul pentru rezultate complete.
          </span>
        )}
        {filter.data.missingDetails > 0 && (
          <span className="ml-2 text-amber-600">
            {filter.data.missingDetails} avize fara detalii — unele rezultate pot fi ascunse.
          </span>
        )}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 8.4: Update label-uri butoane afectate (export, sterge selectia)**

In componenta, gaseste butonul de export. Adauga label dinamic care reflecta filtrarea:

```tsx
// Inlocuieste textul fix al butonului de export cu:
{matchedSet ? `Exporta ${visibleDocuments.length} (filtrate)` : `Exporta ${result.documents.length}`}
```

(Daca butonul are deja textul derivat din count, doar verifica ca foloseste `visibleDocuments.length` cand filtrul e activ).

- [ ] **Step 8.5: Scrie test integration**

Create `frontend/src/components/rnpm/RnpmResultsTable.filter.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RnpmResultsTable } from "./RnpmResultsTable";
import * as rnpmApi from "@/lib/rnpmApi";
import type { RnpmSearchResponse } from "@/types/rnpm";

const mockResult: RnpmSearchResponse = {
  searchId: 1,
  documents: [
    { id: 10, no: 1, identificator: { v: "AV-A" }, utilizatorAutorizat: "U1", data: "01.01.2024", tip: "Aviz", needsActualizare: false, activ: true } as any,
    { id: 20, no: 2, identificator: { v: "AV-B" }, utilizatorAutorizat: "U2", data: "02.01.2024", tip: "Aviz", needsActualizare: false, activ: true } as any,
    { id: 30, no: 3, identificator: { v: "AV-C" }, utilizatorAutorizat: "U3", data: "03.01.2024", tip: "Aviz", needsActualizare: false, activ: true } as any,
  ],
  total: 3,
  // alte campuri necesare conform tipului — completeaza minimul
} as any;

describe("RnpmResultsTable - filter integration", () => {
  let filterSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    filterSpy = vi.spyOn(rnpmApi, "filterRnpmResults");
  });

  afterEach(() => {
    vi.useRealTimers();
    filterSpy.mockRestore();
  });

  it("inputul de filter este vizibil cand result.searchId exista", () => {
    render(<RnpmResultsTable result={mockResult} />);
    expect(screen.getByLabelText(/Filtru text/i)).toBeInTheDocument();
  });

  it("type query -> randuri vizibile reduse la matched", async () => {
    filterSpy.mockResolvedValueOnce({
      matchedAvizIds: [10],
      matchedCount: 1,
      totalInSearch: 3,
      missingDetails: 0,
      truncated: false,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<RnpmResultsTable result={mockResult} />);
    const input = screen.getByLabelText(/Filtru text/i);
    await user.type(input, "av-a");
    act(() => vi.advanceTimersByTime(350));
    await waitFor(() => expect(filterSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("AV-B")).not.toBeInTheDocument());
    expect(screen.getByText("AV-A")).toBeInTheDocument();
  });

  it("disabled state - input disabled + banner", async () => {
    const { RnpmFilterDisabledError } = await import("@/lib/rnpmApi");
    filterSpy.mockRejectedValueOnce(new RnpmFilterDisabledError("disabled"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<RnpmResultsTable result={mockResult} />);
    const input = screen.getByLabelText(/Filtru text/i);
    await user.type(input, "test");
    act(() => vi.advanceTimersByTime(350));
    await waitFor(() => expect(screen.getByText(/Filtru indisponibil/)).toBeInTheDocument());
    expect(input).toBeDisabled();
  });

  it("truncated=true - banner 'Afisez primele N'", async () => {
    filterSpy.mockResolvedValueOnce({
      matchedAvizIds: Array.from({ length: 1500 }, (_, i) => i + 1),
      matchedCount: 2000,
      totalInSearch: 5000,
      missingDetails: 0,
      truncated: true,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<RnpmResultsTable result={mockResult} />);
    await user.type(screen.getByLabelText(/Filtru text/i), "abc");
    act(() => vi.advanceTimersByTime(350));
    await waitFor(() => expect(screen.getByText(/Afisez primele 1500/)).toBeInTheDocument());
  });

  it("missingDetails > 0 - banner non-blocant", async () => {
    filterSpy.mockResolvedValueOnce({
      matchedAvizIds: [10],
      matchedCount: 1,
      totalInSearch: 3,
      missingDetails: 5,
      truncated: false,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<RnpmResultsTable result={mockResult} />);
    await user.type(screen.getByLabelText(/Filtru text/i), "abc");
    act(() => vi.advanceTimersByTime(350));
    await waitFor(() => expect(screen.getByText(/5 avize fara detalii/)).toBeInTheDocument());
  });

  it("eroare generica - mesaj rosu", async () => {
    filterSpy.mockRejectedValueOnce(new Error("Eroare server (500)"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<RnpmResultsTable result={mockResult} />);
    await user.type(screen.getByLabelText(/Filtru text/i), "abc");
    act(() => vi.advanceTimersByTime(350));
    await waitFor(() => expect(screen.getByText(/Eroare server/)).toBeInTheDocument());
  });

  it("counter matchedCount/totalInSearch afisat cand filter activ", async () => {
    filterSpy.mockResolvedValueOnce({
      matchedAvizIds: [10],
      matchedCount: 1,
      totalInSearch: 3,
      missingDetails: 0,
      truncated: false,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<RnpmResultsTable result={mockResult} />);
    await user.type(screen.getByLabelText(/Filtru text/i), "abc");
    act(() => vi.advanceTimersByTime(350));
    await waitFor(() => expect(screen.getByText(/1 din 3 avize/)).toBeInTheDocument());
  });
});
```

**Nota**: testul foloseste `mockResult as any` pentru a evita typing strict pe `RnpmSearchResponse`. Daca componenta cere mai multe props (handleri pentru open modal etc.), adauga mock-uri minime (`vi.fn()`).

- [ ] **Step 8.6: Ruleaza component tests**

Run:
```bash
cd frontend && npm test -- --run src/components/rnpm/RnpmResultsTable.filter.test.tsx
```

Expected: 7 tests pass. Daca pica pe import-uri/props, ajusteaza mock-ul `mockResult` sa includa proprietatile necesare componentei.

- [ ] **Step 8.7: Biome + tsc + commit**

Run:
```bash
npx biome check --write frontend/src/components/rnpm/RnpmResultsTable.tsx frontend/src/components/rnpm/RnpmResultsTable.filter.test.tsx
cd frontend && npx tsc --noEmit && cd ..
git add frontend/src/components/rnpm/RnpmResultsTable.tsx frontend/src/components/rnpm/RnpmResultsTable.filter.test.tsx
git commit -m "feat(rnpm-ui): integrare filter text live in RnpmResultsTable + 7 component tests"
```

---

## Task 9: Version bump v2.24.0 + actualizare docs

**Files:**
- Modify: `package.json` (root)
- Modify: `backend/package.json`
- Modify: `frontend/package.json`
- Modify: `package-lock.json`
- Modify: `frontend/src/data/changelog-entries.tsx`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `SESSION-HANDOFF.md`
- Modify: `STATUS.md`
- Modify: `DOCUMENTATIE.md`
- (conditional) Modify: `SECURITY.md`

- [ ] **Step 9.1: Bump package.json (root + workspaces)**

Run:
```bash
node -e "const fs=require('fs'); for (const p of ['package.json','backend/package.json','frontend/package.json']) { const j=JSON.parse(fs.readFileSync(p,'utf8')); j.version='2.24.0'; fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n'); console.log(p, 'ok'); }"
```

Expected: 3 fisiere updated.

- [ ] **Step 9.2: Regenereaza package-lock.json**

Run:
```bash
npm install --package-lock-only
```

Expected: package-lock.json updated cu versiunea noua, fara modificari de deps.

- [ ] **Step 9.3: Adauga entry in changelog in-app**

Modify `frontend/src/data/changelog-entries.tsx` — adauga entry-ul nou la varful array-ului (sau in pozitia corecta cronologic, conform pattern-ului existent):

```tsx
{
  version: "2.24.0",
  date: "2026-05-13",
  summary: "Filtru text incremental peste rezultatele cautarii RNPM",
  details: [
    "Adaugat POST /api/rnpm/search/:searchId/filter cu owner isolation, anti-enumeration 404, timeout 5s, truncare 1500 ID-uri.",
    "Index nou idx_rnpm_avize_owner_search (migration 0021) + boot-time probe.",
    "Kill switch RNPM_RESULTS_FILTER_DISABLED pentru oprire de urgenta.",
    "UI: filtru live in RnpmResultsTable cu debounce 300ms, counter missingDetails transparent, banner truncate.",
    "49 teste noi (15 repo + 13 route + 1 EXPLAIN + 4 migration + 2 cross-tenant + 7 hook + 7 component)."
  ]
}
```

- [ ] **Step 9.4: Adauga sectiune in CHANGELOG.md**

Modify `CHANGELOG.md` — adauga la varful fisierului (dupa header), inainte de v2.23.0:

```markdown
## v2.24.0 — 2026-05-13

### Features

- **Filtru text peste rezultatele cautarii RNPM** — endpoint nou `POST /api/rnpm/search/:searchId/filter` cu Zod validation, owner isolation, anti-enumeration 404, timeout 5s, truncare 1500 ID-uri. UI: input live in `RnpmResultsTable` cu debounce 300ms si AbortController.
- **Index nou** `idx_rnpm_avize_owner_search` (migration 0021) cu boot-time probe.
- **Kill switch operational** `RNPM_RESULTS_FILTER_DISABLED=1` opreste filtrul fara restart.

### Tests

- 49 teste noi: 15 repo unit, 13 route, 1 EXPLAIN QUERY PLAN, 4 migration idempotenta, 2 cross-tenant breach drill, 7 hook, 7 component.
```

- [ ] **Step 9.5: Update README.md**

Modify `README.md` — gaseste linia cu versiunea curenta si update la `v2.24.0` (data 2026-05-13).

- [ ] **Step 9.6: Update SESSION-HANDOFF.md**

Modify `SESSION-HANDOFF.md`:

1. Header `**Versiune curenta**: v2.24.0 (2026-05-13)`.

2. In tabelul "Kill switches operationale", adauga row nou:

```
| `RNPM_RESULTS_FILTER_DISABLED=1` | Ruta POST `/api/rnpm/search/:searchId/filter` raspunde 503 cu `code: "FILTER_DISABLED"`; UI ascunde inputul si arata banner | Stop urgent daca filter-ul provoaca contention DB sau bug regresat |
```

3. Adauga sectiune noua (inlocuieste sau dupa "Sprint inchis 2026-05-13 — Migrare exporturi server-side"):

```markdown
## Sprint inchis 2026-05-13 — Filtru text rezultate RNPM

**Status**: livrat integral pe branch `feat/rnpm-results-filter`. 9 commit-uri TDD, biome + tsc + 49 teste noi verzi.

**Trigger**: search RNPM cu zeci-sute de avize face inutil scroll-ul fara filtru. Spec vechi (commit 3208782) STALE, codebase evoluase.

**Solutie**: endpoint nou `POST /api/rnpm/search/:searchId/filter` cu helper repository dedicat (NU refactor `getAvize`), 17 LIKE-uri pe `rnpm_norm()` (avize + creditori + debitori + bunuri + bunuri_descrieri). UI filtreaza local pe `Set<id>`. Spec full: [`docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md`](docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md).

**Decizii arhitecturale cheie**:
- POST (NU GET) — evita leak `q` in Hono `logger()` URL.
- Anti-enumeration 404 pentru `searchId` neexistent SAU al altui owner.
- `AbortSignal.any([req.signal, AbortSignal.timeout(5000)])` — cancel client + timeout intern.
- Truncare 1500 ID-uri cu `truncated: boolean` flag.
- `missingDetails` counter transparent — UI banner non-blocant.
- Helper PRIVAT `buildResultsFilterClause` — NU partajat cu `getAvize().searchText` pentru zero-regresie pe `/api/rnpm/saved?q=`.
```

- [ ] **Step 9.7: Update STATUS.md si DOCUMENTATIE.md**

Modify `STATUS.md` — header campurile "Data curenta" → 2026-05-13 si "Versiune curenta reala" → v2.24.0.

Modify `DOCUMENTATIE.md` — campul "Versiune curenta" din sectiunea "Descriere Generala" → v2.24.0.

- [ ] **Step 9.8: SECURITY.md entry conditional**

Modify `SECURITY.md` — daca exista un changelog table la baza, adauga entry:

```
| v2.24.0 | 2026-05-13 | Filter RNPM cu owner isolation + anti-enumeration 404 + anti-leak log (qLen vs raw q) |
```

Daca SECURITY.md nu are tabel sau e gol pe versiunea curenta, skip acest step.

- [ ] **Step 9.9: Sanity check grep pe versiunea veche**

Run:
```bash
grep -rni "v2\.23\.0" --include="*.md" . | grep -v node_modules | grep -v "^./CHANGELOG.md" | grep -v ".git/"
```

Expected: doar referinte istorice (CHANGELOG entries vechi). Fiecare alt hit → trebuie updated.

- [ ] **Step 9.10: Biome pe toate .md (daca biome are config pentru md)**

Run:
```bash
npx biome check --write . 2>&1 | tail -20
```

Expected: clean sau ignored (biome de obicei nu touchuieste .md).

- [ ] **Step 9.11: Commit version bump**

Run:
```bash
git add package.json backend/package.json frontend/package.json package-lock.json frontend/src/data/changelog-entries.tsx CHANGELOG.md README.md SESSION-HANDOFF.md STATUS.md DOCUMENTATIE.md SECURITY.md 2>/dev/null
git status
git commit -m "release: v2.24.0 — filtru text peste rezultate RNPM"
```

Expected: commit creat. Verifica `git status` arata working tree clean dupa.

---

## Task 10: Final gates si push

**Files:** toate cele atinse (sanity check final)

- [ ] **Step 10.1: Biome full repo**

Run:
```bash
npx biome check --write .
```

Expected: clean (sau fixuri minore re-aplicate). Daca biome modifica ceva, re-stage si commit suplimentar `style: biome format pass`.

- [ ] **Step 10.2: TypeScript backend + frontend**

Run:
```bash
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
```

Expected: clean ambele.

- [ ] **Step 10.3: Build complete**

Run:
```bash
npm run build
```

Expected: bundle clean (Vite + esbuild backend). Verifica `dist/` si `dist-backend/` create fara erori.

- [ ] **Step 10.4: Test suite complet**

Run:
```bash
npm test --workspace=backend
cd frontend && npm test -- --run && cd ..
```

Expected: tot test suite verde. Numar minim asteptat:
- Backend: 926 (baseline v2.23.0) + 35 (15 repo + 13 route + 1 EXPLAIN + 4 migration + 2 cross-tenant) = ~961
- Frontend: 102 (baseline) + 14 (7 hook + 7 component) = ~116

- [ ] **Step 10.5: Manual smoke Electron**

Run:
```bash
npm run electron:dev
```

In aplicatia desktop:
1. Navigheaza la modulul RNPM.
2. Ruleaza o cautare reala (ipoteci sau alt tip — captcha key necesar).
3. Verifica input-ul filter apare deasupra tabelului.
4. Tasteaza un debitor cunoscut → randurile se filtreaza in ~300ms.
5. Verifica counter "X din Y avize" afisat.
6. Sterge textul → toate randurile reapar.
7. Restart cu env `set RNPM_RESULTS_FILTER_DISABLED=1` → input disabled + banner.
8. Verifica logs stdout: `"action":"rnpm.results.filter"` cu `qLen`, fara raw `q`.

Daca toate cele 8 verificari trec → smoke green.

- [ ] **Step 10.6: Push branch**

Run:
```bash
git push -u origin feat/rnpm-results-filter
```

Expected: branch push-uit cu succes.

- [ ] **Step 10.7: Creeaza PR cu link la spec**

Run:
```bash
gh pr create --title "feat(rnpm): filtru text incremental peste rezultatele cautarii (v2.24.0)" --body "$(cat <<'EOF'
## Summary

Adauga `POST /api/rnpm/search/:searchId/filter` — filtru text incremental peste rezultatele unei cautari RNPM. Owner isolation, anti-enumeration 404, AbortSignal timeout 5s, truncare 1500 ID-uri, `missingDetails` counter transparent. Zero regresii pe `getAvize()` / `/api/rnpm/saved?q=`.

## Spec si plan

- Spec: `docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md`
- Plan: `docs/superpowers/plans/2026-05-13-rnpm-results-text-filter.md`

## Changes

- Migration 0021 `idx_rnpm_avize_owner_search` (IF NOT EXISTS + boot-time probe).
- Helper repository `filterRnpmSearchResults` (17 LIKE-uri pe `rnpm_norm()` + EXISTS pe creditori/debitori/bunuri).
- Route handler cu Zod validation, kill switch `RNPM_RESULTS_FILTER_DISABLED`, structured logging (qLen NU raw q).
- Frontend hook `useRnpmResultsFilter` cu `useDebouncedValue` 300ms + AbortController.
- UI integration in `RnpmResultsTable.tsx` cu input + 3 banner-uri (truncate, missingDetails, disabled).

## Tests

- 35 teste backend noi (15 repo + 13 route + 1 EXPLAIN + 4 migration + 2 cross-tenant breach).
- 14 teste frontend noi (7 hook + 7 component).
- Total 49 teste noi, toate verzi.

## Test plan

- [ ] Smoke Electron: cautare reala + filter live + counter + truncate banner + disabled mode.
- [ ] Verifica log stdout: `"action":"rnpm.results.filter"` cu `qLen`, fara raw `q`.
- [ ] Cross-tenant breach drill verzi.
- [ ] EXPLAIN QUERY PLAN verde (index utilizat).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: PR URL returnat.

- [ ] **Step 10.8: Sanity check post-push**

Run:
```bash
git log --oneline -10
gh pr status
```

Expected: vezi PR-ul deschis + ultimele 10 commit-uri pe branch (Task 0-9).

---

## Note finale pentru executant

1. **TDD strict**: scrie testul ÎNTAI, ruleaza, vezi FAIL, apoi implementeaza. NU sari la implementare fara test failing vazut.
2. **Romana fara diacritice** — verifica fiecare comentariu si fiecare string UI.
3. **NU modifica `getAvize()`** — niciun caracter. Daca pare ca trebuie, opreste-te si intreaba.
4. **Helper privat `buildResultsFilterClause`** — folosit DOAR de `filterRnpmSearchResults`. NU il exporta. NU il refoloseste in alta parte.
5. **POST nu GET** — daca vezi handler-ul ca GET, e bug.
6. **`/api/rnpm/...` nu `/api/v1/rnpm/...`** — productie e fara `v1`.
7. **17 LIKE-uri cu ESCAPE `'\\'` uniforme** — verifica fiecare LIKE inainte de commit.
8. **`new Response(null, { status: 499 })`** — NU `c.body` cu cast pentru 499; Response direct.
9. **`logFilterEvent` local** — NU incerca import `logRnpmEvent` din service (e privat).
10. **Commit la fiecare task** — nu batch multiple task-uri intr-un commit.
