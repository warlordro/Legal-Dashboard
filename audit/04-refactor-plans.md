# A4 — Refactor Plans (Staged, per Top-5 Target)

**Generated:** 2026-05-16
**Source:** `/refactor-review` skill — 4 agents paralel (refactor-planner + deep-code-reviewer + test-architect + claude-guard)
**Scope:** Top-5 din `audit/03-architecture.md` shortlist + twin WHERE-builder reconciliation

---

## Refactor Planner

**Total effort estimat:** ~41h (staged, 14 PR-uri sub-200 LOC each)
**Strategie:** parallel waves (PR-uri independente livrabile concurent), fiecare PR cu test caracterizare INAINTE de schimbarea structurala.

### Cross-cutting decisii (din planner)
- **NU** crea o singura abstractie `AlertPubSub` + `IdempotencyStore` partajata. Sunt 2 lifecycle-uri diferite (pub/sub fan-out vs lock-acquire). Mergi pe 2 interfete separate.
- **NU** unifica twin WHERE-builders pre-product owner sign-off (vezi `audit/03-architecture.md` H4).
- Order: PR-uri characterization tests (Faza T) → PR-uri interface extraction (Faza I) → PR-uri implementation swap (Faza S) → PR-uri cleanup (Faza C).

### Target 1 — `monitoringAlertsRepository.ts` → `AlertPubSub`

**PR-1.T (~2h):** characterization tests pe `listAlerts`, `dispatchAlert`, `subscribe`/`unsubscribe`. Acopera owner-scoping, listener cleanup pe abort, ordering (subscribe-before-ready).
**PR-1.I (~3h):** introdu interfata `AlertPubSub` cu metode `subscribe(ownerId, listener) → Unsubscribe`, `publish(ownerId, alert) → void`. Impl in-memory existenta refactorizata. Repository devine consumer al interfetei.
**PR-1.S (~2h):** swap singleton `alertListenersByOwner` cu instance injected via DI container (acelasi nivel cu db handle). Ownership: `createAlertPubSub()` factory.
**PR-1.C (~1h):** cleanup: documenteaza in `PLAN-monitoring-webmode.md` cum se schimba impl pentru Redis pub/sub la cutover (NU implementa Redis acum).

**LOC delta:** +120 (interface + tests), -40 (singleton init scattered) → +80 net.
**Migration path:** zero breaking. Existing call-site-uri continua sa apeleze repository care delegheaza la pub/sub.

### Target 2 — `rnpm.ts` `inflightRequests` → `IdempotencyStore`

**PR-2.T (~1h):** caracterizare test pe `inflightRequests` lock behavior:
- 2 cereri concurrente cu acelasi `clientRequestId` → a doua asteapta prima
- A doua cerere DUPA finalizare → NOT cached (vine din nou)
- Cleanup on error (NO permanent lock)
**PR-2.I (~2h):** interfata `IdempotencyStore` cu `acquireLock(key, ttl) → Lock | null` + `releaseLock(lock)`. NU `cachedResult` — explicit sentinel-only impl pentru a pastra semantica.
**PR-2.S (~2h):** swap Map global cu instance injected; TTL explicit 120s pentru lock expiry; cleanup-on-error in finally block.
**PR-2.C (~1h):** ADR (architecture decision record) intern care explica decision-ul "NU cache rezultate, doar lock". Adauga la `HARDENING.md` sau `PLAN-monitoring-webmode.md`.

**LOC delta:** +60 (interface + tests), -25 (Map global + cleanup scattered) → +35 net.
**Migration path:** zero breaking. Acelasi clientRequestId contract pe client.

### Target 3 — `DosareTable.tsx` 24-state → 3-component + `useAiAnalysisCache`

**PR-3.T (~3h):** characterization tests pe DosareTable (cea mai mare gap din test-architect):
- Render with 100 dosare
- Selection (single, multi, shift-range)
- Sort by 5 columns
- Pagination next/prev
- AI panel toggle, cache hit/miss
- sessionStorage reload edge case
**PR-3.I (~3h):** extract `useAiAnalysisCache(cacheKey, options)` hook cu lifecycle clar:
- `getCached(dosarId) → CachedAnalysis | null`
- `setCached(dosarId, analysis)` cu TTL explicit
- Clock-skew protection: store both `cachedAt` (epoch ms) AND `monotonic` (performance.now()) → invalidate la skew detectat
- SSR-safe init (defer load to useEffect, not useState initializer)
**PR-3.S1 (~2h):** extract `<DosareAiPanel>` (folosind hook nou)
**PR-3.S2 (~2h):** extract `<DosareTableContainer>` (data + pagination)
**PR-3.S3 (~2h):** restrange `<DosareTableBody>` la rendering pur

