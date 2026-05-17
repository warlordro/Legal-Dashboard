# A3 — Architecture & God Component Audit

**Generated:** 2026-05-16
**Scope:** rigorous deep-code review pe top 10 candidate (sectiunea 1 din `AUDIT-REFACTOR-PLAN.md`)
**Exclusions:** AI-branch files (migrations 0023/0024, `ownerAiSettingsRepository.{ts,test.ts}`, `PLAN-openrouter-toggle.md`, `CODEX-TASK-openrouter-toggle.md`)

## Severity rollup

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH     | 13 |
| MED      | 15 |
| LOW      | 9 |

---

## CRITICAL findings

### C1 — `monitoringAlertsRepository.ts`: singleton `alertListenersByOwner` Map blocheaza multi-process deploy
**File:** `backend/src/db/monitoringAlertsRepository.ts`
**Severity:** CRITICAL (web-readiness blocker)
**Issue:** Map global in process tine listeners SSE per owner (`alertListenersByOwner: Map<string, Set<Listener>>`). La cutover web cu >1 instanta backend (Node cluster, Litestream, k8s), un alert emis pe instance A nu raze listeners-i conectati la instance B → SSE silently drop.
**Concerne secundare:**
- Lifecycle listener nu garanteaza unsubscribe la SSE disconnect (req.signal abort)
- Set<Listener> nu are backpressure — daca un client lent, accumulare event-uri in callback
- Owner-scoping este enforced la dispatch, dar nu la registrare → daca un caller uita `ownerId`, listener primeste evenimente cross-tenant
**Recommendation:** extract `AlertPubSub` interface; in-memory impl pentru Electron, Redis pub/sub pentru web. Owner-scoping obligatoriu in tipajul interfetei (`subscribe(ownerId, listener)`).

### C2 — `rnpm.ts`: singleton `inflightRequests` Map dedup-lock evapora la restart
**File:** `backend/src/routes/rnpm.ts`
**Severity:** CRITICAL (web-readiness blocker)
**Issue:** Map global `inflightRequests<clientRequestId, Promise<Result>>` previne dublu-fire pentru cereri RNPM identice. La restart proces (deploy rolling, OOM, healthcheck restart), in-flight requests pierdute → client retry cu acelasi `clientRequestId` declanseaza al doilea captcha solve (cost real). In multi-instance, dedup nu functioneaza cross-instance.
**Nuanta importanta (din deep-review):** Map-ul e **sentinel dedup-lock**, NU un idempotency cache. Nu cache-uieste rezultatul; doar previne paralel pe acelasi key cat timp promise-ul e in zbor. Refactor-ul nu trebuie sa-l "promoveze" la idempotency store fara analiza explicita a cerinte (TTL, cleanup, ownership).
**Recommendation:** extract `IdempotencyStore` interface cu metode `acquire(key, ttl) → Lock | null` + `release(key)` + opt-in `cachedResult(key)`. Impl in-memory pentru Electron, Redis SET NX EX pentru web. TTL explicit (~120s) + cleanup la failure.

---

## HIGH findings

### H1 — `rnpmSearchService.ts`: 4 executoare aproape-duplicate
**File:** `backend/src/services/rnpmSearchService.ts`
**Severity:** HIGH
**Issue:** 4 functii executoare (`executeSearch`, `executeBulkSearch`, `executeSplitSearch`, `executeNestedDestinationSplit`) share ~70% logica: list page fetch + details concurrency + captcha retry + emit SSE phase + persist. Adaugarea unei phase noi (ex. `cache-warmup`) impune 4 edituri paralele cu drift risk. Test coverage: doar 2 din 4 au unit tests dedicate.
**Recommendation:** extract `PageFetcher` strategy interface (fetch list page + decide split/no-split) + `SearchOrchestrator` care primeste fetcher si emit-uie phase-urile. Cele 4 executoare devin thin wrappers (~30 LOC each).

