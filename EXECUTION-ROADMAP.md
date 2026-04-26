# Execution Roadmap — Monitorizare + Web Mode

> **Status**: 🟢 READY TO START — toate deciziile blocante rezolvate (2026-04-27).
> **Versiune document**: 1.0 (2026-04-27)
> **Owner**: Cezar (solo dev) + Claude Code
> **Spec tehnic complet**: [PLAN-monitoring-webmode.md](PLAN-monitoring-webmode.md)
> **Threat model**: [SECURITY.md](SECURITY.md) | **Hardening backlog**: [HARDENING.md](HARDENING.md)

Acest document e **roadmap-ul de executie** — saptamanal, cu checkboxes si limbaj non-IT. Pentru detalii tehnice (DDL, API contract, edge cases) vezi PLAN-monitoring-webmode.md.

---

## TL;DR pentru audienta non-tehnica

**Ce facem**: adaugam in aplicatia desktop existenta (Legal Dashboard) o functie de **monitorizare automata** care urmareste dosare si trimite alerte cand apar termene noi sau solutii. Apoi, aceeasi aplicatie devine accesibila si **prin browser** (web), pentru ca toata firma sa o foloseasca de oriunde, cu login Google Workspace.

**Cat dureaza**: **10-13 saptamani calendar**. Solo dev (Cezar + Claude Code).

**Cum e structurat**: 13 livrari mici (PR-0 → PR-12), fiecare merge-ready independent. Aplicatia ramane functionala dupa fiecare. Daca un PR e problematic, putem da rollback la PR-ul anterior fara sa pierdem nimic.

**Cele 2 faze mari**:
1. **Faza 1** (sapt 1-8): monitorizare functioneaza pe desktop, dar codul e scris ca si cand am avea deja userii web. Asta inseamna ca nu rescriem nimic in Faza 2.
2. **Faza 2** (sapt 9-13): publicam serverul, login Google, backup automat, email-uri.

**Cost extern**: ~$1/luna Google Cloud Storage (backup). Restul e timp.

---

## Decizii rezolvate (decision log)

| # | Decizie | Rezolvare | Data |
|---|---|---|---|
| 1 | Auth provider | Google Workspace SSO (OAuth2/OIDC), domain restriction `@firma.ro`. Login local doar admin escape hatch. | 2026-04-26 |
| 2 | DB engine | SQLite + Litestream forever. Postgres eliminat (overkill <100 useri). | 2026-04-26 |
| 3 | Pricing model | Niciun tier — internal flat. AI quota default $5/zi/user, $50/zi global firma. | 2026-04-26 |
| 4 | AI keys | Centralizate in `.env` server (NU BYOK). | 2026-04-26 |
| 5 | Mobile / multi-tenant | Out of scope. | 2026-04-26 |
| 6 | Strategie sequencing | Faza 1 (PR-0..PR-7) → Faza 2 (PR-8..PR-12). NU intercalat. | 2026-04-26 |
| 7 | Litestream target | **Google Cloud Storage** `legal-dashboard-backups` (europe-west3 Frankfurt). | 2026-04-27 |
| 8 | Portal Just Integrat referinta | Sister project — port conceptual, NU 1:1 (port snapshot-by-keys, 4h cadence, email format). | 2026-04-27 |
| 9 | HARDENING reconcile | Optiunea C — plan superseaza schema, HARDENING marcat OBSOLETE. Features pastrate in `alert_config_json`. | 2026-04-27 |

---

## Pre-flight checklist (saptamana 0 — inainte de PR-0)

Treci prin asta inainte sa scrii prima linie de cod. Daca ceva nu e bifat, opreste-te si rezolva.

### Local dev
- [ ] `git status` clean pe `main` (nu sunt modificari uncommitted ramase de la Faza 10).
- [ ] `npm run electron:dev` porneste fara erori.
- [ ] `npm test --workspace=backend` toate testele green (62 teste in v2.0.10).
- [ ] `npx tsc --noEmit -p backend/tsconfig.json` zero errors.
- [ ] `cd frontend && npx tsc --noEmit` zero errors.
- [ ] `npx biome check` warnings doar non-bloquante.

