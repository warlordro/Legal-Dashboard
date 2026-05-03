# Execution Roadmap â€” Monitorizare + Web Mode

> **Status**: PR-0 → PR-8 v2.6.0 implementate local (2026-04-30) + patch-uri UX v2.6.1 → v2.6.3 + audit hardening v2.6.4 + UX polish Monitorizare v2.6.5 → v2.6.6 + export Monitorizare v2.6.7 + review-driven hardening v2.6.8 (2026-05-01) + **PR-A v2.7.0 Dashboard redesign sprint, 1/3 — KPI strip + QuickActions** + **PR-9 v2.7.0 Auth pluggable seam (desktop noop / web JWT)** + PR-B v2.8.0 + PR-C v2.9.0 + patch UX v2.9.1 + **patch v2.9.2 notificari native Windows/macOS** + **PR-11 v2.10.0 Email notifiers** + patch UX v2.10.7 Monitorizare total count. PR-10 si PR-12 sunt eliminate; web cutover ramane reevaluabil separat.
> **Versiune document**: 1.18 (2026-05-03)
> **Owner**: Cezar (solo dev) + Claude Code
> **Spec tehnic complet**: [PLAN-monitoring-webmode.md](PLAN-monitoring-webmode.md)
> **Threat model**: [SECURITY.md](SECURITY.md) | **Hardening backlog**: [HARDENING.md](HARDENING.md)

Acest document e **roadmap-ul de executie** â€” saptamanal, cu checkboxes si limbaj non-IT. Pentru detalii tehnice (DDL, API contract, edge cases) vezi PLAN-monitoring-webmode.md.

---

## TL;DR pentru audienta non-tehnica

**Ce facem**: adaugam in aplicatia desktop existenta (Legal Dashboard) o functie de **monitorizare automata** care urmareste dosare si trimite alerte cand apar termene noi sau solutii. Apoi, aceeasi aplicatie devine accesibila si **prin browser** (web), pentru ca toata firma sa o foloseasca de oriunde, cu login Google Workspace.

**Cat dureaza**: **10-13 saptamani calendar**. Solo dev (Cezar + Claude Code).

**Cum e structurat**: 13 livrari mici (PR-0 â†’ PR-12), fiecare merge-ready independent. Aplicatia ramane functionala dupa fiecare. Daca un PR e problematic, putem da rollback la PR-ul anterior fara sa pierdem nimic.

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
| 3 | Pricing model | Niciun tier â€” internal flat. AI quota default $5/zi/user, $50/zi global firma. | 2026-04-26 |
| 4 | AI keys | Centralizate in `.env` server (NU BYOK). | 2026-04-26 |
| 5 | Mobile / multi-tenant | Out of scope. | 2026-04-26 |
| 6 | Strategie sequencing | Faza 1 (PR-0..PR-7) â†’ Faza 2 (PR-8..PR-12). NU intercalat. | 2026-04-26 |
| 7 | Litestream target | **Google Cloud Storage** `legal-dashboard-backups` (europe-west3 Frankfurt). | 2026-04-27 |
| 8 | Portal Just Integrat referinta | Sister project â€” port conceptual, NU 1:1 (port snapshot-by-keys, 4h cadence, email format). | 2026-04-27 |
| 9 | HARDENING reconcile | Optiunea C â€” plan superseaza schema, HARDENING marcat OBSOLETE. Features pastrate in `alert_config_json`. | 2026-04-27 |
| 10 | Captcha provider keys | Desktop ramane cu UI + Electron `safeStorage`; web/server mode muta cheile 2Captcha/CapSolver in `.env` server-side (NU BYOK, NU client/browser). | 2026-04-30 |
| 11 | **PR-10 Litestream/GCS — ELIMINAT** | Decizia #7 (GCS backup) si PR-10 sunt scoase din scope. Motivul: solo dev fara firma, cost-benefit negativ. Ramane backup-ul zilnic local din v2.3.0. La cutover web (daca se intampla), reevaluam cu Cloudflare R2 sau Backblaze B2 ca alternative S3-compatibile. PR-12 GDPR delete tot eliminat (nu suntem firma de avocatura, nu prelucram date pe seama unor clienti). Ramase active pentru web cutover: **doar SSO (PR-9 livrat) + Email notifiers (PR-11)**. | 2026-05-03 |

---

## Pre-flight checklist (saptamana 0 â€” inainte de PR-0)

Treci prin asta inainte sa scrii prima linie de cod. Daca ceva nu e bifat, opreste-te si rezolva.

### Local dev (validat post-v2.4.0 la 2026-04-29)
- [x] `git status` clean pe `main` (nu sunt modificari uncommitted ramase de la Faza 10).
- [x] `npm run electron:dev` porneste fara erori (3 smoke-uri consecutive).
- [x] `npm test --workspace=backend` toate testele green (**416 teste** in v2.4.0).
- [x] `npx tsc --noEmit -p backend/tsconfig.json` zero errors.
- [x] `cd frontend && npx tsc --noEmit` zero errors.
- [x] `npx biome check` clean.

### Repo hygiene
- [ ] Branch protection pe `main` activat in GitHub (require PR review, even if self-merging).
- [ ] CI (GitHub Actions) verde pe ultimul commit `main`.
- [x] CHANGELOG.md sincronizat cu `package.json` (`v2.4.0`).

### Citire obligatorie inainte de PR-3
- [ ] **Citeste integral** Portal Just Integrat `frontend/src/pages/Monitorizare.tsx:1-1724` (path local â€” sister project `portaljust-dashboard`, configureaza via env `PJI_REFERENCE_REPO`) â€” pattern-ul de snapshot/diff/scheduler e portat. ~1h.
- [ ] **Citeste integral** [HARDENING.md L274-440](HARDENING.md) â€” chiar daca e OBSOLETE, semantic-ul (notify_days_before, is_new, solution_changed_at) trebuie inteles ca sa-l absoarbi corect in `alert_config_json`.
- [ ] **Spike empirical OBLIGATORIU**: ruleaza `cautareDosare` 5Ã— same-input â†’ verifica daca PortalJust intoarce payload identic. Daca difera (timestamp, ordering, etc), pivoteaza diff strategy. Documenteaza rezultatul intr-un comment in [batch-dosare.ts](backend/src/services/batch-dosare.ts).

