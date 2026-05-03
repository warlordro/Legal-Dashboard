# Deep Review Legal Dashboard - 2026-05-04

## Scope si metoda

Review read-only pe cod, arhitectura, securitate, deploy readiness, zone de god-code si bug-uri. Am folosit un model multi-agent usor:

- Apex/Helm: sinteza, prioritizare si coerenta raportului.
- Prism/Spine: cod, bug-uri, mentenabilitate si zone mari.
- Warden/Vigil: securitate, izolarea datelor, dependinte si configuratie.
- Atlas/Flux: arhitectura, deploy, CI si release readiness.
- Proof: validari locale executate.

Nu am schimbat codul aplicatiei. Singura modificare este acest raport Markdown.

## Verdict executiv

Legal Dashboard construieste local si are fundatia desktop relativ solida, dar nu este gata pentru release web/server sau LAN multi-user. Blocajele principale sunt izolarea RNPM in web mode, endpoint-urile globale de mentenanta neprotejate pe rol admin, configuratia Docker/server care poate raporta container sanatos dar inaccesibil din host, si auditul de dependinte production care ramane rosu.

Pentru desktop loopback, riscul este mai controlat, dar exista in continuare datorie tehnica reala: componente mari, fetch-uri care nu trec toate prin acelasi boundary, tranzactii orchestratate in rute, si teste locale care nu au putut fi rulate complet fara refacerea ABI-ului `better-sqlite3`.

## Validari executate

Comenzi care au trecut:

- `npx.cmd tsc --noEmit -p backend/tsconfig.json`
- `npx.cmd tsc --noEmit` in `frontend`
- `npm.cmd run build`
- `git diff --check`

Comenzi care nu au trecut sau au fost blocate:

- `npm.cmd audit --omit=dev`: 5 vulnerabilitati production, inclusiv `nodemailer` high si `xlsx` high.
- `npm.cmd run typecheck`: script lipsa in root.
- `npm.cmd run lint`: script lipsa in root.
- `npx.cmd biome check`: nu exista `node_modules\.bin\biome.cmd`, iar instalarea temporara a esuat cu `EPERM` in cache-ul npm.
- `npm.cmd test --workspace=backend -- --run`: blocat initial de `spawn EPERM`, apoi cu `--pool threads` a esuat din cauza ABI-ului `better-sqlite3` compilat pentru Electron `NODE_MODULE_VERSION 145`, in timp ce Node local cere `137`.
- Testele frontend Vitest au esuat la startup cu `spawn EPERM`.

Build-ul a trecut, dar a raportat avertismente:

- `scripts/build.js` este tratat ca ESM fara `"type": "module"`.
- `frontend/src/lib/export.ts` este importat atat static, cat si dinamic, deci dynamic import-ul nu mai separa chunk-ul.
- Chunk-uri mari: `charts`, `xlsx`, `xlsx.min`.

Electron desktop smoke nu a fost finalizat in acest review; pentru release ramane necesar un smoke real al aplicatiei Electron dupa orice rebuild Node/Electron al lui `better-sqlite3`.

## Findings prioritizate

### P0 - Blocante pentru web/server release

#### 1. RNPM nu este izolat pe owner in web mode

Evidenta:

- `backend/src/routes/rnpm.ts` foloseste in continuare owner hardcodat `"local"` pentru idempotency si bulk search.
- Operatii precum `getAvizById`, `deleteAllAvize`, `deleteAvizeByIds`, `getAvizeByIds`, `getSearches`, `deleteSearch` sunt apelate fara `getOwnerId(c)`.
- `backend/src/services/rnpmSearchService.ts` are fallback `input.ownerId ?? "local"`.
- Testul `backend/src/routes/rnpm.contract.test.ts` documenteaza comportamentul curent ca single-user/local.

Impact:

In `LEGAL_DASHBOARD_AUTH_MODE=web`, utilizatori diferiti pot ajunge sa citeasca, exporte sau stearga date RNPM comune sub owner-ul `local`. Asta rupe izolarea multi-user si este blocant pentru deployment web/company.

Remediere:

- Importa si foloseste `getOwnerId(c)` in toate rutele RNPM.
- Propaga `ownerId` in service si repository pentru cautari, saved avize, export, stergeri si history.
- Include owner-ul real in cheia de idempotency, nu `"local"`.
- Adauga teste contract Alice/Bob pentru list, detail, export, delete, search history si bulk search.

#### 2. Endpoint-urile RNPM de backup/DB maintenance nu sunt protejate admin

Evidenta:

- Routerul RNPM nu are `requireRole("admin")`, spre deosebire de `backend/src/routes/admin.ts`.
- Endpoint-uri destructive sunt montate in `backend/src/routes/rnpm.ts`: delete all backups, restore backup, compact DB, open DB/backups folder.