### Repo hygiene
- [ ] Branch protection pe `main` activat in GitHub (require PR review, even if self-merging).
- [ ] CI (GitHub Actions) verde pe ultimul commit `main`.
- [ ] CHANGELOG.md sincronizat cu `package.json` (`v2.0.10`).

### Citire obligatorie inainte de PR-3
- [ ] **Citeste integral** [Portal Just Integrat `Monitorizare.tsx:1-1724`](C:/Users/Cezar/Desktop/Proiecte/Portal%20Just%20Integrat/frontend/src/pages/Monitorizare.tsx) — pattern-ul de snapshot/diff/scheduler e portat. ~1h.
- [ ] **Citeste integral** [HARDENING.md L274-440](HARDENING.md) — chiar daca e OBSOLETE, semantic-ul (notify_days_before, is_new, solution_changed_at) trebuie inteles ca sa-l absoarbi corect in `alert_config_json`.
- [ ] **Spike empirical OBLIGATORIU**: ruleaza `cautareDosare` 5× same-input → verifica daca PortalJust intoarce payload identic. Daca difera (timestamp, ordering, etc), pivoteaza diff strategy. Documenteaza rezultatul intr-un comment in [batch-dosare.ts](backend/src/services/batch-dosare.ts).

### Setup Google Cloud (poate astepta pana la sapt ~9, dar incepe procesul acum)
- [ ] Cere admin Workspace acces la Google Cloud Console pentru `<project-id>`.
- [ ] Reserve nume bucket: `legal-dashboard-backups` (verificat ca nu e ocupat global).

---

## Saptamana cu saptamana

Fiecare PR are: scop in 1 fraza, rezultat utilizator (ce se schimba pentru user), tasks principale, definition of done (DoD), risk + mitigation.

### Saptamana 1 — Fundatie (PR-0 + PR-1 + PR-2)

> **Tema**: pregatim "schela" pentru web fara sa schimbam nimic vizibil pentru user. Toate cele 3 PR-uri sunt low-risk si pot merge in aceeasi saptamana.

#### PR-0 — Migration framework
- **Scop**: tabel `_schema_versions` + runner ordonat. Inseamna ca de acum incolo, orice modificare de schema DB (tabel nou, coloana noua) e versionata si reproductibila pe orice DB existent.
- **User vede**: nimic.
- **Tasks**:
  - [ ] Branch: `feat/migrations-framework`
  - [ ] Tabel `_schema_versions(version INTEGER PRIMARY KEY, applied_at, sha256_up)` cu CREATE IF NOT EXISTS.
  - [ ] Runner in `backend/src/db/migrations/runner.ts` care citeste `0001_*.up.sql` ... ordonat.
  - [ ] Backfill: marcheaza schema curenta ca `version=1`.
  - [ ] Test: deschide DB existing → ruleaza runner → idempotent (no-op la al 2-lea run).
- **DoD**:
  - [ ] `npm test --workspace=backend` verde + DB existing migrat la `version=1` (sentinel `__backfilled_v1__`) + nu pierde date.
  - [ ] Migration files citite **doar la boot** (sync `fs.readdirSync` ok, NU in handler) — CQ-6 conform.
  - [ ] Comiteat `0001_baseline.up.sql` real (extras DDL existing) pentru consistenta CI pe DB-uri proaspete.
  - [ ] **PR-0 NU blocheaza PR-1** — pot rula in paralel daca timing convenabil.
- **Bump**: 2.0.11 patch.
- **Risk**: LOW (paralel cu schema existing, nu interfere).

#### PR-1 — `getOwnerId` helper + 5 fix-uri owner_id leak
- **Scop**: orice endpoint nou va folosi `c.get('ownerId')` (azi returneaza `'local'` hardcoded). Cand vine PR-9, schimbam doar implementarea helper-ului — TOATE endpoint-urile mostenesc auth automat.
- **User vede**: nimic.
- **Tasks**:
  - [ ] Branch: `feat/web-readiness-foundation`
  - [ ] Middleware Hono: `c.set('ownerId', req.user?.id ?? 'local')`.
  - [ ] Fix 5 leak-uri din `avizRepository.ts` lines 272, 273, 276-283, 292, 353-354 (vezi PLAN §3).
  - [ ] Test: `repository-isolation.test.ts` (skeleton extensibil) — verifica ca o operatie cu `ownerId='userA'` nu vede date `ownerId='userB'`.
