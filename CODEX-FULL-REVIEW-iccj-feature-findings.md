# Full Review Findings - ICCJ Feature

Review target: `CODEX-ADVERSARIAL-REVIEW-iccj-feature-full.md`

Scope: security, bugs, architecture, reliability, hardening. Evidence is from the target brief plus live workspace files read in this session. I did not edit implementation code.

## Executive Verdict

Overall verdict: **NO-GO until HIGH/MEDIUM findings below are fixed**.

The ICCJ feature has a sound high-level shape: upstream URLs are hardcoded, route params are bounded, detail ids are numeric-gated, route mounts inherit global middleware, and parser-only tests pass. The blocking risks are not classic SSRF/XSS/SQLi; they are monitoring correctness, timeout isolation, parser drift behavior, target identity, and operability of a scraper that can affect a government site and user trust.

## Findings

### F1 - HIGH - ICCJ monitoring ignores stored `iccj_id`, so exact-number matching can produce false "not found"

Verdict for area A: **confirmed real defect**.

Evidence:

- `backend/src/schemas/monitoring.ts:43-57` allows `target.iccj_id` for ICCJ jobs.
- `frontend/src/lib/monitoringApi.ts:124-132` sends `{ numar_dosar, iccj_id }` when `input.iccjId` exists.
- `backend/src/services/monitoring/iccjRunner.ts:47-52` parses only `{ numar_dosar }` and passes only the number to `fetchCurrentDosar`.
- `backend/src/index.ts:670-677` searches by `numarDosar`, then requires `d.numar === numarDosar`, ignoring the stored id.

Risk:

If scj.ro returns `1783/1/2023*` but the stored watch has `1783/1/2023`, the runner returns `null`. With a prior present snapshot, `diffDosarSoap` can emit a disappearance transition. Even without a prior snapshot, the job baselines as absent and stops monitoring the real case.

Fix:

Make the runner target-aware. Parse `{ numar_dosar, iccj_id }`; if `iccj_id` exists, fetch detail directly by id and verify the returned number is compatible for display only. If no id exists, use a deliberate fallback search path and mark ambiguous/multiple matches as `IccjSourceError`, not `null`.

### F2 - HIGH - Date-bounded ICCJ dosar search sends ISO dates to scj.ro instead of `DD.MM.YYYY`

Verdict for area B: **confirmed real defect**.

Evidence:

- `backend/src/services/iccj/iccjClient.ts:194-199` defines `isoToIccjDate`.
- `backend/src/services/iccj/iccjClient.ts:469-485` builds the `/738` search body but sets `StartDate` and `EndDate` from `params.dataStart` / `params.dataStop` without conversion.
- The `/737` sedinte path does convert dates with `isoToIccjDate` at `backend/src/services/iccj/iccjClient.ts:681-684`.

Risk:

Date-filtered ICCJ dosar searches can silently return wrong or unfiltered results. That breaks user search, metrics, and any monitoring path that depends on date filters later.

Fix:

Use `isoToIccjDate(params.dataStart ?? "")` and `isoToIccjDate(params.dataStop ?? "")` in `buildSearchBody`. Add a unit test that asserts the form body contains `04.06.2026`, not `2026-06-04`.

### F3 - HIGH - A single detail timeout can collapse an entire enriched search batch

Verdict for area C: **confirmed real defect**.

Evidence:

- `backend/src/services/iccj/iccjClient.ts:409-411` combines external cancellation with `AbortSignal.timeout(ICCJ_TIMEOUT_MS)`.
- `fetchIccjDetail` uses that combined signal at `backend/src/services/iccj/iccjClient.ts:556-590`.
- `searchIccjEnriched` catches per-detail failures but rethrows any `DOMException` named `AbortError` at `backend/src/services/iccj/iccjClient.ts:817-824`.
- `searchTermeneByDosarIccj` has the same pattern at `backend/src/services/iccj/iccjClient.ts:750-757`.
- The dosare enrichment path has no max-result cap; it loops every page row at `backend/src/services/iccj/iccjClient.ts:814-829`. The termene path caps to 20 at `backend/src/services/iccj/iccjClient.ts:717-741`.

Risk:

`AbortError` is used for both caller cancellation and per-item timeout. One slow detail response can fail the whole `/api/dosare-iccj` response instead of returning the list row without enrichment. Worst-case latency can also stack by batches: around 50 rows / 5 concurrency * 30s = up to 300s.

