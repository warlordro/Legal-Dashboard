# Legal Dashboard — Status Implementare

**Data curenta:** 2026-07-09 (v2.42.2: corectii pe findings-urile review-ului post-merge v2.42.1 — limiterul global de body 1MB reordonat inaintea tuturor routerelor cu exceptii exact-match pentru rutele cu limite proprii mai mari (export xlsx dosare/termene 25MB, name-lists 10/15MB) si acoperire noua pe `POST /api/v1/tokens` in web mode, release pre-auth gardat pe `c.finalized` (throw pre-autentificare ramane contorizat), timeout shutdown Electron 5s → 40s peste bugetul intern de drain, ceiling si pe fereastra proaspata de rate limit, comentarii corectate (isTrustedIpcSender, finalize_noop). Predecesor v2.42.1: patch hardening post-audit full-project — DevTools inchis in build-urile packaged (`IS_DEV = !app.isPackaged`), sender validation pe IPC safeStorage, boot nonce la health-check-ul Electron, weight 3x pe `/api/v1/ai/analyze-multi` + pe bucket-ul per-token PAT, release pre-auth in `finally`, body limit global 1MB pe `/api/*`, `/health/detail` 403 in web mode, guard pe return-ul `finalize()` + `durationMs` real in scheduler, `ownerId` obligatoriu in avizRepository/searchRepository. Predecesor v2.42.0: administrare utilizatori in web mode — creare individuala `POST /users` + import xlsx cu template server-side (email unic NOCASE prin migratia 0040, `canonicalizeEmail` unic normalizator, reactivare conturi sterse), pagina `/setari` pe taburi cu gating pe rol, pool AI unic per user (migratiile 0041/0042, `quotaGuard` pe feature "ai", granturi exclusive cu nelimitat), `GET /usage/overview` per utilizator pe functiile guard-urilor + tab Consum cu totaluri si echivalent EUR, audit cu emailuri + export XLSX cu escape formula-injection, Claude Sonnet 5 + prompturi system/user, toast-uri in-house + confirmari `useConfirm` + sortare `useClientSort` + dark mode complet. Starea finala sincronizata din implementarea GitLab care a inclus fixurile din testarea reala pe deployment. Predecesor v2.41.0: primul val de corectii post-testare web — layout browser reparat (drag strip + pt-8 gated pe desktop, font 16px baseline web cu migrare localStorage one-time, sidebar scrollabil cu footer pinned), frontend-ul conectat la cheile tenant prin hook-ul nou `useTenantKeyStatus` pe `GET /me/key-status` cu fail-open pe stari tranzitorii (RNPM search/split/paginare/bulk + AI deriva modelele din cheile tenant, body fara chei), dialog Setari API read-only in web (PAT admin-only UI + server-side, fara notificari native in browser), fallback captcha simetric din cheile tenant + body sanitizat "tenant key wins", pagina Cote cu select uman in loc de token-uri interne. Tooling: `scripts/dev-web-local.ps1` — server web local complet fara Docker/Caddy. Predecesor v2.40.1: fixuri deploy web de productie — Dockerfile compileaza dist-urile intr-un stage de build (build-from-git functioneaza pe Dokploy/Coolify fara pre-compilare locala), volum persistent `/data` by default in docker-compose.yml root, bridge oauth2-proxy trecut pe mecanismele reale legacy config: secret ca parola Basic Auth (`basic-auth-password` + `pass-basic-auth`), identitate din `X-Forwarded-Email` (`pass-user-headers`); designul vechi folosea `OAUTH2_PROXY_INJECT_REQUEST_HEADERS` (doar alpha config, ignorat silentios) + `X-Auth-Request-Email` (header de raspuns nginx auth_request) si nu a functionat niciodata in productie. Predecesor v2.40.0: API programatic doar-citire prin Personal Access Tokens — Piesa A din planul API + MCP, doar web mode. Dosare + termene (PortalJust), ICCJ si RNPM accesibile extern cu tokenuri `ld_pat_...` (hash SHA-256 in DB, migratia 0039); gate default-deny pe tuple (metoda, path, scope), management session-only, HTTPS-only + no-store, rate-limit + plafon captcha per-token (rezervare atomica fail-closed), audit + alerta email la IP nou, circuit breaker ICCJ ponderat pe caller class, OpenAPI 3.1 la `/api/v1/openapi.json` + `API.md`, panou UI Setari -> Acces API. Desktop: zero impact. Predecesor v2.39.0: fix major deploy web — sesiunea se stabileste automat la incarcare, se reinnoieste in fundal si se autorecupereaza la 401.)
**Versiune curenta reala:** v2.42.2
**Status global curent:** Sprint monitoring + web mode livrat pana la PR-11; sprint-uri ulterioare absorbite ca patch-uri UX si hardening (v2.10.x → v2.20.x). Pentru detalii pe fiecare release vezi [CHANGELOG.md](CHANGELOG.md). PR-10 si PR-12 sunt eliminate prin decizia #11 din `EXECUTION-ROADMAP.md`; web cutover ramane reevaluabil separat.

**Livrat recent (v2.13.0):** Export alerte + raport zilnic email peste v2.12.1. **Backend (export route):** nou `routes/alerts.ts` `POST /api/v1/alerts/export` cu Zod `discriminatedUnion("mode", [ids|filters|range])`, cap 10k randuri (413 + total in details), reuseaza `deriveAlertDigestRow` din template-ul de raport ca sa decoreze fiecare rand cu `numarDosar/dosarLink/kindLabel/severityLabel/nameMonitored`; audit `alerts.export` cu `mode + count`. `monitoringAlertsRepository.listAlertsByIds(ownerId, ids)` filtreaza pe `id IN (...) AND owner_id = ?`. **Backend (raport zilnic):** migration `0015_daily_report_settings.up.sql` adauga `daily_report_enabled INTEGER NOT NULL DEFAULT 0` + `last_daily_report_sent_for TEXT NULL` in `owner_email_settings`; nou `services/email/dailyReportTemplate.ts` cu `renderDailyReport({reportDateLocal, alerts})` care emite `{subject, html, text, rowCount}` + `getPortalJustUrl` + `deriveAlertDigestRow`; nou `services/email/dailyReportScheduler.ts` cu `runDailyReportTick(deps?)` care fires doar la ora locala configurabila (`DAILY_REPORT_HOUR=9` default), itereaza prin owneri cu `daily_report_enabled = 1` AND `last_daily_report_sent_for != today`, fereastra `[yesterday 00:00, today 00:00 local)`, audit `email.daily_report.sent`/`.failed` + marcare zi doar pe success (best-effort retry pe failure). `mailer.sendComposedEmail` reutilizat; `index.ts` porneste `setInterval` 5 min care apeleaza tick-ul + drain in graceful shutdown. **Frontend:** `lib/alertsApi.ts` `exportAlerts(payload)`, `lib/export-alerts.ts` `buildAlertsXlsx`/`buildAlertsPdf` cu hyperlink-uri portal.just.ro live, `pages/Alerts.tsx` checkbox per rand + buton "Exporta" + modal radio Excel/PDF + Selectie/Filtre/Interval, `components/EmailSettingsPanel.tsx` checkbox "Trimite raport zilnic la 09:00" controlat de field nou `dailyReportEnabled`. **Tests:** 789 backend (+38: 17 template + 12 scheduler + 7 export route + 2 me daily flag); 81 frontend (+8: 3 alertsApi exportAlerts + 3 export-alerts + 2 EmailSettingsPanel daily flag). tsc backend + frontend verde, biome verde pe testele noi. **Versionare:** manifest/lockfile bumpate `2.12.1` → `2.13.0` (minor — schimba contractul HTTP cu rute noi `/api/v1/alerts/export` + DDL nou cu migration `0015`, dar fara breaking changes pe rute existente).

**Livrat anterior (v2.12.1):** UX bulk import + humanize validare + alerta `source_error` enrich peste v2.12.0. **Frontend:** `MonitoringBulkImportCard.tsx` inlocuieste limita statica de 300 randuri vizibile cu paginare server-style identica cu pagina principala (default 100/pagina, `pageSizes=[25, 50, 100, 250]`); coloana noua "Actiune" cu Exclude/Include per rand (icon `<X>`) + checkbox "Exclude warn-urile automat" pentru bulk; legenda colapsabila statusuri ok/warn/respins + nota dedup automat (constraint UNIQUE owner_id + target_hash + kind). **Backend:** `services/nameListParser.ts` `classifyRawName` rescris cu mesaje romanesti complete care explica motivul si actiunea recomandata + regula noua `nume_lung` (warn) la `>100` chars sau `>12` cuvinte (constante `PORTALJUST_WARN_*` exportate, helper `isLikelyTooLongForPortalJust`); `services/monitoring/scheduler.ts` adauga helper `computeProbableCause(job, outcome)` care, pentru `name_soap` cu `errorCode === "SOAP_FAIL"` si `name_normalized` peste limitele PortalJust, marcheaza alerta `source_error` cu `probable_cause: nume_prea_lung_pentru_portaljust` + titlu specific + detail JSON. **Tests:** 751 backend (+4 nameListParser warn nume lung cu exemplul real GLOBALSAT din raportul utilizatorului; +3 scheduler probable_cause enrichment). 73/73 frontend. tsc backend + frontend verde. **Versionare:** manifest/lockfile bumpate `2.12.0` → `2.12.1` (patch — UX + mici imbogatiri observabile, fara migrari/schema/contract break).

**Livrat anterior (v2.12.0):** MIN-VIABLE seam refactors peste v2.11.0 — patru cuturi mici cu test in zona schimbata. Fara migrari, fara schimbari de API observabile.

