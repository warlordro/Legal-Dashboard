# Legal Dashboard — Roadmap de Hardening

> **Scop:** lista de items care muta aplicatia din „production-ready pentru use intern" → „production-ready pentru deployment multi-user la firme externe".
>
> **Nu este** tech debt (codul nu e stricat). **Este** maturizare pentru adoption non-tech + compliance.

Items filtrate din analiza completa: 15 actionable. Restul (~35) sunt fie overkill pentru contextul actual (i18n, Prometheus, ADR-uri, snapshot tests PDF), fie deferred pentru tranzitia web (auth, multi-tenancy, Postgres). Nu le re-adauga aici fara reevaluare.

Format: `[ ]` TODO → `[~]` in progress → `[x]` done. Cand un item e done, lasa-l aici cu `[x]` + data ca referinta.

---

## Faza 1 — CI Foundation (~1 saptamana)

**De ce prima:** fara CI, orice item de mai jos e „verde pe laptopul meu". Cu CI, restul capata gate real.

- [ ] **CI pipeline GitHub Actions** (`.github/workflows/ci.yml`) — rula pe PR + push main: `npm ci` cached + `npx tsc --noEmit` pe ambele workspace-uri + `npx vitest run` + build frontend + build backend. Fara publish. **Effort:** ~4h.
- [ ] **Biome gate in CI** — `npx biome check` ca step obligatoriu. Biome.json exista deja. **Effort:** ~1h.
- [ ] **Dependabot** (`.github/dependabot.yml`) — patch+minor grupate saptamanal, PR separat per major. Nativ GitHub, nu Renovate (overkill pentru solo dev). **Effort:** ~30 min.

## Faza 2 — Security active findings (~3-4 zile)

Sunt fix-urile pentru findings-urile ACTIVE P1 din auditul intern.

- [ ] **Eliminare fallback localStorage pentru chei AI in web mode** — detecteaza `!window.desktopApi` → ascunde dialogul „Setari AI" + endpoint-urile AI raspund 503 daca nu au cheie env. Plaintextul in localStorage e security theater. **Effort:** ~2h.
- [ ] **Bump dompurify + jspdf** (doar patch/minor, nu major) — `npm update` pe ambele + re-test exports PDF (changelog + analiza AI). **NU migrare xlsx → exceljs** (xlsx e folosit doar pentru export/write, nu parse — CVE-urile nu aplica). **Effort:** ~2h.
- [ ] **Bump Hono + @hono/node-server** — backend HTTP-facing, orice CVE pe layer-ul HTTP e impact maxim cu `LEGAL_DASHBOARD_ALLOW_REMOTE=1`. Bump + vitest + smoke test. **Effort:** ~2h.

## Faza 3 — Crash visibility (~3 zile)

Fara astea, o exceptie intr-un sub-tree React daramaa tot renderer-ul; nu ai date cand ceva se rupe la user.

- [ ] **Error boundaries React** — global `<ErrorBoundary>` wrapping `<App>` + boundary-uri locale pe `DosareTable`, `RnpmDetailModal`, `dosare-ai-analysis-panel`. Fallback UI: „Reload section" + breadcrumb cu component name. **Effort:** ~4h.
- [ ] **Request ID middleware (Hono)** — UUID v4 per request, propagat in `X-Request-ID` response header + in toate log-urile. Debug „de ce a esuat requestul X" devine trivial. **Effort:** ~1h.
- [ ] **`/health/detailed` endpoint** (auth-protected chiar si pe localhost) — status SQLite (`integrity_check`), status backup (ultimul + dim + varsta), status memorie (RSS/heap), status ultimul AI call per provider. **Effort:** ~4h.

## Faza 4 — Data integrity (~3-4 zile)

Protectii pentru datele utilizatorului. Corruption SQLite e rar dar silentios — trebuie detectat.

- [ ] **`PRAGMA integrity_check` la boot** — in `backend/src/db/schema.ts` dupa `initSchema()`, inainte de prewarm. Daca nu e `"ok"`, log warning + expune prin `/health/detailed` (user poate sa decida restore). **Effort:** ~2h.
- [ ] **Backup verification automata** — dupa `runDailyBackup()` deschide snapshot-ul intr-o conexiune temporara + `integrity_check`. Esec → log + retry next boot. Un backup care nu se restaureaza = fals confort. **Effort:** ~2h.
- [ ] **Schema version table** — `_schema_versions` (version, applied_at, migration_hash). La boot: refuza startup daca DB e mai noua decat app-ul (downgrade detection). Previne „user instaleaza versiune veche peste DB noua → crash silentios". **Effort:** ~3h.
- [ ] **WAL checkpoint periodic** — `setInterval(PRAGMA wal_checkpoint(PASSIVE), 5 min)` in backend. 10 linii. Previne WAL bloat intre VACUUM-uri manuale. **Effort:** ~1h.
- [ ] **Tests pentru migrari SQLite** — `migrations.test.ts` care porneste cu DB gol, ruleaza toate migrarile, ruleaza din nou (idempotency), insereaza date sintetice, `integrity_check` + `foreign_key_check`, testeaza `deleteAllAvize` cu CASCADE. Migrarea `descriere-dedup` e cea mai complexa — merita test dedicat. **Effort:** ~1 zi.

## Faza 5 — Compliance & audit (~2-3 zile)

**Non-negociabil inainte de distribuirea catre prima firma externa.** GDPR pe date juridice nu e optional.

- [ ] **Politica de confidentialitate** (`PRIVACY.md` + pagina in Manual) — explicit: ce colecteaza app-ul (zero local, DA pentru providerii AI selectati), ce se trimite la Anthropic/OpenAI/Google, ce retine localStorage + SQLite, cum sterge userul totul (path catre `<userData>`). **Effort:** ~4h.
- [ ] **Consent dialog la prima pornire** — ecran de bun-venit inainte de prima utilizare: „App-ul trimite datele dosarului catre provider-ul AI selectat. Accept?", persist in settings. **Effort:** ~4h.
- [ ] **Audit log local pentru actiuni sensibile** — log separat de log-urile tehnice (tabela `audit_log` in SQLite): cautari efectuate (user, query, timestamp), exporturi produse, configurari AI schimbate, restore backup. „Cine a cautat dosarul X pe data Y" devine raspuns rapid. **Effort:** ~1 zi.

## Faza 6 — Release engineering (~4-5 zile + buget)

- [ ] **Code signing Windows (OV certificate, ~$200/an)** — semnare cu `signtool` in release pipeline. Binary nesemnat = SmartScreen „Windows protected your PC" = blocker adoption non-tech. **Effort:** 3-4 zile (includes setup cert + CI integration). **Cost:** $200/an recurent.
- [ ] **Release pipeline GitHub Actions** (`.github/workflows/release.yml`) — triggered pe tag `v*`: build Windows `.exe` NSIS + macOS `.dmg` (x64 + arm64, doar daca urmaresti Mac), publish ca GitHub Release, changelog auto-extras din `changelog-entries.tsx`. **Effort:** ~1 zi.

## Faza 7 — CodeRabbit findings 2026-04-19 (pre-web-deploy + pre-monitorizare auto)

**De ce aici:** auditul CodeRabbit din 19 aprilie 2026 a scos 4 Critical + 7 Important. Le tratam inainte de doua borne majore:
- **Tranzitia web** (`LEGAL_DASHBOARD_ALLOW_REMOTE=1`, deploy server sau Docker image) — C1-C4 + I2 sunt **blocante**.
- **Modul Watched Dosare cu auto-sync** (Pilon B din sectiunea urmatoare) — sync periodic multi-dosar reintroduce exact acelasi fanout concern ca C1; capacitatea SOAP trebuie capped uniform inainte de auto-interval.

Un finding (I1 — dublu `validateAiBody`) a fost verificat direct vs cod si **respins ca false positive** (singur apel la `ai.ts:106`, liniile pre-validation sunt existence guards, nu re-validari) — detaliat mai jos la Rejected.

### Blockers pentru web deploy (fix inainte de orice flag `ALLOW_REMOTE` sau Docker push)

- [x] **C1 — SOAP fanout cap pe GET /api/dosare + /api/termene** (2026-04-25) — aplicat `MAX_SOAP_FANOUT=500` (`backend/src/util/validation.ts`) inainte de fanout + nou cap `MAX_DOSARE_RESPONSE=5000` post-merge. Fanout-too-large → 400, response-too-large → 413. **Follow-up Faza 9:** lower cap to ~200 + p-limit concurrency + per-institutie row cap (memory bound pre-`JSON.stringify`).
- [x] **C2 — rate-limit fail-closed pe IP irezolvabil** (2026-04-25) — `getConnInfo(c).remote.address` falsy → HTTP 503 in [backend/src/middleware/rate-limit.ts](backend/src/middleware/rate-limit.ts). 4 noi teste ([rate-limit.test.ts](backend/src/middleware/rate-limit.test.ts)). **Follow-up Faza 9:** normalize `::ffff:127.0.0.1` (overlap cu O5).
- [x] **C3 — Dockerfile non-root + fara secrete baked** (2026-04-25) — multi-stage build (`deps` instaleaza native binding, runtime drops root via `addgroup/adduser app` + `USER app`). Scoate `COPY .env*`, adauga `.dockerignore` exhaustiv, HEALTHCHECK in image. **Critical fix:** stage de deps adauga `better-sqlite3` din source (alpine musl); fara el image-ul crash-a la runtime (bundle externalizeaza native binding).
- [x] **C4 — docker-compose loopback-bind + healthcheck** (2026-04-25) — `127.0.0.1:3002:3002` default in [docker-compose.yml](docker-compose.yml), comentariu explicit despre reverse-proxy. Portul aliniaza la `LEGAL_DASHBOARD_PORT=3002`. **Follow-up Faza 9:** env-driven `LEGAL_DASHBOARD_BIND_HOST` pentru deploy LAN fara edit la compose.
- [x] **I2 — CORS gate pe NODE_ENV** (2026-04-25) — CORS mounted doar daca `NODE_ENV !== "production"` in [backend/src/index.ts](backend/src/index.ts). **Follow-up Faza 9:** `LEGAL_DASHBOARD_CORS_ORIGINS` env override pentru deploy cross-origin.

