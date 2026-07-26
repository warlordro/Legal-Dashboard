# Plan implementare — remediere findings /full-review v2.37.1 + v2.38.0

> **Sursa:** `CODEX-REVIEW-v2.37.1-v2.38.0.md` (43 findings confirmate, meta-reviewed Opus/GPT/Kimi). Acest plan stadializeaza remedierea pe blast-radius, pentru implementare safe + code quality.
> **Branch:** `feat/v2.38.0-hardening-model-refresh` (nepushat) — fix-urile intra in v2.38.0. HIGH-ul (bug v2.37.1 live) poate fi cherry-pick-uit ulterior pe un hotfix `main` daca v2.38.0 intarzie.
> **Executie:** subagent-driven — per task: implementer (TDD unde se cere, gate verde, biome, commit scoped) → 3 revieweri adversariali in paralel (spec + corectitudine + risc) → bucla de fix. Verificare gate intre etape. STOP inainte de `git push`.
> **Sub-skill:** superpowers:subagent-driven-development.

## Asumptii explicite (Karpathy)
1. Fix-urile pe cod live (HIGH nameSoap, M4 purge, robustete LOW) au prioritate peste doc-sync.
2. Findings `[meta]`-calibrate se implementeaza conform formularii rafinate din review (scoping HIGH, `.env` root-only, dup `normalizeIccjNumar` = test de egalitate nu eliminare, etc.).
3. **NU se auto-implementeaza (optional, notat la final):** Dockerfile digest refresh (necesita lookup registry live + depinde de dependabot docker), `purgeExpiredJti` standalone interval (gap pre-existent MONITORING_ENABLED=0), wrap `withMaintenanceRead` pe purge-uri (parity pre-existenta), reshape envelope erori ICCJ (schimbare de contract API — decizie produs), F1 CRLF (igiena repo-wide separata).
4. Fiecare task ramane chirurgical; testele noi trebuie sa PICE pe codul curent inainte de fix (red-green).

---

## Etapa 1 — HIGH (LIVE in productie) — vocabular institutie name_soap

### T1.1 — Fix mismatch enum-vs-display + test de regresie real
**Files:** `backend/src/services/monitoring/nameSoapRunner.ts` (~106-108, 253-267), `backend/src/services/monitoring/diff/nameSoap.ts` (build/compare), `backend/src/services/monitoring/diff/nameSoap.test.ts`.
- **Red:** rescrie testul `nameSoap.test.ts:280-298` sa treaca prin `buildNameSoapSnapshot` cu string-uri DIVERGENTE (`failedInstitutii:["TribunalulBUCURESTI"]`, returned dosar `institutie:"Tribunalul Bucuresti"`) + assert ca suprimarea `dosar_disappeared` SI carry-forward functioneaza. Trebuie sa PICE pe cod curent.
- **Green:** normalizeaza ambele parti inainte de `failed.has(...)`. Preferat (b): mapeaza `target.institutie[]` prin `getInstitutieLabel` + `normalizeInstitutie` inainte de a popula `failedInstitutii` (oglindeste `filterByInstitutii` din `Dosare.tsx:80-86`). Alternativ (a): stampileaza institutia-param pe dosarul fetch-uit in `nameSoapRunner` (~256-259).
- **Scope (confirmat):** doar joburi institution-scoped; all-institution (`institutii=[undefined]`) e moot. Pastreaza comportamentul all-institution neschimbat.
- **Gate:** `npm test --workspace=backend -- nameSoap nameSoapRunner` + backend tsc.
- **Commit:** `fix(monitoring): name_soap — normalize institutie enum<->display before failed-institution suppression (live v2.37.1 false dosar_disappeared)`

---

## Etapa 2 — MEDIUM cod (corectitudine/fiabilitate)

