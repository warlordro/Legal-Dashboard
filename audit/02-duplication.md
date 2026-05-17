# 02 — Duplication Audit

Scope: `backend/src/**` + `frontend/src/**`. Read-only investigation.
Exclusions applied: test files, `frontend/src/data/changelog-entries.tsx`, `backend/src/db/migrations/**`, AI-branch additions (`0023_*`, `0024_*`, `ownerAiSettingsRepository.{ts,test.ts}`).

Twelve duplication clusters identified, each with concrete file:line evidence, extract proposal, LOC saved estimate, and refactor risk.

---

## Cluster 1 — HTTP response envelope: legacy `c.json({ error })` vs `ok/fail`

**Pattern.** `backend/src/util/envelope.ts` (lines 21-67) defines `ErrorCodes`, `ok(data, c)`, `fail(code, message, c, details?)` for the standard `{ data, error?, requestId }` envelope used post-PR-3. However, legacy routes (`dosare.ts`, `termene.ts`) still emit raw `c.json({ error: "..." }, status)` — 16 instances in `dosare.ts` alone. The frontend then needs THREE different unwrappers to cope:

- `frontend/src/lib/api.ts:30-60` — `unwrapMonitoring<T>(res)` (EnvelopeOk / EnvelopeError narrowing).
- `frontend/src/lib/alertsApi.ts:34-78` — local `unwrapAlerts<T>` (verbatim near-copy of unwrapMonitoring).
- `frontend/src/lib/rnpmApi.ts:170-260` — `jsonOrThrow<T>` with custom legacy-vs-v2.14.0 envelope branching.

**Occurrences.**
- `backend/src/routes/dosare.ts:24,43,46-53,95-100,118,124,179,189,193,199,205,214` — 16 raw `c.json({ error })` calls.
- `backend/src/routes/termene.ts` — same legacy pattern (per envelope.ts comment).
- `backend/src/util/envelope.ts:14-16` (intent explicitly documented: "dosare, termene, rnpm, ai intentionally remain as-is until PR-6").
- `frontend/src/lib/api.ts:30-60` vs `frontend/src/lib/alertsApi.ts:34-78` — duplicate unwrappers.
- `frontend/src/lib/rnpmApi.ts:170-260` — third unwrapper variant.

**Extract proposal.** Two-part: (a) migrate `dosare.ts` / `termene.ts` to `fail(ErrorCodes.INVALID_PARAMS, msg, c, { status: 400 })`; (b) collapse the three frontend unwrappers into a single `unwrapEnvelope<T>(res, opts?)` in `api.ts` with an optional `legacyShape: true` flag for the transition window. After migration, drop the flag.

**Estimated LOC saved.** ~200 LOC (16 lines × 2 routes for backend rewrites that drop repeated 400-shape declarations + ~150 LOC of duplicated unwrap logic on the frontend).

**Refactor risk.** MED — frontend currently branches on legacy vs envelope shape; tightening this requires that the dosare/termene response shape changes are coordinated with frontend call sites (`api.dosare.*`, `api.termene.*`).

---

## Cluster 2 — Captcha provider dual paths (`solveWith2Captcha` vs `solveWithCapSolver`)

**Pattern.** `backend/src/services/captchaSolver.ts` exposes two parallel solve paths and two parallel balance paths that share identical abort-wrapping + error classification + retry semantics. The provider-specific delta is the network protocol (SDK vs HTTP `pollSleep`), but everything around it (CaptchaError construction, `ERROR_ZERO_BALANCE`/`ERROR_NO_BALANCE` mapping, slot abort wrap inside `solveRace`) is duplicated.

**Occurrences.**
- `backend/src/services/captchaSolver.ts` — `solveWith2Captcha` ↔ `solveWithCapSolver` (the two named functions; ~140 LOC each with parallel error shape).
- `backend/src/services/captchaSolver.ts` — `balance2Captcha` ↔ `balanceCapSolver` (same abort-wrap + `CaptchaInsufficientFundsError` classification).
- `backend/src/services/captchaSolver.ts` — `solveRace` calls `wrap("A", ...)` and `wrap("B", ...)` with symmetric slot logic.

**Extract proposal.** Introduce an internal interface `CaptchaProvider { solve(opts): Promise<string>; balance(): Promise<number>; readonly name: string }` with two implementations (`TwoCaptchaProvider`, `CapSolverProvider`). The error-classification table (`ERROR_*` → `CaptchaError | CaptchaInsufficientFundsError`) becomes one shared `classifyProviderError()`. `solveRace` then iterates over `providers: CaptchaProvider[]` without per-slot duplication.