- **DoD**: zero teste rosii + `getOwnerId(c)` folosit consistent in toate routes.
- **Bump**: 2.0.12 patch.
- **Risk**: LOW.

#### PR-2 — DDL users/sessions/audit (shadow tables)
- **Scop**: cream tabelele `users`, `sessions`, `audit_log` cu un singur seed `local`. Nu sunt populate cu useri reali pana la PR-9. Insa `audit_log` e folosit imediat in PR-3+.
- **User vede**: nimic.
- **Tasks**:
  - [ ] Migration `0002_users_sessions_audit.up.sql` + down complet.
  - [ ] Helper `recordAudit(c, action, ...)` exportat din `backend/src/db/auditRepository.ts`.
  - [ ] Seed: 1 row in `users` cu `id='local', email='local@desktop'`.
- **DoD**: tables creates + seed inserat + `recordAudit()` se poate apela manual.
- **Bump**: 2.0.13 patch.
- **Risk**: LOW.

**Saptamana 1 — verificari finale**:
- [ ] CHANGELOG.md actualizat (3 entries).
- [ ] Tag git pe fiecare PR pentru rollback usor.
- [ ] Smoke test desktop: aplicatia porneste si functioneaza identic ca inainte.

---

### Saptamana 2-3 — Monitorizare core (PR-3)

> **Tema**: toate tabelele si API-urile pentru monitorizare. Scheduler-ul e DEZACTIVAT inca (`MONITORING_ENABLED=false`).

#### PR-3 — Monitoring core: schema + repo + UI minimal read-only
- **Scop**: user deschide o pagina noua "Monitorizare" si vede o lista (goala). Poate adauga manual un dosar dar nu se intampla nimic — pregatim doar infrastructura.
- **User vede**: tab nou in sidebar "Monitorizare" cu lista vida.
- **Tasks**:
  - [ ] Migration `0003_monitoring_core.up.sql`: tabelele `monitoring_jobs`, `monitoring_snapshots`, `monitoring_alerts`, `monitoring_runs` (vezi PLAN §2.2 — INCLUSIV `alert_config_json` + `monitoring_alerts.is_new`).
  - [ ] Repository: `monitoringJobsRepository.ts`, `monitoringAlertsRepository.ts` cu owner_id scoping.
  - [ ] Routes:
    - `GET /api/v1/monitoring/jobs` (lista)
    - `POST /api/v1/monitoring/jobs` (create, idempotent prin `client_request_id`)
    - `PATCH /api/v1/monitoring/jobs/:id` (toggle active, edit cadence)
    - `DELETE /api/v1/monitoring/jobs/:id`
  - [ ] Frontend: pagina `Monitorizare.tsx` minimala — tabel + buton "Adauga dosar" + form simple.
  - [ ] Env flag `MONITORING_ENABLED=false` (default desktop).
  - [ ] Util: `canonicalJson()` deterministic + `buildSedintaKey()` (port din PJI cu stadiu prefix — vezi PLAN §5.1).
- **DoD**:
  - [ ] User adauga manual un dosar → row in DB cu `next_run_at = now() + jitter`.
  - [ ] Scheduler-ul NU ruleaza (flag off).
  - [ ] Teste integration: idempotency `client_request_id`, owner_id isolation.
  - [ ] Toate rutele noi sub `/api/v1/*` cu envelope `{data, error?: {code, message}, requestId}`. **Rutele legacy `/api/dosare`, `/api/termene`, `/api/rnpm`, `/api/ai` raman intacte cu shape-ul existent** (zero risk regresie desktop).
- **Bump**: 2.1.0 minor.
- **Risk**: LOW (scheduler off, doar CRUD).

---

### Saptamana 4-5 — Scheduler + diff + alerte (PR-4)

> **Tema**: PORNIM scheduler-ul. Asta e zona cu **cel mai mare risc tehnic** — atentie maxima.

