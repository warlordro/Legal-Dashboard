# Fixuri post-review adversarial — rnpm-split (v2.43.0, pre-merge) — Rev. 2

> **Pentru agentul executant:** planul consolideaza findings-urile din DOUA review-uri
> adversariale independente pe delta `aac59da..89986ff`: Codex GPT-5.6 Sol (0 CRITICAL,
> 5 HIGH, 6 MEDIUM, 2 LOW) si review-panel (Opus 4.8 + Kimi K2.7). Rev. 2 incorporeaza
> si review-ul PANELULUI PE PLAN (Opus + Kimi + GLM + DeepSeek, sinteza Fable):
> latch-ul monolit fara self-block, cod de eroare numit pentru shutdown, compact
> re-escaladat (VACUUM pe handle viu confirmat), asarUnpack pentru worker, manifest
> optional pe done, regex preSplit explicit, cooldown cu refund. Toate findings-urile
> au fost REVERIFICATE pe cod. TDD strict, gate-uri complete inainte de fiecare commit,
> `git add` doar pe fisiere enumerate.

**Goal:** branch-ul `feat/v2.43.0-rnpm-split` devine merge-ready: restore atomic si
serializat, marker fail-closed, boot/shutdown fara ferestre de rupere, 409/503 corecte,
event loop-ul nu mai e blocabil de operatii VACUUM self-service.

## Constrangeri globale (identice cu planul sprintului)

- Limba UI/mesaje: romana FARA diacritice in cod sursa.
- Erori HTTP: envelope-ul standard `fail(code, message, c)`.
- SQL raw DOAR in `backend/src/db/**`.
- Backend bundlat CJS (esbuild) — fara `import.meta.url`; pattern `typeof __dirname`.
- Gate-uri inainte de fiecare commit: biome pe fisierele atinse (re-stage), tsc
  backend (+frontend daca e atins), `npm run build`, `npm run test:backend`
  (+frontend daca e atins).
- Branch: `feat/v2.43.0-rnpm-split`. NU push fara cerere explicita.
- Commit-uri CONSOLIDATE: 3 commit-uri, la finalul T3 (A), T6 (B), T8 (C).
- Dupa teste Node pe better-sqlite3: `npm run rebuild:electron` inainte de smoke Electron.
- Numerele de linie sunt ORIENTATIVE — localizeaza dupa simbol/continut.

---

### Task 1: Restore atomic prin staging (Codex HIGH-1 + panel M5 + Codex M2, LOW rename)

**Files:** `backend/src/db/backup.ts`, `backend/src/db/rnpmBackup.test.ts`, `backend/src/db/backup.test.ts`

Problema (confirmata): in `restoreTargetImpl`, sidecar-urile bundle-ului legacy se
copiaza DUPA rename-ul fisierului principal; un esec de copiere (ENOSPC/EPERM/shutdown)
arunca INAINTE de integrity/auto-revert, cu baza live deja inlocuita si fara WAL-ul
necheckpointat. Catch-ul curata un `tmpPath` deja renamed. Auto-revert-ul redenumeste
DB-ul original INAINTE sa stearga sidecar-urile straine. Rename-ul principal nu are
retry EPERM/EBUSY.

- [ ] **1.1 (red): teste fault-injection** (spy pe `fsPromises.copyFile`/`rename` care
  arunca la al N-lea apel) — ATENTIE la noua semantica de staging (fix panel):
  - esec ORIUNDE in faza de staging (copiere bundle / integrity / checkpoint) =>
    fisierul live BYTE-IDENTIC, directorul de staging CURATAT, pre-restore snapshot-ul
    ramane in jail (e creat inainte si e inofensiv);
  - esec la RENAME-ul de publicare => fisierul live e INCA cel vechi si valid
    (staged-ul nu l-a atins), staging curatat — NU se asteapta auto-revert aici
    (semantica noua: inainte de publish nu exista nimic de revertit);
  - esec la POST-PUBLISH probe (integrity pe dbPath, injectat) => auto-revert:
    fisierul original inapoi si ZERO sidecars straine langa el;
  - happy path legacy-bundle: randul din WAL supravietuieste (testul existent, dar
    bundle-ul forjat primeste `_schema_versions` — vezi 1.4);
  - rename-ul de publicare reincearca pe EPERM tranzitoriu (spy esueaza o data);
  - staging orfan de la un crash anterior (`<dbPath>.restore-staging/` pre-existent
    cu gunoi) e curatat inainte de refolosire.
