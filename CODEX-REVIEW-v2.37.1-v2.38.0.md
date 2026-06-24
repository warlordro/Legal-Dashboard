# CODEX Handoff — Full Review: v2.37.1 + v2.38.0

> Acest fisier e generat de `/full-review` (12 revieweri paraleli + faza de verificare) ca sa fie predat catre CODEX pentru analiza/implementare. Fiecare finding are `file:line`, problema si fix propus. CODEX trebuie sa re-confirme fiecare fix vs codul curent inainte de implementare.
>
> **Meta-review (2026-06-14, `ADVERSARIAL-META-REVIEW-CODEX-...md`):** raportul a fost re-verificat adversarial de 3 modele independente (Opus/GPT/Kimi) care au redeschis sursa la HEAD. **Zero findings refuzate, linii exacte, HIGH-ul confirmat de toti trei.** S-au aplicat in textul de mai jos 4 calibrari `[meta]` (scoping pe HIGH; softening composeSignal + iccjRunner:53; intarire validateAiBody) + 2 precizii (`.env` root-only; dup `normalizeIccjNumar` intentional → fix = test de egalitate). Toate re-confirmate la sursa de agenti in sesiune.

## Target

- **Scope:** toate schimbarile din v2.37.1 SI v2.38.0 — git range `v2.37.0..HEAD`.
- **HEAD:** `cf2651f` (branch `feat/v2.38.0-hardening-model-refresh`, NEPUSHAT). Base: tag `v2.37.0`.
- **Volum:** 130 fisiere, +4468 / -733. (v2.37.1 = `v2.37.0..v2.37.1`, 74 fisiere; v2.38.0 = `v2.37.1..HEAD`, 75 fisiere.)
- **Metoda:** 12 agenti routati in paralel → faza de verificare (fiecare `file:line` confirmat vs cod la HEAD). 47 findings brute → **4 aruncate** (3 MITIGATED, 1 NOT_REPRODUCED) → **43 confirmate** (41 CONFIRMED + 2 RELOCATED cu linii corectate).

## Routing

**Rulati (12):** deep-code-reviewer, claude-guard, repo-security-auditor, release-readiness-reviewer, backend-reliability-reviewer, api-contract-reviewer, database-change-reviewer, dependency-security-reviewer, data-validation-reviewer, workflow-risk-reviewer, audit-trail-reviewer, test-architect.

**Sariti:** fraud-control-reviewer (fara anti-fraud/scoring/approval), debug-investigator (fara teste failing/flaky active), refactor-planner (cerere de review, nu de refactor).

**Verdicte per-agent:** deep-code **HIGH**, workflow-risk **HIGH**, security **CLEAN**, api-contract **CLEAN**, restul (claude-guard, release, backend-rel, db, deps, data-val, audit-trail, tests) **MEDIUM**.

## Verdict

🟡 **CONDITIONAL** — niciun BLOCKER de securitate/data-loss; build + 1443 backend + 232 frontend + 2 electron teste trec. **Un singur HIGH real** domina: fix-ul de monitoring `name_soap` din v2.37.1 (suprimarea alertei false "dosar disparut" la esec partial) e **INERT in productie** din cauza unui mismatch de vocabular institutie (cod enum WSDL vs nume afisat XML), iar testul lui da acoperire falsa.

> ⚠️ **PRIORITATE: HIGH-ul e LIVE in v2.37.1, care e DEJA MERGED in `main` si released** — nu e un bug doar pe branch-ul v2.38.0. Adica utilizatorii pe v2.37.1 primesc DEJA alerte false "dosarul tau a disparut" la fiecare esec partial de fan-out + `dosar_new` spurios la recuperare. **Confirmat la sursa primara** (nu doar de agenti): `nameSoapRunner.ts:106-108` ia codul enum raw; `Dosare.tsx:77-78` documenteaza explicit pe cod de productie ca SOAP enum value ("TribunalulSATUMARE") ≠ XML text ("Tribunalul SATUMARE"). Trebuie prioritizat **peste** toate MEDIUM-urile v2.38.0 — e singurul finding cu impact pe utilizatori live.