**Backend - AlertEventService seam:** nou `services/alerts/alertEventService.ts` cu `recordAndDispatchAlert(input)` care apeleaza `insertAlert` (repo pur) si dispecerizeaza email-ul prin `queueMicrotask` doar la insert real (`result.inserted === true`). `monitoringAlertsRepository.insertAlert` curatat de `dispatchAlertEmail` import + microtask block (SSE listener `notifyNewAlert(row)` ramane local). Caller-ii `dosarSoapRunner`/`nameSoapRunner`/`scheduler` au alias `recordAndDispatchAlert as insertAlert`. 3 teste noi in `alertEventService.test.ts` (persistence + dispatch o data + zero pe dedup hit) cu `vi.mock("../email/mailer.ts", ...)` si `drainEmailDispatches(2_000)` in `afterEach`.

**Backend - command service framework-free:** nou `services/monitoring/commands/createMonitoringJob.ts` (~95 linii) cu functie pura `executeCreateMonitoringJob(input)` ce primeste input deja parsat (Zod la boundary) + callback `writeAudit(event)`. Outcome union `{ status: "ok" | "kind_not_implemented" | "idempotency_conflict", ... }`; service-ul nu cunoaste HTTP. `routes/monitoring.ts` POST /jobs ramane (1) Zod parse → (2) `getOwnerId` → (3) chemarea service-ului cu adapter `writeAudit: (event) => recordAudit(c, event.action, ...)` → (4) switch outcome → 201/200/409/422. 53 teste `monitoring.test.ts` raman verzi.

**Frontend - hook extragere:** nou `frontend/src/hooks/useMonitoringJobs.ts` (~130 linii) cu abort controller, debounce 300ms via `useDebouncedValue([value, flush])`, page-empty recovery effect, `refresh()` pentru re-fetch idempotent. `Monitorizare.tsx` mai detine doar selection (`Set<number>`), modale, bulk delete state si handlers de mutatii — ~60 linii inlocuite cu un singur destructure.

**Electron - modul `notifications.js`:** nou `electron/notifications.js` (186 linii) cu `getNotificationStatus()`, `showNativeNotification(payload)`, `registerNotificationIpc(ipcMain)`, `MAX_NOTIFICATION_*` constants, sentinels `WINDOWS/MACOS_NOTIFICATION_ACCEPTS`, `notificationsByTag` Map (LRU by insertion order), capability detection prin `windows-notification-state` / `macos-notification-state`. `electron/main.js` redus 727 → 533 linii; cele 3 inline `ipcMain.handle("notification:*", ...)` blocuri inlocuite cu `registerNotificationIpc(ipcMain)`. Contract IPC neschimbat.

**Backend - bug fix dashboard timeline:** `routes/dashboard.ts` `/timeline` endpoint folosea `LIMIT n` per-source si pierdea un eveniment legitim cand cursor-ul composite `<ts>|<eventId>` cadea pe boundary (post-merge filter scotea event-ul boundary). Fix: `fetchLimit = inclusive ? limit + 1 : limit`. Cu composite ID-uri unice, cel mult un event per sursa egaleaza cursor-ul, deci `+1` e suficient. Testul `paginates via cursor (events strictly older than the cursor)` din `dashboard.test.ts` (modificat in v2.11.0) trece acum determinist.

**Tests:** **744 teste backend** (de la 728 in v2.11.0: +3 in `services/alerts/alertEventService.test.ts` (nou), +11 in `routes/rnpm.owner-isolation.test.ts` (nou), +1 in `dashboard.test.ts` "compound cursor", +1 absorbit din v2.11.0). 73/73 frontend neschimbate. tsc backend + frontend verde, biome verde.

**Documentatie:** `CHANGELOG.md`, `frontend/src/data/changelog-entries.tsx`, `README.md`, `STATUS.md`, `SESSION-HANDOFF.md`, `CLAUDE.md` actualizate.

**Versionare:** Manifest root + workspaces backend/frontend bumpate `2.11.0` → `2.12.0`.

**Livrat anterior (v2.11.0):** Deep-review remediation peste v2.10.8 — sweep PR A (operational) + PR Web-Readiness Closure.

**Securitate (PII + CVE):** `backend/rnpm-dumps/` adaugat in `.gitignore` (PII real RNPM — CUI, denumire, identificator nu mai pot fi commit-ate accidental); `nodemailer` `^6.9.13` → `^7.0.13` (HIGH DoS GHSA-rcmh-qjqh-p98v / CVSS 7.5 patched 7.0.11+); `@anthropic-ai/sdk` `^0.90.0` → `^0.92.0` (moderate file-perms GHSA-p7fg-763f-g4gf). `npm audit` redus de la 6 → 4 high/moderate; remaining: `xlsx@0.18.5` HIGH (no upstream fix, mutat in devDependencies in v2.6.4 — nu mai e pe path de parsare user input), `uuid <14.0.0` moderate (transitiv), 2 nodemailer SMTP injection (require crafted `transport.name`/`envelope.size`, threat realistic foarte scazut).

**Backend:** Closure deep-review #1 (RNPM owner propagation) — `routes/rnpm.ts` ruleaza `executeSearch` si `executeBulkSearch` cu `ownerId = getOwnerId(c)` end-to-end; `inflightKey(ownerId, clientRequestId)` foloseste owner-ul real (anterior `"local"` hardcodat, masking pentru web cand mai multi useri trimit acelasi `clientRequestId` cross-owner). Closure #2 (admin guard pe global routes) — `requireRole("admin")` aplicat pe `DELETE /saved/all`, `POST /compact`, `DELETE /backups`, `GET /backups`, `POST /backups/restore`, `POST /open-db-folder`, `POST /open-backups-folder` (anterior orice user putea sterge avizele globale sau lansa restore in web mode). Closure #12 (web mode captchaKey body refuz) — helper `rejectCaptchaKeyInWebMode()` returneaza 501 cu mesaj romanesc pe `POST /search`, `POST /bulk`, `POST /captcha/balance` cand `getAuthMode() === "web"` (RNPM in web necesita per-user key storage server-side, neimplementat in v2.11.0).

**Build script:** `scripts/build-server.js` rebrand "portaljust" → "legal-dashboard" (`outName`, banner CLI, `README.txt`).

**Tests:** **728 teste backend** (de la 721 in v2.10.6 — 7 noi in `rnpm.contract.test.ts`: 3 pentru web-mode 501 gate pe `/search` + `/bulk` + `/captcha/balance`, 4 pentru admin-required pe `/saved/all` + `/compact` + `/backups/restore` + `/backups` GET cu user demoted via `updateUserRole("local","user")`). 73/73 frontend neschimbate. tsc backend + frontend verde, biome verde.

**Documentatie:** `CHANGELOG.md`, `frontend/src/data/changelog-entries.tsx`, `README.md`, `STATUS.md`, `SESSION-HANDOFF.md`, `EXECUTION-ROADMAP.md`, `CLAUDE.md` actualizate.

**Versionare:** Manifest root + workspaces backend/frontend bumpate `2.10.8` → `2.11.0` (lockfile refresh via `npm install --package-lock-only`).

**Livrat anterior (v2.10.8):** Patch CI-only peste v2.10.7. Workflow-urile `build-windows.yml` si `build-mac.yml` ruleaza `tsc --noEmit` + `vitest run` pentru backend si frontend **inainte** de packaging — pe Windows ordinea conteaza pentru ABI-ul `better-sqlite3` (testele ruleaza cu ABI Node lasat de `npm ci`, inainte de `rebuild:electron` care flips la ABI Electron); pe Mac testele ruleaza inainte de `npm run build` (electron-builder are `npmRebuild` intern care flips ABI la packaging time). Un fail de type-check sau teste blocheaza generarea artefactelor. `actions/upload-artifact` foloseste pattern-ul `legal-dashboard-{platform}-${{ github.ref_name }}-run${{ github.run_id }}` pentru a evita overwrite-uri pe rerun cu acelasi tag — retention pastreaza istoric, nu doar ultimul build. Backlog-ul "GitHub Actions packaging hardening" inchis (eliminat din `SESSION-HANDOFF.md` si `EXECUTION-ROADMAP.md`).

**Livrat anterior (v2.10.7):** Patch frontend + docs peste v2.10.6. Pagina `Monitorizare` nu mai afiseaza in header doar numarul de randuri incarcate pe pagina (`jobs.length`, de exemplu 100), ci totalul real returnat de backend pentru lista paginata (`total`, de exemplu 616). Textul `Selectia opereaza doar pe pagina vizibila (100 din 616)` ramane pentru claritatea selectiei/exportului pe pagina curenta. Tooltip-urile Excel/PDF mentioneaza explicit joburile vizibile.

**Livrat anterior (v2.10.6):** Patch hardening peste v2.10.5, fara comportament nou. Absoarbe integral findings-urile review-ului `REVIEW-FINDINGS-2026-05-03.md` (Critical + High + Medium + Low + nice-to-have) si elimina script-ul `seed-test-alerts.cjs` plus Task A (editare job monitorizare). Frontend: `useDebouncedValue` rescris cu tuple `[value, flush]`, `flushQuery("")` cablat in clear-X / Reset filter pe `Alerts.tsx` + `Monitorizare.tsx`, `JobKindTabs` primeste navigatie tastatura WAI-ARIA (ArrowLeft/Right cu wrap, Home/End, roving tabindex), `jobKind` ingustat la tipul tab-bar-ului. Backend: helper `escapeLikeMeta` extras in `util/textNormalize.ts` cu JSDoc `@example`; `auditRepository.listAuditEvents` (`actionLike`) si `userRepository.listUsers` (`search`) folosesc `ESCAPE '\\'` + `escapeLikeMeta`; `monitoringJobs/AlertsRepository` adauga guard `q?.trim()`. Tests: 721/721 backend (+18: nou `textNormalize.test.ts` + 3 wildcard `getAvize`); 73/73 frontend (+22: noi `useDebouncedValue.test.ts`, `JobKindTabs.test.tsx`, `alertsApi.test.ts`). Validare: tsc backend + tsc frontend verde, build productie OK, rebuild Electron, smoke desktop `/health` 200.

