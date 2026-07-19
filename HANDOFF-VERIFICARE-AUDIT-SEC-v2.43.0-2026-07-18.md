# HANDOFF — Verificare audit securitate + corectitudine v2.43.0 (2026-07-18)

**Sesiune intrerupta de safeguards; acest document permite reluarea intr-o sesiune noua.**

## Obiectivul original (goal-ul sesiunii)

1. Verifica vs cod claim-urile din `AUDIT-SEC-CORECTITUDINE-v2.43.0-2026-07-18.md` (23 findings). — **FACUT (100%)**
2. Propune un plan de remediere. — **DRAFT mai jos (sectiunea 4), de rafinat**
3. Ia opinie adversariala de la **Codex**. — **FACUT (vezi §4c)**
4. Ia opinie adversariala de la **review-panel**. — **FACUT (vezi §4b; 4/5 modele, Kimi timeout)**
5. Prezinta concluziile finale non-tehnic + plan TDD. — **FACUT (plan final in §4d; prezentarea livrata in chat 2026-07-19)**

## 1. Cum s-a facut verificarea (pasul 1, complet)

5 agenti paraleli de verificare adversariala, fiecare a re-derivat claim-urile din cod (file:line, citate, teste empirice in node_modules unde a fost cazul). Zero fisiere modificate. Skill `verification-discipline` aplicat.

## 2. Verdicte consolidate per finding

**Bilant: 21/23 CONFIRMATE, 2 PARTIALE (BUG-01, BUG-07), 0 REFUTATE integral. Auditul e de incredere; 2 severitati Medium trebuie retrogradate la Low (BUG-01, BUG-02).**