### T2.1 — Cluster audit logout (M2+M3, un singur patch)
**File:** `backend/src/routes/auth.ts` (logout, ~68-98).
- Extrage `ip`/`userAgent`/`requestId` explicit din `c` (fara a pasa `c` → evita throw `getOwnerId`); `let revokeSucceeded=false` setat la succesul `revokeJti`; adauga in `detail`: `jtiPresent: Boolean(payload?.jti)`, `revokeSucceeded`.
- **Gate:** `npm test --workspace=backend -- auth` + tsc. Adauga assert pe noul detail intr-un test existent de logout.
- **Commit:** `fix(auth): logout audit — capture ip/ua/requestId + record jtiPresent/revokeSucceeded`

### T2.2 — purgeOldAiUsage chunking (M4)
**File:** `backend/src/db/aiUsageRepository.ts` (~404-409).
- Chunk rowid-IN-LIMIT loop (chunkSize=1000), oglindind `purgeOldRuns`/`purgeOldAuditLog`. Fara migratie (`idx_ai_usage_global_time` exista).
- **Gate:** `npm test --workspace=backend -- aiUsage` + tsc.
- **Commit:** `perf(db): chunk purgeOldAiUsage DELETE to avoid long write-lock on large history`

### T2.3 — purgeExpiredJti standalone interval (inclus la cererea userului)
**File:** `backend/src/index.ts` (~597-616 web-gated block + ~749 shutdown).
- Adauga un timer standalone zilnic care apeleaza `purgeExpiredJti()`, **oglindind exact** `reservationPurgeInterval` (web-gated `getAuthMode()==='web'`, `unref()`, try/catch independent, clear pe shutdown). Astfel `jwt_denylist` ramane marginit chiar cu `MONITORING_ENABLED=0`.
- **Gate:** `npm test --workspace=backend -- index` + tsc.
- **Commit:** `fix(web): standalone daily purgeExpiredJti interval (web-gated) so jwt_denylist stays bounded when MONITORING_ENABLED=0`

---

## Etapa 3 — MEDIUM teste (acoperire cod nou)

### T3.1 — dosareIccj route test (M6)
Creaza `backend/src/routes/dosareIccj.test.ts` (app.request + vi.mock pe `iccjClient.ts`; simboluri `searchIccjEnriched`/`fetchIccjDetail`/`searchTermeneByDosarIccj`; mount `/api/dosare-iccj`; env `ICCJ_ROUTES_DISABLED`): badSectie 400, isValidDate 400, TimeoutError→504, `ICCJ_ROUTES_DISABLED`→503+Retry-After. **Gate:** `npm test --workspace=backend -- dosareIccj`. **Commit:** `test(iccj): cover dosareIccj route — 504/badSectie/badDate/disabled`

### T3.2 — iccjRunner ICCJ_PARSE_FAIL (M7)
`backend/src/services/monitoring/iccjRunner.test.ts`: `fetchCurrentDosar` arunca `IccjParseError` → `status="error"`, `errorCode="ICCJ_PARSE_FAIL"`, fara snapshot. **Gate:** `-- iccjRunner`. **Commit:** `test(monitoring): cover iccjRunner IccjParseError -> ICCJ_PARSE_FAIL branch`

### T3.3 — logout no-jti (M8)
`backend/src/routes/auth.test.ts`: token valid fara `jti` + user activ → 200, cookie sters, `jwt_denylist` gol. **Gate:** `-- auth`. **Commit:** `test(auth): cover logout with pre-v2.38 token lacking jti (no denylist write)`

### T3.4 — streamCap body-null (M9)
`backend/src/util/streamCap.test.ts`: `Response(null,{status:204})`→`""`; cu `maxBytes=1`→`""` fara throw. **Gate:** `-- streamCap`. **Commit:** `test(net): cover streamCap null-body branch`

---

## Etapa 4 — MEDIUM config + doc-sync

### T4.1 — dependabot docker ecosystem (M5)
`.github/dependabot.yml`: adauga blocuri `docker` pentru `/` (Dockerfile) + `/deploy` (compose). **Gate:** YAML valid. **Commit:** `ci(dependabot): add docker ecosystem (Dockerfile + deploy compose)`