#### PR-4 — Monitoring scheduler + dosar_soap kind
- **Scop**: backend-ul ruleaza singur la fiecare 60s, vede ce joburi sunt scadente, le executa, salveaza snapshot, detecteaza diff, emite alerte.
- **User vede**: pe pagina Monitorizare incepe sa apara "Last checked: acum 2 minute" + alerte cand apar termene noi.
- **Tasks**:
  - [ ] `backend/src/services/monitoring/scheduler.ts` — tick worker (setInterval 60s), SELECT due jobs, lease lock (`locked_until`), Promise.all cu cap concurrency 3.
  - [ ] `backend/src/services/monitoring/diff.ts` — `buildSedintaKey()`, `computeDiff()`, emit alerts (`dosar_new`, `termen_new`, `termen_changed`, `solutie_aparuta`, `dosar_disappeared`). Vezi PLAN §5.1.
  - [ ] Crash recovery la boot (B.18): joburi `locked_until > 20 min ago` → reset la `aborted`.
  - [ ] Withdrawal `withMaintenanceLock` extins ca RWLock (backup = exclusive writer, scheduler = shared reader).
  - [ ] Retry exponential backoff: `next_run_at = min(60s * 2^fail_streak, 3600s) + jitter`.
  - [ ] Cancellation `AbortSignal.any([wallClockSignal, shutdownSignal])` propagat in fetch SOAP.
  - [ ] Env flag flip: `MONITORING_ENABLED=true` default desktop.
  - [ ] Teste vitest pentru: dedup alerts, lease expiration, abort propagation, fail streak reset.
- **DoD**:
  - [ ] Adaugi un dosar real, astepti tick → vezi `monitoring_runs` row + snapshot + zero alerts (run baseline).
  - [ ] Modifici manual snapshot in DB → next tick detecteaza diff + emit alert corect.
  - [ ] Dezactivezi job in timpul run → status='aborted'.
  - [ ] Backup-ul daily nu se ciocneste cu scheduler-ul (rwlock works).
  - [ ] **`load-test/monitoring-jobs.k6.js` ruleaza local** — simuleaza 1000 jobs scheduled, p95 `POST /api/v1/monitoring/jobs` < 500ms, zero error la tick worker dupa 10 min run continuu (CP-7 conform).
- **Bump**: 2.1.1 minor.
- **Risk**: 🟡 MEDIUM. Chestia care ne poate strica zilele e: PortalJust returneaza payload non-determinist → false positive alerts spam. **Mitigation**: spike-ul empirical din pre-flight + fallback diff strategy in PLAN §B.3.

**WARNING**: NU porni saptamana 4 pana cand nu ai facut spike-ul de payload determinism!

---

### Saptamana 6 — Bulk name import (PR-5)

#### PR-5 — Bulk name lists + name_soap kind
- **Scop**: user uploadeaza Excel/CSV cu lista nume clienti, sistemul creeaza automat job-uri de monitorizare pentru fiecare.
- **User vede**: pagina noua "Liste monitorizate" cu upload XLSX/CSV + preview validation + commit.
- **Tasks**:
  - [ ] Migration `0004_name_lists.up.sql`: `name_lists`, `name_list_items`.
  - [ ] Parser XLSX (deja in deps) + CSV (`csv-parse` adauga).
  - [ ] Validare CNP (13 cifre + checksum), CUI (2-10 cifre + RO prefix optional + checksum).
  - [ ] Routes: `POST /api/v1/name-lists/preview` + `POST /api/v1/name-lists` (commit cu `auto_create_jobs`).
  - [ ] Scheduler suporta `kind='name_soap'` — foloseste `cautareDosareDupaParte` cu cap snapshot 1MB.
  - [ ] UI: upload, preview cu validation per row, confirma commit, throttle 100 jobs/cerere.
- **DoD**:
  - [ ] Upload 100 nume → 100 joburi create + scheduler le proceseaza in batches.
  - [ ] Snapshot per nume comparat cu setul de `numarDosar` returnat → emit `dosar_new` la cei nou aparuti.
  - [ ] Filtru `categorii`/`stadii` din `alert_config_json` aplicat post-fetch.
