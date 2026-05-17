# Audit Refactor — Prezentare Unitara cu Masuri Propuse

**Generat:** 2026-05-16
**Versiune tinta:** v2.28.0 (HEAD `main`, perspective `feat/openrouter-toggle-stacks` cu AI files excluse)
**Scope:** backend/src + frontend/src + electron, fara migrations, fara teste, fara `changelog-entries.tsx`
**Surse:** 6 rapoarte intermediare in `audit/01..06`. Fiecare candidat de mai jos referentiaza sursa originala.

> **ERRATA / POST-VALIDATION CORRECTIONS (2026-05-16, post v2.28.1):** 4 agenti de validare (backend-reliability-reviewer, test-architect, refactor-planner, deep-code-reviewer) au identificat 5 erori factuale + 17 invariants ascunse in audit-ul initial. **Citeste sectiunea 0 (Errata) inainte de a actiona pe orice priority P1-P15.** Sectiunile afectate sunt marcate inline cu `[CORRECTED]`.

---

## 0. Errata — Corectii post-validation (5 gap-uri critice)

### G1 — P2 TTL 120s hard-coded e footgun
**Original (P2):** `TTL hard-coded 120s default (nu lasa optional infinit — leak ar bloca toate RNPM searches)`
**Realitate cod (`backend/src/routes/rnpm.ts:85-90`):**
- `SSE_TIMEOUT_MS = 5_400_000` (90 min bulk)
- `SSE_SPLIT_TIMEOUT_MS = 2_700_000` (45 min split)
La 120s, lock-ul expira mid-bulk → al doilea click solve din nou captcha pe pana la 200 itemi (~$10 real money). **Corectie:** TTL **parametrizat per operatie** — `acquireLock(key, ttlMs)`. Default 120s pentru `/search` simplu; pentru `/bulk` + `/search-split` TTL trebuie `>= SSE_TIMEOUT_MS + margine`. Vezi P2 [CORRECTED] mai jos.

### G2 — Al 3-lea singleton ratat: scheduler AbortController
**Audit identifica 2 blocker-i web-cutover (P1, P2). Lipseste al 3-lea:**
- `backend/src/services/monitoring/scheduler.ts:9-10` — singleton AbortController map cu comentariu explicit "manual /run route can cancel a specific in-flight job"
- Multi-instance: cancel pe instance B nu opreste job claim-uit pe instance A
Aceeasi clasa de bug ca P1, scope absent din audit. **Adaugat P0-new** in sectiunea 3.

### G3 — P15 fisier inexistent + arhitectura gresita
**Original:** `monitoringAlertsEnrichment.ts` la `backend/src/services/monitoring/alertsEnrichment.ts`
**Realitate:** fisierul real e `backend/src/db/monitoringAlertsEnrichment.ts:48`, **NU e rider la P1** — e singleton independent in sibling-file. Ambele singletons (`alertListenersByOwner` + `alertEnrichmentListenersByOwner`) sunt wired in **acelasi** SSE stream (`backend/src/routes/alerts.ts:694` + `:732`) cu pattern identic. **Corectie:** unifica P1+P15 dintr-o data intr-un singur `AlertPubSub` cu **canale tipizate**: `publish(channel: "alert" | "alert_enriched", ownerId, payload)`. NU 2 interfete separate (ar duplica subscribe-before-ready gap-ul de 2 ori). Vezi P1 [CORRECTED].

### G4 — P3 premiza AI cache MAX_AGE NU EXISTA in cod
**Original:** `useState(() => loadFromSessionStorage())` SSR-unsafe + AI cache invalidation pe `Date.now() - cachedAt > MAX_AGE` fara clock-skew protection
**Realitate (`frontend/src/components/DosareTable.tsx`):** `aiAnalysis` e plain `{}`, fara TTL, fara sessionStorage persistence. Singura cheie sessionStorage e `viewedDosare` (set de expanded row IDs). **Consecinta:** testele PR-3.T scrise pe aceasta premiza ar pica pe codul actual neschimbat. Refactor-ul P3 ramane valid (24 state vars e real, 837 LOC e real), dar **tintele de test trebuie schimbate**: render 100 rows, sort 5 cols, selectie single/multi/shift, pagination, `viewedDosare` reload. NU cache TTL / clock-skew. Vezi P3 [CORRECTED].

### G5 — P12/D1 unificare XLSX imposibila tehnic
**Original:** Extract `lib/xlsxBuilder.ts` cu builder API unic pentru header/body/freeze pane (~250 LOC savings)
**Realitate:**
- `backend/src/services/rnpmExportXlsx.ts:1` foloseste **exceljs** (`cell.value`, `worksheet.addRow`)
- `frontend/src/lib/excel-helpers.ts:36` foloseste **xlsx-js-style** (`ws[addr] = {t,v,s}`)
Libraries fundamental incompatibile, **builder unificat imposibil**. Singurul artefact share-abil real e regex-ul `FORMULA_PREFIX = /^[=+\-@\t\r]/`. **Corectie:** P12/D1 redus la 1 modul `lib/formulaPrefixRegex.ts` (5 LOC) + 2 teste invariant (cate unul in backend + frontend). LOC savings real: **~5 LOC** (vs ~250 in audit). Vezi P12 [CORRECTED].

### Totaluri recalculate (post-corectie)

| Categorie | Audit original | Post-validation |
|-----------|----------------|-----------------|
| Web-cutover blockers | 2 (P1, P2) | **3** (P1+P15 combinat, P2, **P0-new scheduler**) |
| Duplicate savings | ~1555 LOC | **~505 LOC** (D1 imposibil; D2-D4 valide cu nuante) |
| Dead code | ~110 LOC + 2 deps | neschimbat (verificat) |
| Quick wins | ~120 LOC | neschimbat (verificat) |
| Structural net delta | ~+95 LOC interfaces | **~+118 LOC** (P0-new + P1 combinat) |
| NET TOTAL refactor complet | -1700 LOC claim | **~-1007 LOC + 2 packages** (realist) |

### Invariants ascunse descoperite post-validation (17 in total)

Vezi sectiunea noua **"6.5 Hidden invariants (deep-code-reviewer)"** la finalul documentului. Top 5 cu impact mare:
- I1: `searchBelongsToOwner` cross-tenant precheck pe `existingSearchId` (`rnpmSearchService.ts:108-110`)
- I2: `withMaintenanceRead` bracket-uieste DOAR SQLite write, NU HTTP fetch (`rnpmSearchService.ts:284`)
- I3: `consecutiveSilentRefusals` reset semantics complex (reset pe success/limit_exceeded, NU pe transient errors)
- I4: `insertAlert` tenant pre-check INSIDE transaction — `UNIQUE(job_id, dedup_key)` NU e owner-scoped
- I5: `OPENROUTER_DISABLED=1` arunca in `callOpenRouter`, fara try/catch fallback — orice "resilience refactor" reintroduce bug-ul v2.28.0 inchis

