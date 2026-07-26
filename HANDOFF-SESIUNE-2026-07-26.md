# Handoff sesiune — 2026-07-26

**Branch:** `feat/v2.43.0-rnpm-split` (NU `main` — `main` e urmarit de Dokploy, push acolo = deploy in productie)
**Ultimul push:** `4ff06ce` (2026-07-26 03:21). Local suntem inaintea remote-ului cu commituri de documentatie — vezi sectiunea 5.
**Stare cod:** nimic remediat in aceasta sesiune. Tot ce urmeaza e triaj verificat la sursa, nu backlog copiat.

Trei fluxuri de lucru deschise, in ordinea in care se ataca:

| # | Flux | Sursa detaliilor | Volum |
|---|------|------------------|-------|
| A | Cele 3 findings de securitate care blocheaza web deploy | [HANDOFF-SEC-WEB-BLOCKERS-F12-2026-07-26.md](HANDOFF-SEC-WEB-BLOCKERS-F12-2026-07-26.md) | ~5h |
| B | Review CodeRabbit din 2026-07-26 (54 comentarii) | [audit/CODERABBIT-TRIAJ-2026-07-26.md](audit/CODERABBIT-TRIAJ-2026-07-26.md) | 9 fixuri + 1 commit ieftin |
| C | Calibrare AI Claude 5: effort + max_tokens + fix raportare cost OpenRouter | sectiunea 9 de mai jos | ~3-4h |

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

## 9. Flux C — calibrare AI Claude 5 (plan aprobat 2026-07-26, neimplementat)

Independent de A si B: atinge doar `backend/src/services/ai.ts`, `backend/src/routes/ai.ts` si
testele aferente — zero suprapunere de fisiere cu F12 sau CodeRabbit. Un singur release (decizie
explicita: aplicatia NU e inca deployata, deci nu exista baseline de date de protejat — argumentul
"observabilitate intai, comportament dupa" nu se aplica). Plan trecut prin review-panel (OpenRouter:
Opus 5 + GPT-5.6 Sol + Kimi K3 + Grok 4.5, sinteza Fable 5); review-panel2/cheaperinference a picat
cu erori de conexiune ("fetch failed" pe 4/5 modele + sinteza) — instabilitate provider, nu config.

### Context

Bump-ul la `claude-opus-5`/`claude-sonnet-5` (eb736c5) NU a schimbat parametrii de apel. Pe
generatia Claude 5, thinking-ul e pornit IMPLICIT cand nu se trimite camp `thinking`: tokenii de
thinking se factureaza ca output si consuma din `AI_MAX_TOKENS` (8000, ai.ts:104). Traficul merge
in principal prin OpenRouter. Prompturile system NU se ating (decizie: sunt curate, livrate in
v2.42.0; lungimea outputului se masoara post-deploy din `ai_usage` inainte de orice revizuire).

### Bug preexistent confirmat (fix inclus in acest flux)

`callOpenRouter` trimite `extra_body: { usage: { include: true } }` (ai.ts:662-663) — idiom din
SDK-ul Python. VERIFICAT 2026-07-26: `openai@6.36.0` instalat contine ZERO aparitii de
`extra_body` in tot pachetul, deci campul pleaca literal in JSON si OpenRouter il ignora.
Raportarea de cost real (`usage.cost` → `costUsdMilli`, ai.ts:701) nu a functionat niciodata;
nu s-a observat pentru ca `aiUsage.ts:79-85` cade pe tabelul static de preturi. Dublu-check
optional: toate randurile openrouter din `ai_usage` ar trebui sa aiba `cost` NULL.
NU urma sugestia (respinsa) de a pune `reasoning` in `extra_body` — exact asta ar reproduce bug-ul.

### Pasii de implementare

1. **Body OpenRouter corect:** `usage: { include: true }` si conditionat `reasoning: { effort }`
   ca proprietati TOP-LEVEL in `chat.completions.create` — o singura variabila de body cu cast
   tipizat (un `@ts-expect-error` pe spread conditionat pica strict build-ul ca "unused"). Sterge
   `extra_body`.
2. **Effort "medium" prin allowlist exact, pe ambele rute:**
   - nativ, in `callAnthropic`: `output_config: { effort }` DOAR pentru modelId in
     {`claude-sonnet-5`, `claude-opus-5`}. VERIFICAT: `output_config`/`effort` sunt tipizate in
     `@anthropic-ai/sdk` 0.94 (`messages.d.ts`, include si `xhigh`/`max`) — fara beta header,
     fara cast.
   - OpenRouter, in `callOpenRouter`: DOAR pentru slug REZOLVAT in {`anthropic/claude-sonnet-5`,
     `anthropic/claude-opus-5`}. Prefixul generic `anthropic/` NU e suficient:
     `OPENROUTER_MODEL_MAP["claude-haiku"]` = `anthropic/claude-haiku-4.5` (ai.ts:47) ar trece de
     un gate pe prefix, iar Haiku 4.5 nu suporta effort (400 nativ). Atentie si la
     `OPENROUTER_MODEL_OVERRIDES` (ai.ts:76-90), care poate remapa chei pe alte sluguri — gate-ul
     se aplica dupa `resolveOpenRouterSlug`.
   - construieste campul doar daca `effort !== undefined` SI allowlist — nu trimite
     `{ effort: undefined }` (se serializeaza `{}`).
