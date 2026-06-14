# Session Handoff

**Versiune curenta**: v2.38.0 (2026-06-14)

Document de context transfer intre sesiuni Claude. Pentru istoric versiuni detaliat
vezi [CHANGELOG.md](CHANGELOG.md). Aici tin doar reguli active de lucru,
operational kill switches, riscuri ramase si directii deschise pentru urmatorul agent.

## Kill switches operationale

| Variabila / mecanism | Effect cand activat | Cand folosesti |
|----------------------|---------------------|----------------|
| `SMTP_HOST/PORT/USER/PASS/FROM` lipsesc sau invalide | `isMailerConfigured()` ramane `false`; dispatcher-ul scurt-circuiteaza inainte de SELECT, panoul UI arata "SMTP off" | Default desktop / mod degraded controlat |
| `SMTP_SECURE=true\|false` | Forteaza TLS implicit/explicit; default = `port === 465` | Cand provider-ul SMTP cere STARTTLS pe 587 (`SMTP_SECURE=false`) sau implicit TLS pe 465 |
| `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` | Scheduler-ul nu mai claim-uieste tipurile listate; joburile raman in DB, alertele existente raman accesibile | Stop temporar pe sursa upstream cu probleme (PortalJust SOAP rate-limit) |
| `OPENROUTER_DISABLED=1` | `callOpenRouter` esueaza imediat si nu face fallback silent la native | Stop urgent daca OpenRouter are incident, billing risc sau policy drift |
| `OPENROUTER_MODEL_OVERRIDES=modelKey:provider/slug` | Suprascrie slug-uri OpenRouter fara rebuild backend | Cand OpenRouter redenumeste un model sau muta un provider |
| `RNPM_AUDIT_CAP_HIT_DISABLED=1` | `POST /api/v1/rnpm/search-split` sare INSERT-ul `rnpm.cap_hit` din `audit_log`; restul flow-ului (SSE, decision, captchasUsed) ruleaza neschimbat | Stop urgent daca tabela audit creste suspect sau introduce contention vizibil pe write |
| `RNPM_RUNTIME_VALIDATION_DISABLED=1` | Opt-out temporar pentru validarea runtime RNPM fail-closed; payload-urile invalide sunt acceptate doar cat timp flag-ul este setat | Foloseste doar ca rollback operational daca upstream-ul RNPM schimba schema in productie |
| `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` | Permite folosirea `X-Forwarded-For` doar cand peer-ul intra in CIDR-ul proxy-ului de incredere | Setat in deploy prin Docker network CIDR; lasa gol pe desktop |
| `LEGAL_DASHBOARD_FORCE_BOOT=1` | Permite reclaim fortat al instance lock-ului SQLite cand operatorul confirma manual ca procesul vechi nu mai ruleaza | Break-glass dupa crash/stale lock, cu audit `system.instance_lock.reclaim` |
| `RNPM_RESULTS_FILTER_DISABLED=1` | Ruta POST `/api/rnpm/search/:searchId/filter` raspunde 503 cu `code: "FILTER_DISABLED"`; UI ascunde inputul si arata banner | Stop urgent daca filtrul provoaca contention DB sau bug regresat |
| `LEGAL_DASHBOARD_ALLOW_REMOTE=1` (+ `AUTH_MODE=web` + JWT valid) | Backend-ul accepta bind non-loopback | Setup web/server, niciodata desktop |
| `TENANT_KEY_ENCRYPTION_SECRET` | Master key AES-256-GCM pentru `tenant_api_keys`; lipsa in web mode opreste boot-ul | Obligatoriu pentru web admin keys; pastreaza separat de backup-ul DB |
| Cooldown POST `/email-settings/test` (60s/owner) | Ruta returneaza 429 cu `Retry-After`; audit `me.email_settings.test outcome=denied reason=cooldown` | Limita built-in vs user click loop pe butonul "Trimite test" |
| `drainEmailDispatches(timeoutMs)` | Asteapta SMTP-urile in flight inainte sa inchida DB-ul; default 10s, shutdown 5s | Gracefull shutdown — invocat automat din `gracefulShutdown()` |
| `DAILY_REPORT_HOUR=9` | Schimba ora locala la care ruleaza scheduler-ul de raport zilnic | Cand 09:00 default e nepotrivit (ex. dev local sau alt fus orar operator) |

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
- Pentru web mode v2.30.0, cheile AI/captcha sunt ale tenantului si stau in
  `tenant_api_keys`; non-adminii nu trebuie sa poata trimite BYOK in body.