| ID | Verdict verificare | Corectii fata de audit |
|---|---|---|
| SEC-01 (CSRF desktop) | **CONFIRMAT** (Medium OK) | Sub-claim (b) partial: `requireDesktopHeader` e aplicat si pe unele rute cu body JSON (alerts.ts:302 dismiss-bulk, monitoring.ts:359 bulk-delete, rnpm.ts:921/954/1027/1046/1168/1210/1262/1294, adminBackups.ts:52/80/122) — dar tot selectiv/inconsistent. Lantul de atac complet confirmat: pagina ostila -> POST text/plain (simple request, fara preflight) -> originGuard bypass loopback (originGuard.ts:52-56) -> desktop auth = ownerId "local" FARA token (authProvider.ts:53-60) -> local e auto-promovat ADMIN la boot (index.ts:538-548) -> Hono `c.req.json()` parseaza indiferent de Content-Type (verificat in node_modules/hono/dist/request.js:117-119). Rutele expuse din audit: toate 6 confirmate. PATCH/PUT/DELETE safe (non-simple), CORS dev-only confirmat (index.ts:140-151). |
| SEC-02 (Electron) | **CONFIRMAT + ascutit** (Medium OK) | Lockfile blocat pe **41.5.0**, dar linia 41.x are deja **41.10.2** (publicat 2026-07-14, acelasi val de patch-uri cu 43.1.1) — deci exista gap de patch-uri Chromium ACUM, in propria linie. Latest stable = **43.1.1**; 41 e ultima linie suportata (cade la release-ul 44). Fix imediat: `npm update electron` (ramane pe 41) + `npm run rebuild:electron`; strategic: migrare 41->43. |
| BUG-01 (alertsExportPdf leak) | **PARTIAL — retrogradeaza Medium -> Low** | Trigger-ul "emoji arunca in WinAnsi" e **REFUTAT**: pdfkit 0.18.0 (pdfkit.js:2350-2369) NU arunca — randeaza `.notdef` silentios. Eroarea de stream e DEJA curatata: pdfStream.ts:17-19 face unlink la 'error'. Raman 2 goluri reale dar rare: (a) throw sincron in drawTable inainte de doc.end() scurge tmp+stream, (b) fs.stat respins scurge tmp scris complet. Fix-ul (try/catch paritate cu rnpmExportPdf.ts:314-319) ramane util ca armonizare. XLSX "committed flag" confirmat in toate 4 builders. |
| BUG-02 (RNPM storage bypass gcode) | **CONFIRMAT faptic — dar retrogradeaza Medium -> Low, e DECIZIE DE DESIGN** | Skip-ul e **intentionat si testat**: `rnpmStorageRecheck.test.ts:96-119` ("continuarea cu existingGcode termina paginile fara recheck") — rationament: nu irosi captcha platit / nu strica batch partial. Depasirea e **marginita**: MAX_TOTAL_RESULTS=1500 per cautare (rnpmSearchService.ts:84,260-271), cautare NOUA re-declanseaza check-ul. Worst case: cateva zeci de MB peste limita de 750MB, NU crestere infinita. Bulk path are recheck per item neconditionat (rnpmSearchService.ts:524). Decizie necesara de la owner: pastram design-ul (documentat) sau strangem (recheck si pe gcode, cu oprire gratioasa). |
| SEC-03 (xlsx-js-style) | **CONFIRMAT + extins** | In plus fata de audit: **SECURITY.md:204,256** sustine fals "write-only, no reachable surface" — contrazis chiar de changelog-entries.tsx:1150-1152 care documenteaza migrarea parsarii de INPUT USER la xlsx-js-style. De corectat si SECURITY.md, STATUS.md:65, SESSION-HANDOFF.md:474. |
| SEC-04 (redirect + chei) | **CONFIRMAT + rafinat** | Verificat in undici 6.27.0 local: pe redirect cross-origin sterge DOAR authorization/proxy-authorization/cookie/host — `x-api-key`/`x-goog-api-key` raman. Rafinare: cheile din BODY (CapSolver) nu se scurg pe 301/302/303 (rescriere in GET + drop body), doar pe 307/308; cheile din HEADER se scurg pe orice 3xx cross-origin. |
| SEC-05 (log forging faultstring) | **CONFIRMAT** | Liniile exacte: soap.ts:145-150. Fault-ul nu ajunge la client (confirmat dosare.ts:182-195). |
| SEC-06 (RangeError decodeXmlEntities) | **CONFIRMAT** | Empiric: `String.fromCodePoint(0x110000)` arunca RangeError pe Node local. Eroarea E prinsa downstream (500 generic pe ruta; SOAP_FAIL + fail_streak++ in monitoring, alerta "Sursa indisponibila" la 5 esecuri) — exact impactul din audit. |
| SEC-07 (rnpmClient fara cap) | **CONFIRMAT + bonus** | Zero cap in tot fisierul (si error-path `res.text()` la :284,305,328 buffer-uieste tot). **Bonus negasit de audit: iccjClient.ts:468 `warmSession` face `arrayBuffer()` fara cap.** |
| SEC-08 (IPC notification) | **CONFIRMAT** | Linii reale 211-225 (getStatus:212, test:214, show:224). Nuanta: setWindowOpenHandler deny-all pe creare ferestre, dar face shell.openExternal pe whitelist https. |
| SEC-09 (fara plafon joburi) | **CONFIRMAT** | Mitigari verificate exacte (cadence min 600s, claim 50/tick@60s, retention 90 zile pe varsta, rate limit global 120/min per ip+owner => ~170k joburi/zi posibile). Infrastructura de quota exista (user_quota_overrides 0011/0027/0028/0041, quotaGuard.ts) — cap-ul de count e o extensie noua, precedent: rnpmStorageLimit.ts. |
| SEC-10 (will-redirect) | **CONFIRMAT** | Zero hits `will-redirect` in electron/. |
| SEC-11 (placeholder JWT) | **CONFIRMAT** | Corectie: 48 chars, nu 49. Check-ul e length-only >=32 (auth/config.ts:3,67-73), zero verificare entropie/pattern. |
| SEC-12 (uuid via exceljs) | **CONFIRMAT** | npm audit live 2026-07-18: uuid 8.3.2 sub exceljs 4.4.0, GHSA-w5hq-g745-h8pq, 2 moderate. Fara fix curat upstream (npm propune downgrade breaking exceljs@3.4.0). |
| SEC-13 (drift deploy) | **CONFIRMAT** | Toate 4 punctele exacte: 2.35.0 / 2.38.0 / 2.39.0 vs 2.43.0; comentariul instantfactoring.com la docker-compose.yml:32. |
| BUG-03 (500 vs 409 race) | **CONFIRMAT** | Fereastra microtask reala (claimDueJobs comite in withMaintenanceRead, inflight.set dupa await, scheduler.ts:178-202,592). Doar directia "manualul pierde" loveste indexul; claimDueJobs are NOT EXISTS pe running (repo:481-485). Fara corupere de stare. |
| BUG-04 (retry hour-gate) | **CONFIRMAT** | Corectie aritmetica: la esec 09:50, primul retry (+5min=09:55) RULEAZA; abia attempt 2 (+15=10:10) e orfan. `retry_exhausted` e atins daca toate 3 incap in ora (esec devreme in ora); "pierdut silent" e usor exagerat — exista audit rows `email.daily_report.failed`. DST: real doar daca operatorul configureaza ora 3 (default 9). |
| BUG-05 (splitter handle leak) | **CONFIRMAT** | rnpmSplitter.ts:356-358; catch-ul 419-431 acopera doar blocul dupa linia 358. Impact practic minim (boot abort). |
| BUG-06 (pagesTotal nevalidat) | **CONFIRMAT** | NU e loop infinit — rnpmPage++ neconditionat la :410; e durata nemarginita (pana la pagesTotal fetch-uri secventiale), oprita de abort la disconnect (throwIfAborted:364). INFLIGHT_TTL_SEARCH_MS=900_000 confirmat (rnpm.ts:190,320). |
| BUG-07 (finishWriteStream unlink) | **PARTIAL — cosmetic** | fs.createWriteStream are autoClose:true => se auto-distruge pe 'error'; claim-ul EPERM Windows e dubios (libuv deschide cu FILE_SHARE_DELETE + POSIX delete pe Win10+). Ramane doar o fereastra de race pe inchiderea fd — worst case un tmp orfan rar. |
| BUG-08 (timer 75s) | **CONFIRMAT** (Low, arguabil Info) | app.quit() la main.js:123 termina procesul indiferent de timere — e igiena, nu hang. |
| BUG-09 (name filter fara fingerprint) | **CONFIRMAT** | dosarSoap are mecanismul (dosarSoap.ts:16,49,91,195), nameSoap nu (payload v2 fara fingerprint). Mitigare omisa de audit: flood-ul cere notify_on_dosar_disappeared activ per job. |
| BUG-10 (manual stale) | **CONFIRMAT** | 3 locatii: manual-content.tsx:727, export-manual.ts:407,470. Codul e MAI STRICT decat docul (refuza persistarea fara safeStorage, sterge legacy). |

