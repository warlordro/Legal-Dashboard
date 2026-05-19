# Audit Pack Full Project - main - 2026-05-18

## 0. Verdict executiv

**Verdict:** proiectul este solid pentru modul desktop/single-backend, dar **nu este release-clean / web-production-ready** fara hardening suplimentar.

Auditul a fost reluat corect pe `main`, nu pe branch-ul de refactor. Scope-ul este checkout-ul local curent:

- branch: `main`
- HEAD local: `5e3d659 docs: cleanup bloat .md (15 fisiere consumate/inchise)`
- `origin/main`: `cce4246 release: v2.28.3 - refactor closeout + invariants pin (#41)`
- stare worktree la finalul auditului: un fisier neversionat ramas din auditul anterior de refactor: `audit/AUDIT-PACK-REFACTOR-CLOSEOUT-v2.28.3-2026-05-18.md`

Finding-ul principal este **CSRF pe loopback in desktop mode**: `originGuard` lasa toate requesturile unsafe de pe loopback sa treaca, iar `requireDesktopHeader` este aplicat doar pe cateva rute admin RNPM. O pagina web ostila deschisa in browserul utilizatorului poate trimite requesturi `POST` simple catre `localhost:3002` fara sa citeasca raspunsul, dar cu efect de mutatie.

## 1. Metoda si agenti folositi

Auditul a folosit modelul multi-agent cerut, consolidat intr-un singur raport:

- delivery-plan / audit-pack: orchestrare, scope, evidence si plan de remediere
- acceptance-criteria / test-generate / test-review: gap-uri de teste, smoke si gates
- threat-model / security-audit: atacatori, active, CSRF, secrets, local file risks
- dependency-risk: `npm audit`, CI pinning, native ABI, parser libraries
- release-readiness / migration-runbook: stare release, migrations, runbook operational
- code-review / architecture-review / engineering-review: backend, frontend, boundaries, UX failures

Excluderi intentionate: `dist/`, build artifacts, baze de date runtime, loguri si smoke Electron interactiv. Smoke-ul Electron trebuie facut separat deoarece pornirea aplicatiei poate modifica DB/loguri/runtime state.

## 2. Validari rulate

Comenzi cu rezultat verde:

- `npm audit --omit=dev --json` - 0 vulnerabilitati
- `npx biome check .` - 352 fisiere, fara erori
- `npx tsc --noEmit -p backend/tsconfig.json` - pass
- `cd frontend; npx tsc --noEmit` - pass
- `npm test --workspace=backend -- src/index.test.ts` - 5 teste pass
- `cd frontend; npm test -- --run src/lib/export-modules.test.ts` - 6 teste pass dupa rerun in afara sandboxului
- `npm run rebuild:electron` - pass, `better-sqlite3` restaurat pentru Electron

Observatii:

- Full backend/frontend tests au picat cand au fost rulate in paralel in auditul initial: backend pe timeout in `src/index.test.ts`, frontend pe timeouts in `export-modules.test.ts`.
- Rerun-urile secventiale targetate au trecut, deci clasificarea este **flakiness / mediu / concurenta**, nu defect functional confirmat.
- Testele Node cer `npm rebuild better-sqlite3`; dupa testele Node, Electron cere `npm run rebuild:electron`.

## 3. Threat model sumar

Active critice:

- SQLite local si backupuri DB
- date dosare, parti, termene, monitorizare, alerte
- chei AI, captcha, SMTP
- token JWT in web mode
- costuri AI/captcha
- fisiere importate XLSX/CSV

Atacatori relevanti:

- pagina web ostila deschisa pe acelasi calculator in timp ce Electron ruleaza backendul pe `localhost`
- client LAN daca backendul este expus gresit
- fisier XLSX/CSV mare sau crafted importat manual
- dependency/CI supply-chain
- provider AI/captcha/SMTP compromis sau indisponibil

## 4. Findings critice si high

### F1 - HIGH/BLOCKER - Loopback CSRF pe rute state-changing in desktop mode

**Impact:** o pagina web ostila poate produce mutatii locale in Legal Dashboard cand aplicatia desktop ruleaza backendul pe `127.0.0.1:3002`.

**Evidenta:**

- `backend/src/middleware/originGuard.ts:42-57` trece peste verificarea Origin pentru orice peer loopback.
- `backend/src/middleware/requireDesktopHeader.ts:26-28` spune explicit ca headerul nu se aplica pe POST-uri cu body JSON.
- Rute mutante fara `requireDesktopHeader` includ:
  - `backend/src/routes/rnpm.ts:790` - `POST /saved/delete-batch`
  - `backend/src/routes/rnpm.ts:886` - `POST /backups/restore`
  - `backend/src/routes/alerts.ts:301` - `POST /dismiss-bulk`
  - `backend/src/routes/monitoring.ts:358` - `POST /jobs/bulk-delete`
  - `backend/src/routes/me.ts:133` - `POST /email-settings/test`

