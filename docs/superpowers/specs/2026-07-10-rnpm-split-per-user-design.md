# Plan: Split RNPM per user (varianta E) — regandirea arhitecturii backup/restore

## Context

**Incidentul declansator (2026-07-10, test live):** restore-ul din modalul RNPM a suprascris INTREAGA baza SQLite (`legal-dashboard.db` — toate modulele, toti userii), nu doar datele RNPM cum sugera contextul UI. S-au pierdut scrierile post-boot (inclusiv `fx_rates` proaspat). In web mode un restore admin da inapoi toti userii. Nu exista restore per user, per modul, si nici backup manual on-demand.

**Decizia userului (dupa analiza comparativa a 5 variante, publicata ca artifact
`https://claude.ai/code/artifact/bdd089f7-467c-433e-995d-80f85d98d236`):**
varianta E — separare fizica DOAR pe modulul RNPM, per user. Fiecare user primeste
fisierul lui `rnpm/<ownerId>.db`; restul aplicatiei (users, auth, quota, usage,
monitoring, audit, fx_rates) ramane in baza unica. Motivatie: RNPM e singurul modul
unde se acumuleaza vizibil o baza per user si unde trebuia sa existe control la nivel
de user; monitorizarea are deja control granular in-app (stergere joburi 1-cu-1,
inchidere alerte individuala).

**Fundament:** analiza a fost facuta cu 5 agenti evaluatori + 2 verificatori
adversariali direct pe cod (~60 referinte file:line confirmate). Verdict varianta E:
fezabila, efort L, fara deal-breakers. Fapte cheie verificate:
- Doar 16 call-sites `getDb()` ating tabele `rnpm_*`: 11 in `backend/src/db/avizRepository.ts` (liniile ~155, 344, 354, 362, 429, 534, 547, 563, 586, 609, 708), 5 in `backend/src/db/searchRepository.ts` (~28, 49, 70, 79, 98). Toate functiile au deja `ownerId` in semnatura (exceptie `loadAvizChildren` care il deriva din `aviz.owner_id`).
- ZERO tranzactii care combina `rnpm_*` cu tabele non-RNPM (`saveAvizFull` e pur rnpm — avizRepository.ts:158-338; captcha quota e tranzactie separata pe `captcha_usage`; audit-ul e post-hoc). Nicio degradare de atomicitate.
- Scheduler-ul si dashboard-ul NU ating tabele rnpm (folosesc doar UDF-ul `rnpm_norm` pe tabele proprii — monitoringAlertsRepository.ts:308/648, monitoringJobsRepository.ts:227).
- Doar 3 migrations ating `rnpm_*`: 0001 (baseline), 0021 (index), 0022 (coloane `_norm` + triggere).
- Runner-ul de migrations e deja parametrizat pe handle (`runMigrations(db, dir)` — runner.ts:106) si are guard anti-downgrade (runner.ts:152).
- CAPCANA: detectia legacy din runner.ts:126-148 backfill-uieste sentinel daca gaseste `rnpm_searches`/`rnpm_avize` fara `_schema_versions` — orice DB per-user trebuie creat PRIN runner INTAI, apoi populat.
- `backup.ts` (569 linii) e hardwired pe un singur fisier (prefixe/regexuri :63-72, `getBackupDir` :74, `RESTORE_NAME_RE` :184, `closeDb()` global :234, `getDb().backup()` :540).

**Decizii de design confirmate de user:**
1. Self-service complet: userul non-admin isi vede backup-urile, isi face backup manual si isi restaureaza singur fisierul RNPM propriu (web + desktop).
2. Managementul backup-ului intregii baze (monolit) se muta in Setari, admin-only, cu copy explicit.
3. Buton "Creeaza backup acum" per user in v1.
4. Lucrul pe branch stacked: `feat/v2.43.0-rnpm-split` creat din varful lui `feat/v2.42.0-users-settings` (care e inghetat in asteptarea aprobarii MR). Merge fara squash => dupa merge-ul v2.42 in main, MR-ul nou arata doar delta. NICIUN commit nou pe branch-ul v2.42.
5. Split-ul se aplica SI pe desktop (confirmat explicit): acelasi cod pentru ambele moduri, pe desktop apare doar `rnpm/local.db` (owner unic); shell-ul Electron ramane neatins. ID-urile de search/aviz devin namespace per user — confirmat de user ca fiind exact izolarea dorita ("fiecare user este izolat de celalalt").