- **Promovarea la admin pe desktop ramane manuala**:
  `UPDATE users SET role='admin' WHERE id='local';` direct in SQLite. Workflow
  tehnic acceptat pentru desktop solo; cutover-ul web (daca se reia) ar expune
  un mecanism legat de Google Workspace SSO.

## Probleme/riscuri ramase

- `useCurrentUser` se apeleaza din mai multe locuri (Sidebar + AdminGate per
  pagina admin). Pe desktop call-ul este local si rapid; daca devine vizibil in
  load tests pe web mode, va fi lift-ed in context shared (sau cache-uit).
- Pe desktop quota este informativa/bypass. Enforce real ramane pentru web
  cutover viitor (daca se reia).
- PR-9 livreaza seam-ul de auth (desktop noop / web JWT validation, livrat in
  v2.7.0). Cutover-ul real web — Google Workspace SSO/OIDC, deploy server, TLS,
  backup S3-compatible — este reevaluabil separat (PR-10 GCS si PR-12 GDPR
  delete + hash-chain audit eliminate prin decizia #11 din
  `EXECUTION-ROADMAP.md`, 2026-05-03).
- Email canal SMTP (PR-11, v2.10.0) ramane optional; dispatcher scurt-circuiteaza
  cand `SMTP_*` lipsesc. Daily report email livrat in v2.13.0 + boot-time SMTP
  partial-config probe in v2.17.0 (warn la lipsa partiala in loc de silent
  runtime fail).
- `xlsx@0.18.5` nu mai este pe path-ul de parsare a inputului user (in v2.6.4
  `nameListParser.ts` a fost migrat la `exceljs@^4.4.0`). Ramane folosit doar
  ca dependinta tranzitiva pe path-ul write-only de export prin `xlsx-js-style`
  si in fixturile de test — fara expunere directa la fisiere uploadate.

## Sprint inchis 2026-05-20 - v2.34.0 web hardening

**Status**: livrat pe branch `feat/v2.34.0-web-hardening`.

**Scope**: inchide 4 P0 + 8 P1 din `audit/AUDIT-FINAL-FULL-PROJECT-v2.33.0-2026-05-19.md`. P0 acopera auth surface (Google OAuth2 device-code POST-only + RL `(ip, ua)`, admin guards intarite pe tenant-keys, blocare self-grant edits). P1 acopera SOAP retry budget, captcha balance per-tenant TTL, owner-scoped tenant key guard, body-key warning hardening, per-user captcha quota count-based cu rolling 24h/7d/30d si intent-recording, CI fixtures via `openssl rand`, offsite backup hook env-configurabil cu RUNBOOK.md (12 sectiuni).

**Solutie**: tot codul nou este gateuit pe `getAuthMode() === "web"` sau pe rute web-only (admin endpoints). Cota captcha este atomic-in-tranzactie cu pattern "record-at-guard-accept" (overcount-never-undercount). Offsite backup hook este fail-open (local backup ramane chiar la hook failure); structured JSON `offsite_backup` / `offsite_backup_failed`. Sentry SDK explicit amanat la v2.35.0 — workaround documentat in RUNBOOK §12 (stdout structured JSON grep-friendly cu Loki/Promtail/fluent-bit).

**Invariante pastrate**: desktop ZERO impact, BYOK desktop unchanged, `rejectApiKeysFromBodyInWebMode` activ, web-mode 501 gate pe `rejectCaptchaKeyInWebMode`, `TENANT_KEY_ENCRYPTION_SECRET` strict 32 bytes base64, raw SQL nou doar in `backend/src/db/**`.

