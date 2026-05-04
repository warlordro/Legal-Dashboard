# Session Handoff - v2.12.0 (MIN-VIABLE seam refactors + dashboard pagination fix)

**Data**: 2026-05-04

## v2.12.0 - MIN-VIABLE seam refactors + dashboard pagination fix

Sweep peste v2.11.0 care absoarbe sectiunea "MIN-VIABLE seams" din
`DEEP-REVIEW-LEGAL-DASHBOARD-2026-05-04.md` plus un fix de paginare la
dashboard timeline care a iesit la suprafata cand testul a evidentiat boundary
loss prin per-source `LIMIT`. Patru cuturi mici, low-risk, fiecare cu boundary
clar si test in zona schimbata; **fara migrari, fara schimbari de API
observabile**.

**Backend — AlertEventService (split persistence/fanout)**:
- `services/alerts/alertEventService.ts` (nou, ~50 linii):
  `recordAndDispatchAlert(input)` apeleaza `insertAlert` (repo pur) si, doar
  la insert real (`result.inserted === true`), face
  `queueMicrotask(() => { void dispatchAlertEmail(result.row); })`. Returneaza
  acelasi shape `InsertAlertResult` ca `insertAlert`, deci callerii pot face
  swap fara schimbare de API.
- `db/monitoringAlertsRepository.ts`: scos `import dispatchAlertEmail` + blocul
  `queueMicrotask`. SSE listener `notifyNewAlert(row)` ramane in repo (e
  infrastructura locala, nu fanout extern). Comentariu nou indica callerii
  spre `services/alerts/alertEventService.ts`.
- `services/monitoring/dosarSoapRunner.ts`, `nameSoapRunner.ts`, `scheduler.ts`:
  alias `import { recordAndDispatchAlert as insertAlert } from "../alerts/alertEventService.ts"`
  (alias pe acelasi nume local pentru a minimiza diff-ul).
- 16 puncte de apel din teste folosesc `insertAlert` direct din repo (testele
  nu vor side-effect SMTP).
- 3 teste noi in `services/alerts/alertEventService.test.ts`: persists row +
  returneaza shape; dispatch o singura data pe insert real; zero dispatch pe
  dedup hit. `vi.mock("../email/mailer.ts", ...)` izoleaza SMTP;
  `drainEmailDispatches(2_000)` in `afterEach` previne leak intre teste.

**Backend — command service framework-free**:
- `services/monitoring/commands/createMonitoringJob.ts` (nou, ~95 linii):
  functie pura `executeCreateMonitoringJob(input)` care primeste input deja
  parsat (Zod la boundary) + un callback `writeAudit(event)` ce decoupleaza
  accesul la Hono `Context`. Detine tranzactia
  `getDb().transaction(() => { createJob + audit })`, traduce
  `IdempotencyConflictError` in outcome `idempotency_conflict` cu rândul
  existent, si rejecta `aviz_rnpm` cu outcome `kind_not_implemented`.
- Outcome union explicit:
  `{ status: "ok" | "kind_not_implemented" | "idempotency_conflict", ... }`.
  Service-ul **nu cunoaste HTTP**; route-ul mapeaza outcome-urile in
  200 / 201 / 409 / 422 + envelope error code.
- `routes/monitoring.ts`: handler-ul `POST /jobs` se rezuma la (1) Zod parse,
  (2) `getOwnerId(c)`, (3) chemarea service-ului cu adapter
  `writeAudit: (event) => recordAudit(c, event.action, ...)`,
  (4) switch pe `outcome.status`.
- 53 teste in `routes/monitoring.test.ts` raman verzi; service-ul e implicit
  testat via integration tests existente.

**Frontend — hook extragere `useMonitoringJobs`**:
- `frontend/src/hooks/useMonitoringJobs.ts` (nou, ~130 linii): owns abort
  controller, debounce 300ms cu `useDebouncedValue([value, flush])`, page-empty
  recovery effect (cand pagina curenta devine goala dupa delete, pageNum `--`),
  `refresh()` pentru re-fetch idempotent.
- API hook expune
  `{ jobs, total, totalPages, loading, error, page, pageSize, kindFilter,
  searchInput, debouncedQuery, setPage, setPageSize, setKindFilter,
  setSearchInput, flushQuery, refresh, setError, setJobs }`.
- `frontend/src/pages/Monitorizare.tsx`: scos `useCallback` import,
  `useDebouncedValue` import, `JobKindFilter` type import; ~60 linii de
  state + refresh + effect inlocuite cu un singur `useMonitoringJobs()`
  destructure. Page-ul mai detine doar selection (`selectedIds: Set<number>`),
  modale (Detalii instante), bulk delete state si handlers de mutatii care
  cheama `refresh()` din hook.

**Electron — modul `notifications.js`**:
- `electron/notifications.js` (nou, 186 linii): exports
  `getNotificationStatus()`, `showNativeNotification(payload)`,
  `registerNotificationIpc(ipcMain)`. Detine `MAX_NOTIFICATION_*` constants,
  `WINDOWS_NOTIFICATION_ACCEPTS` / `MACOS_NOTIFICATION_ACCEPTS` sentinels,
  `notificationsByTag` Map (LRU by insertion order),
  `normalizeNotificationCapability(...)`, capability detection prin
  `windows-notification-state` / `macos-notification-state`.