**De ce conteaza:** presupunerea curenta este ca `Content-Type: application/json` declanseaza preflight CORS. Dar browserul poate trimite request simplu cu `Content-Type: text/plain`, iar parserele JSON/text pot accepta corp JSON. Atacatorul nu poate citi raspunsul, dar poate declansa efectul.

**Remediere recomandata:**

1. In desktop mode, cere `X-Legal-Dashboard-Desktop: 1` pe toate metodele unsafe (`POST`, `PUT`, `PATCH`, `DELETE`) sub `/api/*`.
2. Pastreaza exceptii explicite doar pentru rute publice documentate.
3. Adauga teste negative cu:
   - peer loopback
   - `Origin: https://attacker.example`
   - `Content-Type: text/plain`
   - body JSON valid
4. Acceptance: requestul cross-site simplu primeste `403`, iar rendererul propriu continua sa functioneze prin `apiFetch`.

### F2 - HIGH pentru web - owner isolation are fallback `local` in API-uri RNPM legacy

**Impact:** pentru desktop compatibilitatea este utila, dar pentru web orice caller care uita `ownerId` poate cadea pe `local`, ceea ce face boundary-ul mai putin fail-closed.

**Evidenta:**

- `backend/src/services/rnpmSearchService.ts` accepta `ownerId?: string` in fluxuri legacy.
- `backend/src/db/searchRepository.ts` si `backend/src/db/avizRepository.ts` pastreaza fallback implicit `local` in unele API-uri.

**Remediere recomandata:**

- Fa `ownerId` obligatoriu pentru service/repository APIs web-facing.
- Pastreaza fallback `local` doar intr-un adapter desktop explicit.
- Adauga teste care confirma ca lipsa ownerului este eroare in web mode.

### F3 - HIGH pentru web scale-out - state process-local pentru dedup/scheduler

**Impact:** in single-backend desktop este acceptabil; in web multi-instance produce dedup/rate-limit/scheduler drift intre instante.

**Evidenta:**

- `backend/src/routes/rnpm.ts` foloseste `Map` local pentru dedup.
- `backend/src/services/monitoring/scheduler.ts` tine state in memorie pentru joburi inflight.
- `backend/src/routes/monitoring.ts` tine scheduler handle global.

**Remediere recomandata:**

- Blocheaza explicit multi-instance in deployment docs/health pana exista storage distribuit.
- Pentru web, muta dedup/inflight/locks in DB sau storage distribuit cu lease/TTL.

### F4 - HIGH UX/reliability - Master switch Monitorizare poate ramane blocat in "Se incarca..."

**Impact:** daca primul GET pentru master switch pica, utilizatorul vede control disabled fara recuperare clara.

**Evidenta:**

- `frontend/src/hooks/useMonitoringMasterSwitch.ts:41` initializeaza `enabled` cu `null`.
- `frontend/src/hooks/useMonitoringMasterSwitch.ts:66-68` trateaza erori, dar nu expune `error`.
- `frontend/src/hooks/useMonitoringMasterSwitch.ts:80-83` inghite eroarea de mount cu `refresh().catch(() => {})`.

**Remediere recomandata:**

- Expune `error` in hook si afiseaza retry local.
- Butonul `Reincarca` din pagina sa cheme si `masterSwitch.refresh()`.
- Acceptance: cand GET master switch pica, UI arata eroare + retry, nu ramane blocat in loading.

## 5. Findings medium

### F5 - Import XLSX/CSV in renderer fara cap local inainte de parse

**Impact:** fisier mare/crafted poate bloca rendererul sau consuma memorie inainte ca backendul sa aplice limite.

**Evidenta:**

- `frontend/src/components/monitoring/MonitoringBulkImportCard.tsx:75-76` citeste tot fisierul prin `file.arrayBuffer()` si cheama `parseBulkFile`.
- `frontend/src/lib/monitoringBulkTemplate.ts:310-321` foloseste `XLSX.read` si `sheet_to_json` fara cap bytes/rows/cols.
- Backendul are capuri mai bune in `backend/src/services/nameListParser.ts`, dar acestea sunt dupa parse-ul renderer.

**Remediere recomandata:**

- Verifica `file.size` inainte de `arrayBuffer()`.
- Impune cap de bytes, rows si cols.
- Pentru fisiere mari, muta parse-ul intr-un Worker sau backend parser streaming.