### Setup Google Cloud (poate astepta pana la sapt ~9, dar incepe procesul acum)
- [ ] Cere admin Workspace acces la Google Cloud Console pentru `<project-id>`.
- [ ] Reserve nume bucket: `legal-dashboard-backups` (verificat ca nu e ocupat global).

---

## Saptamana cu saptamana

Fiecare PR are: scop in 1 fraza, rezultat utilizator (ce se schimba pentru user), tasks principale, definition of done (DoD), risk + mitigation.

### Saptamana 1 â€” Fundatie (PR-0 + PR-1 + PR-2) âœ… LIVRAT 2026-04-27

> **Tema**: pregatim "schela" pentru web fara sa schimbam nimic vizibil pentru user. Toate cele 3 PR-uri sunt low-risk si pot merge in aceeasi saptamana.

#### PR-0 â€” Migration framework âœ… DONE (commit `9c3a9aa` pe main, v2.0.11)
- **Scop**: tabel `_schema_versions` + runner ordonat. Inseamna ca de acum incolo, orice modificare de schema DB (tabel nou, coloana noua) e versionata si reproductibila pe orice DB existent.
- **User vede**: nimic.
- **Tasks**:
  - [x] Branch: `feat/migrations-framework`
  - [x] Tabel `_schema_versions(version INTEGER PRIMARY KEY, applied_at, sha256_up)` cu CREATE IF NOT EXISTS.
  - [x] Runner in `backend/src/db/migrations/runner.ts` care citeste `0001_*.up.sql` ... ordonat.
  - [x] Backfill: marcheaza schema curenta ca `version=1` cu sentinel `__backfilled_v1__`.
  - [x] Test: deschide DB existing â†’ ruleaza runner â†’ idempotent (no-op la al 2-lea run).
- **DoD**:
  - [x] `npm test --workspace=backend` verde + DB existing migrat la `version=1` (sentinel `__backfilled_v1__`) + nu pierde date.
  - [x] Migration files citite **doar la boot** (sync `fs.readdirSync` ok, NU in handler) â€” CQ-6 conform.
  - [x] Comiteat `0001_baseline.up.sql` real (extras DDL existing) pentru consistenta CI pe DB-uri proaspete.
  - [x] **PR-0 NU blocheaza PR-1** â€” pot rula in paralel daca timing convenabil.
- **Bump**: 2.0.11 patch. âœ…
- **Risk**: LOW (paralel cu schema existing, nu interfere).

#### PR-1 â€” `getOwnerId` helper + 5 fix-uri owner_id leak âœ… DONE (commit `beca3b6`, v2.0.12)
- **Scop**: orice endpoint nou va folosi `c.get('ownerId')` (azi returneaza `'local'` hardcoded). Cand vine PR-9, schimbam doar implementarea helper-ului â€” TOATE endpoint-urile mostenesc auth automat.
- **User vede**: nimic.
- **Tasks**:
  - [x] Branch: `feat/web-readiness-foundation`
  - [x] Middleware Hono `backend/src/middleware/owner.ts`: `c.set('ownerId', ...)` + `ContextVariableMap` augmentation.
  - [x] Fix 5 leak-uri din `avizRepository.ts` lines 272, 273, 276-283, 292, 353-354 (vezi PLAN Â§3).
  - [x] Test: `repository-isolation.test.ts` (skeleton extensibil) â€” verifica ca o operatie cu `ownerId='userA'` nu vede date `ownerId='userB'`.
- **DoD**: âœ… zero teste rosii + `getOwnerId(c)` folosit consistent in toate routes.
- **Bump**: 2.0.12 patch. âœ…
- **Risk**: LOW.

#### PR-2 â€” DDL users/sessions/audit (shadow tables) âœ… DONE (commit `c09a855`, v2.0.13)
- **Scop**: cream tabelele `users`, `sessions`, `audit_log` cu un singur seed `local`. Nu sunt populate cu useri reali pana la PR-9. Insa `audit_log` e folosit imediat in PR-3+.
- **User vede**: nimic.
- **Tasks**:
  - [x] Migration `0002_users_sessions_audit.up.sql` + `.down.sql` complet.
  - [x] Helper `recordAudit(c, action, options?)` exportat din `backend/src/db/auditRepository.ts` (+ `getAuditEvents` cu owner scope si system filter).
  - [x] Seed: 1 row in `users` cu `id='local', email='local@desktop', role='user'`.
- **DoD**: âœ… tables creates + seed inserat + `recordAudit()` se poate apela manual; 13 teste in `auditRepository.test.ts` (schema, write paths, read paths, owner isolation).
- **Bump**: 2.0.13 patch. âœ…
- **Risk**: LOW.

**Saptamana 1 â€” verificari finale**:
- [x] CHANGELOG.md actualizat (3 entries â€” v2.0.11/12/13).
- [x] In-app changelog (`frontend/src/data/changelog-entries.tsx`) actualizat (3 entries).
- [ ] Tag git pe fiecare PR pentru rollback usor â€” **optional, nu blocheaza PR-3**.
- [x] Smoke test desktop: 3 launch-uri Electron consecutive (02:18 / 02:26 / 02:29 in `logs/electron-20260427-*`), `[schema] applied migrations: 2`, app functional 1:1.

---

### Saptamana 2-3 â€” Monitorizare core (PR-3) âœ… LIVRAT 2026-04-27

> **Tema**: toate tabelele si API-urile pentru monitorizare. Scheduler-ul e DEZACTIVAT inca (in PR-3 nu se interogheaza inca PortalJust; flag `MONITORING_ENABLED=1` desktop default activeaza doar API + UI).

