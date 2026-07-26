# Plan implementare — Flux B: cele 6 findinguri CodeRabbit ramase + lotul cosmetic

> **Pentru agenti:** SUB-SKILL OBLIGATORIU: `superpowers:subagent-driven-development` (recomandat) sau
> `superpowers:executing-plans`. Pasii folosesc checkbox (`- [ ]`).

**Goal:** Inchide ce a ramas din triajul CodeRabbit 2026-07-26. Din cele 9 initiale: 1.2 a fost livrat in
Fluxul A, 1.7 s-a dovedit deja rezolvat (vezi verificarea la sursa), deci raman **6** plus lotul cosmetic.

**Arhitectura:** Findinguri independente intre ele, in fisiere diferite (migrations, db, routes, middleware,
frontend, docs). Fara dependente incrucisate — fiecare e un commit propriu. Lotul cosmetic vine la final,
intr-un singur commit, ca delta-ul substantial sa ramana reviewabil separat.

**Tech stack:** Node 22, Hono, SQLite (better-sqlite3), React 18, vitest, biome.

## Ce NU intra in scope

**1.2 e deja livrat** in Fluxul A (`706b9ae`) — gardul de restore a fost mutat inaintea consumului de captcha
si a verificarii de stocare. Nu se re-deschide.

**Cele 3 findinguri de infra** (#27, #28, #29 — fallback hardcodat `2.43.0` in `deploy/.env.prod.example`,
`deploy/docker-compose.prod.yml`, `docker-compose.yml`) raman neatinse: decizie explicita a userului ca
Dokploy, `docker-compose.yml` si `deploy/` sunt in afara perimetrului.

**Cele 12 fals pozitive** raman inchise, cu dovezile din `audit/CODERABBIT-TRIAJ-2026-07-26.md` sectiunile
4 si 5. Nu se re-verifica si nu se re-deschid.

**Cele doua documente trunchiate** (`HANDOFF-EXECUTIE-REMEDIERE-AUDIT-v2.43-2026-07-19.md` si
`docs/superpowers/plans/2026-07-19-remediere-audit-sec-v2.43.md`) — au intrat in git deja trunchiate, in
`41d9ca4`; nu exista versiune intreaga nicaieri, iar munca pe care o descriau a fost livrata. Nu se
"recupereaza". Daca userul vrea, se sterg — decizie separata, nu se ia in acest plan.

## Global Constraints

Branch: `feat/v2.43.0-rnpm-split`. NICIODATA push pe `main` (Dokploy deployeaza de acolo).

Fara `git add -A`. `PowerShell-7.6.4-win-x64.msi` de la radacina nu e in `.gitignore`.

**Exista modificari necommise care NU sunt ale acestui flux** — `AGENTS.md`, `CLAUDE.md`, `HARDENING.md`
(mutari de documente in `docs/archive/`, facute de user). Nu le include in niciun commit; staging doar pe
cai explicite.

Cod sursa fara diacritice. Mesaje UI in romana.

Gate inainte de FIECARE commit: `npx biome check --write <fisiere atinse>` →
`npx tsc --noEmit -p backend/tsconfig.json` (+ `cd frontend && npx tsc --noEmit` daca s-a atins frontendul) →
`npm run build` → `npm test --workspace=backend` (+ `npm test -- --run` in frontend daca e cazul).

Baseline la `9bed150` (finalul Fluxului C): **2111 teste backend / 8 skipped, 395 frontend.**

Fals pozitiv cunoscut la biome: artefactul CRLF din `CLAUDE-SECURITY-20260724-195947/`, negestionat de git.

**Push:** nimic nu urca pe GitLab pana la decizia userului.

---

## Rezultatul verificarii la sursa (2026-07-26)

Toate cele 7 au fost verificate in cod inainte de a scrie task-urile. Trei verdicte difera de triaj.

