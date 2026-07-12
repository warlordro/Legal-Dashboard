# PROMPT CODEX — Implementare: autocompact la stergere + limite de stocare RNPM per user

**Rol:** esti implementatorul. Executi DOUA planuri aprobate, in ordine stricta, cu TDD riguros. Nu improvizezi design — orice ambiguitate se rezolva citind planurile; daca planul tace, te opresti si raportezi, nu inventezi.

## 0. Sursele de adevar (citeste-le INTEGRAL inainte de orice)

1. `docs/superpowers/plans/2026-07-12-rnpm-autocompact-delete-batch.md` — planul 1 (implementat PRIMUL). Sectiunile "Rev. 2 — corectii obligatorii" si punctul "7a. Rev. 3" CASTIGA asupra textului initial al taskurilor oriunde exista conflict.
2. `docs/superpowers/plans/2026-07-12-rnpm-storage-limits.md` — planul 2 (implementat DUPA planul 1). Sectiunile "Rev. 2 — corectii obligatorii" si "Rev. 3 — corectii suplimentare" CASTIGA asupra textului initial. Deciziile marcate "DECIZIE-USER: APROBAT" sunt finale.
3. `CLAUDE.md` din radacina — conventiile repo-ului (obligatorii).

Ambele planuri au fost validate prin doua review-uri adversariale (Codex + panel multi-model); corectiile sunt deja in Rev. 2/Rev. 3. NU re-deschide deciziile de design.

## 1. Constrangeri globale (non-negociabile)

- **Fara push. Fara bump de versiune. Fara modificari in CHANGELOG/README.** Doar commits locale pe branch-ul curent (`feat/v2.43.0-rnpm-split`).
- **Romana fara diacritice** in cod, comentarii, mesaje, teste.
- **SQL raw / PRAGMA doar in `backend/src/db/**`** (repository-only). Rutele nu ating SQLite direct.
- **TDD strict per task**: scrii testele, rulezi si CONFIRMI ca pica (RED) cu motivul asteptat, abia apoi implementezi, apoi GREEN. Nu scrii implementarea inainte de red.
- **Commits pe blocuri** — un commit per task de plan (mesajele sugerate sunt in planuri), NU per fisier.
- **Serverul dev-web-local (porturi 3002-3004) NU se opreste si NU se restarteaza.** Testele folosesc DB-uri temporare izolate.
- **Nu atinge** fisiere neinrudite, formatari adiacente, comentarii existente. Schimbari chirurgicale.

## 2. Ordinea de executie

### FAZA A — Autocompact (planul 1, taskurile T1→T4)

**A-T1** (`backend/src/db/backup.ts` + `backend/src/db/rnpmAutoCompact.test.ts` nou):
1. Scrie testele din planul 1 Task 1 Step 1, CORECTATE de Rev. 2 #5 (boundary exact, env invalid — atentie Rev. 3: fractiile finite >=0 sunt VALIDE, "1.5" NU e caz invalid) si Rev. 3 (kill switch `LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_DISABLED=1` => `{attempted:false}`; ENOSPC => `reason:"enospc"`; anti-provisioning; concurenta reala cu `RnpmSearchActiveError`).
2. RED: `cd backend && npx vitest run src/db/rnpmAutoCompact.test.ts` — toate testele noi pica pe importuri/comportament inexistent.
3. Implementeaza in `backup.ts`: `shouldAutoCompactRnpm` (pur), `readAutoCompactMinFreeBytes` (env, pattern `readDefaultQuotaMilli`), `compactRnpmIfStillNeeded` (ATENTIE Rev. 3 HIGH: recheck-ul sub lock foloseste `openRnpmDbHandleDirect` DUPA `beginRnpmRestore`, masoara PRAGMA, INCHIDE handle-ul, apoi VACUUM — NU `getRnpmDb`, care e blocat de latch), `maybeAutoCompactRnpm(ownerId, deps?)` cu tipul de retur `{attempted; compacted; freedBytes; coalesced?; durationMs?; reason?}` si seam injectabil pentru teste.
4. GREEN, apoi: `npx biome check --write backend/src/db/backup.ts backend/src/db/rnpmAutoCompact.test.ts` si `npx tsc --noEmit -p backend/tsconfig.json`.
5. Commit (mesajul din plan T1 Step 5).