**Spot-check-uri pe claim-urile "curate" ale auditului (sectiunea 5 din audit): 3/3 CONFIRMATE** (zero secrete/DB-uri tracked; singurul dangerouslySetInnerHTML e SanitizedHtml.tsx cu DOMPurify strict; jail RNPM regex+hash exact la rnpmDb.ts:20-37). Acoperirea auditului e de incredere.

## 3. Severitati finale propuse (dupa verificare)

- **Medium (2):** SEC-01 (CSRF desktop), SEC-02 (Electron — cu fix imediat ieftin: update patch 41.10.2).
- **Low:** BUG-01 (retrogradat), BUG-02 (retrogradat; decizie de design), SEC-03..SEC-09, BUG-03..BUG-09.
- **Info:** SEC-10..SEC-13, BUG-10.

## 4. DRAFT plan de remediere TDD (de rafinat + validat adversarial in sesiunea noua)

Ordine: blast radius, apoi cost. Fiecare item = intai testul care pica, apoi fix-ul minim, apoi verificare (`npm run check`).

**Sprint 1 — SEC-01 (singurul cu exploit real azi):**
1. Test rosu: request POST cu `Content-Type: text/plain` si body JSON pe `/api/v1/monitoring/jobs` in desktop mode, fara header desktop -> asteapta 403/415; azi trece (job creat).
2. Fix: (a) `requireDesktopHeader` global pe `/api/*` mutating cand `getAuthMode()==="desktop"` (in index.ts), (b) enforce `Content-Type: application/json` in `readLimitedJsonBody` + wrapper peste `c.req.json()` -> 415, (c) defense-in-depth in originGuard: pe loopback, daca Origin e prezent si nu corespunde Host (cu exceptii dev 5173/4173 non-prod), respinge.
3. Teste verzi existente: tot setul de rute desktop (Electron trimite headerul; verifica preload/fetch client ca trimite `Content-Type: application/json` peste tot — altfel fix-ul rupe aplicatia proprie; ATENTIE la SSE/exporturi).