| # | Verdict | Ce s-a schimbat fata de triaj |
|---|---------|-------------------------------|
| 1.1 | CONFIRMAT | — |
| 1.3 | CONFIRMAT | Suprafata sincrona e mai LARGA: si `hasPendingRnpmMigrations` deschide DB sincron, iar `getRnpmDb` are semnatura sincrona |
| 1.4 | CONFIRMAT | Context atenuant: premisa sectiunii e "boot-ul aborteaza", deci aplicatia e deja jos |
| 1.5 | CONFIRMAT | Sunt TREI handlere, nu unul; doua au fereastra mult mai larga (asteapta dialogul de confirmare inainte de `setBusy`) |
| 1.6 | PARTIAL | Fisierul frontend din triaj e GRESIT; "incalca conventia" e exagerat |
| 1.7 | **INFIRMAT** | Avertismentul la boot EXISTA deja (`index.ts:718-726`, commit `d176019`) |
| 1.8 | PARTIAL | Se scrie totusi un rand de audit structurat; se pierde doar motivul granular |

**1.7 iese din scope ca finding.** Ramane un rest real dar mic: alte kill switches scriu si in `audit_log`
(`RNPM_RUNTIME_VALIDATION_DISABLED`, `index.ts:699-716`, cu rationamentul "operatorul vede warn-ul in stdout,
complianta vede entry-ul in audit_log"), iar ramura CSRF are doar `console.warn`. Intra in lotul cosmetic,
nu ca task propriu.

**Corectii de dus inapoi in triaj** (Task 8): 1.7 marcat rezolvat anterior, fisierul corect pentru 1.6, si
precizarea de la 1.8.

---

## Structura fisierelor

| Fisier | Rol | Task |
|--------|-----|------|
| `backend/src/db/migrations/0041_unified_ai_quota.down.sql` + `.up.sql` | marcare + curatare copie la rollback | 1 |
| `backend/src/index.ts` | prewarm de boot pentru snapshotul RNPM in web mode | 2 |
| `frontend/src/pages/admin/Backups.tsx` | `actionInFlightRef` pe trei handlere | 3 |
| `backend/src/db/backup.ts` | masuratoarea intra in `try` | 4 |
| `backend/src/routes/adminRnpm.ts` + `frontend/src/lib/adminRnpmApi.ts` | paginare pe `/usage` | 5 |
| `RUNBOOK.md` | o propozitie in Varianta 1 | 6 |
| lot cosmetic (12 intrari) | vezi Task 7 | 7 |
| `audit/CODERABBIT-TRIAJ-2026-07-26.md` | corectiile de mai sus | 8 |

---

## Task 1: Rollback-ul migratiei 0041 dubleaza grantul AI

**Files:**
- Modify: `backend/src/db/migrations/0041_unified_ai_quota.down.sql:13-17`
- Modify: `backend/src/db/migrations/0041_unified_ai_quota.up.sql:25`
- Test: `backend/src/db/` — test nou de ciclu down→up

**Problema, verificata:** down-ul face din 1 rand de grant doua (`:15` insereaza o copie `ai.multi`, `:17`
redenumeste originalul in `ai.single`), iar up-ul le colapseaza pe amandoua inapoi in `'ai'` (`up.sql:25`).
Copia e identica pe TOATE coloanele cu exceptia `id`-ului autoincrement, deci up-ul nu are cum sa o distinga.
Extra-ul se aduna per grant, deci un ciclu down→up dubleaza bugetul; N cicluri il inmultesc cu 2^N.
`down.sql:20` sterge versiunea 41, deci re-aplicarea chiar ruleaza.

Overrides NU se dubleaza — cheia primara e `(user_id, feature)` si up-ul alege un singur rand. Fixul atinge
strict grants.

- [ ] **Step 1: Testul care pica**

Test nou care aplica migrarile pana la 41, insereaza un grant `ai`, ruleaza down-ul, apoi up-ul, si verifica
ca `extra_usd_milli` total pe user a ramas acelasi. Fara fix, se dubleaza.

**DESIGN SCHIMBAT dupa review adversarial (CRITICAL).** Varianta initiala marca copia printr-un prefix in
`reason` (`'[split-0041] ' || ...`) si o stergea in up cu `LIKE`. Respinsa din doua motive:
`reason` e text liber, fara namespace rezervat — un grant legitim al carui `reason` incepe cu acel prefix ar fi
fost STERS de up; si varianta muta date reale ale userului (continutul lui `reason`) doar ca sa transporte un
flag intern de migrare.

**Varianta adoptata:** `down.sql` ramane NEATINS — nu mutam date si nu inventam markere. Toata logica sta in
`up.sql`, care deduplica randurile identice inainte de colapsare. Copia produsa de down e identica pe TOATE
coloanele in afara de `id` si `feature`, deci gruparea pe restul coloanelor o identifica fara ambiguitate.

Coliziunea ramasa e mult mai putin plauzibila decat la varianta cu prefix: ar cere doua granturi genuin
distincte, pentru acelasi user, cu aceeasi suma, acelasi `reason`, acelasi `granted_by` SI acelasi `granted_at`
la secunda. Doua randuri identice pe toate coloanele sunt oricum indistinctibile intre ele prin definitie.

Migrarile ruleaza in tranzactie (`backend/src/db/migrations/runner.ts:226`), deci pasul e atomic: ori
dedup + colapsare, ori nimic.

- [ ] **Step 2: `down.sql` — NICIO modificare**

Se lasa exact cum e. Notat explicit ca sa nu il "imbunatateasca" cineva la executie.

- [ ] **Step 3: Dedup in `up.sql`, INAINTE de colapsare**

Inainte de `UPDATE ... SET feature = 'ai' WHERE feature IN ('ai.single','ai.multi')` (`up.sql:25`):

```sql
-- Un ciclu down->up dubla extra-ul fiecarui user (N cicluri: x2^N). down.sql face din
-- 1 grant doua — insereaza o copie 'ai.multi' si redenumeste originalul 'ai.single' —
-- iar UPDATE-ul de mai jos le colapseaza pe amandoua inapoi in 'ai'. Extra-ul se aduna
-- per grant, deci ambele se numara.
-- Copia e identica pe toate coloanele in afara de id si feature, deci gruparea pe restul
-- o identifica fara marker in date. Se pastreaza randul cu id-ul cel mai mic.
DELETE FROM user_quota_grants
WHERE feature IN ('ai.single', 'ai.multi')
  AND id NOT IN (
    SELECT MIN(id) FROM user_quota_grants
    WHERE feature IN ('ai.single', 'ai.multi')
    GROUP BY user_id, extra_usd_milli, expires_at, reason, granted_by, granted_at,
             revoked_at, revoked_by, revoked_reason
  );
```

Linia 25 ramane neschimbata dupa.

- [ ] **Step 4: Testul acopera si al DOILEA ciclu**

Nu doar down→up, ci down→up→down→up: fara dedup, al doilea ciclu ar da x4. Cu dedup, totalul trebuie sa ramana
constant la orice numar de cicluri.

- [ ] **Step 5: Verde + gate + commit**

---

## Task 2: Snapshotul sincron ingheata serverul la prima cerere dupa upgrade

**Files:**
- Modify: `backend/src/index.ts` (blocul de prewarm de la `:613-620`)
- Test: `backend/src/db/` sau `backend/src/routes/` — test care dovedeste ca prima cerere nu mai face snapshot

**Problema, verificata:** `preRnpmMigrationBackup` (`rnpmDb.ts:58-78`) e integral sincron — `mkdirSync`,
`new Database`, `VACUUM INTO`, `close`, `pruneBackupJailSync`. Se apeleaza din `getRnpmDb` (`:147-150`), care
are semnatura SINCRONA, deci nu poate astepta un worker. In plus `hasPendingRnpmMigrations` (`:84-103`)
deschide si el DB-ul sincron. Pe desktop e invizibil; pe web tot serverul sta cat ruleaza.

**Fixul, respectand constrangerea de semnatura:** nu se face asincron `getRnpmDb` — se muta munca inaintea
serverului. Prewarm-ul de boot (`index.ts:613-620`) ruleaza deja INAINTE de `serve()`, exact ca sa nu se
serveasca `/health: ok` in timp ce migrarile blocheaza event loop-ul. Se extinde: in web mode, pentru fiecare
user real, se ruleaza snapshotul de pre-migrare la boot. Cand vin cererile, `hasPendingRnpmMigrations` intoarce
deja `false` si calea sincrona nu se mai atinge.

**Atentie — motivul pentru care prewarm-ul RNPM e azi desktop-only** (`index.ts:614-617`): in web mode un apel
`getRnpmDb("local")` ar PROVISIONA un fisier orfan pentru un owner inexistent. Deci iterarea trebuie facuta pe
userii REALI din `users`, nu pe `"local"`.

**Ce NU se face:** nu se rescrie `preRnpmMigrationBackup` sa foloseasca `snapshotRunner` (workerul exista,
`backend/src/util/snapshotRunner.ts`, si comentariul lui confirma exact patologia — dar `runSnapshotOp` e
async, iar `getRnpmDb` nu). Mutarea la boot rezolva problema fara refactor de semnatura. Daca pe viitor
`getRnpmDb` devine async, workerul e alegerea corecta.

**Ce NU acopera fixul (finding review adversarial, HIGH — corectat partial dupa verificare).** Codex sustine
ca raman doua cai sincrone: useri creati dupa boot si useri restaurati. Verificat in cod:

**Userii NOI sunt exceptati, contrar findingului.** Gardul de la `rnpmDb.ts:148` e
`if (fs.existsSync(dbPath) && hasPendingRnpmMigrations(dbPath))` — pentru un user nou fisierul nu exista inca,
deci `preRnpmMigrationBackup` NU ruleaza deloc. Migrarile ruleaza pe un fisier gol, adica instant.

**Restore-ul ramane rezidual REAL.** Un restore inlocuieste fisierul cu unul mai vechi, care poate avea migrari
lipsa; urmatoarea cerere a ACELUI user intra pe calea sincrona. Diferenta fata de problema initiala: afecteaza
un singur user, pe care il si asteapta oricum dupa un restore, nu toti userii simultan dupa un upgrade. Se
documenteaza ca rezidual asumat; inchiderea lui ar cere `getRnpmDb` async, adica refactor de semnatura.

**Costul boot-ului nu e plafonat (MEDIUM).** Iterarea peste toti userii ruleaza inainte ca portul sa existe.
Pe multi useri cu baze mari, boot-ul se lungeste proportional. Se accepta — e acelasi compromis pe care il face
deja blocul de prewarm ("bind only when ready", `index.ts:608-612`) — dar se logheaza progresul si durata
totala, ca operatorul sa vada de ce sta boot-ul, in loc sa para blocat.

**Un snapshot esuat NU trebuie sa cada boot-ul.** `preRnpmMigrationBackup` are deja `try/catch` intern care
doar avertizeaza (`rnpmDb.ts:75-77`); prewarm-ul nu trebuie sa transforme asta in `fatalBoot`.

- [ ] **Step 1: Testul care pica**

Test care simuleaza migrari pending pentru doi useri si verifica ca dupa prewarm-ul de boot
`hasPendingRnpmMigrations` intoarce `false` pentru amandoi.

- [ ] **Step 2: Extinde prewarm-ul**, cu log de progres (cati useri, durata totala) si fara `fatalBoot` pe
      esec individual.

- [ ] **Step 3: Verde + gate + commit**

---

## Task 3: Dublu-click pe backup

**Files:**
- Modify: `frontend/src/pages/admin/Backups.tsx` — TREI handlere
- Test: `frontend/src/pages/admin/` — test nou

**Problema, verificata:** trei handlere se apara cu state React:
`handleCreate` (`:49-51`) — `if (busy) return` apoi `setBusy` imediat: fereastra e doar tick-ul curent.
`handleRestore` (`:65-77`) si `handleDeleteAll` (`:94-104`) — `if (busy) return` la inceput, dar `await
confirm({...})` INAINTE de `setBusy`, deci fereastra tine cat e deschis dialogul, nu un tick.

Patternul corect exista in repo: `RnpmStorage.tsx:41` (`actionInFlightRef`), cu reset in `finally`-ul EXTERIOR
(`:101-103`, `:135-137`) ca sa acopere si respingerea dialogului. Ref-ul e partajat intre actiuni — un singur
dialog o data.

- [ ] **Step 1: Testul care pica** — doua click-uri in acelasi tick produc un singur POST.
- [ ] **Step 2: Aplica `actionInFlightRef` pe toate trei**, cu reset in `finally` exterior.
- [ ] **Step 3: Verde + gate (inclusiv `cd frontend && npx tsc --noEmit` si testele frontend) + commit**

---

## Task 4: Motivul granular de skip la autocompactare se pierde

**Files:**
- Modify: `backend/src/db/backup.ts:1192-1200`
- Test: `backend/src/db/backup*.test.ts`

**Problema, verificata si CORECTATA fata de triaj:** `readAutoCompactMinFreeBytes()` (`:1192`) si
`measureRnpmFreelistIfPresent()` (`:1193`) sunt in afara `try`-ului care se deschide la `:1200`. Un throw din
ele iese din functie fara `logBackupEvent({ action: "rnpm_autocompact_skipped" })`.

Nu e ipotetic: `measureRnpmFreelistIfPresent` rethrow-uieste orice eroare de stat non-ENOENT si apeleaza
`getRnpmDb`, care arunca `RnpmRestoreInProgressError`. Iar `autoCompactFailureReason` (`:1168-1181`) exista
EXACT ca sa clasifice cazul asta (`RESTORE_IN_PROGRESS` → `restore_in_progress`). Plasarea pre-`try` invalideaza
clasificatorul fix in cazul pentru care a fost scris.

**Triajul exagereaza intr-un punct:** nu ramane "doar un `console.error`". Apelantul
(`rnpm.ts:83-92`) are `.catch` care INTOARCE o valoare, deci executia continua la `recordAuditSafe`
(`:93-103`), care scrie un rand de audit cu `reason: "error"`. Ce se pierde efectiv: motivul granular
(`search_active` / `restore_in_progress` / `maintenance_shutdown` / `enospc`, toate colapsate in `"error"`) si
`durationMs`.

**Schimbare de comportament, declarata (finding review adversarial, MEDIUM):** mutand masuratoarea in `try`,
catch-ul va absorbi si erori care azi ies din functie — `EACCES`, `EIO`, DB corupta, esec de migrare. Ele devin
un "skip" logat in loc de o exceptie propagata.

E acceptabil si chiar dorit: apelantul le inghitea oricum (`rnpm.ts:84`, `.catch` care intoarce o valoare),
deci nu se pierde nicio propagare reala — se castiga un motiv clasificat in loc de `"error"`. DAR
`autoCompactFailureReason` trebuie sa mapeze explicit clasele noi la un `reason` distinct (ex. `io_error`), nu
sa le colapseze in acelasi cos cu refuzurile legitime de concurenta. Altfel un disc plin ar arata identic cu
un restore in curs.

- [ ] **Step 1: Testele care pica** — (a) `RnpmRestoreInProgressError` din masuratoare → eveniment
      `rnpm_autocompact_skipped` cu `reason: "restore_in_progress"`; (b) o eroare de I/O → `reason` distinct,
      NU acelasi cu (a).
- [ ] **Step 2: Muta cele doua linii in `try` si extinde `autoCompactFailureReason`** cu clasa de I/O.
- [ ] **Step 3: Verde + gate + commit**

---

## Task 5: `/usage` fara paginare

**Files:**
- Modify: `backend/src/routes/adminRnpm.ts:26-48`
- Modify: `frontend/src/lib/adminRnpmApi.ts:16-21` (**NU** `adminApi.ts` — triajul citeaza fisierul gresit)
- Modify: `frontend/src/pages/admin/RnpmStorage.tsx` (`:19`, `:43-53`, `:140-142`) — **al doilea consumator,
  ratat in prima versiune a planului** (finding review adversarial, MEDIUM). Pagina asteapta lista COMPLETA si
  calculeaza local; schimbarea formei o rupe daca nu e ajustata odata cu ruta.
- Test: `backend/src/routes/adminRnpm.test.ts`

**Problema, verificata:** ruta intoarce TOTI userii (`listAllUserIdentities()`, fara limit/offset) si face,
SERIAL, per user, `measureRnpmStorage` (stat pe db/wal/shm) plus `listRnpmBackups` (listare de director sub
lock de mentenanta). La cativa useri e in regula; la cateva sute e o cerere lenta si nelimitata.

**Precizare fata de triaj:** "incalca conventia proiectului" e prea tare. Proiectul are cel putin trei forme de
liste admin: paginata (`admin.ts:237-246`, `{ rows, page, pageSize, total }`), plafonata-fara-paginare
(`{ overrides, truncated }`) si lista simpla — iar `adminRnpm.ts:1-3` spune EXPLICIT ca forma actuala e
deliberata, "paritate cu GET /api/v1/admin/backups". Deci schimbarea e o imbunatatire de scalare, nu
repararea unei incalcari.

Se urmeaza forma paginata din `admin.ts:237-246`, care e cea mai apropiata de conventia web-readiness din
CLAUDE.md.

- [ ] **Step 1: Testul care pica** — `?page=2&pageSize=1` intoarce un singur rand si `total` corect.
- [ ] **Step 2: Adauga schema de query + paginare pe ruta**, dupa modelul `ListUsersQuerySchema`.
- [ ] **Step 3: Adapteaza apelantul frontend** sa citeasca noua forma.
- [ ] **Step 4: Verde + gate (backend + frontend) + commit**

---

## Task 6: RUNBOOK — Varianta 1 fara "opreste aplicatia"

**Files:**
- Modify: `RUNBOOK.md:743-752`

**Verificat:** Varianta 1 da comenzi `DELETE` + `VACUUM` fara instructiune de oprire (doar "reporneste" la
`:744`); Varianta 2, imediat dedesubt, spune "cu aplicatia OPRITA" (`:755`).

**Context atenuant, de pastrat in minte:** premisa sectiunii (`:737`) e "boot-ul aborteaza", deci aplicatia e
deja jos cand operatorul ajunge aici. Fixul ramane justificat — un operator care citeste doar pasul nu
trebuie sa deduca starea din context — dar nu e scenariul de coruptie pe care il sugera triajul.

- [ ] **Step 1: O propozitie** care spune explicit ca aplicatia trebuie sa fie oprita, in acelasi stil ca
      Varianta 2. Fara alte modificari in sectiune.
- [ ] **Step 2: Commit**

---

## Task 7: Lotul cosmetic (un singur commit)

Cele 12 intrari din `audit/CODERABBIT-TRIAJ-2026-07-26.md` sectiunea 2, plus reziduul de la 1.7.

**Inainte de a atinge fiecare, verifica-l in cod** — triajul s-a dovedit ca poate purta afirmatii invechite
(1.7) sau referinte gresite (1.6). Ce nu se confirma, se noteaza si se sare.

Grupe:
plural gresit la numarul 1 (`Dosare.tsx:92`, `Backups.tsx:109`); mesaj de trunchiere inselator
(`UserPicker.tsx:97`); manual PDF care spune "cheia e stocata local" si in web (`export-manual.ts:398`);
413 nedocumentat in OpenAPI (`openapi.ts:66`); trei locuri unde nu se elibereaza conexiunea pe redirect
(`keyValidation.ts:20,60`, `soap.ts:135`); date gresite pentru v2.43.2 in patru documente; comentariu care
promite un lock unic cand sunt doua (`adminRnpm.ts:28-35`); preconditie `foreign_keys=ON` doar in comentariu
(`avizRepository.ts:551`); modal inchidibil in timpul unui backup (`RnpmSavedStats.tsx`); `Ctrl+C` lasa
procese copil (`dev-web-local.ps1:43`); doua reguli de sprint expirate in `SESSION-HANDOFF.md`.

Plus: `recordAudit` pentru kill switch-ul CSRF in `index.ts`, dupa modelul `RNPM_RUNTIME_VALIDATION_DISABLED`
(`:699-716`) — singurul rest real din 1.7.

- [ ] **Step 1: Verifica fiecare intrare in cod, noteaza ce nu se confirma.**
- [ ] **Step 2: Aplica ce s-a confirmat.**
- [ ] **Step 3: Gate complet + un singur commit.**

---

## Task 8: Corecteaza triajul

**Files:**
- Modify: `audit/CODERABBIT-TRIAJ-2026-07-26.md`

Documentul e sursa pentru sesiunile urmatoare; lasat asa, ar retrimite pe cineva sa "repare" 1.7, care e deja
rezolvat.

- [ ] **Step 1:** marcheaza 1.7 ca INFIRMAT, cu commitul `d176019` care a adaugat avertismentul.
- [ ] **Step 2:** corecteaza fisierul frontend la 1.6 (`adminRnpmApi.ts`, nu `adminApi.ts`) si atenueaza
      formularea "incalca conventia".
- [ ] **Step 3:** precizeaza la 1.8 ca se scrie totusi un rand de audit; se pierde motivul granular.
- [ ] **Step 4: Commit**

## Review adversarial Codex pe plan (2026-07-26) — integrat

Sase findinguri, toate re-verificate la sursa. Unul a schimbat designul unui task.

| # | Finding | Severitate | Unde s-a integrat |
|---|---------|-----------|-------------------|
| 1 | Markerul `[split-0041] ` in `reason` putea sterge granturi legitime | CRITICAL | Task 1 — design schimbat: dedup in up, `down.sql` neatins |
| 2 | Calea sincrona ramane pentru useri noi si restaurati | HIGH | Task 2 — corectat partial: userii NOI sunt exceptati prin `existsSync`; restore-ul e rezidual documentat |
| 3 | Cost de boot neplafonat pe multi useri | MEDIUM | Task 2 — acceptat, cu log de progres si durata |
| 4 | `RnpmStorage.tsx` e al doilea consumator al `/usage` | MEDIUM | Task 5 — adaugat la Files |
| 5 | Catch-ul extins ar masca `EACCES`/`EIO` ca "skip" | MEDIUM | Task 4 — declarat, plus clasa de eroare separata pentru I/O |
| 6 | Titlul spunea 7 findinguri, planul insusi infirma unul | LOW | titlu si Goal corectate la 6 |

Codex nu a putut verifica semantica tranzactionala a runner-ului (in afara perimetrului dat). Verificat separat:
migrarile ruleaza in `db.transaction(...)` (`backend/src/db/migrations/runner.ts:226`), deci pasul din Task 1
e atomic.

## Definition of done

- [ ] 1.1: ciclu down→up nu mai dubleaza extra-ul, prin dedup in up (NU prin marker in `reason`); test care
      acopera si al doilea ciclu (down→up→down→up)
- [ ] 1.3: prima cerere dupa upgrade nu mai face snapshot sincron in web mode; restore-ul ramane rezidual
      documentat, userii NOI sunt exceptati prin gardul `existsSync`
- [ ] 1.5: toate TREI handlerele pe `actionInFlightRef`, cu reset in `finally` exterior
- [ ] 1.8: motivul granular de skip se logheaza si cand masuratoarea esueaza; erorile de I/O primesc clasa
      proprie, nu se amesteca cu refuzurile de concurenta
- [ ] 1.6: `/usage` paginat, AMBII consumatori frontend adaptati (`adminRnpmApi.ts` si `RnpmStorage.tsx`)
- [ ] 1.4: RUNBOOK Varianta 1 spune sa opresti aplicatia
- [ ] 1.7: NU se implementeaza (deja rezolvat); doar `recordAudit` in lotul cosmetic
- [ ] Lotul cosmetic intr-un singur commit, cu ce nu s-a confirmat notat explicit
- [ ] Triajul corectat
- [ ] Gate verde, fara regresii fata de 2111 backend / 395 frontend
- [ ] Commituri separate, pe `feat/v2.43.0-rnpm-split`, nepushuite