### H2 — `DosareTable.tsx`: god component 24 useState + sessionStorage init bug + clock-skew heuristic
**File:** `frontend/src/components/DosareTable.tsx`
**Severity:** HIGH
**Issue:** 747 LOC, 24 useState, mixaza:
- Selection state (selectedIds, lastClickedId pentru shift-select)
- AI analysis cache + lifecycle (sessionStorage key, expire heuristic pe clock skew)
- Sorting + pagination + filter
- Modal state (expand row, export modal)
- Inline edit state
**Bug-uri concrete identificate:**
- `useState(() => loadFromSessionStorage())` ruleaza pe SSR/hydrate inainte ca window sa existe in unele test setups
- AI cache invalidation foloseste `Date.now() - cachedAt > MAX_AGE` fara clock-skew protection (utilizator schimba ora system → cache permanent stale sau permanent valid)
**Recommendation:** split in 3 componente:
1. `DosareTableContainer` (data fetching + pagination)
2. `DosareTableBody` (sortable rows, selection)
3. `DosareAiPanel` (AI cache + analysis, deja partial extras in `dosare-ai-analysis-panel.tsx`)
Extract `useAiAnalysisCache` hook cu lifecycle clar.

### H3 — `Alerts.tsx`: god component 18+ useState, missing ErrorBoundary, busy SSE reconnect
**File:** `frontend/src/pages/Alerts.tsx`
**Severity:** HIGH
**Issue:** 888 LOC pagina, 18+ useState (filter, selectie, modal, export, bulk dismiss, SSE state, last-fetch timestamp etc.). SSE reconnect logic inline, fara backoff exponential — daca backend cade, refresh loop bate API cu retry imediat.
**Recommendation:** extract `useAlertsStream(filters)` hook (SSE + reconnect cu jitter + listener cleanup), `AlertsFilterBar`, `AlertsBulkActions`, `AlertsExportModal` deja extras.

### H4 — Twin WHERE-builder NU este simpla dedup
**Files:** `backend/src/db/monitoringAlertsRepository.ts` (`listAlerts` + `selectAlertIdsByFilters`), `backend/src/db/avizRepository.ts` (`getAvize` + `filterRnpmSearchResults`)
**Severity:** HIGH (semantic divergence)
**Issue critic (din deep-review):** twin WHERE-builder pare duplicare dar reprezinta de fapt **reconciliere product-decision**:
- `getAvize` accepta 12 coloane, **single-token search** (LIKE %token%)
- `filterRnpmSearchResults` accepta 24 coloane, **multi-token AND** (toate tokenii match in oricare coloana indexata)
- `listAlerts` vs `selectAlertIdsByFilters` au scope-uri ID-set vs row-set diferite
Unificare naiva ar **silently broaden** match surface-ul pentru `/saved` (12-col → 24-col) sau ar restringe-o → false positives / negatives in productie.
**Recommendation:** NU unifica fara product owner sign-off. Daca se face: scrie test de echivalenta semantica pre-refactor (golden snapshot pe dataset de productie).

### H5 — `rnpm.ts`: 17+ route handlers, mixed validation/orchestration/IO
**File:** `backend/src/routes/rnpm.ts`
**Severity:** HIGH
**Issue:** Encapsuleaza 17+ endpoint-uri (/search, /bulk, /saved, /captcha/balance, /compact, /detail/:id etc.) cu validare zod inline, orchestration call la service, response envelope, error mapping. Functii pana la 232 LOC. 53 ocurrente ale 4 guard helpers (`assertCaptchaProvider`, `rejectCaptchaKeyInWebMode`, `requireSearchKey`, `getRnpmConfig`) — inconsistent applied.
**Recommendation:** split by domain (`rnpm.search.ts`, `rnpm.saved.ts`, `rnpm.admin.ts`, `rnpm.captcha.ts`). Extract `withRnpmGuards(opts, handler)` middleware care aplica guard-urile o data si tipajul propagat in handler.

### H6 — `alerts.ts`: SSE handler 120 LOC, dismiss-bulk fara transaction rollback
**File:** `backend/src/routes/alerts.ts`
**Severity:** HIGH
**Issue:** SSE handler concentreaza setup + heartbeat + listener subscribe + cleanup + error handling. Dismiss-bulk pe `mode: filters` query intern face SELECT IDs apoi UPDATE — fara transaction → daca crash intre cei doi pasi, alerts dismissed partial fara audit log.
**Recommendation:** wrap dismiss-bulk intr-un `db.transaction(() => { ... })` (better-sqlite3 sync). Extract SSE plumbing in `lib/sseChannel.ts`.

### H7 — `manual-content.tsx`: function 889 LOC, mixed page + form + preview + persist
**File:** `frontend/src/pages/manual-content.tsx`
**Severity:** HIGH
**Issue:** Single function component cu 889 LOC, mixaza routing, form draft state, validation, preview render, persist API call, toast handling.
**Recommendation:** split in `ManualContentLayout`, `ManualContentForm`, `ManualContentPreview`. Extract `useManualContentDraft` hook.

