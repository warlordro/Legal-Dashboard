# Legal Dashboard â€” Context Proiect

## Descriere
Aplicatie Electron desktop pentru cautare dosare si termene (portalquery.just.ro, SOAP) **+ modul RNPM** (Registrul National de Publicitate Mobiliara, via HTTP cu rezolvare captcha 2Captcha / CapSolver). Target final: se va deploya si ca aplicatie web â€” fiecare decizie arhitecturala trebuie sa supravietuiasca ambelor moduri.

## Versiune Curenta
**v2.6.5** - 1 Mai 2026 (UX polish Monitorizare: TINTA bold, bulk import collapsible + descriere non-tehnica, template XLSX restilizat la nivelul exporturilor din aplicatie, nota inline italic sub TINTA pe randurile cu notes populat)

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

Detalii in [EXECUTION-ROADMAP.md](EXECUTION-ROADMAP.md) si [SESSION-HANDOFF.md](SESSION-HANDOFF.md).

## Structura Proiect
```
legal-dashboard/
â”œâ”€â”€ frontend/          # React 18 + TypeScript + Vite + custom CSS
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ pages/     # Dashboard, Dosare, Termene, RnpmSearch, Changelog, Manual
â”‚       â”œâ”€â”€ components/# DosareTable, TermeneTable, Sidebar, MetricsPanel, CalendarView,
â”‚       â”‚              # DosarModal, InstitutieSelect, SearchForm, TermeneMetrics, rnpm/*, ui/
â”‚       â”œâ”€â”€ hooks/     # useApiKey (safeStorage IPC), useDialog, useFontSize,
â”‚       â”‚              # useRnpmHistory, useSearchHistory, useTheme
â”‚       â”œâ”€â”€ lib/       # api.ts, rnpmApi.ts, export.ts, rnpmExport.ts,
â”‚       â”‚              # chart-colors.ts, institutii.ts, utils.ts
â”‚       â””â”€â”€ types/     # desktop-api.d.ts, index.ts, rnpm.ts
â”œâ”€â”€ backend/           # Node.js 22+ + Hono (port 3002)
â”‚   â”œâ”€â”€ tsconfig.json  # strict: true, noEmit (type-check only)
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ index.ts   # Bootstrap: CSP, CORS, mount routers, prewarm, backup, shutdown
â”‚       â”œâ”€â”€ routes/    # rnpm.ts, dosare.ts (SOAP search), termene.ts, ai.ts, aiUsage.ts, monitoring.ts
â”‚       â”œâ”€â”€ services/  # rnpmSearchService, captchaSolver, rnpmClient,
â”‚       â”‚              # ai.ts (Claude/OpenAI/Gemini), aiUsage.ts, batch-dosare.ts, monitoring/*
â”‚       â”œâ”€â”€ middleware/# rate-limit.ts (real-IP), static-frontend.ts (path-traversal guard),
â”‚       â”‚              # owner.ts (getOwnerId helper, PR-1)
â”‚       â”œâ”€â”€ db/        # schema.ts, avizRepository.ts, searchRepository.ts,
â”‚       â”‚              # backup.ts (owner_id everywhere), auditRepository.ts (recordAudit, PR-2),
â”‚       â”‚              # aiUsageRepository.ts, migrations/ (0001..0010, latest ai_usage)
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
- `npm test --workspace=backend` â€” vitest backend (524 teste, neschimbate in v2.6.1)
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