**A-T2** (`backend/src/routes/rnpm.ts` + teste route-level):
1. Teste RED conform plan T2 + Rev. 2 #2 (audit separat: `aviz.delete_batch` imediat dupa commit, NEATINS; eveniment DISTINCT `rnpm.autocompact` cu detail `{attempted, compacted, freedBytes, reason?, durationMs}`) + Rev. 3 (rutele `DELETE /saved/:id` si `DELETE /searches/:id` primesc ACELASI apel `maybeAutoCompactRnpm`; kill switch => raspuns FARA camp `compacted`).
2. Implementare: dupa mutatia comisa, `const auto = await maybeAutoCompactRnpm(ownerId).catch(...)` — catch generic = log + `{attempted:true, compacted:false}`; raspunsul `{deleted, compacted?, freedBytes?}` cu campurile prezente DOAR cand `attempted:true`.
3. GREEN + biome + tsc. Commit (mesajul din plan T2 Step 5, completat cu rutele individuale).

**A-T3** (frontend): conform plan T3 — `rnpmApi.ts` (`rnpmDeleteAvizeBatch` intoarce `{deleted, compacted?, freedBytes?}`), `RnpmSavedData.tsx` (stare `deleteWarning`, copy identic cu RnpmSavedStats.tsx:208-210), test jsdom nou pe pattern-ul `RnpmStorage.test.tsx`. RED → implementare → GREEN → `cd frontend && npx tsc --noEmit` → commit.

**A-T4**: rand nou in tabelul kill switches din `SESSION-HANDOFF.md` (ambele env-uri: `LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB`, `LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_DISABLED`). Gate complet FAZA A: `npx biome check --write` pe fisierele atinse → `npx tsc --noEmit -p backend/tsconfig.json` → `cd frontend && npx tsc --noEmit` → `npm test --workspace=backend` → `cd frontend && npx vitest run`. Commit doc.

### FAZA B — Limite de stocare (planul 2, taskurile T1→T4, DOAR dupa FAZA A completa si verde)

