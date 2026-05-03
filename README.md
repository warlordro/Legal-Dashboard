# Legal Dashboard

Desktop app (Electron) cu arhitectura web-ready pentru cautarea rapida a
dosarelor in portalul instantelor, interogarea Registrului National de
Publicitate Mobiliara (RNPM) si monitorizarea automata a dosarelor prin
PortalJust SOAP. Include un modul de analiza AI multi-agent (Claude, OpenAI,
Gemini) cu stocarea cheilor in keystore-ul sistemului de operare prin Electron
`safeStorage`.

Versiune curenta: **2.9.2**. Vezi [CHANGELOG.md](CHANGELOG.md) pentru istoric
si [SECURITY.md](SECURITY.md) pentru threat model. Ultimul release este
**v2.9.2** - patch notificari native: alertele de monitorizare raman in inbox-ul
aplicatiei si in badge-ul rosu, iar canalul Windows/macOS are acum status citibil
din Electron, buton de test in dialogul de configurare si gating defensiv cand
sistemul de operare raporteaza ca toast-urile sunt blocate. Dependintele
`windows-notification-state` si `macos-notification-state` sunt optionale si
incluse in packaging-ul desktop; daca statusul OS nu poate fi citit, alerta
interna nu se pierde. Predecesor **v2.9.1** - patch UX post-feedback: eliminata
sectiunea "Activitate recenta"
(componenta `Timeline`, introdusa in PR-B v2.8.0) din pagina Dashboard. Lista
randa "Run ok (dosar_soap) · 2.6s · 0 alerte noi · 2h in urma" plus event-uri
de audit — feedback explicit user a marcat continutul ca prea tehnic pentru
utilizatorii non-tehnici si redundant cu pagina dedicata `/alerte` (filtre +
paginatie + context dosar enrichment). Componenta `Timeline.tsx` ramane in
arbore, endpoint-ul `GET /api/v1/dashboard/timeline` ramane montat necitit de
UI ca sa nu sparga clientii externi. In-app changelog: intrare noua v2.9.1 +
intrare retroactiva "Refactor 11 stagii (post-v2.7.0)" care documenteaza
sweep-ul intern absent pana acum din UI. Predecesor **v2.9.0** - PR-C din
sprint-ul de redesign al Dashboard-ului (3/3, ultimul): Quick Action "Export
raport" devine functional. Modal cu picker `range` (7d / 30d) + `format`
(XLSX / PDF) genereaza un raport agregat printr-un endpoint nou
`GET /api/v1/dashboard/report?range=7d|30d` (snapshot atomic owner-scoped +
`withMaintenanceRead`) si construieste fisierul off-main-thread in Web Worker
(3 sheets XLSX: Sumar / Activitate zilnica / Cronologie; PDF landscape A4 cu
aceleasi 3 sectiuni). 645/645 teste backend (era 640 in v2.8.0, +5 noi pentru
`/report`). Predecesor **v2.8.0** - PR-B Dashboard timeline + charts
(eliminata sectiunea statica "TIPURI DE PROCESE DISPONIBILE", inlocuita cu
Timeline cursor-paginated + 3 charts daily 7d/30d). Inainte: **v2.7.1** -
patch UX dev mode taskbar icon (`ensureDevTaskbarShortcut()`).

**PR-C Backend - endpoint nou `/api/v1/dashboard/report`:** snapshot atomic
owner-scoped via `getOwnerId(c)`, wrapped in `withMaintenanceRead`. Validare
`range` 400 `invalid_range` daca nu e `7d`/`30d`. Reuseste blocurile
`readJobsBlock`/`readAlertsBlock`/`readRunsBlock`/`readAiBlock` (PR-A) pentru
sumar si agregarile zilnice (PR-B charts) pentru `charts`. Trei helperi noi
in `dashboardActivityRepository.ts`: `listAlertsInRange`,
`listFinalizedRunsInRange`, `listCuratedAuditInRange` (window inchis
`ts >= since AND ts <= until`, ordonate `(ts, id) DESC`, cap
`REPORT_TIMELINE_LIMIT = 500` per sursa). Cele 3 surse merge-uite si sortate
`ts DESC, id DESC`; `truncated = true` daca oricare sursa atinge cap-ul.