#### PR-3 â€” Monitoring core: schema + repo + UI minimal read-only
- **Scop**: user deschide o pagina noua "Monitorizare" si vede o lista (goala). Poate adauga manual un dosar dar nu se intampla nimic â€” pregatim doar infrastructura.
- **User vede**: tab nou in sidebar "Monitorizare" cu lista vida.
- **Tasks**:
  - [x] Migration `0003_monitoring_core.up.sql`: tabelele `monitoring_jobs`, `monitoring_snapshots`, `monitoring_alerts`, `monitoring_runs` (vezi PLAN Â§2.2 â€” INCLUSIV `alert_config_json` + `monitoring_alerts.is_new`).
  - [x] Repository: `monitoringJobsRepository.ts`, `monitoringAlertsRepository.ts` cu owner_id scoping.
  - [x] Routes:
    - `GET /api/v1/monitoring/jobs` (lista)
    - `POST /api/v1/monitoring/jobs` (create, idempotent prin `client_request_id`)
    - `PATCH /api/v1/monitoring/jobs/:id` (toggle active, edit cadence â€” recomputeaza `next_run_at` cand cadenta/active/paused_until se schimba)
    - `DELETE /api/v1/monitoring/jobs/:id`
  - [x] Frontend: pagina `Monitorizare.tsx` minimala â€” tabel + buton "Adauga dosar" + form simple. Buton "Monitorizeaza schimbari" si in `DosareTable` panou expanded.
  - [x] Env flag `MONITORING_ENABLED` (desktop default `1` din `electron/main.js`; setare `0` = kill switch â€” ruta nu e mount-uita).
  - [x] Util: `canonicalJson()` deterministic + `buildSedintaKey()` (port din PJI cu stadiu prefix â€” vezi PLAN Â§5.1).
- **DoD**:
  - [x] User adauga manual un dosar â†’ row in DB cu `next_run_at` calculat din cadenta.
  - [x] Scheduler-ul NU ruleaza (worker-ul care interogheaza PortalJust ramane pentru PR-4).
  - [x] Teste integration: idempotency `client_request_id`, owner_id isolation, audit writes pe mutatii, request-id propagation (192 teste backend, +93 noi).
  - [x] Toate rutele noi sub `/api/v1/*` cu envelope `{data, error?: {code, message}, requestId}`. **Rutele legacy `/api/dosare`, `/api/termene`, `/api/rnpm`, `/api/ai` raman intacte cu shape-ul existent** (zero risk regresie desktop).
  - [x] Live smoke launch (post-rebuild Electron): `[schema] applied migrations: 3`, GET /api/v1/monitoring/jobs 200, GET /api/dosare 200, POST /api/rnpm/search 200 (35s captcha race).
- **Bump**: 2.1.0 minor.
- **Risk**: ðŸŸ¢ LOW (scheduler off, doar CRUD). Post-review hardening (4 valuri) absorbit pre-merge â€” vezi `CHANGELOG.md` v2.1.0 "Post-review hardening" pentru detalii (schema strftime ISO Z, cadence default 14400, atomic audit + recompute next_run_at, parseSqliteUtc).

---

### Saptamana 4-5 â€” Scheduler + diff + alerte (PR-4) âœ… LIVRAT 2026-04-28

> **Tema**: PORNIM scheduler-ul. Asta e zona cu **cel mai mare risc tehnic** â€” atentie maxima.

#### PR-4 - Monitoring scheduler + dosar_soap kind DONE (main merge `1907373`, v2.2.0)
- **Scop**: backend-ul ruleaza singur la fiecare 60s, vede ce joburi sunt scadente, le executa, salveaza snapshot, detecteaza diff, emite alerte.
- **User vede**: pe pagina Monitorizare incepe sa apara "Last checked: acum 2 minute" + alerte cand apar termene noi.
- **Livrari** (6 commit-uri bisectabile, C1-C6):
  - [x] `backend/src/services/monitoring/scheduler.ts` â€” tick worker (setTimeout chain 60s), claim semantics via `monitoring_runs` running row (NU `locked_until` column â€” abandonat in favor of run-row lease pentru atomic claim).
  - [x] `backend/src/services/monitoring/diff.ts` â€” `diffDosarSoap()` pur, alerts `termen_nou`, `solutie_aparuta`, `termen_modificat`. `sedintaKey` cu prefix `stadiu` â€” fix pentru bug-ul silentios PJI (Apel vs Fond colideau).
  - [x] Crash recovery la boot: `recoverOrphanRuns()` ruleaza inainte de prima tick, marcheaza `running` rows ca `aborted`.
  - [x] `withMaintenanceLock` extins ca `RWLock` (backup = exclusive writer, scheduler = shared reader, writer-preference). Stop()-race fixed: re-check `this.running` post-acquire ca un reader parked sa nu execute claim+run dupa shutdown.
  - [x] Backoff: `computeNextRunAt(failStreak)` = `min(60 * 2^failStreak, 3600)` + jitter 0-30s. Source error 1h override la `failStreak >= 5`.
  - [x] Cancellation: `AbortSignal.any([externalSignal, AbortSignal.timeout(10min)])` propagat in fetch SOAP.
  - [x] `POST /api/v1/monitoring/jobs/:id/run` manual trigger â€” 202 + `{runId}` (PLAN L491). 503 / 404 / 409 fallback paths. Audit `monitoring.job.run_manual`.
  - [x] Env flag flip: `MONITORING_ENABLED !== "0"` (default ON, kill switch ramane).
  - [x] Boot wiring: scheduler instantiat post-`listen` + `gracefulShutdown` await `scheduler.stop()` inainte de `closeDb()`.
- **DoD**:
  - [x] Backup-ul daily nu se ciocneste cu scheduler-ul (`rwlock.test.ts` writer-preference test).
  - [x] `aborted` outcome lasa `fail_streak`/`next_run_at` neschimbate (drain semantics).
  - [x] `source_error` alert emis exact la transition 4â†’5 fail streak, NU repetat.
  - [x] `scripts/loadtest-monitoring.js` k6 1000-job harness gata (manual smoke â€” nu in CI).
  - [x] **Manual smoke** pe desktop dupa merge: real dosar, astepti 60s, vezi `monitoring_runs` ok row + snapshot.
  - [x] Full-review hardening Tier 2-6 absorbit in release: body caps monitoring, per-kind kill switch, retention purge, owner-scoped latest snapshot, crash recovery marker/logging.
- **Bump**: 2.2.0 minor (PR-4 + hardening full-review). Patch ulterior: `v2.2.0` â†’ `v2.3.0` (audit remediation: backup zilnic recurent, restore SQLite cu `PRAGMA integrity_check`, graceful shutdown drain 30s, migration 0005 `idx_one_running_per_job`, executeSearch RNPM in maintenance lock, audit pe rute destructive RNPM, migration runner self-heal bidirectional, export Web Worker pe RNPM + AI + Manual). 357/357 backend tests verde.
- **Risk**: MEDIUM initial, redus dupa smoke desktop si hardening Tier 2-6.

