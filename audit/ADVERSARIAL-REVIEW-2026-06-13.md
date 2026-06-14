# Adversarial Review — Legal Dashboard

> ## Reconciliere / disposition (adaugat 2026-06-14)
>
> **Scope real:** acest audit a fost rulat la jumatatea refactorului de drop al stack-ului chinezesc OpenRouter, pe branch-ul de feature (NU pe `main` released). Headerul "v2.37.1 (branch `main`)" e mislabeled: codul analizat era de fapt branch-ul `feat/v2.38.0-hardening-model-refresh` mid-flight, motiv pentru care `npm run check` pica (C1/T1) — testele vechi inca importau simboluri deja sterse din `ai.ts`. Defectele de tip "stack chinezesc" reflecta o stare tranzitorie a branch-ului, nu o regresie pe productie.
>
> **Disposition findings → outcome:**
>
> | Finding | Outcome | Note / commit |
> |---|---|---|
> | C1 / R1 / T1 / T2 (`ai.openrouter.test.ts` rupt) | FOLDED v2.38.0 | testele aliniate la noul API in dropul stack-ului chinezesc (`c503064`, `2b094d6`, `dc53aa0`) |
> | S1 / A1 / R2 / U1 / U3 (stack chinezesc backend↔frontend) | FOLDED v2.38.0 | stack chinezesc eliminat din settings API + migration 0036 coerce `chinese->western` (`2b094d6`, `dc53aa0`) |
> | S2 / O1 / O2 (`.env.example` ACK + JWT issuer/audience) | INCLUS v2.38.0 | ACK_NO_AUTH retras, `.env.example` + SECURITY.md sincronizate (env docs-sync, acest batch) |
> | S6 (cookie JWT nu se invalideaza la suspendare/rol) | INCLUS v2.38.0 | JWT revocation: `jti` + `jwt_denylist` (migration 0038), revoke la logout |
> | S3 (IP real in spatele proxy) | DEFERAT | comportament documentat (`LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR`); operational, nu blocant |
> | S4 (captcha race controllere neabortate) | DEFERAT | next sprint |
> | S5 (`owner_id DEFAULT 'local'`) | DEFERAT | risc latent web-mode, runtime guard de extins |
> | R3 (callOpenAI fara fallback) / R4 (audit cap bytes) / R5 (nameListParser temp) / R6 (ICCJ batch budget) | DEFERAT | robustete, next sprint |
> | A2 (DDL duplicat schema.ts) | DEFERAT | cross-ref comentariu adaugat (`9fe1bbf`); drift-test ramane TODO |
> | A3 (SQL interpolat tenant keys) | ACCEPTAT | guard `isTenantKeyField` prezent; risc acceptat |
> | T3 / T4 / U2 / O3 / O4 | DEFERAT | calitate/UX/operational, esalonat |
>
> Raportul de mai jos e pastrat ca atare (snapshot al starii mid-refactor) pentru trasabilitate.

**Dată:** 13 iunie 2026  
**Versiune analizată:** v2.37.1 (branch `main`)  
**Reviewer:** Claude Code (opencode/moonshotai/kimi-k2.7-code)  
**Metodologie:** inspectie cod sursa + documente proiect + rulare `npm run check` + teste frontend/backend + verificari statice

## Verdict general

Proiectul are o fundatie solida de securitate si multe hardening-uri corecte, dar contine defecte concrete care blocheaza release-ul si afecteaza functionalitatea. Cel mai mare risc nu mai este perimetrul de securitate, ci consistenta codului dupa refactorari, documentatia/env decuplat si cateva bug-uri operationale.

**Starea release-ului:** `npm run check` pica. **Nu se poate face push/release inainte de remediere.**

---

## 1. Securitate

### C1 (Critical). `npm run check` pica — release blocat

`npm run check` esueaza la `typecheck:backend` cu erori in `backend/src/services/ai.openrouter.test.ts`:

- `Module '"./ai.ts"' has no exported member 'OPENROUTER_CHINESE_MAP'`
- `Module '"./ai.ts"' has no exported member 'OPENROUTER_WESTERN_MAP'`
- `Expected 1 arguments, but got 2` la apelurile `resolveOpenRouterSlug`
- `'stack' does not exist in type 'AiRouting'`

