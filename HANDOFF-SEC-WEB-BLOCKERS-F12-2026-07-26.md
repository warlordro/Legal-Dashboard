# Handoff — cele 3 findings F12 care blocheaza web deploy (F12-F3, F12-F5, F12-F8)

**Data:** 2026-07-26
**Branch:** `feat/v2.43.0-rnpm-split` (NU `main` — `main` e urmarit de Dokploy)
**Autor handoff:** sesiunea Claude Opus 5 din 2026-07-25/26
**Stare:** nimic remediat. Cele 3 sunt verificate la sursa in aceasta sesiune (nu preluate pe incredere din raport).

## 1. Ce livram

Remedierea a TREI findings din scanul de securitate 2026-07-24 (Faza 12), alese pentru ca
sunt singurele din cele 12 care ating direct suprafata web:

| ID | Titlu scurt | Impact in web mode | Efort |
|----|-------------|--------------------|-------|
| F12-F3 | `gcode` din body ocoleste limita de stocare RNPM | orice user isi umple cota fara oprire | ~3h |
| F12-F5 | cheia captcha ajunge in raspunsul 500 catre client | cheia 2Captcha a TENANTULUI, expusa oricarui user autentificat | ~1.5h |
| F12-F8 | `/api/v1/tokens*` fara `requireRole("admin")` | orice user non-admin isi emite PAT-uri | ~30 min + test |

Restul de 9 findings (F12-F1, F12-F2, F12-F4, F12-F6, F12-F7, F12-F7b, F12-F9..F12-F12 —
9 findings pe 10 id-uri, pentru ca F12-F7b e addendum documentar la F12-F7, nu finding separat)
raman in [HARDENING.md](HARDENING.md), sectiunea Faza 12 — **sursa unica**, nu le duplic aici.
Raportul integral: `audit/AUDIT-CLAUDE-SECURITY-SCAN-v2.43.2-2026-07-24.md`.

## 2. Decizii inchise (nu le redeschide)

- Nu se atinge nimic din infra: Dokploy, `docker-compose.yml`, `deploy/`. Userul a stabilit explicit.
- Nu se face push pe `main`. `main` = deploy productie prin Dokploy.
- `PowerShell-7.6.4-win-x64.msi` de la radacina NU e in `.gitignore`. Niciodata `git add -A`;
  doar staging pe cai explicite.
- Prioritatea proiectului e WEB DEPLOY, nu Electron. De aceea exact aceste 3 si nu altele.
- **DESCHIS, nu inchis:** singurul commit nepushuit de pe branch (acest handoff + raportul de
  audit + Faza 12 din HARDENING + triajul CodeRabbit + handoff-ul de sesiune) e tinut local
  intentionat — publica pe GitLab inventarul a 3 probleme exploatabile neremediate, cu file:line.
  Userul nu a decis inca daca urca. Verifica
  `git log --oneline origin/feat/v2.43.0-rnpm-split..HEAD` inainte de orice push: daca e inca
  acolo si nu exista decizie explicita, intreaba inainte sa-l urci odata cu fixurile.

## 3. Date verificate la sursa (in aceasta sesiune, nu preluate din raport)

### F12-F3 — bypass limita de stocare prin `gcode` — CONFIRMAT

Doua puncte pe acelasi lant, ambele conditionate de acelasi camp controlat de client:

`backend/src/routes/rnpm.ts:243-246` (admitere):
```ts
const previewGcode = (parsedBody as { gcode?: unknown }).gcode;
if (!(typeof previewGcode === "string" && previewGcode.length > 0)) {
  await assertRnpmStorageWithinLimit(ownerId);
}
```

`backend/src/services/rnpmSearchService.ts:371` (recheck intre paginile interne):
```ts
if (!existingGcode) await input.storageLimitCheck?.(ownerId);
```

Consecinta: un `gcode` non-gol trimis din browser sare peste verificarea de cota la
admitere SI peste recheck-ul din timpul paginarii. Nu e nevoie de un `gcode` valid la
primul apel — conditia e doar `typeof === "string" && length > 0`.

**Capcana care se pierde usor:** `backend/src/services/rnpmStorageRecheck.test.ts:96`
codifica comportamentul ACTUAL ca fiind cel asteptat. Fixul TREBUIE sa actualizeze acel
test, altfel suita pica si arata ca o regresie cand de fapt e corectarea intentiei.

**Directia de fix** (de validat la implementare): limita se verifica intotdeauna la
admitere, indiferent de `gcode`. `gcode` marcheaza continuarea unei cautari deja pornite,
nu o scutire de cota — daca exista un motiv real pentru care continuarea trebuie sa scape
de limita (ca sa nu lase o cautare la jumatate), atunci gcode-ul trebuie legat de un
`searchId` propriu owner-ului si validat, nu acceptat ca string liber.

### F12-F5 — cheia captcha in corpul raspunsului 500 — CONFIRMAT CAP-COADA

