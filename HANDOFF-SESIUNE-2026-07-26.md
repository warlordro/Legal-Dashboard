# Handoff sesiune — 2026-07-26

**Branch:** `feat/v2.43.0-rnpm-split` (NU `main` — `main` e urmarit de Dokploy, push acolo = deploy in productie)
**Ultimul push:** `4ff06ce` (2026-07-26 03:21). Local suntem inaintea remote-ului cu commituri de documentatie — vezi sectiunea 5.
**Stare cod:** nimic remediat in aceasta sesiune. Tot ce urmeaza e triaj verificat la sursa, nu backlog copiat.

Doua fluxuri de lucru deschise, in ordinea in care se ataca:

| # | Flux | Sursa detaliilor | Volum |
|---|------|------------------|-------|
| A | Cele 3 findings de securitate care blocheaza web deploy | [HANDOFF-SEC-WEB-BLOCKERS-F12-2026-07-26.md](HANDOFF-SEC-WEB-BLOCKERS-F12-2026-07-26.md) | ~5h |
| B | Review CodeRabbit din 2026-07-26 (54 comentarii) | [audit/CODERABBIT-TRIAJ-2026-07-26.md](audit/CODERABBIT-TRIAJ-2026-07-26.md) | 9 fixuri + 1 commit ieftin |

**Ordinea:** intai A (web deploy e prioritatea declarata a proiectului, iar F12-F5 scurge cheia
2Captcha a tenantului), apoi cele 9 din B care merita, apoi cele 18 cosmetice intr-un singur commit.
Fara ordinea asta scrisa, o sesiune noua alege dupa ce citeste prima.

## 1. Fluxul A — securitate (rezumat; detaliile in documentul dedicat)

Trei findings din scanul de securitate 2026-07-24 (Faza 12 din [HARDENING.md](HARDENING.md)),
re-verificate la sursa pe 2026-07-26:

| ID | Ce e | Efort |
|----|------|-------|
| F12-F3 | `gcode` din body ocoleste limita de stocare RNPM | ~3h |
| F12-F5 | cheia captcha a tenantului ajunge in raspunsul 500 si in loguri | ~1.5h |
| F12-F8 | `/api/v1/tokens*` fara `requireRole("admin")` — gardul e doar in UI | ~30 min + test |

Nu duplic aici lanturile de verificare, capcanele si directiile de fix — sunt in
[HANDOFF-SEC-WEB-BLOCKERS-F12-2026-07-26.md](HANDOFF-SEC-WEB-BLOCKERS-F12-2026-07-26.md),
sectiunile 3, 4 si 8. Primul pas de acolo e o intrebare catre user (PAT-urile sunt admin-only
sau self-service), nu cod.

## 2. Fluxul B — CodeRabbit 2026-07-26

Review pe `6f326e4` → `4ff06ce`, 54 comentarii in 45 de fisiere, toate marcate `actionable`.
Verdictul dupa verificarea fiecaruia in cod:

| Categorie | Cate | Ce facem |
|-----------|------|----------|
| Merita reparate | 9 | sectiunea 3 de mai jos |
| Ieftine, cosmetice | 18 | un singur commit, la final |
| Corecte dar blocate de politica (infra) | 3 | nu le atingem — sectiunea 6 |
| Fals pozitive | 12 | inchise, sectiunea 4 |
| Documente istorice | 12 | fara actiune, cu doua exceptii — sectiunea 4 |

Rata reala de utilitate: **27 din 54**. Export brut, cu textul integral al fiecarui comentariu:
[audit/CODERABBIT-REVIEW-2026-07-26.md](audit/CODERABBIT-REVIEW-2026-07-26.md).

## 3. Cele 9 care merita reparate

