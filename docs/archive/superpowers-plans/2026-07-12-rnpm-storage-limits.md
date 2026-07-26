# Limite de stocare RNPM per user (live 500 MB + plafon backup 500 MB) — Implementation Plan (Rev. 2)

> **Rev. 2:** review-ul adversarial Codex (2026-07-12, thread 019f57a6) a dat REJECT pe Rev. 1; corectiile acceptate sunt in sectiunea "Rev. 2 — corectii obligatorii" de la final si CASTIGA asupra textului initial. Trei decizii de produs raman la user (marcate DECIZIE-USER).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Niciun user nu poate acumula mai mult de 500 MB in baza RNPM vie (cautarile noi sunt refuzate cu mesaj clar peste limita; stergerea/exportul/compactarea raman mereu permise), iar folderul lui de backup e plafonat la 500 MB cu o podea de siguranta (cea mai recenta copie din fiecare categorie nu se sterge niciodata). Worst case per user: ~1 GB total.

**Architecture:** (1) Guard de stocare pe rutele care ADAUGA date (`/search`, `/bulk`, `/search/split`), plasat INAINTE de consumul de captcha (nu cheltuim bani pe o cerere refuzabila): masoara fisierul viu (db+wal, stat async, ENOENT=0), compara cu limita (override per user `rnpm.storage` din `user_quota_overrides`, altfel default env 500), refuza tipat -> 429 QUOTA_EXCEEDED cu cifre in envelope. (2) Plafon in bytes pe jail-ul de backup, aplicat in `pruneOld` (ruleaza deja la fiecare snapshot): dupa pool-urile pe numar, daca totalul depaseste plafonul, sterge cele mai vechi copii (cross-pool, dupa mtime) DAR pastreaza mereu cea mai recenta din fiecare pool (podeaua). (3) UI: cardul admin Stocare RNPM arata folosit/limita per user, pagina Cote primeste feature-ul nou cu unitate MB, iar eroarea 429 din zona RNPM afiseaza cifrele si actiunile posibile.

**Tech Stack:** TypeScript (Hono + React), better-sqlite3, vitest, biome.

## Global Constraints

- Romana fara diacritice in cod; copy UI in romana, fara token-uri brute in DOM (conventia quotaFeatureLabels).
- SQL raw doar in `backend/src/db/**`; masurarea FS si pruning-ul stau in `backup.ts`/modul dedicat db, nu in rute.
- Rutele de CURATARE nu se blocheaza niciodata peste limita: delete-batch, delete-all, compact, backups (create/restore/delete), export, listari — gate DOAR pe search/bulk/split.
- Stocarea limitei per user refoloseste `user_quota_overrides.limit_usd_milli` ca NUMAR DE MB (precedent: `captcha.rnpm` = count, v2.34.0). Period-ul e irelevant pentru stocare — se accepta si se ignora (conventie documentata).
- Gate pre-commit: biome -> tsc backend+frontend -> teste backend+frontend. Fara push fara confirmare. Fara bump de versiune.
- Depinde de planul de autocompact (2026-07-12-rnpm-autocompact-delete-batch.md): fara el, limita ar numara si spatiul gol din fisier. Ordinea de implementare: autocompact INTAI.

---

### Task 1 (backend): limita pe baza vie — config + guard tipat

**Files:**
- Create: `backend/src/db/rnpmStorageLimit.ts`
- Modify: `backend/src/routes/rnpm.ts` (rutele `/search` ~L204, `/bulk` ~L440, `/search/split` ~L580 — apelul guard-ului inainte de `withRnpmCaptchaGuards`)
- Modify: `backend/src/util/appErrorHandler.ts` (maparea erorii tipate -> 429 envelope, daca nu e deja acoperita de clasa generica)
- Test: `backend/src/db/rnpmStorageLimit.test.ts` + extindere `backend/src/routes/rnpm.contract.test.ts`