---

## 1. Cifre cheie [REVISED post-validation]

| Indicator | Valoare originala | Valoare corectata |
|-----------|-------------------|-------------------|
| Fisiere scanate (non-test, non-content) | 204 | 204 |
| LOC total | 40 734 | 40 734 |
| Hot-files (>500 LOC) | 19 backend + 11 frontend | 19 backend + 11 frontend |
| HIGH-risk | 68 | 68 |
| MED-risk | 60 | 60 |
| LOW-risk | 76 | 76 |
| Clustere duplicare detectate | 12 (~1555 LOC savings potential) | 12 (~**505 LOC** realist — D1 imposibil, D3 cu nuanta) |
| Findings arhitectura (CRITICAL / HIGH / MED / LOW) | 2 / 13 / 15 / 9 | **3** / 13 / 15 / 9 (P0-new scheduler adaugat) |
| Quick wins LOW-RISK | 8 immediate + 4 batched (~120 LOC net) | neschimbat (verificat) |
| Dead code real | ~110 LOC + 2 deps frontend neutilizate | neschimbat (verificat) |
| Web-cutover blockers | 2 (P1, P2) | **3** (P0-new + P1 combinat + P2) |
| Hidden invariants identificate post-validation | — | **17** (vezi sectiunea 6.5) |
| Estimare effort total refactor structural | ~45-48h staged peste 14-16 PR-uri | **~76h staged peste 24-26 PR-uri** |
| Path minim cutover web | — | **~22h** (Sprint 0 + P0/P1/P2 T+I+S+C) |

---

## 2. Tabel sintetic — candidati sortati dupa (impact × frecventa) / effort

Toti candidatii din top 15. Detalii fiecare in sectiunea 3. **Prioritate** = ordinea in care recomand sa fie atacat.

| # | Candidat | Severitate | Effort | Sursa | Web-blocker? | Status |
|---|----------|------------|--------|-------|--------------|--------|
| **P0-new** | `scheduler.ts:9-10` AbortController singleton → distributed cancel signaling | **CRITICAL** | ~6h | post-validation G2 | DA | refactor structural [ADDED] |
| **P1** | `monitoringAlertsRepository.ts` + `monitoringAlertsEnrichment.ts` singletoane → `AlertPubSub` interface cu canale tipizate (combina P15) | **CRITICAL** | ~10h | A3:C1, A4:T1, G3 | DA | refactor structural [CORRECTED] |
| **P2** | `rnpm.ts` `inflightRequests` Map → `IdempotencyStore` interface (sentinel-only, TTL **parametrizat per operatie**) | **CRITICAL** | ~6h | A3:C2, A4:T2, G1 | DA | refactor structural [CORRECTED] |
| **P3** | `DosareTable.tsx` 24-state god component → 3-component + `useAiAnalysisCache` hook | HIGH | ~10h | A3:H2, A4:T3 | NU (UX critic) | refactor structural |
| **P4** | `rnpmSearchService.ts` 4 executoare → `PageFetcher` strategy | HIGH | ~8h | A3:H1, A4:T4 | NU | refactor structural |
| **P5** | Twin WHERE-builder reconciliere semantica (NU dedup tehnic) | HIGH | ~6h + product sign-off | A3:H4, A4:T5 | NU | product decision |
| P6 | `Alerts.tsx` god component 18+ state + SSE backoff | HIGH | ~5h | A3:H3 | NU | refactor structural |
| P7 | `manual-content.tsx` function 889 LOC split | HIGH | ~4h | A3:H7 | NU | refactor structural |
| P8 | `Monitorizare.tsx` nesting 10 flatten + extract sub-components | HIGH | ~4h | A3:H8 | NU | refactor structural |
| P9 | `rnpm.ts` split by domain + `withRnpmGuards` middleware | HIGH | ~5h | A3:H5 | NU | refactor structural |
| P10 | `alerts.ts` SSE plumbing extract + dismiss-bulk transaction | HIGH | ~3h | A3:H6 | NU | refactor structural |
| P11 | `avizRepository.ts` extract `buildAvizWhere` + `parseAvizRow` | HIGH | ~3h | A3:H9 | NU | refactor structural |
| P12 | Cluster duplicare A2 D1-D4: XLSX/PDF/envelope/pagination scaffolds | MED | ~6h | A2 cluster 1-4 | NU | duplicate extract |
| P13 | A5 Batch B1+B2+item-1+item-2+item-8 (quick wins net ~80 LOC) | LOW | ~1h | A5 | NU | quick win |
| P14 | A6 deps + orfan + dead exports cleanup | LOW | ~25 min | A6 | NU | dead code |
| ~~P15~~ | ~~`monitoringAlertsEnrichment.ts` rider~~ | — | — | — | — | **MERGED into P1** [CORRECTED G3] |

---

## 3. Candidati cu masuri propuse

### P0-new — `scheduler.ts`: AbortController singleton → distributed cancel [ADDED post-validation G2]

**Fisier:** `backend/src/services/monitoring/scheduler.ts:9-10`
**Problema:** Map global de AbortController-uri per job ID, cu comentariu explicit "manual /run route can cancel a specific in-flight job". La multi-process, cancel emis pe instance B nu poate opri job claim-uit pe instance A → request `/run` cu intentie de cancel se intoarce 200 OK dar job-ul ramane in executie pe alta instanta.

**Masuri propuse:**
1. **PR-0.T (1.5h)**: characterization — cancel via /run pe job claim-uit local opreste fetch + scade gracefully; cancel pe job non-existent intoarce 404; cancel idempotent (apel dublu = al 2-lea no-op).
2. **PR-0.I (2h)**: interfata `JobCancellationSignal` cu `register(jobId, controller)` + `cancel(jobId): Promise<boolean>`. Implementare default in-memory (echivalent cu Map curent); ADR pentru cutover web → Redis key polling.
3. **PR-0.S (1.5h)**: swap Map cu instance DI-injected; preserve abort propagation in fetch (vezi I2 — `withMaintenanceRead` brackets).
4. **PR-0.C (1h)**: ADR documentand path Redis: cancel publish pe canal, runner-ul polleaza la fiecare 5s + abort local.