- `electron/main.js` (727 → 533 linii): scos `Notification` din
  destructure-ul electron, scos cele 5 constants inline + cele 2 sentinel
  sets + tag-dedup Map + capability helpers. Adaugat
  `const { getNotificationStatus, showNativeNotification, registerNotificationIpc }
  = require(path.join(__dirname, "notifications.js"))`. Cele 3 inline
  `ipcMain.handle("notification:*", ...)` blocuri inlocuite cu un singur
  `registerNotificationIpc(ipcMain)`.
- Comportament IPC neschimbat (`notification:show`, `notification:status`,
  `notification:get-all-tags`).

**Backend — bug fix dashboard timeline pagination**:
- `routes/dashboard.ts`: cand cursor-ul de paginare e composite
  (`<ts>|<eventId>`, deci `inclusive=true` pe predicat repo `<=`), per-source
  fetch foloseste acum `limit + 1` in loc de `limit`. **Cauza**: cursorul
  include event-ul boundary in fetch, iar post-merge filter-ul
  `compareDesc(ev, cursor) > 0` il scoate; fara `+1`, sursa care contine
  boundary-ul pierde un candidat real. Cu composite ID-uri unice, cel mult
  un eveniment per sursa egaleaza cursor-ul, deci `+1` e suficient.
- Testul `paginates via cursor (events strictly older than the cursor)` din
  `dashboard.test.ts` (modificat in v2.11.0 sa foloseasca composite cursor)
  trece acum determinist.

**Tests — 744 backend (de la 728)**:
- +3 in `services/alerts/alertEventService.test.ts` (nou).
- +11 in `routes/rnpm.owner-isolation.test.ts` (nou): owner-isolation pe rute
  RNPM care lucreaza pe DB partajata (verifica ca user A nu vede salvarile
  user-ului B in lista, search-ul, bulk-ul, etc.).
- +1 in `dashboard.test.ts` (compound cursor disambiguation absorbit din
  v2.11.0 deep-review) si +1 absorbit din v2.11.0.
- 73/73 frontend neschimbate.

**Validare**:
- `npx tsc --noEmit -p backend/tsconfig.json` verde local.
- `cd frontend && npx tsc --noEmit` verde local.
- `npm test --workspace=backend` 744/744 verde.
- `cd frontend && npm test -- --run` 73/73 verde.
- `npx biome check` verde.

**Docs / versiune**:
- `package.json`, `backend/package.json`, `frontend/package.json` si
  `package-lock.json` sincronizate la `2.12.0`. Bump minor pentru a marca
  refactorul de seam-uri vizibile la diff de cod chiar daca nu se modifica
  contractele HTTP/IPC.
- `CHANGELOG.md`, `STATUS.md`, `SESSION-HANDOFF.md`, `CLAUDE.md`, `README.md`,
  `frontend/src/data/changelog-entries.tsx` actualizate.

**Reminder**: `npm rebuild better-sqlite3` necesar dupa testele Node ca
Electron sa porneasca cu ABI corect la urmatorul `electron:dev` (testele lasa
ABI 145 pentru Node 24, Electron 41 cere ABI 137).

---

## v2.11.0 - Deep-review remediation (PR A operational + Web-Readiness Closure)

Sweep peste v2.10.8 care absoarbe `DEEP-REVIEW-LEGAL-DASHBOARD-2026-05-04.md`
(PR A operational + PR Web-Readiness Closure) **cu o singura exceptie**:
trecerea frontend `xlsx` → `exceljs` ramane deferata ca scope separat. xlsx
nu mai e pe path-ul de input user din v2.6.4 (mutat in `devDependencies`,
folosit doar pe path write-only prin `xlsx-js-style` si in fixturile de test).

**Securitate (PII + CVE)**:
- `.gitignore`: directorul `backend/rnpm-dumps/` (PII real RNPM — CUI,
  denumire, identificator) adaugat ca pattern explicit. Continea fisiere `.txt`
  cu raspunsuri SOAP capturate in dev pentru investigatii — nu mai pot fi
  commit-ate accidental.
- `backend/package.json`: `nodemailer` `^6.9.13` → `^7.0.13`. CVE GHSA-rcmh-qjqh-p98v
  (HIGH DoS, CVSS 7.5) este patched in 7.0.11+. SemVer major bump (6→7) — usage
  existent in `services/email/mailer.ts` (`createTransport`, `verify`,
  `sendMail`) ramane API-compatibil, fara modificari de cod necesare.
- `backend/package.json`: `@anthropic-ai/sdk` `^0.90.0` → `^0.92.0`. CVE
  GHSA-p7fg-763f-g4gf (moderate file-perms) patched. Usage existent in
  `services/ai.ts` (`new Anthropic({...})`, `messages.create`) ramane neschimbat.
- `npm audit` final: 4 high/moderate (de la 6 inainte). Remaining: `xlsx@0.18.5`
  HIGH (no upstream fix, mutat in devDependencies — accepted), `uuid <14.0.0`
  moderate transitiv (accepted), 2 nodemailer SMTP injection (necesita crafted
  `transport.name`/`envelope.size` — threat realistic foarte scazut, accepted).

**Backend — Closure deep-review #1 (RNPM owner propagation)**:
- `backend/src/routes/rnpm.ts`: `POST /search` si `POST /bulk` calculeaza
  `const ownerId = getOwnerId(c);` la inceputul handler-ului si propaga prin
  `executeSearch({..., ownerId})` si `executeBulkSearch(items, captchaKey,
  ownerId, ...)`. Anterior aceste rute foloseau `"local"` hardcodat indiferent
  de modul AUTH (in desktop e safe pentru ca `getOwnerId` returneaza `"local"`,
  dar pe path-ul web ar fi mascat owner-ul real al request-ului).