**PR-C Frontend - builders + modal:** `frontend/src/lib/export-report.ts`
expune `buildReportXlsx` (3 sheets: Sumar 13 randuri KPI, Activitate zilnica
9 coloane day x metrics, Cronologie 5 coloane events cu detail JSON
serializat 800ch cap; paleta `BLUE_DARK` titlu / `BLUE_MAIN` header /
`ROW_ALT`/`WHITE` alternativ; `sanitizeFormulaCells` pe formula injection)
si `buildReportPdf` (landscape A4 helvetica cu 3 sectiuni, `stripDiacritics`,
footer "Pagina N", italic note daca `truncated=true`). Filename pattern
`raport_dashboard_<range>_<dataRO>.<ext>`. ExportJob extins cu `reportXlsx` +
`reportPdf`, dispatch in `export.worker.ts` (build off main thread).
`ReportExportModal` (parent-controlled `open`/`onClose`, segmented control
range + format, `AbortController` per cerere, `aria-modal`+ ESC suport)
randat din `QuickActions` care are acum buton `<button onClick>` pentru
Export raport (era `disabled` in PR-A v2.7.0).

**PR-B Backend - timeline cursor-paginated:** `GET /api/v1/dashboard/timeline?
cursor=<isoTs>&limit=<n>` returneaza un stream descrescator combinat din 3
surse: `monitoring_alerts.created_at`, `monitoring_runs.ended_at` (doar
finalizate), `audit_log.ts` (curated set + `outcome != 'ok'` catch-all).
Cursor strict `<` mentine pagini stabile cand 2 evenimente au acelasi ms;
`limit` clamp `[1,100]`, default 30. Repository nou
`dashboardActivityRepository.ts` separat de per-table CRUD repos.

**PR-B Backend - charts daily series:** `GET /api/v1/dashboard/charts?range=7d|
30d` returneaza 3 serii aliniate pe acelasi UTC-day grid (`utcDayStart` din
aiUsageRepository, partajat cu AIUsagePanel): alerts count, runs split
ok/error/timeout/aborted, aiCost USD+calls+tokens. Closed lower bound `ts >=
since` aliniat cu PR-7. Backfill cu zero pe zilele lipsa.

**PR-B Frontend - Timeline + Charts:** `components/dashboard/Timeline.tsx`
randeaza lista cu iconita per kind (Bell/PlayCircle/Shield), pill colorat per
severity, subline contextual (run = duration+alerts_created+error_code; alert
= numar_dosar/nume din job_target; audit = outcome+target), buton "Incarca
mai multe" pe `nextCursor`. `components/dashboard/Charts.tsx` randeaza 3
charts side-by-side cu segmented control 7d/30d (BarChart amber pentru
alerte, BarChart stacked pentru runs cu legend interactive, AreaChart sky
pentru cost AI). `lib/chart-colors.ts` centralizeaza paleta.

**PR-A Backend - endpoint nou `/api/v1/dashboard/summary`:** read-only
aggregation owner-scoped via `getOwnerId(c)`, wrapped in `withMaintenanceRead`
ca sa coexiste cu backup/restore. 4 blocuri: `jobs.active` + `jobs.byKind`,
`alerts.unseen` + `alerts.last24h`, `runs {ok, error, timeout, aborted, total}`
(running excluse din totals; `aborted` ca bucket separat post-review),
`ai {costUsd, calls, tokens}` 24h cu closed lower bound + `cost_usd_milli/1000`.