Restul sunt MEDIUM (doc-sync de securitate, atributie audit la logout, purge nelimitat, lipsa ecosistem docker la dependabot, lacune de teste) + LOW (observabilitate, robustete, doc). Recomandare: rezolva HIGH-ul (cu prioritate, e in productie) + clusterul de audit logout inainte de push; restul pot intra esalonat.

---

## Fix Order (grupat pe root-cause, ordonat dupa blast radius)

### 1. [🟠 HIGH] Mismatch vocabular institutie → fix `name_soap` partial-failure inert (false "dosar disparut")
**Root cause:** doua vocabulare diferite comparate prin egalitate de string.
- `failedInstitutii` se construieste din `target.institutie` = **coduri enum WSDL** (`"TribunalulBUCURESTI"`, fara spatii) — `nameSoapRunner.ts:106-108`.
- `snapshot.instanta` se construieste din `<institutie>` **returnat** = **nume afisat** (`"Tribunalul Bucuresti"`, cu spatiu) — `buildNameSoapSnapshot`, `diff/nameSoap.ts:186`, parsat la `soap.ts:219`.
- Deci `failed.has(prev.instanta)` la `diff/nameSoap.ts:212` (carry-forward) si `:290` (suprimare `dosar_disappeared`) sunt **mereu false in productie**.

**Impact:** la un esec partial de fan-out, dosarele instantei picate (1) primesc alerta falsa `dosar_disappeared` (exact bug-ul pe care v2.37.1 voia sa-l omoare), apoi (2) reapar ca `dosar_new` fals la tick-ul de recuperare → flapping de alerte. Front-end-ul (`Dosare.tsx:77-86`) documenteaza si normalizeaza deja exact acest mismatch — dovada ca cele doua vocabulare difera real.

**Acoperire falsa:** testul `nameSoap.test.ts:278-298` seteaza `failedInstitutii` si `instanta` la acelasi literal `"TribunalulCLUJ"` (nu trece prin `buildNameSoapSnapshot`) → trece desi productia diverge.

**Fix propus:** normalizeaza ambele parti ale comparatiei. Fie (a) la fetch (`nameSoapRunner.fetchForTarget`, ~256-259) stampileaza provenienta: seteaza `dosar.institutie = institutie` (param-ul de cautare) inainte de `byNumar.set`, fie (b) mapeaza `target.institutie[]` prin `getInstitutieLabel` + `normalizeInstitutie` inainte de a popula `failedInstitutii` (oglindind `filterByInstitutii` din `Dosare.tsx:80-86`). **Obligatoriu:** rescrie testul sa treaca prin `buildNameSoapSnapshot` cu string-uri DIVERGENTE (`failedInstitutii:["TribunalulBUCURESTI"]`, returned `"Tribunalul Bucuresti"`) — testul trebuie sa PICE pe codul curent.

**Scope `[meta]` (confirmat la sursa):** bug-ul se manifesta **doar pe joburi institution-scoped** (multi-instanta) — exact subsetul vizat de v2.37.1. Un watch all-institution itereaza `[undefined]` (`nameSoapRunner.ts:241`) si fie arunca "all institutions failed" la `:271` (→ `SOAP_FAIL`, `fetchForTarget` nu returneaza), fie returneaza `failedInstitutii=[]` — deci lista care ajunge la `diffNameSoap` e mereu goala si suprimarea e moot pentru acel subset. HIGH-ul ramane; doar formularea "ALWAYS false in productie" se citeste corect ca "always false pe orice target institution-scoped".