**Interfaces:**
- Consumes: `getOverride(ownerId, "rnpm.storage")` (userQuotaRepository, existent), `getRnpmDbPath(ownerId)`.
- Produces:
  - `readDefaultRnpmStorageMb(): number | null` — env `LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB`, nesetat => 500 (default-ul produsului), `0` sau negativ => null (NELIMITAT, kill switch documentat), invalid => 500 cu warn o data (pattern readDefaultQuotaMilli).
  - `getRnpmStorageLimitBytes(ownerId): number | null` — override-ul (MB) daca exista, altfel default-ul; null = nelimitat.
  - `class RnpmStorageLimitError extends Error { usedBytes; limitBytes }`.
  - `assertRnpmStorageWithinLimit(ownerId): Promise<void>` — stat async pe db + db-wal (ENOENT=0; alte errno se PROPAGA — fail-closed pe FS rupt ar bloca si curatarea, deci NU: erorile FS non-ENOENT se propaga ca 500, nu ca "peste limita"); arunca `RnpmStorageLimitError` cand `used > limit`.
- Raspunsul 429 (prin handlerul central sau catch in ruta): `fail(ErrorCodes.QUOTA_EXCEEDED, "Spatiul RNPM alocat este plin (X MB din Y MB). Sterge avize vechi sau cere marirea limitei.", c, { feature: "rnpm.storage", usedBytes, limitBytes })`.

- [ ] Step 1: teste rosii — unit (default env: nesetat=500, "0"=null, "abc"=500+warn; override castiga; ENOENT=0; EACCES se propaga) + contract (search peste limita => 429 cu cifre SI captcha NEconsumat — assert ca `solveRnpmCaptcha`/guard-ul de captcha nu a fost atins; search sub limita => 200; delete-batch peste limita => functioneaza normal).
- [ ] Step 2: RED -> Step 3: implementare -> Step 4: GREEN.
- [ ] Step 5: commit `feat(rnpm): limita de stocare per user pe baza vie — 429 cu cifre inainte de captcha, override rnpm.storage, curatarea ramane mereu permisa`

---

### Task 2 (backend): plafon in bytes pe jail-ul de backup, cu podea de siguranta

**Files:**
- Modify: `backend/src/db/backup.ts` (`pruneOld`, ~L339-392)
- Test: extindere `backend/src/db/rnpmBackup.test.ts` (describe nou)

**Interfaces:**
- Consumes: pool-urile existente (`poolRegexes`), `unlinkBundle` (sterge si sidecar-urile legacy).
- Produces: dupa pruning-ul pe numar, DOAR pentru jail-urile RNPM (`prefix === RNPM_PREFIX`): citeste env `LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB` (nesetat => 500; `0`/negativ => null = nelimitat; invalid => 500 + warn); daca totalul bytes al fisierelor ramase depaseste plafonul, sterge oldest-first (mtime asc, cross-pool) SARIND peste cea mai recenta copie din fiecare pool (dated/manual/pre-restore) — podeaua se pastreaza chiar daca totalul ramane peste plafon. Esecul de unlink e tolerat (logat, pattern existent).

- [ ] Step 1: teste rosii — jail cu copii peste plafon => raman sub plafon si cele mai noi din fiecare pool exista; jail in care DOAR podeaua depaseste plafonul => nu se sterge nimic; monolitul (MAIN_PREFIX) => neatins de plafon.
- [ ] Step 2: RED -> Step 3: implementare -> Step 4: GREEN.
- [ ] Step 5: commit `feat(backup): plafon 500MB pe jail-ul de backup RNPM per user — oldest-first cu podea (cea mai recenta copie din fiecare pool nu se sterge niciodata)`

---

### Task 3 (frontend): vizibilitate + mesaje cu cifre

**Files:**
- Modify: `backend/src/routes/adminRnpm.ts` (randul de usage primeste `storageLimitBytes` din aceeasi functie ca guard-ul — cifrele din UI nu au voie sa minta fata de gate)
- Modify: `frontend/src/lib/adminRnpmApi.ts` (campul nou), `frontend/src/pages/admin/RnpmStorage.tsx` (coloana Baza devine "folosit / limita", evidentiere cand >85%)
- Modify: `frontend/src/lib/quotaFeatureLabels.ts` (feature "rnpm.storage", label "Stocare RNPM (MB)", unitate MB — extinde isCountFeature/quotaLimitUnitLabel cu maparea noua), `frontend/src/pages/admin/Quota.tsx` doar daca enum-ul nu se propaga automat
- Modify: componenta de cautare RNPM care afiseaza erorile (maparea 429 cu `feature:"rnpm.storage"` -> mesajul cu cifre + indrumare spre stergere)
- Test: extindere `RnpmStorage.test.tsx` + `quotaFeatureLabels.test.ts` (daca exista) + testul componentei de eroare

