Am verificat codul urmărit de Git pe `feat/v2.43.0-rnpm-split`, HEAD `a9630b90149961b148889396b248b7ecc306e759`. Worktree-ul urmărit era curat; planul este un fișier local untracked. Nu am modificat nimic.

Verdict general: planul nu este sigur de executat în forma actuală. Task 7, 9, 12 și 15 au defecte care ar livra comportament greșit; încă 11 taskuri necesită ajustări de implementare sau teste. Niciun finding nu este complet stale/already-fixed.

## Cluster A

### Task 1 — CORRECT

Finding-ul este real, iar fixul propus este compatibil cu fluxul actual.

- Monolitul este procesat înaintea enumerării RNPM: `dailyBackupTarget(mainTarget())` la [backup.ts:1311](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:1311>).
- Enumerarea curentă înghite orice eroare:

  `catch { /* directorul rnpm nu exista... */ }`

  la [backup.ts:1317](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:1317>).

- `logBackupEvent()` emite JSON prin `console.log`, exact mecanismul cerut de plan, la [backup.ts:102](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:102>).
- `getRnpmDataDir()` este într-adevăr `<dirname monolit>/rnpm`, la [rnpmDb.ts:38](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/rnpmDb.ts:38>).

Fixul `ENOENT => benign; orice alt cod => daily_backup_failed` este corect și nu oprește backup-ul monolitului deja finalizat.

### Task 2 — NEEDS ADJUSTMENT

Diagnosticul și schimbarea de producție sunt corecte, dar testul indicat nu corespunde codului actual.

- Guard-ul curent întoarce 409 fără audit la [rnpm.ts:865](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:865>) și [rnpm.ts:893](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:893>).
- După mutație, ambele rute folosesc `recordAudit`, care poate arunca și transforma succesul într-un 500: [rnpm.ts:884](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:884>) și [rnpm.ts:907](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:907>).
- `recordAuditSafe` este deja importat la [rnpm.ts:28](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:28>) și este exact helper-ul post-mutație documentat la [auditRepository.ts:135](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/auditRepository.ts:135>).

Corecție necesară:

- Testul trebuie adăugat în `rnpmBackups.contract.test.ts`, unde există deja cazurile SEARCH_ACTIVE pentru delete-all/batch la [rnpmBackups.contract.test.ts:355](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpmBackups.contract.test.ts:355>) și [rnpmBackups.contract.test.ts:369](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpmBackups.contract.test.ts:369>).
- Helperii reali sunt `beginRnpmSearch`/`endRnpmSearch`, nu `beginRnpmSearchActivity`, conform [rnpmActivity.ts:23](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/rnpmActivity.ts:23>).
- Păstrează testele de audit după Task 7, care înlocuiește guard-ul explicit cu eroarea tipată din DB layer.

### Task 3 — NEEDS ADJUSTMENT

Fixul UI este corect; testele propuse nu pot rula în repo-ul actual.

- Enter confirmă global astăzi, indiferent de focus, la [confirm-dialog.tsx:47](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/components/ui/confirm-dialog.tsx:47>)–[55](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/components/ui/confirm-dialog.tsx:55>).
- `Button` suportă ref prin `forwardRef`, deci `cancelBtnRef` este valid: [button.tsx:9](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/components/ui/button.tsx:9>).
- Repo-ul nu are `@testing-library/react`, `@testing-library/user-event` sau `jest-dom`; dependențele reale sunt la [frontend/package.json:26](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/package.json:26>).
- Testul existent indicat drept model folosește `createRoot` + `act`, nu Testing Library: [Backups.test.tsx:27](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/pages/admin/Backups.test.tsx:27>).

Corecție necesară:

- Scrie testul cu `createRoot`, `act`, `element.focus()` și evenimente native `KeyboardEvent`.
- Adaugă un test Escape real; testul din plan afirmă „Escape anulează”, dar verifică numai Enter.
- Verifică și regresia non-destructive: focusul inițial trebuie să rămână pe confirmare.

