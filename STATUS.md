# Legal Dashboard — Status Implementare

**Data:** 2026-04-18 (sesiune 2)
**Versiune tinta:** v1.0.0
**Status global:** 10/10 pasi completi. Installer generat: `release/Legal Dashboard Setup 1.0.0.exe` (98 MB).

**De continuat:** parser-ul RNPM trateaza acum `ipoteci` (default) + `specifice` (shape partiF/partiJ + part3.bunuri). Ramane de extins pentru **fiducii / creante / obligatiuni ipotecare** — dupa captura unor raspunsuri reale (parts 1-4 + istoric). Vezi CHANGELOG.md → "18 Aprilie 2026 (sesiune 2)" pentru pattern-ul de branching.

---

## Ce este Legal Dashboard

Aplicatie Electron desktop = **copie completa PortalJust Dashboard v1.4.4-ai + tab nou "Cautare RNPM"** (Registrul National de Publicitate Mobiliara). PortalJust ramane aplicatie separata, neatinsa.

- **Versiune:** v1.0.0
- **AppId:** `ro.legaldashboard.app`
- **ProductName:** Legal Dashboard
- **DB path:** `userData/legal-dashboard.db` (via env `LEGAL_DASHBOARD_DB_PATH`)
- **Istoric RNPM separat** de istoricul PortalJust (localStorage: `legal-dashboard-rnpm-history`)

---

## Progres

| # | Pas | Status |
|---|---|---|
| 1 | Copy PortalJust -> Legal Dashboard + rename branding | OK |
| 2 | Verify copied app runs (npm install + build) | OK |
| 3 | Backend: deps + SQLite schema + repositories | OK |
| 4 | Backend: captchaSolver + rnpmClient | OK |
| 5 | Backend: rnpmSearchService + routes (REST + SSE bulk) | OK |
| 6 | Frontend: types + rnpmApi + useApiKey + useRnpmHistory | OK |
| 7 | Frontend: RnpmSearchForm + RnpmResultsTable | OK |
| 8 | Frontend: RnpmDetailModal + RnpmBulkSearch + RnpmSavedData | OK |
| 9 | Integrate: Sidebar + App.tsx + 2Captcha key dialog | OK |
| 10 | Electron build `Legal Dashboard.exe` (`npm run dist`) | OK |

**Typecheck frontend:** curat (`npx tsc --noEmit` returns empty).

---

## Ce s-a construit in aceasta sesiune

### Backend (`backend/src/`)

- `db/schema.ts` — singleton `getDb()`, WAL, foreign keys, creeaza 6 tabele:
  - `rnpm_searches` — istoric interogari (cu owner_id, tip, params JSON, total)
  - `rnpm_avize` — UNIQUE(owner_id, identificator); toate campurile part1
  - `rnpm_creditori`, `rnpm_debitori`, `rnpm_bunuri`, `rnpm_istoric` — relatii per aviz
- `db/searchRepository.ts` — saveSearch, getSearches (cursor), deleteSearch
- `db/avizRepository.ts` — saveAvizFull (tranzactie upsert), getAvizById, getAvize (filtre searchType/activ/data/q), deleteAviz, getAvizeByIds
- `services/captchaSolver.ts` — @2captcha/captcha-solver wrapper; RNPM_SITEKEY `6Lff9LsUAAAAAO1gN9y3YMSyX94MS4Yh5zPqePkT`; CaptchaError cu mesaje RO
- `services/rnpmClient.ts` — `search()`, `fetchPart(uuid, 1..4)`, `fetchIstoric()`, `fetchFullDetail()` (Promise.all 5 req)
- `services/rnpmSearchService.ts` — executeSearch (captcha -> search -> batch-5 fetch detail -> persist) + executeBulkSearch (AbortSignal + progress callback)
- `routes/rnpm.ts` — Hono router montat la `/api/rnpm`:
  - `POST /search` — cautare + persist
  - `POST /bulk` — SSE streaming (streamSSE din hono/streaming)
  - `GET /saved` — paginat cursor, filtre (searchType, activ, q, dataStart, dataStop)
  - `GET /saved/:id` — detaliu full
  - `DELETE /saved/:id`
  - `POST /saved/export` (max 500 ids)
  - `GET /searches`, `DELETE /searches/:id`
  - `POST /captcha/balance`
- `index.ts` — health string "Legal Dashboard API", router montat

