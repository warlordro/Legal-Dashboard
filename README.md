# Legal Dashboard

Desktop app (Electron) cu arhitectura web-ready pentru cautarea rapida a
dosarelor in portalul instantelor, interogarea Registrului National de
Publicitate Mobiliara (RNPM) si monitorizarea automata a dosarelor prin
PortalJust SOAP. Include un modul de analiza AI multi-agent (Claude, OpenAI,
Gemini) cu stocarea cheilor in keystore-ul sistemului de operare prin Electron
`safeStorage`.

Versiune curenta: **2.20.0**. Vezi [CHANGELOG.md](CHANGELOG.md) pentru istoric
si [SECURITY.md](SECURITY.md) pentru threat model.

Ultimul release **v2.20.0** - observability pentru cap-ul RNPM de 1500 rezultate. Banner-ul
pentru cautari rulate in mod split distinge acum **trei cauze de gap** in loc de generic
`respins (X > limita)`: `terminal_cap` (sub-tip > 1500 fara axa de split), `silent_refusal`
(RNPM raspunde cu `total > 0` dar `documents: []` — rate-limit upstream / captcha invalid)
si `residual_unclassified` (records istorice fara destinatie atribuita ramase dupa tier-2).
In paralel scriem un audit event `rnpm.cap_hit` la fiecare cautare split cu gap > 0
(detalii: `type`, `criteriu`, `upstreamTotal`, `recovered`, `gap`, `gapByReason`,
`blockedLabels`), util pentru analiza retroactiva a frecventei celor trei cauze pe productie.
Status-ul intern `rejected` a fost redenumit `blocked`, mai semantic clar.
**823 teste backend, 92 teste frontend**.

Predecesor **v2.19.2** - bugfix highlight Cautare dosare: tokenii scurti din numele cautat
(`DE`) erau evidentiati ca prefix in cuvintele mai lungi (`DEMOLARI`), lasand restul cuvantului
fara highlight. Fix: alternation sortata dupa lungime descrescator si delimitatori Unicode-aware
(recunosc litere romanesti precum `Ă`, `Î`, `Ș`, `Ț`) — un cuvant cautat se evidentiaza acum
doar cand apare ca cuvant intreg.

Predecesor **v2.19.1** - patch hardening + UX polish post v2.19.0. Trei bug-uri
descoperite la rulare empirica imediat dupa v2.19.0. Frontend `lib/rnpmApi.ts`:
`jsonOrThrow` accepta acum envelope-ul v2.14.0 `{ data, error: { code, message },
requestId }` (pana acum extragea doar `data.error` ca string, ceea ce pe envelope-ul
nou producea `Error([object Object])` in modalul "Info baza locala"). Backend
`index.ts`: auto-promote `local` -> `admin` in desktop mode la boot, idempotent.
Frontend `pages/RnpmSearch.tsx`: stop button apare cand auto-loading e declansat
din tabelul de paginare. **822 teste backend, 86 teste frontend**.

Predecesor **v2.19.0** - RNPM tier-2 split pe `destinatieInscriere`. Extinde v2.18.0
(split tier-1 pe `tipInscriere`) cu un al doilea nivel cand un sub-tip individual
depaseste tot capul de 1500. Caz empiric care a motivat feature-ul: pe `specifice` cu CUI
33317138, sub-tipul `aviz initial` SINGUR avea 1823 records, iar v2.18.0 recupera doar 3
documente. v2.19.0 declanseaza tier-2 pe destinatii enumerable (`specifice` 14 valori,
`ipoteci` 10 valori), recuperand records pe destinatie individuala. Recuperarea e
**best-effort**: records fara destinatie atribuita raman neacoperite si gap-ul
(`tier1SubTotal - SUM(tier2 subTotals)`) e disclose-uit explicit in UI. Backend nou:
`services/rnpmDestinations.ts`, `executeNestedDestinationSplit` privata in
`rnpmSearchService.ts`, `SplitSubResult` extins cu `status: "recovered" | "partial"` +
`nested?` + `gap?`, `SSE_SPLIT_TIMEOUT_MS` 30 -> **45 min**.

Predecesor **v2.18.0** - RNPM auto-split la depasire limita 1500 inregistrari.
Cand o cautare RNPM intoarce peste capul oficial de 1500 (ex: debitor PJ cu CUI cu
multe ipoteci active), in loc de eroare opaca `limita 1500` aplicatia afiseaza un
dialog de confirmare cu costul estimat si ETA, iar la accept ruleaza secvential cate
o cautare per `tipInscriere` din `TIP_AVIZ_BY_CATEGORY[type]`. Rezultatele se agrega
intr-un singur entry de istoric (parent search row reutilizat via `existingSearchId`).
Fail-clean: sub-tipurile care depasesc tot capul sunt marcate `respins` si rularea
continua. Backend nou: `RnpmError` cu `code: "limit_exceeded"`, `executeSplitSearch`,
ruta `POST /api/v1/rnpm/search-split` (SSE). Frontend: `RnpmLimitExceededError`,
`rnpmSplitSearch` SSE consumer, `RnpmSplitDialog` modal de confirmare, banner amber
peste tabela rezultate cu sub-tipurile respinse.

