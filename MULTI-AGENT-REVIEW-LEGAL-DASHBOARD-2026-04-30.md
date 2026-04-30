# Multi-Agent Review - Legal Dashboard

Data review: 2026-04-30  
Scope: Legal Dashboard `main`, diff local necommit-uit fata de `origin/main`  
Verdict: **Needs changes inainte de release pentru diff-ul curent. Desktop smoke boot este OK, dar exista riscuri reale in lifecycle monitoring, enrichment alerts, security web-readiness si test coverage.**

## Agentii folositi

- `/debug-investigation` - lifecycle, race-uri, runtime traps.
- `/test-generate` - scenarii de regresie necesare.
- `/implementation-plan` - plan de remediere si release gates.
- `/code-review current diff` - correctness, edge cases, maintainability.
- `/test-review current diff` - acoperire teste si gap-uri.
- `/security-audit current app/current diff` - auth, input, deps, Electron, web readiness.
- Release readiness - executat local de lead, din cauza limitei de thread-uri.

## Stare repo

- Branch: `main`.
- Remote: `main...origin/main`, dar cu 4 fisiere modificate local.
- Fisiere modificate:
  - `backend/src/db/monitoringAlertsRepository.ts`
  - `backend/src/services/monitoring/dosarSoapRunner.ts`
  - `frontend/src/pages/Alerts.tsx`
  - `frontend/src/pages/Monitorizare.tsx`
- `origin/main` este la commit `4a08932` (`v2.6.3`), dar tag-urile locale se opresc la `v2.5.1`.
- Diff-ul contine comentarii `v2.6.4`, dar package/docs/changelog sunt inca `2.6.3`.

## Findings

### F1 - HIGH - Stergerea joburilor nu respecta lifecycle-ul run-urilor in-flight

**Evidence**
- `frontend/src/pages/Monitorizare.tsx:157-158` trimite delete-uri paralele prin `Promise.allSettled(ids.map((id) => monitoring.deleteJob(id)))`.
- `backend/src/routes/monitoring.ts:321` sterge direct jobul prin `deleteJob(ownerId, id)`.
- `backend/src/services/monitoring/scheduler.ts:202` expune deja `getInflightAbortController(jobId)`, dar ruta DELETE nu il foloseste.
- `backend/src/db/monitoringSnapshotsRepository.ts:59-65` arunca daca jobul nu mai exista cand runner-ul incearca sa scrie snapshot.

**Impact**
Daca un job este sters in timp ce scheduler-ul ruleaza SOAP pentru el, runner-ul poate continua si apoi poate esua la snapshot/alert/finalize. Bulk delete mareste probabilitatea cursei.

**Remediere**
In `DELETE /api/v1/monitoring/jobs/:id`, verifica scheduler in-flight inainte de `deleteJob`. Varianta conservatoare: returneaza `409 job_in_flight` si cere retry dupa finalizare. Varianta mai agresiva: abort controlat + asteptare drain + delete.

**Teste**
Test backend cu runner blocat, DELETE in timpul rularii, assert `409` sau abort controlat si fara run orphan / `RUNNER_THREW`.

### F2 - HIGH - Remote/web mode este unsafe pana la PR-9 auth real

**Evidence**
- `backend/src/middleware/owner.ts:17` seteaza orice request ca `ownerId = "local"`.
- `backend/src/middleware/owner.ts:27` cade la `"local"` daca lipseste owner-ul.
- `backend/src/index.ts:153` monteaza `/api/ai`; alte API-uri destructive sunt montate fara auth real.
- `backend/src/index.ts:183-190` permite bind non-loopback doar cu `LEGAL_DASHBOARD_ALLOW_REMOTE=1`.

**Impact**
Daca backend-ul este expus pe LAN/server inainte de PR-9, orice client care ajunge la port poate crea/sterge joburi, marca alerte, consuma AI/RNPM si poate mosteni rolul `local` daca acesta este promovat admin.