**Invariant non-negotiable**: cancel-ul pe job in-flight trebuie sa propage `AbortSignal` pana in `fetch()` SOAP/HTTP (vezi I2 + invariant SOAP cancellation).

**LOC delta:** +40 net.
**Web-cutover impact:** elimina al 3-lea blocker (alaturi de P1+P2).

---

### P1 — `monitoringAlertsRepository.ts` + `monitoringAlertsEnrichment.ts`: 2 singletons → `AlertPubSub` cu canale [CORRECTED G3]

**Fisiere:**
- `backend/src/db/monitoringAlertsRepository.ts` (709 LOC) — `alertListenersByOwner` Map (line 112)
- `backend/src/db/monitoringAlertsEnrichment.ts:48` — `alertEnrichmentListenersByOwner` Map (NU `services/monitoring/alertsEnrichment.ts` cum spunea audit-ul original)

**Problema:** Doua Maps globale tin listeners SSE per owner. Ambele wired in **acelasi** SSE stream (`backend/src/routes/alerts.ts:694` + `:732`) cu pattern identic (per-owner cap, try/catch isolation, `queueMicrotask` deferral). La cutover web multi-process, alert emis pe instance A nu raze listeners conectati la instance B → SSE silently drop. Owner-scoping enforced doar la dispatch, nu la registration.

**De ce combinat (nu 2 interfete):** doua interfete separate ar duplica subscribe-before-ready gap-ul si ar necesita 2 subscriptii Redis la cutover. Pattern unic cu canale tipizate evita asta.

**Masuri propuse:**
1. **PR-1.T (3h)**: characterization tests — owner-scoping (instance A nu vede owner B), listener cleanup pe abort, subscribe-before-ready ordering, cap MAX_ALERT_SUBSCRIBERS_PER_OWNER=5, Map prune dupa ultimul unsubscribe, listener isolation (un throw NU break-uie restul).
2. **PR-1.I (4h)**: introdu interfata `AlertPubSub` cu canale tipizate:
   - `subscribe(channel: "alert" | "alert_enriched", ownerId: string, listener) → Unsubscribe`
   - `publish(channel: "alert" | "alert_enriched", ownerId: string, payload) → void`
   - Owner-scoping enforced **in semnatura non-optional**, NU la callsite.
   - **Subscribe trebuie sa intoarca `Promise<Unsubscribe>`** (nu sync) — contract pregatit pentru Redis async transport.
3. **PR-1.S (2h)**: swap ambele Maps cu instance DI-injected; factory `createAlertPubSub()` cu impl in-memory default. Routes `alerts.ts:686-732` migreaza la `await pubsub.subscribe(...)` inainte de ready frame.
4. **PR-1.C (1h)**: ADR in `PLAN-monitoring-webmode.md` documentand path Redis pub/sub + replay-on-reconnect via `Last-Event-ID` query DB pentru alerte din disconnect window.

**Invariants non-negotiable** (Claude Guard):
- subscribe fara ownerId in semnatura → RESPINGE PR
- `publish` apelat in interiorul `db.transaction(...)` → RESPINGE (must defer via `queueMicrotask` outside tx, vezi I4 + listener fanout deferred invariant)
- Cap MAX=5 enforce-uit INAINTE de `.add()` la set (vezi `monitoringAlertsRepository.ts:118+139-141`) — daca interfata throwneste DUPA add → memory leak

**LOC delta:** +80 net (interface + DI factory + tests, scade singletons scattered).
**Web-cutover impact:** elimina 1 din 3 blocker-i (impreuna cu P0-new + P2).

---

### P2 — `rnpm.ts`: `inflightRequests` Map → `IdempotencyStore` (sentinel-only, TTL parametrizat) [CORRECTED G1]

