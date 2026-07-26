# Triaj CodeRabbit — review 2026-07-26 (54 comentarii)

**Sursa:** [CODERABBIT-REVIEW-2026-07-26.md](CODERABBIT-REVIEW-2026-07-26.md) (base `6f326e4` -> head `4ff06ce`)
**Metoda:** fiecare finding pe cod a fost verificat citind fisierul real, nu preluat din raport.
Cele 10 findings de pe planurile de sprint inchise (#30-#39) au primit un verdict de clasa,
nu au fost deschise individual. #3 si #4 au fost verificate direct.

**Numerotare:** findings-urile sunt numerotate 1-54 in ordinea alfabetica a fisierelor din
[raport](CODERABBIT-REVIEW-2026-07-26.md) (`CHANGELOG.md`=1 ... `scripts/dev-web-local.ps1`=54).

> **Status executie (2026-07-26):** 1.2 livrat in Fluxul A (`706b9ae`). Restul de sase livrate in
> Fluxul B: `0ae2c4e` (1.1), `547c48b` (1.3), `4c17c31` (1.4), `9203358` (1.5), `2f051a5` (1.6),
> `a7a92e8` (1.8), plus `56bb969` pentru lotul cosmetic. **1.7 e INFIRMAT** — vezi sectiunea lui.
> Plan si trasabilitate: [docs/superpowers/plans/2026-07-26-flux-b-coderabbit.md](../docs/superpowers/plans/2026-07-26-flux-b-coderabbit.md).

## Verdict

| Categorie | Nr. | Gravitate | Ce faci |
|-----------|----:|-----------|---------|
| Merita reparate | 9 | MEDIU spre MIC | vezi lista 1 (9 findings in 8 sectiuni — 1.6 acopera doua) |
| Ieftine, cosmetice | 18 | toate MIC | lista 2, un singur commit |
| Corecte dar blocate de politica ta (infra) | 3 | MIC | NU se ating |
| Fals pozitive | 12 | fara gravitate (nu sunt reale) | se ignora |
| Documente istorice | 12 | fara impact pe cod | se ignora, minus 2 exceptii (§5) |

Rata reala de utilitate: **27 din 54** (50%). Restul e zgomot sau lucruri pe care le-ai
decis deja altfel.

---

## 1. Merita reparate

### 1.1 Bugetul AI acordat se dubleaza la rollback — MEDIU
`backend/src/db/migrations/0041_unified_ai_quota.down.sql:13-17`

Daca dai rollback la migrarea 41 si apoi urci la loc, fiecare grant de buget AI se
numara de doua ori. Down-ul face din 1 rand doua (`ai.single` + `ai.multi`), iar up-ul
le redenumeste pe amandoua inapoi in `ai`. Verificat citind ambele fisiere: up-ul face
`UPDATE ... SET feature='ai' WHERE feature IN ('ai.single','ai.multi')`, deci nu are cum
sa distinga copia.

Conteaza pentru ca deploy-ul web e prin Dokploy, iar un rollback e plauzibil.
Fix: marcheaza copia in down (prefix in `reason`) si sterge randurile marcate in up.

### 1.2 Un captcha se consuma degeaba pe 409 — MEDIU
`backend/src/routes/rnpm.ts:247-261`

Gardul de captcha ruleaza inainte de verificarea de restore. Daca userul cauta in RNPM
exact cand ii ruleaza o restaurare, cererea e respinsa cu 409 — dar rezervarea de captcha
s-a facut deja si nu se intoarce. Userul pierde un slot din cota lui zilnica pentru o
cerere care n-a facut nimic.

Doar in mod web (calea `tenant`). Fix: muta verificarea de restore inaintea contorizarii,
dar **dupa** rezolutia de configuratie captcha — altfel modul web isi pierde raspunsul
canonic 501. Aceeasi ordine pe `/bulk` si `/search-split`.

### 1.3 Prima cerere dupa un upgrade blocheaza serverul — MEDIU (doar web)
`backend/src/db/rnpmDb.ts:58-78`

Cand un user atinge prima data baza lui RNPM dupa un upgrade cu migrari noi, se face un
snapshot de siguranta cu operatii **sincrone** (`mkdirSync`, `VACUUM INTO`). Pe desktop e
invizibil. Pe web, cat timp ruleaza, tot serverul sta — cererile celorlalti useri asteapta.
Masurat in smoke: o baza de 103 MB dureaza ~120 ms; timpul creste cu marimea bazei.
Inseamna un inghet global scurt, o singura data per user dupa fiecare upgrade.

Fix: incalzeste handle-urile la boot sau muta snapshotul in worker-ul care exista deja.

### 1.4 RUNBOOK: lipseste "opreste aplicatia" — MEDIU
`RUNBOOK.md:743-752`

Varianta 1 de remediere iti da comenzi `DELETE` pe baza restaurata fara sa spuna sa
opresti aplicatia. Varianta 2, imediat dedesubt, spune explicit "cu aplicatia OPRITA".
Un operator care urmeaza varianta 1 scrie in SQLite sub aplicatia vie. Fix: o propozitie.

### 1.5 Doua click-uri = doua backup-uri — MIC spre MEDIU
`frontend/src/pages/admin/Backups.tsx:65-116`

Garda de dublu-click citeste state React (`if (busy) return`), care nu s-a actualizat inca
la al doilea click din aceeasi fractiune de secunda. Ai deja solutia corecta in
`frontend/src/pages/admin/RnpmStorage.tsx:41` (`actionInFlightRef`) — verificat, exista si
functioneaza. Aici lipseste. La creare de backup inseamna doua scrieri reale.

### 1.6 Lista admin de useri nu are paginare — MIC spre MEDIU (#19 + #44)
`backend/src/routes/adminRnpm.ts:26-48` (+ `frontend/src/lib/adminRnpmApi.ts:16-21` si
`frontend/src/pages/admin/RnpmStorage.tsx`)

**Corectie (2026-07-26):** fisierul frontend citat initial (`adminApi.ts:157-172`) e ALTUL —
acolo sunt override-urile de cota, fara legatura cu `/usage`. Consumatorii reali sunt cei doi
de mai sus; al doilea a fost ratat si in prima versiune a planului de implementare.

`/usage` intoarce toti userii, iar pentru fiecare face masuratori de fisier si listeaza
directorul de backup-uri. La cativa useri e in regula; la cateva sute devine o cerere
lenta si nelimitata.

**Atenuare (2026-07-26):** "incalca conventia proprie a proiectului" e prea tare. Proiectul are
cel putin trei forme de liste admin — paginata (`admin.ts:237-246`), plafonata-fara-paginare
(`{ overrides, truncated }`) si lista simpla — iar `adminRnpm.ts:1-3` spune EXPLICIT ca forma
actuala e deliberata, "paritate cu GET /api/v1/admin/backups". Schimbarea e o imbunatatire de
scalare, nu repararea unei incalcari.

### 1.7 Kill-switch-ul CSRF se activeaza fara sa spuna nimic — ~~MIC~~ **INFIRMAT (2026-07-26)**
`backend/src/middleware/requireDesktopHeaderGlobal.ts:19`

**Afirmatia era INVECHITA.** Avertismentul la boot exista deja: `backend/src/index.ts:718-726`
emite `csrf.hardening.disabled.boot`, adaugat in commitul `d176019`. Gardul warn-ului
(`getAuthMode() === "desktop"`) oglindeste exact early-return-ul middleware-ului, deci nu
exista nici gaura de acoperire. Findingul original venea din raportul CodeRabbit, care
*propunea* codul ce fusese deja aplicat.

Ce ramanea real, si e mult mai mic: alte kill switches scriu si in `audit_log` pe langa
`console.warn` (vezi `RNPM_RUNTIME_VALIDATION_DISABLED`, `index.ts:699-716` — "operatorul
vede warn-ul in stdout, complianta vede entry-ul in audit_log"), iar ramura CSRF are doar
warn. Nu s-a implementat: e o alegere de politica de audit, nu un bug.

### 1.8 Un skip de autocompactare nu se logheaza — MIC
`backend/src/db/backup.ts:1184-1214`

Masuratoarea de dinainte de compactare e in afara blocului `try`. Daca esueaza, nu se scrie
evenimentul structurat de "skip". **Nu** e un crash: am verificat apelantul (`rnpm.ts:84`) si
are `.catch`. E strict o gaura de observabilitate.

**Precizare (2026-07-26):** "doar un `console.error` generic" e inexact. `.catch`-ul INTOARCE o
valoare in loc sa re-arunce, deci executia continua la `recordAuditSafe` si se scrie totusi un
rand de audit cu `reason: "error"`. Ce se pierdea efectiv: motivul granular (`search_active` /
`restore_in_progress` / `maintenance_shutdown` / `enospc`, colapsate in `"error"`) si `durationMs`.

---

## 2. Ieftine (un singur commit)

| # | Fisier | Ce e |
|---|--------|------|
| 50 | `frontend/src/pages/Dosare.tsx:92` | "si alte **1** instante" cand exact 4 instante pica |
| 51 | `frontend/src/pages/admin/Backups.tsx:109` | "**1** backup-uri sterse" |
| 40 | `frontend/src/components/UserPicker.tsx:97` | zice "trunchiata la 1000" si cand nu asta a fost motivul |
| 46 | `frontend/src/lib/export-manual.ts:398` | manualul PDF zice "cheia e stocata local" si pentru web, unde e pe server |
| 21 | `backend/src/routes/openapi.ts:66` | `/api/dosare` chiar raspunde 413 (verificat: `dosare.ts:224,247`), dar spec-ul nu-l documenteaza |
| 23, 24, 26 | `keyValidation.ts:20,60` + `soap.ts:135` | pe raspuns de redirect nu se elibereaza conexiunea; 3 linii identice |
| 1, 2, 8, 42 | CHANGELOG, DOCUMENTATIE, SESSION-HANDOFF, changelog-entries | v2.43.2 e datat 21 iulie, dar contine schimbari din 22 si 25 iulie |
| 20 | `backend/src/routes/adminRnpm.ts:28-35` | comentariul promite un lock unic; in realitate sunt doua lock-uri separate |
| 10 | `backend/src/db/avizRepository.ts:551` | preconditia `foreign_keys=ON` traieste doar intr-un comentariu |
| 41 | `frontend/src/components/rnpm/RnpmSavedStats.tsx:103,226,242` | modalul se poate inchide in timpul unui backup |
| 54 | `scripts/dev-web-local.ps1:43` | Ctrl+C lasa procese copil in viata |
| 6, 7 | `SESSION-HANDOFF.md` | reguli de sprint expirate, risc marcat "de rezolvat in v2.42.0" |

## 3. Corecte, dar NU le atingem

| # | Fisier | Ce |
|---|--------|-----|
| 27 | `deploy/.env.prod.example:87` | `APP_VERSION=2.43.0` |
| 28 | `deploy/docker-compose.prod.yml:84` | `image: legal-dashboard:${APP_VERSION:-2.43.0}` |
| 29 | `docker-compose.yml:82` | idem |

Findings reale: fallback-ul a ramas la 2.43.0. Dar ai stabilit ca infra (Dokploy,
`docker-compose.yml`, `deploy/`) nu se atinge — motiv suficient. Nu am verificat daca
Dokploy chiar injecteaza `APP_VERSION` (ar face fallback-ul irelevant); ramane la decizia ta.

## 4. Fals pozitive (12) — de ce cad

**#45, #47, #48, #49 — patru findings, o singura neintelegere.** CodeRabbit cere sa nu
afisezi token-uri necunoscute si citeaza conventia proiectului. Dar conventia proiectului
**este exact** `Necunoscut (token)` — scris negru pe alb in `auditOutcome.ts:3-4`,
`quotaFeatureLabels.ts:28-30` si `quotaPeriodLabels.ts:16-18`, cu tokenul pastrat in
paranteze pentru diagnostic. Cere sa schimbi o decizie luata deliberat.

**#43 — cheile AI pe desktop.** Sustine ca exista o fereastra in care desktopul trimite
cereri fara chei. Am citit `useTenantKeyStatus.ts:82-88`: pe desktop starea se seteaza
**sincron** la bootstrap, inainte ca userul sa poata da vreun click. Fereastra nu exista
practic.

**#9 — stergere de aviz raportata ca eroare.** Scenariul cere ca o restaurare sa porneasca
intre commit si checkpoint. Intre acele doua linii (`avizRepository.ts:540-542`) nu exista
niciun `await`, deci JavaScript nu poate rula altceva. Imposibil.

**#13 — latch de restore ne-reentrant.** Toate cele 4 locuri care il folosesc verifica deja
explicit inainte (`backup.ts:943, 1057, 1134, 1224`), sub acelasi lock global, cu comentarii
care descriu fix problema semnalata si cu test dedicat. Deja inchis.

**#15 — purge care omoara procesul.** Am citit `retentionPurge.ts`: functia e sincrona si
are `try/catch` separat pe fiecare din cele doua operatii. Nu poate arunca.

**#53 — text contradictoriu in Quota.** Sustine ca mesajul nu spune la ce se refera
"nelimitat". `Quota.tsx:296` spune literal "(AI si captcha)". Deja corect.

**#17, #18 — baza de calcul pentru granturi.** Ar face ca pe desktop sa nu mai poti acorda
granturi deloc. Comentariul de la `admin.ts:957-961` arata ca forma actuala e un fix
deliberat dintr-un review anterior. A o "repara" ar readuce bug-ul vechi.

**#25 — SQL brut in test.** Conventia repository-only tinteste codul de productie, nu
fixture-urile de test.

## 5. Documente istorice (12) — se ignora, cu doua exceptii

Findings 3, 4, 30-39: planuri si handoff-uri de sprint deja inchise. Sunt inregistrari a
ce s-a decis atunci; "corectarea" lor rescrie istoricul fara sa schimbe nimic in cod.
Cele 10 de pe planuri (#30-#39) au primit verdict de clasa, nu au fost deschise unul cate unul.

### Exceptie verificata: doua fisiere sunt chiar trunchiate — MIC (pierdere de continut)

| # | Fisier | Stare reala |
|---|--------|-------------|
| 4 | `HANDOFF-EXECUTIE-REMEDIERE-AUDIT-v2.43-2026-07-19.md` | 7 linii, se opreste in mijlocul cuvantului ("23 findings verificate pe cod — v") |
| 38 | `docs/superpowers/plans/2026-07-19-remediere-audit-sec-v2.43.md` | 5 linii, se opreste la "workflow-ul de verificare independ" |

Nu e o eroare de continut, e continut lipsa. **Nu se poate recupera din git**: ambele au
intrat trunchiate in commit-ul de arhivare `41d9ca4`, nu exista versiune completa in istoric.
Lucrarea pe care o descriau e oricum livrata (39 commits, MR !3, 2026-07-19), deci optiunile
sunt: le lasi ca fragmente, sau le stergi. Nu blocheaza nimic.