**Sprint 1 — SEC-02:** `npm update electron` (41.10.2) + `npm run rebuild:electron` + smoke `electron:dev`. Fara test nou (dependenta); planifica separat migrarea 43.

**Sprint 2 — quick wins cu teste:**
4. SEC-05/06: teste rosii pe `decodeXmlEntities("&#x110000;")` -> U+FFFD (nu throw) si pe sanitizarea faultstring (control chars + cap 500); fix safeCodePoint + slice/replace in soap.ts.
5. BUG-01: test rosu cu drawTable fortat sa arunce (mock) -> asteapta tmp sters; fix try/catch paritate rnpmExportPdf.
6. SEC-07: test rosu raspuns RNPM > cap -> eroare controlata; fix readResponseTextWithCap + JSON.parse (si arrayBuffer-ul din iccjClient warmSession).
7. BUG-03: test rosu care simuleaza SQLITE_CONSTRAINT_UNIQUE din insertRunning -> asteapta 409 in_flight; fix mapare in catch.
8. BUG-04: test rosu cu clock mock (esec la :50, retry due :10 ora urmatoare) -> asteapta retry rulat; fix gate `&& !dueRetry`.
9. SEC-08/SEC-10/BUG-05/BUG-08/SEC-11: micro-fixuri (sender-check IPC, will-redirect mirror, try/finally splitter, unref timer, placeholder <32 chars); teste unde exista harness (electron greu de testat unit — smoke).
10. BUG-06: test rosu pagesTotal=2^50 cu pagini goale -> clamp la ceil(total/pageSize) sau max 100.

**Sprint 3 — decizii + strategic:**
11. BUG-02: decizie owner (pastreaza design documentat vs recheck pe gcode cu oprire gratioasa). Daca strange: modifica testul existent rnpmStorageRecheck.test.ts:96-119 intentionat.
12. SEC-09: quota count joburi per owner pe infrastructura user_quota_overrides; test rosu la depasire cap.
13. SEC-04: redirect "manual" pe keyValidation + soap; teste cu fetch mock 307.
14. SEC-03: muta preview parsing pe backend (exceljs) SAU documenteaza corect; obligatoriu corecteaza SECURITY.md:204,256 (claim "write-only" fals).
15. SEC-13 + BUG-10: sync versiuni deploy templates + scoate domeniul din comentariu; corecteaza manualul (3 locatii).
16. Electron 43 migration (milestone separat).

## 4b. Rezultat review-panel (FACUT — 4/5 modele: Opus 4.8, GPT-5.6, GLM-5.2, Grok 4.5; Kimi timeout; sinteza manuala)