- [ ] **1.2 (green): rescrie secventa din `restoreTargetImpl`:**
  1. Curata staging-ul orfan: `fs.rm(stagingDir, { recursive, force })`.
  2. STAGING: `mkdir <dbPath>.restore-staging/`; copiaza `.db` + sidecars EXISTENTE
     ale backup-ului in staging (`staged.db`, `staged.db-wal`, `staged.db-shm`);
     deschide STAGED cu conexiune rw temporara: `PRAGMA integrity_check` +
     `PRAGMA wal_checkpoint(TRUNCATE)`; close; apoi `unlinkStrict` pe
     `staged.db-wal`/`-shm` (dupa checkpoint+close raman doar daca ceva e anormal —
     fail-closed daca unlink-ul pica pe non-ENOENT). Staged = UN SINGUR fisier
     self-contained. Orice esec => rm staging, live NEATINS, throw.
  3. Pre-restore snapshot (ramane ca acum, INAINTE de orice mutare a live-ului),
     `closeLive()`, unlink sidecars live (fail-closed),
     `renameWithRetryAsync(stagedMain, dbPath)` — UN SINGUR rename atomic.
  4. Post-publish probe (integrity pe dbPath, conexiune raw — NU getDb). La esec,
     auto-revert REORDONAT: intai `unlinkStrict` pe sidecars (throw pe non-ENOENT),
     APOI copy revert-tmp + `renameWithRetryAsync` peste dbPath.
  5. `fs.rm(stagingDir)` in finally (best-effort).
  - Nota de cod: necesarul de disc la varf = sursa + staged + pre-restore snapshot
    simultan; esecul de spatiu pica in faza de staging cu live-ul neatins (safe).
- [ ] **1.3:** sterge copierea sidecars post-rename + catch-ul pe `tmpPath` mort.
- [ ] **1.4 (red+green): validare structurala la restore RNPM (Codex M2):**
  `assertRnpmBackupVersionCompatible` devine FAIL-CLOSED pentru jail-ul rnpm: lipsa
  `_schema_versions` => `BackupValidationError` (400) — jail-urile exista doar din
  v2.43.0, toate backup-urile lor au tracking. Monolitul pastreaza acceptarea legacy.
  Test: bundle rnpm forjat fara `_schema_versions` => 400; testul legacy-bundle
  existent forjeaza si `_schema_versions` (version=1).

### Task 2: Serializare + retentie + cooldown (Codex H3, H4, M5, L1 + panel pool preSplit)

**Files:** `backend/src/db/backup.ts`, `backend/src/db/rnpmSplitter.ts`, `backend/src/routes/rnpm.ts`, testele lor

Confirmate: `deleteAllBackupsInDir` nu e sub `withMaintenanceWrite`; `restoreTargetImpl`
nu apeleaza `pruneOld`; `legal-dashboard.pre-rnpm-split-*` cade in pool-ul
`preMigration` si sorteaza lexicografic DUPA `pre-schema-upgrade-*` (evacuat primul);
crash-loop la split creeaza backup pre-split la fiecare boot fara prune;
`resolveBackupOwner` cu ownerId invalid de la admin => 500 pe GET/DELETE.

- [ ] **2.1 (red):** teste:
  - (a) `deleteRnpmBackups` lansat in timpul unui `restoreRnpmFromBackup` in curs NU
    sterge sursa/pre-restore-ul (serializare; test cu `withMaintenanceWrite` tinut
    deschis manual) + ACELASI test pentru `deleteAllBackups` (monolit — cerut de panel);
  - (b) 6 restore-uri consecutive => exact 5 snapshot-uri `rnpm.pre-restore-*`;
  - (c) pool `preSplit`: seed 4 `pre-rnpm-split-*` + 6 `pre-schema-upgrade-*` =>
    prune pastreaza 3 split + 5 schema-upgrade; pool-urile NU se fura reciproc
    (fisierul de split NU e numarat si in preMigration);
  - (d) crash-loop split (failpoint dupa backup_ok, 5 iteratii) => cel mult 3
    backup-uri pre-split pe disc;
  - (e) cooldown cu REFUND (fix panel — pastreaza anti-double-submit): doua create-uri
    cvasi-simultane => al doilea 429; un create ESUAT nu lasa cooldown-ul consumat
    (al treilea request dupa esec reuseste imediat);
  - (f) admin `?ownerId=../x` pe GET/DELETE backups => 400 `INVALID_PARAMS`.
