# Changelog - Legal Dashboard

Toate modificarile notabile ale acestui proiect sunt documentate in acest fisier.

---

## [2.10.7] - 2026-05-03

### UX Monitorizare - contor total in titlul tabelului

Patch frontend + docs peste v2.10.6. Corecteaza confuzia din pagina
`Monitorizare` unde header-ul `Joburi active (100)` afisa numarul de randuri
incarcate pe pagina curenta, nu totalul real de joburi active.

### Frontend

- `frontend/src/pages/Monitorizare.tsx`: titlul cardului foloseste acum
  `total` din raspunsul paginat (`Joburi active (616)`), nu `jobs.length`
  (`100` cand pagina este setata la 100 randuri).
- Tooltip-urile butoanelor Excel/PDF spun explicit ca exportul fara selectie
  acopera joburile vizibile pe pagina curenta, ca sa ramana aliniate cu textul
  existent `Selectia opereaza doar pe pagina vizibila (100 din 616)`.

### Release targets

- Bump la `2.10.7` in root/backend/frontend manifests si lockfile.
- Push-ul pe `main` declanseaza workflow-ul Docker Build; tag-ul `v2.10.7`
  declanseaza workflow-urile GitHub Actions pentru macOS DMG si Windows NSIS
  installer.

---

## [2.10.6] - 2026-05-03

### Hardening post-v2.10.5 — review findings + curatare backlog

Patch peste v2.10.5 fara schimbari functionale vizibile. Absoarbe in totalitate
findings-urile review-ului `REVIEW-FINDINGS-2026-05-03.md` (Critical + High +
Medium + Low + nice-to-have), elimina script-ul `seed-test-alerts.cjs` si scoate
din backlog Task A (editare job monitorizare).

### Frontend

- `useDebouncedValue` rescris cu tuple-return `[value, flush]`. Callback-ul
  `flush(next)` permite resetarea sincrona la apasari de buton (clear-X / Reset
  filtre) ca debounced state-ul sa nu mai fluture printr-un val intermediar.
- `Alerts.tsx`: `jobKind` ingustat de la `AlertJobKind` la tipul tab-bar-ului
  (`JobKindFilter`); cast-ul mort dropuit. Reset-handlerii cheama `flushQuery("")`
  inainte sa puna input-ul gol.
- `Monitorizare.tsx`: same pattern (`flushQuery("")` pe clear-X si Reset filter).
- `JobKindTabs`: navigatie tastatura conform WAI-ARIA Authoring Practices —
  ArrowLeft / ArrowRight cu wrap, Home / End jump la extreme, roving tabindex
  (`tabIndex={active ? 0 : -1}`), focus mutat sincron pe tab-ul selectat.

### Backend