### F6 - AI calls nu sunt anulate cand clientul se deconecteaza

**Impact:** costuri AI si latenta continua dupa ce utilizatorul inchide tabul/streamul.

**Evidenta:**

- `backend/src/routes/ai.ts:197` paseaza `undefined` ca signal la `callModel`.
- `backend/src/routes/ai.ts:333` paseaza `undefined` pentru judge call.
- `backend/src/services/ai.ts` are deja suport pentru `signal`.

**Remediere recomandata:**

- Paseaza `c.req.raw.signal` in single analysis.
- In SSE, combina `stream.onAbort` / request signal cu controllerul intern si paseaza semnalul la analysts + judge.

### F7 - Load-more routes citesc body-ul complet inainte de cap

**Impact:** request oversized poate aloca memorie inainte de guardul de 512 KB.

**Evidenta:**

- `backend/src/routes/dosare.ts:184` defineste `POST /load-more` fara `bodyLimit`.
- `backend/src/services/batch-dosare.ts:155-162` citeste `c.req.text()` inainte de verificarea capului.

**Remediere recomandata:**

- Pune `bodyLimit({ maxSize: MAX_LOADMORE_BODY })` pe rutele `load-more`.
- Sau inlocuieste `c.req.text()` cu reader limitat/streaming.

### F8 - Release docs drift: migration latest este stale

**Impact:** handoff-ul tehnic induce in eroare la debugging/migrations.

**Evidenta:**

- `CLAUDE.md:83` spune `latest 0021`.
- Repo-ul contine migratii pana la `0025_ai_usage_owner_default.up.sql`.

**Remediere recomandata:**

- Actualizeaza `CLAUDE.md` la latest `0025`.
- Marcheaza docs istorice ca istorice sau sincronizeaza headerul (`EXECUTION-ROADMAP.md`, `STATUS.md`) cu realitatea v2.28.3.

### F9 - Docker workflow nu respecta pinning-ul documentat

**Impact:** supply-chain drift in CI pentru Docker release.

**Evidenta:**

- `.github/workflows/docker-build.yml:25-29` foloseste `actions/checkout@v6` si `actions/setup-node@v6`.
- Alte workflow-uri sunt SHA-pinned.

**Remediere recomandata:**

- Pin-uieste actiunile Docker la SHA-uri full, aliniat cu restul CI.

### F10 - Diagnostic OpenRouter poate loga continut sensibil generat

**Impact:** date derivate din dosare pot ajunge in stdout/loguri cand raspunsul este gol.

**Evidenta:**

- `backend/src/services/ai.ts:522-531` logheaza `JSON.stringify(choice?.message).slice(0, 2000)`.
- Promptul AI include date de dosar/parti/sedinte.

**Remediere recomandata:**

- Logheaza doar `finish_reason`, model, requestId, lungimi/coduri si provider metadata safe.

### F11 - RNPM Baza locala nu are error state la load

**Impact:** load failure poate deveni unhandled promise rejection si UI fara mesaj.

**Evidenta:**

- `frontend/src/components/rnpm/RnpmSavedData.tsx:76-95` are `try/finally`, dar nu `catch`.
- `frontend/src/components/rnpm/RnpmSavedData.tsx:97-100` cheama `load()` din effect fara `catch`.

**Remediere recomandata:**

- Adauga `loadError`.
- Foloseste `void load().catch(...)`.
- Evita `load()` imediat dupa `setPage(0)` cu closure vechi.

### F12 - MonitoringApiError pierde `requestId`

**Impact:** debugging-ul incidentelor devine mai greu, desi envelope-ul backend il ofera.

**Evidenta:**

- `frontend/src/lib/api.ts:381-384` include `requestId` in error envelope.
- `frontend/src/lib/api.ts:387-396` constructorul `MonitoringApiError` nu il pastreaza.

**Remediere recomandata:**

- Adauga `requestId?: string` pe `MonitoringApiError`.
- Afiseaza sau logheaza `requestId` in bannerele de eroare.

## 6. Findings low / hardening

### F13 - Dev CORS nu permite toate metodele API

**Impact:** fluxurile Vite/dev pot pica la preflight pentru `PATCH`/`DELETE`, ascunzand regresii web-mode.

**Remediere:** adauga `PATCH` si `DELETE` in allow-list-ul dev CORS si un test preflight.

### F14 - Dialogurile custom declara `aria-modal`, dar nu trap-uiesc focusul

**Impact:** accesibilitate slaba in modale custom.