Lantul complet, fiecare veriga citita in fisier:

1. `node_modules/@2captcha/captcha-solver/dist/structs/2captcha.js:63` —
   `get defaultPayload() { return { key: this.apikey, json: 1, ... } }`
2. acelasi fisier `:172` — `fetch(this.in + utils.objectToURI(payload))`, deci URL-ul
   contine `key=<apikey>` in query string
3. `node_modules/node-fetch/lib/index.js:1501` —
   ``reject(new FetchError(`request to ${request.url} failed, reason: ${err.message}`, ...))``
   → pe orice eroare de retea (DNS, ECONNREFUSED, TLS) mesajul contine URL-ul intreg
4. `backend/src/services/captchaSolver.ts:83` —
   ``throw new CaptchaError(`Eroare 2Captcha: ${msg}`, e)``. Filtrele de la `:80-81`
   (`ERROR_ZERO_BALANCE`, `ERROR_WRONG_USER_KEY`) NU prind un `FetchError`, deci mesajul
   trece nemodificat
5. `backend/src/routes/rnpm.ts:368-370` — `console.error("[rnpm/search]", msg)` +
   `return internalError(c, msg)`
6. `backend/src/routes/rnpm.ts:76-77` — `internalError` e un helper LOCAL:
   `c.json(fail(ErrorCodes.INTERNAL_ERROR, message, c), 500)`. Nu sanitizeaza nimic.
7. `backend/src/util/envelope.ts:79-83` — `fail` pune `message` verbatim in
   `{ data: null, error: { code, message }, requestId }`

Deci cheia ajunge in DOUA locuri: corpul HTTP 500 catre client si logurile procesului.

**De ce e mai grav in web decat pe desktop:** pe desktop cheia e a userului insusi.
In web mode `resolveCaptchaKeyForRoute` intoarce `source === "tenant"`
(`backend/src/routes/rnpm.ts:238-241`) — cheia este cea configurata de admin la nivel de
tenant. Orice user autentificat, sau orice detinator de PAT cu scope `rnpm`, care reuseste
sa provoace o eroare de retea catre 2Captcha primeste cheia comuna in raspuns.

**Directia de fix:** `rnpm.ts:370` nu trebuie sa intoarca `msg` brut. Mesaj generic catre
client (in stilul celorlalte 9 apeluri `internalError` din acelasi fisier, care deja
folosesc texte fixe cu trimitere la `requestId`) + detaliul doar in log, dupa redactarea
query string-ului. Redactarea e necesara si in log — `console.error` de la `:369` scrie
azi cheia in stdout, care in Docker ajunge in log driver.

### F12-F8 — `/api/v1/tokens*` fara gard de rol — CONFIRMAT

`backend/src/routes/apiTokens.ts:14-28` are un singur gard: PAT-ul nu poate administra
tokenuri (`ErrorCodes.PAT_CANNOT_MANAGE_TOKENS`). Nu exista `requireRole("admin")`.
`backend/src/index.ts:361` monteaza `app.route("/api/v1/tokens", apiTokensRouter);` fara
gard de rol.

Singura restrictie azi e in UI: `frontend/src/components/ApiKeyDialog.tsx:133` si
`frontend/src/pages/Settings.tsx:110`. Un gard doar in frontend nu e un gard — un apel
direct cu cookie de sesiune de user normal creeaza un PAT.

**Directia de fix:** `requireRole("admin")` pe router, plus un test care loveste ruta cu
sesiune non-admin si asteapta 403. Verifica inainte daca intentia de produs e chiar
"doar adminii emit PAT-uri" — UI-ul o presupune, dar merita confirmat cu userul, pentru ca
alternativa (fiecare user isi emite propriile tokenuri, scoped la el) e o decizie de
produs, nu un bug.

## 4. Executie

### Pas 1 — confirma intentia pe F12-F8
Intreaba userul: PAT-urile sunt admin-only (cum presupune UI-ul) sau self-service per user?
Raspunsul schimba fixul. Nu ghici.

### Pas 2 — F12-F8 (cel mai mic, primul)
Gard pe router + test 403 pe sesiune non-admin. Verifica sa nu strici testele existente
de PAT si fluxul din `Settings.tsx`.

### Pas 3 — F12-F5
Mesaj generic in `internalError` + redactare in log. Test: forteaza un `FetchError` din
solver si verifica ca (a) corpul raspunsului nu contine cheia si (b) nici linia de log.

### Pas 4 — F12-F3
Muta verificarea de cota inainte de ramura pe `gcode` in ambele puncte
(`rnpm.ts:243-246` si `rnpmSearchService.ts:371`). **Actualizeaza
`rnpmStorageRecheck.test.ts:96`** — vezi capcana de la sectiunea 3. Test nou: cerere cu
`gcode` arbitrar peste limita → 429 cu cifre, nu 200.

