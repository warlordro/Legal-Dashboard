# Audit complet Legal Dashboard v2.43.0

**Data:** 2026-07-11  
**Branch auditat:** `feat/v2.43.0-rnpm-split`  
**HEAD:** `a9630b9`  
**Mod:** read-only asupra codului; acest document este singurul artefact creat  
**Verdict:** **DO NOT SHIP**

## 1. Rezumat executiv

Auditul a acoperit securitate, autentificare/autorizare, izolare per owner, API-uri, fluxuri Electron si web, backup/restore RNPM, concurenta si shutdown, stari asincrone, accesibilitate WCAG 2.2 AA, responsive behavior si consistenta UI/copy.

Au fost confirmate:

| Severitate | Numar |
|---|---:|
| Critical | 0 |
| High | 3 |
| Medium | 22 |
| Low | 7 |
| Total | 32 |

Cele trei blocante de release sunt:

1. shutdown-ul poate elibera instance lock-ul in timp ce un restore/compact/backup continua;
2. backup-ul zilnic poate raporta succes pentru monolit, omitand silentios toate bazele RNPM;
3. dialogul comun de confirmare executa actiunea destructiva la `Enter` chiar daca focusul este pe `Anuleaza`.

Primele doua pot compromite exclusivitatea procesului si capacitatea reala de recovery. Al treilea poate transforma o intentie explicita de anulare intr-o restaurare sau stergere de date.

## 2. Scope si metoda

### Fluxuri trasate end-to-end

- Electron renderer -> `apiFetch` -> Hono middleware -> route -> repository -> SQLite;
- web browser -> oauth2-proxy bridge -> JWT cookie/PAT -> owner/role guards -> owner-scoped repositories;
- RNPM search/filter/export -> fisier SQLite per user;
- RNPM split one-time -> preflight -> copie per owner -> marker -> wipe monolit;
- backup/restore/compact -> maintenance lock -> snapshot worker -> staging/swap -> audit;
- monitoring scheduler -> upstream SOAP/ICCJ -> snapshot/diff -> alerte/SSE/email;
- UI destructive actions -> dialog -> async request -> refresh/state feedback;
- tastatura, screen reader, zoom/reflow si stari dinamice pentru fluxurile principale.

### Dovezi si verificari

- documente citite: `CLAUDE.md`, `SESSION-HANDOFF.md`, `EXECUTION-ROADMAP.md`, spec-urile si planurile v2.43.0;
- diff analizat fata de `main`: 185 fisiere, aproximativ 23k linii adaugate;
- typecheck backend si frontend: **PASS** (`npm run typecheck`);
- analiza statica si trasare manuala pe codul curent;
- review-uri independente Warden, Prism, Vigil si Proof, consolidate si deduplicate aici.

### Limitari

- suita completa nu a putut fi rulata: mediul a blocat noi executii dupa atingerea limitei de aprobare;
- `npm audit` nu a fost rulat deoarece ar fi transmis metadatele dependency tree catre serviciul extern npm, actiune refuzata de mediu;
- nu s-a facut smoke Electron, smoke web cu doi useri, screen-reader real sau test vizual pe dispozitive;
- concluziile `Confirmed` provin din cai deterministe de cod; `High Confidence` indica o conditie de runtime/infrastructura ce trebuie reprodusa controlat.

## 3. Findings High

### H-01 — Instance lock eliberat inainte de terminarea writerilor de mentenanta

- **Severity:** High
- **Category:** Race Condition / Reliability
- **Location:** `backend/src/db/backup.ts:73-90,1255-1265`; `backend/src/util/snapshotRunner.ts:20-23,107-126`; `backend/src/index.ts:952-982`
- **Issue:** shutdown-ul asteapta writerii maximum 30 secunde, apoi continua sa inchida DB-urile si sa elibereze instance lock-ul. Operatia aflata in curs nu este anulata de acel timeout, iar writerii deja admisi nu reverifica starea de shutdown dupa dobandirea lock-ului.
- **Impact:** o a doua instanta poate porni pe acelasi `dataDir` in timp ce prima inca finalizeaza ori abandoneaza restore/compact/backup. Sunt posibile lost writes, swap-uri concurente, fisiere temporare ramase si corupere SQLite.
- **Evidence:** `waitForBackupToSettle()` foloseste un timeout care doar incheie asteptarea; workerul poate rula pana la 10 minute. `gracefulShutdown()` executa ulterior cleanup si `releaseInstanceLock()` neconditionat.
- **Reproduction:** injecteaza un worker care dureaza peste 30s, porneste restore/compact, declanseaza shutdown si verifica disparitia `.instance.lock` inainte ca promisiunea writerului sa se termine; apoi porneste o a doua instanta pe acelasi director.
- **Recommended fix:** nu inchide DB-urile si nu elibera instance lock-ul cat timp exista writeri. Fie anuleaza operatia si asteapta confirmarea reala a terminarii workerului, fie refuza quit-ul pana la settle complet. Reverifica latch-ul de shutdown imediat dupa `acquireWrite()`.
- **Confidence:** High Confidence