- `escapeLikeMeta(s)` extras in `util/textNormalize.ts` ca helper reutilizabil
  pentru orice path care trece input user prin `LIKE ? ESCAPE '\\'`. JSDoc
  documenteaza explicit contractul (omiterea `ESCAPE` lasa `\` literal si re-
  enable-uieste `%` / `_` ca wildcards).
- `auditRepository.listAuditEvents` (`actionLike`) si
  `userRepository.listUsers` (`search` peste `email` + `display_name`) folosesc
  acum `escapeLikeMeta` + `ESCAPE '\\'` — defense-in-depth pentru admin paths
  unde user input ajunge in clauze LIKE.
- `monitoringJobsRepository` si `monitoringAlertsRepository`: filtru `q` are
  guard `q?.trim()` defensiv (Zod-ul deja face trim, dar repo-ul nu mai depinde
  de el).

### Tests

- Backend: nou `util/textNormalize.test.ts` (11 teste) + 3 teste wildcard pentru
  `getAvize` (`%`, `_`, `\` literali → 0 rezultate). **721 teste backend**.
- Frontend: noi `useDebouncedValue.test.ts` (6 teste, harness manual cu
  `react-dom/client` + React 18 `act` din `react`), `JobKindTabs.test.tsx`
  (9 teste — render, aria-selected, click, roving tabindex, ArrowLeft/Right,
  Home/End, ignored keys), `alertsApi.test.ts` (7 teste pentru constructia
  query string). **73 teste frontend**.

### Cleanup

- Sters `scripts/seed-test-alerts.cjs` (script tactic, nu mai are utilitate).
- Scos Task A din `CODEX-BACKLOG.md` si memoria persistenta — feature-ul de
  editare job monitorizare ramane decis-out-of-scope.

---

## [2.10.5] - 2026-05-03

### UX Dashboard + Alerte - KPI umanizat si filtre pe sursa jobului

Patch peste v2.10.4. Task A din `CODEX-BACKLOG.md` ramane neimplementat
deocamdata; aceasta versiune acopera doar Task B si Task C.

### Dashboard

- KPI-ul `Joburi active` devine `Monitorizari active`.
- Sublinia tehnica `X dosar_soap, Y name_soap` devine `X Dosare, Y Nume`.

### Alerte

- Pagina `Alerte` primeste tab-bar `Toate / Dosare / Nume`, ortogonal fata de
  select-ul existent pe event-kind (`dosar_new`, `termen_changed`, etc.).
- Search input nou cu debounce 300ms cauta dupa targetul jobului:
  `numar_dosar` pentru `dosar_soap` si `name_normalized` pentru `name_soap`.
- Filtrele existente (event-kind, severitate, necitite, inchise, interval date)
  raman neschimbate si se combina cu noul `jobKind` / `q`.
- Empty state contextualizat cand tab-bar/search nu au rezultate si link pentru
  resetarea filtrelor noi.

### Backend

- `GET /api/v1/alerts` accepta query params noi: `jobKind` si `q`.
- `listAlerts` aplica filtrele noi pe `monitoring_jobs` prin LEFT JOIN-ul deja
  folosit pentru target enrichment; alertele ale caror joburi au fost sterse
  sunt excluse doar cand aceste filtre target-based sunt active.
- `q` foloseste `rnpm_norm(...) LIKE ... ESCAPE '\'`, deci cautarea este
  case-insensitive, diacritic-insensitive si trateaza `%`, `_`, `\` ca literali.
- `COUNT(*)` foloseste acelasi JOIN cand `jobKind` sau `q` sunt active, ca
  `total` sa ramana sincronizat cu lista paginata.

### Tests

- `backend/src/routes/alerts.test.ts`: 5 teste noi pentru `jobKind`, cautare pe
  `numar_dosar`, cautare pe `name_normalized` cu/fara diacritice, wildcard `%`
  literal si combinatia `q + jobKind`.

**703 teste backend** asteptate dupa aceasta versiune.

---

## [2.10.4] - 2026-05-03

### UX Monitorizare - filtre kind (Dosare/Nume) + search box diacritic-insensitive

Patch UX peste v2.10.3 — singura zona afectata e pagina `Monitorizare`.
Modulele `Cautare Dosare` si `Termene & Calendar` raman intacte.

Probleme adresate:
1. Pe DB-uri cu sute de joburi mixte (dosar_soap + name_soap), nu exista un mod
   rapid de a vedea doar lista de dosare sau doar lista de nume monitorizate.
2. Cu paginare server-side (introdusa in v2.10.3), lookup-ul unui job specific
   prin scroll + paginatie e ineficient.

### Backend - GET /api/v1/monitoring/jobs primeste param `q`

`backend/src/schemas/monitoring.ts` (`JobListQuerySchema`):
- Field nou `q: z.string().trim().min(1).max(100).optional()`. Trim aplicat
  inainte de validare; `.min(1)` respinge string gol post-trim cu 400.

`backend/src/db/monitoringJobsRepository.ts` (`listJobs`):
- Cand `q` e prezent, WHERE-ul adauga un OR pe trei `json_extract`-uri:
  `target_json.numar_dosar` (dosar_soap), `target_json.name_normalized`
  (name_soap), `target_json.identificator` (placeholder aviz_rnpm).
- Match diacritic-insensitive + case-insensitive prin `rnpm_norm()` pe coloane.
  Param-ul `q` e trecut o singura data prin `stripDiacritics().toLowerCase()`
  pe RHS, apoi `LIKE %...%` cu meta-caractere `%`, `_`, `\` escapate cu `\`
  ESCAPE clause — input "50%" nu degenereaza in wildcard SQL.
- Acest comportament reproduce semantica `Cautare Dosare`: cautarea cu
  diacritice match-uieste fara diacritice si invers ("Ștefan" → "STEFAN
  POPESCU" si "Stefan" → "Ștefan Popescu").

### Frontend - filtre Toate/Dosare/Nume + search input

`frontend/src/lib/monitoringApi.ts`:
- `monitoring.list({ ..., q })` accepta noul param. Trim + drop pe gol inainte
  de a-l atasa la `URLSearchParams`.

`frontend/src/pages/Monitorizare.tsx`:
- State nou `kindFilter` (`"all" | "dosar_soap" | "name_soap"`) +
  `searchInput` (raw) + `debouncedQuery` (300ms debounce -> evita request
  spam la fiecare keystroke).
- Tab-bar de 3 butoane (`Toate`, `Dosare`, `Nume`) + `Input` cu icon `X` pentru
  clear, randate intr-o linie deasupra hint-ului `Selectia opereaza doar pe
  pagina vizibila`. Buton activ marcat cu `bg-primary` + `text-primary-foreground`.
- Counter discret `{total} rezultate` afisat doar cand exista filtre active.
- Empty state contextualizat: `"Niciun rezultat pentru filtrele aplicate.
  Reseteaza filtrele"` (cu link clickable care reseteaza ambele field-uri),
  vs. mesajul vechi de "niciun job activ" pastrat doar pentru cazul fara filtre.
- `useEffect([kindFilter, debouncedQuery])` reseteaza `page` la 0 cand filtrele
  se schimba — altfel utilizatorul aplica filtru pe pagina 7 si vede gol pana
  la recovery-ul de retro-decrementare.

### Backend - fail-closed pe target = doar sufix legal

- `dosarMatchesAllNameTokens(targetCore=[])` returneaza acum `false`
  (fail-closed) in loc de `true`. Un target compus exclusiv din sufixe legale
  ("SRL", "S.R.L.", "SRL LLC") e marginal (input-ul UPPERCASE + min 2 chars il
  blocheaza la `/commit`), dar pasul ramane defense-in-depth: in vechea forma,
  un astfel de target ar fi lasat sa treaca toate dosarele pe care PortalJust
  le returna prin substring-match, dezvalindu-l ca o gaura de pseudo-pozitive.

### Tests

- `backend/src/schemas/monitoring.test.ts`: 3 noi (`q` trim, gol post-trim,
  >100 chars).
- `backend/src/routes/monitoring.test.ts`: 4 noi (`q` matches numar_dosar,
  `q` cu diacritice matcheaza valoare fara diacritice, `q` + `kind` AND-ed,
  wildcard `%` escapat la match literal). Toate folosesc `QListResponse` shape
  partajat si afirma explicit `r.status === 200`.
- `backend/src/services/monitoring/nameSoapRunner.test.ts`: 1 nou (fail-closed
  pe target compus exclusiv din sufixe legale, 3 variante: `"SRL"`, `"S.R.L."`,
  `"  SRL  LLC  "`).

**698 teste backend** (zero regresii pe restul suite-ului).

---

## [2.10.3] - 2026-05-03

### UX Monitorizare - paginare server-side, buton Anuleaza, normalizare UPPERCASE

Patch UX peste v2.10.2 ca reactie la feedback-ul direct pe build-ul live: pagina
`Monitorizare` taia lista la 100 joburi vizibile (banner static "Sunt cel putin
100 joburi vizibile (din 617 total)"), fluxul de import bulk nu avea cale
explicita de iesire dupa preview, iar numele de monitorizare ajungeau in DB cu
mixed case (rezultat: tabelul afisa simultan `AMBKEVEN SRL` si `global learning
logistics srl` desi sunt aceeasi clasa de date).

### Frontend - paginare server-side pe Monitorizare

`frontend/src/pages/Monitorizare.tsx`:
- State nou `page`/`pageSize` (default 0/50). UI 0-indexed, server 1-indexed.
- `refresh()` re-fetcheaza pe schimbare via `useCallback([page, pageSize])` si
  `useEffect([refresh])`; recovery automat pe pagina goala dupa delete (decrement
  daca `jobs.length === 0 && total > 0 && page > 0`).
- `<TablePagination>` randat sub tabel cand `total > 0`. `pageSizes=[10,25,50,100]`
  matches cap-ul backend `JobListQuerySchema.pageSize.max(100)`.
- Eliminat banner-ul vechi `>= 100`. Hint nou: `"Selectia opereaza doar pe pagina
  vizibila ({jobs.length} din {total})"` doar cand `total > jobs.length`.

### Frontend - buton Anuleaza pe import bulk

`frontend/src/components/monitoring/MonitoringBulkImportCard.tsx`:
- Handler `handleBulkCancel()` reseteaza preview/dosar rows/error/title/filter +
  goleste fileInput. Fara reload, fara confirmare — flow non-destructive (nu am
  comis inca nimic in DB).
- Buton `<Button variant="outline">Anuleaza</Button>` cu `<X>` icon adaugat
  langa `Confirma import`. Disabled in timpul `bulkBusy`.

### Backend + frontend - normalizare UPPERCASE pe import

Regula noua: numele de monitorizare se stocheaza UNIFORM in UPPERCASE,
indiferent de calea de input (XLSX bulk, CSV bulk, manual add). PortalJust SOAP
`CautareDosare` accepta `numeParte` case-insensitive, deci match-ul nu se
schimba; uniformitatea elimina "AMBKEVEN SRL" vs "ambkeven srl" din UI.

- `backend/src/services/nameListParser.ts`: `normalizeName()` schimbat din
  `.toLowerCase()` in `.toUpperCase()`. Defense-in-depth — orice path trece prin
  `validateRawItems` (commit) sau `parseNameList` (preview) primeste valoarea
  uppercase, fara ca clientul sa poata bypass-a.
- `frontend/src/lib/monitoringBulkTemplate.ts`: parser-ul XLSX/CSV uppercaseaza
  `nameNorm` la extractia din celula.
- `frontend/src/components/monitoring/MonitoringAddForm.tsx`: form-ul manual
  uppercaseaza inputul inainte de submit (`monitoring.createName`).

Datele vechi din DB raman lowercase — nu adaugam migratie destructiva pe
schema; randurile noi importate vor fi UPPERCASE de aici inainte. Re-importul
aceleiasi liste produce aceeasi semnatura `target_hash` consistent (toate
input-urile trec acum prin acelasi normalizator).

### Backend - filtru strict word match + suffix legal ignorat (name_soap)

Problema: PortalJust SOAP `CautareDosare` returneaza dosare care fac match pe
**oricare** dintre cuvintele din `numeParte` (substring search). Pentru un nume
multi-cuvant precum `GLOBAL LEARNING LOGISTICS` portalul intoarce si
`GLOBAL LOGISTICS SA`, `LEARNING SOLUTIONS SRL` etc., generand alerte
fals-pozitive masive in inbox-ul de monitorizare.

Solutia: filtru post-fetch in runner-ul `name_soap` care pastreaza un dosar
**doar** daca exista cel putin o parte (din `dosar.parti[]`) ale carei tokeni
contin TOATE tokenii numelui monitorizat. Match-ul e strict pe egalitate de
tokeni (nu substring), case-insensitive, fara diacritice. Caracterul `&` e
promovat ca token de sine statator, deci `ABC&XYZ` si `ABC & XYZ` se
echivaleaza (`["ABC", "&", "XYZ"]` in ambele cazuri).

**Exceptie suffix legal:** SRL, SA, SCA, SNC, SCS, PFA, IF (RO) + LLC, LTD,
INC (intl) sunt eliminate de la coada listei de tokeni inainte de comparare,
indiferent de forma (`SRL`, `S.R.L.`, `S.R.L`, `SRL.`). Asta inseamna ca:
- Target `GLOBAL LEARNING LOGISTICS` matcheaza parte `GLOBAL LEARNING LOGISTICS SRL`.
- Target `GLOBAL LEARNING LOGISTICS SRL` matcheaza parte `GLOBAL LEARNING LOGISTICS`.
- Variatiile `S.R.L.` vs `SRL` nu mai produc false-negative.

`backend/src/services/monitoring/nameSoapRunner.ts`:
- Helperi noi exportati: `tokenizeNameForMatch`, `stripLegalSuffix`,
  `dosarMatchesAllNameTokens`. Set constant `LEGAL_SUFFIX_TOKENS`.
- `fetchForTarget` aplica filtrul peste rezultatul agregat din toate
  `institutii` (filtrul se executa o singura data pe Map-ul deduplicat).

### Tests

- `backend/src/services/nameListParser.test.ts`: actualizat 3 assertion-uri pe
  output-ul `normalizeName` / `nameNormalized` la UPPERCASE.
- `backend/src/services/monitoring/nameSoapRunner.test.ts`: adaugat 6 teste in
  describe-ul "nameSoapRunner - strict word filter" (tokenizare `&`, strip
  diacritice, all-words required intr-o singura parte, multi-party match, parti
  goale → false, runner-level filter elimina false-pozitive, runner accepta `&`
  literal). `makeDosar` default updated sa includa o parte `Ion Popescu` (matches
  default target name) altfel testele baseline picau pe `parti=[]`.

**690 teste** pass (zero regresii pe restul suite-ului).

---

## [2.10.2] - 2026-05-03

### Patch UX peste v2.10.1 - eliminam zone goale din UI

Patch frontend-only peste v2.10.1 (zero backend, zero schema, zero migration).
Rezolva doua iritari vizuale observate in build-ul live: header de coloana
afisat permanent fara continut in tabelul Monitorizare, plus doua panouri AI
mereu vizibile pe pagina Cautare Dosare chiar si pentru utilizatorii fara
chei API configurate. Ambele cazuri lasau zone goale care ocupau spatiu pe
ecran fara sa aduca informatie.

### Frontend - tabel Monitorizare adaptiv (coloana Detalii)

Coloana `Detalii` (introdusa in v2.10.0) randeaza un buton `Info` (galben)
**doar** pentru `name_soap` cu scope restrans la o lista de instante (click
deschide modal-ul cu lista). Pentru `dosar_soap` si pentru `name_soap` care
monitorizeaza toate instantele, celula este goala — deci pe DB-uri tipic
desktop unde majoritatea joburilor sunt `dosar_soap`, intregul header DETALII
ramanea o coloana inutila care fura ~80px din latimea tabelului.

- `frontend/src/pages/Monitorizare.tsx`: helper-ul `showDetailsColumn`
  calculat o singura data per render printr-un IIFE care wrap-uieste blocul
  `jobs.length > 0`. Verifica daca exista cel putin un job `name_soap` cu
  `getNameSoapInstitutie(job).length > 0`.
- `<th>DETALII</th>` randat condiional pe `showDetailsColumn`.
- `<td>` corespunzator randat condiional pe acelasi flag (per row), ca grid-ul
  sa ramana aliniat cand coloana e ascunsa.

### Frontend - panourile AI inlocuite cu banner discret pana la prima cheie

Pe pagina `/dosare`, expandarea unui rand afisa pana acum doua panouri
colapsate: `Analiza AI` (single-model) si `Analiza AI Avansata (multi-agent)`.
Erau vizibile chiar si cand `keys.anthropic`, `keys.openai` si `keys.google`
erau toate goale — utilizatorul vedea doua butoane pe care nu le putea folosi,
plus un mesaj inline "Configureaza cel putin o cheie API".

Solutia aleasa NU este sa ascundem complet feature-ul (utilizatorii noi
n-ar afla niciodata ca exista), ci sa-l surface-am minimal:

- `frontend/src/components/dosare-ai-analysis-panel.tsx`:
  `DosareAiAnalysisPanel` verifica `ai.hasAnyKey` la nivel de top. Cand
  flag-ul e `false`, randeaza un banner single-line discret in locul
  panourilor:

  ```tsx
  <div className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-violet-200 bg-violet-50/40 px-3 py-1.5 text-xs text-violet-700 ...">
    <Bot className="h-3.5 w-3.5 shrink-0" />
    <span>
      Analize AI (single + multi-agent) disponibile dupa configurarea unei
      cheie API in <strong>Setari API</strong>.
    </span>
  </div>
  ```

- Cand prima cheie e salvata in safeStorage si rand-ul Cautare Dosare se
  re-randeaza, banner-ul dispare iar panourile reapar automat —
  `hasAnyKey` reactiv din `useApiKey`.
- Discoverability-ul pentru "adauga cheie" ramane si in dialogul Setari API
  (NotificationStatusPanel + EmailSettingsPanel + sectiunea AI Keys), dar
  banner-ul de aici inchide gap-ul pentru utilizatorii care nu deschid acel
  dialog imediat.

### Decizii de design

- `showDetailsColumn` calculat o singura data per render (nu per row), pentru
  a evita re-evaluarea `getNameSoapInstitutie(job)` `O(N)` pe fiecare celula.
- Helper-ul ramane local (nu mutat in `lib/`) — singura componenta care are
  nevoie de el este pagina Monitorizare.
- `DosareAiAnalysisPanel` foloseste flag-ul `ai.hasAnyKey` care era deja
  propagat prin props (folosit pentru `showKeyPrompt`). Nu am adaugat
  tipuri noi sau callback-uri suplimentare.
- Modal-ul `Detalii instante` (cu focus trap din v2.10.1) ramane neatins.

### Validari

- `npx tsc --noEmit` (frontend) — clean.
- Lint pe fisierele atinse — clean.
- `npm run build` — verde.
- Smoke desktop dupa rebuild + restart Electron: header `DETALII` dispare
  cand toate joburile vizibile sunt `dosar_soap`; panourile AI dispar cand
  toate cheile sunt goale.

### Tests

- Niciun test nou: schimbare strict UX render. Acoperirea backend (683 teste
  in v2.10.1) ramane neschimbata.

---

## [2.10.1] - 2026-05-03

### PR-11 review hardening - patch peste v2.10.0

Patch care absoarbe 14 fix-uri tehnice din `/multi-review` (deep-code-reviewer,
backend-reliability-reviewer, test-architect, release-readiness-reviewer,
claude-guard) si o decizie explicita de a NU schimba design-ul (filtrul de
severitate ramane neaplicat — produsul a fost decis ca "email = toate alertele
noi de monitorizare" in v2.10.0; daca se vrea filtrare pe `min_severity`, va
fi o iteratie viitoare cu UI explicit, nu o schimbare silentioasa).

### Backend - email pipeline reliability

- `mailer.ts` cache-uieste `Promise<Transporter>` in loc de transport-ul
  rezolvat: doua dispatch-uri concurente nu mai construiesc doua connection
  pool-uri SMTP. Pe fail-ul primului build, cache-ul se reseteaza astfel incat
  apelul urmator sa retry-uiasca, in loc sa reziste cu un Promise rejectat.
- Timeout-uri SMTP explicite (`connectionTimeout=10s`, `greetingTimeout=5s`,
  `socketTimeout=15s`). Default-urile nodemailer sunt minute / nelimitate;
  pentru un canal user-facing prefera fail rapid in audit decat retry stuck.
- `readMailerConfig()` returneaza `null` cand `SMTP_PORT` este NaN sau in
  afara intervalului `[1, 65535]`. Eroarea de validare apare la boot, nu mai
  tarziu, pe primul send.
- `alertEmailDispatcher.ts` rescris cu queue FIFO si `MAX_CONCURRENT=1`. Un
  burst de alerte nu mai spawn-uieste multe `sendMail()` in paralel pe acelasi
  SMTP relay (Gmail = 100/zi, O365 = 30/min — limite agresive).
- `dispatchAlertEmail` short-circuiteaza cand `isMailerConfigured()` returneaza
  `false`: nu mai face SELECT pe `owner_email_settings` cand SMTP-ul e off.
- `dispatchAlertEmail` scrie audit `email.dispatch.failed`
  `outcome=error` pe `send_failed` sau exceptii: un outage SMTP silent devine
  vizibil pe trail-ul de audit (vechiul cod doar logona la `console.error`).
- `drainEmailDispatches(timeoutMs)` exportat: asteapta queue-ul sa se goleasca
  (default 10s, shutdown 5s). `index.ts` apeleaza drain-ul in `gracefulShutdown`
  inainte sa inchida DB-ul, deci audit-urile post-send nu mai lovesc un DB
  inchis.

### Backend - rute si validare

- `me.ts` PUT `/email-settings` foloseste `minSeverity.optional()`; cand
  field-ul lipseste din body, valoarea stocata e pastrata in upsert (era
  silent overwrite cu default `"info"`).
- `me.ts` POST `/email-settings/test` are cooldown 60s/owner: previne SMTP
  abuse pe relay throttled si ofera UX clar (return 429 cu `Retry-After`,
  audit `outcome=denied reason=cooldown`).

### Frontend - a11y modal Detalii instante

- `Monitorizare.tsx` adauga focus trap si focus restoration pe modal-ul
  Detalii (introdus in v2.10.0): la deschidere capturam `document.activeElement`
  si focus-am butonul de inchidere; ESC inchide; la inchidere restauram
  focus-ul daca elementul anterior inca exista in DOM. `focus-visible:ring-2`
  pe butoanele de inchidere.

### Docs

- `0014_email_settings.up.sql` ramane neschimbat (migratiile sunt imutabile
  prin `runner.ts` SHA-256 hash). Discrepanta `DEFAULT 'warning'` vs cod
  `"info"` documentata in `ownerEmailSettingsRepository.ts` ca seam pentru un
  viitor preset filtrat.
- `SESSION-HANDOFF.md` are sectiunea "Kill switches operationale" care
  enumera `SMTP_*`, `MONITORING_DISABLED_KINDS`, cooldown-ul `/test`, drain-ul
  graceful si gate-ul `LEGAL_DASHBOARD_ALLOW_REMOTE`.

### CI

- `.github/workflows/docker-build.yml` ruleaza `npx tsc --noEmit` pe backend
  + `npm test --workspace=backend -- --run` inainte de Docker build. Local nu
  se pot rula testele backend cand Electron a recompilat `better-sqlite3`
  pentru ABI-ul lui (`npm run rebuild:electron` necesar). CI-ul pe Node 22 cu
  prebuild ABI-correct inchide gap-ul.

### Tests

- 4 teste noi in `alertEmailDispatcher.test.ts` (short-circuit cand mailer-ul
  nu e configurat, audit pe `send_failed`, `drainEmailDispatches` resolva
  dupa settle, `pendingDispatchCountForTests` semnaleaza inflight).
- Mock-ul existent extins cu `isMailerConfigured: vi.fn(() => true)` pentru
  paritate cu noul import in dispatcher.

---

## [2.10.0] - 2026-05-03

### PR-11 Email notifiers - SMTP optional pentru alertele de monitorizare

Adauga un canal email peste fluxul existent de alerte. Inbox-ul `/alerte`,
badge-ul rosu, SSE-ul si notificarile native Windows/macOS raman sursa de
adevar; email-ul este strict aditiv, opt-in si izolat de hot path-ul de insert.

### Backend

- Migration noua `0014_email_settings` cu tabela `owner_email_settings`
  owner-scoped: `enabled`, `to_address`, `min_severity`, `created_at`,
  `updated_at`. `min_severity` ramane metadata compatibila cu schema alertelor,
  dar email-ul nu filtreaza dupa severitate. Default-ul este OFF.
- Repository nou `ownerEmailSettingsRepository.ts` cu `getEmailSettings`,
  `upsertEmailSettings`, trim/cap 320 pentru `to_address` si conversie DB
  snake_case -> domain camelCase.
- Service nou `services/email/mailer.ts` pe `nodemailer`: citeste doar
  `SMTP_*` din env, nu blocheaza boot-ul cand lipsesc, construieste subject,
  HTML body escaped si text body pentru alerte, plus `sendTestEmail`.
- Dispatcher nou `services/email/alertEmailDispatcher.ts` care verifica
  setarile owner-ului, `enabled` si destinatarul; orice eroare de send este
  logata si izolata.
- `monitoringAlertsRepository.insertAlert()` declanseaza email doar pentru
  inserturi reale (`inserted=true`), prin `queueMicrotask`, separat de SSE.
- Rute noi in `/api/v1/me`: `GET /email-settings`,
  `PUT /email-settings`, `POST /email-settings/test`, cu audit pe write/test.
- Cand nu exista setari salvate, `GET /email-settings` precompleteaza adresa
  userului autentificat daca este un email real; desktop-ul `local@desktop`
  ramane blank. Trimiterea ramane opt-in.

### Frontend

- Panou nou `EmailSettingsPanel` in dialogul de configurare chei API, langa
  statusul notificarilor native: enable/disable, adresa email, status SMTP,
  save si test. Cand este activ, canalul email trimite toate alertele noi de
  monitorizare.
- `adminApi.ts` extinde suprafata `me.emailSettings` cu `get`, `put`, `test`;
  tipurile sunt re-exportate prin barrel-ul `lib/api.ts`.

### Docs

- `backend/.env.example` documenteaza `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`.
- README, CLAUDE, SESSION-HANDOFF, EXECUTION-ROADMAP si in-app changelog
  actualizate la `v2.10.0`.

**Tests**: 34 teste backend noi pentru repository, mailer, dispatcher si rute
`/me/email-settings`; 5 teste frontend noi pentru helperii panoului email.

### Polish Monitorizare - coloana Detalii + modal instante

Sub-feedback empiric din pagina Monitorizare (joburi `name_soap` cu scope
restrans la o lista de instante): textul "Toate instantele" inflama tabelul
fara sa raspunda la intrebarea reala "care instante?", iar layout-ul lui
`name_soap` se rupea cand numele subiectului depasea coloana fixa.

- Coloana `Tip` (Dosar / Nume / Aviz RNPM) inlocuita cu coloana noua
  `Detalii` care afiseaza un buton circular cu pictograma `Info` (galben /
  amber) doar pentru `name_soap` cu scope restrans. Click pe pictograma
  deschide un modal `role="dialog"` `aria-modal` cu lista instantelor
  monitorizate (label uman din catalogul `INSTITUTII`) - `Building2` per item,
  inchidere prin click in afara, ESC, sau X. `text-[15px]` titlu,
  `text-[13px]` lista pentru densitate suficienta cand scope-ul are 10+
  instante. Tip-ul jobului ramane derivabil din formatul tintei (numar dosar
  vs nume) si din indicii ramasi (link extern PortalJust pe dosare, label
  `Eye Dosare` pe nume).
- Numele lung pentru `name_soap` face acum `break-words` cu
  `min-w-[180px] flex-1`, iar butonul Dosare are `shrink-0`, deci ramane
  ancorat la dreapta cu spacing `justify-between` cand sidebar-ul este
  collapsed (mai mult spatiu pentru numele/firma) si cu wrap natural in
  randul existent cand este expandat.
- Helperii partajati: `getInstitutieLabel` extras in `lib/institutii.ts`,
  `getNameSoapInstitutie` in `lib/monitoringApi.ts`. Folositi acum si la
  exportul Monitorizare (Excel + PDF) care suffix-eaza tinta `name_soap` cu
  `[Curtea de Apel ALBA IULIA, ...]` sau `[Toate instantele]`, asa incat
  raportul exportat sa nu mai fie ambiguu fata de UI-ul live.

### Polish taskbar Windows - icon dev separat

Continuare patch v2.7.1: AUMID-urile pentru dev (`ro.legaldashboard.dev`) si
packaged (`ro.legaldashboard.app`) sunt separate, ca instalatorul NSIS sa nu
mai imparta scurtatura cu sesiunile `electron:dev` si Windows sa nu mai
amestece icon-urile in taskbar. `ensureDevTaskbarShortcut()` rescrie shortcut-ul
existent in loc sa il sara, asa incat o schimbare de icon sau project root sa
fie aplicata fara reseed manual. `mainWindow.setIcon()` apelat explicit dupa
`new BrowserWindow(...)` in dev, ca Windows sa lege fereastra de icon-ul corect
chiar si cand `setAppUserModelId()` a fost apelat dar AUMID-ul nu este inca
inregistrat.

Helper nou `scripts/launch-electron-dev.cjs` (apelat din `npm run electron:dev`)
clone-uieste `electron.exe` in `Legal Dashboard Dev.exe` si patch-uieste
metadata cu `rcedit.exe` (icon, ProductName, FileDescription, InternalName,
OriginalFilename), apoi launch-eaza copia. Pe Windows fara `rcedit.exe` (lipsa
`electron-winstaller`), launcher-ul cade gracefully la binarul Electron native
si avertizeaza in stdout.

---

## [2.9.2] - 2026-05-03

### Patch notificari native - status Windows/macOS + notificare test

Intareste fluxul existent de alerte desktop: alertele generate de monitorizare
raman in inbox-ul aplicatiei si in badge-ul rosu, iar canalul nativ Windows /
macOS este verificat separat inainte de trimiterea toast-ului. Daca sistemul de
operare blocheaza notificarile sau statusul nu poate fi citit, alerta interna
nu se pierde.

### Electron

- `electron/main.js`: adaugat IPC `notification:getStatus` care returneaza
  `{ platform, supported, state, canNotify, reason }`.
- `electron/main.js`: adaugat IPC `notification:test` pentru notificare manuala
  de verificare din UI.
- `electron/main.js`: `notification:show` verifica statusul OS si suprima
  toast-ul cand Windows/macOS raporteaza explicit ca notificarile sunt blocate.
- `package.json`: adaugate optional dependencies
  `windows-notification-state` si `macos-notification-state`, plus includere in
  `electron-builder` `files` si `asarUnpack` pentru build-urile desktop.

### Frontend

- `frontend/src/components/NotificationStatusPanel.tsx`: panou nou in dialogul
  de configurare chei API, cu status notificari sistem, refresh si buton Test.
- `frontend/src/hooks/useAlertsStream.ts`: payload-ul notificarii este construit
  prin helper testabil, statusul nativ este cache-uit 60s, iar fallback-ul web
  cu `Notification.requestPermission()` ramane compatibil.
- `frontend/src/types/desktop-api.d.ts`: extins contractul `desktopApi` cu
  `getNotificationStatus()` si `showTestNotification()`.

**Tests**: adaugat `frontend/src/hooks/useAlertsStream.test.ts` pentru payload,
trunchiere body si gating pe status OS. Validari finale: frontend 45/45,
backend 645/645, backend type-check, frontend type-check, `npm run build`,
`npm run rebuild:electron` si smoke Electron desktop cu `/health` OK.

---

## [2.9.1] - 2026-05-02

### Patch UX post-feedback - Timeline scoasa din Dashboard + refactor sweep documentat retroactiv

Patch UX in urma feedback-ului direct: sectiunea "Activitate recenta"
(componenta `Timeline`, introdusa in PR-B v2.8.0) randa rulari de monitorizare
si event-uri de audit cu format tehnic ("Run ok (dosar_soap) · 2.6s · 0
alerte noi · 2h in urma") inutil pentru utilizatorii non-tehnici si redundant
cu pagina dedicata `/alerte` (care are filtre, paginatie completa si context
dosar enrichment via PR-6.x). Importul si render-ul `<Timeline />` au fost
scoase din `pages/Dashboard.tsx`. Componenta `Timeline.tsx` ramane in arbore
(poate fi reactivata pentru un panou administrativ separat). Pagina Dashboard
ramane cu KpiStrip + QuickActions + LastDosareCard + LastRnpmCard + Charts +
"Informatii API + Versiune". Endpoint-ul backend
`GET /api/v1/dashboard/timeline` ramane montat (necitit de UI) ca sa nu
sparga clientii externi sau test app-ul.

Adaugata si o intrare retroactiva in in-app changelog ("Refactor 11 stagii
(post-v2.7.0)") care documenteaza sweep-ul intern de refactorizare livrat in
11 commit-uri secventiale dupa tag-ul v2.7.0 si inainte de PR-B v2.8.0:
- Stage 0-1: vitest + jsdom infra pe workspace frontend + suite caracterizare
- Stage 2a-2c: structured logging in loadMoreSSE silent catches +
  jobExistsForAnyOwner mutat la repository + classifyRawName extras helper pur
- Stage 3-5: buildAlertContext extras (~250 LOC), MonitoringBulkImportCard
  extras (~400 LOC), datetime-formatters dedupe
- Stage 7: lib/export.ts spart in 3 (lib/pdf-helpers + lib/export-analysis +
  lib/export-manual), de la 1400 LOC la 698 LOC
- Stage 8: lib/api.ts spart per-domeniu cu wrapper apiFetch (lib/monitoringApi
  + lib/adminApi + lib/dashboardApi + barrel re-exports), de la 762 LOC la
  ~370 LOC
- Stage 9: useAlertsStream hook extras din AppShell (~130 LOC mutati)
- Stage 10: monitoringAlertsEnrichment extras din monitoringAlertsRepository
  (~180 LOC + subsistem alert_enriched mutat in modul propriu); repository
  scade de la 704 la ~485 LOC

**Tests**: 645/645 verzi (timeline endpoint backend ramane functional +
acoperit; niciun test backend modificat; frontend type-check curat dupa
scoaterea importului).

### Frontend - pages/Dashboard.tsx

- Eliminat import `import { Timeline } from "@/components/dashboard/Timeline"`
- Eliminat render `<Timeline />` din JSX (era pozitionat dupa `<Charts />`)
- Comentariu inline care explica decizia (linkat la feedback-ul user-ului)

### Frontend - frontend/src/data/changelog-entries.tsx

- Inserata noua intrare `v2.9.1` cu `Sparkles` icon + emerald border + 4
  sectiuni (Frontend Timeline elim, Backend endpoint pastrat, justificarea,
  Tests)
- Inserata intrare retroactiva `Refactor 11 stagii (post-v2.7.0)` intre
  v2.7.1 si v2.7.0 cu `Layers` icon + purple border + 9 sectiuni stagii

### Docs

- README.md: hero block actualizat cu v2.9.1, citatul feedback-ului inclus
- CLAUDE.md: "Versiune Curenta" rescris pentru v2.9.1, sprint list extins
- SESSION-HANDOFF.md: header actualizat, sectiune v2.9.1 in fata
- package.json + frontend/package.json + backend/package.json: bump 2.9.0 -> 2.9.1

---

## [2.9.0] - 2026-05-02

### PR-C v2.9.0 - Export raport dashboard (a treia si ultima livrare din sprintul de redesign)

Inchide sprintul de redesign al Dashboard-ului (PR-A v2.7.0 KPI strip + Quick
Actions, PR-B v2.8.0 timeline + charts, PR-C v2.9.0 export raport). Activeaza
butonul "Export raport" din Quick Actions cu un modal de selectie interval +
format care delega generarea unui workbook XLSX (3 sheet-uri) sau a unui PDF
landscape catre worker-ul de export, alimentat dintr-un singur snapshot
consistent al backend-ului.

**Backend - GET /api/v1/dashboard/report?range=7d|30d:**

- Endpoint nou owner-scoped (`getOwnerId`), wrapped in `withMaintenanceRead`
  pentru consistenta cu PR-A si PR-B (snapshot atomic peste backup/restore).
  Returneaza un envelope v1 care contine 4 blocuri:
  - `summary`: aceeasi forma ca `/summary` (KPI 24h - jobs, alerts, runs cu
    `aborted` separat de `error`, ai cost+calls+tokens).
  - `charts`: aceeasi forma ca `/charts` (3 serii daily backfilled - alerts,
    runs pivotate pe status ok/error/timeout/aborted, ai cost+calls+tokens),
    grid pe UTC days via `utcDayStart` ca toate seriile sa aiba acelasi X-axis.
  - `timeline`: lista bounded cu toate evenimentele in `[since, until]`
    (alerts + finalized runs + curated audit), cap `REPORT_TIMELINE_LIMIT=500`
    per sursa cu flag `truncated: boolean` cand vreuna dintre surse atinge
    limita (UI/PDF afiseaza nota informativa, nu eroare).
  - `range`, `since`, `until`, `generatedAt` - meta consistente.
- Reuseste helperii `readJobsBlock`/`readAlertsBlock`/`readRunsBlock`/`readAiBlock`
  + `aggregateAlertsByDayInRange` + `aggregateFinalizedRunsByDayAndStatusInRange`
  din PR-A si PR-B, iar pentru timeline-ul windowed introduce 3 helperi noi in
  `dashboardActivityRepository.ts`: `listAlertsInRange`, `listFinalizedRunsInRange`,
  `listCuratedAuditInRange` (closed `[since, until]`, ordering DESC pe `(ts, id)`,
  acelasi `CURATED_AUDIT_ACTIONS` allowlist + `outcome != 'ok'` catch-all).
- Validare interval: `range` trebuie sa fie `7d` sau `30d`, altfel 400 cu
  envelope `error.code="invalid_range"` (acelasi pattern ca `/charts`).
- Merge in JS al timeline-ului cu sort `ts DESC` + tiebreak `id DESC`,
  identic cu cel folosit la `/timeline` (acelasi `mergeAndSliceTimeline`-style
  cod inline ca sa pastram comportament unitar).

**Frontend - dashboardApi.report:**

- Metoda noua `dashboardApi.report({range?, signal?})` in `lib/dashboardApi.ts`
  (range default `7d`, suporta `AbortSignal` ca toate celelalte). Tipuri noi
  exportate: `ReportTimelineBlock` si `DashboardReportPayload`. Re-exportate
  prin barrel-ul `lib/api.ts` ca import-urile sa ramana centrate.

**Frontend - builder-i `buildReportXlsx` + `buildReportPdf`:**

- Modul nou `lib/export-report.ts` - 2 builderi puri (fara DOM, ruleaza in
  worker) pentru XLSX si PDF. XLSX: 3 sheet-uri ("Sumar" cu 13 KPI-uri formatate,
  "Activitate zilnica" cu 9 coloane day x metrics, "Cronologie" cu evenimente
  expandate inclusiv detail JSON serializat la 800ch cap), styling reuzat din
  `excel-helpers.ts` (BLUE_DARK title, BLUE_MAIN header, alternate row, ROW_ALT)
  + `sanitizeFormulaCells` pe toate cele 3 sheet-uri (formula-injection guard).
  PDF: landscape A4 helvetica cu titlu, sumar table (3 col), activitate zilnica
  table (9 col), cronologie table pe pagina noua (4 col), `stripDiacritics` pe
  text RO, footer "Pagina N", nota italica daca `truncated=true`.
- Filename pattern `raport_dashboard_<range>_<dataRO>.<ext>`.
- `ExportJob` extins cu kind-uri `reportXlsx` + `reportPdf`, dispatch wired in
  `export.worker.ts` ca buildurile sa nu blocheze main thread-ul nici pe 30d
  range cu sute de evenimente.
- Orchestratori `exportReportXlsx` + `exportReportPdf` adaugati in `export.ts`
  (round-trip prin worker + `triggerDownload` pe main thread).

**Frontend - ReportExportModal + QuickActions wiring:**

- Componenta noua `components/dashboard/ReportExportModal.tsx` - modal
  controllat de parent (open/onClose) cu picker interval (segmented control
  7d/30d) si format (XLSX/PDF). Generate: ruleaza fetch raport prin
  `dashboardApi.report` + delega builderul ales catre worker. State `busy`
  blocheaza inputurile + arata `Loader2` spin pe butonul de generare; `error`
  inline; ESC inchide cand nu e in lucru; click pe overlay inchide; cleanup
  pe unmount aborteaza request-ul. Accesibil: `role="dialog"`, `aria-modal`,
  `aria-labelledby`, buton X cu `aria-label`.
- `QuickActions` rescris ca state `reportOpen` + buton "Export raport" pe
  `<button onClick>` (nu mai e disabled), iconul slate `FileDown`. Restul
  butoanelor raman `<Link>`-uri react-router; signature-ul `QuickAction`
  acum poate purta fie `to` (link), fie `onClick` (handler).

**Tests - 645/645 verzi:**

- 5 teste noi in `routes/dashboard.test.ts` pentru `/report`:
  - envelope shape + empty state (timeline empty, charts backfilled la 7 zile,
    summary zerourat, `truncated:false`).
  - `range=42d` -> 400 cu `error.code="invalid_range"`.
  - `range=30d` extinde grid-ul charts la 30 zile (toate cele 3 serii).
  - timeline merge alerts + finalized runs + curated audit cu order DESC
    verificat (1 alert + 1 run + 1 audit = 3 events, ordering monotonic).
  - owner isolation pe ambele blocks (timeline + charts) - bob-ul nu trebuie
    sa apara in raportul lui alice.
- Total: 640 baseline din v2.8.0 + 5 noi = 645.

---

## [2.8.0] - 2026-05-02

### PR-B v2.8.0 - Dashboard timeline + charts (din sprint-ul de redesign)

A doua livrare din 3 (PR-A v2.7.0 KPI strip + Quick Actions, PR-C v2.9.0
Export raport). Inlocuieste blocul static "TIPURI DE PROCESE DISPONIBILE"
de pe Dashboard cu doua surfaces operationale, alimentate de doua endpoint-uri
noi din `/api/v1/dashboard`.

**Backend - timeline cursor-paginated:**

- Endpoint nou `GET /api/v1/dashboard/timeline?cursor=<isoTs>&limit=<n>`
  (owner-scoped via `getOwnerId`, wrapped in `withMaintenanceRead` ca sa
  coexiste cu backup/restore). Returneaza un stream descrescator combinat din
  3 surse: `monitoring_alerts.created_at`, `monitoring_runs.ended_at` (doar
  finalizate), `audit_log.ts` (curated set + outcome != 'ok' catch-all).
  Cursor strict `<` mentine pagini stabile cand 2 evenimente au acelasi ms;
  `nextCursor=null` cand pagina returneaza mai putin de `limit` events.
  `limit` clamp `[1,100]`, default 30. Fiecare sursa e query-ita independent
  cu `LIMIT N` apoi merged in JS si sliced — worst case 3*N rows / pagina,
  cheap pentru N≤100.
- `CURATED_AUDIT_ACTIONS` (auth.denied + monitoring delete + name_list
  commit + admin user/quota writes + aviz/backup/search destructive ops +
  backup.restore). Audit cu `outcome != 'ok'` apare in stream chiar si daca
  actiunea nu e in lista (defense in depth).
- Severity mapping pentru randul timeline: alert.severity → direct;
  run.status → ok=info / error=critical / timeout=warning / aborted=info;
  audit.outcome → ok=info / denied|error=warning, dar `auth.denied` bumpat
  la critical ca sa pop-uiasca.

**Backend - charts daily series:**

- Endpoint nou `GET /api/v1/dashboard/charts?range=7d|30d` (owner-scoped,
  withMaintenanceRead). Returneaza 3 serii zilnice aliniate pe acelasi
  UTC-day grid (`utcDayStart` din aiUsageRepository, ca sa partajeze X-axis
  cu AIUsagePanel):
  - `alerts[]` cu `{day, count}`
  - `runs[]` cu `{day, ok, error, timeout, aborted, total}` (pivot
    per-day-per-status → per-day cu 4 buckets)
  - `aiCost[]` cu `{day, costUsd, calls, tokens}` (`cost_usd_milli/1000`)
  Closed lower bound `ts >= since` aliniat cu conventia din PR-7. Backfill
  cu zero pe zilele lipsa ca chart-ul sa afiseze linie continua.
- Repository nou `dashboardActivityRepository.ts` separat de per-table CRUD
  repos: timeline merge-uieste 3 surse cu shape-uri non-reusable, daily
  aggregations sunt consumate doar de dashboard. Splitting-ul tine repo-urile
  per-tabela focusate pe row CRUD si nu drag-uieste tipuri dashboard-shaped
  in ele.

**Frontend - Timeline component:**

- `components/dashboard/Timeline.tsx`: card cu lista descrescatoare de
  evenimente, refresh button + paginatie cursor-based ("Incarca mai multe").
  Iconita per kind (`Bell`/`PlayCircle`/`Shield`) + pill colorat per
  severity. Subline contextual per kind: run = `duration_ms` + `alerts_created`
  + `error_code`; alert = `numar_dosar` sau `nume` din `job_target`; audit =
  `outcome` + `target_kind:target_id`. Click pe alert linkeaza catre `/alerte`.
- Relative time auto-tick (`{n}s/m/h/z in urma`) cu `setInterval(60_000)` ca
  rendarea sa nu fie statica. Dedup defensiv pe id la "Incarca mai multe"
  pentru same-ms ties.

**Frontend - Charts component:**

- `components/dashboard/Charts.tsx`: card cu segmented control 7d/30d +
  refresh, 3 charts side-by-side (lg:grid-cols-3, stacked pe mobile):
  - Alerte/zi (BarChart amber)
  - Rulari/zi (BarChart stacked: ok=verde, erori=rosu, timeout=portocaliu,
    oprite=mov; legend interactive)
  - Cost AI/zi (AreaChart sky cu gradient, identic stilistic cu AIUsagePanel)
- `lib/chart-colors.ts`: 5 culori noi (`alerts`, `runOk`, `runError`,
  `runTimeout`, `runAborted`) ca single source of truth — re-theming sau
  dark-mode chart variants se modifica intr-un singur loc.
- Date format UTC-anchored (`new Date('YYYY-MM-DDT00:00:00Z')` + `timeZone:
  "UTC"` pe `toLocaleDateString`) ca eticheta zilei sa nu shift-eze cu o zi
  pe utilizatorii din alte timezone-uri.

**Frontend - Dashboard wiring:**

- `pages/Dashboard.tsx`: blocul static `tipuriProces` (7 chips Penal/Civil/
  Contencios/etc.) eliminat complet, inlocuit cu `<Charts />` + `<Timeline />`
  intre `LastRnpmCard` si "Informatii API + Versiune". Ambele componente fac
  fetch propriu (NU primesc data prin props) ca pagina Dashboard sa nu
  orchestreze 3 traseuri intr-un singur effect — KPI strip ramane separat la
  polling 30s.

**Frontend API surface:**

- `lib/dashboardApi.ts` extins cu `timeline(opts)` + `charts(opts)`. Toate
  query params (`cursor`, `limit`, `range`) optionale, AbortSignal propagat.
  Tipuri publice (`TimelineEvent`, `TimelineEventKind`, `TimelinePayload`,
  `ChartsRange`, `ChartsAlertsPoint`, `ChartsRunsPoint`, `ChartsAiPoint`,
  `ChartsPayload`) re-exportate prin `lib/api.ts` ca toate paginile sa
  importe din barrel-ul existent.

**Migration:** zero noi (nu schimba schema; toate query-urile noi merg pe
indexuri existente — `monitoring_alerts (owner_id, created_at)`,
`monitoring_runs (owner_id, ended_at)` — adaugate in v2.7.0 prin `0013`).

**Tests:** 640/640 verzi (591 baseline din v2.7.0 + 49 noi distribuite intre
`routes/dashboard.test.ts` si suite-urile auxiliare). Coverage nou: timeline
envelope + paginatie cursor + 3-source merge + audit curation; charts daily
backfill + UTC alignment + range validation + owner isolation.

---

## [2.7.1] - 2026-05-02

### Patch - icon Legal Dashboard pe taskbar in dev mode

Fix mic dar vizibil: pana acum, `npm run electron:dev` afisa icon-ul implicit
Electron (atom) in taskbar Windows in loc de icon-ul aplicatiei. Build-ul
NSIS instalat avea icon-ul corect (electron-builder injecteaza AUMID si
shortcut-uri Start Menu), dar dev mode nu — Windows nu putea rezolva
`appUserModelId` la un icon fara un shortcut inregistrat.

**Electron - shortcut Start Menu auto-generat in dev mode:**

- `electron/main.js`: helper nou `ensureDevTaskbarShortcut()` apelat in
  `app.whenReady()`. Skip pe pachetele NSIS (`app.isPackaged`) si pe
  non-Windows. Creeaza per-user `Legal Dashboard (Dev).lnk` in Start Menu cu
  `target=process.execPath`, `args="<projectRoot>"`, `icon=build/icon.ico`,
  `appUserModelId="ro.legaldashboard.app"`. Idempotent: skip daca shortcut-ul
  exista deja. Erorile sunt try/catch + `console.warn` (nu blocheaza boot-ul).

**De ce e nevoie de shortcut:** Windows leaga AUMID-ul declarat de
`app.setAppUserModelId(...)` la icon-ul declarat in shortcut-ul Start Menu cu
acelasi AUMID. Fara shortcut, taskbar-ul foloseste icon-ul executabil-ului
(electron.exe), nu icon-ul aplicatiei. Pe build-ul NSIS, electron-builder
genereaza shortcut-ul automat la install — dev mode nu trecea prin acel
flow, deci shortcut-ul nu exista.

**Operational:** primul `npm run electron:dev` dupa update creeaza
shortcut-ul si apoi taskbar-ul afiseaza icon-ul corect (poate fi nevoie de
restart Explorer la prima rulare, daca Windows cache-uieste icon-ul vechi).
Restart-urile ulterioare reuseaza shortcut-ul existent.

**Tests:** zero teste noi (boot-time helper, fara regresie pe paths
existente). Build NSIS neafectat.

---

## [2.7.0] - 2026-05-02

### PR-A v2.7.0 - KPI strip + Quick Actions pe Dashboard

Prima livrare din sprint-ul de redesign al Dashboard-ului
(PLAN-dashboard-redesign.md). Aduce un rezumat operational live deasupra
cardurilor existente, fara sa schimbe nimic din fluxurile actuale.

**Backend - endpoint nou `/api/v1/dashboard/summary`:**

- `backend/src/routes/dashboard.ts`: endpoint owner-scoped care agrega 4
  blocuri intr-o singura cerere - joburi active (cu breakdown
  `dosar_soap`/`name_soap`), alerte (necitite + ultimele 24h), rulari
  ultimele 24h (ok / error / timeout / total, cu `aborted` foldat in error),
  cost AI ultimele 24h (USD + calls + total tokens).
- Wrapped in `withMaintenanceRead` ca sa coexiste cu backup/restore (RWLock).
- Fereastra de 24h calculata server-side cu `closed lower bound` consecvent
  cu pattern-ul din `aiUsageRepository.getAiUsageTotals` - fara off-by-one.
- Envelope v1 standard `{ data, requestId }` via `ok()` helper; nu adauga
  endpoint-uri de scriere (read-only aggregation).

**Frontend - KPI strip + Quick Actions deasupra Last cards:**

- `frontend/src/components/dashboard/KpiStrip.tsx`: 4 carduri responsive
  (mobile stacked -> md 2 col -> lg 4 col) cu icon + label + valoare +
  subline contextuala ("+N noi in ultimele 24h", "M ok / X erori / Y
  timeout"). Loading state cu spinner per card; error state inline (nu
  blocheaza restul paginii).
- `frontend/src/components/dashboard/QuickActions.tsx`: 6 butoane spre
  fluxurile principale (Cauta dosar, Adauga monitorizare, Cauta RNPM, Vezi
  alerte, Vezi termene). Al saselea (Export raport) ramane disabled cu
  tooltip "Disponibil in v2.9.0 (PR-C)" - placeholder onorat pana cand PR-C
  livreaza modal-ul de raport on demand.
- `frontend/src/pages/Dashboard.tsx`: integrate KpiStrip + QuickActions
  inserate deasupra `LastDosareCard`. Polling la 30s prin `setInterval` cu
  `AbortController` per request (coalesce overlap pe sleep/wake). SSE delta
  pe `alerts.unseen` ramane pentru PR-B impreuna cu plumbing-ul
  `alertsStreamVersion` din App.tsx.

**Frontend API surface:**

- `frontend/src/lib/api.ts`: tipurile `DashboardSummary`,
  `Dashboard{Jobs,Alerts,Runs,Ai}Block` + obiectul
  `dashboardApi.summary(signal?)` care reuseste `unwrapMonitoring` si
  `MonitoringApiError` pentru consistenta cu restul suprafetei v1.

**Tests:**

- `backend/src/routes/dashboard.test.ts`: 7 teste - envelope shape, empty
  state, jobs.byKind (active filter), alerts.unseen vs last24h windowing,
  runs status bucketing (cu `aborted` in error + still-running excluse), AI
  aggregation (calls + tokens + costUsd din milli), izolare `owner_id`
  (doua tenants concurente). 553/553 backend tests verzi (era 546 baseline
  in v2.6.8, +7 noi in PR-A).

### PR-9 v2.7.0 - Auth pluggable seam (desktop noop / web JWT)

A doua livrare mergeata in v2.7.0 (commit `61580a4` pe main). Codex livreaza
seam-ul de autentificare separat de cutover-ul web complet (PR-10..PR-12
raman in viitor). Desktop pastreaza identitatea `local` 1:1, `web` mode
devine opt-in tehnic cu JWT validation fail-closed.

**Backend - auth provider interface:**

- `backend/src/auth/authProvider.ts`: `AuthProvider` interface cu doua
  implementari - `DesktopAuthProvider` (returneaza `local`/`local`) si
  `WebJwtAuthProvider` (cere Bearer token sau cookie `legal_dashboard_session`,
  valideaza HS256 cu `jose`, verifica issuer + audience, valideaza userul in
  DB cu status `active`).
- `backend/src/auth/jwt.ts`: `verifyAuthToken({ secret, issuer, audience })`
  - codes interne: `jwt_expired`, `jwt_invalid_audience`, `jwt_invalid_issuer`,
  `jwt_invalid_signature`, `jwt_malformed`. Codes interne sunt logate via
  `console.warn`; raspunsul public foloseste `unauthorized` ca sa nu leak-uiasca
  detalii catre atacatori.
- `backend/src/auth/config.ts`: `getAuthMode()` (default `desktop`),
  `validateAuthConfig()` care arunca daca `JWT_ISSUER`/`JWT_AUDIENCE` lipsesc
  in `web` mode, `firstNonEmpty()` helper accepta atat `LEGAL_DASHBOARD_*`
  cat si nume neprefixate, `isAuthCookieSecureDisabled()` arunca eroare la
  boot daca `AUTH_COOKIE_SECURE=0` in productie (doar warn in dev).

**Backend - middleware ownerContext:**

- `backend/src/middleware/owner.ts`: `ownerContext()` apeleaza provider-ul
  curent, set-eaza `c.set("ownerId"|"actorId"|"authUser", ...)`.
- Pe orice respingere de auth (401/403): apeleaza `recordAudit(null,
  "auth.denied", { ownerId: null, actorId: null, outcome: "denied",
  targetKind: "http_request", targetId: c.req.path, ip, userAgent, detail:
  { requestId, method, code, status } })` wrapped in try/catch (audit failure
  nu blocheaza raspunsul).
- Mesajele auth sunt traduse in romana, raspunsurile folosesc envelope-ul
  standard `fail()` cu `requestId`.

**Backend - rate-limit pre-auth:**

- `backend/src/middleware/rate-limit.ts`: predicat fix - `releasePreAuthAttempt(key)`
  se apeleaza doar pe 2xx (era inversat - decrementa counter pe ne-2xx, ceea
  ce nega scopul).
- Mesaj tradus: "Prea multe cereri neautentificate".

**Backend - rute auth:**

- `backend/src/routes/auth.ts`: `POST /api/v1/auth/login` returneaza 501
  `not_implemented` cu pointer catre PR-10 (SSO se livreaza in cutover-ul
  web real). `POST /api/v1/auth/logout` sterge cookie-ul de sesiune.
- Cookie-ul de sesiune se construieste prin `secureCookie()` care respecta
  `AUTH_COOKIE_SECURE` cu hard error in productie cand e dezactivat.

**Backend - migration 0013:**

- `backend/src/db/migrations/0013_idx_runs_owner_ended.up.sql`: index nou
  `idx_runs_owner_ended ON monitoring_runs(owner_id, ended_at DESC) WHERE
  ended_at IS NOT NULL` pentru queries de stats (24h windows in dashboard
  summary).
- Down migration drop-uieste indexul.

**Backend - dashboard runs.aborted ca bucket separat (post-review fix):**

- `backend/src/routes/dashboard.ts`: schema `RunsBlock` are camp nou
  `aborted: number`. `readRunsBlock` NU mai foldeaza `aborted` in `error`
  (era pierdere semantica - run-urile abortate manual nu sunt erori).
- `backend/src/db/monitoringRunsRepository.ts`: query separat pentru
  `aborted` count.

**Frontend - KPI strip arata aborted separat:**

- `frontend/src/lib/api.ts`: `DashboardRunsBlock` interface gained `aborted:
  number`.
- `frontend/src/components/dashboard/KpiStrip.tsx`: subline arata
  `"X ok / X erori / X timeout / X oprite"` cu tooltip explicativ.

**Tests - 591 pass (553 baseline PR-A + 38 noi):**

- `backend/src/auth/jwt.test.ts`, `backend/src/auth/config.test.ts`,
  `backend/src/middleware/owner.test.ts`, `backend/src/middleware/rate-limit.test.ts`,
  `backend/src/routes/auth.test.ts`, `backend/src/routes/dashboard.test.ts` -
  acopera P0/P1: JWT validare iss+aud, missing/invalid token, account_inactive,
  rate-limit predicate fix, auth.denied audit, cookie secure flag, pre-auth
  bucket, dashboard aborted bucket. 591/591 backend verzi.
- `tsc --noEmit` backend si frontend verzi, `biome check` verde, `npm run
  build` (backend CJS + frontend Vite) verde, smoke desktop boot OK -
  `/api/v1/me`, `/api/v1/dashboard/summary`, `/api/v1/alerts/stream` toate 200.

**Co-developat cu PR-A pe main:**

- `c74a77e` PR-A v2.7.0 Dashboard redesign (squashed 4 commits in 1).
- `61580a4` PR-9 audit pack 2026-05-02 - B1-B4 + P0/P1 tests + docs sync.
- `579ce7b` PR-A + PR-9 review hardening (Tier 1 + Tier 2 + 0013 migration).

---

## [2.6.8] - 2026-05-01

### Review-driven hardening: HTML a11y + template fragility + doc accuracy

Patch de polish post-review pe diff-ul v2.6.7. Trei probleme reale gasite la
verificarea unor nitpick-uri automate; aplicate strict 1:1 fara scope creep.

**Frontend - fix HTML button nesting (Monitorizare bulk import header):**

- `frontend/src/pages/Monitorizare.tsx`: cardul "Adaugare bulk din fisier"
  folosea `<button>` ca wrapper peste `<CardHeader>` (div) si `<CardTitle>`
  (h3). HTML interzice block-elemente in `<button>` — invalid markup +
  comportament a11y inconsistent intre browsere.
- Fix: handler-ul (toggle deschide/inchide) muta direct pe `<CardHeader>` cu
  `role="button"` + `tabIndex={0}` + `onClick` + `onKeyDown` (Enter / Space cu
  `preventDefault`). Pastrat `aria-expanded` + `aria-controls`. Adaugat
  `focus-visible:ring-2 focus-visible:ring-ring` ca focus-ul de la tastatura
  sa fie vizibil.

**Frontend - derivare `CADENCE_COL_LETTER` din `HEADERS`:**

- `frontend/src/lib/monitoringBulkTemplate.ts`: literalul `"C"` inlocuit cu
  `colIndexToLetter(HEADERS.indexOf("cadence_sec"))`. Reordonarea coloanelor
  in `HEADERS` nu mai poate sa desincronizeze silent dropdown-ul de cadenta
  injectat in OOXML (ar fi inceput sa pointeze pe coloana gresita fara nicio
  eroare la build sau la runtime).
- Helper nou `colIndexToLetter(idx)` (0-based → A, B, ..., Z, AA, ...) in
  acelasi fisier; bazic, fara dep noua. Boot-time guard
  (`throw new Error(...)` cand `cadence_sec` lipseste din `HEADERS`) ca
  simptomul sa apara la primul download al template-ului, nu silent in Excel.

**Frontend - eroare vizibila pentru fisier bulk fara header recunoscut:**

- `frontend/src/lib/monitoringBulkTemplate.ts:parseBulkFile`: cand
  `findHeaderRow(matrix) < 0`, in loc de `return { valid, invalid }` silent
  (utilizatorul vedea zero valid + zero invalid si presupunea ca fisierul e
  gol), parser-ul push-uieste o intrare in `invalid` cu mesaj clar — "Header
  lipsa: fisierul nu contine niciuna dintre coloanele recunoscute (numar_dosar,
  nume, name_normalized, denumire). Descarca template-ul si reincearca." UI-ul
  care afiseaza `invalid[]` are acum un semnal de eroare in loc de "0 randuri".

**Docs - corectare claim stale despre `xlsx@0.18.5`:**

- `SESSION-HANDOFF.md` lines 235-236 spuneau "xlsx@0.18.5 ramane risc acceptat
  temporar, documentat si mitigat prin limite stricte" — invalid post-v2.6.4
  (parser-ul `nameListParser.ts` a fost migrat pe `exceljs@^4.4.0`, `xlsx`
  mutat in `devDependencies`). Rescris cu adevarul curent: nu mai e pe path-ul
  de parsare a inputului user, ramane folosit doar tranzitiv pe path-ul
  write-only prin `xlsx-js-style` si in fixturile de test.

**Style commitment - structured-section pe entries noi:**

- Pe future CHANGELOG / STATUS / ROADMAP / SESSION-HANDOFF entries, sectiunile
  vor fi structurate cu sub-headere bold (`**Frontend:**`, `**Backend:**`,
  `**Tests:**`, etc.) in loc de paragrafe monolitice. Entries istorice nu se
  retrofiteaza — costul de mentenanta depaseste beneficiul.

### Verificari

- `npx tsc --noEmit` (frontend) → OK, fara erori noi.
- `npm run build` (root) → frontend build complet (15.64s), backend bundle
  4.0mb, fara erori noi. Doar warning-ul existent pentru chunks > 500kb.
- Manual: `/monitorizare` → cardul "Adaugare bulk din fisier" se deschide cu
  click si cu Enter/Space; `aria-expanded` toggle confirmat; focus ring
  vizibil la tastatura.

### Fisiere modificate

- `frontend/src/pages/Monitorizare.tsx` — 3 linii structurale (button → div
  role=button), +5 linii (onKeyDown).
- `frontend/src/lib/monitoringBulkTemplate.ts` — +14 linii (helper
  `colIndexToLetter` + derivare `CADENCE_COL_LETTER`), +9 linii (push pe
  `invalid` la header lipsa).
- `SESSION-HANDOFF.md` — 2 linii rescrise.

### Risc / regression surface

- Zero modificari pe backend, repository sau scheduler — pur frontend
  additive + un text in MD. Aceleasi librarii in bundle.
- Tests: 546/546 backend raman verzi (modificarile sunt strict frontend +
  un fisier MD).

---

## [2.6.7] - 2026-05-01

### Export Monitorizare (Excel + PDF) — paritate cu Dosare/Termene

Pana acum pagina Monitorizare nu avea export, desi colega ei Dosare si Termene
ofereau XLSX + PDF. Patch-ul aduce paritate: aceeasi suprafata UI, aceleasi
template-uri stilizate, acelasi flow Web Worker.

### Frontend - butoane export in CardHeader "Joburi active"

- `frontend/src/pages/Monitorizare.tsx`: doua butoane `Excel` + `PDF` adaugate
  langa actiunea destructive existenta (`Sterge selectate`). Vizibile cand
  `jobs.length > 0`. State partajat `exporting: "xlsx" | "pdf" | null` dezactiveaza
  ambele butoane in timpul generarii si afiseaza `Loader2` spin pe butonul activ.
  Cand `selectedIds.size > 0`, butoanele exporta doar selectia (suffix `(N)`),
  altfel exporta toate joburile vizibile — pattern identic cu `DosareTable`.
- Helperi noi: `getExportJobs()` (selectie sau toate) si `handleExport(kind)`
  (cu try/finally + reset state). Erorile se afiseaza in banner-ul `error`
  existent al paginii.

### Frontend - builderi pure pe Web Worker

- `frontend/src/lib/export.ts`: `buildMonitoringXlsx(jobs)` si
  `buildMonitoringPdf(jobs)` adaugati. **Design identic cu Termene/Dosare** —
  XLSX-ul foloseste `BLUE_DARK` pentru titlu (`PORTALJUST DASHBOARD —
  MONITORIZARE`), `BLUE_MAIN` pentru header, `ROW_ALT/WHITE` alternativ pe
  randuri, font 10, helperii `styleTitle/styleStats/styleHeader/styleDataCell`
  partajati. PDF-ul ruleaza in `landscape` A4, `helvetica`, header
  `[37,99,235]`, alternateRowStyles `[245,247,250]`, footer "Pagina N" — exact
  ca exporturile Termene si Dosare.
- 8 coloane: `#`, `Tinta`, `Tip`, `Cadenta`, `Ultima rulare`, `Urmatoarea verif.`,
  `Status`, `Note`. `formatMonitoringTarget(job)` reuseste helperul existent
  din `lib/api.ts`; cadenta umanizata (4h, 24h, 7z, 30min); status combina
  `active` (activ/pauza) cu `last_status` (ok/error/partial/skipped).
- `sanitizeFormulaCells(ws)` aplicat pe XLSX (formula-injection guard pe
  `=+-@\t\r`), `stripDiacritics` pe PDF (jsPDF default font nu suporta
  diacritice).
- Filename pattern: `monitorizare_<target>.xlsx` cand exporti un singur job
  (sanitizat), `monitorizare_<dataRO>.xlsx` cand exporti mai multe — consecvent
  cu `dosare_*` si `termene_*`.

### Frontend - worker dispatcher

- `frontend/src/lib/export.worker.ts`: doua case-uri noi `monitoringXlsx` si
  `monitoringPdf` in switch-ul existent. ExportJob discriminated union extins
  cu cele doua kind-uri. UI-ul ramane responsiv pe runs cu sute de joburi
  (build-ul nu blocheaza main thread-ul).

### Verificari

- `npx tsc --noEmit` (frontend) → OK
- `npm run build` → 13.94s build complet, fara erori, doar warning-ul existent
  pentru `export.ts` static + dinamic import
- Manual: butoane vizibile pe `/monitorizare`, exportul descarca fisier
  corect numit, Excel-ul deschis in Office afiseaza titlul stilizat, PDF-ul
  deschis in viewer afiseaza tabelul cu paginare

### Fisiere modificate

- `frontend/src/pages/Monitorizare.tsx` — imports, state, helperi, butoane
- `frontend/src/lib/export.ts` — `buildMonitoringXlsx`, `buildMonitoringPdf`,
  `exportMonitoringExcel`, `exportMonitoringPDF`, `monitoringFilename` +
  helperii pentru cadenta/data/kind/status
- `frontend/src/lib/export.worker.ts` — dispatch cases noi

### Risc / regression surface

- Zero modificari pe backend, repository sau scheduler — pur frontend additive.
- Niciun test backend afectat (546/546 raman verzi). Aceleasi librarii
  `xlsx-js-style` si `jspdf`/`jspdf-autotable` deja in bundle.

---

## [2.6.6] - 2026-05-01

### UX polish Monitorizare — name_soap parity

Patch frontend-only peste v2.6.5. Doua frecari minore ramase pe inbox-ul
Monitorizare dupa polish-ul TINTA: randurile `name_soap` (subiectii din bulk
import) nu aveau buton de cautare in-app, iar coloana TIP afisa "Subiect" desi
formularul de adaugare si template-ul XLSX folosesc consecvent termenul "Nume".

### Frontend - Dosare button pe randuri name_soap

- `frontend/src/pages/Monitorizare.tsx` (linia ~705): randurile cu
  `job.kind === "name_soap"` randeaza acum target-ul (numele subiectului) in
  `font-bold` urmat de un buton `Dosare` cu pictograma `Eye`, identic vizual cu
  butonul de pe randurile `dosar_soap`. Click → `onOpenName(target)` →
  `navigate("/dosare")`. Pattern consecvent: orice TINTA din inbox-ul de
  monitorizare ofera o scurtatura catre cautarea in-app.
- `frontend/src/App.tsx` (linia ~295): prop nou `onOpenName` propagat ca
  `handleHistoryClick("dosare", { numeParte: nume })`. SearchParams accepta
  deja optional `numeParte`, deci `pendingSearch` flow-ul existent
  (Dosare → auto-search) functioneaza fara modificari pe `Dosare.tsx`.

### Frontend - "Subiect" → "Nume" in coloana TIP

- `frontend/src/pages/Monitorizare.tsx` (linia ~743): label-ul afisat pentru
  joburi `name_soap` schimba "Subiect" → "Nume" pentru consecventa cu
  formularul de adaugare (`MonitoringAddForm` foloseste "nume") si cu coloana
  `nume` din template-ul XLSX (v2.6.5). Restul kind-urilor raman neschimbate
  (`dosar_soap` → "Dosar", `aviz_rnpm` → "Aviz RNPM").

### Frontend - swap coloane "Ultima rulare" / "Urmatoarea verif."

- `frontend/src/pages/Monitorizare.tsx`: ordinea coloanelor in tabel devine
  **Ultima rulare → Urmatoarea verif.** (era invers). Citirea naturala in
  cazul unui inbox de monitorizare este "ce s-a intamplat ultima oara, apoi
  cand verific din nou" — coloana cu fapte (last_run_at) inainte de cea cu
  predictia (next_run_at). Swap-ul atinge atat header-ul cat si celulele
  `<td>`, fara modificari la datele transmise de API sau la formatare.

### Tests

- 546 teste pass (neschimbate fata de v2.6.5 — modificarile sunt strict
  frontend label + render path, fara backend touch).

---

## [2.6.5] - 2026-05-01

### UX polish Monitorizare

Patch frontend-only peste v2.6.4. Inbox-ul Monitorizare primeste un val de polish
in zona vizibilitatii joburilor: link-ul TINTA devine vizual prima ancora din
rand (bold), cardul de bulk import nu mai ocupa permanent jumatate din pagina
(devine collapsible cu default colapsat), template-ul XLSX descarcat nu mai e
un grid plain ci match-uieste vizual celelalte exporturi Excel din aplicatie,
iar notele introduse la creare sau import devin in fine vizibile in tabel
(erau write-only — stocate dar niciodata redate).

### Frontend - Monitorizare TINTA bold

- `frontend/src/pages/Monitorizare.tsx` — link-ul `<a>` din coloana TINTA
  pentru joburi `dosar_soap` schimba `font-medium` → `font-bold`. Numarul
  dosarului devine prima ancora vizuala din rand (consecvent cu pattern-ul
  "primary action surface" din inbox-ul Alerte).

### Frontend - bulk import collapsible + descriere non-tehnica

- Cardul "Adaugare bulk din fisier" din `Monitorizare.tsx` foloseste acum un
  state `bulkOpen` (default `false`) si afiseaza un buton clickable pe header
  cu icon `ChevronDown`/`ChevronRight`. `<CardContent>` se randeaza condional
  doar cand cardul e deschis — pagina nu mai pierde un screenful pentru o
  zona pe care utilizatorul o foloseste rar.
- Descrierea cardului trece de pe `text-muted-foreground` (gri pal) pe
  `text-foreground` (negru/inversa pe dark mode) pentru lizibilitate, iar
  textul tehnic ("XLSX/CSV cu numar_dosar / nume / cadence_sec / notes…") se
  rescrie in romana simpla pentru utilizatori non-tehnici: explica fluxul
  in trei pasi (descarca template → completeaza → incarca), fara mentiunea
  numelor de coloane.

### Frontend - template XLSX restilizat la nivelul exporturilor

- `frontend/src/lib/monitoringBulkTemplate.ts` rescris sa foloseasca
  `xlsx-js-style` (dinamic import) cu acelasi limbaj vizual ca restul
  exporturilor Excel din aplicatie (`excel-helpers.ts`). Layout-ul:
  - **Row 1** — titlu "Template Adaugare Bulk Monitorizare" merged pe
    coloanele A:E, font 13 bold alb, fill `BLUE_DARK`, centrat.
  - **Row 2** — caption "Generat la <data RO> · adauga maxim 1000 randuri"
    italic gri pe fundal `F1F5F9`.
  - **Row 4** — header BLUE_MAIN, alb bold, border-bottom `1D4ED8`,
    `wrapText`. Coloanele: `numar_dosar`, `nume`, `cadence_sec`, `instanta`,
    `notes`.
  - **Row 5+** — alternating row fill (`ROW_ALT` pe randurile impare,
    `WHITE` pe pare), font 10 plain, `vertical: top`, `wrapText`.
- Constant nou `TEMPLATE_FONT_SIZE = 10` aplicat consecvent pe header / data
  / stats. Latimi de coloane recalibrate (16ch numar_dosar, 28ch nume, 12ch
  cadence_sec, 18ch instanta, 30ch notes).
- Dropdown-ul de validare `cadence_sec` se aplica acum pe range `C5:C1004`
  (era `C2:C1001` pe template-ul vechi flat) — post-process OOXML cu
  `fflate` ca `xlsx-js-style` nu emite `<dataValidations>` direct.
- `parseBulkFile` detecteaza header-ul dinamic prin `findHeaderRow()` —
  scaneaza primele 20 randuri si identifica primul rand cu `numar_dosar`,
  `nume`, `name_normalized` sau `denumire`. Fisierele exportate cu
  template-ul nou (header pe row 4) si fisierele vechi flat (header pe
  row 1) sunt ambele acceptate fara forking de path.
- `downloadBulkTemplate` devine `async` (necesita `await import()` pe
  `xlsx-js-style` + `fflate`) — toate apelurile de pe pagina updated cu
  `await`.

### Frontend - note inline sub TINTA (Varianta B)

- Field-ul `notes` din formularul de monitorizare era write-only — colectat
  in UI, persistent in `monitoring_jobs.notes`, dar niciodata vizibil in
  tabelul de joburi. Patch-ul afiseaza nota in **aceeasi celula TINTA**, sub
  link+buton, pe randurile cu `job.notes` populat:
  - render conditionat (`{job.notes && (…)}`) — randurile fara nota raman
    compacte, fara spatiu in plus si fara coloana noua.
  - `text-xs italic text-muted-foreground` (gri italic, font sm) +
    `font-sans` ca sa rupa mostenirea `font-mono` din `<td>`.
  - `truncate max-w-[420px]` cu `title={job.notes}` pentru tooltip pe hover
    (textul integral disponibil fara modal).
- Variant respinsa: coloana separata "Note" intre Status si Actiuni —
  introducea spatiu mort pe randurile fara nota si crestea latimea totala a
  tabelului in zona deja crowded.

### Tests

- 546 teste pass (neschimbate fata de v2.6.4 — modificarile sunt strict
  frontend + un singur helper de parse fara backend touch).

---

## [2.6.4] - 2026-05-01

### Audit hardening (multi-agent review) — finalizat

- **F1**: DELETE monitoring job verifica scheduler in-flight, returneaza 409 daca jobul ruleaza activ; previne RUNNER_THREW cand userul sterge in timpul SOAP.
- **F2 (hard fail)**: `LEGAL_DASHBOARD_ALLOW_REMOTE=1` sau HOST non-loopback REFUZA pornirea daca nu e prezent ack explicit `LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet`. Suplimentar, middleware `originGuard` pe `/api/*` blocheaza requesturi state-changing (POST/PUT/PATCH/DELETE) cu Origin/Referer mismatch fata de Host pentru caller-i non-loopback. Bypass automat pentru loopback (desktop la el insusi) si pentru metode safe (GET/HEAD/OPTIONS).
- **F3 (xlsx → exceljs)**: backend `nameListParser.ts` migrat de pe `xlsx@0.18.5` (CVE Prototype Pollution + ReDoS, no upstream fix) pe `exceljs@^4.4.0`. `parseNameList` devine `async`, ruleaza cu safety belt 30s timeout pe parse (Promise.race) si pastreaza limitele MAX_FILE_BYTES / MAX_ROWS / MAX_COLS. `xlsx` mutat de pe `dependencies` pe `devDependencies` in backend (folosit doar de fixture-uri de test). 2 teste noi: PARSE_ERROR pe zip stream malformed, TOO_MANY_ROWS pe XLSX peste cap.
- **F4+F5+F6**: enrichSolutieAlertsForJob limita 200 alerte/tick + filtru created_at >= now-7days + match relaxat (trim+fallback pe data/ora/complet) ca textul solutiei sa nu blocheze backfill-ul hotararii.
- **F7**: SSE eveniment nou `alert_enriched` notifica clientii cand o alerta veche primeste textul hotararii (fara refresh manual).
- **F8 (test coverage)**: 10 teste P0 noi pentru `enrichSolutieAlertsForJob` la nivel repository (idempotency, izolare cross-tenant, fereastra 7d, JSON corupt, fallback whitespace, listener fanout, scope per-owner, etc.) + 1 integration test runner-level pe `dosarSoapRunner` care exerseaza path-ul end-to-end (alerta veche fara solutie_sumar → tick nou cu hotarare → detail_json patch-uit).
- **F9**: bulk delete ATOMIC backend (`POST /jobs/bulk-delete`) cu raport pe `deleted_ids`/`inflight_ids`/`not_found_ids`; frontend pastreaza selectia esuata pentru retry.
- **F10**: `alerts_created` numara doar inserturile reale (insertAlert returneaza `{row, inserted}`); dedup no-op nu mai infla metrica. **Coloana noua `monitoring_runs.alerts_patched`** (migration 0012) contorizeaza separat enrichment-urile in-place — un tick care patch-uieste 5 alerte fara insert nou raporteaza `alerts_created=0, alerts_patched=5`.

### Schema
- Migration **0012_monitoring_runs_alerts_patched** — `ALTER TABLE monitoring_runs ADD COLUMN alerts_patched INTEGER NOT NULL DEFAULT 0`. Auto-aplicata la boot.

### Tests
- 546 teste pass (era 524 in v2.6.3) — 10 P0 enrichment + 1 runner integration + 7 originGuard + 1 alerts_patched repo + 3 nameListParser xlsx malformed/oversized.

---

## 30 Aprilie 2026 - v2.6.3 - UX Monitorizare TINTA + cadenta non-standard honesty + Alerte pagination unified

Patch UX continuu dupa v2.6.2: in tabelul de joburi din Monitorizare coloana TINTA
era plain text — fara legatura cu PortalJust si fara scurtatura catre cautarea
in-app, desi inbox-ul Alerte avea exact acest pattern. Mai grav: dropdown-ul
de cadenta minte. Empiric pe v2.6.2 un job (`1234/180/2024`, leftover de
smoke-hardening din PR-4) avea `cadence_sec=600` (10min) in DB, dar UI-ul
afisa silent "4h" (`DEFAULT_CADENCE_SEC`) pentru ca 600 nu era in
`CADENCE_OPTIONS`. Runner-ul folosea valoarea reala (next_run = last_run +
~10min cu jitter), deci utilizatorul vedea o cadenta in tabel si una complet
diferita la verificarile efective. In paralel, paginarea inbox-ului Alerte
era custom (Inapoi / Inainte) cu cardurile stivuite vertical, fara page-size
selector, in timp ce restul aplicatiei (Cautare Dosare, RNPM) folosesc deja
componenta `TablePagination` partajata.

### Frontend - Monitorizare TINTA cu link + buton cautare

- `frontend/src/pages/Monitorizare.tsx` randeaza coloana TINTA pentru joburi
  `dosar_soap` cu `<a href={getPortalJustUrl(numar)} target="_blank">` +
  pictograma `ExternalLink` 12px (acelasi pattern ca in `pages/Alerts.tsx`).
  Whitelist-ul `portal.just.ro` din `setWindowOpenHandler` ramane neschimbat.
- Buton mic 24x24 cu pictograma `Search` langa numarul dosarului. Click →
  `onOpenDosar(numar)` propagat din `App.tsx` ca `handleHistoryClick("dosare",
  { numarDosar })` → `pendingSearch` → tab Dosare cu auto-search. Acelasi
  mecanism deja folosit de butonul "Cauta in app" din inbox-ul Alerte.
- Pentru joburi `name_soap` / `aviz_rnpm` TINTA ramane plain text (nu ai un
  numar de dosar canonic care sa intre intr-un URL `cautare.aspx?k=`).
- `App.tsx` adauga prop-ul `onOpenDosar` pe randarea Monitorizare, pe acelasi
  pattern cu Alerts.

### Frontend - dropdown cadenta non-standard onest

- `frontend/src/pages/Monitorizare.tsx` (linia ~503-530): cand
  `job.cadence_sec` nu e in `CADENCE_OPTIONS` (4h / 8h / 12h / 24h),
  dropdown-ul prepende un option dinamic `"<formatCadence> (custom)"` cu
  valoarea reala (ex: "10min (custom)") si `select.value = job.cadence_sec`,
  deci utilizatorul vede exact valoarea din DB. Border + text amber
  (`border-amber-500 text-amber-700`) ca avertisment vizual. Tooltip:
  `Cadenta non-standard (10min). Alege o optiune din lista pentru a o
  normaliza.`. Selectia oricarei optiuni standard normalizeaza prin
  `handleCadenceChange` (PATCH existent → `updateJob` reschedule).
- `DEFAULT_CADENCE_SEC` constant eliminat din pagina (orphan dupa fix; ramane
  in `MonitoringAddForm` ca default pentru job nou).
- Backend Zod accepta `min(600).max(86400)` deci optiunile UI nu sunt
  exhaustive — fix-ul reflecta corect realitatea fara a constrange backend-ul
  (job-uri create programatic / smoke / migration pot avea cadente arbitrare
  in interval).

### Frontend - paginare inbox Alerte unificata

- `frontend/src/pages/Alerts.tsx` foloseste acum componenta partajata
  `TablePagination` (`@/components/table-pagination`), aceeasi ca in Cautare
  Dosare / RNPM / Termene. Wrappata in `<Card>` ca dimensiunile zonei sa
  match-uiasca exact (border + padding standard).
- `page` schimbat de la 1-indexed la 0-indexed (componenta foloseste
  0-indexed). API-ul backend ramane 1-indexed, deci `alertsApi.list({ page:
  page + 1, pageSize })` la apelul de fetch.
- `pageSize` devine state controlat (default 25) cu setter via
  `onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}`.
- Constanta `PAGE_SIZE = 25` eliminata; `totalPages = Math.ceil(total /
  pageSize)`.
- Filtrele (kind / severity / from / to / onlyUnread / includeDismissed)
  reseteaza pagina la 0 in `useEffect` cand se schimba.

### Frontend - alert card zoom −1px aditional

- `frontend/src/pages/Alerts.tsx` (linia ~268): `alertCardZoom = (fontSize.value
  - 3) / fontSize.value` (era `- 2`). Cardul de alerta scade cu inca un pixel
  pe toata scara slider-ului. La pozitiile slider-ului (Mic 16, Normal 18,
  Mare 20, Extra 22), zoom-ul devine 13/16=81.3%, 15/18=83.3%, 17/20=85%,
  19/22=86.4%. La toate pozitiile cardul ramane perceptibil mai compact decat
  restul UI-ului dar cu spatiere lizibila.

### Validari

- `npx tsc --noEmit` (frontend) clean.
- 524/524 teste backend neschimbate (modificarile sunt strict frontend +
  prop-passing in `App.tsx`).
- Smoke desktop: TINTA pe job `dosar_soap` deschide portal.just.ro in browser
  + butonul Search navigheaza in Dosare cu auto-search; dropdown-ul afiseaza
  "10min (custom)" cu border amber pe job-ul `1234/180/2024`; selectarea "4h"
  normalizeaza valoarea la 14400 si elimina border-ul amber dupa refresh;
  paginarea Alerte arata identic cu Cautare Dosare; zoom cardului reactiv la
  slider.

---

## 30 Aprilie 2026 - v2.6.2 - UX inbox alerte (card scaling + dosar link extern + solutie completa)

Patch UX dupa feedback in productie pe v2.6.1: cardul de alerta era prea mare
relativ la restul UI-ului si nu se reasculta la slider-ul de fonturi; numarul
de dosar era plain text fara legatura cu PortalJust; alertele de tip
`solutie_aparuta` afisau doar campul scurt `solutie` ("Nefondat") fara textul
integral al hotararii; "Detalii suplimentare" enumerau doar cheile, dropind
valorile; alertele pre-enrichment (Run-uri pre-v2.6.1) ramaneau fara
`numar_dosar` chiar daca jobul lor il avea in `target_json`.

### Frontend - card scaling reactiv

- `pages/Alerts.tsx` aplica `style={{ zoom: (slider.value - 2) / slider.value }}`
  pe `<CardContent>`. Constant 2px sub slider-ul de fonturi, in toate cele
  patru pozitii (Mic 16/14, Normal 18/16, Mare 20/18, Extra 22/20). `zoom`
  scaleaza simultan font + padding + gap (Chromium-supported, Electron 41 OK).
  Ratio-ul se recalculeaza prin `useFontSize()` la fiecare re-render, deci
  cardul se schimba imediat cand utilizatorul muta slider-ul.
- `useFontSize` neschimbat (am incercat o rebazare a scalei initial, dar
  feedback-ul utilizatorului a fost ca scala globala nu trebuie atinsa - doar
  cardul de alerta sa fie mai mic decat slider-ul).

### Frontend - dosar link extern + buton corect

- `Dosar: <numar>` din header-ul cardului e acum `<a target="_blank">` cu
  href `https://portal.just.ro/SitePages/cautare.aspx?k=<encodeURIComponent>`,
  pictograma `ExternalLink` 12px alaturi de numar. Click-ul navigheaza prin
  `setWindowOpenHandler` (whitelist `portal.just.ro` deja activ) → 
  `shell.openExternal` → browser-ul default OS. Nu strica setul de protectii
  pentru CSP / popup-uri (nicio extindere de allowlist).
- Buton secundar redenumit "Cauta in app" cu pictograma `Eye` (era `ExternalLink`
  + "Cauta dosar" cu titlu inseelator "in PortalJust"). Pastreaza comportament:
  `onOpenDosar(numar)` → `pendingSearch` mecanism in `App.tsx` → tab Dosare
  cu auto-search.

### Backend + frontend - solutie_aparuta cu hotararea integrala

- `services/monitoring/diff/dosarSoap.ts` la emit-ul `solutie_aparuta` adauga
  acum in `detail`: `solutie_sumar` (textul lung al hotararii, ex.
  "Respinge apelurile ca nefondate. Definitivă..."), `numar_document`
  ("113/2026") si `data_pronuntare`. Toate trei sunt deja parsate de
  `soap.ts` din `<DosarSedinta>` SOAP, doar nu erau propagate.
- `pages/Alerts.tsx` `buildAlertContext` afiseaza:
  - `Hotarare: <numar_document> · <dd.mm.yyyy>` (cand cel putin unul prezent);
  - `Solutie completa: <solutie_sumar>` ca rand separat in `<dl>` 2-col cu
    text-wrap natural pe valoare lunga.
- Tests (`diff/dosarSoap.test.ts`) folosesc `toMatchObject` partial-match pe
  detail, deci adaugarea celor trei campuri nu sparge nimic. 524/524 verzi.

### Backend - JOIN pentru alerte pre-enrichment

- `db/monitoringAlertsRepository.ts` `listAlerts` aliasaza `monitoring_alerts`
  ca `a`, qualifica toate clauzele `WHERE` (necesare ca `kind` exista pe ambele
  table-uri) si LEFT JOIN-eaza `monitoring_jobs j ON j.id = a.job_id AND
  j.owner_id = a.owner_id` (defensiv pe owner ca un row misowned nu leak-eaza).
  SELECT emite `j.target_json AS job_target_json` si `j.kind AS job_kind`
  pe rand. INNER nu, LEFT - alertele a caror joburi au fost sterse continua
  sa apara cu fields NULL.
- `MonitoringAlertRow` extins cu `job_target_json?: string | null` si
  `job_kind?: string | null`. `MonitoringAlert` (frontend type) la fel.
- `buildAlertContext` parseaza `alert.job_target_json` (try/catch) si o
  foloseste ca fallback pentru `numar_dosar`/`instanta`/`name_normalized`
  cand `detail_json` nu le are (alerte pre-v2.6.1).
- COUNT-ul `total` ramane fara JOIN (nicio coloana din `monitoring_jobs` nu
  apare in WHERE), deci performance-ul agregatului nu sufera.

### Frontend - "Detalii suplimentare" cu valori

- `buildAlertContext` schimba `fallbackKeys: string[]` in `fallback: { label,
  value }[]`. `humanizeKey` converteste `snake_case`/`camelCase` in label
  capitalizat ("foo_bar_baz" → "Foo bar baz"). `stringifyFallbackValue`
  serializeaza primitive direct, obiecte/array-uri JSON-stringificate cu cap
  la 200 caractere si elipsa, iar valori null/empty/empty-object dropate.
- Render-ul foloseste `<dl>` 2-coloane (la fel ca `facts`) cu styling mai
  discret (text-xs muted-foreground). Nu mai apare lista nuda de chei fara
  context.

### UX cleanup

- Linia tehnica `Job #X · Run #Y · Dedup: ...` din footer-ul cardului scoasa
  complet (debug-info zgomotoasa pentru utilizator final). Daca debug e
  necesar, dedup_key ramane disponibil in API response.

### Validari

- `npx tsc --noEmit -p backend/tsconfig.json` clean.
- `cd frontend && npx tsc --noEmit` clean.
- `npm run build` produce `dist-frontend/` + `dist-backend/index.cjs`
  (3.7MB, neschimbat de marime).
- 524/524 vitest verzi (necesita `npm rebuild better-sqlite3` dupa
  `npm run rebuild:electron` - workflow standard din CLAUDE.md).
- Smoke desktop: card-ul se rescaleaza la fiecare miscare a slider-ului,
  link-ul Dosar deschide `portal.just.ro` in browser-ul default OS, butonul
  "Cauta in app" deschide tab-ul Dosare cu pre-search.

---

## 30 Aprilie 2026 - v2.6.1 - alerte cu context dosar + identitate Windows

Patch UX dupa feedback in productie pe v2.6.0: alertele de monitorizare nu
purtau identificare suficienta (numar dosar, formatare data, link spre
cautare) si iconita aplicatiei pe Windows aparea ca default Electron in
taskbar / native notifications.

### Backend - alerte enrichment

- `dosarSoapRunner` adauga `numar_dosar` (din `target.numar_dosar`),
  `instanta` si `stadiu` (din `currentDosar`, daca prezent) la fiecare alerta
  inainte de insert. Diff-ul ramane pur (nu primeste context external);
  enrichmentul se face la limita runner-ului. Dedup key si payload de diff
  raman neschimbate.
- `nameSoapRunner` adauga `name_normalized` (din `target.name_normalized`)
  la fiecare alerta. Per-dosar alerts (`dosar_new`, `stadiu_changed`, etc.)
  pastreaza `numar` din diff-ul intern.
- 524/524 teste vitest verzi (zero modificari de assertions: testele
  existente folosesc `toMatchObject` partial-match si tolereaza fields noi).

### Frontend - alerte cu detail structurat + link spre Dosare

- `pages/Alerts.tsx` inlocuieste `detailPreview` (single-line) cu
  `buildAlertContext(alert)` care extrage `numarDosar`, `instanta`,
  `nameNormalized` si o lista `facts` (label/value perechi):
  - data sedintei reformatata `dd.mm.yyyy` (parsa din `2026-04-30T00:00:00`
    sau ISO complet);
  - ora, complet, solutie, stadiu, categorie afisate ca `dt`/`dd`;
  - `termen_changed` arata `from`/`to` ca "De la" / "La";
  - `stadiu_changed` / `categorie_changed` arata "Schimbare: from -> to";
  - fallback pentru chei necunoscute pastreaza extensibilitatea.
- buton "Cauta dosar" (cand `numar_dosar` e prezent) reuseste mecanismul
  existent `pendingSearch` din App.tsx: `onOpenDosar(numar)` →
  `handleHistoryClick("dosare", { numarDosar })` → `navigate("/dosare")` →
  Dosare auto-executa search via `pendingSearch` effect.
- `numar_dosar` afisat font-mono prominent sub titlu.

### Electron - identitate Windows

- `electron/main.js` apeleaza `app.setAppUserModelId("ro.legaldashboard.app")`
  inainte de orice `BrowserWindow` / `Notification`. Fix: in dev mode taskbar-ul
  nu mai arata icon-ul default Atom-Electron; native notifications nu mai
  sunt atribuite "electron.app.Electron". `appId` din electron-builder
  config e identic, deci pe NSIS install grupare ramane consistenta.

### Validari

- `npx tsc --noEmit -p backend/tsconfig.json` clean.
- `cd frontend && npx tsc --noEmit` clean.
- `npm test --workspace=backend` 524/524 verde.
- Smoke desktop: alerta `solutie_aparuta` afiseaza acum numar dosar +
  data formatata + complet + solutie; buton "Cauta dosar" navigheaza si
  declanseaza cautare in Dosare.
- Icon-ul aplicatiei in taskbar dev = icon.ico din `build/`.

---

## 30 Aprilie 2026 - v2.6.0 - PR-8 admin pages + roles guard

PR-8 livreaza primul ecran admin si guard-ul de rol care va proteja in PR-9
toate suprafetele admin in mod web. Pe desktop, "local" este seedat ca user
normal, iar adminul se promoveaza dintr-o sesiune SQLite directa
(`UPDATE users SET role='admin' WHERE id='local';`) sau dintr-o pagina admin
existenta dupa ce primul admin a fost promovat manual.

### Backend - middleware + rute

- **Middleware nou `requireRole(...allowed: UserRole[])`**: rezolva userul prin
  `getOwnerId(c)` + `getUserById`, refuza cu 401 cand userul nu exista, 403 cand
  statusul nu este `active` sau cand rolul nu este in allowlist. Fiecare refuz
  scrie un audit `auth.denied` cu `reason` (`user_not_found` | `user_inactive` |
  `role_mismatch`), `userId`, `role`/`status` curent si `required` (lista
  rolurilor cerute). Construire fara roluri arunca eroare la timpul setup-ului.
- **Ruta noua `GET /api/v1/me`**: returneaza profilul callerului in envelope
  v1 - `id`, `email`, `displayName`, `role`, `status`, `createdAt`,
  `lastLoginAt`. Folosita de UI pentru a decide ce sectiuni de admin se
  afiseaza si pentru gating client-side la `/admin/*`.
- **Rute noi `/api/v1/admin/*`** (toate gated cu `requireRole('admin')`):
  - `GET /admin/users` - listare paginata cu filtre `search` (email/nume),
    `role`, `status`, `page`, `pageSize`.
  - `GET /admin/users/:id` - detaliu user.
  - `PATCH /admin/users/:id/role` - **guardrail self-demotion**: refuz 409
    `last_admin` cand callerul incearca sa-si retrogradeze rolul ramanand
    zero administratori activi; audit `admin.users.demote_blocked` pe esec.
    Pe succes, audit `admin.users.update_role` cu `before`/`after`.
  - `PATCH /admin/users/:id/status` - **guardrail self-deactivation**: refuz
    409 `self_deactivation` cand callerul isi schimba statusul in
    non-`active`; audit `admin.users.update_status` pe succes.
  - `GET /admin/audit` - jurnal cu filtre `actionLike` (LIKE `%x%`), `ownerId`,
    `actorId`, `targetKind`, `targetId`, `outcome`, `since` (closed lower
    bound, `ts >= ?`), `until` (open upper bound, `ts < ?`), pagination.
  - `GET /admin/users/:id/quota` + `PUT` (upsert) + `DELETE` (idempotent) -
    override-uri zilnice per feature stocate ca `cost_usd_milli` integer.
- **Migration `0011_user_quota_overrides`**: tabel cu PK `(user_id, feature)`,
  `daily_limit_usd_milli` (NOT NULL CHECK >= 0), `updated_at` (default
  `CURRENT_TIMESTAMP`), `updated_by` (nullable, FK soft pe users).
  `ON DELETE CASCADE` pe user pentru cleanup automat.
- **Convenții ferestre de timp**: `since` este closed lower bound (`ts >= ?`),
  `until` este open upper bound (`ts < ?`) - aliniat cu `aiUsageRepository`
  din PR-7 hardening, asa incat un admin care compara audit cu AI usage pe
  acelasi interval vede aceleasi randuri.
- **Audit pe writes only**: read-urile (list, get, audit list, quota list) nu
  scriu in audit_log ca sa nu polueze. Write-urile (role, status, quota
  upsert/delete) scriu envelope cu `before`/`after` in `detail_json`.

### Frontend - hook + componente shared

- **Hook nou `useCurrentUser`**: fetch `/api/v1/me` la mount, expune
  `{ user, loading, error, refresh }`. AbortController pe unmount, retry via
  `tick` state. Folosit de Sidebar (decide afisarea sectiunii Admin) si de
  `AdminGate` (decide accesul la rutele `/admin/*`).
- **Componenta `AdminGate`**: ruleaza in jurul fiecarei pagini admin si
  arata un ecran 403 cand `user?.role !== "admin"`. Guard pur cosmetic -
  serverul re-verifica rolul pe fiecare call `/api/v1/admin/*`.
- **Sidebar**: cand `user?.role === "admin"`, randeaza o sectiune
  "Administrare" cu trei iteme - `Utilizatori`, `Audit`, `Cote`. Iconite
  identice in modul collapsed.
- **`lib/api.ts`**: tipuri si helper noi - `UserRole`, `UserStatus`,
  `MeProfile`, `AdminUser`, `PaginatedUsers`, `AuditEvent`, `PaginatedAudit`,
  `QuotaOverride`, `QuotaListResult`. Exporturi `me.get()` si
  `admin.{listUsers,getUser,updateRole,updateStatus,listAudit,listQuota,upsertQuota,deleteQuota}`.
  Reuseaza `unwrapMonitoring` + `MonitoringApiError` pentru a beneficia de
  acelasi error-handling ca rutele monitoring.

### Frontend - pagini admin

- **`/admin/users`**: tabel paginat cu inline `<select>` pentru rol si
  status. Confirmari prin `useConfirm` la fiecare schimbare. Self-demotion
  blocata si client-side cu mesaj romanesc cand callerul incearca sa-si
  schimbe rolul. Refresh `/me` automat dupa schimbare proprie de rol pentru
  a-si actualiza Sidebar-ul (admin -> user ascunde sectiunea Administrare).
- **`/admin/audit`**: tabel cu rand expandabil per eveniment - prima linie
  arata timestamp, action, outcome (badge color-coded), owner, actor, target
  si IP; expansiunea afiseaza `detail_json` pretty-printed plus `userAgent`.
  Filtre: `action` (substring match), `ownerId`, `actorId`, `targetKind`,
  `outcome`, `from`/`to` (date inputs in timezone local, convertite la ISO
  cu boundaries 00:00:00.000 / 23:59:59.999 ca pe Alerts).
- **`/admin/quota`**: workflow in doua etape - cauta utilizator (reuseaza
  `admin.listUsers`), apoi vezi/edit-eaza override-urile lui. Limitele se
  introduc in USD (decimale pana la trei zecimale) si se salveaza ca
  milli-USD pentru aliniere cu modelul de cost AI din PR-7. Delete e
  idempotent si confirmat prin `useConfirm`.

### Routing & UX

- `App.tsx`: trei rute noi `/admin/users`, `/admin/audit`, `/admin/quota`,
  fiecare wrapped in `<AdminGate>`. 403 placeholder cu mesaj romanesc cand
  userul nu este admin.
- Sidebar randeaza sectiunea Administrare doar cand server-ul a confirmat
  prin `/me` ca rolul este `admin` - non-adminii nu vad linkurile, dar pot
  ajunge la URL prin tastare directa unde primesc 403.

### Teste & validare

- **Backend full suite**: 524 teste trecute (de la 440 in v2.5.1, +84 noi).
  - `requireRole.test.ts` (10 cazuri): allowlist single-role, multi-role,
    rol mismatch, suspended, deleted, ghost user (401), construction-time
    error fara roluri, audit pe `role_mismatch` si `user_inactive`.
  - `userQuotaRepository.test.ts` (13 cazuri): read paths, ordering by
    feature, scope per user_id, upsert idempotent, zero limit valid,
    negative/non-integer rejected, empty feature rejected, ON DELETE CASCADE.
  - `auditRepository.test.ts` extins cu 12 cazuri pe `listAuditEvents`:
    filtre per camp, closed lower bound `since`, open upper bound `until`,
    `since`+`until` tile fara overlap, pagination cu total separat de pagesize,
    limit clamped `[1,500]`.
  - `admin.test.ts` (~30 cazuri): gate (non-admin 403, admin 200, suspended
    admin 403), users list/filters/pagination, get user 200/404, PATCH role
    cu audit, invalid role 400, self-demote blocked + allowed cand alt admin
    exista, PATCH status cu audit, self-deactivation blocked, audit list cu
    `since`/`outcome`, malformed datetime 400, quota CRUD, idempotent delete.
- **Type-check** backend si frontend: clean.
- **Smoke test end-to-end** pe rutele noi prin curl: `/me`, gate behavior
  (403 cand local nu este admin), `/admin/users` listing, `/admin/audit`
  cu `since`, quota PUT/GET, self-demote 409 cu mesaj romanesc.

### Cunoscut & limitari

- **`useCurrentUser` se apeleaza din mai multe locuri** (Sidebar +
  AdminGate per pagina admin). Pe desktop call-ul este local si rapid;
  daca devine vizibil in load tests pe web mode, va fi lift-ed in
  context shared.
- **Promovarea primului admin pe desktop** ramane manuala (UPDATE direct
  in SQLite). PR-9 va expune un mecanism mai prietenos legat de SSO.

---

## 30 Aprilie 2026 - v2.5.1 - PR-7 hardening (post multi-review)

Patch peste v2.5.0 dupa multi-agent review pe suprafata AI usage tracking.
Fara feature noi - doar fixuri de corectitudine, izolare si robustete operationala
identificate de cei 5 agenti de review.

### Backend - aliniere fereastra de timp + retention

- **`aiUsageRepository`**: toate query-urile pe fereastra de timp folosesc `ts >= ?`
  (closed lower bound) - fix off-by-one pentru randuri care aterizeaza exact la
  `since`. `nonNegativeInteger` redenumit `clampToNonNegativeInteger` cu predicate
  `< 0` (acum accepta corect `0`). Helper exportat `utcDayStart(now, daysBack)`.
  `listAiUsageLastDays` calculeaza `since` aliniat la UTC-midnight si returneaza
  `{ rows, since, until }`.
- **`purgeOldAiUsage(retentionDays)`**: functie noua, cuplata in scheduler-ul
  zilnic alaturi de `purgeOldRuns` cu try/catch independent. Retention 90 zile.
- **`routes/aiUsage.ts`**: `summary30d` aliniat la aceeasi fereastra UTC-midnight
  ca seria daily (era `now − 30×24h`, mismatched). Handler-ul wrapped in
  `withMaintenanceRead` ca sa coopereze cu daily backup writer.

### Backend - cancellation + shutdown safety

- **Multi-agent abort propagation**: `analystsAbort` AbortController shared, asa
  incat un analist esuat anuleaza sibling-ul in loc sa-l lase pana la 180s
  timeout. `signal?: AbortSignal` adaugat pe `callAnthropic`/`callOpenAI`/
  `callGoogle`/`callModel`, compus cu timeout intern via `AbortSignal.any`.
- **Shutdown latch**: export nou `markShuttingDown()` in `db/schema.ts` care
  inchide DB si seteaza un latch one-way. `getDb()` arunca daca este apelat
  post-shutdown - previne late `recordAiUsageSafely` microtasks de a redeschide
  DB-ul. `gracefulShutdown` foloseste `markShuttingDown()` in loc de `closeDb()`
  dupa drain.
- **Token extraction din SDK errors**: `withAiLogging` extrage acum
  `input_tokens`/`promptTokenCount` ca `usageInput` si
  `output_tokens`/`candidatesTokenCount` ca `usageOutput` din `e.usage` cand SDK-ul
  arunca dar a contorizat deja partial.

### Backend - safety & observability

- **`httpStatus` clamped** la `[100,599]` sau `null` cand SDK-ul intoarce o
  valoare in afara intervalului HTTP standard.
- **Price-table miss warn one-shot** (JSON structurat) cu dedup pe
  `provider+model` ca sa nu spam-uiasca log-ul cand un model nou e adaugat in
  `AI_MODELS` fara pret.
- **Insert-failure log structurat** single-line JSON
  (`action: "ai_usage.persist_failed"`).
- **Insert SQLite deferred via `queueMicrotask`** ca sa iasa de pe response hot
  path al call-ului SDK.
- **Comentariu cross-reference** intre `CHECK (provider IN (...))` din migration
  `0010_ai_usage` si price map din `services/aiUsage.ts`.

### Frontend - timezone + cancellation

- **Fix timezone bug pe seria daily**: `new Date(\`${value}T00:00:00Z\`)` +
  `timeZone: "UTC"` in `formatDateLabel` ca etichetele sa coincida cu bucket-urile
  UTC din backend.
- **`inflightRef` AbortController** in `AIUsagePanel.tsx` - refresh re-fire
  anuleaza request-ul anterior in loc sa lase doua request-uri in zbor.
- **Caption "Informativ"** etichetat explicit in panel: pe desktop nu exista
  quota enforce, costurile efective sunt facturate de provider.

### Teste

- **Fisier nou** `backend/src/routes/aiUsage.test.ts` (route-level integration):
  envelope shape, owner isolation, daily-sum=summary30d invariant.
- **`aiUsageRepository.test.ts`** extins cu closed-lower-bound case si noul
  return shape `{ rows, since, until }`.
- **`services/aiUsage.test.ts`** extins cu AI_MODELS price-table coverage
  (fiecare modelId are pret nenul), error-path tests (429 cu usage), clamps pe
  `http_status` out-of-range si "no row when tracking omitted".

### Validare

- Backend full suite: `npm test --workspace=backend` - **440/440 teste trecute**
  (de la 432 in v2.5.0, +8 din hardening pass).
- Type-check backend si frontend: clean.
- Biome lint/format check pe fisierele modificate: clean.
- `npm rebuild better-sqlite3` (Node ABI) → `npm test` → `npm run rebuild:electron`
  (Electron ABI) - sequence completata cu succes.

---

## 30 Aprilie 2026 - v2.5.0 - PR-7 AI usage tracking + quota visibility

PR-7 inchide Faza 1: fiecare apel AI real lasa audit operational persistat,
iar utilizatorul vede costul estimat in Setari API. Prompturile si flow-ul AI
au ramas neschimbate.

### Backend (`ai_usage`)

- **Migration `0010_ai_usage`**: tabel owner-scoped cu `provider`, `model`,
  `input_tokens`, `output_tokens`, `cost_usd_milli`, `http_status`,
  `was_aborted`, `request_id` si `feature`.
- **`aiUsageRepository`**: insert normalizat, totals pe sliding window, breakdown
  provider/feature si serie zilnica owner-scoped.
- **Cost model safe**: preturi per provider/model stocate in cod ca integer
  milli-USD; fallback la `0` cand modelul sau tokenii lipsesc.
- **Tracking post-call**: `withAiLogging()` persista usage dupa call SDK, fara
  SQLite lock peste I/O extern. `NO_API_KEY` nu se contorizeaza fiindca nu
  porneste un call SDK.
- **Multi-agent**: analiza avansata scrie cate un row per call real (doi
  analisti + judge cand faza judge este atinsa).
- **Ruta noua**: `GET /api/v1/ai-usage/summary` returneaza cost 24h, cost 30
  zile si serie daily last 30 days in envelope v1.

### Frontend

- **Panou `AI Usage` in Setari API** cu loading/error/empty states.
- **Graf Recharts last 30 days** plus carduri pentru cost ultimele 24h si 30
  zile, tokeni input/output si cost mediu per apel.

### Validare

- Backend full suite: `npm test --workspace=backend` - 432/432 teste trecute.
- Type-check backend si frontend - clean.
- Build productie: `npm run build` - trecut.
- `better-sqlite3` a fost reconstruit pentru Node inainte de Vitest si readus
  pe ABI Electron cu `npm run rebuild:electron` dupa teste.

---

## 30 Aprilie 2026 - v2.4.2 - PR-6 hardening (post-review hotfix)

Hotfix peste v2.4.1 dupa full-review multi-agent pe suprafata alertelor. Fara feature noi - doar fixuri de corectitudine, izolare si robustete operationala.

### Backend (`/api/v1/alerts`)

- **Heartbeat SSE la 25s** (`event: ping`) ca sa supravietuiasca timeout-urilor de NAT/proxy idle (~60s); curatat in `onAbort`, in `.catch` pe writeSSE si dupa `await closed`.
- **`retry: 3000`** pe primul frame `ready` ca EventSource sa reconecteze deterministic in 3s indiferent de browser.
- **`recordAudit`** pe `PATCH /:id/seen`, `PATCH /:id/dismissed` si nou-aparutul `POST /seen-bulk`; auditul se scrie doar pe success path (nu pe 404 - ar fi leak de existenta cross-tenant).
- **`bodyLimit`** dedicat: 4 KiB pe PATCH-uri, 8 KiB pe `seen-bulk` (max 100 ids).
- **Cap per-owner pe SSE** (5 stream-uri): `subscribeToNewAlerts` arunca `TooManyAlertSubscribersError`; ruta scrie un frame final `{ "code": "too_many_streams" }` si inchide curat in loc de drop silent.
- **`POST /api/v1/alerts/seen-bulk`** - inlocuieste N PATCH-uri sequential cu un singur UPDATE `IN (...)` tranzactional, audit agregat.
- **`alertExistsForAnyOwner` helper** - util pentru detectia probelor cross-tenant in viitoare denial paths.

### Backend repo (`monitoringAlertsRepository`)

- **`insertAlert` complet tranzactional**: ownership guard + INSERT + readback intr-un singur `db.transaction`; `notifyNewAlert` defer-uit cu `queueMicrotask` ca listeneri (SSE writeSSE, etc.) sa nu mai ruleze sub SQLite write lock.
- **`markAlertsSeen(ownerId, ids)`** - bulk seen tranzactional cu owner_id scoping si dedup pe ids.

### Frontend (`Alerts.tsx`, `App.tsx`)

- **Fix timezone in filtre data**: `from`/`to` foloseau `new Date(\`\${from}T00:00:00\`)` care interpreta string-ul ca UTC; pentru un user UTC+3 selectarea "30 Apr" intoarcea fereastra `29 Apr 21:00 - 30 Apr 20:59 UTC` si rata 3h de alerte. Inlocuit cu construire local-time prin constructorul multi-arg.
- **markVisibleSeen** trece prin endpoint-ul nou `seen-bulk`; fallback `Promise.allSettled` pe per-id PATCH daca bulk-ul esueaza, in loc de loop sequential care abandoneaza la prima eroare.
- **Notificari desktop suprimate cand fereastra e focused** (`document.hasFocus() && visibilityState === 'visible'`) - elimina double-feedback cand user-ul deja se uita la app.
- **Counter unread server-truth**: scos `setUnreadAlerts(c => c + 1)` optimistic care racing cu refresh-ul; pe fiecare event `alert` se face refresh.
- **Listener `sync` SSE mort sters** (backend nu emite niciodata `sync`).
- **`alertsStreamVersion` bump pe reconnect open** ca pagina `Alerte` sa re-fetcheze lista dupa drop SSE si sa nu piarda alerte aparute in fereastra de disconnect.

### Electron native notifications

- **Dedup pe `tag`**: payload-ul `desktopApi.showNotification` accepta acum `tag?: string`; main process tine un `Map<tag, Notification>` (cap 100 cu evictie FIFO) si inchide notificarea anterioara cu acelasi tag inainte de a o arata pe cea noua. Renderer-ul trimite `dedup_key` ca tag.

### Validare

- Type-check: `npx tsc --noEmit -p backend/tsconfig.json` si `cd frontend && npx tsc --noEmit` - clean.
- Biome: `npx biome check` pe toate fisierele atinse - clean.
- **Smoke test live Electron desktop**: pornire OK cu `ELECTRON_RUN_AS_NODE` curatat, banner `Server: http://127.0.0.1:3002`, scheduler started (60s tick, claimLimit=25), `/health` 200, `GET /api/v1/alerts?onlyUnread=true` 200, `GET /api/v1/alerts/stream` 200 (subscribe cu cap-5 + heartbeat exersat), `GET /api/v1/monitoring/jobs` 200. Renderer incarca asseturile fara eroare.
- Vitest: amanat - `better-sqlite3` ABI mismatch intre Electron `NODE_MODULE_VERSION 145` si Node tester 137; rebuild necesita Electron oprit. Modificarile de cod sunt verificate runtime prin smoke-ul de mai sus, nu doar tip-checked. Doua teste in `monitoringAlertsRepository.test.ts` deja actualizate pentru deferral-ul microtask al `notifyNewAlert` (asteapta sa fie rulate la urmatorul rebuild).

---

## 30 Aprilie 2026 - v2.4.1 - PR-6 Alerte UI + notificari desktop

PR-6 transforma alertele generate de scheduler in workflow vizibil: inbox dedicat,
badge in sidebar, stream live si notificari native Electron.

### Inbox alerte

- Pagina noua `Alerte` cu lista paginata, filtre dupa tip/severitate/interval,
  toggle pentru necitite si includere alerte inchise.
- Actiuni pe rand: marcheaza citit si inchide/dismiss; pagina poate marca toate
  alertele vizibile ca citite.
- Detaliile din `detail_json` sunt parsate defensiv si afisate compact, fara sa
  blocheze UI-ul daca un payload vechi nu respecta forma asteptata.

### Backend alerts API

- Rute noi owner-scoped: `GET /api/v1/alerts`,
  `PATCH /api/v1/alerts/:id/seen`, `PATCH /api/v1/alerts/:id/dismissed` si
  `GET /api/v1/alerts/stream`.
- `monitoringAlertsRepository` are read-side helpers pentru listare, unread
  count, seen/dismiss si subscriber in-process pentru SSE.
- Inbox-ul exclude implicit alertele dismiss-uite; `includeDismissed=true`
  ramane disponibil pentru audit operational.

### Electron desktop

- Sidebar-ul afiseaza badge cu alerte necitite.
- Badge-ul este numeric si vizibil atat in sidebar expandat, cat si in modul
  colapsat/icon-only.
- Stream-ul SSE are cleanup la unmount si reconnect cu backoff; la reconectare
  face refresh de count/lista ca sa nu piarda alerte.
- Notificarile noi folosesc IPC catre Electron main process si `new Notification`
  nativ; fallback-ul Web Notification ramane pentru dev/web.

### Validare

- Backend alerts tests: `npm test --workspace=backend -- src/db/monitoringAlertsRepository.test.ts src/routes/alerts.test.ts` - 13/13 teste trecute.
- Backend full suite: `npm test --workspace=backend` - 424/424 teste trecute.
- Type-check backend + frontend: `npm exec tsc --workspace=backend -- --noEmit` si `npm exec tsc --workspace=frontend -- --noEmit` trecute.
- Build productie: `npm run build` trecut.
- Smoke Electron desktop: pornire cu `ELECTRON_RUN_AS_NODE` curatat, `/health` 200 cu scheduler running, `/api/v1/alerts` 200.

---

## 29 Aprilie 2026 - v2.4.0 - PR-5 bulk name lists + name_soap monitoring

PR-5 inchide sprintul de bulk import pentru monitorizare: acelasi fisier XLSX/CSV poate contine `numar_dosar` pentru joburi `dosar_soap` si `nume` pentru joburi `name_soap`. Flow-ul ruleaza in Electron desktop si pastreaza preview/commit pentru liste de nume.

### Monitorizare bulk

- Template XLSX `monitorizare-template.xlsx` cu coloanele `numar_dosar`, `nume`, `cadence_sec`, `notes` si dropdown Excel pentru `4h`, `8h`, `12h`, `24h`.
- Reparat generatorul XLSX: `<dataValidations>` este injectat in ordinea OOXML corecta, inainte de `<ignoredErrors>`. Verificat prin download real din Electron si deschidere Excel COM hidden (`EXCEL_OPEN_OK`).
- UI-ul bulk pastreaza flow-ul existent: `numar_dosar` creeaza `dosar_soap`, `nume` intra prin preview/commit `name_soap`; nu exista coloana vizibila CNP/CUI in template.
- Statistica pentru dosare bulk foloseste statusul HTTP `201` vs `200`, nu o euristica pe `created_at`.

### Backend name lists + name_soap

- Migrari `0006..0009`: `name_lists`, `name_list_items`, FK invers `monitoring_jobs.name_list_id`, suport `name_soap` in CHECK-uri si `cadence_sec`/`notes` per item.
- Rute `/api/v1/name-lists/preview` si `/api/v1/name-lists`/`/commit`, cu caps stricte pentru `xlsx@0.18.5` (10MB, 50000 rows, 20 cols) si re-validare server-side la commit.
- Auto-create jobs cu cap 100/joburi per tranzactie si retry idempotent prin `(owner_id, source_sha256)`.
- `nameSoapRunner` interogheaza PortalJust dupa subiect, salveaza snapshot-uri si emite alerte pentru dosare noi, schimbari de stadiu/categorie si intrare/iesire din relevanta.
- Fix post-review: replay check-ul `createList()` ruleaza acum in `BEGIN IMMEDIATE`, iar `archiveList()` face blocking-check + archive atomic.

### Validare

- Backend: `npm test --workspace=backend` - 416/416 teste trecute.
- Build productie: `npm run build` trecut.
- CI GitHub PR #5: `docker-build` pass.
- Electron desktop smoke: aplicatia pornita cu `ELECTRON_RUN_AS_NODE` curatat; template XLSX descarcat din Electron si deschis in Excel fara repair.

### Risc acceptat

- `xlsx@0.18.5` ramane temporar pentru compatibilitate cu flow-ul existent; riscul este mitigat prin caps stricte si documentat pentru migrare ulterioara la parser mai sigur.

---

## 29 Aprilie 2026 - v2.3.0 - Audit remediation hardening + export Web Worker

Patch peste v2.2.0 dupa auditul intern din 29 aprilie. Convergent catre robustete operationala in modul desktop si pregatire pentru cutover web. Niciuna dintre schimbari nu cere migrare manuala — la prima pornire dupa update, baza de date se aliniaza singura.

### Reliability — backup, shutdown, finalize state-guarded

- **Backup zilnic recurent**: pana acum singurul backup automat era cel de la pornirea aplicatiei. Acum un `setInterval` la 24h declanseaza backup-ul si pe sesiuni lungi (firme care nu inchid Electron-ul peste noapte). Timer cleanup la `gracefulShutdown`.
- **Restore SQLite hardened**: pe restore, `PRAGMA integrity_check` valideaza fisierul inainte sa-l promoveze; sidecar-urile WAL/SHM sunt sterse cu detection a erorilor non-ENOENT (nu mai trec in tacere peste un disk full).
- **Graceful shutdown drain HTTP 30s**: la `SIGTERM` / `SIGINT`, serverul HTTP face drain explicit cu timeout 30s inainte de oprirea scheduler-ului si inchiderea DB-ului. Nu mai pierde request-uri in curs daca Electron e inchis cu Quit.
- **Migration 0005 — `idx_one_running_per_job`**: index UNIQUE partial pe `monitoring_runs(job_id) WHERE status='running'`. Garanteaza la nivel de DB ca un singur run `running` simultan per job. Daca scheduler-ul ar reseta in timpul unei executii, recovery-ul nu mai poate produce duplicate.

### RNPM — maintenance lock + audit complet pe rutele destructive

- `executeSearch` (write-urile in DB ale rezultatelor RNPM) ruleaza acum sub `withMaintenanceRead` — la fel ca runner-ul SOAP de dosare. Backup-ul care intra in maintenance mode nu mai blocheaza scrierile la jumatate. Fetch-ul HTTP catre rnpm.ro NU intra in lock — nu prelungim lock-ul cu latenta de retea.
- Toate cele 3 rute destructive RNPM scriu audit log: `POST /saved/delete-batch`, `DELETE /saved/:id`, `DELETE /searches/:id`. Nicio stergere fara urma.
- `executeSearch` verifica `searchRepository.belongsToOwner` inainte de a accepta `existingSearchId`, prevenind reutilizarea cross-user a unui search vechi.

### Migration runner — self-heal bidirectional pe line endings

- Hash-ul SQL e calculat pe continut normalizat (CRLF → LF + BOM scos) ca sa fie stabil intre Windows si Linux. `git autocrlf` pe Windows nu mai invalideaza hash-urile la checkout.
- Self-heal match in ambele directii: `sha256Raw` (DB-uri vechi care au stocat hash pe bytes raw, CRLF inclus) si `sha256Crlf` (DB-uri stocate pe varianta CRLF cand fisierul curent e LF). Drift real (continut SQL chiar diferit) arunca in continuare.
- Observability: `RunMigrationsResult.selfHealed[]` expune versiunile auto-vindecate; `schema.ts` loggeaza fiecare boot cu remediere.
- `MIGRATIONS_STRICT=1` dezactiveaza self-heal in CI — orice mismatch arunca, util pentru a prinde drift accidental inainte de release.
- `.gitattributes` forteaza `eol=lf` pe `backend/src/db/migrations/*.sql` ca Windows-ul sa nu mai converteasca la checkout.

### Export — Web Worker pentru toate fluxurile (RNPM + AI + Manual)

- Generarea XLSX si PDF mutata integral in Web Worker — RNPM avize, Dosare/Termene, panoul de analiza AI si Manualul aplicatiei. Pe sute/mii de avize, UI-ul nu mai ingheata; main thread-ul ramane disponibil pentru rendering.
- Butoanele afiseaza spinner imediat la apasare (in locul iconitei Download), feedback vizual instant ca fisierul se genereaza. Catch-block pe orice esec — daca worker-ul pica, butonul revine la starea initiala in loc sa ramana blocat.
- Build-ul XLSX (cu styling per cell + hyperlink-uri navigabile) si PDF (`jsPDF` + `autotable`) e tot pe acelasi cod, doar mutat in worker.
- ArrayBuffer transferat zero-copy intre worker si main thread.
- Vite `worker.format="es"` permite code-splitting (xlsx + jspdf chunk-uri lazy), pastrand bundle-ul principal sub 400 KB.

### Dependinte — bump-uri de securitate

- `dompurify >= 3.4.1`, `jspdf >= 4.2.1` cu `jspdf-autotable 5.0.7` compatibil. Aliniate cu auditul de securitate intern din aprilie.

### Teste + smoke

- Backend: 357 teste trecute la `npm test` in `backend/` (de la 333 in v2.2.0). 24 noi acopera bidirectional self-heal (`sha256Raw` vs `sha256Crlf` branches), `MIGRATIONS_STRICT=1` strict mode, finalize state guards si recurrence backup timer.
- Type-check backend + frontend curat (`npx tsc --noEmit` ambele workspace-uri).
- Build productie trecut la `npm run build` — `export.worker` chunk emitted (~52 KB), main bundle sub 400 KB.
- Smoke Electron: backup zilnic timer wired, scheduler running, joburi `dosar_soap` finaizeaza corect cu `idx_one_running_per_job` activ.

---

## 29 Aprilie 2026 - v2.2.0 - PR-4 full-review hardening Tier 2-6

Release de hardening peste monitoring scheduler + dosar_soap runner, rezultat din full-review. Include fix-uri critical/high deja commit-uite pe branch si inchide remaining Tier 4, Tier 5 si Tier 6.

### Reliability + operational hardening

- `monitoring_jobs.claimDueJobs` respecta `MONITORING_DISABLED_KINDS` pentru kill switch operational per kind (`dosar_soap`, `name_soap`, `aviz_rnpm`).
- `monitoring_runs` primeste retention purge zilnic la 90 zile, cu timer curatat pe `Scheduler.stop()`.
- `recoverOrphanRuns()` marcheaza crash recovery cu `error_code='CRASH_RECOVERY'`, iar boot-ul logheaza numarul de randuri recuperate.
- Scheduler-ul logheaza `monitoring.source_error_suppressed` pentru esecurile consecutive peste pragul de alertare.
- Operatiile destructive RNPM backup delete/restore scriu audit log.

### Correctness + defense in depth

- Snapshot + alert persistence este testata atomic pe partial failure.
- `sedintaKey` refuza separatorul `|` in segmentele structurale si permite separatorul doar in solutie, unde parserul re-imbina restul segmentelor.
- `zod` este pin-uit exact la `4.3.6` in manifest si lockfile.
- Rutele monitoring POST/PATCH/manual-run au body-size limit dedicat inainte de parse.
- `getLatestSnapshot(ownerId, jobId)` filtreaza explicit dupa `owner_id`, pentru aparare in profunzime pe izolarea multi-user.
- Clientul API include explicit `page=0` si `pageSize=0` cand aceste valori sunt setate intentionat, in loc sa le trateze ca falsy.

### Teste + smoke

- Backend: 333 teste trecute la `npm test` in `backend/`.
- Type-check backend curat la `npx tsc --noEmit -p tsconfig.json`.
- Build productie trecut la `npm run build`.
- Smoke Electron pe port `3021`: scheduler running, job nou `dosar_soap` creat, tick real produs `monitoring_runs.status='ok'`, audit `monitoring.job.created` prezent.

---

## 28 Aprilie 2026 - v2.1.1 - PR-4: monitoring scheduler + dosar_soap runner

Al cincilea PR (saptamana 4-5). Aduce live executia: scheduler-ul tick-claim-run-finalize cu re-entrancy guard, dosar_soap runner cu compose AbortSignal (drain extern + 10min wallclock budget intern), backoff 0/120/240/.../3600s cu jitter 0-30s, source_error alert la 5 esecuri consecutive, manual-trigger route si feature ON by default (`MONITORING_ENABLED!=0` — kill switch ramane).

### Scheduler

- `backend/src/services/monitoring/scheduler.ts` — orchestration shell: `claimDueJobs` (lease semantics: in-flight `running` row exclude jobul din claim), `runOne` cu per-job AbortController, `finalize` + `applyJobOutcome` (cadence vs backoff vs source_error 1h override). Tick re-entrancy guard prin `tickInProgress` boolean. `start()` ruleaza `recoverOrphanRuns()` PRIMA — orphan `running` rows ar exclude joburile din claim altfel. `stop()` aborteaza fiecare in-flight controller si asteapta finalize-ul.
- `backend/src/util/rwlock.ts` — writer-preference RWLock; `withMaintenanceRead` (scheduler tick) vs `withMaintenanceWrite` (daily backup, restore). Stream-ul de readers nu poate flama un writer queued. Tick-ul wrap-uit in `withMaintenanceRead` cu re-check post-acquire `if (!this.running) return` pentru a preveni reader-ul parked sa execute claim+run dupa `stop()`.
- `backend/src/services/monitoring/clock.ts` — `Clock` interface cu `realClock` + `FakeClock` pentru teste deterministe.

### Runner dosar_soap

- `backend/src/services/monitoring/dosarSoapRunner.ts` — `createDosarSoapRunner({ searchDosare, budgetMs? })` factory. Compose-uieste signal extern (drain) cu `AbortSignal.timeout(10min)` via `AbortSignal.any`. Mapeaza `AbortError` cu external aborted → `aborted`, cu budget aborted → `timeout`. Diff pur `diffDosarSoap` returneaza alerts `termen_nou`, `solutie_aparuta`, `termen_modificat`. Snapshot persistat doar daca payload_hash difera de ultimul.
- `backend/src/services/monitoring/diff.ts` — diff pur intre snapshots. Foloseste `sedintaKey` cu prefix stadiu (Apel vs Fond) — fix pentru bug-ul silentios din PJI.

### Manual trigger

- `POST /api/v1/monitoring/jobs/:id/run` returneaza `202 + {runId}` (PLAN-monitoring-webmode L491). 503 cand scheduler-ul nu e mounted/running, 409 cand jobul are deja un runner in flight, 404 cand jobul lipseste sau apartine altui owner. Audit row `monitoring.job.run_manual` scris doar pe 202.
- `Scheduler.runJobNow(job)` — wrap intern pe `withMaintenanceRead` + `insertRunning` + fire-and-forget `runOne`. Reuse-uieste `getInflightAbortController` pentru detectia conflictelor.

### Boot wiring

- `index.ts`: scheduler instantiat post-`listen` (dupa `ready=true`, dupa daily backup queued), `setMonitoringScheduler(scheduler)` injecteaza handle-ul in route. `gracefulShutdown` await-uieste `scheduler.stop()` INAINTE de `closeDb()` ca runnerii sa finalize-eze run rows pe DB-ul live.
- Default flip: `MONITORING_ENABLED !== "0"` — feature-ul porneste implicit, kill switch `MONITORING_ENABLED=0` ramane pentru ops.

### Load harness

- `scripts/loadtest-monitoring.js` — k6 1000-job harness (CP-7 envelope: p95 < 500ms, error < 1%). 80% list / 15% GET / 5% manual-run mix. Manual run only — nu in CI.

### Teste (302+ in v2.1.1)

- `scheduler.test.ts` — crash recovery, success path, error backoff (1/3/5/6 fail streaks cu source_error transition exact la 4→5), `getInflightAbortController` lifecycle, `stop()`-race vs parked tick (regression dupa C4), drain semantics (fail_streak/next_run_at neschimbate pe `aborted`), `runJobNow` cu in_flight si not_running paths.
- `rwlock.test.ts` — concurrent readers, writer preference, error-self-heal.
- `monitoring.test.ts` — `POST /jobs/:id/run` cu 202/404/409/503 + audit row.

---

## 27 Aprilie 2026 - v2.1.0 - PR-3: monitoring core (schema + API + UI minimala)

Al patrulea PR din roadmap (saptamana 2-3, gated de flag-ul `MONITORING_ENABLED`). Scop: livram intreaga schema `monitoring_*`, API-ul versionat `/api/v1/monitoring/jobs` cu envelope standard `{data, error?, requestId}`, helperii partajati (canonical JSON hash, sedinta key) si o pagina minimala in UI care permite adaugarea + pauza + stergerea unui dosar din monitorizare. Pe desktop, flag-ul e setat implicit pe `1` din `electron/main.js` — feature-ul e ON by default; setare `MONITORING_ENABLED=0` in mediu functioneaza ca kill switch. Scheduler-ul (worker care chiar interogheaza PortalJust) ramane pentru PR-4 — schema si feature-flag-ul sunt insa gata.

### Migrare DDL (`0003_monitoring_core.up.sql`)

- `monitoring_jobs(id, owner_id, kind, target_json, target_hash, cadence_sec, active, paused_until, alert_config_json, next_run_at, last_run_at, last_status, fail_streak, notes, client_request_id, created_at, updated_at)`. CHECK pe `kind IN ('dosar_soap','name_soap','aviz_rnpm')` si pe `last_status IN ('ok','error','partial','skipped')`. UNIQUE `(owner_id, target_hash, kind)` previne dubluri logice; index partial UNIQUE `(owner_id, client_request_id) WHERE client_request_id IS NOT NULL` permite idempotenta opt-in pe POST.
- Index partial pentru scheduler PR-4: `idx_monitoring_due ON monitoring_jobs(next_run_at) WHERE active = 1` — narrow scan pe joburile active. Predicatul `paused_until` ramane filtru la query-time in scheduler (SQLite ingheata `datetime('now')` la creation in indexuri partiale, deci pause/unpause cycles nu s-ar mai re-include altfel).
- `monitoring_snapshots(id, job_id FK CASCADE, ts, payload_json, payload_hash, http_status)` — schema persistenta pentru rezultatele crawl-ului PR-4.
- `monitoring_alerts(id, owner_id, job_id FK CASCADE, ts, severity, kind, payload_json, dedup_key, read_at)` cu UNIQUE `(job_id, dedup_key)` — antidup intre runs (un termen schimbat o data nu mai genereaza alerta la urmatoarea verificare). CHECK pe `severity IN ('info','warn','critical')`.
- `monitoring_runs(id, job_id FK CASCADE, started_at, finished_at, status, error_message, snapshot_id, alert_count)` cu CHECK pe `status` — log de auditare per executie pentru UI-ul de health (PR-12).
- Down migration prezenta (manuala) — DROP INDEX + DROP TABLE in ordine inversa (children inainte de parent), plus `DELETE FROM _schema_versions WHERE version = 3`.

### Helperi noi (partajat intre route + repo + scheduler PR-4)

- `backend/src/util/canonicalJson.ts` — `canonicalJson(value)` (JSON cu chei sortate, fara whitespace) si `canonicalSha256(value)`. Folosit pentru `target_hash`: doua jobs cu acelasi target produc acelasi hash indiferent de ordinea cheilor in payload-ul clientului.
- `backend/src/services/monitoring/sedintaKey.ts` — `buildSedintaKey({stadiuProcesual, data, ora, complet, solutie})` returneaza `${stadiu}|${data}|${ora}|${complet}|${solutie}` dupa normalizare (date `YYYY-MM-DD`, ora `HH:MM`, stadiu lowercase fara diacritice). Diferenta critica fata de proiectul-sora PJI: prefix-ul `stadiu` in cheie elimina coliziunile dintre Apel si Fond la aceeasi data — bug-ul pe care PJI il avea silentios. `buildSedintaKeyWithoutSolutie()` separat pentru detectia "solutie nou aparuta".
- `backend/src/middleware/requestId.ts` — `requestIdContext` mount-uit dupa `ownerContext` in `index.ts`. Accepta inbound `x-request-id` cand matcheaza `/^[A-Za-z0-9_\-]{8,128}$/`, altfel genereaza UUID v4. Surfata pe envelope (`requestId`) si pe response header `x-request-id`.
- `backend/src/util/envelope.ts` — `ok(data, c)` si `fail(code, message, c, details?)` helperi pentru rutele v1. Legacy non-envelope (`/api/dosare`, `/api/termene`, `/api/rnpm`, `/api/ai`) raman pe formatul vechi pana la PR-6 (`@hono/zod-openapi`).

### Repository + Zod schemas

- `backend/src/db/monitoringJobsRepository.ts` cu `createJob`, `getJobById`, `listJobs`, `updateJob`, `deleteJob` — toate scope-uite pe `owner_id`. `createJob` are doua nivele de idempotenta: (1) `client_request_id` UNIQUE → returneaza randul existent ca `idempotentReplay: true`; (2) `target_hash + kind` collision → returneaza randul existent ca `duplicate: true, idempotentReplay: false`. Audit-ul se scrie doar pe insert real, nu pe replay.
- `backend/src/db/monitoringAlertsRepository.ts` — stub `insertAlert` (idempotent pe `dedup_key`), `listByJob`, `markRead`. Schema gata; PR-4 ataseaza producerul.
- `backend/src/schemas/monitoring.ts` — `JobCreateBodySchema = z.discriminatedUnion("kind", [...])`, fiecare branch cu `target` validat per kind (`numar_dosar` regex `^\d{1,7}/\d{1,5}/\d{4}(?:/[A-Za-z0-9]+)?$` pentru `dosar_soap`). `.strict()` peste tot — chei extra → 422. `JobUpdateBodySchema` rejecta `kind`/`target` (immutable) cu `.refine` non-empty.

### API `/api/v1/monitoring/jobs` (gated `MONITORING_ENABLED`, desktop default = `1`)

- `GET /jobs` — pagination + filter `kind=` + `active=true|false`. Envelope `{data: {rows, total, page, pageSize}, requestId}`.
- `GET /jobs/:id` — owner-scoped. Daca jobul exista dar la alt owner: **404 not_found** (deliberat, nu 403, ca sa nu leak-uiasca existenta).
- `POST /jobs` — 201 pe insert nou, 200 pe replay/duplicate. Audit doar pe insert.
- `PATCH /jobs/:id` — partial merge pentru `alert_config`, restul cimpurilor overwrite. 404 cand id-ul nu e al userului.
- `DELETE /jobs/:id` — CASCADE pe snapshots/alerts/runs prin FK. 404 cand nu e al userului.
- Toate mutatiile scriu `audit_log` cu `action: monitoring.job.{created,updated,deleted}`, `target_kind: monitoring_job`, `target_id: <id>`.

### Frontend — pagina `Monitorizare` + integrare in Cautare Dosare

- `frontend/src/pages/Monitorizare.tsx` (read + add + delete + pause/resume). Pagina minimala in stilul aplicatiei: un card pentru formularul de adaugare (numar dosar + cadenta + note) si un tabel cu joburile active (target, tip, cadenta, urmatoarea verificare, ultima rulare, status, actiuni). Refresh pe demand.
- `frontend/src/components/Sidebar.tsx` — link nou `/monitorizare` cu icon `Activity`.
- `frontend/src/components/DosareTable.tsx` — buton **"Monitorizeaza schimbari"** in panoul expanded al unui dosar. Click → POST cu `client_request_id` deterministic per dosar (idempotent la double-click). Feedback inline: "Adaugat" / "Deja monitorizat" / mesaj eroare. Hub-ul global ramane pagina Monitorizare.
- `frontend/src/lib/api.ts` — sectiune `monitoring` + `MonitoringApiError` cu envelope unwrap. Trecut prin acelasi modul ca restul API-ului ca sa respecte hook-ul `block-renderer-fetch`.

### Tests (93 noi → total **192** backend, de la 99)

- `canonicalJson.test.ts` (19 teste) — sort-by-key recursiv, `undefined` skip, BigInt fallback, hash determinism cross-order.
- `monitoring.test.ts` Zod (26 teste) — discriminated union, regex `numar_dosar`, alert config defaults, `.strict()` reject, PATCH refuse `kind`/`target`, plus assertion pentru cadence default = 14400.
- `sedintaKey.test.ts` (23 teste) — normalizare data/ora/stadiu, determinism cross-cosmetic-drift, segment integrity (stadiu prefix critic), `buildSedintaKeyWithoutSolutie` semantics.
- `monitoring.test.ts` integration (25 teste) — POST 201/200/duplicate-replay, idempotency `client_request_id`, owner_id isolation 404 (GET/PATCH/DELETE), audit_log writes pe mutatii (verificat ca tx atomic prin `getDb().transaction()`), malformed JSON → 400, unknown kind / numar_dosar invalid → 422, `x-request-id` propagation (inbound valid echo, malformed -> mint UUID, missing -> mint UUID), filter `kind=` + `active=`, pageSize cap, `institutie` array sort+dedup determinism (target_hash stable cross-order), `next_run_at` recompute la PATCH cadence_sec.

### Post-review hardening (deep + reliability + audit-trail review feedback)

Dupa run-ul de `/full-review` peste PR-3 (8 reviewers paraleli), cele 4 valuri de remediere au fost aplicate inainte de commit — toate fixate cu blast-radius LOW si cu mitiganti documentati:

**Wave 1 — schema correctness (`0003_monitoring_core.up.sql`)**:
- `cadence_sec NOT NULL DEFAULT 14400` (era fara default → INSERT-uri viitoare ar fi fost forced sa-l specifice manual; alinierea cu Zod default elimina drift-ul).
- Toate cele 4 timestamp-uri (`created_at`, `updated_at`, `observed_at`, `created_at` pe alerts) trec de la `datetime('now')` (format SQLite naive, space-separated) la `strftime('%Y-%m-%dT%H:%M:%fZ','now')` (ISO Z) — V8 `new Date()` parsa formatul vechi ca **local time** in loc de UTC, drift de pana la 12h pe useri din timezone-uri non-UTC.
- `idx_monitoring_due` simplificat: predicatul `paused_until` scos definitiv (vezi comentariu in fisier — `datetime('now')` se ingheata la index-creation in SQLite, deci pause/unpause cycles ar fi ramas permanent excluse). Filtrarea `paused_until` ramane la query-time in scheduler (PR-4).

**Wave 2 — validation determinism (`backend/src/schemas/monitoring.ts`)**:
- `institutie: z.array(...).transform(arr => Array.from(new Set(arr)).sort())` — Zod transform ce dedup + sort ordinea de array `name_soap`. Fara asta, doi useri care submit `["X", "Y"]` vs `["Y", "X"]` (acelasi target logic) primeau hash-uri diferite si jobs separate.
- `cadence_sec` Zod default mutat de la 600 la 14400 (4h), aliniat cu schema SQL si cu `CADENCE_OPTIONS` din UI.

**Wave 3 — atomic audit + recompute next_run_at (`backend/src/db/monitoringJobsRepository.ts` + `backend/src/routes/monitoring.ts`)**:
- Toate cele 3 mutatii (POST/PATCH/DELETE) wrapped in `getDb().transaction(() => { mutate; recordAudit(...); })()`. better-sqlite3 transactions sunt sincrone si pe connection-level (singleton `getDb()`), deci o exceptie la `recordAudit` rollback-uieste si jobul. Inainte: existau ferestre micro-secunde in care un crash intre INSERT job si INSERT audit putea lasa state-ul inconsistent.
- `updateJob` recomputeaza `next_run_at` cand userul schimba `cadence_sec`, `active` sau `paused_until` — folosind `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+N seconds')`. Inainte: PATCH la cadenta nu avea efect pana la urmatorul tick de scheduler care el insusi astepta vechiul `next_run_at`.

**Wave 4 — frontend correctness (`frontend/src/pages/Monitorizare.tsx` + tabel components + `lib/utils.ts` + `lib/api.ts`)**:
- `parseSqliteUtc()` helper nou in `frontend/src/lib/utils.ts` — defensive pentru ambele formate (legacy naive space-separated vs noul ISO Z) si folosit in `DosareTable.tsx` + `TermeneTable.tsx` la display-ul `created_at`. Pana cand toate row-urile sunt rescrise de scheduler, vor coexista in DB.
- Eliminat loop-ul `auto-PATCH off-grid` din `Monitorizare.tsx` (era anti-pattern: refresh-ul list-ului pornea N PATCH-uri secventiale catre joburi cu `cadence_sec` in afara grid-ului UI, generand audit_log spam si race condition la dublu-render).
- `monitoring.delete` redenumit `monitoring.deleteJob` in `lib/api.ts` (`delete` e keyword JS rezervat, IDE hint-ul devenea inutilizabil in TypeScript strict).
- Diacriticele in pagina Monitorizare normalizate la varianta fara semne (legacy constraint PortalJust + restul UI).
- Activity icon adaugat la sidebar item.

### Bump

`2.0.13 → 2.1.0` minor — feature nou (monitoring API + UI), schema noua, gated de `MONITORING_ENABLED` (desktop default `1` din `electron/main.js`). Pe desktop, userul vede tabul Monitorizare in sidebar si poate adauga dosare la prima pornire dupa upgrade — schema 0003 ruleaza automat (idempotent). Setand `MONITORING_ENABLED=0` in mediu, codul devine inert: ruta nu e mount-uita, nimic nu schimba comportamentul existing — kill switch curat in caz de incident. Scheduler-ul (worker-ul care chiar interogheaza PortalJust) ramane off pana la PR-4 — UI-ul afiseaza explicit acest lucru in pagina.

### Risk

🟢 **LOW**. Ruta noua e izolata sub `/api/v1/monitoring/*` si gated explicit; rutele existente raman bit-pentru-bit identice. Migrarea 0003 ataseaza tabele noi, nu modifica nimic existent — rollback clean prin down migration. Idempotenta dubla pe POST elimina riscul de duplicate la retry-uri de retea. Owner isolation acoperita end-to-end (GET/PATCH/DELETE -> 404 cross-owner) si verificata in 4 teste integrate. Singurul risc de comportament neasteptat: scheduler-ul lipsa face ca `next_run_at` sa nu mai conteze pana la PR-4, dar UI-ul afiseaza acest lucru explicit.

---

## 27 Aprilie 2026 - v2.0.13 - PR-2: shadow tables auth + audit_log

Al treilea PR din roadmap (saptamana 1 incheiata). Scop: introducem `users`, `user_sessions`, `audit_log` ca tabele "shadow" — definite de acum dar nepopulate cu utilizatori reali pana la PR-9 (web mode + Google SSO). `audit_log` insa devine imediat scriabil prin helperul `recordAudit()`, pe care PR-3+ il vor consuma pe fiecare mutatie sensibila (monitoring CRUD, name list import, AI request). Pe desktop, comportamentul ramane identic: un singur user sintetic `local` e seed-uit, iar restul tabelei `users` e gol.

### Migrare DDL (`0002_users_sessions_audit.up.sql`)

- `users(id, email UNIQUE, password_hash, display_name, role, status, created_at, last_login_at, meta_json)`. CHECK pe `role IN ('user','admin','support','readonly')` si pe `status IN ('active','suspended','deleted')`.
- `user_sessions(id, user_id FK→users.id ON DELETE CASCADE, token_hash UNIQUE, user_agent, ip, expires_at, revoked_at, created_at)` cu index `(user_id, revoked_at)`.
- Seed `INSERT OR IGNORE INTO users(...) VALUES ('local','local@desktop','Local User','user')` — un singur user sintetic care reprezinta sesiunea desktop.
- `audit_log(id, owner_id, actor_id, ts, action, target_kind, target_id, outcome, ip, user_agent, detail_json)` cu CHECK `outcome IN ('ok','denied','error')` si indexuri `(owner_id, ts DESC)` + `(actor_id, ts DESC)`. `owner_id` nullable pentru evenimente de sistem.
- Down migration prezenta (manuala, neexecutata automat de runner) — DROP INDEX + DROP TABLE in ordinea inversa, plus `DELETE FROM _schema_versions WHERE version=2`.

### Helper `recordAudit()` (`backend/src/db/auditRepository.ts`)

- API: `recordAudit(c | null, action, options?)`. Cu `c: Hono.Context` extrage automat `owner_id`, `actor_id`, `ip` (via `getConnInfo` — consistenta cu rate-limit-ul, **NU** trusted proxy headers), `user-agent`. Cu `c = null` semneaza evenimente de sistem (boot, scheduler tick, backup).
- Override-uri explicite in `options` (e.g. admin actionand pentru alt tenant) cad peste valorile derivate din context.
- `serializeDetail()` JSON-ifica obiectul; pentru circular refs sau BigInt, fallback la `{_audit_serialize_error: true}` ca path-ul de audit sa nu blocheze niciodata request-ul.
- `getAuditEvents({ownerId, action, limit})` pentru read scope-uit pe owner sau system events (`ownerId: null`). Limit clamped `[1, 1000]`.
- Sincron pe scop — audit-urile se scriu pe mutatii (rar), nu pe queries (des). Erorile propaga; caller-ul decide daca le inghite.

### Tests (13 noi → total **99** backend, de la 85)

`backend/src/db/auditRepository.test.ts`:

- **Schema (6 teste)**: tabelele exista post-0002, seed `local` user prezent, `_schema_versions(2)` are hash real (nu sentinel-ul), CHECK rejecta role/status/outcome invalid, ON DELETE CASCADE pe user_sessions, idempotency la al 2-lea boot.
- **Write paths (4 teste)**: system events (`c=null`), context auto-fill (Hono `app.request()` cu `ownerContext` mount-uit end-to-end), explicit overrides, fallback pe detail necirculizabil.
- **Read paths (3 teste)**: scope per owner, system filter (`ownerId: null`), limit clamp.

Plus 1 fix in `runner.test.ts`: integration test-ul "real baseline" se astepta la `result.applied === [1]` — acum cu 0002 in repo, e `[1, 2]`. Testul foloseste `applied[0] === 1` + `length >= 1` ca sa nu mai fie nevoie de update la fiecare PR viitor.

### Bump

`2.0.12 → 2.0.13` patch. DDL nou pe DB-urile existente (legacy backfilled), zero schimbare user-vizibila, zero rute noi. Modulul `auditRepository` e pregatit dar inca neapelat (consumatori — PR-3+).

### Risk

🟢 **LOW**. 0002 ruleaza o singura data per DB. Pe DB-uri legacy: `_schema_versions(1, sentinel)` exista deja → 0002 vede applied=[1], aplica fresh, recordeaza `(2, sha256)`. Pe DB fresh: `0001_baseline` instaleaza schema rnpm_*, `0002` instaleaza users + audit. Seed-ul `INSERT OR IGNORE` e safe daca cineva pre-seed-uieste manual. Niciun query existent nu e modificat — tabelele noi nu intersecteaza cu rnpm_*.

---

## 27 Aprilie 2026 - v2.0.12 - PR-1: getOwnerId helper + 5 owner_id leak fixes

Al doilea PR din roadmap (PLAN §3 + EXECUTION-ROADMAP saptamana 1). Scop: stabilim seam-ul prin care toate rutele viitoare vor citi `owner_id`-ul curent din context si inchidem cele 5 cai latente prin care un FK breach ar fi putut leak-ui randuri intre owneri in modul web (PR-9+). Pe desktop, comportamentul ramane identic (singurul `owner_id` activ e in continuare `"local"`).

### Helper + middleware (`backend/src/middleware/owner.ts`)

- `ownerContext`: middleware Hono care seteaza `c.set("ownerId", "local")` pe fiecare request. PR-9 va inlocui valoarea cu user id-ul derivat din JWT (si va respinge requesturi neautentificate).
- `getOwnerId(c)`: helper consumat de rutele noi (PR-3+). Citeste valoarea seteaza de middleware; fallback `"local"` astfel incat o eventuala lipsa de mount sa pastreze comportamentul desktop.
- `ContextVariableMap` augmentat o singura data — `c.get("ownerId")` returneaza `string` in tot codebase-ul, fara cast manual.
- Mount-uit in `index.ts` ca `app.use("*", ownerContext)` inainte de `rateLimit` (deja pregatit pentru rate-limit per owner in PR-12).

### Fix-uri leak `avizRepository.ts` (5 locuri, PLAN §3)

`loadAvizChildren` re-querya copiii (creditori/debitori/bunuri/istoric) doar dupa `aviz_id`, fara `owner_id`. Daca un FK breach apare vreodata (bug de migrare, restore partial), child-ul user-ului B s-ar fi livrat catre user A. Toate cele 4 query-uri primesc acum `AND owner_id = ?` si pasa `aviz.owner_id`.

`getAvize` continea doua sub-clauze `EXISTS` peste `rnpm_creditori` / `rnpm_debitori` care matchau pe `c.aviz_id = a.id` fara constraint pe `owner_id`. Adaugat `AND c.owner_id = a.owner_id` (idem `d`) — un breach child al lui B nu mai poate face ca aviz-ul lui A sa apara in rezultatele unei cautari ale lui A.

### Test de regresie (`backend/src/db/repository-isolation.test.ts`)

Skeleton extensibil pentru toate repo-urile viitoare:

- **Happy path** (3 teste): `getAvize`, `getAvizById`/`getAvizByIdentificator`, `getAvizStats`/`getAvizeByIds`/`deleteAviz*` toate respecta filtrul `owner_id`. Cross-owner reads/writes intoarce `null` / `0`.
- **FK breach defense** (5 teste, cate unul per fix): inserturi raw care simuleaza un copil cu `owner_id` mismatch fata de aviz-ul parinte, apoi assert ca repo-ul **nu** returneaza randul forjat. Acopera toate cele 5 leak-uri din PLAN §3.

Suite-ul ruleaza in tmp dir cu `LEGAL_DASHBOARD_DB_PATH` setat per-test, deci nu atinge baza locala. 8 teste noi → total **85** in backend (de la 77).

### Bump

`2.0.11 → 2.0.12` patch. Zero schimbari user-vizibile, zero migrare DDL noua (PR-1 nu adauga schema, doar query fixes).

### Risk

🟢 **LOW**. Pe desktop singurul `owner_id` e `"local"` peste tot, deci constraint-urile noi `AND owner_id = ?` sunt no-op functional. Singura schimbare de comportament posibila e cazul (improbabil) de FK breach pre-existent: random copil ortografiat manual ar deveni invizibil — but exact asta e scopul fix-ului.

---

## 27 Aprilie 2026 - v2.0.11 - PR-0: migration framework + _schema_versions

Primul PR din roadmap-ul de monitoring + web mode (vezi `PLAN-monitoring-webmode.md`, `EXECUTION-ROADMAP.md`). Scopul e infrastructural: introducem un mecanism de migrari versionate inainte sa adaugam orice schema noua in PR-2+.

### Migration framework (`backend/src/db/migrations/`)

- `runner.ts` exporta `runMigrations(db, migrationsDir)`. La boot citeste sincron toate fisierele `0001_*.up.sql`, `0002_*.up.sql`, ... (sortate numeric, contiguu de la 1) si le aplica in tranzactie pe cele neinregistrate inca in tabela `_schema_versions(version INTEGER PRIMARY KEY, applied_at TEXT, sha256_up TEXT)`.
- **Backfill pentru DB-uri legacy**: la prima rulare, daca `_schema_versions` e gol AND DB-ul are tabele user (instalari v2.0.10 si mai vechi), runner-ul insereaza `(1, '__backfilled_v1__')` si SARE peste executia `0001_baseline.up.sql`. Asta evita `CREATE TABLE` duplicat pe schema deja prezenta.
- **Drift detection**: la rulari ulterioare, daca hash-ul stocat difera de continutul fisierului → throw + abort boot. Mesajul de eroare include numarul versiunii urmatoare disponibile pentru forward progress (e.g. "create a new 0002_*.up.sql instead").
- **Downgrade guard**: daca DB-ul are versiune > max(file_version) → throw (preveniti accidentul "checkout commit vechi pe DB nou").
- **Sanity la discovery**: duplicate de versiune, gap-uri in numerotare, lipsa directorului → throw cu mesaj clar.

### Baseline schema commit-uita (`0001_baseline.up.sql`)

- Reflecta v2.0.10 in forma FINALA post-ALTER: rnpm_avize cu cele 4 coloane `inscriere_initiala/modificata_*`, rnpm_creditori/debitori cu `subscriptor + nr_ordine`, rnpm_bunuri **fara** `descriere` (deduplicat in `rnpm_bunuri_descrieri`) dar cu `referinte_json + descriere_id`.
- Ordinea CREATE respecta dependintele FK sub `PRAGMA foreign_keys = ON`: searches → avize → bunuri_descrieri → creditori/debitori → bunuri → istoric.
- Pe DB-uri fresh (CI, instalari noi), runner-ul executa fisierul si stocheaza sha256 real. Pe instalari legacy se sare prin sentinel.

### Wiring in `schema.ts`

- `initSchema()` apeleaza `runMigrations()` ca **Phase 1**, urmat de blocul idempotent legacy CREATE/ALTER existent ca **Phase 2**. Phase 2 ramane intact pentru DB-urile backfilled cu sentinel — pentru ele 0001_baseline e skipped, deci ALTER-urile inline sunt singura sursa de mentinere a coloanelor adaugate intre v2.0.0 → v2.0.10.
- Zero schimbare de comportament pentru useri instalati: `LEGAL_DASHBOARD_DB_PATH` deschide DB-ul existent → backfill o singura data → ALTER-urile inline ruleaza ca pana acum → totul continua.

### Build pipeline (`scripts/build.js`)

- Pas nou `[4/4] Copying migration files...` care copiaza `backend/src/db/migrations/*.up.sql` + `*.down.sql` la `dist-backend/migrations/`. Esbuild bundleaza CJS dar nu copiaza assets non-JS; runner-ul le citeste cu `fs.readdirSync(migrationsDir)` la boot.
- Filtru pozitiv (whitelist `*.up.sql|*.down.sql` plus directoare pentru recursie), nu negativ — fisierele sidecar (test, README, viitoare TS helpers) raman in afara bundle-ului productie.

### Tests (`runner.test.ts`)

- 15 teste vitest pe runner: ordering numeric, idempotency, hash mismatch → throw, backfill cu sentinel pe DB legacy, sentinel sare hash check, transaction rollback la SQL invalid, gap detection, duplicate version detection, downgrade guard.
- Plus un test integration care ruleaza efectiv `0001_baseline.up.sql` pe DB temporar si verifica ca toate cele 7 tabele sunt create.

### Verificare

- `npx tsc --noEmit -p backend/tsconfig.json` — clean.
- `npm test --workspace=backend` — toate testele verde (62 existente + 15 noi runner = 77 total).
- Smoke desktop: `npm run electron:dev` cu DB-ul existing v2.0.10 → boot ok, log `[schema] legacy DB — backfilled _schema_versions(1, sentinel)` o singura data, run urmator → silent (deja backfilled).

---

## 26 Aprilie 2026 - v2.0.10 - hardening: AI logging extension + backup maintenance lock + safeStorage trim

Continuare directa a `v2.0.9`. Trei imbunatatiri de hardening pe linia de observabilitate AI, integritatea operatiilor de backup/restore si robustetea persistentei cheilor API. Plus o investigatie negativa inchisa pe partea de captcha RNPM.

### Observabilitate AI extinsa

- `services/ai.ts` exporta acum helper-ul `isTimeoutOrAbort(e)` care detecteaza corect timeout-urile si abort-urile inclusiv pentru subclase SDK (Anthropic / OpenAI `APIUserAbortError` / `APIConnectionTimeoutError`, Google SDK abort errors). Inainte normalizarea se baza doar pe `e.name`, care e `"Error"` pentru subclase ce nu il override-uiesc - branch-ul timeout era practic dead.
- `withAiLogging` accepta acum `{ value, meta }` din functia interioara, astfel incat fiecare provider sa-si ataseze `usageInput` / `usageOutput` (token counts) la log-ul JSON. Plus capturarea `httpStatus` din erorile SDK (`.status` pe `APIError`) ca dashboard-urile sa poata splita 4xx/5xx vs network/abort.
- `ai_call` log line acum poate include: `httpStatus`, `usageInput`, `usageOutput`, complementar cu `latencyMs`, `status`, `errorType`. Pasul intermediar pana la `audit_log` persistent (Faza 5).

### Backup/restore: maintenance lock + WAL truncate pre-snapshot

- `withMaintenanceLock` (promise chain in-process) serializeaza `restoreFromBackup` cu `runDailyBackup`. Pe desktop nu sunt concurente in practica, dar scheduler-ul `runDailyBackup` putea teoretic interleave-ui cu un restore initiat de user care inchide DB-ul mid-`db.backup()` -> destinatie corupta. Web mode va inlocui cu row-lock / advisory lock.
- Pre-restore snapshot face acum `PRAGMA wal_checkpoint(TRUNCATE)` *inainte* de `closeDb()`. Fara checkpoint, pre-restore copy captura doar fisierul `.db` si pierdea frame-urile WAL necommitate -> rollback-ul "moments before restore" era silent incomplete.
- `logBackupEvent` (single-line JSON, `ts` auto-stamp) inlocuieste `console.log` ad-hoc. `daily_backup_failed` distinge acum `stage: "mkdir"` vs `stage: "backup"`. Sterge orphan sidecar `-wal`/`-shm` cu logging non-ENOENT (EBUSY de la AV pe Windows nu mai e silentios).
- `runDailyBackup` foloseste `await fsPromises.mkdir` in loc de `fs.mkdirSync` (nu mai blocheaza event loop-ul; cosmetic - dir-ul exista in 99% din cazuri).

### Frontend: safeStorage defensive trim

- `useApiKey.setKeys()` aplica `.trim()` pe fiecare cheie inainte de persistare. Inchide o gap legacy: path-ul de migrare `deobfuscate` propaga whitespace din intrari vechi `localStorage`, iar fara trim-ul defensiv keystore-ul ramanea cu spaces care faceau cererile sa esueze cu 401. `setKey` deja trimea valoarea individuala; `setKeys` (bulk) nu o facea.

### RNPM gcode caching - investigatie inchisa (negativa)

- Test empiric `2026-04-26` confirma ca RNPM **respinge** reuse-ul gcode intre cautari cu parametri diferiti. Spike in `RnpmSearch.tsx` care threading `existingGcode` din `runSearch` precedent a generat in backend `phase: "search_retry"` (gap 16.4s = failed-SOAP + captcha re-solve + retry), nu `phase: "search"` direct.
- Concluzie: captcha-per-query este cost intrinsec la nivelul API-ului RNPM. Optimizarile client-side nu pot evita. Path-ul existent de pagination intra-search (`loadNextBatch` reuseaza gcode-ul corect) ramane valid.
- Mitigari posibile pe viitor (neinvestigate): provider mai rapid (CapSolver vs 2Captcha - deja setting), race mode (deja suportat), pre-warm captcha speculativ.

### CodeRabbit follow-up

- Verificate trei claim-uri pe CodeRabbit: `setKeys` nu trim (PARTIAL VALID - fixat), `.mcp.json` shape (FALSE POSITIVE - format-ul actual e valid), `fs.mkdirSync` blocking (VALID cosmetic - fixat). Cele doua valid au fost executate pure-equivalent fara impact functional.

### Verificare

- `npx tsc --noEmit -p backend/tsconfig.json` - clean.
- `cd frontend && npx tsc --noEmit` - clean.
- `npm test --workspace=backend` - 62/62 teste verde (include teste noi pe `withMaintenanceLock` + WAL checkpoint si pe `isTimeoutOrAbort`).

---

## 26 Aprilie 2026 - v2.0.9 - Faza 10 medium close-out + Docker CI

Continuare directa a hardening-ului `v2.0.8`: inchide ultimele patru medium-priority din review-ul Faza 10 (M4-M7) si adauga un workflow GitHub Actions care valideaza imaginea Docker la fiecare push pe `main` sau pull request.

### Restore correctness (F10-M4 + F10-M5)

- `restoreFromBackup` foloseste acum `await fsPromises.access(dbPath)` + flag `dbExists` in loc de `fs.existsSync`. Path-ul ramane integral asincron, iar event loop-ul nu mai blocheaza pe stat-uri lente (de ex. fisier scanat de antivirus).
- `unlink(-wal)` / `unlink(-shm)` se executa **inainte** de `rename(tmpPath, dbPath)`. Inainte exista o fereastra in care DB-ul nou era pereche cu sidecar-uri WAL/SHM stale, iar `better-sqlite3` putea face lazy open peste combinatia gresita (silent corruption la primul query post-restore).

### Observability (F10-M6)

- `services/ai.ts` introduce helper-ul `withAiLogging(provider, model, fn)` care imbraca `callAnthropic` / `callOpenAI` / `callGoogle`. Fiecare apel emite un singur rand JSON: `{ action: "ai_call", provider, model, latencyMs, status, errorType?, ts }`. `TimeoutError` / `AbortError` sunt normalizate la `errorType: "timeout"` ca agregatoarele sa nu trebuiasca sa special-case-uieze ambele.
- Util pentru ops: cost tracking grosier per provider, rata de timeout-uri, latente la nivel de model. `audit_log` persistent ramane scope Faza 5 (compliance).

### Docker CI smoke test (F10-M7)

- `.github/workflows/docker-build.yml` ruleaza la push pe `main` si la PR atunci cand `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `package-lock.json`, `backend/**`, `frontend/**` sau `scripts/build.js` se schimba.
- Pasi: `npm ci` + `npm run build` (genereaza `dist-backend/` + `dist-frontend/` cerute de Dockerfile) -> `docker build -t legal-dashboard:ci .` -> smoke test `node -e "console.log(process.version)"` in image -> smoke test `/health` (poll 60s, valideaza prewarm + listen flip la 200 OK in container).
- Containerul primeste `HOST=0.0.0.0` + `LEGAL_DASHBOARD_ALLOW_REMOTE=1` la `docker run` astfel incat portul 3002 sa fie accesibil din afara (loopback-ul containerului e izolat de host - `-p 3002:3002` cere bind non-loopback).
- Esuarea oricarui pas dump-eaza `docker logs ld-ci` si `exit 1`, ca triage-ul sa fie posibil direct din run-ul GitHub Actions.

### Verificare

- `npx tsc --noEmit -p backend/tsconfig.json` - clean.
- `npm test --workspace=backend` - 55/55 teste verde.
- `cd frontend && npx tsc --noEmit` - clean.
- GitHub Actions Docker Build run `24955410182` - verde in 2m20s, smoke test `/health` confirma 200 OK in containerul produs.

---

## 26 Aprilie 2026 - v2.0.8 - hardening + release packaging

Sesiune de hardening dupa tag-ul `v2.0.7`. Versiunea `v2.0.8` include fixurile post-tag pentru backup/env/SOAP, teste de regresie pe backup atomic si packaging reproductibil pentru Docker + ZIP server.

### Backend hardening - backup, restore, env si SOAP cancel

**Fixuri livrate:**

- `backend/.env.example` nu mai contine `NODE_ENV=development`; template-ul explica faptul ca Electron/Docker seteaza production, iar dev mode se activeaza explicit din shell.
- `cautareDosare(params, { signal })` propaga `AbortSignal` pana in `fetch`-ul SOAP prin `AbortSignal.any([external, timeout])`, deci disconnect-ul clientului sau timeout-ul SSE opresc request-ul in zbor.
- `runDailyBackup` scrie backup-ul zilnic la `${dest}.tmp`, apoi face `rename` atomic; orphan `.db.tmp` se curata la urmatorul run.
- `restoreFromBackup` emite log JSON structurat `{ action, source, preRestore, ts }`, util pana la introducerea unui `audit_log` persistent.

### Teste backup atomicity (F10-M8)

- `backup.test.ts` acopera cleanup-ul orphan `legal-dashboard.*.db.tmp`.
- Verifica faptul ca fisierele `.tmp` care nu apartin aplicatiei nu sunt sterse.
- Verifica faptul ca `listBackupsWithMeta` expune doar backup-uri finalizate `.db`, nu staging `.db.tmp`.
- Verifica retention pools separate pentru daily / pre-restore / pre-migration (`7/5/5`), ca un pool sa nu le elimine pe celelalte.

### Release packaging - Docker si ZIP server

- `Dockerfile` foloseste acum `package-lock.json` + `npm ci --omit=dev --workspace=backend --include-workspace-root=false --build-from-source`, nu `npm install` fara lockfile.
- `Dockerfile` si `docker-compose.yml` au `start-period/start_period=120s` pe healthcheck pentru boot-uri lente cu prewarm/migrari DB.
- `dist:server` include in ZIP root `package.json`, `package-lock.json`, `backend/package.json`, `frontend/package.json`.
- `start.sh` / `start.bat` instaleaza runtime deps cu `npm ci` la prima pornire daca lipseste `node_modules/better-sqlite3`, astfel incat modulul nativ sa fie construit pe platforma tinta.
- `.gitignore` ignora `server-release/`; `.dockerignore` pastreaza manifestele necesare workspace-ului in build context.

### Developer workflow

- Script nou `npm run rebuild:electron` pentru recompilarea `better-sqlite3` pe ABI-ul Electron dupa teste Node / `npm rebuild`.

### Verificare

- `npx tsc --noEmit -p backend/tsconfig.json` - clean.
- `npm test --workspace=backend` - 55/55 teste verde.
- `npm run build` - clean.
- `npm run dist:server` - ZIP generat; arhiva contine lockfile + manifests + start scripts.
- `npm run rebuild:electron` + `npm run electron:dev` - aplicatia porneste, `/health` raspunde 200.

---

## 26 Aprilie 2026 - v2.0.7 - RNPM tab-state UX fix

Sesiune de corectie UI pentru tab-ul **Cautare RNPM**. Bump de versiune din `2.0.6` la `2.0.7`, ca fixul sa fie vizibil in aplicatie, documentatie si artefactele de release.

### RNPM - rezultatele nu mai "curg" intre cele 5 categorii

**Simptom:** dupa o cautare in `Aviz de ipoteca mobiliara`, rezultatele ramaneau vizibile si dupa schimbarea categoriei interne catre `Fiducie`, `Aviz specific`, `Creante securitizate` sau `Obligatiuni ipotecare`.

**Fix:**

- [frontend/src/components/rnpm/RnpmSearchForm.tsx](frontend/src/components/rnpm/RnpmSearchForm.tsx) expune `onTypeChange`, apelat cand utilizatorul schimba categoria RNPM.
- [frontend/src/pages/RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx) tine `activeSearchType` separat de `lastType`.
- Tabelul, mesajele de eroare si actiunile `Incarca tot` / `Opreste incarcarea` folosesc `visibleResult` / `visibleError`, afisate doar cand `activeSearchType === lastType`.

### RNPM - revenire corecta din Cautare / Bulk / Baza locala

**Simptom:** cand utilizatorul pleca din tab-ul principal `Cautare` catre `Bulk` sau `Baza locala`, apoi revenea, formularul se remonta pe prima categorie (`Aviz de ipoteca mobiliara`). Daca rezultatul anterior apartinea acelei categorii, uneori ramanea ascuns pana cand utilizatorul se plimba manual intre cele 5 categorii.

**Fix:**

- Sectiunea `Cautare` ramane montata permanent si este doar ascunsa cu `hidden`, la fel ca `RnpmSavedData`.
- State-ul intern al formularului ramane viu intre cele 3 taburi principale: categoria activa, campurile completate si rezultatul vizibil.
- `RnpmSearchForm` sincronizeaza categoria activa cu parent-ul la mount si la schimbarea categoriei, ca UI-ul vizibil si `activeSearchType` sa nu mai intre in drift.

### Verificare

- `npm run build --workspace=frontend` - clean.
- `npm run build` - clean; `dist-frontend` si `dist-backend` regenerate.
- Electron repornit manual; `/health` raspunde `ok`, `/api/rnpm/saved` raspunde cu date.

---

## 19 Aprilie 2026 (sesiune 3) — v2.0.6 — SOAP XML entity decoding + consolidare CodeRabbit findings

Fix de corectitudine pe parser-ul SOAP PortalJust + consolidarea auditului CodeRabbit 19.04.2026 in roadmap-ul de hardening. Nimic nou in feature set — doar bani ficti mai curati pe display + un punch-list explicit pentru tranzitia web si modulul de monitorizare.

### SOAP parser — decodare entitati XML (I3 din audit CodeRabbit)

**Simptom:** nume parti cu `&` / `'` / `"` (ex. `S.C. X &amp; Co. SRL`, `John&apos;s Pub`) apareau cu literal `&amp;` / `&apos;` in tabele, modal detalii, export XLSX si promptul AI. `DOMPurify` neutraliza orice risc de injectie, deci nu e vulnerabilitate — dar output-ul e vizibil gresit.

**Cauza:** [backend/src/soap.ts](backend/src/soap.ts) foloseste regex simplu pentru `extractFirst` / `extractAll`, fara decoder pentru entitati XML. PortalJust (corect) escape-eaza `&`, `<`, `>`, `"`, `'` in text nodes — aplicatia le returna raw.

**Fix:**

- Helper nou `decodeXmlEntities(s)` exportat din `soap.ts` — decodeaza in ordine: numeric hex (`&#x41;`), numeric zecimal (`&#65;`), named (`&lt;`, `&gt;`, `&quot;`, `&apos;`) si **`&amp;` ultimul** ca sa nu dublu-decodeze secvente de forma `&amp;lt;` in `<`.
- **Aplicat la leaf fields** in `parseDosar`, nu la nivelul `extractFirst` / `extractAll`. Motiv: extractoarele pot returna XML inner cu tag-uri nested (`<DosarParte>` in `<parti>`); decoderea prematura ar risca sa transforme text legal cu `&lt;` in tag-uri fantoma. Campuri decodate: `obiect`, `institutie`, `departament`, `categorieCaz`, `stadiuProcesual`, `parti[].nume`, `parti[].calitateParte`, `sedinte[].solutie`, `sedinte[].solutieSumar`, `sedinte[].complet`, `sedinte[].documentSedinta`.
- Campuri cu format strict (`numar`, `data`, `ora`, `numarDocument`, `dataPronuntare`) raman ne-decodate — nu contin entitati prin natura datelor.
- **Teste noi** ([backend/src/soap.test.ts](backend/src/soap.test.ts)): 4 unit tests pentru `decodeXmlEntities` (named / numeric / invariant „`&amp;` nu dublu-decodeaza" / passthrough pe text fara entitati) + 1 integration test pe `parseDosar` cu payload mixt (entitati in nume, obiect si solutie). Total: **24 → 29 teste verde**.

### HARDENING — Faza 7: consolidare CodeRabbit findings 19.04.2026

Auditul CodeRabbit a scos 4 Critical + 7 Important. Fiecare verificat manual vs codul sursa (fisier:linie concrete), apoi sintetizat in [HARDENING.md](HARDENING.md) Faza 7 ca punch-list actionabil. Fisierul intermediar `CODERABBIT-FINDINGS-2026-04-19.md` a fost eliminat — context-ul necesar e self-contained in fiecare bullet din Faza 7.

**Blockers pentru web deploy** (~3h total, fix inainte de orice `LEGAL_DASHBOARD_ALLOW_REMOTE=1` sau Docker push):

- **C1** — `GET /api/dosare` + `/api/termene` ruleaza `Promise.all` peste `institutii[]` fara cap `MAX_SOAP_FANOUT`. Doar `MAX_INSTITUTII=50` e aplicat; guard-ul exista deja in SSE `/load-more`, trebuie oglindit pe GET. Amplificator SOAP outbound + memory pressure in web mode.
- **C2** — rate limiter foloseste string `"unknown"` ca bucket cand `getConnInfo(c).remote.address` e falsy. In web mode orice client fara IP resolvable consuma quota partajata. Fix: HTTP 503 fail-closed.
- **C3** — Dockerfile ruleaza ca root + `COPY .env* ./` baked in layers (secrete persistente in imagine). Fix: `USER app` non-root + `.dockerignore` cu `.env*` + inject env la runtime.
- **C4** — docker-compose bind-uieste `3001:3001` pe toate interfete-le dar backend-ul forteaza `127.0.0.1` fara `LEGAL_DASHBOARD_ALLOW_REMOTE=1` → port forward se termina in container loopback, service invizibil silent. In plus port-mismatch cu backend default `LEGAL_DASHBOARD_PORT=3002`.
- **I2** — CORS allow-list are `localhost:5173/4173` fara gate pe `NODE_ENV`. In build productie un atacator local pe host-ul deploy poate emite request-uri cross-origin cu credentials.

**Pre-monitorizare Watched Dosare** (~4h, inainte de auto-sync multi-dosar):

- **I4** — splash „Optimizare baza de date..." inainte de VACUUM sincron pe migration path `descriere-dedup` (azi blocheaza Electron UI 30-90s fara feedback la primul boot post-upgrade).
- **I5** — `searchRepository.saveSearch` accepta orice string pentru `searchType`. Validare enum la repository boundary.
- **I6** — `rateLimitMap` cleanup doar la size>1000. Trebuie mutat pe `setInterval(60_000).unref()`.
- **I7** — `let body: any` in ai.ts handlers (singurul `any` ramas in backend) → `unknown` + narrowing via `validateAiBody` tipat.

**Suggestions opportunistic** (~2h): `json: any` in api.ts, README GPU flag, log orphan solve-id captcha, comentariu User-Agent RNPM, pinning test validateParamsDepth, debounce `cleanupOrphanDescrieri`.

**Rejected ca false positive** (verificat vs cod):

- **I1** — CodeRabbit a raportat dublu-apel `validateAiBody` in `/analyze-multi`. Citit direct [backend/src/routes/ai.ts:102-109](backend/src/routes/ai.ts): un singur apel la L106; L102-103 sunt guard-uri existence (`!body || typeof body !== "object"` si `!body.dosar`), nu re-validari. Not actionable.

### De ce aceasta versiune

Doua borne apropiate: **tranzitia web** (cand ridicam `LEGAL_DASHBOARD_ALLOW_REMOTE` sau distribuim Docker image) si **modulul Watched Dosare cu auto-sync** (Pilon B din roadmap). Ambele reuseaza codul atacat de findings — e mai ieftin sa ai punch-list-ul scris inainte de implementare decat sa-l inventezi la momentul critic. I3 s-a facut azi pentru ca e corectitudine vizibila la user (~30 min), restul raman in `[ ]` pentru sprint dedicat.

### Verificare

- `npx tsc --noEmit -p backend/tsconfig.json` — 0 erori.
- `npm test --workspace=backend` — **29/29 verde** (24 existente + 5 noi pentru XML entities).
- Manual pe payload SOAP real cu `&amp;` in denumire parte: render corect in `DosareTable`, modal detalii, export XLSX, prompt AI.

---

## 19 Aprilie 2026 (sesiune 2) — Backend god-file split + audit remediation + RNPM UX + dark bar nativ

Sesiune larga: ultimul god-file (backend/src/index.ts) spart in module dedicate; review tehnic intern cu findings inchise si ramase; UX pe paginarea RNPM; sincronizare tema nativa Windows; export PDF pentru changelog.

### Backend — index.ts 1214 → 133 linii

Audit-ul a identificat [backend/src/index.ts](backend/src/index.ts) ca ultimul fisier monolitic mare din proiect: bootstrap + middleware + rate limiting + SOAP + AI + static serving + lifecycle erau toate inghesuite intr-un singur fisier. Splitat in module cu responsabilitate unica; comportamentul observabil este neschimbat (type-check + smoke tests RNPM).

- [backend/src/routes/dosare.ts](backend/src/routes/dosare.ts) (204 linii) — SOAP PortalJust search endpoints.
- [backend/src/routes/termene.ts](backend/src/routes/termene.ts) (236 linii) — termene by instanta + istoric.
- [backend/src/routes/ai.ts](backend/src/routes/ai.ts) (182 linii) — multi-provider AI proxy (Claude / OpenAI / Gemini).
- [backend/src/services/ai.ts](backend/src/services/ai.ts) (219 linii) — provider clients + cost calculators.
- [backend/src/services/batch-dosare.ts](backend/src/services/batch-dosare.ts) (186 linii) — batch analysis orchestration cu AbortSignal.
- [backend/src/middleware/rate-limit.ts](backend/src/middleware/rate-limit.ts) (40 linii) — real-IP rate limiter.
- [backend/src/middleware/static-frontend.ts](backend/src/middleware/static-frontend.ts) (64 linii) — static serving cu path-traversal guard intact (`path.relative` + `decodeURIComponent` defensiv).
- [backend/src/util/validation.ts](backend/src/util/validation.ts) — validare shared request payloads.
- `index.ts` ramane doar bootstrap: CSP, CORS, mount routers, loopback-guard, prewarm page cache, daily backup, graceful shutdown.

### Audit remediation (legal-dashboard-review-report.md)

Review tehnic complet orientat spre code quality + security posture + component architecture. Inchise in aceasta iteratie sau confirmate ca deja rezolvate:

- **[INCHIS]** Static path traversal — middleware dedicat cu `path.relative` + `decodeURIComponent` defensiv.
- **[INCHIS]** Logging RNPM sensibil — [rnpmSearchService.ts:90-101](backend/src/services/rnpmSearchService.ts#L90-L101) logheaza doar type/page/field-names, nu valori PII.
- **[INCHIS]** TermeneTable selection drift — chei stabile + dedup in `loadMore` cu aceeasi semantica.
- **[INCHIS]** God-files `DosareTable` + `RnpmSearchForm` + `backend/src/index.ts` — toate splitate (frontend in v2.0.4, backend in v2.0.5).

Ramase active pentru faze ulterioare (documentate in `legal-dashboard-review-report.md`):

- **[P1]** `useApiKey` fallback `localStorage` pentru web mode — de eliminat inainte de tranzitia la web; AI doar cu chei server-side.
- **[P1]** Dependente vulnerabile — `dompurify` / `jspdf` / `jspdf-autotable` / `xlsx` (faza de dependency hardening separata).
- **[P2]** Modal standardization — `useDialog` nu e folosit uniform; plan: `DialogShell` comun + `role="dialog"` + `aria-modal`.
- **[P3]** Hono stack — `hono` + `@hono/node-server` raman in urma fata de advisories curente.

### Electron — title bar + menu bar nativ urmeaza tema app-ului

In dark mode, bara nativa Windows (title bar + meniul Fisier/Editare/Vizualizare/Fereastra/Ajutor) ramanea light chiar si cand app-ul era dark. Fix prin sync explicit catre `nativeTheme` pe fiecare toggle.

- [electron/main.js](electron/main.js) — import `nativeTheme` + `ipcMain.handle("window:setTheme")` care seteaza `nativeTheme.themeSource` in `"dark" | "light" | "system"`.
- [electron/preload.js](electron/preload.js) — expune `window.desktopApi.setWindowTheme(theme)` via contextBridge; suprafata IPC ramane minima + tipata in [desktop-api.d.ts](frontend/src/types/desktop-api.d.ts).
- [useTheme hook](frontend/src/hooks/useTheme.ts) — apeleaza `setWindowTheme` in `useEffect`-ul existent, fire-and-forget; pe web (fara `desktopApi`) ramane no-op via `?.`.
- Windows 11 aplica tema dark pe title bar + meniul nativ dupa prima IPC din renderer (flicker minim la boot).

### Changelog — export PDF

Buton nou „Export PDF" in pagina Changelog genereaza un document portrait A4 cu tot istoricul (versiune + data + subtitlu + sectiuni + bulleturi) pentru lectura in afara aplicatiei.

- [frontend/src/lib/changelog-pdf.ts](frontend/src/lib/changelog-pdf.ts) — jsPDF dynamic import, auto page-break, page numbering, strip diacritics pentru compatibilitate Helvetica.
- Fisier salvat ca `legal-dashboard-changelog-v<VERSION>.pdf` — `VERSION` din `__APP_VERSION__` (root package.json, single source of truth).

### RNPM — auto-loop „Incarca tot" (pe modelul cautarii de dosare)

Butonul `Incarca mai multe` obliga click per batch pe cautari cu sute/mii de rezultate. Flow inlocuit cu **auto-loop**:

- [RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx): state nou `autoLoading: boolean` + `useEffect` care re-declanseaza `loadNextBatch()` dupa fiecare batch completat, pana cand `result.nextRnpmPage === null` sau user apasa stop.
- Buton single cu contor in text: `Incarca tot (X din TOTAL)` → `Opreste incarcarea (X din TOTAL)` (variant `destructive` in timpul auto-load-ului).
- **Bara de progres albastra** (h-1.5 w-32) langa buton — `style.width = Math.round((documents.length / total) * 100)%`; animata cu `transition-all duration-300`.
- **Stop duplicat suprimat** in timpul auto-load-ului — prop nou `suppressStop?: boolean` pe `RnpmSearchForm`, setat de parent la `result != null && result.nextRnpmPage != null`. Stop-ul formularului ramane activ doar in prima faza (inainte ca primele rezultate sa apara).
- Datele deja aduse raman accesibile in tabel in timpul auto-load-ului (scroll, filtru, click detaliu functioneaza neintrerupt). Abort middle-batch pastreaza documentele deja incarcate.

### RNPM Detalii — tab Bunuri: lag eliminat pentru avize cu 1000+ items

Pe avize mari (test real: 1730 bunuri pe un singur aviz), primul click pe tabul Bunuri bloca rendererul ~800ms. Fix cu 3 linii CSS, fara `@tanstack/react-virtual` sau alta dependenta.

- [RnpmDetailModal.tsx](frontend/src/components/rnpm/RnpmDetailModal.tsx) — pe fiecare card bun: `style={{ contentVisibility: "auto", containIntrinsicSize: "auto 150px" }}`.
- Chromium decide singur ce iese din viewport si **skip-uieste rendering-ul**; click-to-render din ~800ms → imperceptibil. Singurul cost: un pop-in scurt la flick-scroll foarte rapid prin mii de iteme — nu e flow real.
- Memoria proiectului actualizata (`project_legal_dashboard_large_list_render.md`) sa indice **content-visibility** ca default pentru liste mari viitoare in renderer.

### Sterge baza — acum elibereaza efectiv spatiul pe disc

**Simptom:** dupa `Sterge baza` contoarele aratau 0 avize, dar fisierul `.db` ramanea la ~112 MB.

**Cauza:** SQLite `DELETE` marcheaza doar pagini libere intern — nu returneaza spatiul pe disc fara `VACUUM`. `PRAGMA wal_checkpoint(TRUNCATE)` e necesar pentru a trunchia si fisierul `-wal`.

**Fix** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)):

```ts
rnpmRouter.delete("/saved/all", (c) => {
  const count = deleteAllAvize();
  try { compactDb(); } catch (e) { console.warn("[rnpm] compact after delete-all failed:", e); }
  return c.json({ deleted: count });
});
```

- `compactDb()` e implementat in repositories ca `db.exec("VACUUM"); db.pragma("wal_checkpoint(TRUNCATE)")`.
- Best-effort: esecul `VACUUM` logheaza warning (ex. daca rulează alta tranzactie), dar stergerea randurilor nu e blocata.
- Panoul `Info baza locala` reflecta corect eliberarea imediat dupa stergere.

### Observabilitate — HTTP 499 pentru user-abort pe RNPM search

Anterior, abortul clientului (buton Stop / Opreste incarcarea) rezulta in log 500 pe backend — indistinct de erorile reale (captcha fail, upstream down, parse fail). Schimbat la **499 Client Closed Request** (convenția nginx, non-standard).

**Fix** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)):

```ts
} catch (e) {
  if (e instanceof DOMException && e.name === "AbortError") {
    console.log("[rnpm/search] aborted by client");
    // 499 = Client Closed Request. Hono's ContentfulStatusCode exclude 499,
    // deci emit direct prin Response pentru a pastra status-ul.
    return new Response(JSON.stringify({ error: "Cautare oprita" }), {
      status: 499,
      headers: { "Content-Type": "application/json" },
    });
  }
  ...
}
```

- `console.log` ramane pentru observabilitate backend.
- UI-ul nu vede `499`: fetch-ul client se arunca deja cu `AbortError` inainte de primirea raspunsului, iar `isAbort(e) || ctl.signal.aborted` suprima orice UI de eroare.
- Metricile 500 devin curate — reflecta doar esec real.

### Verificare

- `npx tsc --noEmit` — clean pe ambele workspace-uri.
- Manual in Electron: cautari 200+ rezultate cu auto-load, Stop la mijloc + reluare, `Sterge baza` cu observare dimensiune fisier `.db` inainte/dupa, abort middle-batch (backend scrie 499 in logs, UI ramane curat).

---

## 19 Aprilie 2026 — Refactor structural major + polish formular RNPM

Sesiune dedicata reducerii complexitatii componentelor mari (pre-conditie pentru web transition + testabilitate) si rafinarii formularului de cautare RNPM.

### Splituri de componente

Componentele care crescusera peste 500-800 linii prin acumulare au fost sparte in parti dedicate cu responsabilitate unica:

- **DosareTable** (1063 → ~450 linii): extrase `dosare-ai-config.ts` (AI_MODELS, JUDGE_MODELS_LIST, PROVIDER_LABELS, model cost), `dosare-table-highlight.tsx` (highlight helpers pentru AI output), `dosare-table-helpers.ts` (utilitare generice), `dosare-ai-analysis-panel.tsx` (panoul single + multi-agent cu sanitizare DOMPurify). Paginarea reutilizeaza `table-pagination.tsx`.
- **RnpmSearchForm** (863 → ~590 linii): extrase `rnpm-form-constants.ts` (CATEGORIES, TIP_AVIZ_BY_CATEGORY, DESTINATIE_IPOTECI/INSCRIERII, BUN_ALT_TIP_CATEGORII), `rnpm-form-hooks.ts` (useText, useSiSauField, usePJField, usePFField), `rnpm-form-fields.tsx` (SiSauToggle, PJPFToggle, PJBlock, PFBlock, PartyFieldset, VehiculFieldset, DestinatieSelect, CollapsibleFieldset).
- **Sidebar**: extrase `sidebar-footer.tsx` si `sidebar-history-entry.tsx`.
- **MetricsPanel**: extrase `metrics-panel-parts.tsx` cu sub-componentele de rendering.
- **Dashboard**: extrase `dashboard-modals.tsx` si `dashboard-summary-cards.tsx`.
- **Manual**: continutul (mii de linii de text) extras in `manual-content.tsx`.
- **Changelog**: datele (toate version entries) extrase in `data/changelog-entries.tsx`; pagina `Changelog.tsx` pastreaza doar render layer.
- **TermeneTable**: row-ul extins extras in `termene-table-detail-row.tsx`.

**Motivatie:** testabilitate scazuta, review greu, risc mare de regresii pe fisiere peste 1000 linii. Extractia pastreaza acelasi comportament observabil (verificat in browser) si deblocheaza rescrieri incrementale viitoare.

### RNPM — formular search polish

Formularul de cautare RNPM a fost ajustat pentru paritate cu site-ul oficial si pentru a reduce clutter-ul vizual:

- **Creditor PF** primeste camp **Prenume** (exista deja la Debitor PF; paritate completa cu formularul RNPM).
- **PFBlock** rearanjat cu grid `1fr_1fr_auto`: rand 1 = Nume + Prenume + toggle SI/SAU, rand 2 = CNP (full width col 1) + toggle SI/SAU sub primul. Toggle-urile SI/SAU stivuite vertical la dreapta (aestetica + CNP vizibil pe toate 13 cifre).
- **Vehicul (bun garantat)** si **Bun (alt tip) & Tert cedat** devin zone colapsabile (nou `CollapsibleFieldset` cu chevron + `defaultOpen=false`) — reduc inaltimea formularului la scroll initial, fara a pierde campurile.
- **Legend alignment fix**: in fieldset-uri imbricate in `CollapsibleFieldset`, folosim `ml-*` (margin-left) pe `<legend>` in loc de `pl-*` (padding-left) — `pl-*` lasa un stub de border vizibil la stanga (aparent "discontinuu"), `ml-*` muta legend-ul intreg si border-ul ramane continuu pana la text.

### RNPM — bulk stats refresh

`RnpmBulkSearch` primeste prop `onItemSaved?: () => void` (invocat la fiecare item cu `phase === "done" && resultCount > 0`). Parent-ul `RnpmSearch.tsx` incrementeaza `savedRefreshKey` → `RnpmSavedStats` re-fetch-uieste contoarele. Inainte, contoarele nu se actualizau decat dupa delete manual.

### Adaugiri

- `RnpmRestoreModal.tsx` — modal dedicat pentru restore backup DB (listing + confirm destructiv); a absorbit logica care era inlinata in `RnpmSavedStats`.

### Verificare

- `npx tsc --noEmit` — clean pe ambele workspace-uri.
- Verificare manuala in Electron: toate categoriile RNPM (ipoteci/fiducii/specifice/creante/obligatiuni), toggle PJ/PF, toggle SI/SAU, submit + stop + reset, alignment zone colapsabile.

---

## 18 Aprilie 2026 (sesiune 3) — Fix filtre RNPM: `activ` semantic + `tipInscriere` index

Doua bug-uri la cautarile RNPM descoperite azi:

### 1. Checkbox "Numai active" nu facea nimic — toate avizele veneau marcate active

**Simptom:** User a rulat cautare CUI 37700569 cu "Numai active" debifat si a primit 42 rezultate **toate marcate active**, desi pe site-ul RNPM aceeasi cautare intoarce ~180 rezultate (active + inactive).

**Cauza dubla:**
1. **Endpoint-ul `/api/search/ipoteci` trateaza `{"activ": false}` identic cu `{"activ": true}`** — ambele filtreaza la active-only (criteriu echoat contine "este activ" in ambele cazuri). Singurul mod de a primi active + inactive este sa **omiti cheia `activ` complet** din payload.
2. Parser-ul backend la [backend/src/services/rnpmSearchService.ts:153](backend/src/services/rnpmSearchService.ts#L153) avea `doc.activ = detail.part1?.activ !== false` — cand `part1.activ` era `undefined`/absent, comparatia `undefined !== false` = `true`, deci toate avizele ajungeau marcate active indiferent de realitate.

**Fix:**
- Frontend ([RnpmSearchForm.tsx:749-756](frontend/src/components/rnpm/RnpmSearchForm.tsx#L749-L756)): `onChange` era deja corect (`checked ? true : undefined` → cand debifat, `activ` nu e trimis). Comportamentul asteptat confirmat prin Network capture.
- Backend ([rnpmSearchService.ts:153](backend/src/services/rnpmSearchService.ts#L153)): `if (typeof detail.part1?.activ === "boolean") doc.activ = detail.part1.activ;` — preserva `part1.activ` doar cand e boolean explicit.
- Backend ([rnpmSearchService.ts:289](backend/src/services/rnpmSearchService.ts#L289)): la persist, `activ: typeof part1.activ === "boolean" ? part1.activ : (doc.activ ?? true)`.

**Verificat empiric:** CUI 39029401 fara `activ` → 190 rezultate (mix active + inactive); cu `activ: true` → 146 (doar active). Avizul `2020-05051707599224-CAY` aparut in DB cu `activ=0`.

**Semantica RNPM (documentata acum):**
- `activ` = STAREA avizului (in vigoare vs. expirat/stins).
- `nemodificat` = ISTORIA avizului (atins de acte ulterioare sau nu) — dimensiune ortogonala fata de `activ`.
- Combinatii testate pe CUI 39029401: ambele unset → 190; `nemodificat:true` only → 170; `activ:true` only → 166; ambele true → 146.

### 2. Dropdown "Tipul avizului" pe `specifice` (si celelalte non-ipoteci) — 0 rezultate chiar cu criterii identice cu site-ul

**Simptom:** Cautare specifice + tip "stingere" + CUI 39029401 + nemodificat → 0 in app, 73 pe site.

**Cauza:** RNPM asteapta `tipInscriere.value` ca **index 1-based** in lista tipurilor de aviz din categoria curenta, NU ca label. Request-ul site-ului pentru "stingere" pe specifice: `{"tipInscriere":{"type":"1","value":"3"}}` (pozitia 3 in lista `["aviz initial","modificare","stingere",...]`). Aplicatia trimitea `value: "stingere"` → RNPM il ignora si echoia `Tipul inscrierii este ''` → 0 rezultate.

**Fix** ([RnpmSearchForm.tsx handleSubmit](frontend/src/components/rnpm/RnpmSearchForm.tsx)): la submit, `tipInscriere.value` se converteste din label → index 1-based folosind `TIP_AVIZ_BY_CATEGORY[activeType].indexOf(label) + 1`. Uniform pentru toate cele 5 tipuri (convenția site-ului e identica). State-ul dropdown-ului ramane label pentru UX — conversia e punctuala la submit.

**Verificat empiric:** specifice + tip stingere + CUI 39029401 → 73 rezultate (identic cu site-ul).

### Verificare

- Rebuild frontend + recopiere `dist-frontend` + restart Electron efectuate dupa fiecare fix (fara HMR in Electron).
- Testat manual: ipoteci (CUI 39029401, 37700569) + specifice (CUI 39029401). Celelalte tipuri (fiducii/creante/obligatiuni) — fix-ul tipInscriere e uniform, dar fara CUI-uri de test nu am putut confirma direct.
- Diagnostic console.log-uri adaugate temporar au fost eliminate.

---

## 18 Aprilie 2026 (sesiune 2) — Parser avize specifice + UI/export per-tip + cascade delete + backup button disable

Context: aviz `2021-07221630009133-WUW` (specific, initial) aparea cu tab-uri goale — Creditori/Debitori/Bunuri fara date — desi pe site-ul RNPM avea PJ (`IFN IMPRUMUT EXPRES`), PF (`BUDAN NICU ILIE`) si bun descris ca "fideiusiune". Diagnosticul a aratat ca RNPM returneaza pentru tipul `specifice` un shape diferit fata de `ipoteci`:

- `part2.partiF / part2.partiJ` (in loc de `creditoriF/creditoriJ` + `debitoriF/debitoriJ`); partile au `calitate` + `altaCalitate` (ex: "Altele: Fideiusiune").
- `part3.bunuri` (in loc de `part4.vehicule/mobile/alte`); bunurile au doar `no` + `descriere`.
- `part4 = null` pentru specifice.

### 1. Parser backend — branch pe `searchType === "specifice"`

**Types** ([backend/src/services/rnpmClient.ts](backend/src/services/rnpmClient.ts)):
- `RnpmDetailPartyPF/PJ` — adaugat `calitate` + `altaCalitate`.
- `RnpmDetailPart2` — adaugat `partiF?: RnpmDetailPartyPF[]` + `partiJ?: RnpmDetailPartyPJ[]`.
- `RnpmDetailPart3` — adaugat `bunuri?: RnpmDetailBun[]`.

**Persist** ([backend/src/services/rnpmSearchService.ts](backend/src/services/rnpmSearchService.ts)):
- Helper `formatCalitate(calitate, altaCalitate)` — combina `"Altele: Fideiusiune"` cand `altaCalitate` e prezent; altfel returneaza `calitate` brut.
- Pentru `specifice`: `creditori = []`; `debitori` = `partiF + partiJ` cu `calitate` formatata; `bunuri` = `part3.bunuri` cu `tip_bun: "alt"` si doar `descriere` populat (restul campurilor null). Pentru celelalte tipuri, ramane codul vechi (creditori/debitori/bunuri din buckets-urile originale).

### 2. UI tabs — "Parti" in loc de Creditori/Debitori pentru specifice

**Frontend** ([frontend/src/components/rnpm/RnpmDetailModal.tsx](frontend/src/components/rnpm/RnpmDetailModal.tsx)):
- `isSpecifice = data?.aviz.search_type === "specifice"`.
- Pentru specifice: 4 tab-uri (`General`, `Parti`, `Bunuri`, `Istoric`) — se dropeaza tab-ul "Creditori". Tab-ul "Parti" foloseste bucket-ul `debitori` (unde parser-ul pune partile) cu label schimbat.
- `emptyMsg={isSpecifice ? "Fara parti" : "Fara debitori"}`.

### 3. Export Excel + PDF — etichete per-tip + filename identificator

**Frontend** ([frontend/src/lib/rnpmExport.ts](frontend/src/lib/rnpmExport.ts)):
- `isSpecifice` + `partyLabel2 = isSpecifice ? "Parti" : "Debitori"` calculate o data la export.
- Sheet "Avize" (overview) dropeaza coloana "Creditori" pentru specifice; numerotarea coloanelor pentru link-urile interne (Creditori/Debitori/Bunuri/Istoric) ajustata corespunzator.
- Linia de stats afiseaza `"{N} parti"` in loc de `"{N} creditori + {N} debitori"` pentru specifice.
- Sheet "Creditori" **nu** se mai creeaza pentru specifice (`wsCred = null`); sheet "Debitori" se redenumeste "Parti" via `book_append_sheet(wb, wsDeb, partyLabel2)`.
- PDF: sectiunea "Creditori" se omite pentru specifice; sectiunea "Debitori" apare sub titlul "Parti".
- **Filename identificator:** cand exportul e pentru un singur aviz (`docs.length === 1`), filename-ul devine `<identificator>.xlsx/.pdf` (sanitizat cu `[^A-Za-z0-9._-]+ → _`) in loc de `rnpm_<tip>_<timestamp>`. Valabil pentru toate cele 5 tipuri RNPM, nu doar specifice.

### 4. "Sterge back-up" — disable cand nu exista backup-uri

**Frontend** ([frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx)):
- State nou `backupCount: number | null` (null = neincarcat / eroare la listare → buton activ ca retry affordance).
- `loadBackups()` — apeleaza `rnpmListBackups()` la mount + dupa orice delete; seteaza `backupCount = list.length`.
- Butonul "Sterge back-up" are `disabled={backupCount === 0}` + `title` explicativ + `disabled:opacity-50`. Clasa `ml-auto` pastrata pentru spacing.

### 5. "Sterge baza" cascadeaza la rezultatele din tab "Cautare"

Inainte: `onAfterDeleteAll` bumpa doar `savedRefreshKey` (re-fetch baza locala). Tab-ul "Cautare" pastra in-memory rezultatele vechi care pointau la ID-uri sterse → click pe aviz = 404 pe `rnpmGetAvizDetail`.

**Frontend** ([frontend/src/pages/RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx)):
- Callback-ul pasat la `<RnpmSavedStats onAfterDeleteAll={...}>` reseteaza acum `result`, `error`, `elapsedMs` in plus de refreshKey. Actiunea "Sterge back-up" ramane separata — nu curata rezultatele (backup-urile nu invalideaza DB-ul curent).

### Pending / de continuat

- **fiducii / creante / obligatiuni ipotecare** — parser-ul folosit azi acopera doar ipoteci (default) + specifice. User a ales **Optiunea 1** (astepta sample-uri reale inainte de extindere — fara cod speculativ). La urmatoarea sesiune: rula una-doua cautari reale pentru fiecare tip, captura raspunsul RNPM (parts 1-4 + istoric) si extinde `rnpmSearchService.ts` cu ramuri noi unde shape-ul difera.

### Verificare

- `npx tsc --noEmit` frontend + backend — clean.
- `npm run build` frontend (Vite) — OK; `dist-frontend/` copiat peste.
- Rebuild backend (esbuild via `scripts/build.js`) necesar cand se modifica `backend/src/**` pentru ca `electron:dev` incarca bundle-ul `dist-backend/index.cjs`, nu sursa `.ts`.
- Manual in Electron:
  - Re-cautare aviz specific cu CUI-ul reclamat → tab "Parti" populat cu PJ + PF, tab "Bunuri" cu descrierea "fideiusiune".
  - Export individual aviz specific → xlsx/pdf denumit `<identificator>`; sheet Creditori absent, sheet Parti prezent.
  - "Sterge baza" → tab "Cautare" curatat automat, buton "Sterge back-up" ramane activ (exista backup-uri).
  - "Sterge back-up" → butonul se dezactiveaza dupa delete cand count-ul ajunge la 0.

---

## 18 Aprilie 2026 — Mini-lag RNPM rezolvat + backup zilnic + dialog confirmare stilizat + restore flow + dashboard persistent

Sesiune dedicata **fluiditatii UI** (tab-enter + deschidere aviz), **rezilientei datelor** (backup automat) si **coerentei vizuale** (confirmari native Chromium → dialog stilizat in app).

### 1. Performanta — mini-lag la intrarea pe tab si deschiderea avizelor

Diagnostic: nu era viteza query-urilor, ci (a) unmount/remount al componentei la tab switch si (b) round-trip + 5 query-uri pentru fiecare click pe aviz. Aplicate trei interventii complementare:

**A. Keep-mounted pe RnpmSavedData** ([frontend/src/pages/RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx)):
- Inainte: `{tab === "saved" && <RnpmSavedData .../>}` — conditional render = unmount total la fiecare tab-switch, cu re-fetch + re-hidratare state.
- Dupa: `<div className={tab === "saved" ? "" : "hidden"}><RnpmSavedData .../></div>` — componenta ramane montata, state (filtre, pagina, selectie) persistat, re-intrarea pe tab este instant.

**D. Cache in-memory pentru detaliul avizului** ([frontend/src/lib/rnpmApi.ts](frontend/src/lib/rnpmApi.ts)):
- `avizDetailCache: Map<number, { data, expiresAt }>` + `AVIZ_DETAIL_TTL_MS = 60_000`.
- `rnpmGetAvizDetail(id)` verifica cache-ul inainte de fetch; hit-ul evita round-trip-ul + cele 5 query-uri repository-side.
- Invalidare explicita in `rnpmDeleteAviz`, `rnpmDeleteAllSaved`, `rnpmDeleteAvizeBatch` — coherenta garantata cu stergeri.

**E. Prewarm SQLite page cache la bootstrap** ([backend/src/index.ts](backend/src/index.ts)):
- Dupa `serve(...)`: `getAvize({ limit: 1 })` + `getAvizStats()` — fortam o prima atingere a paginilor SQLite care altfel s-ar citi de pe disc la primul request al userului.
- Cold-start dispare din prima interactiune — cache-ul paginilor e deja cald cand userul apasa pe tab.

### 2. Backup zilnic automat al bazei locale

Motivatie: cu mii de avize salvate, pierderea `.db`-ului ar fi costisitoare. Solutie — backup automat la fiecare pornire, cu rotatie.

**Backend** ([backend/src/db/backup.ts](backend/src/db/backup.ts)):
- `runDailyBackup()` — foloseste `better-sqlite3` online backup API (`db.backup(dest)`), sigur cu WAL fara checkpoint sau exclusive lock.
- Nume: `legal-dashboard.YYYY-MM-DD.db` in `<userData>/backups/`.
- Skip daca ultimul backup `<24h` (check pe `mtimeMs` din `fs.stat`).
- Rotatie: sortare lexicografica (= cronologica gratie formatului ISO in nume), pastreaza ultimele 7, sterge restul.
- Best-effort — orice esec logheaza `[backup] failed: ...` si lasa app-ul sa porneasca normal.
- `runDailyBackup()` apelat in [backend/src/index.ts](backend/src/index.ts) dupa prewarm, cu `.catch(...)` ca nu blocheaza bootstrap-ul.

**Endpoints noi** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)):
- `POST /api/rnpm/open-backups-folder` — `shell.openPath(backupsDir)` + `mkdir -p` defensiv (501 daca nu e Electron).
- `DELETE /api/rnpm/backups` — `deleteAllBackups()` (unlink pe toate fisierele care respecta prefix/sufix), returneaza `{ deleted: n }`.

### 3. Dialog de confirmare stilizat (inlocuieste `window.confirm()` nativ)

Motivatie: user a observat ca pop-up-urile native Chromium arata strain fata de restul UI-ului. Creat un dialog unified stilizat cu app-ul.

**Componenta noua** ([frontend/src/components/ui/confirm-dialog.tsx](frontend/src/components/ui/confirm-dialog.tsx)):
- `ConfirmProvider` + `useConfirm()` hook (Promise-based: `await confirm({ message, confirmLabel, cancelLabel, destructive, title })`).
- Icon `AlertTriangle` pentru variantele destructive; buton confirm rosu cand `destructive: true`.
- Keyboard: `Escape` = cancel, `Enter` = confirm. Click-outside = cancel. Auto-focus pe butonul de confirmare.
- `z-[100]`, backdrop-blur, consistent cu restul modalelor din app.
- Wrapper instalat in [frontend/src/App.tsx](frontend/src/App.tsx) sub `BrowserRouter`.

**Call-site-uri migrate** (4):
- [RnpmSavedData.tsx](frontend/src/components/rnpm/RnpmSavedData.tsx) — sterge aviz individual + batch delete.
- [RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx) — sterge toate avizele din baza locala.
- [RnpmSearchForm.tsx](frontend/src/components/rnpm/RnpmSearchForm.tsx) — warning CUI invalid (non-destructive, confirmLabel="Continua").

### 4. "Info baza locala" — management backups + relabel butoane

[frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx) — reorganizare zona de actiuni:
- `[Folder baza]` `[Backups]` ... `[Sterge back-up]` `[Sterge baza]`
- Butonul `Backups` (icon `Archive`) → deschide `<userData>/backups/` in File Explorer.
- Butonul `Sterge back-up` (rosu, outline) → sterge toate fisierele de backup (confirm destructiv); urmatorul backup se genereaza la urmatoarea pornire a app-ului.
- Butonul `Sterge baza` pastreaza comportamentul anterior (fost "Sterge tot"), cu confirm destructiv; confirmarile folosesc toate noul `useConfirm()`.
- Relabel: "Deschide folder" → "Folder baza".

### 5. Fix UI — DosareTable timeline sedinte

Efect secundar al `dd05b05` (font-scale bump): data "19.01.2026" era taiata, iar cercul-marker nu se alinia vertical cu linia.
**Frontend** ([frontend/src/components/DosareTable.tsx](frontend/src/components/DosareTable.tsx)): coloana data `w-[60px]`→`w-[80px]`, marker-ul `left-[72px]`→`left-[92px]`, spacing `mt-1`→`mt-1.5`.

### 6. Bugfix — paginare goala dupa aplicare filtre

Simptom: la aplicarea unui filtru care reducea numarul de pagini, tabela ramanea goala pentru ca `page` depasea noul `totalPages` si slice-ul `filtered.slice((page-1)*pageSize, page*pageSize)` returna `[]`.

**Frontend** ([frontend/src/components/DosareTable.tsx](frontend/src/components/DosareTable.tsx), [frontend/src/components/TermeneTable.tsx](frontend/src/components/TermeneTable.tsx)): `useEffect` care clampeaza `page` la `Math.max(1, totalPages)` cand filtered data se schimba. Dependency array include lungimea datelor filtrate + pageSize.

### 7. TermeneTable — chei stabile pentru selectie (CP-B P2.3)

Inainte: selection state folosea index-ul rand-ului (`${page}-${idx}`) drept cheie. La sortare/filtrare, Set-ul de selectii "se agata" de indici care indicau alte randuri — selectie care pare sa sara.

**Frontend** ([frontend/src/components/TermeneTable.tsx](frontend/src/components/TermeneTable.tsx)): cheie compusa stabila `${institutie}|${departament}|${numar}|${ora}|${complet}` in locul index-ului; helper `rowKey(t)` aplicat peste tot in checkbox handlers, `selectAllFiltered`, export CSV.

### 8. RnpmDetailModal — identificator aviz in header

User vrea sa vada identificatorul avizului fara sa scrolleze pana la randul de detalii.

**Frontend** ([frontend/src/components/rnpm/RnpmDetailModal.tsx](frontend/src/components/rnpm/RnpmDetailModal.tsx)): `<h3>` cu `flex items-baseline gap-2`, "Detalii Aviz" `text-sm font-semibold` + identificator `text-xs font-semibold text-foreground` (fara font-mono — metricile diferite intre sans/mono cauzeaza offset vizual la `items-center`; baseline + acelasi font family rezolva alinierea).

### 9. Dashboard — persistenta "Ultima Cautare" pentru dosare (Optiunea 1)

Inainte: dupa restart, cardul "Dosare" disparea din dashboard chiar daca userul facuse zeci de cautari. RNPM avea deja persistenta; dosare nu.

Decisie: **nu** persistam intregul dataset (prea mare, deja avem istoric local), ci doar meta-count-urile + params-ul ultimei cautari. Click pe card → navigare la pagina dosare + re-trigger search cu params stored (prin pending-search pattern existent).

- **Types** ([frontend/src/types/index.ts](frontend/src/types/index.ts)): `SearchHistoryEntry.meta?: { categoriesCount; institutiiCount }`.
- **Hook** ([frontend/src/hooks/useSearchHistory.ts](frontend/src/hooks/useSearchHistory.ts)): `addEntry(type, params, resultCount, meta?)`.
- **Dosare** ([frontend/src/pages/Dosare.tsx](frontend/src/pages/Dosare.tsx)): `handleSearch` construieste Set-urile pentru categorie + institutie, pasa meta prin `onSearchComplete`.
- **Dashboard** ([frontend/src/pages/Dashboard.tsx](frontend/src/pages/Dashboard.tsx)): daca nu sunt date live, fallback pe `history.find(e => e.type === "dosare")`. Click pe card → `navigate("/dosare")` + (daca e fallback) `onHistoryClick("dosare", params)` pentru refresh.
- **App** ([frontend/src/App.tsx](frontend/src/App.tsx)): passing `history` + `onHistoryClick` la Dashboard.

### 10. Restore baza locala din backup

User: "Cum putem face restore la un backup daca stergem baza principala?". Motivatie — azi un backup corupt sau o stergere accidentala ar fi fatala fara o cale de recuperare in-app.

**Backend** ([backend/src/db/backup.ts](backend/src/db/backup.ts)):
- `listBackupsWithMeta()` — enumera fisierele care respecta prefix/sufix, returneaza `{ name, sizeBytes, mtime }[]`, sortat desc pe mtime.
- `restoreFromBackup(name)` — validare stricta: regex `/^legal-dashboard\.[A-Za-z0-9._-]+\.db$/` + check `/` si `\` (block path traversal).
  - `closeDb()` — necesar pe Windows unde fisierul deschis e blocat.
  - Snapshot preventiv al DB-ului curent in `legal-dashboard.pre-restore-<ISO>.db` (user poate rolla back manual).
  - `copyFile(src, dbPath)`.
  - Unlink `-wal` + `-shm` (sidecar-urile apartin vechii DB; ar corupe deschiderea noii DB).
  - Returneaza `preRestoreName` catre UI.

**API** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)): `GET /api/rnpm/backups` + `POST /api/rnpm/backups/restore` (cu `limitSmall`).

**Frontend** ([frontend/src/lib/rnpmApi.ts](frontend/src/lib/rnpmApi.ts)): `rnpmListBackups()` + `rnpmRestoreBackup(name)`.

**UI** ([frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx)): buton "Restaurare" (icon `History`) intre "Backups" si "Sterge back-up". Deschide `RestoreModal` — lista backups (name + size + data), confirm destructiv cu `useConfirm`, afisare success cu `preRestoreName`, reincarca stats + trigger `onRestored` dupa 2.5s pentru re-hidratare.

### 11. Info baza locala — aliniere "Cale:" + modal largit

User: "alinieaza vizual 'Cale' cu scrisul caii efective" + "poti lungi si fereastra putin".

**Frontend** ([frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx)):
- Modal `max-w-xl` → `max-w-2xl`.
- "Cale:" row — inlinat intr-un singur `<div className="leading-5">` cu `<span>Cale: </span><span className="font-mono ...">{path}</span><button ...><Copy/></button>`. Butonul de copiere `h-4 w-4 translate-y-[2px]` aliniat vizual cu linia de text (font-mono are metrici diferite de sans — baseline pur nu ajunge, translate-y fixeaza restul).

### 12. Dependency hygiene

- Bump `dompurify` — patch minor de securitate (XSS sanitizer).
- Bump `@anthropic-ai/sdk` — pastram in sync cu release-urile upstream.
- `npm audit` — 0 vulnerabilitati la nivel repo.

### Verificare

- `npx tsc --noEmit` (frontend + backend) — clean.
- `node scripts/build.js` — build complet reproducibil, backend bundle `1.7mb`.
- Reproducere manuala in Electron:
  - Tab-switch intre RNPM → Cautare ↔ Baza locala — instant, fara re-fetch vizibil.
  - Click pe aviz recent → modal apare instant (cache hit).
  - Log backend la pornire: `[backup] saved legal-dashboard.2026-04-18.db`.
  - Fisier prezent in `%APPDATA%/legal-dashboard/backups/`.
  - Delete aviz / Delete all / Sterge back-up / CUI warning — toate afiseaza dialog stilizat, nu pop-up nativ.
  - RNPM → Info baza locala → "Restaurare" → selecteaza backup → confirm → app reincarca cu datele din backup; fisier `legal-dashboard.pre-restore-*.db` aparut in `backups/`.
  - Dashboard dupa restart (fara cautare in sesiunea curenta) — cardul "Dosare" afiseaza ultima cautare persistata; click → navigheaza + re-triggereaza search-ul automat.
  - Aplicare filtru pe pagina 5 dintr-o tabela cu 50 rezultate → `page` clampat la ultima pagina valida, tabela afiseaza randuri.

---

## 17 Aprilie 2026 — Butonul Stop RNPM functioneaza cap-coada (abort chain complet)

Bug raportat: la tab-ul **Cautare RNPM → Cautare**, click pe butonul **Stop** nu oprea efectiv cautarea. UI parea "blocat" (Stop + "Interogare RNPM..." persistau), iar dupa cateva incercari aparea un val de ~25 avize persistate in baza locala fara ca userul sa fi cerut. Investigatia a scos la iveala mai multe probleme in lantul de anulare — rezolvate toate in aceasta sesiune.

### 1. Abort propagat din UI prin fetch pana la backend

Inainte: `rnpmSearch()` + `runSearch()` + `loadNextBatch()` nu aveau `AbortController` deloc. Click pe Stop doar ascundea UI-ul dar fetch-ul continua in background si backend-ul rula pana la capat.

**Frontend** ([frontend/src/lib/rnpmApi.ts:39-52](frontend/src/lib/rnpmApi.ts#L39-L52)):
- `rnpmSearch(...)` accepta acum `signal?: AbortSignal` ca ultim parametru si il pasa la `fetch({ signal })`.

**Frontend** ([frontend/src/pages/RnpmSearch.tsx:61-156](frontend/src/pages/RnpmSearch.tsx#L61-L156)):
- `abortRef: useRef<AbortController | null>` — detine controller-ul cautarii in curs (un singur concurrent).
- `stoppedRef: useRef(false)` — flag sincron (nu state batched) pentru a ignora rezultate parvenite dupa Stop.
- `runSearch()` + `loadNextBatch()`: guard `if (abortRef.current) return` impotriva start-urilor concurente; creeaza controller nou, reseteaza `stoppedRef=false`, pasa `ctl.signal` la `rnpmSearch(...)`; in `finally` elibereaza `abortRef` si flip-uieste loading-ul. Verifica `stoppedRef.current || ctl.signal.aborted` inainte de a comita rezultate in state (nu mai populeaza UI cu rezultate din request abortate).
- `handleStop()` — seteaza `stoppedRef=true`, cheama `abortRef.current?.abort()`, flip `loading=false` + `phase=""`.

**Backend** ([backend/src/routes/rnpm.ts:95,111-114](backend/src/routes/rnpm.ts#L95-L114)):
- `rnpmRouter.post("/search")` pasa `c.req.raw.signal` la `executeSearch({ signal })`. In `catch` recunoaste `DOMException("AbortError")` si returneaza 500 cu mesaj "Cautare oprita" + log `[rnpm/search] aborted by client`.

### 2. Abort propagat in toate fetch-urile outbound

Inainte: chiar daca backend-ul primea abort, fetch-urile catre RNPM (search + detail parts 1-4 + istoric) continuau pana la timeout-ul default al Node fetch.

**Backend** ([backend/src/services/rnpmClient.ts:199-256](backend/src/services/rnpmClient.ts#L199-L256)):
- `RnpmClient.search()`, `fetchPart()`, `fetchIstoric()`, `fetchFullDetail()` — toate accepta `signal?: AbortSignal`.
- `fetchFullDetail()` pasa `signal` la toate cele 5 fetch-uri paralele (parts 1-4 + istoric) via `Promise.all`.

**Backend** ([backend/src/services/rnpmSearchService.ts:38-175](backend/src/services/rnpmSearchService.ts#L38-L175)):
- Helper `throwIfAborted(signal)` folosit la ~6 puncte cheie (inainte/dupa captcha, intre pagini, inainte de batch).
- `input.signal` threaded prin tot orchestratorul: catre `solveRnpmCaptcha`, `client.search`, `client.fetchFullDetail`.
- Retry-urile de captcha pe pagina ramasa (gcode expirat) re-check `throwIfAborted` inainte de re-solve.
- `executeBulkSearch` propaga signal catre fiecare `executeSearch` si iese curat la abort (fara "done"/"error" SSE events).

### 3. Abort ajunge la solver-ul de captcha (2Captcha + CapSolver)

Inainte: SDK-ul `@2captcha/captcha-solver` este blocant (pana la 60s) si nu accepta `AbortSignal`. CapSolver polluia la 2s intervale fara a verifica signal. Click pe Stop in timpul captchei astepta pana la 60-120s inainte sa se elibereze.

**Backend** ([backend/src/services/captchaSolver.ts:28-125](backend/src/services/captchaSolver.ts#L28-L125)):
- `solveWith2Captcha` — `Promise.race([solvePromise, abortPromise])` unde `abortPromise` rejecteaza pe `signal.addEventListener("abort", ...)`. Curatenie listener in `finally { signal.removeEventListener(...) }` ca sa nu tinem referinta dupa ce promise-ul se termina. Comentariu inline explica ca token-ul rezolvat ulterior e pierdut (acceptabil — nu blocam UI-ul 60s).
- `solveWithCapSolver` — fiecare iteratie de polling verifica `if (signal?.aborted) throw new DOMException("Aborted", "AbortError")`. `fetch` primeste si el `signal` (abortare chiar a request-ului HTTP, nu doar pauza dintre polls).
- Fallback 2Captcha (daca CapSolver esueaza) — re-propaga `signal`, re-verifica `signal?.aborted` la intrare si dupa `await`.
- `solveRnpmCaptcha` — orchestreaza ambii provideri, re-verifica `signal` la intrare, intre provideri, si la iesire.

### 4. Skip persist daca fetch-ul a scapat de abort inainte de SQLite

Inainte: `processPage` facea `await client.fetchFullDetail(...)` si imediat `persistAvizWithDetail(...)` sincron in SQLite. Un `Promise.all` cu `concurrency=7` insemna ca daca abort-ul venea in mijlocul batch-ului, fetch-urile deja rezolvate continuau sa persiste → avize partiale in baza locala.

**Backend** ([backend/src/services/rnpmSearchService.ts:140-148](backend/src/services/rnpmSearchService.ts#L140-L148)):
- Dupa `await client.fetchFullDetail(doc.identificator.k, signal)` verificare explicita `if (signal?.aborted) throw new DOMException("Aborted", "AbortError")` inainte de a apela `persistAvizWithDetail`. Fetch-urile care se intorc dupa abort sunt ignorate — SQLite ramane neatinsa.

### 5. Bug final: butonul Stop auto-submita form-ul (React 18 DOM node reuse)

Cu toate fix-urile de mai sus aplicate, Stop tot parea sa nu functioneze. Instrumentare temporara cu `console.log` + `console.trace` in `handleSubmit`, `runSearch`, `handleStop`, ruta `/search` + `executeSearch` a relevat secventa reala:

```
[RNPM handleStop] ENTRY
[RNPM handleStop] abort() called, signal.aborted=true
[RNPM handleStop] setLoading(false) called
[RnpmSearchPage render] {loading: false}
[RnpmSearchForm handleSubmit] FIRED {type:'submit', target:'FORM', isTrusted:true}
[RNPM runSearch] entry
```

`isTrusted: true` + stack trace cu doar cod React intern (rt / dk / pk / hk / Ey / Gb — fara frame aplicativ) dovedea ca browser-ul submita form-ul, nu apelam runSearch direct. Network confirma: 3+ request-uri `/api/rnpm/search` la un singur click pe **Cauta**; primele doua abortate rapid (`[rnpm/search] aborted by client` la ~2s), al treilea completat integral si persistenta 25 avize.

**Cauza**: JSX-ul original reutiliza acelasi DOM node:
```tsx
{loading && onStop ? (
  <Button type="button" onClick={onStop}>Stop</Button>
) : (
  <Button type="submit" disabled={loading}>Cauta</Button>
)}
```
React 18 reconciliation: ambele ternare → acelasi slot → acelasi `<button>` DOM. Secventa:
1. Browser fires `click` pe `<button type="button">` (Stop)
2. React ruleaza `onClick` → `handleStop` → `abort()` + `setLoading(false)` (batched)
3. Handler-ul se termina → React commit batched state → `loading=false` → acelasi `<button>` primeste `type="submit"`
4. Browser continua default action → vede `type="submit"` → **submite form-ul automat**
5. `onSubmit={handleSubmit}` → `runSearch(type, params)` → request nou

**Fix** ([frontend/src/components/rnpm/RnpmSearchForm.tsx:767-780](frontend/src/components/rnpm/RnpmSearchForm.tsx#L767-L780)): `key` distincte pe cele doua butoane forteaza React sa faca **unmount + mount** (noduri DOM diferite), nu **reuse** cu morph de prop:
```tsx
{loading && onStop ? (
  <Button key="rnpm-stop-btn" type="button" onClick={onStop}>Stop</Button>
) : (
  <Button key="rnpm-submit-btn" type="submit" disabled={loading}>Cauta</Button>
)}
```
Butonul Stop e distrus complet cand `loading → false`, iar click-ul in curs nu mai are o destinatie `type="submit"` valida → browser-ul nu mai submite form-ul.

### Verificare finala

- Reproducere manuala: click Cauta → click Stop. UI revine imediat la "Cauta", Console fara `[RnpmSearchForm handleSubmit] FIRED`, Network cu un singur request abortat in ~2s, baza locala neatinsa.
- Stop in timpul captchei: provider-ul primeste abort imediat (2Captcha via Promise.race, CapSolver la urmatorul poll < 2s). Token-ul nu mai e folosit.
- `backend && npx vitest run` — **24/24 verde**.
- `npm run build` — OK (warning preexistent `import.meta` neschimbat).

### Curatenie

Toate log-urile de diagnostic adaugate in timpul investigatiei au fost sterse:
- `RnpmSearch.tsx` — `console.log` din `runSearch`, `handleStop`, render top-level, `useEffect(pendingSearch)`.
- `RnpmSearchForm.tsx` — `console.log` + `console.trace` din `handleSubmit`.
- `rnpmSearchService.ts` — log-uri `[rnpm executeSearch] start/captcha solved`, abort listener, `[rnpm] SKIP persist`, `[rnpm] persist`. Pastrat `[rnpm] search type/page/params` si `[rnpm] result total/criteriu` (preexistente, utile in operational).
- `routes/rnpm.ts` — log `[rnpm/search] ENTRY` + abort listener. Pastrat `[rnpm/search] aborted by client` (preexistent).

### Learnings

- **Abort chain in Electron cu Hono in-process**: `c.req.raw.signal` propaga corect din frontend (via `fetch({signal})`) la backend, cu conditia ca toate nivelurile sa accepte si sa pase `signal` mai departe. O singura veriga lipsa (ex: SDK blocant) gate-uieste intreg lantul.
- **Pattern React 18**: cand un ternar schimba un `<Button>` cu acelasi component type dar `type` (sau alt prop sensibil) diferit, React reutilizeaza DOM-ul. Cand purpose-ul semantic al butonului se schimba (ex: Stop → Submit), foloseste `key` distincte pentru a forta mount/unmount.
- **Promise.race cu abortPromise** e pattern-ul standard pentru a wrap-ui librarii blocante care nu stiu de AbortSignal. Atentie la cleanup-ul listener-ului in `finally`.

---

## 17 Aprilie 2026 — Categorie noua, filtru data, rafinari UI (schimbari absente din PLAN.md v1.0.0)

Sectiune separata pentru a documenta explicit ce **depaseste** scopul `PLAN.md` (4 categorii RNPM, fara filtru de data pe baza locala, fara referinte de persoane pe bunuri). Toate modificarile descrise mai jos au fost validate prin `npx tsc --noEmit` + `npx vitest run` (24/24).

### 1. Categoria 5 — **Aviz de ipoteca - obligatiuni ipotecare** (completa cap-coada)

`PLAN.md` v1.0.0 enumera categoria "obligatiuni" la endpoint-uri si schema, dar stub-ul `RnpmSearchParams` (PLAN.md §"Search Parameters", liniile 114-135) **omite** toate cheile specifice obligatiunilor — la fel cum omite `constituitorPJ`/`fiduciar`/`beneficiarPJ` (fiducii), `reprezentantCreditor`/`debitorJ`/`debitorF`/`creante` (creante specific). Cheile au fost descoperite prin captura Network pe `https://mj.rnpm.ro/#informatii/cautare` si adaugate integral.

**Types** ([frontend/src/types/rnpm.ts:1](frontend/src/types/rnpm.ts#L1), [frontend/src/types/rnpm.ts:37-40](frontend/src/types/rnpm.ts#L37-L40)):
- `RnpmSearchType` extins cu `"obligatiuni"`.
- Chei confirmate prin captura Network: `agentPJ` / `agentPF` / `emitent` (toate PJ) / `bunGarantie.descriere`.

**Backend** ([backend/src/services/rnpmClient.ts:3](backend/src/services/rnpmClient.ts#L3), [backend/src/services/rnpmClient.ts:40-43](backend/src/services/rnpmClient.ts#L40-L43)):
- `VALID_TYPES` (in `routes/rnpm.ts`) si `RnpmSearchType` (in `rnpmClient.ts`) accepta `"obligatiuni"`.
- `RnpmSearchParams` suplimentat cu noile chei — trec transparent prin `executeSearch` → `client.search` fara logica speciala (categoria a cincea foloseste aceeasi ruta SOAP ca restul).

**Form** ([frontend/src/components/rnpm/RnpmSearchForm.tsx:73-76](frontend/src/components/rnpm/RnpmSearchForm.tsx#L73-L76), [frontend/src/components/rnpm/RnpmSearchForm.tsx:310-314](frontend/src/components/rnpm/RnpmSearchForm.tsx#L310-L314), [frontend/src/components/rnpm/RnpmSearchForm.tsx:448-482](frontend/src/components/rnpm/RnpmSearchForm.tsx#L448-L482), [frontend/src/components/rnpm/RnpmSearchForm.tsx:696-707](frontend/src/components/rnpm/RnpmSearchForm.tsx#L696-L707)):
- Dropdown **Tipul avizului** (9 valori, identice cu "creante"): aviz initial, modificare, extindere, reducere, stingere, nulitate, prelungire, reactivare, indreptare a erorii materiale.
- UI: `PartyFieldset` **Agent** (PJ/PF toggle) + `PJBlock` **Emitent** (PJ-only) + `Input` descriere **Creante (bun de garantie)**.
- State: `oblAgentTip`, `oblAgentJ` (usePJField), `oblAgentF` (usePFField), `oblEmitent` (usePJField), `oblBunDescr` (useText). Folosesc aceleasi custom hooks introdusi la refactor-ul CP-15 → zero cod nou de boilerplate.
- Submit: construieste `params.agentPJ` / `params.agentPF` / `params.emitent` / `params.bunGarantie` doar daca user-ul a completat cel putin un subcamp.
- `TIP_LABEL_BY_CATEGORY[obligatiuni] = "Tipul avizului"` (identic cu "specifice"; "ipoteci"/"creante" afiseaza "Tipul inregistrarii", "fiducii" afiseaza "Tipul fiduciei") — reproduc exact label-urile site-ului oficial.

**Validare CUI** ([frontend/src/components/rnpm/RnpmSearchForm.tsx:99-111](frontend/src/components/rnpm/RnpmSearchForm.tsx#L99-L111)):
- Walker `findNonNumericCui` ruleaza pe params-ul **deja construit** (post-filtru per categorie activa), deci acopera automat `agentPJ.CUI` + `emitent.CUI` din noua categorie — fara cod nou de validare per camp.

**Bulk** ([frontend/src/components/rnpm/RnpmBulkSearch.tsx:14](frontend/src/components/rnpm/RnpmBulkSearch.tsx#L14)):
- Categoria apare in dropdown-ul **Categorie** al tab-ului Bulk. Rolurile FieldKey suportate (debitor/creditor PJ/PF) raman aplicabile dar nu acopera `agent`/`emitent` — limitarea e acceptata: bulk-ul proceseaza liste de CUI/CNP pe cea mai folosita cautare (debitor/creditor); pentru obligatiuni ipotecare volumul justifica cautari individuale din tab-ul Cautare.

**Saved (baza locala)** ([frontend/src/components/rnpm/RnpmSavedData.tsx:15](frontend/src/components/rnpm/RnpmSavedData.tsx#L15)):
- Filtru pe categorie include `obligatiuni`. Schema `rnpm_avize.search_type` e `TEXT` → accepta orice valoare, nu necesita migrare.

### 2. Baza locala — filtre + integritate (modificari absente din PLAN.md)

`PLAN.md` specifica doar cautare libera + filtru pe `activ`. In aceasta sesiune + sesiunile precedente s-au adaugat:

**Filtru interval data** ([backend/src/db/avizRepository.ts:274-284](backend/src/db/avizRepository.ts#L274-L284), [frontend/src/components/rnpm/RnpmSavedData.tsx:90-113](frontend/src/components/rnpm/RnpmSavedData.tsx#L90-L113)):
- Backend: coloana `data` e stocata ca **"dd.mm.yyyy"** (format RNPM nativ). Filtru converteste in SQL prin `substr()` la ISO (yyyy-mm-dd) ca string-urile sa fie comparabile lexicografic:
  ```sql
  substr(a.data,7,4)||'-'||substr(a.data,4,2)||'-'||substr(a.data,1,2) >= ?
  ```
  Pretul e o scanare in plus (nu exista index pe expresia `substr`) dar volumul bazei locale e `< 50K` avize per user → acceptabil.
- Frontend: doua `<Input type="date">` (`dataStart` / `dataStop`) cu buton **reset** care sterge ambele. `onClick={showPicker?.()}` pentru UX — clic deschide picker-ul nativ. Filtrul ruleaza automat la `useEffect` dependency (`[searchType, activOnly, dataStart, dataStop, refreshKey]`).
- `GetAvizeOptions.dataStart`/`dataStop` sunt string-uri ISO ("yyyy-mm-dd") — contractul vine direct din `<input type="date">`.

**Migrare `referinte_json` pe `rnpm_bunuri`** ([backend/src/db/schema.ts:149-153](backend/src/db/schema.ts#L149-L153), [backend/src/db/avizRepository.ts:199-206](backend/src/db/avizRepository.ts#L199-L206)):
- Coloana `TEXT NOT NULL DEFAULT (json_array())` NU s-a putut folosi (SQLite nu accepta expresii non-constante ca DEFAULT). Pattern idempotent:
  ```ts
  const cols = db.prepare(`PRAGMA table_info(rnpm_bunuri)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "referinte_json")) {
    db.exec(`ALTER TABLE rnpm_bunuri ADD COLUMN referinte_json TEXT`);
  }
  ```
- Citeste `NULL` pentru randuri preexistente (fara referinte); scrie `JSON.stringify(referinte)` doar cand array-ul e ne-gol (economie de spatiu — majoritatea bunurilor n-au referinte).
- Parse defensive in `loadAvizChildren` cu try/catch → `[]` pe JSON invalid (defense-in-depth impotriva corupere WAL).
- Unlock: `RnpmDetailModal > Bunuri > BunRefRow` poate afisa Constituitor (badge sky) vs Tert cedat (badge amber) — feature absent in PLAN.md.

**Scalar SQLite `rnpm_norm` (diacritic-insensitive search)** ([backend/src/db/schema.ts:22-24](backend/src/db/schema.ts#L22-L24)) — deja documentat in sesiunea 3 din 16 Aprilie; mentionat aici ca referinta pentru cititorul viitor care vede schema.

**`deleteAllAvize` tranzactional** ([backend/src/db/avizRepository.ts:316-325](backend/src/db/avizRepository.ts#L316-L325)):
- PLAN.md prevede doar `deleteAviz(id)`. UI "Sterge tot" avea nevoie de:
  - Stergere `rnpm_avize` pe owner scope → CASCADE auto pe `rnpm_creditori` / `rnpm_debitori` / `rnpm_bunuri` / `rnpm_istoric` (toate au `ON DELETE CASCADE`).
  - Stergere **explicita** `rnpm_searches` (metadata istoric cautari) — `rnpm_avize.search_id` are `ON DELETE SET NULL`, deci searches **nu** cad in cascada.
  - Tranzactie pentru atomicitate: daca una esueaza, ambele raman intacte.
- Return `number` (count avize sterse) pentru a putea afisa in UI.

**Bulk fetch `getAvizeByIds`** ([backend/src/db/avizRepository.ts:327-335](backend/src/db/avizRepository.ts#L327-L335)):
- `IN (...)` placeholders dinamici + `loadAvizChildren` per rand → suport pentru **export PDF/Excel** (ruta `/api/rnpm/saved/export` accepta max 500 id-uri per request, aliniat cu `EXPORT_BODY_LIMIT` 64KB de la audit-readiness).

### 3. Frontend — rafinari UX (non-abort)

**`RnpmDetailModal` cu 5 tab-uri navigate**:
- Tab-uri: General / Creditori / Debitori / Bunuri / Istoric. Count badge pe fiecare (ex: "Bunuri (3)") cand exista date.
- `requestAnimationFrame` + `window.scrollBy` pe tab-switch → la overflow, tab-ul selectat ramane vizibil fara salt brut.
- `BunRefRow` (sub-componenta) afiseaza `Constituitor` (sky-600) vs `Tert` (amber-600) cu toate atributele de identificare (CUI/CNP/sediu/localitate/tara) intr-un layout 2-col dens.
- Click pe backdrop inchide modala; click pe continut il blocheaza (`e.stopPropagation`).

**`RnpmSavedData` badge-uri active/inactiv**:
- Coloana "Stare" cu `Badge className="bg-green-500"` (activ) sau `bg-gray-400` (inactiv) — aliniat cu `activ INTEGER DEFAULT 1` din schema.
- Dubla confirmare `confirm()` pentru **Sterge tot** ("Actiunea nu poate fi anulata.") inainte de a apela `deleteAllAvize` — protectie minima impotriva click-urilor accidentale intr-un flux ireversibil.
- Cursor paginat: buton **Incarca mai multe** disparut automat la `nextCursor == null`.

**`RnpmBulkSearch` feedback per-item**:
- Icon per phase: `Loader2` (captcha/search/details) → `CheckCircle2` verde (done) → `XCircle` rosu (error).
- Contor `done + errors / total` + breakdown "X OK / Y erori" in header.
- Estimare **duration** (25s/item × count) + **cost** (~$0.003/item 2Captcha) afisate inainte de start.
- Hard limit `MAX_BATCH=100` — valorile peste sunt taiate si marcate cu warning amber ("primele 100 vor fi procesate").

### 4. Validare completa

- `npx tsc --noEmit` (frontend + backend) — clean.
- `npx vitest run` (backend) — **24/24 verde**, 256ms.
- Reproducere manuala **in Electron**: obligatiuni ipotecare search complet (agent PJ CUI + emitent CUI + bun descriere), rezultate vizibile in tabel, persistenta confirmata in baza locala, filtru data range pe tab "Baza locala" intoarce rezultate corecte, "Sterge tot" + confirmare goleste atat `rnpm_avize` cat si `rnpm_searches`.

### Scope separation vs PLAN.md

PLAN.md v1.0.0 ramane specificatia **initiala** (4 categorii, filtru basic, fara referinte bunuri). Acest CHANGELOG documenteaza **delta-ul** implementat peste — fara a rescrie PLAN.md (istoric inghetat). Urmatoarea revizie a PLAN.md (v1.1.0 sau v2.0.0) ar trebui sa incorporeze:
- Categoria 5 (obligatiuni ipotecare) cu payload-ul ei exact.
- Filtru `dataStart`/`dataStop` pe baza locala.
- Referinte `constituitor`/`tert` pe bunuri (`referinte_json`).
- Diacritic-insensitive search (`rnpm_norm`).

---

## 16 Aprilie 2026 (sesiunea 4) — Audit remediation (Round Next + Round 2 + Round 3)

Toate cele 12 findings din `AUDIT-LEGAL-DASHBOARD.md` aplicate. Build frontend OK, backend `vitest run` 24/24 verde.

### Round Next — fluxuri load-more + boot Electron (P1)
- **F2** — `load-more` suporta multi-institutie. `frontend/src/lib/api.ts::loadMoreSSE` accepta `string[]` si serializeaza prin `URLSearchParams.append`; `backend/src/index.ts` foloseste `c.req.queries("institutie") ?? []`, valideaza `MAX_INSTITUTII=50` + per-institutie. Loop serial pe institutie cu dedup intre institutii pe `existingNumere` Set; `totalUnits = institutionList.length * intervals.length`; prefix `[institutie]` in `currentInterval`.
- **F3** — Buton **Stop** propaga abort la backend. `batchFetchDosare` + `subdivideInterval` accepta `signal?: AbortSignal` si verifica la fiecare iteratie/chunk; ruta wired la `c.req.raw.signal` (pattern `routes/rnpm.ts:141`); single timeout seteaza `timedOut=true` si cheama `abortController.abort()`. Daca `aborted` → nu se emit evenimente "done"/"error" (silent close).
- **F4** — Boot Electron cu deadline + dialog. `electron/main.js`: `STARTUP_TIMEOUT_MS=30000`, `HEALTH_POLL_INTERVAL_MS=200`. `require()` backend in try/catch cu reject explicit; polling cu deadline (nu retry infinit); `backendStarted=true` doar dupa confirmare `/health`; helper `showStartupErrorAndQuit()` foloseste `dialog.showErrorBox` + `app.quit()`.

### Round 2 — state, erori, metrici, versiuni (P2/P3)
- **F5** — Updates `load-more` cu `setState` functional. `Dosare.tsx` + `Termene.tsx`: `onStateChange` tipat `React.Dispatch<React.SetStateAction<...>>`; toate update-urile in callback-uri folosesc `(prev) => ({...prev, ...})` (onBatch, final pass, catch error branch). Stream-ul nu mai poate suprascrie filtre/state aparute intre batch-uri.
- **F7** — Erorile HTTP propagate transparent. `frontend/src/lib/api.ts`: `await res.text()` o singura data, parse JSON in try/catch separat, propagat `serverMessage ?? "Eroare la incarcarea extinsa."` — fara dublu-throw in acelasi try.
- **F11** — Metrici uniformizate. `MetricsPanel.tsx`: `institutiiCounts` separat in `totalInstitutii` (Object.keys.length, afisat ca cifra reala) + `topInstitutii` (slice 0..5). `TermeneMetrics.tsx`: single `useMemo` cu `today.setHours(0,0,0,0)` aliniat la `filterByMetrics()` din `Termene.tsx` (definitie unica `viitor` / `trecut` / `azi`).
- **F12** — Versiunea unificata. `package.json` root → `1.4.4-ai`; `frontend/package.json` name → `legal-dashboard-frontend`; `backend/package.json` name → `legal-dashboard-backend`. `frontend/vite.config.ts` injecteaza `__APP_VERSION__` din `../package.json` (single source of truth); `frontend/src/vite-env.d.ts` declara constanta; `Dashboard.tsx` consuma `__APP_VERSION__`.

### Round 3 — performance, theming, a11y, tests (P2)
- **F8** — Code-splitting. `Dashboard.tsx`: `Changelog` + `Manual` lazy via `React.lazy` cu `<Suspense>`; `exportManualPDF` dynamic-import in handler (jspdf+xlsx out of Dashboard chunk). `Dosare.tsx` + `Termene.tsx`: `MetricsPanel` + `TermeneMetrics` lazy (recharts out of initial). `vite.config.ts`: `manualChunks` named pentru `charts` (recharts), `xlsx`, `pdf` (jspdf+jspdf-autotable). Bundle main: **306 kB** (gzip 83 kB); `charts` 517 kB doar la prima cautare cu rezultate; `xlsx`/`pdf` doar pe export.
- **F10** — Culori grafice centralizate. `frontend/src/lib/chart-colors.ts` (nou) exporta `CATEGORY_COLORS` (Penal/Civil/Contencios/Litigii munca/Faliment/Profesionisti/Altele), `CATEGORY_FALLBACK`, `CHART_FILLS` (primary/accent/termene). `MetricsPanel.tsx` + `TermeneMetrics.tsx` consuma constantele. Recharts cere literale CSS pentru fill — re-themeing chart palette intr-un singur loc.
- **F6** — Accesibilitate dialoguri + form. `frontend/src/hooks/useDialog.ts` (nou) — Escape close, body scroll lock, focus capture pe mount, restore focus pe unmount. Wired in: Dashboard `Changelog`/`Manual` modals, `App.tsx` API key dialog, `InstitutieSelect` overlay. Toate cu `role="dialog"` + `aria-modal="true"` + `aria-labelledby` + `tabIndex={-1}` + butonul X cu `aria-label`. `SearchForm.tsx` foloseste `useId()` pentru pairing `htmlFor`/`id` pe `numarDosar`/`numeParte`/`obiectDosar`/`dataStart`/`dataStop`. WCAG 1.3.1, 2.1.1, 2.4.3, 4.1.2 acoperite.
- **F9** — Test coverage minimum. Vitest instalat in backend (`devDependencies`, script `npm test`). `intervals.test.ts` (12 cases): generateMonthlyIntervals (range valid/invalid/leap/cross-year/clamp), splitInterval (no overlap/no gap, edge case 2-day), defaultDateRange (7y window). `soap.test.ts` (12 cases): `toLegacyDiacritics`, `extractFirst`/`extractAll` (namespaced tags, self-closing ignore, prefix collision `data` vs `dataStop`), `parseDosar` (top-level fields, parti, sedinte isolation, fallback `categorieCaz`/`categorieCazNume`, missing sections). Helpers `extractFirst`/`extractAll`/`parseDosar`/`toLegacyDiacritics` exportate explicit pentru testabilitate. Total: **24/24 verde**.

### Verificare finala
- `frontend && npx tsc --noEmit` — clean.
- `frontend && npm run build` — OK; warning preexistent `import.meta` neschimbat.
- `backend && npm test` — 24/24 verde, 256ms.

---

## 16 Aprilie 2026 (sesiunea 3) — Normalizare text RNPM (scope: RNPM only)

Trei imbunatatiri din spec-ul RNPM "Mentiuni esentiale", cu scope explicit pe fluxurile RNPM. Cautarea Dosare si Termene (PortalJust, SOAP) ramane neatinsa.

### Backend
- `backend/src/util/textNormalize.ts` (nou) — `stripDiacritics(s)` + `stripDiacriticsDeep<T>(value)`. Pattern NFD + drop U+0300..036F.
- `services/rnpmSearchService.ts::executeSearch`: `stripDiacriticsDeep` aplicat pe `restParams` **doar** pentru payload-ul trimis la `client.search(...)`. `input.params` ramane neatins, deci `rnpm_searches.params_json` pastreaza textul original cu diacritice (istoricul cautarilor afiseaza exact ce a tastat userul). `/search` si `/bulk` trec prin acelasi drum, deci comportamentul e simetric. `captchaKey` / `type` / `gcode` nu sunt atinse.
- `db/schema.ts`: inregistrat scalar SQLite `rnpm_norm(x) = lower(stripDiacritics(x))` via `db.function(...)`, `deterministic: true`, per-connection.
- `db/avizRepository.ts::getAvize()`: filtrul `searchText` foloseste `rnpm_norm(col) LIKE ? ESCAPE '\'` pe 9 coloane (`identificator`, `tip`, `utilizator_autorizat`, creditor `denumire`/`cod`/`cnp`, debitor `denumire`/`cod`/`cnp`). Parametrul e normalizat o singura data in JS (`stripDiacritics(q).toLowerCase()`) si meta-caracterele LIKE (`%`, `_`, `\`) sunt escape-uite pentru a fi tratate literal — user tasteaza "a%b" si gaseste literal "a%b", nu orice contine "a". User tasteaza "stefan" → gaseste "Ștefan" / "STEFAN" in baza locala.

### Frontend
- `RnpmSearchForm.tsx`: helper `findNonNumericCui(obj)` walk pe params-ul construit dupa filtrul per-activeType. Daca `CUI.value` contine non-digit → `window.confirm("Atentie: CUI ... contine caractere non-numerice. Continui cautarea?")` non-blocking. Astfel nu valideaza CUI-uri stocate in state dar apartinand unui tab inactiv.

### Scope isolation
- `getDb()` e folosit EXCLUSIV de `avizRepository.ts` + `searchRepository.ts` (ambele RNPM).
- `stripDiacriticsDeep` importat EXCLUSIV in `routes/rnpm.ts`.
- PortalJust Dosare + Termene nu trec prin SQLite locala si nu trec prin `/api/rnpm/*`.

---

## 16 Aprilie 2026 (sesiunea 2) — Hardening post-audit

Remediere findings audit-readiness + CLAUDE.md conventions. Fara schimbari de comportament user-facing; toate defense-in-depth.

### Backend
- `hono/body-limit` pe POST `/api/rnpm/*`: `/search` 64KB, `/bulk` 512KB, `/saved/export` 64KB, `/captcha/balance` 4KB → 413 la depasire (F-1).
- `/bulk` SSE timeout 10 min via `setTimeout` pe `AbortController` (F-2) — stream-ul nu mai poate ramane blocat indefinit.
- `validateParamsDepth` — walk recursiv care respinge params cu adancime > 4 sau string-uri > 500 chars (W-1).
- `defaultRnpmClient` — singleton exportat din `rnpmClient.ts`; `executeSearch` / `executeBulkSearch` / ruta `/bulk` folosesc instanta partajata in loc de `new RnpmClient()` per call (CP-B5).

### Frontend
- `RnpmBulkSearch`: `useEffect` cleanup care face `abortCtl.abort()` la unmount — previne waste 2Captcha daca userul paraseste tab-ul in timpul unui bulk (CP-E1).
- `lib/rnpmApi.ts`: SSE reader wrap in try/finally cu `reader.cancel()` pentru eliberare pe abort/error abrupt (CQ-6).

### Electron
- `ALLOWED_EXTERNAL_DOMAINS` extins cu `mj.rnpm.ro`, `www.rnpm.ro` (W-2).

### Onboarding
- `backend/.env.example` — lista completa variabile + nota 2Captcha (se configureaza in UI) (CQ-8).

### Refactor (CP-15)
- `RnpmSearchForm.tsx` restructurat pe hooks + sub-componente: introduse `useText` / `useSiSauField` / `usePJField` / `usePFField` pentru a grupa starea per-entitate; introduse `PJBlock` / `PFBlock` / `PartyFieldset` / `VehiculFieldset` / `DestinatieSelect` pentru a elimina duplicarea JSX. `useState` direct in component: 40+ → 11. Logica de submit pastrata exact (toate particularitatile per-categorie comentate inline).

---

## 16 Aprilie 2026 — RNPM form parity cu site-ul oficial

Aliniere completa a formularului `RnpmSearchForm` la specificatia oficiala RNPM (`https://mj.rnpm.ro/#informatii/cautare`) si la payload-urile reale capturate din Network tab.

### Formular cautare
- Categoriile au denumirile exacte din spec (Aviz de ipoteca mobiliara / Fiducie / Aviz specific / Aviz de ipoteca - creante securitizate / Aviz de ipoteca - obligatiuni ipotecare).
- **Tipul avizului** — dropdown per categorie (18 valori ipoteci, 7 specifice, 7 fiducii).
- **Destinatia inscrierii** — dropdown la specifice (14 valori) si la ipoteca (10 valori).
- **SI/SAU** pe operatorul fiecarui camp `SiSau` (CUI, CNP, RegCom, Prenume, Serie sasiu/motor, Nr inmatriculare, tip aviz, destinatie).
- **Default checkboxes**: `Numai active` + `Nemodificate de alte inscrieri` bifate implicit, conform spec.
- **Toggle PJ/PF unic per parte** ("Persoana Juridica" / "Persoana Fizica") cu campuri condiționate (CUI vs CNP).
- Structura noua per categorie:
  - **Fiducie**: Constituitor (PJ/PF) / Fiduciar (PJ) / Beneficiar (PJ/PF) / Vehicul.
  - **Aviz specific**: Destinatie + Parte (PJ/PF) + Bun (descriere).
  - **Creante securitizate**: Reprezentant Creditor (PJ) + Debitor (PJ/PF) + Bun (descriere).

### Backend
- `RnpmSearchParams` extins cu: `constituitorPJ/PF`, `fiduciar`, `beneficiarPJ/PF`, `parteJ/parteF`, `bunA.descriere`, `reprezentantCreditor`, `debitorJ`, `debitorF`, `creante.descriere`.
- `RnpmDetailBun` extins cu `constituitoriF/J` (referinte numerice catre debitori) si `tertiF/J` (entitati complete).
- `executeSearch` arunca eroare clara cand `total > 1500` (limita RNPM): _"RNPM a returnat N rezultate (limita 1500). Restrange criteriile de cautare."_
- Re-solve captcha automat pe `410/401/403` (gcode expirat) pentru paginile ulterioare ale aceleiasi cautari.

### Persistenta detalii
- `rnpm_bunuri.referinte_json` — coloana noua (migratie idempotenta) cu referintele tert/constituitor per bun.
- Modalul de detaliu afiseaza referintele ca badge-uri colorate (amber = tert, sky = constituitor).

### Erori UI
- Mesaj backend (status text) propagat la frontend in loc de "Eroare server (500)" generic.
- Auto-scroll la panoul de detaliu cand se selecteaza un aviz (centru viewport).

### Documentatie
- `STATUS.md` extins cu sectiune "Update 2026-04-16" + sectiune "Ramas de facut" (Obligatiuni, Tert cedat la ipoteca, Bun mobil atasat imobilului, Bun "Alt tip"/imobil la fiducie, validari input).

---

## v2.0.0 — 15 Aprilie 2026 (Legal Dashboard Launch — rebranding din PortalJust App)

Aplicatia a fost rebrand-uita din **PortalJust App v1.4.4-ai** in **Legal Dashboard v2.0.0**. Versiunea bumped la 2.0.0 pentru continuitate cu istoricul PortalJust (entry-urile v1.4.4-ai si mai vechi raman vizibile mai jos sub vechea denumire). PortalJust ramane aplicatie separata, neatinsa. Legal Dashboard = tot ce avea PortalJust + tab nou **Cautare RNPM** (Registrul National de Publicitate Mobiliara).

### Rebranding
- Nume aplicatie: "Legal Dashboard" (titlu fereastra, installer, shortcut, PDF exports, manual)
- AppId: `ro.legaldashboard.app`
- DB path: `userData/legal-dashboard.db` (env `LEGAL_DASHBOARD_DB_PATH`)
- Istoric RNPM separat de istoricul PortalJust (localStorage `legal-dashboard-rnpm-history`)
- Referintele la `portal.just.ro` pastrate ca "PortalJust" (sursa externa de date)

### RNPM — Backend
- SQLite: 6 tabele noi (`rnpm_searches`, `rnpm_avize`, `rnpm_creditori`, `rnpm_debitori`, `rnpm_bunuri`, `rnpm_istoric`) cu `owner_id` si index-uri adecvate
- Repositories: `searchRepository`, `avizRepository` (upsert idempotent pe UNIQUE(owner_id, identificator), cursor pagination)
- `captchaSolver` peste `@2captcha/captcha-solver` (SDK oficial 2Captcha) — sitekey RNPM hardcodat, erori RO
- `rnpmClient` — search + 4 parti detaliu + istoric; batch de 5 requests concurent
- `rnpmSearchService` — orchestreaza captcha -> search -> fetch eager detalii -> persist (tranzactie)
- Endpoint-uri Hono la `/api/rnpm`: `POST /search`, `POST /bulk` (SSE), `GET/DELETE /saved`, `GET /saved/:id`, `POST /saved/export`, `GET/DELETE /searches`, `POST /captcha/balance`

### RNPM — Frontend
- Tab nou **Cautare RNPM** in sidebar cu 3 sub-tab-uri: Cautare / Bulk / Baza locala
- Formular cautare cu 5 categorii (ipoteci, fiducii, specifice, creante, obligatiuni) + filtre debitor/creditor PJ+PF + vehicule
- Tabel rezultate cu paginare + selectie multipla
- Modal detaliu cu 5 tab-uri (General, Creditori, Debitori, Bunuri, Istoric)
- Bulk search cu SSE live progress, estimare timp/cost, Abort
- Browse baza locala cu filtrare full-text + cursor "Incarca mai multe"
- `useRnpmHistory` — istoric separat (max 15 intrari)
- Sectiune "Istoric RNPM" separata in sidebar

### Setari AI — Card nou 2Captcha
- Al 4-lea card in dialogul "Setari AI" alaturi de Anthropic / OpenAI / Google
- Cheie stocata obfuscata in localStorage (btoa + reverse) alaturi de celelalte
- Necesara exclusiv pentru tab-ul RNPM (~$0.003/captcha)

### Eager detail fetch
- UUID-urile RNPM sunt efemere — detaliile complete (parti 1-4 + istoric) sunt aduse in timpul cautarii si persistate local, eliminand round-trip-ul la browse ulterior

---

## v1.4.4-ai — 5 Aprilie 2026 (AI Enabled)

### Export — Excel Stilizat cu Formatare Avansata
- **xlsx-js-style** ca dependenta (drop-in replacement pentru xlsx cu suport styling la nivel de celula)
- **Titlu dark blue** — rand de titlu cu fundal albastru inchis, text alb, bold, merge pe toate coloanele
- **Rand statistici** — numar dosare/termene si data exportului, fond gri deschis
- **Headere colorate** — fundal albastru, text alb, bold, aliniere centrata (similar cu stilul PDF)
- **Randuri alternante** — gri deschis pe randurile pare, alb pe cele impare, text negru clar
- **Numar dosar bold** — evidentierea numerelor de dosar in lista principala
- **Sheet Sedinte grupat** — sectiuni clare per dosar cu header colorat, separate de un rand gol

### Export — Hyperlinks Interne Excel (Bidirectionale)
- **Dosare → Sedinte**: numarul dosarului din sheet-ul Dosare are hyperlink direct catre prima sedinta a dosarului din sheet-ul Sedinte
- **Sedinte → Dosare**: headerul fiecarei sectiuni de dosar din sheet-ul Sedinte are hyperlink inapoi catre randul dosarului din sheet-ul Dosare (indicat cu ↑)
- Navigare rapida intre cele doua sheet-uri fara scroll manual

### Export — Filenames Dinamice
- **1 dosar exportat**: fisierul se numeste `dosar_NR-DOSAR.xlsx` / `dosar_NR-DOSAR.pdf` (numarul dosarului in denumire)
- **Multiple dosare**: `dosare_DD.MM.YYYY.xlsx` / `dosare_DD.MM.YYYY.pdf` (data exportului)
- **Acelasi comportament pentru termene**: `termen_NR-DOSAR.ext` / `termene_DD.MM.YYYY.ext`
- Caracterele invalide pentru fisiere din numarul dosarului sunt inlocuite cu `-`

### AI — Actualizare Modele Claude
- **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — modelul Echilibrat
- **Claude Opus 4.6** (`claude-opus-4-6`) — modelul Premium si judecator multi-agent
- **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) — modelul Rapid
- Actualizare label-uri in interfata: "Sonnet 4" → "Sonnet 4.6", "Opus 4" → "Opus 4.6"

### Server — Versiune Deployabila
- **Build server** (`npm run dist:server`) — pachet ZIP complet pentru deployment direct pe server
- Backend bundlat cu esbuild (toate dependentele incluse intr-un singur fisier CJS)
- Frontend compilat ca fisiere statice, servite de backend in production
- Dockerfile + docker-compose.yml pentru deployment in container
- `.env.example` cu toate variabilele de configurare

---

## v1.4.3-ai — 3 Aprilie 2026 (AI Enabled)

### AI — Modele Gemini 3.x
- **Eliminare completa modele Gemini 2.5** — toate modelele deprecated din seria 2.5 au fost scoase
- **Modele noi Gemini 3.x**: Gemini 3.1 Flash Lite (Rapid), Gemini 3 Flash (Echilibrat), Gemini 3.1 Pro (Premium)
- **Gemini 3.1 Pro ca model judecator** — adaugat in lista modelelor permise pentru analiza multi-agent (alaturi de Claude Opus 4 si GPT-5.4)
- Actualizare model IDs backend: gemini-3.1-flash-lite-preview, gemini-3-flash-preview, gemini-3.1-pro-preview

### UX — Filtrare Date Client-Side (Calendar)
- **Filtrare instant pe rezultatele deja incarcate** — schimbarea datelor din Data Start / Data Stop filtreaza dosarele si termenele in timp real, fara o noua cautare SOAP
- Functioneaza pe ambele pagini: Cautare Dosare (filtreaza dupa data dosar) si Termene & Calendar (filtreaza dupa data sedinta)
- Se poate folosi doar Data Start, doar Data Stop, sau ambele simultan
- Filtrul se reseteaza automat la o cautare noua sau la apasarea butonului Reseteaza

### Performance — Timeout Multi-Agent
- **Timeout multi-agent crescut la 180s** (de la 120s) — permite analize complete pe dosare mari cu modele premium
- Timeout-ul e propagat separat prin lantul de apeluri `callModel → callAnthropic/callOpenAI/callGoogle`

### Desktop — Dimensionare Dinamica Fereastra
- **Fereastra Electron se adapteaza la rezolutia monitorului** — 85% din latimea si 90% din inaltimea work area
- Limite min/max: minim 900x600, maxim 1800x1100
- Respecta Windows DPI scaling nativ (fara zoom suplimentar)

---

## v1.4.2-ai — 31 Martie 2026 (AI Enabled)

### UX — Sectiuni AI Colapsabile
- **Analiză AI** (analiza simpla) este acum o sectiune colapsabila proprie cu header, model selectors direct vizibili, buton analiza si rezultat — totul intr-un singur container
- **Analiză AI Avansată** (multi-agent) este o sectiune colapsabila separata, independenta
- Ambele sectiuni pornesc **inchise by default** — se deschid doar la cererea utilizatorului
- Design unificat: ambele sectiuni au acelasi layout (header cu download + chevron, selectoare model, buton jos)
- Redenumire: "Analiză Avansată" → "Analiză AI Avansată"
- Descrierea modelului selectat (Rapid/Echilibrat/Premium) afisata langa butoanele de model in ambele sectiuni

### UX — Marire Fonturi Globala
- **Sidebar**: "Normal" label 11px → 12px, badge "Activ"/"Neconfigurat" 10px → 11px
- **Istoric Cautari**: header 11px → 12px, nume cautare 12px → 13px, rezultate + timp 10px → 11px
- **CalendarView**: toate fonturile marite cu +1.5px (card, solutie, solutieSumar 14.5px, parti, badges)

### UX — Consistenta Termene cu Dosare
- **solutieSumar** in TermeneTable: 13px → 14.5px (aliniat cu DosareTable)
- **Party badges** in TermeneTable: text-[10px] → text-xs (aliniat cu DosareTable)
- **splitConcatenatedWords** aplicat si pe TermeneTable (fix text concatenat tip "INCHEIEREINDREPTAR...")
- **Functii comune** (splitConcatenatedWords, formatDocumentSedinta) mutate in utils.ts (shared)
- **Bold rosu** pe data, ora si institutie cand randul e expandat (la fel ca in DosareTable)
- **Collapse anterior** — la deschiderea unui termen, cel anterior se inchide automat (la fel ca in DosareTable)

### AI — Descriere Model Selectat in Multi-Agent
- Fiecare row de model (Analist 1, Analist 2, Judecator) afiseaza acum descrierea modelului selectat (Rapid/Echilibrat/Premium) langa butoane
- Adaugat `desc` pe JUDGE_MODELS_LIST (Premium pentru Opus 4 si GPT-5.4)

---

## v1.4.1-ai — 30 Martie 2026 (AI Enabled)

### UX — Auto-Scroll la Detalii Dosar
- La expandarea unui rand din tabel, ecranul face scroll automat pentru a afisa sectiunea de detalii
- Deosebit de util cand dosarul este la finalul paginii vizibile
- Functioneaza pe ambele tab-uri: Dosare si Termene
- Detectie inteligenta a containerului scrollable (getBoundingClientRect + scrollable parent traversal)

### UX — Indicator Vizualizat / Nevizualizat
- Punct albastru animat (ping) langa numarul dosarelor/termenelor nevizualizate
- Iconita ochi gri pentru cele deja vizualizate (expandate)
- Marcare automata la expandarea randului
- Persistare in sessionStorage pe durata sesiunii de browser
- Functioneaza pe ambele tab-uri: Dosare si Termene

### UX — Butoane Navigare Rapida (Scroll Sus/Jos)
- Doua butoane floating in coltul din dreapta-jos al ecranului
- Sageata sus — apare cand ai scrollat >300px in jos, duce la meniul de cautare
- Sageata jos — apare cand mai ai >300px pana la finalul paginii
- Se actualizeaza automat la incarcarea de continut nou (ResizeObserver)
- Functioneaza pe toate paginile (Dashboard, Dosare, Termene)

### AI — Fix Analiza Trunchiata pe Dosare Complexe
- **max_tokens crescut de la 3000 la 8000** pe toti providerii (Anthropic, OpenAI, Google)
- **max_output_tokens setat explicit** pe OpenAI (Responses API) si Google (Gemini) — inainte depindeau de default-uri
- **Timeout backend crescut**: 90s → 120s per apel AI — safety net pentru dosare mari
- **Timeout frontend crescut**: single 120s → 180s, multi-agent 180s → 300s (5 minute)
- Rezolva problema analizei multi-agent care se oprea la dosare cu multe termene stufoase

---

## v1.4.0-ai — 29 Martie 2026 (AI Enabled)

### Paginare Extinsa (Load More)
- **Incarca mai multe** — cand SOAP API returneaza limita de 1.000 rezultate, butonul "Incarca mai multe" scaneaza luna cu luna pentru a aduce toate rezultatele
- Bara de progres in timp real: "Luna X din Y — Z dosare/termene noi gasite"
- Buton **Stop** (rosu) permite oprirea cautarii si pastrarea rezultatelor partiale deja primite
- Backend-ul primeste lista dosarelor existente (POST body) si trimite doar dosare **NOI** — fara re-scanare redundanta
- Subdivizare recursiva: daca o luna depaseste 1.000, se imparte in jumatati (max adancime 2)
- Chunking SSE: batch-uri de max 50 elemente per event pentru a evita pierderea in proxy buffers
- Functioneaza pe ambele tab-uri: Cautare Dosare si Termene
- Merge incremental pe fiecare batch — totalul afisat in progress reflecta numarul unic real
- Delay 150ms intre request-uri SOAP pentru a nu suprasolicita portalquery.just.ro
- Date range implicit 3 ani inapoi cand nu sunt specificate date

### Navigare Persistenta intre Tab-uri
- Componentele Dosare si Termene raman montate in DOM cand navighezi intre tab-uri (display:none)
- Operatiile async (load-more, cautare) **supravietuiesc** navigarii — nu se pierd la schimbarea tab-ului
- Doar butonul Stop opreste o cautare in progress, nu navigarea
- Campurile formularului, numele cautat si butonul Reseteaza se pastreaza corect la navigarea inapoi

### Buton Reseteaza Imbunatatit
- Reseteaza sterge complet: campuri formular, rezultate cautare, filtre, metrici, starea load-more
- Pagina revine la starea initiala (fara rezultate)

### Analiza Multi-Agent AI — Documentare Functionare
- **Rolul judecatorului** (nedocumentat anterior): judecatorul primeste datele complete ale dosarului + cele 2 analize separate
  - Unde ambele analize sunt de acord → preia direct concluzia comuna
  - Unde difera, se contrazic sau sunt vagi → verifica in datele originale ale dosarului
  - Produce analiza finala unitara + sectiune "Revizuire si reconciliere" cu diferentele gasite si cum le-a rezolvat
- Modele judecator permise: Claude Opus 4 si GPT-5.4
- Prompt analist: 7 sectiuni (Rezumat, Explicatie parti, Starea actuala, Istoric sedinte, Ce ar putea urma, Temei juridic, Legaturi cu alte dosare)

### Securitate (Audit Complet + Hardening)

#### CRITICAL — Fixate
- **Validare POST body pe load-more**: array `existing` limitat la max 10.000 elemente, max 100 caractere/element, tipuri verificate — previne DoS prin epuizare memorie
- **Schema validation pe POST body**: structura JSON validata complet (obiect, array de string-uri) — body malformat returneaza 400 cu mesaj clar, nu silent fail
- **JSON.parse protejat**: try-catch dedicat pe toate endpoint-urile AI — body invalid returneaza "JSON invalid." in loc de exceptie neprinsa

#### HIGH — Fixate
- **SSE timeout + limita intervale**: max 10 minute per stream, max 120 intervale lunare (~10 ani) — previne resource exhaustion
- **Chei API obfuscate in localStorage**: stocare cu btoa + reverse (nu plaintext citibil) — migrare automata de la formatul vechi
- **External URL whitelist exact**: `portal.just.ro`, `www.just.ro`, `portalquery.just.ro` — `.endsWith()` inlocuit cu `.includes()` pentru a preveni bypass-ul cu domenii similare (ex: `attacker-just.ro`)
- **DevTools dezactivate in productie**: `devTools: false` cand `NODE_ENV === "production"` — activabile cu flag `--dev-tools` pentru dezvoltatori

#### MEDIUM — Fixate
- **`enableRemoteModule: false`** explicit in Electron webPreferences
- **CSP restrictionat**: `data:` URI eliminat din `img-src` si `font-src` (aplicatia nu foloseste data: URI)

#### Riscuri Acceptate (documentate)
- SOAP HTTP: portalquery.just.ro nu ofera HTTPS — date publice, fara autentificare
- XML regex parsing: functioneaza corect cu formatul fix al Ministerului Justitiei, nu necesita parser dedicat

### Manual de Utilizare
- Manual complet integrat in aplicatie cu **12 capitole** care acopera toate functionalitatile
- Accesibil din Dashboard (buton "Manual" langa "Vezi Noutati"), deschis ca modal full-screen
- **Cuprins interactiv** — click pe capitol navigheaza direct la sectiunea respectiva (scroll smooth in containerul modal)
- **Export PDF** — buton de descarcare disponibil atat in header cat si la finalul manualului
- PDF generat: Portrait A4 cu cover page, cuprins, 12 capitole formatate profesional si footer pe fiecare pagina
- Capitole: Prezentare Generala, Dashboard, Cautare Dosare, Termene & Calendar, Load More, Export, Analiza AI, Multi-Agent, Chei API, Sidebar, Personalizare, Securitate

### Lizibilitate Text Imbunatatita
- Textul din Manual si Changelog schimbat de la gri (`text-muted-foreground`) la negru (`text-foreground`)
- Aplicat pe: paragrafe, bullet-uri, cuprins, subtitluri, footer, date versiuni

### Tehnic
- Load-more endpoints schimbate de la GET la POST (numerele dosarelor existente nu mai incap in URL)
- `backend/src/intervals.ts` — modul nou pentru generare intervale lunare si subdivizare
- Vite proxy cu timeout 600s pentru SSE endpoints
- `parseExistingFromBody()` — functie centralizata de validare body cu limite de securitate
- `AppShell` component cu `useLocation()` pentru routing persistent
- SearchForm accepta `defaultParams` si `onReset` props
- `lastSearchParams` salvat in starea parintelui (App.tsx) pentru persistenta intre navigari
- `onBatch` callback in `loadMoreSSE()` pentru merge incremental

---

## v1.3.0-ai — 28 Martie 2026 (AI Enabled)

### Analiza AI Avansata (Multi-Agent)
- Sistem multi-agent: 2 analisti AI analizeaza dosarul in paralel, un al 3-lea model (judecator) reconciliaza rezultatele
- Judecatorul primeste datele complete ale dosarului + cele 2 analize — verifica afirmatiile contra datelor reale, corecteaza interpretari gresite si adauga aspecte omise
- Modele judecator permise: Claude Opus 4 si GPT-5.4
- Sectiune colapsabila cu selectori model pentru fiecare analist si judecator
- Vizualizare analize individuale (toggle side-by-side)
- Endpoint nou: `POST /api/ai/analyze-multi`

### OpenAI Responses API & Modele Noi
- Migrare de la Chat Completions API la noul Responses API (`client.responses.create()`)
- Modele actualizate: GPT-5.4 nano (Rapid), GPT-5.4 mini (Echilibrat), GPT-5.4 (Premium)

### Prompt AI Imbunatatit
- Adaugat sectiuni noi in analiza: "Temei juridic (articole de lege relevante)" si "Legaturi cu alte dosare"
- Selectori model stivuiti vertical (layout imbunatatit)
- Afisare tip model (Rapid/Echilibrat/Premium) pe fiecare rand de provider in selectorul AI

### Export PDF Analize AI
- Export PDF pentru analiza simpla si avansata
- Design profesional: header minimal, card info dosar, formatare markdown
- Page breaks inteligente (titlul sectiunii nu ramane singur pe pagina)
- Paleta culori calde (warm gray/stone), footer pe fiecare pagina

### Securitate (Audit v1.3.0-ai)
- Prompt injection defense: date dosar in `<dosar_data>` delimiters, truncare campuri (obiect 500, nume parte 200, solutie 10000 chars)
- Analize AI in `<analiza_1>`/`<analiza_2>` delimiters in prompt-ul judecatorului
- Rate limiter ponderat: endpoint multi-agent consuma 3 unitati (vs 1 pentru alte endpoint-uri)
- Schema validation pe endpoint multi-agent (reutilizare `validateAiBody`)

### Performanta AI
- Apeluri directe fara extended thinking/reasoning — viteza optima pe toate modelele
- Timeout backend: 90s per apel AI
- Timeout frontend fetch: 120s (analiza simpla), 180s (multi-agent)
- `max_tokens` Anthropic: 3000 (suficient pt output real ~800-1500 tokens)
- Toate sedintele dosarului se trimit integral catre AI (fara limitare)
- Truncare campuri ajustata: obiect 500, nume parte 200, solutie 10000 caractere
- Fix macOS: guard `app.isReady()` pe `activate` + flag `backendStarted`

### Documentatie
- DOCUMENTATIE.md — documentatie completa a proiectului (arhitectura, functionalitati, securitate, API, tipuri date)

---

## [1.2.1-ai] - 2026-03-27 — AI Enabled

### Functionalitati Noi

#### Selector Institutii (Multi-Select)
- Selector modal pentru filtrarea pe **246 instante** din Romania (parsate din WSDL-ul SOAP)
- Grupare pe categorii: Curți de Apel (15), Tribunale (42), Tribunale Specializate (1), Tribunale Comerciale (3), Tribunale Militare (5), Curți Militare (1), Judecătorii (179)
- **Multi-select** cu draft state — selectiile se aplica la inchiderea ferestrei, cu sortare alfabetica
- Cautare diacritice-insensitiva (ex: "brasov" gaseste "Brașov")
- Chips vizuale pentru selectii, buton de reset, counter de rezultate
- **Cautare paralela SOAP** — cand sunt selectate mai multe institutii, backend-ul face `Promise.all` pe toate

#### Filtrare Client-Side pe Institutii
- Pipeline de filtrare extins: Institutii → Categorii → Stadii → Roluri
- Filtrarea se aplica pe dosarele deja extrase (fara re-interogare SOAP)

### Imbunatatiri

#### Normalizare Nume Institutii
- Functia `normalizeInstitutie()` centralizeaza — transforma "TribunalulSATUMARE" in "Tribunalul Satu Mare"
- Cache-based lookup cu strip diacritice pentru matching robust
- Aplicata in toate componentele: DosareTable, TermeneTable, MetricsPanel, CalendarView, DosarModal, export

#### Compatibilitate Diacritice Romanesti
- **Backend SOAP**: conversie automata ș(U+0219)→ş(U+015F) si ț(U+021B)→ţ(U+0163) — API-ul PortalJust accepta doar varianta legacy cu sedila
- Cautarea cu "Ioan Farcaș", "Ioan Farcaş" sau "Ioan Farcas" returneaza aceleasi rezultate
- **Analiza Parte (MetricsPanel)**: matching diacritice-insensitiv pentru contorizarea rolurilor
- **Highlight nume (DosareTable)**: regex cu variante diacritice — "farcas" face highlight pe "FARCAŞ"/"FĂRCAȘ"
- **Filtru roluri (Dosare)**: comparare diacritice-insensitiva intre numele cautat si parti
- **Selector institutii**: cautare fara diacritice gaseste rezultate cu diacritice

#### API Multi-Institutie
- Backend accepta parametrul `institutie` ca array (`?institutie=X&institutie=Y`)
- Frontend trimite array prin `URLSearchParams.append()`
- `c.req.queries("institutie")` in Hono pentru parsarea array-urilor

### Securitate (Audit v1.2.1-ai)

#### Protectie Amplificare Cereri SOAP
- Limita maxima de **50 institutii** per cerere — previne trimiterea de sute de cereri SOAP paralele printr-un singur request
- Toate valorile din array-ul `institutie` sunt validate individual (lungime, caractere de control)

#### Timeout pe Apeluri AI
- Toate apelurile catre providerii AI (Anthropic, OpenAI, Google) au acum timeout de **60 secunde**
- Previne blocarea conexiunilor HTTP cand un provider AI nu raspunde

#### Validare Body Size Reala
- Verificarea dimensiunii cererii `/api/ai/analyze` se face pe body-ul real, nu doar pe header-ul `Content-Length` (care poate fi omis sau falsificat)

#### Validare Chei API
- Valorile din `apiKeys` sunt validate ca string-uri cu lungime maxima de 256 caractere
- Previne trimiterea de obiecte sau string-uri foarte lungi ca chei API

#### Protectie URL Injection
- `encodeURIComponent()` aplicat pe toate URL-urile portal.just.ro construite din numere de dosar
- Previne injectarea de parametri URL prin caractere speciale in numerele de dosar

#### Verificare Identitate Backend (Electron)
- Health check-ul la pornire verifica acum ca raspunsul contine `service: "PortalJust API"`
- Previne port hijacking — daca alt proces ocupa portul 3001, aplicatia nu va incarca continut strain

#### Validare URL Stricta (Electron)
- `shell.openExternal()` foloseste acum `new URL()` pentru parsare si verifica `hostname.endsWith(".just.ro")`
- Previne bypass prin URL-uri de forma `https://portal.just.ro.evil.com`

#### CSP Imbunatatit (Electron)
- Adaugat `object-src 'none'` — blocheaza plugin-uri si embeds
- Adaugat `frame-ancestors 'none'` — previne incadrarea aplicatiei in iframe-uri

### Infrastructura
- `frontend/src/lib/institutii.ts` — fisier centralizat cu date institutii, grupuri si normalizare
- `frontend/src/components/InstitutieSelect.tsx` — componenta modal multi-select
- `toLegacyDiacritics()` in `backend/src/soap.ts` pentru compatibilitate Unicode SOAP
- `stripDiacritics()` aplicat consistent in toate componentele frontend cu matching de text

---

## [1.2.0-ai] - 2026-03-27 — AI Enabled

### Functionalitati Noi

#### Asistenta AI Multi-Provider
- Analiza AI integrata pentru interpretarea dosarelor din detalii expandate
- Suport pentru **3 provideri AI**:
  - **Anthropic** (Claude): Haiku 4.5, Sonnet 4, Opus 4
  - **OpenAI** (GPT-4): 4o mini, GPT-4o, GPT-4.1
  - **Google** (Gemini): Flash 2.0, Flash 2.5, Pro 2.5
- Selector de model grupat pe provideri cu coduri de culoare (violet/emerald/blue)
- Se afiseaza doar modelele pentru care exista cheie API activa
- Analiza completa: rezumat, explicatie parti, stare actuala, istoric sedinte, pasi urmatori
- Toate sedintele dosarului sunt incluse in analiza (nu doar ultimele 10)
- Buton toggle pentru ascundere/aratare analiza AI dupa generare
- Buton "Re-analizează" pentru regenerare cu alt model

#### Configurare Chei API
- Dialog global "Configurare Chei API" accesibil din sidebar ("Setari AI")
- Inputuri separate per provider cu status indicator (Activa/Neconfigurat)
- Posibilitate de stergere individuala a cheilor
- Cheile se salveaza doar local (localStorage) — nu sunt trimise nicaieri in afara de API-ul respectiv
- Optiunea "Mai tarziu" — configurarea nu este obligatorie
- Migrare automata de la formatul vechi (cheie unica) la multi-provider
- Indicator status in sidebar: verde (Activ) sau portocaliu (Neconfigurat)

#### Selectie pentru Export (Dosare & Termene)
- Checkbox pe fiecare rand din tabelele **Dosare** si **Termene**
- Checkbox "Select All" in header (selecteaza/deselecteaza pagina curenta)
- Evidentierea vizuala a randurilor selectate (fundal violet)
- Butoanele Excel/PDF arata numarul de elemente selectate
- Daca nu e selectat nimic, se exporta toate elementele (comportament implicit)
- Buton "Deselecteaza tot" pentru reset rapid

#### Export Imbunatatit cu Sedinte
- **Excel**: 2 sheet-uri — "Dosare" + "Sedinte" (toate sedintele cu data, ora, complet, solutie, sumar, document, numar document, data pronuntare)
- **PDF**: coloana noua "Sedinte" cu rezumatul fiecarei sedinte (data, ora, solutia si sumarul)
- Subtitlu cu numar total de dosare si sedinte

#### Selector Rezultate pe Pagina
- Butoane pentru alegerea numarului de rezultate per pagina
- Dosare: 10, 15, 25, 50, 100 (default: 15)
- Termene: 10, 20, 50, 100 (default: 20)
- Se reseteaza automat la pagina 1 cand se schimba

#### Meniu Contextual Electron (Click Dreapta)
- **Copiaza** — apare doar cand exista text selectat
- **Selecteaza tot** — selecteaza tot textul din pagina
- **Printeaza...** — deschide dialogul de printare Windows
- Ctrl+C functioneaza nativ pentru copiere

### Securitate (Audit v1.2.0-ai)

#### Protectie XSS pe Analiza AI
- Toate zonele care afiseaza raspunsul AI folosesc acum **DOMPurify** pentru sanitizarea HTML-ului
- Taguri permise strict limitate la `<strong>`, `<em>`, `<b>`, `<i>` — restul sunt eliminate automat
- Previne executia de cod malitios daca un model AI ar returna HTML/JavaScript in raspuns

#### Sanitizare Erori API
- Mesajele de eroare returnate clientului nu mai contin detalii interne (stack trace, chei API partiale, mesaje SDK)
- Erorile sunt logate complet server-side pentru debugging, dar clientul primeste doar un mesaj generic
- Mesajele SOAP Fault de la PortalJust sunt si ele sanitizate — detaliile tehnice raman doar in log

#### Validare Schema AI Request
- Endpoint-ul `/api/ai/analyze` valideaza acum structura completa a body-ului: tipuri campuri dosar, format apiKeys, model valid
- Limita de dimensiune body: **100KB** — cererile mai mari sunt respinse cu HTTP 413
- Campurile dosarului sunt validate individual (string, array unde trebuie)

#### Protectie Rate Limiter
- Rate limiterul nu mai foloseste header-ul `X-Forwarded-For` (spoofable) pentru identificarea clientilor
- Serverul fiind bind pe localhost, toate cererile vin de la aceeasi adresa — rate limiting-ul protejeaza impotriva flood-ului local

#### Validare Date Imbunatatita
- Validarea datelor (dataStart, dataStop) verifica acum ca data este **reala** (ex: 2024-02-30 este respins, nu doar formatul YYYY-MM-DD)
- Reject caractere de control si null bytes din toti parametrii de input

### Infrastructura
- Backend multi-provider: endpoint unic `/api/ai/analyze` cu rutare automata catre SDK-ul corect
- SDK-uri instalate: `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`
- Vite `optimizeDeps.include` pentru pre-bundling `xlsx`, `jspdf`, `jspdf-autotable`
- dotenv cu `override: true` pentru incarcarea corecta a variabilelor de mediu

---

## [1.2.0] - 2026-03-26

### Imbunatatiri

#### Build macOS (DMG)
- Adaugat suport complet pentru **macOS** (Intel + Apple Silicon)
- GitHub Actions workflow pentru build automat pe macOS
- Fisier DMG cu drag-to-Applications installer
- Repository GitHub: github.com/Havocwithin/portaljust-dashboard

#### Ajustare Dimensiune Font
- Recalibrat valorile fontului: Mic (16px), Normal (18px), Mare (20px), Extra (22px)
- "Normal" corespunde acum dimensiunii corecte pentru ecrane laptop standard
- Rezolvat problema fontului prea mic pe rezolutii mari

#### Iconita Aplicatie
- Iconita cu balanta justitiei prezenta peste tot: installer, taskbar Windows, title bar
- Configurata pentru NSIS (installer/uninstaller icons)
- Adaptata pentru macOS (icon 1024px)

#### Installer fara Drepturi Admin
- Instalarea pe Windows nu mai necesita drepturi de administrator
- Se instaleaza in AppData (per-user), nu in Program Files
- `allowElevation: false` previne prompt-ul UAC

---

## [1.1.0] - 2026-03-26

### Functionalitati Noi

#### Selectie Multipla Roluri (Analiza Parte)
- Badge-urile de rol din sectiunea "Analiza Parte" suporta acum **selectie multipla**
- Se pot combina mai multe roluri simultan (ex: "Creditor" + "Parat" + "Reclamant")
- Mesaj dinamic: "1 filtru activ" / "3 filtre active"
- Click repetat pe un rol il deselecteaza

#### Evidentierea Numelui Cautat (Highlight)
- Cuvintele cautate sunt evidientiate cu **galben** in numele partilor
- Functioneaza independent de ordinea cuvintelor ("instant factoring" evidentiaza "INSTANT" si "FACTORING" separat)
- Aplicat in:
  - Preview-ul din randul tabelului Dosare (primele 2 parti)
  - Sectiunea expandata Parti din Dosare
  - Sectiunea expandata Parti din Termene
- Tooltip (hover) pe numele trunchiate pentru vizualizarea numelui complet

#### Control Dimensiune Text
- Adaugat control de font size in sidebar (4 pasi: Mic 14px, Normal 16px, Mare 18px, Extra 20px)
- Sidebar expandat: butoane A-/A+ cu indicator vizual (4 puncte)
- Sidebar collapsed: iconita "A" cu ciclu prin pasi la click
- Setarea se salveaza in localStorage - persistenta intre sesiuni
- Afecteaza toata aplicatia (Tailwind rem-based scaling)

#### Detalii Expandabile in Tabelul Termene
- Click pe rand deschide/inchide detalii complete
- Informatii afisate: Categorie, Stadiu, Obiect dosar
- Solutie completa (titlu + sumar integral, text lizibil)
- Lista de parti cu badge calitate + nume cu highlight
- Sageata vizuala (chevron) indica expandabilitatea

#### Detalii Expandabile in Calendar
- Numerele de dosar din calendar sunt acum **linkuri** catre portal.just.ro
- Click pe card deschide dropdown cu:
  - Solutie completa (titlu + sumar)
  - Lista de parti cu badge calitate
- Sageata vizuala indica expandabilitatea

#### Filtre Metrici Termene (Carduri Clickabile)
- Cardurile "Termene Viitoare", "Termene Trecute", "Cu Solutie" functioneaza ca **filtre multiple choice**
- Card activ: ring albastru + iconita inversata
- "Total Termene" reseteaza toate filtrele la click
- Filtrele se propaga in cascada: Categorie/Stadiu -> Metrici -> Tabel + Calendar
- Se reseteza automat la cautare noua

#### Filtre Categorie/Stadiu pe Termene
- Filtrele Categorie Caz si Stadiu Procesual sunt acum **functionale** pe pagina Termene
- Backend-ul transmite acum `categorieCaz`, `stadiuProcesual`, `obiect` si `parti` pentru fiecare termen
- Filtrare client-side identica cu cea de pe Dosare
- Metricile reflecta datele filtrate de categorie/stadiu

### Imbunatatiri

#### Corectare Texte Concatenate (Documente Sedinta)
- Extins dictionarul de segmentare cu ~50 termeni juridici noi
- Rezolvate cazuri precum:
  - "INCHEIEREFINALA" -> "INCHEIERE FINALA"
  - "DEZINVESTIREFINALA" -> "DEZINVESTIRE FINALA"
  - "INCHEIERECAMERAPRELIMINARA" -> "INCHEIERE CAMERA PRELIMINARA"
  - "HOTARAREDEFINITIVA" -> "HOTARARE DEFINITIVA"
  - "SENTINTAPENALA" -> "SENTINTA PENALA"
- Categorii adaugate: actiuni procesuale, calificative, locuri/contexte, participanti, prepozitii

#### Consistenta Interfata
- Stilul solutiei din detalii Termene aliniat cu cel din Dosare
- Badge-ul albastru de marcare parte eliminat (pastrat doar highlight-ul galben pe nume)

### Infrastructura

#### Date Complete pentru Termene
- API-ul `/api/termene` returneaza acum informatii complete din dosar:
  - `categorieCaz` - categoria dosarului
  - `stadiuProcesual` - stadiul procesual
  - `obiect` - obiectul dosarului
  - `parti[]` - lista completa de parti (nume + calitate)
- Tipul TypeScript `Termen` actualizat cu campurile noi

---

## [1.0.0] - 2026-03-25

### Lansare Initiala

#### Functionalitati Principale
- Conectare la API-ul SOAP PortalJust.ro (Ministerul Justitiei)
- Cautare dosare dupa: numar dosar, nume parte, obiect dosar
- Cautare termene cu date start/stop
- Filtre client-side: Categorie Caz, Stadiu Procesual
- Vizualizare tabel cu paginatie (20 elemente/pagina)
- Vizualizare calendar pentru termene
- Export Excel si PDF
- Metrici si statistici (grafice Recharts)
- Analiza parte cu roluri si numar aparitii
- Sectiuni de metrici collapsabile (Ascunde/Arata)
- Tema Dark/Light cu persistenta
- Sidebar cu navigare si collapse
- Istoric cautari (max 15, localStorage, stergere individuala)
- Popover istoric pentru sidebar collapsed
- Link-uri directe catre portal.just.ro
- Segmentare automata documente concatenate (INCHEIEREDESEDINTA -> INCHEIERE DE SEDINTA)
- Matching nume independent de ordine (Florin Duduianu = DUDUIANU FLORIN)

#### Arhitectura
- Frontend: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- Backend: Node.js + Hono (port 3001)
- SOAP integration: portalquery.just.ro/query.asmx
- Grafice: Recharts (PieChart, BarChart)
- Packaging: Electron + electron-builder (NSIS installer, fara admin)

#### Securitate (Masuri de Baza)
- **Rate limiting** (30 req/min pe endpoint) — previne flood-ul si abuzul API-ului
- **Input validation** — lungime maxima 200 caractere per parametru, validare format date YYYY-MM-DD
- **Bind localhost only** (127.0.0.1) — serverul backend nu este expus in retea, doar aplicatia Electron il poate accesa
- **Path traversal protection** — fisierele statice servite doar din directorul frontend; cererile cu `../` sau cai absolute sunt blocate cu HTTP 403
- **Security headers** (Hono secureHeaders) — X-Content-Type-Options: nosniff, X-Frame-Options: DENY, X-XSS-Protection, Content-Security-Policy
- **Escape XML complet** pentru SOAP requests — toate inputurile utilizatorului sunt escaped inainte de a fi trimise catre PortalJust (previne XML injection)
- **CORS restrictiv** — doar originile localhost pe porturile de dezvoltare (5173, 4173) sunt permise; orice alta origine este blocata
- **Fara persistenta API keys in backend** — cheile nu sunt stocate pe disc de catre server, sunt primite per-request de la client