- [ ] **2.2 (green):**
  - `deleteAllBackups`/`deleteRnpmBackups` impachetate in `withMaintenanceWrite`;
  - `pruneOld(t.dir, t.prefix)` la finalul `restoreTargetImpl` (sub acelasi lock);
  - pool `preSplit` EXPLICIT in `poolRegexes` cu excludere in regex, nu doar ordinea
    clasificarii (fix panel): `preMigration: ^<prefix>pre-(?!restore-|rnpm-split-)[^\\/]+\.db$`
    si `preSplit: ^<prefix>pre-rnpm-split-[^\\/]+\.db$`, `PRE_SPLIT_RETAIN = 3`;
  - `preSplitBackupStrict` apeleaza prune-ul pool-ului preSplit dupa verificare;
  - cooldown-ul din `/backups/create` ramane setat LA START (anti-double-submit),
    dar se REFUNDEAZA (`delete` din map) in catch la esec (fix panel — inlocuieste
    "set dupa succes" din Rev. 1, care redeschidea fereastra de dubla-trimitere);
  - `resolveBackupOwner` arunca `BackupValidationError`; GET/DELETE o mapeaza la 400.
- [ ] **2.3:** decizie documentata in cod: restore-ul NU primeste cooldown separat
  (prune-ul inchide cresterea discului; raman rate-limit-urile globale).
- [ ] Nota: fault-injection pe `preSplitBackupStrict` (abort cu monolit intact) EXISTA
  deja in rnpmSplitter.test.ts ("backup-ul pre-split esueaza") — nu se dubleaza.

### Task 3: Marker fail-closed + manifest (Codex H5) — COMMIT A la final

**Files:** `backend/src/db/rnpmSplitter.ts`, `backend/src/db/rnpmSplitter.test.ts`, `RUNBOOK.md`

Confirmat: `readMarker` casteaza fara validare; status necunoscut cade pe fluxul de
split normal (poate suprascrie fisiere per-user mai noi); resume-ul `wiping` nu
reverifica fisierele per-user.

- [ ] **3.1 (red):** teste: (a) marker JSON valid cu status necunoscut
  (`{"status":"finished"}`) => boot ABORT cu mesaj RUNBOOK, fisierele per-user
  neatinse; (b) marker `wiping` + un fisier per-user sters => ABORT, monolit NEGOLIT;
  (c) marker `wiping` + fisier per-user corupt (trunchiat) => ABORT; (d) marker
  `wiping` + count nepotrivit cu manifestul => ABORT; (e) marker `wiping` valid =>
  resume ok (regresie); (f) marker `done` FARA manifest (forma fresh-install) =>
  acceptat (regresie — manifestul e cerut DOAR pe calea wiping); (g) owners cu
  ownerId invalid => ABORT.
- [ ] **3.2 (green):** validare runtime stricta in `readMarker`: `status` in
  {"wiping","done"}, `owners` array de ownerId valide (assertValidOwnerId), campuri
  necunoscute tolerate; orice abatere => throw fail-closed cu mesaj RUNBOOK.
  **Manifestul e OPTIONAL pe `done` si OBLIGATORIU doar pe calea de resume `wiping`**
  (fix panel — altfel marker-ele done fresh-install ar termina boot-ul pe veci):
  marker-ul `wiping` scris de split include `manifest: { [owner]: { [tabela]: count } }`
  populat la faza de copiere; count-ul pentru `rnpm_bunuri_descrieri` foloseste
  EXACT `countSql`-ul splitter-ului (subsetul WHERE EXISTS, nu COUNT(*) global —
  fix panel). Resume-ul `wiping` verifica per owner: fisier existent +
  `PRAGMA integrity_check` + count-urile == manifest; abatere => ABORT inainte de wipe;
  marker `wiping` fara manifest => ABORT (nu exista in productie; RUNBOOK primeste
  o linie pentru mediile dev cu marker pre-fix: sterge `.split-done.json` + re-split).