### T4.2 — doc-sync de securitate + reziduale (batch)
- `CLAUDE.md:118-139` — adauga 3 bullet-uri (JWT revocation, sameSite Strict, ACK retras).
- `SECURITY.md:159` — `JWT_ISSUER`/`AUDIENCE`: "Optional" → "Required in web auth mode — fatal boot".
- `HARDENING.md:25` — Dependabot `[ ]` → `[x] livrat v2.38.0`.
- root `.env.example` (DOAR root) — adauga `RNPM_TIMEOUT_MS=  # OPTIONAL — default 60000` (backend-ul il are deja la :161).
- `RUNBOOK.md:382` — bloc rollback 0035-0038 (ordine down 0038→0035; 0036 no-op ireversibil; 0038 readuce tokenele).
- `0037_..._latency.down.sql` — comentariu floor SQLite >=3.35; `0036_..._western.down.sql` — nota recovery din backup pre-0036.
- `PLAN-v2.38.0-hardening-model-refresh.md:574` (CR-2) — `AUTH_MODE` → `LEGAL_DASHBOARD_AUTH_MODE`.
- `audit/ADVERSARIAL-REVIEW-2026-06-13.md` (CR-3) — prepend header de scope + tabel disposition (finding→commit).
- **Gate:** tsc (CLAUDE.md atinge doar text), grep sanity. **Commit:** `docs: sync security catalog + env/rollback/audit docs with v2.37.1+v2.38.0 reality`

---

## Etapa 5 — LOW cod (robustete/validare)

### T5.1 — soap.ts WAF guard tag-shape (+ test)
`soap.ts:256-259`: `!/<CautareDosareResult[\s>\/]/.test(xml)`. + test pagina non-XML cu string-ul. **Commit:** `fix(soap): require XML tag shape for CautareDosareResult envelope guard`

### T5.2 — validateAiBody item-type (`[meta]` justificare intarita: `parti:[null]` → 500)
`ai.ts:604-609`: dupa cap, respinge daca vreun element nu e obiect non-null. + test. **Commit:** `fix(ai): reject non-object items in parti/sedinte (buildPrompt TypeError -> 500)`

### T5.3 — iccjRunner target_json guard (`[meta]` formulare softened)
`iccjRunner.ts:53`: guard `typeof parsed?.numar_dosar !== "string"` → `IccjParseError`. **Commit:** `fix(monitoring): guard malformed target_json -> ICCJ_PARSE_FAIL not opaque error`

### T5.4 — aiUsage safe wrappers
`aiUsage.ts:147-148`: `safeLatencyMs` (finit,>=0,round) + `safeErrorType` (string, slice 128). **Commit:** `fix(ai): sanitize latency_ms/error_type before persist (safe wrappers)`

### T5.5 — dosareIccj 504 Retry-After
`dosareIccj.ts` (3 catch mapError): daca status===504 → `Retry-After: 60`. **Commit:** `fix(iccj): add Retry-After to 504 upstream-timeout responses`

---

## Etapa 6 — LOW observabilitate

### T6.1 — authProvider jwt_revoked audit discriminator
`authProvider.ts:82-85`: `recordAudit(null,'auth.jwt_revoked',{...ip,ua,detail:{jti}})` best-effort inainte de throw. **Commit:** `feat(audit): discriminated auth.jwt_revoked audit row on revoked-token replay`

### T6.2 — logout jti-absent warn + jwt purge audit/heartbeat
`auth.ts:68` else: `console.warn` jti-absent. `scheduler.ts:438-458`: `recordAudit jwt_denylist.purged` + `SELECT COUNT(*)` heartbeat neconditionat. **Commit:** `feat(observability): log jti-absent logout + durable jwt_denylist purge audit/heartbeat`

### T6.3 — composeSignal fresh budget (`[meta]` softened — optional robustete)
`ai.ts` callOpenAI: `composeSignal(timeout, signal)` proaspat inainte de fallback chat.completions. **Commit:** `fix(ai): fresh timeout budget for chat.completions fallback`

---

## Etapa 7 — LOW drift/quality + teste

### T7.1 — normalizeIccjNumar equality test (`[meta]` — test, NU eliminare dup)
Test care asserteaza ca regex-ul din `monitoringJobsRepository.ts:94` == `iccjFetchCurrent.ts:23`. **Commit:** `test(iccj): equality guard for duplicated normalizeIccjNumar regex`

