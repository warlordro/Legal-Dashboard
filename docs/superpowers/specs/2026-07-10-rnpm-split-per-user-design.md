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
<dataDir>/rnpm/<ownerId>.db           # per user: rnpm_searches -> rnpm_avize ->
                                      #   creditori/debitori/bunuri/istoric + rnpm_bunuri_descrieri proprie
<dataDir>/backups/                    # backup-urile monolitului (neschimbat: 7 daily / 5 pre-restore / 5 pre-migration)
<dataDir>/backups/rnpm/<ownerId>/     # jail per user: rnpm.YYYY-MM-DD.db, rnpm.pre-restore-*, rnpm.manual-*
```
`<dataDir>` = dirname(getDbPath()) — neschimbat (userData pe desktop, /data pe Docker).
`ownerId` validat `^[A-Za-z0-9_-]+$` inainte de orice folosire in path (refuz altfel).
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
- Rutare in cele 16 call-sites din `avizRepository.ts` + `searchRepository.ts`
  (`getDb()` -> `getRnpmDb(ownerId)`).

### Migrations
- Director nou `backend/src/db/migrations-rnpm/` cu `0001_rnpm_baseline.up.sql/.down.sql` =
  forma finala consolidata a tabelelor rnpm (baseline actual + index 0021 + coloane `_norm`
  si triggere din 0022). `_schema_versions` propriu per fisier user.
- Lantul monolitului 0001-0042 ramane NEATINS (nicio migration noua necesara: splitter-ul
  goleste randurile, nu schimba schema). Blocul legacy din schema.ts ramane pentru monolit.
- UDF `rnpm_norm` se inregistreaza pe ORICE handle inainte de runMigrations pe fisiere rnpm
  (triggerele din 0022 il apeleaza — gasit de verificatorul adversarial).

### Splitter one-time (fisier nou `backend/src/db/rnpmSplitter.ts`, apelat din index.ts la boot)
Conditie: monolitul are randuri in `rnpm_searches`/`rnpm_avize`. Pasi:
1. Pre-split backup al monolitului (reuse `preMigrationBackup`, label `rnpm-split`).
2. Preflight spatiu disc: varful e ~3x volumul RNPM (monolit intact + pre-split backup + fisiere noi) — abort cu mesaj clar daca nu incape.
3. Per owner distinct: provisioneaza `rnpm/<ownerId>.db` PRIN runner (vezi capcana sentinel), scrie intr-un `.tmp` + rename la final; ATTACH monolit readonly; `INSERT...SELECT` filtrat pe `owner_id` PASTRAND id-urile originale (FK `search_id`/`aviz_id`/`descriere_id` raman valide; `sqlite_sequence` se actualizeaza automat). `rnpm_bunuri_descrieri`: doar subsetul referit de bunurile ownerului, cu id-urile originale — FARA remap.
4. Verificare COUNT per tabela per owner (monolit vs fisier nou) + `integrity_check`.
5. DOAR dupa ce TOTI ownerii sunt verificati: DELETE `rnpm_*` din monolit intr-o tranzactie + VACUUM.
6. Idempotent la crash: monolitul ramane sursa de adevar pana la pasul 5; fisierele partiale `.tmp` se refac la re-run.
Desktop = un singur owner `local`. Operatia e sincrona la boot (inainte de listen); durata acceptata, logata JSON (`action":"rnpm_split"` + per-owner counts).

### Backup generalizat (`backend/src/db/backup.ts`)
- Parametrizare pe target `{ id, dbPath, backupDir, prefix, getHandle?, closeHandle }`.
  Monolitul ramane un target cu comportament identic celui de azi.
- Daily backup: itereaza monolitul + toate `rnpm/*.db` ENUMERATE DE PE DISC (nu din registry
  — altfel nightly backup declanseaza provisioning sub lock); pentru useri inactivi deschide
  un handle temporar simplu (fara migrations), `db.backup()`, close. Freshness check per target.
  Retention 7/5/5 per target. Offsite hook per fisier (env neschimbat).
- Restore per user: `withMaintenanceWrite` global (RWLock ramane UNIC — simplu si suficient la
  zeci de useri) -> gard race (vezi mai jos) -> checkpoint + close handle-ul ownerului din
  registry -> snapshot pre-restore in jail-ul lui -> unlink sidecars (throw pe non-ENOENT) ->
  copy+rename atomic -> `integrity_check` -> auto-revert la esec -> reopen lazy.
  Flux identic cu `restoreFromBackupImpl` existent, parametrizat.