**Test coverage**: 1334 pass / 5 skipped backend (4 noi POSIX-only pentru offsite hook + 1 pre-existent). Biome pass, tsc backend + frontend pass, build pass.

## Sprint inchis 2026-05-19 - v2.33.0 security hardening

**Status**: livrat pe branch `feat/v2.33.0-security-hardening`.

**Scope**: inchide CRITICAL-1 + 5 HIGH + 11 MEDIUM + 3 LOW din planurile `audit/FIX-PLAN-CLUSTER-*.md`, cu overlay obligatoriu din `audit/FIX-PLAN-v2.33.0-REMEDIATION.md`.

**Solutie**: quota/budget foloseste rezervari atomice in web mode dupa provider resolution si include pending spend in fereastra rolling; deployment-ul primeste instance lock atomic, proxy trust explicit si digest pinning; SOAP/RNPM/FX/key validation devin fail-closed unde planul cere; audit trail-ul elimina plaintext din SMTP errors, key events si logout attribution edge cases.

**Invariante pastrate**: desktop ZERO impact, `rejectApiKeysFromBodyInWebMode` activ, web-mode 501 gate pe `rejectCaptchaKeyInWebMode`, `TENANT_KEY_ENCRYPTION_SECRET` strict 32 bytes base64, LAN bind doar cu `LEGAL_DASHBOARD_ALLOW_REMOTE=1`, raw SQL nou doar in `backend/src/db/**`.

## Sprint inchis 2026-05-19 - v2.30.0 web admin keys + per-user budget

**Status**: livrat pe branch `feat/web-admin-keys-budget`.

**Solutie**: web mode muta cheile AI si captcha in `tenant_api_keys`, criptate AES-256-GCM cu `TENANT_KEY_ENCRYPTION_SECRET`. Adminul foloseste `/admin/keys`; non-adminii nu mai vad dialogul BYOK in web mode. AI foloseste fallback-ul `env > tenant DB > BYOK desktop`, iar RNPM captcha ia provider/mode/cheie din tenant DB in web mode.

**Budget**: `quotaGuard` aplica limitele zilnice per user pentru AI single si multi, cu `QUOTA_EXCEEDED` 429 si `Retry-After`. `/me/budget` si `BudgetIndicator` expun consumul curent cand exista limita.

**Teste cheie**: crypto, repository tenant keys, admin routes, me key-status/budget, quota guard, OpenRouter tenant DB, RNPM captcha web flow, ApiKeyDialog guard, AdminKeys page si BudgetIndicator.

## Sprint inchis 2026-05-18 - v2.29.0 monitoring noise & storage

**Status**: livrat pe branch `feat/monitoring-noise-storage`.

**Solutie**: `monitoring_snapshots` este curatat incremental prin `deletePriorSnapshots()` in aceeasi tranzactie cu insertul nou pentru `name_soap` si `dosar_soap`. Snapshot cap-ul este 3 MiB, cu titlu oversize parametrizat. Filtrarea pe nume foloseste set equality, deci un party superset nu mai trece pentru target mai scurt. `name_soap` snapshot include `latest_sedinta_at`, iar `diffNameSoap` primeste `jobCreatedAt` ca sa suprime `dosar_new` istoric fara activitate dupa adaugarea la monitorizare.

**Observability**: retention emite log JSON `monitoring.snapshot_retention` cand sterge randuri. Suppressia istorica face fail-open si logheaza `console.error("[diffNameSoap.isHistoricNoise] invalid date input", ...)` pentru date invalide.

**Teste cheie**: rollback tranzactie DELETE+INSERT, 3 tick-uri = 1 snapshot/job, oversize peste 3 MiB vs 2 MiB valid, `parte.nume` null/undefined, set equality si suppressie istorica cu date invalide.

## Sprint inchis 2026-05-14 - Notite editabile per job + propagare in alerte