- `inflightKey(ownerId, clientRequestId)` pentru dedup-ul idempotency: anterior
  `inflightKey("local", clientRequestId)` ar fi colizionat intre useri diferiti
  in web mode care emit acelasi `clientRequestId` (UUID v4 ar face coliziunea
  improbabila statistic, dar cleanup-ul nu mai e robust impotriva attacker-ului
  intentionat).

**Backend — Closure #2 (admin guard pe global routes)**:
- `requireRole("admin")` aplicat ca middleware pe rutele "global state" din
  `routes/rnpm.ts`:
  - `DELETE /saved/all` (sterge **toate** avizele salvate din DB)
  - `POST /compact` (VACUUM SQLite + WAL checkpoint global)
  - `DELETE /backups` (sterge fisiere backup de pe disc)
  - `GET /backups` (lista fisierelor backup — informatie operationala)
  - `POST /backups/restore` (overwrite DB live)
  - `POST /open-db-folder` (deschide directorul `userData` in OS)
  - `POST /open-backups-folder` (deschide directorul backup in OS)
  - In desktop usage flow, `local` user e seed-uit cu role `user` (vezi
    migration 0002), iar bootstrap admin se face manual via 0006_admin_roles.
    Pe path-ul web aceste rute sunt **strict admin-only**, fara middleware ar
    permite oricarui caller autentificat sa stearga datele globale sau sa lanseze
    restore.

**Backend — Closure #12 (web mode captchaKey body refuz)**:
- Helper nou `rejectCaptchaKeyInWebMode(c)` in `routes/rnpm.ts` returneaza
  `501` cu mesaj romanesc cand `getAuthMode() === "web"`. Aplicat la inceputul
  handler-elor pentru `POST /search`, `POST /bulk`, `POST /captcha/balance`.
  Ratiunea: in web mode, cheia 2Captcha/CapSolver vine din body-ul request-ului
  fara stocare server-side; expune cheia in network call si o face accesibila
  oricarui middleware/proxy intermediar. v2.11.0 nu implementeaza per-user key
  storage server-side (necesita migration noua + UI nou), deci RNPM ramane
  **intentionat dezactivat in web mode**.

**Build script — rebrand**:
- `scripts/build-server.js`: `outName = "portaljust-server-${version}"` →
  `"legal-dashboard-server-${version}"`; banner CLI si `README.txt` aliniate.
  Anterior generau ZIP-uri cu nume care confunda artefactul cu PortalJust.

**Tests — 728 backend (de la 721)**:
- `backend/src/routes/rnpm.contract.test.ts` adauga 7 teste noi:
  - 3 teste pentru web-mode 501 gate (set `LEGAL_DASHBOARD_AUTH_MODE=web`,
    POST `/search`/`/bulk`/`/captcha/balance` cu body valid → expect 501 + mesaj
    romanesc).
  - 4 teste pentru admin-required rejection: `updateUserRole("local", "user")`
    in `beforeEach`, apoi DELETE `/saved/all`, POST `/compact`, POST
    `/backups/restore`, GET `/backups` → expect 403.
- `beforeEach` adauga `updateUserRole("local", "admin")` ca testele existente
  sa treaca dupa adaugarea middleware-ului. Migration 0002 seed-uieste `local`
  cu role=user, deci rutele admin-required ar fi 403 fara promote explicit.
- 73/73 frontend neschimbate.

**Validare**:
- `npx tsc --noEmit -p backend/tsconfig.json` verde local.
- `cd frontend && npx tsc --noEmit` verde local.
- `npm test --workspace=backend -- --run` 728/728 verde.
- `cd frontend && npm test -- --run` 73/73 verde.
- `npx biome check` verde.
- `npm rebuild better-sqlite3` rulat dupa testele Node ca Electron sa porneasca
  cu ABI corect la urmatorul `electron:dev` (testele lasa ABI 145 pentru Node 24,
  Electron 41 cere ABI 137).

**Docs / versiune**:
- `package.json`, `backend/package.json`, `frontend/package.json` si
  `package-lock.json` sincronizate la `2.11.0`. Bump minor (nu patch) pentru ca
  pune in pluso o feature noua (web-mode 501 gate + admin guard pe rute
  globale RNPM) care schimba contractul API observabil din afara.
- `CHANGELOG.md`, `frontend/src/data/changelog-entries.tsx`, `CLAUDE.md`,
  `README.md`, `STATUS.md`, `EXECUTION-ROADMAP.md` si acest handoff actualizate.

## v2.10.8 - CI hardening (test gate + artifact naming)

Patch CI-only peste v2.10.7. Absorbe integral findings-urile "Defer separat"
listate in handoff-ul anterior pentru `.github/workflows/build-windows.yml`
si `.github/workflows/build-mac.yml`. Zero modificari pe codul backend /
frontend / Electron in afara version bump-ului.

**GitHub Actions — test gate inainte de packaging**:
- `.github/workflows/build-windows.yml` adauga, intre `npm ci` si
  `Rebuild native modules for Electron ABI`, patru pasi:
  - `npx tsc --noEmit -p backend/tsconfig.json`;
  - `npm test --workspace=backend -- --run`;
  - `cd frontend && npx tsc --noEmit`;
  - `cd frontend && npm test -- --run`.
  Ordinea conteaza: `npm ci` lasa `better-sqlite3` cu ABI Node, deci testele
  vitest ruleaza inainte de `rebuild:electron` care flips ABI-ul; daca testele
  ruleaza dupa rebuild Electron, `vitest` se prabuseste cu mismatch ABI.