Impact:

In web mode, orice utilizator autentificat poate afecta resurse globale: backup-uri, restore DB sau operatii de mentenanta. Chiar daca datele RNPM devin owner-scoped, aceste operatii raman cross-user/global.

Remediere:

- Pune backup/compact/open-folder/stat maintenance routes in spatele `requireRole("admin")`.
- Alternativ, dezactiveaza complet aceste rute in `AUTH_MODE=web` si pastreaza-le doar pentru desktop/Electron.
- Adauga teste pentru user non-admin: `403` pe rutele globale.

#### 3. Docker/server poate fi healthy dar inaccesibil din host

Evidenta:

- `docker-compose.yml` publica `127.0.0.1:3002:3002`.
- Backend-ul are guard de bind remote si cere `HOST=0.0.0.0` plus `LEGAL_DASHBOARD_ALLOW_REMOTE=1`.
- CI seteaza explicit aceste variabile in workflow-ul Docker, dar compose local nu le seteaza.
- Healthcheck-ul Docker verifica din interiorul containerului, nu din host.

Impact:

`docker-compose up -d` poate arata container sanatos, dar aplicatia sa fie inaccesibila de pe host. Pentru deploy readiness, asta produce fals pozitiv.

Remediere:

- Decide clar daca `docker-compose.yml` este dev-only sau deployable.
- Daca este deployable, seteaza explicit `HOST=0.0.0.0`, `LEGAL_DASHBOARD_ALLOW_REMOTE=1`, `LEGAL_DASHBOARD_AUTH_MODE=web`, secret/audience/issuer JWT si acknowledgement-ul cerut.
- Adauga un smoke host-side, nu doar container healthcheck.

#### 4. Auditul production ramane rosu

Evidenta:

- `npm audit --omit=dev` raporteaza 5 vulnerabilitati: `nodemailer` high, `xlsx` high, `@anthropic-ai/sdk` moderate, `exceljs/uuid` moderate.
- Frontend-ul are inca `xlsx` ca dependinta si foloseste `XLSX.read` in bulk import.
- `nodemailer` este direct in backend si este folosit pentru `sendMail`.

Impact:

Nu exista un release clean din perspectiva dependency risk. Pentru desktop local riscul depinde de fisierele deschise si configuratia email, dar pentru web/company este o problema de release si compliance.

Remediere:

- Elimina `XLSX.read` din renderer; muta preview/import pe backend sau pe o librarie mai sigura, cu cap de marime inainte de parsare.
- Scoate `xlsx` din runtime daca ramane doar export write-only prin alta librarie.
- Upgrade sau inlocuire `nodemailer` cand exista versiune remediata; pana atunci SMTP trebuie considerat risc acceptat sau dezactivat in deployment-uri necontrolate.
- Documenteaza explicit riscurile fara fix upstream.

### P1 - Riscuri importante in release, arhitectura si date

#### 5. Artifact names in GitHub Actions pot esua pe branch-uri cu `/`

Evidenta:

- `.github/workflows/build-windows.yml` si `build-mac.yml` folosesc raw `${{ github.ref_name }}` in artifact name.
- Upload-ul are `continue-on-error: true`, deci esecul poate fi mascat.

Impact:

Pe branch-uri de tip `feature/foo`, artifact upload poate esua si workflow-ul poate ramane aparent verde fara artifact util.

Remediere:

- Sanitizeaza ref name intr-un `SAFE_REF`.
- Scoate `continue-on-error` sau limiteaza-l la cazuri justificate.

#### 6. Repository-ul de alerts amesteca persistence cu fanout/email side effects

Evidenta:

- `backend/src/db/monitoringAlertsRepository.ts` importa direct `dispatchAlertEmail`.
- Acelasi modul tine subscriberii SSE, notificarile si dispatch-ul email.
- Email-ul este pornit in microtask dupa commit.

Impact:

Daca procesul cade dupa commit si inainte de microtask, alerta ramane in DB dar email-ul se pierde. Modulul are responsabilitati amestecate si va fi greu de extins pentru outbox/retry.

Remediere:

- Introdu un `AlertEventService` sau outbox table.
- Pastreaza repository-ul strict pentru DB.
- Proceseaza email/notifications dintr-un worker sau dispatcher durabil.

#### 7. Rutele orchestreaza prea multe tranzactii si business flow

Evidenta:

- `backend/src/routes/monitoring.ts` importa `getDb` si tine tranzactii in rute.
- `backend/src/routes/nameLists.ts` are acelasi pattern.

Impact:

Validarea, auditul, tranzactiile si business rules sunt greu de testat separat. Creste riscul de regresie cand se schimba contractul API.