**B-T1** (limita live):
- Files conform plan + Rev. 3 R7: `backend/src/db/rnpmStorageLimit.ts` (nou), `backend/src/middleware/quotaGuard.ts` (enum `QUOTA_FEATURES` + `rnpm.storage`), `backend/src/routes/admin.ts` (z.enum; VERIFICA range-ul validat al `limit_usd_milli` pentru valori MB — daca exista un max care ar respinge 200000, extinde-l documentat), `backend/src/routes/rnpm.ts` (guard pe `/search`, `/bulk`, `/search-split` — ATENTIE: numele REAL al rutei e `search-split`), `backend/src/services/rnpmSearchService.ts` (recheck intre iteme bulk, intre sub-cautari split SI intre batch-urile interne de pagini — Rev. 3 R4), `backend/src/util/appErrorHandler.ts` (mapare tipata → 429 FARA `Retry-After` — Rev. 3 R9).
- Functia de masurare: `measureRnpmStorage(ownerId)` UNICA, in db/**, sub `withMaintenanceRead`, numerator db+wal+shm, checkpoint PASSIVE "a doua sansa" inauntru (Rev. 3 R2). Conditia: `used >= limit` (Rev. 2 #4). Paginarea de continuare cu `existingGcode` e EXCEPTATA (Rev. 3 R5). Fara provisioning pe useri fara fisier (R12: ENOENT ⇒ used=0, fara creare).
- Semantica period pentru `rnpm.storage`: canonic `day`, UI-ul ascunde selectorul (Rev. 2 #7).
- TDD cu matricea completa din plan #14 (lista Codex) — implementeaz-o integral; e criteriul de done.

**B-T2** (plafon backup):
- Modul nou fara dependinte circulare (`backend/src/db/backupPrune.ts` — Rev. 3 R6); pool-uri RNPM reduse (daily 3, manual 2, pre-restore 2, pre-migration 2 — DECIZIE-USER-2), monolitul NEschimbat; `protectedNames` pe AMBELE faze de pruning si toate cele 4 call-site-uri `pruneOld` (Rev. 3 R3); accounting best-effort post-commit cu `capSatisfied` prin re-stat real (Rev. 3 R8); jail accounting include sidecars si `.db.tmp`; snapshot-ul pre-migrare din `rnpmDb.ts` apeleaza pruning-ul prin modulul nou.

**B-T3** (UI): conform plan Task 3 + Rev. 2 #13 (`ApiError` primeste `details?`; `rnpmApi.ts` in scope) + Rev. 3 R10 (copy "revine la default-ul configurat") + R11 (descriptor de unitate `"usd" | "count" | "mb"` in `quotaFeatureLabels.ts`, NU extinderea binarului isCountFeature) + R2 (cardul si `/stats` folosesc `measureRnpmStorage` prin endpoint-uri, nu masuratori proprii).

**B-T4**: docs (SESSION-HANDOFF kill switches: `LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB`, `LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB`; RUNBOOK: politica restore-peste-limita + nota proxy timeout >=60s + motivatia 429-fara-Retry-After) + gate complet identic cu A-T4. Commit final.

## 3. Capcane cunoscute ale repo-ului (nu le redescoperi)

1. **better-sqlite3 ABI**: daca testele Node pica cu `NODE_MODULE_VERSION mismatch`, ruleaza `npm rebuild better-sqlite3` INTAI. NU rula `npm run rebuild:electron` (l-ar strica pentru teste).
2. **Biome `noAssignInExpressions`**: `(r) => (x = r)` pica — foloseste block body `(r) => { x = r; }`.
3. **`vi.spyOn` pe export-ul aceluiasi modul NU intercepteaza apelul lexical intern** — de asta exista seam-ul `deps?` din A-T1. Pentru mock pe module STRAINE foloseste `vi.mock` cu `importOriginal`.
4. **Windows: `stat("<fisier>/<copil>")` da ENOENT, nu ENOTDIR** — pentru erori FS non-ENOENT in teste, mock-uieste `fsPromises.stat` (namespace-ul functioneaza), nu aranja directoare pe disc.
5. **Suita `backup.test.ts` are `captureConsoleLog` propriu** (spy-ul simplu pe console.log nu prinde peste microtask-hop-ul maintenance-lock) — refoloseste-l pentru asertiile pe `logBackupEvent`.
6. **Testele care ating registry-ul RNPM** au nevoie de `LEGAL_DASHBOARD_DB_PATH` pe mkdtemp + cleanup in afterEach (pattern: `rnpmGuards.test.ts`, `rnpmBackup.test.ts`).
7. **`.dev-web-local/` e git-ignored** — nu apare in git status; nu-l atinge.

## 4. Criterii de finalizare (verifica-le pe toate inainte de raport)

- [ ] Toate taskurile A-T1…A-T4, B-T1…B-T4 comise, in ordine, cu gate verde intre faze.
- [ ] `npm run check` trece integral (lint + typecheck + toate testele).
- [ ] Zero teste `.skip`/`.only` ramase; zero `console.log` de debug.
- [ ] Matricea de teste din planul 2 punctul #14 acoperita integral (bifeaz-o element cu element in raport).
- [ ] Niciun fisier din afara scope-ului atins (`git status` curat pe rest).

## 5. Raportul final (obligatoriu)

Tabel per task: task → commit hash → teste noi (nr) → RED confirmat (da/nu) → observatii. Plus: lista abaterilor de la plan (ideal: zero; orice abatere cu motivatia si locul), riscurile ramase, si ce NU ai implementat (daca ceva a fost imposibil — cu explicatia exacta, nu workaround silentios).
