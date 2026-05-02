# Legal Dashboard â€” Context Proiect

## Descriere
Aplicatie Electron desktop pentru cautare dosare si termene (portalquery.just.ro, SOAP) **+ modul RNPM** (Registrul National de Publicitate Mobiliara, via HTTP cu rezolvare captcha 2Captcha / CapSolver). Target final: se va deploya si ca aplicatie web â€” fiecare decizie arhitecturala trebuie sa supravietuiasca ambelor moduri.

## Versiune Curenta
**v2.7.1** - 2 Mai 2026 (patch UX: icon Legal Dashboard pe taskbar in dev mode). Helper nou `ensureDevTaskbarShortcut()` in `electron/main.js` apelat in `app.whenReady()` creeaza per-user `Legal Dashboard (Dev).lnk` in `%APPDATA%\Microsoft\Windows\Start Menu\Programs` cu `target=process.execPath`, `args="<projectRoot>"`, `icon=build/icon.ico`, `appUserModelId="ro.legaldashboard.app"` ca Windows sa rezolve corect AUMID-ul la icon-ul aplicatiei in taskbar pentru `npm run electron:dev` (build-ul NSIS instalat avea deja icon-ul corect via shortcut-urile generate de electron-builder, dar dev mode nu trecea prin acel flow). Skip pe `app.isPackaged` si pe non-Windows. Idempotent: skip daca shortcut-ul exista. Erorile try/catch + `console.warn` (nu blocheaza boot). Build NSIS neafectat, zero teste noi (boot-time helper).

Predecesor **v2.7.0** - 2 Mai 2026 (release dual: PR-A Dashboard redesign + PR-9 Auth pluggable, mergeate impreuna in main, tag `v2.7.0` push-uit). **PR-A — Backend:** endpoint nou `/api/v1/dashboard/summary` (owner-scoped, withMaintenanceRead) care agrega 4 blocuri intr-o singura cerere — joburi active cu byKind dosar_soap/name_soap, alerte unseen+last24h, rulari ok/error/timeout/total cu `aborted` separat (post review hardening, nu mai e foldat in error) si still-running excluse, AI cost+calls+tokens 24h. **PR-A — Frontend:** `KpiStrip` (4 carduri responsive) + `QuickActions` (6 butoane) inserate deasupra `LastDosareCard` in `pages/Dashboard.tsx`; polling 30s cu `AbortController`; subline runs arata "X ok / X erori / X timeout / X oprite"; al saselea button (Export raport) ramane disabled cu tooltip "Disponibil in v2.9.0 (PR-C)". **PR-9 — Backend:** `AuthProvider` interface (`DesktopAuthProvider` noop / `WebJwtAuthProvider` HS256 cu `jose`, valideaza issuer+audience+user.active); `ownerContext` middleware emite `recordAudit("auth.denied")` pe 401/403 cu ip+ua+requestId; rute `/api/v1/auth/{login,logout,refresh}` (login→501 catre PR-10); `validateAuthConfig()` arunca pe missing JWT_ISSUER/JWT_AUDIENCE in web mode; `AUTH_COOKIE_SECURE=0` in productie = hard error; pre-auth rate-limit predicat fix; mesaje auth traduse in romana; JWT error codes interne logate, public `unauthorized` only. **Migration:** `0013_idx_runs_owner_ended` pe `monitoring_runs(owner_id, ended_at DESC) WHERE ended_at IS NOT NULL`. **Tests:** 591/591 verzi (553 baseline PR-A + 38 noi P0/P1 PR-9). **Commits:** `c74a77e` PR-A (squashed), `61580a4` PR-9 audit pack, `579ce7b` review hardening.)

Vezi `CHANGELOG.md` pentru istoric complet si `SECURITY.md` pentru threat model.