- **Bump**: 2.2.0 minor.
- **Risk**: 🟡 MEDIUM. Nume populare (ex: "POPESCU ION") pot returna >1000 dosare → trebuie sa documentam si capam in UI.

---

### Saptamana 7 — Alerte UI + notificari (PR-6)

#### PR-6 — Alerte UI + notificari desktop
- **Scop**: user are un "inbox" de alerte, le poate marca read/dismiss, primeste si toast Windows nativ cand apar.
- **User vede**: badge cu numar alerte necitite in sidebar + tab "Alerte" cu inbox + notification toast Windows.
- **Tasks**:
  - [ ] Routes: `GET /api/v1/alerts` (paginated), `PATCH /api/v1/alerts/:id/seen`, `PATCH /alerts/:id/dismissed`, `GET /api/v1/alerts/stream` (SSE pentru push real-time).
  - [ ] Frontend: pagina `Alerte.tsx` cu filter (kind, severity, daterange, only unread), bulk actions, dedup vizual.
  - [ ] Electron: `new Notification({title, body})` cand SSE primeste alert nou.
  - [ ] Badge in sidebar cu count `is_new=1` + `read_at IS NULL`.
- **DoD**:
  - [ ] Alert detectat in PR-4 apare imediat in UI prin SSE.
  - [ ] Marchezi citit → badge scade.
  - [ ] Notificare Windows cand app e in background.
  - [ ] **EventSource cleanup verificat**: `useEffect(() => { const es = new EventSource('/api/v1/alerts/stream'); ...; return () => es.close(); }, [])`. Reconnect-with-backoff la disconnect (CQ-5 + CQ-8 conform). Test: navighezi de pe pagina Alerte → connection-uri active in `netstat` scad la 0.
- **Bump**: 2.2.1 minor.
- **Risk**: LOW.

---

### Saptamana 8 — AI quota tracking (PR-7) + buffer

#### PR-7 — AI usage tracking + per-user quota
- **Scop**: orice apel AI (Claude/OpenAI/Gemini) lasa un row in `ai_usage`. Pe desktop quota=infinit. Pe web (PR-9+) verificam inainte de call.
- **User vede**: panou "AI Usage" in setari cu grafic last 30 days + cost cumulativ.
- **Tasks**:
  - [ ] Migration `0005_ai_usage.up.sql`: `ai_usage(owner_id, provider, model, input_tokens, output_tokens, cost_usd, called_at, request_id)`.
  - [ ] Wrapper `aiCallTracked()` care log-eaza dupa orice call AI existent.
  - [ ] Sliding window query: `SUM(cost_usd) FROM ai_usage WHERE called_at > now()-24h`.
  - [ ] UI panel cu Recharts (deja in deps).
- **DoD**:
  - [ ] Faci 3 analize AI → 3 rows in `ai_usage` cu cost calculat.
  - [ ] Panel afiseaza cost ultimele 24h + 30 zile.
- **Bump**: 2.3.0 minor.
- **Risk**: LOW.

**End of Faza 1**: 🎉 Aplicatia are monitorizare auto + alerte + AI quota visibility. Inca strict desktop. Toate scheme-urile au `owner_id` din zi 1 — Faza 2 ataseaza doar auth real fara sa rescrie nimic.

---

### Saptamana 9 — Admin pages (PR-8)

#### PR-8 — Admin pages + roles guard
- **Scop**: pagini `/admin/*` ascunse pe desktop (rol=`local`), accesibile pe web pentru `role='admin'`.
- **User vede pe desktop**: nimic (pagina hidden).
- **User vede pe web admin**: dashboard `/admin/users`, `/admin/audit`, `/admin/quota`.
- **Tasks**:
  - [ ] Middleware `requireRole('admin')` pe toate `*/admin/*`.
  - [ ] UI: lista users cu role + status, audit log search, quota override per user.
  - [ ] Pe desktop: pagina exista dar `rol='local'` ≠ `admin`, deci 403. UI ascunde linkul.
- **DoD**: ruta `/admin/users` accesibila doar daca `currentUser.role='admin'`.
- **Bump**: 2.3.1 minor.
- **Risk**: LOW.

---

