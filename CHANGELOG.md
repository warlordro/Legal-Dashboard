# Changelog - Legal Dashboard

Toate modificarile notabile ale acestui proiect sunt documentate in acest fisier.

---

## [2.20.7] - 2026-05-11

### UX RNPM Baza locala + toggle notificari sistem + retentie tab Bulk

Release de polish dupa v2.20.6, cu trei interventii independente, toate scope-narrow:
(a) export "toate avizele filtrate", nu doar pagina vizibila, in panoul Baza locala
RNPM, plus redenumirea sheet-ului "Debitori" in "Parti" pentru a reflecta continutul
real; (b) toggle pentru a opri popup-urile Windows/macOS legate de alerte fara a
afecta bulina cu count sau pagina Alerts; (c) micro-fix UX care opreste anularea
unei cautari Bulk RNPM cand userul comuta tabul.

#### Export Baza locala — toate avizele filtrate, nu doar pagina

- [frontend/src/components/rnpm/RnpmSavedData.tsx](frontend/src/components/rnpm/RnpmSavedData.tsx):
  cand nu exista selectie explicita, `handleExport` cheama acum `rnpmGetAllSaved`
  cu filtrul activ (`searchType`, `activ`, `q`, `dataStart`, `dataStop`, `sortKey`,
  `sortDir`) si exporta intregul set, nu doar pagina afisata. Butoanele "Excel" si
  "PDF" arata `total` cand nu e selectie si `selectedIds.size` cand este.
- [frontend/src/lib/rnpmApi.ts](frontend/src/lib/rnpmApi.ts): batching transparent
  pe cele doua cap-uri backend — `/saved` GET pe pagini de 200 ca sa adune toate
  inregistrarile filtrate, apoi `/saved/export` POST in batch-uri de 500 IDs.
  Niciun cap backend nu a fost modificat.

#### Sheet "Debitori" redenumit in "Parti"

- [frontend/src/lib/rnpmExport.ts](frontend/src/lib/rnpmExport.ts): sheet-ul al
  doilea (xlsx) si sectiunea PDF echivalenta au acum titlul "Parti". Sheet-ul
  istoric mostenea numele bucket-ului RNPM (`part3.debitoriF/J` upstream), dar in
  practica contine entitati cu rol/calitate (Cesionar, Cedent, Debitor cedat,
  Garant, etc.), nu doar literal debitorii — verificat empiric pe baza locala:
  TELECREDIT IFN (CUI 33317138) apare de 106 ori ca Cesionar, 1 data Cedent, 0
  ori in tabela `rnpm_creditori`. DB schema (`rnpm_creditori` / `rnpm_debitori`)
  ramane neatinsa — schimbarea e doar la presentation layer.
- Linia stats-uri din export afiseaza `... parti ...` in loc de `... debitori ...`.

#### Toggle notificari sistem pentru alerte (in-memory, session-scoped)

- [frontend/src/lib/alertsNotificationPref.ts](frontend/src/lib/alertsNotificationPref.ts):
  modul nou, preferinta in-memory cu listeners pentru sync intre componenta UI
  si stream-ul de alerte. Nu persista — la restart Electron revine ON. Cand e
  OFF, alertele NU se queue-uiesc, deci la reactivare nu vine un flood.
- [frontend/src/components/NotificationStatusPanel.tsx](frontend/src/components/NotificationStatusPanel.tsx):
  checkbox nou "Trimite notificari sistem pentru alerte noi". Butonul "Test" se
  dezactiveaza cand preferinta e OFF (cu tooltip), ca sa nu se trimita test
  imediat dupa ce userul a debifat.
- [frontend/src/hooks/useAlertsStream.ts](frontend/src/hooks/useAlertsStream.ts):
  early-return la inceputul `showDesktopNotification` cand preferinta e OFF.
  Restul fluxului (refresh unread badge, bump streamVersion, lista in pagina
  Alerts) ramane neatins.

#### Bulk RNPM ramane montat la schimbare de tab

- [frontend/src/pages/RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx): tabul
  "Bulk" e acum tinut montat prin `className` `hidden` cand userul comuta la
  "Search" sau "Saved", in loc sa fie unmount-uit prin guard `{tab === "bulk" && ...}`.
  Anterior, comutarea de tab in timpul unei cautari Bulk in progres declansa
  cleanup-ul useEffect, care anula `AbortController`-ul si pierdea progresul.
  Acum, doar navigarea efectiva afara din pagina RnpmSearch (route change) mai
  aborteaza cautarea.

#### CHANGELOG.md markdown style fix

- [CHANGELOG.md](CHANGELOG.md) (sectiunea v2.20.4): o linie din interiorul unui
  paragraf incepea cu `+` urmat de spatiu, care era randat de GitHub ca bullet
  list si spargea bold-ul peste boundary. Reformat la `plus` text (conform
  conventiei din `CLAUDE.md`).

#### Tests

- Frontend: 100/100 trec (`cd frontend && npm test -- --run`).
- Backend: nicio modificare in backend, suite ramane 844/844.
- Type-check (`tsc --noEmit` pe ambele workspace-uri): clean.

---

## [2.20.6] - 2026-05-10

### Hygiene release: documentatie env vars + microfix envelope pe rute admin

Doua interventii narrow-scope alese ca sa nu rupa contractul: (a) repo-ul nu avea
`.env.example` desi codul referea ~25 env vars (CP-2 din root `CLAUDE.md` era
violat); (b) `requireRole.ts` (admin guard) emitea raw `{ error: { code, message } }`
in loc de envelope-ul standard, ceea ce facea ca admin tooling sa nu poata corela
401/403 cu `requestId`-ul HTTP. Migrarea envelope pe celelalte rute legacy
(rnpm/dosare/termene/ai) a fost EXPLICIT amanata pentru PR-6 — vezi sectiunea
"Defer la PR-6" mai jos.

#### `.env.example` reconstruit (CP-2 closure)

- Fisier nou la root cu ~25 variabile grupate in 7 sectiuni: `Mod si bind`,
  `Auth (web mode)`, `Storage si migrations`, `Monitoring`, `Email (SMTP)`,
  `AI providers`, `RNPM operational kill switches`. Fiecare variabila adnotata
  cu `REQUIRED-WEB | OPTIONAL` plus descriere concreta (ce face, default-ul,
  unde se obtine valoarea).
- Listate la final si constantele hardcodate (`RNPM_SITEKEY`, `RNPM_USER_AGENT`)
  ca pointer in cod — daca migreaza candva la env vars, intrarile exista deja
  in template ca referinta.

#### `requireRole` envelope (Batch 1.1 din `FIXES-TODO`)

- [backend/src/middleware/requireRole.ts](backend/src/middleware/requireRole.ts):
  cele 3 cai de denial (`user_not_found` 401, `user_inactive` 403,
  `role_mismatch` 403) returneaza acum `c.json(fail(code, message, c), status)`
  in loc de raw `{ error: { code, message } }`.
- Schimbarea pe wire e strict aditiva: pre-migration shape avea `{ error: { code, message } }`,
  post-migration adauga `data: null` + `requestId` (din `requestId` middleware).
  Toate testele existente (8 in `requireRole.test.ts`) raman verde — asertiile
  erau pe `body.error.code` + `body.error.message`, nu pe shape-ul intregului
  payload.
- Beneficiul real: admin tooling (audit log review) poate corela 401/403 cu
  request-ul HTTP exact prin `requestId`; pana acum erau orfane.

#### Defer la PR-6: rnpm/dosare/termene/ai envelope

Restul rutelor legacy NU au fost migrate. Doua semnale in repo o cer explicit:

1. [backend/src/util/envelope.ts](backend/src/util/envelope.ts) are policy-ul
   ca migrarea sa fie one-shot odata cu `@hono/zod-openapi` (PR-6), nu
   incrementala — pentru ca shape-ul wire trebuie tinut sincron cu OpenAPI
   schema generata.
2. [backend/src/routes/rnpm.contract.test.ts](backend/src/routes/rnpm.contract.test.ts)
   are docstring explicit care marcheaza testele ca guard de migrare. Trei
   teste asertea `expect(typeof body.error).toBe("string")` pentru web-mode
   501 — schimbarea shape-ului fara PR-6 ar sparge contract tests.

Batch-urile 1.2 (rnpm web-mode 501), 1.3 (`bodyTooLarge` 413), 1.4 (ai.ts error
paths) raman deschise in `FIXES-TODO.md` cu nota "DEFER la PR-6".

#### Tests

- **Backend**: 844/844, type-check curat. Schimbarea functionala e doar in
  `requireRole.ts` — testele asertea pe campuri (`error.code`, `error.message`),
  nu pe shape-ul outer, deci raman compatibile.
- **Frontend**: 100/100, type-check curat.

---

## [2.20.5] - 2026-05-10

### Hotfix release pipeline + SSE timeout aliniat la cap-ul real de 200 CUI

v2.20.4 a fost taggat dar build-ul GitHub Actions a esuat pe Docker + macOS
(Build Windows in progress in momentul descoperirii) pentru ca commit-ul de
release a stripuit accidental blocurile `scripts`, `build` si `devDependencies`
din root `package.json`. NSIS/DMG-ul nu a fost generat — practic v2.20.4 nu are
artefacte. v2.20.5 restaureaza root `package.json` integral si rezolva 2
findings CodeRabbit pe v2.20.4.

#### Restore tooling root `package.json`

- Restaurate scripturile `dev:backend`, `dev:frontend`, `build`, `dist`,
  `dist:mac`, `dist:server`, `electron:dev`, `rebuild:electron`, `typecheck*`,
  `test*`, `lint`, `check`. Fara ele `npm run build` returneaza
  "Missing script" si workflows-urile fail-eaza la pasul "Build app".
- Restaurat blocul `build` (electron-builder config: appId, files, NSIS, mac
  DMG, asarUnpack). Fara el `electron-builder` nu stie ce sa packageze.
- Restaurate `devDependencies`: `@biomejs/biome`, `electron@41`, `electron-builder@26`,
  `esbuild`, `png-to-ico`, `sharp`. Fara ele `npm ci` la runner nu instaleaza
  toolchain-ul de packaging.

#### CodeRabbit finding 1 — SSE timeout sub worst-case-ul cap-ului UI

- **Bulk SSE timeout 60 min -> 90 min** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)). `SSE_TIMEOUT_MS = 3600000` -> `5400000`. v2.20.4 a ridicat cap-ul UI la 200 CUI dar a setat timeout-ul la 60 min, sub worst-case-ul real de ~83 min (200 items × 25s ipoteci) — taia stream-ul pe la item ~144. 90 min acopera batch-uri reale de 200 CUI in 1 stream singur (worst-case ipoteci), plus margin pentru retries captcha si latenta upstream variabila. Ramane cap finit (taburile orfane nu hang-uiesc indefinit).

#### CodeRabbit finding 2 — Wording auto-contradictoriu in changelog v2.20.4

- Re-formulata sectiunea "Bulk SSE timeout" din [frontend/src/data/changelog-entries.tsx](frontend/src/data/changelog-entries.tsx) si CHANGELOG.md. v2.20.4 anunta ca 60 min "acopera 200 CUI in 1 stream singur" si in aceeasi propozitie mentiona "worst-case ipoteci ~83 min" — auto-contradictoriu. v2.20.5 afirma corect: 90 min e budget-ul pentru worst-case 200 CUI / 1 stream (ipoteci); use case-ul real ramane 2-6 taburi paralele × 100 CUI in ~20-40 min fiecare.

#### Tests

- **Backend**: 844/844 (neschimbate; doar constanta SSE_TIMEOUT_MS hardcodata diferit).
- **Frontend**: 100/100 (neschimbate).
- **Type-check**: curat pe ambele.

#### Versionare

- Root: `2.20.4` -> `2.20.5`
- Backend: `2.20.4` -> `2.20.5`
- Frontend: `2.20.4` -> `2.20.5`
- `package-lock.json` sincronizat
- Changelog in-app: VersionEntry v2.20.5 prepended la `versions[]`

---

## [2.20.4] - 2026-05-10

> **Notă (post-mortem)**: build-ul GitHub Actions a esuat pe v2.20.4 (Docker
> + macOS au returnat "Missing script: build" pentru ca root `package.json`
> a pierdut accidental scripts/build/devDependencies). Fix-ul a iesit ca
> hotfix v2.20.5; v2.20.4 nu are installer NSIS sau DMG.

### UX hardening pentru bulk RNPM la batch-uri mari + rate-limit ridicat

Patch UX universal valabil pe toate cele 5 categorii RNPM (ipoteci, specifice,
fiducii, creante, obligatiuni). Zero schimbari de contract HTTP, zero migration,
zero modificari pe SSE event payload. Doar constante.

#### Schimbari backend

- **Bulk SSE timeout 10 min -> 60 min** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)). `SSE_TIMEOUT_MS = 600000` -> `3600000`. Cap-ul anterior ucidea orice batch peste ~24 items (la 25s/item worst-case ipoteci) — practic peste cap-ul de 100 CUI din UI. 60 min acopera use case-ul real cu 2-6 taburi paralele × 100 CUI fiecare in ~20-40 min. (CORRIGENDUM v2.20.5: 60 min nu acopera worst-case-ul de 200 CUI / 1 stream ipoteci ~83 min — re-bumped la 90 min in v2.20.5.)
- **Rate-limit global 30 -> 120 req/min per `(ip, ownerId)`** ([backend/src/middleware/rate-limit.ts](backend/src/middleware/rate-limit.ts)). `RATE_LIMIT` exportata acum (era constanta locala) ca testele sa nu duplice magic number-ul. Pragul anterior era prea conservator pentru UX desktop — pagina Alerts cu Refresh + Inchide toate + paginare burst-uia usor 30/min si producea 429 in flow normal. 120 acopera bursturi realiste, pastreaza protectia impotriva runaway loops (un infinite useEffect ar fi blocat tot dupa ~1 min) si ramane izolare per `(ip, ownerId)` in web mode.

#### Schimbari frontend

- **UI `MAX_BATCH` 100 -> 200** ([frontend/src/components/rnpm/RnpmBulkSearch.tsx](frontend/src/components/rnpm/RnpmBulkSearch.tsx)). Egaleaza cap-ul server (`rnpm.ts:231` "Maxim 200 cautari per bulk"). Permite paste direct de batch-uri mari fara warning de overlimit + nici o trunchiere silentioasa.
- **Hint UI pentru >150 CUI**. Sub textarea apare automat un mesaj amber: "Pentru >150 CUI recomandam splitting in 2-3 taburi paralele (fiecare cu ~100 CUI). Fiecare bulk are propriul stream SSE si nu se influenteaza reciproc — wall time scade liniar cu numarul de taburi." Educational, sa nu se bata in cap-ul SSE pe stream-uri orfane si sa profite de paralelismul natural al taburilor.

#### Tests