### Task 4 — NEEDS ADJUSTMENT

Bugurile sunt reale, iar reload-ul funcționează în web și renderer-ul Electron, dar acoperirea de test este incompletă.

- Confirmarea restore nu trimite `title`, deci cade pe fallback-ul distructiv „Confirmare stergere”: [Backups.tsx:65](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/pages/admin/Backups.tsx:65>) și [confirm-dialog.tsx:85](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/components/ui/confirm-dialog.tsx:85>).
- După restore se face doar `await load()`, iar restul stării aplicației rămâne stale: [Backups.tsx:80](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/pages/admin/Backups.tsx:80>).
- Testul existent folosește deja harness propriu și poate verifica titlul la [Backups.test.tsx:81](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/pages/admin/Backups.test.tsx:81>).

Corecție necesară:

- Păstrează `title: "Restaureaza backup"` și reload-ul complet.
- Adaugă test separat că reload-ul este programat numai după succes, nu după cancel sau eroare.
- Controlează timerul în test; altfel timerul real de două secunde poate declanșa navigarea jsdom după unmount.

### Task 5 — NEEDS ADJUSTMENT

Diagnosticul principal este corect, dar implementarea propusă nu își respectă contractul de logging.

- Heartbeat-ul actual aruncă direct din `setInterval` la mismatch sau lock ilizibil: [instanceLock.ts:264](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/instanceLock.ts:264>)–[278](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/instanceLock.ts:278>).
- `readLock()` transformă atât lipsa, cât și JSON corupt/I/O în `null`: [instanceLock.ts:65](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/instanceLock.ts:65>).
- Hook-ul graceful există pe `globalThis`, conform [index.ts:994](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/index.ts:994>).

Problema din difful planificat: ramura `latest === null` incrementează contorul și returnează, dar nu emite `instance_lock.heartbeat_skip`. Cum `readLock` înghite eroarea, această situație nu ajunge în `catch`. Interfața promisă de task nu este implementată.

Corecție necesară:

- Fie fă `readLock` să întoarcă un rezultat discriminat (`ok/missing/unreadable`), fie loghează explicit `heartbeat_skip` în ramura `latest === null`.
- Testele trebuie să verifice evenimentul structurat, nu numai că fatal handler-ul nu a fost apelat.
- Folosește fake timers cu cleanup `vi.useRealTimers()`.
- Evită ieșirea prematură dacă shutdown-ul era deja în progres: `gracefulShutdown()` întoarce imediat când `shuttingDown === true` la [index.ts:865](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/index.ts:865>), iar `.finally(exit)` poate scurta drain-ul deja pornit.

### Task 6 — NEEDS ADJUSTMENT

Fixul de producție este solid, dar testul principal și verificarea lock-retention sunt incomplete.

- `withMaintenanceWrite` verifică shutdown-ul numai înainte de coadă și execută direct callback-ul după acquire: [backup.ts:73](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:73>).
- `waitForBackupToSettle` întoarce `void`, deci caller-ul nu știe dacă a expirat: [backup.ts:1255](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:1255>).
- Shutdown-ul eliberează lock-ul necondiționat la [index.ts:958](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/index.ts:958>)–[982](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/index.ts:982>).

Implementarea boolean + recheck după acquire este corectă.

Corecții necesare:

- Testul propus trebuie să aștepte cel puțin un microtask/setImmediate după pornirea primului writer. `RWLock.withWrite()` face `await acquireWrite()` înainte să invoce callback-ul, la [rwLock.ts:34](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/util/rwLock.ts:34>); altfel `releaseFirst` rămâne funcția no-op și testul blochează.
- Adaugă un test real pentru decizia din `index.ts`: timeout `false` ⇒ `releaseInstanceLock()` nu este apelat. Rularea generică a `index.test.ts` nu dovedește acest invariant.
- Timerul pierzător din `Promise.race` ar trebui curățat când writerii termină înainte de timeout.