**Consens pe downgrade-uri:** BUG-01 Medium->Low sustinut (trigger-ul emoji refutat corect), DAR leak-ul rezidual e mai larg decat am spus: throw sincron inainte de doc.end() lasa si un WriteStream deschis fara listener de 'error' (risc de unhandled stream error, nu doar tmp orfan) — fix-ul e "genuinely warranted", nu doar armonizare. BUG-02 Medium->Low sustinut PE DESKTOP, dar conditionat: pe web multi-tenant trebuie tratat ca Medium si DECIS INAINTE de web deploy, nu in Sprint 3. GLM precizeaza: batchSize default pe load-more e 25 (nu 1500), deci depasirea per continuare e ~25 docs; 1500 e doar plafonul per cautare.

**Atac consens pe planul SEC-01 (corectii OBLIGATORII la plan):**
1. `requireDesktopHeader` global FARA exemptie PAT/tokenId rupe toti clientii PAT/CLI (originGuard are exemptia la :63-66, requireDesktopHeader nu) — adauga `if (c.get("tokenId")) next()` si ordinea middleware: ownerContext -> tokenId short-circuit -> desktopHeader -> origin -> CT.
2. **RENUNTA la pasul 2c** (originGuard loopback Origin!=Host): renderer-ul Electron packaged trimite Origin `null`/custom scheme, Vite 5173/4173 difera de Host — riscul cel mai mare de a "brick-ui" propria aplicatie, si redundant: headerul desktop singur inchide exploit-ul (simple request nu poate seta header custom).
3. Content-Type enforcement DOAR in cititorii JSON (readLimitedJsonBody + wrapper c.req.json()), NU blanket pe POST — altfel rupe multipart/upload, sendBeacon, exporturi; accepta `application/json; charset=utf-8`.
4. Livrare in 3 PR-uri separate ordonate: (1) header global cu exemptie PAT + teste matrice pe TOATE rutele mutante (inclusiv /jobs si /jobs/:id/run — vector care ARDE BANI de captcha), (2) CT la cititorii JSON, (3) eventual origin-tightening doar dupa inventarul real de Origin-uri. Feature flag env de rollback (`LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING`-style).
5. De VERIFICAT inainte de orice: `readClientIp` foloseste peer-ul de socket, nu X-Forwarded-For — daca XFF e crezut pe loopback-check, tot originGuard-ul se prabuseste (Opus, uncertain-High). Plus GPT: DNS rebinding ocoleste si headerul daca Host non-loopback e acceptat in desktop mode — respinge Host non-loopback in desktop; ideal secret per-launch injectat in renderer in loc de constanta "1".

**Atac consens pe ordinea sprinturilor:** conflict cu prioritatea WEB DEPLOY — muta in fata: SEC-04 (redirect chei), SEC-07 (cap RNPM), SEC-09 (plafon joburi), decizia BUG-02; SEC-02 (Electron patch) in PR separat de SEC-01 (rebuild nativ ortogonal, sa nu blocheze fix-ul CSRF); Sprint 2 ordonat dupa dauna user: BUG-04 -> SEC-07 -> BUG-03 -> SEC-05/06 -> BUG-06 -> BUG-01 -> micro-fixuri. BUG-06: clamp DOAR la ceil(total/pageSize), fara plafonul arbitrar 100 (ar trunchia cautari legitime).

**Findings NOI de la panel (plauzibile, NEVERIFICATE de noi — de triat in sesiunea de implementare):**
- dailyReportScheduler: backoff-ul de 45 min e cod mort (check-ul exhausted la :187 ruleaza inaintea check-ului de backoff la :213) (GLM); dublare email daca markDailyReportSent esueaza dupa SMTP reusit (GPT :275); render-ul in afara try/catch-ului per-owner — un owner corupt omoara tot tick-ul (GPT :263); truncare silentioasa la 1000 alerte (GPT :221).
- monitoring.ts: DELETE /jobs/:id verifica inflight INAINTE de ownership -> scurgere de existenta cross-owner (409 vs 404) (GPT :293, si bulk la :397); TOCTOU inflight-map vs delete (Grok).
- soap.ts: `text.includes("soap:Fault")` substring naiv — un dosar care contine literal textul devine fals fault (Opus :145); guard-ul envelope fara prefix de namespace (Opus/GPT :262); clamp-ul codepoint trebuie sa acopere si surogatele, nu doar >0x10FFFF (GPT).
- rnpmSearchService: retry-ul pe gcode reclasifica ORICE RnpmError ca expirare captcha -> arde captcha (GPT :229); detailConcurrency<=0 ar bucla infinit daca ajunge nevalidat (GPT :304, uncertain); Grok (uncertain): prima pagina a unei cautari noi persista inainte de primul recheck in-service (acoperit probabil de check-ul de ruta rnpm.ts:243-246 — de confirmat).