---

### Saptamana 6 â€” Bulk name import (PR-5)

#### PR-5 â€” Bulk name lists + name_soap kind
- **Scop**: user uploadeaza Excel/CSV cu lista nume clienti, sistemul creeaza automat job-uri de monitorizare pentru fiecare.
- **User vede**: pagina noua "Liste monitorizate" cu upload XLSX/CSV + preview validation + commit.
- **Tasks** (livrabil in 6 commits secventiale pe `feat/pr5-name-lists-bulk`):
  - [x] **Commit 1/6** (`046fb66`) â€” Migration `0006_name_lists.up.sql` (renumerotat: 0005 consumat de `idx_one_running_per_job` din patch-ul v2.3.0): `name_lists`, `name_list_items`, FK invers `monitoring_jobs.name_list_id`. Plus `nameListsRepository` complet (15 teste).
  - [x] **Constatare adversiala #6 (PR-4 review)**: `name_list_items.list_id` foloseste `ON DELETE RESTRICT` (NU CASCADE) si noul FK invers `monitoring_jobs.name_list_id` la fel. Motivare: stergerea CASCADE a unei liste cu joburi `name_soap` active orfana run-urile + alertele asociate fara warning operator. RESTRICT forteaza ordin explicit: archive-job â†’ archive-list â†’ delete-list. Detalii in `PLAN-monitoring-webmode.md` Â§2.3.
  - [x] **Commit 2/6** (`ffc8ba7`) â€” Parser XLSX (`xlsx@0.18.5`) + CSV (`csv-parse@^5.6.0`). 24 teste in `nameListParser.test.ts` (format detection, header sinonime, validation reject/warn, capurile FILE_TOO_LARGE/TOO_MANY_ROWS/TOO_MANY_COLS).
  - [x] Validare nume: trim + length 2..200, dedup intra-fisier pe `(name_normalized, name_kind)`, normalizare diacritic strip + collapse whitespace.
  - [x] **Commit 3/6** (`e2743a4`) â€” Routes: `POST /api/v1/name-lists/preview` (multipart 10MB, stateless) + `POST /api/v1/name-lists` (JSON 15MB, autoCreateJobs sync cu cap 100 + lineage `name_list_id`, partial flag pe batch-urile urmatoare). 17 teste cu defense-in-depth re-validation server-side via `validateRawItems`.
  - [x] **Commit 4/6** â€” Scheduler suporta `kind='name_soap'` â€” foloseste `cautareDosareDupaParte`. Captura imbogatita: `{version, fetched_at, dosare: [{numar, stadiu, categorie, instanta}]}`. Plafon 1MB pe `payload_json` (la depasire: trunchiere + alerta `source_error` cod `SNAPSHOT_OVERSIZE`).
  - [x] **Commit 4/6** â€” Diff per element pe `numar` (nu set diff): emit `dosar_new`, `dosar_disappeared` (configurabil), `stadiu_changed`, `categorie_changed`, `dosar_relevant_now`/`dosar_no_longer_relevant` cand schimba apartenenta la filtrul `alert_config.stadii`/`categorii`.
  - [x] **Commit 4/6** â€” Cheia dedup pe alerta: `${kind}|${numar}|${tranzitie}` (NU `runId`) â€” flapping pe acelasi dosar nu duplicheaza alertele la fiecare oscilare.
  - [x] **Commit 5/6** â€” UI: upload, preview cu validation per row, confirma commit, throttle 100 jobs/cerere.
  - [x] **Commit 6/6** â€” k6 harness pentru bulk import (perf + correctness).
- **DoD**:
  - [x] Upload 100 nume â†’ 100 joburi create + scheduler le proceseaza in batch-uri.
  - [x] Captura per nume comparata per element pe `numar` â†’ emit `dosar_new` la cei nou aparuti, `stadiu_changed` la tranzitii pe acelasi numar.
  - [x] Filtru `categorii`/`stadii` din `alert_config_json` aplicat la pasul de emit alerta (nu la salvarea capturii) â€” schimbarea filtrului ia efect imediat, fara reseed.
  - [x] Test: oscilare portal (R1 vede dosar, R2 nu, R3 il vede) â†’ dedup pe numar previne `dosar_disappeared`+`dosar_new` repetate la fiecare ciclu.
- **Bump**: 2.4.0 minor (renumerotat â€” `v2.3.0` consumat de patch-ul de audit remediation publicat 2026-04-29).
- **Risk**: ðŸŸ¡ MEDIUM. Nume populare (ex: "POPESCU ION") pot returna >1000 dosare â†’ trebuie sa documentam si capam in UI.

---

### Saptamana 7 â€” Alerte UI + notificari (PR-6)

#### PR-6 â€” Alerte UI + notificari desktop âœ… IMPLEMENTAT LOCAL 2026-04-30
- **Scop**: user are un "inbox" de alerte, le poate marca read/dismiss, primeste si toast Windows nativ cand apar.
- **User vede**: badge cu numar alerte necitite in sidebar + tab "Alerte" cu inbox + notification toast Windows.
- **Tasks**:
  - [x] Routes: `GET /api/v1/alerts` (paginated), `PATCH /api/v1/alerts/:id/seen`, `PATCH /api/v1/alerts/:id/dismissed`, `GET /api/v1/alerts/stream` (SSE pentru push real-time).
  - [x] Frontend: pagina `Alerte.tsx` cu filter (kind, severity, daterange, only unread), bulk action pentru pagina vizibila si detalii defensive.
  - [x] Electron: `new Notification({title, body})` in main process via IPC cand SSE primeste alert nou.
  - [x] Badge in sidebar cu count `read_at IS NULL AND dismissed_at IS NULL`.