Fix:

Distinguish caller abort from per-item timeout. Isolate per-item timeout as a recoverable detail failure, add an aggregate route budget, and cap dosare enrichment count or make enrichment lazy/partial with explicit UI state.

### F4 - MEDIUM - Optional `iccj_id` changes `target_hash`, allowing duplicate jobs for the same ICCJ dosar

Verdict for area D: **confirmed real defect**.

Evidence:

- `frontend/src/lib/monitoringApi.ts:130-132` sometimes includes `iccj_id` and sometimes sends only `{ numar_dosar }`.
- `backend/src/schemas/monitoring.ts:54-57` makes `iccj_id` optional.
- `backend/src/db/monitoringJobsRepository.ts:82-88` computes `targetHash = canonicalSha256(body.target)`.
- The uniqueness constraint is `(owner_id, target_hash, kind)` in `backend/src/db/migrations/0034_iccj_job_kind.up.sql:45-46`.

Risk:

The same user can create one ICCJ job from a row with `iccjId` and another from a manual/id-less path. They hash differently and bypass the duplicate guard.

Fix:

Do not include volatile metadata in the uniqueness target. Either require `iccj_id` for ICCJ monitoring and canonicalize on it, or store `iccj_id` in a metadata column/detail field while hashing a normalized logical identity.

### F5 - HIGH - Detail parser can silently drop all sedinte on markup drift

Verdict for area E: **confirmed real defect**.

Evidence:

- `parseSearchItems` fails loud on row drift at `backend/src/services/iccj/iccjClient.ts:210-224`.
- `parseDetail` fails loud only if the whole `docket_details` block is absent at `backend/src/services/iccj/iccjClient.ts:339-343`.
- `parseDetail` gets `Sedinte de judecata` with `?? ""` at `backend/src/services/iccj/iccjClient.ts:355-357`.
- `parseDetailSedinte` returns `[]` if no `<tbody>` exists at `backend/src/services/iccj/iccjClient.ts:293-296`.

Risk:

If the detail page label or table structure drifts, monitoring writes a valid "present dosar with zero sedinte" snapshot. That can erase prior hearing state and emit false changes later. It also hides a scraper break as genuine empty detail.

Fix:

Separate "known no sedinte" from "sedinte section/table not parseable". Throw `IccjParseError` on unknown structure. Add tests for section-label drift and table drift, not only full `docket_details` absence.

### F6 - MEDIUM - ICCJ alerts reuse PortalJust wording and can deep-link to PortalJust while titled as scj.ro

Verdict for area F: **confirmed real defect**.

Evidence:

- `backend/src/services/monitoring/diff/dosarSoap.ts:207-214` emits title `Dosarul nu mai apare la PortalJust`.
- `backend/src/services/monitoring/diff/dosarSoap.ts:220-228` emits title `Dosarul a aparut la PortalJust`.
- ICCJ runner uses the same diff at `backend/src/services/monitoring/iccjRunner.ts:81-87`.
- ICCJ runner alert detail injects `numar_dosar`, `instanta`, `stadiu`, but not `iccj_id` at `backend/src/services/monitoring/iccjRunner.ts:130-142`.
- Alert context derives `source: "iccj"` from `alert.job_kind` and `iccjId` from detail or target at `frontend/src/lib/alert-context.tsx:140-143`.
- `getDosarExternalUrl` falls back to PortalJust if `source === "iccj"` but `iccjId` is absent at `frontend/src/components/dosare-table-helpers.ts:63-65`.
- Alerts renders the link title as scj.ro when `ctx.source === "iccj"` at `frontend/src/pages/Alerts.tsx:743-751`.

Risk:

ICCJ alert titles can say PortalJust. For id-less ICCJ jobs/alerts, the UI can show a scj.ro title but produce a `portal.just.ro` URL, violating the "never route ICCJ to PortalJust" invariant.

Fix:

Make diff titles source-aware, or pass a source label into the shared diff. Include `iccj_id` in runner alert detail when available. Change `getDosarExternalUrl` so `source === "iccj"` without id returns an ICCJ search URL or disables the external link; never fall back to PortalJust.

### F7 - MEDIUM - ICCJ routes have no operational kill switch and scraper settings are not env-tunable

Verdict for areas G/J: **confirmed hardening gap**.

Evidence:

- Routes mount unconditionally at `backend/src/index.ts:312-316`.
- `MONITORING_DISABLED_KINDS` only affects job claiming; repository code composes disabled kinds at `backend/src/db/monitoringJobsRepository.ts:355-372`.
- ICCJ upstream URLs, timeout, response cap, and session TTL are constants at `backend/src/services/iccj/iccjClient.ts:21-38`.

Risk:

Ops can stop scheduled ICCJ monitoring, but cannot stop interactive `/api/dosare-iccj` / `/api/termene-iccj` scraping if scj.ro blocks the IP or starts rate-limiting. Timeout/cap changes also require code changes.

Fix:

Add `ICCJ_ROUTES_DISABLED=1` or equivalent to return 503 for ICCJ routes, plus env-tunable `ICCJ_TIMEOUT_MS`, response cap, and possibly concurrency/cap. Document these in `.env.example`, `CLAUDE.md`/runbook as appropriate.

### F8 - MEDIUM - High count parsing is brittle for localized thousands separators

Verdict for area I: **partly confirmed, live separator format not verified**.

Evidence:

- `classifyEnvelope` accepts only `/^\d+\s+rezultate/` at `backend/src/services/iccj/iccjClient.ts:395-404`.
- `searchIccj` does `Number.parseInt(String(json.Keywords), 10)` at `backend/src/services/iccj/iccjClient.ts:545`.
- The fixture confirms singular count still uses plural text: `backend/src/services/iccj/__fixtures__/search-1result.json:1` has `"Keywords":"1 rezultate"`.
- Unit tests cover `"136 rezultate"` but not separator variants at `backend/src/services/iccj/iccjClient.test.ts:129-142`.

Risk:

If scj.ro emits `1.234 rezultate` or `1 234 rezultate`, the regex will classify it as error or `parseInt` will return `1`. That breaks pagination and can make broad searches look failed or truncated.

Fix:

Parse counts with a locale-tolerant helper: accept digits plus `.`/space separators before `rezultate`, strip separators, then parse. Add tests for `1 rezultate`, `1.234 rezultate`, and `1 234 rezultate`. Live verification is still needed to know which separator scj.ro emits.

### F9 - LOW - Row expansion still performs redundant ICCJ detail fetch after server-side enrichment

Verdict for area K: **confirmed inefficiency / reliability hardening issue**.

Evidence:

- The route returns enriched dosare by calling `searchIccjEnriched` at `backend/src/routes/dosareIccj.ts:50-64`.
- `searchIccjEnriched` fetches details for each result at `backend/src/services/iccj/iccjClient.ts:801-831`.
- `DosareTable` still calls `api.dosare.detaliuIccj(id)` on expansion at `frontend/src/components/DosareTable.tsx:80-89` and triggers it at `frontend/src/components/DosareTable.tsx:296`.

Risk:

The same detail page can be fetched once during search and again on expand. That increases latency and upstream load. It also contradicts the brief's intended "no client-side enrich loop and no UI loader" behavior.

Fix:

If search results are enriched, initialize detail state from the row or skip `ensureIccjDetail` when `categorieCaz`, party roles, and sedinte are already present. Keep lazy fetch only as a fallback for older/list-only rows.

### F10 - LOW - Migration down-path behavior with existing ICCJ rows is documented but not directly tested

Verdict for area H: **mostly sound, coverage gap**.

Evidence:

- Up migration rebuilds `monitoring_jobs`, preserves indexes, and documents FK/backup behavior at `backend/src/db/migrations/0034_iccj_job_kind.up.sql:1-18` and `:20-69`.
- Down migration documents fail-loud behavior when `kind='iccj'` rows exist at `backend/src/db/migrations/0034_iccj_job_kind.down.sql:1-7`.
- Tests cover cascade preservation and index recreation at `backend/src/db/migrations/0034_iccj_job_kind.test.ts:121-140`.
- Tests cover up-then-down only after no ICCJ rows exist at `backend/src/db/migrations/0034_iccj_job_kind.test.ts:143-156`.

Risk:

The intended fail-loud rollback with existing ICCJ rows is plausible, but not explicitly asserted. A future migration runner/change could alter transactional cleanup and leave partial rebuild artifacts.

Fix:

Add a migration test that inserts `kind='iccj'` after `up`, runs `down`, expects a CHECK failure, and verifies the original table/index state is intact after transaction rollback.

## Security Surface Verdict

SSRF: **refuted as a current finding**. ICCJ URLs are constants in `backend/src/services/iccj/iccjClient.ts:21-30`, and user params are form fields via `URLSearchParams` at `backend/src/services/iccj/iccjClient.ts:469-485`.