- [ ] Step 1: teste rosii (card cu limita afisata + evidentiere; label + unitate MB; mesajul de eroare cu cifre) -> Step 2: RED -> Step 3: implementare -> Step 4: GREEN.
- [ ] Step 5: commit `feat(ui): limita de stocare RNPM vizibila — card admin folosit/limita, feature rnpm.storage in Cote (MB), mesaj 429 cu cifre in zona RNPM`

---

### Task 4: gate final + documentare

- [ ] SESSION-HANDOFF.md: doua randuri noi in tabelul de kill switches (`LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB` — 0=nelimitat; `LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB` — 0=nelimitat) + `.env.example`/compose daca exista sectiunea de env-uri operationale.
- [ ] Gate complet: biome -> tsc backend+frontend -> `npm test --workspace=backend` -> `cd frontend && npx vitest run`.
- [ ] Commit final.

---

## Decizii (context pentru reviewer)

1. **Gate DOAR pe adaugare, niciodata pe curatare** — un user peste limita trebuie sa poata iesi singur din starea asta (delete + autocompact + backups). Blocarea curatarii ar fi deadlock de produs.
2. **Guard-ul ruleaza INAINTE de captcha** — refuzul nu costa bani si nu consuma cota de captcha.
3. **Limita masoara fisierul viu (db+wal)** — cu autocompact-ul implementat intai, fisierul reflecta datele reale; fara wal, o sesiune lunga de scrieri ar putea depasi nedetectat.
4. **Plafonul de backup e FIX (500 MB), nu legat de dimensiunea curenta a bazei** — altfel stergerea masiva din live ar sterge exact backup-urile utile pentru regret (decizie explicita user, 2026-07-12).
5. **Podeaua de siguranta bate plafonul** — un user cu baza de 450 MB pastreaza cate o copie recenta per pool chiar daca impreuna trec de 500 MB; plafonul e anti-acumulare, nu anti-siguranta.
6. **Override per user in tabela existenta** (MB in `limit_usd_milli`, precedentul captcha=count) — zero migrare de schema; period ignorat pentru stocare.
7. **Bulk-ul e gate-uit la INTRARE, nu per item** — un bulk pornit sub limita poate termina peste (itemele adauga date in timpul rularii); overshoot-ul unui singur bulk e acceptat si plafonat de dimensiunea raspunsurilor RNPM (acelasi compromis ca overshoot-ul multi-agent la cota AI, PLAN §12).
8. **0/negativ = nelimitat (kill switch semantic)** — invatatura din review-ul Codex pe planul de autocompact (nu "valoare mare = disable").

## Riscuri semnalate (de validat in review)

- **TOCTOU pe masurare**: doua cautari simultane sub limita pot impinge amandoua peste (overshoot de o cautare) — acceptat, identic cu overshoot-ul AI documentat.
- **WAL-ul poate fi mare tranzitoriu** intre checkpoint-uri — limita l-ar putea "vedea" si refuza prematur; marja default generoasa (500 MB) absoarbe; semnalat, fara mitigare dedicata.
- **Userii existenti peste limita la deploy** (ex. cei de test cu 200 MB pe fisiere necompactate): nu li se sterge nimic; prima cautare peste limita primeste 429 cu indrumare — de verificat ca mesajul e suficient de clar incat sa nu para defectiune.

---

## Rev. 2 — corectii obligatorii (review Codex, findings CONFIRM acceptate)