- [ ] **3.3: gate-uri + COMMIT A** (`fix(rnpm-split): restore atomic prin staging,
  serializare + retentie backup, marker fail-closed cu manifest`).

### Task 4: Ordinea de boot + acoperirea shutdown-ului (Codex M1, M3 + panel)

**Files:** `backend/src/index.ts`, `backend/src/db/backup.ts`, `backend/src/util/appErrorHandler.ts`, `backend/src/index.test.ts`, `backend/src/db/backup.test.ts`

Confirmate: in web mode `getMasterKey()` ruleaza DUPA splitter (secret lipsa =>
monolit deja golit la abort); `waitForBackupToSettle` urmareste doar daily-ul;
esecul `getDb()` din splitter e raportat "rnpm split failed".

- [ ] **4.1 (red):** teste: (a) index.test: web mode fara `TENANT_KEY_ENCRYPTION_SECRET`
  + monolit cu randuri rnpm => boot pica INAINTE de golirea monolitului si fara
  fisiere per-user create; (b) backup.test: un `restoreRnpmFromBackup` in zbor e
  asteptat de `waitForBackupToSettle`; (c) dupa flag-ul de shutdown, un
  `withMaintenanceWrite` NOU arunca eroarea tipata cu `code: "MAINTENANCE_SHUTDOWN"`
  iar o ruta care o loveste raspunde 503 prin handlerul central; (d) un writer aflat
  DEJA in asteptare pe lock cand se seteaza flag-ul isi termina treaba si e prins de
  settle-set (nu e abandonat).
- [ ] **4.2 (green):**
  - `index.ts`: gate-ul de master key (getMasterKey + round-trip probe, web-only)
    mutat intr-un bloc `fatalBoot` DEDICAT INAINTE de `runRnpmSplitIfNeeded()`;
    `getDb()` explicit intr-un try cu `fatalBoot("schema init failed")` inainte de
    splitter (atributie corecta);
  - `backup.ts`: settle-set la nivel de modul; **flag-ul `maintenanceShuttingDown` se
    verifica INAINTE de `maintenanceLock.withWrite` (fix panel — writer preference:
    un writer refuzat in interiorul callback-ului ar fi blocat deja reader-ii), iar
    promise-ul inregistrat in settle-set e CEL returnat de withWrite (include timpul
    de asteptare pe lock)**; eroarea tipata: clasa cu `code = "MAINTENANCE_SHUTDOWN"`;
  - `appErrorHandler.ts`: mapare `MAINTENANCE_SHUTDOWN` => 503 (+ `Retry-After`);
  - `waitForBackupToSettle` asteapta TOT set-ul, plafon 30s la shutdown;
  - Note documentate in cod: offsite hook-urile ruleaza in afara lock-ului si NU sunt
    in settle-set (best-effort la shutdown); reader-ii (`withMaintenanceRead`,
    scheduler) raman pe drain-ul HTTP existent; intre commit B si C settle-cap-ul de
    30s poate fi inca depasit de VACUUM-ul sincron multi-target — fereastra EXISTENTA
    si azi (10s), inchisa complet de Task 7.
- [ ] **4.3:** audit pe rnpm.ts + adminBackups.ts: TOATE catch-urile generice care pot
  inghiti erori tipate primesc rethrow pe `code` in
  {"RESTORE_IN_PROGRESS","SEARCH_ACTIVE","MAINTENANCE_SHUTDOWN"} (fix panel — altfel
  503-ul de la 4.2 e inaccesibil din rutele cu try/catch; se face IMPREUNA cu Task 5.2).

### Task 5: 409 corect pe /compact + paritate monolit la restore (Codex M4 + panel M6, cu fixul de self-block)

**Files:** `backend/src/routes/rnpm.ts`, `backend/src/db/backup.ts`, `backend/src/db/schema.ts`, `backend/src/routes/adminBackups.ts`, teste

Confirmate: catch-ul din `/compact` mapeaza erorile tipate la 500; restore-ul
monolitului nu are latch pe `getDb()` si nici validare de versiune.