- **Backend**: 844/844 (neschimbate; testele de rate-limit folosesc acum constanta `RATE_LIMIT` exportata in loc de magic 30).
- **Frontend**: 100/100 (neschimbate).
- **Type-check**: curat pe ambele.

#### Versionare

`2.20.3` -> `2.20.4` (patch UX — fara breaking change, fara migration).

---

## [2.20.3] - 2026-05-08

### RNPM hardening — fail-fast, audit corelat cu envelope, allow-list canonica

Hardening urmare a `/full-review` post v2.20.2. Adauga 1 migration noua
(audit_log plus request_id), un kill switch operational, si validare in plus la nivel de ruta.
Fara modificari la contract HTTP la rezultat (split-stats shape neschimbat).

#### Schimbari backend

- **Audit retention 90 zile pe `audit_log`** ([backend/src/db/auditRepository.ts](backend/src/db/auditRepository.ts)). Adauga `purgeOldAuditLog(retentionDays = 90)` analog `purgeOldRuns` / `purgeOldAiUsage`. Apelat din scheduler-ul de monitoring; previne crestere monotona pe productie cu ~1 INSERT/request mutant.
- **Fail-fast pe K=3 silent_refusal consecutive** ([backend/src/services/rnpmSearchService.ts](backend/src/services/rnpmSearchService.ts)). Daca RNPM intoarce `total>0, documents:[]` de 3 ori la rand pe acelasi split (refuz tacit upstream), saritura restul sub-tipurilor cu reason RO. Counter reset pe semnale clare ca upstream functioneaza (total=0 sau success cu docs sau limit_exceeded). Evita 18×1.5s waste pe categorii ipoteci cand throttle-ul e wholesale.
- **`audit_log.request_id` (migration 0017)** ([backend/src/db/migrations/0017_audit_request_id.up.sql](backend/src/db/migrations/0017_audit_request_id.up.sql)). Coloana noua + index partial `WHERE request_id IS NOT NULL`. Permite jump direct de la envelope `{requestId}` la randul de audit corespunzator (admin Audit page filtru `requestId` exact). Migration are si fisier `.down.sql` cu `DROP COLUMN` (better-sqlite3 ≥3.35).
- **`onSearchCreated` callback in `executeSplitSearch`** ([backend/src/services/rnpmSearchService.ts](backend/src/services/rnpmSearchService.ts)). Surface searchId-ul imediat ce parent-ul e creat in DB, inainte de prima sub-cautare. Permite SSE handler-ului sa emita `event: started` ca front-ul sa stie searchId-ul chiar daca user-ul aborteaza in primele secunde.
- **SSE explicit timeout vs aborted differentiation** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)). Catch-ul `AbortError` distinge `c.req.raw.signal?.aborted === true` (client a inchis conexiunea) vs intern (`SSE_SPLIT_TIMEOUT_MS` / `SSE_TIMEOUT_MS` au expirat). Front-ul stie sa afiseze toast "anulat de utilizator" vs "timeout server" si include `searchId` + `timeoutMs` in payload.
- **`captchasUsed` corect cu retry-uri** ([backend/src/services/rnpmSearchService.ts](backend/src/services/rnpmSearchService.ts)). Adaugat `captchasUsed: number` la `ExecuteSearchResult`; pe success acumuleaza `result.captchasUsed` (include retries `search_retry`); pe error path conservative `+1` (cel putin captcha-ul initial a fost consumat).
- **Allow-list canonica pe `subTypeLabels`** ([backend/src/services/rnpmSubTypes.ts](backend/src/services/rnpmSubTypes.ts), [backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)). Fisier nou cu mirror al `frontend/src/components/rnpm/rnpm-form-constants.ts:TIP_AVIZ_BY_CATEGORY`. POST `/search-split` valideaza ca lista trimisa e prefix exact (ordine + casing) — previne drift / accidental re-ordering care ar fi schimbat indexarea 1-based pe care RNPM o asteapta in `tipInscriere.value`.
- **Kill switch `RNPM_AUDIT_CAP_HIT_DISABLED`** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)). Set la `1` opreste INSERT-ul `rnpm.cap_hit` fara restart; util operational daca audit_log creste prea repede sau in timpul unui incident upstream care produce zeci de events/minut.

#### Tests

- **Backend**: 844/844 (era 827 in v2.20.2, +17 noi):
  - 2 in `rnpmSearchService.split.test.ts` Grupul I: K=3 fail-fast happy path + counter reset pe success intermediar.
  - 5 in `rnpmSearchService.split.test.ts` Grupul N edge cases: abort mid-tier-2, mixed gapReasons (terminal_cap + silent_refusal + residual_unclassified), single-sub-type, all-empty, tier-2 generic error.
  - 4 in `auditRepository.test.ts` Grupul J: requestId persist din middleware, override explicit, NULL pe system events, filter exact.
  - 2 in `routes/rnpm.split-route.test.ts` Grupul O: allow-list reject, kill switch.
  - 1 admin route Grupul J: filtru `requestId` in `/api/v1/admin/audit`.
  - 3 alte teste auxiliare in suite-ul existing (cumulativ).
- **Frontend**: 100/100 (neschimbate).

#### Versionare

`2.20.2` -> `2.20.3` (minor patch — adauga migration 0017 + helper service nou,
fara breaking change la API public sau la shape-ul SSE).

---

## [2.20.2] - 2026-05-08

### Patch correctness — audit safety, overlay humanizat, exhaustiveness TS

Bug-uri descoperite la `/full-review` post v2.20.0/v2.20.1. Fara feature nou, fara migrare,
fara schimbari de contract; doar fix-uri de regresie + observability hardening.

#### Schimbari

- **Audit `rnpm.cap_hit` izolat la failure** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)). Inainte: `recordAudit(...)` arunca propagandu-se in
  `try` si flip-uia event-ul SSE de success in error. Acum: wrap in `try/catch` local, failure → `console.warn` si SSE complete-ul tot ajunge la client. Audit observability != hard dependency.
- **GDPR — sterge `criteriu` din audit detail** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)). Campul `criteriu` (CUI/CNP/nume) era duplicat in
  `audit_log.detail_json`, in plus fata de payload-ul de cautare deja stocat. In schimb se loga `searchType` (enum low-cardinality, RnpmSearchType).
- **Audit `blockedLabels` flatten tier-1 + tier-2** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)). Pana acum nested gap-urile (destinatii blocate
  in tier-2 ipoteci) nu apareau in `blockedLabels`. Acum: prefix `tier1 > tier2`, cap la 20 entries, flag `blockedLabelsTruncated` cand depaseste.
- **Audit `gapByReason` aritmetic corect** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)). Pentru status="partial" foloseste `s.gap` (deja calculat in service) in loc de derivat `subTotal - count` care dubla numara recovered tier-2. Tier-2 nested se aduna separat (silent_refusal pe destinatie).
- **Overlay split humanizat + 1-based** ([frontend/src/pages/RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx)). v2.20.1 humanizase doar banner-ul; overlay-ul fix bottom-right
  inca afisa `Split 0/7` (0-based) si `nested_progress` (raw token enum). Fix: state shape `RnpmSplitProgress | null` (in loc de subset cu `phase: string`), randam via `describeSplitPhase` + `describeNestedPhase`, index-ul afisat `splitProgress.index + 1`.
- **TS exhaustiveness pe humanizers** ([frontend/src/lib/rnpmGapReason.ts](frontend/src/lib/rnpmGapReason.ts), [frontend/src/lib/rnpmProgressPhase.ts](frontend/src/lib/rnpmProgressPhase.ts)). `default:`-urile defeats TypeScript exhaustiveness pe `RnpmGapReason` / split phase / nested phase. Fix: handle `undefined` explicit (caz runtime real), apoi `_exhaustive: never` in default ca un enum nou neimplementat sa esueze build-ul.

#### Tests

- **Backend**: 827/827 (era 823, +4 noi in `routes/rnpm.split-route.test.ts`):
  - E1 audit detail shape (gapByReason tier-1+tier-2 flatten, criteriu absent, searchType prezent).
  - E2 recordAudit failure isolated (mock throws → SSE complete event still emits).
  - E3 no-emit cand nu exista cap (upstreamTotal === total si zero blocked).
  - E4 gapByReason for partial uses s.gap (not subTotal - count).
- **Frontend**: 100/100 (neschimbate; teste rnpmGapReason + rnpmProgressPhase pass cu noua structura switch).

#### Versionare

`2.20.1` -> `2.20.2` (patch — bug fix, fara migrari, fara schimbari de contract HTTP / shape SSE / DDL).

---

## [2.20.1] - 2026-05-08

### UX polish — banner progres RNPM split humanizat

Banner-ul de progres din `RnpmSearch` afisa direct token-ul tehnic emis de backend
(`nested_progress`, `nested_start`, `nested_done`) si index-ul tier-1 era 0-based
(`Split 0/7`). Patch-ul traduce toate fazele in romana, schimba index-ul la 1-based si
afiseaza si sub-progresul tier-2 cand exista.

#### Schimbari

- **Helper nou** `frontend/src/lib/rnpmProgressPhase.ts` cu trei functii pure:
  - `describeSplitPhase(phase)` — traduce cele 9 faze tier-1 (`captcha` -> "captcha",
    `search` -> "cautare", `done` -> "finalizat", `blocked` -> "blocat",
    `skipped` -> "fara rezultate", `error` -> "eroare", `nested_start` ->
    "split secundar — start", `nested_progress` -> "split secundar", `nested_done` ->
    "split secundar — finalizat").
  - `describeNestedPhase(phase)` — traduce cele 6 faze tier-2 (`captcha`, `search`,
    `done`, `blocked`, `skipped`, `error`).
  - `formatSplitProgress(p)` — formateaza tot mesajul: `Split ${p.index + 1}/${p.total} - ${p.label} (${frazaTier1})` plus, daca exista `p.nested`,
    sufix `-> ${nested.index}/${nested.total} ${nested.label} (${frazaTier2})` plus,
    daca exista `p.message`, sufix `: ${message}`.
- **Mesaj initial inainte de primul progres event** schimbat din `Split: 0/${N}...`
  in `Pregatire split ${N} sub-tipuri...` (semantic mai clar — "0 din N done"
  nu inseamna nimic util la pornire).
- `frontend/src/pages/RnpmSearch.tsx` foloseste `formatSplitProgress(p)` in loc de
  template literal inline cu `p.phase` brut.

#### Exemple banner

| Inainte | Dupa |
|---|---|
| `Split 0/7 - aviz initial (nested_progress)` | `Split 1/7 - aviz initial (split secundar) -> 3/14 publicitatea X (cautare)` |
| `Split 6/7 - fara obiect (done)` | `Split 7/7 - fara obiect (finalizat)` |
| `Split 1/7 - aviz initial (error): timeout SOAP` | `Split 2/7 - aviz initial (eroare): timeout SOAP` |

#### Tests

- **Frontend**: 100/100 (era 92, +8 noi in `lib/rnpmProgressPhase.test.ts` —
  fiecare faza tier-1, fiecare faza tier-2, format index 1-based, format nested,
  format mesaj append).
- **Backend**: 823/823 (neschimbate — patch-ul e strict frontend).

#### Versionare

`2.20.0` -> `2.20.1` (patch — UX text-only, fara migrari, fara schimbari de
contract HTTP / shape SSE / DDL).

---

## [2.20.0] - 2026-05-08

### Observability pentru cap-ul RNPM de 1500 rezultate (Task E)

Banner-ul pentru cautari rulate in mod split distinge acum **trei cauze de gap** in loc de o
singura categorie generica `respins (X > limita)`. Fiecare cauza primeste un mesaj explicit in UI
si este logata intr-un audit event `rnpm.cap_hit` pentru analiza retroactiva.

#### Cele trei cauze de gap clasificate (`RnpmGapReason`)

- **`terminal_cap`** — sub-tip / destinatie singura > 1500 inregistrari, RNPM nu mai poate livra
  rezultatele si nu mai exista o axa de split (categorie fara `destinatieInscriere` enumerabil:
  `creante`, `obligatiuni`, `fiducii`, sau destinatie individuala in tier-2 ipoteci/specifice
  > 1500). UI: `blocat de limita RNPM (X > 1500, fara axa de split)`.
- **`silent_refusal`** — RNPM raspunde cu `total > 0` dar `documents: []` (rate-limit upstream sau
  captcha invalid). Detectat in tier-1 si tier-2 inainte de incercarea unui split inutil. UI:
  `blocat de RNPM (raport X dar nicio inregistrare livrata — rate-limit / captcha invalid)`.
- **`residual_unclassified`** — tier-2 a rulat dar a ramas un gap (records istorice fara
  destinatie atribuita pe care RNPM nu le poate filtra dupa `destinatieInscriere`). UI:
  `blocat partial (X raportat, ramas neacoperit dupa tier-2)`.

#### Audit event `rnpm.cap_hit`

[backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts) emite acum `recordAudit("rnpm.cap_hit", ...)`
dupa fiecare `executeSplitSearch` cu `gap > 0` sau sub-tipuri blocate. `detail_json` contine:

- `type` — categoria RNPM cautata
- `criteriu` — string-ul de criteriu agregat
- `upstreamTotal` — suma sub-totalurilor raportate de RNPM
- `recovered` — documente efectiv livrate
- `gap` — diferenta `upstreamTotal - recovered`
- `gapByReason` — suma `subTotal - count` per `gapReason` (terminal_cap / silent_refusal /
  residual_unclassified)
- `blockedLabels` — lista sub-tipurilor blocate cu label, status, gapReason, subTotal, count

Util pentru analiza retroactiva a frecventei celor trei cauze pe productie, fara a deranja userul
cu mesaje diagnostice in UI.

#### Rename intern `rejected` -> `blocked`

Status-ul `RnpmSplitSubResult.status` si `RnpmSplitProgress.phase` au fost redenumite din
`rejected` in `blocked`, mai semantic clar (RNPM nu respinge tehnic — pur si simplu nu mai poate
livra rezultatele). Schimbare contract API SSE.

### Backend

- [backend/src/services/rnpmSearchService.ts](backend/src/services/rnpmSearchService.ts):
  - Tipuri noi: `export type RnpmGapReason = "terminal_cap" | "silent_refusal" | "residual_unclassified"`
  - `SplitSubResult.status`: `"rejected"` -> `"blocked"`; nou camp optional `gapReason?: RnpmGapReason`
  - `NestedSplitSubResult.status`: idem
  - `SplitSearchProgress.phase` + `nested.phase`: `"rejected"` -> `"blocked"`
  - `executeSplitSearch`: 3 puncte de detectie (tier-1 silent reject, tier-1 fail-clean fara
    nested destinations, tier-2 cu gap > 0)
  - `executeNestedDestinationSplit`: 2 puncte de detectie (tier-2 silent reject, tier-2 destinatie
    singura > 1500)
