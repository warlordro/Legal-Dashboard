# Legal Dashboard â€” Context Proiect

## Descriere
Aplicatie Electron desktop pentru cautare dosare si termene (portalquery.just.ro, SOAP) **+ modul RNPM** (Registrul National de Publicitate Mobiliara, via HTTP cu rezolvare captcha 2Captcha / CapSolver). Target final: se va deploya si ca aplicatie web â€” fiecare decizie arhitecturala trebuie sa supravietuiasca ambelor moduri.

## Versiune Curenta

**v2.12.0** - 4 Mai 2026 (MIN-VIABLE seam refactors + dashboard pagination fix). Sweep peste v2.11.0 care absoarbe sectiunea "MIN-VIABLE seams" din `DEEP-REVIEW-LEGAL-DASHBOARD-2026-05-04.md` plus un fix de paginare la dashboard timeline. Patru cuturi mici cu boundary clar, fara migrari, fara schimbari de API observabile. **Backend (AlertEventService):** nou `services/alerts/alertEventService.ts` cu `recordAndDispatchAlert(input)` care apeleaza `insertAlert` (repo pur) si dispecerizeaza email-ul prin `queueMicrotask` doar la insert real (`result.inserted === true`); `monitoringAlertsRepository.insertAlert` curatat de fanout extern (SSE listener `notifyNewAlert(row)` ramane local); callerii `dosarSoapRunner`/`nameSoapRunner`/`scheduler` au alias `recordAndDispatchAlert as insertAlert` ca diff sa fie minim. **Backend (Command service):** nou `services/monitoring/commands/createMonitoringJob.ts` cu functie pura framework-free `executeCreateMonitoringJob(input)` ce primeste input deja parsat (Zod la boundary) + callback `writeAudit(event)`; detine tranzactia `createJob + audit`, traduce `IdempotencyConflictError`/aviz_rnpm in outcome union (`ok | kind_not_implemented | idempotency_conflict`). `routes/monitoring.ts` POST /jobs ramane (1) Zod parse → (2) getOwnerId → (3) chemarea service-ului cu adapter `writeAudit: (event) => recordAudit(c, event.action, ...)` → (4) switch outcome → 201/200/409/422. **Frontend (hook extragere):** nou `frontend/src/hooks/useMonitoringJobs.ts` (~130 linii) cu abort controller, debounce 300ms via `useDebouncedValue`, page-empty recovery effect, `refresh()` pentru re-fetch idempotent; expune `{ jobs, total, totalPages, loading, error, page, pageSize, kindFilter, searchInput, debouncedQuery, setPage, setPageSize, setKindFilter, setSearchInput, flushQuery, refresh, setError, setJobs }`. `Monitorizare.tsx` mai detine doar selection (Set), modale, bulk delete state si handlers de mutatii (~60 linii inlocuite cu un singur destructure). **Electron (modul notifications):** nou `electron/notifications.js` (186 linii) cu `getNotificationStatus()`, `showNativeNotification(payload)`, `registerNotificationIpc(ipcMain)`, MAX_NOTIFICATION_* constants, WINDOWS/MACOS_NOTIFICATION_ACCEPTS sentinels, `notificationsByTag` Map (LRU by insertion order), capability detection prin `windows-notification-state` / `macos-notification-state`. `electron/main.js` redus 727 → 533 linii; cele 3 inline `ipcMain.handle("notification:*", ...)` blocuri inlocuite cu `registerNotificationIpc(ipcMain)` (contract IPC neschimbat). **Backend (bug fix dashboard timeline):** `routes/dashboard.ts` `/timeline` endpoint folosea `LIMIT n` per-source si pierdea un eveniment legitim cand cursor-ul composite `<ts>|<eventId>` cadea pe boundary (post-merge filter scotea event-ul boundary). Fix: `fetchLimit = inclusive ? limit + 1 : limit`. Cu composite ID-uri unice, cel mult un event per sursa egaleaza cursor-ul, deci `+1` e suficient. **Tests:** **744 teste backend** (de la 728 in v2.11.0: +3 in `services/alerts/alertEventService.test.ts` (nou) + 11 in `routes/rnpm.owner-isolation.test.ts` (nou) + 1 dashboard "compound cursor" + 1 absorbit din v2.11.0 deep-review); 73/73 frontend neschimbate. tsc backend + frontend verde, biome verde. **Versionare:** bump manifest/lockfile la `2.12.0` (minor — refactor de seam-uri vizibile la diff de cod chiar daca nu se modifica contractele HTTP/IPC).

