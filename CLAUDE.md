# Legal Dashboard â€” Context Proiect

## Descriere
Aplicatie Electron desktop pentru cautare dosare si termene (portalquery.just.ro, SOAP) **+ modul RNPM** (Registrul National de Publicitate Mobiliara, via HTTP cu rezolvare captcha 2Captcha / CapSolver). Target final: se va deploya si ca aplicatie web â€” fiecare decizie arhitecturala trebuie sa supravietuiasca ambelor moduri.

## Versiune Curenta

**v2.10.3** - 3 Mai 2026 (UX Monitorizare + strict word match name_soap). **Frontend:** paginare server-side pe `Monitorizare` (`page`/`pageSize`, `TablePagination`, `pageSizes=[10,25,50,100]`, recovery automat la pagina goala dupa delete) inlocuieste limita statica de 100 joburi vizibile; buton `Anuleaza` (cu `<X>` icon) pe import bulk reseteaza preview/dosar rows/error/title/filter fara a comite in DB; toate caile de input (XLSX, CSV, manual) uniformizeaza numele de monitorizare la **UPPERCASE** (defense-in-depth in `nameListParser.normalizeName` + transformare la sursa in `monitoringBulkTemplate.ts` si `MonitoringAddForm.tsx`). **Backend:** filtru post-fetch in `nameSoapRunner` reduce false-pozitivele PortalJust (substring match pe `numeParte`) — un dosar e pastrat doar daca o parte (`dosar.parti[i].nume`) contine TOATE tokenii numelui monitorizat (case-insensitive, fara diacritice, `&` promovat ca token de sine statator); suffix-urile legale `SRL/SA/SCA/SNC/SCS/PFA/IF/LLC/LTD/INC` (cu sau fara puncte: `S.R.L.` ≡ `SRL`) sunt eliminate de la coada listei pe target si pe parti inainte de comparare, deci variatiile de forma juridica nu produc false-negative. **Tests:** 7 noi in `nameSoapRunner.test.ts` (tokenize `&`, strip diacritice, all-words required, multi-party match, parti goale → false, runner-level filter, `&` literal); 3 actualizate in `nameListParser.test.ts` pentru output UPPERCASE — **690 teste backend**.

Predecesor **v2.10.1** - 3 Mai 2026 (PR-11 review hardening peste v2.10.0). Absoarbe 14 fix-uri din `/multi-review` fara sa schimbe design-ul (filtrul de severitate ramane neaplicat — produsul a fost decis ca "email = toate alertele noi de monitorizare"). **Backend:** mailer cache-uieste `Promise<Transporter>` cu timeout-uri SMTP explicite (10s/5s/15s); dispatcher rescris ca queue FIFO `MAX_CONCURRENT=1` cu `drainEmailDispatches()` in graceful shutdown si audit `email.dispatch.failed` pe outage; `me.ts` PUT `/email-settings` foloseste `minSeverity.optional()` ca sa nu mai overwrite-uiasca silent, POST `/email-settings/test` cooldown 60s/owner cu 429 + `Retry-After`. **Frontend:** focus trap pe modal Detalii instante (Monitorizare). **CI:** `.github/workflows/docker-build.yml` ruleaza `tsc --noEmit -p backend` + `npm test --workspace=backend` inainte de Docker build. **Tests:** 4 noi in `alertEmailDispatcher.test.ts` — 683 total backend.

Predecesor **v2.10.0** - 3 Mai 2026 (PR-11 Email notifiers + UX polish Monitorizare). **Backend:** migration `0014_email_settings` adauga `owner_email_settings` owner-scoped cu default OFF; `services/email/mailer.ts` pe `nodemailer` (citeste doar `SMTP_*` din env si nu blocheaza boot-ul cand lipsesc); dispatcher trimite doar pe `inserted=true` prin `queueMicrotask`; rute `/api/v1/me/email-settings` GET/PUT + `/test`. **Frontend:** `EmailSettingsPanel` in dialogul de chei API langa `NotificationStatusPanel`; coloana `Detalii` pe Monitorizare cu modal `Building2` pentru `name_soap` cu scope restrans la o lista de instante (helperii `getInstitutieLabel`/`getNameSoapInstitutie` reutilizati si in exportul Excel/PDF). **Electron:** AUMID separate dev/packaged; helper nou `scripts/launch-electron-dev.cjs` cloneaza `electron.exe` in `Legal Dashboard Dev.exe` si patch-uieste metadata cu `rcedit.exe` (icon + ProductName) inainte de launch. **Tests:** 34 backend noi + 5 frontend noi.