- [backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts): hook nou `recordAudit("rnpm.cap_hit", ...)`
  dupa `splitRun` cand `result.upstreamTotal !== result.total` sau exista sub-tipuri blocked/partial

### Frontend

- [frontend/src/types/rnpm.ts](frontend/src/types/rnpm.ts): tip nou `RnpmGapReason`, rename
  status enum, camp optional `gapReason` pe `RnpmSplitSubResult` si `RnpmNestedSplitSubResult`
- [frontend/src/lib/rnpmGapReason.ts](frontend/src/lib/rnpmGapReason.ts) (nou): pure helper
  `describeBlockedSubResult(s)` care returneaza textul humanizat pentru fiecare cauza
- [frontend/src/pages/RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx): banner-ul foloseste
  helper-ul nou; "respins" inlocuit cu "blocat" peste tot

### Teste

- Backend: 4 split tests in [backend/src/services/rnpmSearchService.split.test.ts](backend/src/services/rnpmSearchService.split.test.ts)
  (era 3) — adaugat scenariu nou pentru `silent_refusal`, plus assertion `gapReason` pe testele
  existente. Backend: 823 / 823 verzi (era 822).
- Frontend: 6 unit tests in [frontend/src/lib/rnpmGapReason.test.ts](frontend/src/lib/rnpmGapReason.test.ts)
  pentru `describeBlockedSubResult` (cele 3 gapReason + fallback + 2 cazuri error). Frontend:
  92 / 92 verzi (era 86).

### Compatibilitate

- API SSE: clientii care parsau `phase: "rejected"` sau `status: "rejected"` din
  `/api/v1/rnpm/search-split` trebuie actualizati la `"blocked"`. Nu exista clienti third-party
  cunoscuti — desktop UI a fost actualizat in aceeasi versiune.
- Audit log: tabel existent (`audit_log`), action noua `rnpm.cap_hit`. Fara migrare schema.

---

## [2.19.2] - 2026-05-07

### Bugfix highlight Cautare dosare — tokenii scurti nu mai mananca prefixe

Cautarea unui nume cu mai multe cuvinte (ex. `COMPANIA DE DEMOLARI INDUSTRIALE SRL`) producea highlight
partial: tokenul scurt `DE` matchuia ca prefix in `DEMOLARI`, lasand `MOLARI` fara fundal galben. Cauza
in [frontend/src/components/dosare-table-highlight.tsx](frontend/src/components/dosare-table-highlight.tsx):
regex-ul `(de|demolari|...)` cu flag `gi` testa alternativele in ordinea declarata si nu avea word
boundaries Unicode-aware (`\b` standard JS exclude `Ă/Î/Ș/Ț`). Engine-ul matchuia `de` la pozitia 11
in `DEMOLĂRI`, consuma 2 caractere, apoi continua de la `MOLĂRI` care nu mai matchuia nimic.

### Frontend (`components/dosare-table-highlight.tsx`, `components/termene-table-detail-row.tsx`)

- **Sortare alternativelor descrescator dupa lungime** inainte de a construi pattern-ul.
  Tokenul lung (`demolari`) castiga matchul peste tokenul scurt (`de`) la inceputul `DEMOLĂRI`.
- **Word boundaries Unicode-aware** prin lookarounds `(?<!\p{L})...(?!\p{L})` cu flag `u`.
  `\p{L}` recunoaste tot setul Unicode Letter (inclusiv `Ă`, `Î`, `Ș`, `Ț`), deci `de` nu mai
  matchuie ca prefix in `DEPOZIT`, `DECIZIE`, `DEMOLĂRI`, etc. — doar cand apare ca cuvant intreg.
- **Termene foloseste acum acelasi `HighlightName`** prin import din `dosare-table-highlight.tsx`
  (in loc de o copie locala). Beneficiu suplimentar: highlight-ul pe Termene devine
  diacritic-insensitive (cautarea `DEMOLARI` evidentiaza acum `DEMOLĂRI` in lista de parti),
  comportament aliniat cu Cautare dosare.

### Validare

- Frontend: 86/86 teste vitest verzi.
- Type-check: `npx tsc --noEmit` clean pe ambele workspace-uri.
- Test empiric reprodus pe `COMPANIA DE DEMOLĂRI INDUSTRIALE SRL` cu cautare `COMPANIA DE DEMOLARI
  INDUSTRIALE SRL` — toate cuvintele highlightate integral.

---

## [2.19.1] - 2026-05-07

### Patch hardening + UX polish post v2.19.0

Trei bug-uri descoperite la rulare empirica imediat dupa v2.19.0, plus o documentare a limitei tehnice
RNPM atinse pe debitori cu volum mare. Zero schimbari functionale in tier-1/tier-2 split engine.

### Frontend (`lib/rnpmApi.ts`)

- **`jsonOrThrow` accepta envelope-ul v2.14.0** `{ data, error: { code, message }, requestId }`. Pana
  acum extragea doar `data.error` ca string, ceea ce pe envelope-ul nou (`error` = obiect) producea
  `Error([object Object])` in UI. Fix: type-narrow pe `error` — string folosit direct, obiect cu
  `.message` extras, fallback `Eroare (${status})`. Modalul "Info baza locala" + alte rute admin RNPM
  arata acum mesajul real (ex. "Insufficient role" cand role-ul lipseste, in loc de `[object Object]`).

### Backend (`index.ts`)

- **Auto-promote `local` la `admin` in desktop mode** la boot, idempotent. Migration 0002 seed-uieste
  user-ul `local` cu `role: "user"` (default sigur pentru web mode multi-tenant). In desktop mode
  insa exista un singur user, iar `requireRole("admin")` din v2.11.0 (pe `DELETE /rnpm/saved/all`,
  `POST /rnpm/compact`, backup management) bloca chiar utilizatorul aplicatiei. Fix: la boot, daca
  `getAuthMode() === "desktop"` si `getUserById("local").role !== "admin"`, apel `updateUserRole`.
  Log: `[boot] desktop mode: promoted local user to admin`.

### Frontend (`components/Sidebar.tsx`)

- **Sectiunea "Administrare" (Utilizatori/Audit/Cote) ascunsa in desktop mode**. Promovarea
  automata la admin (de mai sus) declansa side-effect: sidebar-ul afisa sectiunea admin
  introdusa in v2.6.0 (PR-8), care e relevanta doar pentru deploy-uri web multi-tenant.
  Pe desktop solo, e zgomot vizual fara valoare. Detectie via `window.desktopApi !== undefined`
  (pattern existent in `useApiKey.ts`, `useAlertsStream.ts`, `useTheme.ts`). Rutele `/admin/*`
  raman accesibile prin URL direct dar nu mai sunt promovate in nav.

### Frontend (`pages/RnpmSearch.tsx`)

- **Stop button apare cand auto-loading e declansat din tabelul de paginare**. Pana acum conditia era
  `autoLoading ? red-stop-button : blue-load-button`, care nu acoperea cazul cand butonul "Incarca mai
  multe" din toolbar-ul tabelului declansa o singura batch (`loading=true`, `autoLoading=false`). UI-ul
  ramanea cu butonul albastru imposibil de oprit. Fix: conditia devine `autoLoading || loading`.

### Documentatie

- **`PROBLEM-rnpm-cap-1500.md` (nou la root)**: documentare formala a limitei RNPM. Caz empiric: CUI
  33317138, categorie `specifice`, tier-2 destinatie 5 ramane cu 1744 records peste cap. Lista de
  axe de split incercate (tipInscriere ✅, destinatieInscriere ✅, perioada ❌, activ ❌, nemodificat ❌,
  tipAct ❌, creditorPJ ❌). Captura RNPM oficial confirma: "Pentru a obtine o lista de inscrieri
  care pot fi vizualizate, modificati criteriile de cautare astfel incat sa se obtina mai putin de
  1500 de rezultate. S-au gasit 1825 inscrieri." Concluzie: pe debitori cu >1500 inregistrari intr-o
  singura combinatie tier-1×tier-2, recuperarea integrala via API public RNPM e imposibila. v2.19.0
  best-effort + disclosure UI ramane raspunsul corect arhitectural.
- **`CODEX-BACKLOG.md` Task E**: backlog redeschis cu observability tasks (gap reason enum
  `terminal_cap`/`silent_refusal`/`residual_unclassified`, status enum rename `rejected` -> `blocked`,
  audit event `rnpm.cap_hit`). Refactor generic Splitter registry + probe-then-fetch + tier-3
  creditor split respinse explicit (motivate in task).

### Tests

- 814 backend, 86 frontend (neschimbat fata de v2.19.0).

---

## [2.19.0] - 2026-05-07

### RNPM tier-2 split — recuperare best-effort pe destinatieInscriere cand un sub-tip singur depaseste 1500

Extensie a auto-split-ului v2.18.0. Scenariul empiric: pe `specifice` cu CUI 33317138 (debitor PJ),
`tipInscriere=1 (aviz initial)` SINGUR are 1823 inregistrari, peste capul de 1500 al RNPM. v2.18.0 recupera
doar 3 documente din celelalte sub-tipuri si marca "aviz initial" ca respins. v2.19.0 adauga un al doilea
nivel de split pe `destinatieInscriere` (sub-axa enumerable doar pentru `specifice` si `ipoteci`),
recuperand records pe destinatie individuala. Recuperarea e **best-effort**: inregistrarile fara
destinatie atribuita raman neacoperite, iar gap-ul e disclose-uit explicit in UI.

### Backend (`services/rnpmDestinations.ts` — fisier nou)

- **`DESTINATII_BY_CATEGORY`** mirror al `frontend/src/components/rnpm/rnpm-form-constants.ts`. Numai
  `ipoteci` (10 valori) si `specifice` (14 valori) au lista; `creante`/`obligatiuni`/`fiducii` raman
  fail-clean ca in v2.18.0 (nu au destinatii enumerable in UI-ul oficial).
- **`hasNestedDestinations(type)`** helper boolean.

### Backend (`services/rnpmSearchService.ts`)

- **`executeNestedDestinationSplit`** functie privata noua: itereaza `DESTINATII_BY_CATEGORY[type]`,
  pentru fiecare destinatie ruleaza `executeSearch` cu `tipInscriere` (tier-1 valoare) +
  `destinatieInscriere: { type: "1", value: <label> }`. RNPM stocheaza destinatieInscriere ca **literal
  label string** (NU index 1-based ca tipInscriere), confirmat in `RnpmSearchForm.tsx:147`.
- **`executeSplitSearch` extins**: catch-ul pe `RnpmError.code === "limit_exceeded"` la nivel tier-1
  acum verifica `hasNestedDestinations(type)`. Daca da, declanseaza tier-2 split; daca nu, fail-clean
  cu `status: "rejected"` ca inainte. Gap calculat la runtime: `gap = tier1SubTotal - SUM(tier2 subTotals)`.
- **`SplitSubResult`** extins cu `status: "recovered" | "partial"`, `nested?: NestedSplitSubResult[]`,
  `gap?: number`. `SplitSearchProgress.phase` extins cu `"nested_start" | "nested_progress" | "nested_done"`,
  `nested?: { index, total, label, phase, ... }` per destinatie iterata.

### Backend (`routes/rnpm.ts`)

- **`SSE_SPLIT_TIMEOUT_MS`** bumped 30 -> **45 min**. Worst case: `ipoteci` cu 18 sub-tipuri × 17s +
  1-2 sub-tipuri care declanseaza tier-2 cu 10 destinatii × 17s ≈ 11 min, dar adaugand latente captcha
  + retry, 45 min ofera margin sigur.

### Frontend (`types/rnpm.ts`, `lib/rnpmApi.ts`)

- **`RnpmNestedSplitProgress`**, **`RnpmNestedSplitSubResult`** tipuri noi.
- **`RnpmSplitProgress.phase`** extins (mirror backend); `nested?` field.
- **`RnpmSplitSubResult`** extins cu `nested?`, `gap?`, status `"recovered" | "partial"`.
- SSE consumer `rnpmSplitSearch` neschimbat — extensia e transparent type-extends; eveniment-ul
  ramane `progress` cu shape extins.

### Frontend (`components/rnpm/RnpmSplitDialog.tsx`)

- **Pre-warning best-effort**: pentru `specifice`/`ipoteci`, dialogul afiseaza explicit ca tier-2 split
  pe destinatie va fi rulat cand un sub-tip individual depaseste limita, iar costul/ETA arata interval
  (min - max) in functie de cate sub-tipuri vor declansa tier-2.
- Pentru `creante`/`obligatiuni`/`fiducii` mesajul ramane vechiul fail-clean.

### Frontend (`pages/RnpmSearch.tsx`)

- **Banner cu tier-2 breakdown**: deasupra tabelei, daca exista entries `recovered`/`partial`,
  afiseaza cate destinatii au reusit per sub-tip + gap-ul individual.
- **Gap disclosure**: daca `totalGap > 0`, callout amber explicit: "X inregistrari fara destinatie
  atribuita nu au putut fi recuperate (limitarea API RNPM pentru records istorice fara destinatie)".

### Tests

- **`backend/src/services/rnpmSearchService.split.test.ts`** (nou, 3 teste):
  1. Dispatcher iterates EVERY tier-1 sub-type chiar daca unul din mijloc declanseaza tier-2.
  2. Tier-2 itereaza EVERY destinatie din `DESTINATII_BY_CATEGORY[type]` — guard contra omisiunii.
  3. Categoriile fara destinatii enumerable (creante) raman fail-clean fara apel `destinatieInscriere`.
- 814 backend tests, 86 frontend tests.

---

## [2.18.0] - 2026-05-06

### RNPM auto-split la depasire limita 1500 — confirmare cu cost + fail-clean per sub-tip

Feature nou pentru RNPM: cand o cautare returneaza peste limita oficiala de 1500 inregistrari (cazul empiric:
debitor PJ cu CUI 33317138 -> 1826 rezultate), in loc de eroarea opaca `limita 1500`, frontend-ul afiseaza un
dialog de confirmare cu costul estimat in captcha-uri si ETA, iar la accept ruleaza automat **N cautari
secventiale** (cate una pentru fiecare `tipInscriere` din `TIP_AVIZ_BY_CATEGORY[type]`), agregand documentele
intr-un singur search row. Fail-clean: daca un sub-tip individual depaseste tot 1500, e marcat `respins` si
cautarea continua cu celelalte (zero recursie, zero blocare). Toate inregistrarile colectate pe parcurs sunt
salvate normal in baza locala chiar daca cativa sub-tipi esueaza.

### Backend (`services/rnpmSearchService.ts`)

- **`RnpmError` cu `code: "limit_exceeded"`** pe ramura cand `total > MAX_TOTAL_RESULTS` sau
  `documents.length === 0 && total === 0` cu indicator de cap. `details: { total, limit }` propaga numarul
  exact pentru UI.