- **DoD**:
  - [x] Alert nou este publicat prin SSE si UI face refresh.
  - [x] Marchezi citit â†’ badge scade.
  - [x] Notificare Windows prin Electron IPC cand app-ul primeste alerta noua.
  - [x] Patch v2.9.2: status notificari Windows/macOS citibil prin IPC,
    notificare test disponibila in UI si toast-uri native suprimate doar cand
    OS-ul raporteaza explicit blocare; inbox-ul si badge-ul raman sursa de
    adevar.
  - [x] **EventSource cleanup verificat in cod + test SSE backend**: `useEffect` inchide conexiunea si reconecteaza cu backoff la disconnect.
- **Bump**: 2.4.1 patch.
- **Risk**: LOW.

---

### Saptamana 8 â€” AI quota tracking (PR-7) + buffer

#### PR-7 â€” AI usage tracking + per-user quota
- **Scop**: orice apel AI (Claude/OpenAI/Gemini) lasa un row in `ai_usage`. Pe desktop quota=infinit. Pe web (PR-9+) verificam inainte de call.
- **User vede**: panou "AI Usage" in setari cu grafic last 30 days + cost cumulativ.
- **Tasks**:
  - [x] Migration `0010_ai_usage.up.sql`: `ai_usage(owner_id, ts, provider, model, input_tokens, output_tokens, cost_usd_milli, http_status, was_aborted, request_id, feature)`.
  - [x] Integrare minim invaziva in `withAiLogging()` care persista dupa orice call AI existent, fara sa schimbe prompturi/flow.
  - [x] Sliding window queries pentru 24h / 30 zile + serie zilnica owner-scoped.
  - [x] UI panel cu Recharts in Setari API.
- **DoD**:
  - [x] Analiza single scrie 1 row; analiza multi-agent scrie cate un row per SDK call (2 analisti + judge cand ajunge la faza judge).
  - [x] Panel afiseaza cost ultimele 24h + 30 zile.
  - [x] Validare: `npm test --workspace=backend` 432/432, backend/frontend typecheck, `npm run build`; `npm run rebuild:electron` rulat dupa testele Node.
- **Bump**: 2.5.0 minor.
- **Risk**: LOW.

**End of Faza 1**: ðŸŽ‰ Aplicatia are monitorizare auto + alerte + AI quota visibility. Inca strict desktop. Toate scheme-urile au `owner_id` din zi 1 â€” Faza 2 ataseaza doar auth real fara sa rescrie nimic.

---

### Saptamana 9 â€” Admin pages (PR-8)

#### PR-8 â€” Admin pages + roles guard
- **Scop**: pagini `/admin/*` ascunse pe desktop (rol=`local`), accesibile pe web pentru `role='admin'`.
- **User vede pe desktop**: nimic (pagina hidden).
- **User vede pe web admin**: dashboard `/admin/users`, `/admin/audit`, `/admin/quota`.
- **Tasks**:
  - [x] Middleware `requireRole('admin')` pe toate `*/admin/*`.
  - [x] UI: lista users cu role + status, audit log search, quota override per user.
  - [ ] Pe desktop: pagina exista dar `rol='local'` â‰  `admin`, deci 403. UI ascunde linkul.
- **DoD**: ruta `/admin/users` accesibila doar daca `currentUser.role='admin'`.
- **Bump**: 2.6.0 minor.
- **Risk**: LOW.
- **Status**: LIVRAT 2026-04-30 (v2.6.0). Vezi CHANGELOG si SESSION-HANDOFF pentru detalii implementare.

---

### Saptamana 10-11 - Web auth seam + cutover viitor

> **Tema**: separa auth seam-ul conservator de cutover-ul web real. PR-9 nu
> livreaza SSO/deploy complet; doar pregateste granita fail-closed.

#### PR-9 - Auth pluggable seam (branch curent)
- **Scop**: desktop ramane pe identitatea `local`, iar `LEGAL_DASHBOARD_AUTH_MODE=web`
  valideaza JWT/cookie si refuza fallback-ul la `local`.
- **User vede**: nimic nou in desktop; web mode este opt-in tehnic pentru teste.
- **Tasks**:
  - [x] Auth provider interface: desktop noop + web JWT validation.
  - [x] `getOwnerId(c)` returneaza userul autentificat in web mode.
  - [x] `/api/v1/auth/login|logout|refresh`: login ramane 501; logout sterge
    cookie; refresh reemite JWT cookie.
  - [x] Env discriminator `LEGAL_DASHBOARD_AUTH_MODE=web` (`APP_MODE` ramane alias).
  - [x] Remote bind cere `LEGAL_DASHBOARD_AUTH_MODE=web` + JWT secret + ack.
  - [x] `/health` public si non-sensitive in toate modurile.
- **DoD**:
  - [x] Desktop ramane functional 1:1.
  - [x] Web missing/invalid token returneaza envelope cu `requestId`.
  - [x] Pre-auth rate limit protejeaza requesturile fara auth valida.
  - [x] Docs descriu user pre-seed si faptul ca SSO/cutover raman viitoare.
- **Bump**: fara bump pe branch (ramane 2.6.8); bump-ul se face in PR-ul de release dupa merge.
- **Risk**: MEDIUM. Este auth seam, nu productie web cutover.

#### PR-10 → PR-12 - Future web cutover
- Google Cloud Console: client OAuth2/OIDC, domain restriction `@firma.ro`,
  redirect URI `https://legal.firma.ro/auth/callback`.
- Backend real Google SSO + server-side sessions/revocation.
- Export/import desktop-web si remap `owner_id='local'` catre user real.
- Server deployment: Docker image, reverse proxy, TLS, Litestream.
- Captcha provider keys server-side in web mode; niciodata BYOK/browser-supplied.

---

### Saptamana 12 â€” Backup automat (PR-10) — ❌ ELIMINAT 2026-05-03

> **STATUS: SCOS DIN SCOPE.** Vezi decizia #11 in decision log. Backup-ul zilnic
> local din v2.3.0 ramane singura strategie. Continutul de mai jos e pastrat
> doar ca referinta istorica daca cineva reintroduce stage-ul cu alt provider
> (Cloudflare R2 / Backblaze B2 in loc de GCS).