## Arhitectura tinta

### Layout fisiere
```
<dataDir>/legal-dashboard.db          # monolitul: tot ce NU e RNPM (schema neschimbata;
                                      #   tabelele rnpm_* raman dar sunt golite; DROP amanat)
<dataDir>/rnpm/<stem>.db              # per user: rnpm_searches -> rnpm_avize ->
                                      #   creditori/debitori/bunuri/istoric + rnpm_bunuri_descrieri proprie
<dataDir>/rnpm/.split-done.json       # marker durabil al splitter-ului (status wiping/done)
<dataDir>/backups/                    # backup-urile monolitului (7 daily / 5 pre-restore / 5 pre-migration / 5 manual)
<dataDir>/backups/rnpm/<stem>/        # jail per user: rnpm.YYYY-MM-DD.db, rnpm.pre-restore-*, rnpm.manual-*
```
`<dataDir>` = dirname(getDbPath()) — neschimbat (userData pe desktop, /data pe Docker).
`ownerId` validat `^[A-Za-z0-9_-]{1,64}$`; numele de fisier este `stem = lowercase(ownerId) + "-" + sha256(ownerId)[0..10]`
(CORECTIE review Sol: ownerId-ul brut nu e injectiv pe filesystem-uri case-insensitive — Windows/macOS —
si poate coincide cu nume rezervate Windows; stem-ul rezolva ambele).
Coloana `owner_id` si filtrele WHERE existente SE PASTREAZA in DB-urile per-user
(belt-and-braces contra bug-urilor de rutare; diff minim in repositories).

### DB layer (fisier nou `backend/src/db/rnpmDb.ts`)
- `getRnpmDb(ownerId)`: registry `Map<ownerId, Database>`; la primul acces: mkdir, open,
  pragmas (WAL, foreign_keys=ON, synchronous=NORMAL, busy_timeout), UDF `rnpm_norm`,
  WAL-truncate la >32MB (paritate cu schema.ts:111-120), pre-migration backup per fisier
  cand exista migrations pending, apoi `runMigrations(db, MIGRATIONS_RNPM_DIR)`
  (provisioning lazy — acopera si userii noi, zero hook pe createUser).
- `closeRnpmDb(ownerId)`, `closeAllRnpmDbs()`; latch-ul `shuttingDown` partajat cu schema.ts
  (markShuttingDown inchide si registry-ul). `checkpointWal`/`compactDb` parametrizate pe handle.
- CORECTIE review Sol: `getRnpmDb` verifica si latch-ul de RESTORE per owner
  (`isRnpmRestoreInProgress`) — in timpul unui restore, ORICE operatie repository a ownerului
  (stats/list/delete/compact/export, nu doar search) primeste `RnpmRestoreInProgressError` in loc
  sa redeschida lazy fisierul in mijlocul swap-ului. Registry-ul de activitate traieste in DB layer
  (`backend/src/db/rnpmActivity.ts`).
- Rutare in cele 16 call-sites din `avizRepository.ts` + `searchRepository.ts`
  (`getDb()` -> `getRnpmDb(ownerId)`), livrata ATOMIC in acelasi commit cu montarea splitter-ului
  la boot (altfel exista o fereastra in care scrierile noi si datele legacy traiesc in layout-uri diferite).

### Migrations
- Director nou `backend/src/db/migrations-rnpm/` cu `0001_rnpm_baseline.up.sql/.down.sql` =
  forma finala consolidata a tabelelor rnpm (baseline actual + index 0021 + coloane `_norm`
  si triggere din 0022). `_schema_versions` propriu per fisier user.
- Lantul monolitului 0001-0042 ramane NEATINS (nicio migration noua necesara: splitter-ul
  goleste randurile, nu schimba schema). Blocul legacy din schema.ts ramane pentru monolit.
- UDF `rnpm_norm` se inregistreaza pe ORICE handle inainte de runMigrations pe fisiere rnpm
  (triggerele din 0022 il apeleaza — gasit de verificatorul adversarial).

### Splitter one-time (fisier nou `backend/src/db/rnpmSplitter.ts`, apelat din index.ts la boot)
Conditie: monolitul are randuri in ORICARE din cele 7 tabele `rnpm_*` SI markerul nu e `done`. Pasi:
1. Preflights fail-closed (monolit intact la orice esec): validare owneri; `PRAGMA foreign_key_check`
   per tabela rnpm; consistenta owner parinte-copil (copil cu `owner_id` diferit de aviz => abort;
   aviz cu owner diferit de search-ul referit => abort); spatiu disc ~3x volumul bazei (statfs, injectabil).