- **`executeSplitSearch({ type, baseParams, subTypeLabels, ... })`**: itereaza secvential peste sub-tipuri,
  apeleaza `executeSearch` cu `tipInscriere: { type: "1", value: String(i + 1) }` (1-based, match cu encoding-ul
  din `RnpmSearchForm`). `existingSearchId: parentSearchId` reutilizeaza row-ul de search creat upfront, deci
  history page primeste **un singur entry** in loc de N. `try`/`catch` per sub-tip prinde
  `RnpmError.code === "limit_exceeded"` si marcheaza `status: "rejected"` fara a opri rularea. `finally` block
  apeleaza `updateSearchTotal` cu numarul cumulat de documente, asa ca abort la mijloc lasa state coerent.
- **`SplitSearchProgress`** stream type: `phase: "captcha" | "search" | "done" | "rejected" | "skipped" | "error"`,
  emit dupa fiecare tranzitie a runner-ului per sub-tip.

### Backend (`routes/rnpm.ts`)

- **`POST /api/v1/rnpm/search` returneaza 400 structurat** la `RnpmError.code === "limit_exceeded"`:
  `{ error, code: "limit_exceeded", total, limit, splittable: { type } }`. Frontend-ul detecteaza prin
  `RnpmLimitExceededError` si declanseaza dialogul.
- **`POST /api/v1/rnpm/search-split` SSE endpoint nou**: streamuieste `progress` events per sub-tip si un
  `complete` final cu `RnpmSplitResult`. Validare Zod: `subTypeLabels` array cu max 50 elemente, fiecare
  string `<=200` chars. Dedup `clientRequestId` (409 daca acelasi request e reluat). Tenant guard via `ownerId`.
- **`SSE_SPLIT_TIMEOUT_MS = 1_800_000`** (30 min) constanta separata fata de `SSE_TIMEOUT_MS` (10 min al
  bulk-ului). Worst case: `ipoteci` are 18 sub-tipuri × ~17s + latenta captcha; cap-ul de 10 min al
  bulk-ului ar fi prematur pentru split. (Bumped la 45 min in v2.19.0.)

### Frontend (`lib/rnpmApi.ts`, `types/rnpm.ts`)

- **`RnpmLimitExceededError`** clasa cu `code = "limit_exceeded"`, `total`, `limit`, `splittableType` —
  ridicata din `rnpmSearch` cand `res.status === 400 && body.code === "limit_exceeded"`. UI-ul intercepteaza
  in `runSearch` si seteaza `pendingSplit` pentru dialog.
- **`rnpmSplitSearch(type, baseParams, subTypeLabels, ...)`** consumer SSE care parseaza `event:` /
  `data:` blocks, propaga progress callback per sub-tip si returneaza `RnpmSplitResult` din `complete`.
  Suporta `AbortSignal` extern pentru cancel.
- **Tipuri noi**: `RnpmSplitProgress`, `RnpmSplitSubResult`, `RnpmSplitResult` in `types/rnpm.ts`.

### Frontend (`components/rnpm/RnpmSplitDialog.tsx`, `pages/RnpmSearch.tsx`)

- **`RnpmSplitDialog`** modal de confirmare cu: numar sub-tipuri, cost estimat (`N × $0.003` pentru 2Captcha
  sau `N × $0.0008` pentru CapSolver), ETA (`N × ~17s`), provider activ, explicatie fail-clean. Butoane
  `Anuleaza` / `Continua cu split (N cautari)`. Reuseaza `useDialog` hook (focus trap + Escape).
- **`RnpmSearchPage` integration**: state nou `pendingSplit` + `splitProgress`, banner amber deasupra tabelei
  cand `result.splitMode === true` listand sub-tipurile respinse, toast progress in colt jos-dreapta in timpul
  rularii, butonul "Incarca tot" dezactivat in mod split (deja avem rezultatele agregate complete).

### Operational

- **Empiric**: 1826 rezultate (CUI 33317138 debitor PJ category `ipoteci`) -> 18 sub-tipuri × ~17s captcha =
  ~5 min ETA, ~$0.054 cost cu 2Captcha. Test live confirma agregarea fara depasire (fiecare sub-tip a returnat
  sub 1500 individual).

---

## [2.17.0] - 2026-05-06

### Multi-review hardening peste v2.16.1 — atomicitate audit, fail-loud boot, partial-success monitorizare nume, drift detector

Sesiune de hardening operational care absoarbe 28 findings din `/full-review` rulat dupa v2.16.1, grupate
in 5 prioritati (P1 critical → P5 nice-to-have). Zero schimbari in shape-ul UI; o singura schimbare
observabila in afara codului — eticheta corecta in subiectul email-ului per alerta noua pentru kind-ul
`termen_dupa_solutie` (era randat ca text raw inainte). Toate celelalte fix-uri sunt strict interne — un zid
de aparare in plus pentru deploy-ul web cu multi-user / multi-worker.

### Backend (`db/schema.ts`) — P1.1 + P3.3 + P5.1

- **`hasPendingSchemaMigrations` rescris fail-closed** (P1.1, BLOCKER): catch-ul generic returna `false`
  pre-fix (fail-open), exact scenariul cu cel mai mare risc — un DB corupt sau cu permisii rupte deschis
  fara backup prealabil. Post-fix, orice esec la probe-ul read-only (corupt, permission, lock) returneaza
  `true` pentru a forta backup-ul defensiv. Costul unui backup in plus e neglijabil; costul unui backup
  ratat la un DB corupt e ireversibil.
- **`preMigrationBackup` extins WAL/SHM** (P3.3, HIGH): copia includea pana acum doar `.db`. In WAL mode,
  tranzactii recente pot sta in fisierele `-wal` / `-shm` care raman ne-backupuite. Acum `fs.copyFileSync`
  copiaza si sidecars cand exista — backup-ul e o oglinda completa a starii la momentul rularii.
- **`busy_timeout = 5000` pragma** (P5.1, defense-in-depth): toate conexiunile DB asteapta acum pana la
  5 secunde la SQLITE_BUSY. Pe desktop single-user impactul e teoretic; pentru web multi-worker / multi-tab,
  mark seen / dismiss nu mai pica sub locking aleator de la procesul de backup zilnic.

### Backend (`routes/alerts.ts`) — P1.2

- **Atomicitate audit + mutation pe PATCH alerts** (CRITICAL): cele 3 handlers (`/seen`, `/unseen`,
  `/dismissed`) wrap acum repo call + `recordAudit` intr-o `getDb().transaction(() => { ... })()` atomica.
  Pre-fix, audit log putea ramane incomplet daca a doua scriere esua (disc plin, lock); UI-ul putea arata
  o alerta inchisa fara urma in audit. Better-sqlite3 nested transactions devin SAVEPOINT-uri, deci
  wrap-ul exterior e safe peste tranzactiile interne ale repo-urilor.

### Backend (`services/alerts/alertEventService.ts`) — P1.3

- **Audit `monitoring.alert.emitted` la insert real** (HIGH): `recordAndDispatchAlert` scrie acum
  eveniment audit la fiecare insert real (nu la dedup hit), cu `targetKind: "monitoring_alert"`,
  `targetId: row.id`, detail `{ kind, severity, jobId, runId, dedupKey }`. Pre-fix, generarea unei alerte
  noi nu lasa nicio urma in audit log — pentru deploy web cu multi-user, asta facea reconstructia "cand
  a fost vazuta o schimbare" imposibila fara sa te bazezi doar pe `created_at` din tabel. Audit failure
  logged la stderr fara sa crash-uieze runner-ul (best-effort, nu blocking — runner-ul de monitorizare nu
  trebuie sa esueze pentru un audit failure).

### Backend (`index.ts`) — P1.4 + P1.5

- **`process.on("unhandledRejection")` handler** (P1.4, HIGH): log + exit (sau throw cand
  `IS_ELECTRON_INPROC=true` ca Electron sa restart-uieze procesul). Pre-fix, un reject unhandled din
  scheduler / background promise putea lasa procesul intr-o stare inconsistenta fara sa apara in logs.
- **SMTP partial-config probe la boot** (P1.5, HIGH): daca cateva `SMTP_*` env vars sunt setate dar altele
  lipsesc, log warn cu lista celor lipsa + verificare `SMTP_PORT` in range valid. Pre-fix, configurarea
  partiala duce la `Mailer not configured` silent run-time fail; acum operatorul afla la boot exact ce
  variabile lipsesc / sunt invalide.

### Backend (`services/monitoring/nameSoapRunner.ts`) — P2.1

- **Partial-success multi-institutie** (HIGH): `fetchForTarget` rescris cu colectie `failedInstitutii` —
  bucla peste institutii continua la esec (signal aborts re-thrown), accumula erori, si arunca doar daca
  **toate** institutiile au esuat. Pre-fix, un singur tribunal jos in scope-ul de monitorizare facea sa
  esueze tot job-ul cu SOAP_FAIL desi alte institutii raspundeau corect. Mesajul de eroare la all-fail
  enumera explicit institutiile care au esuat, ca debugging-ul sa nu necesite log scraping.

### Backend (`services/monitoring/diff/dosarSoap.ts`) — P3.4

- **Breadcrumb log la multi-pending bucket** (LOW): `console.warn` cand un bucket `(stadiu, complet)` are
  multiple solutii pending si multiple termene neconsumate (drift in business logic — nu ar trebui sa
  apara in fluxul normal). Pre-fix, picking the first un-consumed era silent.

### Backend (`db/migrations/0016_termen_dupa_solutie_kind.down.sql`) — P2.2

- **Sharpened fail-loud comment** (HIGH docs): comentariul rescris ca multi-line block care explica
  explicit design-ul fail-loud + cele doua optiuni operator (delete sau back-to-pair conversion) cand un
  downgrade fortat e necesar. Pre-fix, comentariul era ambiguu pe ce inseamna "fail loud" — operatorul
  trebuia sa ghiceasca ce strategie sa adopte.

### Backend (`services/email/mailer.ts` + `services/email/dailyReportTemplate.ts`) — P3.2

- **`KIND_LABELS` / `SEVERITY_LABELS` tipizate strict** (HIGH + bug fix): hartile tipizate
  `Record<AlertKind, string>` / `Record<AlertSeverity, string>` (in loc de `Record<string, string>` care
  permitea labels lipsa silent). **Bug real fix:** `mailer.ts` lipsea label-ul `termen_dupa_solutie`
  (introdus in v2.15.0) — pe email-urile per-alerta, subiectul randa textul tehnic raw
  (`termen_dupa_solutie`) in loc de `Termen nou dupa solutie`. Type tightening surfaced via tsc + entry
  adaugata. `dailyReportTemplate.ts` ajustat sa pasaze `AlertSeverity` typed in helpers.

### Frontend (`pages/Alerts.tsx`) — P3.5

- **Toast la `markSeen` failure** (LOW UX): `handleOpen` `markSeen` fire-and-forget capata `setError(...)`
  la esec cu mesaj romanesc humanizat ("Marcarea alertei ca citita a esuat: ..."). Navigarea ramane
  non-blocking (preserva v2.16.0 fire-and-forget design — nu blocheaza user-ul daca network-ul e lent).

### Tests — P3.1 + P4

- **819 teste backend** (de la 811 in v2.16.1, +8):
  - +4 in `db/alertKindDrift.test.ts` (nou) — drift detector backend `ALERT_KINDS` / `ALERT_SEVERITIES` /
    `ALERT_JOB_KINDS` vs frontend `alertsApi.ts` union via regex extraction; daca cineva adauga un kind
    doar pe o parte, testul cade in CI inainte de release. Acopera si `alertKindLabels` keys vs union
    members (label completeness).
  - +2 in `services/alerts/alertEventService.test.ts` — audit row scris la insert real (`inserted=true`)
    si NU la dedup hit (`inserted=false`). Verifica `target_kind`, `target_id`, `detail_json` shape.
  - +2 in `services/monitoring/nameSoapRunner.test.ts` describe "partial-success on multi-institution
    failures" — partial 2/3 success returns ok cu survivors; all-fail returns SOAP_FAIL cu mesaj enumerat.
- **86 teste frontend** neschimbate (drift detector ruleaza pe backend cu fs read pe frontend source —
  light-weight, fara file partajat de tipuri).
- tsc backend + frontend verde, biome verde pentru cod nou (project baseline pentru
  CRLF/template-literal/non-null pre-existing).

### Versionare

- Bump manifest/lockfile la `2.17.0` (minor — schimbarea observabila in afara codului e shape-ul email-ului
  per-alerta pentru `termen_dupa_solutie`; rest strict intern, fara migrari, fara breaking changes pe rute
  existente, fara DDL nou).

---

## [2.16.1] - 2026-05-05

### Multi-review remediation post v2.16.0 — drift Zod, ORDER BY, transaction wrap, pre-migration backup

Patch hardening peste v2.16.0 care absoarbe integral findings-urile `/multi-review` rulat dupa
livrarea v2.16.0 (1 CRITICAL drift validation, 2 BLOCKERs operational, 4 HIGH defense-in-depth).
Zero schimbari in contractul HTTP / shape-ul UI; toate fix-urile sunt strict interne — zid de aparare
in plus, fara feature nou.

### Backend (`db/monitoringAlertsRepository.ts`)

- **Single source of truth pentru kind/severity/jobKind** (CRITICAL): `ALERT_KINDS`, `ALERT_SEVERITIES`,
  `ALERT_JOB_KINDS` exportate ca `as const` tuple-uri din repo. Tipurile `AlertKind`, `AlertSeverity`,
  `AlertJobKind` derivate prin `(typeof X)[number]`. Pre-fix, fiecare schema Zod din `routes/alerts.ts`
  avea propriul `z.enum([...])` inlinit cu lista hardcodata — drift-ul era inevitabil (dovada: in v2.15.0
  trei locuri trebuiau sincronizate manual cand s-a adaugat `termen_dupa_solutie`, una a scapat). Acum
  adaugarea unui nou kind se face **intr-un singur loc** (constanta) si toate locurile se actualizeaza
  automat la compile-time.
- **`selectAlertIdsByFilters` ORDER BY** (HIGH): adaugat `ORDER BY a.created_at DESC, a.id DESC` inainte
  de `LIMIT ?`. Pre-fix, cand cap-ul de 10k era atins, query-ul intorcea un subset arbitrar (functie de
  storage layout SQLite); user-ul `Inchide toate` nu stia ce 10k din 50k sunt afectate. Post-fix, ordinea
  e deterministica si match-uieste `listAlerts` (cele mai recente alerte primele) — contract clar.
- **`markAlertUnseen` wrap in transaction** (HIGH): `db.transaction((): MonitoringAlertRow | null => {...})`
  pentru ca SELECT existence probe + UPDATE + readback sa vada un snapshot consistent. Pre-fix, intre
  SELECT-ul de existenta si UPDATE putea sa se inserteze un dismiss concurent (extrem de improbabil pe
  desktop single-user, dar expune defense-in-depth pentru web mode multi-tab).