### Frontend (`frontend/src/`)

- `types/rnpm.ts` — toate tipurile RNPM
- `lib/rnpmApi.ts` — wrapper fetch: rnpmSearch, rnpmGetSaved, rnpmGetAvizDetail, rnpmDeleteAviz, rnpmExport, rnpmCaptchaBalance, rnpmBulkSearch (parser SSE manual)
- `hooks/useApiKey.ts` — extins cu `twocaptcha` + `hasTwoCaptcha`; migratie + obfuscate compatibile
- `hooks/useRnpmHistory.ts` — istoric separat (STORAGE_KEY `legal-dashboard-rnpm-history`, max 15)
- `components/rnpm/RnpmSearchForm.tsx` — 5 tab-uri categorie + toate filtrele (debitor/creditor PJ+PF, vehicule, perioada, identificator)
- `components/rnpm/RnpmResultsTable.tsx` — tabel cu checkbox selectie + paginare
- `components/rnpm/RnpmDetailModal.tsx` — modal cu 5 tab-uri (General, Creditori, Debitori, Bunuri, Istoric)
- `components/rnpm/RnpmBulkSearch.tsx` — bulk UI (textarea valori, AbortController, progres live cu SSE)
- `components/rnpm/RnpmSavedData.tsx` — browser baza locala cu filtrare + cursor "Incarca mai multe"
- `pages/RnpmSearch.tsx` — pagina compusa: tabs Cautare / Bulk / Baza locala + modal detaliu partajat
- `components/Sidebar.tsx` — adaugat nav `/rnpm` + sectiune "Istoric RNPM" separata
- `App.tsx` — RnpmSearchPage montat cu `display:none` (supravietuieste tab switch); `useRnpmHistory` la root; dialogul "Setari AI" are acum al 4-lea card **2Captcha (RNPM)**

### Electron / Branding

- `package.json` — name "legal-dashboard", version "1.0.0", productName "Legal Dashboard", shortcutName "Legal Dashboard", appId "ro.legaldashboard.app"
- `electron/main.js` — title "Legal Dashboard", env `LEGAL_DASHBOARD_DB_PATH` setat inainte de require backend
- Rebranding Sidebar / Dashboard / Manual / export PDF la "Legal Dashboard" (referintele la portal.just.ro pastrate cu nume PortalJust pentru ca e sursa externa de date)

---

## Arhitectura RNPM — note cheie

- **Fetch eager al detaliilor:** UUID-urile RNPM sunt efemere, deci in timpul search-ului facem imediat `fetchFullDetail` (5 requests per document, batch de 5 concurent) si persistam complet (aviz + creditori + debitori + bunuri + istoric). Ulterior, browse-ul din "Baza locala" nu mai face round-trip la RNPM.
- **Idempotenta:** `saveAvizFull` face upsert pe UNIQUE(owner_id, identificator) + sterge+reinserare child rows in tranzactie.
- **Cost 2Captcha:** ~$0.003/captcha. Bulk UI afiseaza estimare timp (25s/intrare) + cost.
- **SSE pentru bulk:** `streamSSE` din `hono/streaming`; frontend parseaza manual evenimentele (`event:` + `data:` linii).
- **Cursor pagination** peste tot (`{ limit, cursor }` -> `{ items, nextCursor }`), owner_id pe toate tabelele (default `"local"`).

---

## Pas ramas: 10 — Build installer

```bash
cd "C:\Users\Cezar\Desktop\Claude Code\Legal Dashboard"
npm run dist
```

Output asteptat: `release/Legal Dashboard Setup 1.0.0.exe` (NSIS) + portabil.

**Verificari dupa build:**
1. Installer se deschide, se instaleaza in `%LOCALAPPDATA%\Programs\legal-dashboard`
2. La prima rulare: DB se creeaza in `%APPDATA%\legal-dashboard\legal-dashboard.db`
3. Tab-urile Dashboard / Dosare / Termene / **Cautare RNPM** functioneaza
4. "Setari AI" contine 4 carduri: Anthropic / OpenAI / Google / **2Captcha**
5. Cu cheie 2Captcha valida: cautare RNPM -> rezultate persistate in baza locala
6. "Istoric cautari" (PortalJust) si "Istoric RNPM" afisate separat in sidebar

---

## Referinte externe