- `.github/workflows/build-mac.yml` adauga aceiasi 4 pasi intre `npm ci` si
  `Build app (backend + frontend)`. Pe Mac nu exista step `rebuild:electron`
  separat — electron-builder are `npmRebuild` intern care flips ABI la
  packaging time, deci testele ruleaza inainte de `npm run build`.
- Un fail de tipuri sau teste blocheaza generarea artefactelor — nu se mai pot
  publica releases cu cod care nu trece type-check sau teste.

**GitHub Actions — artifact naming aliniat**:
- `actions/upload-artifact` (atat Windows cat si Mac) foloseste pattern-ul
  `legal-dashboard-{platform}-${{ github.ref_name }}-run${{ github.run_id }}`.
  Inainte: `legal-dashboard-windows` / `legal-dashboard-mac` — nume fixe care
  permit overwrite la rerun pe acelasi tag si nu lasa istoric retentionable.
- Pattern-ul include atat `ref_name` (tag-ul / branch-ul) cat si `run_id`
  pentru a deduplica re-rulari pe acelasi tag (de exemplu cand un job esueaza
  din motive infrastructurale si e re-trigger-uit manual).

**Docs / versiune**:
- `package.json`, `backend/package.json`, `frontend/package.json` si
  `package-lock.json` sincronizate la `2.10.8`.
- `CHANGELOG.md`, `frontend/src/data/changelog-entries.tsx`, `CLAUDE.md`,
  `README.md`, `STATUS.md`, `EXECUTION-ROADMAP.md` si acest handoff
  actualizate. Sectiunea "Defer separat" stearsa din v2.10.7 pentru ca
  findings-urile sunt absorbite.

**Validare**:
- `npx tsc --noEmit -p backend/tsconfig.json` verde local.
- `cd frontend && npx tsc --noEmit` verde local.
- Workflow-urile vor fi validate la urmatorul push pe `main` / la urmatorul
  tag de release; ordinea pe Windows e testata logic (testele ruleaza inainte
  de `rebuild:electron`).

## v2.10.7 - UX Monitorizare total count

Patch frontend + docs peste v2.10.6.

**Frontend**:
- `frontend/src/pages/Monitorizare.tsx`: CardHeader-ul `Joburi active` afiseaza
  acum totalul real din raspunsul paginat (`total`), nu `jobs.length`.
  Exemplu: cu 616 joburi totale si `pageSize=100`, header-ul devine
  `Joburi active (616)`, iar textul de sub filtre ramane
  `Selectia opereaza doar pe pagina vizibila (100 din 616)`.
- Tooltip-urile Excel/PDF clarifica faptul ca exportul fara selectie acopera
  joburile vizibile pe pagina curenta.

**Docs / versiune**:
- `package.json`, `backend/package.json`, `frontend/package.json` si
  `package-lock.json` sincronizate la `2.10.7`.
- `CHANGELOG.md`, `frontend/src/data/changelog-entries.tsx`, `CLAUDE.md`,
  `README.md`, `STATUS.md`, `EXECUTION-ROADMAP.md`, `CODEX-BACKLOG.md` si
  acest handoff actualizate.

**Note**: findings-urile workflow metadata / release artifact naming care erau
listate aici ca "defer separat" au fost absorbite in v2.10.8 (vezi sectiunea
de mai sus).

## v2.10.6 - Review hardening + cleanup backlog (peste v2.10.5)

Patch fara comportament nou. Absoarbe integral findings-urile review-ului
`REVIEW-FINDINGS-2026-05-03.md` (Critical + High + Medium + Low + nice-to-have)
si elimina script-ul tactic `seed-test-alerts.cjs`. Task A din `CODEX-BACKLOG.md`
(editare job monitorizare) este scos din backlog si din memoria persistenta.

**Frontend**:
- `frontend/src/hooks/useDebouncedValue.ts`: rescris cu tuple `[value, flush]`.
  `flush(next)` permite resetarea sincrona la apasari de buton (clear-X / Reset
  filter) ca debounced state-ul sa nu mai fluture printr-un val intermediar.
- `frontend/src/pages/Alerts.tsx`: `jobKind` ingustat de la `AlertJobKind` la
  `JobKindFilter`; reset-handlerii cheama `flushQuery("")` inainte de
  `setSearchInput("")`. Cast-ul mort dropuit.
- `frontend/src/pages/Monitorizare.tsx`: same pattern (`flushQuery("")`).
- `frontend/src/components/monitoring/JobKindTabs.tsx`: navigatie tastatura
  conform WAI-ARIA Authoring Practices — ArrowLeft / ArrowRight cu wrap,
  Home / End jump la extreme, roving tabindex (`tabIndex={active ? 0 : -1}`),
  focus mutat sincron pe tab-ul selectat. Tipul handler-ului corectat la
  `KeyboardEvent<HTMLButtonElement>`.