#### PR-10 â€” Litestream backup automat (GCS) — ❌ ELIMINAT
- **Scop**: in fiecare secunda, schimbarile DB sunt replicate la Google Cloud Storage. Daca serverul moare, restore in <5 min cu pierdere maxima 10s.
- **User vede**: nimic (background).
- **Tasks**:
  - [ ] Google Cloud Console: bucket `legal-dashboard-backups` europe-west3, retention 30 zile.
  - [ ] Service Account `litestream-replicator@<project>.iam.gserviceaccount.com` cu rol `storage.objectAdmin` doar pe bucket.
  - [ ] JSON key download â†’ `/etc/secrets/litestream-sa.json` (perms 600).
  - [ ] `/etc/litestream.yml` cu config snippet din PLAN PR-10.
  - [ ] Systemd unit `litestream.service` â†’ enable.
  - [ ] Test restore: opresti DB-ul, faci `litestream restore` pe alta cale, verifici integritate.
  - [ ] Filesystem flock pe `/var/run/legal-dashboard.lock` â€” un singur scheduler activ daca rulezi multiple instances.
- **DoD**:
  - [ ] `gsutil ls gs://legal-dashboard-backups/db/` arata generations + WAL pages.
  - [ ] Restore pe staging din GCS â†’ DB identica cu source (dupa hash check).
  - [ ] **`.env.example` updated** cu `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/litestream-sa.json`, `LITESTREAM_BUCKET=legal-dashboard-backups`, `LITESTREAM_REGION=europe-west3` (CP-2 conform).
- **Bump**: 3.1.0 minor.
- **Risk**: ðŸŸ¡ MEDIUM. Riscul mare e configurare Service Account: too-broad permissions = leak risk; too-narrow = restore esueaza.

---

### Saptamana 13 â€” Email + final hardening (PR-11 + PR-12)

#### PR-11 â€” Email notifiers (Google SMTP/relay)
- **Scop**: user primeste alertele si pe email-ul Workspace.
- **Tasks**:
  - [x] SMTP config documentat in `.env.example`; operatorul completeaza `SMTP_*` si DNS/SPF/DKIM ramane operational, in afara codului.
  - [x] Backend `mailer.ts` cu nodemailer, provider-agnostic si disabled cand `SMTP_*` lipsesc.
  - [x] Template HTML email escaped + text fallback; subject `[Legal Dashboard] <severitate>: <kind>`, body cu detail JSON si deep-link `legal-dashboard://alerts/:id`.
  - [x] PR-11 executat ca immediate per alert, conform brief-ului dedicat; digest zilnic a ramas non-scope pentru PR viitor optional.
  - [x] Per-user setting in tabela `owner_email_settings`: `enabled`, `to_address`, `min_severity` compatibil cu schema alertelor; UI-ul nu expune prag de severitate, iar email-ul trimite toate alertele noi de monitorizare cand este activ.
- **DoD**:
  - [x] Alert nou inserat (`inserted=true`) â†’ email dispatch pe `queueMicrotask`, fara sa blocheze insert/SSE/native notifications.
  - [x] **`.env.example` updated** cu `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`.
- **Bump**: 2.10.0 minor.
- **Risk**: ðŸŸ¡ MEDIUM. Atentie: SPF/DKIM gresit â†’ email-uri in spam. Test cu mai multi recipients.

#### PR-12 â€” Hardening final — ❌ ELIMINAT 2026-05-03
> **STATUS: SCOS DIN SCOPE.** Vezi decizia #11. GDPR delete nu e necesar pentru
> uz personal (nu suntem firma de avocatura, doar verificam dosare publice de pe
> portaljust.ro). Hash-chain audit pe single-user e compliance theatre. Cron purge
> `monitoring_runs > 90d` deja livrat in v2.5.1. Continutul de mai jos e referinta
> istorica.

- **Scop**: hash-chain audit log (compliance), cron retention, GDPR delete simplu.
- **Tasks**:
  - [ ] Hash-chain pe `audit_log`: fiecare row contine `prev_hash`. La verificare, recomputi lant si confirmi integritate.
  - [ ] Cron purge: `monitoring_runs > 90 zile` â†’ DELETE; `audit_log > 1 an` â†’ DELETE (cu archive optional pe GCS).
  - [ ] Admin route `POST /admin/users/:id/delete-data` cu cascade: monitoring_*, ai_usage, sessions. Audit log retained (compliance).
- **DoD**:
  - [ ] Modifici manual o linie audit_log â†’ verificarea hash-chain detecteaza tamper.
  - [ ] Admin sterge un user â†’ toate datele lui dispar except audit log.
- **Bump**: 3.3.0 minor.
- **Risk**: ðŸŸ¡ MEDIUM (DELETE cascade â€” testeaza pe staging cu seed mare inainte de prod).

---

## Risk register sintetizat

| Risc | Severity | PR afectat | Mitigare |
|---|---|---|---|
| PortalJust returneaza payload non-determinist â†’ spam alerts | ðŸ”´ HIGH | PR-4 | Spike empirical pre-PR-3; fallback diff strategy in PLAN Â§B.3; dryRun mode in PR-3 (logs alerts in audit fara emit) |
| Google OIDC integration esueaza | ðŸ”´ HIGH | PR-9 | Test cu cont real, staging deploy, login local fallback |
| Service Account GCS configurat gresit | ðŸŸ¡ MED | PR-10 | Test restore obligatoriu pe staging inainte de cutover prod |
| Lease lock race condition in scheduler | ðŸŸ¡ MED | PR-4 | Crash recovery la boot (B.18); lease timeout 20 min; teste vitest |
| Bulk name import nume popular returneaza >1000 | ðŸŸ¡ MED | PR-5 | Cap snapshot 1MB; warn UI cand >100 results; throttle |
| Email-uri in spam (SPF/DKIM gresit) | ðŸŸ¡ MED | PR-11 | Test cu multi-recipient pe staging; fallback in-app notification |
| Migration `0003_*` esueaza pe DB existing | ðŸŸ¡ MED | PR-3 | Pattern existing tested + idempotent CREATE IF NOT EXISTS |
| Solo dev burnout (10-13 sapt sustained) | ðŸŸ¡ MED | global | +20% buffer; un PR / saptamana realistic; nu pus presure |

---

## Ce NU facem (out-of-scope explicit)

