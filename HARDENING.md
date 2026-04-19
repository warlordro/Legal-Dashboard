# Legal Dashboard — Roadmap de Hardening

> **Scop:** lista de items care muta aplicatia din „production-ready pentru use intern" → „production-ready pentru deployment multi-user la firme externe".
>
> **Nu este** tech debt (codul nu e stricat). **Este** maturizare pentru adoption non-tech + compliance.

Items filtrate din analiza completa: 15 actionable. Restul (~35) sunt fie overkill pentru contextul actual (i18n, Prometheus, ADR-uri, snapshot tests PDF), fie deferred pentru tranzitia web (auth, multi-tenancy, Postgres). Nu le re-adauga aici fara reevaluare.

Format: `[ ]` TODO → `[~]` in progress → `[x]` done. Cand un item e done, lasa-l aici cu `[x]` + data ca referinta.

---

## Faza 1 — CI Foundation (~1 saptamana)

**De ce prima:** fara CI, orice item de mai jos e „verde pe laptopul meu". Cu CI, restul capata gate real.

- [ ] **CI pipeline GitHub Actions** (`.github/workflows/ci.yml`) — rula pe PR + push main: `npm ci` cached + `npx tsc --noEmit` pe ambele workspace-uri + `npx vitest run` + build frontend + build backend. Fara publish. **Effort:** ~4h.
- [ ] **Biome gate in CI** — `npx biome check` ca step obligatoriu. Biome.json exista deja. **Effort:** ~1h.
- [ ] **Dependabot** (`.github/dependabot.yml`) — patch+minor grupate saptamanal, PR separat per major. Nativ GitHub, nu Renovate (overkill pentru solo dev). **Effort:** ~30 min.

## Faza 2 — Security active findings (~3-4 zile)

Sunt fix-urile pentru findings-urile ACTIVE P1 din auditul intern.

- [ ] **Eliminare fallback localStorage pentru chei AI in web mode** — detecteaza `!window.desktopApi` → ascunde dialogul „Setari AI" + endpoint-urile AI raspund 503 daca nu au cheie env. Plaintextul in localStorage e security theater. **Effort:** ~2h.
- [ ] **Bump dompurify + jspdf** (doar patch/minor, nu major) — `npm update` pe ambele + re-test exports PDF (changelog + analiza AI). **NU migrare xlsx → exceljs** (xlsx e folosit doar pentru export/write, nu parse — CVE-urile nu aplica). **Effort:** ~2h.
- [ ] **Bump Hono + @hono/node-server** — backend HTTP-facing, orice CVE pe layer-ul HTTP e impact maxim cu `LEGAL_DASHBOARD_ALLOW_REMOTE=1`. Bump + vitest + smoke test. **Effort:** ~2h.

## Faza 3 — Crash visibility (~3 zile)

Fara astea, o exceptie intr-un sub-tree React daramaa tot renderer-ul; nu ai date cand ceva se rupe la user.

- [ ] **Error boundaries React** — global `<ErrorBoundary>` wrapping `<App>` + boundary-uri locale pe `DosareTable`, `RnpmDetailModal`, `dosare-ai-analysis-panel`. Fallback UI: „Reload section" + breadcrumb cu component name. **Effort:** ~4h.
- [ ] **Request ID middleware (Hono)** — UUID v4 per request, propagat in `X-Request-ID` response header + in toate log-urile. Debug „de ce a esuat requestul X" devine trivial. **Effort:** ~1h.
- [ ] **`/health/detailed` endpoint** (auth-protected chiar si pe localhost) — status SQLite (`integrity_check`), status backup (ultimul + dim + varsta), status memorie (RSS/heap), status ultimul AI call per provider. **Effort:** ~4h.

## Faza 4 — Data integrity (~3-4 zile)

Protectii pentru datele utilizatorului. Corruption SQLite e rar dar silentios — trebuie detectat.