- **`dismissAlertsByIds` COUNT optimization** (LOW perf): doua `COUNT(*)` separate (total + already
  dismissed) -> un singur `SELECT COUNT(*) AS total, SUM(CASE WHEN dismissed_at IS NOT NULL THEN 1 ELSE 0 END) AS already`.
  Per-chunk SQLite roundtrip redus la jumate; relevant pentru bulk dismiss la 10k randuri (20 chunk-uri).

### Backend (`db/schema.ts`)

- **Pre-migration backup probe generic** (BLOCKER): inainte de a deschide DB-ul in WAL mode pentru
  `runMigrations`, deschidem read-only un probe ca sa citim `_schema_versions` si comparam cu
  `discoverMigrations(MIGRATIONS_DIR)`. Daca exista vreo migration fisier care nu e in setul stocat,
  apelam `preMigrationBackup(dbPath, "schema-upgrade")`. Pre-fix, doar migration 0008 avea backup explicit
  in handler-ul ei (rebuild CHECK enum); 0016 (analog rebuild) nu il avea, deci o rulare partiala lasa
  DB intr-o stare in care un rollback manual cere `.bak` care lipseste. Post-fix, **orice** migration
  rebuild face backup automat. Probe-ul e defensiv: pe orice eroare returneaza `false` (boot continua),
  ca un fisier corupt sa nu blocheze pornirea aplicatiei.
- **Legacy DB pre-migration backup completeness** (review post-commit): prima iteratie a probe-ului
  returna `false` cand `_schema_versions` lipsea (DB-uri legacy v2.0.10 si anterior), pe motiv ca
  backfill-ul sentinel pentru baseline nu modifica schema utilizator. **Insa** la primul boot post-upgrade,
  exact migrarile 0002..0N se aplica pe schema; deci scenariul cu cel mai mare risc (rebuild de la zero
  pentru o cabina veche) sarea peste backup. Fix: cand `_schema_versions` lipseste si exista fisiere
  de migration cu `version > 1`, returnam `true` (backup ruleaza). Backfill-ul de baseline (`v=1`)
  singur tot nu trigger-uieste backup-ul, ca pe DB-urile noi (post-PR-0) sa nu existe overhead inutil.

### Backend (`routes/alerts.ts`)

- **Schemele Zod refactorate** (CRITICAL): `AlertExportFiltersSchema`, `AlertListQuerySchema`,
  `AlertDismissBulkFiltersSchema` folosesc acum `z.enum(ALERT_KINDS)`, `z.enum(ALERT_SEVERITIES)`,
  `z.enum(ALERT_JOB_KINDS)` importate din repo. Eliminate trei liste hardcodate care duplicau aceeasi
  enumerare — drift-ul (cum a fost in v2.15.0 cu `termen_dupa_solutie`) devine imposibil structural.

### Tests

- **+2 backend regression** in `routes/alerts.test.ts`:
  1. `GET /api/v1/alerts` — `accepts kind=termen_dupa_solutie filter (v2.15.0 composite)`;
  2. `POST /api/v1/alerts/dismiss-bulk` — `accepts kind=termen_dupa_solutie in filters mode (v2.15.0 composite)`.
  Ambele insereaza o alerta `termen_dupa_solutie` si verifica ca filtrul Zod o accepta + matcheaza
  contul corect. Daca cineva sterge intamplator un kind din `ALERT_KINDS`, testul cade in CI.
- **811 teste backend** (de la 809 in v2.16.0). 86/86 frontend neschimbate.

### Migrations

- Niciuna. Patch-ul e strict cod aplicativ + reorganizare interna (constante exportate, transaction wrap,
  ORDER BY, COUNT optimization, pre-migration backup hook). Schema DB neschimbata.

---

## [2.16.0] - 2026-05-05

### UX polish post v2.15.0 — eticheta KPI, citita togglable, data umanizata, solutie reapare in alerta amanare

Patru ajustari in continuare a sweep-ului v2.15.0, declansate de feedback live in ferestra Electron:
1. eticheta KPI Monitorizare ramasese "Joburi active" desi pe Dashboard se chema deja "Monitorizari active";
2. butonul Citit nu putea fi anulat (o data marcata, alerta ramanea citita pentru totdeauna);
3. titlul `Termen nou dupa solutie` afisa data RAW PortalJust (`2026-05-04T00:00:00 -> 2026-05-19`);
4. dupa merge-ul amanarii, textul solutiei nu mai era vizibil in detail-ul alertei (era prezent doar in cea
   veche `solutie_aparuta` care acum nu se mai emite separat).

### Frontend (`pages/Monitorizare.tsx`, `pages/Alerts.tsx`, `lib/alertsApi.ts`, `lib/alert-context.tsx`)

- **Eticheta KPI Monitorizare**: `Joburi active` -> `Monitorizari active` in `Monitorizare.tsx:288` ca sa
  match-uiasca KPI-ul din `KpiStrip.tsx` (single label across the app).
- **Butonul Dosare marcheaza alerta ca citita**: `handleOpen` in `Alerts.tsx` cheama
  `alertsApi.markSeen(alert.id)` fire-and-forget cand alerta e necitita inainte de
  `onOpenDosar(numarDosar)` + `navigate("/dosare")`. SSE re-fetch la return updateaza UI-ul; nu mai
  asteptam round-trip-ul. Dosare se considera implicit acknowledgement.
- **Toggle Citit/Necitit**: butonul afiseaza `Citit` (Eye icon) cand alerta e necitita si `Necitit`
  (EyeOff icon) cand e citita. La click cheama `markSeen` sau `markUnseen` corespunzator. Tooltip-ul
  schimba in functie de starea curenta. Disabled doar pe `busyId === alert.id` (nu mai e disabled
  pe `alert.read_at`).
- **Lib API**: `alertsApi.markUnseen(id)` (PATCH `/api/v1/alerts/:id/unseen`).
- **Detail rendering pentru `termen_dupa_solutie`**: branch dedicat in `buildAlertContext` care
  randeaza explicit "Solutie pe <data> · <ora>" + "Termen nou <data> · <ora>" + "Complet" + "Solutie"
  (textul deciziei) in loc de pattern-ul generic `De la / La` (care suprapune semantici de
  reschedule pe semantici de amanare). Hotararea (numar_document / data_pronuntare / solutie_sumar)
  se extrage acum si din `from.*` (nu doar top-level), ca sa apara callout-ul cu sumar pe alertele
  compuse.

### Backend (`services/monitoring/diff/dosarSoap.ts`, `db/monitoringAlertsRepository.ts`, `routes/alerts.ts`)

- **Helper `formatTitleDate(raw)`** in `dosarSoap.ts` — strip-uie sufixul `T00:00:00` (sedintele de
  solutie sunt serializate de PortalJust ca ISO datetime, dar ora reala e in `ora`) si converteste
  `yyyy-mm-dd -> dd.mm.yyyy`. Aplicat in titlul `termen_dupa_solutie` care devine
  `Termen nou dupa solutie: 04.05.2026 -> 19.05.2026` (clean) in loc de `... 2026-05-04T00:00:00 -> 2026-05-19`.
  Fall-back la raw daca prefix-ul nu matchuieste pattern-ul ISO (forward-compatible).
- **`markAlertUnseen(ownerId, id)`** in repo — clear `read_at = NULL` cu owner check + idempotent
  pe alertele deja necitite. `is_new` ramane 0 (SSE broadcast-ul s-a intamplat la insert; flipping
  is_new=1 ar re-trigger eronat notificarea "alerta noua"). `dismissed_at` ramane intact.
- **`PATCH /api/v1/alerts/:id/unseen`** — endpoint nou cu acelasi pattern ca `/seen` (body limit 4 KiB,
  audit `alert_unseen`, 404 cross-owner, 200 cu envelope `MonitoringAlertRow`).

### Tests

- **+3 backend** in `routes/alerts.test.ts` describe `PATCH /api/v1/alerts/:id/seen and /dismissed` —
  toggle round-trip seen->unseen, idempotent unseen pe alerta deja necitita, 404 cross-owner.
- **Test ajustat** in `services/monitoring/diff/dosarSoap.test.ts` "termen_dupa_solutie (postponement
  merge)" — titlul contine acum `04.05.2026` / `19.05.2026` (in loc de `2026-05-04` / `2026-05-19`).
- **809 teste backend** (de la 806 in v2.15.0). 86 frontend neschimbate (changes sunt strict
  type+label sau toggle UI, fara test coverage nou).

### Migrations

- Niciuna. Toate schimbarile sunt cod aplicativ — `markAlertUnseen` foloseste schema existenta
  (`read_at` deja nullable in v2.0.x).

---

## [2.15.0] - 2026-05-05

### Fix duplicare alerte cand un dosar primeste solutie + termen nou (amanare)