### Saptamana 10-11 — Google SSO + cutover web (PR-9) — **PR-UL CRITIC**

> **Tema**: aici se schimba totul. Aplicatia devine accesibila prin browser.

#### PR-9 — Auth wire-up: Google Workspace SSO + data export/import
- **Scop**: deployment server real, login Google, useri din firma se autentifica si vad fiecare dosarele lui. Cezar exporta datele de pe desktop si le importa pentru `cdragos@firma.ro`.
- **User vede**: in browser, https://legal.firma.ro → login Google → dashboard cu datele lui.
- **Tasks**:
  - [ ] Google Cloud Console: client OAuth2 / OIDC, domain restriction `@firma.ro`, redirect URI `https://legal.firma.ro/auth/callback`.
  - [ ] Backend: routes `/auth/google`, `/auth/callback`, `/auth/logout` cu library `oauth4webapi` sau `arctic`.
  - [ ] JWT (HS256) in cookie HttpOnly + Secure + SameSite=Lax. Refresh token 7 zile.
  - [ ] `getOwnerId(c)` schimbat: returneaza `c.var.user.id` daca login, altfel respinge 401 in mod web.
  - [ ] Login local: form basic doar pentru `email IN admin_allowlist`, argon2id + lockout. Escape hatch daca SSO down.
  - [ ] Buton desktop "Export pentru web" → ZIP cu DB filtered pe `owner_id='local'` + JSON manifest.
  - [ ] Admin web "Import for user" → unzip + remap `owner_id='local'` → `cdragos@firma.ro` + replay.
  - [ ] Server deployment: Docker image existing + nginx reverse proxy + Let's Encrypt cert.
  - [ ] Env discriminator `APP_MODE=web`.