- Mobile app (iOS/Android native).
- Multi-tenant workspaces (un singur tenant = firma).
- Pricing tiers / payment processing (interna, gratuita).
- Postgres migration (SQLite + Litestream forever pentru <100 useri).
- BYOK AI/captcha keys (centralized in server `.env` for web mode; desktop keeps local `safeStorage`).
- 2FA local app-side (Google Workspace gestioneaza).
- Public signup (numai useri din `@firma.ro` Workspace).
- Public signup / anti-bot captcha (gestionat by Workspace SSO). RNPM captcha provider keys raman server-side in web mode.
- Email verify (Google deja confirmat).
- GDPR DSAR public endpoints (admin manual delete suficient pentru intern).
- Advanced CSRF protection peste SameSite cookie (suficient pentru intern).

Vezi PLAN-monitoring-webmode.md Â§0 pentru rationale complet.

---

## Glosar non-IT

| Termen | Explicatie |
|---|---|
| PR | Pull Request â€” un set de schimbari de cod care merg impreuna intr-o livrare. |
| Migration | Script SQL care modifica structura DB-ului (tabele noi, coloane noi). Versionat ca sa fie reproductibil. |
| Schema | Structura DB-ului â€” ce tabele exista, ce coloane au. |
| SSO | Single Sign-On â€” login cu un singur cont (Google) care da acces la mai multe aplicatii. |
| OIDC / OAuth2 | Protocoale standard pentru SSO. Google le suporta nativ. |
| JWT | Token de autentificare semnat criptografic. Browser-ul il trimite la fiecare cerere. |
| SOAP | Protocol vechi de comunicare server-server (XML). PortalJust foloseste SOAP. |
| Snapshot | "Poza" la un moment dat â€” aici, lista de chei `sedintaKeys` la ultimul check. |
| Diff | Diferenta intre doua snapshots. Generam alerte din diff. |
| Cron / Scheduler | Mecanism care ruleaza task-uri automat la intervale regulate. |
| Litestream | Tool care replicheaza SQLite continuu la cloud (in cazul nostru GCS). |
| GCS / S3 | Google Cloud Storage / Amazon S3 â€” locul unde tinem backup-urile. |
| Service Account | Cont "robot" Google cu permisiuni specifice (in cazul nostru, scrie in bucket). |
| Idempotency | Daca dai click de 2 ori pe acelasi buton, se intampla o singura data. |
| Lease lock | Mecanism care impiedica 2 procese sa proceseze acelasi job in paralel. |
| Audit log | Tabel care inregistreaza toate actiunile importante (cine, ce, cand). |
| Hash-chain | Fiecare linie in audit log contine un hash al liniei anterioare â†’ tamper detection. |

---

## Cum folosesti acest document

1. **Inainte de fiecare saptamana**: deschide sectiunea respectiva, bifeaza ce ai facut.
2. **Cand incepi un PR nou**: citeste sectiunea PR-ul + sectiunea corespunzatoare din [PLAN-monitoring-webmode.md](PLAN-monitoring-webmode.md) (spec-ul tehnic detaliat).
3. **Cand inchei un PR**: bump version in `package.json`, update [CHANGELOG.md](CHANGELOG.md), tag git, merge la `main`.
4. **Daca un PR depaseste 1.5Ã— estimarea**: opreste-te si re-evalueaza. Mai bine spargi in 2 PR-uri mici decat 1 mare.
5. **La fiecare 2-3 PR-uri**: smoke test desktop (golden path: search â†’ analiza AI â†’ export) ca sa prinzi regresii devreme.

---

## Document history