**Estimated LOC saved.** ~80 LOC.

**Refactor risk.** LOW — captcha is well-tested in `backend/src/services/captchaSolver.test.ts` (excluded from this audit but exists), and the provider abstraction does not change observable behavior.

---

## Cluster 3 — Backend XLSX export style scaffolding (4 modules)

**Pattern.** Four backend services each redefine the SAME color palette + style objects + cell helpers + formula-injection escape. `backend/src/util/xlsxHelpers.ts` is anaemic (only `todayRo` + `sanitizeFilename`, ~7 lines) and centralizes nothing of substance.

Each file redefines:
- Color constants: `BLUE_DARK = "1E40AF"`, `BLUE_MAIN = "2563EB"`, `ROW_ALT = "EFF6FF"`, `WHITE`, `TEXT_DARK`, `TEXT_MID`.
- Style factories: `titleStyle`, `statsStyle`, `headerStyle`, `dataStyle(rowIdx, bold)`.
- Cell utilities: `sanitizeNr`, `safeCell`, `applyStyle`, `safeValues`, `styleRow`.
- `FORMULA_PREFIX` escape (`"'"`) for injection-safe cells.

**Occurrences.**
- `backend/src/services/dosareExportXlsx.ts`
- `backend/src/services/termeneExportXlsx.ts`
- `backend/src/services/alertsExportXlsx.ts`
- `backend/src/services/rnpmExportXlsx.ts`

**Extract proposal.** Promote `backend/src/util/xlsxHelpers.ts` into a real module: export `PALETTE`, `STYLES` (titleStyle/headerStyle/etc as factory functions), `sanitizeNr`, `safeCell`, `safeValues`, `applyStyle`, `styleRow`, `FORMULA_PREFIX`. Each export service then only owns its column definitions + workbook composition.

**Estimated LOC saved.** ~250 LOC (≈60-70 per module × 4, minus the consolidated helper).

**Refactor risk.** LOW — output is byte-comparable (XLSX writes go through identical exceljs / xlsx-js-style APIs).

---

## Cluster 4 — Frontend jsPDF/autoTable scaffolding (5+ modules)

**Pattern.** All `frontend/src/lib/export-*.ts` modules use the SAME jsPDF autotable scaffold: setFontSize/setFont/text title block → `autoTable` with identical `styles`, `headStyles: { fillColor: [37, 99, 235], textColor: 255 }`, `alternateRowStyles: { fillColor: [245, 247, 250] }`, `didDrawCell` link decorator, `didDrawPage` page-N footer.

**Occurrences.**
- `frontend/src/lib/export-dosare.ts`
- `frontend/src/lib/export-termene.ts`
- `frontend/src/lib/export-monitoring.ts`
- `frontend/src/lib/export-report.ts`
- `frontend/src/lib/export-analysis.ts`
- `frontend/src/lib/export-manual.ts`
- `frontend/src/lib/rnpmExport.ts`
- Each redefines `sanitizeNr`, `formatInstitutie`, `toTransferableBuffer`.

**Extract proposal.** Create `frontend/src/lib/export-helpers.ts` exporting: `BRAND_COLORS`, `buildAutotableOptions(opts)`, `drawTitleBlock(doc, title, meta)`, `drawPageFooter(doc, pageInfo)`, `linkDecoratorDidDrawCell(doc, columnIndex, hrefFn)`. Also relocate shared `sanitizeNr`/`formatInstitutie`/`toTransferableBuffer` to this module (or to existing `frontend/src/lib/excel-helpers.ts`).

**Estimated LOC saved.** ~300 LOC.

**Refactor risk.** LOW — pure presentation; visual regression risk only for color/spacing constants. NOTE: `frontend/src/data/changelog-entries.tsx` references export modules indirectly; no impact since the helper extraction is internal.

---

## Cluster 5 — Backend PDF helpers + tmp-file streaming scaffold

**Pattern.** PDF export services duplicate `stripDiacritics(s)`, `text(v)` coercer, `MIME_PDF`, page dimensions, and the tmp-file write scaffold (`randomUUID()` → `tmpdir()` path → `createWriteStream` → `finishWriteStream`).

**Occurrences.**
- `backend/src/services/alertsExportPdf.ts` — `stripDiacritics`, `text`, tmp scaffold.
- `backend/src/services/rnpmExportPdf.ts` — same `stripDiacritics`, `text`, tmp scaffold.

**Extract proposal.** Add `backend/src/util/pdfHelpers.ts` with `stripDiacritics`, `coerceText`, `MIME_PDF`, `streamToTmpPdf(buildFn): Promise<{ tmpPath, cleanup }>`. Both services collapse to ~30 fewer LOC each.