### H-02 — Backup-ul zilnic poate omite silentios toate bazele RNPM

- **Severity:** High
- **Category:** Reliability
- **Location:** `backend/src/db/backup.ts:1309-1327`
- **Issue:** orice eroare la enumerarea directorului RNPM este inghitita si tratata identic cu `ENOENT`.
- **Impact:** monolitul poate fi salvat si run-ul poate parea reusit, desi recovery set-ul nu contine nicio baza RNPM per-user. Defectul poate fi descoperit abia dupa pierderea datelor.
- **Evidence:** catch-ul din enumerare nu verifica `errno`, nu logheaza si nu marcheaza rezultatul `partial`/`failed`.
- **Reproduction:** refuza dreptul de listare pe `<dataDir>/rnpm`, pastrand accesul la monolit si `backups/`, apoi ruleaza daily backup. Se creeaza numai copia monolitului fara eroare RNPM explicita.
- **Recommended fix:** tolereaza exclusiv `ENOENT`. Pentru `EACCES`, `EIO`, ACL/storage failures emite `daily_backup_failed` cu stage `enumerate_rnpm` si returneaza rezultat agregat `failed` sau explicit `partial`.
- **Confidence:** Confirmed

### H-03 — `Enter` confirma actiunea destructiva chiar pe butonul `Anuleaza`

- **Severity:** High
- **Category:** Accessibility
- **Location:** `frontend/src/components/ui/confirm-dialog.tsx:45-59,91-100`; consumatori in `frontend/src/components/rnpm/RnpmSavedStats.tsx:166-220`, `frontend/src/components/rnpm/RnpmRestoreModal.tsx:46-55`, `frontend/src/pages/admin/Backups.tsx:65-99`
- **Issue:** handlerul global de tastatura apeleaza neconditionat `close(true)` la `Enter`, indiferent de elementul focalizat.
- **Impact:** un utilizator de tastatura poate focaliza explicit `Anuleaza`, dar `Enter` declanseaza restaurarea sau stergerea bazei/backup-urilor.
- **Evidence:** activarea nativa a butonului focalizat este suprascrisa de listenerul global de pe `window`.
- **Reproduction:** deschide `Sterge backup`, muta focusul pe `Anuleaza` cu `Shift+Tab`, apoi apasa `Enter`; promisiunea se rezolva `true`.
- **Recommended fix:** elimina confirmarea globala pe `Enter`; lasa butonul focalizat sa gestioneze activarea nativa. Pentru destructive flows focalizeaza implicit `Anuleaza` si testeaza `Tab`, `Shift+Tab`, `Enter`, `Escape`.
- **Confidence:** Confirmed

## 4. Findings Medium

### M-01 — `DELETE /saved/all` nu este atomic fata de search/compact

- **Severity:** Medium
- **Category:** Race Condition
- **Location:** `backend/src/routes/rnpm.ts:861-888`; `backend/src/db/backup.ts:989-1048`
- **Issue:** verificarea pentru search activ si stergerea se executa inainte de maintenance lock si owner latch; doar compactarea ulterioara este protejata.
- **Impact:** delete-ul poate reusi, compactarea poate astepta, iar o cautare noua poate repopula baza. Ruta poate raspunde 200 cu randuri sterse desi baza nu ramane goala.
- **Evidence:** `deleteAllAvize()` ruleaza inainte ca `beginRnpmRestore()` sa fie activat in callback-ul compactarii.
- **Reproduction:** tine maintenance write lock, porneste `DELETE /saved/all`, incepe o cautare pentru acelasi owner, apoi elibereaza lock-ul.
- **Recommended fix:** muta delete + compact intr-o singura operatie DB-layer, sub acelasi write lock si cu latch owner activ inaintea primei mutatii.
- **Confidence:** Confirmed

### M-02 — Preflight-ul de disk pentru split subestimeaza duplicarea descrierilor

- **Severity:** Medium
- **Category:** Reliability
- **Location:** `backend/src/db/rnpmSplitter.ts:163-190,334-339,348-416`
- **Issue:** preflight-ul cere de trei ori dimensiunea monolitului, dar descrierile partajate sunt copiate in fiecare DB per-owner.
- **Impact:** split-ul poate trece preflight-ul si esua ulterior cu `ENOSPC`, lasand aplicatia in boot-loop pana la interventia operatorului. Monolitul ramane sursa de adevar, dar serviciul este indisponibil.
- **Evidence:** calculul foloseste marimea monolitului, in timp ce copy path-ul multiplica aceleasi descrieri pentru fiecare owner.
- **Reproduction:** creeaza mai multi owneri care refera aceeasi descriere mare si lasa spatiu intre `3 x monolit` si necesarul real backup + suma DB-urilor per-user.
- **Recommended fix:** estimeaza logic per owner, incluzand descrierile duplicate, staging si WAL, sau construieste un dry-run masurabil inainte de publish.
- **Confidence:** High Confidence