Predecesor **v2.11.0** - 4 Mai 2026 (deep-review remediation — PII/CVE + web-readiness closure). Sweep peste v2.10.8 care absoarbe `DEEP-REVIEW-LEGAL-DASHBOARD-2026-05-04.md` (PR A operational + PR Web-Readiness Closure) **cu o singura exceptie**: trecerea frontend `xlsx` → `exceljs` ramane deferata. **Securitate (PII + CVE):** `backend/rnpm-dumps/` (PII real RNPM — CUI, denumire, identificator) adaugat in `.gitignore`; `nodemailer` `^6.9.13` → `^7.0.13` (HIGH DoS GHSA-rcmh-qjqh-p98v / CVSS 7.5 patched 7.0.11+); `@anthropic-ai/sdk` `^0.90.0` → `^0.92.0` (moderate file-perms GHSA-p7fg-763f-g4gf). `npm audit` redus 6 → 4 (remaining: `xlsx@0.18.5` HIGH no upstream fix dar mutat in devDependencies in v2.6.4; `uuid <14.0.0` moderate transitiv; 2 nodemailer SMTP injection cu threat realistic foarte scazut). **Backend (Closure deep-review #1, #2, #12):** `routes/rnpm.ts` propaga `ownerId = getOwnerId(c)` end-to-end pe `executeSearch`/`executeBulkSearch` (anterior `"local"` hardcodat masking pentru web mode); `inflightKey(ownerId, clientRequestId)` pentru dedup robust intre useri; `requireRole("admin")` aplicat pe `DELETE /saved/all`, `POST /compact`, `DELETE/GET /backups`, `POST /backups/restore`, `POST /open-{db,backups}-folder` (rute care opereaza pe state global / sterg date / lanseaza restore); helper `rejectCaptchaKeyInWebMode()` returneaza 501 cu mesaj romanesc pe `POST /search`/`/bulk`/`/captcha/balance` cand `getAuthMode() === "web"` (RNPM in web necesita per-user key storage server-side, neimplementat in v2.11.0). **Build:** `scripts/build-server.js` rebrand "portaljust" → "legal-dashboard" pe `outName`, banner CLI si `README.txt`. **Tests:** **728 teste backend** (de la 721 in v2.10.6, +7 contract noi in `rnpm.contract.test.ts`: 3 pentru web-mode 501 gate + 4 pentru admin guard cu `updateUserRole("local","user")` in `beforeEach`); 73/73 frontend neschimbate. tsc backend + frontend verde, biome verde. **Versionare:** bump manifest/lockfile la `2.11.0` (minor, nu patch — schimba contract API observabil cu noile gate-uri 403/501).

Predecesor **v2.10.8** - 4 Mai 2026 (CI hardening — test gate + artifact naming). Patch CI-only peste v2.10.7. **GitHub Actions:** `build-windows.yml` si `build-mac.yml` ruleaza acum `tsc --noEmit` + `vitest run` pentru backend si frontend **inainte** de packaging. Pe Windows, ordinea e cruciala: `npm ci` lasa `better-sqlite3` cu ABI Node, deci testele ruleaza inainte de `rebuild:electron` care flips ABI-ul; pe Mac testele ruleaza inainte de `npm run build` (electron-builder are `npmRebuild` intern care flips ABI la packaging time). Un fail de tipuri sau teste blocheaza generarea artefactelor — nu se mai pot publica releases cu cod care nu trece type-check. **Artifact naming:** `actions/upload-artifact` foloseste pattern `legal-dashboard-{platform}-${{ github.ref_name }}-run${{ github.run_id }}` ca sa evite suprascrierile la rerun pe acelasi tag (artifact retention pastreaza istoric, nu doar ultimul build). **Versionare:** bump manifest/lockfile la `2.10.8`.

Predecesor **v2.10.7** - 3 Mai 2026 (UX Monitorizare total count). Patch frontend + docs peste v2.10.6. **Frontend:** `Monitorizare.tsx` afiseaza in CardHeader `Joburi active (${total})`, adica totalul real returnat de backend pentru lista paginata, nu `jobs.length` (randurile incarcate pe pagina curenta, de exemplu 100). Tooltip-urile Excel/PDF clarifica faptul ca exportul fara selectie acopera joburile vizibile pe pagina. **Docs:** `CODEX-BACKLOG.md` este inchis ca document istoric pentru Task B/C livrate si Task A eliminat. **Versionare:** bump manifest/lockfile la `2.10.7`.

Predecesor **v2.10.6** - 3 Mai 2026 (review hardening + cleanup backlog). Patch fara comportament nou peste v2.10.5. Absoarbe integral findings-urile review-ului `REVIEW-FINDINGS-2026-05-03.md` (Critical + High + Medium + Low + nice-to-have). **Frontend:** `useDebouncedValue` rescris cu tuple `[value, flush]` — `flush(next)` permite resetare sincrona la clear-X / Reset filter, asa ca debounced state-ul nu mai fluture printr-un val intermediar; `Alerts.tsx` ingusteaza `jobKind` la `JobKindFilter` (cast mort dropuit); `JobKindTabs` primeste navigatie tastatura conform WAI-ARIA Authoring Practices (ArrowLeft/Right cu wrap, Home/End jump la extreme, roving tabindex `tabIndex={active ? 0 : -1}`, focus mutat sincron). **Backend:** helper `escapeLikeMeta` extras in `util/textNormalize.ts` cu JSDoc `@example` care documenteaza explicit contractul `ESCAPE '\\'`; `auditRepository.listAuditEvents` (`actionLike`) si `userRepository.listUsers` (`search` peste `email` + `display_name`) folosesc acum `escapeLikeMeta` + `ESCAPE '\\'` — defense-in-depth pentru admin paths cu user input in clauze LIKE; `monitoringJobs/AlertsRepository` adauga guard `q?.trim()` pe filtrul `q`. **Cleanup:** `scripts/seed-test-alerts.cjs` sters; Task A (editare job monitorizare) scos integral din `CODEX-BACKLOG.md` si din memoria persistenta. **Tests:** nou `util/textNormalize.test.ts` (11 teste) + 3 wildcard tests pentru `getAvize` (`%`, `_`, `\` literali). **721 teste backend** + nou `useDebouncedValue.test.ts`, `JobKindTabs.test.tsx`, `alertsApi.test.ts` — **73 teste frontend**.

Predecesor **v2.10.5** - 3 Mai 2026 (UX Dashboard + Alerte). **Dashboard:** KPI-ul `Joburi active` este redenumit `Monitorizari active`, iar sublinia `dosar_soap/name_soap` devine `X Dosare, Y Nume`. **Alerte:** pagina primeste tab-bar sursa job (`Toate / Dosare / Nume`) + search input debounced 300ms peste targetul jobului (`numar_dosar` / `name_normalized`), fara sa inlocuiasca filtrele existente pe event-kind, severitate, unread/dismissed sau date. **Backend:** `GET /api/v1/alerts` accepta `jobKind` + `q`; `listAlerts` filtreaza pe `monitoring_jobs` cu match diacritic-insensitive si escape pentru meta-caractere LIKE, iar `COUNT(*)` foloseste JOIN cand aceste filtre sunt active. **Tests:** 5 noi in `alerts.test.ts` — **703 teste backend**.

Predecesor **v2.10.4** - 3 Mai 2026 (UX Monitorizare — filtre kind + search box). **Backend:** `JobListQuerySchema` capata field `q` (trim + max 100 chars); `listJobs` adauga WHERE OR pe `rnpm_norm(json_extract(target_json, '$.numar_dosar'))` + `name_normalized` + `identificator`, match diacritic-insensitive + case-insensitive cu meta-caractere LIKE escapate pe `\`. Comportamentul reproduce semantica `Cautare Dosare`: query cu diacritice matcheaza valori fara diacritice si invers. **Frontend:** `Monitorizare.tsx` primeste tab-bar de 3 butoane (Toate / Dosare / Nume) + search input cu debounce 300ms si buton clear; filtrele reseteaza pagina la 0; empty state contextualizat ("Niciun rezultat pentru filtrele aplicate. Reseteaza filtrele"). **Tests:** 8 noi (3 schema + 4 integration + 1 runner fail-closed) — **698 teste backend**.

Predecesor **v2.10.3** - 3 Mai 2026 (UX Monitorizare + strict word match name_soap). **Frontend:** paginare server-side pe `Monitorizare` (`page`/`pageSize`, `TablePagination`, `pageSizes=[10,25,50,100]`, recovery automat la pagina goala dupa delete) inlocuieste limita statica de 100 joburi vizibile; buton `Anuleaza` (cu `<X>` icon) pe import bulk reseteaza preview/dosar rows/error/title/filter fara a comite in DB; toate caile de input (XLSX, CSV, manual) uniformizeaza numele de monitorizare la **UPPERCASE** (defense-in-depth in `nameListParser.normalizeName` + transformare la sursa in `monitoringBulkTemplate.ts` si `MonitoringAddForm.tsx`). **Backend:** filtru post-fetch in `nameSoapRunner` reduce false-pozitivele PortalJust (substring match pe `numeParte`) — un dosar e pastrat doar daca o parte (`dosar.parti[i].nume`) contine TOATE tokenii numelui monitorizat (case-insensitive, fara diacritice, `&` promovat ca token de sine statator); suffix-urile legale `SRL/SA/SCA/SNC/SCS/PFA/IF/LLC/LTD/INC` (cu sau fara puncte: `S.R.L.` ≡ `SRL`) sunt eliminate de la coada listei pe target si pe parti inainte de comparare, deci variatiile de forma juridica nu produc false-negative. **Tests:** 7 noi in `nameSoapRunner.test.ts` (tokenize `&`, strip diacritice, all-words required, multi-party match, parti goale → false, runner-level filter, `&` literal); 3 actualizate in `nameListParser.test.ts` pentru output UPPERCASE — **690 teste backend**.

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
| v2.10.4          | Patch UX Monitorizare — filtre kind (Toate/Dosare/Nume) + search box diacritic-insensitive |
| v2.10.5          | Patch UX Dashboard/Alerte — KPI umanizat + tab-bar/search pe Alerte |
| v2.10.6          | Review hardening + cleanup backlog (`useDebouncedValue` flush, JobKindTabs WAI-ARIA, `escapeLikeMeta` admin paths, seeder sters, Task A scos) |
| v2.10.7          | Patch UX Monitorizare — `Joburi active` afiseaza totalul real paginat, nu randurile vizibile |
| v2.10.8          | CI hardening — type-check + tests inainte de packaging in `build-windows.yml` / `build-mac.yml`, artifact naming cu `ref_name` + `run_id` |
| v2.11.0          | Deep-review remediation — PII (`rnpm-dumps/` in `.gitignore`) + CVE (nodemailer 7.0.13 / Anthropic SDK 0.92) + Web-Readiness Closure (RNPM ownerId propagation, `requireRole("admin")` pe rutele globale, 501 web-mode gate pe captchaKey body) |
| v2.12.0          | MIN-VIABLE seam refactors — `services/alerts/alertEventService.ts` (split persistence/fanout), `services/monitoring/commands/createMonitoringJob.ts` (command service framework-free), `frontend/src/hooks/useMonitoringJobs.ts` (hook extras din `Monitorizare.tsx`), `electron/notifications.js` (modul extras din `main.js` 727→533 linii); fix paginare `/timeline` (`+1` overfetch pe inclusive cursor) |

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
- `npm run dist:mac` â€” electron-builder pentru macOS DMG (x64 + arm64; se ruleaza normal pe runner macOS)
- `npm run dist:server` â€” ZIP server deployabil; Docker Build ruleaza in GitHub Actions la push pe `main`
- `npm test --workspace=backend` â€” vitest backend (744 teste dupa v2.12.0: 728 baseline v2.11.0 + 3 noi in `services/alerts/alertEventService.test.ts` + 11 noi in `routes/rnpm.owner-isolation.test.ts` + 1 nou "compound cursor disambiguates" in `dashboard.test.ts` + 1 absorbit din v2.11.0 deep-review)
- `cd frontend && npm test -- --run` â€” vitest frontend (73 teste dupa v2.10.6: noi `useDebouncedValue.test.ts`, `JobKindTabs.test.tsx`, `alertsApi.test.ts`)
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