Numerotarea `1.x` e cea din documentul de triaj, unde fiecare are analiza completa.
`1.6` acopera doua comentarii CodeRabbit (#19 si #44), de aceea 9 findings in 8 sectiuni.

| # | Problema | Gravitate | Locul |
|---|----------|-----------|-------|
| 1.1 | rollback-ul migratiei dubleaza grantul AI | MEDIU | `backend/src/db/migrations/0041_unified_ai_quota.down.sql:13-17` |
| 1.2 | captcha consumata chiar si cand cererea pica pe 409 | MEDIU | `backend/src/routes/rnpm.ts:247-261` |
| 1.3 | snapshotul sincron blocheaza serverul (doar web) | MEDIU | `backend/src/db/rnpmDb.ts:58-78` |
| 1.4 | RUNBOOK-ul de restore nu spune "opreste aplicatia" | MEDIU | `RUNBOOK.md:743-752` |
| 1.5 | dublu-click pe backup = doua backupuri | MIC-MEDIU | `frontend/src/pages/admin/Backups.tsx:65-116` |
| 1.6 | `/usage` admin fara paginare | MIC-MEDIU | `backend/src/routes/adminRnpm.ts:26-48` + `frontend/src/lib/adminApi.ts:157-172` |
| 1.7 | kill switch CSRF fara log | MIC | `backend/src/middleware/requireDesktopHeaderGlobal.ts:19` |
| 1.8 | autocompact sarit fara nicio urma in log | MIC | `backend/src/db/backup.ts:1184-1214` |

Trei lucruri de retinut inainte de a incepe:

**1.2 se face impreuna cu F12-F3.** Ambele stau in acelasi bloc de admitere din `rnpm.ts`
(F12-F3 la `:243-246`, 1.2 la `:247-261`). Commituri separate, dar o singura trecere peste bloc.
La 1.2 verificarea de restore trebuie mutata inainte de consumul captchei, dar **dupa** rezolvarea
configului de captcha — altfel se pierde 501-ul canonic din web mode. Aceeasi ordine trebuie
replicata pe `/bulk` si `/search-split`.

**1.5 are deja patternul corect in repo:** `frontend/src/pages/admin/RnpmStorage.tsx:41`
foloseste `actionInFlightRef`. Nu inventa altul.

**1.3 e mai putin grav decat suna.** Masurat: ~120 ms pentru o baza de 103 MB, o singura data
per user per upgrade de schema. Merita facut asincron, dar nu e incident.

## 4. Ce am inchis eu, ca sa nu se re-deschida

Astea nu sunt concluziile CodeRabbit, sunt ale mele dupa verificare in cod. Dovezile sunt in
documentul de triaj, sectiunile 4 si 5.

- **Aceeasi eroare repetata de 4 ori** (#45, #47, #48, #49): CodeRabbit citeste `Necunoscut (${token})`
  ca pe un bug de afisare. E conventie deliberata a repo-ului, documentata in `auditOutcome.ts:3-4`,
  `quotaFeatureLabels.ts:28-30`, `quotaPeriodLabels.ts:16-18`. Un token backend necunoscut trebuie
  sa se vada, nu sa fie ascuns.
- **#17 / #18 ar face revert la un fix deliberat** — vezi `admin.ts:957-961`. A le "repara" inseamna
  a reintroduce bug-ul reparat anterior.
- **#9, #13, #15, #43, #53, #25** — fals pozitive verificate individual (fara `await` intre linii deci
  fara interleaving; garda deja existenta; cod sincron cu try/catch per operatie; state setat sincron;
  textul cerut exista deja; SQL raw intr-un fixture de test).
- **Doua documente sunt trunchiate si NU se pot recupera:** `HANDOFF-EXECUTIE-REMEDIERE-AUDIT-v2.43-2026-07-19.md`
  (7 linii, se opreste in mijlocul unui cuvant) si `docs/superpowers/plans/2026-07-19-remediere-audit-sec-v2.43.md`
  (5 linii, la fel). Au intrat in git deja trunchiate, in `41d9ca4` — nu exista versiune intreaga
  nicaieri. Munca pe care o descriau a fost oricum livrata (39 commituri, MR !3, 2026-07-19).
  Optiuni: le lasi ca fragmente sau le stergi. Nu incerca sa le "recuperezi".
- **Nu am verificat** daca Dokploy chiar injecteaza `APP_VERSION` — de asta cele 3 findings de infra
  (sectiunea 6) sunt marcate "corecte, dar netestate de mine", nu "fals pozitive".

## 5. Stare git

Un singur commit de documentatie nepushuit peste `origin/feat/v2.43.0-rnpm-split`: raportul de
audit securitate, Faza 12 din HARDENING.md, handoff-ul F12, exportul si triajul CodeRabbit, si
acest document.

**Tinut nepushuit intentionat.** Publica pe GitLab un inventar de probleme exploatabile
neremediate: handoff-ul F12 contine lanturile complete cu file:line, iar sectiunea 1 de mai sus le
rezumeaza oricum suficient cat sa fie actionabile ("trimite orice `gcode` nevid", "loveste ruta
ca user non-admin"). De aceea totul sta intr-un singur commit — nu exista o bucata "neutra" care
sa poata urca separat.

Verificat pe 2026-07-26: versiunea pushuita a `SESSION-HANDOFF.md` nu contine inca pointerul
catre cele 3 findings, deci pe GitLab nu a ajuns nimic. Verifica intotdeauna
`git log --oneline origin/feat/v2.43.0-rnpm-split..HEAD` inainte de push si intreaba userul.

## 6. Ce nu se atinge

- **Infra:** Dokploy, `docker-compose.yml`, `deploy/`. Decizia userului, explicita. Blocheaza
  findings #27 (`deploy/.env.prod.example:87`), #28 (`deploy/docker-compose.prod.yml:84`),
  #29 (`docker-compose.yml:82`) — toate acelasi lucru: fallback hardcodat `2.43.0` pentru versiune.
- **`main`** — push acolo declanseaza deploy prin Dokploy.
- **`PowerShell-7.6.4-win-x64.msi` de la radacina** — nu e in `.gitignore`. Niciodata `git add -A`;
  doar staging pe cai explicite. Nu-l sterge si nu-l adauga in gitignore fara sa intrebi.
- **Celelalte 9 findings F12** — sunt in HARDENING.md, se rezolva separat, ca sa ramana delta-ul
  reviewabil.

## 7. Gate pre-push si mediu

Gate-ul complet, falsul pozitiv cunoscut de la biome si baseline-ul de teste (2078 backend / 395 frontend
la `4ff06ce`) sunt in [HANDOFF-SEC-WEB-BLOCKERS-F12-2026-07-26.md](HANDOFF-SEC-WEB-BLOCKERS-F12-2026-07-26.md),
sectiunea 5. Nu le duplic.

Confirmarea live se face pe **web mode**, nu pe desktop. Daca totusi pornesti Electron:
`npm run rebuild:electron` e obligatoriu inainte de `npm run electron:dev` — ABI-ul `better-sqlite3`
e compilat acum pentru Node, dupa ultima rulare de teste.

## 8. Cum s-a obtinut exportul CodeRabbit (daca mai trebuie o data)

Extensia VS Code nu are comanda de export; datele stau intr-un JSON de ~97 MB in
`%APPDATA%/Code/User/workspaceStorage/<hash>/coderabbit.coderabbit-vscode/`. Scriptul care le
extrage e in scratchpad-ul sesiunii (`export-coderabbit.mjs`) — daca nu mai exista, punctele care
conteaza sunt: folderul workspace-ului e salvat ca URI cu encoding inconsistent (`file:///c%3A/...%20...`),
deci comparatia se face pe cale decodata; fisierul de review e cel mai mare `.json` din folder
(exclus `categories.json`); rularea cere `--max-old-space-size=4096`.