**LOC delta:** 747 → ~3 fisiere a 250-300 LOC each (~+100 LOC total din boilerplate split, dar maintainability ↑).
**Migration path:** zero breaking — API public al `<DosareTable>` ramane neschimbat (wrapper Container).

### Target 4 — `rnpmSearchService.ts` 4 executoare → `PageFetcher` strategy

**PR-4.T (~3h):** unit tests pe `executeSearch` (cel mai bine coperit), apoi extend la celelalte 3. Acopera gcode retry path, captcha provider race, split decision logic.
**PR-4.I (~2h):** interfata `PageFetcher` + `SearchOrchestrator`:
```
interface PageFetcher {
  fetchPage(params): Promise<PageResult>
  decideSplit(result): SplitDecision
  emitPhase(phase): void
}
class SearchOrchestrator {
  run(fetcher: PageFetcher): AsyncIterable<Phase>
}
```
**PR-4.S1 (~2h):** migrate `executeSearch` la strategy
**PR-4.S2 (~1h):** migrate `executeBulkSearch`
**PR-4.S3 (~1h):** migrate `executeSplitSearch` + `executeNestedDestinationSplit` (impart fetcher cu state for nested level)
**PR-4.C (~1h):** delete dead code (orphan phase emitters)

**LOC delta:** 1019 → ~700 (strategy + 4 thin wrappers, ~-300 net).
**Migration path:** zero breaking — public service API neschimbata.

### Target 5 — Twin WHERE-builder reconciliere

**Plan diferit:** acesta NU este pur refactor tehnic; este product decision.

**PR-5.T (~3h):** golden snapshot test:
- Snapshot 500 randuri productie cu `getAvize` (12-col single-token) vs `filterRnpmSearchResults` (24-col multi-token)
- Diff matrix pe ID-uri returnate per query → quantify divergence
- Output → `audit/where-builder-divergence.md` (NU `04-refactor-plans.md`)
**PR-5.D (~2h, decision):** prezinta divergenta product owner. 3 path-uri posibile:
- A) Pastreaza ambele (decision: NO refactor)
- B) Unifica la 24-col multi-token (lazy 12-col adapter) → broadens `/saved` match surface
- C) Documenteaza intent diferent + nu unifica niciodata (rename clear: `searchAvizSimple` vs `filterRnpmExtended`)
**PR-5.I (~1h):** doar daca decizia este B sau C, implementeaza.

**LOC delta:** highly variable (0 daca A, +50 daca C documenteaza, -100 daca B unifica).
**Migration path:** posibil breaking (B) — necesita feature flag.

---

## Deep Code Reviewer

**Critical invariants** care trebuie pastrate prin TOATE PR-urile:

| # | Invariant | Where it lives now | Risk if broken |
|---|-----------|--------------------|----|
| I1 | Owner-scoping enforced la interface boundary (NU doar la callsite) | `monitoringAlertsRepository.dispatchAlert(ownerId, alert)` | Cross-tenant alert leak |
| I2 | `inflightRequests` Map e SENTINEL, NU cache | `rnpm.ts:~450` | Refactor inflate scope la full cache → cost + stale-result risk |
| I3 | Subscribe-before-ready ordering pentru SSE handler | `routes/alerts.ts: GET /stream` | Race: alert dispatched in fereastra subscribe→headerFlush → res.write panic |
| I4 | AI analysis cache lifecycle (TTL + clock-skew + sessionStorage init) | `DosareTable.tsx` | Permanent stale cache; SSR hydrate bug |
| I5 | 4 executoare = NU 3 (`executeNestedDestinationSplit` separat) | `rnpmSearchService.ts` | Refactor uita strategie nested → bulk searches cu split la 2 niveluri |
| I6 | Twin WHERE-builder = product decision, NU dedup tehnic | `avizRepository.ts`, `monitoringAlertsRepository.ts` | Silent broadening match surface → false positives |
| I7 | Captcha sentinel dedup + per-slot diagnostic (din v2.27.5 perf fix) | `rnpmSearchService.ts: details concurrency` | Regresie race captcha cross-slot |
| I8 | `monitoringAlertsEnrichment` singleton cache invalidation | `services/monitoring/alertsEnrichment.ts` | Multi-instance: enrichment partial / divergent |
| I9 | Backup atomic write (`.db.tmp` rename) + pre-migration backup | `db/backup.ts` | Corupere SQLite WAL la crash |
| I10 | XLSX formula-injection escape (`=+-@\t\r` prefix `'`) | `services/rnpmExportXlsx.ts` | Re-introducere injection daca extract scaffold uita escape |