**PR-A Frontend - KPI strip + Quick Actions:** `KpiStrip` cu 4 carduri
responsive (stacked → 2 col → 4 col, iconite ListChecks/Bell/Activity/Sparkles)
si `QuickActions` cu 6 butoane (2 → 3 → 6 col: Cauta dosar, Monitorizare,
RNPM, Alerte, Termene + Export raport disabled cu tooltip "Disponibil in
v2.9.0 (PR-C)"); ambele plasate deasupra `LastDosareCard` in
`pages/Dashboard.tsx`. Polling 30s prin `setInterval` cu `AbortController` per
request. Sprint Dashboard redesign continua cu PR-B v2.8.0 (timeline+charts)
si PR-C v2.9.0 (reports).

**PR-9 Backend - auth pluggable:** `AuthProvider` interface cu doua
implementari: `DesktopAuthProvider` returneaza `{ ownerId: "local" }` 1:1
(comportament identic cu pre-PR-9), `WebJwtAuthProvider` cere Bearer token sau
cookie `legal_dashboard_session`, valideaza HS256 cu `jose` + issuer +
audience, verifica userul activ in DB. Middleware `ownerContext()` set-eaza
`c.set("ownerId"|"actorId"|"authUser", ...)` si scrie audit `auth.denied` pe
401/403 cu wrap try/catch.

**PR-9 Boot gate fail-closed:** `LEGAL_DASHBOARD_ALLOW_REMOTE=1` (sau bind
non-loopback) cere acum `LEGAL_DASHBOARD_AUTH_MODE=web` +
`LEGAL_DASHBOARD_JWT_SECRET` (>=32 chars) + `LEGAL_DASHBOARD_JWT_ISSUER` +
`LEGAL_DASHBOARD_JWT_AUDIENCE` + `LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet`.
Desktop noop mode nu mai poate sa porneasca pe interfata remota. Migration nou
`0013_idx_runs_owner_ended` pentru queries 24h din dashboard summary.

Baza ramane v2.6.8 - review-driven hardening: HTML button nesting fix in
`/monitorizare` (CardHeader cu `role="button"`+`onKeyDown`), derivare
`CADENCE_COL_LETTER` din `HEADERS.indexOf("cadence_sec")`, eroare vizibila la
header lipsa in `parseBulkFile`.

Baza ramane v2.6.7 - export Monitorizare Excel + PDF cu paritate
Dosare/Termene: butoane Excel + PDF in CardHeader "Joburi active" cu
`Loader2` spin, builderii noi `buildMonitoringXlsx`/`buildMonitoringPdf`
reuseaza paleta din `lib/export.ts` (BLUE_DARK titlu, BLUE_MAIN header,
ROW_ALT/WHITE alternativ, sanitizeFormulaCells pe XLSX, stripDiacritics
pe PDF), filename pattern `monitorizare_<target_or_dataRO>.<ext>`,
ExportJob extins + dispatch in Web Worker.

Baza ramane v2.6.6 - UX polish Monitorizare name_soap parity:
randurile cu `job.kind === "name_soap"` randeaza target-ul `font-bold` urmat
de buton `Dosare` cu icon `Eye`, identic vizual cu randurile `dosar_soap`;
click → prop `onOpenName(target)` propagat din `App.tsx` ca
`handleHistoryClick("dosare", { numeParte: nume })`, reuseste flow-ul existent
`pendingSearch`; coloana TIP afiseaza "Nume" pentru `name_soap` (era "Subiect"),
consecvent cu formularul de adaugare si cu coloana `nume` din template-ul XLSX
(v2.6.5); ordinea coloanelor in tabel devine "Ultima rulare → Urmatoarea verif."
(era invers) pentru lectura naturala fapte→predictie.
Baza ramane v2.6.5 - patch UX polish frontend-only Monitorizare: link-ul
TINTA pentru joburile `dosar_soap` devine `font-bold` (numarul devine prima
ancora vizuala din rand, consecvent cu inbox-ul Alerte); cardul "Adaugare bulk din fisier"
devine collapsible (default colapsat) cu buton clickable pe header si icon
`ChevronDown`/`ChevronRight`, descrierea trece de pe gri (`text-muted-foreground`)
pe negru (`text-foreground`) si textul tehnic se rescrie in romana simpla
pentru utilizatori non-tehnici; template-ul XLSX bulk restilizat sa
match-uiasca exporturile celelalte (xlsx-js-style cu titlu BLUE_DARK centrat
merged A:E, header BLUE_MAIN border-bottom 1D4ED8, randuri alternate
ROW_ALT/WHITE, font 10, dropdown cadenta mutat pe `C5:C1004`); `parseBulkFile`
detecteaza header-ul dinamic (scaneaza primele 20 randuri) ca fisierele
vechi flat sa ramana compatibile cu template-ul nou; field-ul `notes` din
formularul de monitorizare devine in fine vizibil — randat inline sub
link-ul TINTA in **aceeasi celula**, conditionat pe `{job.notes && (…)}` ca
randurile fara nota sa ramana compacte (text mic italic gri, truncate cu
tooltip integral pe hover). 546/546 teste backend (neschimbate fata de v2.6.4
— modificarile sunt strict frontend).
Baza ramane v2.6.4 - audit hardening dupa multi-agent review (finalizat):
F1 `DELETE
/monitoring/jobs/:id` returneaza 409 `job_in_flight` cand runner-ul are
`AbortController` activ pe job (previne `RUNNER_THREW`); F2 `LEGAL_DASHBOARD_ALLOW_REMOTE=1`
REFUZA pornirea fara ack `LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet`
+ middleware nou `originGuard` pe `/api/*` blocheaza state-change cu Origin
mismatch (403 `csrf_origin_mismatch`); F3 `nameListParser.ts` migrat de pe
`xlsx@0.18.5` (CVE Prototype Pollution + ReDoS) pe `exceljs@^4.4.0`,
`parseNameList` async cu safety belt 30s, `xlsx` mutat in devDependencies;
F4+F5+F6 `enrichSolutieAlertsForJob` restrans — fereastra 7 zile + cap 200
alerte/tick + early return + match relaxat `(data, ora, complet)` cu fallback
cand textul `solutie` se schimba intre alerta initiala si publicarea hotararii;
F7 frame SSE nou `alert_enriched` ca alertele vechi primesc textul hotararii
fara refresh manual; F9 ruta noua `POST /monitoring/jobs/bulk-delete` atomica
(cap 100, raport `deleted_ids`/`inflight_ids`/`not_found_ids`); F10
`alerts_created` din `monitoring_runs` reflecta doar inserturile reale
(`insertAlert` returneaza `{row, inserted}`) + coloana noua `alerts_patched`
(migration `0012`) contorizeaza separat enrichment-urile in-place. 546/546
teste backend (era 524 in v2.6.3, +22 noi).
Baza ramane v2.6.3 - patch UX Monitorizare + Alerte: coloana TINTA in tabelul
de joburi `dosar_soap` afiseaza numarul ca link extern catre `portal.just.ro`
+ buton mic Search care declanseaza auto-search in lista Dosare,
dropdown-ul de cadenta prepende option `"<valoare> (custom)"` cu border
amber cand DB-ul are o valoare in afara optiunilor standard, paginarea
inbox-ului de alerte adopta `TablePagination` partajata, zoom-ul cardului
de alerta scade un pixel suplimentar pe scara fontului.
Baza ramane v2.6.2 - patch UX inbox alerte: cardul de alerta scaleaza dinamic
sub slider-ul de fonturi prin `zoom`, "Dosar: <numar>" e link extern catre
`portal.just.ro`, butonul navigheaza in Dosare, `solutie_aparuta` include
`solutie_sumar`/`numar_document`/`data_pronuntare` pe detail, "Detalii
suplimentare" afiseaza chei + valori (humanizate, JSON-stringificate, scurtate
la 200ch), `listAlerts` LEFT JOIN `monitoring_jobs` ca alertele vechi sa
primeasca `numar_dosar` din `target_json` chiar daca runner-ul nu enrich-uise
`detail`, linia tehnica `Job/Run/Dedup` scoasa din card.
Baza ramane v2.6.1 - alerte cu context dosar + identitate Windows: alertele
de monitorizare arata acum `numar_dosar` (injectat la nivelul runner-ului),
data formatata `dd.mm.yyyy`, ora, complet, solutie + buton "Cauta dosar" care
declanseaza search in Dosare; `app.setAppUserModelId` rezolva icon-ul
default Electron in taskbar-ul Windows si in native notifications.
Baza ramane v2.6.0 - PR-8 admin pages + roles guard: middleware nou
`requireRole(...allowed)` cu audit `auth.denied`, ruta `GET /api/v1/me`,
suprafata `/api/v1/admin/{users,audit,users/:id/quota}`, migration
`0011_user_quota_overrides`, hook `useCurrentUser` + componenta `AdminGate`,
sidebar conditional `Administrare` si trei pagini admin (`/admin/users`,
`/admin/audit`, `/admin/quota`). Guardrails irreversibile pe `last_admin` 409
(self-demote) si `self_deactivation` 409 (status non-active pe self).
Baza ramane v2.5.1 - PR-7 hardening: closed-lower-bound pe ferestre de timp,
`summary30d` aliniat la UTC-midnight, `purgeOldAiUsage(90)`,
`markShuttingDown()` latch si `inflightRef` AbortController pe refresh.
Baza ramane v2.5.0 - PR-7 AI usage tracking: migration
`0010_ai_usage`, tracking owner-scoped dupa fiecare call SDK AI, cost calculat
ca integer `cost_usd_milli`, endpoint `/api/v1/ai-usage/summary` si panou
"AI Usage" in Setari API cu cost ultimele 24h / 30 zile. Baza ramane PR-6: inbox `Alerte`,
badge cu necitite in sidebar, stream live `/api/v1/alerts/stream`, mark
read/dismiss si notificari native Electron.
PR-5 ramane baza de bulk name lists / `name_soap`: upload XLSX/CSV direct din
Monitorizare, template cu coloanele `numar_dosar`, `nume`, `cadence_sec`,
`notes` si dropdown Excel pentru cadenta, preview/commit pentru liste de nume,
auto-create joburi `name_soap`, runner SOAP pentru subiecti si alerte pe dosare
noi, stadii/categorii/relevanta. Patch-ul v2.3.0 ramane baza de hardening:
backup zilnic, restore
SQLite cu `PRAGMA integrity_check`, drain HTTP 30s, `idx_one_running_per_job`,
RNPM in maintenance lock, audit pe rute destructive, migration runner
self-heal bidirectional si export XLSX/PDF in Web Worker.