**Blocante de contract (fara ele feature-ul nu functioneaza):**
1. (#1) `rnpm.storage` intra in enum-ul BACKEND `QUOTA_FEATURES` (quotaGuard.ts:23) validat de `PUT /admin/.../quota` (admin.ts:152, z.enum) — altfel override-ul nu se poate salva din UI. Test nou pe PUT cu feature-ul nou.
2. (#7) Semantica period pentru stocare: valoarea canonica `day` la salvare, UI-ul ASCUNDE selectorul de perioada pentru `rnpm.storage` (afiseaza "Permanenta"), iar copy-ul de stergere a override-ului spune "revine la default (500 MB)", NU "nelimitat". Test UI pe ambele.
3. (#13) `ApiError` din frontend/src/lib/api.ts se extinde cu `details?: Record<string, unknown>` (backward compatible), iar `rnpmApi.ts` intra in Task 3 — altfel maparea 429 cu cifre e neimplementabila. Bulk/split (SSE) afiseaza mesajul serverului ca text (contine deja cifrele).

**Semantica limitei (redefinita onest):**
4. (#2) Limita live = ADMISSION CONTROL cu recheck-uri, nu plafon fizic absolut: conditia devine `used >= limit`; recheck INTRE itemele bulk si INTRE sub-cautarile split (hook in rnpmSearchService: itemul urmator nu porneste peste limita; itemul in curs se termina). Overshoot-ul ramas = o singura cautare, documentat.
5. (#3) Ruta corecta e `POST /search-split` (nu /search/split) — corectat in Task 1.
6. (#4, DECIZIE-USER-1: APROBAT 2026-07-12) Restore-ul ramane PERMIS peste limita (recovery bate limita), iar cautarile ulterioare sunt blocate pana la curatare — politica declarata explicit in plan si in RUNBOOK.
7. (#5, #6) Masurarea: db+wal+shm (ACELASI numerator ca adminRnpm.ts:45 — cardul si guard-ul nu au voie sa difere), sub `withMaintenanceRead` (anti-swap cu compact/restore), cu politica WAL declarata: guard-ul face `PRAGMA wal_checkpoint(PASSIVE)` best-effort inainte de masurare DOAR cand masuratoarea bruta depaseste limita (a doua sansa ieftina anti-refuz-prematur pe WAL reciclabil).
8. (#14) Mesajul 429 include calea de iesire completa: "Sterge avize (stergerea pe selectie elibereaza automat spatiul) sau compacteaza din zona RNPM" — autocompact-ul e dependinta declarata; butonul self-service de compact exista deja.

**Plafonul de backup (redefinit onest ca best-effort steady-state):**
9. (#8) Podeaua include TOATE pool-urile RNPM reale, inclusiv `preMigration` (omis in Rev. 1); snapshotul pre-migrare din rnpmDb.ts primeste apel de `pruneOld` dupa creare. Worst-case-ul onest per user devine: 500 live + podeaua (pana la 4 copii × ~500 MB) ≈ **pana la ~2.5 GB teoretic**, atins doar de un user care sta fix la limita si are toate tipurile de snapshot simultan — cifrele din Goal se corecteaza. (DECIZIE-USER-2: APROBAT 2026-07-12 — reducem copiile per pool DOAR pentru jail-urile RNPM: daily 7→3, manual 5→2, pre-restore 5→2, pre-migration 5→2; monolitul ramane neschimbat. Constante separate RNPM_* in backup.ts, langa cele existente. Worst-case per user ≈ 500 live + 4×500 podea teoretica, dar cu pool-urile reduse steady-state-ul realist scade spre ~1.5 GB.)
10. (#9) `pruneOld` primeste `protectedNames: string[]` — sursa activa a unui restore si snapshotul pre-restore curent nu pot fi sterse de byte-pruning (restore-ul dintr-un backup vechi nu-si mai poate sterge propria sursa la staging-failure).
11. (#11) Accounting-ul jail-ului include sidecar-urile legacy (-wal/-shm) si exclude/curata `.db.tmp`; rezultatul pruning-ului raporteaza `capSatisfied` in log cand podeaua tine jail-ul peste plafon; plafonul e documentat ca "best-effort steady-state", nu garantie hard.
12. (#12) Risc ACCEPTAT documentat: hook-ul offsite (env optional, operator-only) poate citi un fisier in timp ce byte-pruning-ul il sterge — fereastra exista si azi la pool-pruning; operatorul cu offsite activ e instruit in RUNBOOK sa dimensioneze plafonul generos.

**Rollout si teste:**
13. (#15, DECIZIE-USER-3: APROBAT 2026-07-12 — block imediat, fara grace period; aplicatia NU e lansata oficial, nu exista useri de migrat) La deploy, userii peste limita sunt blocati la prima cautare cu mesajul cu cifre + card admin evidentiat rosu.
## Rev. 3 — corectii suplimentare (review-panel multi-model, 2026-07-12; CASTIGA asupra Rev. 2)

R1. **Goal-ul se corecteaza onest**: worst-case per user NU e "~1 GB" — cu podeaua de backup si restore permis peste limita, footprint-ul teoretic e nemarginit (marginit practic de pool-urile reduse + plafonul best-effort). Cifra promisa public: "500 MB date vii + backup-uri plafonate best-effort, tipic sub ~1.5 GB total".
R2. **O SINGURA functie de masurare partajata** (`measureRnpmStorage(ownerId)` in db/**, sub `withMaintenanceRead`, numerator db+wal+shm) folosita de: guard, cardul admin (adminRnpm.ts:45) SI `/stats` (rnpm.ts:935-963, azi fara lock) — cifrele nu au voie sa difere intre suprafete. Checkpoint-ul PASSIVE "a doua sansa" ruleaza in interiorul functiei, deterministic, nu doar in guard.
R3. **`protectedNames` se aplica AMBELOR faze de pruning** (pe numar SI pe bytes) si tuturor fisierelor bundle-ului — altfel faza pe numar poate sterge sursa restore-ului activ inainte ca protectia byte-cap sa conteze. Toate cele 4 call-site-uri `pruneOld` (backup.ts:613, :776, :1350, :1433) se enumera si se actualizeaza; test cu sursa dincolo de retain-count.
R4. **Overshoot cuantificat si limitat**: recheck si INTRE batch-urile interne de pagini din `executeSearch` (nu doar intre iteme bulk/sub-cautari) — plafonul real de overshoot devine ~1 batch de detalii; SSE-ul bulk emite eroarea de limita coerent per item.
R5. **Paginarea de continuare** (`existingGcode`/`startRnpmPage`, rnpm.ts:242-243) e EXCEPTATA de la gate: o cautare inceputa legitim are voie sa se termine (UX coerent); documentat in plan + RUNBOOK, test dedicat.
R6. **Fara import circular**: pruning-ul cu pool-uri RNPM reduse se extrage in modul separat fara dependinte (`backend/src/db/backupPrune.ts` sau echivalent) — `rnpmDb.ts` (snapshot pre-migrare) il apeleaza fara sa importe backup.ts; `rnpmDb.ts` intra in Files la Task 2.
R7. **Files completate**: Task 1 primeste `backend/src/middleware/quotaGuard.ts` (enum QUOTA_FEATURES backend), `backend/src/routes/admin.ts` (z.enum + verificarea range-ului limitei pentru valori MB mari), `backend/src/services/rnpmSearchService.ts` (hook-ul de recheck).
R8. **Accounting best-effort post-commit**: erorile de stat/unlink DUPA o mutatie comisa (backup/restore reusit) nu au voie sa devina 500 — log + `capSatisfied:false`; `capSatisfied` se calculeaza prin re-stat real, nu prin scaderea bytes-ilor candidati (unlinkBundle poate lasa sidecars pe disc).
R9. **429 fara `Retry-After`** (conditia nu e tranzitorie — retry-ul automat al proxy-urilor ar bucla) + motivatia documentata in RUNBOOK; codul ramane 429 pentru consistenta cu restul cotelor.
R10. **Copy-ul de stergere a override-ului**: "revine la default-ul configurat" (env-ul poate schimba default-ul sau dezactiva limita) — nu "500 MB" hardcodat.
R11. **Unitate per feature in quotaFeatureLabels**: descriptor `"usd" | "count" | "mb"` in loc de binarul isCountFeature — altfel UI-ul eticheteaza MB drept USD/captcha-uri.
R12. **Teste anti-provisioning**: guard-ul pe primul `/search` al unui user FARA fisier => used=0 FARA creare de fisier (invariantul rnpm.ts:946 pastrat).

14. (#16) Matricea de teste se extinde cu lista completa Codex: PUT admin pe feature nou; boundary `used == limit` si override `0`; bulk si split respinse INAINTE de captcha; recheck intre iteme/sub-cautari; paginare cu gcode existent (trece prin gate — REJECT confirmat de Codex, dar testul o dovedeste); restore peste limita + cautare ulterioara blocata; WAL mare checkpointat; masurare concurenta cu compact (sub read lock); numerator identic card/guard; period ascuns in UI; stergere override revine la default; details pastrate in ApiError pe search; preMigration in cap si podea; sursa restore protejata; sidecars in accounting; capSatisfied la podea peste plafon.