**Total blockers: ~3h** — singur sprint inainte de primul push public.

### Desktop UX + convention hygiene (nice-to-have pre-monitorizare)

- [ ] **I4 — splash „Optimizare baza de date..." la boot pre-VACUUM** — cand `needsDescriereMigration()` e true, afiseaza BrowserWindow minimal inainte de `require(dist-backend)`; VACUUM sincron blocheaza 30-90s pe DB de ~100MB fara feedback. Alternativ: defer VACUUM post-first-paint + worker thread. **Fisiere:** [electron/main.js](electron/main.js) L149 + [backend/src/db/schema.ts](backend/src/db/schema.ts) L315-347. **Effort:** ~2h.
- [ ] **I5 — validare `searchType` enum la repository** — tuple `SEARCH_TYPES` + throw on miss in `searchRepository.saveSearch`. Previne typo-uri tipu `"rnmp"` care polueaza silent history. **Fisier:** [backend/src/db/searchRepository.ts](backend/src/db/searchRepository.ts) L15,29. **Effort:** ~30 min.
- [ ] **I6 — `rateLimitMap` cleanup pe interval cu unref** — `setInterval(cleanup, 60_000).unref()` + scoate sweep-ul size>1000 din hot path (blocheaza request thread cand se declanseaza). Relevant doar in web mode sub scan traffic. **Fisier:** [backend/src/middleware/rate-limit.ts](backend/src/middleware/rate-limit.ts) L33. **Effort:** ~30 min.
- [ ] **I7 — `any` → `unknown` + narrowing in ai.ts handlers** — `let body: any` (L34, L94 in [backend/src/routes/ai.ts](backend/src/routes/ai.ts)) → `unknown`; `validateAiBody` returneaza shape tipat in loc de `string | undefined`. Singurul `any` ramas in `backend/src/**`. **Effort:** ~1h.

### Suggestions (opportunistic, independent)

- [ ] **`frontend/src/lib/api.ts` — ultimul `json: any`** — `get<T>` helper L17 foloseste `any` pentru parsed body; inlocuieste cu `unknown` + narrow guard la call site. **Effort:** ~15 min.
- [ ] **README troubleshooting — documenteaza `ELECTRON_DISABLE_GPU=1`** — opt-out exista in cod (main.js) + documentat in DOCUMENTATIE.md L502 + START.md L72, dar lipseste din README. **Effort:** ~10 min.
- [ ] **`captchaSolver.ts` race mode — log orphan solve-id** — 2Captcha SDK ignora AbortSignal → losing provider continua sa consume credite. Log `solve_id` la cancel + nota explicita in SECURITY.md despre dubla-facturare in race mode. **Effort:** ~30 min.
- [ ] **`rnpmClient.ts` — comentariu anti-bot pe User-Agent/Referer fixate** — previne „curatenia" gresita de un maintainer viitor. **Effort:** ~5 min.
- [ ] **`rnpm.ts validateParamsDepth` — pinning test** — unit test care asserteaza `depth=4, stringLen=500` ca sa nu se relaxeze silent. **Effort:** ~30 min.
- [ ] **`avizRepository.cleanupOrphanDescrieri` — debounce pe retries** — daca `clientRequestId` retries declanseaza apeluri repetate in aceeasi secunda, debounce la 1s. **Effort:** ~30 min.

### Done