**Status**: livrat pe branch `feat/monitoring-notes-edit`.

**Solutie**: `monitoring_jobs.notes` ramane coloana existenta, fara migration
noua. Backend-ul limiteaza write-urile la 200 caractere prin Zod, `listAlerts`
propaga `j.notes AS job_notes`, iar frontend-ul ofera `NoteEditor` inline in
Monitorizare si bloc `Notita: ...` in Alerte.

**UX validat**: notitele lungi fac wrap in coloana tintei si nu intra sub
butonul `Dosare`; randurile fara nota afiseaza `+ Adauga notita`.

**Teste cheie**: limita Zod notes, join `job_notes`, `NoteEditor` si
`AlertNoteBlock`.

## Sprint inchis 2026-05-13 - PR-6 Envelope Migration

**Status**: Task 1-8 complet pe branch `feat/pr6-envelope-migration`.
Executia este oprita intentionat dupa release bump v2.26.0, inainte de Task 9
smoke desktop, push si tag.

**Solutie**: rutele HTTP legacy din `rnpm.ts`, `ai.ts` si `termene.ts` emit
envelope standard pentru 4xx/5xx. `INSUFFICIENT_FUNDS` foloseste 402 +
`Retry-After: 0`, detectat tipizat prin `CaptchaInsufficientFundsError`;
`LIMIT_EXCEEDED` pastreaza `details` pentru split-search; `FILTER_DISABLED` si
`FILTER_TIMEOUT` se citesc din `body.error.code`.

**Frontend**: `frontend/src/lib/api.ts` are `extractErrorMessage` dual-shape,
folosit pe exporturi XLSX/PDF, load-more SSE si AI multi-model ca mesajele
reale sa nu cada pe fallback generic.

**Scope exclus intentionat**: path-ul RNPM 499 abort cu `searchId`,
payload-urile SSE, raspunsurile OK 200/201 si `recordAudit()` raman nemigrate.
Pagination ramane shape-only, fara `INVALID_PAGE` nou unde exista coercitie
silentioasa.

## Sprint inchis 2026-05-13 - Filtru RNPM multi-token + highlight

**Status**: livrat pe branch `feat/rnpm-filter-multitoken-highlight`, peste
branch-ul `feat/rnpm-results-filter` fast-forwarded in `main`.

**Solutie**: filtrul text RNPM tokenizes query-ul in backend si frontend,
deduplica termenii case-insensitive/diacritics-insensitive si limiteaza
evaluarea la `FILTER_TOKEN_MAX_COUNT = 8`. Backend-ul construieste o grupa OR
de 24 LIKE-uri pentru fiecare token si combina grupele cu AND, pastrand owner
isolation, `search_id`, `buildRnpmLikePattern()` si indexul
`idx_rnpm_avize_owner_search`. Frontend-ul foloseste aceiasi tokeni pentru
highlight in randul colapsat si in tab-urile Creditori/Debitori/Bunuri/Istoric.

**UX**: cand avizul match-uieste doar in detaliile expandate, tabelul afiseaza
badge-ul `match in detalii` sub Identificator. Highlight-ul galben pastreaza
textul original si face potrivire diacritics-insensitive.

## Sprint inchis anterior 2026-05-13 - Filtru text rezultate RNPM

**Status**: livrat integral pe branch `feat/rnpm-results-filter`. 9 commit-uri TDD planificate pentru implementare + release, cu biome, tsc si 51 teste noi pe zonele schimbate.

**Trigger**: search RNPM cu zeci-sute de avize facea inutil scroll-ul fara filtru text peste rezultatele deja gasite. Planul/spec-ul au fost realiniate la schema curenta inainte de Task 2: `rnpm_bunuri` nu are `descriere_proprie`, iar textul descrierii vine exclusiv prin `descriere_id -> rnpm_bunuri_descrieri.text`.

