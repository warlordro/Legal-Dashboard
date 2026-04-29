# Plan aprofundat — Monitorizare dosare/persoane + tranzitie web multi-user

> Status update 2026-04-29: PR-0..PR-4 sunt livrate pe `main` si tag-uite `v2.2.0`. Patch `v2.3.0` publicat in aceeasi zi (audit remediation hardening + export Web Worker pe RNPM + AI + Manual). PR-5 este retargetat operational la `v2.4.0` (renumerotat — `v2.3.0` consumat de patch-ul de audit remediation). Restul acestui document ramane spec tehnic istoric si roadmap de lucru.

**Status**: draft v1.3, 2026-04-26 (post-v2.0.10) — sinteza din 8 agenti + advisor double-check + context "uz intern <100 angajati, fara plati, Google Workspace SSO confirmat, 1 dev + Claude Code".
**Scope**: doua faze livrate **secvential** (nu intercalat), fiecare PR lasand desktop-ul functional.

**Strategie agreata cu user**:
- **Faza 1 — Foundations + Monitoring (PR-0..PR-7)**: feature complet pe desktop + scaffolding web invizibil (`owner_id` peste tot, `getOwnerId` helper, `/api/v1`, audit log, migrations framework). Aplicatia ramane desktop-first; ZERO cod scris in Faza 1 nu trebuie rescris la Faza 2.
- **Faza 2 — Web cutover (PR-8..PR-12)**: activam Google Workspace SSO, deploy server intern, migrare date desktop → web per angajat.

**Durata estimata pentru solo dev + Claude Code**: **10-13 saptamani calendar** (Faza 1: 6-8 sapt, Faza 2: 4-5 sapt). Era 6-8 sapt la 2 devs paraleli — solo cu asistenta nu e 2× mai lent dar fiecare PR are review + smoke manual care nu se paralelizeaza.

---

## 0. Principii directoare

1. **Auth seam first, payload dupa**. Nu adaugam features noi cu `ownerId = "local"` hardcodat. Introducem `getOwnerId(c)` care azi returneaza `"local"`, maine returneaza `c.get("user").id` din JWT — orice cod nou consuma helperul.
2. **APP_MODE=desktop|web** ca discriminator runtime, dar **un singur binar / o singura sursa**. Ramificatii prin DI (clock, lock, storage), nu prin fork-uri.
3. **Multi-tenant de la prima zi pentru features noi**. Monitorizarea + bulk-name lists nasc cu `owner_id NOT NULL` si vor fi compatibile web fara migrare ulterioara.
4. **Co-tranzactional dupa I/O**. SOAP/HTTP iesire intai (fara lock), commit sincron in tranzactie better-sqlite3 dupa, intr-un singur batch (alert + snapshot + cursor).
5. **Determinism & idempotenta**. Alertele au `dedup_key` UNIQUE per job; jobs au `clientRequestId` opt-in; cron tick-urile produc rezultat identic la replay.
6. **Kill switches inainte de features**. `MONITORING_ENABLED`, `AI_GLOBAL_DAILY_CAP_USD`, `WEB_MODE_ENABLED` exista ca flag-uri inca de la PR-1.

---

## 1. Arhitectura tinta (post-implementare)

```
┌──────────── desktop (Electron) ────────────┐   ┌──────── web (Node + Postgres/SQLite) ────────┐
│ main.js → in-process backend (port 3002)   │   │ docker → Hono backend (port 3002)            │
│ APP_MODE=desktop, owner_id="local"         │   │ APP_MODE=web, owner_id=user.id (uuid)        │
│ scheduler in-process (single instance lock)│   │ scheduler with leader election (advisory lk) │
│ no auth                                    │   │ JWT (httpOnly cookie) + refresh + admin role │
│ AI keys: safeStorage IPC                   │   │ AI keys: server-side env (workspace level)   │
└────────────────────────────────────────────┘   └──────────────────────────────────────────────┘
                          │                                          │
                          └─── shared core ──────────────────────────┘
                              repositories, soap client, captcha,
                              monitoring scheduler (impl identic),
                              alert engine, AI service, audit log
```

Decizii ferme:
- **DB engine**: SQLite ramane pe desktop. Pentru web revizuit la Litestream + SQLite single-writer pentru v3.0 (vezi B.9); Postgres este post-launch (PR-13+). Repository layer abstract — schimbam doar driver.
- **Job queue**: in-DB (tabel `monitoring_jobs` + `next_run_at` index partial `WHERE active=1`), NU Redis/BullMQ. Argumente: zero infrastructura noua pe desktop, throughput suficient (sute joburi/min), recovery trivial dupa restart.
- **AI quotas**: tabel `ai_usage` cu rolling window 24h, scris **dupa** SDK call (capturam tokens reali). Cap global daily $ + cap per-user request count.
- **Exemptie owner_id**: `rnpm_bunuri_descrieri` ramane content-addressable shared lookup (cheia primara = sha256 al continutului), exclus din `owner_id` rule per HARDENING.md CM5. Toate celelalte tabele (existente + noi) trebuie sa contina `owner_id NOT NULL`.
- **Migrations**: introducem `_schema_versions` table + ordered migration runner in **PR-0** (vezi §4) — astazi `initSchema()` aplica DDL idempotent ad-hoc; nu putem livra 7 tabele noi + tag 3.0.0 fara framework de migrari versionate.

---

## 2. Modelul de date complet (DDL)

DDL-uri scrise pentru SQLite. Pentru Postgres-port: `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL`, `TEXT CHECK(... IN ...)` → `enum`, `JSON TEXT` → `JSONB`.

### 2.1 Auth & users (introdus in PR-2 ca tabel "shadow", populat in PR-9)

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,                  -- uuid v7
  email         TEXT UNIQUE NOT NULL,              -- citizen-case email, lowercased
  password_hash TEXT,                              -- argon2id; NULL daca SSO-only
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user'
                CHECK(role IN ('user','admin','support','readonly')),
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('active','suspended','deleted')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  meta_json     TEXT NOT NULL DEFAULT '{}'         -- workspace, plan, feature flags
);

CREATE TABLE user_sessions (                       -- opaque refresh tokens (server-side only)
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,                -- sha256 al refresh-ului
  user_agent  TEXT,
  ip          TEXT,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id, revoked_at);

-- Pentru desktop, un singur "user" sintetic:
INSERT INTO users(id,email,display_name,role) VALUES
  ('local','local@desktop','Local User','user');
```

### 2.2 Monitoring core (PR-3 / PR-4 / PR-5)

**Validation strategy pentru coloanele `*_json`** (`target_json`, `alert_config_json`, `payload_json`, `detail_json`, ulterior `meta_json`, `params_json`):

- **Decizie**: Zod schemas la **route layer** + repository write helpers, **NU** `CHECK(json_valid(col))` inline in DDL.
- **De ce nu CHECK**: SQLite `json_valid()` valideaza doar JSON well-formedness, nu structure. Si mai important, daca adaugam in viitor `CHECK(json_valid(...))` pe coloana cu date istorice non-JSON (sau JSON laxat de un bug), migrarea forward esueaza pe DB-uri vechi — costless de evitat.
- **Implementare**:
  - `backend/src/schemas/monitoring.ts` exporta `TargetJsonSchema`, `AlertConfigSchema`, `SnapshotPayloadSchema`, `AlertDetailSchema` (Zod).
  - Route handlers PR-3+ apeleaza `Schema.parse(input)` inainte de write — failure → 422 cu `{error: {code: 'invalid_payload', issues: [...]}}`.
  - Repository write helpers (`monitoringJobRepo.create`, `snapshot.insert`, `alert.insert`) primesc `Type` (validated), serializeaza cu `JSON.stringify` la final.
  - Reader-side: `Schema.safeParse(JSON.parse(row.x_json))` cu fallback graceful (logheaza + returneaza valori default) pentru a supravietui drift istoric (ex: o cheie noua adaugata in alert_config_json post-PR-5 trebuie sa decoda OK pe rows din PR-3).
- **Test**: `schemas/monitoring-validation.test.ts` — happy path + reject (extra keys, wrong types, missing required) + forward-compat (citire row cu schema veche).

```sql
-- Job: cerere persistenta de a urmari un dosar SOAP sau o lista de nume
CREATE TABLE monitoring_jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id       TEXT NOT NULL,                    -- FK logic catre users(id)
  kind           TEXT NOT NULL
                 CHECK(kind IN ('dosar_soap','name_soap','aviz_rnpm')),
  -- Pentru dosar_soap: numar_dosar (string canonic, ex. "1234/180/2024")
  -- Pentru name_soap: name_normalized (folded), name_kind ('fizic'|'juridic'), institutie?
  -- Pentru aviz_rnpm: identificator (string)
  target_json    TEXT NOT NULL,                    -- JSON cu cheile relevante per kind
  target_hash    TEXT NOT NULL,                    -- sha256(canonicalJson(target)): chei sortate alfabetic, string fields lowercase + diacritic-strip per kind. Vezi util/canonicalJson.ts.
  cadence_sec    INTEGER NOT NULL DEFAULT 3600     -- min 600 (10 min), max 86400
                 CHECK(cadence_sec BETWEEN 600 AND 86400),
                 -- effective_cadence = max(cadence_sec, ceil(N_active_jobs_owner * 500ms / concurrency_per_owner))
                 -- aplicat in scheduler runtime; nu in DB.
  active         INTEGER NOT NULL DEFAULT 1,
  paused_until   TEXT,                             -- snooze UI
  alert_config_json TEXT NOT NULL DEFAULT '{}',    -- per-job config (imprumutat din HARDENING.md L296-309 absorbed):
                                                    --   notify_days_before: number[]   (ex: [14,7,3,1] multi-threshold)
                                                    --   notify_on_new_termen: bool     (default true)
                                                    --   notify_on_solution: bool       (default true; trigger 'solutie_aparuta')
                                                    --   notify_on_dosar_disappeared: bool (default false)
                                                    --   stadii?: string[]              (filtrare client-side dupa fetch — ex: ['Apel','Recurs'])
                                                    --   categorii?: string[]           (filtrare client-side — ex: ['Civil','Comercial'])
                                                    --   email_to?: string              (override per-job; altfel global owner setting)
  next_run_at    TEXT NOT NULL,                    -- ISO; scheduler ordoneaza dupa asta
  last_run_at    TEXT,
  last_status    TEXT CHECK(last_status IN ('ok','error','partial','skipped')),
  fail_streak    INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  client_request_id TEXT,                          -- opt-in idempotency la create
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(owner_id, target_hash, kind)              -- evita dubluri per user
);
-- INDEX critic pentru scheduler — partial, evita full scan pe joburi pauzate
CREATE INDEX idx_monitoring_due
  ON monitoring_jobs(next_run_at)
  WHERE active = 1 AND (paused_until IS NULL OR paused_until <= datetime('now'));