Remediere:

- Extrage command services: `createMonitoringJob`, `bulkCreateMonitoringJobs`, `updateMonitoringJob`, `importNameList`.
- Rutele sa ramana subtiri: auth/parse/response.

#### 8. Boundary-ul frontend pentru API nu este unic

Evidenta:

- `frontend/src/lib/api.ts` spune ca request-urile trebuie sa treaca prin `apiFetch`, dar acelasi fisier are raw `fetch`.
- `frontend/src/lib/alertsApi.ts` foloseste raw `fetch`.

Impact:

Cand vor fi adaugate headere comune, request IDs, retry, auth sau origin policies, unele call-uri pot ramane in afara politicii.

Remediere:

- Toate request-urile sa treaca prin `apiFetch`.
- Adauga test/static check simplu pentru raw `fetch` in `src/lib`.

#### 9. Idempotency pentru monitoring poate intoarce job gresit

Evidenta:

- `monitoringJobsRepository.ts` cauta dupa `(owner_id, client_request_id)` si intoarce randul existent inainte sa compare `kind` sau `target_hash`.
- Ruta intoarce `200 duplicate`.

Impact:

Daca un client refoloseste acelasi `client_request_id` cu alt target, primeste jobul vechi fara conflict explicit.

Remediere:

- La replay, compara `kind`, `target_hash` si campurile importante.
- Intoarce `409 idempotency_conflict` cand payload-ul difera.
- Test: acelasi `client_request_id`, target diferit => `409`.

#### 10. Timeline pagination poate sari evenimente cu acelasi timestamp

Evidenta:

- Query-urile folosesc strict `ts < cursor`.
- `nextCursor` contine doar timestamp-ul ultimului eveniment.

Impact:

Daca mai multe evenimente impart acelasi timestamp la limita paginii, pagina urmatoare le exclude.

Remediere:

- Cursor compus: `ts + source + id`.
- Query cu tie-breaker: `ts < ? OR (ts = ? AND tie_breaker < ?)`.

#### 11. Dump RNPM real este tracked in git

Evidenta:

- `git ls-files` include un fisier sub `backend/rnpm-dumps/`.
- Fisierul contine nume, adrese si identificatori fiscali/registration IDs.

Impact:

Repo-ul devine vehicul de distributie pentru date reale, in afara controalelor aplicatiei.

Remediere:

- Inlocuieste cu fixture sintetic.
- Adauga `backend/rnpm-dumps/` in ignore.
- Daca remote-ul este public sau distribuit larg, planifica purge de istoric.

#### 12. Web mode accepta inca chei AI/captcha trimise din browser

Evidenta:

- AI key poate veni din request body.
- RNPM accepta `captchaKey` din request body.

Impact:

Pentru un serviciu web company-wide, secretele userilor tranziteaza serverul, contrar directiei de config server-side.

Remediere:

- In `AUTH_MODE=web`, respinge cheile AI/captcha din body.
- Pastreaza BYOK doar in desktop mode sau intr-un mecanism dedicat de secret storage.

#### 13. Build server artifact inca foloseste branding PortalJust

Evidenta:

- `scripts/build-server.js` foloseste `portaljust-server-${version}` si text `PortalJust Dashboard Server`.

Impact:

Artifactele de release pot iesi cu nume/produs gresit, ceea ce creeaza confuzie operationala si de suport.

Remediere:

- Redenumeste artifact-ul server in `legal-dashboard-server-${version}`.
- Actualizeaza README-ul generat si orice referinta ramasa la PortalJust.

#### 14. Root validation scripts/tooling lipsesc

Evidenta:

- Root `package.json` nu are `typecheck`, `lint` sau `test`.
- Exista `biome.json`, dar nu exista Biome instalat local.

Impact:

Developerii si CI nu au aceleasi comenzi de baza. Se produce drift intre documentatie, workflow-uri si ce poate fi rulat local.

Remediere:

- Adauga scripturi root: `typecheck`, `test`, `check`/`lint`.
- Adauga `@biomejs/biome` ca devDependency daca Biome ramane standardul.

### P2 - Mentenabilitate, UX si datorie tehnica

#### 15. `Monitorizare.tsx` este hotspot de god-code

Evidenta:

- `frontend/src/pages/Monitorizare.tsx` contine fetch, filtre, selectie, export, modal focus, rendering de tabel si mutatii.

Impact:

Orice schimbare de UI sau comportament atinge o suprafata mare si creste riscul de regresii.

Remediere:

- Extrage `useMonitoringJobs`.
- Extrage `MonitoringJobsTable`, toolbar, filtre si modalul de instance scope.

#### 16. Fetch-urile frontend pot fi suprascrise de raspunsuri stale