- [ ] **`PRAGMA integrity_check` la boot** — in `backend/src/db/schema.ts` dupa `initSchema()`, inainte de prewarm. Daca nu e `"ok"`, log warning + expune prin `/health/detailed` (user poate sa decida restore). **Effort:** ~2h.
- [ ] **Backup verification automata** — dupa `runDailyBackup()` deschide snapshot-ul intr-o conexiune temporara + `integrity_check`. Esec → log + retry next boot. Un backup care nu se restaureaza = fals confort. **Effort:** ~2h.
- [ ] **Schema version table** — `_schema_versions` (version, applied_at, migration_hash). La boot: refuza startup daca DB e mai noua decat app-ul (downgrade detection). Previne „user instaleaza versiune veche peste DB noua → crash silentios". **Effort:** ~3h.
- [ ] **WAL checkpoint periodic** — `setInterval(PRAGMA wal_checkpoint(PASSIVE), 5 min)` in backend. 10 linii. Previne WAL bloat intre VACUUM-uri manuale. **Effort:** ~1h.
- [ ] **Tests pentru migrari SQLite** — `migrations.test.ts` care porneste cu DB gol, ruleaza toate migrarile, ruleaza din nou (idempotency), insereaza date sintetice, `integrity_check` + `foreign_key_check`, testeaza `deleteAllAvize` cu CASCADE. Migrarea `descriere-dedup` e cea mai complexa — merita test dedicat. **Effort:** ~1 zi.

## Faza 5 — Compliance & audit (~2-3 zile)

**Non-negociabil inainte de distribuirea catre prima firma externa.** GDPR pe date juridice nu e optional.

- [ ] **Politica de confidentialitate** (`PRIVACY.md` + pagina in Manual) — explicit: ce colecteaza app-ul (zero local, DA pentru providerii AI selectati), ce se trimite la Anthropic/OpenAI/Google, ce retine localStorage + SQLite, cum sterge userul totul (path catre `<userData>`). **Effort:** ~4h.
- [ ] **Consent dialog la prima pornire** — ecran de bun-venit inainte de prima utilizare: „App-ul trimite datele dosarului catre provider-ul AI selectat. Accept?", persist in settings. **Effort:** ~4h.
- [ ] **Audit log local pentru actiuni sensibile** — log separat de log-urile tehnice (tabela `audit_log` in SQLite): cautari efectuate (user, query, timestamp), exporturi produse, configurari AI schimbate, restore backup. „Cine a cautat dosarul X pe data Y" devine raspuns rapid. **Effort:** ~1 zi.

## Faza 6 — Release engineering (~4-5 zile + buget)

- [ ] **Code signing Windows (OV certificate, ~$200/an)** — semnare cu `signtool` in release pipeline. Binary nesemnat = SmartScreen „Windows protected your PC" = blocker adoption non-tech. **Effort:** 3-4 zile (includes setup cert + CI integration). **Cost:** $200/an recurent.
- [ ] **Release pipeline GitHub Actions** (`.github/workflows/release.yml`) — triggered pe tag `v*`: build Windows `.exe` NSIS + macOS `.dmg` (x64 + arm64, doar daca urmaresti Mac), publish ca GitHub Release, changelog auto-extras din `changelog-entries.tsx`. **Effort:** ~1 zi.

## Faza 7 — CodeRabbit findings 2026-04-19 (pre-web-deploy + pre-monitorizare auto)

**De ce aici:** auditul CodeRabbit din 19 aprilie 2026 a scos 4 Critical + 7 Important. Le tratam inainte de doua borne majore:
- **Tranzitia web** (`LEGAL_DASHBOARD_ALLOW_REMOTE=1`, deploy server sau Docker image) — C1-C4 + I2 sunt **blocante**.
- **Modul Watched Dosare cu auto-sync** (Pilon B din sectiunea urmatoare) — sync periodic multi-dosar reintroduce exact acelasi fanout concern ca C1; capacitatea SOAP trebuie capped uniform inainte de auto-interval.