SQLi: **refuted as a current finding** for the reviewed ICCJ scraper path. The new ICCJ routes do not write SQL directly; monitoring job creation uses repository hashing/insert logic in `backend/src/db/monitoringJobsRepository.ts:82-88`.

Stored XSS/raw HTML render: **no confirmed issue found**. ICCJ parser strips tags through `stripTags` at `backend/src/services/iccj/iccjClient.ts:175-178`, and reviewed UI paths render React text/props rather than `dangerouslySetInnerHTML`.

Auth/rate-limit/CSRF inheritance: **refuted as a current finding**. Global middleware is applied before route mounting: request id at `backend/src/index.ts:207`, pre-auth rate limit at `:226`, owner context at `:231`, rate limit and origin guard at `:238-239`, with ICCJ routes mounted at `:314-316`.

Remaining security hardening: route kill switch, upstream load caps, timeout isolation, and route-specific abuse limits for scraper endpoints.

## Area-by-Area Brief Verdict

A Monitoring identity: **confirmed defect** - see F1.

B Date conversion: **confirmed defect** - see F2.

C Batch isolation vs timeout: **confirmed defect** - see F3.

D Duplicate jobs: **confirmed defect** - see F4.

E Parser drift safety: **confirmed defect** - see F5.

F Alert wording + deep-link routing: **confirmed defect** - see F6.

G Security surface: **mostly refuted for SSRF/XSS/ReDoS/SQLi**, but hardening gap remains - see Security Surface Verdict and F7.

H Migration 0034: **mostly sound**, with a test gap - see F10.

I Count parsing: **single-result claim refuted; high-count separator risk remains** - see F8.

J Tests + operability: **coverage and operability gaps confirmed** - see F3, F7, F8, F10.

K Missed issues: **redundant detail fetch confirmed** - see F9.

## Prior-Review Claims Refuted

The claim that single-result ICCJ searches fail because upstream says `1 rezultat` is **refuted by fixture evidence**. The captured fixture has `"1 rezultate"` at `backend/src/services/iccj/__fixtures__/search-1result.json:1`, and parser tests for `iccjClient.test.ts` passed 13/13 in this session.

The broad claim that SSRF/stored-XSS/SQLi are open in the reviewed ICCJ path is **not supported by the code read**. Hardcoded upstream constants, numeric detail id gating, `URLSearchParams`, tag stripping, and global middleware inheritance all point the other way.

The claim that migration 0034 necessarily breaks FK/CASCADE behavior is **not supported by the code read**. The migration uses a parent-table rebuild with `foreign_keys=off`, recreates indexes, and tests cover cascade preservation. The missing piece is down-with-existing-ICCJ-row coverage.

## Prioritized Fix List

1. Fix ICCJ monitoring identity: use stored `iccj_id` in runner and remove exact-number-only failure mode.
2. Convert `/738` `StartDate` / `EndDate` to `DD.MM.YYYY`.
3. Separate per-item timeout from caller abort; add aggregate route budget and enrichment cap.
4. Make detail parser fail loud on sedinte/section drift instead of silently returning `[]`.
5. Make alert titles and deep-links source-safe; never fall back from ICCJ to PortalJust.
6. Normalize ICCJ monitoring target hash so `{numar}` and `{numar, iccj_id}` do not duplicate jobs.
7. Add ICCJ route kill switch and env-tunable timeout/concurrency/caps.
8. Harden count parsing for localized thousands separators.
9. Remove or gate redundant row-expand detail fetch after server-side enrichment.
10. Add tests for timeout isolation, duplicate target hash, id-less alert links, down migration with existing ICCJ rows, and high-count parsing.

## Verification Performed

Passed:

```text
npm.cmd test --workspace=backend -- iccjClient.test.ts
Test Files 1 passed
Tests 13 passed
```

Blocked by environment ABI, not by assertion failure:

```text
npm.cmd test --workspace=backend -- iccjClient.test.ts iccjRunner.test.ts 0034_iccj_job_kind.test.ts
iccjClient.test.ts passed
iccjRunner.test.ts and 0034_iccj_job_kind.test.ts failed before logic:
better-sqlite3 was compiled for NODE_MODULE_VERSION 145, current Node requires 137
```

I did not run live scj.ro requests in this review. The high-count separator behavior remains a live-verification item.