**Fisier:** `backend/src/routes/rnpm.ts` (1128 LOC; 3 dedup sites la `:202` `/search`, `:447` `/bulk`, `:571` `/search-split`)
**Problema:** Map global `inflightRequests<clientRequestId, Promise<Result>>` previne dublu-fire pentru cereri identice. La restart proces / multi-instance, dedup pierde efectul → al doilea captcha solve (~$0.05 each, pana la 200 itemi/bulk = ~$10 real money per click duplicat).
**Nuanta critica** (deep-review): Map-ul e **sentinel dedup-lock**, NU idempotency cache. NU promova la full result cache fara analiza explicita (TTL, ownership, stale-read).
**Nuanta sentinel per site** (deep-review #2): `/search` (`:228`) seteaza sentinel-ul la actual run promise; `/bulk` + `/split` (`:437-451`) seteaza sentinel-ul **synchronously la `Promise.resolve()`** inainte de `streamSSE` callback. Refactor unificat trebuie sa preserve aceasta diferenta — 3 caracterization tests separate per ruta.

**Corectie TTL (G1):** TTL hard-coded 120s ar expira mid-bulk pe operatii lungi (`SSE_TIMEOUT_MS = 5_400_000` / 90 min bulk; `SSE_SPLIT_TIMEOUT_MS = 2_700_000` / 45 min split). TTL trebuie **parametrizat per operatie**.

**Masuri propuse:**
1. **PR-2.T (1.5h)**: characterization — 2 cereri concurrente acelasi key asteapta; a doua dupa finalizare NU e cached; cleanup-on-error garantat; sentinel set BEFORE await yield (toate 3 site-uri); per-owner isolation (`ownerA:key` != `ownerB:key`).
2. **PR-2.I (2h)**: interfata `IdempotencyStore` cu:
   - `acquireLock(key: string, ttlMs: number) → Lock | null` (**ttlMs non-optional** — caller decide)
   - `releaseLock(lock)`
   - **NU** `cachedResult` — explicit sentinel-only.
3. **PR-2.S (2.5h)**: swap Map global pe toate 3 site-uri; TTL per site:
   - `/search`: `ttl = 120_000` (request scurt, ok)
   - `/bulk`: `ttl = SSE_TIMEOUT_MS + 60_000` (90 min + 1 min margine)
   - `/split`: `ttl = SSE_SPLIT_TIMEOUT_MS + 60_000` (45 min + 1 min)
   - Cleanup in finally garantat la toate 3.
4. **PR-2.C (1h)**: ADR explicit "NU cache rezultate, doar lock" + metric `idempotency_locks_active_count` + nota pentru cutover web: Redis `SET NX PX` cu value=`instance_uuid` pentru distinctie locks stale-de-self vs alta instanta.

**Invariant non-negotiable:** daca PR propune `cachedResult` in interfata → RESPINGE. Daca TTL ramane `120000` constant in toate site-urile → RESPINGE.

**LOC delta:** +35 net.
**Web-cutover impact:** elimina al 2-lea blocker web-readiness.

---

### P3 — `DosareTable.tsx`: 24-state god component → split [CORRECTED G4]

**Fisier:** `frontend/src/components/DosareTable.tsx` (837 LOC; audit initial spunea 747 LOC, fisier a crescut)
**Problema:** 24 useState mixaza selection, sort, pagination, modal, inline edit, AI analysis state, `viewedDosare` expansion tracking. Lipsa testelor face orice modificare risk-prone.

**Corectie G4:** premiza originala mentiona AI cache `useState(() => loadFromSessionStorage())` SSR-unsafe + invalidation `Date.now() - cachedAt > MAX_AGE` fara clock-skew. **Aceste lucruri NU EXISTA in cod**. `aiAnalysis` e plain `{}`, fara TTL, fara sessionStorage persistence. Singura cheie sessionStorage e `viewedDosare` (set de expanded row IDs). Refactor-ul ramane valid (24 state vars e real), dar tintele de test si invariantii se schimba.

**Masuri propuse (tinte de test corectate):**
1. **PR-3.T (3-4h, must-add)**: characterization tests pe ce **chiar exista**:
   - render 100 dosare fara crash; tabel returneaza `min(100, pageSize)` randuri
   - sort: dublu click pe header inverteaza directia; sort reseteaza page la 0
   - selection: single click adauga `numar` la set; header checkbox selecteaza all pe pagina curenta; deselect on second click
   - shift-click selection (atentie: contractul curent e DOAR within-page, NU cross-page — testul trebuie sa locheze acest contract)
   - expansion: row click persisteaza `numar` in `sessionStorage["viewedDosare"]`
   - page clamp: 30 dosare la pageSize=15, navigate page 2, reduce list la 10 → page reseteaza la 0
2. **PR-3.I (3h)**: extract `useAiAnalysisCache(cacheKey, options)` hook — TTL **simplu** (nu monotonic clock-skew, fara premiza existenta); SSR-safe init (defer in useEffect, NU useState initializer pentru sessionStorage).
3. **PR-3.S1 (2h)**: extract `<DosareAiPanel>` care foloseste hook nou.
4. **PR-3.S2 (2-3h)**: extract `<DosareTableContainer>` (data fetching + pagination). **Atentie:** acest PR va depasi 200 LOC; accepta cap 300-350 LOC sau sub-split in "container shell" + "pagination migration".
5. **PR-3.S3 (2h)**: restrange `<DosareTableBody>` la rendering pur.

**Invariant non-negotiable:** SSR-safe init (defer in useEffect) — daca apare `useState(() => sessionStorage...)` in noul cod → RESPINGE.

**LOC delta:** 837 LOC → 3 fisiere a ~280 LOC each. Maintainability ↑ semnificativ. **Net delta ~0** (split, nu reduction).
**Migration path:** zero breaking — API public `<DosareTable>` neschimbat (wrapper Container).

---

### P4 — `rnpmSearchService.ts`: 4 executoare → `PageFetcher` strategy

**Fisier:** `backend/src/services/rnpmSearchService.ts` (1019 LOC)
**Problema:** 4 functii executoare (`executeSearch`, `executeBulkSearch`, `executeSplitSearch`, **`executeNestedDestinationSplit`**) share ~70% logica. Adaugarea unei phase noi → 4 edituri paralele cu drift risk. Coverage gap: 2 din 4 fara unit tests.
**Critical** (deep-review): sunt **4 executoare, NU 3**. `executeNestedDestinationSplit` necesita acoperire separata pentru bulk searches cu split la 2 niveluri.

**Masuri propuse:**
1. **PR-4.T (3h, must-add)**: unit tests pe `executeSearch` (gcode retry, captcha provider race, split decision) apoi extend la celelalte.
2. **PR-4.I (2h)**: interfata `PageFetcher` + `SearchOrchestrator`. Cele 4 executoare devin thin wrappers ~30 LOC each.
3. **PR-4.S1/S2/S3 (4h total)**: migrate progresiv (search → bulk → split+nested).
4. **PR-4.C (1h)**: delete dead phase emitters.

**LOC delta:** 1019 → ~700 (-300 net).
**Invariant:** captcha sentinel dedup + per-slot diagnostic (din v2.27.5 perf fix) trebuie pastrate.

---

### P5 — Twin WHERE-builder: reconciliere semantica (NU dedup)

**Fisiere:**
- `backend/src/db/avizRepository.ts` (`getAvize` 181 LOC, 12-col single-token vs `filterRnpmSearchResults` 24-col multi-token AND)
- `backend/src/db/monitoringAlertsRepository.ts` (`listAlerts` row-set vs `selectAlertIdsByFilters` ID-set)

**Problema:** twin WHERE-builders par dedup dar reprezinta **reconciliere product-decision**:
- `getAvize` accepta 12 coloane, **single-token search** (LIKE %token%)
- `filterRnpmSearchResults` accepta 24 coloane, **multi-token AND** (toti tokenii match in oricare coloana indexata)

Unificare naiva ar **silently broaden** match surface pe `/saved` (12 → 24) sau ar restringe → false positives/negatives in productie.

**Masuri propuse (diferit de restul — NU pur engineering):**
1. **PR-5.T (3h, must-add)**: golden snapshot test — 500 randuri productie cu ambele functii, diff matrix pe ID-uri returnate → quantify divergence. Output → `audit/where-builder-divergence.md`.
2. **PR-5.D (2h, product decision)**: prezinta divergenta product owner. 3 path-uri:
   - **A) Pastreaza ambele** (decision: NO refactor, doc as-is)
   - **B) Unifica la 24-col multi-token** cu adapter 12-col lazy → broadens match surface, necesita feature flag
   - **C) Documenteaza intent diferent + rename clear** (`searchAvizSimple` vs `filterRnpmExtended`)
3. **PR-5.I (1-3h)** doar daca decizia este B sau C.

**Invariant non-negotiable**: daca PR incearca unifying fara golden snapshot + product sign-off → RESPINGE.

**LOC delta:** variabil (0 daca A, +50 daca C, -100 daca B).
**Migration path:** posibil breaking (B) — feature flag obligatoriu.

---

### P6-P11 — Refactor structural HIGH (sumar)