2. Pre-split backup STRICT al monolitului (`VACUUM INTO`, verificat cu size>0 + integrity_check;
   orice esec opreste split-ul — backup-ul e rollback-ul promis, nu best-effort).
3. Per owner distinct: provisioneaza `rnpm/<stem>.db` PRIN runner (capcana sentinel), scrie in
   `.split-tmp` + rename cu retry (AV Windows); ATTACH monolit READONLY prin URI percent-encodat
   (path-ul poate contine spatii), FARA fallback read-write; `INSERT...SELECT` cu id-urile originale;
   descrierile = subsetul referit, cu id-urile originale; `sqlite_sequence` preia high-water mark-ul
   sursei (nu doar MAX(id) copiat). Curatarile de fisiere ignora DOAR ENOENT.
4. Verificare COUNT per tabela per owner + `integrity_check` + probe de citire post-rename.
5. Marker durabil `.split-done.json` (CORECTIE review Sol): dupa verificarea TUTUROR ownerilor se
   scrie `status="wiping"`, apoi DELETE explicit pe toate cele 7 tabele + verificare zero randuri,
   apoi `status="done"`, apoi VACUUM best-effort (esecul compactarii nu mai e fatal).
6. Idempotenta pe faze: fara marker => re-split complet din monolit; marker `wiping` => se reia
   DOAR wipe-ul (fisierele per-user sunt deja sursa de adevar); marker `done` + randuri rnpm
   reaparute in monolit (ex. restore de backup vechi al bazei) => BOOT ABORTAT fail-closed cu
   procedura de remediere in RUNBOOK — splitter-ul nu suprascrie NICIODATA automat fisiere per-user
   mai noi.
Desktop = un singur owner `local`. Operatia e sincrona la boot (inainte de listen), dupa TOATE
validarile fatale de configuratie; logata JSON (`action":"rnpm_split"` + per-owner counts).

### Backup generalizat (`backend/src/db/backup.ts`)
- Parametrizare pe target; monolitul ramane un target cu comportament identic celui de azi.
- CORECTIE review Sol — snapshot-uri SELF-CONTAINED peste tot: toate backup-urile noi (daily,
  manual, pre-restore, pre-migration, pre-split) se produc cu `VACUUM INTO` (sincron, atomic,
  include tot ce e comis), NU cu copyFile dependent de WAL. Restore-ul ramane compatibil cu
  backup-urile legacy care au sidecars: se restaureaza ca BUNDLE (.db + -wal/-shm daca exista),
  iar prune/delete sterg bundle-ul intreg.
- Daily backup: itereaza monolitul + toate `rnpm/*.db` de pe disc (fara provisioning; handle
  temporar readonly `fileMustExist`); freshness PER TARGET (early-return-ul global de azi se
  elimina); retentie 4 pool-uri disjuncte (daily/pre-restore/pre-migration/manual, regex cu
  prefix escapat) per target; snapshot-urile ruleaza sub `withMaintenanceWrite`, dar hook-urile
  OFFSITE ruleaza DUPA eliberarea lock-ului (altfel N useri x 10 min timeout blocheaza scrierile).
  Promise-ul backup-ului in curs e asteptat cu timeout in `gracefulShutdown`.
- Restore per user: `withMaintenanceWrite` -> `beginRnpmRestore` (SEARCH_ACTIVE daca are cautare)
  -> validare nume (regex + `path.resolve` in jail) -> validare VERSIUNE de schema a backup-ului
  (backup dintr-o versiune mai noua => reject clar, altfel anti-downgrade-ul runner-ului blocheaza
  fisierul) -> snapshot pre-restore VERIFICAT prin `VACUUM INTO` -> close handle -> unlink sidecars
  (doar ENOENT tolerat) -> copy bundle + rename atomic -> `integrity_check` -> auto-revert prin
  `.revert-tmp` + rename (nu copyFile direct peste fisierul viu) -> reopen lazy.
- Backup manual: `VACUUM INTO`, nume `rnpm.manual-<stamp>.db`, pool propriu (5); pentru un user
  fara fisier inca, create provisioneaza intai baza goala (decizie explicita); ruta are cooldown
  60s per owner (429 + Retry-After — snapshotul tine maintenance lock-ul si declanseaza offsite).