**Estimated LOC saved.** ~60 LOC.

**Refactor risk.** LOW.

---

## Cluster 6 — Monitoring SOAP runner orchestration (`dosarSoapRunner` ≈ `nameSoapRunner`)

**Pattern.** Both runners share:
- `parseTarget(job.target_json)` + `parseAlertConfig(job.alert_config_json)` pattern.
- Abort/budget composition: `AbortSignal.timeout(budgetMs)` + `AbortSignal.any([signal, budgetSignal])`.
- Try/catch outcome mapping: `signal.aborted → "aborted"`, `budgetSignal.aborted → "timeout"`, else `"error" + SOAP_FAIL`.
- Oversize handling: `SNAPSHOT_PAYLOAD_MAX_BYTES` check → `insertAlert("source_error", "SNAPSHOT_OVERSIZE", ...)`.
- Identical `getDb().transaction()` wrapping `insertSnapshot` + for-loop calling `insertAlert(alert)`.

Pure deltas: dosar adds `enrichSolutieAlertsForJob`; name adds `partialAlertsEnabled()` + per-institutie `fetchForTarget` loop.

**Occurrences.**
- `backend/src/services/monitoring/dosarSoapRunner.ts` (238 lines).
- `backend/src/services/monitoring/nameSoapRunner.ts` (335 lines).

**Extract proposal.** Introduce `backend/src/services/monitoring/runnerBase.ts` exporting:
- `composeAbortBudget(externalSignal, budgetMs)` → `{ signal, budgetSignal }`.
- `mapErrorToOutcome(err, signal, budgetSignal)` → `"aborted" | "timeout" | "error"`.
- `commitSnapshotAndAlerts(jobId, snapshot, alerts)` — transactional helper enforcing `SNAPSHOT_PAYLOAD_MAX_BYTES`.
- Generic `runSoapJob<TFetch, TDiff>({ fetchTargets, diff, enrich? })` template that each kind plugs into.

**Estimated LOC saved.** ~150 LOC.

**Refactor risk.** MED — subtle behavioral variance between runners (e.g., dosar's enrichment ordering vs name's per-institutie loop). Refactor must preserve current alert ordering and snapshot timestamp semantics; covered by existing monitoring smoke tests but worth a focused regression pass.

---

## Cluster 7 — Frontend table pagination + sort state (4 tables, 3 pages)

**Pattern.** Same `useState` triplet + toggle handler repeated:
```ts
const [page, setPage] = useState(0);
const [sortKey, setSortKey] = useState<SortKey>("...");
const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
// toggle: if (sortKey === key) setSortDir(d => d==="asc"?"desc":"asc"); else { setSortKey(key); setSortDir("asc"); }
```

**Occurrences.**
- `frontend/src/components/DosareTable.tsx` (sort + page state).
- `frontend/src/components/TermeneTable.tsx:32,34,179,398-401` (page/pageSize + sort triplet).
- `frontend/src/components/rnpm/RnpmResultsTable.tsx` (sort triplet).
- `frontend/src/components/rnpm/RnpmSavedData.tsx` (sort triplet).
- `frontend/src/pages/Alerts.tsx`, `frontend/src/pages/admin/Users.tsx`, `frontend/src/pages/admin/Audit.tsx` — `const [page, setPage] = useState(1)` plus filter state.

**Extract proposal.** `frontend/src/hooks/useSortableTable.ts`: `useSortableTable<TKey extends string>({ initialKey, initialDir }) → { sortKey, sortDir, toggleSort(key), reset() }`. Also `useTablePagination({ initialPage, initialPageSize }) → { page, pageSize, setPage, setPageSize, reset }` for the page/pageSize pair plus the "reset page on filter change" effect each table currently inlines.

**Estimated LOC saved.** ~80 LOC.

**Refactor risk.** LOW — pure UI state, behavior unchanged.

---

## Cluster 8 — Frontend hook abort+mounted ref pattern

**Pattern.** Every data-loading hook redeclares `mountedRef = useRef(true)` + `getAbortRef = useRef<AbortController | null>(null)` + `useEffect` cleanup that aborts pending request. The catch block does double-narrowing (`e instanceof DOMException && e.name === "AbortError"` AND `e instanceof Error && e.name === "AbortError"`).

**Occurrences.**
- `frontend/src/hooks/useMonitoringJobs.ts`.
- `frontend/src/hooks/useMonitoringMasterSwitch.ts`.
- `frontend/src/hooks/useRnpmResultsFilter.ts`.
- Several components inline equivalent abort plumbing (`DosareTable.tsx`, `TermeneTable.tsx` during load-more).