| # | Target | Masuri |
|---|--------|--------|
| **P6** | `Alerts.tsx` (888 LOC) | Extract `useAlertsStream(filters)` hook cu SSE + reconnect cu jitter; extract `AlertsFilterBar`, `AlertsBulkActions` |
| **P7** | `manual-content.tsx` (872 LOC, function 889 LOC) | Split `ManualContentLayout` + `ManualContentForm` + `ManualContentPreview`; extract `useManualContentDraft` |
| **P8** | `Monitorizare.tsx` (775 LOC, nesting 10) | Flatten cu early returns; extract `<JobStateBadge>`, `<JobActionsMenu>`, `<JobDetailCard>` |
| **P9** | `rnpm.ts` (1054 LOC, 17+ endpoints) | Split by domain (`rnpm.search.ts`, `rnpm.saved.ts`, `rnpm.admin.ts`, `rnpm.captcha.ts`); extract `withRnpmGuards(opts, handler)` middleware (consolideaza 53 ocurrente ale 4 helper-i inconsistent applied) |
| **P10** | `alerts.ts` (714 LOC, SSE 120 LOC handler) | Extract `lib/sseChannel.ts`; wrap dismiss-bulk in `db.transaction(...)` (better-sqlite3 sync) — actualmente fara rollback la crash partial |
| **P11** | `avizRepository.ts` (684 LOC) | Extract `buildAvizWhere(filters)` + `parseAvizRow(row)`. **NU unifica** cu `filterRnpmSearchResults` (vezi P5) |

---

### P12 — Cluster duplicare (A2) [CORRECTED G5]

**Sursa:** `audit/02-duplication.md` cluster 1-4
**Total LOC savings:** ~505 LOC (vs ~950 in audit original — D1 reduce la 5 LOC, D3 ajustat pentru `api.ts:370` already-exists).

| Cluster | Masura | Status |
|---------|--------|--------|
| D1: ~~Backend XLSX style scaffold~~ | ~~Extract `lib/xlsxBuilder.ts` builder API~~ **IMPOSIBIL**: backend foloseste `exceljs` (`cell.value`/`addRow`), frontend foloseste `xlsx-js-style` (`ws[addr]={t,v,s}`). Libraries fundamental incompatibile. **Singurul artefact share-abil:** regex `FORMULA_PREFIX = /^[=+\-@\t\r]/` in `lib/formulaPrefixRegex.ts` (5 LOC) + 2 teste invariant (backend + frontend) care verifica ca input `"=cmd|..."` iese cu prefix `'`. | **[CORRECTED G5]** -5 LOC (nu -250) |
| D2: Frontend jsPDF scaffold (~300 LOC) | Extract `lib/pdfBuilder.ts` (helper for table generation, headers, multi-page footer) | Valid, ~-200 LOC realist |
| D3: Frontend envelope unwrappers (~200 LOC) | `frontend/src/lib/api.ts:370-415` are deja `unwrapMonitoring` + `MonitoringEnvelopeOk`. **NU crea fisier nou** — **MOVE** existing impl into `lib/unwrapEnvelope.ts`, apoi re-import in `api.ts` + migrate restul callsite-urilor. | Valid cu nuanta, ~-150 LOC |
| D4: Repository `buildWhere` + pagination pattern (~200 LOC) | Extract `db/queryHelpers.ts` cu `buildOwnerScopedWhere(filters, columns)` + `applyPagination(query, opts)`. **Atentie:** `monitoringAlertsRepository.ts:345` foloseste `needsJobJoin` gating (LEFT JOIN conditional pe filter `q`/`jobKind`); naive helper care always-join regresseaza unfiltered list latency (path hot — alerts inbox open). Helper trebuie sa accepte `optionalJoins: Join[]` cu predicat. | Valid cu nuanta, ~-150 LOC |

**Atentie:** invariant I10 (XLSX formula-injection escape `=+-@\t\r` prefix `'`) ramane critic — testat in noul `formulaPrefixRegex.ts` cu input `"=CMD|..."` care trebuie sa iasa cu prefix `'`.

---

### P13 — Quick wins LOW-RISK (A5)

**Total saving:** ~80 LOC + behavior bonus (private-mode safety pe writes).

**Apply immediate (8 items, single-file, ~30 min total):**
1. Delete `formatDateTime` dead in `lib/utils.ts` (-5 LOC)
2. Collapse `describeNestedPhase` → alias `describeSplitPhase` (-20 LOC)
3. Simplify `readInitial()` in `alertsNotificationPref.ts` (-5 LOC)
4. Drop trailing `return;` in 2 middleware (-4 LOC; optional)
5. `RWLock.hasQueuedWriter()` → `Array.some` (-3 LOC)
6. `useTheme` → `classList.toggle(token, force)` (-3 LOC)
7. `useFontSize.loadStep` flatten + `Number.isInteger` (-1 LOC)
8. **Rate-limit middleware** — 4 inline envelope copies → `fail()` helper (-30 LOC, consistency win — toate celelalte middleware folosesc `fail()`)

**Batch in PR (4 grouped, ~1h):**
- B1: `clampLimit` / `clampOffset` repetate 3x → `clampInt(value, {min, max, default})` in `util/validation.ts` (-20 LOC)
- B2: `loadHistory`/`saveHistory` in `useSearchHistory` + `useRnpmHistory` → `_localStorageList.ts` shared (-15 LOC + private-mode safety bonus)
- B3: `stripDiacritics` frontend mirror → `frontend/src/lib/textNormalize.ts` (anchor convention; -6 LOC)
- B4: Periodic sweep helper in `rate-limit.ts` → `sweepExpired<T>(map, now)` (-10 LOC)

**Skip (intentional, vezi A5 sectiunea Skip):** backend/frontend `todayRo` duplicate (runtime split), per-source SQL pairs in dashboard, monitoring tenant guards.

---

### P14 — Dead code & deps cleanup (A6)

**Total:** ~110 LOC delete + 2 npm deps.

**Imediat (no risk, ~10 min):**
1. `npm uninstall date-fns react-day-picker --workspace=frontend` — ambele 0 referinte
2. `git rm frontend/src/components/DosarModal.tsx` (~80 LOC, componenta orfana, NU e linkata din router/dashboard/dosare-page)
3. Delete `rnpmExport(ids)` din `frontend/src/lib/rnpmApi.ts:356` (~25 LOC, inlocuita de `rnpmExportXlsxBlob`/`rnpmExportPdfBlob` server streaming)

**Drop export (PR separat "API surface tightening", ~15 min):**
- 4 simboluri pur internal: `PJPFToggle`, `PFBlock` (frontend), `CURATED_AUDIT_ACTIONS`, `AlertsDailyRow`, `RunsByDayStatusRow`, `RunsByStatusRow`, `AuthProvider` interface (backend)
- 4 simboluri exported-for-tests: `computeFilterFingerprint`, `buildSubject`/`buildHtmlBody`/`buildTextBody` — **pastreaza export + adauga `@internal` JSDoc**