### M-03 — Restore fara idempotency durabila

- **Severity:** Medium
- **Category:** Race Condition / Reliability
- **Location:** `backend/src/routes/rnpm.ts:1078-1117`; `backend/src/routes/adminBackups.ts:65-97`; `backend/src/db/backup.ts:479-497,716-722`
- **Issue:** requesturile de restore nu accepta `clientRequestId` si nu pastreaza rezultatul mutatiei finalizate.
- **Impact:** pierderea raspunsului dupa rename-ul atomic determina retry. Fiecare retry creeaza alt snapshot pre-restore si poate elimina prin retentie snapshot-ul starii originale.
- **Evidence:** nu exista ledger de operatii sau replay al rezultatului pentru restore.
- **Reproduction:** intrerupe conexiunea dupa commit, inainte de raspuns, apoi repeta requestul de peste cinci ori.
- **Recommended fix:** ledger persistent `(owner, operation, clientRequestId)` cu `running/completed/failed`; UI-ul genereaza UUID o singura data per intentie si serverul replay-uieste rezultatul.
- **Confidence:** Confirmed

### M-04 — Restore-urile esuate acumuleaza snapshot-uri pre-restore

- **Severity:** Medium
- **Category:** Reliability
- **Location:** `backend/src/db/backup.ts:479-497,499-564,716-720`
- **Issue:** snapshot-ul live este creat inaintea validarii staged, dar prune-ul ruleaza numai dupa succes.
- **Impact:** retry-uri pe un backup invalid sau pe o eroare persistenta creeaza fisiere noi pana la epuizarea discului.
- **Evidence:** failure paths dupa staged validation nu aplica retentia pool-ului pre-restore.
- **Reproduction:** foloseste un DB integru cu ledger/hash de migratie alterat; fiecare incercare creeaza snapshot si esueaza la validare.
- **Recommended fix:** aplica prune si pe failure paths dupa crearea snapshotului; logheaza distinct esecul de prune.
- **Confidence:** Confirmed

### M-05 — UI-ul permite mutatii RNPM conflictuale in paralel

- **Severity:** Medium
- **Category:** Race Condition
- **Location:** `frontend/src/components/rnpm/RnpmSavedStats.tsx:150-182,331-364`; `backend/src/db/backup.ts:1228-1242`
- **Issue:** create, delete, compact si restore folosesc busy flags separate; delete-backups nu are guard comun. Create ramane pending pe durata hook-ului offsite dupa eliberarea lock-ului local.
- **Impact:** utilizatorul poate sterge backup-ul nou in timp ce uploadul offsite continua, apoi UI raporteaza `Backup creat` pentru un recovery point local inexistent.
- **Evidence:** actiunile incompatibile raman active simultan, iar hook-ul offsite este in afara maintenance lock-ului.
- **Reproduction:** configureaza hook offsite lent, apasa `Creeaza backup`, apoi `Sterge backup` si confirma.
- **Recommended fix:** un singur `busyOperation` pentru toate mutatiile; backend-ul separa starea snapshotului local de copia offsite.
- **Confidence:** Confirmed

### M-06 — CSRF localhost pe doua POST-uri desktop fara body

- **Severity:** Medium
- **Category:** Security
- **Location:** `backend/src/middleware/originGuard.ts:41-55`; `backend/src/middleware/requireDesktopHeader.ts:1-28`; `backend/src/routes/monitoring.ts:457-510`; `backend/src/routes/me.ts:301-350`
- **Issue:** `originGuard` permite orice peer loopback, iar `POST /monitoring/jobs/:id/run` si `POST /me/email-settings/test` nu cer headerul desktop custom.
- **Impact:** o pagina ostila deschisa pe aceeasi masina poate forta rularea unui job si trimiterea unui email de test. CORS/SOP blocheaza citirea raspunsului, nu simple POST-ul.
- **Evidence:** cele doua endpoint-uri nu parseaza body JSON si nu folosesc `requireDesktopHeader`; desktop auth atribuie automat userul `local`.
- **Reproduction:** dintr-o pagina externa ruleaza `fetch('http://127.0.0.1:3002/api/v1/monitoring/jobs/1/run',{method:'POST',mode:'no-cors'})`.
- **Recommended fix:** aplica centralizat headerul desktop tuturor metodelor nesigure/body-less, cu exceptii explicite si test de inventariere a rutelor.
- **Confidence:** Confirmed

### M-07 — Query-urile juridice ajung integral in loguri