Un finding (I1 — dublu `validateAiBody`) a fost verificat direct vs cod si **respins ca false positive** (singur apel la `ai.ts:106`, liniile pre-validation sunt existence guards, nu re-validari) — detaliat mai jos la Rejected.

### Blockers pentru web deploy (fix inainte de orice flag `ALLOW_REMOTE` sau Docker push)

- [ ] **C1 — SOAP fanout cap pe GET /api/dosare + /api/termene** — aplica `MAX_SOAP_FANOUT` (500) + limit total randuri inainte de `JSON.stringify`, oglindind guard-ul existing din SSE `/load-more`. Azi `GET` foloseste doar `MAX_INSTITUTII=50`, fara cap pe fanout agregat. **Fisiere:** [backend/src/routes/dosare.ts](backend/src/routes/dosare.ts) (L20-68) + [backend/src/routes/termene.ts](backend/src/routes/termene.ts) (L20-87). **Effort:** ~1h.
- [ ] **C2 — rate-limit fail-closed pe IP irezolvabil** — `getConnInfo(c).remote.address` falsy → HTTP 503 (sau 1 req/min hard), nu bucket `"unknown"` partajat. **Fisier:** [backend/src/middleware/rate-limit.ts](backend/src/middleware/rate-limit.ts) L12. **Effort:** ~30 min.
- [ ] **C3 — Dockerfile non-root + fara secrete baked** — `addgroup/adduser app` + `USER app` + scoate `COPY .env* ./` + `.dockerignore` cu `.env*` + `node_modules`. **Fisier:** [Dockerfile](Dockerfile). **Effort:** ~30 min.
- [ ] **C4 — docker-compose loopback-bind by default + port-fix** — `127.0.0.1:3001:3001` default + comentariu „remote requires reverse-proxy + auth" + aliniaza portul Dockerfile (3001) cu backend default (`LEGAL_DASHBOARD_PORT=3002` in [backend/src/index.ts](backend/src/index.ts) L78) — sau decide o singura valoare si propaga. **Fisier:** [docker-compose.yml](docker-compose.yml). **Effort:** ~30 min.
- [ ] **I2 — CORS gate pe NODE_ENV** — `http://localhost:5173/4173` allowed doar daca `process.env.NODE_ENV !== "production"`. **Fisier:** [backend/src/index.ts](backend/src/index.ts) L55-62. **Effort:** ~15 min.

**Total blockers: ~3h** — singur sprint inainte de primul push public.

### Desktop UX + convention hygiene (nice-to-have pre-monitorizare)

- [ ] **I4 — splash „Optimizare baza de date..." la boot pre-VACUUM** — cand `needsDescriereMigration()` e true, afiseaza BrowserWindow minimal inainte de `require(dist-backend)`; VACUUM sincron blocheaza 30-90s pe DB de ~100MB fara feedback. Alternativ: defer VACUUM post-first-paint + worker thread. **Fisiere:** [electron/main.js](electron/main.js) L149 + [backend/src/db/schema.ts](backend/src/db/schema.ts) L315-347. **Effort:** ~2h.
- [ ] **I5 — validare `searchType` enum la repository** — tuple `SEARCH_TYPES` + throw on miss in `searchRepository.saveSearch`. Previne typo-uri tipu `"rnmp"` care polueaza silent history. **Fisier:** [backend/src/db/searchRepository.ts](backend/src/db/searchRepository.ts) L15,29. **Effort:** ~30 min.
- [ ] **I6 — `rateLimitMap` cleanup pe interval cu unref** — `setInterval(cleanup, 60_000).unref()` + scoate sweep-ul size>1000 din hot path (blocheaza request thread cand se declanseaza). Relevant doar in web mode sub scan traffic. **Fisier:** [backend/src/middleware/rate-limit.ts](backend/src/middleware/rate-limit.ts) L33. **Effort:** ~30 min.
- [ ] **I7 — `any` → `unknown` + narrowing in ai.ts handlers** — `let body: any` (L34, L94 in [backend/src/routes/ai.ts](backend/src/routes/ai.ts)) → `unknown`; `validateAiBody` returneaza shape tipat in loc de `string | undefined`. Singurul `any` ramas in `backend/src/**`. **Effort:** ~1h.

