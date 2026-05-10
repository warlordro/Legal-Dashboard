# Session Handoff

**Versiune curenta**: v2.20.5 (2026-05-10)

Document de context transfer intre sesiuni Claude. Pentru istoric versiuni detaliat
vezi [CHANGELOG.md](CHANGELOG.md). Aici tin doar reguli active de lucru,
operational kill switches, riscuri ramase si directii deschise pentru urmatorul agent.

## Kill switches operationale

| Variabila / mecanism | Effect cand activat | Cand folosesti |
|----------------------|---------------------|----------------|
| `SMTP_HOST/PORT/USER/PASS/FROM` lipsesc sau invalide | `isMailerConfigured()` ramane `false`; dispatcher-ul scurt-circuiteaza inainte de SELECT, panoul UI arata "SMTP off" | Default desktop / mod degraded controlat |
| `SMTP_SECURE=true\|false` | Forteaza TLS implicit/explicit; default = `port === 465` | Cand provider-ul SMTP cere STARTTLS pe 587 (`SMTP_SECURE=false`) sau implicit TLS pe 465 |
| `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` | Scheduler-ul nu mai claim-uieste tipurile listate; joburile raman in DB, alertele existente raman accesibile | Stop temporar pe sursa upstream cu probleme (PortalJust SOAP rate-limit) |
| `RNPM_AUDIT_CAP_HIT_DISABLED=1` | `POST /api/v1/rnpm/search-split` sare INSERT-ul `rnpm.cap_hit` din `audit_log`; restul flow-ului (SSE, decision, captchasUsed) ruleaza neschimbat | Stop urgent daca tabela audit creste suspect sau introduce contention vizibil pe write |
| `LEGAL_DASHBOARD_ALLOW_REMOTE=1` (+ `ACK_NO_AUTH=...` + `AUTH_MODE=web`) | Backend-ul accepta bind non-loopback | Setup web/server, niciodata desktop |
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

### B. Continuare ad-hoc

- Bug fixes / UX polish pe fluxurile existente (Monitorizare, Alerte,
  Dashboard, Admin) pe baza feedback-ului direct din uz real.