Pentru istoric complet vezi `CHANGELOG.md` (in repo) si in-app changelog (pagina `/changelog`).

### Sprint completat: monitoring + web mode (PR-0..PR-11, livrat 2026-04-27 → 2026-05-03)

| Versiune | Scop |
|---|---|
| v2.0.11..v2.0.13 | PR-0/1/2 — migration framework + `getOwnerId` helper + shadow tables `users`/`sessions`/`audit_log` |
| v2.1.0 | PR-3 — monitoring core (schema + repo + rute `/api/v1/monitoring/jobs` + UI minimal) |
| v2.2.0 | PR-4 — scheduler + `dosar_soap` runner + crash recovery + RWLock backup-vs-scheduler |
| v2.3.0 | Audit remediation (backup recurent, restore PRAGMA integrity, graceful drain, idx one-running-per-job) |
| v2.4.0..v2.4.2 | PR-5 bulk import + `name_soap` runner; PR-6 inbox alerte + SSE + native notifications + hardening |
| v2.5.0..v2.5.1 | PR-7 AI usage tracking (`ai_usage`, panou Setari API) + multi-review hardening |
| v2.6.0..v2.6.8 | PR-8 admin pages + `requireRole` guard; UX polish Monitorizare/Alerte (TINTA bold, bulk collapsible, name_soap parity, export XLSX/PDF); audit hardening F1..F10 (originGuard CSRF, exceljs migration, bulk-delete atomic) |
| v2.7.0..v2.7.1 | PR-A Dashboard KPI strip + QuickActions; PR-9 auth pluggable seam (desktop noop / web JWT HS256); dev mode taskbar icon |
| v2.8.0 | PR-B Dashboard timeline + charts (3 endpoints: summary/timeline/charts; UTC-anchored daily series) |
| v2.9.0..v2.9.2 | PR-C Dashboard Export raport (XLSX + PDF, modal cu range 7d/30d); Timeline scoasa post-feedback; status notificari native |
| v2.10.0..v2.10.1 | PR-11 Email notifiers (SMTP optional, owner-scoped) + review hardening |
| v2.10.2..v2.10.3 | Patch UX Monitorizare (paginare, cancel bulk, UPPERCASE) + strict word match name_soap |

PR-10 (Litestream/GCS backup cloud) si PR-12 (GDPR delete + hash-chain audit) **eliminate** prin decizia #11 din `EXECUTION-ROADMAP.md` (cost-benefit negativ pentru solo dev fara firma; compliance theatre pentru uz personal). Web cutover (Google SSO real + deploy server + backup S3-compatible) ramane reevaluabil separat, fara timeline.

Detalii operationale in [EXECUTION-ROADMAP.md](EXECUTION-ROADMAP.md) si [SESSION-HANDOFF.md](SESSION-HANDOFF.md).

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
- `npm test --workspace=backend` â€” vitest backend (690 teste dupa v2.10.3: 683 baseline v2.10.1 + 7 noi name_soap strict word match in v2.10.3 — 6 in `nameSoapRunner.test.ts` strict-word filter + 1 prin baseline updates)
- `npx tsc --noEmit -p backend/tsconfig.json` â€” type-check backend
- `cd frontend && npx tsc --noEmit` â€” type-check frontend
- `npx biome check` â€” lint + format check
- `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` â€” kill switch operational pentru a opri temporar claim-ul pe anumite tipuri de joburi de monitoring
- `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`/`SMTP_SECURE` â€” canal email optional pentru alerte; lipsa/incomplet = email disabled, boot normal

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