### Task 7 — INCORRECT — severitate HIGH

Acesta este cel mai periculos defect al planului.

Codul actual deschide handle-urile RNPM configurate astfel:

- `journal_mode = WAL`
- `foreign_keys = ON`
- `synchronous = NORMAL`
- `busy_timeout = 5000`

la [rnpmDb.ts:118](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/rnpmDb.ts:118>)–[123](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/rnpmDb.ts:123>).

Planul însă deschide direct:

`const db = new Database(dbPath);`

și apelează `deleteAllAvizeOnHandle()` fără `PRAGMA foreign_keys=ON`.

Consecință: delete-ul din `rnpm_avize` nu execută cascadele. Tabelele copil depind explicit de `ON DELETE CASCADE`, de exemplu:

- `rnpm_creditori.aviz_id`: [0001_rnpm_baseline.up.sql:70](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/migrations-rnpm/0001_rnpm_baseline.up.sql:70>)
- `rnpm_debitori.aviz_id`: [0001_rnpm_baseline.up.sql:97](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/migrations-rnpm/0001_rnpm_baseline.up.sql:97>)
- `rnpm_bunuri.aviz_id`: [0001_rnpm_baseline.up.sql:126](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/migrations-rnpm/0001_rnpm_baseline.up.sql:126>)
- `rnpm_istoric.aviz_id`: [0001_rnpm_baseline.up.sql:152](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/migrations-rnpm/0001_rnpm_baseline.up.sql:152>).

Astfel, planul ar șterge părinții și ar lăsa creditori/debitori/bunuri/istoric orfane. Testul propus verifică numai `getAvizStats().total === 0`, deci nu detectează coruperea logică.

Al doilea defect: `fsPromises.access(dbPath)` prinde orice eroare și o clasifică drept „fișier absent”. `EACCES`, `EIO` sau problemele ACL ar produce un succes fals `{deleted: 0}`.

Corecție obligatorie:

- Deschide cu `{ fileMustExist: true }`.
- Imediat după open: `db.pragma("foreign_keys = ON")` și cel puțin `busy_timeout`.
- Ideal, extrage în `rnpmDb.ts` un helper pentru handle direct configurat, ca setul de pragmas să nu fie duplicat.
- La access/stat: doar `ENOENT` înseamnă absent; restul erorilor se propagă.
- `deleteAllAvizeOnHandle` trebuie să valideze explicit owner-ul sau să rămână neexportat/public doar prin wrapper validat.
- Testul trebuie să insereze aviz plus creditori/debitori/bunuri/istoric, apoi să verifice toate count-urile zero și `PRAGMA foreign_key_check` gol.
- Adaugă test EACCES/eroare FS și test de izolare între doi owneri.

Separarea RNPM este altfel respectată: operația lucrează în `rnpm/<stem>.db`, nu în monolit, iar SQL-ul nou rămâne sub `backend/src/db/**`.

## Cluster B

### Task 2 / B1c — NEEDS ADJUSTMENT

Același verdict ca mai sus. Auditul `denied` este necesar și `recordAuditSafe` este corect post-mutație, dar testele trebuie mutate pe fixture-urile reale `rnpmBackups.contract.test.ts`.

### Task 8 — NEEDS ADJUSTMENT — severitate HIGH

Finding-urile sunt reale, dar planul are două goluri importante.

Cross-owner:

- Restore-ul admin scrie astăzi target owner numai în `detail.targetOwnerId`, la [rnpm.ts:1097](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:1097>).
- Fără `options.ownerId`, `recordAudit()` înlocuiește owner-ul null cu owner-ul callerului: [auditRepository.ts:100](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/auditRepository.ts:100>)–[109](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/auditRepository.ts:109>).
- Testul existent verifică doar JSON-ul din detail, nu coloana `owner_id`: [rnpmBackups.contract.test.ts:225](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpmBackups.contract.test.ts:225>).

Defect de scope în plan:

- La DELETE backups, `const owner` este declarat în interiorul `try`, la [rnpm.ts:1121](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:1121>).
- Planul cere folosirea lui și în `catch`; implementat literal, nu compilează.

Corecție: rezolvă owner-ul înainte de `try` sau folosește `let owner`, apoi setează `ownerId: owner` atât pe succes, cât și pe error/denied.

Auditul split nu este durabil:

- Markerul `done` determină ca boot-urile următoare să întoarcă `split:false`: [rnpmSplitter.ts:545](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/rnpmSplitter.ts:545>).
- Split-ul scrie markerul `done` înainte să revină în `index.ts`: [rnpmSplitter.ts:585](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/rnpmSplitter.ts:585>)–[598](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/rnpmSplitter.ts:598>).
- Dacă `recordAudit("rnpm.split")` eșuează după split, boot-ul este abortat de catch-ul de prewarm la [index.ts:641](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/index.ts:641>), dar la următorul boot split-ul nu mai este raportat. Evenimentul lipsește definitiv.

Corecție: split audit trebuie să aibă mecanism idempotent/durabil legat de marker, nu doar un `recordAudit()` one-shot după return. De exemplu marker cu stare `audit_pending`, plus insert idempotent/detectare audit existent înainte de trecerea finală.

Helper-ul `isTypedMaintenanceError()` în sine este corect și reutilizează setul real de la [appErrorHandler.ts:16](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/util/appErrorHandler.ts:16>).

## Cluster C

### Task 9 — INCORRECT — severitate HIGH

Backend envelope este corect ca direcție; obiectivul „`.code` păstrat în client” nu este realizat pentru admin backups.

- `adminBackups.ts` răspunde astăzi flat `{backups}`, `{ok,name}` etc.: [adminBackups.ts:32](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/adminBackups.ts:32>).
- `adminBackupsApi.ts` are propriul `jsonOrThrow`, care aruncă `new Error(...)`: [adminBackupsApi.ts:12](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/lib/adminBackupsApi.ts:12>)–[24](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/lib/adminBackupsApi.ts:24>).
- Planul modifică shape-ul de succes, dar nu modifică acel error parser și nu importă `ApiError` din `rnpmApi`. Prin urmare, erorile admin continuă să piardă `.code`, `.status` și `requestId`.

Mai mult, repo-ul are deja implementarea standard potrivită:

- `MonitoringApiError` la [api.ts:480](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/lib/api.ts:480>).
- `unwrapMonitoring()` păstrează code/status/details/requestId la [api.ts:496](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/lib/api.ts:496>).

Corecție:

- `adminBackupsApi.ts` trebuie să folosească `unwrapMonitoring`, nu încă un parser local.
- Pentru RNPM legacy poate exista un `RnpmApiError`, dar ar trebui să păstreze și `requestId/details`, nu numai code/status.
- Actualizează testul real [adminBackups.test.ts:72](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/adminBackups.test.ts:72>), care asertează toate shape-urile flat.
- Adaugă test de client care dovedește că un envelope error produce o eroare cu `.code`, `.status` și `.requestId`.

Valorile lowercase `cooldown` și `desktop_header_required` sunt într-adevăr contractele wire actuale: [rnpm.ts:1051](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:1051>) și [requireDesktopHeader.ts:46](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/middleware/requireDesktopHeader.ts:46>).

## Cluster E

### Task 10 — NEEDS ADJUSTMENT

Finding-ul este real, iar loggerul pathname-only este corect.

- Loggerul Hono este montat la [index.ts:95](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/index.ts:95>) și primește URL-ul complet.
- `requestIdContext` setează header-ul răspunsului la [requestId.ts:20](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/middleware/requestId.ts:20>), deci loggerul exterior îl poate citi după `await next()`.

Problema este testul: `/api/dosare?numeParte=...` ajunge în apelul SOAP real la [dosare.ts:142](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/dosare.ts:142>), deci testul devine dependent de rețea și timeout.

Corecție:

- Folosește un query sensibil nerecunoscut pe un răspuns local determinist, de exemplu `/api/dosare?marker=NUME-SENSIBIL`, care întoarce 400 înainte de SOAP la [dosare.ts:104](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/dosare.ts:104>).
- Instalează spy-ul înainte de `importFreshIndex`; loggerul Hono curent capturează referința `console.log` la construire.
- Păstrează test pentru pathname, status, durată și requestId.

### Task 11 — NEEDS ADJUSTMENT

Fixul de producție este corect; testul propus nu este un test failing valid.

- Cele trei catch-uri brute există la [mailer.ts:186](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/services/email/mailer.ts:186>), [mailer.ts:212](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/services/email/mailer.ts:212>) și [mailer.ts:232](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/services/email/mailer.ts:232>).
- `sanitizeSmtpError` există și elimină RCPT/MAIL FROM, email și hostname SMTP: [auditSanitize.ts:63](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/util/auditSanitize.ts:63>).

Defectele testului din plan:

- Nu apelează `setSmtpEnv()`, deci mailerul este disabled și `sendMail` nu este invocat.
- Nu configurează `mocks.sendMail.mockRejectedValue(...)`.
- `JSON.stringify(new Error(...))` nu include proprietatea non-enumerabilă `message`, deci adresa nu apare nici înaintea fixului. Testul poate trece fals.

Corecție:

- Configurează SMTP și mock-ul reject.
- Serializează argumentele Error prin `a instanceof Error ? a.message : JSON.stringify(a)`.
- Testează toate trei funcțiile sau cel puțin o buclă tabelară peste `sendAlertEmail`, `sendComposedEmail`, `sendTestEmail`.

### Task 12 — INCORRECT — severitate HIGH

Planul nu își atinge propriul scop.

- Purge-urile există numai în scheduler la [scheduler.ts:386](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/services/monitoring/scheduler.ts:386>)–[439](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/services/monitoring/scheduler.ts:439>).
- Monitoring poate fi oprit în orice mod prin `MONITORING_ENABLED=0`: [index.ts:427](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/index.ts:427>).
- Blocul în care planul introduce noul timer este strict web-only: [index.ts:745](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/index.ts:745>)–[809](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/index.ts:809>).

Prin urmare, desktop + `MONITORING_ENABLED=0` continuă să acumuleze `audit_log` și `ai_usage` nelimitat.

Al doilea defect: planul pune ambele purge-uri într-un singur `try`. Schedulerul actual le separă intenționat, astfel încât eroarea AI să nu sară audit retention: [scheduler.ts:386](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/services/monitoring/scheduler.ts:386>) și [scheduler.ts:419](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/services/monitoring/scheduler.ts:419>).

Al treilea defect: `backend/src/intervals.test.ts` nu testează timer-ele serverului. Este exclusiv pentru `generateMonthlyIntervals`, `splitInterval` și `defaultDateRange`: [intervals.test.ts:1](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/intervals.test.ts:1>).

Al patrulea defect: testul cere loguri separate `audit_log.purged`/`ai_usage.purged`, iar implementarea propune un singur `retention.purged`.

Corecție obligatorie:

- Timerul retention trebuie pornit în afara `if (getAuthMode() === "web")`, în ambele moduri.
- Folosește try/catch separat pentru fiecare repository.
- Extrage un helper testabil `runRetentionPurge()` și testează-l direct; testele de boot/timer pot rămâne în `index.test.ts`.
- Alege un singur contract de log și testează exact acel contract.
- Cleanup-ul la shutdown rămâne obligatoriu.

### Task 13 — NEEDS ADJUSTMENT

Fixul principal este corect, dar scope-ul și testele sunt incomplete.

- `/stats` expune efectiv path-ul absolut în ambele răspunsuri: [rnpm.ts:925](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:925>) și [rnpm.ts:938](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:938>).
- Tipul frontend îl cere la [rnpm.ts type:192](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/types/rnpm.ts:192>).
- UI îl afișează și copiază la [RnpmSavedStats.tsx:118](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/components/rnpm/RnpmSavedStats.tsx:118>) și [RnpmSavedStats.tsx:307](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/components/rnpm/RnpmSavedStats.tsx:307>).