## Prerequisite

- **Node.js >= 22** (backend foloseste `--experimental-strip-types`)
- **Git**
- Optional, doar pentru reCAPTCHA RNPM: cont 2Captcha sau CapSolver (cu credit)
- Optional, doar pentru modulul AI: cheie API Anthropic / OpenAI / Google

## Setup local (5 pasi)

```bash
git clone <repo-url> legal-dashboard
cd legal-dashboard
npm install                  # instaleaza root + backend + frontend (workspaces)
cp backend/.env.example backend/.env    # edit daca vrei API keys din .env
npm run electron:dev         # porneste Electron (backend pe 3002, window)
```

Primul boot creeaza DB-ul la `app.getPath("userData")/legal-dashboard.db`.

## Comenzi utile

| Comanda | Ce face |
|---|---|
| `npm run electron:dev` | Porneste aplicatia desktop |
| `npm run rebuild:electron` | Recompileaza `better-sqlite3` pentru ABI-ul Electron dupa teste Node / `npm rebuild` |
| `npm run dev:backend` | Ruleaza backend-ul separat (Node + TS direct) pe 3002 |
| `npm run dev:frontend` | Ruleaza Vite dev server pe 5173 (doar renderer) |
| `npm run build` | Build productie (frontend + backend CJS bundle) |
| `npm run dist` | Build + `electron-builder` pentru Windows NSIS |
| `npm test --workspace=backend` | Ruleaza vitest pe backend (645 teste in v2.9.0: 640 baseline din v2.8.0 + 5 noi pentru `/report`; 591 din v2.7.0; baseline 546 din v2.6.4..v2.6.8) |
| `npx tsc --noEmit -p backend/tsconfig.json` | Type-check backend |
| `cd frontend && npx tsc --noEmit` | Type-check frontend |
| `npx biome check` | Lint + format check (warnings non-bloquant) |