### Suggestions (opportunistic, independent)

- [ ] **`frontend/src/lib/api.ts` — ultimul `json: any`** — `get<T>` helper L17 foloseste `any` pentru parsed body; inlocuieste cu `unknown` + narrow guard la call site. **Effort:** ~15 min.
- [ ] **README troubleshooting — documenteaza `ELECTRON_DISABLE_GPU=1`** — opt-out exista in cod (main.js) + documentat in DOCUMENTATIE.md L502 + START.md L72, dar lipseste din README. **Effort:** ~10 min.
- [ ] **`captchaSolver.ts` race mode — log orphan solve-id** — 2Captcha SDK ignora AbortSignal → losing provider continua sa consume credite. Log `solve_id` la cancel + nota explicita in SECURITY.md despre dubla-facturare in race mode. **Effort:** ~30 min.
- [ ] **`rnpmClient.ts` — comentariu anti-bot pe User-Agent/Referer fixate** — previne „curatenia" gresita de un maintainer viitor. **Effort:** ~5 min.
- [ ] **`rnpm.ts validateParamsDepth` — pinning test** — unit test care asserteaza `depth=4, stringLen=500` ca sa nu se relaxeze silent. **Effort:** ~30 min.
- [ ] **`avizRepository.cleanupOrphanDescrieri` — debounce pe retries** — daca `clientRequestId` retries declanseaza apeluri repetate in aceeasi secunda, debounce la 1s. **Effort:** ~30 min.

### Done