- **Severity:** Medium
- **Category:** Security
- **Location:** `backend/src/index.ts:95`; `backend/src/routes/dosare.ts:101`; `backend/src/routes/termene.ts:107`; `backend/src/routes/dosareIccj.ts:89`; `backend/src/routes/rnpm.ts:825-849`
- **Issue:** loggerul Hono primeste URL-ul complet, inclusiv query-string cu nume, numere de dosar, obiect si filtre.
- **Impact:** date juridice si criterii de cautare raman in stdout, loguri Electron/Docker si colectoare centralizate cu acces/retentie mai larga decat DB-ul aplicatiei.
- **Evidence:** `app.use('*', logger())` este global, iar rutele citesc direct `c.req.query()`.
- **Reproduction:** apeleaza `/api/dosare?numeParte=NUME-SENSIBIL&numarDosar=1234/1/2026` si inspecteaza consola.
- **Recommended fix:** logger custom care scrie numai pathname, status, durata si requestId; redacteaza/haseaza metadatele permise. Considera POST body pentru cautari cu PII daca si proxy-ul logheaza query-uri.
- **Confidence:** Confirmed

### M-08 — Erorile SMTP sunt logate brut inainte de sanitizare

- **Severity:** Medium
- **Category:** Security
- **Location:** `backend/src/services/email/mailer.ts:171-189,195-215,218-234`; sanitizare existenta in `backend/src/util/auditSanitize.ts:63-73`
- **Issue:** `console.error` primeste obiectul complet Nodemailer, in timp ce numai audit trail-ul foloseste sanitizare.
- **Impact:** raspunsuri SMTP, recipienti, hostname-uri si detalii de infrastructura pot ajunge in loguri Electron/server. Continutul exact depinde de provider si tipul erorii.
- **Evidence:** cele trei catch-uri logheaza `err` brut; helperul `sanitizeSmtpError()` nu este folosit la console logging.
- **Reproduction:** configureaza un recipient respins sau credentiale SMTP invalide, trimite un test si inspecteaza stdout.
- **Recommended fix:** logheaza exclusiv rezultatul `sanitizeSmtpError(err)` si request/owner identifiers ne-PII; nu loga obiectul original.
- **Confidence:** High Confidence

### M-09 — Retentia audit/AI depinde de schedulerul de monitoring

- **Severity:** Medium
- **Category:** Reliability / Performance
- **Location:** `backend/src/index.ts:433-438`; `backend/src/services/monitoring/scheduler.ts:49-59,419-439`; `backend/src/db/auditRepository.ts:315-324`
- **Issue:** purge-ul de 90 zile este executat de scheduler. Cand `MONITORING_ENABLED=0`, rutele si AI pot continua sa scrie, dar retentia nu mai ruleaza.
- **Impact:** `audit_log` si `ai_usage` cresc nelimitat, consumand disk si degradand performanta SQLite exact in configuratia operationala care dezactiveaza monitoringul.
- **Evidence:** schedulerul nu este creat cand flagul este off; nu exista timer independent pentru aceste doua purges, desi exista pentru reservations/JWT.
- **Reproduction:** ruleaza cu `MONITORING_ENABLED=0`, genereaza mutatii/AI si avanseaza peste fereastra de retentie; randurile vechi raman.
- **Recommended fix:** muta retention workers intr-un serviciu operational independent de feature flags sau adauga timere dedicate, cu health/log pentru ultimul purge reusit.
- **Confidence:** Confirmed

### M-10 — Salvarea cheilor poate parea reusita desi persistenta a esuat

- **Severity:** Medium
- **Category:** Reliability
- **Location:** `frontend/src/hooks/useApiKey.ts:151-180,229`; `frontend/src/components/ApiKeyDialog.tsx:24-39,73-81,167-168`
- **Issue:** state-ul in-memory este actualizat inainte de encrypt/localStorage; erorile sunt inghitite ori seteaza `encryptionUnavailable`, dar dialogul nu consuma si nu afiseaza acel flag.
- **Impact:** cheia apare `Activa` in sesiunea curenta, insa dispare la restart fara mesaj de esec. Userul poate crede ca AI/captcha este configurat si poate pierde timp/cost pe retries.
- **Evidence:** `setKeysState(trimmed)` precede persistenta asincrona; prop contractul dialogului exclude `encryptionUnavailable`.
- **Reproduction:** forteaza esecul safeStorage sau quota error la localStorage, salveaza cheia si reporneste aplicatia.
- **Recommended fix:** persistenta sa returneze rezultat; marcheaza succesul UI numai dupa scriere confirmata, afiseaza eroare persistenta si pastreaza inputul pentru retry.
- **Confidence:** Confirmed

### M-11 — Manualul descrie gresit custodia cheilor in web mode