### 2. [🟡 MEDIUM] Audit la logout — atributie + rezultat revocare incomplete (cluster, acelasi `recordAudit`)
`backend/src/routes/auth.ts:88-98` — un singur `recordAudit(null, "auth.logout", ...)`:
- **(2a)** primul arg `null` → `ip`, `user_agent`, `request_id` sunt **mereu null** pe randul de logout (vs `auth.refresh` care le capteaza). Nu se poate trece `c` direct (logout e exclus din `ownerContext` → `getOwnerId(c)` arunca in web mode).
- **(2b)** `detail` nu inregistreaza daca revocarea jti a reusit; pe esec `revokeJti` doar `console.error` (efemer), iar randul ramane `tokenVerified=true` fara semnal ca denylist-ul a esuat → forensics inselatoare la 90 zile.

**Fix (un singur patch):** extrage explicit `ip`/`userAgent`/`requestId` din `c` (fara a pasa `c`), introdu `let revokeSucceeded=false` setat `true` doar la succesul `revokeJti`, si adauga in `detail`: `jtiPresent: Boolean(payload?.jti)`, `revokeSucceeded`. (Snippet complet in finding-ul M2/M3 de mai jos.)

### 3. [🟡 MEDIUM] Documentatie de securitate desincronizata (post-merge blocant pentru claritate)
- **CLAUDE.md:118-139** — catalogul "Securitate (protectii active)" NU listeaza cele 3 protectii noi v2.38.0 (JWT revocation, sameSite Strict, ACK retras). CLAUDE.md a fost atins in v2.38.0 (deci nu e deferare deliberata).
- **SECURITY.md:159** — eticheteaza `JWT_ISSUER`/`JWT_AUDIENCE` ca "Optional" desi `config.ts:77-86` arunca fatal la boot in web mode.
- **`.env.example`** — lipseste `RNPM_TIMEOUT_MS` (introdus v2.37.1, documentat in SECURITY.md/README dar nu aici).
- **HARDENING.md:25** — `Dependabot` inca bifat `[ ]` desi livrat (`aca1f65`).

**Fix:** vezi finding-urile individuale (snippets exacte).

### 4. [🟡 MEDIUM] Robustete operationala
- **purgeOldAiUsage** `aiUsageRepository.ts:404-409` — `DELETE` nelimitat fara chunking (vs `purgeOldRuns`/`purgeOldAuditLog` chunked) → write-lock pe istoric mare. Chunk-uieste (snippet in finding).
- **dependabot.yml** — fara ecosistem `docker` → imaginile SHA-pinned (`node:22-alpine`, `caddy`, `oauth2-proxy`) nu primesc PR-uri de refresh. Adauga 2 intrari `docker` (`/` + `/deploy`).

### 5. [🟡 MEDIUM] Lacune de teste pe cod nou
- `dosareIccj.ts` — **ruta complet netestata** (mapError 504, badSectie whitelist, isValidDate, `ICCJ_ROUTES_DISABLED` 503). Creaza `dosareIccj.test.ts`.
- `iccjRunner.ts:77-82` — ramura `IccjParseError → ICCJ_PARSE_FAIL` netestata.
- `auth.ts:68` — calea logout fara `jti` (token pre-v2.38.0) netestata.
- `streamCap.ts:14-19` — ramura body-null netestata.

### 6. [🟢 LOW] — 36 findings: observabilitate, robustete defensiva, doc-sync, code-quality, CI, deps. Detaliate in tabelele de mai jos.

---

## Findings — HIGH (2 confirmate, acelasi root cause)

