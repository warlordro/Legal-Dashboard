# CODEX — Adversarial Review Brief: ICCJ feature (full)

You are an independent adversarial reviewer. Your job is to find real defects in the ICCJ
(Înalta Curte de Casație și Justiție) feature of the Legal Dashboard, and to **independently
verify or refute** the findings listed at the bottom (a prior multi-agent review produced them;
treat them as *claims to check against the code and the live site*, not as ground truth). Be
skeptical of both the code and the prior review. Cite `file:line`. Do not edit code — review only.

## How to read the change
- Repo root: `c:\Users\Cezar\Desktop\Claude Code\Legal Dashboard`. Stack: Electron + React/Vite
  frontend, Hono/Node backend (port 3002, backend in-process under Electron), better-sqlite3.
- The **entire ICCJ feature is uncommitted** on top of HEAD `b79a3dd` (pre-ICCJ). New files are
  **untracked** (read them in full — they will NOT appear in `git diff`). Modified tracked files:
  use `git diff b79a3dd -- <file>`.
- Run `git status` to see the set. Useful: backend tests `npm test --workspace=backend` (ABI note
  below), frontend `cd frontend && npm test -- --run`, type-check `npx tsc --noEmit -p backend/tsconfig.json`
  and `cd frontend && npx tsc --noEmit`, lint `npx biome check`.
- ABI note: better-sqlite3 is built for the Electron ABI while the app runs; backend vitest needs
  the Node ABI. The pure-parser ICCJ tests (`iccjClient.test.ts`) don't load better-sqlite3 and run
  fine; DB-touching tests (migration, runner) may need an ABI switch.

## Architecture (context — ICCJ has NO API; it is HTML-scraped from www.scj.ro)
PortalJust (the pre-existing path) is a SOAP service returning complete dosare in one response.
ICCJ has no API, so the feature scrapes scj.ro:
- **Search**: `POST https://www.scj.ro/738/...` with a form body (DocketNumber/PartyName/DocketObject/
  Department(sectie)/StartDate/EndDate as `CustomQuery[i].Key/Value`). Returns a JSON envelope
  `{Status, Keywords:"N rezultate", Items:"<tr>…</tr> HTML"}`. Parsed by `parseSearchItems`.
- **Detail**: `GET https://www.scj.ro/1094/Detalii-dosar?...Value=<iccjId>` → HTML page parsed by
  `parseDetail` (Materia juridică → categorieCaz, Stadiul procesual, Partile din dosar → parti with
  `calitateParte`, sedinte, cai de atac). The search list rows lack categorie + party roles + sedinte;
  those exist ONLY on the detail page.
- **Sedinte/termene**: `POST /737/...` parsed by `parseSedinteItems` (used by the Termene page).
- Dates: scj.ro uses `DD.MM.YYYY`; the app normalizes to ISO via `iccjDateToIso` / reverse `isoToIccjDate`.
- A session cookie is warmed (`warmSession`/`getSession`, cached + single-flight) before requests.

### What the feature adds
1. **Dosare search** gains an ICCJ source toggle (`SearchForm`). Route `GET /api/dosare-iccj` →
   `{data: Dosar[], total, page}` (NOTE: a `hasMore` field was intentionally REMOVED; the frontend
   computes "more" cumulatively). Detail route `GET /api/dosare-iccj/detaliu/:id`.
2. **Server-side enrichment**: `searchIccjEnriched` (in `iccjClient.ts`) runs the list search, then
   fetches `/1094` detail for every dosar on the page (batched, concurrency 5, per-item try/catch) and
   merges categorie + party roles + sedinte before responding. There is NO client-side enrich loop and
   NO UI loader — by design (enrichment is invisible, server-side only).
3. **Termene by dosar**: `GET /api/termene-iccj` → `searchTermeneByDosarIccj` (page-1 search + per-dosar
   detail, capped at `MAX_TERMENE_DOSARE=20`) → all hearing dates for matching dosare.
4. **Metrics** (`MetricsPanel`, source-aware): for ICCJ, the 4th card is "Departamente" (from
   `d.departament`) instead of "Institutii" (constant for ICCJ); Categorii + "Analiza Parte" (party-role
   breakdown) render only once enriched. Filter chips for ICCJ are derived dynamically from the result set.
5. **Monitoring** gains an `iccj` job kind: migration `0034_iccj_job_kind` extends the `monitoring_jobs`
   CHECK; `iccjRunner` fetches the current dosar and diffs vs a stored snapshot to emit alerts. The
   critical invariant: a source/parse failure (scj.ro down or markup drift) must NOT be read as
   "0 results / dosar disappeared" (that would emit false alerts).