**Recomandare deep-reviewer:** fiecare PR sa inceapa cu o caracterizare test care explicit verifica unul sau mai multe invarianti din lista. NU shipping fara verde pe invarianti relevanti.

---

## Test Architect

**Total tests recomandate:** 10
**"Must add now" (blocking gates inainte de refactor):** 4
**Estimated test-writing effort:** ~14h pentru lista completa, ~8h pentru cele 4 must-add.

### Must add NOW (blocking)

| # | Test | Target file | Effort | Why blocking |
|---|------|-------------|--------|--------------|
| T1 | `DosareTable.characterization.test.tsx` | `DosareTable.tsx` | 3-4h | God component 24-state — zero coverage actualmente; orice refactor regresseaza vizibil in UX |
| T2 | `rnpm.dedup.test.ts` | `routes/rnpm.ts` `inflightRequests` | 1h | Sentinel lock semantica — refactor IdempotencyStore poate inflate scope |
| T3 | `executeSearch.gcodeRetry.test.ts` | `rnpmSearchService.ts` | 2h | Gcode retry path testat doar in integration smoke; unit gap |
| T4 | `alertRepository.filterEquivalence.test.ts` | `monitoringAlertsRepository.ts` | 2h | `listAlerts` vs `selectAlertIdsByFilters` semantica WHERE → snapshot pe dataset productie |

### Should add (in waves de refactor)

| # | Test | Why |
|---|------|-----|
| T5 | `AlertPubSub.contract.test.ts` | Interface contract: subscribe ordering, unsubscribe cleanup, owner isolation |
| T6 | `IdempotencyStore.contract.test.ts` | Lock acquire/release, TTL expiry, no result cache |
| T7 | `useAiAnalysisCache.test.tsx` | Hook standalone: TTL, clock-skew, SSR-safe init |
| T8 | `PageFetcher.strategy.test.ts` | Per-impl: list executor, bulk executor, split executor, nested |
| T9 | `whereBuilderDivergence.snapshot.test.ts` | Golden snapshot 12-col vs 24-col WHERE pe dataset productie |
| T10 | `SSE.subscribeBeforeReady.test.ts` | Race characterization: dispatch alert in fereastra subscribe→flush |

### Shared test infrastructure needs

- `createTestDb(): Database` helper in `backend/src/db/__testutils__/createTestDb.ts` (better-sqlite3 in-memory cu migrations applied)
- `RnpmStubClient` in `backend/src/services/__testutils__/RnpmStubClient.ts` (fixture pe portal RNPM responses, captcha solver stub deterministic)
- `renderDosareTable(props)` factory in `frontend/src/components/__testutils__/renderDosareTable.tsx` (wrapper cu QueryClient + Router + AI provider stubs)

Aceste 3 helpers se livreaza in PR pregatitor `PR-T0` inainte de orice characterization test.

---

## Claude Guard

**Verdict:** GO with mitigations.
**Workflow compliance check:** plan respecta CLAUDE.md root + project — Repository-only DB access, owner_id everywhere, no singleton state tied to user activity, biome + tsc + vitest per stage.

### Mitigations obligatorii inainte de fiecare PR

1. **Biome** — `npx biome check --write` pe fisierele atinse, re-stage daca biome reformat.
2. **Type-check** — `npx tsc --noEmit -p backend/tsconfig.json` + `cd frontend && npx tsc --noEmit`.
3. **Tests** — `npm test --workspace=backend` (+ frontend cand atinge `frontend/`).
4. **Build sanity** — `npm run build` ca sa confirmi esbuild + Vite ies curat.
5. **Electron smoke** — `npm run electron:dev`, deschide pagina afectata, golden path + 1 edge case. Documenteaza in commit message ce-ai testat.
6. **Memory update** — daca un PR introduce o conventie sau decizie noua (ex. AlertPubSub interface signature), update memory file dedicat.

### Risc-uri specifice flagged

- **Owner-scoping la interface boundary** (AlertPubSub) este non-negotiable. Daca tipajul accepta `subscribe(listener)` fara ownerId, RESPINGE PR-ul.
- **IdempotencyStore TTL** trebuie sa fie configurabil DAR cu default 120s explicit hard-coded. NU lasa "TTL optional" sa fie infinit by default — leak-uri de lock-uri ar bloca toate RNPM searches.
- **Twin WHERE-builder** — daca PR-ul incearca unifying fara golden snapshot test + product sign-off, RESPINGE.
- **DosareTable AI cache** — clock-skew protection trebuie sa fie atat `Date.now()` cat si `performance.now()` paired check. Daca lipsa, RESPINGE.

### AI-branch coordination