CREATE INDEX idx_monitoring_owner ON monitoring_jobs(owner_id, kind);
CREATE UNIQUE INDEX idx_monitoring_client_req
  ON monitoring_jobs(owner_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Snapshot: ultima oglinda observata pentru job (pentru diff & alert dedupare)
CREATE TABLE monitoring_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  job_id        INTEGER NOT NULL REFERENCES monitoring_jobs(id) ON DELETE CASCADE,
  observed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  payload_hash  TEXT NOT NULL,                     -- sha256 al payload-ului normalizat
  payload_json  TEXT NOT NULL                      -- compactat (whitespace-strip)
);
CREATE INDEX idx_snap_job_time ON monitoring_snapshots(job_id, observed_at DESC);

-- Alert: eveniment derivat din diff intre snapshot-uri sau aparitie noua
CREATE TABLE monitoring_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  job_id        INTEGER NOT NULL REFERENCES monitoring_jobs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL                       -- alert types (extins cu 'solutie_aparuta' si 'dosar_disappeared' din HARDENING.md absorption):
                CHECK(kind IN ('dosar_new','termen_new','termen_changed','solutie_aparuta','dosar_disappeared','aviz_changed','source_error')),
  severity      TEXT NOT NULL DEFAULT 'info'
                CHECK(severity IN ('info','warning','critical')),
  title         TEXT NOT NULL,
  detail_json   TEXT NOT NULL DEFAULT '{}',
  dedup_key     TEXT NOT NULL,                      -- ex: sha256("termen_new" || dosarId || dataTermen)
  is_new        INTEGER NOT NULL DEFAULT 1,         -- badge "NOU" pana user-ul vede (HARDENING absorption); reset la PATCH /alerts/:id/seen
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  read_at       TEXT,
  dismissed_at  TEXT,
  UNIQUE(job_id, dedup_key)                         -- key idempotency pentru alerts
);
CREATE INDEX idx_alerts_owner_unread ON monitoring_alerts(owner_id, read_at, created_at DESC);

-- Audit pentru run-uri (debugging + transparenta)
CREATE TABLE monitoring_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  job_id        INTEGER NOT NULL REFERENCES monitoring_jobs(id) ON DELETE CASCADE,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  status        TEXT NOT NULL CHECK(status IN ('running','ok','error','timeout','aborted')),
  http_status   INTEGER,
  error_code    TEXT,
  error_message TEXT,
  alerts_created INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER
);
CREATE INDEX idx_runs_job_time ON monitoring_runs(job_id, started_at DESC);
```

### 2.3 Bulk name lists (PR-5)

> **Constatare adversiala #6 (PR-4 review)** — politica FK pentru `name_list_items.list_id`
> trebuie sa fie `ON DELETE RESTRICT`, nu `ON DELETE CASCADE`. Motivare:
> joburile `name_soap` create dintr-o lista pastreaza un FK invers
> (`monitoring_jobs` ar avea `name_list_id` in PR-5); o stergere CASCADE a unei
> liste cu joburi active orfana run-urile / snapshot-urile / alertele asociate
> fara ca operatorul sa fie avertizat. RESTRICT forteaza ordinul corect:
> archive-job → archive-list → delete-list. Implementatorul PR-5 trebuie sa
> oglindeasca politica si pe noul FK invers (`monitoring_jobs.name_list_id
> REFERENCES name_lists(id) ON DELETE RESTRICT`) ca sa fie simetrica si sa
> elimine punctele tacute de pierdere de lineage.

```sql
-- Lista (import) — un fisier urcat de user devine o "lista" cu N nume
CREATE TABLE name_lists (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  title         TEXT NOT NULL,
  source_filename TEXT,
  source_sha256 TEXT NOT NULL,                      -- dedup uploads identice
  total_rows    INTEGER NOT NULL DEFAULT 0,
  valid_rows    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at   TEXT,
  UNIQUE(owner_id, source_sha256)
);

CREATE TABLE name_list_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  -- #6: RESTRICT (NU CASCADE) — sterge lista doar dupa ce items + joburile
  -- legate sunt arhivate explicit. Vezi banner-ul de mai sus.
  list_id       INTEGER NOT NULL REFERENCES name_lists(id) ON DELETE RESTRICT,
  name_kind     TEXT NOT NULL CHECK(name_kind IN ('fizic','juridic','unknown')),
  name_raw      TEXT NOT NULL,
  name_normalized TEXT NOT NULL,                    -- folded + lowercase + trim spaces
  cnp           TEXT,                               -- doar pentru fizic
  cui           TEXT,                               -- doar pentru juridic
  validation    TEXT NOT NULL DEFAULT 'ok'         
                CHECK(validation IN ('ok','warn','rejected')),
  validation_msg TEXT,
  -- SET NULL aici e ok: stergerea jobului doar rupe lineage-ul invers (item-ul
  -- ramane in lista), iar `archived_at` la nivel de job ofera un soft-delete
  -- care pastreaza informatia. RESTRICT s-ar bate aici cu retentia automata.
  monitoring_job_id INTEGER REFERENCES monitoring_jobs(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_nli_owner_list ON name_list_items(owner_id, list_id);
CREATE INDEX idx_nli_norm ON name_list_items(owner_id, name_normalized);
```

### 2.4 AI quota & audit (PR-7)

```sql
CREATE TABLE ai_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  ts            TEXT NOT NULL DEFAULT (datetime('now')),
  provider      TEXT NOT NULL CHECK(provider IN ('anthropic','openai','google')),
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd_milli INTEGER NOT NULL DEFAULT 0,        -- preview pret (×1000), fara floats
  http_status   INTEGER,
  was_aborted   INTEGER NOT NULL DEFAULT 0,
  request_id    TEXT,                               -- correlation id
  feature       TEXT NOT NULL                       -- 'dosar_summary','termene_analysis',...
);
CREATE INDEX idx_ai_usage_owner_time ON ai_usage(owner_id, ts DESC);
CREATE INDEX idx_ai_usage_global_time ON ai_usage(ts DESC);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT,                               -- nullable pentru evenimente sistem
  actor_id      TEXT,                               -- userId real care a facut actiunea (poate fi admin pentru ownerId altcuiva)
  ts            TEXT NOT NULL DEFAULT (datetime('now')),
  action        TEXT NOT NULL,                      -- 'login','monitoring.create','admin.suspend_user',...
  target_kind   TEXT,
  target_id     TEXT,
  outcome       TEXT NOT NULL DEFAULT 'ok'         CHECK(outcome IN ('ok','denied','error')),
  ip            TEXT,
  user_agent    TEXT,
  detail_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_owner_time ON audit_log(owner_id, ts DESC);