- [ ] **5.1 (red):** teste: (a) `POST /compact` cu restore RNPM activ => 409 (nu 500);
  (b) in timpul unui `restoreFromBackup` (monolit), `getDb()` arunca eroarea tipata
  cu `code: "RESTORE_IN_PROGRESS"` (failpoint intre closeLive si publish) SI
  pre-restore snapshot-ul PROPRIU al restore-ului reuseste (anti-self-block);
  (c) o ruta NE-rnpm (`GET /api/v1/me`) in timpul restore-ului de monolit => 409
  prin handlerul central (comportament global documentat); (d) restore monolit
  dintr-un backup cu `_schema_versions` mai nou => 400.
- [ ] **5.2 (green):**
  - rethrow-urile din 4.3 (acelasi pas de implementare);
  - `schema.ts`: latch `monolithRestoreInProgress` cu set/clear EXPORTATE, verificat
    in `getDb()`; **latch-ul e setat/curatat EXCLUSIV in `restoreFromBackup`
    (backup.ts), in try/finally in interiorul `withMaintenanceWrite` — NU in
    `restoreTargetImpl` partajat (fix panel)**;
  - **anti-self-block (fix panel, cel mai important):** `openLiveForSnapshot` al
    monolitului NU mai foloseste `getDb()` — deschide conexiune raw
    `new Database(getDbPath(), { readonly: true, fileMustExist: true })` cu
    `close: true` (oglinda `openRnpmDbRaw`); TOATE accesele din fereastra latch-ului
    (pre-restore snapshot, post-publish probe) folosesc conexiuni raw — post-publish
    probe-ul deja o face (`new Database(dbPath)`), se verifica si se comenteaza;
  - comentariu + docs: restore-ul de monolit inseamna INDISPONIBILITATE GLOBALA
    temporara (toate rutele 409) — acceptat, fereastra e scurta si admin-triggered;
  - `backup.ts`: validare versiune monolit (MAX(version) vs
    `discoverMigrations(MIGRATIONS_DIR)`) => 400; lipsa tabelei ramane ACCEPTATA la
    monolit (backup-uri legacy reale).

### Task 6: Igiena web-mode + docs (panel LOW + Codex M6 PLAUSIBLE) — COMMIT B la final

**Files:** `backend/src/index.ts`, `backend/src/routes/rnpm.ts`, `DEPLOY-SERVER.md`, `RUNBOOK.md`, teste

- [ ] **6.1 (red+green):** prewarm-ul rnpm (`getAvize`/`getAvizStats` pe "local")
  gate-uit pe `getAuthMode() === "desktop"` (test: boot web => nu exista
  `rnpm/local-*.db`).
- [ ] **6.2 (red+green):** `GET /stats` si `POST /compact` verifica
  `fs.existsSync(getRnpmDbPath(owner))` LA NIVEL DE RUTA, INAINTE de orice apel de
  repository (fix panel — `getAvizStats` provisioneaza prin `getRnpmDb` daca e
  apelat): stats => zerouri + `sizeBytes: 0` fara creare de fisier; compact => 404
  `NOT_FOUND`. Teste: user nou face GET /stats si POST /compact => fisierul NU apare
  pe disc.
- [ ] **6.3:** boot warn in web mode cand `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` e gol
  (JSON structurat) + paragraf DEPLOY-SERVER.md si RUNBOOK.md despre dependinta CSRF
  de configurarea proxy-ului (finding PLAUSIBLE — tratat operational).
- [ ] **6.4: gate-uri + COMMIT B** (`fix(rnpm-split): gate master-key inainte de split,
  shutdown acopera maintenance write-urile (503), latch+versiune la restore monolit,
  409 pe compact, igiena web-mode`).

### Task 7: VACUUM/VACUUM INTO in afara thread-ului principal (Codex H2 + panel H1; compact RE-ESCALADAT)

**Files:** `backend/src/util/snapshot-worker.cjs` (NOU, JS pur), `backend/src/util/snapshotRunner.ts` (NOU), `backend/src/db/backup.ts`, `backend/src/db/rnpmDb.ts`, `backend/src/db/schema.ts` (audit compactDb), `backend/src/routes/rnpm.ts`, `scripts/build.js`, `package.json` (asarUnpack), teste

Confirmate: VACUUM/VACUUM INTO sincrone pe thread-ul Node; IN PLUS (panel, confirmat
pe cod): `compactRnpmDb` face `VACUUM` PE HANDLE-UL VIU din registry si `/compact` nu
e sub `withMaintenanceWrite` — un VACUUM din worker pe acelasi fisier cu handle-ul viu
deschis ar da SQLITE_BUSY intermitent.