**Remediere**
PR-9 trebuie sa fie blocker pentru remote: `requireAuth` global pe `/api/*`, fara fallback `local` in web mode, TLS/reverse proxy, sesiuni reale, per-user owner si quota enforcement.

**Nota**
Pentru desktop loopback, riscul este controlat de bind local. Nu activa `LEGAL_DASHBOARD_ALLOW_REMOTE=1` pentru utilizare reala pana la auth.

### F3 - HIGH - `xlsx@0.18.5` are CVE-uri active si este reachable prin import XLSX

**Evidence**
- `npm audit --omit=dev` raporteaza `xlsx` High: Prototype Pollution si ReDoS, no fix.
- `backend/package.json:21` depinde de `xlsx`.
- `backend/src/services/nameListParser.ts:232` ruleaza `XLSX.read()` pe fisier incarcat.
- `backend/src/routes/nameLists.ts:60-64` are body limits, dar ruta preview/commit ramane reachable.
- `SECURITY.md:141-150` este partial stale: spune ca `xlsx.read()` nu este reachable, desi PR-5 a introdus import XLSX.

**Impact**
Fisier XLSX malițios poate lovi parserul. Cap-urile actuale reduc blast radius, dar nu elimina vulnerabilitatea.

**Remediere**
Migrare server-side la un parser intretinut (`exceljs` sau alternativa), timeout/sandbox pentru parsing si test cu XLSX supradimensionat/malformat. Actualizeaza `SECURITY.md`.

**Clarificare functionalitate**
Exportul PDF/XLSX trebuie sa ramana. Recomandarea este hardening/migrare dependency, nu eliminarea exportului.

### F4 - MEDIUM - Backfill-ul de `instanta/stadiu` poate falsifica contextul istoric

**Evidence**
- `backend/src/db/monitoringAlertsRepository.ts:545-555` aplica `instanta` si `stadiu` pe orice alerta istorica `solutie_aparuta` a jobului cand campurile lipsesc.
- `backend/src/services/monitoring/dosarSoapRunner.ts:218-219` paseaza contextul curent al dosarului la enrichment.

**Impact**
Daca un dosar trece din fond in apel, o alerta veche fara `stadiu` poate fi imbogatita ulterior cu stadiul curent, deci UI-ul arata un context istoric gresit.

**Remediere**
Limiteaza `instanta/stadiu` la alerta care face match pe sedinta sau elimina backfill-ul global pentru aceste campuri. Backfill-ul principal ar trebui sa fie textul hotararii: `solutie_sumar`, `numar_document`, `data_pronuntare`.

### F5 - MEDIUM - Enrichment-ul scaneaza toate alertele istorice ale jobului la fiecare tick

**Evidence**
- `backend/src/db/monitoringAlertsRepository.ts:463-473` permite rularea si cand exista doar `haveDosarFields`.
- `backend/src/db/monitoringAlertsRepository.ts:478-480` selecteaza toate alertele `solutie_aparuta` ale jobului.

**Impact**
Pe joburi vechi, costul devine O(istoric alerte) per tick chiar cand nu exista hotarare noua de completat.

**Remediere**
Fa early return cand `sedintaCandidates.length === 0`, apoi limiteaza query-ul la alerte cu campuri lipsa si/sau la tuple candidate. Adauga cap/batch daca istoricul poate creste mult.

### F6 - MEDIUM - Match-ul de enrichment poate rata hotararea daca textul `solutie` se schimba

**Evidence**
- `backend/src/db/monitoringAlertsRepository.ts:506-511` cere egalitate exacta pe `data`, `ora`, `complet`, `solutie`.
- Dedup-ul pentru `solutie_aparuta` este stabil in diff-ul pur si nu se bazeaza pe text complet al solutiei.

**Impact**
Daca PortalJust modifica textul solutiei intre alerta initiala si publicarea hotararii, alerta veche poate ramane fara `numar_document` / `solutie_sumar`.

**Remediere**
Foloseste o cheie stabila pentru backfill: dedup key, sau `(data, ora, complet)` cu fallback defensiv cand exista multipli candidati.