### H8 — `Monitorizare.tsx`: nesting 10, function 741 LOC
**File:** `frontend/src/pages/Monitorizare.tsx`
**Severity:** HIGH
**Issue:** Top-level page render functie cu nesting 10 (conditional render-uri imbricate pentru job state x detail card x action menu).
**Recommendation:** flatten cu early returns + extract `<JobStateBadge>`, `<JobActionsMenu>`, `<JobDetailCard>`.

### H9 — `avizRepository.ts`: 14 functii, getAvize 181 LOC
**File:** `backend/src/db/avizRepository.ts`
**Severity:** HIGH
**Issue:** Repository mixaza CRUD + complex search (getAvize 181 LOC cu 12 column filter builder + pagination + JSON parsing inline).
**Recommendation:** extract `buildAvizWhere(filters)` helper + `parseAvizRow(row)` mapper. NU unifica cu `filterRnpmSearchResults` (vezi H4).

### H10 — `RnpmSearchForm.tsx`: 4 functii, una 702 LOC
**File:** `frontend/src/components/rnpm/RnpmSearchForm.tsx`
**Severity:** HIGH
**Issue:** Form CNP/CUI/Nume cu validation + history + suggestions + autosave + submit handling intr-o singura functie.
**Recommendation:** extract `useRnpmSearchForm` hook + `<CnpInput>`, `<CuiInput>`, `<NameInput>` cu validare per camp.

### H11 — `monitoringAlertsEnrichment.ts`: alt singleton cache neidentificat ca multi-instance hazard
**File:** `backend/src/services/monitoring/alertsEnrichment.ts`
**Severity:** HIGH (web-readiness)
**Issue:** Tin enrichment cache in-memory (job metadata, dosar references) pentru a evita lookup-uri repetate. La multi-instance, cache divergent → enrichment partial pe alerts emise cross-instance.
**Recommendation:** acelasi `AlertPubSub` refactor de la C1 trebuie sa acopere si invalidation enrichment cache (event "job-updated" → toate instantele invalidate cache local).

### H12 — Subscribe-before-ready ordering ne-documentat in SSE setup
**File:** `backend/src/routes/alerts.ts` (`GET /api/v1/alerts/stream`)
**Severity:** HIGH (race condition latent)
**Issue:** Handler-ul SSE subscribe la `monitoringAlertsRepository` listener inainte de a flush header-ele HTTP. Daca un alert e dispatched in fereastra dintre subscribe si headerFlush, listener-ul primeste eventul dar `res.write()` panicheaza (response not yet started). Refactorul AlertPubSub trebuie sa pastreze ordering-ul "subscribe inainte de ready signal".
**Recommendation:** documenteaza explicit ordering-ul in interfata AlertPubSub. Test characterization inainte de refactor.

### H13 — Phase enum-uri RNPM netranslate in UI cativa locuri
**File:** `frontend/src/components/rnpm/RnpmResultsTable.tsx`
**Severity:** HIGH (CLAUDE.md cross-stack convention)
**Issue:** Cateva locuri raw enum token (ex. `search_retry`, `nested_split_in_progress`) ajung in DOM fara translate prin `frontend/src/lib/rnpmProgressPhase.ts`.
**Recommendation:** extinde `rnpmProgressPhase.ts` cu fallback handler care logheaza `console.warn("unmapped phase: <token>")` in dev.

---

## MED findings (15 items, summarized)