- [ ] **7.1: design (puncte fixe):**
  - worker CJS PUR (`snapshot-worker.cjs`, fara TS): `{ op: "vacuum_into", srcPath,
    destPath }` — conexiune readonly proprie; raspunde `{ ok }` / `{ error }`;
  - `snapshotRunner.ts`: `runSnapshotOp(...)` cu `new Worker(workerPath)`, timeout
    hard 10 min cu `await worker.terminate()` in TOATE caile de esec/timeout (fix
    panel — altfel workerii blocati se acumuleaza), fallback SINCRON cu warn
    structurat `snapshot.worker_fallback` daca worker-ul nu porneste;
  - **rezolutia path-ului in Electron impachetat (fix panel):** workerPath calculat cu
    `__dirname` + inlocuire `app.asar` -> `app.asar.unpacked` cand path-ul contine
    asar; `package.json` build.asarUnpack primeste `"dist-backend/snapshot-worker.cjs"`;
    `scripts/build.js` copiaza fisierul in `dist-backend/` (whitelist explicit);
  - **compact prin worker = INCHIDE handle-ul intai (fix panel, re-escaladat):**
    `/compact` intra sub `withMaintenanceWrite` -> gard SEARCH_ACTIVE (nu compacta sub
    o cautare in zbor) -> `closeRnpmDb(ownerId)` -> worker `vacuum_into` spre
    `<dbPath>.compact-tmp` -> verify (size>0 + integrity) -> unlink sidecars live ->
    `renameWithRetryAsync(tmp, dbPath)` -> reopen lazy la urmatorul getRnpmDb. Fara
    op "vacuum" pe fisier viu — se ELIMINA din design (VACUUM INTO + swap e echivalent
    functional si evita SQLITE_BUSY);
  - splitter-ul si pre-migration backup-urile de BOOT raman SINCRONE deliberat
    (ruleaza inainte de serve; comentariu explicit).
- [ ] **7.2 (red):** teste: (a) snapshot prin runner identic functional cu varianta
  sincrona (count + integrity); (b) compact prin worker scade dimensiunea si datele
  raman intacte; (c) worker mort / op invalid / fisier lipsa => promise rejected cu
  mesaj + NICIUN handle orfan (rm pe tmpdir merge) + worker terminat; (d) event loop
  responsiv in timpul unui VACUUM INTO mare (DB seedat ~50MB; tick-uri fara gauri
  >1s; `it.skipIf` pe CI daca e fragil); (e) **shutdown in timpul unui snapshot in
  worker: `waitForBackupToSettle` asteapta finalizarea worker-ului (fix panel —
  promise-ul din settle-set trebuie sa acopere await-ul worker-ului IN INTERIORUL
  lock-ului, nu sa se rezolve inainte)**.
- [ ] **7.3 (green): enumerarea COMPLETA a call-site-urilor convertite (fix panel):**
  - `snapshotViaVacuumInto` -> varianta async prin runner in: `restoreTargetImpl`
    (pre-restore snapshot — RE-ATINGE codul din commit A, cuplaj asumat),
    `createManualBackupForTarget`, `createRnpmManualBackup`, `dailyBackupTarget`;
  - `compactRnpmDb` -> `compactRnpmDbViaWorker` (nou in backup.ts sau rnpmDb.ts) —
    consumatori: `POST /compact` si `DELETE /saved/all` (ambele devin await);
  - `compactDb` din schema.ts: audit consumatori — daca a ramas fara caller dupa
    cutover, se marcheaza deprecated cu comentariu (NU se sterge — schimbare
    chirurgicala); daca mai are calleri, raman pe sync doar cei de boot;
  - splitter/pre-migration: neatinse (sync, boot).
- [ ] **7.4:** decizie documentata: fara coada globala de concurenta in acest batch
  (maintenance lock-ul serializeaza deja write-urile grele); reevaluare la load-test.

### Task 8: Teste anti-drift intarite + verificare finala + docs — COMMIT C la final

**Files:** `backend/src/db/rnpmDb.test.ts`, `CHANGELOG.md`, `SESSION-HANDOFF.md`, `RUNBOOK.md`