### Garduri de concurenta (extinse dupa review)
Registry in-proces in DB layer (`backend/src/db/rnpmActivity.ts`), cu erori tipate cu cod masina:
- Restore cu search activ => 409 `SEARCH_ACTIVE`; search pornit in timpul restore-ului => 409
  `RESTORE_IN_PROGRESS`. Gardul de search e verificat IN RUTA, inainte de a porni stream-ul SSE
  (dupa start, 200 e deja trimis).
- Latch-ul de restore e consultat si de `getRnpmDb` (acopera toate operatiile repository, nu doar
  search) si mapat central la 409 in error handler.
- `DELETE /saved/all` si `POST /saved/delete-batch` refuza cu 409 `SEARCH_ACTIVE` cand ownerul are
  o cautare in zbor (altfel FK errors / repopulare imediat dupa stergere).
- Restore si daily backup se serializeaza natural (ambele sub acelasi `withMaintenanceWrite`).

### Schimbare de contract API (asumata explicit)
Id-urile de search/aviz NU mai sunt unice global, ci per fisier user. `getSearchOwnership`
(searchRepository.ts:97-104) pierde starea `foreign` => ramane owned/missing; branch-ul 403
"search-ul altui user" din `executeSearch` (rnpmSearchService.ts:118-128) dispare (documentat;
garda de tenant devine izolarea fizica insasi). Testele `rnpm.owner-isolation` se rescriu
semantic (izolarea prin fisier, nu prin WHERE owner_id). `audit_log.target_id` ramane
interpretabil doar impreuna cu `owner_id` (coloana exista deja pe audit).

### Rute API (`backend/src/routes/rnpm.ts`)
- `GET /api/rnpm/backups` — lista DOAR jail-ul callerului (`backups/rnpm/<ownerId>/`); admin poate cere `?ownerId=`.
- `POST /api/rnpm/backups/create` — NOU: backup manual on-demand al fisierului propriu; audit `backup.rnpm.create`.
- `POST /api/rnpm/backups/restore` — self-service pe fisierul PROPRIU (admin poate tinti alt owner); guard-uri: jail pe director (regex nume fara separatoare + verificare `path.resolve` in jail), fara upload, gard SEARCH_ACTIVE, `recordAudit` pastrat, `limitSmall`. CORECTIE (review-panel 2026-07-10): `requireDesktopHeader` RAMANE pe toate rutele mutante rnpm-backup — in desktop mode header-ul custom e apararea CSRF (forteaza preflight CORS spre 127.0.0.1), iar in web mode middleware-ul e pass-through complet, deci self-service-ul web functioneaza nemodificat. Self-service = guard `requireRole("admin", "user")` in loc de admin-only.
- `DELETE /api/rnpm/backups` — sterge doar jail-ul propriu.
- `GET /stats`, `POST /compact`, `DELETE /saved/all` — opereaza pe fisierul RNPM al callerului (compactDb per handle; rnpm.ts:835/902).
- `open-db-folder`/`open-backups-folder` — raman desktop-only, pointate pe fisierul/jail-ul userului local.
- NOU `backend/src/routes/adminBackups.ts` (mount `/api/admin/backups`, `requireRole("admin")`): list/restore/delete pentru MONOLIT + `POST /create` (backup manual on-demand al monolitului — azi nu exista deloc; pool de retentie propriu `manual`, ca backup-urile manuale sa nu evacueze daily-urile). Mutate din namespace-ul rnpm; pe desktop restore pastreaza `requireDesktopHeader` ca azi. Rutele vechi de monolit din rnpm.ts se elimina (breaking intern acceptat — UI-ul e singurul consumator).

### UI
- Zona RNPM ("Info baza locala" -> devine "Baza mea RNPM"): stats pe fisierul propriu, lista backup-uri proprii, "Creeaza backup acum", "Restaureaza" (copy: "doar datele TALE RNPM"), "Compacteaza", "Sterge backup-urile mele". `RnpmSavedStats.tsx` + `RnpmRestoreModal.tsx` + `rnpmApi.ts`.
- Setari -> tab/sectiune noua admin-only "Backup baza de date" (pattern `embedded` existent pe paginile admin): lista backup-urilor monolitului (nume, data, dimensiune), buton "Creeaza backup acum" (manual), restore cu copy explicit "backup COMPLET al bazei — toate modulele, toti userii (datele RNPM au backup separat per utilizator)" + confirmare destructiva; backup-ul automat (boot + 24h) ramane neschimbat.
- Enums/mesaje noi traduse prin helper `frontend/src/lib/` conform conventiei (fara raw tokens in DOM).