## Monitoring

Feature-ul de monitorizare este pornit implicit pe desktop incepand din v2.2.0.
Scheduler-ul ruleaza joburi `dosar_soap` si `name_soap`, salveaza snapshot-uri,
detecteaza diferente intre sedinte/solutii/subiecti monitorizati si scrie audit
log pentru mutatiile relevante. v2.4.0 adauga bulk import pentru nume si runner
`name_soap`; v2.3.0 a adaugat finalize state-guarded + index unic
`idx_one_running_per_job` la nivel de DB, deci un singur run `running` simultan
per job - recovery-ul de crash nu mai poate produce duplicate.

Kill switch-uri operationale:

- `MONITORING_ENABLED=0` opreste mount-ul rutelor si scheduler-ul.
- `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` exclude tipurile listate din
  claim-ul scheduler-ului fara modificari in DB.

Tipul `aviz_rnpm` ramane rezervat pentru o etapa viitoare; `name_soap` este activ in v2.4.0+.

## Server / Docker deploy

`npm run dist:server` genereaza `server-release/portaljust-server-<version>.zip`.
ZIP-ul include `package-lock.json` + manifestele workspace si scripturile
`start.sh` / `start.bat` instaleaza runtime deps cu `npm ci` la prima pornire
daca lipseste `node_modules/better-sqlite3`. Motiv: `better-sqlite3` este modul
nativ si trebuie compilat pe platforma tinta.