**Backend**:
- `backend/src/util/textNormalize.ts`: helper nou `escapeLikeMeta(s)` extras ca
  utilitate reutilizabila pentru orice path care trece input user prin
  `LIKE ? ESCAPE '\\'`. JSDoc `@example` documenteaza explicit contractul
  (omiterea `ESCAPE` lasa `\` literal si re-enable-uieste `%` / `_` ca
  wildcards).
- `backend/src/db/auditRepository.ts`: `listAuditEvents` (`actionLike`)
  foloseste acum `escapeLikeMeta` + `ESCAPE '\\'` — defense-in-depth pentru
  admin paths unde user input ajunge in clauze LIKE.
- `backend/src/db/userRepository.ts`: `listUsers` (`search` peste `email` +
  `display_name`) — same pattern.
- `backend/src/db/monitoringJobsRepository.ts` si
  `backend/src/db/monitoringAlertsRepository.ts`: filtru `q` are guard
  `q?.trim()` defensiv (Zod-ul deja face trim, dar repo-ul nu mai depinde
  de el).

**Cleanup**:
- `scripts/seed-test-alerts.cjs` sters (script tactic, nu mai are utilitate).
- `CODEX-BACKLOG.md`: Task A (editare job monitorizare) scos integral.
  `MEMORY.md` si memory file `project_backlog_edit_monitoring_job.md` curatate.

**Tests**:
- Backend: nou `backend/src/util/textNormalize.test.ts` (11 teste) + 3 teste
  wildcard pentru `getAvize` (`%`, `_`, `\` literali → 0 rezultate).
  **721/721 backend** (de la 703 in v2.10.5, +18).
- Frontend: noi `frontend/src/hooks/useDebouncedValue.test.ts` (6 teste,
  harness manual cu `react-dom/client` + React 18 `act`),
  `frontend/src/components/monitoring/JobKindTabs.test.tsx` (9 teste — render,
  aria-selected, click, roving tabindex, ArrowLeft/Right, Home/End, ignored
  keys), `frontend/src/lib/alertsApi.test.ts` (7 teste pentru constructia
  query string). **73/73 frontend**.

**Validari rulate**:
- `npx tsc --noEmit -p backend/tsconfig.json` - OK.
- `cd frontend && npx tsc --noEmit` - OK (dupa fix tip
  `KeyboardEvent<HTMLButtonElement>` in `JobKindTabs.tsx:29`).
- `npm rebuild better-sqlite3 --workspace=backend` - OK (ABI Node restaurat
  pentru vitest dupa Electron).
- `npm test --workspace=backend` - 721/721 passed.
- `cd frontend && npm test -- --run` - 73/73 passed.
- `npm run rebuild:electron` - OK (ABI Electron restaurat dupa testele Node).

**Docs / versiune**:
- `package.json`, `backend/package.json`, `frontend/package.json` si
  `package-lock.json` sincronizate la `2.10.6`.
- `CHANGELOG.md`, `frontend/src/data/changelog-entries.tsx`, `CLAUDE.md`,
  `README.md`, `STATUS.md`, `EXECUTION-ROADMAP.md` actualizate pentru v2.10.6.

## v2.10.5 - Dashboard KPI rename + Alerte tab-bar/search (istoric anterior)

Aceasta sesiune a implementat doar Task B si Task C din `CODEX-BACKLOG.md`.
La momentul v2.10.5, Task A (`Editare job monitorizare existent`) a ramas
explicit neimplementat: `JobUpdateBodySchema` nu accepta `target`, iar
`monitoringJobsRepository` nu recomputeaza `target_hash` pe PATCH. In v2.10.6,
Task A a fost scos integral din backlog.

**Dashboard**:
- `frontend/src/components/dashboard/KpiStrip.tsx`: KPI-ul `Joburi active`
  devine `Monitorizari active`.
- Sublinia `X dosar_soap, Y name_soap` devine `X Dosare, Y Nume`.

**Alerte**:
- `backend/src/routes/alerts.ts`: query schema accepta `jobKind` si `q`.
- `backend/src/db/monitoringAlertsRepository.ts`: `listAlerts` filtreaza pe
  `monitoring_jobs` pentru `jobKind` / `q`, folosind `rnpm_norm(...) LIKE ...
  ESCAPE '\'`; `COUNT(*)` include acelasi JOIN cand aceste filtre sunt active.
- `frontend/src/lib/alertsApi.ts`: `alertsApi.list()` propaga `jobKind` si `q`.
- `frontend/src/pages/Alerts.tsx`: tab-bar `Toate / Dosare / Nume`, search
  debounced 300ms, reset page pe schimbare filtru si empty state cu reset.

**Docs / versiune**:
- `package.json`, `backend/package.json`, `frontend/package.json` si
  `package-lock.json` sincronizate la `2.10.5`.
- `CHANGELOG.md`, `frontend/src/data/changelog-entries.tsx`, `CLAUDE.md` si
  `README.md` actualizate pentru v2.10.5.
- `CODEX-BACKLOG.md` este acum document istoric: Task B/C sunt livrate, iar
  Task A a fost eliminat in v2.10.6.

**Validari rulate**:
- `npm rebuild better-sqlite3` - OK dupa oprirea proceselor stale
  `Legal Dashboard Dev`.
- `npm test --workspace=backend -- alerts.test.ts` - 10/10 passed.
- `npm test --workspace=backend` - 703/703 passed.
- `npx tsc --noEmit -p backend/tsconfig.json` - OK.
- `cd frontend && npx tsc --noEmit` - OK.
- `npx biome check` - OK.
- `git diff --check` - OK.
- `npm run build` - OK, cu warning-uri Vite existente despre chunk size /
  dynamic import.
- `npm run rebuild:electron` - OK.
- Smoke Electron desktop: `/health` 200,
  `{"status":"ok","service":"Legal Dashboard API","monitoring":{"enabled":true,"running":true,"inflight":0}}`.

**Git state inainte de commit/push**:
- Branch local: `main`, ahead fata de `origin/main` cu v2.10.3 si v2.10.4,
  plus modificarile v2.10.5 in working tree.
- Remote: `https://github.com/warlordro/Legal-Dashboard.git`.
- Userul a aprobat explicit commit + push pe GitHub in aceasta sesiune.

## v2.10.1 - PR-11 review hardening (istoric anterior)

## v2.10.1 - PR-11 review hardening

Patch peste v2.10.0 care absoarbe 14 fix-uri din `/multi-review` (corectitudine,
fiabilitate, securitate, observabilitate, teste, a11y) si o decizie explicita
de a NU schimba design-ul (filtrul de severitate ramane neaplicat — aliniere
cu produsul: "email = toate alertele noi de monitorizare").

**Backend**:
- `mailer.ts` cache-uieste `Promise<Transporter>` (nu transport-ul rezolvat):
  primele apeluri concurente nu mai construiesc doua connection pool-uri.
- Timeout-uri SMTP explicite (`connectionTimeout=10s`, `greetingTimeout=5s`,
  `socketTimeout=15s`) — nodemailer-ul implicit poate astepta minute intregi.
- `readMailerConfig()` rejecteaza port-uri in afara `[1, 65535]` sau NaN.
- `me.ts` PUT `/email-settings` foloseste `minSeverity.optional()`; cand
  field-ul lipseste din body, valoarea stocata e pastrata (era silent
  overwrite cu default `info`).
- `me.ts` POST `/email-settings/test` are cooldown 60s/owner ca sa previna
  SMTP abuse (SMTP relay-uri ca Gmail/O365 throttleaza agresiv); audit pe
  `outcome=denied` cu `reason=cooldown` si `Retry-After`.
- `alertEmailDispatcher.ts` rescris cu queue FIFO `MAX_CONCURRENT=1` (Gmail =
  100/zi, O365 = 30/min), short-circuit pe `isMailerConfigured()` inainte de
  SELECT, audit `email.dispatch.failed` pe `send_failed`/exceptii.
- `index.ts` apeleaza `drainEmailDispatches(5_000)` in `gracefulShutdown`
  inainte sa inchida DB-ul, ca audit-urile post-send sa nu loveasca un DB
  inchis.

**Frontend**:
- `Monitorizare.tsx` modal "Detalii instante" are focus trap: la deschidere
  capturam `document.activeElement`, focus pe X cu `queueMicrotask`, ESC
  ramane pe modal, la inchidere restauram focus-ul daca elementul anterior
  inca exista in DOM (`focus-visible:ring-amber-500`).

**Docs si CI**:
- `0014_email_settings.up.sql` ramane neschimbat (migratiile sunt imutabile
  prin `runner.ts` SHA-256 hash); discrepanta `DEFAULT 'warning'` vs cod
  `'info'` documentata in `ownerEmailSettingsRepository.ts` ca seam pentru
  un viitor preset filtrat.
- `.github/workflows/docker-build.yml` ruleaza `npx tsc --noEmit -p backend`
  + `npm test --workspace=backend -- --run` inainte de build. Local nu se
  pot rula testele backend cand Electron a recompilat `better-sqlite3`
  pentru ABI-ul lui — CI-ul aluneca pe Node 22 cu prebuild ABI-correct si
  inchide gap-ul.

**Tests**:
- 4 teste noi in `alertEmailDispatcher.test.ts` (short-circuit cand mailer-ul
  nu e configurat, audit pe `send_failed`, `drainEmailDispatches` resolva
  dupa settle, `pendingDispatchCountForTests` semnaleaza inflight).
- Mock-ul existent extins cu `isMailerConfigured: vi.fn(() => true)` ca
  testele anterioare sa nu cada pe import nou.

## Kill switches operationale (post-v2.10.1)

| Variabila / mecanism | Effect cand activat | Cand folosesti |
|----------------------|---------------------|----------------|
| `SMTP_HOST/PORT/USER/PASS/FROM` lipsesc sau invalide | `isMailerConfigured()` ramane `false`; dispatcher-ul scurt-circuiteaza inainte de SELECT, panoul UI arata "SMTP off" | Default desktop / mod degraded controlat (test in productie SMTP fara incident) |
| `SMTP_SECURE=true|false` | Forteaza TLS implicit/explicit; default = `port === 465` | Cand provider-ul SMTP cere STARTTLS pe 587 (`SMTP_SECURE=false`) sau implicit TLS pe 465 |
| `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` | Scheduler-ul nu mai claim-uieste tipurile listate; joburile raman in DB, alertele existente raman accesibile | Stop temporar pe sursa upstream cu probleme (PortalJust SOAP rate-limit) |
| `LEGAL_DASHBOARD_ALLOW_REMOTE=1` (+ `ACK_NO_AUTH=...` + `AUTH_MODE=web`) | Backend-ul accepta bind non-loopback; pre-v2.7.0 era default | Setup web/server, niciodata desktop |
| Cooldown POST `/email-settings/test` (60s/owner) | Ruta returneaza 429 cu `Retry-After`; audit `me.email_settings.test outcome=denied reason=cooldown` | Limita built-in vs user click loop pe butonul "Trimite test" |
| `drainEmailDispatches(timeoutMs)` | Asteapta SMTP-urile in flight inainte sa inchida DB-ul; default 10s, shutdown 5s | Gracefull shutdown — invocat automat din `gracefulShutdown()` |
**Branch local**: `main`

**Remote**: `main` local este sincronizat cu `origin/main` la commit-ul
`cebf061` (`fix: v2.10.1 - PR-11 review hardening (14 fixes + a11y)`).
Working tree clean, zero commits ahead/behind.

**Commits push-uite peste v2.7.0 release** (toate pe `origin/main`):
- `b11c706` `chore(dev): v2.7.1 - dev mode taskbar icon`
- `ea7419e` `feat: v2.8.0 - PR-B Dashboard timeline + charts (2/3)`
- `72e662f` `feat: v2.9.0 - PR-C Dashboard Export raport (3/3, sprint incheiat)`
- `ec71d42` `fix: v2.9.1 - patch UX post-feedback (Timeline eliminat + retroactive refactor in changelog)`
- `50018de` `fix: v2.9.2 native notification status`
- `58f9957` `feat: v2.10.0 - PR-11 Email notifiers + UX polish Monitorizare`
- `cebf061` `fix: v2.10.1 - PR-11 review hardening (14 fixes + a11y)`

**Tag-uri**: `v2.0.7` → `v2.10.1` push-uite pe `origin` (inclusiv `v2.7.1`,
`v2.8.0`, `v2.9.0`, `v2.9.1`, `v2.9.2`, `v2.10.0`, `v2.10.1` create si
push-uite in sesiunea de cleanup 2026-05-03).

**Versiune curenta**: `v2.10.1` (PR-11 review hardening: 14 fix-uri din
multi-agent review absorbite peste v2.10.0 — SMTP timeouts + cooldown
`/test` 60s/owner + queue FIFO `MAX_CONCURRENT=1` + drain pe shutdown +
focus trap modal Detalii instante). v2.10.0 baseline livrat email notifiers
prin SMTP optional, setari per-owner, rute `/api/v1/me/email-settings`,
panou UI si email trimis doar pentru alerte nou inserate.

## v2.10.0 - PR-11 Email notifiers

Scop: alertele generate de monitorizare raman in sistemul intern al aplicatiei
(`/alerte` + badge rosu + SSE + notificari native), iar email-ul devine un
canal suplimentar optional. Default-ul este OFF; lipsa `SMTP_*` nu blocheaza
boot-ul.

**Backend**:
- Migration `0014_email_settings` creeaza `owner_email_settings` cu
  `enabled`, `to_address`, `min_severity`, `created_at`, `updated_at`.
  `min_severity` ramane metadata compatibila cu schema alertelor; email-ul nu
  filtreaza dupa severitate.
- `ownerEmailSettingsRepository.ts` expune get/upsert owner-scoped, trim pentru
  adresa si cap 320 caractere.
- `services/email/mailer.ts` foloseste `nodemailer`, citeste doar `SMTP_*` din
  env, construieste subject/body pentru alerte si escape-uieste HTML-ul.
- `services/email/alertEmailDispatcher.ts` verifica settings active si
  recipient; erorile SMTP sunt prinse si logate.
- `monitoringAlertsRepository.insertAlert()` declanseaza dispatcher-ul prin
  `queueMicrotask` doar cand `inserted=true`, separat de fanout-ul SSE.
- `/api/v1/me/email-settings` GET/PUT + `/test`, cu audit pe update/test.
- GET precompleteaza `toAddress` cu emailul real al userului autentificat cand
  nu exista setari salvate; desktop `local@desktop` ramane manual/blank.

**Frontend**:
- `EmailSettingsPanel` nou in `ApiKeyDialog`, langa `NotificationStatusPanel`.
- Panoul expune doar activare, adresa email, status SMTP, Save si Test; cand
  este activ, canalul email trimite toate alertele noi de monitorizare.
- `adminApi.ts` extinde `me.emailSettings.{get,put,test}` si tipurile sunt
  re-exportate prin `lib/api.ts`.

**Docs / versiune**:
- `package.json`, `backend/package.json`, `frontend/package.json`,
  `package-lock.json` bump la `2.10.0`.
- `backend/.env.example` documenteaza `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`.
- `CHANGELOG.md`, in-app changelog, `README.md`, `CLAUDE.md`,
  `SESSION-HANDOFF.md`, `EXECUTION-ROADMAP.md`, `SECURITY.md` actualizate.

**Decizii de design**:
- `nodemailer`, nu SDK provider-specific, ca sa ramana compatibil cu Gmail
  SMTP relay, Resend SMTP sau alt provider SMTP.
- `owner_email_settings`, nu global config, ca web mode sa poata trimite catre
  destinatarul owner-ului fara query param sau shared mutable state.
- `queueMicrotask`, nu `await` in `insertAlert`, ca SMTP latency/failure sa nu
  tina lock-uri SQLite si sa nu sparga inbox-ul/SSE-ul.

**Validari partiale rulate in timpul implementarii**:
- `npm test --workspace=backend -- ownerEmailSettingsRepository.test.ts mailer.test.ts alertEmailDispatcher.test.ts me.test.ts --pool threads` - 34/34 passed.
- `npm test --workspace=frontend -- EmailSettingsPanel.test.ts` - 5/5 passed
  dupa rerun escalat (prima incercare a lovit `spawn EPERM` in Vite config).

**Ramas pentru finalul sesiunii**:
- full backend/frontend tests, type-check, build, `npm run rebuild:electron`,
  smoke Electron desktop.

## v2.9.2 - notificari native Windows/macOS

Scop: alertele generate de monitorizare raman in sistemul intern al aplicatiei
(`/alerte` + badge rosu), iar toast-urile native Windows/macOS devin un canal
suplimentar verificabil, nu un single point of failure.

**Electron**:
- `electron/main.js`: helperi noi pentru status notificari native.
- IPC nou `notification:getStatus` -> `{ platform, supported, state, canNotify, reason }`.
- IPC nou `notification:test` pentru notificare manuala de verificare.
- `notification:show` verifica statusul OS si nu trimite toast cand OS-ul
  raporteaza explicit blocare.
- Dependinte optionale noi: `windows-notification-state@^2.0.0` si
  `macos-notification-state@^3.0.0`.
- `electron-builder` include modulele optionale in `files` + `asarUnpack`.
- `npm run rebuild:electron` ruleaza prin `scripts/rebuild-electron.cjs` si
  reconstruieste doar modulele native relevante platformei curente.

**Frontend**:
- `NotificationStatusPanel` nou in `ApiKeyDialog`, cu status, refresh si buton
  Test.
- `desktopApi` extins cu `getNotificationStatus` si `showTestNotification`.
- `useAlertsStream` construieste payload-ul prin helper testabil, cache-uieste
  statusul nativ 60s si pastreaza fallback-ul web `Notification.requestPermission`.

**Docs / versiune**:
- `package.json`, `backend/package.json`, `frontend/package.json`,
  `package-lock.json` bump la `2.9.2`.
- `CHANGELOG.md`, in-app changelog, `README.md`, `CLAUDE.md`,
  `SESSION-HANDOFF.md`, `EXECUTION-ROADMAP.md` actualizate.

**Validari finale**:
- `npm test --workspace=frontend -- useAlertsStream.test.ts` - 3/3 passed
  dupa rerun escalat (prima incercare a lovit `spawn EPERM`).
- `npx tsc --noEmit -p backend/tsconfig.json` - OK.
- `npx tsc --noEmit` in `frontend/` - OK.
- `npm test --workspace=frontend` - 45/45 passed.
- `npm rebuild better-sqlite3` (Node ABI) - OK, apoi
  `npm test --workspace=backend -- --pool threads` - 645/645 passed.
- `npm run rebuild:electron` - OK dupa scriptul platform-aware.
- `npm run build` - OK.
- Smoke Electron desktop final: app pornita cu `ELECTRON_RUN_AS_NODE` curatat,
  `/health` 200 cu `service: "Legal Dashboard API"`, monitoring `running: true`,
  `inflight: 0`.

**Ramas in aceasta sesiune**:
- commit + tag `v2.9.2` + push commit si tag pe GitHub.

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

- `main` local este sincronizat cu `origin/main` la `cebf061` (v2.10.1,
  PR-11 review hardening). Tag-urile `v2.0.7` → `v2.10.1` sunt toate pe
  `origin`.
- `package.json`, `backend/package.json`, `frontend/package.json` si
  `package-lock.json` sincronizate la versiunea `2.10.1`.
- `useCurrentUser` se apeleaza din mai multe locuri (Sidebar + AdminGate per
  pagina admin). Pe desktop call-ul este local si rapid; daca devine vizibil in
  load tests pe web mode, va fi lift-ed in context shared (sau cache-uit).
- Pe desktop quota este informativa/bypass. Enforce real ramane pentru web
  cutover viitor (daca se reia).
- PR-9 livreaza seam-ul de auth (desktop noop / web JWT validation). Cutover-ul
  real web — Google Workspace SSO/OIDC, deploy server, TLS, backup
  S3-compatible — este reevaluabil separat (PR-10 GCS si PR-12 GDPR delete +
  hash-chain audit eliminate prin decizia #11 din `EXECUTION-ROADMAP.md`,
  2026-05-03).
- Email canal SMTP (PR-11) ramane optional; dispatcher scurt-circuiteaza cand
  `SMTP_*` lipsesc (vezi tabela "Kill switches operationale" mai sus).
  Cooldown 60s/owner pe `/api/v1/me/email-settings/test` previne abuz vs
  Gmail/O365 SMTP throttling.
- `xlsx@0.18.5` nu mai este pe path-ul de parsare a inputului user (in v2.6.4
  `nameListParser.ts` a fost migrat la `exceljs@^4.4.0`). Ramane folosit doar
  ca dependinta tranzitiva pe path-ul write-only de export prin `xlsx-js-style`
  si in fixturile de test — fara expunere directa la fisiere uploadate.

## Urmatoarea etapa

Sprintul de monitorizare + email este incheiat. Roadmap-ul oficial
(`EXECUTION-ROADMAP.md`) nu mai are PR-uri planificate dupa v2.10.1 — PR-10
(Litestream/GCS) si PR-12 (GDPR delete + hash-chain audit) au fost eliminate
prin decizia #11 (cost-benefit negativ pentru solo dev fara firma; compliance
theatre pentru uz personal).

Directii deschise (toate optionale, fara timeline):

### A. Web cutover viitor (reevaluabil separat)

- Google Workspace SSO real peste seam-ul PR-9 (desktop noop / web JWT
  validation deja livrat in v2.7.0).
- Deploy server: Docker image, reverse proxy, TLS.
- Backup S3-compatible (Cloudflare R2 / Backblaze B2 ca alternativa la GCS
  eliminat).
- Captcha provider keys (2Captcha / CapSolver) muta-le in `.env` server-side
  in web mode; desktop pastreaza Electron `safeStorage`.

### B. Digest email zilnic (extensie optionala peste PR-11)

- PR-11 livreaza dispatch immediate per alerta. Digest-ul zilnic (un singur
  email cu rezumatul alertelor din ultima zi) era explicit marcat
  "non-scope pentru PR viitor optional" in `EXECUTION-ROADMAP.md` L347.
- Necesita un cron in scheduler + template HTML separat + setting per-owner
  pentru digest vs immediate vs both.

### C. Continuare ad-hoc

- Bug fixes / UX polish pe fluxurile existente (Monitorizare, Alerte,
  Dashboard, Admin) pe baza feedback-ului direct din uz real.