- **Severity:** Medium
- **Category:** Visual Consistency
- **Location:** `frontend/src/pages/manual-content.tsx:392,619,726-728`; `frontend/src/lib/export-manual.ts:407,470`; comportament actual in `frontend/src/hooks/useApiKey.ts:104-113` si `frontend/src/components/ApiKeyDialog.tsx:66-70,120-130,167-168`
- **Issue:** manualul afirma ca web-ul pastreaza/obfuscheaza cheile in localStorage si ca cheia captcha nu este stocata pe server. Codul actual sterge legacy storage fara keystore, ascunde BYOK in web si foloseste chei tenant criptate server-side.
- **Impact:** utilizatorii si operatorii primesc instructiuni de securitate false si pot lua decizii gresite despre backup, master key, browser storage si responsabilitatea adminului.
- **Evidence:** copy-ul user-facing contrazice direct gate-ul web si panoul de tenant keys.
- **Reproduction:** deschide Manual/Securitate sau exporta manualul in web mode si compara textul cu dialogul `Configurare chei API`.
- **Recommended fix:** actualizeaza simultan manualul UI si exportul: desktop = safeStorage + ciphertext local; web = `tenant_api_keys` criptat cu master key, fara BYOK in browser.
- **Confidence:** Confirmed

### M-12 — Modalele RNPM nu izoleaza focusul si se inchid in cascada

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `frontend/src/components/rnpm/RnpmSavedStats.tsx:108-116,235-261,387-398`; `frontend/src/components/rnpm/RnpmRestoreModal.tsx:38-44,70-95`
- **Issue:** lipsesc `role=dialog`, `aria-modal`, nume accesibil, focus trap/restoration. Ambele asculta `Escape` global.
- **Impact:** screen reader-ul nu primeste context modal, focusul ajunge in fundal, iar `Escape` in modalul copil inchide intregul stack.
- **Evidence:** componentele nu folosesc primitiva `useDialog`; listener-ele independente primesc acelasi eveniment.
- **Reproduction:** deschide `Baza mea RNPM -> Restaurare`, apoi apasa `Escape`.
- **Recommended fix:** primitiva Dialog unica, stack-aware, cu focus trap/restoration si un singur handler pentru modalul topmost.
- **Confidence:** Confirmed

### M-13 — Shell-ul nu face reflow la 320px/400% zoom

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `frontend/src/App.tsx:149-175`; `frontend/src/components/Sidebar.tsx:69,153-157`; `frontend/src/pages/admin/Backups.tsx:115-137,193-197`
- **Issue:** sidebar fix `w-60`, root `h-screen overflow-hidden`, fara drawer/collapse responsive; actiunile Backup nu fac wrap.
- **Impact:** la 320 CSS px sau zoom 400%, continutul principal ramane cu aproximativ 80px si devine clipuit, contrar WCAG 1.4.10.
- **Reproduction:** deschide web la 320px/400% si navigheaza la Setari -> Backup.
- **Recommended fix:** drawer/collapse sub breakpoint, `min-w-0` pe main, padding si action bars responsive; teste 320/375/768px si 200-400% zoom.
- **Confidence:** High Confidence

### M-14 — Modalele de backup pot depasi viewport-ul fara scroll

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `frontend/src/components/rnpm/RnpmRestoreModal.tsx:72-79,96-141`; `frontend/src/components/rnpm/RnpmSavedStats.tsx:237-247,264-385`
- **Issue:** lipsesc max-height raportat la viewport si container vertical scrollabil.
- **Impact:** la zoom/text mare/viewport scund sau multe backup-uri, close/action/list items ies din viewport.
- **Reproduction:** zoom 200-400% cu o lista lunga de backup-uri.
- **Recommended fix:** `max-h-[calc(100dvh-2rem)] overflow-y-auto`, header/actions sticky si zona de lista scrollabila.
- **Confidence:** High Confidence

### M-15 — Taburile Setari nu implementeaza patternul ARIA complet

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `frontend/src/pages/Settings.tsx:80-160`; exemplu corect in `frontend/src/components/monitoring/JobKindTabs.tsx:24-76`
- **Issue:** exista `tablist/tab`, dar lipsesc roving tabindex, ArrowLeft/Right, Home/End, `aria-controls` si `tabpanel`.
- **Impact:** navigarea cu tastatura este lenta, iar relatia tab-panou nu este anuntata corect.
- **Reproduction:** focalizeaza `General` si apasa ArrowRight.
- **Recommended fix:** generalizeaza/reutilizeaza `JobKindTabs` si adauga ID-uri/panouri corelate.
- **Confidence:** Confirmed

### M-16 — Selectul custom nu anunta optiunea activa

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `frontend/src/components/ui/select.tsx:79-107,227-267,281-313`; consumatori in Audit, Alerts si Users
- **Issue:** focusul ramane pe listbox, dar lipsesc ID-uri de optiune si `aria-activedescendant`; multe trigger-e nu au eticheta.
- **Impact:** screen reader-ul nu anunta fiabil optiunea navigata sau scopul controlului.
- **Reproduction:** deschide filtrul cu screen reader si foloseste sagetile.
- **Recommended fix:** ID stabil per optiune, `aria-activedescendant`, label obligatoriu sau o primitiva accesibila matura.
- **Confidence:** Confirmed