## 4c. Rezultat Codex adversarial (FACUT — task-mrpxcgq8-wu6q70, sesiune 019f73b0-e1d8-7c43-b1ce-6207283d848d)

**BUG-01: AGREE cu downgrade-ul la Low** (emoji refutat, stream-error deja curatat; ramane gap-ul throw-inainte-de-doc.end() + fs.stat; testul actual acopera doar succesul).

**BUG-02: DISAGREE cu downgrade-ul — inapoi la MEDIUM.** Contra-scenariu concret verificat pe cod: ruta sare admission check pentru ORICE string `gcode` nenul (rnpm.ts:243-246) si NU leaga `gcode` de `searchId`/parametri/owner (rnpm.ts:279-315) — un owner peste limita trimite o cautare NOUA cu un gcode valid anterior si persista detalii fara nicio verificare; daca gcode-ul e expirat, orice RnpmError declanseaza captcha NOU tot fara recheck (rnpmSearchService.ts:226-244). Cap-ul 1500 e per cautare, batch 200 per request — requesturi repetate raman neplafonate IN TIMP. Fix: leaga continuarea de o stare server-side verificabila (gcode<->searchId<->params<->owner) sau recheck per pagina; testeaza pe RUTA (gcode fara searchId, searchId inexistent, parametri diferiti).

**SEC-01 — corectii decisive (verificate pe cod de Codex):**
- Frontend-ul trimite DEJA headerul desktop pe TOATE requesturile prin `apiFetch` (frontend/src/lib/api.ts:53-59, test api.test.ts:42-75) — deci guard-ul global NU rupe clientul propriu. Electron renderer e incarcat DE PE backend (localhost:3002, main.js:365-406) => same-origin, contrar temerii panelului cu `file://` (premisa stale exista chiar in originGuard.test.ts:142-161).
- EXCEPTIA: `new EventSource("/api/v1/alerts/stream")` NU trece prin apiFetch (useAlertsStream.ts:132-145) — guard-ul trebuie limitat explicit la POST|PUT|PATCH|DELETE (middleware-ul actual nu filtreaza metoda!) sau migrat SSE la fetch-streaming intai.
- Content-Type 415 DOAR pe parserele JSON: altfel rupe importul XLSX `application/octet-stream` (adminApi.ts:476-481 / admin.ts:343-348), upload FormData name-lists (monitoringApi.ts:261-268 / nameLists.ts:130-133) si POST/DELETE/PATCH fara body (backup-create, delete-job, seen/unseen).
- GET-uri cu efecte raman descoperite: GET dosare/termene fac fanout SOAP, GET audit-export construieste XLSX + audit row — guard-ul pe mutatii inchide integritatea, nu si availability (NEW-03 Low).