- **DoD**:
  - [ ] Cezar logheaza pe https://legal.firma.ro cu Google → vede zero date (e cont nou).
  - [ ] Cezar exporta de pe desktop → admin importa → revine pe web → vede datele lui.
  - [ ] Coleg din firma logheaza → vede zero (e ok, nu importa pentru el).
  - [ ] Logout terge cookie + refresh token revoked.
  - [ ] **Desktop ramane functional 1:1** — zero schimbare in UX desktop, rutele legacy `/api/*` neatinse, AI keys safeStorage neatinse, port 3002 in-process.
  - [ ] **`.env.example` updated** cu `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `WORKSPACE_DOMAIN`, `PUBLIC_URL` (CP-2 conform).
- **Bump**: 3.0.0 major. **Major bump reflecta noul transport web + cutover envelope `/api/v1/*` pe web mode**, NU breaking change pentru desktop. Aplicatia desktop instalata pe stationul user-ului continua sa functioneze identic dupa upgrade la 3.0.0.
- **Risk**: 🔴 HIGH. Chestii care pot rupe: scope-uri OAuth gresite, redirect URI mismatch, cookies cross-origin, token expiry edge cases, user with `@firma.ro` dar fara cont in users table → first-login flow.

**MITIGARE OBLIGATORIE inainte de PR-9**:
- [ ] Test cu **un cont Google** Workspace real (cere un cont test la admin Workspace).
- [ ] Staging deploy (subdomeniu staging.legal.firma.ro) inainte de prod.
- [ ] Rollback plan: pastreaza login local activ ca fallback ⇒ daca SSO buggy, intri local cu admin si dezactivezi SSO temporar.

---

### Saptamana 12 — Backup automat (PR-10)

#### PR-10 — Litestream backup automat (GCS)
- **Scop**: in fiecare secunda, schimbarile DB sunt replicate la Google Cloud Storage. Daca serverul moare, restore in <5 min cu pierdere maxima 10s.
- **User vede**: nimic (background).
- **Tasks**:
  - [ ] Google Cloud Console: bucket `legal-dashboard-backups` europe-west3, retention 30 zile.
  - [ ] Service Account `litestream-replicator@<project>.iam.gserviceaccount.com` cu rol `storage.objectAdmin` doar pe bucket.
  - [ ] JSON key download → `/etc/secrets/litestream-sa.json` (perms 600).
  - [ ] `/etc/litestream.yml` cu config snippet din PLAN PR-10.
  - [ ] Systemd unit `litestream.service` → enable.
  - [ ] Test restore: opresti DB-ul, faci `litestream restore` pe alta cale, verifici integritate.
  - [ ] Filesystem flock pe `/var/run/legal-dashboard.lock` — un singur scheduler activ daca rulezi multiple instances.
- **DoD**:
  - [ ] `gsutil ls gs://legal-dashboard-backups/db/` arata generations + WAL pages.
  - [ ] Restore pe staging din GCS → DB identica cu source (dupa hash check).
  - [ ] **`.env.example` updated** cu `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/litestream-sa.json`, `LITESTREAM_BUCKET=legal-dashboard-backups`, `LITESTREAM_REGION=europe-west3` (CP-2 conform).
- **Bump**: 3.1.0 minor.
- **Risk**: 🟡 MEDIUM. Riscul mare e configurare Service Account: too-broad permissions = leak risk; too-narrow = restore esueaza.

---

### Saptamana 13 — Email + final hardening (PR-11 + PR-12)

#### PR-11 — Email notifiers (Google SMTP/relay)
- **Scop**: user primeste alertele si pe email-ul Workspace.
- **Tasks**:
  - [ ] SMTP config Google Workspace (smtp-relay.gmail.com, SPF/DKIM in DNS).
  - [ ] Backend `mailer.ts` cu nodemailer (port direct din PJI `index.ts:80-99`).
  - [ ] Template HTML email (port din PJI `index.ts:215-231`) — subject `[Legal Dashboard] N alerte`, body cu lista + link deep-link la app.
  - [ ] Cron jitter: trimite digest 1×/zi cu toate alerte non-critical, immediate doar pentru `severity=critical`.
  - [ ] Per-user setting `email_alerts_enabled: bool` + `digest_frequency: immediate|daily|off`.
- **DoD**:
  - [ ] Alert critical → email in <30s; alert info → in digest seara.
  - [ ] **`.env.example` updated** cu `SMTP_HOST=smtp-relay.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=...`, `SMTP_PASS=...` (App Password Google), `SMTP_FROM=alerts@firma.ro`, `CONTACT_EMAIL=admin@firma.ro` (CP-2 conform).
- **Bump**: 3.2.0 minor.
- **Risk**: 🟡 MEDIUM. Atentie: SPF/DKIM gresit → email-uri in spam. Test cu mai multi recipients.

#### PR-12 — Hardening final
- **Scop**: hash-chain audit log (compliance), cron retention, GDPR delete simplu.
- **Tasks**:
  - [ ] Hash-chain pe `audit_log`: fiecare row contine `prev_hash`. La verificare, recomputi lant si confirmi integritate.
  - [ ] Cron purge: `monitoring_runs > 90 zile` → DELETE; `audit_log > 1 an` → DELETE (cu archive optional pe GCS).
  - [ ] Admin route `POST /admin/users/:id/delete-data` cu cascade: monitoring_*, ai_usage, sessions. Audit log retained (compliance).
- **DoD**:
  - [ ] Modifici manual o linie audit_log → verificarea hash-chain detecteaza tamper.
  - [ ] Admin sterge un user → toate datele lui dispar except audit log.
- **Bump**: 3.3.0 minor.
- **Risk**: 🟡 MEDIUM (DELETE cascade — testeaza pe staging cu seed mare inainte de prod).

---

## Risk register sintetizat

| Risc | Severity | PR afectat | Mitigare |
|---|---|---|---|
| PortalJust returneaza payload non-determinist → spam alerts | 🔴 HIGH | PR-4 | Spike empirical pre-PR-3; fallback diff strategy in PLAN §B.3; dryRun mode in PR-3 (logs alerts in audit fara emit) |
| Google OIDC integration esueaza | 🔴 HIGH | PR-9 | Test cu cont real, staging deploy, login local fallback |
| Service Account GCS configurat gresit | 🟡 MED | PR-10 | Test restore obligatoriu pe staging inainte de cutover prod |
| Lease lock race condition in scheduler | 🟡 MED | PR-4 | Crash recovery la boot (B.18); lease timeout 20 min; teste vitest |
| Bulk name import nume popular returneaza >1000 | 🟡 MED | PR-5 | Cap snapshot 1MB; warn UI cand >100 results; throttle |
| Email-uri in spam (SPF/DKIM gresit) | 🟡 MED | PR-11 | Test cu multi-recipient pe staging; fallback in-app notification |
| Migration `0003_*` esueaza pe DB existing | 🟡 MED | PR-3 | Pattern existing tested + idempotent CREATE IF NOT EXISTS |
| Solo dev burnout (10-13 sapt sustained) | 🟡 MED | global | +20% buffer; un PR / saptamana realistic; nu pus presure |

---

## Ce NU facem (out-of-scope explicit)

- Mobile app (iOS/Android native).
- Multi-tenant workspaces (un singur tenant = firma).
- Pricing tiers / payment processing (interna, gratuita).
- Postgres migration (SQLite + Litestream forever pentru <100 useri).
- BYOK AI keys (centralized in `.env`).
- 2FA local app-side (Google Workspace gestioneaza).
- Public signup (numai useri din `@firma.ro` Workspace).
- Captcha (gestionat by Workspace SSO).
- Email verify (Google deja confirmat).
- GDPR DSAR public endpoints (admin manual delete suficient pentru intern).
- Advanced CSRF protection peste SameSite cookie (suficient pentru intern).

Vezi PLAN-monitoring-webmode.md §0 pentru rationale complet.

---

## Glosar non-IT

| Termen | Explicatie |
|---|---|
| PR | Pull Request — un set de schimbari de cod care merg impreuna intr-o livrare. |
| Migration | Script SQL care modifica structura DB-ului (tabele noi, coloane noi). Versionat ca sa fie reproductibil. |
| Schema | Structura DB-ului — ce tabele exista, ce coloane au. |
| SSO | Single Sign-On — login cu un singur cont (Google) care da acces la mai multe aplicatii. |
| OIDC / OAuth2 | Protocoale standard pentru SSO. Google le suporta nativ. |
| JWT | Token de autentificare semnat criptografic. Browser-ul il trimite la fiecare cerere. |
| SOAP | Protocol vechi de comunicare server-server (XML). PortalJust foloseste SOAP. |
| Snapshot | "Poza" la un moment dat — aici, lista de chei `sedintaKeys` la ultimul check. |
| Diff | Diferenta intre doua snapshots. Generam alerte din diff. |
| Cron / Scheduler | Mecanism care ruleaza task-uri automat la intervale regulate. |
| Litestream | Tool care replicheaza SQLite continuu la cloud (in cazul nostru GCS). |
| GCS / S3 | Google Cloud Storage / Amazon S3 — locul unde tinem backup-urile. |
| Service Account | Cont "robot" Google cu permisiuni specifice (in cazul nostru, scrie in bucket). |
| Idempotency | Daca dai click de 2 ori pe acelasi buton, se intampla o singura data. |
| Lease lock | Mecanism care impiedica 2 procese sa proceseze acelasi job in paralel. |
| Audit log | Tabel care inregistreaza toate actiunile importante (cine, ce, cand). |
| Hash-chain | Fiecare linie in audit log contine un hash al liniei anterioare → tamper detection. |

---

## Cum folosesti acest document

1. **Inainte de fiecare saptamana**: deschide sectiunea respectiva, bifeaza ce ai facut.
2. **Cand incepi un PR nou**: citeste sectiunea PR-ul + sectiunea corespunzatoare din [PLAN-monitoring-webmode.md](PLAN-monitoring-webmode.md) (spec-ul tehnic detaliat).
3. **Cand inchei un PR**: bump version in `package.json`, update [CHANGELOG.md](CHANGELOG.md), tag git, merge la `main`.
4. **Daca un PR depaseste 1.5× estimarea**: opreste-te si re-evalueaza. Mai bine spargi in 2 PR-uri mici decat 1 mare.
5. **La fiecare 2-3 PR-uri**: smoke test desktop (golden path: search → analiza AI → export) ca sa prinzi regresii devreme.

---

## Document history

- **v1.0** (2026-04-27): document creat initial dupa rezolvare deciziilor §11.2-1/2/3.