Docker foloseste acelasi lockfile prin `npm ci --workspace=backend --omit=dev`
si are `start-period=120s` pe healthcheck pentru boot-uri lente cu prewarm /
migrari DB.

## Configurare

Toate variabilele de environment sunt in [backend/.env.example](backend/.env.example).
Cheile API pentru AI pot fi setate fie in `.env` (precedence), fie din UI
(salvate local prin safeStorage). Vezi `SECURITY.md` pentru detalii.
Cheile 2Captcha / CapSolver raman in UI + safeStorage pe desktop; in planul
web/server (PR-9) vor fi mutate server-side in `.env`/config si nu vor fi BYOK
sau trimise din browser.

Port backend default: `3002`. Suprascrie cu `LEGAL_DASHBOARD_PORT`.
LAN exposure blocat by default; opt-in explicit cu `LEGAL_DASHBOARD_ALLOW_REMOTE=1`.

## Auth modes (PR-9)

Aplicatia suporta doua moduri de autentificare:

- **desktop** (default): single-user `local` identity, no token validation.
  Folosit cand backend-ul ruleaza in-process via Electron.
- **web**: JWT validation pe `Authorization: Bearer <token>` sau cookie
  `legal_dashboard_session`. Cere `LEGAL_DASHBOARD_JWT_SECRET` (32+ bytes).

### Env vars

- `LEGAL_DASHBOARD_AUTH_MODE` - `desktop` | `web` (default `desktop`)
- `LEGAL_DASHBOARD_JWT_SECRET` - required pentru web mode
- `LEGAL_DASHBOARD_JWT_ISSUER` - optional, default `legal-dashboard`
- `LEGAL_DASHBOARD_JWT_AUDIENCE` - optional
- `LEGAL_DASHBOARD_JWT_TTL_SECONDS` - optional, default `3600`
- `LEGAL_DASHBOARD_ALLOW_REMOTE=1` - opt-in pentru bind non-loopback; cere
  `LEGAL_DASHBOARD_AUTH_MODE=web` + `LEGAL_DASHBOARD_ACK_NO_AUTH`
- `LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet` - confirmare boot
  pentru bind non-loopback

### Setup user pentru web mode

JWT `sub` trebuie sa mapeze la o coloana activa `users.id`. Pre-seedati userii
manual pana la PR-10/PR-11 (server-side sessions + Google SSO). `/api/v1/auth/login`
returneaza 501 in acest sprint - login-ul real vine in PR-11.

### `/health`

`/health` ramane public si non-sensitive in toate modurile.

## Arhitectura (scurt)

- `electron/main.js` - main process: single-instance lock, CSP, safeStorage IPC,
  backend bundle load
- `electron/preload.js` - context bridge (doar safeStorage)
- `backend/src/index.ts` - Hono server (port 3002), bootstrap scheduler, rute AI,
  SOAP PortalJust, RNPM
- `backend/src/routes/monitoring.ts` - API v1 pentru joburi de monitorizare,
  manual run si body-size limits dedicate
- `backend/src/services/monitoring/**` - scheduler, diff, runner `dosar_soap`,
  clock/test seams
- `backend/src/routes/rnpm.ts` - search + bulk + baza locala + export
- `backend/src/db/**` - SQLite (better-sqlite3), migrari versionate,
  repositories cu `owner_id`, audit si monitoring tables
- `frontend/src/**` - React 18 SPA (Vite), comunica cu backend prin REST/SSE
- `dist-backend/`, `dist-frontend/` - output de build

## Securitate

Vezi [SECURITY.md](SECURITY.md) pentru threat model complet, protectii
desktop/backend si scope out-of-scope (cod fara semnatura Windows, LAN mode
fara auth, etc.).