- [x] **I3 — decodeXmlEntities in parseDosar** (2026-04-19) — helper exportat in [backend/src/soap.ts](backend/src/soap.ts), aplicat la leaf fields (nume, obiect, solutie, institutie, departament, categorieCaz, stadiuProcesual). Teste: 5 noi (entity decoding + invariant „&amp; nu dublu-decodeaza"). Scopul: nume parti `S.C. X &amp; Co.` redau corect in UI/XLSX.

### Rejected (false positive verificat vs cod)

- **I1** — CodeRabbit: „`validateAiBody` apelat de doua ori in `/analyze-multi`". Verificare directa [backend/src/routes/ai.ts:102-109](backend/src/routes/ai.ts): UN singur apel la L106. L102-103 sunt `if (!body || typeof body !== "object")` + `if (!body.dosar)` — existence checks, nu re-validari. Not actionable.

## Faza 8 — Multi-review findings 2026-04-24 (deep-code + backend-reliability + test-architect + release-readiness + claude-guard)

**De ce aici:** rulare `/multi-review` pe 24 aprilie 2026 peste HEAD v2.0.6 (clean tree, commit `3b78687`). Findings noi fata de Faza 7 — items care se suprapun cu C1-C4/I2/I4/I6/I7 sunt cross-referite, nu duplicate.

### Release blockers (fix inainte de urmatorul tag `v2.0.7`)

- [x] **B1 — `scripts/build-server.js:30` cu path rupt** — copiaza `.env.example` din repo root, fisier care nu exista (doar `backend/.env.example`). `npm run dist:server` arunca inainte sa produca ZIP-ul. ✅ Rezolvat in [build-server.js:30](scripts/build-server.js#L30) (path schimbat la `backend/.env.example`).
- [x] **B2 — `release/Legal Dashboard Setup 1.0.0.exe` + `.blockmap` inca prezente** — daca folder-ul e zipat/distribuit, installer-ul vechi pleaca odata cu cel nou. Rollback la versiune veche peste DB noua = cascada de probleme (vezi Faza 4 schema version table). ✅ Rezolvat: artefactele 1.0.0 sterse + adaugat `clean:release` + `predist*` hooks in [package.json](package.json) (electron-builder porneste de pe `release/` curat la fiecare build).
- [x] **B3 — banner stale `v1.0.0` in backend** — [backend/src/index.ts:128](backend/src/index.ts) hardcoded la `Legal Dashboard v1.0.0` cand `package.json` zice 2.0.6. User-vizibil in Electron console + Docker logs + undermineaza bug reports. ✅ Rezolvat: `APP_VERSION` citita la runtime via `require("../../package.json")` cu fallback `"unknown"` (esbuild bundle-uieste JSON-ul in CJS).

### Data integrity + reliability (desktop-critical)

- [x] **DR1 — `restoreFromBackup` non-atomic** (2026-04-25) — stage la `<dbPath>.restore.tmp` apoi `fs.rename` (atomic same-FS pe Win/Linux). Pre-restore snapshot creat inainte. WAL/SHM unlinked best-effort. 7 noi teste in [backup.test.ts](backend/src/db/backup.test.ts) (atomicity + path traversal + missing). **Bonus fix:** `pruneOld` separat pool dated (`BACKUP_RETAIN_COUNT=7`) vs pre-restore (`PRE_RESTORE_RETAIN=5`) ca un retain sa nu starve celalalt; `latestBackupMtime` ignora pre-restore (skip-daily logic). **Follow-up Faza 9:** fsync tmp + dir; `db.backup()` pentru pre-restore snapshot (coherent vs WAL); surface unlink failures.
- [ ] **DR2 — maintenance mutex pe restore/compact/saved-all** — [backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts) L266 (`DELETE /saved/all`), L322 (`/compact`), L352 (`/backups/restore`) nu au garduri de concurrenta vs request-uri in zbor. Dublu-click pe „Restore" lanseaza doua restore-uri paralele peste acelasi fisier. Fix: un Promise-backed mutex module-level in `schema.ts`, acquired de restore/compact/wipe + de fiecare write la intrare in tx. **Effort:** ~2h.
- [x] **DR3 — boot migration blocheaza request path** (2026-04-25) — schema/prewarm rulate inainte de `serve()` (exit 1 on fail). `/health` returneaza 503 cu `{status:"starting"}` pana cand `ready=true`. **Important:** `ready` flip mutat in callback-ul `serve(...)` (event `listening`), NU pe tick-ul urmator — altfel `/health` ar raspunde 200 inainte ca port-bind sa termine, iar `EADDRINUSE` ar deveni `unhandledRejection`. Adaugat `httpServer.on("error", ...)` ca explicit handler. **Follow-up Faza 9:** broaden prewarm la toate tabelele migrate (sau `PRAGMA integrity_check`); defer `runDailyBackup` 30-60s pentru a nu hami latency cu p95 al primei cereri.
- [ ] **DR4 — `runDailyBackup` e one-shot, nu daily** — [backend/src/index.ts:103](backend/src/index.ts) invoca o singura data la boot; proces care sta up >24h (desktop obisnuit) nu mai backup-eaza. 24h idempotency check din [backup.ts:147](backend/src/db/backup.ts) e defensive, dar nu TRIGGEREAZA. Fix: `setInterval(runDailyBackup, 60*60*1000).unref()`; check-ul intern inca previne duplicate. Cancellable pe shutdown. **Effort:** ~30 min.
- [ ] **DR5 — graceful shutdown nu dreneaza in-flight** — [backend/src/index.ts:110-120](backend/src/index.ts) apeleaza `gracefulShutdown` apoi `process.exit(0)` pe acelasi tick. Nu exista `server.close()` + asteptare request-uri active. SIGTERM in mijlocul `/analyze-multi` (3×3min paid calls) = pierdere directa. Fix: pastreaza handle-ul din `serve({...})`, track in-flight request-uri intr-un `Set`, drain cu timeout 30s, apoi `closeDb()`. **Effort:** ~2h.
- [ ] **DR6 — zero log persistent post-crash** — [electron/main.js](electron/main.js) foloseste `console.error`, Hono `logger()` scrie la stdout — pachete Electron nu persista stdout nicaieri descoperibil. User raporteaza „a crashuit" = zero evidenta. Fix: pipe stdout/stderr la `<userData>/logs/legal-dashboard.YYYY-MM-DD.log`, rotation 7 zile (mirror `BACKUP_RETAIN_COUNT`). Expune path-ul in Manual. Unlock debugging de teren. **Effort:** ~3h.
- [ ] **DR7 — `saveSearch` committed inainte de orice aviz** — [backend/src/services/rnpmSearchService.ts:126-132](backend/src/services/rnpmSearchService.ts) insereaza randul cu `total_results=N` inainte de detail-fetch loop. Crash dupa saveSearch + inainte de `saveAvizFull` → istoric arata count fictional cu zero avize linkate. Fix: defer saveSearch la primul aviz persistat, sau update-on-completion. **Effort:** ~1h.
- [ ] **DR8 — RNPM parts 1-4 fara retry budget** — [backend/src/services/rnpmClient.ts:228-285](backend/src/services/rnpmClient.ts) ruleaza 5 upstream calls in `Promise.all`; orice 500/502/503/ECONNRESET pe un part fail-eaza intreg aviz-ul. Istoric are deja 1-shot retry pe 400 (L246-250). Fix: extinde retry cu jitter (~500ms) pe 5xx/network in `fetchPart`; pastreaza 400/404/410 terminal. **Effort:** ~1h.
- [ ] **DR9 — `/rnpm/compact` blocheaza event loop fara fence** — VACUUM sincron tine event loop-ul blocat (secunde pe DB mare), orice caller poate sa-l declanseze, rate-limit e singurul gard. Fix: singleton-in-flight flag — al doilea apel returneaza 429 daca e deja in curs. Web-mode: require operator role. **Effort:** ~30 min.

### Prompt-injection + idempotency (AI surface)

- [x] **A1 — escape closing pseudo-tags in `buildPrompt`/`buildJudgePrompt`** (2026-04-25) — `escapeFenceTags(s)` (replace `</` → `<\\/`) aplicat prin `safeTruncate`/`safeField` pe toate splice-urile user-controlled (numar, institutie, parti, sedinte, obiect, model name, analyst output). Truncate caps: `TRUNCATE_OBIECT=500`, `TRUNCATE_PARTY_NAME=200`, `TRUNCATE_SOLUTIE=5000`, `TRUNCATE_ANALYSIS=50000` (judge), `TRUNCATE_FIELD=200`. 13 noi teste in [ai.test.ts](backend/src/services/ai.test.ts) (escapeFenceTags + buildPrompt + buildJudgePrompt). **Follow-up Faza 9:** extend `validateAiBody` la nested parti/sedinte (azi non-string silent → `""`); strict regex pe `modelA`/`modelB` (`[a-zA-Z0-9._-]{1,64}`) ca defense-in-depth; teste suplimentare (mixed-case `</DOSAR_DATA>`, repeated injection, very-short truncation chopping `</`).
- [ ] **A2 — extinde `clientRequestId` dedup la mutatii destructive + AI** — azi exista doar pe `/rnpm/search` + `/rnpm/bulk` ([rnpm.ts:73, 127, 172](backend/src/routes/rnpm.ts)). Lipseste pe `DELETE /saved/all` (wipe + VACUUM), `/saved/delete-batch`, `/compact`, `DELETE /backups`, `/backups/restore`, `DELETE /saved/:id`, `/ai/analyze`, `/ai/analyze-multi`. CLAUDE.md: „All IPC mutations are idempotent and accept a `clientRequestId`". Consecinte concrete: double-click pe „Analiza multi" = triplu-tax la provider (Anthropic+OpenAI+Google). Fix: extract pattern in Hono middleware factory, aplica la toate mutatiile; pentru AI cost-sensitive, considera TTL cache scurt peste window-ul in-flight. **Effort:** ~3h.

### Multi-institutie + frontend

- [ ] **F1 — per-institutie status in GET `/dosare` + `/termene`** — [backend/src/routes/dosare.ts:55-62](backend/src/routes/dosare.ts) + [termene.ts](backend/src/routes/termene.ts) fail silent per-court (`.catch → []`). User crede „zero dosare la Curtea X" cand de fapt SOAP-ul a picat. SSE variantul carrera warnings doar in event-ul `done` — disconnect-ul rateaza. Fix optiunea A: return `{ data, total, perInstitutie: [{ name, status, count, error? }] }`. Optiunea B: documenteaza explicit in API contract ca sync GET e best-effort, UI renders banner „X dintre Y curti au raspuns partial". **Effort:** ~2h (A) / ~30 min (B).
- [ ] **F2 — `loadMoreSSE` nu mai string-compare eroare localizata** — [frontend/src/lib/api.ts:115-126](frontend/src/lib/api.ts) branch-uieste pe `e.message !== "Eroare la incarcarea extinsa."` ca sa decida re-throw. Orice TypeError real, 500 backend, abort user = toate devin `partial:true` — zero semnal pentru debug. Fix: distinge `AbortError` (re-throw), timeout explicit (flag), network error (re-throw), protocol-level partial (backend trimite `partial` ca event type SSE). **Effort:** ~1h.
- [ ] **F3 — DOMPurify config duplicated 8× in `dosare-ai-analysis-panel.tsx`** — `{ALLOWED_TAGS: ['strong','em','b','i'], ALLOWED_ATTR:[]}` inline la ~L158, 163, 166, 334, 339, 342, 366, 368. Security-critical config — tightening viitor (ex. scoate `<b>`) inseamna 8 locuri sau risk de drift. Fix: `const AI_SANITIZE_CONFIG = { ... } as const;` module-level + helper `sanitizeAi(html)`. **Effort:** ~15 min.
- [ ] **F4 — `executeBulkSearch` ignora `delayMs`** — [backend/src/services/rnpmSearchService.ts](backend/src/services/rnpmSearchService.ts) executeaza seriali items, dar nu apeleaza `client.sleep()` intre iteratii. RNPM loveste la full fetch rate = risc IP-ban pe portal guvernamental. Fix: `await client.sleep()` dupa fiecare iteratie succes (nu pe abort). **Effort:** ~10 min.

### Web-deploy extras (pe langa Faza 7)

- [ ] **W1 — Store interface pentru `rateLimitMap` + `inflightRequests`** — ambele Maps module-level ([rate-limit.ts:7](backend/src/middleware/rate-limit.ts), [rnpm.ts:73](backend/src/routes/rnpm.ts)) sunt process-local. Sub load balancer: dedup fails-open, rate-limit e `limit × N replicas`. Desktop ramane Map (single-instance lock). Web swap la Redis/Valkey sau tabel SQLite cu TTL 60s. Fix: injecteaza `LimiterStore` + `IdempotencyStore` in `index.ts`, middleware accepta interface. **Effort:** ~1 zi (design once, migrate o data).
- [ ] **W2 — rezolva hardcoded `"local"` ownerId in dedup key** — [rnpm.ts:107, 173](backend/src/routes/rnpm.ts) cheaie `inflightKey("local", clientRequestId)`. Cand multi-user se aprinde, user A si B partajeaza namespace-ul; UUID-uri egale se blocheaza reciproc. Fix: thread `ownerId` via `c.set("ownerId", ...)` din auth middleware; enforce la orice call repository. Aduce integration test care verifica ca doi useri cu acelasi clientRequestId nu coliziuneaza. **Effort:** ~3h (dupa ce auth layer aterizeaza).
- [ ] **W3 — split desktop-only routes de cele partajate** — [backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts) face `require("electron")` in handlere (~L310 export, ~L372 openPath). In `dist:server` bundle-ul, path-urile exista si fail-eaza la runtime. Fix: `rnpm.ts` (shared) + `rnpm-desktop.ts` (mount conditional pe `process.versions.electron` sau env flag). `build-server.js` exclude explicit `rnpm-desktop.ts`. **Effort:** ~2h.
- [x] **W4 — `.dockerignore` la repo root** (2026-04-25) — adaugat [.dockerignore](.dockerignore) cu `.env*`, `node_modules`, `release/`, `server-release/`, `.git`, `.claude`, `dist/`, `*.db`, `*.sqlite-journal`, `coverage/`, `*.dmg`, `*.exe`, `*.AppImage`. Build context redus + zero risc de leak `.env.local` sau installer artifacts in image.

### Opportunistic / small wins

- [ ] **O1 — `preload.js invokeWithTimeout` clearTimeout** — [electron/preload.js](electron/preload.js) seteaza timer 10s, nu-l sterge pe resolve. Timer-ul fire-uieste eventual (respinge promise deja settled). Fix: `try { return await race } finally { clearTimeout(h) }`. **Effort:** ~5 min.
- [ ] **O2 — `fetchPart` distinge 400 vs 404/410** — [backend/src/services/rnpmClient.ts:231](backend/src/services/rnpmClient.ts) trateaza identic → silent drop pe 400 transient. Fix: retry-once pe 400 cu 1.5s backoff (ca istoric endpoint), null-return doar daca persista. **Effort:** ~20 min.
- [ ] **O3 — uniformizeaza pagination shape** — `avizRepository` returneaza `{items,total,page,pageSize}`, `searchRepository` returneaza `{items,nextCursor}`. CLAUDE.md prescrie offset-based. Fix: fie port cursor → offset, fie documenteaza explicit motivul cursor (jump-to-page impossible). **Effort:** ~1h.
- [ ] **O4 — parse `termen.data` la Date la ingestie** — [backend/src/routes/termene.ts](backend/src/routes/termene.ts) sort callback `localeCompare(a.data)` presupune strict ISO; SOAP legacy poate intoarce `DD.MM.YYYY` care sorteaza silent gresit. Fix: parse in `Date` la SOAP parse-time, sort pe epoch ms, guard parse failures. **Effort:** ~30 min.
- [ ] **O5 — loopback set normalize IPv6-mapped IPv4** — [backend/src/index.ts:82-88](backend/src/index.ts) Set `["127.0.0.1","localhost","::1"]` nu acopera `::ffff:127.0.0.1`, `0:0:0:0:0:0:0:1`. Noise pe WARN log cand HOST setup corect. Fix: `net.isIP` + canonicalize, accepta `127.0.0.0/8` + `::1` + `::ffff:127.0.0.0/8`. **Effort:** ~15 min.
- [ ] **O6 — `stripDiacritics` → Unicode native** — [frontend/src/lib/export.ts](frontend/src/lib/export.ts) hand-rolled ASCII fold doar pentru romana; nume non-RO (maghiari, ucraineni) render ca `#` in jsPDF. Fix: `str.normalize("NFKD").replace(/\p{Diacritic}/gu, "")` — orice script, o linie. **Effort:** ~10 min.
- [ ] **O7 — drop `@2captcha/captcha-solver` SDK pentru abort** — SDK nu accepta AbortSignal; race-mode losers leak paid tokens. Fix optiunea A: call HTTP direct cu `fetch(url, {signal})` (pattern existent pentru CapSolver). Optiunea B: accepta leak documentat, log `[captcha] leaked token` counter, nota in SECURITY.md despre dubla-facturare (overlap cu suggestion-ul existing din Faza 7). **Effort:** ~2h (A) / ~15 min (B).

### CI / release process

- [ ] **CI1 — Windows CI workflow** — `.github/workflows/build-windows.yml` mirror `build-mac.yml`, runs-on `windows-latest`, `--publish never`, artifact upload cu retention. NSIS-ul pleaca azi de pe laptop-ul maintainerului = zero audit trail + zero reproducibility. **Effort:** ~2h.
- [ ] **CI2 — smoke-test gate in `build-mac.yml`** — inainte de `action-gh-release`: `npx tsc --noEmit` ambele workspace-uri + `npm test --workspace=backend` + unpack DMG + verify `Info.plist` version match tag. Drop `continue-on-error: true` de pe step-ul de publish critic. Auto-publish ramane doar pe explicit `workflow_dispatch confirm=yes`. **Effort:** ~2h.
- [ ] **CI3 — `--publish never` hard in dist scripts** — [package.json:16-18](package.json) `dist`, `dist:mac`, `dist:all` se bazeaza doar pe env-scoping. Fix: adauga `--publish never` explicit in script; CI-ul deja-l pasa (L36). Belt + suspenders vs `GH_TOKEN` strays. **Effort:** ~5 min.
- [ ] **CI4 — `postinstall` cu `electron-builder install-app-deps`** — pe top-level `node_modules`, `better_sqlite3.node` e built pentru Node ABI, nu Electron 41. Dev rulant `electron:dev` direct poate hit clasicul „compiled against different Node.js version". **Effort:** ~10 min.
- [ ] **CI5 — README macOS Gatekeeper section** — DMG unsigned + neotarized afiseaza `"Legal Dashboard" is damaged`. Adauga in README sectiune „Prima lansare pe macOS" cu `xattr -cr /Applications/Legal\ Dashboard.app` sau right-click → Open. Mirror in Release body template. **Effort:** ~15 min.
- [ ] **CI6 — `dist-frontend/**` out of `asarUnpack`** — [package.json:38-41](package.json) dubleaza bundle-ul frontend (~2.6MB ×2). Hono serveste transparent din ASAR (Node `fs` pe path rezolvat). Fix: scoate `dist-frontend/**/*` din `asarUnpack`, verifica `mountStaticFrontend` inca serveste (ar trebui). **Effort:** ~30 min (include verify).

### Tests (wire fixture existent + critical gaps)

**CLAUDE.md zice „24 tests"; real e 2 fisiere / 29 tests** — documentatie stale de un ordin de marime. Drift-ul se repara in sectiunea CLAUDE.md de mai jos.

- [ ] **T1 — wire `backend/rnpm-dumps/*.json` ca fixture** — dump-ul exista (`2026-04-15T23-22-33-902Z_*.json`), NICI UN test nu-l foloseste. Adauga cate un dump per searchType (`specifice`, `ipoteci`, eventual `fiducii`/`creante`/`obligatiuni` cand sampled) + test `persistAvizWithDetail` care parseaza prin serviciu. Catches 1-based `constituitoriF[idx-1]` regression (commit `0c0c605`) + per-type shape drift. **Effort:** ~2h.
- [ ] **T2 — `saveAvizFull` rollback + owner_id scoping** — in-memory SQLite cu migratii reale: inject failure in part3, assert part1/part2 lipsesc; owner `"alice"` save, apoi owner `"bob"` cu acelasi avizId, assert bob nu poate update la alice; re-save idempotent (fara duplicate part2/part3). **Effort:** ~3h.
- [ ] **T3 — `clientRequestId` concurrent dedup** — doua `POST /api/rnpm/search` simultan cu acelasi `clientRequestId`: primul 200, al doilea 409. Dupa finalizare, al treilea cu acelasi id returneaza rezultat fresh (cleanup verificat). Throw in handler inca sterge map entry. **Effort:** ~1h.
- [ ] **T4 — `solveRace` winner-aborts-loser + both-failed typed error** — stub `solve` cu timer, assert loser's AbortSignal fired; ambele respinse → `CaptchaError` wrapping both causes; sequential fallback path; CapSolver mid-poll abort. **Effort:** ~2h.
- [ ] **T5 — `RESTORE_NAME_RE` + restore flow** — table-driven rejects: `../etc/passwd`, `legal-dashboard.\x00.db`, absolute, `legal-dashboard..db`, `/`/`\`, empty. Acceptable: `legal-dashboard.2026-04-15T12-00-00.db`. Pre-restore snapshot present; DB closed before copy. **Effort:** ~1h.
- [ ] **T6 — `static-frontend.ts` path-traversal integration** — `/..%2F..%2Fetc%2Fpasswd`, `/..\..\windows\system32\...`, `/%2e%2e/%2e%2e/config.json`, `/\\..\\..\\secret` → 403/400. Valid `/index.html`, `/assets/main.abc123.js` → 200. `decodeURIComponent` throw → 400 nu 500. **Effort:** ~1h.
- [ ] **T7 — Vitest `--coverage` + CI `test` job** — prerequisite pentru Faza 1. `backend/package.json` `"test:coverage": "vitest run --coverage"` + c8 thresholds soft initial (50%) + CI block. Unblock-eaza orice hardening ulterior cu gate real. **Effort:** ~2h.
- [ ] **T8 — frontend test runner setup** — zero teste frontend azi. Vitest + jsdom + `@testing-library/react` match-uiesc stack-ul. Prerequisite pentru test-urile XLSX injection + print-page smoke. **Effort:** ~2h setup, teste separate ulterior.

### CLAUDE.md drift (doc fix, nu hardening — dar `claude-guard` l-a scos)

- [ ] **CM1 — linia 59 contradictorie** — zice „React 19" + „custom CSS (fara Tailwind)". Reality: `frontend/package.json` pinneaza React 18.3.1; Tailwind 3.4 e activ (`tailwind.config.js`, `@tailwind base/components/utilities` in `index.css`, clase in uz). Fix: `**Frontend**: React 18, Vite 5, Tailwind CSS 3.4 + primitive shadcn-style, Recharts, DOMPurify`.
- [ ] **CM2 — test count stale** — linia 53 zice „(24 teste)"; real 29 in 2 fisiere. Fix: `vitest (~29 teste / 2 fisiere)`.
- [ ] **CM3 — `npx biome check` nu e instalabil** — `biome.json` exista, dar `@biomejs/biome` lipseste din toate `package.json`. Comanda pulls un pachet `biome@0.3.3` nerelevant si fail-eaza. Fix optiunea A: adauga `"@biomejs/biome": "^1.9.4"` la root devDeps + script `lint`. Optiunea B: scoate linia 56.
- [ ] **CM4 — „fara diacritice" ingust la backend** — linia 107 e absoluta; frontend-ul are diacritice in user-facing strings (13 fisiere: `Analiză AI`, `Judecător`, `Exportă PDF`, `Curți de Apel`). Backend/SOAP ramane strict (textNormalize folder). Fix: „Constrangerea `fara diacritice` se aplica backend-SOAP (soap.ts, textNormalize, schema) pentru PortalJust; frontend accepta diacritice in stringuri user-facing."
- [ ] **CM5 — `rnpm_bunuri_descrieri` exempt de `owner_id` rule** — tabela shared lookup pentru dedupe descrieri (~99% storage reduction). CLAUDE.md zice „toate tabelele" (line 91). Fix: adauga nota in Web-readiness bridge: „Exceptie: `rnpm_bunuri_descrieri` e tabela content-addressable shared (text UNIQUE); CASCADE delete via FK pastreaza integritatea multi-tenant."

**Total Faza 8: ~3 zile dev efectiv** (blockers + DR + prompt-injection ~6h; restul distribuite in sprint-uri incrementale).

## Faza 9 — Review follow-ups 2026-04-25 (post security-first sprint)

**De ce aici:** trei review agents (data-validation-reviewer + backend-reliability-reviewer + release-readiness-reviewer) au validat sprint-ul A1/DR1/DR3/C1-C4/I2 si au scos urmatoarele follow-ups. Items care intaresc fix-urile deja landed; nu blocheaza release-ul, dar trebuie inainte de extinderea web mode + multi-tenant.

### AI prompt-injection — defense-in-depth (extends A1)

- [ ] **A1.1 — `validateAiBody` nested validation** — azi top-level dosar fields sunt type-checked, dar `parti[].calitateParte`/`nume` si `sedinte[].data`/`solutie`/`solutieSumar` sunt acceptate ca `unknown`. `truncate(value, n)` coerceaza non-string silent la `""` → user vede analiza fara parti, fara semnal. Fix: extinde `validateAiBody` la iteratie nested + reject explicit non-string. **Fisier:** [backend/src/services/ai.ts](backend/src/services/ai.ts) L213-222. **Effort:** ~30 min.
- [ ] **A1.2 — strict regex pe model name** — `<analiza_1 model="${escapeFenceTags(modelA)}">` neutralizeaza `</` dar NU `"` sau `<`. Azi e gated de whitelist in routes/ai.ts, dar defense-in-depth: `String(modelA).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64)`. **Fisier:** [backend/src/services/ai.ts](backend/src/services/ai.ts) L117, L121. **Effort:** ~10 min.
- [ ] **A1.3 — teste suplimentare prompt-injection** — pin contracts pentru: mixed-case `</DOSAR_DATA>` (escape e tag-name-agnostic — mentine garanta), repeated injection (`a</d>b</d>c`), very-short truncation care taie mid-`</`, structural assertion ca `model="..."` nu poate fi rupt. **Fisier:** [backend/src/services/ai.test.ts](backend/src/services/ai.test.ts). **Effort:** ~30 min.

### Backup + restore — durability (extends DR1)

- [ ] **R1 — fsync tmp + parent dir post-rename** — `copyFile` + `rename` fara `fh.sync()`/`open(dir).sync()` nu sunt crash-safe pe ext4/APFS/NTFS. Power-loss intre copy si rename → fisier zero-length la `dbPath` desi rename a „reusit" syscall-wise. Fix: `fs.open` → `copyFile` → `fsync` → `rename` → `fsync(dirname)`. **Fisier:** [backend/src/db/backup.ts](backend/src/db/backup.ts) L118-121. **Effort:** ~30 min.
- [ ] **R2 — pre-restore snapshot via `db.backup()`** — azi `closeDb()` + `copyFile(dbPath, preRestorePath)`. Daca close-ul nu reuseste sa checkpoint-eze (sau alt proces tine WAL deschis), snapshot-ul rateaza commit-uri WAL recente. Fix: `db.backup(preRestorePath)` (online backup API → coherent snapshot indiferent de state-ul WAL) inainte de `closeDb()`. **Fisier:** [backend/src/db/backup.ts](backend/src/db/backup.ts) L97-106. **Effort:** ~30 min.
- [ ] **R3 — surface unlink failures pe WAL/SHM** — azi `try { unlink } catch {}` pentru `-wal`/`-shm` swallow-uieste. Daca unlink esueaza (locked by AV), urmatorul `getDb()` deschide cu WAL stale → corruption silent. Fix: log warning + return success doar daca ambele unlink reusesc (sau ambele lipsesc). **Fisier:** [backend/src/db/backup.ts](backend/src/db/backup.ts) L132-134. **Effort:** ~15 min.
- [ ] **R4 — guard concurrent restore + readers pe Windows** — `closeDb()` inchide doar handle-ul in-process. Antivirus/DB Browser/alt process care tine fisierul → `rename` esueaza cu EBUSY si lasa orphan pre-restore snapshot. Fix: probe `fs.open(dbPath, "r+")` inainte de snapshot, abort early daca lock detected. **Fisier:** [backend/src/db/backup.ts](backend/src/db/backup.ts) L97. **Effort:** ~30 min.

### Boot + observability (extends DR3)

- [ ] **B1 — broaden prewarm sau `PRAGMA integrity_check`** — `getAvize`/`getAvizStats` exerciteaza doar `rnpm_avize`. Migrari pe `rnpm_bunuri`/`creditori`/`debitori`/`istoric`/`bunuri_descrieri` pot ramane partial-applied → prewarm pass, primul request fail. Fix: `SELECT count(*)` pe fiecare tabela migrata, sau o data per boot `PRAGMA integrity_check`. **Fisier:** [backend/src/index.ts](backend/src/index.ts) L109-118. **Effort:** ~30 min.
- [ ] **B2 — defer `runDailyBackup` 30-60s post-ready** — backup ruleaza imediat dupa `ready=true`. Pe DB ~100MB, backup IO concura cu primele cereri → p95 spike de cateva secunde. Fix: `setTimeout(runDailyBackup, 60_000)`. **Fisier:** [backend/src/index.ts](backend/src/index.ts) L122-126. **Effort:** ~5 min.
- [ ] **B3 — `/health` returneaza version + last-backup mtime + schema version** — azi e doar `{status, service}`. Pentru ops: `{status, version, dbPath?, lastBackupMtime?, schemaVersion?}`. Complementeaza `/health/detailed` din Faza 3. **Fisier:** [backend/src/index.ts](backend/src/index.ts) L75-80. **Effort:** ~30 min.

### SOAP fanout — capacity control (extends C1)

- [ ] **S1 — coboara `MAX_SOAP_FANOUT` 500 → 200** — 500 e teoretic, real-world dosare/judet rar trec de 200. Reduce blast radius pentru abuse. **Fisier:** [backend/src/util/validation.ts](backend/src/util/validation.ts). **Effort:** ~5 min.
- [ ] **S2 — concurrency limit pe GET path** — azi `Promise.all` peste 50 institutii hammer portal.just.ro fara cap. Fix: re-foloseste `PARALLEL_BATCH_SIZE=3` din [batch-dosare.ts](backend/src/services/batch-dosare.ts), p-limit sau chunk + serial. **Fisier:** [backend/src/routes/dosare.ts](backend/src/routes/dosare.ts) L64-69 + [termene.ts](backend/src/routes/termene.ts) L60-65. **Effort:** ~1h.
- [ ] **S3 — per-institutie row cap** — `MAX_DOSARE_RESPONSE=5000` fires DUPA `Promise.all` materializeaza tot in memorie. Fix: per-institutie 1000 cap inside `cautareDosare` cu warning, asa ca aggregate stays sub limit fara alocare totala. **Effort:** ~30 min.

### Config flexibility (extends C4 + I2)

- [ ] **D1 — `LEGAL_DASHBOARD_BIND_HOST` in docker-compose** — `127.0.0.1:3002:3002` hardcoded forteaza ops sa edit-eze compose pentru deploy LAN. Fix: `${LEGAL_DASHBOARD_BIND_HOST:-127.0.0.1}:3002:3002` + documentat in SECURITY.md. **Fisier:** [docker-compose.yml](docker-compose.yml). **Effort:** ~10 min.
- [ ] **D2 — `LEGAL_DASHBOARD_CORS_ORIGINS` env** — `NODE_ENV !== "production"` hardcoded toggle e prea ingust pentru deploy cross-origin. Fix: env var comma-separated; daca setat → mount CORS cu acel allowlist indiferent de NODE_ENV; daca unset si prod → no CORS. **Fisier:** [backend/src/index.ts](backend/src/index.ts) L58-67. **Effort:** ~30 min.
- [ ] **D3 — `dotenv` `override: false` in productie** — azi `override: true`; un `.env` accidental mountat ar peste-write env vars din docker-compose `env_file`. Fix: `override: process.env.NODE_ENV !== "production"`. **Fisier:** [backend/src/index.ts](backend/src/index.ts) L29. **Effort:** ~5 min.

### Docs (operational drift)

- [ ] **DOC1 — SECURITY.md ops requirements** — adauga sectiune „Operare server" cu: env_file mount obligatoriu (zero `.env` in image), loopback bind default + reverse-proxy pentru public, healthcheck SCC. **Fisier:** [SECURITY.md](SECURITY.md). **Effort:** ~30 min.
- [x] **DOC2 — README troubleshooting `dist:server`** (2026-04-26) — ZIP-ul server livreaza acum `package.json`, `package-lock.json`, `backend/package.json`, `frontend/package.json`; `start.sh`/`start.bat` ruleaza `npm ci --omit=dev --workspace=backend --include-workspace-root=false` la prima pornire daca lipseste `node_modules/better-sqlite3`. README-ul generat in ZIP explica explicit ca `better-sqlite3` e modul nativ si trebuie instalat pe platforma tinta. **Fisier:** [scripts/build-server.js](scripts/build-server.js).

**Total Faza 9: ~6h** (defense-in-depth peste sprint-ul deja landed; non-blocking pentru release v2.0.7 dar required inainte de Faza 7 web deploy).

## Faza 10 — Multi-agent `/full-review` findings 2026-04-25 (pre-tag v2.0.7)

**De ce aici:** rulare `/full-review` cu 8 agenti specializati (deep-code-reviewer + backend-reliability-reviewer + debug-investigator + test-architect + audit-trail-reviewer + release-readiness-reviewer + repo-security-auditor + claude-guard) peste cele 3 commits-uri locale (`668aedd` + `f24d7c0` + `2b2b869`). Items care se suprapun cu Faza 8/9 sunt cross-referite, nu duplicate; aici doar **findings noi**.

**Verdict global:** 🟡 CONDITIONAL — calitatea sprint-ului e mare, dar 3 blockers fac container-ul Docker sa nu booteze, exit-ul Electron sa fie distructiv silentios, si concurency-ul restore-ului inca neaplicat (DR2 din Faza 8 e same risc, ramane open).

**Status v2.0.10 (2026-04-26):** toate cele 3 blockers (C1+C2+C3), toate 4 high-priority (H1+H2+H3+H4) si **toate** medium-urile (M1+M2+M3+M4+M5+M6+M7+M8) sunt **landed**. `v2.0.8` a fost release-ul de hardening initial; `v2.0.9` a inchis ultimele patru medium din Faza 10. `v2.0.10` adauga peste asta: `withMaintenanceLock` pentru serializarea restore + daily backup, `PRAGMA wal_checkpoint(TRUNCATE)` pre-restore snapshot, `isTimeoutOrAbort` care detecteaza subclase SDK pentru log corect, `httpStatus` + token usage in `ai_call`, `useApiKey.setKeys` defensive trim. Doar L1-L10 raman in Faza 10 (low priority, deferable la Faza 9 cleanup sau dupa primul deploy real).

### Release blockers (fix INAINTE de tag `v2.0.7`)

- [x] **F10-C1 — Dockerfile chown gap pe `WORKDIR /app`** (2026-04-25) — reordonat in [Dockerfile](Dockerfile): `addgroup/adduser app` → `WORKDIR /app` → `RUN chown app:app /app` → `USER app`. Directorul are user-ul aplicatiei ca proprietar inainte de drop-privileges; runtime fs.write sub `/app` (tmp restore staging, db sidecars, log files) functioneaza fara EACCES. Detectat de debug-investigator (Hypothesis 1) + repo-security-auditor.
- [x] **F10-C2 — `process.exit(1)` in [backend/src/index.ts](backend/src/index.ts) ucide Electron renderer** (2026-04-25) — adaugat helper `fatalBoot(reason, err)`: detect `process.versions.electron` → throw (propaga prin `require()` la main.js → dialog + `app.exit(1)`); altfel pastreaza `process.exit(1)` pentru ca process manager (PM2/systemd/Docker) sa restart-eze. Aplicat la prewarm failure + `httpServer.on("error")`. 53/53 teste pass + tsc clean.
- [x] **F10-C3 — `legal-dashboard.pre-{label}-{stamp}.db` bypass pentru retention** (2026-04-25) — adaugat al treilea pool `PRE_MIGRATION_RE = /^legal-dashboard\.pre-(?!restore-)[^.]+\.db$/` cu `PRE_MIGRATION_RETAIN=5` in [backup.ts](backend/src/db/backup.ts). Negative lookahead pastreaza disjuncta vs `PRE_RESTORE_RE`. Pre-migration backups (`schema.ts:11`) acum se prune-uiesc separat de daily + pre-restore. Detectat de deep-code-reviewer + backend-reliability-reviewer.

### High priority (fix inainte de push public, post-tag)

- [x] **F10-H1 — `NODE_ENV=development` in `backend/.env.example`** (2026-04-26) — linia stearsa din [backend/.env.example](backend/.env.example), inlocuita cu nota explicita: Electron seteaza `production` automatic, Docker hard-code-eaza `ENV NODE_ENV=production` in image, dev-mode se activeaza prin export shell, nu prin `.env` copiat in deploy ZIP. Eliminat riscul ca un operator sa porneasca server-ul in dev mode neintentionat (CORS dev origins, alte branch-uri dev-only).
- [x] **F10-H2 — AbortSignal propagat prin SOAP layer** (2026-04-26) — `cautareDosare(params, options?: { signal? })` in [backend/src/soap.ts](backend/src/soap.ts) cu helper `combineSignals` care face `AbortSignal.any([external, AbortSignal.timeout(45000)])`. `batchFetchDosare` + `subdivideInterval` paseaza `signal` la fiecare apel SOAP. Routes [dosare.ts](backend/src/routes/dosare.ts) + [termene.ts](backend/src/routes/termene.ts) GET handlers paseaza `c.req.raw.signal` — disconnect-ul clientului anuleaza fetch-ul SOAP imediat in loc sa astepte 45s timeout intern. SSE handler-urile beneficiaza implicit prin `batchFetchDosare`. Build + 53/53 teste verde. **Follow-up Faza 9+:** unit test cu fetch mock care asserteaza ca abortul extern fire-uieste signal-ul fetch-ului SOAP (nu doar `combineSignals` returneaza AbortSignal valid).
- [x] **F10-H3 — daily backup atomic (`.tmp` + rename)** (2026-04-26) — `runDailyBackup` in [backend/src/db/backup.ts](backend/src/db/backup.ts) staga la `${dest}.tmp` apoi `fs.rename` atomic. SIGTERM / power loss / crash mid-`db.backup()` lasa doar `.tmp` (cleanup `cleanupOrphanTmp` la urmatorul boot, skip-uit de freshness check pentru ca sufix-ul difera de `.db`). Inainte: fisier zero-or-partial la `today.db` parea „backup valid" si `restoreFromBackup` corupea silent DB-ul live. Cross-ref cu R1 din Faza 9 (fsync) — ramane separat. **Follow-up:** unit test pentru orphan cleanup la boot + simulare SIGTERM mid-backup (cross-ref F10-M8).
- [x] **F10-H4 — restore audit log structurat** (2026-04-26) — adaugat `console.log(JSON.stringify({ action, source, preRestore, ts }))` la sfarsitul `restoreFromBackup` ([backend/src/db/backup.ts](backend/src/db/backup.ts)). Single-line JSON, log scrapers pot grep `"action":"restore"` after-the-fact in stdout pipe Electron sau in fisier persistent (cand DR6 aterizeaza). Tabela `audit_log` ramane scope Faza 5 compliance.

### Medium priority (Faza 9 cleanup sau pre-feedback de la prima firma externa)

- [x] **F10-M1 — Dockerfile fara lockfile** (2026-04-26) — deps stage copiaza acum root [package.json](package.json) + [package-lock.json](package-lock.json) + workspace manifests si ruleaza `npm ci --omit=dev --workspace=backend --include-workspace-root=false --build-from-source`. Build-ul Docker foloseste lockfile-ul testat, iar `better-sqlite3` ramane compilat din sursa pentru Alpine/musl. Ajustat [.dockerignore](.dockerignore) ca `frontend/package.json` sa ramana disponibil in context. **Fisier:** [Dockerfile](Dockerfile).
- [x] **F10-M2 — `HEALTHCHECK` fara `--start-period`** (2026-04-26) — adaugat `--start-period=120s` in [Dockerfile](Dockerfile) si `start_period: 120s` in [docker-compose.yml](docker-compose.yml), ca prewarm/migrari DB mai lente sa nu marcheze container-ul unhealthy inainte ca `/health` sa devina ready.
- [x] **F10-M3 — Version bump v2.0.6 → v2.0.7 + CHANGELOG entry** (2026-04-26) — bump aplicat sincron in [package.json](package.json), [package-lock.json](package-lock.json), [backend/package.json](backend/package.json), [frontend/package.json](frontend/package.json). [CHANGELOG.md](CHANGELOG.md) si [frontend/src/data/changelog-entries.tsx](frontend/src/data/changelog-entries.tsx) au entry pentru `v2.0.7` (RNPM tab-state UX fix + F10-C1/C2/C3). Tag `v2.0.7` push-uit la `origin`.
- [x] **F10-M4 — `fs.existsSync` regression in `restoreFromBackup`** (2026-04-26) — inlocuit cu `await fsPromises.access(dbPath)` + flag `dbExists` in [backup.ts](backend/src/db/backup.ts). Path-ul async-only acum, niciun blocking sync I/O ramas in `restoreFromBackup`. Detectat de deep-code-reviewer.
- [x] **F10-M5 — WAL/SHM unlink ordering pre-rename** (2026-04-26) — reordonat in [backup.ts](backend/src/db/backup.ts): unlink `-wal`/`-shm` rulat INAINTE de `rename(tmpPath, dbPath)`. Eliminat fereastra in care noua DB co-exista cu WAL/SHM stale → previne corruption silent la lazy open prin better-sqlite3. Detectat de backend-reliability-reviewer.
- [x] **F10-M6 — AI request logging structurat** (2026-04-26) — adaugat helper `withAiLogging(provider, model, fn)` in [backend/src/services/ai.ts](backend/src/services/ai.ts) care wraps `callAnthropic` / `callOpenAI` / `callGoogle`. Emite single-line `console.log(JSON.stringify({ action: "ai_call", provider, model, latencyMs, status, errorType?, ts }))` pe both success si failure. `TimeoutError` / `AbortError` normalizate la `errorType: "timeout"` ca dashboard-urile sa nu trebuie sa special-case-uieze. Cost-tracking via tokens raman scope viitor (SDK-urile expun `usage` separat). Tests 55/55 verde.
- [x] **F10-M7 — Docker CI workflow** (2026-04-26) — adaugat [.github/workflows/docker-build.yml](.github/workflows/docker-build.yml) care ruleaza pe push la `main` + PR cand Dockerfile / `.dockerignore` / `docker-compose.yml` / lockfile / `backend/**` / `frontend/**` / `scripts/build.js` se schimba. Steps: `npm ci` + `npm run build` (genereaza `dist-backend/` + `dist-frontend/` cerute de Dockerfile) → `docker build -t legal-dashboard:ci .` → smoke test `node -e "console.log(process.version)"` in image → smoke test HTTP `/health` (poll 60s, valideaza ca prewarm + listen flip la 200 OK functioneaza in container). Fail-out cu `docker logs` pentru triage. Cross-ref CI1 din Faza 8.
- [x] **F10-M8 — Test coverage pe backup atomicity edge cases** (2026-04-26) — extins [backend/src/db/backup.test.ts](backend/src/db/backup.test.ts) cu coverage pentru H3/F10-C3: orphan `legal-dashboard.*.db.tmp` cleanup in `runDailyBackup`, non-owned `.tmp` left untouched, daily backup final only `.db` (no `.db.tmp` in list), plus retention pools separate pentru dated / pre-restore / pre-migration (`7/5/5`) ca sa previna starvation reciproca si bypass-ul pre-migration. Targeted test verde: `npm test --workspace=backend -- backup.test.ts` (9/9). **Follow-up optional:** test hard cu proces copil / kill mid-`db.backup()` daca apare harness de crash-testing in Faza 9.

### Low priority (deferrable la Faza 9 cleanup sau dupa primul deploy real)

- [ ] **F10-L1 — `gracefulShutdown` deja sets `shuttingDown=true` dar nu interzice noi requesturi** — request-uri in-flight raman, dar noi GET-uri intra. Fix: middleware first-line care 503 daca `shuttingDown=true`. Cross-ref DR5 (Faza 8). **Effort:** ~30 min.
- [ ] **F10-L2 — `secureHeaders` CSP `frame-ancestors: 'none'` blocheaza embedding** — corect azi (Electron-only), dar cand web mode aterizeaza si user vrea iframe pe alta pagina, devine bug. Documenteaza in SECURITY.md. **Effort:** ~10 min.
- [ ] **F10-L3 — `runDailyBackup()` nu retry-eaza pe failure** — un IO error transient (AV scan, lock) lasa backup-ul lipsa toata ziua. Cross-ref DR4 (Faza 8) + B2 (Faza 9). **Effort:** ~15 min.
- [ ] **F10-L4 — Banner-ul `console.log` la boot loga `localhost` chiar si in LAN-bind** — [index.ts:165-167](backend/src/index.ts) afiseaza „Deschide in browser: http://localhost:${port}" fara sa tina cont de `hostname` real. Detectat de deep-code-reviewer. **Effort:** ~10 min.
- [ ] **F10-L5 — `MAX_DOSARE_RESPONSE=5000` fara documentatie user-facing** — eroarea 413 e in romana („Rezultat prea mare ($N dosare). Restrange filtrele sau intervalul (max $MAX)") dar nu exista doc in Manual ce inseamna „restrange filtrele". Cross-ref S1+S3 (Faza 9). **Effort:** ~15 min.
- [ ] **F10-L6 — `dist-backend/index.cjs` nu are sourcemaps** — debugging stack traces din productie pe Sentry future = obfuscated. Fix: `esbuild --sourcemap=external` + upload separat (nu in image). **Effort:** ~30 min.
- [ ] **F10-L7 — `package.json` `engines` field lipseste** — npm/Docker nu refuza Node v18 sau v20 desi codul foloseste features Node 22+ (ex `AbortSignal.any`). Fix: `"engines": { "node": ">=22.0.0" }`. **Effort:** ~5 min.
- [ ] **F10-L8 — `start.sh`/`start.bat` nu seteaza `NODE_ENV=production` consistent cross-platform** — [scripts/build-server.js](scripts/build-server.js) L33-39 seteaza in linii separate; bun pe sh, dar `set NODE_ENV=production` in `.bat` nu persista intre apeluri daca scriptul e source-uit. Edge case, dar simplu fix. **Effort:** ~5 min.
- [ ] **F10-L9 — `ai.ts escapeFenceTags` test pentru tag-name-agnostic invariant** — A1.3 din Faza 9 cere mixed-case + repeated; aici cere stricter ca testul pin-uieste invariantul „escape-ul nu depinde de tag-ul-numit". **Effort:** ~15 min.
- [ ] **F10-L10 — `package.json` scripts nu valideaza `dist-frontend` exista pre-`build:server`** — `build-server.js` se bazeaza pe `dist-backend` + `dist-frontend` dupa `build.js`; daca `build.js` esueaza partial (ex frontend OK, backend fail), `build-server.js` ridica un ZIP fara backend. Fix: assert ambele directoare exista pre-cpSync. **Effort:** ~10 min.

**Total Faza 10: ~6h blockers + ~6h high + ~7h medium + ~3h low = ~22h** (3 zile dev efectiv distribuite). Blockers F10-C1/C2/C3 sunt obligatorii pre-tag v2.0.7.

## Planned feature — Dashboard rework + Watched Dosare (viitor)

> ## ❌ OBSOLETE — 2026-04-27
>
> **Acest spec este absorbit in [PLAN-monitoring-webmode.md](PLAN-monitoring-webmode.md) §5.1 + §11.2bis si NU se mai implementeaza ca atare.**
>
> **Motivul absorbtiei**: schema `tracked_dosare` + `termene_cache` documentata aici e single-purpose (doar dosare urmarite explicit). Plan-ul nou foloseste schema generica `monitoring_jobs(kind='dosar_soap'|'name_soap'|'aviz_rnpm')` + `monitoring_runs` + `monitoring_alerts` care:
> - acopera Watched Dosare ca un caz particular (kind='dosar_soap')
> - extinde nativ la name_soap (bulk name lists, PR-5) si aviz_rnpm (PR-7)
> - e web-ready din ziua 1 (`owner_id` + `getOwnerId()` din PR-1, vs adaugat retroactiv aici)
> - are audit trail separat (`monitoring_runs`) pentru observability + compliance
>
> **Features pastrate (absorbite in plan)**:
> - `notify_days_before_json: [14,7,3,1]` → `monitoring_jobs.alert_config_json.notify_days_before` (multi-threshold proximity alerts)
> - `is_new` flag → `monitoring_alerts.is_new` (badge "NOU" pana user-ul vede)
> - `solution_changed_at` trigger → `monitoring_alerts.kind='solutie_aparuta'` (alert separat de `termen_changed`)
> - `stadiu_procesual` in UNIQUE key → prim segment in `buildSedintaKey()` (un dosar poate avea termene simultan in fond + apel)
> - Concurrency guard `last_sync_status='in_progress'` → `monitoring_jobs.last_status='running'` + crash recovery la boot (B.18)
> - Normalizare data/ora (slice 0,10 + padStart 2) → `normalizeData()` / `normalizeOra()` in diff service
> - Multi-record per dosar (fond + apel coexistente) → `stadiu` in cheia diff
>
> **Features deprecated (NU se mai face)**:
> - Tabel `tracked_dosare` separat — inlocuit cu `monitoring_jobs(kind='dosar_soap')`
> - Tabel `termene_cache` separat — inlocuit cu `monitoring_snapshots` (1 row per run, payload ca JSON in `snapshot_json`)
> - Routes `/api/watched/*` → inlocuite cu `/api/v1/monitoring/jobs` (RESTful, web-ready)
> - Component `WatchStarButton` integrat in 3 locuri (Termene tabel, RnpmDetailModal, cautare) — UX-ul ramane, dar legaturile API se schimba la `POST /api/v1/monitoring/jobs`
>
> **Sectiunea de mai jos e pastrata read-only ca referinta istorica + audit trail al deciziei. NU implementati pe baza acestui spec.**

> **Status:** planificat, **nu inceput**. Documentat aici integral ca sa nu se piarda contextul. Se porneste cand avem bandwidth pe feature-uri non-hardening (probabil dupa Faza 3 — fara error boundaries + request IDs, debug-ul sync-urilor esuate e orb).
>
> **Scop:** combina 2 directii discutate in debate-ul dashboard:
> 1. **Rework dashboard** cu metodele **v1 (sparklines)** + **v3 (Termene Imediate)**.
> 2. **Watched Dosare** ca feature nou — user marcheaza explicit dosare de urmarit, app-ul face sync periodic SOAP, termenele raportate in dashboard + calendar + alerte.
>
> Cele doua sunt cuplate: „Termene Imediate" din dashboard se alimenteaza exclusiv din dosarele urmarite.

### Pilon A — Dashboard rework (v1 + v3)

- **v1 (sparklines):** cardurile existente „Dosare Gasite" / „Avize Gasite" capata un sparkline SVG inline (30 de zile) + delta % WoW. Zero dependente noi (SVG native, 50 linii). Data source: agregare pe `rnpm_searches.created_at` grupata pe zi.
- **v3 (Termene Imediate):** sectiune noua sub carduri — lista top 5 termene din urmatoarele 7 zile (numai din dosare urmarite), sortate dupa `data ASC`, badge urgent daca `≤ notify_days_before`. Date-box stanga (zi + luna), numar dosar + instanta + ora + complet, buton „Deschide in Termene" care deep-link-uieste la tab-ul Termene cu filtru pre-populat.

### Pilon B — Watched Dosare (feature nou)

User marcheaza un dosar cu o stea (din tab-ul Termene sau rezultatele cautarii). App-ul stocheaza watchlist-ul si face sync periodic SOAP pentru a detecta:
- termene noi (nu existau la ultimul sync)
- solutii nou-aparute (termen care avea `solutie=null` si acum are valoare)
- termene care se apropie de pragul `notify_days_before`

#### Schema noua (ambele tabele prefixate cu `owner_id` pentru CP-B7 multi-tenant ready)

```sql
CREATE TABLE tracked_dosare (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id                TEXT NOT NULL DEFAULT 'local',
  dosar_numar             TEXT NOT NULL,
  instanta                TEXT NOT NULL,
  parti_summary           TEXT,                           -- denormalized pentru display rapid
  note                    TEXT,                           -- free-form user note
  notify_days_before_json TEXT NOT NULL DEFAULT '[7]',    -- JSON array: [14,7,3,1] pentru multi-threshold viitor
  notify_on_new_termen    INTEGER NOT NULL DEFAULT 1,
  notify_on_solution      INTEGER NOT NULL DEFAULT 1,
  last_synced_at          TEXT,
  last_sync_status        TEXT,                           -- 'ok' | 'error' | 'in_progress' (concurrency guard)
  last_sync_error         TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(owner_id, dosar_numar, instanta)
);

CREATE TABLE termene_cache (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id             TEXT NOT NULL DEFAULT 'local',
  tracked_dosar_id     INTEGER NOT NULL REFERENCES tracked_dosare(id) ON DELETE CASCADE,
  stadiu_procesual     TEXT NOT NULL DEFAULT '',         -- inclus in UNIQUE key: un dosar poate avea >1 stadii
  data                 TEXT NOT NULL,                    -- normalizat YYYY-MM-DD (slice 0,10)
  ora                  TEXT NOT NULL DEFAULT '',         -- normalizat HH:MM (padded)
  complet              TEXT NOT NULL DEFAULT '',
  solutie              TEXT,
  solutie_sumar        TEXT,
  document_sedinta     TEXT,
  numar_document       TEXT,
  data_pronuntare      TEXT,
  is_new               INTEGER NOT NULL DEFAULT 0,       -- flag afisat cu badge „NOU" pana user-ul vede termenul
  solution_changed_at  TEXT,                             -- set cand solutia trece din null in ne-null
  synced_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tracked_dosar_id, stadiu_procesual, data, ora, complet)
);
```

**De ce JSON array pentru `notify_days_before`:** permite migrare single-threshold `[7]` → multi-threshold `[14,7,3,1]` fara ALTER TABLE. Cost: un `JSON.parse` la read, zero la write.

**De ce `stadiu_procesual` in UNIQUE key:** un dosar poate avea termene simultane in stadii diferite (fond + apel). Fara el, sync-ul ar suprascrie termene-le dintr-un stadiu cu cele din altul.

**CASCADE DELETE pe termene_cache:** la `unwatchDosar`, termene_cache-ul asociat dispare automat — zero orphan rows.

#### Repositories noi (`backend/src/db/`)

- `watchedRepository.ts` — CRUD pe `tracked_dosare`: `watchDosar`, `unwatchDosar`, `listTrackedDosare`, `getTrackedDosar`, `isTracked`, `updateRules`, `updateNote`, `updateSyncStatus`, `countTracked`.
- `termeneCacheRepository.ts` — CRUD pe `termene_cache`: `upsertTermen` (cu detectie `is_new` + `solution_changed_at`), `listTermeneForTracked`, `listUpcomingTermene({ withinDays, ownerId })`, `deleteTermeneForTracked`.

**API consistency cu existing:** ambele urmeaza pattern-ul `rnpmSearchesRepository.ts` (raw better-sqlite3 prepared statements, owner_id scoping implicit, Row→Domain mapper, zero ORM).

#### Sync service (`backend/src/services/watchedSync.ts`)

- `syncDosar(trackedId, { force?: boolean })` — ruleaza flow-ul SOAP existent pentru un singur dosar, upsertează rezultatele in `termene_cache`, seteaza `last_sync_status` + `last_sync_error`.
- `syncAllWatched()` — itereaza `listTrackedDosare`, ruleaza `syncDosar` cu **concurrency cap = 3** (pe modelul throttling-ului SOAP existent din RNPM). La boot + manual (buton „Sync tot").
- Concurrency guard: inainte de a incepe un sync, seteaza `last_sync_status='in_progress'`. Daca la intrare gasesti `'in_progress'` + `last_synced_at` in ultimele 30s, skip (alta cursa e activa). Previne duble lansari la dublu-click „Sync tot".

#### Hono routes (`backend/src/routes/watched.ts`)

| Method | Route | Scop |
|---|---|---|
| GET | `/api/watched` | `listTrackedDosare` |
| POST | `/api/watched` | `watchDosar({ dosarNumar, instanta, rules?, note? })` — idempotent via UNIQUE constraint |
| DELETE | `/api/watched/:id` | `unwatchDosar` |
| PATCH | `/api/watched/:id/rules` | `updateRules` |
| PATCH | `/api/watched/:id/note` | `updateNote` |
| POST | `/api/watched/:id/sync` | `syncDosar(id, { force: true })` |
| POST | `/api/watched/sync-all` | `syncAllWatched()` |
| GET | `/api/watched/upcoming?days=7` | feed pentru dashboard „Termene Imediate" |

Toate mutatiile accepta `clientRequestId` (CP-B8) — UNIQUE constraint + SELECT post-insert garanteaza ca double-click-ul pe „urmareste" returneaza acelasi rand, nu duplicat.

#### Frontend

- **Componenta `WatchStarButton`** — toggleable, apare in: tabelul Termene (coloana actions), `RnpmDetailModal`, rezultatele cautarii dosare.
- **Tab nou „Dosare Urmarite"** (sau sub-tab sub Termene) — lista + contor, butoane per-rand: Sync, Edit rules, Note, Unwatch. Ultimul sync cu timestamp relativ („acum 2h").
- **`WatchRulesModal`** — edit rules (slider zile + toggles „notifica la termen nou" / „notifica la solutie"). UI-ul porneste cu slider unic; chips multi-select e follow-up (backend-ul deja suporta).
- **Dashboard „Termene Imediate"** (v3) — GET `/api/watched/upcoming?days=7`, renderează date-box + numar dosar + ora + complet + „Deschide". Empty state: „Niciun termen in urmatoarele 7 zile pentru dosarele urmarite."
- **Dashboard sparklines** (v1) — adauga SVG inline in cardurile existente, data vine din agregare pe `rnpm_searches` grupata pe zi (30 zile). Component nou `SparklineCard` care wrap-uieste `StatCard`.

### Plan de implementare (9 faze, ~3 zile efectiv)

| Faza | Continut | Effort |
|---|---|---|
| F1 | Schema: CREATE TABLE tracked_dosare + termene_cache (idempotent, pattern existing) | 0.25 zi |
| F2 | `watchedRepository.ts` + `termeneCacheRepository.ts` + tests unitare | 0.5 zi |
| F3 | `watchedSync.ts` + integrare SOAP existing + concurrency guard + fanout cap 3 | 0.5 zi |
| F4 | Hono routes + preload bridge (CP-B2: window.desktopApi.watch.*) | 0.25 zi |
| F5 | `WatchStarButton` + integrare in 3 locuri (Termene tabel, RnpmDetailModal, cautare) | 0.25 zi |
| F6 | Tab „Dosare Urmarite" (lista + actiuni + sync buttons) | 0.5 zi |
| F7 | `WatchRulesModal` (slider threshold + toggles) | 0.25 zi |
| F8 | Dashboard „Termene Imediate" (fetch upcoming + card layout + deep-link) | 0.25 zi |
| F9 | Dashboard sparklines + aggregate query + `SparklineCard` | 0.25 zi |

**Total:** ~3 zile dev efectiv, distribuite pe ~1 saptamana calendaristica cu testare intercalata.

### Design notes critice (flagate de advisor pre-implementare — NU omite)

1. **Detectie `is_new`:** inainte de `INSERT OR REPLACE`, `SELECT` rowul existent. Daca nu exista → `is_new=1`. Daca exista → pastreaza `is_new` existent (doar user-ul il reseteaza cand vede badge-ul).
2. **Detectie „solutie aparuta":** comparatie `old.solutie IS NULL AND new.solutie IS NOT NULL` → seteaza `solution_changed_at = datetime('now')`. E trigger-ul pentru „notifica la solutie".
3. **Normalizare date/ora:** SOAP returneaza formate inconsistente (`2026-04-19T00:00:00`, `2026-04-19 10:00`, `10:0`). Normalizeaza la `YYYY-MM-DD` (slice 0,10) si `HH:MM` (padStart 2) inainte de UNIQUE check, altfel ai duplicate fantoma.
4. **Concurrency guard:** `last_sync_status='in_progress'` + check la intrare. Previne re-entrant sync pe acelasi dosar daca user-ul da dublu pe „Sync".
5. **SOAP fanout cap:** `syncAllWatched` cu `p-limit(3)` sau reimplementat cu semafor — respecta throttle-ul existent RNPM (nu vrem ban IP pe endpoint-ul SOAP portaljust).
6. **Multi-record per dosar:** `stadiu_procesual` e parte din UNIQUE — un dosar cu apel in desfasurare are termene simultan in „fond" (inchis) + „apel" (deschis), ambele trebuie cache-uite.

### Impact

- **User vizibil:** dashboard util (nu doar 2 contoare statice), workflow „urmareste + ia-mi cand se schimba ceva" — lipsa critica azi, user foloseste Termene manual ca sa urmareasca dosare recurente.
- **Infrastructura:** 2 tabele noi (~KB/dosar urmarit), un background sync (boot + manual; auto-interval e follow-up), zero dependente noi npm (SVG sparkline scris manual).
- **Web-readiness:** ramane green. `owner_id` pe ambele tabele (CP-B7), repository-only DB access (CP-B1), preload bridge (CP-B2), zero fs.* in renderer (CP-B3), idempotenta via UNIQUE + clientRequestId (CP-B8).

### Riscuri si mitigari

| Risc | Impact | Mitigare |
|---|---|---|
| Sync lent (SOAP 5-15s per dosar × N urmarite) | UI freeze perceput la „sync tot" | Background async + progress indicator; cap concurrency 3 |
| SOAP returneaza termene incomplete intermitent | False `is_new` detections | `is_new` doar pe INSERT nou, nu pe UPDATE; log delta-urile in audit |
| User sterge dosarul din Termene dar ramane in watchlist | Orphan tracked_dosare | E ok — watchlist e independent de cache local; next sync va intoarce „error" pana user-ul face unwatch |
| Multi-threshold UI creste complexitatea WatchRulesModal | Scope creep | V1 ramane slider unic (`[7]`); multi-threshold e follow-up cu UI diferit (chips) |
| Migrare schema pe DB-uri existente esueaza | Boot blocat | Pattern-ul existing (CREATE TABLE IF NOT EXISTS + ALTER IF NOT COL) e testat pe 4 migrari anterioare |

### Follow-ups post-MVP (listate separat, nu blocheaza launch-ul)

- [ ] **Auto-sync watched dosare la interval configurabil** — setting 2h / 4h / 6h in UI, cron-like in main process (sau setInterval in backend). Ruleaza peste sync-ul la boot + manual; respecta throttle-ul SOAP. Evaluare dupa ce ai date reale de utilizare (cat de des se schimba termenele in realitate). **Effort:** ~0.5 zi.
- [ ] **Multi-threshold alerts (UI)** — extinde WatchRulesModal de la slider unic (`notify_days_before: [7]`) la chips multi-select (`[14, 7, 3, 1]`). Backend-ul tine deja JSON array — doar UI + afisare. **Effort:** ~0.5 zi.
- [ ] **Notificari native Windows** — integrare `new Notification({ title, body })` cand un termen urmarit depaseste pragul `notify_days_before`. Necesita tray integration (altfel notificarile mor la inchidere fereastra). **Effort:** ~1 zi (+ 0.5 zi tray).
- [ ] **Calendar view pentru termene urmarite** — grid lunar cu termene plotate pe zile, click → detaliu. Mai tarziu, cand volumul dosarelor urmarite justifica vizual.

## In paralel (nu blocking, dar de prins in fazele 3-6)

Items mai mari, de facut cand ai capacitate in fazele de mai sus. Nu blocheaza nimic.

- [ ] **DialogShell unificat** — componenta comuna care wrap-uieste toate modalurile (RnpmDetailModal, RnpmRestoreModal, ConfirmDialog, Info baza locala). useDialog consistent, aria-modal + focus trap, size variants. Migrare incrementala — nu te opri la jumatate. **Effort:** ~2 zile. Flag P2 ACTIV in auditul tau intern.
- [ ] **Playwright E2E — 2-3 flow-uri critice** — (1) cautare RNPM + buton Stop cap-coada + verificare zero avize persistate, (2) configurare API key AI + analiza single + multi-agent, (3) backup automat la boot + restore din backup + verificare snapshot pre-restore. Mai impact decat 10 unit-tests noi. **Effort:** ~3-4 zile.

---

## Deferred pentru tranzitia web

Nu atinge pana nu ai `DEPLOY_TARGET=server` in cod sau decizie explicita „incepem serverul":

- Auth layer (Lucia / Better-Auth)
- Multi-tenancy (user_id pe toate tabelele, astazi `owner_id='local'`)
- SQLite → Postgres migration
- Compression middleware (Hono)
- Plugin architecture pentru AI providers
- Rate limiter persistent (cross-restart)
- Prometheus metrics endpoint

Sunt corect P3/deferred in analiza originala. Web-readiness bridge e deja green prin CP-B1..B8 — aceste items vin la randul lor dupa decizia de transit.

## Feature major separat (nu hardening, dar strategic)

- [ ] **Ollama local LLM support** — adauga „Local (Ollama)" ca provider in `services/ai.ts`. Zero data egress → **diferentiator strategic major pentru firmele RO care refuza sa trimita dosare la US-based providers**. Arhitectura actuala il absoarbe relativ usor (registry de modele exista). **Effort:** ~1 saptamana. **Nu e hardening** — e feature cu impact strategic, tracked aici doar ca sa nu se piarda.

---

## Items ce NU sunt aici (pentru referinta — nu le re-adauga fara reevaluare)

Din analiza completa au fost **filtrate afara** ca overkill / YAGNI / N/A pentru contextul actual:

- Subresource Integrity (nu folosim CDN-uri)
- Script `security:check` custom (reinventeaza Dependabot + biome + tsc)
- Conventional Commits + auto-changelog (degradeaza changelog-ul narativ existent)
- Snapshot tests PDF (brittle — fonts, margini)
- i18n setup (premature abstraction clasica — zero customer anglofon confirmat)
- Zod (validation.ts actual functioneaza, nu rezolva problema reala)
- Export/re-import cycle tests (nu exista feature de import)
- CONTRIBUTING.md (solo dev)
- User-facing docs site (Manual integrat deja are 12 capitole)
- ADR-uri (overhead solo dev; deciziile sunt in changelog)
- Telemetry dashboard (contrazice postura GDPR)
- Migrare xlsx → exceljs (xlsx folosit doar pentru export, nu parse)

---

*Document creat 19.04.2026. Ordonat dupa ROI + dependente, nu dupa P0/P1 din documentul original.*
