# Session Handoff — Plan Monitoring + Web Mode

**Data**: 2026-04-27
**Sesiune**: 29f99a1b-f87c-4cad-90ff-eb78fa55bc73
**Status**: Plan complet, decizii inchise, gata pentru PR-0.

---

## TL;DR pentru sesiunea noua

User (Cezar, solo dev + Claude Code) vrea sa adauge **monitoring automat dosare** + **tranzitie aplicatie web** la Legal Dashboard. Plan livrat secvential in 2 faze (10-13 saptamani total). Toate deciziile blocante sunt rezolvate. Urmatoarea actiune: **start PR-0 (migration framework)**.

---

## Ce am rezolvat in aceasta sesiune

### 1. Decizii arhitecturale (toate RESOLVED 2026-04-27)

| # | Decizie | Rezolutie |
|---|---------|-----------|
| §11.2-1 | Litestream target | **GCS** `legal-dashboard-backups`, europe-west3 Frankfurt. Single-vendor cu Google Workspace SSO. ~$1/luna. Reversibil la S3 in ~30 min. |
| §11.2-2 | Portal Just Integrat reference | Port **conceptual NU 1:1**: snapshot-by-keys, `buildSedintaKey()` deterministic, 4h cadence, email HTML template. Diverge la persistenta (localStorage→SQLite multi-user) si UI (Tailwind→custom CSS). |
| §11.2-3 | HARDENING.md L274-440 vs PLAN | **Optiunea C**: plan supersedes schema. Features absorbite in `monitoring_jobs.alert_config_json` + `monitoring_alerts.is_new` + extended `kind` CHECK. |
| §11.1-4 / B.8 | BYOK | NU BYOK. AI keys centralizate in `.env` server. |
| Postgres? | DB choice | **NU**. SQLite + Litestream forever. <100 users, single writer, <1GB date, 1000× headroom. |

### 2. Documente create / actualizate

- **[PLAN-monitoring-webmode.md](PLAN-monitoring-webmode.md)** v1.3 — 845 linii. Master technical spec, PR-0..PR-12 cu DDL, API contracts, security model.
- **[EXECUTION-ROADMAP.md](EXECUTION-ROADMAP.md)** — 406 linii. Roadmap saptamanal solo-dev cu DoD checkboxes, decision log, risk register.
- **[HARDENING.md](HARDENING.md)** L274-440 — banner OBSOLETE, redirected la PLAN.
- **Memory**: `project_monitoring_webmode_plan.md` updated cu decizii rezolvate.

### 3. claude-guard review aplicat

7 findings adresate sistematic:
- PR-0: sentinel `__backfilled_v1__` + commit `migrations/0001_baseline.up.sql` pentru sha256_up backfill
- PR-3: envelope `{data, error?: {code, message}, requestId}` pe `/api/v1/*`, legacy `/api/*` preservat
- PR-4: DoD load-test (p95 <500ms, error rate <1% pe top 3 endpoints)
- PR-6: DoD EventSource cleanup pe unmount + reconnect cu backoff exponential
- PR-9: clarificare semver "Major 3.0.0 = doar transport web, NU breaking pentru desktop"
- PR-9/10/11: `.env.example` updates pentru GOOGLE_OAUTH_*, GCS_*, SMTP_*
- B.8 BYOK marcat RESOLVED cu trimitere la §11.1 lock-in #4

---

## Ce ramane de facut (in ordine)

### Pre-flight (saptamana 0, ~2 zile)

1. **Verificari low-priority** (10-30 min):
   - `Grep "getOwnerId" backend/src/` — verifica daca helper exista deja
   - `Read backend/src/db/avizRepository.ts` — confirma cele 5 `owner_id` leak fixes potentiale
   - `cat package.json` — check daca `csv-parse`, `argon2`, `arctic`/`oauth4webapi` sunt deja in deps
   - Biome lint plugin echivalent `eslint-plugin-no-network` (pentru a bloca `fetch()` direct in renderer post-cutover)

2. **Faza 9 cleanup decizie** (§11.3 in PLAN ramane OPEN):
   - Scan ce e in Faza 9 din `STATUS.md` / `HARDENING.md`
   - Decide: integrat in PR-0..PR-7 sau separat dupa Faza 1?

3. **GCS setup** (manual, user-side, ~30 min):
   - Creare bucket `legal-dashboard-backups` europe-west3
   - Service Account JSON descarcat
   - Path local pentru `GCS_CREDENTIALS_FILE` env var

### PR-0 (saptamana 1, primul commit)

**Scope**: Migration framework — `backend/src/db/migrations/` runner + tabela `_schema_versions(version INT PRIMARY KEY, applied_at TEXT, sha256_up TEXT)`.

**DoD**:
- [ ] Runner aplica migratii ordine `0001_*.up.sql`, `0002_*.up.sql`, ...
- [ ] `_schema_versions` populata la boot
- [ ] Backfill: schema curenta marcata `version=1` cu `sha256_up='__backfilled_v1__'`
- [ ] Commit real `migrations/0001_baseline.up.sql` cu schema curenta dump-ed (pentru CI consistency)
- [ ] `fs.readdirSync` la boot OK (nu blocheaza event loop, runs once)
- [ ] Test vitest: runner respecta ordinea + nu reaplica versiuni existente
- [ ] Test vitest: hash mismatch pe `0001` (alt continut) → throw + abort boot

**Estimat**: 1-2 zile.

### PR-1..PR-7 (Faza 1 — saptamani 2-8)

Monitoring desktop functional + scaffolding web invizibil. Detalii in [EXECUTION-ROADMAP.md](EXECUTION-ROADMAP.md).

### PR-8..PR-12 (Faza 2 — saptamani 9-13)

Cutover web: admin UI, Google Workspace SSO, Litestream→GCS, email notif, hardening. Detalii in roadmap.

---

## Context proiect (nu schimba)

- **App**: Legal Dashboard v2.0.10, Electron 41 + React 19 + Hono + better-sqlite3
- **Target**: aplicatie interna firma, <100 angajati, fara plati
- **Auth viitor**: Google Workspace OAuth2/OIDC, domain restriction. Login local doar admin escape hatch.
- **DB**: SQLite + Litestream forever (NU Postgres)
- **AI keys**: centralizate in `.env` server
- **Out of scope**: pricing tiers, mobile app, multi-tenant workspaces, BYOK
- **Strategie**: livram **secvential** Faza 1 → Faza 2. Niciun cod scris in Faza 1 nu trebuie rescris la Faza 2.

---

## Comanda de pornire sesiune noua

```
Citeste SESSION-HANDOFF.md si EXECUTION-ROADMAP.md sapt 1.
Vreau sa pornim PR-0 — migration framework + _schema_versions.
Inainte de a scrie cod, verifica:
1. backend/src/db/schema.ts curent
2. daca exista deja vreun mecanism de migration
3. daca better-sqlite3 are tranzactii sync (DA, dar confirm)
```

---

## Loose ends

- User intreba pe parcurs "nu folosim postgres?" — am justificat SQLite + Litestream. User a continuat fara a contesta. **Decizie finala**: SQLite. Daca user revine la intrebare, redirectioneaza la justificarea din PLAN §1.
- Memory `project_monitoring_webmode_plan.md` are `originSessionId: 29f99a1b-f87c-4cad-90ff-eb78fa55bc73` — sesiunea noua nu trebuie sa rescrie aceasta linie.