### Ce NU intra in v1 (explicit out of scope)
- Restore sub-modul / per-aviz (primitivele ATTACH din varianta A raman viitor posibil, aplicate pe fisierul per-user).
- DROP-ul tabelelor `rnpm_*` din monolit (release ulterior, dupa ce split-ul se dovedeste stabil).
- Lock per-fisier (RWLock ramane global), replicare continua/Litestream, schimbari de RPO.
- Migrarea rutelor de monolit spre envelope nou dincolo de mutarea in `/api/admin/backups`.

## Etape de implementare (fiecare commit trece gate-urile 0.3: biome + tsc + build + teste)

Ordinea REVIZUITA dupa review-ul Sol (splitter-ul se construieste inainte de rutare; cutover-ul e
un singur commit — altfel exista o fereastra in care scrierile noi si datele legacy traiesc in
layout-uri diferite). Planul executabil: `docs/superpowers/plans/2026-07-10-rnpm-split-per-user.md` (Rev. 3).

1. **Baseline migrations-rnpm** + test de echivalenta structurala cu monolitul (anti-drift).
2. **DB layer**: `rnpmActivity.ts` (registry activitate + erori tipate) + `rnpmDb.ts` (registry
   handle-uri, stem collision-safe, latch restore, provisioning lazy, openRnpmDbRaw).
3. **Splitter** (modul + teste cu failpoints, NEMONTAT): marker durabil, preflights, backup strict.
4. **CUTOVER atomic**: rutare repos + `getSearchOwnership` owned/missing + wiring splitter la boot
   + adaptarea testelor de izolare — UN SINGUR commit.
5. **Bracketing + garduri pre-SSE**: begin/end search in service, gard RESTORE_IN_PROGRESS in rute
   inainte de SSE, mapare centrala 409.
6. **Backup multi-target**: VACUUM INTO peste tot, restore bundle-aware + validare versiune,
   freshness per target, offsite in afara lock-ului, await la shutdown, full-flow test.
7. **Rute + guard-uri**: self-service owner-scoped cu cooldown pe create + erori de validare 400
   + `/api/admin/backups` (monolit) + gard SEARCH_ACTIVE pe delete-all/delete-batch.
8. **UI**: panoul "Baza mea RNPM" + sectiunea Setari admin "Backup baza de date" + copy romana + teste.
9. **Docs + release**: RUNBOOK (split, marker, "monolit restaurat dupa split", recuperare per user,
   igiena fisiere orfane, offsite N+1), SECURITY.md, DEPLOY-SERVER.md, CLAUDE.md, bump v2.43.0.
10. **Verificare finala**: gate-uri complete + smoke pe bundle (dist-backend) + smoke desktop cu
   split real + smoke web cu doi useri.

## Verificare end-to-end

- **Gate complet**: `npm run check` (biome + typecheck + backend + frontend + scripts) si `npm run build` verzi la fiecare commit; `npm run rebuild:electron` dupa testele Node (better-sqlite3).
- **Smoke desktop (Electron real)**: boot pe un DB v2.42 cu date RNPM => split-ul ruleaza o data, datele RNPM identice (COUNT + spot-check avize), fisier `rnpm/local.db` prezent, monolitul fara randuri rnpm; cautare RNPM noua OK; backup manual + restore propriu OK; restore refuzat cu search activ (409); repornire = splitter nu re-ruleaza.
- **Smoke web (dev-web-local.ps1 din pwsh 7, doi useri)**: userul A isi restaureaza fisierul fara ca userul B sa piarda ceva; A nu vede/nu poate restaura backup-urile lui B (jail); monolitul (fx_rates, monitoring, users) neatins de restore-ul RNPM; sectiunea Setari admin functioneaza; daily backup produce monolit + fisiere per user.
- **Teste noi obligatorii**: splitter (fidelitate/idempotenta), jail traversal, race guard, provisioning lazy, backup/restore per target, anti-drift (nicio tabela `rnpm_*` noua nefolosita de splitter/backup fara decizie explicita).