**Verificare obligatorie inainte de delete:** `npx depcheck` + `npx knip --workspace frontend backend` + `npx tsc --noEmit` + `npm test`.

---

### ~~P15~~ — MERGED into P1 [CORRECTED G3]

**Path original (gresit in audit):** `backend/src/services/monitoring/alertsEnrichment.ts`
**Path real:** `backend/src/db/monitoringAlertsEnrichment.ts:48` (`alertEnrichmentListenersByOwner`)
**Decizie:** Nu mai e "rider" separat — e absorbit in P1 (interfata `AlertPubSub` cu canale tipizate `"alert" | "alert_enriched"`). Vezi P1 [CORRECTED] mai sus.

---

## 4. Sequencing recommendation (roadmap propus) [CORRECTED]

**Sprint 0 (fundatie, ~4h):**
- **PR-T0**: shared test infrastructure (`createTestDb`, `RnpmStubClient`, `renderDosareTable`)

**Sprint 1 (Wave 1 characterization — paralel, ~13.5h):**
- **PR-0.T** [ADDED] (scheduler cancel) + PR-1.T (AlertPubSub, combina P15) + PR-2.T (rnpm dedup, 3 sites) + PR-3.T (DosareTable, **tinte corectate G4**) + PR-4.T (executeSearch + I1/I3) + PR-5.T (WHERE snapshot)
- **PARALEL:** P14 dead code cleanup (~25 min) + P13 quick wins immediate (~30 min)

**Sprint 2 (Wave 2 interface extraction — paralel cross-target, ~14h):**
- **PR-0.I** [ADDED] + PR-1.I (cu canale tipizate, **subscribe → Promise<Unsubscribe>**) + PR-2.I (ttlMs parametrizat) + PR-3.I + PR-4.I
- PR-5.D (product decision, **time-boxed**: daca fara sign-off pana la sfarsit sprint → path A default, NU blocker open-ended)

**Sprint 3 (Wave 3 implementation swap — per target, ~20h):**
- **PR-0.S** [ADDED] + PR-0.C (scheduler cancel signal, gated `USE_CANCEL_SIGNAL=1`)
- PR-1.S + PR-1.C (AlertPubSub swap, **gated `USE_ALERT_PUBSUB=1`**, include both Maps)
- PR-2.S + PR-2.C (IdempotencyStore swap, **gated `USE_IDEMPOTENCY_STORE=1`**, all 3 sites)
- PR-3.S1/S2/S3 (DosareTable split — atentie: PR-3.S2 va depasi 200 LOC, accepta 300-350)
- PR-4.S1/S2/S3 + PR-4.C (rnpmSearchService migration, preserve I1+I2+I3)
- PR-5.I (conditional pe PR-5.D)

**Sprint 4 (cleanup HIGH ramas + clusters duplicare, ~25h):**
- P6 (Alerts.tsx) + P7 (manual-content) + P8 (Monitorizare) + P9 (rnpm.ts split — **dupa P2.S** ca sa nu duplica replace-uri singleton in 4 fisiere) + P10 (alerts.ts SSE) + P11 (avizRepository) + P12 (**D1 redus la formulaPrefixRegex.ts**)

**Total grand:** ~76h staged peste 24-26 PR-uri (de la 70h / 22 PR — +6h pentru PR-0 nou + corectiile G1-G5).

### Path minim cutover web (cea mai sigura prima livrare)

**Sprint 0 + Sprint 1 (PR-0.T + PR-1.T + PR-2.T) + Sprint 2 (PR-0.I + PR-1.I + PR-2.I) + Sprint 3 (PR-0.S/.C + PR-1.S/.C + PR-2.S/.C)** = **~22h** total, 3 blocker-i web-cutover inchisi cu feature flags, zero UX changes, rollback trivial (`git revert <sha>`).

---

## 5. Workflow per PR (Claude Guard, obligatoriu) [EXTENDED post-validation]

1. `npx biome check --write <files>` + re-stage daca biome reformat
2. `npx tsc --noEmit -p backend/tsconfig.json` + `cd frontend && npx tsc --noEmit`
3. `npm test --workspace=backend` (+ frontend cand atinge `frontend/`)
4. `npm run build` (esbuild + Vite sanity)
5. `npm run electron:dev` → golden path + 1 edge case pe pagina afectata; documenteaza in commit message
6. Update memory file dedicat daca PR introduce conventie noua

**Additions post-validation (refactor-planner):**

7. **Feature flag gate** pentru orice swap singleton (PR-*.S): default off prima release, flip pe on in urmatorul release. Env vars: `USE_ALERT_PUBSUB`, `USE_IDEMPOTENCY_STORE`, `USE_CANCEL_SIGNAL`.
8. **Rollback note** in commit message: "rollback: git revert <sha>, no migration down, no data fix required."
9. **Cross-platform smoke** la sprint boundary (nu per-PR): `npm run dist:mac` pe runner macOS inainte de tag, specific pentru PR-uri care ating SSE / process-level singletons (Electron SIGTERM differs).
10. **Lint gate CI**: dupa Sprint 2, adauga in workflow `grep -rn "Map<.*ownerId" backend/src/ && exit 1 || true` ca sa blocheze reintroducerea pattern-ului singleton.

---

## 6. Risc register [EXTENDED post-validation]