6. **Source-aware deep-links**: `getDosarExternalUrl` routes ICCJ dosare to scj.ro, PortalJust to
   portal.just.ro (Codex #6: "never route an ICCJ dosar to PortalJust").

### File map
NEW (untracked): `backend/src/services/iccj/iccjClient.ts` (+ `iccjClient.test.ts`,
`iccjClient.live.test.ts`, `__fixtures__/*.html|*.json`), `backend/src/routes/dosareIccj.ts`,
`backend/src/services/monitoring/iccjRunner.ts` (+ test), `backend/src/db/migrations/0034_iccj_job_kind.{up,down}.sql`
(+ test), `frontend/src/lib/iccjSectii.ts`, `frontend/src/components/MetricsPanel.test.tsx`.
MODIFIED: `backend/src/{index.ts, schemas/monitoring.ts, db/monitoringJobsRepository.ts,
db/monitoringAlertsRepository.ts, db/migrations/runner.ts, services/dosareExportXlsx.ts,
services/monitoring/diff/dosarSoap.ts}`; frontend `pages/{Dosare,Termene,Monitorizare,Alerts}.tsx`,
`components/{MetricsPanel,SearchForm,metrics-panel-parts,TermeneTable,CalendarView,DosareTable,Sidebar,
sidebar-history-entry,monitoring/JobKindTabs}.tsx`, `components/dosare-table-helpers.ts`,
`lib/{api,alert-context,alertsApi,monitoringApi,export-dosare,export-monitoring}`,
`hooks/{useSearchHistory,useMonitorRowState}.ts`, `types/index.ts`, `App.tsx`. Design doc:
`PLAN-iccj-metrics-tier1-tier2.md`.

## Constraints (respect — do NOT flag as defects)
Read `C:\Users\Cezar\.claude\CLAUDE.md`, `c:\Users\Cezar\Desktop\Claude Code\.claude\CLAUDE.md`,
and `c:\Users\Cezar\Desktop\Claude Code\Legal Dashboard\CLAUDE.md`. Documented intentional patterns:
romanian-without-diacritics in SOAP/network source strings (UI labels may carry diacritics, matching
`institutii.ts`); repository-only DB access (raw SQL only in `backend/src/db/**`); `owner_id` on all
tables; CJS backend build via esbuild (`import.meta.url` unavailable); manual SOAP/HTML parsing;
SOAP/HTTP upstream + unsigned-binary + LAN-bind-opt-in are accepted risks.

## Priority areas to scrutinize (verify / refute independently — and look for what was MISSED)

**A. Monitoring identity.** `backend/src/index.ts` wires `fetchCurrentDosar` as
`res.dosare.find((d) => d.numar === numarDosar)` and ignores the stored `iccj_id`. scj.ro appends
`*`/`**` markers to docket numbers (confirmed empirically: a `numeParte=valcov` search returns
`numar = "1783/1/2023*"`). Does monitoring a dosar entered without the marker silently fail to match
→ false `dosar_disappeared` or no baseline? Is matching by `iccj_id` the correct fix, and is `iccj_id`
actually available at the runner wiring? Check `monitoringApi.createIccjWithResult`, the schema
`TargetIccjByNumber`, and what `fetchCurrentDosar` receives.

**B. Date conversion.** `buildSearchBody` (`iccjClient.ts`) forwards `StartDate`/`EndDate` to scj.ro —
does it convert ISO→DD.MM.YYYY (via `isoToIccjDate`) like the `/737` sedinte path does, or send raw ISO?
If raw, date-filtered ICCJ dosar searches silently return wrong/unfiltered results. Verify against the
two code paths and, if you can, a live date-bounded request.

**C. Batch isolation vs per-item timeout.** `streamCap.ts` throws `DOMException("Aborted","AbortError")`
on ANY `signal.aborted`. Per-item detail fetches use a combined signal that includes
`AbortSignal.timeout`. The batch `.catch` in `searchIccjEnriched` / `searchTermeneByDosarIccj` rethrows
on `name === "AbortError"`. Does a per-item *timeout* (slow detail body) therefore collapse the whole
batch (vs a parse failure which is isolated)? Is there any aggregate deadline on the enrich loop, or a
cap on the ~50 detail fetches per search (vs the termene cap of 20)? Measure: a broad search
(`numeParte=popescu`, ~50 results) — how long does `/api/dosare-iccj` take, and what happens if a
detail hangs?

**D. Duplicate jobs.** `monitoringJobsRepository.ts` computes `target_hash = canonicalSha256(body.target)`.
`TargetIccjByNumber` includes optional `iccj_id`. Does `{numar_dosar}` vs `{numar_dosar, iccj_id}`
produce different hashes → two monitoring jobs for the same dosar despite `UNIQUE(owner_id, target_hash, kind)`?

**E. Parser drift safety.** Do the HTML parsers fail *loud* (throw `IccjParseError`, distinct from a
genuine empty result) on markup drift, or silently return empty/garbage that monitoring would read as
"disappeared"? Look hard at `parseDetailSedinte` (the `<tbody>` requirement → silent `[]`) and
sub-section label drift in `parseDetail` (e.g. `get("Sedinte de judecata")`). Also `parseSearchItems`
per-row invariants (`>=7` cells, iccjId+numar present).

**F. Alert wording + deep-link routing.** `diffDosarSoap` is shared by the SOAP and ICCJ runners and
hardcodes "…la PortalJust" in `dosar_disappeared`/`dosar_new` titles — do ICCJ alerts wrongly say
"PortalJust"? And `getDosarExternalUrl` falls back to `getPortalJustUrl` when `iccjId` is absent — does
`Alerts.tsx` (id-less iccj jobs) then deep-link to portal.just.ro while labeling it scj.ro (Codex #6 violation)?

**G. Security surface.** Confirm (or break) the prior conclusion that SSRF/stored-XSS/ReDoS/SQLi are all
closed: upstream URLs hardcoded; params encoded via `URLSearchParams`; detail id numeric-gated
(`^\d{1,20}$` route vs `^\d+$` service); ICCJ strings rendered as React text (no `dangerouslySetInnerHTML`);
regex parsers bounded by a response-size cap. Look specifically for any HTML field that reaches a raw-HTML
render path, any regex with catastrophic backtracking on attacker-influenceable input, and whether the
route inherits the global auth/owner-context + rate-limit middleware.

**H. Migration 0034.** Forward + rollback safety on a prod DB with existing monitoring rows (FK preservation,
owner_id, indexes, CASCADE/RESTRICT), transaction + pre-migration backup, and the down-path behavior when
`kind='iccj'` rows exist (it relies on the restored CHECK to fail — is that safe + documented + tested?).

**I. Count parsing.** `classifyEnvelope` uses `/^\d+\s+rezultate/` and `searchIccj` does
`parseInt(String(json.Keywords))`. **Independently verify the scj.ro `Keywords` format**: the captured
fixture is `"1 rezultate"` (plural even for 1), and a live `numeParte=valcov` (1 result) succeeds — so the
prior review *dropped* a claim that "1 rezultat" (singular) breaks single-result searches. Confirm or
refute by inspecting `__fixtures__/search-1result.json` and, if possible, a live single-result query. Then
separately assess: does a high count with a thousands separator (`"1.234 rezultate"` or `"1 234 rezultate"`)
break the regex / parseInt? When does scj.ro emit a separator?

**J. Tests + operability.** Are the failure paths tested (batch isolation; `fetchIccjDetail` session-refresh
retry on `IccjSourceError` but NOT `IccjParseError`; migration down-failure; monitoring false-empty guard;
cumulative-hasMore dedup stall)? Is the network-dependent `iccjClient.live.test.ts` gated/skipped in CI?
Is there an operational kill-switch for the ICCJ *routes* (not just `MONITORING_DISABLED_KINDS` for the
scheduler) so ops can stop scraping if scj.ro blocks the IP? Are URLs/timeouts env-tunable?

**K. What did everyone miss?** Look beyond A–J: state machine / snapshot-diff correctness for ICCJ
(does the stored snapshot shape match what search returns, so the monitor doesn't diff-flap every run?),
idempotency / double-alerting, the interaction of server-side enrichment with the row-expand lazy fetch
(`DosareTable.ensureIccjDetail` — redundant now?), the `aviz_rnpm` zombie job kind, and any place ICCJ and
PortalJust silently share code that assumes PortalJust semantics.

## Deliverable
For each area: a verdict (confirmed real defect / refuted / can't-verify-without-X) with `file:line`
evidence, severity (BLOCKER / HIGH / MEDIUM / LOW per: data loss > security > downtime > UX > style),
and a concrete fix. End with: (1) a prioritized fix list, (2) an explicit list of prior-review claims you
REFUTE (with why), and (3) anything new the prior review missed. Be adversarial — disagreement backed by
code is more valuable than agreement.
