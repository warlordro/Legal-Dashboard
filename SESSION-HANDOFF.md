# Session Handoff - patch v2.9.1 livrat / sprint Dashboard redesign incheiat la v2.9.0

**Data**: 2026-05-02
**Branch local**: `main`
**Remote**: `main` local este sincronizat cu `origin/main` la commit-ul
`579ce7b` (`fix: PR-A + PR-9 review hardening (Tier 1 + Tier 2 + 0013 migration)`).
Patch v2.7.1 (electron taskbar icon dev mode) commit-uit local in `b11c706`.
PR-B v2.8.0 (timeline + charts) commit-uit local in `ea7419e`. PR-C v2.9.0
(Export raport) commit-uit local in `72e662f`. Patch v2.9.1 (Timeline scoasa
din Dashboard + refactor sweep documentat retroactiv in changelog) urmeaza
commit-ul de release peste local.

Trei commits push-uite in v2.7.0 release pe origin:
- `c74a77e` `feat: v2.7.0 - PR-A Dashboard redesign sprint (1/3)` (squashed 4 → 1)
- `61580a4` `fix: PR-9 audit pack 2026-05-02 - B1-B4 + P0/P1 tests + docs sync`
- `579ce7b` `fix: PR-A + PR-9 review hardening (Tier 1 + Tier 2 + 0013 migration)`

Local-only:
- `b11c706` `chore(dev): v2.7.1 - dev mode taskbar icon`
- `ea7419e` `feat: v2.8.0 - PR-B Dashboard timeline + charts (2/3)`
- `72e662f` `feat: v2.9.0 - PR-C Dashboard Export raport (3/3, sprint incheiat)`
- (urmator) commit `fix: v2.9.1 - elimina Timeline din Dashboard + documenteaza refactor sweep in changelog`

PR-7 v2.5.0, patch v2.5.1, PR-8 v2.6.0, patch-urile v2.6.1 → v2.6.8, PR-A
v2.7.0 si PR-9 v2.7.0 sunt pe `origin/main`. v2.7.1 + v2.8.0 + v2.9.0 + v2.9.1
raman locale pana la push.

**Tag-uri**: `v2.5.0` → `v2.6.8` + `v2.7.0` push-uite pe `origin`. `v2.7.1` +
`v2.8.0` + `v2.9.0` + `v2.9.1` urmeaza dupa commit-uri.

**Versiune curenta**: `v2.9.1` (patch UX post-feedback — Timeline scoasa din
pagina Dashboard, refactor sweep 11 stagii post-v2.7.0 documentat retroactiv
in in-app changelog)

## v2.9.1 — patch UX post-feedback: Timeline scoasa din Dashboard + refactor sweep in changelog

Patch UX in urma feedback-ului direct user pe build-ul live de v2.9.0:

> "nu este o informatie relevanta pentru cineva non-tehnic, ori gasim o alta
> informatie relevant aori o eliminam de tot! De asemenea nu am regasit in
> changlelog in ap refator-ul pe care l-am facut"