| # | file:line | Release | Issue | Fix |
|---|---|---|---|---|
| H1 | `nameSoapRunner.ts:106-108` + `diff/nameSoap.ts:204,212,290` | v2.37.1 | `failedInstitutii` (cod enum WSDL, fara spatii) comparat cu `snapshot.instanta` (nume afisat XML, cu spatiu) → `failed.has(instanta)` mereu false → suprimarea `dosar_disappeared` + carry-forward nu se declanseaza niciodata. Fix-ul cluster-1 din v2.37.1 e inert; testul foloseste string identic = acoperire falsa. | Normalizeaza ambele parti: stampileaza institutia-param la fetch (`nameSoapRunner` ~256-259) SAU mapeaza `target.institutie[]` prin `getInstitutieLabel`+`normalizeInstitutie` inainte de `failedInstitutii`. Rescrie testul sa treaca prin `buildNameSoapSnapshot` cu string-uri divergente (trebuie sa pice pe cod curent). |
| H2 | `diff/nameSoap.ts:204,212,290` (raportat independent de workflow-risk) | v2.37.1 | Acelasi defect, axa de alert-flapping: false `dosar_disappeared` la tick de esec partial + spurious `dosar_new` la recuperare. | Identic cu H1 (acelasi fix rezolva ambele). |

---

## Findings — MEDIUM (9 confirmate)

| # | file:line | Release | Issue | Fix |
|---|---|---|---|---|
| M1 | `CLAUDE.md:118-139` | v2.38.0 | Catalogul "protectii active" nu listeaza JWT revocation, sameSite Strict, ACK retras. | Adauga 3 bullet-uri dupa "Admin guards": JWT revocation (jti + jwt_denylist 0038 + revoke la logout + purge), sameSite Strict (anti-CSRF), ACK_NO_AUTH eliminat. |
| M2 | `auth.ts:88-98` (atributie) | v2.38.0 | `recordAudit(null, ...)` → `ip`/`user_agent`/`request_id` mereu null pe logout. | Extrage `ip=getConnInfo(c).remote.address`, `userAgent=c.req.header('user-agent')`, `requestId=getRequestId(c)` explicit (fara a pasa `c`), paseaza-le la `recordAudit`. |
| M3 | `auth.ts:68-81` + detail `:93-97` (acelasi recordAudit ca M2) | v2.38.0 | `detail` nu are `revokeSucceeded`/`jtiPresent`; esecul `revokeJti` doar in console.error. | `let revokeSucceeded=false` setat la succes; adauga `jtiPresent: Boolean(payload?.jti), revokeSucceeded` in detail. **Merge cu M2 intr-un singur patch.** |
| M4 | `aiUsageRepository.ts:404-409` | both (pre-existing) | `purgeOldAiUsage` = `DELETE` nelimitat, fara chunking (vs purgeOldRuns/purgeOldAuditLog chunked) → write-lock pe istoric mare. `idx_ai_usage_global_time` exista. | Chunk rowid-IN-LIMIT loop (chunkSize=1000), fara migratie. |
| M5 | `.github/dependabot.yml:1` | v2.38.0 | Fara ecosistem `docker` → imaginile SHA-pinned nu primesc refresh PRs. | Adauga blocuri `docker` pentru `/` (Dockerfile) si `/deploy` (compose). |
| M6 | `dosareIccj.ts:56` (ruta intreaga netestata) | v2.37.1 | Fara `dosareIccj.test.ts`: mapError 504, badSectie, isValidDate, `ICCJ_ROUTES_DISABLED` netestate. | Creaza `dosareIccj.test.ts` (app.request + vi.mock pe iccjClient). Atentie: simboluri reale = `searchIccjEnriched`/`fetchIccjDetail`/`searchTermeneByDosarIccj`; mount `/api/dosare-iccj`; env `ICCJ_ROUTES_DISABLED`. |
| M7 | `iccjRunner.ts:77-82` (test `iccjRunner.test.ts`) | v2.37.1 | Ramura `IccjParseError → ICCJ_PARSE_FAIL` netestata (doar SourceError testat). | Adauga test: `fetchCurrentDosar` arunca `IccjParseError` → `status="error"`, `errorCode="ICCJ_PARSE_FAIL"`, fara snapshot. |
| M8 | `auth.ts:68` (test `auth.test.ts`) | v2.38.0 | Calea logout fara `jti` (token pre-v2.38.0) netestata. | Test: token fara jti + user activ → 200, cookie sters, `jwt_denylist` ramane gol (insertUser necesar ca ramura active sa fie atinsa). |
| M9 | `streamCap.test.ts` | v2.38.0 | Ramura body-null (rescrisa in F1) netestata (toate testele folosesc ReadableStream). | 2 teste: `Response(null,{status:204})` → `""`; cu `maxBytes=1` → `""` fara throw (maxBytes=0 arunca pe guard-ul `<=0`). |