Corecții lipsă:

- Elimină și importurile `Copy`/`Check`, altfel rămân nefolosite: [RnpmSavedStats.tsx:3](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/frontend/src/components/rnpm/RnpmSavedStats.tsx:3>).
- Actualizează testele contractuale existente care cer path-ul:
  - [rnpm.contract.test.ts:330](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.contract.test.ts:330>)
  - [rnpmBackups.contract.test.ts:291](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpmBackups.contract.test.ts:291>).
- `rnpm.envelope.test.ts` singur nu este suficient; gate-ul complet va pica pe cele două teste de mai sus.
- Dacă obiectivul este „fără mesaje interne brute pe 500”, planul ratează `/open-db-folder` și `/open-backups-folder`, care încă returnează erori Electron/OS brute la [rnpm.ts:958](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:958>) și [rnpm.ts:1152](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:1152>).
- Fie restrânge explicit obiectivul la backup HTTP, fie genericizează toate 500-urile din suprafața vizată și păstrează detaliul numai server-side.

### Task 14 — NEEDS ADJUSTMENT

Middleware-ul este aproape corect, dar nu garantează politica declarată.

- Unele rute au deja `no-store`, de exemplu exporturile la [dosare.ts:88](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/dosare.ts:88>) și [rnpm.ts:1226](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:1226>).
- SSE-urile au numai `Cache-Control: no-cache`: [dosare.ts:337](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/dosare.ts:337>) și [termene.ts:364](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/termene.ts:364>).

Cu guard-ul `if (!headers.has("Cache-Control"))`, SSE rămâne stocabil/revalidabil și nu primește `no-store`. Totodată, rutele cu `no-store` rămân fără `private`, deși testul și comentariul promit exact `no-store, private`.

Corecție:

- Nu trata simpla prezență a headerului drept suficientă. Parsează directivele și adaugă `no-store`/`private` fără să elimini `no-cache` necesar SSE.
- Alternativ, definește obiectivul strict „toate API au directiva no-store”, fără a promite valoare exactă.
- Testează și o rută SSE, o rută cu `no-store` existent și un 4xx/404.
- Nu folosi `/api/dosare?numarDosar=1` în test, deoarece pornește SOAP real; folosește o rută locală deterministă.

## Cluster G

### Task 15 — INCORRECT — severitate HIGH

Taskul combină fixuri utile cu trei regresii și teste care nu exercită codul pretins.

Owner type:

- Bugul este real: cast-ul `(body as { ownerId?: string }).ownerId` nu validează runtime type la [rnpm.ts:1085](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/routes/rnpm.ts:1085>).
- Guard-ul `typeof requestedOwner === "string"` este corect.

`fileExists`:

- Propunerea prinde orice eroare și întoarce `false`.
- Astfel `EACCES`, `EIO`, ACL sau storage failure devin 404/„nu există”, exact opusul obiectivului „erori FS explicite”.

Corecție: numai `ENOENT => false`; restul se propagă.

`listBackups`:

- Catch-ul actual înghite toate erorile la [backup.ts:235](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:235>).
- Dar `listBackups` este privat; testul propus nu compilează.
- Trebuie testat prin `listBackupsWithMeta()` sau `listRnpmBackups()` la [backup.ts:433](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:433>).

Mai grav, planul afirmă că `dailyBackupTarget` are catch pentru erorile de listare. Nu are: `latestBackupMtime()` este apelat în afara catch-ului snapshot la [backup.ts:1282](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:1282>).

Propagarea brută schimbă și semantica post-mutație:

- `createManualBackupForTarget` creează snapshot-ul, apoi apelează `pruneOld`: [backup.ts:1207](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:1207>).
- Dacă listarea din prune aruncă după ce backup-ul a fost publicat, ruta întoarce 500 pentru un backup deja creat; clientul poate repeta operația.
- Același risc există pentru backup-ul RNPM la [backup.ts:1228](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:1228>).