| Risc | Severity | Mitigation |
|------|----------|------------|
| Twin WHERE-builder silent broadening | HIGH | PR-5.T golden snapshot + product sign-off **OBLIGATORY**, **time-boxed** la durata Sprint 2 (fallback path A) |
| AlertPubSub multi-channel scope creep | MED | Mentine impl in-memory; Redis impl la cutover, nu acum |
| IdempotencyStore TTL leak / **TTL prea scurt mid-bulk (G1)** | HIGH | TTL **parametrizat per operatie** (NU constant 120s); `/bulk`+`/split` necesita `>= SSE_TIMEOUT_MS + 60s` |
| DosareTable behavior regression | HIGH | PR-3.T characterization 3-4h **OBLIGATORY** inainte de split; tinte corectate (NU AI cache MAX_AGE) |
| AI-branch collision pe `routes/ai.ts` | NIL | Branch `feat/openrouter-toggle-stacks` mergat in main la v2.28.1; AI files raman intangible in scope |
| Captcha sentinel dedup regression | MED | PR-2.T trebuie 3 teste separate per ruta (`/search`, `/bulk`, `/split`) — timing sentinel diferit |
| XLSX formula-injection escape pierdut la extract scaffold (P12) | MED | Invariant I10 — test snapshot in noul `lib/formulaPrefixRegex.ts` cu input `"=CMD\|..."` |
| **Scheduler cancellation cross-instance lost (G2 — adaugat)** | HIGH | PR-0-new (`JobCancellationSignal` distributed lock claim) blocheaza cutover daca lipseste |
| **Subscribe-before-ready gap la transport async (post-validation)** | MED | `AlertPubSub.subscribe()` trebuie `Promise<Unsubscribe>` (NU sync); `await` inainte de ready frame; replay via `Last-Event-ID` pentru disconnect window |
| **P12/D1 unificare XLSX imposibila tehnic (G5)** | NIL (after correction) | Reduced la `formulaPrefixRegex.ts` 5-LOC + 2 teste invariant |
| **Owner-scoping invariants in WHERE builders (I4 + I-join-gate + I-defense-in-depth)** | HIGH | Helper `buildOwnerScopedWhere` trebuie sa accepte `optionalJoins: Join[]` cu predicat owner pe ambele tabele; testat cu manually-injected misowned FK |
| **OPENROUTER_DISABLED fallback reintrodus (I5)** | HIGH | Daca P-anything refactor wrap-uieste `callOpenRouter` in try/catch → RESPINGE PR |

---

## 6.5. Hidden invariants (deep-code-reviewer) [ADDED post-validation]

17 invariants ascunse care nu sunt explicit in audit-ul original. Top 5 cu impact mare prezentate in Errata G1-G5; restul de 12 mai jos. Fiecare cu file:line + ce strica daca refactor-ul le dropeaza + assertion minimala.

**Invariants P0+P1 (scheduler + alerts):**
- **I4** (cross-tenant write guard): `insertAlert` ruleaza `(jobId, ownerId)` tenant pre-check INSIDE `db.transaction(...)` (`monitoringAlertsRepository.ts:218-223`). `UNIQUE(job_id, dedup_key)` NU e owner-scoped. Pre-check refuza scrieri cross-tenant care DB schema le-ar permite. *Assertion:* `insertAlert({jobId: <other-tenant>, ownerId: "A"})` arunca.
- **I-fanout** (deferred publish): listener fanout in `monitoringAlertsRepository.ts:264-275` foloseste `queueMicrotask` ca sa ruleze AFTER `db.transaction` commit. Interfata `AlertPubSub.publish()` apelata in interiorul transaction reintroduce back-pressure. *Assertion:* spy on `db.transaction` boundary; `listener` invocations strict-after commit.
- **I-cap** (subscriber cap): MAX_ALERT_SUBSCRIBERS_PER_OWNER=5; check `.size >= MAX` precede `.add()` (`monitoringAlertsRepository.ts:118+139-141`). Refactor cu cap dupa add → memory leak la throw. *Assertion:* subscribe care arunca cap error lasa `getAlertSubscriberCount(owner) === cap`, NU `cap+1`.

**Invariants P2 (rnpm inflight, dincolo de TTL):**
- **I-sentinel-timing**: `/bulk` + `/split` seteaza sentinel SYNCHRON la `Promise.resolve()` inainte de `streamSSE` callback (`rnpm.ts:437-451`); `/search` seteaza la actual promise (`:228`). Refactor care unifica timing-ul breaks dedup pe unul din path-uri. *Assertion:* 3 teste separate per ruta, sentinel exists before any await yield.

**Invariants P4 (rnpmSearchService):**
- **I1** (cross-tenant precheck `existingSearchId`): `searchBelongsToOwner` (`rnpmSearchService.ts:108-110`). Fara el, tenant poate atasa avize pe parent search row al altui tenant. *Assertion:* `executeSearch({existingSearchId: <other-owner>})` arunca `RnpmError(403)`.
- **I2** (`withMaintenanceRead` bracket-uieste DOAR SQLite write, NU HTTP fetch): `rnpmSearchService.ts:284`. Comentariu explicit. Wrap unificat `fetch + persist` regresseaza abort responsiveness + restore-coordination. *Assertion:* `restoreFromBackup` poate incepe in timpul detail fetch, dar NU in timpul `saveAvizFull`.
- **I3** (`consecutiveSilentRefusals` reset semantics): reset pe `total=0` (`:639`), pe success-with-docs (`:681`), pe `limit_exceeded` (`:690`). NU reset pe transient errors. Naive reset → break fail-fast budget. *Assertion:* `[empty,empty,error,empty]` NU fail-fast (counter cap-uit la 2); `[silent,silent,silent]` DA.
- **I-captcha** (`captchasUsed` accumulated from `result.captchasUsed`, never pre-incremented): `rnpmSearchService.ts:673,787,979`. Refactor cu pre-increment outer-layer → under-count retries → cost banner gresit. *Assertion:* `[gcode-expired → retry]` produce counter `1 (initial) + N (retries)`.
- **I-final-update**: `updateSearchTotal(...)` in split's `finally{}` (`rnpmSearchService.ts:846-849`). Pe abort/timeout, parent search reflecta partial state. Refactor care muta in `try` → history shows 0 in loc de partial; "Grupul K" 499-with-searchId recovery (`routes/rnpm.ts:252`) breaks.

**Invariants P11+P12 (avizRepository + clusters):**
- **I-join-gate**: `needsJobJoin` LEFT JOIN conditional pe filter `q`/`jobKind` (`monitoringAlertsRepository.ts:345-346, 670-671`). Naive `buildOwnerScopedWhere` cu always-join regresseaza unfiltered list latency. *Assertion:* `EXPLAIN QUERY PLAN` pe filterless `listAlerts` contine 1 scan, NU 2.
- **I-defense-in-depth**: JOIN condition include `j.owner_id = a.owner_id` (`monitoringAlertsRepository.ts:346`). Generic helper care produce `WHERE a.owner_id = ?` + separate LEFT JOIN drops al 2-lea predicat. *Assertion:* inject row cu `monitoring_alerts.owner_id='A'` + `monitoring_jobs.owner_id='B'`; `listAlerts({ownerId:'A', q:'...'})` NU surface tenant B's `target_json`.