---

## Findings — LOW (32 confirmate + 3 CodeRabbit-this-turn; selectie pe teme)

**Observabilitate / audit:**
| file:line | Release | Issue | Fix |
|---|---|---|---|
| `authProvider.ts:82-85` | v2.38.0 | Replay token revocat → doar `console.warn`; randul audit e `auth.denied` generic (totusi durabil), fara discriminator `jwt_revoked` / jti. | `recordAudit(null,'auth.jwt_revoked',{ ownerId:sub, ip, userAgent, detail:{jti} })` best-effort inainte de throw. |
| `auth.ts:68` (skip-no-jti) | v2.38.0 | Logout fara jti sare revocarea fara log/audit. | `console.warn('[auth.logout] jti absent — revocare sarita')` + optional `jtiRevoked:false` in detail. |
| `scheduler.ts:438-454` (purge audit) | v2.38.0 | `jwt_denylist.purged` doar console.log, fara audit durabil. | `recordAudit(null,'jwt_denylist.purged',{detail:{deleted_count,cutoff_epoch}})` best-effort. |
| `scheduler.ts:438-458` (heartbeat) | v2.38.0 | Fara semnal zilnic pe marimea tabelei jwt_denylist. | `SELECT COUNT(*)` post-purge, log neconditionat `jwt_denylist.size`. |

**Robustete / validare:**
| file:line | Release | Issue | Fix |
|---|---|---|---|
| `soap.ts:256-259` | v2.37.1 | Guard WAF `!xml.includes("CautareDosareResult")` = substring → o pagina WAF care contine string-ul trece. | Regex tag-shape: `if (!/<CautareDosareResult[\s>\/]/.test(xml))`. + test cu pagina non-XML ce contine string-ul. |
| `ai.ts:604-609` (validateAiBody) `[meta]` | v2.38.0 | Capeaza lungimea `parti[]`/`sedinte[]` dar nu tipul elementelor. `buildPrompt` (`ai.ts:121-130`) presupune obiecte → `parti:[null]` **arunca TypeError → 500**, nu doar corupe prompt-ul (justificare mai puternica decat in raportul initial — de fapt subevaluat). | Dupa cap, respinge daca vreun element nu e obiect non-null (`return "Elementele din parti trebuie sa fie obiecte."`). |
| `iccjRunner.ts:53` `[meta]` | v2.37.1 | `JSON.parse(target_json)` cast fara validare runtime (real). Failure-mode exact (TypeError generic) NU e garantat de acest fisier singur — `numar_dosar` devine `undefined`, rezultatul depinde de `fetchCurrentDosar` injectat (formulare initiala speculativa). Coruptia interna ramane mascheata fara guard. | Guard: daca `typeof parsed?.numar_dosar !== "string"` → `throw new IccjParseError(...)` → `ICCJ_PARSE_FAIL` (clasificare corecta). |
| `aiUsage.ts:147-148` | v2.38.0 | `latencyMs`/`errorType` scrise fara `safe*` wrapper (vs httpStatus/tokens/cost). | `safeLatencyMs` (finit, >=0, round) + `safeErrorType` (string, slice 128). |
| `dosareIccj.ts:56-68` | v2.37.1 | 504 (timeout upstream) fara `Retry-After`, dar 503 ICCJ_DISABLED il are → semantica inconsistenta. | In cele 3 catch mapError: daca status===504 → adauga `Retry-After: 60`. |