**Livrat anterior (v2.10.5):** Patch UX Dashboard + Alerte peste v2.10.4. Dashboard-ul afiseaza `Monitorizari active` in loc de `Joburi active`, cu subline `X Dosare, Y Nume`. Pagina Alerte primeste tab-bar `Toate / Dosare / Nume` si search debounced dupa targetul jobului; filtrele existente pe event-kind, severitate, unread/dismissed si interval date raman neschimbate si se combina cu noile filtre. Backend-ul expune `GET /api/v1/alerts?jobKind=...&q=...`, cu match fara diacritice si wildcard-uri LIKE escapate; `COUNT(*)` foloseste acelasi JOIN ca lista paginata cand filtrele target-based sunt active. Validare: 703/703 backend tests, backend/frontend type-check, Biome, build productie, rebuild Electron si smoke desktop `/health` OK.

---

**Data:** 2026-05-01 (v2.6.8: review-driven hardening peste v2.6.7 — fix HTML a11y pe cardul "Adaugare bulk din fisier" + derivare `CADENCE_COL_LETTER` din `HEADERS` + eroare clara la header lipsa in `parseBulkFile` + corectare claim stale despre `xlsx@0.18.5` in `SESSION-HANDOFF.md`)
**Versiune curenta:** v2.6.8
**Status global:** 10/10 pasi completi. Sprint monitoring + web mode: PR-0..PR-8 implementate local + patch-uri UX v2.6.1..v2.6.3 + audit hardening v2.6.4 + UX polish v2.6.5..v2.6.6 + export Monitorizare v2.6.7 + review-driven hardening v2.6.8; urmatorul PR este PR-9 Auth pluggable (desktop noop / web SSO).

**Livrat recent (v2.6.8):** Patch frontend + docs peste v2.6.7. Trei probleme reale gasite la verificarea unor nitpick-uri automate, aplicate strict 1:1 fara scope creep.

**Frontend - HTML button nesting fix:** in `frontend/src/pages/Monitorizare.tsx` cardul "Adaugare bulk din fisier" folosea `<button>` ca wrapper peste `<CardHeader>` (div) si `<CardTitle>` (h3) — HTML interzice block-elemente in `<button>`. Handler-ul (`setBulkOpen((v) => !v)`) muta direct pe `<CardHeader>` cu `role="button"`, `tabIndex={0}`, `onClick`, `onKeyDown` (Enter / Space cu `preventDefault`). `aria-expanded` si `aria-controls` pastrate. Adaugat `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` pentru focus vizibil la tastatura.

**Frontend - derivare `CADENCE_COL_LETTER`:** in `frontend/src/lib/monitoringBulkTemplate.ts` literalul `"C"` inlocuit cu `colIndexToLetter(HEADERS.indexOf("cadence_sec"))`. Helper nou `colIndexToLetter(idx)` (0-based → A, B, ..., Z, AA, ...) baza 26 cu prefix-ul standard Excel. Boot-time guard `throw new Error(...)` cand `cadence_sec` nu mai e in `HEADERS`. Reordonarea coloanelor nu mai poate sa desincronizeze silent `<dataValidation sqref="...">` injectat cu `fflate` in `xl/worksheets/sheet1.xml`.

**Frontend - eroare vizibila pentru header lipsa:** in `parseBulkFile` cand `findHeaderRow(matrix) < 0` se push-uieste `{ rowNumber: 1, display: fileName, message: "Header lipsa: fisierul nu contine niciuna dintre coloanele recunoscute (numar_dosar, nume, name_normalized, denumire). Descarca template-ul si reincearca." }` in `invalid[]`. Anterior: silent return cu `valid=[]`+`invalid=[]`, utilizatorul nu primea niciun semnal de eroare.

**Docs - corectare claim stale:** in `SESSION-HANDOFF.md` linia "xlsx@0.18.5 ramane risc acceptat temporar..." rescrisa — post-v2.6.4 `nameListParser.ts` ruleaza pe `exceljs@^4.4.0` (`xlsx` mutat in `devDependencies`). xlsx nu mai e pe path-ul de parsare a inputului user, ramane folosit tranzitiv pe path-ul write-only prin `xlsx-js-style` si in fixturile de test.

**Style commitment:** structured-section style aplicat pe entries noi de aici inainte (subsections cu `**Frontend:**`, `**Backend:**`, `**Tests:**`, etc.). Entries istorice nu se retrofiteaza — costul de mentenanta depaseste beneficiul.

**Validare:** `npx tsc --noEmit` (frontend) verde, `npm run build` complet in 15.64s fara erori. Manual: cardul colapsabil reactioneaza la click, Enter, Space; `aria-expanded` toggle confirmat; focus ring vizibil. Smoke desktop OK (Electron pornit, `/health` 200, monitoring scheduler running). 546/546 backend tests neschimbate (modificarile sunt strict frontend + un fisier MD).