### M-17 — Filtre si paginare fara etichete persistente

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `frontend/src/pages/admin/Audit.tsx:242-320`; `frontend/src/pages/Alerts.tsx:483-537`; `frontend/src/pages/admin/Users.tsx:330-355`; `frontend/src/components/table-pagination.tsx:110-123`
- **Issue:** scopul controalelor este comunicat prin placeholder/title/text sibling, nu prin label asociat.
- **Impact:** dupa introducerea valorii, scopul dispare; screen reader-ul nu poate identifica sigur campul.
- **Reproduction:** completeaza filtrele Audit si navigheaza forms mode.
- **Recommended fix:** label vizibil `htmlFor/id`; cel putin `aria-label` cand layout-ul nu permite.
- **Confidence:** Confirmed

### M-18 — Checkbox-uri si randuri expandabile fara semantica contextuala

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `frontend/src/components/rnpm/RnpmResultsTable.tsx:406-413,492-520`; `RnpmSavedData.tsx:403-413,467-493`; `TermeneTable.tsx:240-246,274-289`
- **Issue:** checkbox-urile nu includ identificatorul randului; randurile focusabile/expandabile nu au control semantic, `aria-expanded` sau `aria-controls`.
- **Impact:** screen reader-ul anunta selectii anonime si nu comunica starea expandata.
- **Reproduction:** navigheaza tabelele in forms mode.
- **Recommended fix:** aria-label contextual per checkbox si buton dedicat pentru expandare, cu `aria-expanded/controls`.
- **Confidence:** Confirmed

### M-19 — Progresul si erorile dinamice nu sunt anuntate

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `RnpmSearchForm.tsx:735-739`; `RnpmSearch.tsx:569-584`; `RnpmBulkSearch.tsx:451-485`; `RnpmRestoreModal.tsx:97-107`; `pages/admin/Backups.tsx:144-157`
- **Issue:** loading/progress/success/error apar vizual fara live region si fara `aria-busy`.
- **Impact:** utilizatorii screen reader nu afla ca operatia a inceput, s-a terminat sau necesita retry.
- **Reproduction:** porneste bulk RNPM sau restore cu screen reader.
- **Recommended fix:** `role=status aria-live=polite`, `role=alert` pentru erori si `aria-busy` pe suprafata afectata.
- **Confidence:** Confirmed

### M-20 — Touch targets sub minim si focus vizibil inconsistent

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `frontend/src/components/sidebar-footer.tsx:44-78`; icon buttons in `frontend/src/components/Sidebar.tsx:243-250,295-302,373-383,413-423`
- **Issue:** selectorii de font sunt 6x6px, iar unele butoane icon-only au 16-22px si fara focus ring explicit.
- **Impact:** incalca WCAG 2.5.8 si face controlul dificil pentru touch/mobilitate redusa/tastatura.
- **Reproduction:** masoara hit area si navigheaza cu Tab.
- **Recommended fix:** minimum 24x24px, preferabil 40-44px pentru touch, plus `focus-visible:ring-2`.
- **Confidence:** Confirmed

### M-21 — Toasturile expira fara pauza la hover/focus

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `frontend/src/components/ui/toast.tsx:77-92,109-133`
- **Issue:** feedbackul dispare dupa 4/7 secunde fara pause/resume sau mod persistent.
- **Impact:** utilizatorii cu input lent, screen reader sau dificultati cognitive pot pierde singurul rezultat al operatiei; risc WCAG 2.2.1.
- **Reproduction:** focalizeaza close sau tine pointerul pe toast; timerul continua.
- **Recommended fix:** pause la hover/focus; erori persistente pana la dismiss sau duplicate intr-o zona durabila.
- **Confidence:** Confirmed

### M-22 — Contrast insuficient pentru warning text

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `frontend/src/components/rnpm/RnpmResultsTable.tsx:376-379`; `frontend/src/components/rnpm/RnpmBulkSearch.tsx:391-394`
- **Issue:** `text-amber-600` mic pe fundal light are aproximativ 3.05:1, sub 4.5:1.
- **Impact:** warningurile sunt greu de citit pentru low vision si esueaza WCAG 1.4.3.
- **Reproduction:** tema light, verifica `#d97706` pe fundalul aplicatiei.
- **Recommended fix:** amber-700/800 in light sau token semantic verificat in ambele teme.
- **Confidence:** Confirmed

## 5. Findings Low

### L-01 — Erorile de listare backup sunt prezentate ca empty state