Cauza: `backend/src/services/ai.ts` a renuntat la stack-ul chinezesc, dar testele vechi inca importa simboluri sterse.

Impact: CI release workflows (`build-windows.yml`, `build-mac.yml`, `docker-build.yml`) ruleaza `tsc --noEmit` inainte de packaging, deci release-ul este blocat sau va fi livrat fara teste validate.

### S1 (High). OpenRouter stack chinezesc — frontend expune modele inexistente in backend

Fisiere afectate:

- `frontend/src/components/dosare-ai-config.ts` defineste modele chinezesti (`glm-5.1`, `kimi-k2.6`, `qwen-3.7-max`)
- `backend/src/services/ai.ts:16-29` (`AI_MODELS`) nu mai contine niciun model chinezesc
- `backend/src/db/ownerAiSettingsRepository.ts:55-67` scrie constant `'western'` in coloana `openrouter_stack`
- `backend/src/db/migrations/0023_owner_ai_settings.up.sql:5` si `0036_openrouter_stack_western.up.sql` inca gestioneaza valori `chinese`

Impact UX: utilizatorul poate alege modele care produc eroare 100% din timp. Testele frontend (`dosare-ai-config.test.ts`) trec pe baza unui contract care nu mai exista in backend.

### S2 (High). `.env.example` contine valori si etichete invechite

Fisiere afectate:

- `.env.example:19`: comentariul pentru `LEGAL_DASHBOARD_ACK_NO_AUTH` spune `"i-understand-this-is-insecure"`, dar `backend/src/index.ts:392` accepta doar `"i-understand-no-auth-yet"`
- `.env.example:31-32`: `LEGAL_DASHBOARD_JWT_ISSUER` si `LEGAL_DASHBOARD_JWT_AUDIENCE` sunt marcate `OPTIONAL`, dar `backend/src/auth/config.ts:81-86` arunca la boot in web mode daca lipsesc
- `.env.example` nu documenteaza `LEGAL_DASHBOARD_JWT_TTL_SECONDS`, desi exista in `backend/src/auth/config.ts:38`

Impact: primul deploy web pe un server curat va refuza pornirea cu mesaje pe care documentatia nu le anticipa.

### S3 (Medium). IP real lipsa in spatele proxy-ului neconfigurat

Fisiere afectate:

- `backend/src/middleware/rate-limit.ts:33`
- `backend/src/middleware/originGuard.ts:52`
- `backend/src/util/proxyIp.ts:30-36`

`readClientIp` se bazeaza pe `getConnInfo(c).remote.address` si ignora `X-Forwarded-For` daca `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` nu este setat. In Docker/Caddy real, toti clientii apar cu IP-ul containerului/reverse-proxy-ului. Rate-limit devine un bucket comun, iar origin guard poate vedea peer-ul ca loopback.

### S4 (Medium). Captcha race — controllere neabortate in calea de eroare non-Aggregate

Fisier afectat: `backend/src/services/captchaSolver.ts:195-247`

In `solveRace`, daca `Promise.any` arunca o eroare care nu este `AggregateError`, controllerele `ctrlA`/`ctrlB` nu sunt abortate. In scenarii de stres pot ramane cereri captcha active pana la timeout, consumand chei degeaba.

### S5 (Medium). `owner_id DEFAULT 'local'` ramane risc latent in web mode

Migrations si codul de boot folosesc in continuare `"local"` ca fallback. Un handler viitor care uita sa seteze `ownerId` in web mode va absorbi date in tenantul magic `"local"`.

### S6 (Low). Cookie JWT nu se invalideaza la schimbarea statusului/rolului

`backend/src/routes/auth.ts:29-37` seteaza cookie cu `maxAge: ttl`, dar `authProvider.ts` nu invalideaza token-ul la suspendare sau schimbare de rol. Un token emis inainte de suspendare ramane valid pana la expirare.

---

## 2. Corectitudine si robustete

### R1 (Critical). `ai.openrouter.test.ts` este invalid in intregime

Acelasi defect ca C1, subliniat pe axa de corectitudine: test suite-ul da impresia falsa de acoperire, dar testeaza un API care nu mai exista.

### R2 (High). Inconsistenta lista modele AI — backend vs frontend

- Backend are 9 modele western in `AI_MODELS`
- Frontend are 12 modele in `AI_MODELS` (9 western + 3 chinese)
- Backend `JUDGE_MODELS` are 3 modele
- Frontend `JUDGE_MODELS_LIST` are 6 modele