- **2Captcha SDK:** `@2captcha/captcha-solver` (organizatia oficiala: https://github.com/2captcha)
- **RNPM API base:** `https://www.rnpm.ro/api` (endpoints: `/search/{type}/{page}`, `/view/inscriere/{uuid}?part=1..4`, `/view/istoric/{uuid}`)
- **Categorii RNPM:** ipoteci, fiducii, specifice, creante, obligatiuni

---

## Pentru reluare dupa pauza

1. Deschide acest fisier (`STATUS.md`) — contine tot contextul.
2. Ruleaza pasul 10 de mai sus (`npm run dist`).
3. Dupa build, testeaza fluxul complet pe installer-ul generat.
4. Daca totul OK: commit + tag `v1.0.0`.

---

## Update 2026-04-16 — RNPM form parity cu site-ul oficial

Sursa: PDF "Cautarea si vizualizarea informatiilor inscrise in RNPM" + capturi Network tab.

### Aliniat la spec
- **Categorii** denumite exact ca pe RNPM (Aviz de ipoteca mobiliara / Fiducie / Aviz specific / Aviz de ipoteca - creante securitizate / Aviz de ipoteca - obligatiuni ipotecare).
- **Tipul avizului** — dropdown per categorie cu listele exacte (18 ipoteci, 7 specifice, 7 fiducii); SI/SAU pe operator.
- **Destinatia inscrierii** — dropdown la specifice (14 valori) si la ipoteca (10 valori); SI/SAU pe operator.
- **Default checkboxes**: `Numai active` + `Nemodificate de alte inscrieri` bifate implicit (cf. spec).
- **SI/SAU pe toate campurile SiSau**: CUI, CNP, RegCom, Prenume, Serie sasiu, Serie motor, Nr. inmatriculare — pe toate sectiunile (Debitor / Creditor / Constituitor / Fiduciar / Beneficiar / Parte / Vehicul / Reprezentant Creditor / DebitorJ / DebitorF).
- **Limita 1500 rezultate** — backend arunca eroare clara `RNPM a returnat N rezultate (limita 1500). Restrange criteriile de cautare.` cand totalul depaseste pragul.
- **Toggle PJ/PF unic per parte** — etichete "Persoana Juridica" / "Persoana Fizica"; alegerea schimba campurile (CUI vs CNP) intr-o singura sectiune.

### Structura per categorie
| Categorie | Sectiuni |
|---|---|
| Ipoteca mobiliara | Tip aviz, Destinatia inscrierii, Debitor (PJ/PF), Creditor (PJ/PF), Vehicul |
| Fiducie | Tip aviz, Constituitor (PJ/PF), Fiduciar (PJ), Beneficiar (PJ/PF), Vehicul |
| Aviz specific | Tip aviz, Destinatia inscrierii, Parte (PJ/PF), Bun (descriere) |
| Creante securitizate | Reprezentant Creditor (PJ), Debitor (PJ/PF), Bun (descriere) |
| Obligatiuni ipotecare | (lipsa — vezi "Ramas de facut") |

### Mapping API confirmat (din capturi Network)
- Creante: `reprezentantCreditor: { denumire, regCom, CUI }`, `debitorJ: { denumire, RegCom, CUI }`, `debitorF: { nume, prenume, CNP }`, `creante: { descriere }`.
- Note: cheia `regCom` la creditor e camelCase, `RegCom` la debitor e PascalCase — inconsistenta API-ului RNPM, respectata.

### Persistenta detalii (fara modificari)
- `RnpmBun.referinte: RnpmBunPartyRef[]` — bunurile au referinte tert/constituitor afisate ca badge-uri colorate in modal.
- Coloana `referinte_json` in `rnpm_bunuri` (migratie idempotenta in `db/schema.ts`).

---

## Ramas de facut (RNPM)

### Prioritar
1. **Obligatiuni ipotecare** — payload-uri Network tab nepreluate inca. Necesare: Agent PJ + Agent PF + Emitent PJ + Bun (descriere). Spec: `agentJ`/`agentF`/`emitent`/`obligatiuni` — *necesita confirmare prin captura Network*.
2. **Tert cedat** la ipoteca (PJ/PF) — sectiune separata in formular; cheile API necunoscute.
3. **Bun mobil atasat unui bun imobil** (la ipoteca) — Categorie + Identificare; cheile API necunoscute.
4. **Bun "Alt tip"** la fiducie — Categorie; cheia API necunoscuta.
5. **Bun imobil** la fiducie — Localitate, Judet, Tara, Nr CF, Nr cadastral, Adresa; cheile API necunoscute.

### Validari input (din "Mentiuni esentiale" RNPM)
6. ~~**Strip diacritice** automat la submit~~ — DONE (backend `stripDiacriticsDeep` pe `/search` + `/bulk` params; vezi update 2026-04-16 sesiunea 3).
7. ~~**CUI: numai cifre** — validare client-side (warn)~~ — DONE (walk pe params construit + `window.confirm`).
8. **Identificator / Reg.Com / CUI / CNP / Serie sasiu/motor / Nr inmatriculare** — exact match (informativ in UI: tooltip / placeholder).
9. **Pseudo-categorie "Inscriere veche"** pentru bunuri "Alte tipuri" pre-2014-06-16 — recomandare in UI sa se ruleze si pe aceasta cand cauta dupa bun "Alte tipuri".

### Convertire payload-uri necunoscute -> cunoscute
Pentru fiecare element 1-5 de mai sus se colecteaza payload-ul printr-o cautare reala pe RNPM si se confirma cheile JSON inainte de a adauga in `RnpmSearchParams`.

---

## Update 2026-04-16 (sesiunea 2) — Hardening audit findings

Dupa audit-readiness + CLAUDE.md conventions audit, aplicate urmatoarele fix-uri (niciunul nu schimba functionalitatea, toate sunt defense-in-depth):

### Backend (`backend/src/`)
- **Body size limits** pe toate POST `/api/rnpm/*` via `hono/body-limit` (F-1):
  - `/search` 64KB · `/bulk` 512KB · `/saved/export` 64KB · `/captcha/balance` 4KB → 413 "Payload prea mare"
- **SSE timeout 10 min** pe `/bulk` (F-2) — `setTimeout(() => controller.abort(), 600000)` curatat pe finally.
- **Max field depth/length** (W-1) — validator `validateParamsDepth` walk recursiv (max depth 4, max 500 chars/string) aplicat la `/search` + `/bulk`.
- **RnpmClient singleton** (CP-B5) — `defaultRnpmClient` exportat; `executeSearch` / `executeBulkSearch` / `/bulk` route folosesc instanta partajata (RnpmClient e stateless, nu tine user data).

### Frontend (`frontend/src/`)
- **CP-E1 unmount cleanup** in `RnpmBulkSearch.tsx` — `useEffect(() => () => { abortCtl?.abort(); }, [abortCtl])` previne waste 2Captcha daca userul paraseste tab-ul in timpul unui bulk.
- **CQ-6 SSE reader release** in `lib/rnpmApi.ts` — wrap while-loop in try/finally cu `reader.cancel()` pentru a elibera stream-ul pe abort/error abrupt.

### Electron (`electron/main.js`)
- **W-2** `ALLOWED_EXTERNAL_DOMAINS` extins cu `mj.rnpm.ro` si `www.rnpm.ro` pentru cazul in care se foloseste `shell.openExternal` spre RNPM.

### Onboarding
- **CQ-8** creat `backend/.env.example` cu lista completa variabile (ANTHROPIC/OPENAI/GOOGLE_AI, HOST, LEGAL_DASHBOARD_DB_PATH, NODE_ENV) + nota ca 2Captcha key se introduce in UI (Setari AI), nu prin env.

### CP-15 — refactor `RnpmSearchForm`
- Custom hooks noi in-file: `useText`, `useSiSauField`, `usePJField`, `usePFField` — colapseaza cele 40+ `useState` individuale in 10 apeluri de hook + 11 `useState` native la nivel de component.
- Sub-componente noi: `PJBlock`, `PFBlock`, `PartyFieldset`, `VehiculFieldset`, `DestinatieSelect` — elimina 7 duplicari JSX ale pattern-ului PJ/PF.
- Logica de submit pastrata *exact* (parity testata manual pe toate ramurile): particularitatile per-categorie sunt comentate inline (ex: `Ipoteci PF: declanseaza pe nume SAU CNP`, `Creante PF: si pe prenume`, `CreditorPF: fara prenume`).
- Rezultat: 613 → 651 linii (un pic mai mult din cauza abstractiilor + tipurilor), dar `useState` direct in component: **40+ → 11**. Typecheck curat.

---

## Update 2026-04-16 (sesiunea 4) — Audit remediation completa

Toate cele 12 findings din auditul in-depth Legal Dashboard (`AUDIT-LEGAL-DASHBOARD.md`, eliminat dupa remediere) aplicate in 3 runde. Detalii complete in `CHANGELOG.md` la sectiunea omonima.

### Round Next — fluxuri critice (P1)
- **F2** load-more multi-institutie (`URLSearchParams.append` + `c.req.queries`).
- **F3** abort propagat la backend (signal in `batchFetchDosare`/`subdivideInterval`, listener pe `c.req.raw.signal`, single-timer abort).
- **F4** boot Electron cu deadline + `dialog.showErrorBox` la esec backend.

### Round 2 — state, erori, metrici, versiuni (P2/P3)
- **F5** `setState` functional in toate callbackurile load-more.
- **F7** mesaj backend propagat in `lib/api.ts` (parse o singura data, fara dublu-throw).
- **F11** `totalInstitutii` corect (Object.keys.length); `viitor`/`trecut`/`azi` aliniat la `filterByMetrics()` cu `setHours(0,0,0,0)`.
- **F12** versiune unificata: `package.json` root → `1.4.4-ai`, frontend/backend renamed; `__APP_VERSION__` injectat din vite.config.ts ca single source of truth.

### Round 3 — performance, theming, a11y, tests (P2)
- **F8** code-split: `Changelog`/`Manual`/`MetricsPanel`/`TermeneMetrics` lazy + `manualChunks` named (charts/xlsx/pdf). Bundle main 306 kB (gzip 83 kB).
- **F10** `frontend/src/lib/chart-colors.ts` — `CATEGORY_COLORS` + `CHART_FILLS` partajate intre `MetricsPanel` si `TermeneMetrics`.
- **F6** `frontend/src/hooks/useDialog.ts` (Escape close + scroll lock + focus capture/restore) wired in toate dialogurile (Changelog, Manual, API key, InstitutieSelect); `role="dialog"`/`aria-modal`/`aria-labelledby` peste tot; `useId()` pentru pairing `htmlFor`/`id` pe SearchForm.
- **F9** vitest in backend (`npm test`, script nou); `intervals.test.ts` (12) + `soap.test.ts` (12) → **24/24 verde**. `extractFirst`/`extractAll`/`parseDosar`/`toLegacyDiacritics` exportate pentru testabilitate.

### Verificare finala
- `frontend && npx tsc --noEmit` curat.
- `frontend && npm run build` OK (warning preexistent `import.meta` neschimbat).
- `backend && npm test` 24/24 verde, 256ms.

---

## Update 2026-04-16 (sesiunea 3) — Normalizare text RNPM (scope strict RNPM)

Sursa: spec RNPM "Mentiuni esentiale" + obs user ("Cautarea nu tine cont de Uppercase"). **Scope lock:** modificarile afecteaza EXCLUSIV fluxurile RNPM (`/api/rnpm/*`, tab "Cautare RNPM", baza locala RNPM). Cautarea Dosare + Termene PortalJust ramane *neatinsa* — foloseste SOAP separat, fara DB locala partajata.

### Noua utilitate
- `backend/src/util/textNormalize.ts` — `stripDiacritics(s)` (NFD + drop U+0300..036F) + `stripDiacriticsDeep<T>(value)` walker recursiv pentru params objects. Doar doua exporturi, zero abstractii.

### Backend
- **Strip diacritice pe params RNPM** (`backend/src/services/rnpmSearchService.ts::executeSearch`):
  - `stripDiacriticsDeep(restParams)` aplicat *doar* pe payload-ul trimis la `client.search(...)`. `input.params` ramane neatins, deci `rnpm_searches.params_json` stocheaza exact textul original tastat de user ("Ștefan" raspunde "Ștefan" in istoric, nu "Stefan").
  - Atat `/search` cat si `/bulk` trec prin `executeSearch` → comportament simetric automat.
  - Rezultatul: RNPM primeste mereu "Stefan", "Dragoslav", etc. Fara diacritice — cf. nota oficiala "aplicatia nu gaseste nimic cu diacritice".
  - `captchaKey` / `type` / `gcode` / `searchId` nu sunt atinse.
- **Filtru local diacritic-insensibil** (`backend/src/db/schema.ts` + `backend/src/db/avizRepository.ts`):
  - Inregistrat SQLite scalar function `rnpm_norm(x) = lower(stripDiacritics(x))` prin `db.function()` — per-connection, `deterministic: true`.
  - `getAvize()` searchText rescris: `rnpm_norm(col) LIKE ? ESCAPE '\'` pe 9 coloane (identificator, tip, utilizator_autorizat, creditor denumire/cod/cnp, debitor denumire/cod/cnp). JS normalizeaza parametrul o singura data (`stripDiacritics(q).toLowerCase()`) si escape-uieste `%` / `_` / `\` pentru a fi tratate literal (pattern `replace(/[\\%_]/g, "\\$&")`).
  - Rezultat: user tasteaza "stefan" → gaseste salvat "Ștefan", "STEFAN", "stefan". User tasteaza "a%b" → gaseste DOAR literal "a%b", nu orice string care contine "a". Fara migratii, fara reindex.

### Frontend
- **CUI numeric warning** (`frontend/src/components/rnpm/RnpmSearchForm.tsx`):
  - Helper `findNonNumericCui(obj)` walk pe params-ul *construit* (dupa filtrul per-activeType, deci nu valideaza CUI-uri din tab-uri inactive).
  - Daca gaseste `CUI.value` cu `/\D/`, `window.confirm("Atentie: CUI "X" contine caractere non-numerice. Continui cautarea?")` — non-blocking, user alege.

### Scope isolation — de ce nu afecteaza Dosare / Termene
- `backend/src/db/schema.ts::getDb()` e folosit DOAR de `avizRepository.ts` si `searchRepository.ts` (ambele RNPM).
- `stripDiacriticsDeep` importat DOAR in `services/rnpmSearchService.ts` (RNPM-only).
- PortalJust cautari (Dosare / Termene) nu trec prin SQLite locala, nu trec prin `/api/rnpm/*`.
- Verificare tipuri: frontend `npx tsc --noEmit` → clean.
- Smoke tests:
  - `SELECT rnpm_norm('Ștefan')` → `'stefan'`.
  - `stripDiacriticsDeep({denumire:{value:'Ștefan'}})` → strip pe .value, structura preservata.
  - `executeSearch` round-trip: `input.params` keeps "Ștefan", RNPM payload gets "Stefan". `params_json` persistence unchanged.
  - LIKE escape: seed "A%B" / "a_z" / "Ștefan" / "abc123" → search "%" gaseste doar "A%B"; "_" gaseste doar "a_z"; "stefan" gaseste "Ștefan"; "abc" gaseste "abc123".

---

## Update 2026-04-17 — Stop abort chain + categoria 5 (obligatiuni) + filtre baza locala

Detalii complete in `CHANGELOG.md` sectiunea "17 Aprilie 2026 — Butonul Stop RNPM ..." + "17 Aprilie 2026 — Categorie noua, filtru data ...". Sinteza:

### Stop RNPM cap-coada
Abort chain corect propagat UI → fetch → ruta Hono → service → solver captcha + fetch-uri RNPM + detalii. Fix final: butonul **Stop** morfa `type="button"` → `type="submit"` intre click si commit (React 18 DOM node reuse) → browser auto-submita form-ul. Rezolvat cu `key` distincte pe cele doua butoane (unmount + mount). Validat manual in Electron: click Stop revine imediat la "Cauta", fara avize partiale persistate.

### Categoria 5 — Obligatiuni ipotecare (end-to-end)
PLAN.md mentioneaza categoria la endpoint + schema, dar stub-ul `RnpmSearchParams` omite cheile specifice. Adaugate: `agentPJ` / `agentPF` / `emitent` (PJ) / `bunGarantie.descriere` — confirmate prin captura Network pe site-ul oficial. Form-ul are `PartyFieldset` Agent (PJ/PF) + `PJBlock` Emitent + Input descriere; dropdown **Tipul avizului** cu 9 valori identice cu "creante". Disponibila in tab-urile Cautare, Bulk, Baza locala.

### Baza locala — filtre + integritate
- `rnpm_avize` filtru `dataStart`/`dataStop` pe interval (data stocata "dd.mm.yyyy" → convertita in ISO in SQL via `substr()`).
- `rnpm_bunuri.referinte_json` — migrare idempotenta (`PRAGMA table_info` + `ALTER TABLE`). Stocheaza `JSON.stringify(referinte)` array de `BunPartyRef` (constituitor / tert) per bun. Deblocheaza `BunRefRow` in DetailModal cu culori distincte (sky / amber).
- `deleteAllAvize` tranzactional: sterge `rnpm_avize` (CASCADE pe copii) + `rnpm_searches` explicit (search_id e ON DELETE SET NULL, nu CASCADE).
- `getAvizeByIds` bulk fetch pentru export PDF/Excel (max 500 id-uri, aliniat cu `EXPORT_BODY_LIMIT` 64KB).

### Rafinari UI (non-abort)
- `RnpmDetailModal` — 5 tab-uri navigabile (General/Creditori/Debitori/Bunuri/Istoric), count badge per tab, smooth scroll la tab-switch.
- `RnpmSavedData` — filtre data range + reset + confirm dubla la "Sterge tot".
- `RnpmBulkSearch` — icon per phase (Loader2 → CheckCircle2/XCircle), estimare durata/cost, hard limit `MAX_BATCH=100`.

### Verificare
- `npx tsc --noEmit` (frontend + backend) — clean.
- `npx vitest run` — **24/24 verde**.
- Reproducere manuala in Electron: Stop / obligatiuni search / filtru data / Sterge tot — toate comportamente OK.

### Ramas pentru urmatoarea sesiune
- **Verificat comportamentul cautare dupa aviz**: user a semnalat ca trebuie confirmat daca la cautarea dupa **identificatorul unui aviz** rezultatele includ si **avizele de modificare** corespunzatoare (identificator nou, referinta catre cel initial). Comportament potential de completat dupa verificare manuala + captura Network pe site-ul oficial RNPM.

---

## Update 2026-04-18 — Performanta RNPM + backup zilnic + dialog confirmare stilizat

Detalii complete in `CHANGELOG.md` sectiunea "18 Aprilie 2026 — Mini-lag RNPM rezolvat + backup zilnic + dialog confirmare stilizat". Sinteza:

### Performanta — tab-enter instant + click pe aviz instant
- **A. Keep-mounted RnpmSavedData**: conditional render → `hidden` class, elimina unmount/remount la tab switch (state + scroll persist).
- **D. Cache in-memory aviz detail** (`avizDetailCache`, TTL 60s): elimina round-trip + 5 query-uri repository la re-deschidere. Invalidat la delete (single / batch / all).
- **E. Prewarm SQLite page cache la bootstrap**: `getAvize({limit:1}) + getAvizStats()` dupa `serve(...)` — prima interactiune nu mai plateste cold-start.

### Backup zilnic automat (reziliente date cu mii de avize)
- `backend/src/db/backup.ts` — `runDailyBackup()` via `better-sqlite3` online backup API, WAL-safe, fara checkpoint.
- `<userData>/backups/legal-dashboard.YYYY-MM-DD.db` — skip `<24h`, rotatie la 7 fisiere (lexicografic = cronologic gratie ISO in nume).
- Endpoints noi: `POST /api/rnpm/open-backups-folder`, `DELETE /api/rnpm/backups` (returneaza `{deleted}`).

### Dialog de confirmare stilizat (inlocuieste `window.confirm()`)
- `frontend/src/components/ui/confirm-dialog.tsx` — `ConfirmProvider` + `useConfirm()` hook Promise-based; `AlertTriangle` pentru destructive; Esc/Enter; click-outside.
- 4 call-site-uri migrate: sterge aviz / batch / all + warning CUI invalid.

### "Info baza locala" — management backups + relabel
- Butoane noi: **Folder baza** (relabel din "Deschide folder"), **Backups** (open folder), **Sterge back-up** (delete all backups), **Sterge baza** (relabel din "Sterge tot", delete toate avizele). Ultimele doua grupate impreuna spre dreapta.

### Fix UI conex — DosareTable timeline sedinte
Efect secundar al font-scale bump din commit `dd05b05`: data taiata + cerc-marker nealiniat. Ajustat `w-[60px]→w-[80px]`, `left-[72px]→left-[92px]`, `mt-1→mt-1.5`.

### Verificare
- `npx tsc --noEmit` (frontend + backend) — clean.
- Build reproductibil (`node scripts/build.js`), backend bundle 1.7mb.
- Manual in Electron: log `[backup] saved legal-dashboard.2026-04-18.db` prezent la bootstrap; fisierul exista in `%APPDATA%/legal-dashboard/backups/`; tab-switch si click aviz instant; confirmarile folosesc dialog stilizat.