| # | File | Issue | Fix sketch |
|---|------|-------|------------|
| M1 | `RnpmResultsTable.tsx` (567 LOC) | Inline row formatting + JSX duplicate pentru export vs preview | Extract `<RnpmResultRow>` |
| M2 | `RnpmSavedData.tsx` (508 LOC) | Sort + filter inline, 11 functii | Extract `useSavedFilter` hook |
| M3 | `dosare-ai-analysis-panel.tsx` (522 LOC) | Mixed state + render + AI call orchestration | Extract `useDosareAiAnalysis` |
| M4 | `rnpmExportXlsx.ts` (519 LOC, 14 functii) | XLSX style scaffold duplicat per sheet | Vezi cluster A2 D1 |
| M5 | `MonitoringBulkImportCard.tsx` (568 LOC) | Upload + parse CSV + preview + submit inline | Extract `useCsvImport` |
| M6 | `scheduler.ts` (392 LOC) | Long claim loop cu mixed scheduling + dispatching | Extract `ClaimDispatcher` |
| M7 | `App.tsx` (367 LOC) | Routing + error boundary + provider stacking inline | Extract `<AppProviders>` |
| M8 | `Sidebar.tsx` (418 LOC) | Hardcoded nav items + role-based filter inline | Extract `useNavItems` |
| M9 | `RnpmBulkSearch.tsx` (456 LOC) | Bulk paste parser + preview + submit | Extract `useBulkParse` |
| M10 | `TermeneTable.tsx` (375 LOC) | Sort + filter + render duplicate cu `DosareTable` | Extract shared `useTableSort` (deja exists?) |
| M11 | `Charts.tsx` (314 LOC) | 8 chart variants, repetitive Recharts config | Extract `<MetricChart variant="...">` |
| M12 | `ApiKeyDialog.tsx` (303 LOC) | Form + validate + persist + safeStorage | Extract `useApiKeyDraft` |
| M13 | `backup.ts` (323 LOC, 15 functii) | OK responsability-wise dar 15 functii indica missing private/public separation | Move private helpers in `backup.internal.ts` |
| M14 | `SearchForm.tsx` (334 LOC) | Generic search form cu 6 functii inline | Extract `useSearchSubmit` |
| M15 | `routes/ai.ts` (306 LOC, nesting 9) | Provider switch hardcoded (OpenAI/Anthropic/Google) — collision potentiala cu PLAN OpenRouter | **FLAG: intersecteaza zona AI** — NU propunem refactor, asteapta `feat/openrouter-toggle-stacks` merged |

---

## LOW findings (9 items, summarized)

LOW = naming, micro-duplication, inconsistencies care pot fi prinse in batch quick-wins (Agent A5).

| # | File | Issue |
|---|------|-------|
| L1 | `frontend/src/lib/rnpmApi.ts` | 22 functii, naming inconsistent (`fetchX` vs `getX` vs `loadX`) |
| L2 | `frontend/src/lib/utils/normalize.ts` | Duplicate normalizers (trim+lower+diacritic strip in 3 forme) |
| L3 | `backend/src/util/captchaSolver.ts` | Provider switch (2captcha vs CapSolver) cu cod aproape duplicat |
| L4 | Multiple files | `import { z } from "zod"` reordering inconsistent |
| L5 | `frontend/src/components/dashboard/Charts.tsx` | Hardcoded color palette inline (extract `chartColors.ts`) |
| L6 | `frontend/src/components/AlertsExportModal.tsx` | XLSX/CSV/PDF branches share filename builder | 
| L7 | `frontend/src/pages/Dosare.tsx` | useEffect cu dependency array stale lint disable inline |
| L8 | `backend/src/util/dateFormat.ts` | 3 formatters care wrap `date-fns` — candidat inline |
| L9 | `frontend/src/components/SearchForm.tsx` | `setState` callback evitabil (`setX(prev => prev + 1)` → `setX(x + 1)`) |

---

## Top-5 refactor priority shortlist

Selectati ca intersectie LOC × duplication × architecture-severity:

| Rank | Target | Severity | Estimat effort (incl. tests) | Owner risk |
|------|--------|----------|------------------------------|------------|
| 1 | `monitoringAlertsRepository.ts` singleton → `AlertPubSub` | CRITICAL | ~8h | Web cutover blocker; cross-cutting cu H11 (enrichment) si H12 (SSE ordering) |
| 2 | `rnpm.ts` `inflightRequests` → `IdempotencyStore` | CRITICAL | ~6h | Web cutover blocker; nuanta: sentinel dedup, NU full idempotency cache |
| 3 | `DosareTable.tsx` 24-state → 3-component split + `useAiAnalysisCache` | HIGH | ~10h | Bug-uri concrete identificate (sessionStorage init, clock skew); UI critic |
| 4 | `rnpmSearchService.ts` 4 executoare → `PageFetcher` strategy | HIGH | ~8h | Drift risk la fiecare phase noua; coverage gap |
| 5 | Twin WHERE-builder reconciliere semantica (NU dedup) | HIGH | ~6h + product sign-off | Risc silent broadening; necesita golden snapshot test |

Pasul urmator (Agent A4 — refactor-planner via /refactor-review): per fiecare target din top-5, plan staged + risk + test gap + LOC delta + migration path.

---

## AI-branch intersections flagged (NU propunem refactor)

- `backend/src/routes/ai.ts` (M15) — atinge provider switching care va fi refactorizat in `feat/openrouter-toggle-stacks`. Asteapta merge.
- Niciun alt target din top-10 nu intersecteaza zona AI.