**Extract proposal.** `frontend/src/hooks/useAbortableFetch.ts`: returns `{ run<T>(fn: (signal) => Promise<T>): Promise<T | null>, isMounted: () => boolean }` that owns the abort controller + mounted ref + AbortError suppression. Callers shrink to one-liners.

**Estimated LOC saved.** ~60 LOC.

**Refactor risk.** LOW.

---

## Cluster 9 — Error-to-message narrowing (14 occurrences)

**Pattern.**
```ts
err instanceof MonitoringApiError ? err.message
  : err instanceof Error ? err.message
  : "Eroare ..."
```
Same chain repeated across pages, modals, hooks, and `alertsApi.ts`.

**Occurrences.**
- `frontend/src/components/DosareTable.tsx`
- `frontend/src/components/TermeneTable.tsx`
- `frontend/src/components/dashboard/Charts.tsx`
- `frontend/src/components/dashboard/ReportExportModal.tsx`
- `frontend/src/components/dashboard/Timeline.tsx`
- `frontend/src/components/AlertsExportModal.tsx`
- `frontend/src/components/EmailSettingsPanel.tsx`
- `frontend/src/components/monitoring/MonitoringAddForm.tsx`
- `frontend/src/components/monitoring/MonitoringBulkImportCard.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/admin/Users.tsx`
- `frontend/src/lib/alertsApi.ts`
(Grep confirms 12 distinct files.)

**Extract proposal.** `frontend/src/lib/errors.ts` exporting `errorMessage(err: unknown, fallback: string): string`. Each call site collapses from 3 lines to `errorMessage(err, "Eroare la salvare")`.

**Estimated LOC saved.** ~30 LOC.

**Refactor risk.** LOW.

---

## Cluster 10 — Repository list scaffolding (`buildWhere` + count + paginated select)

**Pattern.** Every repository's `listX(opts)` does:
1. Build `where: string[]` and `params: (string|number|null)[]` arrays.
2. Conditionally `where.push("col = ?"); params.push(value)` per filter.
3. `WHERE owner_id = ? AND ${where.join(" AND ")}`.
4. Count query: `SELECT COUNT(*) FROM tbl WHERE ...`.
5. Paginated select: same WHERE + `ORDER BY ... LIMIT ? OFFSET ?`.

Grep stats: 89 occurrences of `owner_id = ?` across 16 db files; `where.push` / `params.push` pattern across 7 files (`aiUsageRepository`, `avizRepository`, `userRepository`, `nameListsRepository`, `monitoringJobsRepository`, `auditRepository`, `monitoringAlertsRepository`).

**Occurrences.**
- `backend/src/db/avizRepository.ts` (20 `owner_id = ?` hits — most prolific).
- `backend/src/db/monitoringAlertsRepository.ts` (15 hits).
- `backend/src/db/monitoringJobsRepository.ts` (13 hits).
- `backend/src/db/nameListsRepository.ts` (8 hits).
- `backend/src/db/userRepository.ts` (auth + list).
- `backend/src/db/auditRepository.ts`.

NOTE: `backend/src/db/ownerAiSettingsRepository.ts` (AI branch, EXCLUDED from occurrences) follows the same pattern — extract would automatically benefit it once merged.

**Extract proposal.** `backend/src/db/queryBuilder.ts` exporting:
- `WhereBuilder` class — `.eq(col, val)`, `.in(col, vals)`, `.like(col, val)`, `.between(col, lo, hi)`, `.build() → { sql, params }`.
- `paginatedList<T>(db, { table, where, orderBy, page, pageSize }) → { rows: T[], total: number }` — runs both COUNT and SELECT under one prepared statement pair.
- Constraint: still confined to `backend/src/db/**` (per project rule), and `owner_id` is always required as the first `.eq()`.

**Estimated LOC saved.** ~200 LOC.

**Refactor risk.** MED — SQL is hand-tuned in places (indexes, `COLLATE NOCASE`). The builder must allow per-column raw fragments; tests in `backend/src/db/repository-isolation.test.ts` already cover owner-scoping invariants and must remain green.

---

## Cluster 11 — `parseFilenameFromContentDisposition` duplicated verbatim (3 locations)

**Pattern.** RFC 6266-style filename parser duplicated word-for-word.

**Occurrences.**
- `frontend/src/lib/api.ts:67` — original.
- `frontend/src/lib/alertsApi.ts:83` — verbatim copy.
- `frontend/src/lib/rnpmApi.ts:376` — verbatim copy.