Listarea cu metadata mai are un catch prea larg: orice `stat` failure este tratat drept „fișier dispărut”, la [backup.ts:417](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:417>)–[425](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:425>). Și aici doar `ENOENT` trebuie ignorat.

Prune-on-staging-failure:

- Ideea este corectă: snapshot-ul pre-restore există înainte de staging, la [backup.ts:479](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:479>).
- Testul cu „backup invalid text” nu ajunge însă în staging. Validarea monolitului/RNPM rulează înainte de `restoreTargetImpl`: [backup.ts:861](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:861>) și [backup.ts:935](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/backup.ts:935>).

Corecție obligatorie:

- `fileExists`: ignoră doar ENOENT.
- Separă semantica publică de listare de prune-ul best-effort:
  - listarea HTTP propagă non-ENOENT;
  - prune după o mutație deja comisă loghează eroarea și nu transformă succesul în 500.
- Pentru testul prune-on-failure, folosește un backup valid și injectează eșecul după snapshot-ul pre-restore, de exemplu mock pe `copyFile` în staging, model deja existent la [rnpmBackup.test.ts:662](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/backend/src/db/rnpmBackup.test.ts:662>).
- Verifică separat erorile `readdir` și `stat` non-ENOENT.

## Task 16 — NEEDS ADJUSTMENT

Gate-ul final nu verifică toate constrângerile declarate.

- `npm run check` execută lint + typecheck + teste, dar nu build-ul CJS: [package.json:24](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/package.json:24>)–[32](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/package.json:32>).
- Build-ul CJS este comandă separată, `npm run build`, la [package.json:14](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/package.json:14>).
- Instrucțiunea proiectului cere explicit smoke Electron, nu numai localhost web: [AGENTS.md:39](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/AGENTS.md:39>)–[42](</C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF/AGENTS.md:42>).

Corecție:

1. `npm run check`.
2. `npm run build` pentru bundle CJS/esbuild.
3. După testele Node: `npm run rebuild:electron`.
4. Smoke Electron sau o derogare explicită aprobată care actualizează instrucțiunea proiectului.
5. Smoke web cu setup documentat de autentificare admin; altfel list/create/restore admin nu este reproductibil în web mode.

Niciun task nu introduce `import.meta.url` nou, iar SQL-ul nou planificat rămâne sub `backend/src/db/**`. Nu este necesară o migration nouă; problema Task 7 este configurarea handle-ului din chain-ul RNPM separat, nu schema monolitului.

## Probleme prioritare care ar livra un fix rău

1. **Task 7:** handle direct RNPM fără `foreign_keys=ON` — lasă tabele copil orfane după delete-all.
2. **Task 15:** propagarea `listBackups` după snapshot poate întoarce 500 pentru un backup deja creat; `fileExists` maschează EACCES/EIO ca „absent”.
3. **Task 12:** retention timer web-only lasă desktop-ul neprotejat; un singur `try` permite ca eroarea AI să sară purge-ul audit.
4. **Task 9:** admin backup client continuă să piardă `.code/status/requestId`, în ciuda obiectivului declarat.
5. **Task 8:** auditul split poate lipsi definitiv după un eșec post-marker; owner-ul din catch-ul DELETE nici nu este în scope.
6. **Task 13/14:** teste contractuale neactualizate și politici incomplete pentru raw 500/SSE cache.
7. **Task 16:** lipsesc build-ul CJS și smoke-ul Electron cerut de proiect.

Recomandarea este să nu se înceapă implementarea batch-urilor înainte de revizuirea planului pentru Task 7, 8, 9, 12 și 15.

Codex session ID: 019f5098-2230-78b2-9678-f155d98f95b0
Resume in Codex: codex resume 019f5098-2230-78b2-9678-f155d98f95b0