Predecesor **v2.17.0** - Multi-review hardening peste v2.16.1, 28 findings absorbite
din `/full-review` (P1 critical -> P5 nice-to-have). Atomicitate audit + mutation pe
PATCH alerts (`db.transaction` wrap pe `/seen` / `/unseen` / `/dismissed`), audit nou
`monitoring.alert.emitted` la insert real, `hasPendingSchemaMigrations` rescris fail-closed,
`preMigrationBackup` extins WAL/SHM sidecars, `busy_timeout=5000` pragma, `unhandledRejection`
handler, SMTP partial-config probe la boot, partial-success multi-institutie in
`nameSoapRunner` (esec single tribunal nu mai esueaza tot job-ul), `mailer.ts` `KIND_LABELS`
tipizat `Record<AlertKind>` + entry `termen_dupa_solutie` lipsa adaugata (bug real fix -
subiectul email-ului per alerta randa acum `Termen nou dupa solutie` in loc de text raw),
toast romanesc la `markSeen` failure (preserva fire-and-forget). **819 teste backend**
(+8: 4 drift detector kind/severity/jobKind backend<->frontend, 2 audit row scris/nu scris,
2 partial-success multi-institutie), **86 teste frontend**.

Predecesor **v2.16.1** - Multi-review remediation post v2.16.0, hardening intern fara
schimbari de contract HTTP / shape UI / DDL: single source of truth pentru `ALERT_KINDS`
/ `ALERT_SEVERITIES` / `ALERT_JOB_KINDS`, `selectAlertIdsByFilters` ORDER BY DESC pentru
determinism la cap 10k, `markAlertUnseen` wrap in `db.transaction(...)`,
`dismissAlertsByIds` COUNT optimization, pre-migration backup **generic** in `db/schema.ts`.
**811 teste backend**, **86 teste frontend**.

Predecesor **v2.16.0** - UX polish post v2.15.0: KPI Monitorizare `Joburi active` →
`Monitorizari active`, butonul Dosare marcheaza alerta ca citita fire-and-forget,
toggle Citit/Necitit pe buton (`alertsApi.markUnseen` + ruta `PATCH /:id/unseen` cu
audit `alert_unseen`), titlul `termen_dupa_solutie` umanizat (`04.05.2026 → 19.05.2026`
in loc de `2026-05-04T00:00:00`), detail dedicat in `lib/alert-context.tsx`.

Predecesor **v2.15.0** - Fix duplicare alerte amanare. Cand PortalJust publica o
solutie SI programeaza un termen nou pentru acelasi complet, inboxul emitea doua
alerte separate; v2.15.0 introduce kind-ul nou `termen_dupa_solutie` care le
contopeste intr-una singura cu detail combinat. Diff engine `dosarSoap.ts` cu Pass 1
(defer) → Pass 2 (merge cu bucket `(stadiu, complet)`) → Pass 3 (emit pending
standalone); migration `0016_termen_dupa_solutie_kind` rebuild CHECK enum.

Predecesor **v2.14.1** - SOAP timeout PortalJust 45s → 60s (`SOAP_TIMEOUT_MS = 60000`).
Driver: pattern empiric BCR (~1000 dosare, ~50% rata de esec, toate la fix 45000ms
duration cu "operation was aborted due to timeout", rusitele aterizau la 40-44s).