Each is paired with a `postBlob`-like helper that calls it at line `res.headers.get("Content-Disposition")` (api.ts:99, alertsApi.ts:118, rnpmApi.ts:424 + :458).

**Extract proposal.** Single export from `frontend/src/lib/api.ts` (it already exports `apiFetch`, `extractErrorMessage`, `postBlob`). `alertsApi.ts` and `rnpmApi.ts` import it; both also collapse their local `postBlob`/`unwrapAlertBlob` variants into reuse of `api.ts`'s `postBlob`.

**Estimated LOC saved.** ~15 LOC (parser) + ~50 LOC (collapsed blob helpers) = ~65 total.

**Refactor risk.** LOW.

---

## Cluster 12 — RNPM route per-handler boilerplate (`rejectCaptchaKeyInWebMode` + `invalidJson` + `invalidParams` + `invalidCaptchaKey`)

**Pattern.** Every POST handler in `backend/src/routes/rnpm.ts` starts with the same gate sequence: web-mode rejection → JSON body parse with try/catch returning `invalidJson(c)` → zod validation returning `invalidParams(c, msg)` → captcha-key shape check returning `invalidCaptchaKey(c)`.

Grep count: 53 occurrences of these 4 helpers in `rnpm.ts` (single file, ~1100 lines).

**Occurrences.**
- `backend/src/routes/rnpm.ts` — handlers `/search`, `/bulk`, `/captcha/balance`, `/saved/*` (POST/DELETE/PATCH), `/compact`, `/export/*`. Each handler opens with 8-12 lines of identical guard plumbing.

**Extract proposal.** A Hono middleware factory `rnpmGuard({ requireCaptchaKey?: boolean, bodySchema?: z.ZodType })` that runs in order: `rejectCaptchaKeyInWebMode` → JSON parse (uses Hono's `c.req.json()` with envelope fail) → `bodySchema.safeParse` → optional captcha-key validation. Handlers shrink to body logic only and read parsed input from `c.get("body")`.

**Estimated LOC saved.** ~80 LOC (8-10 lines × ~10 handlers).

**Refactor risk.** LOW — gates and their order are well-defined; the middleware is internal to one route file.

---

## Summary

| # | Cluster | Files involved | Est. LOC saved | Risk |
|---|---------|----------------|----------------|------|
| 1 | HTTP envelope (legacy `c.json({ error })` + 3 frontend unwrappers) | 2 backend routes + 3 frontend lib | ~200 | MED |
| 2 | Captcha provider dual paths (2Captcha vs CapSolver) | 1 (captchaSolver.ts) | ~80 | LOW |
| 3 | Backend XLSX style scaffolding | 4 backend services | ~250 | LOW |
| 4 | Frontend jsPDF/autoTable scaffolding | 7 frontend lib/export-* | ~300 | LOW |
| 5 | Backend PDF helpers + tmp-file scaffold | 2 backend services | ~60 | LOW |
| 6 | Monitoring SOAP runner orchestration | 2 runners (dosar/name) | ~150 | MED |
| 7 | Frontend table pagination + sort state | 4 tables + 3 pages | ~80 | LOW |
| 8 | Hook abort+mounted ref pattern | 3+ hooks | ~60 | LOW |
| 9 | Error-to-message narrowing chain | 12 frontend files | ~30 | LOW |
| 10 | Repository list scaffolding (buildWhere + paginated select) | 6+ repositories | ~200 | MED |
| 11 | `parseFilenameFromContentDisposition` verbatim | 3 frontend lib | ~65 | LOW |
| 12 | RNPM route per-handler boilerplate | 1 route file (~10 handlers) | ~80 | LOW |
| | **TOTAL** | | **~1,555 LOC** | |

Priority order for refactor PRs (highest ROI first, accounting for risk):
1. Cluster 3 (XLSX styles) + Cluster 4 (PDF autotable) — biggest LOC win, lowest risk.
2. Cluster 11 (filename parser) + Cluster 9 (error narrowing) + Cluster 7 (sort state) — quick wins, isolated blast radius.
3. Cluster 12 (RNPM guard middleware) + Cluster 8 (abort hook) — internal cleanup, no API surface change.
4. Cluster 2 (captcha provider abstraction) + Cluster 5 (PDF helpers) — small, well-bounded.
5. Cluster 10 (queryBuilder) + Cluster 6 (monitoring runner base) — MED risk, deserve dedicated PRs with regression checks.
6. Cluster 1 (envelope migration) — coordinate with PR-6 (zod-openapi) as envelope.ts comment already plans.