**Findings NOI Codex (cu file:line, verificate de Codex pe cod):**
- NEW-01 (Medium) = escaladarea BUG-02 de mai sus.
- NEW-02 (Medium conditionat de topologie): in web mode dupa un reverse proxy pe loopback, daca `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` lipseste, `readClientIp` intoarce peer-ul loopback si originGuard face bypass TOTAL (proxyIp.ts:30-54; configuratia doar warning, nu boot failure, index.ts:657-669); parserul nici nu accepta `::1/128` ca trusted proxy IPv6 (proxyIp.ts:61-72). Critic pentru prioritatea WEB DEPLOY.
- NEW-04 (Low): clamp-ul propus la decodeXmlEntities trebuie sa respecte productia XML 1.0 Char (exclude si surogatele, NUL, controalele interzise), nu doar >0x10FFFF.
- NEW-05 (Info): sleep-ul de retry 1500ms din rnpmClient nu observa signal-ul compus cu timeout.
- Monitoring: `PUT /master-switch` fara header guard (non-simple, deci nu CSRF clasic, dar de inclus in regresia guard-ului).
- Cap-ul RNPM trebuie sa acopere si `res.text()` pe cai de eroare, nu doar `res.json()`.

## 4d. PLAN DE REMEDIERE FINAL (post-adversarial, inlocuieste draftul din §4)

Fiecare pas = test rosu intai, fix minim, `npm run check` verde. PR-uri mici, izolate.

**STATUS DECIZII USER (2026-07-19):** APROBATE de rezolvat: PR-1, PR-2, PR-5, PR-6, PR-8 (BUG-04 primul), PR-9, PR-10. ELIMINATE ca risc asumat: PR-4 (portita stocare gcode), PR-7 (plafon joburi) — vezi pragurile de redeschidere la fiecare. AMANAT: PR-3 (Content-Type). Milestone separat: Electron 43.

**PR-1 (SEC-01 pasul 1, inchide exploit-ul):** `requireDesktopHeader` global pe `/api/*` DOAR pe metodele POST|PUT|PATCH|DELETE, cu exemptie `tokenId` (PAT) si ordine middleware ownerContext -> header. Teste rosii: text/plain POST pe /jobs si /jobs/:id/run fara header -> 403 cu cod dedicat; teste verzi: PUT/PATCH/DELETE cu header, GET /alerts/stream FARA header trece, PAT fara header trece. Env flag de rollback.
**PR-2 (SEC-02a):** `npm update electron` (41.10.2) + rebuild + smoke — PR separat, ortogonal.
**PR-3 (SEC-01 pasul 2, defense-in-depth) — AMANAT (triaj 2026-07-19):** cel mai mare risc de regresie din plan (importuri XLSX/FormData/bodyless) si aproape redundant dupa PR-1. Daca se reia: 415 DOAR pe parserele JSON (readLimitedJsonBody + wrapper c.req.json()), cu `application/json;charset=utf-8` acceptat; teste separate pentru bodyless/multipart/octet-stream ca raman functionale.
**PR-4 (BUG-02/NEW-01) — ELIMINAT DIN PLAN, RISC ACCEPTAT (decizie user, 2026-07-19).** Rationament: exploatarea cere utilizator autentificat + intentie + pricepere tehnica (replay manual de gcode); pe web intern cu utilizatori de incredere probabilitatea e neglijabila; depasirea accidentala e mica si auto-limitata (cautare noua re-declanseaza check-ul); consumul e vizibil in pagina de admin per user; actiunile sunt auditate. **Prag de redeschidere:** daca varianta web primeste vreodata conturi pentru persoane din AFARA organizatiei (clienti, colaboratori), acest item revine automat in plan ca Medium (fix: leaga gcode de searchId/params/owner server-side sau recheck per pagina + la retry captcha; teste de ruta: gcode fara searchId, searchId strain, parametri diferiti, owner peste limita). De adaugat o nota scurta de risc acceptat in SECURITY.md la implementarea pachetului pre-web.
**PR-5 (NEW-02, pre-web):** trusted proxy fail-closed cand auth_mode=web si bind remote (eroare la boot, nu warning) + suport `::1/128`; teste parser CIDR IPv6 + originGuard cu XFF.
**PR-6 (SEC-04 + SEC-07, pre-web):** `redirect:"manual"` pe keyValidation + soap (teste 307/308 cross-origin); cap de dimensiune in rnpmClient pe json+text (matrice success/error search/detail/history) + arrayBuffer iccj warmSession.
**PR-7 (SEC-09) — ELIMINAT DIN PLAN, RISC ACCEPTAT (decizie user, 2026-07-19):** NU se pune nicio limita la numarul de joburi de monitorizare per owner (nici macar siguranta fixa). Rationament: utilizatori interni de incredere, autentificati si auditati; mitigari existente raman active (cadence minima 600s, claim 50/tick, rate limit 120/min, dedup pe target_hash). **Prag de redeschidere:** conturi pentru persoane din afara organizatiei SAU semne reale de infometare a scheduler-ului (alerte intarziate din cauza volumului unui singur owner). De adaugat nota de risc acceptat in SECURITY.md la pachetul pre-web, alaturi de BUG-02.
**PR-8 (corectitudine):** BUG-04 **CONFIRMAT DE REZOLVAT (decizie user, 2026-07-19) — primul din acest PR** (hour-gate cu dueRetry, clock mock; spec exacta: in todayLocal, daca nowMs>=nextAttemptAt ruleaza si in afara orei; la implementare triaza si findings-urile GPT/GLM pe scheduler — 45min dead code, dublare email la markDailyReportSent esuat, render in afara try/catch per-owner), apoi BUG-03 (mapare SQLITE_CONSTRAINT_UNIQUE -> 409), BUG-06 (clamp pagesTotal la ceil(total/pageSize), FARA plafon arbitrar 100), SEC-05/06 (sanitizare faultstring + validator XML Char production per NEW-04).
**PR-9 (igiena marunta):** BUG-01 (try/catch paritate, teste throw-pre-end + stat reject), SEC-08 (sender-check IPC), SEC-10 (will-redirect), BUG-05 (try/finally splitter), BUG-08 (unref), SEC-11 (placeholder <32).
**PR-10 (docs + deploy):** SEC-13 (sync versiuni, scoate domeniul), BUG-10 (manual 3 locatii), SEC-03 (corecteaza SECURITY.md "write-only" + decide mutarea parsarii pe backend), SEC-12 (urmarire uuid la upgrade exceljs).
**Milestone separat:** Electron 43; triaj findings noi panel (DELETE inflight-vs-ownership info leak, soap:Fault substring, envelope namespace guard, gcode retry burning captcha).