Predecesor **v2.14.0** - Bulk dismiss alerte (`POST /api/v1/alerts/dismiss-bulk` cu
Zod `discriminatedUnion("mode", [ids|filters])`, cap 10k randuri, butoane "Inchide
selectia" / "Inchide toate" cu confirmation modal in toolbar Alerte) + fix root cause
"Eroare necunoscuta" — `middleware/rate-limit.ts` 503/429 emit acum envelope-ul
standard `{ data, error: { code, message }, requestId }`.

Predecesor **v2.13.1** - UX polish post-export — `HIDDEN_KIND_FILTERS` ascunde 4
kind-uri inerte din dropdown-ul Alerte; `getPortalJustUrl` strip `/aN` suffix; PDF
hyperlinks pe coloana Numar Dosar in Dosare/Termene/Monitorizare; Monitorizare export
pagineaza prin toate paginile cand nu exista selectie.

Predecesor **v2.13.0** - Export alerte (Excel/PDF, cap 10k, mod ids/filters/range) +
raport zilnic email (`POST /api/v1/me/email-settings` field nou `dailyReportEnabled`,
scheduler ruleaza la 09:00 local default, dedup via `last_daily_report_sent_for`,
migration `0015_daily_report_settings`).

Predecesor **v2.12.1** - UX bulk import + nume lungi PortalJust peste v2.12.0.
Patch care raspunde la trei probleme operationale ridicate de utilizator pe import-ul
bulk de monitorizare: (1) limita statica de 300 randuri vizibile inlocuita cu paginare
server-style 100/pagina + coloana "Actiune" cu Exclude/Include per rand + checkbox
"Exclude warn-urile automat"; (2) mesaje de validare humanizate cu motiv si actiune
recomandata, regula noua `nume_lung` (warn) la >100 chars sau >12 cuvinte calibrata
empiric pe limita PortalJust, legenda colapsabila statusuri + nota dedup automat;
(3) alerta `source_error` enrich cu `probable_cause: nume_prea_lung_pentru_portaljust`
cand un job `name_soap` esueaza repetat pe nume care depasesc limitele PortalJust
(titlul devine "Nume prea lung pentru PortalJust", detail JSON include nameNormalized
si length/wordCount). Fara migrari, fara schimbari de schema sau contract HTTP/IPC.

Predecesor v2.12.0 - MIN-VIABLE seam refactors peste v2.11.0.
Sweep care absoarbe sectiunea "MIN-VIABLE seams" din `DEEP-REVIEW-LEGAL-DASHBOARD-2026-05-04.md`
plus un fix de paginare la dashboard timeline. Patru cuturi mici cu boundary
clar, fara migrari, fara schimbari de API observabile: (1) `services/alerts/alertEventService.ts`
care imparte persistenta de fanout (email pe `queueMicrotask` doar la insert real);
(2) `services/monitoring/commands/createMonitoringJob.ts` framework-free cu
outcome union; (3) `frontend/src/hooks/useMonitoringJobs.ts` cu abort controller +
debounce + page-empty recovery; (4) `electron/notifications.js` (capability
detection + tag dedup) cu `electron/main.js` redus 727 → 533 linii. Bug fix
`/dashboard/timeline`: per-source `LIMIT n` pierdea un eveniment cand cursor-ul
composite cadea pe boundary; fix = `+1` overfetch pe inclusive cursor. Tests:
744/744 backend, 73/73 frontend.

Predecesor **v2.11.0** - deep-review remediation peste v2.10.8.
Absoarbe `DEEP-REVIEW-LEGAL-DASHBOARD-2026-05-04.md` (PR A operational + PR
Web-Readiness Closure) cu exceptia trecerii frontend `xlsx` → `exceljs` (deferata
ca scope separat). Securitate: directorul `backend/rnpm-dumps/` cu PII real
(CUI, denumire, identificator) a fost adaugat in `.gitignore` ca sa nu mai poata
fi commit-at accidental; `nodemailer` `^6.9.13` → `^7.0.13` (HIGH DoS
GHSA-rcmh-qjqh-p98v / CVSS 7.5 patched 7.0.11+); `@anthropic-ai/sdk` `^0.90.0`
→ `^0.92.0` (moderate file-perms GHSA-p7fg-763f-g4gf). Backend: `routes/rnpm.ts`
propaga `ownerId = getOwnerId(c)` end-to-end (search/bulk + dedup
`inflightKey(ownerId, ...)` ); `requireRole("admin")` aplicat pe rutele globale
RNPM (`DELETE /saved/all`, `POST /compact`, `DELETE/GET/POST /backups{,/restore}`,
`POST /open-{db,backups}-folder`); `POST /search`/`/bulk`/`/captcha/balance`
returneaza 501 in `AUTH_MODE=web` (RNPM necesita per-user key storage
server-side, neimplementat). Build: `scripts/build-server.js` rebrand
`portaljust` → `legal-dashboard`. Tests: 728/728 backend (+7 contract noi pe
admin guard + web-mode 501), 73/73 frontend.

Predecesor **v2.10.8** - patch CI-only peste v2.10.7. Workflow-urile
GitHub Actions (`build-windows.yml` si `build-mac.yml`) ruleaza acum
`tsc --noEmit` + `vitest run` pentru backend si frontend **inainte** de
packaging — pe Windows ordinea conteaza pentru ABI-ul `better-sqlite3` (testele
ruleaza cu ABI Node, inainte de `rebuild:electron` care flips la ABI Electron).
`actions/upload-artifact` foloseste pattern-ul
`legal-dashboard-{platform}-${{ github.ref_name }}-run${{ github.run_id }}` ca
sa pastreze artefactele istorice cand acelasi tag este re-rulat. Backlog-ul
"GitHub Actions packaging hardening" este inchis si scos din docs.

Predecesor **v2.10.7** - patch UX Monitorizare peste v2.10.6.
Titlul tabelului `Joburi active` afiseaza totalul real din raspunsul
paginat (`total`, de exemplu 616), nu doar randurile incarcate pe pagina curenta
(`jobs.length`, de exemplu 100). Tooltip-urile Excel/PDF spun explicit ca
exportul fara selectie acopera joburile vizibile pe pagina.

Predecesor **v2.10.6** - patch hardening peste v2.10.5, fara
comportament nou. Absoarbe in totalitate findings-urile review-ului
(`useDebouncedValue` rescris cu callback `flush`, `JobKindTabs` cu navigatie
tastatura conform WAI-ARIA — ArrowLeft/Right, Home/End, roving tabindex,
helper `escapeLikeMeta` extras si folosit in `auditRepository` +
`userRepository`, JSDoc `@example` pe pairing `ESCAPE '\\'`). Sterge script-ul
tactic `seed-test-alerts.cjs` si scoate Task A din backlog (editare job
monitorizare). 721/721 backend + 73/73 frontend.

Istoric anterior:
**v2.10.5** - patch UX Dashboard + Alerte: KPI-ul `Joburi active` devine
`Monitorizari active`, sublinia tehnica devine `X Dosare, Y Nume`, iar pagina
`Alerte` primeste tab-bar `Toate / Dosare / Nume` si cautare debounced dupa
targetul jobului (`numar_dosar` / `name_normalized`). Backend-ul expune
`GET /api/v1/alerts?jobKind=...&q=...`, cu match fara diacritice si total
paginat corect prin acelasi JOIN.
**v2.10.2** - patch UX peste v2.10.1 (frontend-only, zero backend): coloana
Detalii din tabelul Monitorizare se afiseaza doar cand cel putin un job are
continut de aratat (name_soap cu scope restrans pe instante); panourile
Analiza AI din Cautare Dosare sunt inlocuite cu un banner discret cand nicio
cheie API (Anthropic / OpenAI / Google) nu este configurata, iar la salvarea
primei chei panourile reapar automat. Predecesor **v2.10.1** - PR-11 review
hardening (14 fixes + a11y): SMTP timeouts explicite, per-owner cooldown 60s
pe `/email-settings/test`, transport cache prin Promise (anti race-condition),
SMTP_PORT validation, BCC-uri si HTML escape complet pe payload-ul email-ului
de alerta. Predecesor **v2.10.0** - PR-11 Email notifiers: alertele de
monitorizare pot fi trimise si prin SMTP, pe langa inbox-ul `/alerte`,
badge-ul rosu, SSE si notificarile native. Canalul email este optional,
default OFF, configurat prin `SMTP_*` in `backend/.env` si izolat de
insert-ul alertei: daca SMTP lipseste sau trimite eroare, alerta ramane in
aplicatie. Predecesor **v2.9.2** - patch notificari
native: alertele de monitorizare raman in inbox-ul aplicatiei si in badge-ul
rosu, iar canalul Windows/macOS are status citibil din Electron, buton de test
in dialogul de configurare si gating defensiv cand sistemul de operare raporteaza
ca toast-urile sunt blocate. Predecesor **v2.9.1** - patch UX post-feedback:
eliminata
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
REFUZA pornirea fara ack `LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet` plus
middleware nou `originGuard` pe `/api/*` blocheaza state-change cu Origin
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
de joburi `dosar_soap` afiseaza numarul ca link extern catre `portal.just.ro` plus
buton mic Search care declanseaza auto-search in lista Dosare,
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
| `npm run dist:mac` | Build + `electron-builder` pentru macOS DMG (x64 + arm64; normal ruleaza pe runner macOS) |
| `npm run dist:server` | Genereaza ZIP server deployabil pentru bare-metal / Docker context |
| `npm test --workspace=backend` | Ruleaza vitest pe backend (823 teste in v2.20.0) |
| `cd frontend && npm test -- --run` | Ruleaza vitest pe frontend (86 teste dupa v2.14.0) |
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

`npm run dist:server` genereaza `server-release/legal-dashboard-server-<version>.zip`.
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

Notificarile email sunt optionale. Pentru a activa canalul SMTP, completeaza
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` si optional
`SMTP_SECURE` in `backend/.env`, apoi activeaza destinatarul din dialogul de
configurare al aplicatiei. Fara aceste variabile, aplicatia porneste normal si
email-ul ramane dezactivat. In web mode, adresa de login este precompletata ca
destinatar propus; pe desktop (`local@desktop`) campul ramane manual.

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