### F7 - MEDIUM - Enrichment-ul updateaza alerte fara eveniment live catre UI

**Evidence**
- `backend/src/db/monitoringAlertsRepository.ts:559-561` updateaza `detail_json`.
- Fanout SSE este legat de insert nou, nu de update; listenerii sunt notificati in zona `insertAlert`.

**Impact**
Userul aflat deja in pagina Alerte nu vede callout-ul cu hotarare completa pana la refresh manual/reconnect, cu exceptia cazului in care apare incidental o alerta noua.

**Remediere**
Emite eveniment `alert-updated` / `alert-enriched` pe SSE sau refoloseste mecanismul de stream version pentru refresh dupa update.

### F8 - MEDIUM - Lipsesc teste pentru comportamentul nou din diff

**Evidence**
- Diff-ul adauga logica noua in repository, runner si UI, dar nu modifica teste.
- Zonele noi sunt in `monitoringAlertsRepository.ts:457`, `dosarSoapRunner.ts:205`, `Alerts.tsx:579`, `Monitorizare.tsx:141`.

**Teste P0**
- `monitoringAlertsRepository.test.ts`: patch campuri lipsa, idempotenta, nu suprascrie campuri non-empty, owner/job/kind scoping, JSON invalid ignorat, solutie text changed.
- `dosarSoapRunner.test.ts`: alerta veche incompleta + tick nou cu `solutieSumar/numarDocument/dataPronuntare`; rollback atomic cand update-ul enrichment esueaza.

**Teste P1/P2**
- UI/E2E: bulk delete cancel/success/partial failure, select all/indeterminate/prune dupa refresh.
- UI/E2E: Alerte callout `HOTARARE NR.`, data pronuntarii, sumar compactat, fara duplicare `Solutie`.
- UI/E2E: link portal.just.ro si buton `Dosare` din Monitorizare/Alerte.
- AdminGate frontend: user non-admin/admin/error state.

### F9 - LOW/MEDIUM - Bulk delete pierde selectia pentru retry la esec partial si poate parea global

**Evidence**
- `frontend/src/pages/Monitorizare.tsx:141-164` goleste selectia dupa `Promise.allSettled`, inclusiv cand unele delete-uri esueaza.
- `frontend/src/pages/Monitorizare.tsx:97` incarca doar `pageSize: 100`.
- `frontend/src/pages/Monitorizare.tsx:125-129` calculeaza `allSelected` doar pe cele 100 rows incarcate.

**Impact**
Userul pierde lista exacta de joburi nereusite pentru retry. La peste 100 joburi, "select all" poate fi perceput ca global, desi opereaza doar pe pagina incarcata.

**Remediere**
Pastreaza `selectedIds` pentru ID-urile esuate. Clarifica label-ul ca "pagina vizibila" sau adauga paginare/total si endpoint bulk tranzactional cu audit agregat.

### F10 - LOW/MEDIUM - `alerts_created` poate supra-raporta dedup no-op

**Evidence**
- `backend/src/services/monitoring/dosarSoapRunner.ts:224` seteaza `alertsCreated = alerts.length`.
- `insertAlert` gestioneaza intern dedup, dar contractul curent nu expune `inserted`.

**Impact**
Run history poate raporta alerte create cand insert-ul a fost de fapt idempotent/no-op. Enrichment-urile patch-uite nu sunt contorizate deloc.

**Remediere**
Exposeaza `{ row, inserted }` sau un helper `insertAlertWithStatus`, apoi contor separat pentru `alerts_patched` daca vrei observabilitate precisa.

### F11 - LOW - Release metadata inconsistente pentru patch-ul curent

**Evidence**
- Comentarii noi mentioneaza `v2.6.4` in backend/frontend.
- `package.json`, `backend/package.json`, `frontend/package.json`, `CLAUDE.md`, `CHANGELOG.md`, `frontend/src/data/changelog-entries.tsx` raman la `v2.6.3`.
- `SESSION-HANDOFF.md` spune ca push-ul PR-7/PR-8 inca urmeaza, dar `git log` arata `main`, `origin/main` si `origin/HEAD` pe `4a08932`.