**Code-quality / drift (toate LOW, in mare parte din v2.37.1):**
| file:line | Issue | Fix |
|---|---|---|
| `monitoringJobsRepository.ts:94` + `iccjFetchCurrent.ts:23` `[meta]` | Regex `normalizeIccjNumar` duplicat — dar **INTENTIONAL** (comentariu `:90-92`: repo nu importa din services). Drift sparge `target_hash`↔fetch. | Prefera un **test de egalitate** intre cele doua implementari (nu "elimina duplicarea" — separarea repo/services e deliberata). Optional: extrage in `util/iccjDocket.ts` daca se accepta importul. |
| `iccjSectiiIds.ts:5` + `frontend/iccjSectii.ts:12-24` | Allowlist ICCJ_SECTII duplicat backend/frontend, fara garda de drift → adaugare doar pe frontend = 400 self-inflicted. | Test backend care asserteaza egalitatea seturilor (sau JSON partajat). |
| `dosarSoapRunner.ts:46-54` (pickWatchedDosar) | Sticky re-anchoreaza la `dosare[0]` cand stadiu-ul avanseaza (Apel→Recurs) → `stadiu_changed` spurios; orb cand watched-ul n-are sedinte. | Persista identitatea watched (institutie/stadiu) in `DiffSnapshotPayload`; sticky prefera randul cu institutie egala. |
| `diff/nameSoap.ts:210-220` | Carry-forward pastreaza indefinit dosarele unei institutii permanent offline (acumulare). | Comentariu + expune `carried_dosare_count` in alerta `source_partial`. |
| `nameSoapRunner.ts:195-219` | Alerta `source_partial` scrisa intr-un `withMaintenanceRead` separat dupa tranzactia principala → crash window pierde alerta. | Muta `insertAlert` in aceeasi tranzactie (ca dosarSoapRunner). |
| `ai.ts:45-46` (RELOCATED de la 30-39) | Comentariu "fail-fast" gresit; comportamentul e warn-and-fallback. | Aliniaza comentariul (sau throw daca fail-fast e dorit). |
| `ai.ts:47-56` | Override invalid = doar `console.warn` + fallback la map static → invizibil in monitoring error-level. | `console.error` structurat cu cod la respingere. NU largi allowlist-ul (nu exista model backing pentru alt provider). |
| `ai.ts:407-448` (composeSignal reuse) `[meta]` | Garda de la `:433` re-arunca cand `composed.aborted` → un timeout COMPLET expirat NU mai porneste fallback-ul. Se ajunge la fallback doar pe un 404 pre-deadline → ruleaza pe bugetul partial ramas (nu zero, nu proaspat). Worst case: 404 lent → buget ~zero → fallback degradat. Nu e abort instant garantat, nu e data-loss (initial usor dramatizat). | Optional: `composeSignal(timeout, signal)` proaspat inainte de fallback pt buget plin. |

