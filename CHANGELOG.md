# Changelog - Legal Dashboard

Toate modificarile notabile ale acestui proiect sunt documentate in acest fisier.

---

## 27 Aprilie 2026 - v2.0.13 - PR-2: shadow tables auth + audit_log

Al treilea PR din roadmap (saptamana 1 incheiata). Scop: introducem `users`, `user_sessions`, `audit_log` ca tabele "shadow" — definite de acum dar nepopulate cu utilizatori reali pana la PR-9 (web mode + Google SSO). `audit_log` insa devine imediat scriabil prin helperul `recordAudit()`, pe care PR-3+ il vor consuma pe fiecare mutatie sensibila (monitoring CRUD, name list import, AI request). Pe desktop, comportamentul ramane identic: un singur user sintetic `local` e seed-uit, iar restul tabelei `users` e gol.

### Migrare DDL (`0002_users_sessions_audit.up.sql`)

- `users(id, email UNIQUE, password_hash, display_name, role, status, created_at, last_login_at, meta_json)`. CHECK pe `role IN ('user','admin','support','readonly')` si pe `status IN ('active','suspended','deleted')`.
- `user_sessions(id, user_id FK→users.id ON DELETE CASCADE, token_hash UNIQUE, user_agent, ip, expires_at, revoked_at, created_at)` cu index `(user_id, revoked_at)`.
- Seed `INSERT OR IGNORE INTO users(...) VALUES ('local','local@desktop','Local User','user')` — un singur user sintetic care reprezinta sesiunea desktop.
- `audit_log(id, owner_id, actor_id, ts, action, target_kind, target_id, outcome, ip, user_agent, detail_json)` cu CHECK `outcome IN ('ok','denied','error')` si indexuri `(owner_id, ts DESC)` + `(actor_id, ts DESC)`. `owner_id` nullable pentru evenimente de sistem.
- Down migration prezenta (manuala, neexecutata automat de runner) — DROP INDEX + DROP TABLE in ordinea inversa, plus `DELETE FROM _schema_versions WHERE version=2`.

### Helper `recordAudit()` (`backend/src/db/auditRepository.ts`)

- API: `recordAudit(c | null, action, options?)`. Cu `c: Hono.Context` extrage automat `owner_id`, `actor_id`, `ip` (via `getConnInfo` — consistenta cu rate-limit-ul, **NU** trusted proxy headers), `user-agent`. Cu `c = null` semneaza evenimente de sistem (boot, scheduler tick, backup).
- Override-uri explicite in `options` (e.g. admin actionand pentru alt tenant) cad peste valorile derivate din context.
- `serializeDetail()` JSON-ifica obiectul; pentru circular refs sau BigInt, fallback la `{_audit_serialize_error: true}` ca path-ul de audit sa nu blocheze niciodata request-ul.
- `getAuditEvents({ownerId, action, limit})` pentru read scope-uit pe owner sau system events (`ownerId: null`). Limit clamped `[1, 1000]`.
- Sincron pe scop — audit-urile se scriu pe mutatii (rar), nu pe queries (des). Erorile propaga; caller-ul decide daca le inghite.

### Tests (13 noi → total **99** backend, de la 85)

`backend/src/db/auditRepository.test.ts`:

- **Schema (6 teste)**: tabelele exista post-0002, seed `local` user prezent, `_schema_versions(2)` are hash real (nu sentinel-ul), CHECK rejecta role/status/outcome invalid, ON DELETE CASCADE pe user_sessions, idempotency la al 2-lea boot.
- **Write paths (4 teste)**: system events (`c=null`), context auto-fill (Hono `app.request()` cu `ownerContext` mount-uit end-to-end), explicit overrides, fallback pe detail necirculizabil.
- **Read paths (3 teste)**: scope per owner, system filter (`ownerId: null`), limit clamp.

Plus 1 fix in `runner.test.ts`: integration test-ul "real baseline" se astepta la `result.applied === [1]` — acum cu 0002 in repo, e `[1, 2]`. Testul foloseste `applied[0] === 1` + `length >= 1` ca sa nu mai fie nevoie de update la fiecare PR viitor.

### Bump

`2.0.12 → 2.0.13` patch. DDL nou pe DB-urile existente (legacy backfilled), zero schimbare user-vizibila, zero rute noi. Modulul `auditRepository` e pregatit dar inca neapelat (consumatori — PR-3+).

### Risk

🟢 **LOW**. 0002 ruleaza o singura data per DB. Pe DB-uri legacy: `_schema_versions(1, sentinel)` exista deja → 0002 vede applied=[1], aplica fresh, recordeaza `(2, sha256)`. Pe DB fresh: `0001_baseline` instaleaza schema rnpm_*, `0002` instaleaza users + audit. Seed-ul `INSERT OR IGNORE` e safe daca cineva pre-seed-uieste manual. Niciun query existent nu e modificat — tabelele noi nu intersecteaza cu rnpm_*.

---

## 27 Aprilie 2026 - v2.0.12 - PR-1: getOwnerId helper + 5 owner_id leak fixes

Al doilea PR din roadmap (PLAN §3 + EXECUTION-ROADMAP saptamana 1). Scop: stabilim seam-ul prin care toate rutele viitoare vor citi `owner_id`-ul curent din context si inchidem cele 5 cai latente prin care un FK breach ar fi putut leak-ui randuri intre owneri in modul web (PR-9+). Pe desktop, comportamentul ramane identic (singurul `owner_id` activ e in continuare `"local"`).

### Helper + middleware (`backend/src/middleware/owner.ts`)

- `ownerContext`: middleware Hono care seteaza `c.set("ownerId", "local")` pe fiecare request. PR-9 va inlocui valoarea cu user id-ul derivat din JWT (si va respinge requesturi neautentificate).
- `getOwnerId(c)`: helper consumat de rutele noi (PR-3+). Citeste valoarea seteaza de middleware; fallback `"local"` astfel incat o eventuala lipsa de mount sa pastreze comportamentul desktop.
- `ContextVariableMap` augmentat o singura data — `c.get("ownerId")` returneaza `string` in tot codebase-ul, fara cast manual.
- Mount-uit in `index.ts` ca `app.use("*", ownerContext)` inainte de `rateLimit` (deja pregatit pentru rate-limit per owner in PR-12).

### Fix-uri leak `avizRepository.ts` (5 locuri, PLAN §3)

`loadAvizChildren` re-querya copiii (creditori/debitori/bunuri/istoric) doar dupa `aviz_id`, fara `owner_id`. Daca un FK breach apare vreodata (bug de migrare, restore partial), child-ul user-ului B s-ar fi livrat catre user A. Toate cele 4 query-uri primesc acum `AND owner_id = ?` si pasa `aviz.owner_id`.

`getAvize` continea doua sub-clauze `EXISTS` peste `rnpm_creditori` / `rnpm_debitori` care matchau pe `c.aviz_id = a.id` fara constraint pe `owner_id`. Adaugat `AND c.owner_id = a.owner_id` (idem `d`) — un breach child al lui B nu mai poate face ca aviz-ul lui A sa apara in rezultatele unei cautari ale lui A.

### Test de regresie (`backend/src/db/repository-isolation.test.ts`)

Skeleton extensibil pentru toate repo-urile viitoare:

- **Happy path** (3 teste): `getAvize`, `getAvizById`/`getAvizByIdentificator`, `getAvizStats`/`getAvizeByIds`/`deleteAviz*` toate respecta filtrul `owner_id`. Cross-owner reads/writes intoarce `null` / `0`.
- **FK breach defense** (5 teste, cate unul per fix): inserturi raw care simuleaza un copil cu `owner_id` mismatch fata de aviz-ul parinte, apoi assert ca repo-ul **nu** returneaza randul forjat. Acopera toate cele 5 leak-uri din PLAN §3.

Suite-ul ruleaza in tmp dir cu `LEGAL_DASHBOARD_DB_PATH` setat per-test, deci nu atinge baza locala. 8 teste noi → total **85** in backend (de la 77).

### Bump

`2.0.11 → 2.0.12` patch. Zero schimbari user-vizibile, zero migrare DDL noua (PR-1 nu adauga schema, doar query fixes).

### Risk

🟢 **LOW**. Pe desktop singurul `owner_id` e `"local"` peste tot, deci constraint-urile noi `AND owner_id = ?` sunt no-op functional. Singura schimbare de comportament posibila e cazul (improbabil) de FK breach pre-existent: random copil ortografiat manual ar deveni invizibil — but exact asta e scopul fix-ului.

---

## 27 Aprilie 2026 - v2.0.11 - PR-0: migration framework + _schema_versions

Primul PR din roadmap-ul de monitoring + web mode (vezi `PLAN-monitoring-webmode.md`, `EXECUTION-ROADMAP.md`). Scopul e infrastructural: introducem un mecanism de migrari versionate inainte sa adaugam orice schema noua in PR-2+.

### Migration framework (`backend/src/db/migrations/`)

- `runner.ts` exporta `runMigrations(db, migrationsDir)`. La boot citeste sincron toate fisierele `0001_*.up.sql`, `0002_*.up.sql`, ... (sortate numeric, contiguu de la 1) si le aplica in tranzactie pe cele neinregistrate inca in tabela `_schema_versions(version INTEGER PRIMARY KEY, applied_at TEXT, sha256_up TEXT)`.
- **Backfill pentru DB-uri legacy**: la prima rulare, daca `_schema_versions` e gol AND DB-ul are tabele user (instalari v2.0.10 si mai vechi), runner-ul insereaza `(1, '__backfilled_v1__')` si SARE peste executia `0001_baseline.up.sql`. Asta evita `CREATE TABLE` duplicat pe schema deja prezenta.
- **Drift detection**: la rulari ulterioare, daca hash-ul stocat difera de continutul fisierului → throw + abort boot. Mesajul de eroare include numarul versiunii urmatoare disponibile pentru forward progress (e.g. "create a new 0002_*.up.sql instead").
- **Downgrade guard**: daca DB-ul are versiune > max(file_version) → throw (preveniti accidentul "checkout commit vechi pe DB nou").
- **Sanity la discovery**: duplicate de versiune, gap-uri in numerotare, lipsa directorului → throw cu mesaj clar.

### Baseline schema commit-uita (`0001_baseline.up.sql`)

- Reflecta v2.0.10 in forma FINALA post-ALTER: rnpm_avize cu cele 4 coloane `inscriere_initiala/modificata_*`, rnpm_creditori/debitori cu `subscriptor + nr_ordine`, rnpm_bunuri **fara** `descriere` (deduplicat in `rnpm_bunuri_descrieri`) dar cu `referinte_json + descriere_id`.
- Ordinea CREATE respecta dependintele FK sub `PRAGMA foreign_keys = ON`: searches → avize → bunuri_descrieri → creditori/debitori → bunuri → istoric.
- Pe DB-uri fresh (CI, instalari noi), runner-ul executa fisierul si stocheaza sha256 real. Pe instalari legacy se sare prin sentinel.

### Wiring in `schema.ts`

- `initSchema()` apeleaza `runMigrations()` ca **Phase 1**, urmat de blocul idempotent legacy CREATE/ALTER existent ca **Phase 2**. Phase 2 ramane intact pentru DB-urile backfilled cu sentinel — pentru ele 0001_baseline e skipped, deci ALTER-urile inline sunt singura sursa de mentinere a coloanelor adaugate intre v2.0.0 → v2.0.10.
- Zero schimbare de comportament pentru useri instalati: `LEGAL_DASHBOARD_DB_PATH` deschide DB-ul existent → backfill o singura data → ALTER-urile inline ruleaza ca pana acum → totul continua.

### Build pipeline (`scripts/build.js`)

- Pas nou `[4/4] Copying migration files...` care copiaza `backend/src/db/migrations/*.up.sql` + `*.down.sql` la `dist-backend/migrations/`. Esbuild bundleaza CJS dar nu copiaza assets non-JS; runner-ul le citeste cu `fs.readdirSync(migrationsDir)` la boot.
- Filtru pozitiv (whitelist `*.up.sql|*.down.sql` plus directoare pentru recursie), nu negativ — fisierele sidecar (test, README, viitoare TS helpers) raman in afara bundle-ului productie.

### Tests (`runner.test.ts`)

- 15 teste vitest pe runner: ordering numeric, idempotency, hash mismatch → throw, backfill cu sentinel pe DB legacy, sentinel sare hash check, transaction rollback la SQL invalid, gap detection, duplicate version detection, downgrade guard.
- Plus un test integration care ruleaza efectiv `0001_baseline.up.sql` pe DB temporar si verifica ca toate cele 7 tabele sunt create.

### Verificare

- `npx tsc --noEmit -p backend/tsconfig.json` — clean.
- `npm test --workspace=backend` — toate testele verde (62 existente + 15 noi runner = 77 total).
- Smoke desktop: `npm run electron:dev` cu DB-ul existing v2.0.10 → boot ok, log `[schema] legacy DB — backfilled _schema_versions(1, sentinel)` o singura data, run urmator → silent (deja backfilled).

---

## 26 Aprilie 2026 - v2.0.10 - hardening: AI logging extension + backup maintenance lock + safeStorage trim

Continuare directa a `v2.0.9`. Trei imbunatatiri de hardening pe linia de observabilitate AI, integritatea operatiilor de backup/restore si robustetea persistentei cheilor API. Plus o investigatie negativa inchisa pe partea de captcha RNPM.

### Observabilitate AI extinsa

- `services/ai.ts` exporta acum helper-ul `isTimeoutOrAbort(e)` care detecteaza corect timeout-urile si abort-urile inclusiv pentru subclase SDK (Anthropic / OpenAI `APIUserAbortError` / `APIConnectionTimeoutError`, Google SDK abort errors). Inainte normalizarea se baza doar pe `e.name`, care e `"Error"` pentru subclase ce nu il override-uiesc - branch-ul timeout era practic dead.
- `withAiLogging` accepta acum `{ value, meta }` din functia interioara, astfel incat fiecare provider sa-si ataseze `usageInput` / `usageOutput` (token counts) la log-ul JSON. Plus capturarea `httpStatus` din erorile SDK (`.status` pe `APIError`) ca dashboard-urile sa poata splita 4xx/5xx vs network/abort.
- `ai_call` log line acum poate include: `httpStatus`, `usageInput`, `usageOutput`, complementar cu `latencyMs`, `status`, `errorType`. Pasul intermediar pana la `audit_log` persistent (Faza 5).

### Backup/restore: maintenance lock + WAL truncate pre-snapshot

- `withMaintenanceLock` (promise chain in-process) serializeaza `restoreFromBackup` cu `runDailyBackup`. Pe desktop nu sunt concurente in practica, dar scheduler-ul `runDailyBackup` putea teoretic interleave-ui cu un restore initiat de user care inchide DB-ul mid-`db.backup()` -> destinatie corupta. Web mode va inlocui cu row-lock / advisory lock.
- Pre-restore snapshot face acum `PRAGMA wal_checkpoint(TRUNCATE)` *inainte* de `closeDb()`. Fara checkpoint, pre-restore copy captura doar fisierul `.db` si pierdea frame-urile WAL necommitate -> rollback-ul "moments before restore" era silent incomplete.
- `logBackupEvent` (single-line JSON, `ts` auto-stamp) inlocuieste `console.log` ad-hoc. `daily_backup_failed` distinge acum `stage: "mkdir"` vs `stage: "backup"`. Sterge orphan sidecar `-wal`/`-shm` cu logging non-ENOENT (EBUSY de la AV pe Windows nu mai e silentios).
- `runDailyBackup` foloseste `await fsPromises.mkdir` in loc de `fs.mkdirSync` (nu mai blocheaza event loop-ul; cosmetic - dir-ul exista in 99% din cazuri).

### Frontend: safeStorage defensive trim

- `useApiKey.setKeys()` aplica `.trim()` pe fiecare cheie inainte de persistare. Inchide o gap legacy: path-ul de migrare `deobfuscate` propaga whitespace din intrari vechi `localStorage`, iar fara trim-ul defensiv keystore-ul ramanea cu spaces care faceau cererile sa esueze cu 401. `setKey` deja trimea valoarea individuala; `setKeys` (bulk) nu o facea.

### RNPM gcode caching - investigatie inchisa (negativa)

- Test empiric `2026-04-26` confirma ca RNPM **respinge** reuse-ul gcode intre cautari cu parametri diferiti. Spike in `RnpmSearch.tsx` care threading `existingGcode` din `runSearch` precedent a generat in backend `phase: "search_retry"` (gap 16.4s = failed-SOAP + captcha re-solve + retry), nu `phase: "search"` direct.
- Concluzie: captcha-per-query este cost intrinsec la nivelul API-ului RNPM. Optimizarile client-side nu pot evita. Path-ul existent de pagination intra-search (`loadNextBatch` reuseaza gcode-ul corect) ramane valid.
- Mitigari posibile pe viitor (neinvestigate): provider mai rapid (CapSolver vs 2Captcha - deja setting), race mode (deja suportat), pre-warm captcha speculativ.

### CodeRabbit follow-up

- Verificate trei claim-uri pe CodeRabbit: `setKeys` nu trim (PARTIAL VALID - fixat), `.mcp.json` shape (FALSE POSITIVE - format-ul actual e valid), `fs.mkdirSync` blocking (VALID cosmetic - fixat). Cele doua valid au fost executate pure-equivalent fara impact functional.

### Verificare

- `npx tsc --noEmit -p backend/tsconfig.json` - clean.
- `cd frontend && npx tsc --noEmit` - clean.
- `npm test --workspace=backend` - 62/62 teste verde (include teste noi pe `withMaintenanceLock` + WAL checkpoint si pe `isTimeoutOrAbort`).

---

## 26 Aprilie 2026 - v2.0.9 - Faza 10 medium close-out + Docker CI

Continuare directa a hardening-ului `v2.0.8`: inchide ultimele patru medium-priority din review-ul Faza 10 (M4-M7) si adauga un workflow GitHub Actions care valideaza imaginea Docker la fiecare push pe `main` sau pull request.

### Restore correctness (F10-M4 + F10-M5)

- `restoreFromBackup` foloseste acum `await fsPromises.access(dbPath)` + flag `dbExists` in loc de `fs.existsSync`. Path-ul ramane integral asincron, iar event loop-ul nu mai blocheaza pe stat-uri lente (de ex. fisier scanat de antivirus).
- `unlink(-wal)` / `unlink(-shm)` se executa **inainte** de `rename(tmpPath, dbPath)`. Inainte exista o fereastra in care DB-ul nou era pereche cu sidecar-uri WAL/SHM stale, iar `better-sqlite3` putea face lazy open peste combinatia gresita (silent corruption la primul query post-restore).