- **Severity:** Low
- **Category:** Reliability
- **Location:** `backend/src/db/backup.ts:235-241`
- **Issue:** orice eroare filesystem devine `[]`.
- **Impact:** ACL/I/O/storage failure este afisat ca `Nu exista backup-uri`, mascand o problema operationala.
- **Evidence/Reproduction:** refuza permisiunea de listare pe backup jail si deschide modalul.
- **Recommended fix:** `[]` exclusiv pentru `ENOENT`; propaga restul cu cod tipat si path redacted.
- **Confidence:** Confirmed

### L-02 — Fetch-uri si timeout-uri UI fara cleanup/generation guard

- **Severity:** Low
- **Category:** Race Condition / Reliability
- **Location:** `RnpmSavedStats.tsx:81-106,118-127`; `RnpmRestoreModal.tsx:22-36,46-67`; `pages/admin/Backups.tsx:33-47`
- **Issue:** load-urile nu folosesc AbortController/sequence token; timeout-urile nu sunt curatate la unmount.
- **Impact:** raspunsuri vechi pot suprascrie refresh-ul post-mutation, iar callbackuri pot rula dupa inchiderea modalului.
- **Reproduction:** intarzie primul GET, finalizeaza o mutatie si livreaza vechiul raspuns ultimul.
- **Recommended fix:** AbortController per effect, generation counter si cleanup la toate timeout-urile.
- **Confidence:** Confirmed

### L-03 — RNPM stats expune path absolut al DB-ului

- **Severity:** Low
- **Category:** Security
- **Location:** `backend/src/routes/rnpm.ts:914-938`; `backend/src/db/rnpmDb.ts:38-47`
- **Issue:** raspunsul include `db.path` absolut.
- **Impact:** un user web autentificat afla structura directoarelor serverului si stem-ul fisierului, util pentru recon.
- **Reproduction:** `GET /api/rnpm/stats` in web mode.
- **Recommended fix:** returneaza numai size/existence si eventual nume logic; pastreaza path-ul in Electron IPC.
- **Confidence:** Confirmed

### L-04 — Endpoint-urile de backup returneaza mesaje interne brute

- **Severity:** Low
- **Category:** Security
- **Location:** `backend/src/routes/adminBackups.ts:36-41,53-61,83-95`; `backend/src/routes/rnpm.ts:1030-1033,1067-1074,1103-1116,1129-1139`
- **Issue:** exceptiile 500 sunt trimise ca `e.message` catre client.
- **Impact:** EACCES/EPERM/SQLite errors pot divulga path-uri si detalii operationale.
- **Reproduction:** induce o eroare ACL in test si apeleaza create/restore/list.
- **Recommended fix:** mesaje generice + requestId; pastreaza text complet doar in loguri redaction-safe.
- **Confidence:** High Confidence

### L-05 — Raspunsurile JWT autentificate nu au global `no-store`

- **Severity:** Low
- **Category:** Security
- **Location:** `backend/src/middleware/patSecurity.ts:24-25`; `backend/src/index.ts:262-265`; exemple in `backend/src/routes/rnpm.ts:825-850`
- **Issue:** `Cache-Control: no-store` este aplicat PAT/export, nu tuturor raspunsurilor cu cookie JWT.
- **Impact:** date juridice/admin pot ramane in browser cache sau intr-un intermediar adaugat ulterior. Topologia inclusa nu are shared cache, deci riscul este conditionat.
- **Reproduction:** GET autentificat prin cookie si inspecteaza header-ele.
- **Recommended fix:** middleware global `Cache-Control: no-store, private` si `Pragma: no-cache` pentru API autentificat.
- **Confidence:** High Confidence

### L-06 — `prefers-reduced-motion` lipseste

- **Severity:** Low
- **Category:** Accessibility
- **Location:** `frontend/src/index.css:1-71`; animatii in RNPM si smooth scroll in `frontend/src/App.tsx:135-143`
- **Issue:** preferinta OS nu reduce spin/ping/smooth scroll.
- **Impact:** disconfort pentru utilizatori sensibili la miscare.
- **Reproduction:** activeaza reduced motion in OS si observa animatiile neschimbate.
- **Recommended fix:** media query global pentru reducerea animatiilor si `scroll-behavior:auto`.
- **Confidence:** Confirmed

### L-07 — Terminologie inconsistente in fluxurile destructive

- **Severity:** Low
- **Category:** Visual Consistency
- **Location:** `RnpmSavedStats.tsx:189,217,328-367,420`; `RnpmRestoreModal.tsx:28,64,107`; `pages/admin/Backups.tsx:39,59,84,108`
- **Issue:** `Backups`, `back-up`, `backup-uri`, `restore`, `restaurare`, `baza locala`, `Baza mea RNPM` sunt amestecate.
- **Impact:** userul poate ezita daca actiunea atinge baza personala RNPM sau monolitul complet.
- **Reproduction:** compara confirmarile celor trei fluxuri.
- **Recommended fix:** glosar unic: `backup-uri`/`copii de siguranta`, `restaurare`, `baza mea RNPM` versus `baza completa`.
- **Confidence:** Confirmed