### Sprint curent: monitoring + web mode (PR-0..PR-12)
- âœ… **PR-0** v2.0.11 â€” migration framework + 0001 baseline (commit `9c3a9aa` pe main)
- âœ… **PR-1** v2.0.12 â€” `getOwnerId` helper + 5 fix-uri owner_id leak (commit `beca3b6` pe main)
- âœ… **PR-2** v2.0.13 â€” shadow tables users/sessions + audit_log + `recordAudit()` (commit `c09a855` pe main)
- âœ… **PR-3** v2.1.0 â€” monitoring core: schema 0003 + helperi (canonicalJson/sedintaKey/envelope/requestId) + repo + rute `/api/v1/monitoring/jobs` + UI minimal (post-review hardening absorbit)
- âœ… **PR-4** v2.2.0 â€” monitoring scheduler + dosar_soap runner + full-review hardening Tier 2-6
- âœ… **patch v2.3.0** â€” audit remediation: backup zilnic recurent, restore SQLite cu PRAGMA integrity check, graceful shutdown drain 30s, `idx_one_running_per_job` (migration 0005), executeSearch RNPM in maintenance lock, audit pe rute destructive RNPM, migration runner self-heal bidirectional pe line endings, export Web Worker pe RNPM + AI + Manual
- ✅ **PR-5 v2.4.0** - bulk import Monitorizare cu `numar_dosar` sau `nume`, template XLSX cu dropdown cadenta, preview/commit name lists, auto-create jobs `name_soap`, runner SOAP pentru subiecti si fixuri post-review pentru race-uri `name_lists`/archive
- ✅ **PR-6 v2.4.1** - inbox alerte (`/api/v1/alerts` + pagina React + sidebar badge), SSE stream live, IPC notificari native Electron
- ✅ **patch v2.4.2** - PR-6 hotfix post full-review: SSE heartbeat 25s + `retry: 3000`, fix timezone in filtre data, audit pe `seen`/`dismissed`, `bodyLimit`, cap 5 stream-uri/owner, `seen-bulk` route + bulk repo helper, `insertAlert` tranzactional + `notifyNewAlert` deferred microtask, focus suppress pe notificari desktop, dedup native pe `tag`
- ✅ **PR-7 v2.5.0** - AI usage tracking: migration `0010_ai_usage`, `aiUsageRepository`, cost model integer `cost_usd_milli`, post-call tracking pentru single + multi-agent, endpoint `/api/v1/ai-usage/summary`, panou AI Usage in Setari API
- ✅ **patch v2.5.1** - PR-7 hardening post multi-review: closed-lower-bound pe ferestre de timp, `summary30d` aliniat la UTC-midnight ca seria daily, `withMaintenanceRead` pe `/summary`, `purgeOldAiUsage(90)` in scheduler zilnic, `markShuttingDown()` latch ca microtask-urile post-shutdown sa nu redeschida DB-ul, multi-agent `analystsAbort` shared, `httpStatus` clamped `[100,599]`, price-table miss warn one-shot, insert SQLite deferred via `queueMicrotask`, fix timezone pe seria daily UI, `inflightRef` AbortController pe refresh, caption "Informativ" pentru quota desktop
- ✅ **PR-8 v2.6.0** - admin pages + roles guard: middleware `requireRole(...allowed)` cu audit `auth.denied`, ruta `GET /api/v1/me`, suprafata `/api/v1/admin/{users,audit,users/:id/quota}`, migration `0011_user_quota_overrides`, hook `useCurrentUser` + componenta `AdminGate`, sidebar conditional Administrare, pagini `/admin/{users,audit,quota}`, guardrails self-demote (`last_admin` 409) + self-deactivation (`self_deactivation` 409), audit envelope `before`/`after` pe writes
- ✅ **patch v2.6.1** - alerte cu context dosar + identitate Windows: `dosarSoapRunner`/`nameSoapRunner` injecteaza `numar_dosar`/`instanta`/`stadiu`/`name_normalized` in `detail` la limita runner-ului (diff-ul ramane pur), `pages/Alerts.tsx` afiseaza detail structurat (data formatata `dd.mm.yyyy`, ora, complet, solutie, stadiu) + buton "Cauta dosar" care reuseste mecanismul `pendingSearch` din App.tsx pentru auto-search in Dosare, `electron/main.js` apeleaza `app.setAppUserModelId("ro.legaldashboard.app")` ca taskbar-ul si native notifications sa nu mai foloseasca icon-ul default Electron
- ✅ **patch v2.6.2** - UX inbox alerte: card scaling reactiv (font + padding + gap) `zoom: (slider.value-2)/slider.value` legat de `useFontSize`, `Dosar: <numar>` linkificat extern catre `portal.just.ro` (prin `setWindowOpenHandler` whitelist), buton "Cauta in app" cu titlu corect, `diff/dosarSoap.ts` adauga `solutie_sumar`/`numar_document`/`data_pronuntare` la `solutie_aparuta` ca textul integral al hotararii sa apara in card, `buildAlertContext` parseaza si valorile din "Detalii suplimentare" (humanizate, JSON-stringificate, 200ch cap), `listAlerts` LEFT JOIN `monitoring_jobs` cu emit `job_target_json`/`job_kind` ca alertele pre-enrichment sa primeasca tot `numar_dosar`, linia tehnica `Job/Run/Dedup` eliminata din card
- ✅ **patch v2.6.3** - UX Monitorizare + Alerte: coloana TINTA in tabelul de joburi `dosar_soap` afiseaza acum numarul ca link extern catre `portal.just.ro` + buton mic Search care declanseaza auto-search in lista Dosare prin acelasi mecanism `pendingSearch` ca in Alerte; dropdown-ul de cadenta prepende option `"<valoare> (custom)"` cu border amber cand DB-ul are o cadenta in afara optiunilor standard ({4h, 8h, 12h, 24h}) ca UI-ul sa nu mai afiseze fals "4h" peste un job care ruleaza la 10min (bug investigat empiric: job `1234/180/2024` cu `cadence_sec=600` afisa "4h" dar runner-ul folosea valoarea reala — divergenta UI/runtime); paginarea inbox-ului de alerte foloseste componenta partajata `TablePagination` (page-size selector + numere de pagina + input de salt), iar zoom-ul cardului scade un pixel suplimentar pe scara fontului (`zoom: (slider.value - 3) / slider.value`)
- ✅ **patch v2.6.4** - audit hardening (multi-agent review) finalizat: F1 DELETE in-flight check 409, F2 fail-closed remote (`LEGAL_DASHBOARD_ACK_NO_AUTH` ack required) + middleware nou `originGuard` CSRF pe `/api/*`, F3 migrare `xlsx@0.18.5` → `exceljs@^4.4.0` in `nameListParser.ts` (async + safety belt 30s), F4-F6 enrichSolutie restrans (200/tick + 7d window + match relaxat), F7 SSE `alert_enriched`, F9 bulk delete atomic (`POST /jobs/bulk-delete` cu raport detaliat), F10 `alerts_created` reflecta inserturi reale + coloana noua `alerts_patched` (migration `0012`). 546/546 teste (era 524 in v2.6.3, +22 noi)
- ✅ **patch v2.6.5** - UX polish Monitorizare: TINTA-link bold (`font-bold` pe link-ul PortalJust din randurile `dosar_soap`); cardul "Adaugare bulk din fisier" devine collapsible (default colapsat) + descriere rescrisa pentru non-tehnici (text negru, nu gri); template XLSX bulk restilizat sa match-uiasca exporturile celelalte din aplicatie (xlsx-js-style cu titlu BLUE_DARK centrat, header BLUE_MAIN, randuri alternate `ROW_ALT`/`WHITE`, font 10, dropdown cadenta mutat pe `C5:C1004`, header detectat dinamic in `parseBulkFile` ca formatele vechi flat sa ramana compatibile); notele de monitorizare devin vizibile inline sub link-ul TINTA pe randurile cu `notes` populat (text mic italic gri, truncate cu tooltip pe hover; randurile fara nota raman compacte, fara coloana noua)
- ✅ **patch v2.6.6** - UX polish Monitorizare — name_soap parity: butonul `Dosare` adaugat pe randurile `name_soap` (target in `font-bold` + `Eye` icon, identic vizual cu randurile `dosar_soap`); click → `onOpenName(target)` propagat din `App.tsx` ca `handleHistoryClick("dosare", { numeParte: nume })`, reuseste flow-ul `pendingSearch` existent; label-ul afisat in coloana TIP pentru `name_soap` schimbat "Subiect" → "Nume" pentru consecventa cu formularul de adaugare si cu coloana `nume` din template-ul XLSX; swap coloane in tabel — "Ultima rulare" pus inaintea "Urmatoarea verif." (lectura naturala fapte→predictie)
- ✅ **patch v2.6.7** - export Monitorizare Excel + PDF cu paritate Dosare/Termene: butoane Excel + PDF in CardHeader "Joburi active" (vizibile cand `jobs.length > 0`), state partajat `exporting: "xlsx" | "pdf" | null` + `Loader2` spin pe butonul activ; `getExportJobs()` returneaza selectia sau toate joburile (suffix `(N)` pe label cand `selectedIds.size > 0`); builderii noi `buildMonitoringXlsx` + `buildMonitoringPdf` reuseaza paleta de stiluri si helperii existenti din `lib/export.ts` — XLSX cu titlu `PORTALJUST DASHBOARD — MONITORIZARE` BLUE_DARK, header BLUE_MAIN, randuri alternate ROW_ALT/WHITE, `sanitizeFormulaCells` pe formula-injection guard; PDF landscape A4 helvetica cu header `[37,99,235]` si alternate row `[245,247,250]`, `stripDiacritics` pe text, footer "Pagina N"; 8 coloane (#, Tinta, Tip, Cadenta, Ultima rulare, Urmatoarea verif., Status, Note); ExportJob extins cu `monitoringXlsx`+`monitoringPdf`, dispatch in `export.worker.ts` (build off main thread); filename pattern `monitorizare_<target_or_dataRO>.<ext>`; zero modificari pe backend, 546/546 teste raman verzi
- ✅ **patch v2.6.8** - review-driven hardening peste v2.6.7. **Frontend a11y:** `<button>` care wrappa `<CardHeader>` (div) + `<CardTitle>` (h3) la "Adaugare bulk din fisier" eliminat — handler-ul muta direct pe `<CardHeader role="button" tabIndex={0}>` cu `onClick` + `onKeyDown` (Enter/Space + `preventDefault`) + `focus-visible:ring`; `aria-expanded`/`aria-controls` pastrate. **Frontend template safety:** `CADENCE_COL_LETTER` derivat din `HEADERS.indexOf("cadence_sec")` printr-un helper nou `colIndexToLetter` (0-based → A, B, ..., Z, AA) — reordonarea `HEADERS` nu mai poate sa desincronizeze silent dropdown-ul OOXML injectat cu `fflate`; boot-time guard cand `cadence_sec` lipseste din `HEADERS`. **Frontend UX:** `parseBulkFile` push-uieste o intrare in `invalid[]` cu mesaj clar ("Header lipsa: fisierul nu contine niciuna dintre coloanele recunoscute...") cand `findHeaderRow` esueaza, in loc de silent return care lasa utilizatorul cu "0 randuri valide" fara explicatie. **Docs:** `SESSION-HANDOFF.md` linia "xlsx@0.18.5 ramane risc acceptat temporar..." rescrisa — post-v2.6.4 `nameListParser.ts` ruleaza pe `exceljs@^4.4.0`, `xlsx` nu mai e pe path-ul de parsare a inputului user, ramane folosit doar tranzitiv prin `xlsx-js-style` pe path-ul write-only. **Style commitment:** structured-section style aplicat pe entries noi (`**Frontend:**`, `**Backend:**`, `**Tests:**`); entries istorice nu se retrofiteaza. 546/546 teste raman verzi.
- ✅ **PR-A v2.7.0** - Dashboard redesign sprint (PR-A din 3 — PR-B v2.8.0 timeline+charts, PR-C v2.9.0 reports). **Backend:** endpoint nou `GET /api/v1/dashboard/summary` (owner-scoped via `getOwnerId(c)`, wrapped in `withMaintenanceRead` ca sa coexiste cu backup/restore) cu 4 blocuri agregate: `jobs.active` + `jobs.byKind {dosar_soap, name_soap}`, `alerts.unseen` + `alerts.last24h`, `runs {ok, error, timeout, total}` (status `aborted` foldat in bucket `error`, runs `running` excluse), `ai {costUsd, calls, tokens}` 24h cu closed lower bound + `cost_usd_milli/1000` si `+ generatedAt`. **Frontend - KPI strip + Quick Actions:** `KpiStrip` (4 carduri responsive: stacked → 2 col → 4 col, iconite ListChecks/Bell/Activity/Sparkles, loading skeleton cu Loader2, error inline destructive, helperi `formatUsd`/`formatTokens`); `QuickActions` (6 butoane in grid 2→3→6: Cauta dosar, Monitorizare, RNPM, Alerte, Termene + Export raport `disabled` cu tooltip "Disponibil in v2.9.0 (PR-C)"); ambele plasate deasupra `LastDosareCard` in `pages/Dashboard.tsx` cu polling 30s prin `setInterval` + `AbortController` per request (AbortError ignorat, MonitoringApiError extras la mesaj). **Frontend API surface:** `dashboardApi.summary(signal?)` adaugat in `frontend/src/lib/api.ts` (reuseste `unwrapMonitoring`/`MonitoringApiError`, NU se creeaza fisier separat ca sa nu loveasca hook-ul `block-renderer-fetch.mjs`); interfete `DashboardSummary`/`DashboardJobsBlock`/`DashboardAlertsBlock`/`DashboardRunsBlock`/`DashboardAiBlock` exportate. **Tests:** 7 teste noi in `routes/dashboard.test.ts` (envelope+empty state, `jobs.byKind` filtru active, alerts unseen vs last24h windowing, runs status bucketing cu `aborted`→`error`, still-running excluse cu doua joburi separate pentru `idx_one_running_per_job`, AI 24h aggregation, owner isolation 2 tenants); pattern Hono test app cu `x-test-owner` middleware + `requestIdContext`. **Coordonare cu Codex:** PR-9 auth pluggable pastrat in stash labelat pentru pop pe branch-ul corect (Codex landase initial pe `feat/dashboard-redesign` din eroare); `dashboard.ts` salvat in `/c/tmp/pr-a-backup/` pe durata stash-ului si restaurat. 553/553 teste verzi (546 baseline din v2.6.4 + 7 noi).
- ✅ **PR-9 v2.7.0** - auth pluggable seam mergeat in main impreuna cu PR-A (commits `61580a4` + `579ce7b`, tag `v2.7.0`). **Backend:** `AuthProvider` interface (desktop noop returneaza `local`/`local`; web JWT HS256 cu `jose`, valideaza `issuer`+`audience`+user `active` in DB); `ownerContext` middleware apeleaza provider-ul si emite `recordAudit("auth.denied", {...})` pe orice 401/403 wrapped in try/catch (audit failure nu blocheaza raspunsul); rute `/api/v1/auth/{login,logout,refresh}` (login → 501 `not_implemented` cu pointer catre PR-10 cutover); `validateAuthConfig()` arunca daca `JWT_ISSUER`/`JWT_AUDIENCE` lipsesc in web mode; `AUTH_COOKIE_SECURE=0` in productie = hard error la boot; rate-limit pre-auth predicat fix (decrementa counter doar pe 2xx, era inversat); JWT error codes interne (`jwt_expired`/`jwt_invalid_audience`/`jwt_invalid_issuer`/`jwt_invalid_signature`/`jwt_malformed`) logate via `console.warn`, raspuns public `unauthorized` ca sa nu leak-uiasca detalii; mesajele auth traduse in romana. **Migration:** `0013_idx_runs_owner_ended` pe `monitoring_runs(owner_id, ended_at DESC) WHERE ended_at IS NOT NULL` pentru queries 24h din dashboard summary. **Dashboard runs.aborted separat:** schema `RunsBlock` are camp nou `aborted: number` (era pierdut prin folding in `error`); `KpiStrip` arata "X ok / X erori / X timeout / X oprite". **Tests:** 591/591 verzi (553 baseline PR-A + 38 noi P0/P1 in `auth/jwt.test.ts`, `auth/config.test.ts`, `middleware/owner.test.ts`, `middleware/rate-limit.test.ts`, `routes/auth.test.ts`, `routes/dashboard.test.ts`).

Detalii in [EXECUTION-ROADMAP.md](EXECUTION-ROADMAP.md) si [SESSION-HANDOFF.md](SESSION-HANDOFF.md).

## Structura Proiect
```
legal-dashboard/
â”œâ”€â”€ frontend/          # React 18 + TypeScript + Vite + custom CSS
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ pages/     # Dashboard, Dosare, Termene, RnpmSearch, Changelog, Manual,
â”‚       â”‚              # Alerts, Monitorizare, plus admin pages (admin/*)
â”‚       â”œâ”€â”€ components/# DosareTable, TermeneTable, Sidebar, MetricsPanel, CalendarView,
â”‚       â”‚              # DosarModal, InstitutieSelect, SearchForm, TermeneMetrics,
â”‚       â”‚              # AdminGate, AIUsagePanel, table-pagination, rnpm/*, ui/,
â”‚       â”‚              # monitoring/* (MonitoringAddForm, MonitoringBulkImportCard),
â”‚       â”‚              # dashboard/* (KpiStrip, QuickActions)
â”‚       â”œâ”€â”€ hooks/     # useApiKey (safeStorage IPC), useDialog, useFontSize,
â”‚       â”‚              # useRnpmHistory, useSearchHistory, useTheme,
â”‚       â”‚              # useAlertsStream (SSE lifecycle), useCurrentUser
â”‚       â”œâ”€â”€ lib/       # api.ts (re-export barrel), rnpmApi.ts, monitoringApi.ts,
â”‚       â”‚              # alertsApi.ts, aiUsageApi.ts, adminApi.ts, dashboardApi.ts,
â”‚       â”‚              # export.ts (+ worker), rnpmExport.ts (+ worker),
â”‚       â”‚              # export-analysis.ts, export-manual.ts, excel-helpers.ts,
â”‚       â”‚              # pdf-helpers.ts, changelog-pdf.ts, monitoringBulkTemplate.ts,
â”‚       â”‚              # alert-context.tsx, datetime-formatters.ts,
â”‚       â”‚              # chart-colors.ts, institutii.ts, utils.ts (cn() helper)
â”‚       â””â”€â”€ types/     # desktop-api.d.ts, index.ts, rnpm.ts
â”œâ”€â”€ backend/           # Node.js 22+ + Hono (port 3002)
â”‚   â”œâ”€â”€ tsconfig.json  # strict: true, noEmit (type-check only)
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ index.ts   # Bootstrap: CSP, CORS, mount routers, prewarm, backup, shutdown
â”‚       â”œâ”€â”€ routes/    # rnpm.ts, dosare.ts (SOAP search), termene.ts, ai.ts, aiUsage.ts,
â”‚       â”‚              # monitoring.ts, alerts.ts (+ SSE), nameLists.ts, dashboard.ts,
â”‚       â”‚              # me.ts, admin.ts, auth.ts (PR-9 seam, login â†’ 501 pana la PR-10)
â”‚       â”œâ”€â”€ auth/      # PR-9 seam: authProvider.ts (Desktop noop / Web JWT HS256),
â”‚       â”‚              # jwt.ts (jose verify), config.ts (validateAuthConfig)
â”‚       â”œâ”€â”€ services/  # rnpmSearchService, captchaSolver, rnpmClient,
â”‚       â”‚              # ai.ts (Claude/OpenAI/Gemini), aiUsage.ts, batch-dosare.ts, monitoring/*
â”‚       â”œâ”€â”€ middleware/# rate-limit.ts (real-IP), static-frontend.ts (path-traversal guard),
â”‚       â”‚              # owner.ts (getOwnerId + ownerContext PR-9), originGuard.ts (CSRF),
â”‚       â”‚              # requireRole.ts (PR-8 admin guard), requestId.ts
â”‚       â”œâ”€â”€ db/        # schema.ts, avizRepository.ts, searchRepository.ts,
â”‚       â”‚              # backup.ts (owner_id everywhere), auditRepository.ts (recordAudit),
â”‚       â”‚              # aiUsageRepository.ts, userRepository.ts, userQuotaRepository.ts,
â”‚       â”‚              # monitoringJobsRepository.ts, monitoringRunsRepository.ts,
â”‚       â”‚              # monitoringSnapshotsRepository.ts, monitoringAlertsRepository.ts,
â”‚       â”‚              # monitoringAlertsEnrichment.ts (Stage 10 split), nameListsRepository.ts,
â”‚       â”‚              # migrations/ (0001..0013, latest idx_runs_owner_ended)
â”‚       â”œâ”€â”€ util/      # textNormalize (SQLite rnpm_norm diacritic fold), validation.ts
â”‚       â”œâ”€â”€ soap.ts    # SOAP client pentru PortalJust
â”‚       â””â”€â”€ intervals.ts
â”œâ”€â”€ electron/          # Electron shell
â”‚   â”œâ”€â”€ main.js        # Single-instance lock, CSP, safeStorage IPC, crash handlers
â”‚   â””â”€â”€ preload.js     # Context bridge (doar safeStorage, IPC timeout 10s)
â”œâ”€â”€ scripts/           # build.js (esbuild backend â†’ CJS + copy frontend),
â”‚                      # build-server.js (ZIP deploy), generate-icon.mjs
â”œâ”€â”€ biome.json         # Lint + format config
â”œâ”€â”€ README.md          # Setup pentru developeri noi
â””â”€â”€ SECURITY.md        # Threat model + protectii
```

## Comenzi
- `npm run electron:dev` â€” porneste Electron (backend in-process pe 3002)
- `npm run rebuild:electron` â€” recompileaza `better-sqlite3` pentru ABI-ul Electron dupa teste Node / `npm rebuild`
- `npm run dev:backend` â€” backend standalone (pentru dev web)
- `npm run dev:frontend` â€” Vite dev server pe 5173
- `npm run build` â€” build productie (frontend + backend CJS)
- `npm run dist` â€” electron-builder pentru Windows NSIS
- `npm test --workspace=backend` â€” vitest backend (591 teste, baseline din v2.7.0; 553 din PR-A + 38 din PR-9)
- `npx tsc --noEmit -p backend/tsconfig.json` â€” type-check backend
- `cd frontend && npx tsc --noEmit` â€” type-check frontend
- `npx biome check` â€” lint + format check
- `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` â€” kill switch operational pentru a opri temporar claim-ul pe anumite tipuri de joburi de monitoring

## Arhitectura
- **Frontend**: React 18, Vite 5, Tailwind + clsx + tailwind-merge (`cn()` helper, ~40 callers in `components/ui/`), Recharts, DOMPurify
- **Backend**: Hono + `@hono/node-server`, SOAP XML parsing manual
- **DB**: SQLite via `better-sqlite3`, repositories + schema cu `owner_id DEFAULT 'local'` pe toate tabelele
- **AI**: Anthropic SDK, OpenAI SDK, Google Generative AI SDK
- **Captcha**: 2Captcha + CapSolver (mod sequential sau race)
- **Export**: `xlsx-js-style` cu formula-injection escape (`=+-@\t\r` prefix)
- **Desktop**: Electron 41, single-instance lock, safeStorage (DPAPI / Keychain / libsecret)
- **Build**: esbuild (backend â†’ CJS, `--external:better-sqlite3 --external:electron`), Vite (frontend)

## Securitate (audit intern 19 Aprilie 2026 â€” v2.0.5; predecesor 17 Aprilie â€” v2.0.2)
### Protectii active
- **safeStorage IPC** pentru cheile API (DPAPI / Keychain / libsecret), ciphertext in localStorage doar
- **CSP strict** (`script-src 'self'`, fara `unsafe-inline`), `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- **IPC timeout 10s** in preload.js (previne renderer freeze)
- **Single-instance lock** (previne corupere SQLite din writers concurrenti)
- **Crash handlers** (`uncaughtException`, `unhandledRejection`, `before-quit` â†’ cleanup SQLite WAL)
- **DOMPurify** pe toate outputurile AI (HTML render)
- **Rate limiter** per IP via `getConnInfo` (nu trusted proxy headers)
- **Hono `secureHeaders`** + CSP per-response
- **LAN bind opt-in**: `LEGAL_DASHBOARD_ALLOW_REMOTE=1` required altfel `127.0.0.1` hard-forced
- **XLSX formula-injection escape** (`=+-@\t\r` â†’ prefix `'`)
- **Body size limits** (64KB search, 512KB bulk, 4KB small, 100KB AI)
- **Rate limits** dedicated (search, bulk, export, small)
- **External URL whitelist** exact: portal.just.ro, www.just.ro, portalquery.just.ro, mj.rnpm.ro, www.rnpm.ro
- **Backup atomic**: daily backup scrie la `.db.tmp` + rename atomic, cleanup orphan tmp la urmatorul run
- **SOAP cancellation**: `AbortSignal` extern propagat pana in fetch-ul PortalJust, combinat cu timeout intern
- **Monitoring operational kill switch**: `MONITORING_DISABLED_KINDS` exclude tipurile listate din scheduler claim fara modificari in DB
- **Monitoring run retention**: `monitoring_runs` este purjat zilnic la 90 zile pentru a limita cresterea istoricului operational
- **AI usage tracking**: orice call SDK reusit sau pornit si esuat scrie owner-scoped in `ai_usage` dupa call, fara SQLite lock peste I/O extern

### Riscuri acceptate
- SOAP HTTP upstream (portalquery.just.ro nu ofera HTTPS) â€” date publice, fara autentificare
- Unsigned Windows binary â€” SmartScreen warning la prima instalare (fara cert commercial)
- LAN mode fara auth â€” user doar dupa opt-in explicit

## Web-readiness bridge (prep pentru deploy server)
- Repository-only DB access â€” raw SQL doar in `backend/src/db/**`
- `owner_id` column pe toate tabelele (DEFAULT `'local'`)
- Pagination offset-based (`{ page, pageSize, total }`) pe listari principale
- Zero sync fs in handlers (async `fs/promises` everywhere)
- Opt-in `clientRequestId` dedup pe mutations (idempotency)
- No singleton state tied to user activity

## Roadmap & Planuri Active
**Trimestrul curent (sapt 1-13, 2026-04-27 â†’ ~2026-07)**: monitoring desktop + cutover web, livrat in 13 PR-uri secventiale (PR-0 â†’ PR-12).
- [EXECUTION-ROADMAP.md](EXECUTION-ROADMAP.md) â€” roadmap saptamanal cu DoD checkboxes per PR. **Citeste sectiunea PR curent inainte de orice cod.**
- [PLAN-monitoring-webmode.md](PLAN-monitoring-webmode.md) â€” master spec tehnic (DDL, API contracts, security model).
- [SESSION-HANDOFF.md](SESSION-HANDOFF.md) â€” context transfer intre sesiuni (decizii inchise, status PR curent).
- [HARDENING.md](HARDENING.md) â€” **L274-440 SUPERSEDA de PLAN-monitoring-webmode.md** (vezi banner OBSOLETE). Restul fazelor 1-6 inca relevante.

## Nota Importanta Build
- Backend-ul e compilat ca CJS de esbuild. `import.meta.url` nu functioneaza in CJS.
  Se foloseste `typeof __dirname !== "undefined" ? __dirname : ...` pentru compatibilitate.
- `require("electron")` in `rnpm.ts` e marked external la bundle, rezolvat la runtime in main process.
- `npm run dist:server` â€” genereaza pachet ZIP deployabil pe server (dist-backend + dist-frontend + Dockerfile + lockfile/manifests). `start.sh` / `start.bat` instaleaza runtime deps cu `npm ci` daca lipseste `node_modules/better-sqlite3`, pentru ca modulul nativ sa fie construit pe platforma tinta.
- Dockerfile foloseste root `package-lock.json` + `npm ci --workspace=backend --omit=dev --build-from-source`; healthcheck are `--start-period=120s`.

## Limba
- Interfata si mesajele sunt in **romana** (fara diacritice in cod sursa â€” legacy constraint PortalJust)
- Comentariile din cod pot fi in engleza sau romana