- [ ] **8.1 (Codex L2):** testul de echivalenta compara si DEFINITIILE: SQL normalizat
  din `sqlite_master` pentru indexuri + triggere si `PRAGMA index_xinfo` per index
  (inclusiv autoindexurile UNIQUE).
- [ ] **8.2:** `npm run check` de la zero + `npm run build`; `npm run rebuild:electron`;
  smoke pe bundle (boot + split pe copie + restore + compact prin worker) —
  reconfirmare dupa staging/worker; nota: verificarea worker-ului in Electron
  IMPACHETAT (asar) ramane pe checklist-ul de release (smoke-ul dev nu trece prin asar).
- [ ] **8.3:** CHANGELOG.md: sub-sectiune "Fixuri post-review adversarial (pre-merge)"
  in intrarea v2.43.0 (fara bump); SESSION-HANDOFF.md actualizat; RUNBOOK: linia
  pentru marker dev pre-fix (Task 3). **COMMIT C** (`fix(rnpm-split): VACUUM in worker
  thread cu compact prin swap, anti-drift pe definitii, changelog post-review`).

---

## Findings RESPINSE cu dovezi (nu se implementeaza)

1. **Panel/Kimi "VACUUM INTO pica pe conexiuni readonly"** — fals; SQLite >= 3.27 il
   suporta explicit (respins si de sinteza panelului; exersat in smoke real).
2. **Panel "bracketing-ul search lipseste" (unverified)** — fals; wrapper-ele din
   `rnpmSearchService.ts` fac begin/end in try/finally, cu teste dedicate.
   Reviewer-ii nu primisera fisierul serviciului.
3. **Panel "lastBackupCreateByOwner creste nelimitat"** — fals;
   `pruneExpiredBackupCooldowns` ruleaza la fiecare create.
4. **Rev. 1 "cooldown set dupa succes"** — respins de panelul pe plan (redeschidea
   fereastra de double-submit); inlocuit cu set-la-start + refund pe eroare (Task 2.2).
5. **DeepSeek "formularea Task 1 poate fi citita ca operare pe fisiere live"** —
   clarificare de text, nu defect; sursa e backup-ul static (formulare intarita in 1.2).
6. **Codex "smoke web cu 2 useri JWT"** — ramane verificarea manuala pre-merge din
   handoff (dev-web-local), nu task de cod.

## Acceptate ca limitari documentate (fara cod nou in acest batch)

- **CSRF pe proxy gresit configurat (Codex M6 PLAUSIBLE):** warn la boot + docs
  (Task 6.3); guard Origin/Host in web mode se decide la cutover-ul web real.
- **Coada globala de concurenta:** amanata (Task 7.4).
- **Restore fara cooldown dedicat:** decizie explicita (Task 2.3).
- **Restore monolit = indisponibilitate globala temporara (409 pe toate rutele):**
  acceptat si documentat (Task 5.2) — fereastra scurta, admin-triggered.
- **Fereastra settle 30s intre commit B si C:** exista si azi (10s); inchisa de Task 7.

## Istoric review

- **Rev. 1:** consolidarea celor doua review-uri adversariale pe delta sprintului.
- **Rev. 2 (acest fisier):** incorporeaza review-ul panelului PE PLAN (Opus + Kimi +
  GLM + DeepSeek, sinteza Fable): HIGH — anti-self-block pe latch-ul monolit
  (openLiveForSnapshot raw readonly; latch doar in restoreFromBackup); HIGH — cod de
  eroare numit MAINTENANCE_SHUTDOWN + audit rethrow in rute (altfel 503 inaccesibil);
  re-escaladat — compact VACUUM pe handle viu => design nou compact-prin-swap sub
  maintenance lock; asarUnpack + rezolutie path asar pentru worker; flag shutdown
  verificat INAINTE de withWrite; manifest optional pe done / obligatoriu pe wiping;
  regex preSplit cu excludere explicita; cooldown refund-on-error; stats/compact
  existence-check la nivel de ruta; test 1.1 aliniat la semantica staging (auto-revert
  doar la post-publish); enumerarea completa a call-site-urilor sync->async in 7.3;
  teste suplimentare (delete monolit serializat, shutdown vs worker in zbor, done
  fara manifest). Respins din feedback: niciun item (toate incorporate sau mutate la
  limitari documentate).