## 6. Zone investigate fara finding promovat

- Auth web valideaza JWT/PAT server-side, verifica user activ si deriva owner-ul din credential, nu din body.
- Rutele admin sunt protejate de `requireRole('admin')`; repository-urile principale sunt owner-scoped.
- Electron pastreaza `contextIsolation`, sandbox, `nodeIntegration:false`, CSP si allowlist exact pentru URL-uri externe.
- HTML-ul AI este redus prin DOMPurify la taguri de formatare fara atribute.
- SQL din input este parametrizat; interpolarile identificate provin din allowlist-uri interne de coloane/tabele/placeholders.
- `xlsx-js-style@1.2.0` include SheetJS 0.18.5. Advisory-ul de prototype pollution afecteaza citirea fisierelor arbitrare si declara export-only neafectat. In acest proiect dependinta este pe write/export path; importurile user folosesc ExcelJS. Nu a fost promovat ca vulnerabilitate exploatabila in auditul curent.
- `jspdf@4.2.1` este versiunea care include fixurile de securitate publicate pentru output/object injection.

## 7. Plan de remediere prioritizat

### P0 — Inainte de orice release

1. H-01: protocol de shutdown care pastreaza instance lock-ul pana la settle real.
2. H-02: backup agregat fail-closed/partial explicit pe erori RNPM.
3. H-03: elimina confirmarea globala pe Enter si adauga teste keyboard destructive.
4. M-01: serializeaza delete + compact + latch ca o singura operatie.
5. Ruleaza fault-injection, suite complete si smoke pe artifact Electron impachetat.

### P1 — Inainte de promovarea web

1. M-03/M-04: idempotency restore si retentie pe failure.
2. M-06/M-07/M-08: inchide localhost CSRF si redacteaza query/SMTP logs.
3. M-09: retention worker independent de monitoring.
4. M-12/M-13/M-14: dialog comun accesibil si responsive shell/reflow.
5. L-03/L-04/L-05: elimina path/error leakage si aplica no-store pe API autentificat.

### P2 — Imediat dupa blocante

1. M-02: preflight disk realist pentru split.
2. M-05/M-10: busy state unic si persistenta cheilor cu rezultat vizibil.
3. M-15..M-22: tab/select/labels/tables/live regions/touch/timeout/contrast.
4. L-01/L-02/L-06/L-07: erori filesystem explicite, cleanup async, reduced motion si copy unificat.

## 8. Quick wins cu risc mic de regresie

- elimina handlerul global `Enter`;
- propaga erorile `readdir` non-`ENOENT`;
- foloseste `sanitizeSmtpError` si pathname-only logger;
- adauga `requireDesktopHeader` pe cele doua POST-uri body-less;
- scoate `db.path` din API si generalizeaza erorile 500;
- adauga `Cache-Control: no-store, private` pe API autentificat;
- unifica busy state-ul modalului RNPM;
- adauga AbortController/cleanup la fetch-uri si timeout-uri;
- adauga labels, live regions, aria-label contextual, contrast amber mai inchis si touch targets;
- corecteaza manualul si terminologia backup/restore.

## 9. Schimbari arhitecturale sau investigatie profunda

- contract formal de shutdown/cancellation pentru writerii SQLite si worker threads;
- ledger persistent de idempotency pentru restore;
- operatie DB-layer atomica pentru delete/compact;
- model realist de disk sizing pentru split cu date partajate multiplicate;
- primitiva Dialog unica, stack-aware, si Select accesibil reutilizabil;
- shell web responsive cu drawer si testare 320px/400% zoom;
- test de recovery real: restore din setul zilnic cu monolit plus toate DB-urile RNPM;
- verificare completa a dependintelor cu scanner autorizat, fara upload neaprobat de metadata.

## 10. Recomandare de release

**DO NOT SHIP.**

Justificare: branch-ul contine doua defecte High care pot invalida exclusivitatea procesului si recovery set-ul, plus un defect High care poate executa o actiune destructiva contrar focusului utilizatorului. Acestea nu sunt probleme cosmetice si nu trebuie acceptate ca risc cunoscut. Dupa inchiderea P0, release-ul trebuie reevaluat prin:

1. suite completa backend/frontend/electron;
2. fault-injection shutdown peste 30s si pornire instanta a doua;
3. backup zilnic cu EACCES/EIO si restore complet multi-owner;
4. smoke Electron impachetat pentru backup/restore/compact;
5. smoke web cu doi useri si proxy CIDR real;
6. test keyboard/screen-reader pe dialogurile destructive;
7. responsive/zoom matrix pentru web.