**Remediere**
Dupa cod + teste, daca patch-ul ramane: bump complet `v2.6.4`, changelog, in-app changelog, `CLAUDE.md`, `SESSION-HANDOFF.md`, tag-uri lipsa sau decizie explicita de amanare tag.

## Security notes suplimentare

- `npm audit --omit=dev` raporteaza si `@anthropic-ai/sdk` Moderate, no fix: "Insecure Default File Permissions in Local Filesystem Memory Tool". Nu am gasit utilizare a memory tool-ului in codul curent, deci pare risc indirect, dar trebuie monitorizat.
- CSRF/origin policy trebuie introdusa in PR-9 daca web auth foloseste cookie-uri: `SameSite`, `Origin` / `Sec-Fetch-Site`, CSRF token sau bearer non-cookie.
- Electron posture este buna: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, whitelist extern exact, safeStorage IPC limitat.

## Validari rulate de lead

Initial:
- `git diff --check` - passed, doar avertismente CRLF.
- `npx.cmd tsc --noEmit -p backend/tsconfig.json` - passed.
- `npx.cmd tsc --noEmit` in `frontend` - passed.

Probleme de mediu rezolvate:
- `npm.cmd test --workspace=backend` a esuat intai cu `spawn EPERM` in sandbox.
- In afara sandboxului a esuat apoi pentru ca `better-sqlite3` era compilat pentru Electron ABI `NODE_MODULE_VERSION 145`, iar Node cerea `137`.
- Am inchis instanta Electron care tinea lock pe `better_sqlite3.node`.
- `npm.cmd rebuild better-sqlite3` - passed pentru Node ABI.

Validari finale:
- `npm.cmd test --workspace=backend` - **524/524 passed**.
- `npm.cmd run build` - passed. Avertismente: chunk-uri Vite mari si dynamic import `export.ts` deja cunoscut.
- `npm.cmd run rebuild:electron` - passed, `better-sqlite3` refacut pentru Electron.
- Electron desktop smoke: pornire `npm run electron:dev` cu `ELECTRON_RUN_AS_NODE` curatat, fara terminal vizibil; `GET http://127.0.0.1:3002/health` a raspuns:

```json
{
  "status": "ok",
  "service": "Legal Dashboard API",
  "monitoring": {
    "enabled": true,
    "running": true,
    "inflight": 0
  }
}
```

Log smoke:
- `logs/smoke-review-20260501-000420.out.log`
- `logs/smoke-review-20260501-000420.err.log`

Procesele Electron/Node lansate pentru smoke au fost inchise dupa verificare.

## Ordine recomandata de remediere

1. **P0** - Fix DELETE in-flight lifecycle pentru joburi monitoring.
2. **P0** - Restrange `enrichSolutieAlertsForJob`: fara backfill global `instanta/stadiu`, early return cand nu exista candidates, query targetat.
3. **P0** - Adauga teste repository + runner pentru enrichment, inclusiv atomic rollback si text `solutie` modificat.
4. **P1** - Decide audit/immutability pentru update in-place pe `detail_json`.
5. **P1** - Adauga SSE refresh pentru alerte enrich-uite.
6. **P1** - Remediaza `xlsx@0.18.5` reachable sau documenteaza explicit risc temporar actualizat, cu owner si deadline.
7. **P1** - Adauga UX/test coverage pentru bulk delete si callout hotarare.
8. **P2** - Corecteaza release metadata pentru `v2.6.4` si starea handoff/tag-uri.

## Verdict final

Pentru desktop local: **aplicatia booteaza si testele/build-ul trec dupa rebuild ABI**, dar diff-ul curent nu este gata de release fara remedierile P0/P1 de mai sus.

Pentru web/remote: **nu este gata de expunere** pana la PR-9 auth real + TLS/origin/CSRF/quota.