## 5. Pasii ramasi pentru sesiunea noua (in ordine)

**Toate etapele de analiza sunt INCHISE** (verificare cod + Codex + review-panel + prezentare non-tehnica + triaj decizii user). Ce ramane e strict IMPLEMENTAREA, pe branch nou (nimic pe main — conform memoriei `gitlab-workflow-branches`):

1. Deschide branch nou din `feat/v2.43.0-rnpm-split` pentru remediere.
2. Executa pachetele APROBATE in ordine, fiecare ca PR separat, TDD (test rosu -> fix minim -> `npm run check` verde): **PR-1, PR-2** (acum) -> **PR-5, PR-6** + note risc acceptat in SECURITY.md (pre-web) -> **PR-8** (BUG-04 primul), **PR-9, PR-10** (fara graba).
3. NU implementa: PR-4 si PR-7 (risc acceptat — vezi §4d pentru pragurile de redeschidere), PR-3 (amanat). Electron 43 = milestone separat.
4. Biome + typecheck + build + teste inainte de fiecare push (workflow obligatoriu din CLAUDE.md).

## 6. Context operational

- Branch curent: `feat/v2.43.0-rnpm-split` (HEAD c86d43d la momentul sesiunii). Auditul original: `AUDIT-SEC-CORECTITUDINE-v2.43.0-2026-07-18.md` (root, untracked).
- Verificarea a rulat pe workingul curent, zero modificari de fisiere (in afara acestui handoff).
- Prioritate proiect: WEB DEPLOY intai (vezi memory `prioritate-web-deploy`) — SEC-01 e specific desktop, dar fix-ul de Content-Type ajuta si web; BUG-02/SEC-09 devin mai importante pe web multi-tenant.