**Doc-sync (LOW):**
| file:line | Issue | Fix |
|---|---|---|
| `SECURITY.md:159` | `JWT_ISSUER`/`JWT_AUDIENCE` etichetate "Optional" desi fatal la boot web. | "Required in web auth mode — fatal boot if missing." |
| `.env.example` (RNPM, **ROOT only** `[meta]`) | `RNPM_TIMEOUT_MS` lipseste din **root** `.env.example` (introdus v2.37.1, consumat `rnpmClient.ts:252`). `backend/.env.example:161` il ARE deja — NU-l atinge (no-op). | Adauga DOAR in root `.env.example`: `RNPM_TIMEOUT_MS=  # OPTIONAL — timeout per fetch RNPM (default 60000)`. |
| `HARDENING.md:25` | Dependabot bifat `[ ]` desi livrat. | `[x] ... livrat v2.38.0`. |
| `RUNBOOK.md:382` | Fara bloc rollback pentru 0035-0038 (doar 0034). | Adauga bloc: ordine down 0038→0037→0036→0035; 0036 down e no-op ireversibil (chinese pierdut); 0038 down readuce tokenele revocate. |
| `0037_ai_usage_latency.down.sql:1-2` | `DROP COLUMN` fara comentariu de floor SQLite (>=3.35). | Comentariu de floor (bundled 3.53.0 e ok). |
| `0036_..._western.down.sql` | Down no-op ireversibil — fara pointer de recovery din backup. | Nota: restaureaza din backup pre-0036 (schema-upgrade hook). |
| `package.json:30` (RELOCATED) + CI | `test:electron` in agregatul `test`, dar CI ruleaza workspace-scoped → testul electron NU ruleaza in CI. | Adauga pas `node --test "electron/*.test.cjs"` in `lint-test.yml`. |
| `ai.openrouter.test.ts` (resolveOpenRouterSlug) | Fara test ca `gemini-flash-3.5`→`google/gemini-3.5-flash` si ca vechea cheie `gemini-flash-3` → null. | 2 teste de pinning. |
| `0036_..._western.up.sql` (test) | Fara test de migratie 0036 (coercie chinese→western). | Test in-memory: rand 'chinese'→'western', 'western'/NULL neatinse. |
| `scheduler.ts:449-454` (test error-path) | Ramura catch-and-continue a `purgeExpiredJti` netestata. | Test: `DROP TABLE jwt_denylist` → purge arunca intern, loop-ul supravietuieste, `console.error` logat. |
| `routes/dosareIccj.ts:24-32` | `ICCJ_DISABLED_BODY` are `code` top-level; restul erorilor ICCJ doar `{error}`; envelope standard difera → 3 forme. | Optional: adauga `code` la toate erorile ICCJ sau documenteaza discriminarea pe status. |

**Pre-existing (out of scope — nu blocheaza):**
| file:line | Issue | Fix |
|---|---|---|
| `Dockerfile:15,29` | Digest `node:22-alpine` pinned la v2.22.0 (~1 luna vechi). | Refresh digest (depinde de fix-ul docker-dependabot M5). |
| `scheduler.ts:360-458` | Purge-urile zilnice ruleaza fara `withMaintenanceRead` (pattern pre-existent). | Wrap intr-un singur `withMaintenanceRead` sau documenteaza ca intentional. |
| `index.ts:616` (purgeExpiredJti standalone) | `purgeExpiredJti` doar in scheduler → cu `MONITORING_ENABLED=0` in web mode tabela creste nelimitat (rezolvat deja pt purgeExpiredReservations cu setInterval standalone). | Adauga timer standalone web-gated ca la reservations. |

---

## CodeRabbit — findings aditionale (acest tur, verificate vs cod)

| # | file:line | Verdict | Fix |
|---|---|---|---|
| CR-1 | `aiUsageRepository.ts:8,105` | **MITIGATED → LOW** — `AiUsageRoutingTag` ingustat la `native\|openrouter:western`, dar randuri istorice au `openrouter:chinese` (TEXT fara CHECK). Verificare: `SELECT * WHERE id=?` citeste doar randul tocmai inserat (valoare ingusta), niciun cod nu face dispatch pe `routing_tag`, exista test de regresie → riscul e latent/ipotetic, nu prezent. | Optional (corectitudine de tip): largeste tipul de **citire** la `... \| "openrouter:chinese" \| null`, pastrand `AiUsageRoutingTag` ingust doar pe **insert**. |
| CR-2 | `PLAN-v2.38.0-hardening-model-refresh.md:574` | **LOW real** — `AUTH_MODE=web` prescurtat. | `LEGAL_DASHBOARD_AUTH_MODE=web`. |
| CR-3 | `audit/ADVERSARIAL-REVIEW-2026-06-13.md` | **LOW real** — fisierul n-are sectiune de scope/disposition; a fost rulat mid-flight, mislabeled "v2.37.1/main"; lipseste fix-mapping finding→commit. | Prepend header de reconciliere: scope real (rulat pe branch la jumatatea refactor-ului) + tabel disposition (INCLUS/FOLDED/DEFERAT + commit-uri). |