- Backup manual: acelasi mecanism ca daily, nume `rnpm.manual-<stamp>.db`, pool propriu de
  retentie (5) ca sa nu evacueze daily-urile.

### Gard race restore-vs-search (gasit de verificatorul adversarial)
Registry in-proces `activeRnpmSearches: Map<ownerId, count>` incrementat/decrementat in
`executeSearch`/`executeSplitSearch` (rnpmSearchService.ts). Restore cu search activ =>
409 envelope `{ code: "SEARCH_ACTIVE" }`. Pornirea unei cautari in timpul restore-ului
propriu => 409 `RESTORE_IN_PROGRESS` (flag per owner pe durata restore-ului).
Fara asta, scrierile cautarii in-flight pica silentios pe FK dupa swap si captcha e platit degeaba.

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
- `POST /api/rnpm/backups/restore` — self-service pe fisierul PROPRIU (admin poate tinti alt owner); guard-uri: jail pe director + regex nume (fara separatoare), fara upload, gard SEARCH_ACTIVE, `recordAudit` pastrat, `limitSmall`. `requireDesktopHeader` SCOS de pe rutele rnpm-backup (self-service web e scopul; blast radius = fisierul propriu).
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

0. **Spec + plan executabil**: comite designul in `docs/superpowers/specs/2026-07-10-rnpm-split-per-user-design.md` (continutul acestui plan), apoi plan de implementare TDD detaliat via skill-ul `superpowers:writing-plans` in `docs/superpowers/plans/`.
1. **DB layer**: `rnpmDb.ts` (registry, pragmas, UDF, provisioning lazy) + `migrations-rnpm/0001` baseline consolidat + teste (provisioning, sentinel trap, UDF pe handle nou).
2. **Rutare repos**: cele 16 call-sites din `avizRepository.ts`/`searchRepository.ts` + `checkpointWal`/`compactDb` per handle + redefinirea `getSearchOwnership` (owned/missing) + adaptarea testelor de izolare (semantic).
3. **Splitter**: `rnpmSplitter.ts` + wiring in `index.ts` + teste (fidelitate COUNT, descrieri subset cu id-uri originale, idempotenta la crash, preflight disc, DB legacy).
4. **Backup multi-target**: generalizarea `backup.ts` + daily backup enumerat de pe disc + backup manual + restore per user cu gard race + `backup.test.ts` extins (cel mai greu pas — edge-case-urile existente re-verificate per target).
5. **Rute + guard-uri**: rnpm backups self-service owner-scoped + `/api/admin/backups` (monolit) + gard SEARCH_ACTIVE/RESTORE_IN_PROGRESS + audit + teste de contract (jail, 409, admin targeting).
6. **UI**: panoul "Baza mea RNPM" + sectiunea Setari admin "Backup baza de date" + copy romana + teste frontend.
7. **Docs + release**: RUNBOOK (sectiuni: split, restore per user, DR cu N+1 fisiere, offsite multi-fisier), SECURITY.md (suprafata noua self-service), DEPLOY-SERVER.md, CLAUDE.md (arhitectura: DB-uri per user RNPM), apoi checklist bump v2.43.0 din CLAUDE.md.

## Verificare end-to-end

- **Gate complet**: `npm run check` (biome + typecheck + backend + frontend + scripts) si `npm run build` verzi la fiecare commit; `npm run rebuild:electron` dupa testele Node (better-sqlite3).
- **Smoke desktop (Electron real)**: boot pe un DB v2.42 cu date RNPM => split-ul ruleaza o data, datele RNPM identice (COUNT + spot-check avize), fisier `rnpm/local.db` prezent, monolitul fara randuri rnpm; cautare RNPM noua OK; backup manual + restore propriu OK; restore refuzat cu search activ (409); repornire = splitter nu re-ruleaza.
- **Smoke web (dev-web-local.ps1 din pwsh 7, doi useri)**: userul A isi restaureaza fisierul fara ca userul B sa piarda ceva; A nu vede/nu poate restaura backup-urile lui B (jail); monolitul (fx_rates, monitoring, users) neatins de restore-ul RNPM; sectiunea Setari admin functioneaza; daily backup produce monolit + fisiere per user.
- **Teste noi obligatorii**: splitter (fidelitate/idempotenta), jail traversal, race guard, provisioning lazy, backup/restore per target, anti-drift (nicio tabela `rnpm_*` noua nefolosita de splitter/backup fara decizie explicita).