### T7.2 — ICCJ_SECTII drift test
Test backend: `ICCJ_SECTII_IDS` == set valori frontend `iccjSectii.ts`. **Commit:** `test(iccj): drift guard backend ICCJ_SECTII_IDS vs frontend list`

### T7.3 — electron test in CI
`.github/workflows/lint-test.yml`: pas `node --test "electron/*.test.cjs"`. **Commit:** `ci: run electron node:test suite in CI`

### T7.4 — teste mici + comentarii
0036 migration UP test; `resolveOpenRouterSlug` gemini-flash-3.5 pin + old-key null; scheduler purge error-path test; `ai.ts:45-46` comentariu fail-fast→warn-and-fallback; `ai.ts:47-56` override warn→`console.error` structurat. **Commit:** `test+docs(ai): pin slug map, migration 0036, purge error-path; fix override log level + stale comment`

---

## Verificare finala (dupa toate etapele)
`npx biome check .` + backend/frontend tsc + `npm run build` + suita completa (backend + frontend + electron). STOP inainte de push.

## Optional / deferat (NU auto-implementat — decizie user)
- **Dockerfile digest refresh** — acoperit durabil de intrarea dependabot docker (T4.1); bump manual unic amanat post-patch Node 17-iunie (tinta mobila, fara valoare pana atunci).
- **Wrap `withMaintenanceRead` pe purge-uri** — parity pre-existenta pe TOATE purge-urile, impact ~nul; recomandare: documenteaza ca intentional, nu schimba infra partajata.
- **Reshape envelope erori ICCJ** — schimbare de contract API, cere decizie produs + coordonare frontend.
- **F1 CRLF** — igiena repo-wide separata, inofensiv functional.

(NOTA: `purgeExpiredJti` standalone a fost mutat IN scope ca T2.3 la cererea userului.)

---

## Status final (2026-06-14)

**TOATE etapele 1-7 livrate** pe `feat/v2.38.0-hardening-model-refresh` (22 commit-uri de remediere peste baza v2.38.0). Fiecare task: implementer TDD → 3 revieweri adversariali in paralel → toate APPROVE non-blocking, 0 runde de fix fortate.

Commit-uri cheie: `909489e` (HIGH name_soap), `aa49c83`/`ab55904`/`810a3b2` (Etapa 2), `1aa3b21`/`b758e3b`/`08a890b`/`6e179ce` (Etapa 3), `93ac07f`/`ae12729` (Etapa 4), `b716dff`/`2a8c268`/`82160bd`/`b92d53c`/`a0ff9d1` (Etapa 5), `c9ffa56`/`6811fa3`/`effb03e` (Etapa 6), `2c366a6`/`3b251d5`/`0c43ac1`/`20ad0e1` (Etapa 7).

**Limitare cunoscuta acceptata (T6.2, advisor-confirmat DEFER):** in web mode cu monitoring activ, `jwt_denylist` are doua cai de purge (intervalul standalone web-gated din `index.ts` + purge-ul scheduler-ului). Randul de audit `jwt_denylist.purged` provine doar de la calea care a sters efectiv randuri, deci poate lipsi pe un ciclu cand intervalul standalone castiga cursa. Heartbeat-ul neconditionat (count ramas, fiecare ciclu) acopera observabilitatea; corectitudinea (denylist marginit) e neafectata. Fix-ul ar atinge calea boot-critica cu o zi inainte de deploy — amanat ca task separat reviewat post-deploy daca se doreste zero findings.

**Decizie T7.3 (electron CI):** forma glob `node --test "electron/*.test.cjs"` pastrata; forma directory `node --test electron/` esueaza pe runner (nu descopera fisierele). Verificare prim-run CI: step-ul trebuie sa arate `tests 2 / pass 2`.

**Reziduu doc-sync stagiu final:** `SECURITY.md:86` ("si ack explicit") corectat — gate-ul `ACK_NO_AUTH` retras in v2.38.0; aliniat cu `SECURITY.md:210`. CHANGELOG.md + in-app changelog actualizate cu subsectiunea de remediere post-review.