Rezultat: multi-agent flow poate trimite `modelKey` necunoscut catre backend, care raspunde cu 400 `"Model necunoscut"`.

### R3 (High). `callOpenAI` foloseste `responses.create` fara fallback

`backend/src/services/ai.ts:369-401`: pentru OpenAI nativ se apeleaza `client.responses.create`. Daca deployment-ul sau key-ul nu are API-ul Responses activ, call-ul esueaza fara fallback la `chat.completions`.

### R4 (Medium). Audit repository cap de 16KB numara caractere, nu bytes

`backend/src/db/auditRepository.ts:49` compara `raw.length` (caractere JS) cu `AUDIT_DETAIL_MAX_BYTES`. Un payload cu multi-byte (emoji, chinezest) poate depasi 16 KB fizic fara sa fie truncat. Corect: `Buffer.byteLength(raw, "utf8")`.

### R5 (Medium). `nameListParser.ts` — timeout fara cleanup explicit de fisiere temporare

`backend/src/services/nameListParser.ts:397-411` foloseste `setTimeout` pentru a rejecta parsing-ul. Fisierul temporar Excel poate ramane pe disk in unele cai de eroare.

### R6 (Low). ICCJ enrich budget nu opreste batch-ul in curs

`backend/src/services/iccj/iccjClient.ts:852-871`: deadline-ul verifica `deadline.aborted` la inceputul fiecarui batch, dar `Promise.all` lansat pe ultimul batch poate depasi bugetul agregat fara a fi oprit.

---

## 3. Arhitectura si extensibilitate

### A1 (High). Web-readiness bridge partial rupt: frontend inca depinde de `stack` chinezesc

Fisiere afectate:

- `frontend/src/components/dosare-ai-config.ts`
- `frontend/src/components/ApiKeyDialog.tsx`
- `frontend/src/hooks/useAiSettings.ts`
- `frontend/src/App.tsx`

Toate modeleaza inca `stack: "western" | "chinese"`. `backend/src/db/migrations/0036_openrouter_stack_western.up.sql` forteaza doar `western`, lasand coloana moarta.

Recomandare: alegeti fie readucerea modelelor chinezesti in backend cu map corect, fie eliminarea completa a stack-ului din frontend, teste si migrations.

### A2 (Medium). DDL duplicat in `schema.ts`

`backend/src/db/schema.ts:234-354` contine DDL legacy duplicat fata de `migrations/0001_baseline.up.sql`. Orice schimbare de schema trebuie aplicata in doua locuri, cu risc de drift.

### A3 (Medium). SQL interpolat in tenant keys

`backend/src/db/tenantKeysRepository.ts:103-124` interpoleaza `${field}_cipher`, dar are guard `isTenantKeyField`. Este acceptabil, dar ramane unicul loc din codebase cu nume de coloana dinamic.

---

## 4. Calitate si testare

### T1 (Critical). `npm run check` nu trece

Confirmat prin rulare directa. `tsc --noEmit -p backend/tsconfig.json` pica cu 20+ erori in `ai.openrouter.test.ts`.

### T2 (High). Teste care testeaza un contract disparut

- `backend/src/services/ai.openrouter.test.ts` intreg
- `frontend/src/components/dosare-ai-config.test.ts` testeaza modele chinezesti care nu mai exista in backend

Testele frontend trec local, dar contractul este rupt.

### T3 (Medium). Teste skip pe Windows

`backend/src/db/backup.test.ts:247-280`: 4 teste pentru offsite hook sunt sarite pe Windows (`it.skipIf(isWindows)`). Masina de dezvoltare este Windows, deci hook-ul offsite nu este testat local.

### T4 (Medium). Coverage slab pentru web-mode auth

Nu exista test care sa verifice ca `ownerContext` refuza un token valabil pentru user sters sau suspendat.

---

## 5. Operational / build / deploy

### O1 (High). Deploy web va refuza pornirea din cauza `.env.example`

Detaliat la S2. Un operator care copiaza `.env.example` va avea `ACK_NO_AUTH` gresit si va primi `fatalBoot`.

### O2 (High). Docker CI configureaza `JWT_ISSUER`/`JWT_AUDIENCE`, dar `.env.example` nu le documenteaza ca required