**Solutie**: endpoint nou `POST /api/rnpm/search/:searchId/filter` cu helper repository dedicat, fara refactor pe `getAvize()`. Helper-ul cauta in 24 campuri normalizate pe `rnpm_norm()`: 9 din `rnpm_avize`, 3 creditori, 3 debitori si 9 bunuri, inclusiv `rnpm_bunuri_descrieri.text` via JOIN. UI-ul filtreaza local pe `Set<avizId>` si pastreaza exportul/paginarea aliniate cu randurile vizibile. Spec full: [`docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md`](docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md).

**Decizii arhitecturale cheie**:
- POST, nu GET - evita leak `q` in Hono `logger()` URL.
- Anti-enumeration 404 pentru `searchId` neexistent sau apartinand altui owner.
- `AbortSignal.any([req.signal, AbortSignal.timeout(5000)])` - cancel client + timeout intern.
- Truncare la 1500 ID-uri cu `truncated: boolean`.
- `missingDetails` counter transparent - UI banner non-blocant pentru avize fara detalii.
- Helper privat `buildResultsFilterClause` - nu este partajat cu `getAvize().searchText`, pentru zero-regresie pe `/api/rnpm/saved?q=`.

## Sprint inchis 2026-05-13 — Migrare exporturi server-side streaming

**Status**: livrat integral. 4 commits secventiale, fiecare cu smoke + biome + tsc verzi.

**Trigger**: RNPM export pe 148 avizi a hang-uit Electron main process la 4GB peak (Codex telemetry 2026-05-12: PID 3960 1.6GB → 4.06GB → AppHangTransient → kill toate procesele; `/health` timeout = main process blocat). Cauza: `xlsx-js-style` build in-memory + backend in-process in Electron main = same V8 isolate ca UI thread.

**Solutie**: rewrite la `exceljs.stream.xlsx.WorkbookWriter` (row-by-row pe disk temp) si `pdfkit` streaming pentru toate exporturile data-driven. Renderer cere blob, backend stream-uieste fisierul temp + `unlink` in `close` event.

| Faza | Scope | Commit | Status |
|---|---|---|---|
| 1 | RNPM XLSX server-side (avize/parti/bunuri/istoric, hyperlinks cross-sheet workaround) | `3b69e4c` | Done |
| 2 | RNPM PDF server-side (A4 landscape, index + 1 pagina/aviz, max 50 pagini la long fields) | `f9d11ec` | Done |
| 3a | PortalJust dosare + termene XLSX+PDF | `d600959` | Done |
| 3b | Alerte XLSX+PDF (refactor `collectAlertExportRows` + `streamExportResult`, `export-alerts.ts` sters) | `9ece8ca` | Done |

**NU migrate** (scale fix mic, safe pe client): `export-analysis.ts`, `export-manual.ts`,
`export-report.ts` raman in `export.worker.ts`; `changelog-pdf.ts` si
`monitoringBulkTemplate.ts` sunt importate direct in `pages/Changelog.tsx` respectiv
`MonitoringBulkImportCard.tsx`, fara worker (build sincron pe demand de user).

**Regula generala stabilita**: server-side stream DACA scale-ul depinde de count user. Client-side OK doar pentru scale fix cunoscut.

**Caveats tehnice consumate**:
- `WorkbookWriter` NU permite revenire la sheet anterior dupa `.commit()` → row offsets cross-sheet pre-calculate.
- ExcelJS hyperlinks cross-sheet au bug pe writer-ul streaming → workaround via HYPERLINK formula (`{ formula: \`HYPERLINK("#'Sheet'!A1","label")\`, result: "label" }`).
- pdfkit Helvetica.afm trebuie copiata in `dist-backend/data/` la build → fix in `scripts/build.js`.
- Stilizare ExcelJS per-celula: `cell.font` / `cell.fill` / `cell.alignment` / `cell.border` (API direct).

## Urmatoarea etapa (background, fara timeline)

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

### B. Continuare ad-hoc

- Bug fixes / UX polish pe fluxurile existente (Monitorizare, Alerte,
  Dashboard, Admin) pe baza feedback-ului direct din uz real.