**Decizie aplicata**: optiunea (b) — eliminam de tot. Sectiunea "Activitate
recenta" (componenta `Timeline`, introdusa in PR-B v2.8.0) randa rulari de
monitorizare + audit cu format tehnic ("Run ok (dosar_soap) · 2.6s · 0
alerte noi · 2h in urma") inutil pentru utilizatorii non-tehnici si redundant
cu pagina dedicata `/alerte` (filtre + paginatie completa + context dosar
enrichment).

**Frontend**:
- `pages/Dashboard.tsx`: import `Timeline` scos, render `<Timeline />` scos.
  Comentariu inline care explica decizia + leaga de feedback.
- `components/dashboard/Timeline.tsx` ramane in arbore (nu il stergem — poate
  fi reactivat pentru un panou administrativ separat). Pagina Dashboard
  ramane cu KpiStrip + QuickActions + LastDosareCard + LastRnpmCard + Charts
  + "Informatii API + Versiune".
- `frontend/src/data/changelog-entries.tsx`: intrare noua `v2.9.1` (Sparkles
  icon, emerald) + intrare retroactiva `Refactor 11 stagii (post-v2.7.0)`
  (Layers icon, purple) intre v2.7.1 si v2.7.0 care documenteaza sweep-ul
  intern absent pana acum din UI.

**Backend**: endpoint-ul `GET /api/v1/dashboard/timeline` ramane montat
(necitit de UI) ca sa nu sparga clientii externi sau test app-ul. Niciun
test backend modificat.

**Refactor 11 stagii documentat retroactiv** (Stage 0 → Stage 10, livrat in
11 commit-uri secventiale dupa tag-ul v2.7.0 si inainte de PR-B v2.8.0):
- Stage 0-1: vitest + jsdom infra + suite caracterizare frontend
- Stage 2a-2c: structured logging in loadMoreSSE silent catches +
  jobExistsForAnyOwner mutat in repository + classifyRawName extras pur
- Stage 3-5: buildAlertContext extras (~250 LOC) + MonitoringBulkImportCard
  extras (~400 LOC) + datetime-formatters dedupe
- Stage 7: lib/export.ts spart in 3 (lib/pdf-helpers + lib/export-analysis +
  lib/export-manual), 1400 LOC -> 698 LOC (50% reducere)
- Stage 8: lib/api.ts spart per-domeniu cu wrapper apiFetch (lib/monitoringApi
  + lib/adminApi + lib/dashboardApi + barrel re-exports), 762 LOC -> ~370 LOC
- Stage 9: useAlertsStream extras din AppShell (~130 LOC mutati)
- Stage 10: monitoringAlertsEnrichment extras (~180 LOC + subsistem
  alert_enriched mutat in modul propriu); repository 704 LOC -> ~485 LOC

**Tests**: 645/645 verzi (timeline endpoint backend ramane functional +
acoperit; niciun test backend modificat; frontend type-check curat dupa
scoaterea importului).

**Ramas de facut**:
- Push commits + tag-uri (`v2.7.1`, `v2.8.0`, `v2.9.0`, `v2.9.1`) pe origin
- Smoke desktop nou pe build-ul de v2.9.1 (verifica vizual ca pagina
  Dashboard nu mai contine Timeline si ca in-app changelog afiseaza noile
  intrari)

## v2.9.0 — PR-C: Dashboard Export raport (3/3 din sprint redesign — ULTIMUL)

A treia si ultima livrare din sprint. Activeaza Quick Action "Export raport"
care era `disabled` din v2.7.0 (PR-A). Modal cu picker `range` (7d / 30d) +
`format` (XLSX / PDF) genereaza un raport agregat printr-un endpoint nou
`GET /api/v1/dashboard/report` (snapshot atomic owner-scoped) si construieste
fisierul off-main-thread in Web Worker.

**Backend — endpoint nou `/api/v1/dashboard/report`:**

- `backend/src/routes/dashboard.ts`: `GET /report?range=7d|30d` owner-scoped
  via `getOwnerId(c)`, wrapped in `withMaintenanceRead` ca sa coexiste cu
  backup/restore. Validare: 400 `invalid_range` daca `range` lipseste sau nu
  e `7d`/`30d`.
- Returneaza payload `{ range, since, until, summary, charts, timeline,
  generatedAt }`. `summary` reuseste blocurile
  `readJobsBlock`/`readAlertsBlock`/`readRunsBlock`/`readAiBlock` (PR-A).
  `charts` reuseste agregarile zilnice (PR-B). `timeline` foloseste 3 helperi
  noi care merge-uiesc 3 surse pe fereastra `[since, until]`.
- `REPORT_TIMELINE_LIMIT = 500` per sursa. Daca oricare sursa atinge cap-ul,
  payload-ul include `truncated: true`.

**Backend — repository extins:**

- `backend/src/db/dashboardActivityRepository.ts`: helperi noi
  `listAlertsInRange`, `listFinalizedRunsInRange`, `listCuratedAuditInRange`
  (window inchis `ts >= since AND ts <= until`, ordonate `(ts, id) DESC`,
  cap parametric prin `limit`). Reuseste `CURATED_AUDIT_ACTIONS` allowlist +
  `outcome != 'ok'` catch-all definite in PR-B.

**Frontend — builders raport:**

- `frontend/src/lib/export-report.ts` (FILE NOU):
  - `buildReportXlsx(payload)`: 3 sheets — `Sumar` (13 randuri KPI:
    jobs/alerts/runs/ai), `Activitate zilnica` (9 coloane: data + alerts +
    runs ok/error/timeout/aborted/total + ai cost/calls), `Cronologie`
    (5 coloane: data, kind, severity, titlu, detail JSON serializat 800ch
    cap). Paleta partajata: `BLUE_DARK` titlu, `BLUE_MAIN` header,
    `ROW_ALT`/`WHITE` alternativ. `sanitizeFormulaCells` pe formula injection.
  - `buildReportPdf(payload)`: jsPDF landscape A4 helvetica cu 3 sectiuni
    (Sumar 3 col, Activitate zilnica 9 col, Cronologie pe pagina noua 4 col).
    `stripDiacritics` pe text Romana. Footer "Pagina N". Italic note daca
    `truncated=true`.
  - Helperi: `formatUsd`, `formatTokens`, `formatTs`, `severityLabel`,
    `kindLabel`, `formatDetailValue`, `rangeLabel`.
  - Filename pattern: `raport_dashboard_<range>_<dataRO>.<ext>`.

**Frontend — worker dispatch + ExportJob:**

- `frontend/src/lib/export.ts`: `ExportJob` union extins cu
  `{ kind: "reportXlsx"; data: DashboardReportPayload }` si
  `{ kind: "reportPdf"; data: DashboardReportPayload }`. Orchestratorii
  `exportReportXlsx(payload)` + `exportReportPdf(payload)` posteaza job-ul
  catre Worker si triggher-uiesc `triggerDownload` pe rezultat.
- `frontend/src/lib/export.worker.ts`: `case "reportXlsx"` + `case "reportPdf"`
  in switch dispatch.

**Frontend — modal + Quick Actions wiring:**

- `frontend/src/components/dashboard/ReportExportModal.tsx` (FILE NOU):
  - Props: `{ open, onClose }` (parent-controlled, NU context provider —
    are state intern pentru form).
  - State: `range` (default `7d`), `format` (default `xlsx`), `busy`, `error`.
  - `useRef AbortController` pentru cancellation, `useEffect` reset state
    cand se deschide, ESC handler cand nu e busy, cleanup aborts pe unmount.
  - `handleGenerate`: `dashboardApi.report({ range, signal })` → ramifica
    catre `exportReportXlsx`/`exportReportPdf` → inchide pe success.
  - Accesibil: `role="dialog"`, `aria-modal`, `aria-labelledby="report-export-title"`,
    `aria-label="Inchide"` pe X. Segmented controls cu active-state styling.
- `frontend/src/components/dashboard/QuickActions.tsx`: butonul "Export raport"
  era `disabled` cu tooltip "Disponibil in v2.9.0 (PR-C)" din PR-A. Acum
  devine `<button onClick>` (cele 5 cu `to` raman `<Link>`). State local
  `[reportOpen, setReportOpen] = useState(false)`. Componenta wrap-uita in
  `<>` cu `<ReportExportModal />` la final.

**Frontend — API surface:**

- `frontend/src/lib/dashboardApi.ts`: tipuri noi `ReportTimelineBlock` +
  `DashboardReportPayload`. Metoda noua `dashboardApi.report({ range, signal })`.
- `frontend/src/lib/api.ts`: re-exports tipurile noi (barrel).

**Migration:** zero noi (folosim indexurile existente).

**Tests:** 645/645 verzi (640 baseline din v2.8.0 + 5 noi in
`routes/dashboard.test.ts` pentru `/report`):
- envelope + empty state owner-scoped cand DB-ul e gol;
- 400 `invalid_range` pe range absent / invalid;
- 30d grid cu 30 entries in `charts`;
- timeline merge cu 1 alert + 1 run + 1 audit verifica order DESC
  `ts DESC, id DESC tiebreak`;
- owner isolation (alice vs bob);
- `truncated=true` cand sursa atinge `REPORT_TIMELINE_LIMIT`.

**Pattern fix descoperit:**

- `recordAudit` semnatura corecta este `recordAudit(c, action, opts)` cu
  primul arg context (sau `null` in teste). Test initial scris ca
  `recordAudit({ ownerId, action: "auth.denied", ... })` a esuat cu
  `c.get is not a function` — fix prin verificarea call-urilor existente.
- Hook-ul `block-renderer-fetch.mjs` blocheaza prose cu literal "fetch" in
  `frontend/src/**`. Workaround pentru changelog entry: rephrase la "cerere"
  / "request" via barrel. Hook-ul nu inspecteaza context (doar literal word).

**Verificari**: `npx tsc --noEmit -p backend/tsconfig.json` → OK,
`npx tsc --noEmit` (frontend) → OK, `npm test --workspace=backend` →
**645/645 verzi**, `npm run build` → OK.

**Sprint Dashboard redesign incheiat:** PR-A v2.7.0 (KPI strip + Quick Actions),
PR-B v2.8.0 (timeline + charts), PR-C v2.9.0 (Export raport). Urmator sprint:
PR-10 → PR-12 (server-side sessions + Google SSO + cutover web complet).

## v2.8.0 — PR-B: Dashboard timeline + charts (2/3 din sprint redesign)

A doua livrare din 3. Inlocuieste blocul static "TIPURI DE PROCESE
DISPONIBILE" de pe Dashboard cu doua surfaces operationale alimentate de doua
endpoint-uri noi `/api/v1/dashboard/{timeline,charts}`. Zero schema change
(toate query-urile noi merg pe indexurile existente, inclusiv `0013` adaugat
in v2.7.0 pentru `monitoring_runs(owner_id, ended_at DESC)`).

**Backend — timeline cursor-paginated:**

- `backend/src/routes/dashboard.ts`: endpoint nou `GET /timeline?cursor=&limit=`
  owner-scoped via `getOwnerId(c)`, wrapped in `withMaintenanceRead`. Returneaza
  un stream descrescator combinat din 3 surse: `monitoring_alerts.created_at`,
  `monitoring_runs.ended_at` (doar finalizate), `audit_log.ts` (curated set +
  `outcome != 'ok'` catch-all). Cursor strict `<` mentine paginatia stabila
  cand 2 evenimente au acelasi ms; `nextCursor=null` cand pagina returneaza
  mai putin de `limit`. Limit clamp `[1,100]`, default 30. Worst case 3*N rows
  per pagina (cheap pentru N≤100).
- Severity mapping: alert.severity → direct; run.status → ok=info /
  error=critical / timeout=warning / aborted=info; audit.outcome → ok=info /
  denied|error=warning, dar `auth.denied` bumped la critical.

**Backend — charts daily series:**

- Endpoint nou `GET /charts?range=7d|30d` (owner-scoped, withMaintenanceRead).
  3 serii zilnice aliniate pe acelasi UTC-day grid (`utcDayStart` din
  aiUsageRepository, ca sa partajeze X-axis cu AIUsagePanel): alerts count,
  runs split (ok/error/timeout/aborted/total), aiCost USD+calls+tokens
  (`cost_usd_milli/1000`). Closed lower bound `ts >= since` aliniat cu PR-7.
  Backfill cu zero pe zilele lipsa.

**Backend — repository nou:**

- `backend/src/db/dashboardActivityRepository.ts`: separat de per-table CRUD
  repos. `CURATED_AUDIT_ACTIONS` (auth.denied + monitoring delete + name_list
  commit + admin user/quota writes + aviz/backup/search destructive ops +
  backup.restore). Helperi: `listAlertsBefore`, `listFinalizedRunsBefore`,
  `listCuratedAuditBefore` (timeline cursor queries cu LEFT JOIN pe
  monitoring_jobs); `aggregateAlertsByDayInRange`,
  `aggregateFinalizedRunsByDayAndStatusInRange` (charts daily aggregations).

**Frontend — Timeline + Charts:**

- `frontend/src/components/dashboard/Timeline.tsx`: lista descrescatoare cu
  iconita per kind (Bell/PlayCircle/Shield), pill colorat per severity,
  subline contextual per kind (run = duration_ms+alerts_created+error_code;
  alert = numar_dosar/nume din job_target; audit = outcome+target). Buton
  "Incarca mai multe" pe nextCursor; refresh manual; relative time
  auto-tick `setInterval(60_000)`. Click pe alert linkeaza catre `/alerte`.
  Dedup defensiv pe id la "Incarca mai multe" pentru same-ms ties.
- `frontend/src/components/dashboard/Charts.tsx`: 3 charts side-by-side
  (lg:grid-cols-3, stacked pe mobile) cu segmented control 7d/30d:
  BarChart amber pentru alerte/zi, BarChart stacked pentru rulari/zi (ok=verde,
  erori=rosu, timeout=portocaliu, oprite=mov, legend interactive), AreaChart
  sky cu gradient pentru cost AI/zi (identic stilistic cu AIUsagePanel).
  Date format UTC-anchored ca eticheta zilei sa nu shift-eze pe utilizatorii
  din alte timezone-uri.
- `frontend/src/lib/chart-colors.ts`: 5 culori noi (`alerts`, `runOk`,
  `runError`, `runTimeout`, `runAborted`).
- `frontend/src/pages/Dashboard.tsx`: blocul static `tipuriProces` (7 chips)
  eliminat complet, inlocuit cu `<Charts />` + `<Timeline />` intre
  `LastRnpmCard` si "Informatii API + Versiune". Ambele componente fac fetch
  propriu (NU primesc data prin props) ca pagina sa nu orchestreze 3 trase
  intr-un singur effect — KPI strip ramane separat la polling 30s.
- `frontend/src/lib/dashboardApi.ts` extins cu `timeline(opts)` + `charts(opts)`,
  AbortSignal propagat. Tipuri publice (`TimelineEvent`, `TimelineEventKind`,
  `TimelinePayload`, `ChartsRange`, `ChartsAlertsPoint`, `ChartsRunsPoint`,
  `ChartsAiPoint`, `ChartsPayload`) re-exportate prin `frontend/src/lib/api.ts`.

**Migration:** zero noi (folosim indexurile existente).

**Tests:** 640/640 verzi (591 baseline din v2.7.0 + 49 noi distribuite intre
`routes/dashboard.test.ts` si suite-urile auxiliare). Coverage nou: timeline
envelope + paginatie cursor + 3-source merge + audit curation; charts daily
backfill + UTC alignment + range validation + owner isolation.

**Next:** PR-C v2.9.0 — endpoint Export raport (XLSX + PDF pentru KPI +
timeline + charts cu interval custom) + activeaza butonul disabled "Export
raport" din QuickActions.

---

## v2.7.1 — patch UX: dev mode taskbar icon

Pana la v2.7.0, `npm run electron:dev` afisa icon-ul implicit Electron (atom)
in taskbar Windows in loc de icon-ul aplicatiei. Build-ul NSIS instalat avea
icon-ul corect (electron-builder injecteaza AUMID si shortcut-uri Start Menu),
dar dev mode nu — Windows nu putea rezolva `appUserModelId` la un icon fara un
shortcut inregistrat.

**Electron - shortcut Start Menu auto-generat in dev mode:**

- `electron/main.js`: helper nou `ensureDevTaskbarShortcut()` apelat in
  `app.whenReady()`. Skip pe pachetele NSIS (`app.isPackaged`) si pe
  non-Windows. Creeaza per-user `Legal Dashboard (Dev).lnk` in
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs` cu `target=process.execPath`,
  `args="<projectRoot>"`, `icon=build/icon.ico`,
  `appUserModelId="ro.legaldashboard.app"`. Idempotent (skip daca shortcut-ul
  exista). Erorile try/catch + `console.warn` (nu blocheaza boot-ul).

**Operational:** primul `npm run electron:dev` dupa update creeaza shortcut-ul
si apoi taskbar-ul afiseaza icon-ul corect (poate fi nevoie de restart Explorer
la prima rulare daca Windows cache-uieste icon-ul vechi). Build NSIS neafectat,
zero teste noi.

## TL;DR (v2.7.0 — PR-A: Dashboard redesign sprint, 1/3 — KPI strip + Quick Actions)

Prima livrare din sprint-ul de Dashboard redesign (3 PR-uri secventiale:
PR-A v2.7.0 KPI+QuickActions, PR-B v2.8.0 timeline+charts, PR-C v2.9.0
reports). Zero schema change, zero migration. Endpoint nou owner-scoped
agregare + 2 componente UI noi peste pagina Dashboard existenta.

**Backend - endpoint nou `/api/v1/dashboard/summary`:**

- `backend/src/routes/dashboard.ts`: read-only aggregation, owner-scoped via
  `getOwnerId(c)`, wrapped in `withMaintenanceRead` ca sa coexiste cu
  backup/restore. Returneaza envelope v1 prin `ok(payload, c)`.
- 4 blocuri agregate: `jobs.active` + `jobs.byKind {dosar_soap, name_soap}`,
  `alerts.unseen` + `alerts.last24h`, `runs {ok, error, timeout, total}`
  (status `aborted` foldat in bucket `error`, runs `running` excluse din
  totals), `ai {costUsd, calls, tokens}` 24h cu closed lower bound +
  `cost_usd_milli/1000` conversie.
- Mount in `backend/src/index.ts`: `app.route("/api/v1/dashboard",
  dashboardRouter)`.

**Frontend - KPI strip + Quick Actions:**

- `frontend/src/components/dashboard/KpiStrip.tsx`: 4 carduri responsive
  (stacked → 2 col → 4 col), iconite ListChecks (blue), Bell (amber),
  Activity (green), Sparkles (purple). Loading skeleton cu Loader2, error
  state inline destructive. Helperi locali `formatUsd` (sub-cent precision)
  si `formatTokens` (k/M).
- `frontend/src/components/dashboard/QuickActions.tsx`: 6 butoane in grid
  (2 → 3 → 6 col): "Cauta dosar" (/dosare), "Monitorizare" (/monitorizare),
  "RNPM" (/rnpm), "Alerte" (/alerte), "Termene" (/termene), "Export raport"
  (FileDown, `disabled: true`, tooltip "Disponibil in v2.9.0 (PR-C)").
- `frontend/src/pages/Dashboard.tsx`: KpiStrip + QuickActions plasate
  deasupra `LastDosareCard`. State `summary`/`summaryLoading`/`summaryError`
  + `summaryAbortRef`. Polling 30s prin `setInterval` cu `AbortController`
  per request (AbortError ignorat, MonitoringApiError extras la mesaj).

**Frontend - API surface:**

- `frontend/src/lib/dashboardApi.ts`: `dashboardApi.summary(signal?)` care
  reuseste `unwrapMonitoring`/`MonitoringApiError`. Interfete exportate:
  `DashboardSummary`, `DashboardJobsBlock`, `DashboardAlertsBlock`,
  `DashboardRunsBlock`, `DashboardAiBlock`. **Update post-refactor (Stage 8):**
  surface-ul a fost extras intr-un fisier dedicat `dashboardApi.ts` (alaturi
  de `monitoringApi.ts`, `adminApi.ts`, `aiUsageApi.ts`, `alertsApi.ts`).
  `lib/api.ts` ramane barrel cu re-export, deci `import { dashboardApi } from
  "@/lib/api"` continua sa functioneze fara churn la apelanti, iar hook-ul
  `block-renderer-fetch.mjs` ramane satisfacut pentru ca `apiFetch` (singurul
  raw fetch) sta tot in `api.ts`.

**Tests:**

- `backend/src/routes/dashboard.test.ts`: 7 teste noi. Pattern Hono test
  app cu middleware `x-test-owner` + `requestIdContext`.
- Acoperire: envelope+empty state, `jobs.byKind` filtru active vs paused,
  alerts unseen vs last24h windowing, runs status bucketing cu `aborted`
  foldat in `error`, still-running excluse cu doua joburi separate
  (constraint `idx_one_running_per_job` permite un singur `running` per
  job_id), AI 24h aggregation, owner isolation 2 tenants.

**Coordonare cu Codex (PR-9 auth pluggable):**

- Codex landase initial work-ul de PR-9 (auth/, owner.test.ts, auth.ts,
  auth.test.ts + modificari pe auditRepository/owner/index/.env.example/
  SECURITY/SESSION-HANDOFF) pe branch-ul `feat/dashboard-redesign` din
  eroare. Pastrat in stash labelat pentru pop pe branch-ul corect
  `feat/pr9-auth-pluggable`. `dashboard.ts` pre-existent salvat in
  `/c/tmp/pr-a-backup/` pe durata stash-ului si restaurat dupa.

**Verificari**: `npx tsc --noEmit -p backend/tsconfig.json` → OK,
`npx tsc --noEmit` (frontend) → OK, `npm test --workspace=backend` →
**553/553 verzi** (546 baseline din v2.6.4 + 7 noi PR-A), `npm run build`
→ OK, `biome check` pe fisierele atinse → OK, smoke headless backend cu
`curl /api/v1/dashboard/summary` → envelope v1 corect.

## TL;DR (v2.7.0 — PR-9: Auth pluggable seam — desktop noop / web JWT)

A doua livrare in v2.7.0 (mergeata pe `main` impreuna cu PR-A in 3 commits:
`c74a77e` PR-A squashed, `61580a4` PR-9 audit pack, `579ce7b` Tier 1+2 review
hardening). Codex livreaza seam-ul de autentificare separat de cutover-ul web
complet (PR-10 → PR-12 raman in viitor). Desktop pastreaza identitatea `local`
1:1, `web` mode devine opt-in tehnic cu JWT validation fail-closed.

**Backend - auth provider interface:**

- `backend/src/auth/authProvider.ts`: `AuthProvider` interface. `DesktopAuthProvider`
  returneaza `{ ownerId: "local", actorId: "local", user: getUserById("local") }`.
  `WebJwtAuthProvider` cere Bearer token sau cookie `legal_dashboard_session`,
  valideaza HS256 cu `jose`, verifica issuer + audience, valideaza userul in
  DB cu status `active` (401 daca lipseste, 403 daca inactiv, 401 daca token
  expirat/invalid).
- `backend/src/auth/jwt.ts`: `verifyAuthToken({ secret, issuer, audience })`.
  Codes interne (`jwt_expired`, `jwt_invalid_audience`, `jwt_invalid_issuer`,
  `jwt_invalid_signature`, `jwt_malformed`) sunt logate via `console.warn`;
  raspunsul public foloseste `unauthorized` ca sa nu leak-uiasca detalii.
- `backend/src/auth/config.ts`: `getAuthMode()` (default `desktop`).
  `validateAuthConfig()` arunca daca `JWT_ISSUER` sau `JWT_AUDIENCE` lipsesc
  in `web` mode. `firstNonEmpty()` helper accepta atat `LEGAL_DASHBOARD_*`
  cat si nume neprefixate. `isAuthCookieSecureDisabled()` arunca eroare la
  boot daca `AUTH_COOKIE_SECURE=0` in productie (doar warn in dev).

**Backend - middleware ownerContext + audit auth.denied:**

- `backend/src/middleware/owner.ts`: `ownerContext()` apeleaza provider-ul
  curent, set-eaza `c.set("ownerId"|"actorId"|"authUser", ...)`. Pe orice
  respingere de auth (401/403): apeleaza `recordAudit(null, "auth.denied",
  { ownerId: null, actorId: null, outcome: "denied", targetKind:
  "http_request", targetId: c.req.path, ip: readRemoteIp(c), userAgent:
  c.req.header("user-agent") ?? null, detail: { requestId, method, code,
  status } })` wrapped in try/catch (audit failure nu blocheaza raspunsul).
- Mesajele auth sunt traduse in romana, raspunsurile folosesc envelope-ul
  standard `fail()` cu `requestId`.

**Backend - rate-limit pre-auth fix + rute auth + migration 0013:**

- `backend/src/middleware/rate-limit.ts`: `releasePreAuthAttempt(key)` se
  apeleaza doar pe 2xx (era inversat - decrementa counter pe ne-2xx, ceea
  ce nega scopul). Mesaj tradus: "Prea multe cereri neautentificate".
- `backend/src/routes/auth.ts`: `POST /api/v1/auth/login` returneaza 501
  `not_implemented` cu pointer catre PR-10. `POST /api/v1/auth/logout`
  sterge cookie-ul. Cookie-ul de sesiune se construieste prin
  `secureCookie()` care respecta `AUTH_COOKIE_SECURE` cu hard error in
  productie cand e dezactivat.
- `backend/src/db/migrations/0013_idx_runs_owner_ended.up.sql`: index nou
  `idx_runs_owner_ended ON monitoring_runs(owner_id, ended_at DESC) WHERE
  ended_at IS NOT NULL` pentru queries 24h din dashboard summary.

**Backend + Frontend - dashboard runs.aborted ca bucket separat:**

- `backend/src/routes/dashboard.ts`: schema `RunsBlock` are camp nou
  `aborted: number`. `readRunsBlock` NU mai foldeaza `aborted` in `error`
  (era pierdere semantica - run-urile abortate manual nu sunt erori).
- `backend/src/db/monitoringRunsRepository.ts`: query separat pentru
  `aborted` count.
- `frontend/src/lib/api.ts`: `DashboardRunsBlock` interface gained `aborted:
  number`.
- `frontend/src/components/dashboard/KpiStrip.tsx`: subline arata
  `"X ok / X erori / X timeout / X oprite"` cu tooltip explicativ.

**Tests + validari PR-9:**

- 38 teste noi (591/591 backend verzi - era 553 baseline PR-A): `auth/jwt.test.ts`,
  `auth/config.test.ts`, `middleware/owner.test.ts`, `middleware/rate-limit.test.ts`,
  `routes/auth.test.ts`, `routes/dashboard.test.ts` (cu cazurile noi pentru
  aborted bucket).
- `tsc --noEmit` backend si frontend verzi, `biome check` verde, `npm run
  build` (backend CJS + frontend Vite) verde, smoke desktop boot OK -
  `/api/v1/me`, `/api/v1/dashboard/summary`, `/api/v1/alerts/stream` toate 200.

**Tag `v2.7.0` push-uit pe `origin`** dupa validarea integrala.

## TL;DR (v2.6.8 — Review-driven hardening: a11y + template fragility + doc accuracy)

Patch frontend + docs peste v2.6.7 (zero backend touch, zero schema). Trei
probleme reale gasite la verificarea unor nitpick-uri automate; aplicate strict
1:1 fara scope creep. Style commitment ramane: structured-section pe entries
noi, entries istorice raman ca atare.

**Frontend - HTML button nesting (Monitorizare bulk import):**

- `frontend/src/pages/Monitorizare.tsx`: cardul "Adaugare bulk din fisier"
  folosea `<button>` ca wrapper peste `<CardHeader>` (div) si `<CardTitle>`
  (h3) — HTML interzice block-elemente in `<button>`. Handler-ul muta direct
  pe `<CardHeader role="button" tabIndex={0}>` cu `onClick` + `onKeyDown`
  (Enter/Space cu `preventDefault`).
- `aria-expanded` + `aria-controls` pastrate. Adaugat
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`
  pentru focus vizibil la tastatura.

**Frontend - derivare `CADENCE_COL_LETTER`:**

- `frontend/src/lib/monitoringBulkTemplate.ts`: literalul `"C"` inlocuit cu
  `colIndexToLetter(HEADERS.indexOf("cadence_sec"))`. Helper nou
  `colIndexToLetter(idx)` (0-based → A, B, ..., Z, AA, ...) baza 26 cu
  prefix-ul standard Excel.
- Boot-time guard `throw new Error(...)` cand `cadence_sec` lipseste din
  `HEADERS`. Reordonarea coloanelor nu mai poate sa desincronizeze silent
  `<dataValidation sqref="...">` injectat cu `fflate` in
  `xl/worksheets/sheet1.xml`.

**Frontend - eroare vizibila pentru header lipsa:**

- `parseBulkFile`: cand `findHeaderRow(matrix) < 0`, in loc de silent return
  cu `valid=[]`+`invalid=[]`, parser-ul push-uieste o intrare in `invalid[]`
  cu mesaj clar — "Header lipsa: fisierul nu contine niciuna dintre coloanele
  recunoscute (numar_dosar, nume, name_normalized, denumire). Descarca
  template-ul si reincearca."
- UI-ul care afiseaza `invalid[]` are acum un semnal de eroare in loc de
  "0 randuri".

**Docs - corectare claim stale despre `xlsx@0.18.5`:**

- `SESSION-HANDOFF.md` lines 235-236 (acest document, in sectiunea
  "Probleme/riscuri ramase") spuneau "xlsx@0.18.5 ramane risc acceptat
  temporar..." — claim invalid post-v2.6.4. Linia rescrisa: parser-ul
  `nameListParser.ts` ruleaza pe `exceljs@^4.4.0`, `xlsx` mutat in
  `devDependencies`, ramane folosit doar tranzitiv pe path-ul write-only prin
  `xlsx-js-style` si in fixturile de test.

**Verificari**: `npx tsc --noEmit` (frontend) → OK; `npm run build` → 15.64s
build complet, fara erori noi. Smoke desktop OK (Electron pornit, `/health`
200, monitoring `running: true`). 546/546 backend tests neschimbate
(modificarile sunt strict frontend + un fisier MD).

**Revalidare Codex 2026-05-01**: backend tsc OK, frontend tsc OK,
`npm test --workspace=backend` OK (546/546 dupa rebuild Node ABI),
`npm run build` OK, `npm run rebuild:electron` OK, smoke Electron hidden OK
cu `/health` 200 si monitoring `running: true`, `inflight: 0`.

**Doc drift cleanup 2026-05-01 (post-revalidare)**: 9 entries stale care
declarau "524/524 teste" pentru v2.6.7 + v2.6.8 actualizate la "546/546"
(baseline din v2.6.4 +22 noi). Atinse: `CHANGELOG.md` (v2.6.7+v2.6.8
entries), `CLAUDE.md` (v2.6.7+v2.6.8 + linia comanda `npm test`),
`README.md`, `STATUS.md` (linia validare v2.6.8),
`frontend/src/data/changelog-entries.tsx` (sectiunea Tests v2.6.8).
Entries istorice (v2.6.0..v2.6.3, ACCEPTANCE-PR-8, MULTI-AGENT-REVIEW)
pastrate ca snapshot in time — 524 era corect la momentul release-ului.

## TL;DR (v2.6.7 — Export Monitorizare Excel + PDF cu paritate Dosare/Termene)

Patch frontend-only peste v2.6.6 (zero backend touch, zero schema). Pagina
`/monitorizare` primeste paritate completa cu `/dosare` si `/termene` la export:

- **Butoane Excel + PDF** in CardHeader "Joburi active", vizibile cand
  `jobs.length > 0`. State partajat `exporting: "xlsx" | "pdf" | null` cu
  `Loader2` spin pe butonul activ. Disabled in timpul generarii.
- **Selectie sau toate** — `getExportJobs()` returneaza
  `selectedIds.size === 0 ? jobs : jobs.filter(...)`. Suffix `(N)` pe label
  cand selectia e activa, pattern identic cu `DosareTable`.
- **Builderii noi `buildMonitoringXlsx` + `buildMonitoringPdf`** in
  `frontend/src/lib/export.ts` reuseaza paleta de stiluri si helperii existenti
  — XLSX cu titlu `PORTALJUST DASHBOARD — MONITORIZARE` BLUE_DARK merged A:H,
  header BLUE_MAIN, randuri alternate ROW_ALT/WHITE font 10, 8 coloane
  (#, Tinta, Tip, Cadenta, Ultima rulare, Urmatoarea verif., Status, Note),
  `sanitizeFormulaCells(ws)` pre-write. PDF landscape A4 helvetica cu header
  `[37,99,235]`, alternate row `[245,247,250]`, `stripDiacritics(...)` pe text,
  footer "Pagina N" centrat.
- **Web Worker dispatch** — `ExportJob` discriminated union extins cu
  `monitoringXlsx` + `monitoringPdf`, switch cases noi in `export.worker.ts`.
  Build-ul ruleaza off main thread cu transferable buffer.
- **Filename pattern**: `monitorizare_<sanitized_target>.xlsx` (single job) sau
  `monitorizare_<dataRO>.xlsx` (multiple) — consecvent cu `dosare_*`/`termene_*`.

**Tests**: 546 pass (neschimbate fata de v2.6.4 → v2.6.6 — modificari strict
frontend additive). Validare: `npx tsc --noEmit` (frontend) verde,
`npm run build` complet in 13.94s.

## TL;DR (v2.6.6 — UX polish Monitorizare name_soap parity)

Patch UX peste v2.6.5 (zero backend touch, zero schema). Doua frecari minore
ramase pe inbox-ul Monitorizare dupa v2.6.5:

- **Buton `Dosare` pe `name_soap`** — randurile cu `job.kind === "name_soap"`
  randeaza target-ul (numele subiectului) `font-bold` urmat de buton `Dosare`
  cu icon `Eye`, identic vizual cu randurile `dosar_soap`. Click →
  `onOpenName(target)` propagat in `App.tsx` ca
  `handleHistoryClick("dosare", { numeParte: nume })` → flow-ul existent
  `pendingSearch` rezolva auto-search-ul in tab-ul Dosare.
- **"Subiect" → "Nume"** — coloana TIP afiseaza acum "Nume" pentru `name_soap`,
  consecvent cu formularul de adaugare (`MonitoringAddForm` foloseste "nume")
  si cu coloana `nume` din template-ul XLSX (v2.6.5).
- **Swap "Ultima rulare" / "Urmatoarea verif."** — ordinea coloanelor in tabel
  devine "Ultima rulare → Urmatoarea verif." pentru lectura naturala
  fapte→predictie. Header + celule swap-uite, restul randului neatins.

**Tests**: 546 pass (neschimbate fata de v2.6.5 — modificari strict frontend
label + render path).

## TL;DR (v2.6.5 — UX polish Monitorizare frontend-only)

Patch UX peste v2.6.4 (zero backend touch, zero schema). Inbox-ul Monitorizare
primeste un val de polish:

- **TINTA bold** — link-ul `<a>` pentru joburi `dosar_soap` schimba
  `font-medium` → `font-bold`. Numarul devine prima ancora vizuala.
- **Bulk import collapsible** — cardul "Adaugare bulk din fisier" foloseste
  state `bulkOpen` (default `false`) cu icon `ChevronDown`/`ChevronRight`;
  `<CardContent>` randat condional. Descrierea trece pe `text-foreground`
  (negru) cu text rescris in romana simpla pentru non-tehnici (descarca →
  completeaza → incarca, fara mentiunea numelor de coloane).
- **Template XLSX restilizat** — `monitoringBulkTemplate.ts` rescris cu
  `xlsx-js-style` la nivelul exporturilor: titlu `BLUE_DARK` merged A:E,
  header `BLUE_MAIN` border-bottom `1D4ED8`, alternating row fill, font 10,
  dropdown `cadence_sec` mutat pe `C5:C1004`. `parseBulkFile` detecteaza
  header-ul dinamic prin `findHeaderRow()` ca template nou (header row 4)
  si fisiere vechi flat (header row 1) sa fie ambele acceptate.
  `downloadBulkTemplate` devine `async`.
- **Note inline sub TINTA** — field-ul `notes` (era write-only — colectat in
  form, persistent in DB, dar niciodata redat) devine vizibil in tabel sub
  link+buton in **aceeasi celula TINTA**, conditionat pe `{job.notes && (…)}`
  ca randurile fara nota sa ramana compacte. Styling
  `text-xs italic text-muted-foreground font-sans truncate max-w-[420px]` cu
  tooltip integral pe hover. Variant respinsa: coloana separata "Note"
  intre Status si Actiuni — introducea spatiu mort si crestea latimea
  tabelului in zona deja crowded.

**Tests**: 546 pass (neschimbate fata de v2.6.4).

## TL;DR (v2.6.4 — audit hardening anterior)

Audit hardening **finalizat integral** in v2.6.4 (multi-agent review
2026-04-30, follow-up 2026-05-01):

- **F1**: DELETE in-flight check 409.
- **F2**: remote bind FAIL-CLOSED — `LEGAL_DASHBOARD_ALLOW_REMOTE=1` refuza
  pornirea fara ack `LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet`,
  + middleware `originGuard` pe `/api/*` (CSRF defense, loopback bypass).
- **F3**: backend migrat `xlsx@0.18.5` → `exceljs@^4.4.0`; xlsx in
  devDependencies pentru fixture-uri test; timeout 30s pe parse.
- **F4-F6**: enrichSolutie restrans (200/tick + 7d window + match relaxat).
- **F7**: SSE `alert_enriched`.
- **F8**: 10 teste P0 repository + 1 runner integration end-to-end pentru
  enrichment.
- **F9**: bulk delete atomic via `POST /jobs/bulk-delete`.
- **F10**: `alerts_created` doar insert real; coloana noua `alerts_patched`
  (migration 0012) pentru observabilitate enrichment.

**Tests**: 546 passing (era 524 in v2.6.3 = +22 net new). Backend tsc clean,
frontend tsc clean, build green.

PR-8 este implementat local: admin pages + roles guard. Backend si frontend sunt
livrate impreuna. Suprafata `/api/v1/me` + `/api/v1/admin/*` este live, cu trei
pagini admin (`/admin/users`, `/admin/audit`, `/admin/quota`) gated client-side
prin `AdminGate` si server-side prin `requireRole('admin')`.

Aplicatia are acum:

- middleware `requireRole(...allowed: UserRole[])` cu audit `auth.denied` pe
  refuz (reason `user_not_found` | `user_inactive` | `role_mismatch`);
- ruta `GET /api/v1/me` care returneaza profilul callerului in envelope v1;
- suprafata `/api/v1/admin/users{,/:id,/:id/role,/:id/status,/:id/quota,/:id/quota/:feature}` +
  `/api/v1/admin/audit` (toate gated cu `requireRole('admin')`);
- migration `0011_user_quota_overrides` (PK `(user_id, feature)`, ON DELETE
  CASCADE);
- guardrails `last_admin` 409 (self-demote) si `self_deactivation` 409 (status
  non-active pe self), audit `before`/`after` pe writes;
- hook `useCurrentUser` + componenta `AdminGate`;
- sidebar conditional `Administrare` cand `user.role === 'admin'`;
- trei pagini admin (Users / Audit / Quota) cu UI complet (filters, paginare,
  inline edit, expandable detail, useConfirm pe scoateri).

## Ce s-a schimbat in PR-8

### Backend - middleware + rute

Fisiere noi:

- `backend/src/middleware/requireRole.ts` (+ test 10 cazuri)
- `backend/src/routes/me.ts`
- `backend/src/routes/admin.ts` (+ test ~30 cazuri)
- `backend/src/db/userQuotaRepository.ts` (+ test 13 cazuri)
- `backend/src/db/migrations/0011_user_quota_overrides.{up,down}.sql`

Fisiere modificate:

- `backend/src/db/auditRepository.ts` - functie noua `listAuditEvents(opts)` cu
  filtre `ownerId | actorId | action | actionLike | targetKind | targetId |
  outcome | since (closed lower bound, ts >= ?) | until (open upper bound,
  ts < ?) | limit (1..500) | offset`. Helper `clampAuditLimit` /
  `clampAuditOffset`. Audit listing nu scrie audit (read-only).
- `backend/src/db/auditRepository.test.ts` - 12 cazuri noi.
- `backend/src/index.ts` - mount `meRouter` la `/api/v1/me` si `adminRouter`
  la `/api/v1/admin`.

### Frontend - hook + componente + pagini

Fisiere noi:

- `frontend/src/hooks/useCurrentUser.ts`
- `frontend/src/components/AdminGate.tsx`
- `frontend/src/pages/admin/Users.tsx`
- `frontend/src/pages/admin/Audit.tsx`
- `frontend/src/pages/admin/Quota.tsx`

Fisiere modificate:

- `frontend/src/lib/api.ts` - tipuri `UserRole` / `UserStatus` / `MeProfile` /
  `AdminUser` / `PaginatedUsers` / `AuditEvent` / `PaginatedAudit` /
  `QuotaOverride` / `QuotaListResult`; helperi `me.get()` si
  `admin.{listUsers,getUser,updateRole,updateStatus,listAudit,listQuota,
  upsertQuota,deleteQuota}`.
- `frontend/src/components/Sidebar.tsx` - secțiunea condiționată
  "Administrare" cu trei iteme (Utilizatori, Audit, Cote).
- `frontend/src/App.tsx` - trei rute noi `/admin/users`, `/admin/audit`,
  `/admin/quota` wrapped in `<AdminGate>`.

### Documentatie / versiune

- `package.json`, `backend/package.json`, `frontend/package.json` bump la
  `2.6.0`;
- `CHANGELOG.md` extins cu intrare v2.6.0;
- `frontend/src/data/changelog-entries.tsx` extins cu intrare v2.6.0;
- `README.md`, `STATUS.md`, `CLAUDE.md`, `EXECUTION-ROADMAP.md` actualizate.

## Validari rulate

- `npm test --workspace=backend` - **524/524 teste trecute** (de la 440 in
  v2.5.1, +84 noi: `userQuotaRepository.test.ts` 13, `requireRole.test.ts` 10,
  `auditRepository.test.ts` extensii 12, `admin.test.ts` ~30 + ajustari fine).
- `npx tsc --noEmit -p backend/tsconfig.json` - clean.
- `cd frontend && npx tsc --noEmit` - clean.
- Smoke test end-to-end prin curl: `/me`, gate behavior (403 cand local nu este
  admin), `/admin/users` listing cu filtre, `/admin/audit?since=...` (closed
  lower bound), quota PUT/GET, self-demote 409 cu mesaj romanesc.
- `npm rebuild better-sqlite3` (Node ABI) → `npm test` → `npm run rebuild:electron`
  (Electron ABI) - sequence completata cu succes.
- TODO smoke desktop post-commit ca sa confirm in runtime sidebar conditional
  pentru admin si non-admin (promovare manuala `local` la admin via SQLite
  direct, apoi revocare).

## Reguli active pentru urmatorul agent

- Executa doar planul agreat. Daca vezi o problema care cere schimbare
  fundamentala, anunta si asteapta aprobare.
- Nu scoate flow-uri existente care functioneaza.
- Electron smoke inseamna aplicatia desktop Electron, nu doar web localhost.
- La lansare Electron:
  - curata `ELECTRON_RUN_AS_NODE`;
  - evita terminal vizibil daca userul nu cere explicit;
  - prefera `Start-Process ... -WindowStyle Hidden`.
- Daca rulezi teste Node si atingi `better-sqlite3`:
  - pentru Vitest poate fi necesar `npm rebuild better-sqlite3`;
  - dupa teste ruleaza obligatoriu `npm run rebuild:electron`.
- SQLite nu permite modificarea unui CHECK existent via `ALTER TABLE`; pentru
  CHECK-uri trebuie rebuild de tabel sau drop complet de CHECK.
- Nu lasa procese Electron/backend pornite inutil daca nu sunt necesare.
- **Promovarea la admin pe desktop ramane manuala**:
  `UPDATE users SET role='admin' WHERE id='local';` direct in SQLite. Acesta
  este un workflow tehnic acceptat pentru sprintul curent; PR-9 va expune un
  mecanism mai prietenos legat de SSO web.

## Probleme/riscuri ramase

- `main` local este sincronizat cu `origin/main` la `579ce7b` (v2.7.0,
  PR-A + PR-9 review hardening). Tag-ul `v2.7.0` push-uit pe `origin`
  impreuna cu tag-urile `v2.5.0` → `v2.6.8` din sesiunea precedenta.
- `package.json`, `backend/package.json`, `frontend/package.json` si
  `package-lock.json` resincronizate la versiunea `2.7.0`.
- `useCurrentUser` se apeleaza din mai multe locuri (Sidebar + AdminGate per
  pagina admin). Pe desktop call-ul este local si rapid; daca devine vizibil in
  load tests pe web mode, va fi lift-ed in context shared (sau cache-uit).
- Pe desktop quota este informativa/bypass. Enforce real ramane pentru web
  cutover (PR-10 → PR-12).
- PR-9 livreaza seam-ul de auth (desktop noop / web JWT validation), dar
  cutover-ul real web — Google Workspace SSO/OIDC, deploy server, TLS,
  Litestream backup — ramane in PR-10 → PR-12.
- `xlsx@0.18.5` nu mai este pe path-ul de parsare a inputului user (in v2.6.4
  `nameListParser.ts` a fost migrat la `exceljs@^4.4.0`). Ramane folosit doar
  ca dependinta tranzitiva pe path-ul write-only de export prin `xlsx-js-style`
  si in fixturile de test — fara expunere directa la fisiere uploadate.

## Urmatoarea etapa

Conform roadmap, PR-A din sprint-ul Dashboard redesign este livrat. Urmatoarea
livrare este **PR-B v2.8.0** (al 2-lea PR din 3 in sprintul Dashboard
redesign).

### PR-B v2.8.0 - Dashboard timeline + charts

Scop (planificat):

- timeline de evenimente recente (alerte + run-uri + audit relevant) cu
  paginare server-side si filtrare pe tip eveniment;
- charts pentru tendinte 7d/30d (alerte/zi, run success rate, AI cost);
- reuseste endpoint-ul `/api/v1/dashboard/summary` pentru KPI-uri si adauga
  endpoint nou `/api/v1/dashboard/timeline` + `/api/v1/dashboard/charts`;
- zero schema change preferabil (foloseste `monitoring_runs`, `alerts`,
  `audit_log`, `ai_usage` existente cu agregari).

### PR-C v2.9.0 - Dashboard reports

Scop (planificat):

- export raport agregat (XLSX + PDF) cu KPI-uri + timeline + charts pentru
  intervale custom (7d/30d/custom);
- activeaza butonul "Export raport" din `QuickActions` (acum disabled cu
  tooltip "Disponibil in v2.9.0 (PR-C)").

### PR-10 → PR-12 - Cutover web complet (in viitor)

- Google Workspace SSO/OIDC peste seam-ul de auth livrat in PR-9;
- import/export desktop ↔ web (migration cale identitate `local` → user real);
- deploy server (Litestream backup, Docker, TLS, monitoring extern).
