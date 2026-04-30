# Session Handoff - PR-7 + hardening v2.5.1 livrate / PR-8 urmator

**Data**: 2026-04-30
**Branch local**: `main`
**Remote**: `origin/main` urmeaza sa primeasca push-ul cu PR-7 v2.5.0 + patch-ul v2.5.1 (hardening post multi-review). Tag-urile `v2.5.0` si `v2.5.1` nu sunt inca create.
**Versiune curenta**: `v2.5.1`

## TL;DR

PR-7 este implementat local: AI usage tracking + quota visibility.

Aplicatia are acum:

- migration `0010_ai_usage`;
- repository `aiUsageRepository`;
- cost model per provider/model cu fallback safe la 0;
- tracking post-call in `withAiLogging()` pentru single si multi-agent;
- endpoint `GET /api/v1/ai-usage/summary`;
- panou `AI Usage` in Setari API cu 24h / 30 zile / grafic daily;
- `AGENTS.md` pointeaza explicit spre `CLAUDE.md`, `SESSION-HANDOFF.md` si `EXECUTION-ROADMAP.md`.

Nu s-au schimbat prompturile sau flow-ul AI. PR-7 este strict observability/quota visibility.

## Ce s-a schimbat in PR-7

### Backend

Fisiere principale:

- `backend/src/db/migrations/0010_ai_usage.up.sql`
- `backend/src/db/migrations/0010_ai_usage.down.sql`
- `backend/src/db/aiUsageRepository.ts`
- `backend/src/services/aiUsage.ts`
- `backend/src/services/ai.ts`
- `backend/src/routes/ai.ts`
- `backend/src/routes/aiUsage.ts`
- `backend/src/index.ts`

Contracte:

- `POST /api/ai/analyze`
  - response shape legacy ramane `{ analysis }` / `{ error }`;
  - scrie 1 row in `ai_usage` dupa call SDK reusit sau pornit si esuat;
  - `NO_API_KEY` nu scrie row fiindca nu porneste call extern.
- `POST /api/ai/analyze-multi`
  - scrie cate un row per call real: analist 1, analist 2, judge daca faza judge este atinsa.
- `GET /api/v1/ai-usage/summary`
  - v1 envelope `{ data, requestId }`;
  - `data.summary24h`, `data.summary30d`, `data.daily[]`, `data.generatedAt`;
  - costul expus in UI este `cost_usd_milli / 1000`.

### Frontend

Fisiere principale:

- `frontend/src/components/AIUsagePanel.tsx`
- `frontend/src/lib/aiUsageApi.ts`
- `frontend/src/components/ApiKeyDialog.tsx`
- `frontend/src/lib/chart-colors.ts`

Comportament:

- panoul este in dialogul `Setari API`;
- are loading/error/empty states;
- afiseaza cost 24h, cost 30 zile, tokeni input/output, cost mediu per apel;
- graficul foloseste Recharts si seria last 30 days.

### Documentatie / versiune

- `package.json`, `backend/package.json`, `frontend/package.json`, `package-lock.json` bump la `2.5.0`;
- `CHANGELOG.md` si in-app changelog actualizate;
- `README.md`, `STATUS.md`, `CLAUDE.md`, `EXECUTION-ROADMAP.md` actualizate.

## Validari rulate

Status valid pentru hardening pass v2.5.1 (peste baseline `2c30a91` v2.5.0).

- `npm test --workspace=backend -- src/db/aiUsageRepository.test.ts src/services/aiUsage.test.ts src/routes/aiUsage.test.ts`
  - Rezultat: **15/15 teste trecute** post-hardening (clossed-lower-bound + AI_MODELS price-table coverage + 3 error-path service tests + 3 route integration tests).
- `npm test --workspace=backend`
  - Rezultat: **440/440 teste trecute** (+8 fata de v2.5.0, conform asteptarii: noul `routes/aiUsage.test.ts` integration + closed-lower-bound case + AI_MODELS price coverage + 3 error-path service tests).
- `npx tsc --noEmit -p backend/tsconfig.json` - clean.
- `cd frontend && npx tsc --noEmit` - clean.
- `npx biome check` pe fisierele atinse - clean.
- `npm rebuild better-sqlite3` (Node ABI) → `npm test` → `npm run rebuild:electron` (Electron ABI) - sequence completata cu succes.
- TODO smoke desktop post-commit pentru a confirma in runtime `withMaintenanceRead` pe `/summary`, `markShuttingDown` pe graceful shutdown si `purgeOldAiUsage(90)` in scheduler-ul zilnic.

## Reguli active pentru urmatorul agent

- Executa doar planul agreat. Daca vezi o problema care cere schimbare fundamentala, anunta si asteapta aprobare.
- Nu scoate flow-uri existente care functioneaza.
- Electron smoke inseamna aplicatia desktop Electron, nu doar web localhost.
- La lansare Electron:
  - curata `ELECTRON_RUN_AS_NODE`;
  - evita terminal vizibil daca userul nu cere explicit;
  - prefera `Start-Process ... -WindowStyle Hidden`.
- Daca rulezi teste Node si atingi `better-sqlite3`:
  - pentru Vitest poate fi necesar `npm rebuild better-sqlite3`;
  - dupa teste ruleaza obligatoriu `npm run rebuild:electron`.