3. **Call sites (`routes/ai.ts`):** medium pe single (~:216), pe ambii analisti (~:344, ~:359) SI
   pe judge (~:386) — "medium peste tot" e decizie asumata a userului; revert = un string.
   Semnal de regresie pe judge: sectiunea "Revizuire si reconciliere" devine formala/goala pe
   dosare unde analizele chiar difera. GPT/Gemini ca judge nu primesc nimic (comentariu la call
   site ca sa nu se presupuna paritate).
4. **Semnatura:** `effort?: AiEffort` ("low"|"medium"|"high", tip exportat) ca ULTIM parametru
   pozitional pe `callModel`/`callAnthropic`/`callOpenRouter` (la callOpenRouter dupa
   `routingTag`). FARA refactor la options object acum — devine obligatoriu la urmatorul parametru.
5. **Kill switch operational:** env var (ex. `AI_EFFORT_DISABLED=1`) care omite campurile de
   effort pe ambele rute — face saptamana de masurare reversibila fara rebuild. De adaugat in
   tabelul de kill switches din SESSION-HANDOFF.md.
6. **`AI_MAX_TOKENS` 8000 → 16000** (ai.ts:104; actualizeaza si comentariul stale "increased from
   3000"). Constanta e partajata: anthropic `max_tokens`, openai `max_output_tokens` +
   `max_completion_tokens` (fallback), gemini `maxOutputTokens`, openrouter `max_tokens` — bump-ul
   e doar tavan, nu cost garantat. DE VERIFICAT la implementare: SDK-ul Anthropic poate cere
   streaming la max_tokens mari pe apeluri non-streaming (guard de durata); daca da, treci
   `callAnthropic` pe `client.messages.stream(...).finalMessage()` — schimbare locala, fara SSE
   spre client.
7. **`TRUNCATE_ANALYSIS` 50000 → ~120000** (ai.ts:98): la 16k tokeni output (~60-70k caractere),
   capul de 50k ar trunchia analiza analistului inainte de judge — pastreaza rolul de bound
   anti-injection, doar mai sus.
8. **Observabilitate (acelasi release):** logheaza `stop_reason` (anthropic) / `finish_reason`
   (openai/openrouter) / echivalentul Gemini in meta-ul existent `ai_call` (ai.ts:492-496 si
   omologii); extinde diagnosticul `openrouter_empty_content` (ai.ts:676-697) cu effort-ul trimis;
   pe fluxul SINGLE, content gol/whitespace dupa apel reasoning-enabled = eroare tipizata (nu
   `200 {"analysis":""}`). Pe MULTI nu se schimba nimic: promptul judge are deja regula pentru
   analiza goala (ai.ts:323) — degradarea e by design.
9. **Canary post-implementare (inainte de commit final):** un apel live OpenRouter pe
   `anthropic/claude-opus-5` care confirma (a) `usage.cost` populat, (b) cum traduce OpenRouter
   `reasoning.effort` pentru Claude 5 (inspecteaza reasoning details in raspuns; daca se dovedeste
   translatie in budget fix, reevalueaza daca effort-ul pe ruta OpenRouter merita pastrat); un apel
   nativ per model din allowlist. Necesita cheile userului — cere-le la momentul respectiv.

### Ce NU se schimba (decizii, nu omisiuni)

- Prompturile system (`AI_ANALYSIS_SYSTEM`/`AI_JUDGE_SYSTEM`) si structura de headinguri.
- Timeout-urile 120s/180s — se monitorizeaza `errorType:"timeout"` in `ai_call` dupa deploy;
  crestem doar cu date.
- Calibrarea GPT-5.6 (Responses API `reasoning`) si Gemini (`thinkingConfig`) — follow-up separat.
- Estimarile de cota ($0.25 single / $0.50 multi) — raman sub-dimensionate ~2x fata de noul tavan,
  acceptat constient; re-baseline din `ai_usage` dupa primele saptamani reale post-deploy.

### Teste si gate

Mock-urile existente pe `chat.completions.create` folosesc `objectContaining` (aditivele nu le
pica), dar clasa de bug `extra_body` NU e prinsa de mockuri la nivel de metoda — adauga teste de
forma requestului (stub pe `fetch` al SDK-ului): top-level `usage.include` + `reasoning.effort`
prezente, `extra_body` ABSENT; `output_config.effort` doar pentru cele doua modelId-uri; negative
pentru haiku (ambele rute), `openai/*`, `google/*` si override-uri in ambele directii.
Gate-ul standard inainte de commit: biome + tsc (backend+frontend) + build + teste backend.
Commit pe `feat/v2.43.0-rnpm-split`, FARA push (regula din sectiunea 5 ramane valabila).

### Context sesiune 2026-07-26 (in afara repo-ului, deja livrat — nu reface)

Global `~/.claude/CLAUDE.md`: sectiuni noi "Stil de raspuns" + "Subagenti" si scope-ul integrat in
regulile Karpathy (calibrare Claude 5). Cei 6 agenti custom din `~/.claude/agents` mutati pe
`claude-opus-5`. Skill-ul `~/.claude/skills/claude-api` actualizat complet la familia Claude 5
(default `claude-opus-5`, thinking-on-by-default, effort cu `xhigh`, catalog modele 2026-07-26).