**Evidenta:** `frontend/src/hooks/useDialog.ts:14-22` muta focusul initial, dar nu implementeaza focus trap.

**Remediere:** wrapper shared `Dialog` cu focus trap si restore focus.

### F15 - `/health` expune posture operationala fara auth

**Impact:** in web/server mode ofera recon (`authMode`, `monitoring`, `emailConfigured`).

**Remediere:** pastreaza `/health` minimal public si muta detaliile in `/readyz`/ops endpoint auth-gated sau loopback-only.

### F16 - `scripts/check-worktree.mjs` nu prinde deletions staged

**Impact:** prebuild poate trece daca deletions sunt staged (`D  path`), desi scriptul vrea sa opreasca stergeri masive accidentale.

**Evidenta:** `scripts/check-worktree.mjs:24-27` filtreaza doar `" D "`.

**Remediere:** verifica si `D  ` sau foloseste `git diff --name-only --diff-filter=D` pentru index + worktree.

## 7. Good controls confirmate

- Electron hardening este bun: `contextIsolation`, `sandbox`, `nodeIntegration=false`, `webSecurity=true`, preload ingust, safeStorage cu limite si whitelist de navigare externa.
- Remote bind este fail-closed: cere web auth + JWT config inainte sa expuna backendul pe host non-loopback.
- RNPM captcha keys sunt blocate in web mode prin `rnpmGuards`.
- AI BYOK in body este blocat in web mode.
- Dockerfile foloseste imagine Node 22 pinned by digest si user non-root.
- `npm audit --omit=dev` este clean.
- Exporturile server-side au capuri si cleanup mai bune decat vechile fluxuri client-side.
- Formula injection are teste sentinel pentru XLSX.

## 8. Acceptance criteria recomandate

Pentru F1:

- Given desktop mode, peer loopback, unsafe method si Origin cross-site, When lipseste `X-Legal-Dashboard-Desktop`, Then API raspunde 403.
- Given rendererul propriu foloseste `apiFetch`, When trimite acelasi endpoint, Then requestul trece.
- Given `Content-Type: text/plain` cu body JSON valid, Then requestul cross-site tot este respins.

Pentru F5:

- Given fisier peste limita configurata, When utilizatorul il selecteaza, Then UI il respinge inainte de `arrayBuffer()`.
- Given XLSX cu `!ref` peste rows/cols cap, Then parserul se opreste cu eroare controlata.
- Given fisier valid sub limita, Then importul curent ramane functional.

Pentru F6:

- Given clientul inchide SSE inainte de judge, Then signalul ajunge la provider call si requestul este anulat.
- Given single analysis este abortat, Then `callModel` primeste `AbortSignal`.

Pentru F8/F9:

- Docs indica latest migration `0025`.
- Docker workflow foloseste action SHA-uri full.

## 9. Runbook de remediere

Ordine recomandata:

1. **Security hotfix:** aplica header desktop obligatoriu pe toate metodele unsafe in desktop mode. Adauga teste negative cross-site simple request.
2. **Renderer import hardening:** cap `file.size`, rows si cols in Monitoring bulk import; mutare in Worker/backend daca fisierele mari sunt caz real.
3. **AI cancellation:** propaga `AbortSignal` pe single si multi analysis.
4. **Body limits:** pune `bodyLimit` pe load-more routes.
5. **Release hygiene:** actualizeaza docs migrations, pin Docker workflow, extinde check-worktree pentru staged deletions.
6. **UX/test hardening:** master switch retry/error state, RNPM saved load error, requestId in MonitoringApiError, focus trap.
7. **Web readiness:** ownerId obligatoriu pe web-facing APIs si storage distribuit/DB leases pentru multi-instance.

## 10. Release readiness

Nu as marca checkout-ul local drept release-ready pana la:

- F1 este remediat sau acceptat explicit ca risc desktop-local.
- Full test suite este rulata secvential dupa ABI rebuild Node si apoi `npm run rebuild:electron`.
- Electron desktop smoke este rulat real.
- `origin/main` vs local `main` este decis: local are commituri docs peste tagul `v2.28.3`.
- Audit pack-ul anterior de refactor untracked este fie versionat intentionat, fie sters/ignorat intentionat.

## 11. Note despre scope

Acest raport inlocuieste auditul gresit ca scope pe refactor branch. Raportul refactor ramas neversionat este pastrat neatins:

- `audit/AUDIT-PACK-REFACTOR-CLOSEOUT-v2.28.3-2026-05-18.md`

Artifactul curent, corect pentru cererea "tot proiectul, pe main":

- `audit/AUDIT-PACK-FULL-PROJECT-MAIN-2026-05-18.md`