Sweep peste v2.14.1 care rezolva Issue #4 din raportul utilizatorului: cand PortalJust publica o
solutie SI programeaza un termen nou pentru acelasi complet (cazul tipic de **amanare**), inboxul
emitea **doua** alerte separate (`solutie_aparuta` + `termen_new`) care confundau cititorul ("este
acelasi dosar in care s-a primit un nou termen si o solutie, fiind doua devine destul de
confuza treaba"). v2.15.0 introduce un kind compus nou `termen_dupa_solutie` care contopeste cele
doua evenimente intr-o singura alerta cu detail combinat (from = solutia, to = noul termen).

### Backend — diff engine (`services/monitoring/diff/dosarSoap.ts`)

- **`DiffAlertKind` union** adauga `"termen_dupa_solutie"`. Tipul e propagat in
  `db/monitoringAlertsRepository.ts` (`AlertKind`), `frontend/src/lib/alertsApi.ts` si
  `services/email/dailyReportTemplate.ts` (`KIND_LABELS`).
- **Pass 1 (`solutie_aparuta` detection) refactorizat**: in loc sa emita imediat alerta, depune
  fiecare candidat in `pendingSolutiiByBucket: Map<string, PendingSolutie[]>` cheiat pe
  `(normalizeStadiu(stadiuProcesual), complet.trim())`. Ordinea originala e tracked separat in
  `pendingSolutiiOrdered` ca Pass 3 sa pastreze sortarea sedintelor.
- **Pass 2 (termen pairing) extins** cu trei prioritati: (a) `termen_changed` cand exact o sedinta
  prev "missing" matchuieste pe (stadiu, complet) — pure reschedule; (b) `termen_dupa_solutie` cand
  exista o solutie pending in acelasi bucket — consuma pending-ul si emite alerta compusa cu
  severitate `info` si detail `{ from: { ...solutia + sumar + numar_document + data_pronuntare }, to: { data, ora, complet } }`;
  (c) altfel `termen_new` standalone.
- **Pass 3 (nou)**: emite solutiile pending neconsumate ca `solutie_aparuta` standalone, in ordinea
  sedintelor (`pendingSolutiiOrdered`). Ordinea finala in `alerts[]` e: solutii standalone primele,
  termene/merges ultimele — preserva ordinea testelor existente pe `solutie_aparuta`.
- **Dedup key determinism**: `termen_dupa_solutie|<sub_of_solutie>|<key_of_new_termen>` —
  re-tick-uri pe acelasi snapshot post-merge produc 0 alerte noi (idempotent), iar selectia nu
  depinde de timing-ul rularii.

### Backend — schema

- **Migration `0016_termen_dupa_solutie_kind`** (up + down): rebuild `monitoring_alerts` cu
  CHECK enum extins (mirror al pattern-ului din 0008). `INSERT SELECT` preserva toate randurile
  existente; index-urile `idx_alerts_owner_unread` si `idx_alerts_run` sunt re-create.

### Frontend

- **`frontend/src/lib/alertsApi.ts`**: `AlertKind` capata `"termen_dupa_solutie"` + label
  `"Termen nou dupa solutie"` in `alertKindLabels`. Kind-ul **NU** apare in `HIDDEN_KIND_FILTERS`,
  deci e vizibil in dropdown-ul de filtre + filtrabil + apare in inbox.
- **Email digest** (`backend/src/services/email/dailyReportTemplate.ts`): `KIND_LABELS.termen_dupa_solutie = "Termen nou dupa solutie"`
  ca raportul zilnic sa randeze label-ul curat.

### Tests

- **806 teste backend** (de la 799 in v2.14.1: +7 in `services/monitoring/diff/dosarSoap.test.ts`
  describe "termen_dupa_solutie (postponement merge)" — basic merge, dedup determinism,
  complet-different-no-merge, notify_on_new_termen=false fallback, notify_on_solution=false
  fallback, termen_changed wins peste merge cand prev sedinta exista, idempotent re-tick).
- **86 teste frontend** neschimbate (frontend changes sunt strict type + label additions).
- `tsc --noEmit` backend + frontend verde, biome verde pentru cod nou (project baseline pentru
  CRLF/template-literal/non-null pre-existing; nu introduc erori noi).

### Versionare

- bump manifest/lockfile la `2.15.0` (minor — schimba contractul observabil cu un kind nou de alerta
  in API + email digest, plus migration noua in DB).

---

## [2.14.1] - 2026-05-05

### Fix timeout SOAP PortalJust pentru joburi cu rezultate mari (BCR root cause)

Patch peste v2.14.0 care creste hard cap-ul intern al timeout-ului SOAP de la 45s la 60s, ca
raspuns direct la pattern-ul empiric observat pe job 1215 in productie (BANCA COMERCIALA ROMANA SA,
~1000 dosare in PortalJust).

### Backend

- **`backend/src/soap.ts`**: `SOAP_TIMEOUT_MS` bumpat **45000 → 60000** (constanta interna folosita
  de `combineSignals(external)` care compune `AbortSignal.any([external, AbortSignal.timeout(...)])`).
  Comentariile inline din `soap.ts` si `routes/dosare.ts` actualizate sa reflecte noua valoare.
- **Evidenta empirica** care a justificat schimbarea (extrasa via `scripts/diag-bcr.cjs` din DB-ul
  productie la `%APPDATA%/legal-dashboard/legal-dashboard.db`):
  - Job 1215 BCR `name_soap`: ~50% rata de esec; **toate** esecurile cu `error_code: SOAP_FAIL` si
    `error_message: "operation was aborted due to timeout"` la **fix 45000ms duration**, in timp ce
    rularile reusite au aterizat la 40-44s — fix la prag, fara margine.
  - Snapshot ultimele 10 runs: 2575/40s ok, 1956/44s ok, 1955/45s err, 1948/45s err, 1933/45s err,
    1303/13s ok, 1285/45s err, etc.
  - Concluzie: PortalJust serializeaza payload-uri mari (sute de `Dosar` elements per `numeParte`)
    aproape de pragul de 45s; nu e PortalJust jos, e un quirk al volumului.
- **De ce 60s si nu mai mult**: 33% margine peste cele mai lente raspunsuri stabile reusite,
  fara sa inflame budget-ul scheduler-ului (`DEFAULT_BUDGET_MS = 600_000` ramane neschimbat,
  deci la 6 cereri/run cap-ul total per job ramane >> per-call timeout).

### Tests

- **799 teste backend** + **86 teste frontend** neschimbate (no behavioral test depinde de valoarea
  exacta a `SOAP_TIMEOUT_MS`; testele de runner si de error-mapping folosesc fake clock + mock
  fetch reject).

### Versionare

- bump manifest/lockfile la `2.14.1` (patch — schimba doar o constanta numerica fara migrari /
  schema / contract break / API observabil).

---

## [2.14.0] - 2026-05-05

### Bulk dismiss alerte + fix envelope rate-limit (root cause "Eroare necunoscuta")

Sweep peste v2.13.1 care livreaza Task D din backlog (bulk dismiss pe pagina Alerte) si rezolva
in acelasi commit fix-ul de root cause pentru toast-ul "Eroare necunoscuta" care aparea cand
user-ul apasa rapid butonul Inchide pe alerte (rate-limit envelope malformed).

### Backend — fix envelope rate-limit (root cause Issue #1)

- **`backend/src/middleware/rate-limit.ts`**: ramurile 503 (origine indisponibila) si 429 (rate limit
  depasit) emiteau pana la v2.13.1 un body de forma `{ error: "<string>" }`, care **NU** matchuieste
  envelope-ul standard `{ data, error: { code, message }, requestId }` pe care frontend-ul il
  asteapta. `unwrapAlerts` (`frontend/src/lib/alertsApi.ts:67`) face fallback la
  `err?.message ?? "Eroare necunoscuta"` cand `body.error` nu are field `message`, deci la fiecare
  HTTP 429 user-ul vedea generic "Eroare necunoscuta" in loc de mesaj util.
- Fix: ambele ramuri (cu `preAuthRateLimit` la fel) emit acum `{ data: null, error: { code, message },
  requestId }` cu `code: "origin_unavailable"` (503) / `code: "rate_limited"` (429) si mesaj
  romanesc clar ("Origine indisponibila." / "Prea multe cereri. Incercati din nou in cateva
  momente.").
- **Test regresiune** in `rate-limit.test.ts` — 2 noi (503 envelope shape + 429 envelope shape)
  asigura ca fix-ul nu regreseaza intr-o iteratie viitoare.

### Backend — bulk dismiss

- **Migration**: niciuna (foloseste schema existenta `monitoring_alerts.dismissed_at`).
- **`backend/src/db/monitoringAlertsRepository.ts`**: doua helper-e noi —
  - `dismissAlertsByIds(ownerId, ids[])` — UPDATE `dismissed_at = COALESCE(dismissed_at, ?)`
    intr-o tranzactie, chunked la 500 ID-uri (sub limita SQLite de 999 bind variables); intoarce
    `{ dismissedCount, alreadyDismissedCount, totalMatched }` cu separare clara intre randuri
    nou-inchise si randuri deja inchise (idempotent).
  - `selectAlertIdsByFilters(opts, limit)` — reuseaza WHERE-ul lui `listAlerts` cu exclusion
    explicit pentru `dismissed_at IS NOT NULL`, suporta jobKind/q/kind/severity/onlyUnread/from/to
    (NU `includeDismissed` — ramane intentionat exclus pentru ca un dismiss bulk peste alerte deja
    inchise nu are efect util si ar deruta user-ul).
- **`backend/src/routes/alerts.ts`**: ruta noua `POST /api/v1/alerts/dismiss-bulk` cu Zod
  `discriminatedUnion("mode", [ids|filters])` (mirror al `/export`):
  - `mode: "ids"` — selectie explicita din UI; cap 10k randuri (413 cu `details.maxRows: 10000`).
  - `mode: "filters"` — filtrele active din UI (jobKind/q/kind/severity/onlyUnread/from/to);
    probe count via `listAlerts({ pageSize: 1 })` inainte sa execute, intoarce 413 daca
    `total > 10000` cu `details.totalMatched: <total>`.
  - Body limit `256 KB` (suficient pentru 10k integer ID-uri serializati).
  - Audit `alerts.dismiss_bulk` cu `mode + dismissed + alreadyDismissed + totalMatched`.

### Frontend — bulk dismiss UI

- **`frontend/src/lib/alertsApi.ts`**: metoda noua `dismissBulk(payload)` + tipuri
  `AlertDismissBulkRequest` (discriminated union mirror al backend-ului) si
  `AlertDismissBulkResult`.
- **`frontend/src/pages/Alerts.tsx`**: doua butoane noi in toolbar (variant destructive):
  - **"Inchide selectia"** — apare cand `selectedIds.size > 0`; trimite `mode: "ids"` cu ID-urile
    selectate.
  - **"Inchide toate"** — apare cand nu e nimic selectat; trimite `mode: "filters"` cu filtrele
    active (jobKind/q/kind/severity/onlyUnread/from/to). Disabled cand `includeDismissed=true`
    (operatie care nu ar avea efect) sau cand `total === 0`.
  - Confirmation modal inline (role="dialog", aria-modal, click-outside dismiss) cu busy state
    si spinner. Mesaj romanesc explicit ("Vor fi inchise X alerte. Operatia este idempotenta...").

### Tests

- **799 teste backend** (de la 789 in v2.13.1: +9 in `routes/alerts.test.ts` "POST /dismiss-bulk"
  + 1 in `middleware/rate-limit.test.ts` 429 envelope shape regression — testul existent 503 a
  fost rescris pe noul envelope, nu adaugat).
- **86 teste frontend** (de la 83 in v2.13.1: +3 in `lib/alertsApi.test.ts` "dismissBulk").
- tsc backend + frontend verde, biome verde pentru testele noi (project baseline pentru
  CRLF/import-protocol/non-null/a11y modal pre-existing).

### Versionare

Bump manifest/lockfile la `2.14.0` (minor — schimba contractul HTTP cu ruta noua `/dismiss-bulk`
si schimba shape-ul body-ului 503/429 in middleware-ul de rate-limit, dar fara breaking changes
pe rute existente).

---

## [2.13.1] - 2026-05-05

### UX polish post-export — kind-uri ascunse, link-uri PDF, Monitorizare export all-pages

Patch peste v2.13.0 care strange capetele libere semnalate dupa lansarea export-ului de alerte.
Patru sub-changes cu boundary clar, fara migrari, fara schimbari de contract.

### Frontend — Alerts kind dropdown (4 kind-uri ascunse)

- **`frontend/src/pages/Alerts.tsx`**: introduce `HIDDEN_KIND_FILTERS: ReadonlySet<AlertKind>` care exclude
  din dropdown patru tipuri inerte in starea curenta a UI-ului:
  - `dosar_relevant_now` si `dosar_no_longer_relevant` — cer `alert_config.stadii` sau `.categorii`
    setate per job, dar formularul de Monitorizare nu le expune, deci `dosarPassesFilter` ramane mereu
    true si tranzitia nu se declanseaza niciodata.
  - `aviz_changed` — rezervat pentru runner-ul `aviz_rnpm` neimplementat.
  - `dosar_disappeared` — gated de `notify_on_dosar_disappeared` cu default `false` si fara toggle in UI.
- `alertKindLabels` ramane neschimbat, ca eventualele alerte istorice cu aceste kind-uri sa-si pastreze
  label-ul in badge.

### Frontend — PortalJust /aN suffix strip

- **`frontend/src/components/dosare-table-helpers.ts`**: `getPortalJustUrl(numar)` strip `/a`, `/a1`,
  `/a2`... cu `replace(/\/a\d*$/i, "")` inainte de `encodeURIComponent`. SharePoint indexer-ul
  PortalJust nu retine sufixele de dosar asociat; cautarea pe parintele (`1234/5/2025`) returneaza
  pagina care contine link-uri spre toate asociatii lui.

### Frontend — PDF hyperlinks Dosare/Termene/Monitorizare

- **`frontend/src/lib/export.ts`**: `buildDosarePdf`, `buildTermenePdf`, `buildMonitoringPdf` adauga
  link clickabil pe coloana "Numar Dosar" / "Tinta" folosind acelasi pattern din `lib/export-alerts.ts`:
  - Side-band `Map<rowIndex, string>` (autotable nu are acces la valoarea originala in `didDrawCell`,
    doar la textul rendat).
  - `columnStyles[1].textColor = [29, 78, 216]` ca user-ul sa vada vizual ca celula e clickabila.
  - `didDrawCell` apeleaza `doc.link(cell.x, cell.y, cell.width, cell.height, { url })` doar pe
    `section === "body"` AND `column.index === 1`.
- La Monitorizare, link-ul se aplica doar pentru `dosar_soap` si `name_soap` (`aviz_rnpm` necesita
  alta sursa) si guard-uieste cazul `target === j.target_json` care indica ca `formatMonitoringTarget`
  a esuat sa parseze JSON-ul.

### Frontend — Monitorizare export all-pages

- **`frontend/src/pages/Monitorizare.tsx`**: `handleExport` distinge intre selectie si non-selectie:
  - Selectie (`selectedIds.size > 0`) — filter local pe `jobs` (selectia e mereu pe pagina curenta).
  - Non-selectie — `fetchAllJobsForExport()` care pagineaza prin `monitoring.list({page, pageSize: 100, kind, q})`
    pana la `collected.length >= result.total` sau `result.rows.length === 0`; hard guard `pageNum > 1000`
    impotriva loop-ului pe total nestabil intre cereri.
  - Filtrele active (`kindFilter` + `debouncedQuery`) propagate la fetch ca exportul sa respecte ce vede
    utilizatorul, nu intregul DB.
- Tooltip-urile Excel/PDF se schimba din "vizibile" in "toate cele ${total} joburi (toate paginile)".

### Build & Tests

- `tsc --noEmit -p backend/tsconfig.json` — verde.
- `cd frontend && npx tsc --noEmit` — verde.
- `npx biome check` — verde (project baseline pentru CRLF/import-protocol/non-null pre-existing).
- **789 teste backend** + **81 teste frontend** neschimbate (UX-only patch fara teste noi).

### Versionare

- Bump manifest/lockfile la `2.13.1` (patch — UX-only, fara migrari/schema/contract break).

---

## [2.13.0] - 2026-05-05

### Export alerte (Excel/PDF cu link portal.just.ro) + raport zilnic email

Sweep peste v2.12.1 care livreaza cele doua capabilitati cerute de utilizator pe pagina Alerte: export Excel/PDF cu link direct catre dosarele identificate (selectie / filtre curente / interval), si raport zilnic pe email cu toate alertele din ziua precedenta. Migration nou (`0015_daily_report_settings`) adauga 2 coloane in `owner_email_settings`, fara modificari pe contractele rutelor existente.

### Backend — POST /api/v1/alerts/export (3 moduri, cap 10k)

- **`backend/src/routes/alerts.ts`**: nou endpoint `POST /export` cu Zod `discriminatedUnion("mode", [...])`:
  - `mode: "ids"` — `ids: number[]` (cap 10k); foloseste `listAlertsByIds(ownerId, ids)` care filtreaza pe `id IN (...) AND owner_id = ?`, deci selectia cross-owner returneaza doar randurile owner-ului curent.
  - `mode: "filters"` — `filters: AlertListQuery` (acelasi shape ca `GET /api/v1/alerts`); reuses `listAlerts` cu `pageSize: 10000, page: 1`.
  - `mode: "range"` — `from + to: ISO string`; ANDed cu `owner_id`, mapat la `listAlerts({from, to, includeDismissed})`.
- **Cap 10k**: returneaza `413 Payload Too Large` cu `details.total` cand depaseste, ca utilizatorul sa vada cate randuri ar fi incluse si sa restraga filtrul.
- **`backend/src/db/monitoringAlertsRepository.ts`**: nou `listAlertsByIds(ownerId, ids: number[]): MonitoringAlertRow[]` cu chunk-uire la 999 (limita SQLite host-parameters); join optional pe `monitoring_jobs` ca raspunsul sa includa `job_target_json` necesar pentru `deriveAlertDigestRow` fallback chain.
- **`backend/src/services/email/dailyReportTemplate.ts`**: helper `deriveAlertDigestRow(alert: MonitoringAlertRow): {alert, numarDosar, dosarLink, kindLabel, severityLabel, nameMonitored}` reutilizat intre route export si template raport zilnic; fallback chain `detail_json → job_target_json → null` pentru `numar_dosar` + `name_normalized`; `getPortalJustUrl(numarDosar)` foloseste `encodeURIComponent` ca slash-ul si diacriticele sa fie encoded corect in querystring.
- **Audit**: `alerts.export` cu `mode + count` in `detail_json`; `outcome: ok` cand `count > 0`, `not_found` cand selectia returneaza 0 randuri.

### Backend — Raport zilnic email (scheduler + template)

- **Migration `0015_daily_report_settings.up.sql`** — adauga in `owner_email_settings`:
  - `daily_report_enabled INTEGER NOT NULL DEFAULT 0` (independent de `enabled`, ca utilizatorul sa primeasca per-alert imediat dar NU raport zilnic, sau invers).
  - `last_daily_report_sent_for TEXT NULL` — formatul `YYYY-MM-DD` in zona locala; populat doar dupa `send.ok === true` (sau `rowCount === 0` care marcheaza ziua ca acoperita ca sa nu retry-uim acelasi gol).
- **`backend/src/services/email/dailyReportTemplate.ts`** — `renderDailyReport({reportDateLocal, alerts}): {subject, html, text, rowCount}`:
  - Subiect: `[Legal Dashboard] Raport zilnic dd.mm.yyyy — N alerta` (singular pentru `N === 1`) / `N alerte`.
  - Grupare in HTML pe severitate (`critical → warning → info`); fiecare grup afiseaza titlul, dosar (cu hyperlink portal.just.ro pe `<a href="...">numar_dosar</a>`), kind label RO, timestamp; em-dash placeholder cand `numarDosar === null`.
  - HTML escaping defense-in-depth pe `title` ca `<script>` sa nu fie interpretat (template injection prevention).
  - Hint footer: "Modifica preferinte: Setari → Notificari email" (atat in HTML cat si text).
- **`backend/src/services/email/dailyReportScheduler.ts`** — `runDailyReportTick(deps?: SchedulerDeps): Promise<TickResult>`:
  - Opts injected for testing: `now`, `formatLocalDate`, `reportHour` (default `process.env.DAILY_REPORT_HOUR || 9`), `mailerConfigured` (default `isMailerConfigured()`), `send` (default `sendComposedEmail`).
  - **Fire window**: doar la ora locala configurata (default `09:00`); SKIP daca `mailerConfigured === false` (web deploy fara SMTP variabile = boot graceful).
  - **Owner selection**: `daily_report_enabled = 1 AND enabled = 1 AND to_address IS NOT NULL AND last_daily_report_sent_for != today_local`.
  - **Yesterday window**: `[yesterday 00:00:00 local, today 00:00:00 local)` convertit la UTC pentru filtru SQL `created_at >= ? AND created_at < ?`.
  - **Best-effort retry**: `last_daily_report_sent_for` se updateaza DOAR pe `ok` sau `rowCount === 0`; `send` exception → audit `email.daily_report.failed` cu `reason: "exception"` + `message`, NU updateaza flag-ul, deci urmatoarea zi reincearca cu fereastra noua.
  - **Audit**: `email.daily_report.sent` (outcome ok) cu `subject + rowCount` / `email.daily_report.failed` (outcome error) cu `reason + (message?)`.
- **`backend/src/services/email/mailer.ts`** — `sendComposedEmail({to, subject, html, text}): Promise<{ok: true} | {ok: false, reason}>` reutilizat de scheduler; partajeaza cache-ul de transporter SMTP cu dispatcher-ul de alerte per-event.
- **`backend/src/index.ts`** — bootstrap-ul porneste `setInterval` care apeleaza `runDailyReportTick()` la fiecare 5 minute; graceful shutdown drain-uieste tick-ul curent.

### Frontend — Modal export + buton "Exporta" + lib export-alerts

- **`frontend/src/components/AlertsExportModal.tsx`** — modal cu radio Excel/PDF + radio "Selectie / Filtre curente / Interval"; pe "Interval" expune `<input type="date">` pentru `from`/`to`; preview count-ul (cu warning rosu pe `count > 10000`); butonul "Confirma" disabled cand range invalid sau count > cap.
- **`frontend/src/lib/export-alerts.ts`** — `buildAlertsXlsx({rows}): Promise<{buffer: ArrayBuffer, mime, filename}>` + `buildAlertsPdf({rows}): Promise<{...}>`:
  - Excel: foloseste `xlsx-js-style` cu hyperlink `{l: {Target: dosarLink}}` pe celula `numarDosar` (Excel afiseaza link-ul live, click → portal.just.ro); coloane: data, severitate, kind, dosar, nume monitorizat, titlu, status (citit/necitit/respins).
  - PDF: foloseste `pdfmake`; fiecare rand are coloana `Dosar` rendered ca link cu `link: dosarLink` (PDF readers respecta hyperlink-ul).
  - Filename pattern: `alerte_{count}_{dd-mm-yyyy}.xlsx` / `.pdf` — incarca data din clock-ul local.
- **`frontend/src/lib/alertsApi.ts`** — nou `exportAlerts(payload: ExportPayload): Promise<{rows: AlertExportRow[], count, total}>` care POST-eaza la `/export` cu envelope unwrap; `dailyReportEnabled` field adaugat in `MeEmailSettings` types.
- **`frontend/src/pages/Alerts.tsx`** — checkbox de selectie per rand + "Selecteaza toate (pagina curenta)" master checkbox; buton "Exporta" cu dropdown Excel/PDF; lansand modalul cu `selectedIds` pre-completat in mode "ids".

### Frontend — toggle email "Trimite raport zilnic la 09:00"

- **`frontend/src/components/EmailSettingsPanel.tsx`** — checkbox nou "Trimite raport zilnic la 09:00 (web only)" controlat de field `dailyReportEnabled` din `me.ts` GET/PUT `/email-settings`; helper `hasUnsavedChanges` extins ca flipping flag-ul cu address valida sa fie saveable; tooltip explica ca pe desktop SMTP nu e configurabil deci raportul ramane OFF (configurabil din web).

### Tests

- **789 teste backend** (de la 751 in v2.12.1):
  - 17 noi in `services/email/dailyReportTemplate.test.ts` — `getPortalJustUrl` (slashes + diacritice), `deriveAlertDigestRow` (detail JSON, target_json fallback, null path, invalid JSON recovery, name_normalized extraction, severity+kind labels, fallback to raw kind), `renderDailyReport` (zero rows + Romanian subject, singular noun, HTML escape vs template injection, severity grouping order, dosar hyperlink, em-dash placeholder, rowCount, unsubscribe hint).
  - 12 noi in `services/email/dailyReportScheduler.test.ts` — fire window (3: out of hour, in hour zero candidates, SMTP not configured), owner selection (4: daily flag dedup, last_daily_report_sent_for, enabled=false, null toAddress), zero-alert path, send outcomes (3: ok marks day, failure does NOT mark day, exception isolation), yesterday-window correctness.
  - 7 noi in `routes/alerts.test.ts` "POST /api/v1/alerts/export" — invalid mode 400, ids decorate + dosar info, ids owner isolation, filters ANDed cu owner scope, range with includeDismissed, range without bounds 400, ids empty array 400.
  - 2 noi in `routes/me.test.ts` — daily flag GET surface + PUT update.
- **81 teste frontend** (de la 73):
  - 3 noi in `lib/alertsApi.test.ts` "exportAlerts" — ids/filters/range payload encoding via POST.
  - 3 noi in `lib/export-alerts.test.ts` — XLSX mime + buffer, filename `alerte_N_dd-mm-yyyy.xlsx`, zero-row workbook.
  - 2 noi in `components/EmailSettingsPanel.test.ts` — daily flag requires address, flipping daily flag is saveable.
- tsc backend + frontend verde, biome verde pentru testele noi (project baseline pentru CRLF/import-protocol/non-null pre-existing in fisierele extinse).

### Versionare

- Bump manifest/lockfile la `2.13.0` (minor — schimba contractul HTTP cu rute noi `/api/v1/alerts/export` + DDL nou cu migration `0015`, dar fara breaking changes pe rute existente).

---

## [2.12.1] - 2026-05-04

### UX bulk import — preview integral, mesaje clare, alerta contextualizata pe nume lungi

Patch peste v2.12.0 care raspunde la trei probleme operationale ridicate de utilizator pe import-ul bulk de monitorizare. Niciun migration, niciun schema change, niciun contract HTTP/IPC modificat — doar UX si o imbogatire de detail in alerta `source_error`.

### Frontend — preview integral cu paginare + control selectie

- **`frontend/src/components/monitoring/MonitoringBulkImportCard.tsx`**: limita statica de 300 randuri vizibile inlocuita cu paginare server-style identica cu pagina principala (`TablePagination`, default 100/pagina, `pageSizes=[25, 50, 100, 250]`). Toate randurile parse-uite raman in state si sunt accesibile la commit; vizibilitatea in tabel e doar paginata. Reset automat al paginii la schimbarea filtrului sau la cancel.
- **Coloana noua "Actiune" + Exclude/Include per rand**: buton cu icon `<X>` / `<Plus>` ce muta randul intr-un `Set<rowIndex>` (`excludedRows`); randurile excluse se afiseaza cu strikethrough + badge "exclus" si **nu** mai contribuie la commit.
- **Checkbox "Exclude warn-urile automat"**: filtru bulk linga dropdown-ul existent; cand e bifat, toate randurile cu `validation === "warn"` sunt scoase din commit (afiseaza badge "auto-exclus") fara sa modifice `excludedRows` per-rand. Astfel utilizatorul poate alege strategia (per-rand, in masa pe warn, sau hibrid).
- **Legenda statusuri** (`<details>` colapsabil): explica explicit ce inseamna ok / warn / respins si **clarifica deduplicarea automata** prin constraint `UNIQUE(owner_id, target_hash, kind)` — duplicat la import = NU se creeaza job duplicat, contorul reflecta doar joburile unice.
- **Counter de commit recalibrat**: `effectiveCommittableCount` ia in calcul respins (auto-out) + manual-excluse + warn-uri auto-excluse, deci textul "X randuri vor fi adaugate" e mereu corect inainte de commit.

### Backend — humanize mesaje validare + warn nume lung pentru PortalJust

- **`backend/src/services/nameListParser.ts` `classifyRawName`**: rescris cu mesaje romanesti complete care explica motivul si actiunea recomandata. Exemple: "Nume lipsa — completeaza coloana 'nume' sau cnp/cui pentru a putea cauta automat" (vs. fostul cod tehnic `nume_gol`); "Nume prea scurt — minimum 3 caractere" (vs. `prea_scurt`); "Duplicat — apare prima oara la randul X (NU se va crea job duplicat: deduplicare automata la import)". Toate testele existente migrate de la `.toContain("nume_gol")` la `.toMatch(/Nume lipsa/i)`.
- **Regula noua `nume_lung` (warn)**: declansata cand `nameNormalized.length > 100` OR `wordCount > 12`. Calibrata empiric: PortalJust accepta nume pure-char pana la ~120 chars dar refuza inputuri multi-cuvant cu 13+ tokeni cu eroare "Eroare la comunicarea cu serviciul" (probabil limita interna SQL LIKE per-token). Constante exportate: `PORTALJUST_WARN_CHAR_LIMIT = 100`, `PORTALJUST_WARN_WORD_LIMIT = 12`. Helper exportat `isLikelyTooLongForPortalJust(nameNormalized: string): boolean` reutilizat de scheduler.
- **Mesajul warn-ului `nume_lung`**: "Nume lung pentru PortalJust — depaseste limita empirica (~100 caractere / ~12 cuvinte) si poate produce esecuri repetate. Considera scurtarea numelui sau cauta dupa CUI/CNP." Apare la preview inainte de commit, deci utilizatorul poate decide sa excluda randul sau sa scurteze.

### Backend — alerta `source_error` enrich cu `probable_cause`

- **`backend/src/services/monitoring/scheduler.ts`**: helper nou `computeProbableCause(job, outcome)`. Pentru `name_soap` cu `errorCode === "SOAP_FAIL"`, parseaza `target_json`, extrage `name_normalized`, si daca `isLikelyTooLongForPortalJust(name_normalized)` returneaza `"nume_prea_lung_pentru_portaljust"`; altfel `null`.
- **Alerta enriched la `failStreak === SOURCE_ERROR_THRESHOLD` (= 5)**: cand `probable_cause === "nume_prea_lung_pentru_portaljust"`, titlul devine "Nume prea lung pentru PortalJust (5 esecuri consecutive)" iar `detail` JSON include `{ probable_cause, name_normalized, length, word_count }`. In rest, comportamentul ramane identic (titlul generic "Sursa indisponibila" + `dedup_key` neschimbat → o singura alerta active per job).
- **De ce conteaza**: utilizatorul vede direct in inbox-ul Alerte ca PortalJust nu e jos, ci numele monitorizat trebuie scurtat. Inainte, alerta `source_error` era opaca ("Eroare la comunicarea cu serviciul"); acum diagnosticul e expus la nivelul produsului.

### Tests

- **751 teste backend** (de la 744 in v2.12.0):
  - 4 noi in `services/nameListParser.test.ts` "validation — warn (nume lung pentru PortalJust)" — char limit, word limit, exemplul real GLOBALSAT (148 chars / 17 cuvinte) din raportul utilizatorului, nume scurt continua sa fie ok.
  - 3 noi in `services/monitoring/scheduler.test.ts` "Scheduler — source_error probable_cause enrichment" — name_soap cu nume lung emite probable_cause; name_soap cu nume scurt nu emite probable_cause; dosar_soap nu emite niciodata probable_cause indiferent de outcome.
- 73/73 frontend neschimbate (fixurile UI nu schimba contractele componentelor existente; testele de hook si tabs raman valide).
- tsc backend + frontend verde, biome verde pentru lintul nou (`useExhaustiveDependencies` false-positive pe `useEffect([bulkFilter, bulkPreview])` silentiat cu `biome-ignore` + comentariu de motiv).

### Versionare

- Bump manifest/lockfile la `2.12.1` (patch — UX + mici imbogatiri observabile in mesajele de validare si alert detail, **fara** migrari/schema/contract break).

---

## [2.12.0] - 2026-05-04

### Code health — MIN-VIABLE seam refactors + dashboard pagination fix

Release minor peste v2.11.0 care absoarbe lotul al doilea din `DEEP-REVIEW-LEGAL-DASHBOARD-2026-05-04.md` (sectiunea "MIN-VIABLE seams"). Patru cuturi mici, low-risk, fiecare cu boundary clar si test in zona schimbata; **fara migrari, fara schimbari de API observabile**. In plus, un fix de paginare la dashboard timeline care a iesit la suprafata cand testul a evidentiat boundary loss prin per-source `LIMIT`.

### Backend - AlertEventService seam (split persistence/fanout)

- **`services/alerts/alertEventService.ts`** (nou, ~50 linii): wrapper `recordAndDispatchAlert(input)` care apeleaza `insertAlert` (repo pur) si, **doar la insert real (`result.inserted === true`)**, dispecerizeaza email-ul prin `queueMicrotask` ca fanout-ul sa nu blocheze tranzactia SQLite. Returneaza acelasi shape `InsertAlertResult` ca `insertAlert`, deci toti callerii pot face swap fara schimbare de API.
- **`db/monitoringAlertsRepository.ts`**: scos `import dispatchAlertEmail` + blocul `queueMicrotask(() => { void dispatchAlertEmail(row); })` din `insertAlert`. SSE listener `notifyNewAlert(row)` ramane in repo (e infrastructura locala, nu fanout extern). Comentariu nou indica caller-ii spre `services/alerts/alertEventService.ts` pentru email.
- **Caller migration**: `services/monitoring/dosarSoapRunner.ts`, `services/monitoring/nameSoapRunner.ts`, `services/monitoring/scheduler.ts` folosesc `import { recordAndDispatchAlert as insertAlert } from "../alerts/alertEventService.ts"` (alias pe acelasi nume local pentru a minimiza diff-ul). Cele 16 puncte de apel din teste continua sa foloseasca `insertAlert` direct din repo (testele nu vor side-effect SMTP).
- **De ce conteaza**: granularitate clara `inserted=true` vs `inserted=false` (dedup_key duplicat). Inainte, dispatch-ul email era inline in `insertAlert` si se executa pentru orice apel, chiar pe duplicate; acum se pot adauga webhook-uri / Slack / push fara sa atinga repo-ul, fiecare in propriul wrapper.
- **`services/alerts/alertEventService.test.ts`** (nou, 3 teste): persists row + returneaza shape; dispatch o singura data pe insert real; zero dispatch pe dedup hit. `vi.mock("../email/mailer.ts", ...)` izoleaza SMTP; `drainEmailDispatches(2_000)` in `afterEach` previne leak intre teste.

### Backend - command service extras din `routes/monitoring.ts`

- **`services/monitoring/commands/createMonitoringJob.ts`** (nou, ~95 linii): functie pura framework-free `executeCreateMonitoringJob(input)` care primeste input deja parsat (Zod la boundary) + un callback `writeAudit(event)` ce decoupleaza accesul la Hono `Context`. Detine tranzactia `getDb().transaction(() => { createJob + audit })`, traduce `IdempotencyConflictError` in outcome `idempotency_conflict` cu rândul existent, si rejecta `aviz_rnpm` cu outcome `kind_not_implemented`.
- **Outcome union explicit**: `{ status: "ok" | "kind_not_implemented" | "idempotency_conflict", ... }`. Service-ul **nu cunoaste HTTP**; route-ul mapeaza outcome-urile in 200 / 201 / 409 / 422 + envelope error code.
- **`routes/monitoring.ts`**: handler-ul `POST /jobs` se rezuma la (1) Zod parse, (2) `getOwnerId(c)`, (3) chemarea service-ului cu `writeAudit: (event) => recordAudit(c, event.action, ...)`, (4) switch pe `outcome.status`. Toti `recordAudit(c, ...)` din service-ul vechi (route handler) primesc acum doar payload-ul (`{ action, actorId, ownerId, ... }`); request-id-ul / IP-ul / framework-ul raman la boundary.
- **Test impact**: 53 teste in `routes/monitoring.test.ts` raman verzi; service-ul e implicit testat via integration tests existente. Refactorul nu adauga teste noi — comportamentul end-to-end este identic.

### Frontend - hook extragere `useMonitoringJobs`

- **`frontend/src/hooks/useMonitoringJobs.ts`** (nou, ~130 linii): owns abort controller, debounce 300ms cu `useDebouncedValue([value, flush])`, page-empty recovery effect (cand pagina curenta devine goala dupa delete, pageNum `--`), `refresh()` pentru re-fetch idempotent.
- **API hook**: returneaza `{ jobs, total, totalPages, loading, error, page, pageSize, kindFilter, searchInput, debouncedQuery, setPage, setPageSize, setKindFilter, setSearchInput, flushQuery, refresh, setError, setJobs }`. Page-ul `Monitorizare.tsx` mai detine doar selection (`selectedIds: Set<number>`), modale (Detalii instante), bulk delete state si handlers de mutatii.
- **`frontend/src/pages/Monitorizare.tsx`**: scos `useCallback` import, `useDebouncedValue` import, `JobKindFilter` type import. ~60 linii de state + refresh + effect inlocuite cu un singur `useMonitoringJobs()` destructure. `handleBulkDelete` / `handleDelete` / `handleToggleActive` / `handleCadenceChange` apeleaza acum `refresh()` din hook in loc sa-si gestioneze propriul fetch.
- **De ce conteaza**: page-ul face acum un singur lucru (UI compunere); hook-ul e re-utilizabil si testabil in izolare. Tests existente (73/73 frontend) raman verzi.

### Electron - extragere modul `notifications.js` din `electron/main.js`

- **`electron/notifications.js`** (nou, 186 linii): exports `getNotificationStatus()`, `showNativeNotification(payload)`, `registerNotificationIpc(ipcMain)`. Detine `MAX_NOTIFICATION_*` constants, `WINDOWS_NOTIFICATION_ACCEPTS` / `MACOS_NOTIFICATION_ACCEPTS` sentinels, `notificationsByTag` Map (LRU by insertion order), `normalizeNotificationCapability(...)`, capability detection prin `windows-notification-state` / `macos-notification-state`.
- **`electron/main.js`** (727 → 533 linii): scos `Notification` din destructure-ul electron, scos cele 5 constants inline + cele 2 sentinel sets + tag-dedup Map + capability helpers. Adaugat `const { getNotificationStatus, showNativeNotification, registerNotificationIpc } = require(path.join(__dirname, "notifications.js"))`. Cele 3 inline `ipcMain.handle("notification:*", ...)` blocuri inlocuite cu un singur `registerNotificationIpc(ipcMain)`.
- **De ce conteaza**: `main.js` mai detine doar lifecycle (single-instance lock, window manage, AUMID, safeStorage IPC, crash handlers). Notificarile sunt o capabilitate izolata cu un boundary IPC clar.
- Comportament IPC neschimbat (`notification:show`, `notification:status`, `notification:get-all-tags`).

### Backend - bug fix dashboard timeline pagination

- **`routes/dashboard.ts`**: cand cursor-ul de paginare e composite (`<ts>|<eventId>`, deci `inclusive=true` pe predicat repo `<=`), per-source fetch foloseste acum `limit + 1` in loc de `limit`. **Cauza**: cursorul include event-ul boundary in fetch, iar post-merge filter-ul `compareDesc(ev, cursor) > 0` il scoate; fara `+1`, sursa care contine boundary-ul pierde un candidat real, iar urmatorul eveniment legitim "cade" intr-o pagina urmatoare. Cu composite ID-uri unice, cel mult un eveniment per sursa egaleaza cursor-ul, deci `+1` este suficient.
- **Impact**: testul `paginates via cursor (events strictly older than the cursor)` din `dashboard.test.ts` (modificat in v2.11.0 sa foloseasca composite cursor) trece acum determinist.

### Tests

- **744 teste backend** (de la 728 in v2.11.0: +3 in `services/alerts/alertEventService.test.ts` (nou) + +13 distribuite intre `routes/rnpm.owner-isolation.test.ts` (nou, 11 owner-isolation pe rute RNPM care lucreaza pe DB partajata) si `routes/dashboard.test.ts` (compound cursor disambiguation absorbit din v2.11.0 deep-review). 73/73 frontend neschimbate. tsc backend + frontend verde, biome verde.

### Documentatie

- `CHANGELOG.md` (acest fisier), `CLAUDE.md`, `STATUS.md`, `SESSION-HANDOFF.md` actualizate pentru v2.12.0.
- `frontend/src/data/changelog-entries.tsx`: entry nou v2.12.0 in changelog-ul din aplicatie.

### Versionare

- Bump la `2.12.0` in `package.json`, `backend/package.json`, `frontend/package.json` si `package-lock.json` (root + workspace pkgs). Minor (nu patch) pentru a marca refactorul de seam-uri vizibile la diff de cod chiar daca nu se modifica contractele HTTP/IPC.

---

## [2.11.0] - 2026-05-04

### Web-readiness closure + dependency CVE remediation + PII cleanup

Release minor peste v2.10.8 care absoarbe primul lot din `DEEP-REVIEW-LEGAL-DASHBOARD-2026-05-04.md`. Trei axe: (1) operational urgent — PII real in git si CVE HIGH `nodemailer`, (2) inchidere bridge web-readiness pentru rutele RNPM (owner propagation, admin guard, AUTH_MODE=web gate), (3) dependency hygiene fara migrare `xlsx`. Comportament desktop neschimbat: `getOwnerId` cade pe `"local"`, user-ul `local` e admin via bootstrap din `0006_admin_roles`, AUTH_MODE default e `desktop`.

### Securitate - PII si CVE

- **`backend/rnpm-dumps/`**: directorul si dump-ul real care contine CUI 39029401, denumire `INSTANT FACTORING IFN` si `J40/3635/2018` scoase din git index (`git rm --cached`); pattern `backend/rnpm-dumps/` adaugat in `.gitignore` pentru a preveni recommit. Fisierul ramane local pentru referinta. Istoricul git inca pastreaza dump-ul; o curatare cu `git filter-repo` ramane optionala (repository privat, blast radius mic).
- **CVE HIGH `nodemailer` DoS via `addressparser` recursiv** (GHSA-rcmh-qjqh-p98v, CVSS 7.5): bump `^6.9.13` → `^7.0.13`. Acopera si CVE moderate GHSA-mm7p-fcc7-pg87 (interpretation conflict pe domenii). Cele 2 SMTP command injection ramase (GHSA-c7w3-x93f-qmm8 + GHSA-vvjj-xcjg-gr5g, range `<=8.0.4`) cer `transport.name` sau `envelope.size` controlate de atacator; nu sunt expuse user-controlled in `services/email/mailer.ts`.
- **CVE moderate `@anthropic-ai/sdk` Insecure Default File Permissions in Local Filesystem Memory Tool** (GHSA-p7fg-763f-g4gf): bump `^0.90.0` → `^0.92.0` (semver major; nu folosim Local Filesystem Memory Tool, dar aplicam fix-ul ca recomandat).
- `xlsx@0.18.5` (HIGH Prototype Pollution + ReDoS, no upstream fix) ramane risc acceptat — folosit doar in frontend `monitoringBulkTemplate.ts` pentru parsare template; migrarea catre `exceljs` e amanata pentru o sesiune separata. Backend `nameListParser.ts` e deja pe `exceljs@^4.4.0` din v2.6.4. `uuid <14.0.0` (transitive via `exceljs`) ramane CVE moderat documentat (atacul cere buf cu lungime controlata, exceljs nu il expune pe acel path).

### Backend - web-readiness closure pentru RNPM

- **Closure #1 (owner propagation)**: `routes/rnpm.ts` inlocuieste cele trei hardcodari `"local"` (idempotency `dedupKey` pe `/search` + `/bulk` si argumentul `executeBulkSearch`) cu `getOwnerId(c)`. Service-ul accepta deja `ownerId`; `executeSearch` primeste acum `ownerId: getOwnerId(c)` explicit ca `searchId`-ul si `aviz`-ul nou create sa fie scrise sub owner-ul real al request-ului. Pe desktop ramane `"local"` via fallback in `getOwnerId`; in web mode izoleaza inflight map + scriituri intre tenants.
- **Closure #2 (admin guard pe rute globale)**: `requireRole("admin")` montat pe `DELETE /saved/all`, `POST /compact`, `GET /backups`, `DELETE /backups`, `POST /backups/restore`, `POST /open-db-folder`, `POST /open-backups-folder`. Pe desktop, user-ul `local` e admin via `0006_admin_roles` bootstrap, deci comportament neschimbat. In web mode, doar admini pot face wipe global / compact / backup ops.
- **Closure #12 (AUTH_MODE=web gate pe captchaKey body)**: helper `rejectCaptchaKeyInWebMode(c)` in `routes/rnpm.ts` raspunde 501 cu mesaj romanesc cand `getAuthMode() === "web"`, montat pe `POST /search`, `POST /bulk`, `POST /captcha/balance`. Defense-in-depth pentru ce ar fi un anti-pattern in web (cheie captcha plain in body / localStorage / fetch DevTools). Per-user server-side key storage ramane TBD pentru un release viitor.

### Tests

- **728 teste backend** (de la 721 baseline v2.10.6 — +7 noi in `routes/rnpm.contract.test.ts`): 3 pentru gate-ul AUTH_MODE=web (`/search`, `/bulk`, `/captcha/balance` returneaza 501) + 4 pentru defense-in-depth admin guard (`updateUserRole("local","user")` urmat de 403 pe `/saved/all`, `/compact`, `GET /backups`, `DELETE /backups`).
- Test setup actualizat: `beforeEach` promoveaza user-ul `local` (seed-uit de migration 0002 cu role=user) la `admin` via `updateUserRole("local","admin")`, ca rutele admin-gated sa fie testabile in vitest fara seam-ul `setupBootstrapAdmin` din productie.
- **73 teste frontend** neschimbate.

### Build script

- `scripts/build-server.js`: ZIP output rebrand `portaljust-server-${version}.zip` → `legal-dashboard-server-${version}.zip`; titlul console + README.txt aliniate la branding-ul actual.

### Documentatie

- `CHANGELOG.md` (acest fisier), `README.md`, `STATUS.md`, `SESSION-HANDOFF.md`, `EXECUTION-ROADMAP.md`, `CLAUDE.md` actualizate pentru v2.11.0.
- `frontend/src/data/changelog-entries.tsx`: entry nou v2.11.0 in changelog-ul din aplicatie.

### Versionare

- Bump la `2.11.0` in `package.json`, `backend/package.json`, `frontend/package.json` si `package-lock.json` (root + workspace pkgs).

---

## [2.10.8] - 2026-05-04

### CI hardening — type-check + test gate inainte de packaging + artifact naming

Patch CI-only peste v2.10.7. Rezolva findings-urile deferate explicit din
v2.10.7 (`Findings-urile de workflow metadata / release artifact naming raman
deferate pentru o sesiune separata`) fara sa modifice cod aplicativ; binarele
NSIS / DMG produse nu se schimba functional.

### CI / GitHub Actions

- `.github/workflows/build-windows.yml`: introduse 4 step-uri noi intre
  `npm ci` si `Rebuild native modules for Electron ABI` — `Backend type-check`
  (`npx tsc --noEmit -p backend/tsconfig.json`), `Backend tests`
  (`npm test --workspace=backend -- --run`), `Frontend type-check`
  (`cd frontend && npx tsc --noEmit`), `Frontend tests`
  (`cd frontend && npm test -- --run`). Ordinea e importanta: gate-ul ruleaza
  cat timp `better-sqlite3` e prebuild-uit pentru ABI-ul Node (din `npm ci`),
  inainte ca `rebuild:electron` sa il flipeze pe ABI-ul Electron, ca `vitest`
  (Node) sa nu crash-uiasca la load.
- `.github/workflows/build-mac.yml`: aceleasi 4 step-uri introduse intre
  `npm ci` si `Build app (backend + frontend)`. Mac nu are step explicit
  `rebuild:electron` (electron-builder face npmRebuild intern la packaging),
  asa ca testele ruleaza inainte de `npm run build` ca sa pastreze ABI-ul Node.
- Artifact naming aliniat intre Windows si macOS: numele fixe
  `legal-dashboard-windows` / `legal-dashboard-mac` inlocuite cu pattern
  `legal-dashboard-{platform}-${{ github.ref_name }}-run${{ github.run_id }}`.
  Pentru tag pushes (`v2.10.8`) numele devine
  `legal-dashboard-windows-v2.10.8-run<id>`; pentru `workflow_dispatch` pe
  branch include numele branch-ului. Eviti overwrite-uri silentioase intre
  run-uri concurente sau re-run-uri in aceeasi fereastra de retentie de 14
  zile.

### Documentatie

- `CHANGELOG.md` (acest fisier), `README.md`, `STATUS.md`,
  `SESSION-HANDOFF.md`, `EXECUTION-ROADMAP.md`, `CLAUDE.md` actualizate
  pentru v2.10.8 — sectiunile "De facut pe viitor" / "raman deferate" / "
  Backlog tehnic minor" referitoare la workflow-uri scoase, marcate ca
  livrate.
- `frontend/src/data/changelog-entries.tsx`: entry nou v2.10.8 in changelog-ul
  din aplicatie.

### Versionare

- Bump la `2.10.8` in `package.json`, `backend/package.json`,
  `frontend/package.json` si `package-lock.json` (root + workspace pkgs).

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

### Documentatie

- `CODEX-BACKLOG.md` a fost inchis ca document istoric: Task B/C sunt livrate
  in v2.10.5, iar Task A este eliminat din scope din v2.10.6.
- Findings-urile de workflow metadata / release artifact naming raman deferate
  pentru o sesiune separata; starea finala v2.10.7 nu schimba workflow-urile.

- Bump la `2.10.7` in root/backend/frontend manifests si lockfile.

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