---

## Carry-forward — CodeRabbit deja REZOLVAT in aceasta sesiune (informativ pentru CODEX)

Aceste findings CodeRabbit anterioare au fost deja fixate pe branch (nu necesita actiune CODEX, doar context):
- `12daaa8` — skip defensiv pe pair-uri `OPENROUTER_MODEL_OVERRIDES` fara `:`.
- `9a6d354` — `composed.aborted` in loc de `signal?.aborted` la fallback callOpenAI (+ test timeout-intern).
- `cf2651f` — nume env complet (`LEGAL_DASHBOARD_AUTH_MODE`) in SESSION-HANDOFF + preconditii complete remote-bind in DEPLOY-SERVER.
- `f11d0bf` — redactare RECURSIVA watchdog pe `workers[]` + `node:test`.
- `39b6e68` — logout `revokeJti` observabil (console.error, non-silent).
- `9fe1bbf` — comentariu cross-reference schema.ts ↔ 0001_baseline (drift A2).

> Nota: M2/M3 (audit logout) EXTIND `39b6e68` — acolo s-a adaugat observabilitatea pe console; aici se cere si randul de audit durabil (`revokeSucceeded`) + atributia (ip/ua/requestId). Si finding-ul `ai.ts:407-448` (composeSignal fresh budget) e un reziduu peste `9a6d354` (acela a inchis doar dublul-abort, nu bugetul proaspat).

---

## Verificare (Step 6) — ce s-a aruncat

47 findings brute → 4 aruncate:
- **NOT_REPRODUCED (1):** `dosarSoapRunner.ts:255` multi_instanta dedupKey — claim-ul nu se sustine; cheia ESTE setul de institutii, deci re-alerteaza corect la schimbare; adaugarea unui suffix `s${prevSnapshotId}` ar fi regresie.
- **MITIGATED (3):** `jwtDenylistRepository.ts:19-20` purge nelimitat (marginit de TTL 1h + purge zilnic); `aiUsageRepository.ts:8,105` routing_tag type (latent, test-acoperit — vezi CR-1); `0036_..._western.down.sql` ireversibilitate (deja documentata in header).
- **RELOCATED (2, pastrate cu linii corectate):** `ai.ts:45-46` comentariu fail-fast; `package.json:30` agregat test.

---

## Per-agent verdicts (rezumat)

| Agent | Verdict | Top finding |
|---|---|---|
| deep-code | HIGH | nameSoap fix inert (H1) |
| workflow-risk | HIGH | nameSoap flapping (H2, acelasi root cause) |
| repo-security-auditor | CLEAN | niciun exploit/unsafe path nou |
| api-contract | CLEAN | envelope consistent (exceptie minora: forma erorilor ICCJ) |
| claude-guard | MEDIUM | CLAUDE.md catalog desincronizat (M1) |
| release-readiness | MEDIUM | RUNBOOK 0035-0038 rollback, SQLite floor 0037 |
| backend-reliability | MEDIUM | composeSignal reuse, purge fara maintenance lock |
| database-change | MEDIUM | purgeOldAiUsage nelimitat (M4), 0036/0037 rollback docs |
| dependency-security | MEDIUM | dependabot fara docker (M5), digest stale |
| data-validation | MEDIUM | validateAiBody item-type, soap substring guard, target_json |
| audit-trail | MEDIUM | logout atributie + revokeSucceeded (M2/M3) |
| test-architect | MEDIUM | dosareIccj/iccjParse/no-jti/streamCap netestate (M6-M9) |

---

*Generat de /full-review (range v2.37.0..HEAD @ cf2651f). Findings verificate vs cod la HEAD; CODEX trebuie sa re-confirme fiecare inainte de implementare.*