- [x] **I3 — decodeXmlEntities in parseDosar** (2026-04-19) — helper exportat in [backend/src/soap.ts](backend/src/soap.ts), aplicat la leaf fields (nume, obiect, solutie, institutie, departament, categorieCaz, stadiuProcesual). Teste: 5 noi (entity decoding + invariant „&amp; nu dublu-decodeaza"). Scopul: nume parti `S.C. X &amp; Co.` redau corect in UI/XLSX.

### Rejected (false positive verificat vs cod)

- **I1** — CodeRabbit: „`validateAiBody` apelat de doua ori in `/analyze-multi`". Verificare directa [backend/src/routes/ai.ts:102-109](backend/src/routes/ai.ts): UN singur apel la L106. L102-103 sunt `if (!body || typeof body !== "object")` + `if (!body.dosar)` — existence checks, nu re-validari. Not actionable.

## Planned feature — Dashboard rework + Watched Dosare (viitor)

> **Status:** planificat, **nu inceput**. Documentat aici integral ca sa nu se piarda contextul. Se porneste cand avem bandwidth pe feature-uri non-hardening (probabil dupa Faza 3 — fara error boundaries + request IDs, debug-ul sync-urilor esuate e orb).
>
> **Scop:** combina 2 directii discutate in debate-ul dashboard:
> 1. **Rework dashboard** cu metodele **v1 (sparklines)** + **v3 (Termene Imediate)**.
> 2. **Watched Dosare** ca feature nou — user marcheaza explicit dosare de urmarit, app-ul face sync periodic SOAP, termenele raportate in dashboard + calendar + alerte.
>
> Cele doua sunt cuplate: „Termene Imediate" din dashboard se alimenteaza exclusiv din dosarele urmarite.

### Pilon A — Dashboard rework (v1 + v3)

- **v1 (sparklines):** cardurile existente „Dosare Gasite" / „Avize Gasite" capata un sparkline SVG inline (30 de zile) + delta % WoW. Zero dependente noi (SVG native, 50 linii). Data source: agregare pe `rnpm_searches.created_at` grupata pe zi.
- **v3 (Termene Imediate):** sectiune noua sub carduri — lista top 5 termene din urmatoarele 7 zile (numai din dosare urmarite), sortate dupa `data ASC`, badge urgent daca `≤ notify_days_before`. Date-box stanga (zi + luna), numar dosar + instanta + ora + complet, buton „Deschide in Termene" care deep-link-uieste la tab-ul Termene cu filtru pre-populat.

### Pilon B — Watched Dosare (feature nou)

User marcheaza un dosar cu o stea (din tab-ul Termene sau rezultatele cautarii). App-ul stocheaza watchlist-ul si face sync periodic SOAP pentru a detecta:
- termene noi (nu existau la ultimul sync)
- solutii nou-aparute (termen care avea `solutie=null` si acum are valoare)
- termene care se apropie de pragul `notify_days_before`

#### Schema noua (ambele tabele prefixate cu `owner_id` pentru CP-B7 multi-tenant ready)

```sql
CREATE TABLE tracked_dosare (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id                TEXT NOT NULL DEFAULT 'local',
  dosar_numar             TEXT NOT NULL,
  instanta                TEXT NOT NULL,
  parti_summary           TEXT,                           -- denormalized pentru display rapid
  note                    TEXT,                           -- free-form user note
  notify_days_before_json TEXT NOT NULL DEFAULT '[7]',    -- JSON array: [14,7,3,1] pentru multi-threshold viitor
  notify_on_new_termen    INTEGER NOT NULL DEFAULT 1,
  notify_on_solution      INTEGER NOT NULL DEFAULT 1,
  last_synced_at          TEXT,
  last_sync_status        TEXT,                           -- 'ok' | 'error' | 'in_progress' (concurrency guard)
  last_sync_error         TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(owner_id, dosar_numar, instanta)
);

CREATE TABLE termene_cache (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id             TEXT NOT NULL DEFAULT 'local',
  tracked_dosar_id     INTEGER NOT NULL REFERENCES tracked_dosare(id) ON DELETE CASCADE,
  stadiu_procesual     TEXT NOT NULL DEFAULT '',         -- inclus in UNIQUE key: un dosar poate avea >1 stadii
  data                 TEXT NOT NULL,                    -- normalizat YYYY-MM-DD (slice 0,10)
  ora                  TEXT NOT NULL DEFAULT '',         -- normalizat HH:MM (padded)
  complet              TEXT NOT NULL DEFAULT '',
  solutie              TEXT,
  solutie_sumar        TEXT,
  document_sedinta     TEXT,
  numar_document       TEXT,
  data_pronuntare      TEXT,
  is_new               INTEGER NOT NULL DEFAULT 0,       -- flag afisat cu badge „NOU" pana user-ul vede termenul
  solution_changed_at  TEXT,                             -- set cand solutia trece din null in ne-null
  synced_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tracked_dosar_id, stadiu_procesual, data, ora, complet)
);
```

**De ce JSON array pentru `notify_days_before`:** permite migrare single-threshold `[7]` → multi-threshold `[14,7,3,1]` fara ALTER TABLE. Cost: un `JSON.parse` la read, zero la write.

**De ce `stadiu_procesual` in UNIQUE key:** un dosar poate avea termene simultane in stadii diferite (fond + apel). Fara el, sync-ul ar suprascrie termene-le dintr-un stadiu cu cele din altul.

**CASCADE DELETE pe termene_cache:** la `unwatchDosar`, termene_cache-ul asociat dispare automat — zero orphan rows.

#### Repositories noi (`backend/src/db/`)

- `watchedRepository.ts` — CRUD pe `tracked_dosare`: `watchDosar`, `unwatchDosar`, `listTrackedDosare`, `getTrackedDosar`, `isTracked`, `updateRules`, `updateNote`, `updateSyncStatus`, `countTracked`.
- `termeneCacheRepository.ts` — CRUD pe `termene_cache`: `upsertTermen` (cu detectie `is_new` + `solution_changed_at`), `listTermeneForTracked`, `listUpcomingTermene({ withinDays, ownerId })`, `deleteTermeneForTracked`.

**API consistency cu existing:** ambele urmeaza pattern-ul `rnpmSearchesRepository.ts` (raw better-sqlite3 prepared statements, owner_id scoping implicit, Row→Domain mapper, zero ORM).

#### Sync service (`backend/src/services/watchedSync.ts`)

- `syncDosar(trackedId, { force?: boolean })` — ruleaza flow-ul SOAP existent pentru un singur dosar, upsertează rezultatele in `termene_cache`, seteaza `last_sync_status` + `last_sync_error`.
- `syncAllWatched()` — itereaza `listTrackedDosare`, ruleaza `syncDosar` cu **concurrency cap = 3** (pe modelul throttling-ului SOAP existent din RNPM). La boot + manual (buton „Sync tot").
- Concurrency guard: inainte de a incepe un sync, seteaza `last_sync_status='in_progress'`. Daca la intrare gasesti `'in_progress'` + `last_synced_at` in ultimele 30s, skip (alta cursa e activa). Previne duble lansari la dublu-click „Sync tot".

#### Hono routes (`backend/src/routes/watched.ts`)

| Method | Route | Scop |
|---|---|---|
| GET | `/api/watched` | `listTrackedDosare` |
| POST | `/api/watched` | `watchDosar({ dosarNumar, instanta, rules?, note? })` — idempotent via UNIQUE constraint |
| DELETE | `/api/watched/:id` | `unwatchDosar` |
| PATCH | `/api/watched/:id/rules` | `updateRules` |
| PATCH | `/api/watched/:id/note` | `updateNote` |
| POST | `/api/watched/:id/sync` | `syncDosar(id, { force: true })` |
| POST | `/api/watched/sync-all` | `syncAllWatched()` |
| GET | `/api/watched/upcoming?days=7` | feed pentru dashboard „Termene Imediate" |

Toate mutatiile accepta `clientRequestId` (CP-B8) — UNIQUE constraint + SELECT post-insert garanteaza ca double-click-ul pe „urmareste" returneaza acelasi rand, nu duplicat.

#### Frontend

- **Componenta `WatchStarButton`** — toggleable, apare in: tabelul Termene (coloana actions), `RnpmDetailModal`, rezultatele cautarii dosare.
- **Tab nou „Dosare Urmarite"** (sau sub-tab sub Termene) — lista + contor, butoane per-rand: Sync, Edit rules, Note, Unwatch. Ultimul sync cu timestamp relativ („acum 2h").
- **`WatchRulesModal`** — edit rules (slider zile + toggles „notifica la termen nou" / „notifica la solutie"). UI-ul porneste cu slider unic; chips multi-select e follow-up (backend-ul deja suporta).
- **Dashboard „Termene Imediate"** (v3) — GET `/api/watched/upcoming?days=7`, renderează date-box + numar dosar + ora + complet + „Deschide". Empty state: „Niciun termen in urmatoarele 7 zile pentru dosarele urmarite."
- **Dashboard sparklines** (v1) — adauga SVG inline in cardurile existente, data vine din agregare pe `rnpm_searches` grupata pe zi (30 zile). Component nou `SparklineCard` care wrap-uieste `StatCard`.

### Plan de implementare (9 faze, ~3 zile efectiv)

| Faza | Continut | Effort |
|---|---|---|
| F1 | Schema: CREATE TABLE tracked_dosare + termene_cache (idempotent, pattern existing) | 0.25 zi |
| F2 | `watchedRepository.ts` + `termeneCacheRepository.ts` + tests unitare | 0.5 zi |
| F3 | `watchedSync.ts` + integrare SOAP existing + concurrency guard + fanout cap 3 | 0.5 zi |
| F4 | Hono routes + preload bridge (CP-B2: window.desktopApi.watch.*) | 0.25 zi |
| F5 | `WatchStarButton` + integrare in 3 locuri (Termene tabel, RnpmDetailModal, cautare) | 0.25 zi |
| F6 | Tab „Dosare Urmarite" (lista + actiuni + sync buttons) | 0.5 zi |
| F7 | `WatchRulesModal` (slider threshold + toggles) | 0.25 zi |
| F8 | Dashboard „Termene Imediate" (fetch upcoming + card layout + deep-link) | 0.25 zi |
| F9 | Dashboard sparklines + aggregate query + `SparklineCard` | 0.25 zi |

**Total:** ~3 zile dev efectiv, distribuite pe ~1 saptamana calendaristica cu testare intercalata.

### Design notes critice (flagate de advisor pre-implementare — NU omite)

1. **Detectie `is_new`:** inainte de `INSERT OR REPLACE`, `SELECT` rowul existent. Daca nu exista → `is_new=1`. Daca exista → pastreaza `is_new` existent (doar user-ul il reseteaza cand vede badge-ul).
2. **Detectie „solutie aparuta":** comparatie `old.solutie IS NULL AND new.solutie IS NOT NULL` → seteaza `solution_changed_at = datetime('now')`. E trigger-ul pentru „notifica la solutie".
3. **Normalizare date/ora:** SOAP returneaza formate inconsistente (`2026-04-19T00:00:00`, `2026-04-19 10:00`, `10:0`). Normalizeaza la `YYYY-MM-DD` (slice 0,10) si `HH:MM` (padStart 2) inainte de UNIQUE check, altfel ai duplicate fantoma.
4. **Concurrency guard:** `last_sync_status='in_progress'` + check la intrare. Previne re-entrant sync pe acelasi dosar daca user-ul da dublu pe „Sync".
5. **SOAP fanout cap:** `syncAllWatched` cu `p-limit(3)` sau reimplementat cu semafor — respecta throttle-ul existent RNPM (nu vrem ban IP pe endpoint-ul SOAP portaljust).
6. **Multi-record per dosar:** `stadiu_procesual` e parte din UNIQUE — un dosar cu apel in desfasurare are termene simultan in „fond" (inchis) + „apel" (deschis), ambele trebuie cache-uite.

### Impact

- **User vizibil:** dashboard util (nu doar 2 contoare statice), workflow „urmareste + ia-mi cand se schimba ceva" — lipsa critica azi, user foloseste Termene manual ca sa urmareasca dosare recurente.
- **Infrastructura:** 2 tabele noi (~KB/dosar urmarit), un background sync (boot + manual; auto-interval e follow-up), zero dependente noi npm (SVG sparkline scris manual).
- **Web-readiness:** ramane green. `owner_id` pe ambele tabele (CP-B7), repository-only DB access (CP-B1), preload bridge (CP-B2), zero fs.* in renderer (CP-B3), idempotenta via UNIQUE + clientRequestId (CP-B8).

### Riscuri si mitigari

| Risc | Impact | Mitigare |
|---|---|---|
| Sync lent (SOAP 5-15s per dosar × N urmarite) | UI freeze perceput la „sync tot" | Background async + progress indicator; cap concurrency 3 |
| SOAP returneaza termene incomplete intermitent | False `is_new` detections | `is_new` doar pe INSERT nou, nu pe UPDATE; log delta-urile in audit |
| User sterge dosarul din Termene dar ramane in watchlist | Orphan tracked_dosare | E ok — watchlist e independent de cache local; next sync va intoarce „error" pana user-ul face unwatch |
| Multi-threshold UI creste complexitatea WatchRulesModal | Scope creep | V1 ramane slider unic (`[7]`); multi-threshold e follow-up cu UI diferit (chips) |
| Migrare schema pe DB-uri existente esueaza | Boot blocat | Pattern-ul existing (CREATE TABLE IF NOT EXISTS + ALTER IF NOT COL) e testat pe 4 migrari anterioare |

### Follow-ups post-MVP (listate separat, nu blocheaza launch-ul)

- [ ] **Auto-sync watched dosare la interval configurabil** — setting 2h / 4h / 6h in UI, cron-like in main process (sau setInterval in backend). Ruleaza peste sync-ul la boot + manual; respecta throttle-ul SOAP. Evaluare dupa ce ai date reale de utilizare (cat de des se schimba termenele in realitate). **Effort:** ~0.5 zi.
- [ ] **Multi-threshold alerts (UI)** — extinde WatchRulesModal de la slider unic (`notify_days_before: [7]`) la chips multi-select (`[14, 7, 3, 1]`). Backend-ul tine deja JSON array — doar UI + afisare. **Effort:** ~0.5 zi.
- [ ] **Notificari native Windows** — integrare `new Notification({ title, body })` cand un termen urmarit depaseste pragul `notify_days_before`. Necesita tray integration (altfel notificarile mor la inchidere fereastra). **Effort:** ~1 zi (+ 0.5 zi tray).
- [ ] **Calendar view pentru termene urmarite** — grid lunar cu termene plotate pe zile, click → detaliu. Mai tarziu, cand volumul dosarelor urmarite justifica vizual.

## In paralel (nu blocking, dar de prins in fazele 3-6)

Items mai mari, de facut cand ai capacitate in fazele de mai sus. Nu blocheaza nimic.

- [ ] **DialogShell unificat** — componenta comuna care wrap-uieste toate modalurile (RnpmDetailModal, RnpmRestoreModal, ConfirmDialog, Info baza locala). useDialog consistent, aria-modal + focus trap, size variants. Migrare incrementala — nu te opri la jumatate. **Effort:** ~2 zile. Flag P2 ACTIV in auditul tau intern.
- [ ] **Playwright E2E — 2-3 flow-uri critice** — (1) cautare RNPM + buton Stop cap-coada + verificare zero avize persistate, (2) configurare API key AI + analiza single + multi-agent, (3) backup automat la boot + restore din backup + verificare snapshot pre-restore. Mai impact decat 10 unit-tests noi. **Effort:** ~3-4 zile.

---

## Deferred pentru tranzitia web

Nu atinge pana nu ai `DEPLOY_TARGET=server` in cod sau decizie explicita „incepem serverul":

- Auth layer (Lucia / Better-Auth)
- Multi-tenancy (user_id pe toate tabelele, astazi `owner_id='local'`)
- SQLite → Postgres migration
- Compression middleware (Hono)
- Plugin architecture pentru AI providers
- Rate limiter persistent (cross-restart)
- Prometheus metrics endpoint

Sunt corect P3/deferred in analiza originala. Web-readiness bridge e deja green prin CP-B1..B8 — aceste items vin la randul lor dupa decizia de transit.

## Feature major separat (nu hardening, dar strategic)

- [ ] **Ollama local LLM support** — adauga „Local (Ollama)" ca provider in `services/ai.ts`. Zero data egress → **diferentiator strategic major pentru firmele RO care refuza sa trimita dosare la US-based providers**. Arhitectura actuala il absoarbe relativ usor (registry de modele exista). **Effort:** ~1 saptamana. **Nu e hardening** — e feature cu impact strategic, tracked aici doar ca sa nu se piarda.

---

## Items ce NU sunt aici (pentru referinta — nu le re-adauga fara reevaluare)

Din analiza completa au fost **filtrate afara** ca overkill / YAGNI / N/A pentru contextul actual:

- Subresource Integrity (nu folosim CDN-uri)
- Script `security:check` custom (reinventeaza Dependabot + biome + tsc)
- Conventional Commits + auto-changelog (degradeaza changelog-ul narativ existent)
- Snapshot tests PDF (brittle — fonts, margini)
- i18n setup (premature abstraction clasica — zero customer anglofon confirmat)
- Zod (validation.ts actual functioneaza, nu rezolva problema reala)
- Export/re-import cycle tests (nu exista feature de import)
- CONTRIBUTING.md (solo dev)
- User-facing docs site (Manual integrat deja are 12 capitole)
- ADR-uri (overhead solo dev; deciziile sunt in changelog)
- Telemetry dashboard (contrazice postura GDPR)
- Migrare xlsx → exceljs (xlsx folosit doar pentru export, nu parse)

---

*Document creat 19.04.2026. Ordonat dupa ROI + dependente, nu dupa P0/P1 din documentul original.*