Discrepanta intre CI si documentatia pentru operatori.

### O3 (Medium). Offsite backup hook executa shell arbitrar

`backend/src/db/backup.ts:427-488`: `LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD` este executat prin `spawn(shell, [shellFlag, cmd, backupPath])` fara validare sau whitelisting. O configuratie gresita poate executa orice in shell. Desi este env-only, ar trebui documentat explicit ca fiind echivalent cu `eval`.

### O4 (Low). Watchdog rapoarte pot contine chei API

`electron/event-loop-watchdog.js` foloseste `process.report.writeReport()` care include stack/heap. Daca vreun buffer contine cheie API in momentul stall-ului, raportul o poate include.

---

## 6. UX / product

### U1 (High). Utilizatorul poate alege modele AI care nu functioneaza

Selectand `glm-5.1` / `kimi-k2.6` / `qwen-3.7-max`, utilizatorul primeste eroare `"Model necunoscut"` desi UI-ul le prezinta ca disponibile.

### U2 (Medium). Inconsistente de limba

- `backend/src/routes/auth.ts:175`: "Contacteaza adminul" (fara diacritice)
- `backend/src/middleware/originGuard.ts:76`: mesaj eroare amestecat romana/engleza
- `frontend/src/components/dosare-ai-config.ts`: "5.4 nano/mini" nu sunt brand names standard

### U3 (Medium). Termenul `stack: "chinese"` expus in UI

`frontend/src/components/ApiKeyDialog.tsx:155-172` foloseste butoane "Vestic" / "Chinezesc" pentru un feature backend care nu mai exista.

---

## Fisierele cele mai riscante

1. `backend/src/services/ai.openrouter.test.ts` — blocant typecheck
2. `frontend/src/components/dosare-ai-config.ts` — expune modele inexistente in backend
3. `backend/src/services/ai.ts` — refactor incomplet
4. `.env.example` — valori gresite/incomplete
5. `backend/src/db/schema.ts` — DDL duplicat
6. `backend/src/services/captchaSolver.ts` — leak potential pe race path
7. `backend/src/index.ts` — intersectie auth mode, remote bind, ack string, tenant crypto
8. `backend/src/middleware/rate-limit.ts` + `backend/src/util/proxyIp.ts` — rate-limit inoperant in spatele proxy neconfigurat

---

## Recomandari prioritizate

### Imediat (inainte de orice push/release)

1. Reparati `npm run check` actualizand sau stergand `backend/src/services/ai.openrouter.test.ts` conform noului API.
2. Aliati backend/frontend pentru OpenRouter: fie adaugati modelele chinezesti inapoi in backend, fie eliminati stack-ul chinezesc din frontend, teste si migrations.
3. Corectati `.env.example`:
   - `LEGAL_DASHBOARD_ACK_NO_AUTH` → valoarea exacta `i-understand-no-auth-yet`
   - `LEGAL_DASHBOARD_JWT_ISSUER` / `JWT_AUDIENCE` → `REQUIRED-WEB`
   - adaugati `LEGAL_DASHBOARD_JWT_TTL_SECONDS`

### Urmatorul sprint

4. In `backend/src/db/auditRepository.ts:49` folositi `Buffer.byteLength(raw, "utf8")` in loc de `raw.length`.
5. In `backend/src/services/captchaSolver.ts` abortati `ctrlA`/`ctrlB` si in calea de eroare non-Aggregate.
6. Documentati exemplu concret `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` in `.env.example` si `DEPLOY-SERVER.md`.
7. Extindeti runtime guard `ownerId !== "local"` in web mode.

### Termen mediu

8. Eliminati DDL duplicat din `backend/src/db/schema.ts` sau adaugati un test care detecteaza drift fata de migrations.
9. Adaugati observabilitate externa (APM/Sentry).
10. Review `ICCJ_ENRICH_BUDGET_MS` pentru a intrerupe si batch-ul in curs cand bugetul agregat este depasit.

---

## Concluzie

Legal Dashboard nu este "totul bine". Are o fundatie buna, dar **trebuie oprit si reparat inainte de orice release**: `npm run check` pica, UI-ul vinde modele inexistente, iar `.env.example` va impiedica primul deploy web. Acestea sunt defecte concrete, nu generalitati.