Evidenta:

- `Monitorizare.refresh()` si `Alerts.load()` comit raspunsul oricarui request finalizat, fara `AbortController` sau sequence guard.

Impact:

Schimbarile rapide de filtre/paginare pot afisa randuri vechi dupa ce un request mai vechi se termina mai tarziu.

Remediere:

- Foloseste `AbortController` sau request sequence id.
- Teste cu doua promisiuni rezolvate in ordine inversa.

#### 17. Mesaj UX gresit la monitorizare duplicata

Evidenta:

- Backend-ul poate intoarce un job existent la target duplicate.
- Formularul manual afiseaza mereu `Adaugat`.

Impact:

Userul crede ca s-a creat un monitor nou cu setarile curente, dar aplicatia a reutilizat unul existent.

Remediere:

- Expune `created` pentru name jobs.
- Afiseaza `Exista deja` sau mesaj echivalent cand backend-ul intoarce duplicate.

#### 18. Dashboard aggregation este duplicat

Evidenta:

- `backend/src/routes/dashboard.ts` repeta logica de agregare pentru summary, charts si report.

Impact:

Rapoartele si chart-urile pot diverge la schimbari viitoare.

Remediere:

- Creeaza builders comuni pentru agregari dashboard.
- Testeaza o singura sursa de adevar pentru acele calcule.

#### 19. `electron/main.js` este prea incarcat pentru boundary-ul de securitate

Evidenta:

- Acelasi fisier gestioneaza lifecycle backend, IPC, notificari, window security, identitate dev si startup.

Impact:

Schimbarile la securitate/window pot fi amestecate cu lifecycle si notificari, crescand riscul de modificari accidentale.

Remediere:

- Extrage module pentru notifications, backend lifecycle si window policy.
- Pastreaza `main.js` ca orchestrator subtire.

#### 20. Workflows release folosesc action tags mutabile cu `contents: write`

Evidenta:

- Workflows folosesc tags de actiuni precum `actions/checkout@v6`, `actions/setup-node@v6`, `softprops/action-gh-release@v3`.
- Joburile au `contents: write`.

Impact:

Supply-chain risk mai mare in joburi cu drept de release.

Remediere:

- Pin pe commit SHA pentru actiunile folosite in release.
- Separa build/test cu `contents: read` de publicarea efectiva cu `contents: write`.

#### 21. Documentatie/TODO-uri stale

Evidenta:

- Unele comentarii si `.env.example` inca vorbesc despre PR-10/SSO sau fallback-uri vechi.
- `CLAUDE.md`/handoff citite initial indicau v2.10.7, in timp ce manifestele curente sunt v2.10.8.

Impact:

Agentii si developerii pot urma contracte vechi si pot reintroduce comportamente deja eliminate.

Remediere:

- Sincronizeaza `CLAUDE.md`, `SESSION-HANDOFF.md`, `.env.example` si TODO-urile cu realitatea v2.10.8.
- Marcheaza clar ce ramane desktop-only si ce este web-ready.

## Ordinea recomandata de remediere

1. Opreste orice release web/server pana cand RNPM are owner isolation si rutele globale sunt admin-gated sau dezactivate in web mode.
2. Fixeaza RNPM owner propagation end-to-end si adauga teste Alice/Bob pentru toate operatiile RNPM.
3. Protejeaza backup/restore/compact/open-folder cu admin sau desktop-only guard.
4. Clarifica Docker compose: dev-only sau deployable; daca deployable, adauga env web-mode si smoke host-side.
5. Rezolva dependency risk: elimina `XLSX.read` din renderer, scoate `xlsx` runtime daca este posibil, si planifica mitigarea `nodemailer`.
6. Normalizeaza validarea: root scripts pentru typecheck/test/lint si Biome local daca ramane standard.
7. Fixeaza workflow artifact name sanitization si elimina upload-uri silent-fail.
8. Fixeaza idempotency conflict la monitoring si cursor compus pentru dashboard timeline.
9. Extrage treptat command services din rute si refactorizeaza `Monitorizare.tsx` in hook + componente.
10. Sincronizeaza documentatia si handoff-ul cu v2.10.8 si cu deciziile web-readiness curente.

## Concluzie

Aplicatia este intr-o stare buna pentru continuarea developmentului desktop, iar build-ul trece. Pentru release web/server, insa, starea curenta este `not ready`. Cele mai importante remedieri sunt izolarea RNPM pe owner, admin guard pentru operatii globale, clarificarea Docker/server deploy si curatarea dependency audit-ului.

Recomandarea practica este un PR de hardening cu scope strict pe P0, urmat de un PR de release validation/tooling, apoi refactorizari P1/P2 pe bucati mici.