**Invariants cross-cutting (AI + secrets + URL):**
- **I5** (`OPENROUTER_DISABLED=1`): `ai.ts:487-489` arunca in `callOpenRouter`, NU in `callModel`. Throw propaga, NO try/catch fallback. Orice "resilience refactor" wrap → bug v2.28.0 reintrodus. *Assertion:* `OPENROUTER_DISABLED=1` + model Anthropic-routable → `callModel` reject, NU silent success via Anthropic.
- **I-chinese-tokens**: `AI_MAX_TOKENS_CHINESE = 16000` flows DOAR prin `effectiveOpenRouterMaxTokens(stack)` (`ai.ts:101-105 + 614-624`). Native callers (`callAnthropic`, `callOpenAI`, `callGoogle`) hard-code 8000. Refactor care unifica max tokens la `callModel` regresseaza chinese stack (Kimi K2.6 truncates with `finish_reason="length"`). *Assertion:* `callModel("kimi-k2.6", ...)` cu `routing.stack='chinese'` produce OpenRouter call cu `max_tokens >= 16000`.
- **I-backup-order**: `hasPendingSchemaMigrations(dbPath)` ruleaza BEFORE `new Database(...)` (`backend/src/db/schema.ts:84-86`). Copy `fs.copyFileSync` cu DB inca inchis = atomic. Refactor cu lazy-open inainte de check → backup pe DB open-with-uncheckpointed-WAL. *Assertion:* order `preMigrationBackup → new Database → runMigrations` preserved; no DB handle open when backup runs.
- **I-safestorage**: `safeStorage` IPC encrypts la renderer boundary (`electron/main.js:275-291` + `frontend/src/hooks/useApiKey.ts:151-171`). Cleartext in renderer memory ONLY; localStorage tine ciphertext (`ENC_KEY = "portaljust-api-keys-enc"`). Refactor "tidier" dialog care persisteaza `keys` state direct in localStorage (forgetting `persist()`) scrie cleartext la disk. *Assertion:* pe orice `setKey/setKeys`, `localStorage.getItem(ENC_KEY)` difera de `JSON.stringify(keys)` (ciphertext, never plaintext).
- **I-url-whitelist**: 5 hosts in `electron/main.js:422-428` ONLY (single-source pentru `shell.openExternal`). `parsed.hostname` cu `Array.includes`, NU regex/suffix. *Assertion:* `shell.openExternal` never invoked cu `evil.portal.just.ro` sau `portal.just.ro.evil.com`.

---

## 7. AI-branch (NU se atinge) [post-merge v2.28.1]

Plan curent **NU intersecteaza** `feat/openrouter-toggle-stacks` (mergat in main la v2.28.1 ca 3159d7f). Toate fisierele AI sunt acum in main si raman intangible in scope-ul refactor. Exceptia: `backend/src/routes/ai.ts` (M15 in A3) — flagged dar NU propunem refactor in acest val (atentie I5+I-chinese-tokens).

---

## 8. Verdict final [CLOSED 2026-05-17 - v2.28.3]

**Stare codebase:** OK **Sanatos cu datorie tehnica concentrata DEFERRED.**

Auditul a fost validat cu 5 agenti specializati (refactor-planner, backend-reliability,
release-readiness, deep-code-reviewer, test-architect) inainte de v2.28.3. Concluzii:

### Tier 3 - Web cutover blockers: DEFERRED

P0-new (scheduler), P1 (AlertPubSub), P2 (IdempotencyStore) NU sunt blocker-i sub
topologia declarata in `PLAN-monitoring-webmode.md`:

- SQLite + Litestream forever = single-writer prin fizica
- <100 useri interni = 1 replica suficient
- Singletoni corecti pe single-instance

**Trigger reactivare:** decizie active-active (>1 replica simultan) sau >500 useri
activi simultan. Pana atunci, codul actual e correct, fara latent bugs in deployul tinta.

### Tier 4 - God components: DEFERRED + 4 erori factuale identificate

- P3 S1/S2/S3: `useAiAnalysisCache` NU EXISTA in cod (errata G4). DosareTable e deja
  decomposed cu 4 hooks + AI panel sibling (`DosareAiAnalysisPanel`).
- P6 Alerts.tsx SSE: hook-ul deja exista in `frontend/src/hooks/useAlertsStream.ts:112-183`
  cu reconnect exponential corect. Audit-ul a citat fisierul gresit.
- P7 manual-content.tsx: JSX static, zero state/effect. Category error.
- P10 alerts.ts dismiss-bulk: tranzactia EXISTA deja la `monitoringAlertsRepository.ts:574`
  (wraps loop-ul de chunk-uri in `db.transaction`). Bug-ul nu exista.
- P11 avizRepository.ts: `buildAvizWhere` L462 vs L629 acopera coloane diferite
  (12 vs 24) - NU duplicare.

**Restul P-urilor (P3/P4/P6/P8/P9):** "Revisit on touch" - split numai cand
schimbarea functionala loveste fisierul respectiv.

### Livrat in v2.28.3 (refactor closeout)

- Drop-export cleanup pe 7 simboluri (`audit/06` sectiunile 5+7)
- `withRnpmGuards` middleware (helper opt-in): 3 rute RNPM (`/search`, `/bulk`,
  `/search-split`) consolidate pe acelasi pattern web-gate → JSON → captchaKey.
  **Auth-drift hazard ramane PARTIAL OPEN** — guard-ul e helper, NU middleware
  router-level; un endpoint viitor poate uita sa-l apeleze. Pentru enforcement
  structural ar fi nevoie de `rnpmRouter.use("/captcha-routes/*", withRnpmCaptchaGuards)`
  sau mutare a 3 rute sub un sub-router dedicat — deferred ca datorie tehnica.
- 3 teste de characterizare pe invariants I1/I3/I-final-update din rnpmSearchService

**Effort total livrat:** ~3-4h.
**Effort total economisit prin defer:** ~60h (Tier 3 22h + Tier 4 ramas 38h).

---
## 9. Surse (audit/ folder)

| Fisier | Rol |
|--------|-----|
| `audit/01-inventory.md` | A1 — hot-spot map (204 fisiere, 40.7K LOC, risk flag per file) |
| `audit/02-duplication.md` | A2 — 12 clustere duplicare, ~1555 LOC savings |
| `audit/03-architecture.md` | A3 — top-10 deep review, 2 CRITICAL / 13 HIGH / 15 MED / 9 LOW |
| `audit/04-refactor-plans.md` | A4 — `/refactor-review` skill (4 agenti: planner + reviewer + tester + guard) cu Combined Refactor Plan |
| `audit/05-quick-wins.md` | A5 — 8 immediate + 4 batched + 5 skipped, ~120 LOC saving net |
| `audit/06-dead-code.md` | A6 — 2 deps + 1 componenta orfana + 1 functie dead + 9 drop-export candidates |
| `audit/AUDIT-REFACTOR.md` | **Acest fisier** — prezentare unitara cu masuri propuse |