**Atentie la suprapunere:** finding-ul CodeRabbit 1.2 (captcha consumat inainte de verificarea
de restore, `rnpm.ts:247-261`) sta pe liniile imediat urmatoare, in acelasi bloc de admitere.
Se face in aceeasi trecere peste bloc, in commituri separate — altfel a doua sesiune reface
verificarea si intra in conflict. Vezi [HANDOFF-SESIUNE-2026-07-26.md](HANDOFF-SESIUNE-2026-07-26.md).

### Pas 5 — gate + commit
Vezi sectiunea 5. Commit separat per finding, ca sa se poata da revert punctual.

## 5. Gate pre-push (non-negociabil, ordinea din CLAUDE.md)

1. `npx biome check --write <fisierele atinse>` — re-stage ce reformateaza biome
2. `npx tsc --noEmit -p backend/tsconfig.json` si `cd frontend && npx tsc --noEmit`
3. `npm run build`
4. `npm test --workspace=backend` + `cd frontend && npm test -- --run`
5. abia apoi commit

**Fals pozitiv cunoscut la pasul 1:** `npx biome check .` pe tot repo-ul raporteaza 1 eroare
intr-un artefact de scan cu CRLF, `CLAUDE-SECURITY-20260724-195947/CLAUDE-SECURITY-REVISION-c5dd9697e2e3-dirty.json`.
Directorul se auto-ignora (`CLAUDE-SECURITY-20260724-195947/.gitignore:1:*`), `git ls-files`
pe el intoarce gol, deci nu e tracked si nu ajunge niciodata pe remote. NU e un blocker —
verificat in sesiunea din 2026-07-25.

**Baseline de referinta la ultimul gate verde (commit `4ff06ce`):** 2078 teste backend
trecute / 8 skipped, 395 teste frontend trecute.

## 6. Confirmare live

Pentru F12-F5 si F12-F3, confirmarea utila e pe web mode, nu pe desktop — ambele isi
schimba comportamentul in functie de `getAuthMode()` si de sursa cheii captcha (tenant vs
body). Foloseste scripturile din repo, nu comenzi inline cu tokenuri.

Daca totusi rulezi Electron: **`npm run rebuild:electron` e obligatoriu inainte de
`npm run electron:dev`** — ABI-ul `better-sqlite3` pentru Electron e rupt in acest moment
(ultima rulare de teste l-a recompilat pentru Node).

## 7. Ce NU se atinge

- Dokploy, `docker-compose.yml`, `deploy/` — off-limits prin decizia userului.
- `main` — push acolo = deploy in productie.
- Celelalte 9 findings F12. Sunt in HARDENING.md; nu le rezolva "pe drum", ca sa ramana
  delta-ul reviewabil.
- Fisierul `.msi` de la radacina — nu il stage-ui, nu il sterge, nu il adauga in gitignore
  fara sa intrebi.

## 8. Capcane descoperite la verificare (nu le reintroduce)

- **`rnpmStorageRecheck.test.ts:96` codifica bug-ul ca asteptare.** Un fix corect FACE testul
  sa pice. Actualizeaza-l odata cu fixul, nu dupa.
- **Conditia `gcode` e pur sintactica** (`typeof === "string" && length > 0`). Nu presupune
  ca un `gcode` prezent inseamna o cautare reala in curs.
- **Filtrele de eroare din `captchaSolver.ts:80-81` nu acopera erorile de transport.** Ele
  prind doar coduri de aplicatie 2Captcha. Un fix care doar adauga inca un regex acolo nu
  inchide finding-ul.
- **`internalError` din `rnpm.ts` nu e helper-ul partajat din `util/envelope.ts`** — e o
  definitie locala la `:76-77`. Exista o definitie locala similara si in `termene.ts:40`.
  Daca schimbi semnatura, verifica ambele.
- **Gardul de UI nu e gard.** F12-F8 arata exact asta; nu-l "rezolva" adaugand inca o
  verificare in frontend.

## 9. Definition of done

- [ ] Intentia de produs pe PAT confirmata cu userul (Pas 1)
- [ ] F12-F8: `requireRole("admin")` pe `/api/v1/tokens*` + test 403 pe sesiune non-admin
- [ ] F12-F5: raspuns 500 generic + log redactat; test care dovedeste ca cheia nu apare in
      niciunul din cele doua
- [ ] F12-F3: cota verificata indiferent de `gcode`, in ambele puncte; `rnpmStorageRecheck.test.ts`
      actualizat; test nou care dovedeste 429 cu `gcode` arbitrar
- [ ] Gate complet verde (sectiunea 5), fara regresii fata de 2078/395
- [ ] HARDENING.md: cele 3 marcate ca rezolvate in sectiunea Faza 12
- [ ] Commit-uri separate per finding, push pe `feat/v2.43.0-rnpm-split`, NU pe `main`.
      Inainte de push verifica daca commit-ul de docs securitate e inca nepushuit si daca
      userul a autorizat urcarea lui — vezi sectiunea 2.