- SQLite nu permite modificarea unui CHECK existent via `ALTER TABLE`; pentru CHECK-uri trebuie rebuild de tabel sau drop complet de CHECK.
- Nu lasa procese Electron/backend pornite inutil daca nu sunt necesare.

## Probleme/riscuri ramase

- PR-7 (v2.5.0) si patch-ul de hardening v2.5.1 sunt commit-uite local; push-ul pe `origin/main` se executa in aceeasi sesiune. Tag-urile `v2.5.0` si `v2.5.1` nu sunt inca create pe GitHub.
- **Hardening post-multi-review (working tree, peste `2c30a91`)** — adresseaza findings primite pe PR-7 si ataca off-by-one + race conditions + cancellation gaps + shutdown safety:
  - `backend/src/db/aiUsageRepository.ts` — toate query-urile pe fereastra de timp folosesc acum `ts >= ?` (closed lower bound, fix off-by-one pentru randuri care aterizeaza exact la `since`); `nonNegativeInteger` redenumit `clampToNonNegativeInteger` cu predicate `< 0` (acum accepta corect zero); helper exportat `utcDayStart(now, daysBack)`; `listAiUsageLastDays` calculeaza `since` aliniat la UTC-midnight si returneaza `{ rows, since, until }` (BREAKING signature); functie noua `purgeOldAiUsage(retentionDays)` pentru retention.
  - `backend/src/routes/aiUsage.ts` — `summary30d` aliniat la aceeasi fereastra UTC-midnight−29d ca seria daily (era `now − 30×24h`, mismatched); handler-ul wrapped in `withMaintenanceRead` ca sa coopereze cu daily backup writer.
  - `backend/src/services/aiUsage.ts` — `httpStatus` clamped la [100,599] sau null; `console.warn` one-shot (JSON) pe price-table miss cu dedup pe provider+model; insert-failure log structurat single-line JSON (`action: "ai_usage.persist_failed"`); insert SQLite deferred via `queueMicrotask` ca sa iasa de pe response hot path; comentariu cross-reference intre CHECK provider din migration `0010_ai_usage` si price map.
  - `backend/src/services/ai.ts` — best-effort token extraction din SDK error objects (input_tokens/output_tokens/promptTokenCount/candidatesTokenCount); `signal?: AbortSignal` adaugat pe `callAnthropic`/`callOpenAI`/`callGoogle`/`callModel`, compus cu timeout intern via `AbortSignal.any` pentru cancellation propagation.
  - `backend/src/routes/ai.ts` multi-agent — `analystsAbort` AbortController shared, asa incat un analist esuat anuleaza sibling-ul in loc sa-l lase pana la 180s timeout.
  - `backend/src/db/schema.ts` — export nou `markShuttingDown()` care inchide DB si seteaza un latch one-way `shuttingDown`; `getDb()` arunca daca este apelat post-shutdown — previne late `recordAiUsageSafely` microtasks de a redeschide DB-ul.
  - `backend/src/index.ts` — `gracefulShutdown` foloseste acum `markShuttingDown()` in loc de `closeDb()` dupa drain.
  - `backend/src/services/monitoring/scheduler.ts` — `purgeOldAiUsage(90)` cuplat in acelasi timer zilnic ca `purgeOldRuns`, cu try/catch independent.
  - `frontend/src/components/AIUsagePanel.tsx` — fix timezone bug (`new Date(\`${value}T00:00:00Z\`)` + `timeZone: "UTC"`); `inflightRef` AbortController ca refresh re-fire sa anuleze request-ul anterior; caption "Informativ" — quota este informativa pe desktop.
  - Teste: fisier nou `backend/src/routes/aiUsage.test.ts` (route-level integration: envelope shape, owner isolation, daily-sum=summary30d invariant); `aiUsageRepository.test.ts` extins cu closed-lower-bound case si noul return shape; `services/aiUsage.test.ts` extins cu AI_MODELS price-table coverage (fiecare modelId are pret nenul).
- Nu exista inca GitHub release/tag `v2.4.1`, `v2.4.2` sau `v2.5.0`.
- Lansarea pe profilul normal a returnat `process_singleton_win.cc:457 Lock file can not be created! Error code: 5`
  desi nu ramasese proces Electron vizibil. Smoke-ul PR-7 a fost rulat pe profil temporar curat in `C:\tmp`.
- Cost modelul AI foloseste valori configurate in cod pentru modelele curente din aplicatie; daca providerii schimba preturile, trebuie actualizat manual. Hardening-ul a adaugat warn one-shot la price-table miss, dar valorile raman manuale.
- Pe desktop quota este informativa/bypass (acum si etichetat explicit "Informativ" in UI). Enforce real ramane pentru web PR-9+.
- Pentru PR-9 web/server mode trebuie auth real inainte de expunere remote.
- `xlsx@0.18.5` ramane risc acceptat temporar, documentat si mitigat prin limite stricte.

## Urmatoarea etapa

Conform roadmap:

### PR-8 - Admin pages + roles guard

Scop:

- pagini `/admin/*` ascunse pe desktop;
- pe web, acces doar pentru `role='admin'`;
- pregateste audit/quota override pentru PR-9+ fara sa expuna functionalitate pe desktop.

Tasks planificate:

1. Middleware `requireRole('admin')` pe toate rutele admin viitoare.
2. UI skeleton pentru users/audit/quota.
3. Desktop: link ascuns si 403 daca ruta este apelata direct.
4. Teste pentru role guard si owner/admin separation.