CREATE INDEX idx_audit_actor_time ON audit_log(actor_id, ts DESC);
```

### 2.5 Migration plan (PR-2 → PR-9)

- **PR-2**: introduce `users`, `user_sessions`, `audit_log` ca tabele dar **nu schimba comportament** — desktop continua cu `owner_id="local"`. Trigger seed `local` user.
- **PR-3 → PR-7**: tabelele noi (monitoring_*, name_lists*, ai_usage) folosesc `owner_id NOT NULL`, populat de helperul `getOwnerId(c)` care inca returneaza `"local"`.
- **PR-9 (web mode)**: schimbi `getOwnerId` sa intoarca `c.get('user').id`. **Zero rewrite la rutele monitoring/name** — pentru ca toate sunt deja owner-scoped.
- **PR-9 add-on**: dual-column migration daca trebuie reuse pe `rnpm_avize`/`searches` legacy: pastram `owner_id` TEXT (NULL allowed temporar), backfill `owner_id='local'` deja exista, viitorul user real e tot TEXT (uuid). Deci **nu e nevoie de dual-column** — coloana ramane TEXT, semantica se largeste.

---

## 3. Latent leaks owner_id — fix list (PR-1)

Identificate de database-change-reviewer. Toate sunt in [backend/src/db/avizRepository.ts](backend/src/db/avizRepository.ts).

| # | Linie | Problema | Fix |
|---|---|---|---|
| 1 | [272](backend/src/db/avizRepository.ts#L272) | `SELECT * FROM rnpm_creditori WHERE aviz_id = ?` — fara `owner_id` filter | Adauga `AND owner_id = ?` si pasa `aviz.owner_id` |
| 2 | [273](backend/src/db/avizRepository.ts#L273) | idem `rnpm_debitori` | idem |
| 3 | [276-283](backend/src/db/avizRepository.ts#L276-L283) | JOIN bunuri + bunuri_descrieri fara `b.owner_id` | `WHERE b.aviz_id = ? AND b.owner_id = ?` |
| 4 | [292](backend/src/db/avizRepository.ts#L292) | `rnpm_istoric WHERE aviz_id = ?` | `AND owner_id = ?` |
| 5 | [353-354](backend/src/db/avizRepository.ts#L353-L354) | EXISTS pe creditori/debitori in `getAvize` filter | `AND c.owner_id = a.owner_id` (idem `d`) |

**De ce e "latent"**: pe desktop singurul `owner_id` e `'local'` — nimic nu leak-uieste azi. **In web mode** un user A poate cunoaste un `aviz_id` (din leak side-channel) si cere `loadAvizChildren` indirect prin `getAvizById`, care _filtreaza_ aviz-ul, dar copiii lui sunt incarcati fara owner check — daca un FK breach apare vreodata (bug de migrare, restore partial), child-ul user-ului B s-ar livra catre user A.

**PR-1 = lock down before any user-facing rewiring.** Test de regresie: `repository-isolation.test.ts` (vezi sectiunea 7).

---

## 4. Sequencing pe 12 PR-uri

Fiecare PR e merge-ready, lasa desktop functional, are tag de version bump si rollback safe.

| PR | Titlu | Scop | Bump | Risk |
|---|---|---|---|---|
| **PR-0** | Migration framework | Tabel `_schema_versions(version INTEGER PRIMARY KEY, applied_at, sha256_up)`, runner ordonat din `backend/src/db/migrations/NNNN_*.up.sql` + `*.down.sql`. **Backfill explicit**: la bootstrap pe DB existing, scrie `version=1, sha256_up='__backfilled_v1__'` (sentinel constant) + commit `0001_baseline.up.sql` real cu DDL-ul curent extras pentru consistenta CI. Runner skip-uieste verificarea hash daca vede sentinel. Bootstrap aplica `2..latest` ordonat. Migration files citite **doar la boot** (sync `fs.readdirSync` ok aici, nu in handler — CQ-6 conform). **PR-0 nu blocheaza PR-1** (PR-1 nu adauga DDL nou, doar fix queries existing). | 2.0.11 patch | LOW |
| **PR-1** | `getOwnerId` helper + owner_id leak fix | Helper `c.get('ownerId')` returneaza `"local"`, toate route-urile noi il vor folosi. Aplica fix-urile din §3. | 2.0.12 patch | LOW |
| **PR-2** | DDL users/sessions/audit (shadow) | Tabele noi populate cu seed `local`. `audit_log` exporta interfata `recordAudit(c, action, ...)` consumata in PR-3+. Migration `0002_users_sessions_audit.up.sql` cu down complet. | 2.0.13 patch | LOW |
| **PR-3** | Monitoring core: schema + repo + job factory | DDL `monitoring_jobs/snapshots/runs/alerts`. Repository pure. UI minimal: lista joburi (read-only). Scheduler dezactivat (`MONITORING_ENABLED=false`). **Toate rutele noi sub `/api/v1/*` cu envelope `{data, error?: {code,message}, requestId}`.** Rutele legacy `/api/*` (dosare, termene, rnpm, ai) raman intacte cu shape-ul existent pana la PR-9 (zero risk de regresie pe desktop in Faza 1). | 2.1.0 minor | LOW |
| **PR-4** | Monitoring scheduler + dosar_soap kind | Tick worker, locking, retries, run loop. Doar `kind=dosar_soap`. Flag flip: `MONITORING_ENABLED=true` default desktop. **DoD include `load-test/monitoring-jobs.k6.js`** care simuleaza 1000 jobs scheduled la cap concurrency=3 si verifica p95 latency `POST /api/v1/monitoring/jobs` < 500ms + zero error la tick worker dupa 10 minute (CP-7 conform). | 2.2.0 minor (livrat cu full-review hardening) + patch 2.3.0 (audit remediation: backup zilnic recurent, restore SQLite cu PRAGMA integrity check, graceful shutdown drain 30s, idx_one_running_per_job, RNPM in maintenance lock, audit pe rute destructive RNPM, migration runner self-heal bidirectional, export Web Worker pe RNPM + AI + Manual) | MEDIUM |
| **PR-5** | Bulk name import + name_soap kind | UI upload XLSX/CSV, parser cu validation, two-phase preview→commit. Genereaza `name_list_items` si optional joburi `name_soap`. | 2.4.0 minor (renumerotat — 2.3.0 consumat de patch-ul de audit remediation) | MEDIUM |
| **PR-6** | Alerte UI + notificari desktop | Inbox, dedup, filter, mark read/dismiss. Toast + Electron native notification. SSE stream `GET /api/v1/alerts/stream`. **DoD include EventSource cleanup la unmount** (`useEffect(() => { const es = new EventSource(...); return () => es.close(); }, [])`) + reconnect-with-backoff la disconnect (CQ-5 + CQ-8 conform). | 2.4.1 minor | LOW |
| **PR-7** | AI usage tracking + per-user quota | `ai_usage` write-after-call, daily/24h sliding window check inainte. UI usage panel pe Setari. Pe desktop quota=infinit (bypass). | 2.5.0 minor | LOW |
| **PR-8** | Admin pages + roles guard | `/admin/users`, `/admin/audit`, `/admin/quota`. Middleware role-check pe `*/admin/*`. Pe desktop ascunse din UI dar accesibile pentru testing. | 2.5.1 minor | LOW |
| **PR-9** | Auth wire-up: **Google Workspace SSO** + data export/import desktop→web | Activare `getOwnerId` din JWT post-OIDC. OAuth2/OIDC flow cu Google ca IdP unic. Login local doar pentru `admin` (escape hatch daca SSO down). Buton "Export desktop data" (ZIP) + admin "Import for user X". **Breaking pe web mode doar** — desktop ramane backward-compatible (rutele legacy `/api/*` neatinse, AI keys via safeStorage, port 3002 in-process). Major bump 3.0.0 reflecta noul transport web + cutover envelope `/api/v1/*`. **DoD include update `.env.example`** cu `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `WORKSPACE_DOMAIN`, `PUBLIC_URL` (CP-2 conform). | 3.0.0 major | HIGH |
| **PR-10** | Litestream backup automat (GCS) | SQLite + Litestream replicare continua spre Google Cloud Storage `gs://legal-dashboard-backups/db` (regiunea `europe-west3`). Filesystem flock pentru leader election (un singur scheduler activ la un moment dat). Vezi config snippet sub tabel. **DoD include update `.env.example`** cu `GOOGLE_APPLICATION_CREDENTIALS`, `LITESTREAM_BUCKET`, `LITESTREAM_REGION`. | 3.1.0 minor | MEDIUM |
| **PR-11** | Email notifiers (Google SMTP/relay) + cron jitter | Trimitem alertele si pe email-ul Workspace al userului. SMTP via Google relay sau provider extern. **DoD include update `.env.example`** cu `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `CONTACT_EMAIL`. | 3.2.0 minor | MEDIUM |
| **PR-12** | Hardening final: hash-chain audit, retention cron, GDPR delete simplu | Hash-chain pe audit_log (compliance interna). Cron purge `monitoring_runs` 90 zile, `audit_log` 1 an. Admin "delete user data" cu cascade. | 3.3.0 minor | MEDIUM |

**Cadenta pentru solo dev + Claude Code**:
- **Faza 1 (PR-0..PR-7)**: 6-8 saptamani. PR-0..PR-2 = 1 sapt (foundations rapide). PR-3+PR-4 = 2-3 sapt (logica scheduler + diff e zona cu cel mai mare risc — atentie review). PR-5..PR-7 = 2-3 sapt.
- **Faza 2 (PR-8..PR-12)**: 4-5 saptamani. PR-8+PR-9 = 2 sapt (admin UI + Google OIDC integration cu test pe Workspace real). PR-10..PR-12 = 2-3 sapt.
- **Tampon recomandat**: +20% pentru cazuri neasteptate la integrarea Google OIDC (config Workspace, scope-uri OAuth, restrictii admin).

**PR-10 Litestream config concret** (`/etc/litestream.yml` pe serverul Linux):

```yaml
# Path-ul DB-ului local pe server (single source of truth)
dbs:
  - path: /var/lib/legal-dashboard/legal-dashboard.db
    replicas:
      # Primary: Google Cloud Storage europe-west3 (Frankfurt) — single-vendor cu Workspace SSO
      - type: gcs
        bucket: legal-dashboard-backups
        path: db
        # Service Account JSON cu rol "Storage Object Admin" pe bucket
        # Calea catre fisier credentials e in env: GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/litestream-sa.json
        # Snapshot interval: 24h; retention: 30 zile (config Litestream native)
        retention: 720h
        snapshot-interval: 24h
        sync-interval: 10s
```

**Setup minimal in Google Cloud Console** (one-time, ~30 min):
1. Creeaza bucket `legal-dashboard-backups` (region `europe-west3`, storage class `Standard`, retention policy 30 zile).
2. Creeaza Service Account `litestream-replicator@<project>.iam.gserviceaccount.com` cu rol `roles/storage.objectAdmin` doar pe acest bucket (nu pe project-wide).
3. Genereaza JSON key, salveaza la `/etc/secrets/litestream-sa.json` (permissions 600, owner litestream).
4. `systemctl enable --now litestream` (unit file standard din docs Litestream).

**Restore in caz de disaster**:
```bash
# Pe un server nou (sau dupa wipe accidental):
litestream restore -o /var/lib/legal-dashboard/legal-dashboard.db gs://legal-dashboard-backups/db
# Durata: ~minute pentru DB ~100MB. Pierdere date: maxim ultimele 10s (sync-interval).
```

**Cost realist EU**: la 100MB DB + ~50MB audit growth/an, dupa 5 ani = 350MB. Egress + storage = <$0.50/luna. Cost incremental = neglijabil.

---

## 5. Specificatii detaliate per feature

### 5.1 Monitorizare dosare (PR-3 + PR-4)

**Scope flow**:
1. User selecteaza un dosar in tabel/modal → buton "Monitorizeaza".
2. POST `/api/v1/monitoring/jobs` `{kind:'dosar_soap', target:{numarDosar:...,institutie:...}, cadence_sec: 3600}`.
3. Server creeaza `monitoring_jobs` row cu `next_run_at = now() + jitter(0..60s)`.
4. Scheduler tick (60s):
   - SELECT `WHERE active=1 AND next_run_at <= now()` LIMIT N.
   - Pentru fiecare: marker `last_status='running'` sub lock.
   - Run: SOAP `cautareDosare({numarDosar, institutie}, {signal: timeout(30s)})`.
   - **Diff** (port conceptual din Portal Just Integrat `Monitorizare.tsx:516-578` + HARDENING.md L298-339 absorption, vezi §11.2bis):
     - **NU** hash-uim payload-ul intreg. Construim **set de chei stabile**:
       ```ts
       // Stadiu inclus ca prim segment (HARDENING absorption: un dosar poate avea termene
       // simultan in fond + apel — fara stadiu, sync-ul ar suprascrie unul cu celalalt).
       buildSedintaKey(s) =
         `${normalizeStadiu(s.stadiuProcesual)}|${normalizeData(s.data)}|${normalizeOra(s.ora)}|${s.complet || ''}|${s.solutie || ''}`
       // normalizeData: SOAP returneaza '2026-04-19T00:00:00' SAU '2026-04-19' SAU '2026-04-19 10:00' → strict slice(0,10)
       // normalizeOra: '10:0' / '10:00' / '' → padStart 2 (HH:MM)
       // normalizeStadiu: lowercase + diacritic strip + trim
       ```
     - `snapshot_json` = `{ sedintaKeys: string[], lastDosarPresent: boolean, sedinteWithSolution: Record<sedintaKeyFara_solutie, boolean> }`. Ultimul camp e necesar pentru detectia `solutie_aparuta` (compara cheia fara segmentul `solutie`).
     - **Logic alert** (extinsa):
       - Daca `previous == null` SAU `previous.lastDosarPresent == false` → `kind='dosar_new'`, severity=`info`.
       - Pentru fiecare cheie noua in `current.sedintaKeys \ previous.sedintaKeys` → `kind='termen_new'`, severity=`info`.
       - Pentru chei identice cu `data` schimbata → `kind='termen_changed'`, severity=`warning` (compara per `${stadiu}|${complet}` invariant).
       - **`solutie_aparuta`** (HARDENING absorption): pentru fiecare sedinta unde `previous.sedinteWithSolution[k] == false && current.sedinteWithSolution[k] == true` (solutie a trecut din null in non-null) → `kind='solutie_aparuta'`, severity=`warning`. Trigger separat de `termen_changed` pentru ca semantic e altceva pentru user (verdictul e gata vs sedinta s-a re-programat).
       - **`dosar_disappeared`** (edge case nou): SOAP returneaza 0 dupa ce era `lastDosarPresent=true` → `kind='dosar_disappeared'`, severity=`warning`. Suppressed daca `alert_config_json.notify_on_dosar_disappeared == false` (default false — dosarele dispar des temporar din PortalJust din indexare). Snapshot updated cu `lastDosarPresent=false` dar pastram `sedintaKeys` pentru cazul ca revine.
     - Daca set-uri identice + niciun trigger: skip insert snapshot, doar update `last_run_at` (economiseste WAL bloat).
     - **Filtrare pre-diff** (HARDENING absorption — `alert_config_json.stadii/categorii`): aplicat post-fetch, pre-buildSnapshot. Daca jobul are `stadii=['Apel']`, sedinte din `Fond` ignorate complet (nu fac parte nici din current, nici din previous). User schimbarea filtru → reset snapshot la `null` (forteaza re-baseline, evita false positive `dosar_new`).
     - **Threshold proximity alerts** (HARDENING absorption — `alert_config_json.notify_days_before: [14,7,3,1]`): la fiecare run, dupa diff, evalueaza si proximity: pentru fiecare termen viitor cu `daysUntil(termen.data) IN notify_days_before` si fara alert anterior cu `dedup_key=sha256('proximity'||jobId||termenKey||threshold)` → emit alert proximity. Cap: max 1 alert per termen per threshold.
   - Commit: tranzactie better-sqlite3 sync care insert snapshot + alerts (`INSERT OR IGNORE` pe `UNIQUE(job_id, dedup_key)`) + update `monitoring_jobs.last_run_at, next_run_at = now() + cadence_sec ± jitter, fail_streak=0`.
5. Pe failure (retry-able):
   - `fail_streak++`, `next_run_at = now() + min(60s * 2^fail_streak, 3600s) + jitter(0..60s)`.
   - Dupa 5 fail-uri consecutive: `last_status='error'`, alert `severity=warning kind=source_error`, `next_run_at = now() + 1h`.

**Reliability defaults** (calibrate la empirical existing — vezi [batch-dosare.ts:10](backend/src/services/batch-dosare.ts#L10) unde `PARALLEL_BATCH_SIZE=3` a fost masurat ca prag PortalJust):
- Tick interval: **60s** (configurable `MONITORING_TICK_SEC`).
- Concurrency global SOAP scheduler: **3** (`MONITORING_MAX_CONCURRENT_SOAP=3`). NB: redus de la valoarea initiala 5 pentru ca user-ul poate rula in paralel `batchFetchDosare` care deja ocupa 3 paralel — combinat ar atinge 8 si triggher 503 PortalJust. Constrans la 3 inseamna ca atunci cand user-ul face cautare interactiva, scheduler-ul cedeaza (verifica `globalSoapInflight < cap`).
- Inter-request delay: **500ms** intre joburi consecutive (politete catre PortalJust).
- User-Agent fix: `LegalDashboard/<version> (+contact:<env CONTACT_EMAIL>)` — identificare clara la upstream.
- Per-job wall clock: **10 min** (incl. retries).
- Boot jitter: 0-300s la pornire scheduler (evita burst dupa restart).
- Steady jitter: 0-60s pe `next_run_at` calculation (evita aliniere).
- Shutdown drain: **15s** (signal aborts toate run-urile active, salveaza `status='aborted'`).
- **Cancellation cooperativa**: cand user dezactiveaza un job (`active=0`) sau il sterge in timp ce ruleaza, run-ul curent primeste abort prin signal, se salveaza `status='aborted'`, alertele *deja inserate in tx anterioara* raman.
- **Crash recovery la boot** (B.18): `monitoring_runs` cu `status='running'` si `started_at < now() - 2 × wallClockMax` (deci > 20 min) → marcate `status='aborted'`, `error_code='boot_recovery'` la pornire scheduler. Fara asta, joburile orfanate raman blocate pentru ca tick-ul nu le re-prinde (nu sunt due dupa `next_run_at`, dar `last_status='running'` ar bloca rerun in implementarea naive). De asemenea, `monitoring_jobs.last_status='running'` se reseteaza la `'aborted'` corespunzator.

**Interactiuni cu sistemul existent**:
- Reuse `batchFetchDosare` doar daca jobul e `kind='name_soap'` (cautare dupa parte la procese). Altfel direct `cautareDosare`.
- `AbortSignal.any([wallClockSignal, shutdownSignal])` propagat in fetch.
- `withMaintenanceLock` (din [backup.ts](backend/src/db/backup.ts)) extins: scheduler trebuie sa astepte backup; backup-ul nu trebuie sa astepte scheduler. Implementare: `RWLock` cu backup ca writer exclusiv, scheduler ca shared-read (multiplu in paralel).

### 5.2 Bulk name import (PR-5)

**Flow**:
1. User upload XLSX/CSV in pagina "Nume monitorizate".
2. Frontend POST `/api/v1/name-lists/preview` `multipart/form-data` (max 10 MB, max 50000 rows).
3. Server:
   - Parser cu `xlsx` (deja in deps) sau `csv-parse` (de adaugat).
   - Headers detectati: `nume`, `tip` (`fizic`/`juridic`), optional `institutie`. Daca `tip` lipseste → default `fizic` cu `validation='warn'` ("tip lipsa, presupus PF").
   - Returneaza preview JSON `{rows: [{name, kind, validation, msg}], totals: {ok, warn, rejected}, sha256}`.
   - **Nu persista nimic inca**.
4. User confirma in UI ce import-eaza, da titlu listei → POST `/api/v1/name-lists` `{title, sha256, only_validations:['ok','warn']}`.
5. Server:
   - `INSERT name_lists` (UNIQUE(owner_id, source_sha256) — dedup).
   - `INSERT name_list_items` batch (transaction).
   - Optional: `auto_create_jobs:true` → fiecare row genereaza `monitoring_jobs(kind='name_soap')`. Throttle: max 100 joburi noi / cerere; restul async via background process.
6. Scheduler ruleaza joburi `name_soap`:
   - `cautareDosareDupaParte({nume, institutie?}, {signal})`.
   - Captura imbogatita (varianta B — vezi rationale mai jos): `{version: 1, fetched_at, dosare: [{numar, stadiu, categorie, instanta}]}`. Cheia de identitate ramane `numar`; `stadiu` / `categorie` / `instanta` sunt atribute monitorizate.
   - Diff per element pe `numar`:
     - `numar` aparut nou → alerta `dosar_new`.
     - `numar` disparut → alerta `dosar_disappeared` (configurabila prin `notify_on_dosar_disappeared`).
     - acelasi `numar` cu `stadiu` modificat → alerta `stadiu_changed`.
     - acelasi `numar` cu `categorie` modificata → alerta `categorie_changed`.
     - intrare/iesire din filtrul `alert_config.stadii` sau `alert_config.categorii` → alerte `dosar_relevant_now` / `dosar_no_longer_relevant`.
   - Cheia dedup pe alerta: `${kind}|${numar}|${tranzitie}` (NU `runId`) — flapping pe acelasi dosar nu creeaza alerte duplicate la fiecare oscilare a portalului.
   - Plafon captura: 1 MB pe `payload_json`. La depasire (nume foarte popular, > ~3000 dosare): trunchiere + emite `source_error` cu cod `SNAPSHOT_OVERSIZE` si recomandare in mesaj sa filtreze prin institutie.
   - Filtrele `alert_config.stadii` / `alert_config.categorii` se aplica la pasul de emit alerta, nu la salvarea capturii — schimbarea filtrului ia efect imediat fara reseed.

**De ce captura imbogatita (varianta B), nu doar lista de numere (varianta A)**:
A pierde tocmai semnalul valoros: cand un dosar trece din `Fond` in `Apel` dar `numar` ramane acelasi, setul de numere e identic intre tic-uri si diff-ul vede `{}`. Utilizatorul cu filtru `stadii: ["Apel"]` nu primeste alerta desi tranzitia il intereseaza direct. B detecteaza tranzitia si emite alerta corespunzatoare. Costul suplimentar (~200 octeti per dosar × pana la cateva mii de dosare = sub plafonul 1 MB cu marja larga) e justificat. Coerent cu captura `dosar_soap` care deja salveaza `sedintaKeys` + `sedinteWithSolution` (set imbogatit, nu lista plata).

**Validation rules** (intrari import lista nume):
- `name_normalized`: lowercase + diacritic strip + collapse whitespace.
- `name_kind`: `fizic` | `juridic`. Lipsa → default `fizic` + `validation='warn'`.
- Reject: nume empty, < 2 chars, > 200 chars, contine doar cifre.
- Dedup intra-fisier: `(name_normalized, name_kind)` apare 1×; duplicatele primesc `validation='warn'` cu `msg='duplicate_in_file'` si NU genereaza job.

**In afara perimetrului** (decis explicit): validare CNP/CUI. PortalJust SOAP `cautareDosareDupaParte` accepta doar string nume + tip (PF/PJ); CNP/CUI nu sunt cheie de cautare. Daca apare un caz de utilizare viitor (ex: alerta "cand CNP X devine debitor pe RNPM"), va fi legat de modulul RNPM, nu de monitoring SOAP.

### 5.3 Tranzitie web (PR-9)

**Auth wire**:
- `POST /api/v1/auth/signup` `{email, password, displayName}` → 201 `{user, accessToken}` (refresh in httpOnly cookie).
- `POST /api/v1/auth/login` → idem.
- `POST /api/v1/auth/refresh` → noul access token.
- `POST /api/v1/auth/logout` → revoke session.
- Middleware `requireAuth(c)` parse JWT din `Authorization: Bearer` sau cookie, set `c.set('user', {id, role, email})`.
- `getOwnerId(c)` = `c.get('user')?.id ?? (APP_MODE==='desktop' ? 'local' : null)`. Daca `null` → 401.

**Admin role**:
- Middleware `requireRole('admin')` pe rute `/api/v1/admin/*`.
- Endpoints: list users, suspend, reset password, view audit, set quota override, force-cancel job.

**AI quotas** (PR-7 details, rule on PR-9):
- Inainte de AI call: `SELECT SUM(cost_usd_milli) FROM ai_usage WHERE owner_id=? AND ts > datetime('now', '-1 day')`.
- Compara cu user.quota.daily_limit_usd (default 1.00 USD pentru free tier).
- Daca > limit: 429 `{error: {code:'quota_exceeded', message:..., details:{used, limit, resets_at}}}`.
- Dupa AI call: insert real `ai_usage` cu tokens reale. Daca abort: insert cu `was_aborted=1` si cost partial estimat.
- Global cap: `AI_GLOBAL_DAILY_CAP_USD` (env), check identic peste toti user-ii. Hit → 503 `service_overloaded`.

---

## 6. API contract (PR-3+, web-ready)

**Path versioning**: `/api/v1/...` peste tot. Endpoint-urile vechi `GET /api/dosare` etc. redirect 301 la `/api/v1/dosare` in PR-9 (cu transition header in PR-3 sa anunte).

**Standard error envelope**:
```json
{
  "error": {
    "code": "validation_error",
    "message": "name is required",
    "details": { "field": "name" }
  },
  "requestId": "req_a1b2c3"
}
```
Coduri standard: `validation_error`, `not_found`, `unauthorized`, `forbidden`, `quota_exceeded`, `conflict`, `rate_limited`, `internal_error`, `upstream_error`.

**Pagination**:
- Default: offset+total `{items, total, page, pageSize}` (consistent cu legacy).
- Pentru `monitoring_alerts` → cursor (`?after=ts:id`) pentru ca volumul creste fara limita; offset+total nu scaleaza.
- Pentru `audit_log` → cursor.

**Endpoints noi (PR-3 → PR-7)**:

```
# Monitoring
GET    /api/v1/monitoring/jobs?page=&pageSize=&kind=&active=
POST   /api/v1/monitoring/jobs             # body: {kind, target, cadence_sec, clientRequestId?}
GET    /api/v1/monitoring/jobs/:id
PATCH  /api/v1/monitoring/jobs/:id         # active, paused_until, cadence_sec, notes
DELETE /api/v1/monitoring/jobs/:id
POST   /api/v1/monitoring/jobs/:id/run     # manual trigger → 202 + run id
GET    /api/v1/monitoring/jobs/:id/runs?cursor=
GET    /api/v1/monitoring/jobs/:id/snapshots?cursor=

# Alerts
GET    /api/v1/alerts?cursor=&unread=true&kind=
PATCH  /api/v1/alerts/:id                  # {read|dismissed}
POST   /api/v1/alerts/mark-all-read
GET    /api/v1/alerts/stream               # SSE: text/event-stream

# Name lists
POST   /api/v1/name-lists/preview          # multipart, returns {rows, totals, sha256}
POST   /api/v1/name-lists                  # commit
GET    /api/v1/name-lists?page=&pageSize=
GET    /api/v1/name-lists/:id/items?page=
DELETE /api/v1/name-lists/:id

# AI usage
GET    /api/v1/me/ai-usage?period=24h|7d|30d   # {used, limit, by_provider, by_feature}

# Auth (PR-9)
POST   /api/v1/auth/signup
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

# Admin (PR-8)
GET    /api/v1/admin/users?page=&search=
PATCH  /api/v1/admin/users/:id             # role, status, quota_override
GET    /api/v1/admin/audit?cursor=&actor=&action=
GET    /api/v1/admin/quota/overview        # global usage today, top users
```

**OpenAPI**: integram `@hono/zod-openapi` din PR-3 — fiecare ruta noua e descrisa de schema Zod care genereaza si validation runtime + types frontend (via `@hono/client`). Eliminam drift contract-implementare.

---

## 7. Strategie de testare

**Foundation existing**: 62 teste vitest, real SQLite (in-memory + tmpdir). NU mockuim DB-ul.

**Test files noi**:

| File | Scop | Critical asserts |
|---|---|---|
| `repository-isolation.test.ts` | Table-driven: pentru fiecare repo function, creeaza date pentru owner A si B, asserta ca query owner A nu vede nimic owner B. Catcher pentru tot **§3** + viitoare repos. | Daca un select uita `WHERE owner_id`, suite pica. |
| `monitoring/scheduler.test.ts` | Injectam `Clock` interface (NU `vi.useFakeTimers`, sa fie portabil). Test tick → due jobs → run → next_run_at advanced. | Determinism, retry math, jitter range. |
| `monitoring/diff-engine.test.ts` | Snapshot diff → alerts. Cazuri: identic, schimbat, sterse fields, date format ambiguu. | Dedup_key stable cross-runs. |
| `monitoring/scheduler-concurrency.test.ts` | Boot 100 joburi, concurrency cap=5, asserta SOAP mock primit max 5 paralel. | No leaks la job state. |
| `name-lists/parser.test.ts` | XLSX/CSV cu edge-cases: BOM, diacritice, randuri goale, cifre interpretate ca number. | sha256 stability. |
| `auth/jwt.test.ts` | Sign, verify, expired, tampered. Refresh rotation. | No "alg=none" leak. |
| `quota/ai-quota.test.ts` | Sliding 24h, abort partial cost, global cap. | Race-free under parallel callers. |
| `api/error-envelope.test.ts` | Toate rutele noi → format `{error, requestId}`. | No raw 500 strings. |
| `migrations/up-down.test.ts` | Roll forward + roll back fiecare migration noua. | DDL idempotent. |

**Infrastructure**:
- Mock la **SDK boundary** (Anthropic, OpenAI, Google, fetch SOAP) prin DI — NU prin `vi.mock`. Fiecare service are constructor cu deps explicite.
- Real SQLite intotdeauna. Tmpdir per test, cleanup in afterEach.
- **CI rule (lint-grade)**: `eslint-plugin-no-network` pe `*.test.ts` — orice import `node:net`/`node:http` blocheaza CI.
- Coverage target: 80% pe core (scheduler, diff, repos owner-isolation, auth). Restul best-effort.

**Smoke E2E** (manual, pre-release):
- Desktop: instaleaza pe VM curat, creeaza job, astepta tick, verifica alerta.
- Web: docker compose up + signup A si B, asserta izolare cross-user prin DevTools network.

---

## 8. Observabilitate & rollout

### 8.1 Feature flags (env, default sigur)

```
APP_MODE=desktop|web                    # discriminator — toate optiunile depind de el
MONITORING_ENABLED=true|false           # kill switch global pentru scheduler
MONITORING_TICK_SEC=60
MONITORING_MAX_CONCURRENT_SOAP=5
NAME_IMPORT_ENABLED=true|false
AI_GLOBAL_DAILY_CAP_USD=50              # 0 = disabled
WEB_MODE_ENABLED=false                  # PR-9 gate
ADMIN_DASHBOARD_ENABLED=false           # PR-8 gate
EMAIL_NOTIFIER_ENABLED=false            # PR-11
```

Setate in `.env.example` la PR-1 cu defaults clare; documentate in `README.md`.

### 8.2 Observability

- Loguri structurate (JSON pe web, pretty pe desktop): every monitoring run loghează `{jobId, ownerId, kind, durationMs, status, alertsCreated, httpStatus, errorCode}`.
- Metrici Prometheus opt-in (PR-11): `monitoring_runs_total{status}`, `monitoring_alerts_total{kind,severity}`, `monitoring_concurrent`, `ai_usage_usd_total{owner_id,provider}`.
- `/health` extins: `{status, mode, monitoring:{lastTickAt, dueCount, runningCount}, db:{walSize, lastBackup}}`.
- Scheduler heartbeat: `audit_log` row la fiecare 5 min `{action:'scheduler.heartbeat'}` — silence > 10 min = alert ops.

### 8.3 Rollback strategy

| Etapa | Rollback action | Risc data loss |
|---|---|---|
| PR-3 monitoring shadow | Drop tabele, sterge rute. Zero impact desktop. | None |
| PR-4 scheduler activ | `MONITORING_ENABLED=false` + restart. Joburile raman in DB pentru retake. | None |
| PR-5 name lists | Idem flag. List existente raman. | None |
| PR-7 AI quotas | `AI_GLOBAL_DAILY_CAP_USD=0` + per-user limit=∞ | None |
| PR-9 web auth | Major; rollback = revert PR + redeploy. Sessions pierdute. Customer comm 14d ahead. | Sessions only |
| PR-10 Postgres | Mentine SQLite paralel pana stabil. Cutover atomic via `DATABASE_URL` switch + replay. | Posibil daca cutover gresit |

### 8.4 Customer comms

- Inainte de PR-9 (web mode): in-app banner 14 zile "We're rolling out user accounts. Your local data stays local." + email opt-in early access.
- Inainte de PR-10 (Postgres): doar pe web mode, downtime planificat 30 min, ferestre 02:00-04:00 RO time.

---

## 9. Securitate & compliance — adugiri specifice

- **Argon2id** pentru passwords (`argon2` npm). Min cost: `t=3, m=64MB, p=4`.
- **JWT**: HS256 cu secret rotabil (header `kid` pentru rollover), exp 15 min access, 30d refresh.
  - **Secret material**: `JWT_SECRETS_JSON` env var = `{ "<kid>": "<base64-256bit>", ... }` cu min 32 bytes (256-bit) per secret. Genereaza via `openssl rand -hex 32`. Boot fail-fast daca secretul activ < 32 bytes (validat la `parseEnv()`).
  - **Refresh rotation flow**: la `POST /auth/refresh`, mint NEW access + NEW refresh atomic, marcheaza `user_sessions.revoked_at = now()` pe randul vechi, leaga noul session de `parent_session_id`. **Refresh-token reuse detection**: daca un refresh deja revoked este re-prezentat → revoke intregul session family (toate `WHERE parent_session_id = root_id` recursiv) + audit log `auth.refresh_reuse_detected`.
  - **`kid`-aware decode**: header parses `kid`, lookup in keyring; tokens semnate cu `kid` necunoscut → 401 + audit log. Permite rotation grace period (current + N-1 secret valid simultan).
  - **Fail-fast secret validation**: la boot, server itera `JWT_SECRETS_JSON`, valideaza fiecare secret >= 32 bytes; la prima incalcare arunca `ConfigError` si abort process.
- **CSRF** (PR-12): doar pe rute `POST/PATCH/DELETE` din web SPA — token din cookie + header double-submit. Desktop bypassed (acelasi origin, no third-party form).
- **GDPR**: `DELETE /api/v1/me` → cascade soft-delete: `users.status='deleted'`, anonymize email/displayName la `deleted_<id>@anon`, `monitoring_jobs.active=0`, `audit_log` retained 1 an.
- **Audit log immutabilitate**: append-only check via trigger `BEFORE UPDATE/DELETE ON audit_log` → `RAISE`. Compactare lunara cu archive separat.
- **Rate limit per owner_id** (PR-12), nu doar per IP — un user single nu poate epuiza quota pe IP-uri rotative.

---

## 10. Risk register sintetizat

| Risc | Mitigare |
|---|---|
| **Latent owner_id leaks descoperite mai tarziu** | PR-1 fix + `repository-isolation.test.ts` ca regresie permanenta. |
| **PortalJust SOAP rate-limits noi** | Concurrency cap conservator (5), monitorizam `http_status` pe `monitoring_runs`, alert ops la spike 429/503. |
| **AI cost spike (loop, malicious prompt)** | Global cap + per-user cap + `was_aborted` tracking. Circuit breaker la $5/min. |
| **Postgres migration mismatch** | PR-10 in shadow mode (dual-write 7 zile), comparison script DB↔DB inainte de cutover. |
| **Cron leadership split-brain (web)** | Postgres advisory lock (`pg_try_advisory_lock(0xLEGAL)`) acquire per process; one wins. |
| **Backup blocking scheduler** | `withMaintenanceLock` → RWLock; scheduler shared-read, backup writer exclusiv. WAL truncate doar pre-snapshot. |
| **Schema drift desktop ↔ web** | Migrations versioned, single source `backend/src/db/migrations/`. Bootstrap aplica pana la `latest`. |
| **Notification spam dupa long downtime** | Coalescing per `(job_id, kind, hour_bucket)` la `name_soap` jobs. Severity caps. |

---

## 11. Decizii deschise (need user input)

### 11.1 ✅ Decizii rezolvate (lock-in)

- ✅ **Auth provider**: **Google Workspace SSO** (OAuth2/OIDC). Login local doar admin escape hatch. Eliminat: signup public, captcha, email verify, 2FA local (Google gestioneaza).
- ✅ **DB engine**: SQLite + Litestream pentru forever (Postgres eliminat — overkill pentru <100 useri intern).
- ✅ **Pricing**: niciun tier — internal flat. AI quota default $5/zi/user, $50/zi global firma (admin override per user).
- ✅ **Mobile / multi-tenant workspaces**: out of scope confirmat.
- ✅ **AI keys**: centralizate in `.env` server (nu BYOK).
- ✅ **Strategie sequencing**: Faza 1 (PR-0..PR-7) = monitoring desktop cu hooks web; Faza 2 (PR-8..PR-12) = web cutover. **NU intercalat**.

### 11.2 ✅ Decizii rezolvate 2026-04-27 (toate)

1. ✅ **Litestream backup target** — **Google Cloud Storage** bucket `legal-dashboard-backups` in regiunea `europe-west3` (Frankfurt). Motiv: firma deja foloseste Google ecosystem (Workspace SSO + billing); Service Account JSON in `.env` server, zero credentials extra. Cost estimat <$1/luna (DB ~100MB, audit creste ~50MB/an). Cutover GCS→S3 reversibil in ~30 min daca devine necesar (Litestream backup format portabil intre target-uri). Vezi PR-10 §config snippet.
2. ✅ **Reconciliere HARDENING.md "Watched Dosare"** — confirmat **Optiunea C (A+B)**: plan-ul superseaza schema HARDENING; semantica HARDENING (notify_days_before_json, is_new flag, solution_changed_at, stadiu in cheia diff) absorbita in `monitoring_jobs.alert_config_json` + `monitoring_alerts.is_new` + `kind='solutie_aparuta'`. HARDENING.md L274-440 marcat OBSOLETE cu pointer la plan.

### 11.2bis ✅ Decizia §11.2-2 RESOLVED (2026-04-27)

**Status**: Sister project **`portaljust-dashboard` v1.4.2-ai** disponibil local (path configurat prin env `PJI_REFERENCE_REPO`; vezi setup local in [README.md](README.md)). Are **monitorizare implementata complet in productie** (vezi `PROGRES.md` 2026-04-01). Patterns confirmate empiric, le folosim ca **referinta de design**, NU port 1:1 (arhitecturi divergente — vezi mai jos).

**Patterns reutilizabile (port conceptual, rescrie pentru SQLite + multi-user)**:
- ✅ **Snapshot-by-keys, nu by-content**: `snapshot[dosarNumar] = { sedintaKeys: string[] }` (Set<string> de keys deterministe). Memorie eficienta, diff O(n). **Adopta**: `snapshot_json` in `monitoring_jobs` stocheaza set de chei, nu payload SOAP complet (rezolva si B.3 diff determinism).
- ✅ **`buildSedintaKey(sedinta)` deterministic**: cheia compusa din `data + complet + (alte campuri stabile)`. Inlocuieste hash-ul whole-payload propus initial in plan — mai sigur fata de diferente cosmetice in raspuns SOAP.
- ✅ **Diff logic**: `if (!previous) → new_dosar`; pentru dosare existente, set difference pe `sedintaKeys` → `new_termen`. Algoritm validat empiric.
- ✅ **4h cadence empiric** confirmata in productie (~6 verificari/zi). Justifica modelul **B.1 tiered cadence** simplificat: tier "default" = 4h, "urgent" = 1h pentru pre-termen ≤ 7 zile. Nu mai e nevoie de 60s tick + cadence adaptive complicata.
- ✅ **Email format**: subject `[PortalJust] {clientName} - {N} procese noi, {M} termene noi`, HTML body cu lista alerte + PDF attach base64. Replica direct in PR-6 (post-Workspace SSO, doar relay SMTP firma).
- ✅ **Per-client criteria** (`Categorie Caz`, `Stadiu Procesual`): filtreaza rezultate dupa fetch, NU in query SOAP (PortalJust nu suporta filtre granulare). Salveaza in `alert_config_json` per job.
- ✅ **Catch-up scheduler** (`if Date.now() - lastAutoCheckAt >= INTERVAL → run immediately`): elegant, fara cron extern. Adaptam pentru backend: la boot scanneaza `monitoring_jobs.last_run_at` si executa immediate cele scadente.

**Divergente blocante (NU se poate port 1:1)**:
- ❌ **Persistenta**: Portal Just Integrat = **localStorage in renderer**. Legal Dashboard = **SQLite multi-user backend**. Toata logica scheduler+diff trebuie sa migreze din React useEffect in `backend/services/monitoring/` cu `monitoring_jobs.locked_until` lease pentru distributed safety.
- ❌ **Stack UI**: Portal Just Integrat = **Tailwind + shadcn/ui**. Legal Dashboard = **custom CSS**. Pagina Monitorizare se rescrie 100%, doar logica + schema vine ca referinta.
- ❌ **Niciun retry / idempotency / lease lock** in PJI — fail-uri SOAP bubble up la UI direct. Plan-ul Legal Dashboard pastreaza `monitoring_jobs.locked_until` + retry exponential backoff (necesar pentru backend multi-user fara user activ in fata).
- ❌ **No `owner_id`**: PJI = single-user desktop. Toate snapshot-urile shared. Plan-ul nostru pastreaza `owner_id` din ziua 1.
- ❌ **SMTP din `.env` direct in PJI** — Plan-ul nostru = relay Google Workspace via OAuth (PR-11). Mai sigur, foloseste credentials existent.

**Action items concrete**:
- [ ] **PR-3**: implementeaza `buildSedintaKey()` echivalent in `backend/src/services/monitoring/diff.ts` ca port direct.
- [ ] **PR-3**: schema `monitoring_jobs.snapshot_json` = `{ sedintaKeys: string[] } | null` (NOT full payload hash).
- [ ] **PR-4**: scheduler backend implementa "catch-up at boot" pattern (execute jobs cu `next_run_at < now()` immediately).
- [ ] **PR-5**: `alert_config_json` schema include `categorii: string[]`, `stadii: string[]` (compat cu PJI semantica filtrare client-side).
- [ ] **PR-6**: HTML email template port direct din PJI `index.ts:215-231`, ajustat pentru relay Workspace.
- [ ] **PR-3 spike (1h)**: citeste `Monitorizare.tsx:300-700` integral inainte de start, valideaza ca nu ratezi un edge case (de ex. ce face PJI cand SOAP intoarce 0 rezultate dupa ce era populated — clear snapshot? warning? Tine in plan ca "intrebare empirica").

### 11.3 Faza 9 cleanup vs roadmap

MEMORY noteaza Faza 9 cleanup `independent` de Faza 10. Pentru solo dev, nu putem face nimic paralel — ar trebui evaluat daca Faza 9 are itemuri urgente (refactor auth vechi, normalize legacy) inainte de a porni PR-0, sau le lasam strict dupa PR-12. Recomandare: scan Faza 9 in HARDENING.md inainte de PR-0 start, decidem dupa.

---

## 12. Next actions imediate (saptamana 1)

### 12.1 Faza 1 kickoff (nu blocheaza pe deciziile §11.2)

- [ ] **PR-0 start**: branch `feat/migrations-framework` (`_schema_versions` + runner + backfill schema curenta = version=1).
- [ ] **PR-1 follow-up**: branch `feat/web-readiness-foundation` (`getOwnerId` helper + 5 fix-uri owner_id leak) — merge dupa PR-0.
- [ ] Adauga `.env.example` cu toate flag-urile §8.1 (`APP_MODE`, `MONITORING_ENABLED`, `AI_PER_USER_DAILY_LIMIT_USD`, etc).
- [ ] Schelet `repository-isolation.test.ts` extensibil.
- [ ] **Pre-PR-3 spike OBLIGATORIU**: rerun `cautareDosare` 5× same-input → verifica payload determinism. Daca portalul intoarce non-determinist, pivoteaza diff strategy (sub-field comparison in loc de hash whole-payload).
- [ ] **Optional spike `@hono/zod-openapi`** (1 zi) inainte de PR-3 daca vrei risk-aversion pe contract API.

### 12.2 Decizii de obtinut in primele 2 saptamani (nu blocheaza PR-0/PR-1)

- [x] ~~**Decizie §11.2-1**: Litestream target~~ → **RESOLVED 2026-04-27**: GCS `legal-dashboard-backups` (europe-west3 Frankfurt). Vezi PR-10 config.
- [x] ~~**Decizie §11.2-2**: clarificare ref `Portal Just Integrat`~~ → **RESOLVED 2026-04-27**: sister project portabil ca referinta conceptuala (vezi §11.2bis).
- [x] ~~**Decizie §11.2-3**: HARDENING reconcile~~ → **RESOLVED 2026-04-27**: Optiunea C (A+B) confirmata; HARDENING.md L274-440 marcat OBSOLETE.
- [ ] **§11.3**: scan Faza 9 cleanup → decidem inainte/dupa PR-0.

### 12.3 Pregatiri pentru Faza 2 (de inceput in saptamana ~6)

- [ ] **Google Cloud Console**: client OAuth2 / OIDC pentru aplicatia (admin Workspace).
- [ ] **Configurare Workspace**: domain restriction in OAuth client (doar `@firma.ro` poate logheaza).
- [ ] **Decizie hosting server**: VM intern firma (Proxmox/VMware) sau cloud (Hetzner/DigitalOcean)?
- [ ] **Domeniu intern**: `legal.firma.ro` sau subdomeniu existent?
- [ ] **TLS cert**: Let's Encrypt automat sau cert intern firma?

---

## Apendix A — Mapping CP-uri / CQ-uri din CLAUDE.md la acest plan

| CP/CQ | Aplicat in |
|---|---|
| CP-2 env docs | §8.1 + `.env.example` updated PR-1 |
| CP-3 SPOF | §1 leader election; §5.1 retry strategy |
| CP-4 UI loading/error | PR-6 alerte UI; toate rute noi cu loading + error fallback |
| CP-7 pagination | §6 pagination rules |
| CP-9 backup | §8.3 + RWLock vs scheduler |
| CP-10 payments | Out of scope (free + simple Stripe in PR-13 viitor) |
| CP-11 secrets | JWT secret env, AI keys env (web) / safeStorage (desktop) |
| CP-12 silent errors | `monitoring_runs.error_code/message` + audit_log |
| CQ-2 tests | §7 |
| CQ-7 architecture | §6 service/repo split (no SQL in routes pentru new endpoints) |
| CQ-9 API contract | §6 standard envelope |

---

**Sumar pentru lectura rapida**: **13 PR-uri** (PR-0..PR-12) esalonate, fiecare independent merge-able. **PR-0 = migration framework** (`_schema_versions` + runner ordonat — schema.ts azi nu are nimic versionat). **PR-1** = `getOwnerId` helper + 5 fix-uri latent owner_id leak in `avizRepository.ts`. **PR-3..PR-7** livreaza monitorizarea + bulk names + AI quotas pe desktop deja, fara breaking. **PR-9** = pivotul web (3.0.0): JWT + email verify + password reset + captcha + data export/import desktop→web. DDL complet definit (cu exemptie `rnpm_bunuri_descrieri`), scheduler defaults concrete (60s tick, **3** concurrency aliniat empiric `batch-dosare.ts:10`, **2** per-owner cap, tiered cadence free/paid, crash recovery la boot, retry 60s×2^n cap 1h, jitter intotdeauna), test harness real-SQLite + clock injection, rollback path per PR, customer comms 14 zile inainte de v3. **Reconcile HARDENING.md "Watched Dosare"** in §11.7.

---

## Apendix B — First-principles double-check

Am rulat planul prin "ce s-ar sparge la stress?" si "ce ipoteza n-am justificat din primul principiu?". Issues triate.

### B.1 Critical (blocheaza PR-3+ daca nu rezolvate)

**B.1 — Bulk import 50000 nume × cadenta 1h e matematic imposibil**
- Calcul: 50000 joburi `name_soap` / `concurrency=3` / `(500ms inter + ~2s SOAP)` ≈ 41666 sec ≈ **11.5 ore per ciclu**. Cadence 1h declarata genereaza backlog crescator infinit.
- **Decizie revizuita: tiered cadence model** (nu "manual only" — feature-ul e bulk-monitoring si user-ul vrea automatizare):
  - **Free tier**: max 100 nume auto-monitorizate per user, `cadence_sec ≥ 86400` (24h). Math: 100 / 3 / 2.5s ≈ 83s per ciclu — confortabil.
  - **Paid tier**: max 5000 nume per user. `cadence_sec` declarat de user, dar runtime aplica `effective_cadence = max(cadence_sec, ceil(N_active_jobs_owner × 500ms / concurrency_per_owner))`. Pentru 5000 × 3 × 0.5s ≈ 14 min ciclu minim — utilizabil la "daily" cadence chiar la full quota.
  - **Anti-thundering-herd**: la auto-create joburi din lista, `next_run_at` distribuit uniform pe `[now, now + effective_cadence]` cu jitter 0-60s, NU `now()` for all.
  - **Per-owner concurrency cap** (nou): `MONITORING_MAX_CONCURRENT_PER_OWNER=2` — un user nu poate monopoliza scheduler-ul. Global cap ramane 3 (PortalJust).
  - **Hard caps per user in admin/quota tab**: free 5 dosare + 100 nume; paid 50 dosare + 5000 nume.
- **Implementare in plan**: §2.2 cadence_sec are deja nota despre `effective_cadence` runtime; §5.2 actualizat sa permita `auto_create_jobs:true` cu validation cap depending on tier (verificat din `users.meta_json.plan`); reject 422 daca s-ar depasi capul.

**B.2 — Concurrency 5 ar rupe SOAP-ul cand user face si batch search interactiv**
- Empirical [batch-dosare.ts:10](backend/src/services/batch-dosare.ts#L10) declara N=3 ca prag stabil.
- **Aliniat in plan**: §5.1 actualizat la `MONITORING_MAX_CONCURRENT_SOAP=3` cu condition "scheduler cedeaza cand user e activ" prin shared inflight counter. Implementare: `globalSoapSemaphore` cu `tryAcquire(reservedFor:'user'|'scheduler', priority:userBeforeScheduler)`.

**B.3 — Diff-engine fals-pozitive datorate normalizarii**
- Dosarul SOAP returneaza payload cu termene; fiecare termen are data, ora, complet, etc. Daca PortalJust schimba whitespace, ordering, sau timezone format intre apeluri, `payload_hash` difera la fiecare tick = alert spam.
- **Fix in plan**: §2.2 update `target_hash` mentioneaza canonical JSON, dar nu e suficient — `payload_hash` din `monitoring_snapshots` are aceeasi nevoie. Plan adauga in PR-3:
  - `util/canonicalJson.ts` cu reguli explicite per kind (sort keys, normalize whitespace, format dates ISO, drop volatile fields gen `searchTimestamp`).
  - Test `diff-engine.test.ts` cu fixture identic-cu-whitespace-diferit → trebuie `payload_hash` egal.

**B.4 — PortalJust upstream policing / TOS**
- Daca un user incarca cateva mii de nume, traficul e usor identificabil. Operator portal ne poate lista ca abuser → block IP.
- **Adaugat in plan**: §5.1 reliability requires User-Agent fix `LegalDashboard/<version> (+contact:<env CONTACT_EMAIL>)`. Plus: log tras intern `monitoring_runs.http_status=429|503` ne trimite la halt-and-back-off mode (toate joburile pauzate 1h) cu admin alert. PR-4 trebuie sa includa explicit acest "circuit breaker upstream-aware".

**B.5 — `loadAvizChildren` fix in PR-1: fara migrare data necesara, dar test obligatoriu**
- Fix-urile §3 nu schimba schema, doar query. Pe data existenta (single owner='local'), comportament identic. Dar daca un viitor restore aduce randuri orfane, query-ul vechi le-ar fi servit; cel nou nu. Comportament corect.
- **Test obligatoriu in PR-1**: `repository-isolation.test.ts` cu fixture orphan child (aviz_id pointing nowhere or to alt owner) + asserta absence in result.

### B.2 Slabiciuni (fix incremental, nu blocheaza)

**B.6 — `audit_log` immutability via trigger e simbolica**
- Trigger SQLite `BEFORE UPDATE/DELETE → RAISE` blocheaza app-level mutations, dar admin DB sau bug in app cu `PRAGMA temp_store` poate ocoli. WORM real cere storage separat (S3 object lock, append-only log file cu hash chain).
- Decizie: in scope desktop trigger e suficient (compliance pentru "userul nu poate sterge log-uri din UI"). Pentru web pot adauga **hash-chain log** in PR-12: fiecare row include `prev_hash = sha256(prev_row)`, verificabil offline. Cost: o coloana + un job validator.

**B.7 — CSRF middleware logic (Bearer vs cookie)**
- Plan §9 spune "CSRF doar pe POST/PATCH/DELETE web". Lipseste regula explicita: daca request are header `Authorization: Bearer`, skip CSRF (token nu e auto-trimis de browser). Daca foloseste doar cookie session, require `X-CSRF-Token` double-submit.
- **Update in PR-9**: middleware `requireCsrf(c)` — branch pe `c.req.header('authorization')?.startsWith('Bearer ')` → no-op, altfel verifica.

**B.8 — AI keys pe web: BYOK sau SaaS?** ✅ **RESOLVED 2026-04-26** (vezi §11.1 lock-in #4)
- Plan §1 spune "AI keys: server-side env (workspace level)" → SaaS, useri platesc sub-cont. Dar era posibil ca userii sa prefere sa-si aduca propriile chei (BYOK).
- **Decizie finala**: **NU BYOK**. AI keys centralizate in `.env` server. Quota per user via `ai_usage` sliding window (PR-7). Justificare: useri interni firma <100, billing centralizat firma, nu e cazul sa duplicam infrastructura encrypt/decrypt cheie per user. Hibridul AES-256-GCM/KMS = overengineering pentru context intern.

**B.9 — Scope migratie SQLite → Postgres subestimat**
- "Repository abstract" suna usor, dar:
  - `db.prepare(sql).get()` (sync) vs `pg.query()` (async) → toate route-urile devin async (deja sunt) DAR repos-urile actuale sync (better-sqlite3) trebuie rescrise async pentru PG.
  - DDL diferit: `datetime('now')` → `now()`, `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL` sau `IDENTITY`.
  - Triggers SQLite vs PG syntax diferit.
  - JSON storage: TEXT in SQLite, JSONB in PG (cu queries `->`/`@>`).
- **Cost realist**: 2-3 saptamani solo pentru PR-10. Plan trebuie sa marcheze asta. Mitigare: ramai pe SQLite + Litestream pe web pentru first launch web — feti `pg` la scale.
- **Update §1**: decizie revizuita — SQLite + Litestream e default web pentru v3.0; Postgres devine PR-13 (post-launch) cand justificat.

**B.10 — Clock DI refactor scope subestimat**
- Plan §7 spune `Clock` interface in scheduler tests. Dar `Date.now()` apare in zeci de locuri (rate-limit, backup, ai logging). Refactor mare daca DI peste tot.
- **Pragmatic**: `Clock` doar in scheduler + alert dedup (singurele teste sensibile la timp). Restul foloseste `Date.now()` direct in tests cu timeout-uri reale scurte.

### B.3 Lipsa

**B.11 — Email verify, password reset, 2FA**
- Plan §5.3 listeaza signup/login/refresh dar NU `verify-email`, `forgot-password`, `reset-password`. Astea sunt obligatorii.
- **PR-9 add**:
  ```
  POST /api/v1/auth/verify-email          # query token
  POST /api/v1/auth/forgot-password       # body email
  POST /api/v1/auth/reset-password        # body {token, newPassword}
  POST /api/v1/auth/2fa/enroll            # opt-in (TOTP)
  POST /api/v1/auth/2fa/verify
  ```
- 2FA poate fi PR-12 (post-launch hardening). Email verify + password reset sunt PR-9 obligatoriu.

**B.12 — Captcha pe signup (anti-bot)**
- Lipseste protectie inrolare bot-uri.
- **PR-9 add**: hCaptcha (free, GDPR-friendly) pe `/auth/signup`. Token verificat server-side. Bypass pe desktop (no-op).

**B.13 — Backup web mode**
- Plan §8.3 `withMaintenanceLock` e SQLite-specific. Pentru web (chiar cu Litestream), backup separat: snapshot continuous la S3-compatible.
- **Cost**: Litestream config ~30 min, S3 storage ~$1-5/luna. Adugat la PR-10 (sau PR-9 daca livram cu Litestream din prima).

**B.14 — Migrare data desktop → cont web**
- Cand un user existing pe desktop creeaza cont web, vrea sa-si aduca avizele/dosarele/joburile in cont nou. Nu e mentionat.
- **PR-9 add (sau PR-12 daca e edge)**: 
  - Buton "Export data" in desktop → ZIP `legal-dashboard-export-<timestamp>.zip` cu toate tabelele lui owner_id='local' ca JSON + sha256.
  - Buton "Import" in web cu confirm flow + dedup pe sha256/identificator.
  - Schema export versionata cu `schema_version` pentru forward compat.

**B.15 — PII retention pe loguri**
- Logurile structurate JSON contin email-uri si nume cautate (in `target_json` log-eat la job creation/run). GDPR cere retentie limitata.
- **Rule**: log retention 30 zile pe productie (rotate via journald sau Loki), `audit_log` retentie 1 an, `monitoring_runs` retentie 90 zile (apoi compactat la counters in `monitoring_jobs`).
- Add la PR-11 / PR-12 cu cron de purge.

**B.16 — Coalescing alerte dupa downtime lung**
- Daca scheduler-ul e off 12h, la rebot vor fi sute de joburi due simultan. Alert dedup per `(job_id, dedup_key)` ne salveaza la nivel de eveniment unic, dar daca apar 200 termene noi cumulate la 50 joburi, user primeste 200 toast-uri.
- **Mitigare**: in `notifyUser(alert)` + UI render, coalesce pe `(kind, hour_bucket)` → "23 termene noi observate intre 14:00-15:00, click pentru detalii". Frontend-only optimization, server emite individual.

**B.17 — Joburi `paused_until` expirate**
- DDL plan: `paused_until` TEXT. Cand expira, ce face? Plan `idx_monitoring_due` filtreaza `paused_until <= now()` deci e auto-rezolvat la SELECT. Bun. Dar clarificat in spec.

### B.4 Recomandari

1. **PR-1 stand-alone valid**: helperul `getOwnerId(c)` returneaza literal `"local"` la PR-1, fara query catre `users`. Tabelul `users` apare in PR-2 si seedul `local` e idempotent. Deci PR-1 → PR-2 ordering corect, nu se inverseaza.
2. **Marker explicit "speculative work"**: daca user nu confirma ca web mode e committed pentru 2026, PR-2 poate fi dropped. Plan trebuie sa expuna decizia ferm in §11 ca **first decision required**.
3. **Adopta `@hono/zod-openapi` doar pe rute noi**: refactor rute existente la zod nu e in scope. Plan §6 update.
4. **Adauga sectiune "Definition of Done" per PR**: linting + types + tests + manual smoke + changelog entry + docs update + migration up/down test.
5. **Pre-PR-3 spike obligatoriu**: 1 zi pentru a verifica empirical ca `cautareDosare` returneaza payload deterministic (rerun de 5 ori cu acelasi input) — daca nu, planul de diff cade. Daca da, valideaza canonical JSON rules.
6. **PR-0 prerequisit**: `_schema_versions` + migration runner trebuie inainte de PR-1 (nu blocheaza fix-urile owner_id pentru ca acelea nu sunt DDL, dar PR-2 si dupa au DDL nou si nu pot livra fara framework).

### B.5 Verdict double-check

**Plan → CONDITIONAL GO** dupa rezolvarea B.1-B.5 + clarificare §11.6 (Portal Just Integrat) si §11.7 (HARDENING reconcile). Niciunul nu impiedica directia, dar B.1 (bulk feasibility) si B.3 (diff determinism) ar putea pivota scope-ul daca empirical PortalJust nu coopereaza.

**Reduceri scope identificate**:
- Auto-monitor bulk import → tiered cadence (free 100/24h, paid 5000/dynamic) cu hard caps + per-owner concurrency (B.1).
- Postgres → SQLite + Litestream pentru v3.0 (B.9), Postgres = PR-13 post-launch.
- 2FA + advanced rate limit → PR-12 (post-launch, nu launch).

**Cresteri scope identificate**:
- **PR-0 nou**: migration framework (`_schema_versions` + ordered runner) — schema.ts azi nu are nimic.
- **Crash recovery scheduler**: stale `running` runs marcate `aborted` la boot (B.18 in §5.1).
- Email verify + password reset + captcha → PR-9 obligatoriu (B.11, B.12).
- Hash-chain audit log → PR-12 daca compliance (B.6).
- Data export/import desktop ↔ web → PR-9 obligatoriu (B.14).
- Reconcile HARDENING.md Watched Dosare → opsiunea A+B (supersede + alert config extensibility).

Cost timp ajustat: 6-8 saptamani la doi devs paraleli devine **8-11 saptamani** dupa B.5 reductions + cresteri (PR-0 + B.11/B.12/B.14 + HARDENING reconcile + crash recovery).