**Livrat anterior (v2.6.7):** Patch frontend-only peste v2.6.6. Pagina `/monitorizare` primeste paritate completa cu `/dosare` si `/termene` la export — butoane `Excel` + `PDF` adaugate in CardHeader "Joburi active" (vizibile cand `jobs.length > 0`), state partajat `exporting: "xlsx" | "pdf" | null` care dezactiveaza ambele butoane in timpul generarii si afiseaza `Loader2` spin pe butonul activ. Helper nou `getExportJobs()` returneaza selectia (cand `selectedIds.size > 0`) sau toate joburile vizibile, suffix `(N)` pe label cand selectia e activa — pattern identic cu `DosareTable`. Builderii noi `buildMonitoringXlsx(jobs)` si `buildMonitoringPdf(jobs)` in `frontend/src/lib/export.ts` reuseaza acelasi design ca `Termene`/`Dosare`: XLSX cu titlu `PORTALJUST DASHBOARD — MONITORIZARE` (BLUE_DARK 13 bold alb merged A:H), header BLUE_MAIN bold alb, randuri alternate ROW_ALT/WHITE font 10, 8 coloane (#, Tinta, Tip, Cadenta, Ultima rulare, Urmatoarea verif., Status, Note); `sanitizeFormulaCells(ws)` aplicat pre-write pentru formula-injection guard pe `=+-@\t\r`. PDF landscape A4 helvetica cu header `[37,99,235]` text alb, alternate row `[245,247,250]`, `stripDiacritics(...)` pe text (jsPDF default font), columnStyles cu `Tinta` cellWidth 50 fontStyle bold, footer "Pagina N" centrat. Helperi auxiliari: `formatMonitoringCadence(sec)` (4h/24h/7z/30min), `formatMonitoringDateTime(iso)` (dd.mm.yyyy hh:mm), `monitoringKindLabel(kind)` (Dosar/Nume/Aviz RNPM), `monitoringStatusLabel(job)` (`activ/pauza` `/` `last_status`). `ExportJob` discriminated union extins cu `monitoringXlsx`+`monitoringPdf`, dispatch in `frontend/src/lib/export.worker.ts` (build off main thread cu transferable buffer). Filename pattern: `monitorizare_<sanitized_target>.xlsx` cand exporti un singur job, `monitorizare_<dataRO>.xlsx` cand exporti mai multe — consecvent cu `dosare_*` si `termene_*`. Validare: `npx tsc --noEmit` (frontend) verde, `npm run build` complet in 13.94s fara erori. Zero modificari pe backend, repo sau scheduler — pur frontend additive; 546/546 teste backend raman verzi (neschimbate fata de v2.6.4..v2.6.6).

**Livrat anterior (v2.6.5):** Patch frontend-only UX peste v2.6.4. Link-ul `<a>` din coloana TINTA pentru joburi `dosar_soap` schimba `font-medium` → `font-bold` (numarul devine prima ancora vizuala, consecvent cu pattern-ul "primary action surface" din inbox-ul Alerte). Cardul "Adaugare bulk din fisier" din `frontend/src/pages/Monitorizare.tsx` foloseste un state `bulkOpen` (default `false`) cu icon `ChevronDown`/`ChevronRight`; `<CardContent>` randat condional doar cand cardul e deschis — pagina nu mai pierde un screenful pentru o zona folosita rar. Descrierea cardului trece de pe `text-muted-foreground` pe `text-foreground` (negru/inversa pe dark) pentru lizibilitate, iar textul tehnic se rescrie in romana simpla pentru utilizatori non-tehnici (descarca template → completeaza → incarca, fara mentiunea numelor de coloane). Template-ul XLSX `frontend/src/lib/monitoringBulkTemplate.ts` rescris sa foloseasca `xlsx-js-style` (dinamic import) cu acelasi limbaj vizual ca restul exporturilor: row 1 titlu merged A:E `BLUE_DARK` 13 bold alb centrat, row 2 stats italic gri pe `F1F5F9`, row 4 header `BLUE_MAIN` alb bold border-bottom `1D4ED8` cu `wrapText`, row 5+ alternating fill (`ROW_ALT` pe impare, `WHITE` pe pare) font 10 plain `vertical: top`. Constant nou `TEMPLATE_FONT_SIZE = 10` aplicat consecvent. Latimi recalibrate (16/28/12/18/30 ch). Dropdown `cadence_sec` mutat pe `C5:C1004` cu post-process OOXML prin `fflate`. `parseBulkFile` detecteaza header-ul dinamic prin `findHeaderRow()` (scaneaza primele 20 randuri si identifica primul rand cu `numar_dosar`/`nume`/`name_normalized`/`denumire`); template nou (header row 4) si fisiere vechi flat (header row 1) sunt ambele acceptate fara forking de path. `downloadBulkTemplate` devine `async`. Field-ul `notes` din formularul de monitorizare devine vizibil in tabel — sub link+buton in **aceeasi celula TINTA**, conditionat pe `{job.notes && (…)}` ca randurile fara nota sa ramana compacte; styling `text-xs italic text-muted-foreground font-sans truncate max-w-[420px]` cu tooltip integral pe hover. Tests: 546 pass (neschimbate fata de v2.6.4).

**Livrat anterior (v2.6.4):** Audit hardening dupa multi-agent review pe diff-ul local fata de `origin/main` (raport `MULTI-AGENT-REVIEW-LEGAL-DASHBOARD-2026-04-30.md`). Backend — F1: `DELETE /api/v1/monitoring/jobs/:id` verifica `scheduler.getInflightAbortController(id)` inainte de stergere si returneaza `409 job_in_flight` daca runner-ul are `AbortController` activ pe job (audit `monitoring.job.delete_inflight` cu `outcome: denied`); previne `RUNNER_THREW` cand finalizer-ul incerca sa scrie pe o linie disparuta. F4+F5+F6: `enrichSolutieAlertsForJob` restrans — fara backfill global pe `instanta`/`stadiu` (alertele istorice pastreaza contextul lor de la momentul emiterii), early return cand `sedintaCandidates.length === 0`, fereastra de backfill limitata la `created_at >= now - 7 days`, query targetat la alerte cu campuri lipsa, batch cap 200/tick, match relaxat pe `(data, ora, complet)` cu `trim()` pe textul `solutie` (fallback cand PortalJust modifica textul intre alerta initiala si publicarea hotararii). F7: `addAlertEnrichmentListener` + frame SSE nou `alert_enriched` notifica clientii cand o alerta veche primeste textul hotararii (mirror la pattern-ul `notifyNewAlert`, dispatch izolat per-listener, fara work SQLite in callback). F9: ruta noua `POST /api/v1/monitoring/jobs/bulk-delete` — body `{ ids: number[] }` cap 100, tranzactie SQLite atomica, raport detaliat `{ deleted_ids, inflight_ids, not_found_ids, total_deleted }` (denied cross-owner fuzionat in `not_found` ca raspunsul sa nu scurga existenta), audit unic agregat. F10: `insertAlert` returneaza `{ row, inserted }` (era `MonitoringAlertRow`); `dosarSoapRunner` numara doar inserturile reale in `alerts_created`, dedup no-op nu mai infla metrica. F2 (hard-fail + CSRF): `LEGAL_DASHBOARD_ALLOW_REMOTE=1` sau HOST non-loopback REFUZA pornirea (`fatalBoot` exit 1) daca nu e prezent ack explicit `LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet` — un crash forteaza o decizie, banner-ul ramane in jurnale ca audit trail. Suplimentar, middleware nou `originGuard` pe `/api/*` (`backend/src/middleware/originGuard.ts`, mountat in `index.ts:127`) blocheaza state-changing requests (POST/PUT/PATCH/DELETE) cu Origin/Referer mismatch fata de Host pentru caller-i non-loopback (403 `csrf_origin_mismatch`); bypass automat pentru loopback si metode safe (GET/HEAD/OPTIONS). F3 (xlsx → exceljs): `backend/src/services/nameListParser.ts` migrat de pe `xlsx@0.18.5` (CVE Prototype Pollution + ReDoS, no upstream fix) pe `exceljs@^4.4.0`; `parseNameList` devine async cu safety belt 30s timeout pe parse, limitele MAX_FILE_BYTES / MAX_ROWS / MAX_COLS pastrate. `xlsx` mutat din `dependencies` in `devDependencies` (folosit doar de fixture-uri de test). `xlsx-js-style.writeFile()` ramane neschimbat pe path-ul de export. Frontend — `Monitorizare.tsx` foloseste `monitoring.bulkDeleteJobs(ids)` cand `selectedIds.size > 1`, pastreaza `selectedIds` cu `inflight_ids` pentru retry, `useEffect` de prune dupa refresh. `Alerts.tsx` consuma frame-ul SSE `alert_enriched` si rebuilds `AlertContext` cu `hotarare` block (`numarDoc`, `dataPronuntare`, `sumar`) randat ca callout structurat. `lib/api.ts` adauga `BulkDeleteResult` + `monitoring.bulkDeleteJobs`. Teste — **546/546 backend** (de la 524 in v2.6.3, +22 noi): `monitoringAlertsRepository.test.ts` +411 linii (patch idempotent, no overwrite non-empty, owner/job/kind scoping, JSON invalid ignorat, solutie text changed, atomic rollback enrichment), `dosarSoapRunner.test.ts` +104 linii (alerta veche incompleta + tick nou cu hotarare, rollback enrichment), `nameListParser.test.ts` +160 linii. Validare — typecheck backend si frontend verde, build productie trecut, smoke desktop OK (`/health` 200, monitoring `running: true`, `inflight: 0`).

**Livrat anterior (v2.6.3, 30 Aprilie 2026):** Patch UX continuu peste v2.6.2. Frontend-only: in tabelul Monitorizare coloana TINTA pentru joburi `dosar_soap` afiseaza acum numarul ca link extern catre `portal.just.ro/SitePages/cautare.aspx?k=<numar>` (icon `ExternalLink` 12px) plus un buton mic 24x24 cu icon `Search` care declanseaza auto-search in lista Dosare prin acelasi mecanism `pendingSearch` din `App.tsx` ca in inbox-ul Alerte. Bug fix critic: dropdown-ul de cadenta minte pe joburi cu `cadence_sec` non-standard (in afara setului `{14400, 28800, 43200, 86400}`) — empiric job `1234/180/2024` (smoke-hardening leftover din PR-4) avea `cadence_sec=600` (10min) in DB iar UI-ul afisa silent "4h" (`DEFAULT_CADENCE_SEC`) in timp ce runner-ul folosea valoarea reala (next_run = last_run + 10min cu jitter, divergent fata de cei 4h promisi vizual); fix-ul prepende un option `"<formatCadence(cadence_sec)> (custom)"` cu border + text amber (`border-amber-500 text-amber-700`) cand valoarea nu e in optiunile standard, asa ca utilizatorul vede exact ce ruleaza si poate selecta o optiune standard pentru a normaliza prin PATCH existent. Paginarea inbox-ului Alerte adopta componenta partajata `TablePagination` (la fel ca in Cautare Dosare / RNPM / Termene) cu page-size selector + numere de pagina + input de salt, wrappata in `<Card>` ca dimensiunile zonei sa match-uiasca; `page` schimbat de la 1-indexed la 0-indexed cu conversie `+1` la apelul backend; `pageSize` devine state controlat (default 25). Cardul de alerta scade un pixel suplimentar pe scara fontului (`alertCardZoom = (fontSize.value - 3) / fontSize.value`, era `- 2`). Validare - `npx tsc --noEmit` (frontend) clean, 524/524 teste backend neschimbate (modificarile sunt strict frontend + prop-passing in `App.tsx`).

**Livrat anterior (v2.6.0):** PR-8 admin pages + roles guard. Backend - middleware nou `requireRole(...allowed: UserRole[])` cu rezolutie via `getOwnerId(c)` + `getUserById`, refuz 401 pentru ghost user, 403 pentru status non-active si 403 pentru rol mismatch; fiecare refuz scrie audit `auth.denied` cu `reason` si `required`. Ruta noua `GET /api/v1/me` cu profilul callerului in envelope v1. Suprafata `/api/v1/admin/{users,users/:id,users/:id/role,users/:id/status,audit,users/:id/quota,users/:id/quota/:feature}` toate gated cu `requireRole('admin')`. Migration `0011_user_quota_overrides` cu PK `(user_id, feature)`, `daily_limit_usd_milli >= 0`, ON DELETE CASCADE. Guardrails `last_admin` 409 (self-demote refuzat cand callerul ar ramane zero administratori activi) si `self_deactivation` 409 (caller nu-si poate schimba propriul status in non-active). Audit cu `before`/`after` pe writes; reads NU scriu audit. Frontend - hook nou `useCurrentUser` cu AbortController + retry via `tick`; componenta `AdminGate` care randeaza 403 pentru non-admini; sidebar conditional cu sectiunea "Administrare" cand rolul e admin; trei pagini admin (`/admin/users` cu inline edit rol/status si confirmari, `/admin/audit` cu rand expandabil per eveniment si filtre `since`/`until` in timezone local, `/admin/quota` cu workflow in doua etape - cauta user, edit override-uri in USD salvate ca milli-USD); types & helpers `me.get` + `admin.{listUsers,getUser,updateRole,updateStatus,listAudit,listQuota,upsertQuota,deleteQuota}` in `lib/api.ts`. Teste - **524/524 backend** (de la 440 in v2.5.1, +84 noi: `userQuotaRepository.test.ts` 13, `requireRole.test.ts` 10, `auditRepository.test.ts` extensii 12, `admin.test.ts` ~30). Validare - typecheck backend si frontend verde, smoke test end-to-end prin curl pe `/me`, gate, `/admin/users`, `/admin/audit?since=...`, quota PUT/GET, self-demote 409 cu mesaj romanesc, `npm rebuild better-sqlite3` → `npm test` → `npm run rebuild:electron` sequence completata.

**Livrat anterior (v2.5.1):** Hotfix peste PR-7 dupa multi-agent review pe suprafata AI usage tracking. Backend - toate query-urile pe fereastra de timp folosesc `ts >= ?` (closed lower bound, fix off-by-one); `summary30d` aliniat la aceeasi fereastra UTC-midnight ca seria daily (era `now − 30×24h`, mismatched); handler `/summary` wrapped in `withMaintenanceRead` pentru cooperare cu daily backup writer; functie noua `purgeOldAiUsage(90)` in scheduler-ul zilnic alaturi de `purgeOldRuns`; multi-agent `analystsAbort` AbortController shared (un analist esuat anuleaza sibling-ul, evita 180s timeout idle); `signal?: AbortSignal` propagat in toate provider call-urile + `AbortSignal.any` cu timeout intern; `markShuttingDown()` latch ca microtask-urile post-shutdown sa nu redeschida DB-ul; token extraction din SDK error objects; `httpStatus` clamped `[100,599]` sau null; price-table miss warn one-shot JSON cu dedup; insert SQLite deferred via `queueMicrotask`; insert-failure log structurat. Frontend - fix timezone pe seria daily (`new Date(\`${value}T00:00:00Z\`)` + `timeZone: "UTC"`); `inflightRef` AbortController pe refresh re-fire; caption "Informativ" in panou ca quota desktop nu este enforce. Teste - **440/440 backend** (de la 432, +8 din hardening): nou `routes/aiUsage.test.ts` (envelope, owner isolation, daily-sum=summary30d invariant), AI_MODELS price-table coverage, error-path tests cu 429+usage, http_status clamps, no-row-when-tracking-omitted, closed-lower-bound case. Validare - typecheck backend si frontend verde, biome clean, `npm rebuild better-sqlite3` → `npm test` → `npm run rebuild:electron` sequence completata.

**Livrat anterior (v2.5.0):** PR-7 - AI usage tracking + per-user quota visibility. Backend - migration `0010_ai_usage`, `aiUsageRepository`, cost model integer `cost_usd_milli`, owner-scoped totals/sliding window, post-call tracking in `withAiLogging()` pentru single analysis si multi-agent (analisti + judge), ruta `/api/v1/ai-usage/summary` cu envelope v1. Frontend - panou `AI Usage` in Setari API cu cost ultimele 24h/30 zile, grafic Recharts last 30 days, loading/error/empty states. Validare - 432/432 backend tests verde, backend/frontend typecheck verde, build productie trecut, `npm run rebuild:electron` rulat dupa testele Node.

**Livrat recent (v2.4.2):** Hotfix peste PR-6 dupa full-review multi-agent. Backend - heartbeat SSE 25s + `retry: 3000`, `bodyLimit` per ruta (4KB pe PATCH, 8KB pe POST seen-bulk), audit pe `seen`/`dismissed`/`seen-bulk`, cap 5 stream-uri concurente per owner cu frame `too_many_streams`, `insertAlert` complet tranzactional cu `notifyNewAlert` deferred prin `queueMicrotask` ca listenerii sa nu vada `read_at`/`dismissed_at` partiale. Frontend - filtrele de data folosesc `Date(YYYY, M-1, D)` local (timezone fix), `markVisibleSeen` foloseste bulk POST `/seen-bulk` cu fallback per-id, badge-ul refresh-uieste din server in loc de optimistic update. Electron - notificari native cu dedup pe `tag` (Map cap 100, FIFO eviction), suprimate cand fereastra e focusata. Validare - smoke Electron OK, `/health` 200, toate endpoint-urile alerts 200, SSE subscribe cap-5 + heartbeat exercitat la runtime. Teste vitest amanate pana la urmatorul rebuild Node (`better-sqlite3` ABI lock pe Electron 145).

**Livrat anterior (v2.4.1):** PR-6 baseline - inbox `Alerte` paginat, badge numeric rosu in sidebar (expanded + collapsed), stream live `/api/v1/alerts/stream` cu reconnect/backoff pana la 30s, mark read / dismiss, notificari native Electron prin IPC `desktopApi.showNotification` cu fallback Web Notification.

**Livrat anterior (v2.4.0):** PR-5 - bulk import monitorizare si `name_soap`. UI-ul Monitorizare accepta XLSX/CSV mixt cu `numar_dosar` sau `nume`, template-ul XLSX are dropdown `cadence_sec` si a fost verificat prin Electron + Excel. Backend-ul adauga `name_lists`, `name_list_items`, preview/commit stateless, auto-create jobs cu cap 100, runner `name_soap` si diff alerts pentru dosare noi/stadiu/categorie/relevanta. Post-review: `createList()` si `archiveList()` ruleaza check-urile critice in tranzactii `BEGIN IMMEDIATE`, iar bulk dosar raporteaza added/existing dupa status HTTP 201/200. 416/416 backend tests verde, build productie trecut, PR #5 merge-uit in `main`.

**Livrat anterior (v2.3.0):** Audit remediation peste v2.2.0 dupa auditul intern din 29 aprilie. Reliability - backup zilnic recurent (`setInterval` 24h + cleanup la `gracefulShutdown`), restore SQLite cu `PRAGMA integrity_check` inainte de promote, graceful shutdown drain HTTP 30s la `SIGTERM`/`SIGINT`. Migration 0005 - `idx_one_running_per_job` (UNIQUE partial index pe `monitoring_runs(job_id) WHERE status='running'`) garanteaza la nivel de DB ca un singur run `running` simultan per job. RNPM - `executeSearch` ruleaza acum sub `withMaintenanceRead` (write-urile in DB intra in lock; fetch HTTP NU); audit pe `POST /saved/delete-batch`, `DELETE /saved/:id`, `DELETE /searches/:id`; verificare `belongsToOwner` pe `existingSearchId`. Migration runner - self-heal bidirectional (`sha256Raw` + `sha256Crlf`) pentru DB-uri vechi indiferent de directia conversiei `git autocrlf`; `selfHealed[]` expus in `RunMigrationsResult`; `MIGRATIONS_STRICT=1` dezactiveaza self-heal in CI; `.gitattributes` forteaza `eol=lf` pe migrari. Export - XLSX si PDF mutate integral in Web Worker (RNPM avize, Dosare/Termene, panel AI, Manual); ArrayBuffer transferat zero-copy; Vite `worker.format="es"` pentru code-splitting (xlsx + jspdf chunks lazy); butoanele afiseaza spinner imediat la apasare. Dependinte - `dompurify >= 3.4.1`, `jspdf >= 4.2.1`, `jspdf-autotable 5.0.7`. 357/357 backend tests verde (de la 333 in v2.2.0).

**Livrat anterior (v2.2.0):** PR-4 — monitoring scheduler + dosar_soap runner + full-review hardening Tier 2-6. 333 teste backend verde. Tag `v2.2.0` publicat pe origin.

**Livrat anterior (v2.0.10):** Observabilitate AI extinsa — `isTimeoutOrAbort(e)` exported helper detecteaza timeout/abort inclusiv pe subclase SDK (`APIUserAbortError` / `APIConnectionTimeoutError`), `withAiLogging` accepta `{ value, meta }` ca provider-ul interior sa ataseze `usageInput`/`usageOutput` (token counts), `httpStatus` capturat pe path-ul de eroare din `e.status` (APIError SDK). Backup/restore — `withMaintenanceLock` (promise chain) serializeaza `restoreFromBackup` cu `runDailyBackup`, `PRAGMA wal_checkpoint(TRUNCATE)` rulat inainte de `closeDb()` ca pre-restore snapshot sa includa frame-urile WAL necommitate, `logBackupEvent` (single-line JSON, `ts` auto) inlocuieste `console.log` ad-hoc, sidecar `-wal`/`-shm` unlink cu logging non-ENOENT (EBUSY de la AV pe Windows nu mai e silent), `runDailyBackup` foloseste `await fsPromises.mkdir`. Frontend safeStorage — `useApiKey.setKeys()` defensive `.trim()` pe fiecare cheie inainte de persist (legacy migration path). RNPM gcode caching — investigatie inchisa empiric (negativ): RNPM respinge reuse cross-search, captcha-per-query este cost intrinsec API-level. 62/62 backend tests verde.

**Livrat anterior (v2.0.9):** F10-M4 — `restoreFromBackup` foloseste `fsPromises.access` in loc de `fs.existsSync` (path async-only, event loop nu mai blocheaza pe stat-uri lente); F10-M5 — `unlink(-wal)` / `unlink(-shm)` mutate inainte de `rename(tmpPath, dbPath)` ca DB-ul nou sa nu coexiste cu sidecar-uri stale (silent corruption la lazy open eliminat); F10-M6 — helper `withAiLogging(provider, model, fn)` in `services/ai.ts` care wraps `callAnthropic`/`callOpenAI`/`callGoogle` si emite single-line JSON `{action:"ai_call", provider, model, latencyMs, status, errorType?, ts}`; F10-M7 — `.github/workflows/docker-build.yml` cu `docker build` + smoke test `node -e` + smoke test `/health` (60s poll, container primeste `HOST=0.0.0.0` + `LEGAL_DASHBOARD_ALLOW_REMOTE=1` ca portul 3002 sa fie reachable din host). Run CI verde in 2m20s.

**Livrat anterior (v2.0.8):** hardening post-release: `NODE_ENV=development` eliminat din `.env.example`; `AbortSignal` propagat pana in SOAP fetch; daily backup atomic cu `.db.tmp` + rename si cleanup orphan; restore log JSON structurat; teste backup atomicity/retention (55/55 backend tests); Docker reproductibil cu `package-lock.json` + `npm ci`; healthcheck cu `start-period=120s`; ZIP server instaleaza runtime deps pe platforma tinta; script `npm run rebuild:electron` pentru alternanta Node/Electron ABI la `better-sqlite3`.

**Livrat anterior (v2.0.7):** RNPM pastreaza corect state-ul intre taburile principale `Cautare` / `Bulk` / `Baza locala`; revenirea pe `Cautare` intoarce utilizatorul la categoria RNPM activa anterior (din cele 5), nu default pe prima. Rezultatele unei cautari sunt vizibile doar pe categoria in care au fost obtinute, deci nu mai apar in alte categorii.

**Livrat anterior (v2.0.6):** SOAP parser decodeaza entitati XML (`&amp;`, `&quot;`, `&apos;`, `&lt;`, `&gt;` + numeric refs) la leaf fields in `parseDosar` — nume parti si obiect render corect in tabele / modal / export XLSX / prompt AI (ex: `S.C. X &amp; Co.` → `S.C. X & Co.`); consolidare CodeRabbit findings 19.04.2026 in HARDENING Faza 7 (4 Critical + 6 Important + 6 suggestions, blockers pentru web-deploy + auto-sync monitorizare); 5 teste noi pe `decodeXmlEntities` (29/29 verde).

**Livrat anterior (v2.0.5):** RNPM auto-load pe batch de 25 cu bara de progres; `Sterge baza` elibereaza efectiv spatiul pe disc (VACUUM + WAL checkpoint); user-abort loghea 499 pe backend (separat de erorile 500 reale); tab Bunuri nu mai intepeneste pe avize 1000+ bunuri (content-visibility).

**Livrat anterior (v2.0.4):** split-uri componente (DosareTable, RnpmSearchForm, Sidebar, MetricsPanel, Dashboard, Manual, Changelog, TermeneTable) + polish formular RNPM (Prenume creditor PF, PFBlock grid, zone colapsabile, legend alignment) + bulk stats refresh + RnpmRestoreModal.

**De continuat:** parser-ul RNPM trateaza acum `ipoteci` (default) + `specifice` (shape partiF/partiJ + part3.bunuri). Ramane de extins pentru **fiducii / creante / obligatiuni ipotecare** — dupa captura unor raspunsuri reale (parts 1-4 + istoric). Vezi CHANGELOG.md → "18 Aprilie 2026 (sesiune 2)" pentru pattern-ul de branching.

---

## Ce este Legal Dashboard

Aplicatie Electron desktop = **copie completa PortalJust Dashboard v1.4.4-ai + tab nou "Cautare RNPM"** (Registrul National de Publicitate Mobiliara). PortalJust ramane aplicatie separata, neatinsa.

- **Versiune:** v1.0.0
- **AppId:** `ro.legaldashboard.app`
- **ProductName:** Legal Dashboard
- **DB path:** `userData/legal-dashboard.db` (via env `LEGAL_DASHBOARD_DB_PATH`)
- **Istoric RNPM separat** de istoricul PortalJust (localStorage: `legal-dashboard-rnpm-history`)

---

## Progres

| # | Pas | Status |
|---|---|---|
| 1 | Copy PortalJust -> Legal Dashboard + rename branding | OK |
| 2 | Verify copied app runs (npm install + build) | OK |
| 3 | Backend: deps + SQLite schema + repositories | OK |
| 4 | Backend: captchaSolver + rnpmClient | OK |
| 5 | Backend: rnpmSearchService + routes (REST + SSE bulk) | OK |
| 6 | Frontend: types + rnpmApi + useApiKey + useRnpmHistory | OK |
| 7 | Frontend: RnpmSearchForm + RnpmResultsTable | OK |
| 8 | Frontend: RnpmDetailModal + RnpmBulkSearch + RnpmSavedData | OK |
| 9 | Integrate: Sidebar + App.tsx + 2Captcha key dialog | OK |
| 10 | Electron build `Legal Dashboard.exe` (`npm run dist`) | OK |

**Typecheck frontend:** curat (`npx tsc --noEmit` returns empty).

---

## Ce s-a construit in aceasta sesiune

### Backend (`backend/src/`)

- `db/schema.ts` — singleton `getDb()`, WAL, foreign keys, creeaza 6 tabele:
  - `rnpm_searches` — istoric interogari (cu owner_id, tip, params JSON, total)
  - `rnpm_avize` — UNIQUE(owner_id, identificator); toate campurile part1
  - `rnpm_creditori`, `rnpm_debitori`, `rnpm_bunuri`, `rnpm_istoric` — relatii per aviz
- `db/searchRepository.ts` — saveSearch, getSearches (cursor), deleteSearch
- `db/avizRepository.ts` — saveAvizFull (tranzactie upsert), getAvizById, getAvize (filtre searchType/activ/data/q), deleteAviz, getAvizeByIds
- `services/captchaSolver.ts` — @2captcha/captcha-solver wrapper; RNPM_SITEKEY `6Lff9LsUAAAAAO1gN9y3YMSyX94MS4Yh5zPqePkT`; CaptchaError cu mesaje RO
- `services/rnpmClient.ts` — `search()`, `fetchPart(uuid, 1..4)`, `fetchIstoric()`, `fetchFullDetail()` (Promise.all 5 req)
- `services/rnpmSearchService.ts` — executeSearch (captcha -> search -> batch-5 fetch detail -> persist) + executeBulkSearch (AbortSignal + progress callback)
- `routes/rnpm.ts` — Hono router montat la `/api/rnpm`:
  - `POST /search` — cautare + persist
  - `POST /bulk` — SSE streaming (streamSSE din hono/streaming)
  - `GET /saved` — paginat cursor, filtre (searchType, activ, q, dataStart, dataStop)
  - `GET /saved/:id` — detaliu full
  - `DELETE /saved/:id`
  - `POST /saved/export` (max 500 ids)
  - `GET /searches`, `DELETE /searches/:id`
  - `POST /captcha/balance`
- `index.ts` — health string "Legal Dashboard API", router montat

### Frontend (`frontend/src/`)

- `types/rnpm.ts` — toate tipurile RNPM
- `lib/rnpmApi.ts` — wrapper fetch: rnpmSearch, rnpmGetSaved, rnpmGetAvizDetail, rnpmDeleteAviz, rnpmExport, rnpmCaptchaBalance, rnpmBulkSearch (parser SSE manual)
- `hooks/useApiKey.ts` — extins cu `twocaptcha` + `hasTwoCaptcha`; migratie + obfuscate compatibile
- `hooks/useRnpmHistory.ts` — istoric separat (STORAGE_KEY `legal-dashboard-rnpm-history`, max 15)
- `components/rnpm/RnpmSearchForm.tsx` — 5 tab-uri categorie + toate filtrele (debitor/creditor PJ+PF, vehicule, perioada, identificator)
- `components/rnpm/RnpmResultsTable.tsx` — tabel cu checkbox selectie + paginare
- `components/rnpm/RnpmDetailModal.tsx` — modal cu 5 tab-uri (General, Creditori, Debitori, Bunuri, Istoric)
- `components/rnpm/RnpmBulkSearch.tsx` — bulk UI (textarea valori, AbortController, progres live cu SSE)
- `components/rnpm/RnpmSavedData.tsx` — browser baza locala cu filtrare + cursor "Incarca mai multe"
- `pages/RnpmSearch.tsx` — pagina compusa: tabs Cautare / Bulk / Baza locala + modal detaliu partajat
- `components/Sidebar.tsx` — adaugat nav `/rnpm` + sectiune "Istoric RNPM" separata
- `App.tsx` — RnpmSearchPage montat cu `display:none` (supravietuieste tab switch); `useRnpmHistory` la root; dialogul "Setari AI" are acum al 4-lea card **2Captcha (RNPM)**

### Electron / Branding

- `package.json` — name "legal-dashboard", version "1.0.0", productName "Legal Dashboard", shortcutName "Legal Dashboard", appId "ro.legaldashboard.app"
- `electron/main.js` — title "Legal Dashboard", env `LEGAL_DASHBOARD_DB_PATH` setat inainte de require backend
- Rebranding Sidebar / Dashboard / Manual / export PDF la "Legal Dashboard" (referintele la portal.just.ro pastrate cu nume PortalJust pentru ca e sursa externa de date)

---

## Arhitectura RNPM — note cheie

- **Fetch eager al detaliilor:** UUID-urile RNPM sunt efemere, deci in timpul search-ului facem imediat `fetchFullDetail` (5 requests per document, batch de 5 concurent) si persistam complet (aviz + creditori + debitori + bunuri + istoric). Ulterior, browse-ul din "Baza locala" nu mai face round-trip la RNPM.
- **Idempotenta:** `saveAvizFull` face upsert pe UNIQUE(owner_id, identificator) + sterge+reinserare child rows in tranzactie.
- **Cost 2Captcha:** ~$0.003/captcha. Bulk UI afiseaza estimare timp (25s/intrare) + cost.
- **SSE pentru bulk:** `streamSSE` din `hono/streaming`; frontend parseaza manual evenimentele (`event:` + `data:` linii).
- **Cursor pagination** peste tot (`{ limit, cursor }` -> `{ items, nextCursor }`), owner_id pe toate tabelele (default `"local"`).

---

## Pas ramas: 10 — Build installer

```bash
cd "C:\Users\Cezar\Desktop\Claude Code\Legal Dashboard"
npm run dist
```

Output asteptat: `release/Legal Dashboard Setup 1.0.0.exe` (NSIS) + portabil.

**Verificari dupa build:**
1. Installer se deschide, se instaleaza in `%LOCALAPPDATA%\Programs\legal-dashboard`
2. La prima rulare: DB se creeaza in `%APPDATA%\legal-dashboard\legal-dashboard.db`
3. Tab-urile Dashboard / Dosare / Termene / **Cautare RNPM** functioneaza
4. "Setari AI" contine 4 carduri: Anthropic / OpenAI / Google / **2Captcha**
5. Cu cheie 2Captcha valida: cautare RNPM -> rezultate persistate in baza locala
6. "Istoric cautari" (PortalJust) si "Istoric RNPM" afisate separat in sidebar

---

## Referinte externe

- **2Captcha SDK:** `@2captcha/captcha-solver` (organizatia oficiala: https://github.com/2captcha)
- **RNPM API base:** `https://www.rnpm.ro/api` (endpoints: `/search/{type}/{page}`, `/view/inscriere/{uuid}?part=1..4`, `/view/istoric/{uuid}`)
- **Categorii RNPM:** ipoteci, fiducii, specifice, creante, obligatiuni

---

## Pentru reluare dupa pauza

1. Deschide acest fisier (`STATUS.md`) — contine tot contextul.
2. Ruleaza pasul 10 de mai sus (`npm run dist`).
3. Dupa build, testeaza fluxul complet pe installer-ul generat.
4. Daca totul OK: commit + tag `v1.0.0`.

---

## Update 2026-04-16 — RNPM form parity cu site-ul oficial

Sursa: PDF "Cautarea si vizualizarea informatiilor inscrise in RNPM" + capturi Network tab.

### Aliniat la spec
- **Categorii** denumite exact ca pe RNPM (Aviz de ipoteca mobiliara / Fiducie / Aviz specific / Aviz de ipoteca - creante securitizate / Aviz de ipoteca - obligatiuni ipotecare).
- **Tipul avizului** — dropdown per categorie cu listele exacte (18 ipoteci, 7 specifice, 7 fiducii); SI/SAU pe operator.
- **Destinatia inscrierii** — dropdown la specifice (14 valori) si la ipoteca (10 valori); SI/SAU pe operator.
- **Default checkboxes**: `Numai active` + `Nemodificate de alte inscrieri` bifate implicit (cf. spec).
- **SI/SAU pe toate campurile SiSau**: CUI, CNP, RegCom, Prenume, Serie sasiu, Serie motor, Nr. inmatriculare — pe toate sectiunile (Debitor / Creditor / Constituitor / Fiduciar / Beneficiar / Parte / Vehicul / Reprezentant Creditor / DebitorJ / DebitorF).
- **Limita 1500 rezultate** — backend arunca eroare clara `RNPM a returnat N rezultate (limita 1500). Restrange criteriile de cautare.` cand totalul depaseste pragul.
- **Toggle PJ/PF unic per parte** — etichete "Persoana Juridica" / "Persoana Fizica"; alegerea schimba campurile (CUI vs CNP) intr-o singura sectiune.

### Structura per categorie
| Categorie | Sectiuni |
|---|---|
| Ipoteca mobiliara | Tip aviz, Destinatia inscrierii, Debitor (PJ/PF), Creditor (PJ/PF), Vehicul |
| Fiducie | Tip aviz, Constituitor (PJ/PF), Fiduciar (PJ), Beneficiar (PJ/PF), Vehicul |
| Aviz specific | Tip aviz, Destinatia inscrierii, Parte (PJ/PF), Bun (descriere) |
| Creante securitizate | Reprezentant Creditor (PJ), Debitor (PJ/PF), Bun (descriere) |
| Obligatiuni ipotecare | (lipsa — vezi "Ramas de facut") |

### Mapping API confirmat (din capturi Network)
- Creante: `reprezentantCreditor: { denumire, regCom, CUI }`, `debitorJ: { denumire, RegCom, CUI }`, `debitorF: { nume, prenume, CNP }`, `creante: { descriere }`.
- Note: cheia `regCom` la creditor e camelCase, `RegCom` la debitor e PascalCase — inconsistenta API-ului RNPM, respectata.

### Persistenta detalii (fara modificari)
- `RnpmBun.referinte: RnpmBunPartyRef[]` — bunurile au referinte tert/constituitor afisate ca badge-uri colorate in modal.
- Coloana `referinte_json` in `rnpm_bunuri` (migratie idempotenta in `db/schema.ts`).

---

## Ramas de facut (RNPM)

### Prioritar
1. **Obligatiuni ipotecare** — payload-uri Network tab nepreluate inca. Necesare: Agent PJ + Agent PF + Emitent PJ + Bun (descriere). Spec: `agentJ`/`agentF`/`emitent`/`obligatiuni` — *necesita confirmare prin captura Network*.
2. **Tert cedat** la ipoteca (PJ/PF) — sectiune separata in formular; cheile API necunoscute.
3. **Bun mobil atasat unui bun imobil** (la ipoteca) — Categorie + Identificare; cheile API necunoscute.
4. **Bun "Alt tip"** la fiducie — Categorie; cheia API necunoscuta.
5. **Bun imobil** la fiducie — Localitate, Judet, Tara, Nr CF, Nr cadastral, Adresa; cheile API necunoscute.

### Validari input (din "Mentiuni esentiale" RNPM)
6. ~~**Strip diacritice** automat la submit~~ — DONE (backend `stripDiacriticsDeep` pe `/search` + `/bulk` params; vezi update 2026-04-16 sesiunea 3).
7. ~~**CUI: numai cifre** — validare client-side (warn)~~ — DONE (walk pe params construit + `window.confirm`).
8. **Identificator / Reg.Com / CUI / CNP / Serie sasiu/motor / Nr inmatriculare** — exact match (informativ in UI: tooltip / placeholder).
9. **Pseudo-categorie "Inscriere veche"** pentru bunuri "Alte tipuri" pre-2014-06-16 — recomandare in UI sa se ruleze si pe aceasta cand cauta dupa bun "Alte tipuri".

### Convertire payload-uri necunoscute -> cunoscute
Pentru fiecare element 1-5 de mai sus se colecteaza payload-ul printr-o cautare reala pe RNPM si se confirma cheile JSON inainte de a adauga in `RnpmSearchParams`.

---

## Update 2026-04-16 (sesiunea 2) — Hardening audit findings

Dupa audit-readiness + CLAUDE.md conventions audit, aplicate urmatoarele fix-uri (niciunul nu schimba functionalitatea, toate sunt defense-in-depth):

### Backend (`backend/src/`)
- **Body size limits** pe toate POST `/api/rnpm/*` via `hono/body-limit` (F-1):
  - `/search` 64KB · `/bulk` 512KB · `/saved/export` 64KB · `/captcha/balance` 4KB → 413 "Payload prea mare"
- **SSE timeout 10 min** pe `/bulk` (F-2) — `setTimeout(() => controller.abort(), 600000)` curatat pe finally.
- **Max field depth/length** (W-1) — validator `validateParamsDepth` walk recursiv (max depth 4, max 500 chars/string) aplicat la `/search` + `/bulk`.
- **RnpmClient singleton** (CP-B5) — `defaultRnpmClient` exportat; `executeSearch` / `executeBulkSearch` / `/bulk` route folosesc instanta partajata (RnpmClient e stateless, nu tine user data).

### Frontend (`frontend/src/`)
- **CP-E1 unmount cleanup** in `RnpmBulkSearch.tsx` — `useEffect(() => () => { abortCtl?.abort(); }, [abortCtl])` previne waste 2Captcha daca userul paraseste tab-ul in timpul unui bulk.
- **CQ-6 SSE reader release** in `lib/rnpmApi.ts` — wrap while-loop in try/finally cu `reader.cancel()` pentru a elibera stream-ul pe abort/error abrupt.

### Electron (`electron/main.js`)
- **W-2** `ALLOWED_EXTERNAL_DOMAINS` extins cu `mj.rnpm.ro` si `www.rnpm.ro` pentru cazul in care se foloseste `shell.openExternal` spre RNPM.

### Onboarding
- **CQ-8** creat `backend/.env.example` cu lista completa variabile (ANTHROPIC/OPENAI/GOOGLE_AI, HOST, LEGAL_DASHBOARD_DB_PATH, NODE_ENV) + nota ca 2Captcha key se introduce in UI (Setari AI), nu prin env.

### CP-15 — refactor `RnpmSearchForm`
- Custom hooks noi in-file: `useText`, `useSiSauField`, `usePJField`, `usePFField` — colapseaza cele 40+ `useState` individuale in 10 apeluri de hook + 11 `useState` native la nivel de component.
- Sub-componente noi: `PJBlock`, `PFBlock`, `PartyFieldset`, `VehiculFieldset`, `DestinatieSelect` — elimina 7 duplicari JSX ale pattern-ului PJ/PF.
- Logica de submit pastrata *exact* (parity testata manual pe toate ramurile): particularitatile per-categorie sunt comentate inline (ex: `Ipoteci PF: declanseaza pe nume SAU CNP`, `Creante PF: si pe prenume`, `CreditorPF: fara prenume`).
- Rezultat: 613 → 651 linii (un pic mai mult din cauza abstractiilor + tipurilor), dar `useState` direct in component: **40+ → 11**. Typecheck curat.

---

## Update 2026-04-16 (sesiunea 4) — Audit remediation completa

Toate cele 12 findings din auditul in-depth Legal Dashboard (`AUDIT-LEGAL-DASHBOARD.md`, eliminat dupa remediere) aplicate in 3 runde. Detalii complete in `CHANGELOG.md` la sectiunea omonima.

### Round Next — fluxuri critice (P1)
- **F2** load-more multi-institutie (`URLSearchParams.append` + `c.req.queries`).
- **F3** abort propagat la backend (signal in `batchFetchDosare`/`subdivideInterval`, listener pe `c.req.raw.signal`, single-timer abort).
- **F4** boot Electron cu deadline + `dialog.showErrorBox` la esec backend.

### Round 2 — state, erori, metrici, versiuni (P2/P3)
- **F5** `setState` functional in toate callbackurile load-more.
- **F7** mesaj backend propagat in `lib/api.ts` (parse o singura data, fara dublu-throw).
- **F11** `totalInstitutii` corect (Object.keys.length); `viitor`/`trecut`/`azi` aliniat la `filterByMetrics()` cu `setHours(0,0,0,0)`.
- **F12** versiune unificata: `package.json` root → `1.4.4-ai`, frontend/backend renamed; `__APP_VERSION__` injectat din vite.config.ts ca single source of truth.

### Round 3 — performance, theming, a11y, tests (P2)
- **F8** code-split: `Changelog`/`Manual`/`MetricsPanel`/`TermeneMetrics` lazy + `manualChunks` named (charts/xlsx/pdf). Bundle main 306 kB (gzip 83 kB).
- **F10** `frontend/src/lib/chart-colors.ts` — `CATEGORY_COLORS` + `CHART_FILLS` partajate intre `MetricsPanel` si `TermeneMetrics`.
- **F6** `frontend/src/hooks/useDialog.ts` (Escape close + scroll lock + focus capture/restore) wired in toate dialogurile (Changelog, Manual, API key, InstitutieSelect); `role="dialog"`/`aria-modal`/`aria-labelledby` peste tot; `useId()` pentru pairing `htmlFor`/`id` pe SearchForm.
- **F9** vitest in backend (`npm test`, script nou); `intervals.test.ts` (12) + `soap.test.ts` (12) → **24/24 verde**. `extractFirst`/`extractAll`/`parseDosar`/`toLegacyDiacritics` exportate pentru testabilitate.

### Verificare finala
- `frontend && npx tsc --noEmit` curat.
- `frontend && npm run build` OK (warning preexistent `import.meta` neschimbat).
- `backend && npm test` 24/24 verde, 256ms.

---

## Update 2026-04-16 (sesiunea 3) — Normalizare text RNPM (scope strict RNPM)

Sursa: spec RNPM "Mentiuni esentiale" + obs user ("Cautarea nu tine cont de Uppercase"). **Scope lock:** modificarile afecteaza EXCLUSIV fluxurile RNPM (`/api/rnpm/*`, tab "Cautare RNPM", baza locala RNPM). Cautarea Dosare + Termene PortalJust ramane *neatinsa* — foloseste SOAP separat, fara DB locala partajata.

### Noua utilitate
- `backend/src/util/textNormalize.ts` — `stripDiacritics(s)` (NFD + drop U+0300..036F) + `stripDiacriticsDeep<T>(value)` walker recursiv pentru params objects. Doar doua exporturi, zero abstractii.

### Backend
- **Strip diacritice pe params RNPM** (`backend/src/services/rnpmSearchService.ts::executeSearch`):
  - `stripDiacriticsDeep(restParams)` aplicat *doar* pe payload-ul trimis la `client.search(...)`. `input.params` ramane neatins, deci `rnpm_searches.params_json` stocheaza exact textul original tastat de user ("Ștefan" raspunde "Ștefan" in istoric, nu "Stefan").
  - Atat `/search` cat si `/bulk` trec prin `executeSearch` → comportament simetric automat.
  - Rezultatul: RNPM primeste mereu "Stefan", "Dragoslav", etc. Fara diacritice — cf. nota oficiala "aplicatia nu gaseste nimic cu diacritice".
  - `captchaKey` / `type` / `gcode` / `searchId` nu sunt atinse.
- **Filtru local diacritic-insensibil** (`backend/src/db/schema.ts` + `backend/src/db/avizRepository.ts`):
  - Inregistrat SQLite scalar function `rnpm_norm(x) = lower(stripDiacritics(x))` prin `db.function()` — per-connection, `deterministic: true`.
  - `getAvize()` searchText rescris: `rnpm_norm(col) LIKE ? ESCAPE '\'` pe 9 coloane (identificator, tip, utilizator_autorizat, creditor denumire/cod/cnp, debitor denumire/cod/cnp). JS normalizeaza parametrul o singura data (`stripDiacritics(q).toLowerCase()`) si escape-uieste `%` / `_` / `\` pentru a fi tratate literal (pattern `replace(/[\\%_]/g, "\\$&")`).
  - Rezultat: user tasteaza "stefan" → gaseste salvat "Ștefan", "STEFAN", "stefan". User tasteaza "a%b" → gaseste DOAR literal "a%b", nu orice string care contine "a". Fara migratii, fara reindex.

### Frontend
- **CUI numeric warning** (`frontend/src/components/rnpm/RnpmSearchForm.tsx`):
  - Helper `findNonNumericCui(obj)` walk pe params-ul *construit* (dupa filtrul per-activeType, deci nu valideaza CUI-uri din tab-uri inactive).
  - Daca gaseste `CUI.value` cu `/\D/`, `window.confirm("Atentie: CUI "X" contine caractere non-numerice. Continui cautarea?")` — non-blocking, user alege.

### Scope isolation — de ce nu afecteaza Dosare / Termene
- `backend/src/db/schema.ts::getDb()` e folosit DOAR de `avizRepository.ts` si `searchRepository.ts` (ambele RNPM).
- `stripDiacriticsDeep` importat DOAR in `services/rnpmSearchService.ts` (RNPM-only).
- PortalJust cautari (Dosare / Termene) nu trec prin SQLite locala, nu trec prin `/api/rnpm/*`.
- Verificare tipuri: frontend `npx tsc --noEmit` → clean.
- Smoke tests:
  - `SELECT rnpm_norm('Ștefan')` → `'stefan'`.
  - `stripDiacriticsDeep({denumire:{value:'Ștefan'}})` → strip pe .value, structura preservata.
  - `executeSearch` round-trip: `input.params` keeps "Ștefan", RNPM payload gets "Stefan". `params_json` persistence unchanged.
  - LIKE escape: seed "A%B" / "a_z" / "Ștefan" / "abc123" → search "%" gaseste doar "A%B"; "_" gaseste doar "a_z"; "stefan" gaseste "Ștefan"; "abc" gaseste "abc123".

---

## Update 2026-04-17 — Stop abort chain + categoria 5 (obligatiuni) + filtre baza locala

Detalii complete in `CHANGELOG.md` sectiunea "17 Aprilie 2026 — Butonul Stop RNPM ..." + "17 Aprilie 2026 — Categorie noua, filtru data ...". Sinteza:

### Stop RNPM cap-coada
Abort chain corect propagat UI → fetch → ruta Hono → service → solver captcha + fetch-uri RNPM + detalii. Fix final: butonul **Stop** morfa `type="button"` → `type="submit"` intre click si commit (React 18 DOM node reuse) → browser auto-submita form-ul. Rezolvat cu `key` distincte pe cele doua butoane (unmount + mount). Validat manual in Electron: click Stop revine imediat la "Cauta", fara avize partiale persistate.

### Categoria 5 — Obligatiuni ipotecare (end-to-end)
PLAN.md mentioneaza categoria la endpoint + schema, dar stub-ul `RnpmSearchParams` omite cheile specifice. Adaugate: `agentPJ` / `agentPF` / `emitent` (PJ) / `bunGarantie.descriere` — confirmate prin captura Network pe site-ul oficial. Form-ul are `PartyFieldset` Agent (PJ/PF) + `PJBlock` Emitent + Input descriere; dropdown **Tipul avizului** cu 9 valori identice cu "creante". Disponibila in tab-urile Cautare, Bulk, Baza locala.

### Baza locala — filtre + integritate
- `rnpm_avize` filtru `dataStart`/`dataStop` pe interval (data stocata "dd.mm.yyyy" → convertita in ISO in SQL via `substr()`).
- `rnpm_bunuri.referinte_json` — migrare idempotenta (`PRAGMA table_info` + `ALTER TABLE`). Stocheaza `JSON.stringify(referinte)` array de `BunPartyRef` (constituitor / tert) per bun. Deblocheaza `BunRefRow` in DetailModal cu culori distincte (sky / amber).
- `deleteAllAvize` tranzactional: sterge `rnpm_avize` (CASCADE pe copii) + `rnpm_searches` explicit (search_id e ON DELETE SET NULL, nu CASCADE).
- `getAvizeByIds` bulk fetch pentru export PDF/Excel (max 500 id-uri, aliniat cu `EXPORT_BODY_LIMIT` 64KB).

### Rafinari UI (non-abort)
- `RnpmDetailModal` — 5 tab-uri navigabile (General/Creditori/Debitori/Bunuri/Istoric), count badge per tab, smooth scroll la tab-switch.
- `RnpmSavedData` — filtre data range + reset + confirm dubla la "Sterge tot".
- `RnpmBulkSearch` — icon per phase (Loader2 → CheckCircle2/XCircle), estimare durata/cost, hard limit `MAX_BATCH=100`.

### Verificare
- `npx tsc --noEmit` (frontend + backend) — clean.
- `npx vitest run` — **24/24 verde**.
- Reproducere manuala in Electron: Stop / obligatiuni search / filtru data / Sterge tot — toate comportamente OK.

### Ramas pentru urmatoarea sesiune
- **Verificat comportamentul cautare dupa aviz**: user a semnalat ca trebuie confirmat daca la cautarea dupa **identificatorul unui aviz** rezultatele includ si **avizele de modificare** corespunzatoare (identificator nou, referinta catre cel initial). Comportament potential de completat dupa verificare manuala + captura Network pe site-ul oficial RNPM.

---

## Update 2026-04-18 — Performanta RNPM + backup zilnic + dialog confirmare stilizat

Detalii complete in `CHANGELOG.md` sectiunea "18 Aprilie 2026 — Mini-lag RNPM rezolvat + backup zilnic + dialog confirmare stilizat". Sinteza:

### Performanta — tab-enter instant + click pe aviz instant
- **A. Keep-mounted RnpmSavedData**: conditional render → `hidden` class, elimina unmount/remount la tab switch (state + scroll persist).
- **D. Cache in-memory aviz detail** (`avizDetailCache`, TTL 60s): elimina round-trip + 5 query-uri repository la re-deschidere. Invalidat la delete (single / batch / all).
- **E. Prewarm SQLite page cache la bootstrap**: `getAvize({limit:1}) + getAvizStats()` dupa `serve(...)` — prima interactiune nu mai plateste cold-start.

### Backup zilnic automat (reziliente date cu mii de avize)
- `backend/src/db/backup.ts` — `runDailyBackup()` via `better-sqlite3` online backup API, WAL-safe, fara checkpoint.
- `<userData>/backups/legal-dashboard.YYYY-MM-DD.db` — skip `<24h`, rotatie la 7 fisiere (lexicografic = cronologic gratie ISO in nume).
- Endpoints noi: `POST /api/rnpm/open-backups-folder`, `DELETE /api/rnpm/backups` (returneaza `{deleted}`).

### Dialog de confirmare stilizat (inlocuieste `window.confirm()`)
- `frontend/src/components/ui/confirm-dialog.tsx` — `ConfirmProvider` + `useConfirm()` hook Promise-based; `AlertTriangle` pentru destructive; Esc/Enter; click-outside.
- 4 call-site-uri migrate: sterge aviz / batch / all + warning CUI invalid.

### "Info baza locala" — management backups + relabel
- Butoane noi: **Folder baza** (relabel din "Deschide folder"), **Backups** (open folder), **Sterge back-up** (delete all backups), **Sterge baza** (relabel din "Sterge tot", delete toate avizele). Ultimele doua grupate impreuna spre dreapta.

### Fix UI conex — DosareTable timeline sedinte
Efect secundar al font-scale bump din commit `dd05b05`: data taiata + cerc-marker nealiniat. Ajustat `w-[60px]→w-[80px]`, `left-[72px]→left-[92px]`, `mt-1→mt-1.5`.

### Verificare
- `npx tsc --noEmit` (frontend + backend) — clean.
- Build reproductibil (`node scripts/build.js`), backend bundle 1.7mb.
- Manual in Electron: log `[backup] saved legal-dashboard.2026-04-18.db` prezent la bootstrap; fisierul exista in `%APPDATA%/legal-dashboard/backups/`; tab-switch si click aviz instant; confirmarile folosesc dialog stilizat.