Plan curent NU intersecteaza `feat/openrouter-toggle-stacks` (8 fisiere additive, no modifications). Daca un PR din refactor trebuie sa atinga `routes/ai.ts`, asteapta merge-ul AI branch INTAI.

---

## Combined Refactor Plan

**Deduplicare + smallest safe steps in priority order.**

### Fundatie (livrabila imediat, paralel cu orice)

| # | PR | Effort | Blocks |
|---|----|----|----|
| 1 | `PR-T0`: shared test infrastructure (`createTestDb`, `RnpmStubClient`, `renderDosareTable`) | 4h | T1-T10 |

### Wave 1 — Characterization (paralel, livrabile concurent)

| # | PR | Effort | Target |
|---|----|----|----|
| 2 | `PR-1.T`: AlertPubSub characterization tests | 2h | C1 (monitoringAlertsRepository) |
| 3 | `PR-2.T`: rnpm dedup-lock characterization | 1h | C2 (rnpm.ts inflightRequests) |
| 4 | `PR-3.T`: DosareTable characterization | 3-4h | H2 (DosareTable god component) |
| 5 | `PR-4.T`: executeSearch gcode retry test | 2h | H1 (rnpmSearchService 4 executoare) |
| 6 | `PR-5.T`: WHERE-builder golden snapshot | 3h | H4 (twin WHERE-builder) |

**Total Wave 1:** ~11-12h. Toate independente. Verde pe Wave 1 = green light pentru Wave 2.

### Wave 2 — Interface extraction (sequential per target, paralel cross-target)

| # | PR | Effort | Target | Depinde de |
|---|----|----|----|----|
| 7 | `PR-1.I`: AlertPubSub interface + in-memory impl | 3h | C1 | PR-1.T |
| 8 | `PR-2.I`: IdempotencyStore interface | 2h | C2 | PR-2.T |
| 9 | `PR-3.I`: `useAiAnalysisCache` hook + clock-skew | 3h | H2 | PR-3.T |
| 10 | `PR-4.I`: PageFetcher strategy interface | 2h | H1 | PR-4.T |
| 11 | `PR-5.D`: product decision twin WHERE-builder | 2h | H4 | PR-5.T (snapshot) |

**Total Wave 2:** ~12h. PR-5.D este product-blocker, nu engineering — depinde de owner.

### Wave 3 — Implementation swap (per target)

| # | PR | Effort | Target |
|---|----|----|----|
| 12 | `PR-1.S` + `PR-1.C`: AlertPubSub swap + ADR | 3h | C1 |
| 13 | `PR-2.S` + `PR-2.C`: IdempotencyStore swap + ADR | 3h | C2 |
| 14 | `PR-3.S1/S2/S3`: DosareTable split | 6h | H2 |
| 15 | `PR-4.S1/S2/S3` + `PR-4.C`: rnpmSearchService migration | 5h | H1 |
| 16 | `PR-5.I` (conditional): WHERE-builder change | 1-3h | H4 |

**Total Wave 3:** ~18-20h.

### Total grand: ~45-48h staged peste 14-16 PR-uri sub-200 LOC each.

### Sequencing recommendation (priority order, top to bottom)

1. **PR-T0** (test infra) — fara asta, characterization tests sunt blocate
2. **PR-1.T + PR-2.T** (web cutover blockers) — must add now
3. **PR-3.T + PR-4.T** (HIGH severity coverage gaps) — must add now
4. **PR-5.T** (semantic divergence quantification) — informeaza decizia
5. **Wave 2 + 3** in orice ordine convenabila — paralel per target

### Risc register

| Risc | Severity | Mitigation |
|------|----------|------------|
| Twin WHERE-builder silent broadening | HIGH | PR-5.T golden snapshot + product sign-off **OBLIGATORY** |
| AlertPubSub multi-channel scope creep | MED | Mentine impl in-memory; Redis impl la cutover, nu acum |
| IdempotencyStore TTL leak | MED | Default 120s + monitoring metric `idempotency_locks_active_count` |
| DosareTable behavior regression | HIGH | T1 characterization 3-4h **OBLIGATORY** inainte de split |
| AI-branch collision pe `routes/ai.ts` | LOW | Plan curent nu atinge ai.ts; daca apare, defer pana la merge AI branch |

### Web-cutover impact

PR-urile **1.S + 2.S + Wave 3** elimina 2 din blocker-ele web-readiness identificate in `CLAUDE.md`:
- "No singleton state tied to user activity" — devine respectabil
- `inflightRequests` cross-instance dedup — devine configurabil (Redis-ready interface)

PR-urile **NU rezolva** complet cutover-ul (still need: Redis impl, Litestream, observability) — dar elimina datoria tehnica care ar bloca cutover-ul.