### Observability (F10-M6)

- `services/ai.ts` introduce helper-ul `withAiLogging(provider, model, fn)` care imbraca `callAnthropic` / `callOpenAI` / `callGoogle`. Fiecare apel emite un singur rand JSON: `{ action: "ai_call", provider, model, latencyMs, status, errorType?, ts }`. `TimeoutError` / `AbortError` sunt normalizate la `errorType: "timeout"` ca agregatoarele sa nu trebuiasca sa special-case-uieze ambele.
- Util pentru ops: cost tracking grosier per provider, rata de timeout-uri, latente la nivel de model. `audit_log` persistent ramane scope Faza 5 (compliance).

### Docker CI smoke test (F10-M7)

- `.github/workflows/docker-build.yml` ruleaza la push pe `main` si la PR atunci cand `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `package-lock.json`, `backend/**`, `frontend/**` sau `scripts/build.js` se schimba.
- Pasi: `npm ci` + `npm run build` (genereaza `dist-backend/` + `dist-frontend/` cerute de Dockerfile) -> `docker build -t legal-dashboard:ci .` -> smoke test `node -e "console.log(process.version)"` in image -> smoke test `/health` (poll 60s, valideaza prewarm + listen flip la 200 OK in container).
- Containerul primeste `HOST=0.0.0.0` + `LEGAL_DASHBOARD_ALLOW_REMOTE=1` la `docker run` astfel incat portul 3002 sa fie accesibil din afara (loopback-ul containerului e izolat de host - `-p 3002:3002` cere bind non-loopback).
- Esuarea oricarui pas dump-eaza `docker logs ld-ci` si `exit 1`, ca triage-ul sa fie posibil direct din run-ul GitHub Actions.

### Verificare

- `npx tsc --noEmit -p backend/tsconfig.json` - clean.
- `npm test --workspace=backend` - 55/55 teste verde.
- `cd frontend && npx tsc --noEmit` - clean.
- GitHub Actions Docker Build run `24955410182` - verde in 2m20s, smoke test `/health` confirma 200 OK in containerul produs.

---

## 26 Aprilie 2026 - v2.0.8 - hardening + release packaging

Sesiune de hardening dupa tag-ul `v2.0.7`. Versiunea `v2.0.8` include fixurile post-tag pentru backup/env/SOAP, teste de regresie pe backup atomic si packaging reproductibil pentru Docker + ZIP server.

### Backend hardening - backup, restore, env si SOAP cancel

**Fixuri livrate:**

- `backend/.env.example` nu mai contine `NODE_ENV=development`; template-ul explica faptul ca Electron/Docker seteaza production, iar dev mode se activeaza explicit din shell.
- `cautareDosare(params, { signal })` propaga `AbortSignal` pana in `fetch`-ul SOAP prin `AbortSignal.any([external, timeout])`, deci disconnect-ul clientului sau timeout-ul SSE opresc request-ul in zbor.
- `runDailyBackup` scrie backup-ul zilnic la `${dest}.tmp`, apoi face `rename` atomic; orphan `.db.tmp` se curata la urmatorul run.
- `restoreFromBackup` emite log JSON structurat `{ action, source, preRestore, ts }`, util pana la introducerea unui `audit_log` persistent.

### Teste backup atomicity (F10-M8)

- `backup.test.ts` acopera cleanup-ul orphan `legal-dashboard.*.db.tmp`.
- Verifica faptul ca fisierele `.tmp` care nu apartin aplicatiei nu sunt sterse.
- Verifica faptul ca `listBackupsWithMeta` expune doar backup-uri finalizate `.db`, nu staging `.db.tmp`.
- Verifica retention pools separate pentru daily / pre-restore / pre-migration (`7/5/5`), ca un pool sa nu le elimine pe celelalte.

### Release packaging - Docker si ZIP server

- `Dockerfile` foloseste acum `package-lock.json` + `npm ci --omit=dev --workspace=backend --include-workspace-root=false --build-from-source`, nu `npm install` fara lockfile.
- `Dockerfile` si `docker-compose.yml` au `start-period/start_period=120s` pe healthcheck pentru boot-uri lente cu prewarm/migrari DB.
- `dist:server` include in ZIP root `package.json`, `package-lock.json`, `backend/package.json`, `frontend/package.json`.
- `start.sh` / `start.bat` instaleaza runtime deps cu `npm ci` la prima pornire daca lipseste `node_modules/better-sqlite3`, astfel incat modulul nativ sa fie construit pe platforma tinta.
- `.gitignore` ignora `server-release/`; `.dockerignore` pastreaza manifestele necesare workspace-ului in build context.

### Developer workflow

- Script nou `npm run rebuild:electron` pentru recompilarea `better-sqlite3` pe ABI-ul Electron dupa teste Node / `npm rebuild`.

### Verificare

- `npx tsc --noEmit -p backend/tsconfig.json` - clean.
- `npm test --workspace=backend` - 55/55 teste verde.
- `npm run build` - clean.
- `npm run dist:server` - ZIP generat; arhiva contine lockfile + manifests + start scripts.
- `npm run rebuild:electron` + `npm run electron:dev` - aplicatia porneste, `/health` raspunde 200.

---

## 26 Aprilie 2026 - v2.0.7 - RNPM tab-state UX fix

Sesiune de corectie UI pentru tab-ul **Cautare RNPM**. Bump de versiune din `2.0.6` la `2.0.7`, ca fixul sa fie vizibil in aplicatie, documentatie si artefactele de release.

### RNPM - rezultatele nu mai "curg" intre cele 5 categorii

**Simptom:** dupa o cautare in `Aviz de ipoteca mobiliara`, rezultatele ramaneau vizibile si dupa schimbarea categoriei interne catre `Fiducie`, `Aviz specific`, `Creante securitizate` sau `Obligatiuni ipotecare`.

**Fix:**

- [frontend/src/components/rnpm/RnpmSearchForm.tsx](frontend/src/components/rnpm/RnpmSearchForm.tsx) expune `onTypeChange`, apelat cand utilizatorul schimba categoria RNPM.
- [frontend/src/pages/RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx) tine `activeSearchType` separat de `lastType`.
- Tabelul, mesajele de eroare si actiunile `Incarca tot` / `Opreste incarcarea` folosesc `visibleResult` / `visibleError`, afisate doar cand `activeSearchType === lastType`.

### RNPM - revenire corecta din Cautare / Bulk / Baza locala

**Simptom:** cand utilizatorul pleca din tab-ul principal `Cautare` catre `Bulk` sau `Baza locala`, apoi revenea, formularul se remonta pe prima categorie (`Aviz de ipoteca mobiliara`). Daca rezultatul anterior apartinea acelei categorii, uneori ramanea ascuns pana cand utilizatorul se plimba manual intre cele 5 categorii.

**Fix:**

- Sectiunea `Cautare` ramane montata permanent si este doar ascunsa cu `hidden`, la fel ca `RnpmSavedData`.
- State-ul intern al formularului ramane viu intre cele 3 taburi principale: categoria activa, campurile completate si rezultatul vizibil.
- `RnpmSearchForm` sincronizeaza categoria activa cu parent-ul la mount si la schimbarea categoriei, ca UI-ul vizibil si `activeSearchType` sa nu mai intre in drift.

### Verificare

- `npm run build --workspace=frontend` - clean.
- `npm run build` - clean; `dist-frontend` si `dist-backend` regenerate.
- Electron repornit manual; `/health` raspunde `ok`, `/api/rnpm/saved` raspunde cu date.

---

## 19 Aprilie 2026 (sesiune 3) — v2.0.6 — SOAP XML entity decoding + consolidare CodeRabbit findings

Fix de corectitudine pe parser-ul SOAP PortalJust + consolidarea auditului CodeRabbit 19.04.2026 in roadmap-ul de hardening. Nimic nou in feature set — doar bani ficti mai curati pe display + un punch-list explicit pentru tranzitia web si modulul de monitorizare.

### SOAP parser — decodare entitati XML (I3 din audit CodeRabbit)

**Simptom:** nume parti cu `&` / `'` / `"` (ex. `S.C. X &amp; Co. SRL`, `John&apos;s Pub`) apareau cu literal `&amp;` / `&apos;` in tabele, modal detalii, export XLSX si promptul AI. `DOMPurify` neutraliza orice risc de injectie, deci nu e vulnerabilitate — dar output-ul e vizibil gresit.

**Cauza:** [backend/src/soap.ts](backend/src/soap.ts) foloseste regex simplu pentru `extractFirst` / `extractAll`, fara decoder pentru entitati XML. PortalJust (corect) escape-eaza `&`, `<`, `>`, `"`, `'` in text nodes — aplicatia le returna raw.

**Fix:**

- Helper nou `decodeXmlEntities(s)` exportat din `soap.ts` — decodeaza in ordine: numeric hex (`&#x41;`), numeric zecimal (`&#65;`), named (`&lt;`, `&gt;`, `&quot;`, `&apos;`) si **`&amp;` ultimul** ca sa nu dublu-decodeze secvente de forma `&amp;lt;` in `<`.
- **Aplicat la leaf fields** in `parseDosar`, nu la nivelul `extractFirst` / `extractAll`. Motiv: extractoarele pot returna XML inner cu tag-uri nested (`<DosarParte>` in `<parti>`); decoderea prematura ar risca sa transforme text legal cu `&lt;` in tag-uri fantoma. Campuri decodate: `obiect`, `institutie`, `departament`, `categorieCaz`, `stadiuProcesual`, `parti[].nume`, `parti[].calitateParte`, `sedinte[].solutie`, `sedinte[].solutieSumar`, `sedinte[].complet`, `sedinte[].documentSedinta`.
- Campuri cu format strict (`numar`, `data`, `ora`, `numarDocument`, `dataPronuntare`) raman ne-decodate — nu contin entitati prin natura datelor.
- **Teste noi** ([backend/src/soap.test.ts](backend/src/soap.test.ts)): 4 unit tests pentru `decodeXmlEntities` (named / numeric / invariant „`&amp;` nu dublu-decodeaza" / passthrough pe text fara entitati) + 1 integration test pe `parseDosar` cu payload mixt (entitati in nume, obiect si solutie). Total: **24 → 29 teste verde**.

### HARDENING — Faza 7: consolidare CodeRabbit findings 19.04.2026

Auditul CodeRabbit a scos 4 Critical + 7 Important. Fiecare verificat manual vs codul sursa (fisier:linie concrete), apoi sintetizat in [HARDENING.md](HARDENING.md) Faza 7 ca punch-list actionabil. Fisierul intermediar `CODERABBIT-FINDINGS-2026-04-19.md` a fost eliminat — context-ul necesar e self-contained in fiecare bullet din Faza 7.

**Blockers pentru web deploy** (~3h total, fix inainte de orice `LEGAL_DASHBOARD_ALLOW_REMOTE=1` sau Docker push):

- **C1** — `GET /api/dosare` + `/api/termene` ruleaza `Promise.all` peste `institutii[]` fara cap `MAX_SOAP_FANOUT`. Doar `MAX_INSTITUTII=50` e aplicat; guard-ul exista deja in SSE `/load-more`, trebuie oglindit pe GET. Amplificator SOAP outbound + memory pressure in web mode.
- **C2** — rate limiter foloseste string `"unknown"` ca bucket cand `getConnInfo(c).remote.address` e falsy. In web mode orice client fara IP resolvable consuma quota partajata. Fix: HTTP 503 fail-closed.
- **C3** — Dockerfile ruleaza ca root + `COPY .env* ./` baked in layers (secrete persistente in imagine). Fix: `USER app` non-root + `.dockerignore` cu `.env*` + inject env la runtime.
- **C4** — docker-compose bind-uieste `3001:3001` pe toate interfete-le dar backend-ul forteaza `127.0.0.1` fara `LEGAL_DASHBOARD_ALLOW_REMOTE=1` → port forward se termina in container loopback, service invizibil silent. In plus port-mismatch cu backend default `LEGAL_DASHBOARD_PORT=3002`.
- **I2** — CORS allow-list are `localhost:5173/4173` fara gate pe `NODE_ENV`. In build productie un atacator local pe host-ul deploy poate emite request-uri cross-origin cu credentials.

**Pre-monitorizare Watched Dosare** (~4h, inainte de auto-sync multi-dosar):

- **I4** — splash „Optimizare baza de date..." inainte de VACUUM sincron pe migration path `descriere-dedup` (azi blocheaza Electron UI 30-90s fara feedback la primul boot post-upgrade).
- **I5** — `searchRepository.saveSearch` accepta orice string pentru `searchType`. Validare enum la repository boundary.
- **I6** — `rateLimitMap` cleanup doar la size>1000. Trebuie mutat pe `setInterval(60_000).unref()`.
- **I7** — `let body: any` in ai.ts handlers (singurul `any` ramas in backend) → `unknown` + narrowing via `validateAiBody` tipat.

**Suggestions opportunistic** (~2h): `json: any` in api.ts, README GPU flag, log orphan solve-id captcha, comentariu User-Agent RNPM, pinning test validateParamsDepth, debounce `cleanupOrphanDescrieri`.

**Rejected ca false positive** (verificat vs cod):

- **I1** — CodeRabbit a raportat dublu-apel `validateAiBody` in `/analyze-multi`. Citit direct [backend/src/routes/ai.ts:102-109](backend/src/routes/ai.ts): un singur apel la L106; L102-103 sunt guard-uri existence (`!body || typeof body !== "object"` si `!body.dosar`), nu re-validari. Not actionable.

### De ce aceasta versiune

Doua borne apropiate: **tranzitia web** (cand ridicam `LEGAL_DASHBOARD_ALLOW_REMOTE` sau distribuim Docker image) si **modulul Watched Dosare cu auto-sync** (Pilon B din roadmap). Ambele reuseaza codul atacat de findings — e mai ieftin sa ai punch-list-ul scris inainte de implementare decat sa-l inventezi la momentul critic. I3 s-a facut azi pentru ca e corectitudine vizibila la user (~30 min), restul raman in `[ ]` pentru sprint dedicat.

### Verificare

- `npx tsc --noEmit -p backend/tsconfig.json` — 0 erori.
- `npm test --workspace=backend` — **29/29 verde** (24 existente + 5 noi pentru XML entities).
- Manual pe payload SOAP real cu `&amp;` in denumire parte: render corect in `DosareTable`, modal detalii, export XLSX, prompt AI.

---

## 19 Aprilie 2026 (sesiune 2) — Backend god-file split + audit remediation + RNPM UX + dark bar nativ

Sesiune larga: ultimul god-file (backend/src/index.ts) spart in module dedicate; review tehnic intern cu findings inchise si ramase; UX pe paginarea RNPM; sincronizare tema nativa Windows; export PDF pentru changelog.

### Backend — index.ts 1214 → 133 linii

Audit-ul a identificat [backend/src/index.ts](backend/src/index.ts) ca ultimul fisier monolitic mare din proiect: bootstrap + middleware + rate limiting + SOAP + AI + static serving + lifecycle erau toate inghesuite intr-un singur fisier. Splitat in module cu responsabilitate unica; comportamentul observabil este neschimbat (type-check + smoke tests RNPM).

- [backend/src/routes/dosare.ts](backend/src/routes/dosare.ts) (204 linii) — SOAP PortalJust search endpoints.
- [backend/src/routes/termene.ts](backend/src/routes/termene.ts) (236 linii) — termene by instanta + istoric.
- [backend/src/routes/ai.ts](backend/src/routes/ai.ts) (182 linii) — multi-provider AI proxy (Claude / OpenAI / Gemini).
- [backend/src/services/ai.ts](backend/src/services/ai.ts) (219 linii) — provider clients + cost calculators.
- [backend/src/services/batch-dosare.ts](backend/src/services/batch-dosare.ts) (186 linii) — batch analysis orchestration cu AbortSignal.
- [backend/src/middleware/rate-limit.ts](backend/src/middleware/rate-limit.ts) (40 linii) — real-IP rate limiter.
- [backend/src/middleware/static-frontend.ts](backend/src/middleware/static-frontend.ts) (64 linii) — static serving cu path-traversal guard intact (`path.relative` + `decodeURIComponent` defensiv).
- [backend/src/util/validation.ts](backend/src/util/validation.ts) — validare shared request payloads.
- `index.ts` ramane doar bootstrap: CSP, CORS, mount routers, loopback-guard, prewarm page cache, daily backup, graceful shutdown.

### Audit remediation (legal-dashboard-review-report.md)

Review tehnic complet orientat spre code quality + security posture + component architecture. Inchise in aceasta iteratie sau confirmate ca deja rezolvate:

- **[INCHIS]** Static path traversal — middleware dedicat cu `path.relative` + `decodeURIComponent` defensiv.
- **[INCHIS]** Logging RNPM sensibil — [rnpmSearchService.ts:90-101](backend/src/services/rnpmSearchService.ts#L90-L101) logheaza doar type/page/field-names, nu valori PII.
- **[INCHIS]** TermeneTable selection drift — chei stabile + dedup in `loadMore` cu aceeasi semantica.
- **[INCHIS]** God-files `DosareTable` + `RnpmSearchForm` + `backend/src/index.ts` — toate splitate (frontend in v2.0.4, backend in v2.0.5).

Ramase active pentru faze ulterioare (documentate in `legal-dashboard-review-report.md`):

- **[P1]** `useApiKey` fallback `localStorage` pentru web mode — de eliminat inainte de tranzitia la web; AI doar cu chei server-side.
- **[P1]** Dependente vulnerabile — `dompurify` / `jspdf` / `jspdf-autotable` / `xlsx` (faza de dependency hardening separata).
- **[P2]** Modal standardization — `useDialog` nu e folosit uniform; plan: `DialogShell` comun + `role="dialog"` + `aria-modal`.
- **[P3]** Hono stack — `hono` + `@hono/node-server` raman in urma fata de advisories curente.

### Electron — title bar + menu bar nativ urmeaza tema app-ului

In dark mode, bara nativa Windows (title bar + meniul Fisier/Editare/Vizualizare/Fereastra/Ajutor) ramanea light chiar si cand app-ul era dark. Fix prin sync explicit catre `nativeTheme` pe fiecare toggle.

- [electron/main.js](electron/main.js) — import `nativeTheme` + `ipcMain.handle("window:setTheme")` care seteaza `nativeTheme.themeSource` in `"dark" | "light" | "system"`.
- [electron/preload.js](electron/preload.js) — expune `window.desktopApi.setWindowTheme(theme)` via contextBridge; suprafata IPC ramane minima + tipata in [desktop-api.d.ts](frontend/src/types/desktop-api.d.ts).
- [useTheme hook](frontend/src/hooks/useTheme.ts) — apeleaza `setWindowTheme` in `useEffect`-ul existent, fire-and-forget; pe web (fara `desktopApi`) ramane no-op via `?.`.
- Windows 11 aplica tema dark pe title bar + meniul nativ dupa prima IPC din renderer (flicker minim la boot).

### Changelog — export PDF

Buton nou „Export PDF" in pagina Changelog genereaza un document portrait A4 cu tot istoricul (versiune + data + subtitlu + sectiuni + bulleturi) pentru lectura in afara aplicatiei.

- [frontend/src/lib/changelog-pdf.ts](frontend/src/lib/changelog-pdf.ts) — jsPDF dynamic import, auto page-break, page numbering, strip diacritics pentru compatibilitate Helvetica.
- Fisier salvat ca `legal-dashboard-changelog-v<VERSION>.pdf` — `VERSION` din `__APP_VERSION__` (root package.json, single source of truth).

### RNPM — auto-loop „Incarca tot" (pe modelul cautarii de dosare)

Butonul `Incarca mai multe` obliga click per batch pe cautari cu sute/mii de rezultate. Flow inlocuit cu **auto-loop**:

- [RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx): state nou `autoLoading: boolean` + `useEffect` care re-declanseaza `loadNextBatch()` dupa fiecare batch completat, pana cand `result.nextRnpmPage === null` sau user apasa stop.
- Buton single cu contor in text: `Incarca tot (X din TOTAL)` → `Opreste incarcarea (X din TOTAL)` (variant `destructive` in timpul auto-load-ului).
- **Bara de progres albastra** (h-1.5 w-32) langa buton — `style.width = Math.round((documents.length / total) * 100)%`; animata cu `transition-all duration-300`.
- **Stop duplicat suprimat** in timpul auto-load-ului — prop nou `suppressStop?: boolean` pe `RnpmSearchForm`, setat de parent la `result != null && result.nextRnpmPage != null`. Stop-ul formularului ramane activ doar in prima faza (inainte ca primele rezultate sa apara).
- Datele deja aduse raman accesibile in tabel in timpul auto-load-ului (scroll, filtru, click detaliu functioneaza neintrerupt). Abort middle-batch pastreaza documentele deja incarcate.

### RNPM Detalii — tab Bunuri: lag eliminat pentru avize cu 1000+ items

Pe avize mari (test real: 1730 bunuri pe un singur aviz), primul click pe tabul Bunuri bloca rendererul ~800ms. Fix cu 3 linii CSS, fara `@tanstack/react-virtual` sau alta dependenta.

- [RnpmDetailModal.tsx](frontend/src/components/rnpm/RnpmDetailModal.tsx) — pe fiecare card bun: `style={{ contentVisibility: "auto", containIntrinsicSize: "auto 150px" }}`.
- Chromium decide singur ce iese din viewport si **skip-uieste rendering-ul**; click-to-render din ~800ms → imperceptibil. Singurul cost: un pop-in scurt la flick-scroll foarte rapid prin mii de iteme — nu e flow real.
- Memoria proiectului actualizata (`project_legal_dashboard_large_list_render.md`) sa indice **content-visibility** ca default pentru liste mari viitoare in renderer.

### Sterge baza — acum elibereaza efectiv spatiul pe disc

**Simptom:** dupa `Sterge baza` contoarele aratau 0 avize, dar fisierul `.db` ramanea la ~112 MB.

**Cauza:** SQLite `DELETE` marcheaza doar pagini libere intern — nu returneaza spatiul pe disc fara `VACUUM`. `PRAGMA wal_checkpoint(TRUNCATE)` e necesar pentru a trunchia si fisierul `-wal`.

**Fix** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)):

```ts
rnpmRouter.delete("/saved/all", (c) => {
  const count = deleteAllAvize();
  try { compactDb(); } catch (e) { console.warn("[rnpm] compact after delete-all failed:", e); }
  return c.json({ deleted: count });
});
```

- `compactDb()` e implementat in repositories ca `db.exec("VACUUM"); db.pragma("wal_checkpoint(TRUNCATE)")`.
- Best-effort: esecul `VACUUM` logheaza warning (ex. daca rulează alta tranzactie), dar stergerea randurilor nu e blocata.
- Panoul `Info baza locala` reflecta corect eliberarea imediat dupa stergere.

### Observabilitate — HTTP 499 pentru user-abort pe RNPM search

Anterior, abortul clientului (buton Stop / Opreste incarcarea) rezulta in log 500 pe backend — indistinct de erorile reale (captcha fail, upstream down, parse fail). Schimbat la **499 Client Closed Request** (convenția nginx, non-standard).

**Fix** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)):

```ts
} catch (e) {
  if (e instanceof DOMException && e.name === "AbortError") {
    console.log("[rnpm/search] aborted by client");
    // 499 = Client Closed Request. Hono's ContentfulStatusCode exclude 499,
    // deci emit direct prin Response pentru a pastra status-ul.
    return new Response(JSON.stringify({ error: "Cautare oprita" }), {
      status: 499,
      headers: { "Content-Type": "application/json" },
    });
  }
  ...
}
```

- `console.log` ramane pentru observabilitate backend.
- UI-ul nu vede `499`: fetch-ul client se arunca deja cu `AbortError` inainte de primirea raspunsului, iar `isAbort(e) || ctl.signal.aborted` suprima orice UI de eroare.
- Metricile 500 devin curate — reflecta doar esec real.

### Verificare

- `npx tsc --noEmit` — clean pe ambele workspace-uri.
- Manual in Electron: cautari 200+ rezultate cu auto-load, Stop la mijloc + reluare, `Sterge baza` cu observare dimensiune fisier `.db` inainte/dupa, abort middle-batch (backend scrie 499 in logs, UI ramane curat).

---

## 19 Aprilie 2026 — Refactor structural major + polish formular RNPM

Sesiune dedicata reducerii complexitatii componentelor mari (pre-conditie pentru web transition + testabilitate) si rafinarii formularului de cautare RNPM.

### Splituri de componente

Componentele care crescusera peste 500-800 linii prin acumulare au fost sparte in parti dedicate cu responsabilitate unica:

- **DosareTable** (1063 → ~450 linii): extrase `dosare-ai-config.ts` (AI_MODELS, JUDGE_MODELS_LIST, PROVIDER_LABELS, model cost), `dosare-table-highlight.tsx` (highlight helpers pentru AI output), `dosare-table-helpers.ts` (utilitare generice), `dosare-ai-analysis-panel.tsx` (panoul single + multi-agent cu sanitizare DOMPurify). Paginarea reutilizeaza `table-pagination.tsx`.
- **RnpmSearchForm** (863 → ~590 linii): extrase `rnpm-form-constants.ts` (CATEGORIES, TIP_AVIZ_BY_CATEGORY, DESTINATIE_IPOTECI/INSCRIERII, BUN_ALT_TIP_CATEGORII), `rnpm-form-hooks.ts` (useText, useSiSauField, usePJField, usePFField), `rnpm-form-fields.tsx` (SiSauToggle, PJPFToggle, PJBlock, PFBlock, PartyFieldset, VehiculFieldset, DestinatieSelect, CollapsibleFieldset).
- **Sidebar**: extrase `sidebar-footer.tsx` si `sidebar-history-entry.tsx`.
- **MetricsPanel**: extrase `metrics-panel-parts.tsx` cu sub-componentele de rendering.
- **Dashboard**: extrase `dashboard-modals.tsx` si `dashboard-summary-cards.tsx`.
- **Manual**: continutul (mii de linii de text) extras in `manual-content.tsx`.
- **Changelog**: datele (toate version entries) extrase in `data/changelog-entries.tsx`; pagina `Changelog.tsx` pastreaza doar render layer.
- **TermeneTable**: row-ul extins extras in `termene-table-detail-row.tsx`.

**Motivatie:** testabilitate scazuta, review greu, risc mare de regresii pe fisiere peste 1000 linii. Extractia pastreaza acelasi comportament observabil (verificat in browser) si deblocheaza rescrieri incrementale viitoare.

### RNPM — formular search polish

Formularul de cautare RNPM a fost ajustat pentru paritate cu site-ul oficial si pentru a reduce clutter-ul vizual:

- **Creditor PF** primeste camp **Prenume** (exista deja la Debitor PF; paritate completa cu formularul RNPM).
- **PFBlock** rearanjat cu grid `1fr_1fr_auto`: rand 1 = Nume + Prenume + toggle SI/SAU, rand 2 = CNP (full width col 1) + toggle SI/SAU sub primul. Toggle-urile SI/SAU stivuite vertical la dreapta (aestetica + CNP vizibil pe toate 13 cifre).
- **Vehicul (bun garantat)** si **Bun (alt tip) & Tert cedat** devin zone colapsabile (nou `CollapsibleFieldset` cu chevron + `defaultOpen=false`) — reduc inaltimea formularului la scroll initial, fara a pierde campurile.
- **Legend alignment fix**: in fieldset-uri imbricate in `CollapsibleFieldset`, folosim `ml-*` (margin-left) pe `<legend>` in loc de `pl-*` (padding-left) — `pl-*` lasa un stub de border vizibil la stanga (aparent "discontinuu"), `ml-*` muta legend-ul intreg si border-ul ramane continuu pana la text.

### RNPM — bulk stats refresh

`RnpmBulkSearch` primeste prop `onItemSaved?: () => void` (invocat la fiecare item cu `phase === "done" && resultCount > 0`). Parent-ul `RnpmSearch.tsx` incrementeaza `savedRefreshKey` → `RnpmSavedStats` re-fetch-uieste contoarele. Inainte, contoarele nu se actualizau decat dupa delete manual.

### Adaugiri

- `RnpmRestoreModal.tsx` — modal dedicat pentru restore backup DB (listing + confirm destructiv); a absorbit logica care era inlinata in `RnpmSavedStats`.

### Verificare

- `npx tsc --noEmit` — clean pe ambele workspace-uri.
- Verificare manuala in Electron: toate categoriile RNPM (ipoteci/fiducii/specifice/creante/obligatiuni), toggle PJ/PF, toggle SI/SAU, submit + stop + reset, alignment zone colapsabile.

---

## 18 Aprilie 2026 (sesiune 3) — Fix filtre RNPM: `activ` semantic + `tipInscriere` index

Doua bug-uri la cautarile RNPM descoperite azi:

### 1. Checkbox "Numai active" nu facea nimic — toate avizele veneau marcate active

**Simptom:** User a rulat cautare CUI 37700569 cu "Numai active" debifat si a primit 42 rezultate **toate marcate active**, desi pe site-ul RNPM aceeasi cautare intoarce ~180 rezultate (active + inactive).

**Cauza dubla:**
1. **Endpoint-ul `/api/search/ipoteci` trateaza `{"activ": false}` identic cu `{"activ": true}`** — ambele filtreaza la active-only (criteriu echoat contine "este activ" in ambele cazuri). Singurul mod de a primi active + inactive este sa **omiti cheia `activ` complet** din payload.
2. Parser-ul backend la [backend/src/services/rnpmSearchService.ts:153](backend/src/services/rnpmSearchService.ts#L153) avea `doc.activ = detail.part1?.activ !== false` — cand `part1.activ` era `undefined`/absent, comparatia `undefined !== false` = `true`, deci toate avizele ajungeau marcate active indiferent de realitate.

**Fix:**
- Frontend ([RnpmSearchForm.tsx:749-756](frontend/src/components/rnpm/RnpmSearchForm.tsx#L749-L756)): `onChange` era deja corect (`checked ? true : undefined` → cand debifat, `activ` nu e trimis). Comportamentul asteptat confirmat prin Network capture.
- Backend ([rnpmSearchService.ts:153](backend/src/services/rnpmSearchService.ts#L153)): `if (typeof detail.part1?.activ === "boolean") doc.activ = detail.part1.activ;` — preserva `part1.activ` doar cand e boolean explicit.
- Backend ([rnpmSearchService.ts:289](backend/src/services/rnpmSearchService.ts#L289)): la persist, `activ: typeof part1.activ === "boolean" ? part1.activ : (doc.activ ?? true)`.

**Verificat empiric:** CUI 39029401 fara `activ` → 190 rezultate (mix active + inactive); cu `activ: true` → 146 (doar active). Avizul `2020-05051707599224-CAY` aparut in DB cu `activ=0`.

**Semantica RNPM (documentata acum):**
- `activ` = STAREA avizului (in vigoare vs. expirat/stins).
- `nemodificat` = ISTORIA avizului (atins de acte ulterioare sau nu) — dimensiune ortogonala fata de `activ`.
- Combinatii testate pe CUI 39029401: ambele unset → 190; `nemodificat:true` only → 170; `activ:true` only → 166; ambele true → 146.

### 2. Dropdown "Tipul avizului" pe `specifice` (si celelalte non-ipoteci) — 0 rezultate chiar cu criterii identice cu site-ul

**Simptom:** Cautare specifice + tip "stingere" + CUI 39029401 + nemodificat → 0 in app, 73 pe site.

**Cauza:** RNPM asteapta `tipInscriere.value` ca **index 1-based** in lista tipurilor de aviz din categoria curenta, NU ca label. Request-ul site-ului pentru "stingere" pe specifice: `{"tipInscriere":{"type":"1","value":"3"}}` (pozitia 3 in lista `["aviz initial","modificare","stingere",...]`). Aplicatia trimitea `value: "stingere"` → RNPM il ignora si echoia `Tipul inscrierii este ''` → 0 rezultate.

**Fix** ([RnpmSearchForm.tsx handleSubmit](frontend/src/components/rnpm/RnpmSearchForm.tsx)): la submit, `tipInscriere.value` se converteste din label → index 1-based folosind `TIP_AVIZ_BY_CATEGORY[activeType].indexOf(label) + 1`. Uniform pentru toate cele 5 tipuri (convenția site-ului e identica). State-ul dropdown-ului ramane label pentru UX — conversia e punctuala la submit.

**Verificat empiric:** specifice + tip stingere + CUI 39029401 → 73 rezultate (identic cu site-ul).

### Verificare

- Rebuild frontend + recopiere `dist-frontend` + restart Electron efectuate dupa fiecare fix (fara HMR in Electron).
- Testat manual: ipoteci (CUI 39029401, 37700569) + specifice (CUI 39029401). Celelalte tipuri (fiducii/creante/obligatiuni) — fix-ul tipInscriere e uniform, dar fara CUI-uri de test nu am putut confirma direct.
- Diagnostic console.log-uri adaugate temporar au fost eliminate.

---

## 18 Aprilie 2026 (sesiune 2) — Parser avize specifice + UI/export per-tip + cascade delete + backup button disable

Context: aviz `2021-07221630009133-WUW` (specific, initial) aparea cu tab-uri goale — Creditori/Debitori/Bunuri fara date — desi pe site-ul RNPM avea PJ (`IFN IMPRUMUT EXPRES`), PF (`BUDAN NICU ILIE`) si bun descris ca "fideiusiune". Diagnosticul a aratat ca RNPM returneaza pentru tipul `specifice` un shape diferit fata de `ipoteci`:

- `part2.partiF / part2.partiJ` (in loc de `creditoriF/creditoriJ` + `debitoriF/debitoriJ`); partile au `calitate` + `altaCalitate` (ex: "Altele: Fideiusiune").
- `part3.bunuri` (in loc de `part4.vehicule/mobile/alte`); bunurile au doar `no` + `descriere`.
- `part4 = null` pentru specifice.

### 1. Parser backend — branch pe `searchType === "specifice"`

**Types** ([backend/src/services/rnpmClient.ts](backend/src/services/rnpmClient.ts)):
- `RnpmDetailPartyPF/PJ` — adaugat `calitate` + `altaCalitate`.
- `RnpmDetailPart2` — adaugat `partiF?: RnpmDetailPartyPF[]` + `partiJ?: RnpmDetailPartyPJ[]`.
- `RnpmDetailPart3` — adaugat `bunuri?: RnpmDetailBun[]`.

**Persist** ([backend/src/services/rnpmSearchService.ts](backend/src/services/rnpmSearchService.ts)):
- Helper `formatCalitate(calitate, altaCalitate)` — combina `"Altele: Fideiusiune"` cand `altaCalitate` e prezent; altfel returneaza `calitate` brut.
- Pentru `specifice`: `creditori = []`; `debitori` = `partiF + partiJ` cu `calitate` formatata; `bunuri` = `part3.bunuri` cu `tip_bun: "alt"` si doar `descriere` populat (restul campurilor null). Pentru celelalte tipuri, ramane codul vechi (creditori/debitori/bunuri din buckets-urile originale).

### 2. UI tabs — "Parti" in loc de Creditori/Debitori pentru specifice

**Frontend** ([frontend/src/components/rnpm/RnpmDetailModal.tsx](frontend/src/components/rnpm/RnpmDetailModal.tsx)):
- `isSpecifice = data?.aviz.search_type === "specifice"`.
- Pentru specifice: 4 tab-uri (`General`, `Parti`, `Bunuri`, `Istoric`) — se dropeaza tab-ul "Creditori". Tab-ul "Parti" foloseste bucket-ul `debitori` (unde parser-ul pune partile) cu label schimbat.
- `emptyMsg={isSpecifice ? "Fara parti" : "Fara debitori"}`.

### 3. Export Excel + PDF — etichete per-tip + filename identificator

**Frontend** ([frontend/src/lib/rnpmExport.ts](frontend/src/lib/rnpmExport.ts)):
- `isSpecifice` + `partyLabel2 = isSpecifice ? "Parti" : "Debitori"` calculate o data la export.
- Sheet "Avize" (overview) dropeaza coloana "Creditori" pentru specifice; numerotarea coloanelor pentru link-urile interne (Creditori/Debitori/Bunuri/Istoric) ajustata corespunzator.
- Linia de stats afiseaza `"{N} parti"` in loc de `"{N} creditori + {N} debitori"` pentru specifice.
- Sheet "Creditori" **nu** se mai creeaza pentru specifice (`wsCred = null`); sheet "Debitori" se redenumeste "Parti" via `book_append_sheet(wb, wsDeb, partyLabel2)`.
- PDF: sectiunea "Creditori" se omite pentru specifice; sectiunea "Debitori" apare sub titlul "Parti".
- **Filename identificator:** cand exportul e pentru un singur aviz (`docs.length === 1`), filename-ul devine `<identificator>.xlsx/.pdf` (sanitizat cu `[^A-Za-z0-9._-]+ → _`) in loc de `rnpm_<tip>_<timestamp>`. Valabil pentru toate cele 5 tipuri RNPM, nu doar specifice.

### 4. "Sterge back-up" — disable cand nu exista backup-uri

**Frontend** ([frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx)):
- State nou `backupCount: number | null` (null = neincarcat / eroare la listare → buton activ ca retry affordance).
- `loadBackups()` — apeleaza `rnpmListBackups()` la mount + dupa orice delete; seteaza `backupCount = list.length`.
- Butonul "Sterge back-up" are `disabled={backupCount === 0}` + `title` explicativ + `disabled:opacity-50`. Clasa `ml-auto` pastrata pentru spacing.

### 5. "Sterge baza" cascadeaza la rezultatele din tab "Cautare"

Inainte: `onAfterDeleteAll` bumpa doar `savedRefreshKey` (re-fetch baza locala). Tab-ul "Cautare" pastra in-memory rezultatele vechi care pointau la ID-uri sterse → click pe aviz = 404 pe `rnpmGetAvizDetail`.

**Frontend** ([frontend/src/pages/RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx)):
- Callback-ul pasat la `<RnpmSavedStats onAfterDeleteAll={...}>` reseteaza acum `result`, `error`, `elapsedMs` in plus de refreshKey. Actiunea "Sterge back-up" ramane separata — nu curata rezultatele (backup-urile nu invalideaza DB-ul curent).

### Pending / de continuat

- **fiducii / creante / obligatiuni ipotecare** — parser-ul folosit azi acopera doar ipoteci (default) + specifice. User a ales **Optiunea 1** (astepta sample-uri reale inainte de extindere — fara cod speculativ). La urmatoarea sesiune: rula una-doua cautari reale pentru fiecare tip, captura raspunsul RNPM (parts 1-4 + istoric) si extinde `rnpmSearchService.ts` cu ramuri noi unde shape-ul difera.

### Verificare

- `npx tsc --noEmit` frontend + backend — clean.
- `npm run build` frontend (Vite) — OK; `dist-frontend/` copiat peste.
- Rebuild backend (esbuild via `scripts/build.js`) necesar cand se modifica `backend/src/**` pentru ca `electron:dev` incarca bundle-ul `dist-backend/index.cjs`, nu sursa `.ts`.
- Manual in Electron:
  - Re-cautare aviz specific cu CUI-ul reclamat → tab "Parti" populat cu PJ + PF, tab "Bunuri" cu descrierea "fideiusiune".
  - Export individual aviz specific → xlsx/pdf denumit `<identificator>`; sheet Creditori absent, sheet Parti prezent.
  - "Sterge baza" → tab "Cautare" curatat automat, buton "Sterge back-up" ramane activ (exista backup-uri).
  - "Sterge back-up" → butonul se dezactiveaza dupa delete cand count-ul ajunge la 0.

---

## 18 Aprilie 2026 — Mini-lag RNPM rezolvat + backup zilnic + dialog confirmare stilizat + restore flow + dashboard persistent

Sesiune dedicata **fluiditatii UI** (tab-enter + deschidere aviz), **rezilientei datelor** (backup automat) si **coerentei vizuale** (confirmari native Chromium → dialog stilizat in app).

### 1. Performanta — mini-lag la intrarea pe tab si deschiderea avizelor

Diagnostic: nu era viteza query-urilor, ci (a) unmount/remount al componentei la tab switch si (b) round-trip + 5 query-uri pentru fiecare click pe aviz. Aplicate trei interventii complementare:

**A. Keep-mounted pe RnpmSavedData** ([frontend/src/pages/RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx)):
- Inainte: `{tab === "saved" && <RnpmSavedData .../>}` — conditional render = unmount total la fiecare tab-switch, cu re-fetch + re-hidratare state.
- Dupa: `<div className={tab === "saved" ? "" : "hidden"}><RnpmSavedData .../></div>` — componenta ramane montata, state (filtre, pagina, selectie) persistat, re-intrarea pe tab este instant.

**D. Cache in-memory pentru detaliul avizului** ([frontend/src/lib/rnpmApi.ts](frontend/src/lib/rnpmApi.ts)):
- `avizDetailCache: Map<number, { data, expiresAt }>` + `AVIZ_DETAIL_TTL_MS = 60_000`.
- `rnpmGetAvizDetail(id)` verifica cache-ul inainte de fetch; hit-ul evita round-trip-ul + cele 5 query-uri repository-side.
- Invalidare explicita in `rnpmDeleteAviz`, `rnpmDeleteAllSaved`, `rnpmDeleteAvizeBatch` — coherenta garantata cu stergeri.

**E. Prewarm SQLite page cache la bootstrap** ([backend/src/index.ts](backend/src/index.ts)):
- Dupa `serve(...)`: `getAvize({ limit: 1 })` + `getAvizStats()` — fortam o prima atingere a paginilor SQLite care altfel s-ar citi de pe disc la primul request al userului.
- Cold-start dispare din prima interactiune — cache-ul paginilor e deja cald cand userul apasa pe tab.

### 2. Backup zilnic automat al bazei locale

Motivatie: cu mii de avize salvate, pierderea `.db`-ului ar fi costisitoare. Solutie — backup automat la fiecare pornire, cu rotatie.

**Backend** ([backend/src/db/backup.ts](backend/src/db/backup.ts)):
- `runDailyBackup()` — foloseste `better-sqlite3` online backup API (`db.backup(dest)`), sigur cu WAL fara checkpoint sau exclusive lock.
- Nume: `legal-dashboard.YYYY-MM-DD.db` in `<userData>/backups/`.
- Skip daca ultimul backup `<24h` (check pe `mtimeMs` din `fs.stat`).
- Rotatie: sortare lexicografica (= cronologica gratie formatului ISO in nume), pastreaza ultimele 7, sterge restul.
- Best-effort — orice esec logheaza `[backup] failed: ...` si lasa app-ul sa porneasca normal.
- `runDailyBackup()` apelat in [backend/src/index.ts](backend/src/index.ts) dupa prewarm, cu `.catch(...)` ca nu blocheaza bootstrap-ul.

**Endpoints noi** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)):
- `POST /api/rnpm/open-backups-folder` — `shell.openPath(backupsDir)` + `mkdir -p` defensiv (501 daca nu e Electron).
- `DELETE /api/rnpm/backups` — `deleteAllBackups()` (unlink pe toate fisierele care respecta prefix/sufix), returneaza `{ deleted: n }`.

### 3. Dialog de confirmare stilizat (inlocuieste `window.confirm()` nativ)

Motivatie: user a observat ca pop-up-urile native Chromium arata strain fata de restul UI-ului. Creat un dialog unified stilizat cu app-ul.

**Componenta noua** ([frontend/src/components/ui/confirm-dialog.tsx](frontend/src/components/ui/confirm-dialog.tsx)):
- `ConfirmProvider` + `useConfirm()` hook (Promise-based: `await confirm({ message, confirmLabel, cancelLabel, destructive, title })`).
- Icon `AlertTriangle` pentru variantele destructive; buton confirm rosu cand `destructive: true`.
- Keyboard: `Escape` = cancel, `Enter` = confirm. Click-outside = cancel. Auto-focus pe butonul de confirmare.
- `z-[100]`, backdrop-blur, consistent cu restul modalelor din app.
- Wrapper instalat in [frontend/src/App.tsx](frontend/src/App.tsx) sub `BrowserRouter`.

**Call-site-uri migrate** (4):
- [RnpmSavedData.tsx](frontend/src/components/rnpm/RnpmSavedData.tsx) — sterge aviz individual + batch delete.
- [RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx) — sterge toate avizele din baza locala.
- [RnpmSearchForm.tsx](frontend/src/components/rnpm/RnpmSearchForm.tsx) — warning CUI invalid (non-destructive, confirmLabel="Continua").

### 4. "Info baza locala" — management backups + relabel butoane

[frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx) — reorganizare zona de actiuni:
- `[Folder baza]` `[Backups]` ... `[Sterge back-up]` `[Sterge baza]`
- Butonul `Backups` (icon `Archive`) → deschide `<userData>/backups/` in File Explorer.
- Butonul `Sterge back-up` (rosu, outline) → sterge toate fisierele de backup (confirm destructiv); urmatorul backup se genereaza la urmatoarea pornire a app-ului.
- Butonul `Sterge baza` pastreaza comportamentul anterior (fost "Sterge tot"), cu confirm destructiv; confirmarile folosesc toate noul `useConfirm()`.
- Relabel: "Deschide folder" → "Folder baza".

### 5. Fix UI — DosareTable timeline sedinte

Efect secundar al `dd05b05` (font-scale bump): data "19.01.2026" era taiata, iar cercul-marker nu se alinia vertical cu linia.
**Frontend** ([frontend/src/components/DosareTable.tsx](frontend/src/components/DosareTable.tsx)): coloana data `w-[60px]`→`w-[80px]`, marker-ul `left-[72px]`→`left-[92px]`, spacing `mt-1`→`mt-1.5`.

### 6. Bugfix — paginare goala dupa aplicare filtre

Simptom: la aplicarea unui filtru care reducea numarul de pagini, tabela ramanea goala pentru ca `page` depasea noul `totalPages` si slice-ul `filtered.slice((page-1)*pageSize, page*pageSize)` returna `[]`.

**Frontend** ([frontend/src/components/DosareTable.tsx](frontend/src/components/DosareTable.tsx), [frontend/src/components/TermeneTable.tsx](frontend/src/components/TermeneTable.tsx)): `useEffect` care clampeaza `page` la `Math.max(1, totalPages)` cand filtered data se schimba. Dependency array include lungimea datelor filtrate + pageSize.

### 7. TermeneTable — chei stabile pentru selectie (CP-B P2.3)

Inainte: selection state folosea index-ul rand-ului (`${page}-${idx}`) drept cheie. La sortare/filtrare, Set-ul de selectii "se agata" de indici care indicau alte randuri — selectie care pare sa sara.

**Frontend** ([frontend/src/components/TermeneTable.tsx](frontend/src/components/TermeneTable.tsx)): cheie compusa stabila `${institutie}|${departament}|${numar}|${ora}|${complet}` in locul index-ului; helper `rowKey(t)` aplicat peste tot in checkbox handlers, `selectAllFiltered`, export CSV.

### 8. RnpmDetailModal — identificator aviz in header

User vrea sa vada identificatorul avizului fara sa scrolleze pana la randul de detalii.

**Frontend** ([frontend/src/components/rnpm/RnpmDetailModal.tsx](frontend/src/components/rnpm/RnpmDetailModal.tsx)): `<h3>` cu `flex items-baseline gap-2`, "Detalii Aviz" `text-sm font-semibold` + identificator `text-xs font-semibold text-foreground` (fara font-mono — metricile diferite intre sans/mono cauzeaza offset vizual la `items-center`; baseline + acelasi font family rezolva alinierea).

### 9. Dashboard — persistenta "Ultima Cautare" pentru dosare (Optiunea 1)

Inainte: dupa restart, cardul "Dosare" disparea din dashboard chiar daca userul facuse zeci de cautari. RNPM avea deja persistenta; dosare nu.

Decisie: **nu** persistam intregul dataset (prea mare, deja avem istoric local), ci doar meta-count-urile + params-ul ultimei cautari. Click pe card → navigare la pagina dosare + re-trigger search cu params stored (prin pending-search pattern existent).

- **Types** ([frontend/src/types/index.ts](frontend/src/types/index.ts)): `SearchHistoryEntry.meta?: { categoriesCount; institutiiCount }`.
- **Hook** ([frontend/src/hooks/useSearchHistory.ts](frontend/src/hooks/useSearchHistory.ts)): `addEntry(type, params, resultCount, meta?)`.
- **Dosare** ([frontend/src/pages/Dosare.tsx](frontend/src/pages/Dosare.tsx)): `handleSearch` construieste Set-urile pentru categorie + institutie, pasa meta prin `onSearchComplete`.
- **Dashboard** ([frontend/src/pages/Dashboard.tsx](frontend/src/pages/Dashboard.tsx)): daca nu sunt date live, fallback pe `history.find(e => e.type === "dosare")`. Click pe card → `navigate("/dosare")` + (daca e fallback) `onHistoryClick("dosare", params)` pentru refresh.
- **App** ([frontend/src/App.tsx](frontend/src/App.tsx)): passing `history` + `onHistoryClick` la Dashboard.

### 10. Restore baza locala din backup

User: "Cum putem face restore la un backup daca stergem baza principala?". Motivatie — azi un backup corupt sau o stergere accidentala ar fi fatala fara o cale de recuperare in-app.

**Backend** ([backend/src/db/backup.ts](backend/src/db/backup.ts)):
- `listBackupsWithMeta()` — enumera fisierele care respecta prefix/sufix, returneaza `{ name, sizeBytes, mtime }[]`, sortat desc pe mtime.
- `restoreFromBackup(name)` — validare stricta: regex `/^legal-dashboard\.[A-Za-z0-9._-]+\.db$/` + check `/` si `\` (block path traversal).
  - `closeDb()` — necesar pe Windows unde fisierul deschis e blocat.
  - Snapshot preventiv al DB-ului curent in `legal-dashboard.pre-restore-<ISO>.db` (user poate rolla back manual).
  - `copyFile(src, dbPath)`.
  - Unlink `-wal` + `-shm` (sidecar-urile apartin vechii DB; ar corupe deschiderea noii DB).
  - Returneaza `preRestoreName` catre UI.

**API** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)): `GET /api/rnpm/backups` + `POST /api/rnpm/backups/restore` (cu `limitSmall`).

**Frontend** ([frontend/src/lib/rnpmApi.ts](frontend/src/lib/rnpmApi.ts)): `rnpmListBackups()` + `rnpmRestoreBackup(name)`.

**UI** ([frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx)): buton "Restaurare" (icon `History`) intre "Backups" si "Sterge back-up". Deschide `RestoreModal` — lista backups (name + size + data), confirm destructiv cu `useConfirm`, afisare success cu `preRestoreName`, reincarca stats + trigger `onRestored` dupa 2.5s pentru re-hidratare.

### 11. Info baza locala — aliniere "Cale:" + modal largit

User: "alinieaza vizual 'Cale' cu scrisul caii efective" + "poti lungi si fereastra putin".

**Frontend** ([frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx)):
- Modal `max-w-xl` → `max-w-2xl`.
- "Cale:" row — inlinat intr-un singur `<div className="leading-5">` cu `<span>Cale: </span><span className="font-mono ...">{path}</span><button ...><Copy/></button>`. Butonul de copiere `h-4 w-4 translate-y-[2px]` aliniat vizual cu linia de text (font-mono are metrici diferite de sans — baseline pur nu ajunge, translate-y fixeaza restul).

### 12. Dependency hygiene

- Bump `dompurify` — patch minor de securitate (XSS sanitizer).
- Bump `@anthropic-ai/sdk` — pastram in sync cu release-urile upstream.
- `npm audit` — 0 vulnerabilitati la nivel repo.

### Verificare

- `npx tsc --noEmit` (frontend + backend) — clean.
- `node scripts/build.js` — build complet reproducibil, backend bundle `1.7mb`.
- Reproducere manuala in Electron:
  - Tab-switch intre RNPM → Cautare ↔ Baza locala — instant, fara re-fetch vizibil.
  - Click pe aviz recent → modal apare instant (cache hit).
  - Log backend la pornire: `[backup] saved legal-dashboard.2026-04-18.db`.
  - Fisier prezent in `%APPDATA%/legal-dashboard/backups/`.
  - Delete aviz / Delete all / Sterge back-up / CUI warning — toate afiseaza dialog stilizat, nu pop-up nativ.
  - RNPM → Info baza locala → "Restaurare" → selecteaza backup → confirm → app reincarca cu datele din backup; fisier `legal-dashboard.pre-restore-*.db` aparut in `backups/`.
  - Dashboard dupa restart (fara cautare in sesiunea curenta) — cardul "Dosare" afiseaza ultima cautare persistata; click → navigheaza + re-triggereaza search-ul automat.
  - Aplicare filtru pe pagina 5 dintr-o tabela cu 50 rezultate → `page` clampat la ultima pagina valida, tabela afiseaza randuri.

---

## 17 Aprilie 2026 — Butonul Stop RNPM functioneaza cap-coada (abort chain complet)

Bug raportat: la tab-ul **Cautare RNPM → Cautare**, click pe butonul **Stop** nu oprea efectiv cautarea. UI parea "blocat" (Stop + "Interogare RNPM..." persistau), iar dupa cateva incercari aparea un val de ~25 avize persistate in baza locala fara ca userul sa fi cerut. Investigatia a scos la iveala mai multe probleme in lantul de anulare — rezolvate toate in aceasta sesiune.

### 1. Abort propagat din UI prin fetch pana la backend

Inainte: `rnpmSearch()` + `runSearch()` + `loadNextBatch()` nu aveau `AbortController` deloc. Click pe Stop doar ascundea UI-ul dar fetch-ul continua in background si backend-ul rula pana la capat.

**Frontend** ([frontend/src/lib/rnpmApi.ts:39-52](frontend/src/lib/rnpmApi.ts#L39-L52)):
- `rnpmSearch(...)` accepta acum `signal?: AbortSignal` ca ultim parametru si il pasa la `fetch({ signal })`.

**Frontend** ([frontend/src/pages/RnpmSearch.tsx:61-156](frontend/src/pages/RnpmSearch.tsx#L61-L156)):
- `abortRef: useRef<AbortController | null>` — detine controller-ul cautarii in curs (un singur concurrent).
- `stoppedRef: useRef(false)` — flag sincron (nu state batched) pentru a ignora rezultate parvenite dupa Stop.
- `runSearch()` + `loadNextBatch()`: guard `if (abortRef.current) return` impotriva start-urilor concurente; creeaza controller nou, reseteaza `stoppedRef=false`, pasa `ctl.signal` la `rnpmSearch(...)`; in `finally` elibereaza `abortRef` si flip-uieste loading-ul. Verifica `stoppedRef.current || ctl.signal.aborted` inainte de a comita rezultate in state (nu mai populeaza UI cu rezultate din request abortate).
- `handleStop()` — seteaza `stoppedRef=true`, cheama `abortRef.current?.abort()`, flip `loading=false` + `phase=""`.

**Backend** ([backend/src/routes/rnpm.ts:95,111-114](backend/src/routes/rnpm.ts#L95-L114)):
- `rnpmRouter.post("/search")` pasa `c.req.raw.signal` la `executeSearch({ signal })`. In `catch` recunoaste `DOMException("AbortError")` si returneaza 500 cu mesaj "Cautare oprita" + log `[rnpm/search] aborted by client`.

### 2. Abort propagat in toate fetch-urile outbound

Inainte: chiar daca backend-ul primea abort, fetch-urile catre RNPM (search + detail parts 1-4 + istoric) continuau pana la timeout-ul default al Node fetch.

**Backend** ([backend/src/services/rnpmClient.ts:199-256](backend/src/services/rnpmClient.ts#L199-L256)):
- `RnpmClient.search()`, `fetchPart()`, `fetchIstoric()`, `fetchFullDetail()` — toate accepta `signal?: AbortSignal`.
- `fetchFullDetail()` pasa `signal` la toate cele 5 fetch-uri paralele (parts 1-4 + istoric) via `Promise.all`.

**Backend** ([backend/src/services/rnpmSearchService.ts:38-175](backend/src/services/rnpmSearchService.ts#L38-L175)):
- Helper `throwIfAborted(signal)` folosit la ~6 puncte cheie (inainte/dupa captcha, intre pagini, inainte de batch).
- `input.signal` threaded prin tot orchestratorul: catre `solveRnpmCaptcha`, `client.search`, `client.fetchFullDetail`.
- Retry-urile de captcha pe pagina ramasa (gcode expirat) re-check `throwIfAborted` inainte de re-solve.
- `executeBulkSearch` propaga signal catre fiecare `executeSearch` si iese curat la abort (fara "done"/"error" SSE events).

### 3. Abort ajunge la solver-ul de captcha (2Captcha + CapSolver)

Inainte: SDK-ul `@2captcha/captcha-solver` este blocant (pana la 60s) si nu accepta `AbortSignal`. CapSolver polluia la 2s intervale fara a verifica signal. Click pe Stop in timpul captchei astepta pana la 60-120s inainte sa se elibereze.

**Backend** ([backend/src/services/captchaSolver.ts:28-125](backend/src/services/captchaSolver.ts#L28-L125)):
- `solveWith2Captcha` — `Promise.race([solvePromise, abortPromise])` unde `abortPromise` rejecteaza pe `signal.addEventListener("abort", ...)`. Curatenie listener in `finally { signal.removeEventListener(...) }` ca sa nu tinem referinta dupa ce promise-ul se termina. Comentariu inline explica ca token-ul rezolvat ulterior e pierdut (acceptabil — nu blocam UI-ul 60s).
- `solveWithCapSolver` — fiecare iteratie de polling verifica `if (signal?.aborted) throw new DOMException("Aborted", "AbortError")`. `fetch` primeste si el `signal` (abortare chiar a request-ului HTTP, nu doar pauza dintre polls).
- Fallback 2Captcha (daca CapSolver esueaza) — re-propaga `signal`, re-verifica `signal?.aborted` la intrare si dupa `await`.
- `solveRnpmCaptcha` — orchestreaza ambii provideri, re-verifica `signal` la intrare, intre provideri, si la iesire.

### 4. Skip persist daca fetch-ul a scapat de abort inainte de SQLite

Inainte: `processPage` facea `await client.fetchFullDetail(...)` si imediat `persistAvizWithDetail(...)` sincron in SQLite. Un `Promise.all` cu `concurrency=7` insemna ca daca abort-ul venea in mijlocul batch-ului, fetch-urile deja rezolvate continuau sa persiste → avize partiale in baza locala.

**Backend** ([backend/src/services/rnpmSearchService.ts:140-148](backend/src/services/rnpmSearchService.ts#L140-L148)):
- Dupa `await client.fetchFullDetail(doc.identificator.k, signal)` verificare explicita `if (signal?.aborted) throw new DOMException("Aborted", "AbortError")` inainte de a apela `persistAvizWithDetail`. Fetch-urile care se intorc dupa abort sunt ignorate — SQLite ramane neatinsa.

### 5. Bug final: butonul Stop auto-submita form-ul (React 18 DOM node reuse)

Cu toate fix-urile de mai sus aplicate, Stop tot parea sa nu functioneze. Instrumentare temporara cu `console.log` + `console.trace` in `handleSubmit`, `runSearch`, `handleStop`, ruta `/search` + `executeSearch` a relevat secventa reala:

```
[RNPM handleStop] ENTRY
[RNPM handleStop] abort() called, signal.aborted=true
[RNPM handleStop] setLoading(false) called
[RnpmSearchPage render] {loading: false}
[RnpmSearchForm handleSubmit] FIRED {type:'submit', target:'FORM', isTrusted:true}
[RNPM runSearch] entry
```

`isTrusted: true` + stack trace cu doar cod React intern (rt / dk / pk / hk / Ey / Gb — fara frame aplicativ) dovedea ca browser-ul submita form-ul, nu apelam runSearch direct. Network confirma: 3+ request-uri `/api/rnpm/search` la un singur click pe **Cauta**; primele doua abortate rapid (`[rnpm/search] aborted by client` la ~2s), al treilea completat integral si persistenta 25 avize.

**Cauza**: JSX-ul original reutiliza acelasi DOM node:
```tsx
{loading && onStop ? (
  <Button type="button" onClick={onStop}>Stop</Button>
) : (
  <Button type="submit" disabled={loading}>Cauta</Button>
)}
```
React 18 reconciliation: ambele ternare → acelasi slot → acelasi `<button>` DOM. Secventa:
1. Browser fires `click` pe `<button type="button">` (Stop)
2. React ruleaza `onClick` → `handleStop` → `abort()` + `setLoading(false)` (batched)
3. Handler-ul se termina → React commit batched state → `loading=false` → acelasi `<button>` primeste `type="submit"`
4. Browser continua default action → vede `type="submit"` → **submite form-ul automat**
5. `onSubmit={handleSubmit}` → `runSearch(type, params)` → request nou

**Fix** ([frontend/src/components/rnpm/RnpmSearchForm.tsx:767-780](frontend/src/components/rnpm/RnpmSearchForm.tsx#L767-L780)): `key` distincte pe cele doua butoane forteaza React sa faca **unmount + mount** (noduri DOM diferite), nu **reuse** cu morph de prop:
```tsx
{loading && onStop ? (
  <Button key="rnpm-stop-btn" type="button" onClick={onStop}>Stop</Button>
) : (
  <Button key="rnpm-submit-btn" type="submit" disabled={loading}>Cauta</Button>
)}
```
Butonul Stop e distrus complet cand `loading → false`, iar click-ul in curs nu mai are o destinatie `type="submit"` valida → browser-ul nu mai submite form-ul.

### Verificare finala

- Reproducere manuala: click Cauta → click Stop. UI revine imediat la "Cauta", Console fara `[RnpmSearchForm handleSubmit] FIRED`, Network cu un singur request abortat in ~2s, baza locala neatinsa.
- Stop in timpul captchei: provider-ul primeste abort imediat (2Captcha via Promise.race, CapSolver la urmatorul poll < 2s). Token-ul nu mai e folosit.
- `backend && npx vitest run` — **24/24 verde**.
- `npm run build` — OK (warning preexistent `import.meta` neschimbat).

### Curatenie

Toate log-urile de diagnostic adaugate in timpul investigatiei au fost sterse:
- `RnpmSearch.tsx` — `console.log` din `runSearch`, `handleStop`, render top-level, `useEffect(pendingSearch)`.
- `RnpmSearchForm.tsx` — `console.log` + `console.trace` din `handleSubmit`.
- `rnpmSearchService.ts` — log-uri `[rnpm executeSearch] start/captcha solved`, abort listener, `[rnpm] SKIP persist`, `[rnpm] persist`. Pastrat `[rnpm] search type/page/params` si `[rnpm] result total/criteriu` (preexistente, utile in operational).
- `routes/rnpm.ts` — log `[rnpm/search] ENTRY` + abort listener. Pastrat `[rnpm/search] aborted by client` (preexistent).

### Learnings

- **Abort chain in Electron cu Hono in-process**: `c.req.raw.signal` propaga corect din frontend (via `fetch({signal})`) la backend, cu conditia ca toate nivelurile sa accepte si sa pase `signal` mai departe. O singura veriga lipsa (ex: SDK blocant) gate-uieste intreg lantul.
- **Pattern React 18**: cand un ternar schimba un `<Button>` cu acelasi component type dar `type` (sau alt prop sensibil) diferit, React reutilizeaza DOM-ul. Cand purpose-ul semantic al butonului se schimba (ex: Stop → Submit), foloseste `key` distincte pentru a forta mount/unmount.
- **Promise.race cu abortPromise** e pattern-ul standard pentru a wrap-ui librarii blocante care nu stiu de AbortSignal. Atentie la cleanup-ul listener-ului in `finally`.

---

## 17 Aprilie 2026 — Categorie noua, filtru data, rafinari UI (schimbari absente din PLAN.md v1.0.0)

Sectiune separata pentru a documenta explicit ce **depaseste** scopul `PLAN.md` (4 categorii RNPM, fara filtru de data pe baza locala, fara referinte de persoane pe bunuri). Toate modificarile descrise mai jos au fost validate prin `npx tsc --noEmit` + `npx vitest run` (24/24).

### 1. Categoria 5 — **Aviz de ipoteca - obligatiuni ipotecare** (completa cap-coada)

`PLAN.md` v1.0.0 enumera categoria "obligatiuni" la endpoint-uri si schema, dar stub-ul `RnpmSearchParams` (PLAN.md §"Search Parameters", liniile 114-135) **omite** toate cheile specifice obligatiunilor — la fel cum omite `constituitorPJ`/`fiduciar`/`beneficiarPJ` (fiducii), `reprezentantCreditor`/`debitorJ`/`debitorF`/`creante` (creante specific). Cheile au fost descoperite prin captura Network pe `https://mj.rnpm.ro/#informatii/cautare` si adaugate integral.

**Types** ([frontend/src/types/rnpm.ts:1](frontend/src/types/rnpm.ts#L1), [frontend/src/types/rnpm.ts:37-40](frontend/src/types/rnpm.ts#L37-L40)):
- `RnpmSearchType` extins cu `"obligatiuni"`.
- Chei confirmate prin captura Network: `agentPJ` / `agentPF` / `emitent` (toate PJ) / `bunGarantie.descriere`.

**Backend** ([backend/src/services/rnpmClient.ts:3](backend/src/services/rnpmClient.ts#L3), [backend/src/services/rnpmClient.ts:40-43](backend/src/services/rnpmClient.ts#L40-L43)):
- `VALID_TYPES` (in `routes/rnpm.ts`) si `RnpmSearchType` (in `rnpmClient.ts`) accepta `"obligatiuni"`.
- `RnpmSearchParams` suplimentat cu noile chei — trec transparent prin `executeSearch` → `client.search` fara logica speciala (categoria a cincea foloseste aceeasi ruta SOAP ca restul).

**Form** ([frontend/src/components/rnpm/RnpmSearchForm.tsx:73-76](frontend/src/components/rnpm/RnpmSearchForm.tsx#L73-L76), [frontend/src/components/rnpm/RnpmSearchForm.tsx:310-314](frontend/src/components/rnpm/RnpmSearchForm.tsx#L310-L314), [frontend/src/components/rnpm/RnpmSearchForm.tsx:448-482](frontend/src/components/rnpm/RnpmSearchForm.tsx#L448-L482), [frontend/src/components/rnpm/RnpmSearchForm.tsx:696-707](frontend/src/components/rnpm/RnpmSearchForm.tsx#L696-L707)):
- Dropdown **Tipul avizului** (9 valori, identice cu "creante"): aviz initial, modificare, extindere, reducere, stingere, nulitate, prelungire, reactivare, indreptare a erorii materiale.
- UI: `PartyFieldset` **Agent** (PJ/PF toggle) + `PJBlock` **Emitent** (PJ-only) + `Input` descriere **Creante (bun de garantie)**.
- State: `oblAgentTip`, `oblAgentJ` (usePJField), `oblAgentF` (usePFField), `oblEmitent` (usePJField), `oblBunDescr` (useText). Folosesc aceleasi custom hooks introdusi la refactor-ul CP-15 → zero cod nou de boilerplate.
- Submit: construieste `params.agentPJ` / `params.agentPF` / `params.emitent` / `params.bunGarantie` doar daca user-ul a completat cel putin un subcamp.
- `TIP_LABEL_BY_CATEGORY[obligatiuni] = "Tipul avizului"` (identic cu "specifice"; "ipoteci"/"creante" afiseaza "Tipul inregistrarii", "fiducii" afiseaza "Tipul fiduciei") — reproduc exact label-urile site-ului oficial.

**Validare CUI** ([frontend/src/components/rnpm/RnpmSearchForm.tsx:99-111](frontend/src/components/rnpm/RnpmSearchForm.tsx#L99-L111)):
- Walker `findNonNumericCui` ruleaza pe params-ul **deja construit** (post-filtru per categorie activa), deci acopera automat `agentPJ.CUI` + `emitent.CUI` din noua categorie — fara cod nou de validare per camp.

**Bulk** ([frontend/src/components/rnpm/RnpmBulkSearch.tsx:14](frontend/src/components/rnpm/RnpmBulkSearch.tsx#L14)):
- Categoria apare in dropdown-ul **Categorie** al tab-ului Bulk. Rolurile FieldKey suportate (debitor/creditor PJ/PF) raman aplicabile dar nu acopera `agent`/`emitent` — limitarea e acceptata: bulk-ul proceseaza liste de CUI/CNP pe cea mai folosita cautare (debitor/creditor); pentru obligatiuni ipotecare volumul justifica cautari individuale din tab-ul Cautare.

**Saved (baza locala)** ([frontend/src/components/rnpm/RnpmSavedData.tsx:15](frontend/src/components/rnpm/RnpmSavedData.tsx#L15)):
- Filtru pe categorie include `obligatiuni`. Schema `rnpm_avize.search_type` e `TEXT` → accepta orice valoare, nu necesita migrare.

### 2. Baza locala — filtre + integritate (modificari absente din PLAN.md)

`PLAN.md` specifica doar cautare libera + filtru pe `activ`. In aceasta sesiune + sesiunile precedente s-au adaugat:

**Filtru interval data** ([backend/src/db/avizRepository.ts:274-284](backend/src/db/avizRepository.ts#L274-L284), [frontend/src/components/rnpm/RnpmSavedData.tsx:90-113](frontend/src/components/rnpm/RnpmSavedData.tsx#L90-L113)):
- Backend: coloana `data` e stocata ca **"dd.mm.yyyy"** (format RNPM nativ). Filtru converteste in SQL prin `substr()` la ISO (yyyy-mm-dd) ca string-urile sa fie comparabile lexicografic:
  ```sql
  substr(a.data,7,4)||'-'||substr(a.data,4,2)||'-'||substr(a.data,1,2) >= ?
  ```
  Pretul e o scanare in plus (nu exista index pe expresia `substr`) dar volumul bazei locale e `< 50K` avize per user → acceptabil.
- Frontend: doua `<Input type="date">` (`dataStart` / `dataStop`) cu buton **reset** care sterge ambele. `onClick={showPicker?.()}` pentru UX — clic deschide picker-ul nativ. Filtrul ruleaza automat la `useEffect` dependency (`[searchType, activOnly, dataStart, dataStop, refreshKey]`).
- `GetAvizeOptions.dataStart`/`dataStop` sunt string-uri ISO ("yyyy-mm-dd") — contractul vine direct din `<input type="date">`.

**Migrare `referinte_json` pe `rnpm_bunuri`** ([backend/src/db/schema.ts:149-153](backend/src/db/schema.ts#L149-L153), [backend/src/db/avizRepository.ts:199-206](backend/src/db/avizRepository.ts#L199-L206)):
- Coloana `TEXT NOT NULL DEFAULT (json_array())` NU s-a putut folosi (SQLite nu accepta expresii non-constante ca DEFAULT). Pattern idempotent:
  ```ts
  const cols = db.prepare(`PRAGMA table_info(rnpm_bunuri)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "referinte_json")) {
    db.exec(`ALTER TABLE rnpm_bunuri ADD COLUMN referinte_json TEXT`);
  }
  ```
- Citeste `NULL` pentru randuri preexistente (fara referinte); scrie `JSON.stringify(referinte)` doar cand array-ul e ne-gol (economie de spatiu — majoritatea bunurilor n-au referinte).
- Parse defensive in `loadAvizChildren` cu try/catch → `[]` pe JSON invalid (defense-in-depth impotriva corupere WAL).
- Unlock: `RnpmDetailModal > Bunuri > BunRefRow` poate afisa Constituitor (badge sky) vs Tert cedat (badge amber) — feature absent in PLAN.md.

**Scalar SQLite `rnpm_norm` (diacritic-insensitive search)** ([backend/src/db/schema.ts:22-24](backend/src/db/schema.ts#L22-L24)) — deja documentat in sesiunea 3 din 16 Aprilie; mentionat aici ca referinta pentru cititorul viitor care vede schema.

**`deleteAllAvize` tranzactional** ([backend/src/db/avizRepository.ts:316-325](backend/src/db/avizRepository.ts#L316-L325)):
- PLAN.md prevede doar `deleteAviz(id)`. UI "Sterge tot" avea nevoie de:
  - Stergere `rnpm_avize` pe owner scope → CASCADE auto pe `rnpm_creditori` / `rnpm_debitori` / `rnpm_bunuri` / `rnpm_istoric` (toate au `ON DELETE CASCADE`).
  - Stergere **explicita** `rnpm_searches` (metadata istoric cautari) — `rnpm_avize.search_id` are `ON DELETE SET NULL`, deci searches **nu** cad in cascada.
  - Tranzactie pentru atomicitate: daca una esueaza, ambele raman intacte.
- Return `number` (count avize sterse) pentru a putea afisa in UI.

**Bulk fetch `getAvizeByIds`** ([backend/src/db/avizRepository.ts:327-335](backend/src/db/avizRepository.ts#L327-L335)):
- `IN (...)` placeholders dinamici + `loadAvizChildren` per rand → suport pentru **export PDF/Excel** (ruta `/api/rnpm/saved/export` accepta max 500 id-uri per request, aliniat cu `EXPORT_BODY_LIMIT` 64KB de la audit-readiness).

### 3. Frontend — rafinari UX (non-abort)

**`RnpmDetailModal` cu 5 tab-uri navigate**:
- Tab-uri: General / Creditori / Debitori / Bunuri / Istoric. Count badge pe fiecare (ex: "Bunuri (3)") cand exista date.
- `requestAnimationFrame` + `window.scrollBy` pe tab-switch → la overflow, tab-ul selectat ramane vizibil fara salt brut.
- `BunRefRow` (sub-componenta) afiseaza `Constituitor` (sky-600) vs `Tert` (amber-600) cu toate atributele de identificare (CUI/CNP/sediu/localitate/tara) intr-un layout 2-col dens.
- Click pe backdrop inchide modala; click pe continut il blocheaza (`e.stopPropagation`).

**`RnpmSavedData` badge-uri active/inactiv**:
- Coloana "Stare" cu `Badge className="bg-green-500"` (activ) sau `bg-gray-400` (inactiv) — aliniat cu `activ INTEGER DEFAULT 1` din schema.
- Dubla confirmare `confirm()` pentru **Sterge tot** ("Actiunea nu poate fi anulata.") inainte de a apela `deleteAllAvize` — protectie minima impotriva click-urilor accidentale intr-un flux ireversibil.
- Cursor paginat: buton **Incarca mai multe** disparut automat la `nextCursor == null`.

**`RnpmBulkSearch` feedback per-item**:
- Icon per phase: `Loader2` (captcha/search/details) → `CheckCircle2` verde (done) → `XCircle` rosu (error).
- Contor `done + errors / total` + breakdown "X OK / Y erori" in header.
- Estimare **duration** (25s/item × count) + **cost** (~$0.003/item 2Captcha) afisate inainte de start.
- Hard limit `MAX_BATCH=100` — valorile peste sunt taiate si marcate cu warning amber ("primele 100 vor fi procesate").

### 4. Validare completa

- `npx tsc --noEmit` (frontend + backend) — clean.
- `npx vitest run` (backend) — **24/24 verde**, 256ms.
- Reproducere manuala **in Electron**: obligatiuni ipotecare search complet (agent PJ CUI + emitent CUI + bun descriere), rezultate vizibile in tabel, persistenta confirmata in baza locala, filtru data range pe tab "Baza locala" intoarce rezultate corecte, "Sterge tot" + confirmare goleste atat `rnpm_avize` cat si `rnpm_searches`.

### Scope separation vs PLAN.md

PLAN.md v1.0.0 ramane specificatia **initiala** (4 categorii, filtru basic, fara referinte bunuri). Acest CHANGELOG documenteaza **delta-ul** implementat peste — fara a rescrie PLAN.md (istoric inghetat). Urmatoarea revizie a PLAN.md (v1.1.0 sau v2.0.0) ar trebui sa incorporeze:
- Categoria 5 (obligatiuni ipotecare) cu payload-ul ei exact.
- Filtru `dataStart`/`dataStop` pe baza locala.
- Referinte `constituitor`/`tert` pe bunuri (`referinte_json`).
- Diacritic-insensitive search (`rnpm_norm`).

---

## 16 Aprilie 2026 (sesiunea 4) — Audit remediation (Round Next + Round 2 + Round 3)

Toate cele 12 findings din `AUDIT-LEGAL-DASHBOARD.md` aplicate. Build frontend OK, backend `vitest run` 24/24 verde.

### Round Next — fluxuri load-more + boot Electron (P1)
- **F2** — `load-more` suporta multi-institutie. `frontend/src/lib/api.ts::loadMoreSSE` accepta `string[]` si serializeaza prin `URLSearchParams.append`; `backend/src/index.ts` foloseste `c.req.queries("institutie") ?? []`, valideaza `MAX_INSTITUTII=50` + per-institutie. Loop serial pe institutie cu dedup intre institutii pe `existingNumere` Set; `totalUnits = institutionList.length * intervals.length`; prefix `[institutie]` in `currentInterval`.
- **F3** — Buton **Stop** propaga abort la backend. `batchFetchDosare` + `subdivideInterval` accepta `signal?: AbortSignal` si verifica la fiecare iteratie/chunk; ruta wired la `c.req.raw.signal` (pattern `routes/rnpm.ts:141`); single timeout seteaza `timedOut=true` si cheama `abortController.abort()`. Daca `aborted` → nu se emit evenimente "done"/"error" (silent close).
- **F4** — Boot Electron cu deadline + dialog. `electron/main.js`: `STARTUP_TIMEOUT_MS=30000`, `HEALTH_POLL_INTERVAL_MS=200`. `require()` backend in try/catch cu reject explicit; polling cu deadline (nu retry infinit); `backendStarted=true` doar dupa confirmare `/health`; helper `showStartupErrorAndQuit()` foloseste `dialog.showErrorBox` + `app.quit()`.

### Round 2 — state, erori, metrici, versiuni (P2/P3)
- **F5** — Updates `load-more` cu `setState` functional. `Dosare.tsx` + `Termene.tsx`: `onStateChange` tipat `React.Dispatch<React.SetStateAction<...>>`; toate update-urile in callback-uri folosesc `(prev) => ({...prev, ...})` (onBatch, final pass, catch error branch). Stream-ul nu mai poate suprascrie filtre/state aparute intre batch-uri.
- **F7** — Erorile HTTP propagate transparent. `frontend/src/lib/api.ts`: `await res.text()` o singura data, parse JSON in try/catch separat, propagat `serverMessage ?? "Eroare la incarcarea extinsa."` — fara dublu-throw in acelasi try.
- **F11** — Metrici uniformizate. `MetricsPanel.tsx`: `institutiiCounts` separat in `totalInstitutii` (Object.keys.length, afisat ca cifra reala) + `topInstitutii` (slice 0..5). `TermeneMetrics.tsx`: single `useMemo` cu `today.setHours(0,0,0,0)` aliniat la `filterByMetrics()` din `Termene.tsx` (definitie unica `viitor` / `trecut` / `azi`).
- **F12** — Versiunea unificata. `package.json` root → `1.4.4-ai`; `frontend/package.json` name → `legal-dashboard-frontend`; `backend/package.json` name → `legal-dashboard-backend`. `frontend/vite.config.ts` injecteaza `__APP_VERSION__` din `../package.json` (single source of truth); `frontend/src/vite-env.d.ts` declara constanta; `Dashboard.tsx` consuma `__APP_VERSION__`.

### Round 3 — performance, theming, a11y, tests (P2)
- **F8** — Code-splitting. `Dashboard.tsx`: `Changelog` + `Manual` lazy via `React.lazy` cu `<Suspense>`; `exportManualPDF` dynamic-import in handler (jspdf+xlsx out of Dashboard chunk). `Dosare.tsx` + `Termene.tsx`: `MetricsPanel` + `TermeneMetrics` lazy (recharts out of initial). `vite.config.ts`: `manualChunks` named pentru `charts` (recharts), `xlsx`, `pdf` (jspdf+jspdf-autotable). Bundle main: **306 kB** (gzip 83 kB); `charts` 517 kB doar la prima cautare cu rezultate; `xlsx`/`pdf` doar pe export.
- **F10** — Culori grafice centralizate. `frontend/src/lib/chart-colors.ts` (nou) exporta `CATEGORY_COLORS` (Penal/Civil/Contencios/Litigii munca/Faliment/Profesionisti/Altele), `CATEGORY_FALLBACK`, `CHART_FILLS` (primary/accent/termene). `MetricsPanel.tsx` + `TermeneMetrics.tsx` consuma constantele. Recharts cere literale CSS pentru fill — re-themeing chart palette intr-un singur loc.
- **F6** — Accesibilitate dialoguri + form. `frontend/src/hooks/useDialog.ts` (nou) — Escape close, body scroll lock, focus capture pe mount, restore focus pe unmount. Wired in: Dashboard `Changelog`/`Manual` modals, `App.tsx` API key dialog, `InstitutieSelect` overlay. Toate cu `role="dialog"` + `aria-modal="true"` + `aria-labelledby` + `tabIndex={-1}` + butonul X cu `aria-label`. `SearchForm.tsx` foloseste `useId()` pentru pairing `htmlFor`/`id` pe `numarDosar`/`numeParte`/`obiectDosar`/`dataStart`/`dataStop`. WCAG 1.3.1, 2.1.1, 2.4.3, 4.1.2 acoperite.
- **F9** — Test coverage minimum. Vitest instalat in backend (`devDependencies`, script `npm test`). `intervals.test.ts` (12 cases): generateMonthlyIntervals (range valid/invalid/leap/cross-year/clamp), splitInterval (no overlap/no gap, edge case 2-day), defaultDateRange (7y window). `soap.test.ts` (12 cases): `toLegacyDiacritics`, `extractFirst`/`extractAll` (namespaced tags, self-closing ignore, prefix collision `data` vs `dataStop`), `parseDosar` (top-level fields, parti, sedinte isolation, fallback `categorieCaz`/`categorieCazNume`, missing sections). Helpers `extractFirst`/`extractAll`/`parseDosar`/`toLegacyDiacritics` exportate explicit pentru testabilitate. Total: **24/24 verde**.

### Verificare finala
- `frontend && npx tsc --noEmit` — clean.
- `frontend && npm run build` — OK; warning preexistent `import.meta` neschimbat.
- `backend && npm test` — 24/24 verde, 256ms.

---

## 16 Aprilie 2026 (sesiunea 3) — Normalizare text RNPM (scope: RNPM only)

Trei imbunatatiri din spec-ul RNPM "Mentiuni esentiale", cu scope explicit pe fluxurile RNPM. Cautarea Dosare si Termene (PortalJust, SOAP) ramane neatinsa.

### Backend
- `backend/src/util/textNormalize.ts` (nou) — `stripDiacritics(s)` + `stripDiacriticsDeep<T>(value)`. Pattern NFD + drop U+0300..036F.
- `services/rnpmSearchService.ts::executeSearch`: `stripDiacriticsDeep` aplicat pe `restParams` **doar** pentru payload-ul trimis la `client.search(...)`. `input.params` ramane neatins, deci `rnpm_searches.params_json` pastreaza textul original cu diacritice (istoricul cautarilor afiseaza exact ce a tastat userul). `/search` si `/bulk` trec prin acelasi drum, deci comportamentul e simetric. `captchaKey` / `type` / `gcode` nu sunt atinse.
- `db/schema.ts`: inregistrat scalar SQLite `rnpm_norm(x) = lower(stripDiacritics(x))` via `db.function(...)`, `deterministic: true`, per-connection.
- `db/avizRepository.ts::getAvize()`: filtrul `searchText` foloseste `rnpm_norm(col) LIKE ? ESCAPE '\'` pe 9 coloane (`identificator`, `tip`, `utilizator_autorizat`, creditor `denumire`/`cod`/`cnp`, debitor `denumire`/`cod`/`cnp`). Parametrul e normalizat o singura data in JS (`stripDiacritics(q).toLowerCase()`) si meta-caracterele LIKE (`%`, `_`, `\`) sunt escape-uite pentru a fi tratate literal — user tasteaza "a%b" si gaseste literal "a%b", nu orice contine "a". User tasteaza "stefan" → gaseste "Ștefan" / "STEFAN" in baza locala.

### Frontend
- `RnpmSearchForm.tsx`: helper `findNonNumericCui(obj)` walk pe params-ul construit dupa filtrul per-activeType. Daca `CUI.value` contine non-digit → `window.confirm("Atentie: CUI ... contine caractere non-numerice. Continui cautarea?")` non-blocking. Astfel nu valideaza CUI-uri stocate in state dar apartinand unui tab inactiv.

### Scope isolation
- `getDb()` e folosit EXCLUSIV de `avizRepository.ts` + `searchRepository.ts` (ambele RNPM).
- `stripDiacriticsDeep` importat EXCLUSIV in `routes/rnpm.ts`.
- PortalJust Dosare + Termene nu trec prin SQLite locala si nu trec prin `/api/rnpm/*`.

---

## 16 Aprilie 2026 (sesiunea 2) — Hardening post-audit

Remediere findings audit-readiness + CLAUDE.md conventions. Fara schimbari de comportament user-facing; toate defense-in-depth.

### Backend
- `hono/body-limit` pe POST `/api/rnpm/*`: `/search` 64KB, `/bulk` 512KB, `/saved/export` 64KB, `/captcha/balance` 4KB → 413 la depasire (F-1).
- `/bulk` SSE timeout 10 min via `setTimeout` pe `AbortController` (F-2) — stream-ul nu mai poate ramane blocat indefinit.
- `validateParamsDepth` — walk recursiv care respinge params cu adancime > 4 sau string-uri > 500 chars (W-1).
- `defaultRnpmClient` — singleton exportat din `rnpmClient.ts`; `executeSearch` / `executeBulkSearch` / ruta `/bulk` folosesc instanta partajata in loc de `new RnpmClient()` per call (CP-B5).

### Frontend
- `RnpmBulkSearch`: `useEffect` cleanup care face `abortCtl.abort()` la unmount — previne waste 2Captcha daca userul paraseste tab-ul in timpul unui bulk (CP-E1).
- `lib/rnpmApi.ts`: SSE reader wrap in try/finally cu `reader.cancel()` pentru eliberare pe abort/error abrupt (CQ-6).

### Electron
- `ALLOWED_EXTERNAL_DOMAINS` extins cu `mj.rnpm.ro`, `www.rnpm.ro` (W-2).

### Onboarding
- `backend/.env.example` — lista completa variabile + nota 2Captcha (se configureaza in UI) (CQ-8).

### Refactor (CP-15)
- `RnpmSearchForm.tsx` restructurat pe hooks + sub-componente: introduse `useText` / `useSiSauField` / `usePJField` / `usePFField` pentru a grupa starea per-entitate; introduse `PJBlock` / `PFBlock` / `PartyFieldset` / `VehiculFieldset` / `DestinatieSelect` pentru a elimina duplicarea JSX. `useState` direct in component: 40+ → 11. Logica de submit pastrata exact (toate particularitatile per-categorie comentate inline).

---

## 16 Aprilie 2026 — RNPM form parity cu site-ul oficial

Aliniere completa a formularului `RnpmSearchForm` la specificatia oficiala RNPM (`https://mj.rnpm.ro/#informatii/cautare`) si la payload-urile reale capturate din Network tab.

### Formular cautare
- Categoriile au denumirile exacte din spec (Aviz de ipoteca mobiliara / Fiducie / Aviz specific / Aviz de ipoteca - creante securitizate / Aviz de ipoteca - obligatiuni ipotecare).
- **Tipul avizului** — dropdown per categorie (18 valori ipoteci, 7 specifice, 7 fiducii).
- **Destinatia inscrierii** — dropdown la specifice (14 valori) si la ipoteca (10 valori).
- **SI/SAU** pe operatorul fiecarui camp `SiSau` (CUI, CNP, RegCom, Prenume, Serie sasiu/motor, Nr inmatriculare, tip aviz, destinatie).
- **Default checkboxes**: `Numai active` + `Nemodificate de alte inscrieri` bifate implicit, conform spec.
- **Toggle PJ/PF unic per parte** ("Persoana Juridica" / "Persoana Fizica") cu campuri condiționate (CUI vs CNP).
- Structura noua per categorie:
  - **Fiducie**: Constituitor (PJ/PF) / Fiduciar (PJ) / Beneficiar (PJ/PF) / Vehicul.
  - **Aviz specific**: Destinatie + Parte (PJ/PF) + Bun (descriere).
  - **Creante securitizate**: Reprezentant Creditor (PJ) + Debitor (PJ/PF) + Bun (descriere).

### Backend
- `RnpmSearchParams` extins cu: `constituitorPJ/PF`, `fiduciar`, `beneficiarPJ/PF`, `parteJ/parteF`, `bunA.descriere`, `reprezentantCreditor`, `debitorJ`, `debitorF`, `creante.descriere`.
- `RnpmDetailBun` extins cu `constituitoriF/J` (referinte numerice catre debitori) si `tertiF/J` (entitati complete).
- `executeSearch` arunca eroare clara cand `total > 1500` (limita RNPM): _"RNPM a returnat N rezultate (limita 1500). Restrange criteriile de cautare."_
- Re-solve captcha automat pe `410/401/403` (gcode expirat) pentru paginile ulterioare ale aceleiasi cautari.

### Persistenta detalii
- `rnpm_bunuri.referinte_json` — coloana noua (migratie idempotenta) cu referintele tert/constituitor per bun.
- Modalul de detaliu afiseaza referintele ca badge-uri colorate (amber = tert, sky = constituitor).

### Erori UI
- Mesaj backend (status text) propagat la frontend in loc de "Eroare server (500)" generic.
- Auto-scroll la panoul de detaliu cand se selecteaza un aviz (centru viewport).

### Documentatie
- `STATUS.md` extins cu sectiune "Update 2026-04-16" + sectiune "Ramas de facut" (Obligatiuni, Tert cedat la ipoteca, Bun mobil atasat imobilului, Bun "Alt tip"/imobil la fiducie, validari input).

---

## v2.0.0 — 15 Aprilie 2026 (Legal Dashboard Launch — rebranding din PortalJust App)

Aplicatia a fost rebrand-uita din **PortalJust App v1.4.4-ai** in **Legal Dashboard v2.0.0**. Versiunea bumped la 2.0.0 pentru continuitate cu istoricul PortalJust (entry-urile v1.4.4-ai si mai vechi raman vizibile mai jos sub vechea denumire). PortalJust ramane aplicatie separata, neatinsa. Legal Dashboard = tot ce avea PortalJust + tab nou **Cautare RNPM** (Registrul National de Publicitate Mobiliara).

### Rebranding
- Nume aplicatie: "Legal Dashboard" (titlu fereastra, installer, shortcut, PDF exports, manual)
- AppId: `ro.legaldashboard.app`
- DB path: `userData/legal-dashboard.db` (env `LEGAL_DASHBOARD_DB_PATH`)
- Istoric RNPM separat de istoricul PortalJust (localStorage `legal-dashboard-rnpm-history`)
- Referintele la `portal.just.ro` pastrate ca "PortalJust" (sursa externa de date)

### RNPM — Backend
- SQLite: 6 tabele noi (`rnpm_searches`, `rnpm_avize`, `rnpm_creditori`, `rnpm_debitori`, `rnpm_bunuri`, `rnpm_istoric`) cu `owner_id` si index-uri adecvate
- Repositories: `searchRepository`, `avizRepository` (upsert idempotent pe UNIQUE(owner_id, identificator), cursor pagination)
- `captchaSolver` peste `@2captcha/captcha-solver` (SDK oficial 2Captcha) — sitekey RNPM hardcodat, erori RO
- `rnpmClient` — search + 4 parti detaliu + istoric; batch de 5 requests concurent
- `rnpmSearchService` — orchestreaza captcha -> search -> fetch eager detalii -> persist (tranzactie)
- Endpoint-uri Hono la `/api/rnpm`: `POST /search`, `POST /bulk` (SSE), `GET/DELETE /saved`, `GET /saved/:id`, `POST /saved/export`, `GET/DELETE /searches`, `POST /captcha/balance`

### RNPM — Frontend
- Tab nou **Cautare RNPM** in sidebar cu 3 sub-tab-uri: Cautare / Bulk / Baza locala
- Formular cautare cu 5 categorii (ipoteci, fiducii, specifice, creante, obligatiuni) + filtre debitor/creditor PJ+PF + vehicule
- Tabel rezultate cu paginare + selectie multipla
- Modal detaliu cu 5 tab-uri (General, Creditori, Debitori, Bunuri, Istoric)
- Bulk search cu SSE live progress, estimare timp/cost, Abort
- Browse baza locala cu filtrare full-text + cursor "Incarca mai multe"
- `useRnpmHistory` — istoric separat (max 15 intrari)
- Sectiune "Istoric RNPM" separata in sidebar

### Setari AI — Card nou 2Captcha
- Al 4-lea card in dialogul "Setari AI" alaturi de Anthropic / OpenAI / Google
- Cheie stocata obfuscata in localStorage (btoa + reverse) alaturi de celelalte
- Necesara exclusiv pentru tab-ul RNPM (~$0.003/captcha)

### Eager detail fetch
- UUID-urile RNPM sunt efemere — detaliile complete (parti 1-4 + istoric) sunt aduse in timpul cautarii si persistate local, eliminand round-trip-ul la browse ulterior

---

## v1.4.4-ai — 5 Aprilie 2026 (AI Enabled)

### Export — Excel Stilizat cu Formatare Avansata
- **xlsx-js-style** ca dependenta (drop-in replacement pentru xlsx cu suport styling la nivel de celula)
- **Titlu dark blue** — rand de titlu cu fundal albastru inchis, text alb, bold, merge pe toate coloanele
- **Rand statistici** — numar dosare/termene si data exportului, fond gri deschis
- **Headere colorate** — fundal albastru, text alb, bold, aliniere centrata (similar cu stilul PDF)
- **Randuri alternante** — gri deschis pe randurile pare, alb pe cele impare, text negru clar
- **Numar dosar bold** — evidentierea numerelor de dosar in lista principala
- **Sheet Sedinte grupat** — sectiuni clare per dosar cu header colorat, separate de un rand gol

### Export — Hyperlinks Interne Excel (Bidirectionale)
- **Dosare → Sedinte**: numarul dosarului din sheet-ul Dosare are hyperlink direct catre prima sedinta a dosarului din sheet-ul Sedinte
- **Sedinte → Dosare**: headerul fiecarei sectiuni de dosar din sheet-ul Sedinte are hyperlink inapoi catre randul dosarului din sheet-ul Dosare (indicat cu ↑)
- Navigare rapida intre cele doua sheet-uri fara scroll manual

### Export — Filenames Dinamice
- **1 dosar exportat**: fisierul se numeste `dosar_NR-DOSAR.xlsx` / `dosar_NR-DOSAR.pdf` (numarul dosarului in denumire)
- **Multiple dosare**: `dosare_DD.MM.YYYY.xlsx` / `dosare_DD.MM.YYYY.pdf` (data exportului)
- **Acelasi comportament pentru termene**: `termen_NR-DOSAR.ext` / `termene_DD.MM.YYYY.ext`
- Caracterele invalide pentru fisiere din numarul dosarului sunt inlocuite cu `-`

### AI — Actualizare Modele Claude
- **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — modelul Echilibrat
- **Claude Opus 4.6** (`claude-opus-4-6`) — modelul Premium si judecator multi-agent
- **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) — modelul Rapid
- Actualizare label-uri in interfata: "Sonnet 4" → "Sonnet 4.6", "Opus 4" → "Opus 4.6"

### Server — Versiune Deployabila
- **Build server** (`npm run dist:server`) — pachet ZIP complet pentru deployment direct pe server
- Backend bundlat cu esbuild (toate dependentele incluse intr-un singur fisier CJS)
- Frontend compilat ca fisiere statice, servite de backend in production
- Dockerfile + docker-compose.yml pentru deployment in container
- `.env.example` cu toate variabilele de configurare

---

## v1.4.3-ai — 3 Aprilie 2026 (AI Enabled)

### AI — Modele Gemini 3.x
- **Eliminare completa modele Gemini 2.5** — toate modelele deprecated din seria 2.5 au fost scoase
- **Modele noi Gemini 3.x**: Gemini 3.1 Flash Lite (Rapid), Gemini 3 Flash (Echilibrat), Gemini 3.1 Pro (Premium)
- **Gemini 3.1 Pro ca model judecator** — adaugat in lista modelelor permise pentru analiza multi-agent (alaturi de Claude Opus 4 si GPT-5.4)
- Actualizare model IDs backend: gemini-3.1-flash-lite-preview, gemini-3-flash-preview, gemini-3.1-pro-preview

### UX — Filtrare Date Client-Side (Calendar)
- **Filtrare instant pe rezultatele deja incarcate** — schimbarea datelor din Data Start / Data Stop filtreaza dosarele si termenele in timp real, fara o noua cautare SOAP
- Functioneaza pe ambele pagini: Cautare Dosare (filtreaza dupa data dosar) si Termene & Calendar (filtreaza dupa data sedinta)
- Se poate folosi doar Data Start, doar Data Stop, sau ambele simultan
- Filtrul se reseteaza automat la o cautare noua sau la apasarea butonului Reseteaza

### Performance — Timeout Multi-Agent
- **Timeout multi-agent crescut la 180s** (de la 120s) — permite analize complete pe dosare mari cu modele premium
- Timeout-ul e propagat separat prin lantul de apeluri `callModel → callAnthropic/callOpenAI/callGoogle`

### Desktop — Dimensionare Dinamica Fereastra
- **Fereastra Electron se adapteaza la rezolutia monitorului** — 85% din latimea si 90% din inaltimea work area
- Limite min/max: minim 900x600, maxim 1800x1100
- Respecta Windows DPI scaling nativ (fara zoom suplimentar)

---

## v1.4.2-ai — 31 Martie 2026 (AI Enabled)

### UX — Sectiuni AI Colapsabile
- **Analiză AI** (analiza simpla) este acum o sectiune colapsabila proprie cu header, model selectors direct vizibili, buton analiza si rezultat — totul intr-un singur container
- **Analiză AI Avansată** (multi-agent) este o sectiune colapsabila separata, independenta
- Ambele sectiuni pornesc **inchise by default** — se deschid doar la cererea utilizatorului
- Design unificat: ambele sectiuni au acelasi layout (header cu download + chevron, selectoare model, buton jos)
- Redenumire: "Analiză Avansată" → "Analiză AI Avansată"
- Descrierea modelului selectat (Rapid/Echilibrat/Premium) afisata langa butoanele de model in ambele sectiuni

### UX — Marire Fonturi Globala
- **Sidebar**: "Normal" label 11px → 12px, badge "Activ"/"Neconfigurat" 10px → 11px
- **Istoric Cautari**: header 11px → 12px, nume cautare 12px → 13px, rezultate + timp 10px → 11px
- **CalendarView**: toate fonturile marite cu +1.5px (card, solutie, solutieSumar 14.5px, parti, badges)

### UX — Consistenta Termene cu Dosare
- **solutieSumar** in TermeneTable: 13px → 14.5px (aliniat cu DosareTable)
- **Party badges** in TermeneTable: text-[10px] → text-xs (aliniat cu DosareTable)
- **splitConcatenatedWords** aplicat si pe TermeneTable (fix text concatenat tip "INCHEIEREINDREPTAR...")
- **Functii comune** (splitConcatenatedWords, formatDocumentSedinta) mutate in utils.ts (shared)
- **Bold rosu** pe data, ora si institutie cand randul e expandat (la fel ca in DosareTable)
- **Collapse anterior** — la deschiderea unui termen, cel anterior se inchide automat (la fel ca in DosareTable)

### AI — Descriere Model Selectat in Multi-Agent
- Fiecare row de model (Analist 1, Analist 2, Judecator) afiseaza acum descrierea modelului selectat (Rapid/Echilibrat/Premium) langa butoane
- Adaugat `desc` pe JUDGE_MODELS_LIST (Premium pentru Opus 4 si GPT-5.4)

---

## v1.4.1-ai — 30 Martie 2026 (AI Enabled)

### UX — Auto-Scroll la Detalii Dosar
- La expandarea unui rand din tabel, ecranul face scroll automat pentru a afisa sectiunea de detalii
- Deosebit de util cand dosarul este la finalul paginii vizibile
- Functioneaza pe ambele tab-uri: Dosare si Termene
- Detectie inteligenta a containerului scrollable (getBoundingClientRect + scrollable parent traversal)

### UX — Indicator Vizualizat / Nevizualizat
- Punct albastru animat (ping) langa numarul dosarelor/termenelor nevizualizate
- Iconita ochi gri pentru cele deja vizualizate (expandate)
- Marcare automata la expandarea randului
- Persistare in sessionStorage pe durata sesiunii de browser
- Functioneaza pe ambele tab-uri: Dosare si Termene

### UX — Butoane Navigare Rapida (Scroll Sus/Jos)
- Doua butoane floating in coltul din dreapta-jos al ecranului
- Sageata sus — apare cand ai scrollat >300px in jos, duce la meniul de cautare
- Sageata jos — apare cand mai ai >300px pana la finalul paginii
- Se actualizeaza automat la incarcarea de continut nou (ResizeObserver)
- Functioneaza pe toate paginile (Dashboard, Dosare, Termene)

### AI — Fix Analiza Trunchiata pe Dosare Complexe
- **max_tokens crescut de la 3000 la 8000** pe toti providerii (Anthropic, OpenAI, Google)
- **max_output_tokens setat explicit** pe OpenAI (Responses API) si Google (Gemini) — inainte depindeau de default-uri
- **Timeout backend crescut**: 90s → 120s per apel AI — safety net pentru dosare mari
- **Timeout frontend crescut**: single 120s → 180s, multi-agent 180s → 300s (5 minute)
- Rezolva problema analizei multi-agent care se oprea la dosare cu multe termene stufoase

---

## v1.4.0-ai — 29 Martie 2026 (AI Enabled)

### Paginare Extinsa (Load More)
- **Incarca mai multe** — cand SOAP API returneaza limita de 1.000 rezultate, butonul "Incarca mai multe" scaneaza luna cu luna pentru a aduce toate rezultatele
- Bara de progres in timp real: "Luna X din Y — Z dosare/termene noi gasite"
- Buton **Stop** (rosu) permite oprirea cautarii si pastrarea rezultatelor partiale deja primite
- Backend-ul primeste lista dosarelor existente (POST body) si trimite doar dosare **NOI** — fara re-scanare redundanta
- Subdivizare recursiva: daca o luna depaseste 1.000, se imparte in jumatati (max adancime 2)
- Chunking SSE: batch-uri de max 50 elemente per event pentru a evita pierderea in proxy buffers
- Functioneaza pe ambele tab-uri: Cautare Dosare si Termene
- Merge incremental pe fiecare batch — totalul afisat in progress reflecta numarul unic real
- Delay 150ms intre request-uri SOAP pentru a nu suprasolicita portalquery.just.ro
- Date range implicit 3 ani inapoi cand nu sunt specificate date

### Navigare Persistenta intre Tab-uri
- Componentele Dosare si Termene raman montate in DOM cand navighezi intre tab-uri (display:none)
- Operatiile async (load-more, cautare) **supravietuiesc** navigarii — nu se pierd la schimbarea tab-ului
- Doar butonul Stop opreste o cautare in progress, nu navigarea
- Campurile formularului, numele cautat si butonul Reseteaza se pastreaza corect la navigarea inapoi

### Buton Reseteaza Imbunatatit
- Reseteaza sterge complet: campuri formular, rezultate cautare, filtre, metrici, starea load-more
- Pagina revine la starea initiala (fara rezultate)

### Analiza Multi-Agent AI — Documentare Functionare
- **Rolul judecatorului** (nedocumentat anterior): judecatorul primeste datele complete ale dosarului + cele 2 analize separate
  - Unde ambele analize sunt de acord → preia direct concluzia comuna
  - Unde difera, se contrazic sau sunt vagi → verifica in datele originale ale dosarului
  - Produce analiza finala unitara + sectiune "Revizuire si reconciliere" cu diferentele gasite si cum le-a rezolvat
- Modele judecator permise: Claude Opus 4 si GPT-5.4
- Prompt analist: 7 sectiuni (Rezumat, Explicatie parti, Starea actuala, Istoric sedinte, Ce ar putea urma, Temei juridic, Legaturi cu alte dosare)

### Securitate (Audit Complet + Hardening)

#### CRITICAL — Fixate
- **Validare POST body pe load-more**: array `existing` limitat la max 10.000 elemente, max 100 caractere/element, tipuri verificate — previne DoS prin epuizare memorie
- **Schema validation pe POST body**: structura JSON validata complet (obiect, array de string-uri) — body malformat returneaza 400 cu mesaj clar, nu silent fail
- **JSON.parse protejat**: try-catch dedicat pe toate endpoint-urile AI — body invalid returneaza "JSON invalid." in loc de exceptie neprinsa

#### HIGH — Fixate
- **SSE timeout + limita intervale**: max 10 minute per stream, max 120 intervale lunare (~10 ani) — previne resource exhaustion
- **Chei API obfuscate in localStorage**: stocare cu btoa + reverse (nu plaintext citibil) — migrare automata de la formatul vechi
- **External URL whitelist exact**: `portal.just.ro`, `www.just.ro`, `portalquery.just.ro` — `.endsWith()` inlocuit cu `.includes()` pentru a preveni bypass-ul cu domenii similare (ex: `attacker-just.ro`)
- **DevTools dezactivate in productie**: `devTools: false` cand `NODE_ENV === "production"` — activabile cu flag `--dev-tools` pentru dezvoltatori

#### MEDIUM — Fixate
- **`enableRemoteModule: false`** explicit in Electron webPreferences
- **CSP restrictionat**: `data:` URI eliminat din `img-src` si `font-src` (aplicatia nu foloseste data: URI)

#### Riscuri Acceptate (documentate)
- SOAP HTTP: portalquery.just.ro nu ofera HTTPS — date publice, fara autentificare
- XML regex parsing: functioneaza corect cu formatul fix al Ministerului Justitiei, nu necesita parser dedicat

### Manual de Utilizare
- Manual complet integrat in aplicatie cu **12 capitole** care acopera toate functionalitatile
- Accesibil din Dashboard (buton "Manual" langa "Vezi Noutati"), deschis ca modal full-screen
- **Cuprins interactiv** — click pe capitol navigheaza direct la sectiunea respectiva (scroll smooth in containerul modal)
- **Export PDF** — buton de descarcare disponibil atat in header cat si la finalul manualului
- PDF generat: Portrait A4 cu cover page, cuprins, 12 capitole formatate profesional si footer pe fiecare pagina
- Capitole: Prezentare Generala, Dashboard, Cautare Dosare, Termene & Calendar, Load More, Export, Analiza AI, Multi-Agent, Chei API, Sidebar, Personalizare, Securitate

### Lizibilitate Text Imbunatatita
- Textul din Manual si Changelog schimbat de la gri (`text-muted-foreground`) la negru (`text-foreground`)
- Aplicat pe: paragrafe, bullet-uri, cuprins, subtitluri, footer, date versiuni

### Tehnic
- Load-more endpoints schimbate de la GET la POST (numerele dosarelor existente nu mai incap in URL)
- `backend/src/intervals.ts` — modul nou pentru generare intervale lunare si subdivizare
- Vite proxy cu timeout 600s pentru SSE endpoints
- `parseExistingFromBody()` — functie centralizata de validare body cu limite de securitate
- `AppShell` component cu `useLocation()` pentru routing persistent
- SearchForm accepta `defaultParams` si `onReset` props
- `lastSearchParams` salvat in starea parintelui (App.tsx) pentru persistenta intre navigari
- `onBatch` callback in `loadMoreSSE()` pentru merge incremental

---

## v1.3.0-ai — 28 Martie 2026 (AI Enabled)

### Analiza AI Avansata (Multi-Agent)
- Sistem multi-agent: 2 analisti AI analizeaza dosarul in paralel, un al 3-lea model (judecator) reconciliaza rezultatele
- Judecatorul primeste datele complete ale dosarului + cele 2 analize — verifica afirmatiile contra datelor reale, corecteaza interpretari gresite si adauga aspecte omise
- Modele judecator permise: Claude Opus 4 si GPT-5.4
- Sectiune colapsabila cu selectori model pentru fiecare analist si judecator
- Vizualizare analize individuale (toggle side-by-side)
- Endpoint nou: `POST /api/ai/analyze-multi`

### OpenAI Responses API & Modele Noi
- Migrare de la Chat Completions API la noul Responses API (`client.responses.create()`)
- Modele actualizate: GPT-5.4 nano (Rapid), GPT-5.4 mini (Echilibrat), GPT-5.4 (Premium)

### Prompt AI Imbunatatit
- Adaugat sectiuni noi in analiza: "Temei juridic (articole de lege relevante)" si "Legaturi cu alte dosare"
- Selectori model stivuiti vertical (layout imbunatatit)
- Afisare tip model (Rapid/Echilibrat/Premium) pe fiecare rand de provider in selectorul AI

### Export PDF Analize AI
- Export PDF pentru analiza simpla si avansata
- Design profesional: header minimal, card info dosar, formatare markdown
- Page breaks inteligente (titlul sectiunii nu ramane singur pe pagina)
- Paleta culori calde (warm gray/stone), footer pe fiecare pagina

### Securitate (Audit v1.3.0-ai)
- Prompt injection defense: date dosar in `<dosar_data>` delimiters, truncare campuri (obiect 500, nume parte 200, solutie 10000 chars)
- Analize AI in `<analiza_1>`/`<analiza_2>` delimiters in prompt-ul judecatorului
- Rate limiter ponderat: endpoint multi-agent consuma 3 unitati (vs 1 pentru alte endpoint-uri)
- Schema validation pe endpoint multi-agent (reutilizare `validateAiBody`)

### Performanta AI
- Apeluri directe fara extended thinking/reasoning — viteza optima pe toate modelele
- Timeout backend: 90s per apel AI
- Timeout frontend fetch: 120s (analiza simpla), 180s (multi-agent)
- `max_tokens` Anthropic: 3000 (suficient pt output real ~800-1500 tokens)
- Toate sedintele dosarului se trimit integral catre AI (fara limitare)
- Truncare campuri ajustata: obiect 500, nume parte 200, solutie 10000 caractere
- Fix macOS: guard `app.isReady()` pe `activate` + flag `backendStarted`

### Documentatie
- DOCUMENTATIE.md — documentatie completa a proiectului (arhitectura, functionalitati, securitate, API, tipuri date)

---

## [1.2.1-ai] - 2026-03-27 — AI Enabled

### Functionalitati Noi

#### Selector Institutii (Multi-Select)
- Selector modal pentru filtrarea pe **246 instante** din Romania (parsate din WSDL-ul SOAP)
- Grupare pe categorii: Curți de Apel (15), Tribunale (42), Tribunale Specializate (1), Tribunale Comerciale (3), Tribunale Militare (5), Curți Militare (1), Judecătorii (179)
- **Multi-select** cu draft state — selectiile se aplica la inchiderea ferestrei, cu sortare alfabetica
- Cautare diacritice-insensitiva (ex: "brasov" gaseste "Brașov")
- Chips vizuale pentru selectii, buton de reset, counter de rezultate
- **Cautare paralela SOAP** — cand sunt selectate mai multe institutii, backend-ul face `Promise.all` pe toate

#### Filtrare Client-Side pe Institutii
- Pipeline de filtrare extins: Institutii → Categorii → Stadii → Roluri
- Filtrarea se aplica pe dosarele deja extrase (fara re-interogare SOAP)

### Imbunatatiri

#### Normalizare Nume Institutii
- Functia `normalizeInstitutie()` centralizeaza — transforma "TribunalulSATUMARE" in "Tribunalul Satu Mare"
- Cache-based lookup cu strip diacritice pentru matching robust
- Aplicata in toate componentele: DosareTable, TermeneTable, MetricsPanel, CalendarView, DosarModal, export

#### Compatibilitate Diacritice Romanesti
- **Backend SOAP**: conversie automata ș(U+0219)→ş(U+015F) si ț(U+021B)→ţ(U+0163) — API-ul PortalJust accepta doar varianta legacy cu sedila
- Cautarea cu "Ioan Farcaș", "Ioan Farcaş" sau "Ioan Farcas" returneaza aceleasi rezultate
- **Analiza Parte (MetricsPanel)**: matching diacritice-insensitiv pentru contorizarea rolurilor
- **Highlight nume (DosareTable)**: regex cu variante diacritice — "farcas" face highlight pe "FARCAŞ"/"FĂRCAȘ"
- **Filtru roluri (Dosare)**: comparare diacritice-insensitiva intre numele cautat si parti
- **Selector institutii**: cautare fara diacritice gaseste rezultate cu diacritice

#### API Multi-Institutie
- Backend accepta parametrul `institutie` ca array (`?institutie=X&institutie=Y`)
- Frontend trimite array prin `URLSearchParams.append()`
- `c.req.queries("institutie")` in Hono pentru parsarea array-urilor

### Securitate (Audit v1.2.1-ai)

#### Protectie Amplificare Cereri SOAP
- Limita maxima de **50 institutii** per cerere — previne trimiterea de sute de cereri SOAP paralele printr-un singur request
- Toate valorile din array-ul `institutie` sunt validate individual (lungime, caractere de control)

#### Timeout pe Apeluri AI
- Toate apelurile catre providerii AI (Anthropic, OpenAI, Google) au acum timeout de **60 secunde**
- Previne blocarea conexiunilor HTTP cand un provider AI nu raspunde

#### Validare Body Size Reala
- Verificarea dimensiunii cererii `/api/ai/analyze` se face pe body-ul real, nu doar pe header-ul `Content-Length` (care poate fi omis sau falsificat)

#### Validare Chei API
- Valorile din `apiKeys` sunt validate ca string-uri cu lungime maxima de 256 caractere
- Previne trimiterea de obiecte sau string-uri foarte lungi ca chei API

#### Protectie URL Injection
- `encodeURIComponent()` aplicat pe toate URL-urile portal.just.ro construite din numere de dosar
- Previne injectarea de parametri URL prin caractere speciale in numerele de dosar

#### Verificare Identitate Backend (Electron)
- Health check-ul la pornire verifica acum ca raspunsul contine `service: "PortalJust API"`
- Previne port hijacking — daca alt proces ocupa portul 3001, aplicatia nu va incarca continut strain

#### Validare URL Stricta (Electron)
- `shell.openExternal()` foloseste acum `new URL()` pentru parsare si verifica `hostname.endsWith(".just.ro")`
- Previne bypass prin URL-uri de forma `https://portal.just.ro.evil.com`

#### CSP Imbunatatit (Electron)
- Adaugat `object-src 'none'` — blocheaza plugin-uri si embeds
- Adaugat `frame-ancestors 'none'` — previne incadrarea aplicatiei in iframe-uri

### Infrastructura
- `frontend/src/lib/institutii.ts` — fisier centralizat cu date institutii, grupuri si normalizare
- `frontend/src/components/InstitutieSelect.tsx` — componenta modal multi-select
- `toLegacyDiacritics()` in `backend/src/soap.ts` pentru compatibilitate Unicode SOAP
- `stripDiacritics()` aplicat consistent in toate componentele frontend cu matching de text

---

## [1.2.0-ai] - 2026-03-27 — AI Enabled

### Functionalitati Noi

#### Asistenta AI Multi-Provider
- Analiza AI integrata pentru interpretarea dosarelor din detalii expandate
- Suport pentru **3 provideri AI**:
  - **Anthropic** (Claude): Haiku 4.5, Sonnet 4, Opus 4
  - **OpenAI** (GPT-4): 4o mini, GPT-4o, GPT-4.1
  - **Google** (Gemini): Flash 2.0, Flash 2.5, Pro 2.5
- Selector de model grupat pe provideri cu coduri de culoare (violet/emerald/blue)
- Se afiseaza doar modelele pentru care exista cheie API activa
- Analiza completa: rezumat, explicatie parti, stare actuala, istoric sedinte, pasi urmatori
- Toate sedintele dosarului sunt incluse in analiza (nu doar ultimele 10)
- Buton toggle pentru ascundere/aratare analiza AI dupa generare
- Buton "Re-analizează" pentru regenerare cu alt model

#### Configurare Chei API
- Dialog global "Configurare Chei API" accesibil din sidebar ("Setari AI")
- Inputuri separate per provider cu status indicator (Activa/Neconfigurat)
- Posibilitate de stergere individuala a cheilor
- Cheile se salveaza doar local (localStorage) — nu sunt trimise nicaieri in afara de API-ul respectiv
- Optiunea "Mai tarziu" — configurarea nu este obligatorie
- Migrare automata de la formatul vechi (cheie unica) la multi-provider
- Indicator status in sidebar: verde (Activ) sau portocaliu (Neconfigurat)

#### Selectie pentru Export (Dosare & Termene)
- Checkbox pe fiecare rand din tabelele **Dosare** si **Termene**
- Checkbox "Select All" in header (selecteaza/deselecteaza pagina curenta)
- Evidentierea vizuala a randurilor selectate (fundal violet)
- Butoanele Excel/PDF arata numarul de elemente selectate
- Daca nu e selectat nimic, se exporta toate elementele (comportament implicit)
- Buton "Deselecteaza tot" pentru reset rapid

#### Export Imbunatatit cu Sedinte
- **Excel**: 2 sheet-uri — "Dosare" + "Sedinte" (toate sedintele cu data, ora, complet, solutie, sumar, document, numar document, data pronuntare)
- **PDF**: coloana noua "Sedinte" cu rezumatul fiecarei sedinte (data, ora, solutia si sumarul)
- Subtitlu cu numar total de dosare si sedinte

#### Selector Rezultate pe Pagina
- Butoane pentru alegerea numarului de rezultate per pagina
- Dosare: 10, 15, 25, 50, 100 (default: 15)
- Termene: 10, 20, 50, 100 (default: 20)
- Se reseteaza automat la pagina 1 cand se schimba

#### Meniu Contextual Electron (Click Dreapta)
- **Copiaza** — apare doar cand exista text selectat
- **Selecteaza tot** — selecteaza tot textul din pagina
- **Printeaza...** — deschide dialogul de printare Windows
- Ctrl+C functioneaza nativ pentru copiere

### Securitate (Audit v1.2.0-ai)

#### Protectie XSS pe Analiza AI
- Toate zonele care afiseaza raspunsul AI folosesc acum **DOMPurify** pentru sanitizarea HTML-ului
- Taguri permise strict limitate la `<strong>`, `<em>`, `<b>`, `<i>` — restul sunt eliminate automat
- Previne executia de cod malitios daca un model AI ar returna HTML/JavaScript in raspuns

#### Sanitizare Erori API
- Mesajele de eroare returnate clientului nu mai contin detalii interne (stack trace, chei API partiale, mesaje SDK)
- Erorile sunt logate complet server-side pentru debugging, dar clientul primeste doar un mesaj generic
- Mesajele SOAP Fault de la PortalJust sunt si ele sanitizate — detaliile tehnice raman doar in log

#### Validare Schema AI Request
- Endpoint-ul `/api/ai/analyze` valideaza acum structura completa a body-ului: tipuri campuri dosar, format apiKeys, model valid
- Limita de dimensiune body: **100KB** — cererile mai mari sunt respinse cu HTTP 413
- Campurile dosarului sunt validate individual (string, array unde trebuie)

#### Protectie Rate Limiter
- Rate limiterul nu mai foloseste header-ul `X-Forwarded-For` (spoofable) pentru identificarea clientilor
- Serverul fiind bind pe localhost, toate cererile vin de la aceeasi adresa — rate limiting-ul protejeaza impotriva flood-ului local

#### Validare Date Imbunatatita
- Validarea datelor (dataStart, dataStop) verifica acum ca data este **reala** (ex: 2024-02-30 este respins, nu doar formatul YYYY-MM-DD)
- Reject caractere de control si null bytes din toti parametrii de input

### Infrastructura
- Backend multi-provider: endpoint unic `/api/ai/analyze` cu rutare automata catre SDK-ul corect
- SDK-uri instalate: `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`
- Vite `optimizeDeps.include` pentru pre-bundling `xlsx`, `jspdf`, `jspdf-autotable`
- dotenv cu `override: true` pentru incarcarea corecta a variabilelor de mediu

---

## [1.2.0] - 2026-03-26

### Imbunatatiri

#### Build macOS (DMG)
- Adaugat suport complet pentru **macOS** (Intel + Apple Silicon)
- GitHub Actions workflow pentru build automat pe macOS
- Fisier DMG cu drag-to-Applications installer
- Repository GitHub: github.com/Havocwithin/portaljust-dashboard

#### Ajustare Dimensiune Font
- Recalibrat valorile fontului: Mic (16px), Normal (18px), Mare (20px), Extra (22px)
- "Normal" corespunde acum dimensiunii corecte pentru ecrane laptop standard
- Rezolvat problema fontului prea mic pe rezolutii mari

#### Iconita Aplicatie
- Iconita cu balanta justitiei prezenta peste tot: installer, taskbar Windows, title bar
- Configurata pentru NSIS (installer/uninstaller icons)
- Adaptata pentru macOS (icon 1024px)

#### Installer fara Drepturi Admin
- Instalarea pe Windows nu mai necesita drepturi de administrator
- Se instaleaza in AppData (per-user), nu in Program Files
- `allowElevation: false` previne prompt-ul UAC

---

## [1.1.0] - 2026-03-26

### Functionalitati Noi

#### Selectie Multipla Roluri (Analiza Parte)
- Badge-urile de rol din sectiunea "Analiza Parte" suporta acum **selectie multipla**
- Se pot combina mai multe roluri simultan (ex: "Creditor" + "Parat" + "Reclamant")
- Mesaj dinamic: "1 filtru activ" / "3 filtre active"
- Click repetat pe un rol il deselecteaza

#### Evidentierea Numelui Cautat (Highlight)
- Cuvintele cautate sunt evidientiate cu **galben** in numele partilor
- Functioneaza independent de ordinea cuvintelor ("instant factoring" evidentiaza "INSTANT" si "FACTORING" separat)
- Aplicat in:
  - Preview-ul din randul tabelului Dosare (primele 2 parti)
  - Sectiunea expandata Parti din Dosare
  - Sectiunea expandata Parti din Termene
- Tooltip (hover) pe numele trunchiate pentru vizualizarea numelui complet

#### Control Dimensiune Text
- Adaugat control de font size in sidebar (4 pasi: Mic 14px, Normal 16px, Mare 18px, Extra 20px)
- Sidebar expandat: butoane A-/A+ cu indicator vizual (4 puncte)
- Sidebar collapsed: iconita "A" cu ciclu prin pasi la click
- Setarea se salveaza in localStorage - persistenta intre sesiuni
- Afecteaza toata aplicatia (Tailwind rem-based scaling)

#### Detalii Expandabile in Tabelul Termene
- Click pe rand deschide/inchide detalii complete
- Informatii afisate: Categorie, Stadiu, Obiect dosar
- Solutie completa (titlu + sumar integral, text lizibil)
- Lista de parti cu badge calitate + nume cu highlight
- Sageata vizuala (chevron) indica expandabilitatea

#### Detalii Expandabile in Calendar
- Numerele de dosar din calendar sunt acum **linkuri** catre portal.just.ro
- Click pe card deschide dropdown cu:
  - Solutie completa (titlu + sumar)
  - Lista de parti cu badge calitate
- Sageata vizuala indica expandabilitatea

#### Filtre Metrici Termene (Carduri Clickabile)
- Cardurile "Termene Viitoare", "Termene Trecute", "Cu Solutie" functioneaza ca **filtre multiple choice**
- Card activ: ring albastru + iconita inversata
- "Total Termene" reseteaza toate filtrele la click
- Filtrele se propaga in cascada: Categorie/Stadiu -> Metrici -> Tabel + Calendar
- Se reseteza automat la cautare noua

#### Filtre Categorie/Stadiu pe Termene
- Filtrele Categorie Caz si Stadiu Procesual sunt acum **functionale** pe pagina Termene
- Backend-ul transmite acum `categorieCaz`, `stadiuProcesual`, `obiect` si `parti` pentru fiecare termen
- Filtrare client-side identica cu cea de pe Dosare
- Metricile reflecta datele filtrate de categorie/stadiu

### Imbunatatiri

#### Corectare Texte Concatenate (Documente Sedinta)
- Extins dictionarul de segmentare cu ~50 termeni juridici noi
- Rezolvate cazuri precum:
  - "INCHEIEREFINALA" -> "INCHEIERE FINALA"
  - "DEZINVESTIREFINALA" -> "DEZINVESTIRE FINALA"
  - "INCHEIERECAMERAPRELIMINARA" -> "INCHEIERE CAMERA PRELIMINARA"
  - "HOTARAREDEFINITIVA" -> "HOTARARE DEFINITIVA"
  - "SENTINTAPENALA" -> "SENTINTA PENALA"
- Categorii adaugate: actiuni procesuale, calificative, locuri/contexte, participanti, prepozitii

#### Consistenta Interfata
- Stilul solutiei din detalii Termene aliniat cu cel din Dosare
- Badge-ul albastru de marcare parte eliminat (pastrat doar highlight-ul galben pe nume)

### Infrastructura

#### Date Complete pentru Termene
- API-ul `/api/termene` returneaza acum informatii complete din dosar:
  - `categorieCaz` - categoria dosarului
  - `stadiuProcesual` - stadiul procesual
  - `obiect` - obiectul dosarului
  - `parti[]` - lista completa de parti (nume + calitate)
- Tipul TypeScript `Termen` actualizat cu campurile noi

---

## [1.0.0] - 2026-03-25

### Lansare Initiala

#### Functionalitati Principale
- Conectare la API-ul SOAP PortalJust.ro (Ministerul Justitiei)
- Cautare dosare dupa: numar dosar, nume parte, obiect dosar
- Cautare termene cu date start/stop
- Filtre client-side: Categorie Caz, Stadiu Procesual
- Vizualizare tabel cu paginatie (20 elemente/pagina)
- Vizualizare calendar pentru termene
- Export Excel si PDF
- Metrici si statistici (grafice Recharts)
- Analiza parte cu roluri si numar aparitii
- Sectiuni de metrici collapsabile (Ascunde/Arata)
- Tema Dark/Light cu persistenta
- Sidebar cu navigare si collapse
- Istoric cautari (max 15, localStorage, stergere individuala)
- Popover istoric pentru sidebar collapsed
- Link-uri directe catre portal.just.ro
- Segmentare automata documente concatenate (INCHEIEREDESEDINTA -> INCHEIERE DE SEDINTA)
- Matching nume independent de ordine (Florin Duduianu = DUDUIANU FLORIN)

#### Arhitectura
- Frontend: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- Backend: Node.js + Hono (port 3001)
- SOAP integration: portalquery.just.ro/query.asmx
- Grafice: Recharts (PieChart, BarChart)
- Packaging: Electron + electron-builder (NSIS installer, fara admin)

#### Securitate (Masuri de Baza)
- **Rate limiting** (30 req/min pe endpoint) — previne flood-ul si abuzul API-ului
- **Input validation** — lungime maxima 200 caractere per parametru, validare format date YYYY-MM-DD
- **Bind localhost only** (127.0.0.1) — serverul backend nu este expus in retea, doar aplicatia Electron il poate accesa
- **Path traversal protection** — fisierele statice servite doar din directorul frontend; cererile cu `../` sau cai absolute sunt blocate cu HTTP 403
- **Security headers** (Hono secureHeaders) — X-Content-Type-Options: nosniff, X-Frame-Options: DENY, X-XSS-Protection, Content-Security-Policy
- **Escape XML complet** pentru SOAP requests — toate inputurile utilizatorului sunt escaped inainte de a fi trimise catre PortalJust (previne XML injection)
- **CORS restrictiv** — doar originile localhost pe porturile de dezvoltare (5173, 4173) sunt permise; orice alta origine este blocata
- **Fara persistenta API keys in backend** — cheile nu sunt stocate pe disc de catre server, sunt primite per-request de la client