- **v1.0** (2026-04-27): document creat initial dupa rezolvare deciziilor Â§11.2-1/2/3.
- **v1.1** (2026-04-27): Saptamana 1 (PR-0 + PR-1 + PR-2) marcata DONE; commits + version bumps inregistrate; smoke launch logs referenced.
- **v1.2** (2026-04-29): PR-4 + full-review hardening marcat DONE, tag `v2.2.0` publicat, PR-5 retargetat la `v2.3.0`.
- **v1.3** (2026-04-29): patch `v2.3.0` (audit remediation + export Web Worker) publicat; bump-urile PR-5..PR-8 renumerotate la `v2.4.0..v2.5.1` ca sa nu suprascrie patch-ul.
- **v1.4** (2026-04-29): PR-5 marcat livrat pe `main` ca `v2.4.0`; urmatorul PR este PR-6 Alerte UI + notificari desktop.
- **v1.5** (2026-04-30): PR-6 livrat ca `v2.4.1` + patch `v2.4.2` (full-review hardening: SSE heartbeat, audit pe seen/dismissed, bodyLimit, cap stream-uri/owner, focus suppress).
- **v1.6** (2026-04-30): PR-7 livrat ca `v2.5.0` (AI usage tracking: migration `0010_ai_usage`, cost integer milli, `/api/v1/ai-usage/summary`, panou Setari API) + patch `v2.5.1` (multi-review hardening: closed-lower-bound, UTC-midnight, `markShuttingDown` latch, `inflightRef` AbortController).
- **v1.7** (2026-04-30): PR-8 livrat ca `v2.6.0` (admin pages + roles guard: middleware `requireRole`, `/api/v1/me`, suprafata `/api/v1/admin/{users,audit,users/:id/quota}`, migration `0011_user_quota_overrides`, hook `useCurrentUser` + componenta `AdminGate`, sidebar conditional `Administrare`, trei pagini admin Users/Audit/Quota; guardrails irreversibile `last_admin` 409 si `self_deactivation` 409). 524/524 teste backend.
- **v1.8** (2026-05-01): patch-uri UX `v2.6.1` (alerte cu context dosar + identitate Windows), `v2.6.2` (card scaling + linkificare PortalJust + detail enrichment) si `v2.6.3` (TINTA link + cadenta non-standard onesta + Alerte pagination unified) inregistrate; audit hardening `v2.6.4` finalizat dupa multi-agent review: F1 DELETE in-flight 409, F2 fail-closed remote (`LEGAL_DASHBOARD_ACK_NO_AUTH` ack required) + middleware nou `originGuard` CSRF pe `/api/*`, F3 migrare `xlsx@0.18.5` → `exceljs@^4.4.0` in `nameListParser.ts` (async + safety belt 30s, `xlsx` mutat in devDependencies), F4-F6 enrichSolutie restrans (200/tick + 7d window + match relaxat), F7 SSE `alert_enriched`, F9 `POST /jobs/bulk-delete` atomic cu raport detaliat, F10 `alerts_created` reflecta inserturi reale + coloana noua `monitoring_runs.alerts_patched` (migration `0012`). **546/546 teste** (era 524 in v2.6.3, +22 noi).
- **v1.9** (2026-05-01): patch UX `v2.6.5` (frontend-only) Monitorizare: link-ul TINTA pentru joburi `dosar_soap` devine `font-bold` (consecvent cu pattern-ul "primary action surface" din inbox-ul Alerte); cardul "Adaugare bulk din fisier" devine collapsible cu state `bulkOpen` (default `false`) + icon `ChevronDown`/`ChevronRight`; descrierea cardului trece pe `text-foreground` (negru) cu text rescris in romana simpla pentru utilizatori non-tehnici (descarca → completeaza → incarca, fara mentiunea numelor de coloane); template-ul XLSX bulk rescris cu `xlsx-js-style` la nivelul exporturilor celorlalte (titlu `BLUE_DARK` merged A:E, header `BLUE_MAIN` border-bottom `1D4ED8` + `wrapText`, randuri alternate `ROW_ALT`/`WHITE`, font 10, dropdown cadenta mutat pe `C5:C1004` cu post-process OOXML prin `fflate`); `parseBulkFile` detecteaza header-ul dinamic prin `findHeaderRow()` ca template nou (header row 4) si fisiere vechi flat (header row 1) sa fie ambele acceptate fara forking; `downloadBulkTemplate` devine `async`; field-ul `notes` din formularul de monitorizare devine vizibil in tabel inline sub link+buton in **aceeasi celula TINTA**, conditionat pe `{job.notes && (…)}` ca randurile fara nota sa ramana compacte (text mic italic gri, truncate cu tooltip integral pe hover). 546/546 teste backend (neschimbate fata de v2.6.4).
- **v1.10** (2026-05-01): patch UX `v2.6.6` (frontend-only) Monitorizare — name_soap parity + swap coloane: butonul `Dosare` adaugat pe randurile `name_soap` (target `font-bold` + icon `Eye`, identic vizual cu randurile `dosar_soap`); click → prop nou `onOpenName(target)` propagat din `App.tsx` ca `handleHistoryClick("dosare", { numeParte: nume })`, reuseste flow-ul existent `pendingSearch` (SearchParams accepta deja optional `numeParte`); coloana TIP afiseaza "Nume" pentru `name_soap` (era "Subiect"), consecvent cu formularul de adaugare si cu coloana `nume` din template-ul XLSX (v2.6.5); ordinea coloanelor in tabel devine "Ultima rulare → Urmatoarea verif." (era invers) pentru lectura naturala fapte→predictie. 546/546 teste backend (neschimbate fata de v2.6.5 — modificari strict frontend label + render path).
- **v1.11** (2026-05-01): patch `v2.6.7` (frontend-only) export Monitorizare Excel + PDF cu paritate Dosare/Termene — butoane `Excel` + `PDF` adaugate in CardHeader "Joburi active" (vizibile cand `jobs.length > 0`), state partajat `exporting: "xlsx" | "pdf" | null` + `Loader2` spin pe butonul activ, `getExportJobs()` returneaza selectia (suffix `(N)`) sau toate joburile vizibile (pattern identic cu `DosareTable`); builderii noi `buildMonitoringXlsx(jobs)` + `buildMonitoringPdf(jobs)` in `frontend/src/lib/export.ts` reuseaza paleta de stiluri si helperii existenti — XLSX cu titlu `PORTALJUST DASHBOARD — MONITORIZARE` BLUE_DARK merged A:H, header BLUE_MAIN, randuri alternate ROW_ALT/WHITE font 10, 8 coloane (#, Tinta, Tip, Cadenta, Ultima rulare, Urmatoarea verif., Status, Note), `sanitizeFormulaCells` pe formula-injection guard; PDF landscape A4 helvetica cu header `[37,99,235]`, alternate row `[245,247,250]`, `stripDiacritics(...)` pe text, footer "Pagina N"; `ExportJob` discriminated union extins cu `monitoringXlsx` + `monitoringPdf`, dispatch in `frontend/src/lib/export.worker.ts` (build off main thread cu transferable buffer); filename pattern `monitorizare_<sanitized_target>.xlsx` (single) sau `monitorizare_<dataRO>.xlsx` (multiple). 546/546 teste backend (neschimbate fata de v2.6.4..v2.6.6 — patch frontend additive).
- **v1.14** (2026-05-03): patch v2.9.2 inregistrat - notificari native Windows/macOS cu status IPC, notificare test si gating defensiv peste alertele de monitorizare.
- **v1.15** (2026-05-03): PR-11 v2.10.0 inregistrat - email notifiers prin SMTP/nodemailer, setari per-owner, panou UI si scope clar fara digest/retry/PR-10/PR-12.
- **v1.16** (2026-05-03): patch v2.10.5 inregistrat - Task B/C din `CODEX-BACKLOG.md`: Dashboard KPI redenumit `Monitorizari active`, subline umanizat `X Dosare, Y Nume`, pagina Alerte cu tab-bar `Toate / Dosare / Nume` + search debounced dupa targetul jobului (`jobKind` + `q` pe `/api/v1/alerts`). Task A ramane neimplementat.
- **v1.17** (2026-05-03): patch v2.10.6 inregistrat - hardening review fara comportament nou (`useDebouncedValue` cu callback `flush`, `JobKindTabs` cu navigatie tastatura WAI-ARIA + roving tabindex, `escapeLikeMeta` extras si folosit in `auditRepository` + `userRepository`, JSDoc `@example` pe pairing `ESCAPE '\\'`); seeder `seed-test-alerts.cjs` sters; Task A scos din backlog si din memoria persistenta. 721/721 backend + 73/73 frontend.
- **v1.18** (2026-05-03): patch v2.10.7 inregistrat - `Monitorizare` afiseaza `Joburi active (${total})` pe totalul real al listarii paginated, nu pe `jobs.length` din pagina curenta; tooltip-urile Excel/PDF clarifica exportul pe joburile vizibile. Release targets: push `main` pentru Docker Build, tag `v2.10.7` pentru macOS DMG + Windows NSIS installer.
