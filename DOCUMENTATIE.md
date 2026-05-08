# Legal Dashboard — Documentatie Completa

## Descriere Generala

Aplicatie desktop (Electron) + build web viitor pentru:
1. Cautarea dosarelor si termenelor in instantele romanesti via API-ul SOAP public al Ministerului Justitiei (portalquery.just.ro).
2. Interogarea Registrului National de Publicitate Mobiliara (RNPM / mj.rnpm.ro) cu persistenta SQLite locala.
3. Analiza juridica AI multi-provider (Claude, OpenAI, Gemini) in mod single-agent sau multi-agent (2 analisti + judecator).

- **Versiune curenta**: **v2.20.3** (8 Mai 2026, hardening RNPM post-/full-review — audit `rnpm.cap_hit` corelat cu `requestId` din envelope si purjat 90z prin migration 0017, SSE diferentiaza `aborted`/`timeout`/`error`, fail-fast K=3 pe upstream throttling, `captchasUsed` acumulat din retries, allow-list canonica `subTypeLabels` cu helper `rnpmSubTypes.ts`, kill switch `RNPM_AUDIT_CAP_HIT_DISABLED=1`). Pentru istoric complet vezi [CHANGELOG.md](CHANGELOG.md) si in-app changelog (`/changelog`).
- **AppId**: `ro.legaldashboard.app`
- **Produs**: `Legal Dashboard`
- **Platforme**: Windows (NSIS installer, x64), macOS (DMG, x64 + arm64), Web (build standalone viitor)
- **Limba interfata**: Romana

Istoric detaliat in [CHANGELOG.md](CHANGELOG.md) si in pagina `Changelog` din aplicatie (export PDF disponibil).

---

## Structura Proiect

```
legal-dashboard/
├── frontend/                 # React 18.3 + TypeScript + Vite
│   └── src/
│       ├── pages/            # Dashboard, Dosare, Termene, RnpmSearch, Changelog, Manual
│       ├── components/
│       │   ├── rnpm/         # RnpmSearchForm, RnpmBulkSearch, RnpmSavedData, RnpmDetailModal, RnpmRestoreModal, RnpmSavedStats, RnpmResultsTable
│       │   ├── ui/           # shadcn-style primitives
│       │   └── ...           # Sidebar, DosareTable, TermeneTable, MetricsPanel, CalendarView, InstitutieSelect, SearchForm, DosarModal, sidebar-footer, ...
│       ├── hooks/            # useTheme, useFontSize, useApiKey, useSearchHistory, useRnpmHistory, useDialog
│       ├── lib/              # api.ts, rnpmApi.ts, export.ts, rnpmExport.ts, changelog-pdf.ts, institutii.ts, utils.ts, chart-colors.ts
│       ├── data/             # changelog-entries.tsx
│       └── types/            # desktop-api.d.ts, rnpm.ts, index.ts
├── backend/                  # Node 22 + Hono (port 3002)
│   └── src/
│       ├── index.ts          # Bootstrap: CSP, CORS, mount routes, loopback-guard, prewarm, shutdown hook
│       ├── routes/
│       │   ├── dosare.ts     # GET /api/dosare, POST /api/dosare/load-more (SOAP PortalJust)
│       │   ├── termene.ts    # GET /api/termene, POST /api/termene/load-more
│       │   ├── ai.ts         # POST /api/ai/analyze, /analyze-multi (proxy Claude/OpenAI/Gemini)
│       │   └── rnpm.ts       # search / bulk / saved / stats / backup / restore / captcha
│       ├── services/
│       │   ├── ai.ts                 # model registry, cost calculators
│       │   ├── batch-dosare.ts       # batch analysis orchestration (AbortSignal)
│       │   ├── rnpmClient.ts         # low-level RNPM HTTP client
│       │   ├── rnpmSearchService.ts  # per-type search + detail parsing + persist
│       │   └── captchaSolver.ts      # 2Captcha + CapSolver (sequential / race mode)
│       ├── middleware/
│       │   ├── rate-limit.ts         # real-IP rate limiter (30 req/min default)
│       │   └── static-frontend.ts    # SPA serving cu path-traversal guard
│       ├── db/
│       │   ├── schema.ts             # WAL, migrations idempotente, VACUUM, compact
│       │   ├── searchRepository.ts   # rnpm_searches CRUD
│       │   ├── avizRepository.ts     # rnpm_avize + creditori/debitori/bunuri/istoric (cursor pagination)
│       │   └── backup.ts             # snapshot zilnic online (db.backup), retain 7
│       ├── util/                     # textNormalize (diacritics), validation (shared payloads)
│       ├── soap.ts                   # SOAP client PortalJust (regex-based parsing)
│       └── intervals.ts              # helper intervale date
├── electron/
│   ├── main.js               # BrowserWindow, single-instance lock, safeStorage IPC, nativeTheme, CSP
│   └── preload.js            # contextBridge — doar safeStorage + setWindowTheme
├── scripts/
│   ├── build.js              # frontend (Vite) + backend (esbuild -> CJS) + copy
│   └── build-server.js       # build standalone server (fara Electron)
├── build/                    # Icons (icon.ico, icon-1024.png)
├── dist-frontend/            # output Vite (renderer)
├── dist-backend/             # output esbuild (index.cjs + assets)
├── release/                  # output electron-builder (installer .exe, .dmg)
├── CHANGELOG.md
├── SECURITY.md               # threat model + protectii + scope out-of-scope
├── DOCUMENTATIE.md           # acest fisier
└── README.md
```

---

## Stack Tehnologic

### Frontend
- **React 18.3** + **TypeScript 5.5**
- **Vite 5.4** (dev server + build, port 5173)
- **Tailwind CSS 3.4** + primitive UI proprii (shadcn-style)
- **Recharts 3.8** (statistici RNPM, MetricsPanel dosare/termene)
- **Lucide React** (iconite)
- **date-fns 3.6** + **react-day-picker 8.10** (calendar termene)
- **DOMPurify 3.4** (sanitizare renderere AI)
- **xlsx 0.18** + **xlsx-js-style 1.2** (export Excel stilizat, dynamic import)
- **jsPDF 2.5** + **jspdf-autotable 3.8** (export PDF, dynamic import)

### Backend
- **Node.js ≥ 22** (ruleaza .ts direct cu `--experimental-strip-types`)
- **Hono 4.12** + **@hono/node-server 1.19**
- **better-sqlite3 12.9** (WAL, online backup API, VACUUM)
- **dotenv 16** (`backend/.env`)
- SOAP XML parsat manual (regex, zero dependenta externa XML)

### AI SDKs
- **@anthropic-ai/sdk 0.90** — Claude Haiku/Sonnet/Opus 4.x
- **openai 6.33** — GPT-5.4 via Responses API
- **@google/generative-ai 0.24** — Gemini 3.x

### Captcha
- **@2captcha/captcha-solver 1.3** — 2Captcha (provider principal)
- **CapSolver** — implementare proprie HTTP (provider alternativ / race)

### Desktop
- **Electron 41** + **electron-builder 26**
- **esbuild 0.27** (backend bundle -> CJS, pentru compatibilitate require() in Electron)
- NSIS installer Windows (per-user, fara elevare admin)
- DMG macOS (x64 + arm64)

---

## Comenzi

| Comanda | Descriere |
|---|---|
| `npm install` | Instaleaza root + workspaces (backend + frontend) |
| `npm run dev:backend` | Backend dev server pe 3002 cu `--watch --experimental-strip-types` |
| `npm run dev:frontend` | Frontend Vite dev server pe 5173 |
| `npm run electron:dev` | Porneste Electron (backend bundle + window) |
| `npm run build` | Build frontend (Vite) + backend (esbuild -> dist-backend/index.cjs) |
| `npm run dist` | Build + `electron-builder --win` (NSIS) |
| `npm run dist:mac` | Build + `electron-builder --mac` (DMG) |
| `npm run dist:all` | Build + installer Windows + macOS |
| `npm run dist:server` | Build standalone server (fara Electron) |
| `npm test --workspace=backend` | Vitest pe backend (suite cu teste `intervals`, `soap`, etc.) |
| `npx tsc --noEmit -p backend/tsconfig.json` | Type-check backend |
| `cd frontend && npx tsc --noEmit` | Type-check frontend |

Primul boot creeaza DB-ul la `app.getPath("userData")/legal-dashboard.db` (Windows: `%APPDATA%\legal-dashboard\legal-dashboard.db`). Backup-urile zilnice sunt in sub-directorul `backups/` de langa DB.

---

## Pagini si Functionalitati

### 1. Dashboard (`/`)

- Hero + descriere
- **Ultima Cautare** — carduri sumar (numar dosare, categorii, institutii, parte)
- **Feature cards** — navigare rapida catre Dosare / Termene / RNPM
- **Tipuri de Procese** — grid tematic
- **API Info** — endpoint SOAP, limite
- **Versiune** — badge + butoane „Vezi Noutati" (Changelog modal) / „Manual"
- **Dashboard persistent** — ultima sesiune de cautare si metricile sunt restaurate la boot

### 1b. Manual de Utilizare

- 12 capitole integrate in `frontend/src/pages/Manual.tsx`, cuprins interactiv
- Export PDF via `exportManualPDF()` din `lib/export.ts` (Portrait A4, cover, cuprins, footer pe fiecare pagina)
- Accesibil ca modal full-screen din Dashboard

### 1c. Cautare RNPM (`/rnpm`)

Trei tab-uri (`Cautare` / `Bulk` / `Baza locala`) + modal detaliu partajat (`RnpmDetailModal`).

**Persistenta taburi UI**: cand utilizatorul schimba intre `Cautare` / `Bulk` / `Baza locala`, tab-ul `Cautare` ramane montat si isi pastreaza categoria RNPM activa din cele 5, campurile completate si rezultatul vizibil. Rezultatele live sunt scoped pe categoria in care au fost obtinute: o cautare din `ipoteci` nu ramane vizibila cand utilizatorul trece pe `fiducii`, `specifice`, `creante` sau `obligatiuni`.

**5 categorii (tab-uri in formular)**:
- `ipoteci` — Aviz de ipoteca mobiliara (debitor / creditor / destinatie / vehicul / bun alt tip / tert cedat)
- `fiducii` — Fiducie (constituitor / fiduciar / beneficiar / vehicul)
- `specifice` — Aviz specific (parte / bun mobil categorie + identificare)
- `creante` — Aviz de ipoteca — creante securitizate (reprezentant creditor PJ / debitor / descriere bun)
- `obligatiuni` — Aviz de ipoteca — obligatiuni ipotecare (agent PJ/PF / emitent PJ / descriere bun garantie)

**Campuri comune**: identificator inscriere, tip inscriere, perioada (start/final), tip act, nr act, data act, checkbox „Numai active" / „Nemodificate de alte inscrieri".

**SI/SAU**: combinator boolean pe campuri cu doua variante (ex: nume + prenume). `1 = SI` (intersectie), `2 = SAU` (uniune).

**Captcha**: reCAPTCHA v2 rezolvat automat prin **2Captcha** sau **CapSolver** (cu fallback 2Captcha opt-in). Mod `sequential` (incearca provider-ul principal, apoi fallback) sau `race` (trimite la ambii in paralel prin `Promise.race`). Configurare in dialog „Setari AI" → card 2Captcha / CapSolver.

**Buton Stop**: opreste cap-coada — captcha (primeste abort prin `Promise.race`), fetch RNPM, fetch detalii paralele, persist SQLite. Abort chain propagat UI → fetch → Hono → service (HTTP 499 pe server).

**Bulk**: procesare liste (max 200/batch) de CUI / CNP / denumire pe camp ales. Progress per item prin SSE (phase: `captcha` → `search` → `details` → `done`/`error`). Hard timeout 10 min per batch.

**Baza locala**: browser SQLite cu filtre cursor-paginate:
- Text `q` — diacritic-insensitive pe 9 coloane (identificator / tip / utilizator + creditori/debitori denumire / cod / cnp). Folosit prin scalarul SQLite `rnpm_norm` (NFD + strip diacritics + lowercase, inregistrat per-connection).
- `searchType` — dropdown pe cele 5 categorii
- `activ` — checkbox „Doar active"
- `dataStart`/`dataStop` — interval ISO, comparat pe substr-conversia „dd.mm.yyyy" → ISO
- Cursor `Incarca mai multe` (50 per pagina)
- **Sterge tot** — dubla confirmare, tranzactional (avize CASCADE + searches)
- **Compact** (`VACUUM`) — buton UI care ruleaza PRAGMA wal_checkpoint(TRUNCATE) + VACUUM + re-checkpoint si afiseaza dimensiunea recuperata
- **Backup/Restore** — snapshot zilnic automat, retain 7 fisiere; restore via UI cu confirmare

**Detail modal (5 tab-uri)**: General / Creditori / Debitori / Bunuri (`BunRefRow` constituitor vs tert) / Istoric. Descrierile bunurilor sunt dedup-ate printr-o tabela lookup (`rnpm_bunuri_descrieri`) — vezi sectiunea SQLite.

**Avize modificatoare**: coloane `inscriere_initiala_id/uuid` + `inscriere_modificata_id/uuid` populate pe avizele de modificare, pentru a pastra linkul catre parinte. Cautarea locala returneaza parinte + modificari; fetch-ul live RNPM ramane narrow (nu auto-follow).

**Statistici** (RnpmSavedStats): distributie pe tip, top creditori, top debitori, per luna.

**Export PDF / Excel**: max 500 avize per operatie (`getAvizeByIds` bulk).

### 2. Cautare Dosare (`/dosare`)

- **Formular**: numar dosar, obiect, nume parte, selector institutii, interval date
- **Selector Institutii (Multi-Select)**: 246 instante din WSDL, grupate pe 7 categorii (Curti de Apel 15 / Tribunale 42 / Tribunale Specializate 1 / Comerciale 3 / Militare 5 / Curti Militare 1 / Judecatorii 179). Cautare diacritice-insensitiva, chips, buton reset, counter.
- **Cautare paralela SOAP** cand sunt selectate mai multe institutii (`Promise.all`, cap 50 institutii / request).
- **Filtrare duala**: server-side (SOAP query) + client-side (post-fetch pe institutii / categorii / stadii / roluri parti).
- **MetricsPanel**: carduri statistici clickabile ca filtre multiple-choice.
- **DosareTable**:
  - Coloane sortabile: numar, data, institutie
  - Paginare (10/15/25/50/100) + selector pagina + navigare directa
  - Checkbox per rand + select all/deselect all
  - Export Excel/PDF pe selectie sau pe tot
  - Rand expandabil: grid info (Data, Departament, Categorie, Stadiu), Obiect, Parti (cu highlight diacritic-aware pe numele cautat), Sedinte (timeline cu data/ora/complet/solutie/document), link portal.just.ro
- **Analiza AI per dosar** (panel dedicat) — single-agent sau multi-agent.
- **Load-more** via `POST /api/dosare/load-more` cu AbortSignal.

### 3. Termene & Calendar (`/termene`)

- Formular identic cu Dosare
- **Dual view**: Tabel sau Calendar (toggle)
- **TermeneMetrics**: Viitoare / Trecute / Cu Solutie (logica OR, multiple-choice)
- **TermeneTable**:
  - Coloane: Numar Dosar, Data, Ora, Institutie, Complet, Solutie
  - Badge „Viitor" pe termenele viitoare
  - Rand expandabil: Categorie, Stadiu, Obiect, Solutie completa, Parti
  - Paginare (10/20/50/100), chei de selectie stabile cu dedup pe load-more
  - Export Excel/PDF
- **CalendarView**: vizualizare per luna/zi cu detalii expandabile si linkuri portal

### 4. Changelog

- Istoric complet al versiunilor in `frontend/src/data/changelog-entries.tsx`
- Fiecare versiune: titlu, data, subtitle, icon, badge, sectiuni cu bulleturi
- Accesibil ca modal din Dashboard sau ca pagina standalone din Sidebar
- **Export PDF** — `frontend/src/lib/changelog-pdf.ts` genereaza un document Portrait A4 cu cover page colorata, cuprins, banner per versiune in culoarea cardului si footer cu numar pagina. `jsPDF` dynamic import, caractere Unicode transliterate la Latin-1 (Helvetica = WinAnsi, fara suport diacritice).

---

## Modul RNPM (detaliu tehnic)

### Flux search live (`POST /api/rnpm/search`)

1. Client trimite `{ type, params, captchaKey, captchaProvider?, fallback2CaptchaKey?, startRnpmPage?, batchSize?, gcode?, searchId? }`.
2. Backend rezolva reCAPTCHA v2 prin `captchaSolver` (sequential sau race).
3. `rnpmClient` apeleaza mj.rnpm.ro cu gcode-ul rezolvat → pagina cu rezultate.
4. Parser per-type extrage ID-urile si baza de metadate (shape-ul raspunsului difera intre `ipoteci` / `fiducii` / `specifice` — parser-ul bifurca pe `searchType`).
5. Fetch detalii paralel (concurrency 7) → extragere creditori / debitori / bunuri / istoric.
6. Persist tranzactional in SQLite (search row + avize + child tables).
7. Raspuns: `{ searchId, total, pagesTotal, pageSize, currentPage, criteriu, documents[], avizIds[], detailsFailed[], gcode, nextRnpmPage }`.

### AbortSignal cap-coada

Client-ul trimite signal prin `AbortController`. Serviciul propaga:
- catre `captchaSolver` (Promise.race cu aborted)
- catre fiecare fetch RNPM individual
- catre inserturile SQLite (checkpoint inainte sa throw-eze)

Serverul raspunde cu HTTP 499 cand signalul se activeaza (semantica Nginx pentru client closed request).

### Bulk (`POST /api/rnpm/bulk`)

- Input: `{ items: { type, params, label? }[], captchaKey, captchaProvider?, fallback2CaptchaKey? }` (max 200 items, 512KB total).
- SSE streaming `event: progress` per item cu `{ index, total, label, phase, resultCount?, searchId?, error? }`.
- Hard timeout 10 min per batch. SOAP fanout intern capat.

### Baza locala (SQLite)

Vezi sectiunea SQLite pentru schema completa. Filtre:
- `GET /api/rnpm/saved?limit=50&cursor=<id>&searchType=...&activ=1&q=...&dataStart=...&dataStop=...`
- `GET /api/rnpm/saved/:id` — detaliu full (aviz + creditori + debitori + bunuri cu `referinte_json` + istoric).
- `DELETE /api/rnpm/saved/:id` si `DELETE /api/rnpm/saved/all` (tranzactional, CASCADE).
- `POST /api/rnpm/saved/delete-batch` — sterge un subset de id-uri intr-o tranzactie.
- `POST /api/rnpm/saved/export` — max 500 ids, bulk fetch.
- `GET /api/rnpm/stats` — distributii + top creditori/debitori.
- `GET /api/rnpm/searches` si `DELETE /api/rnpm/searches/:id` — audit trail al cautarilor salvate.

### Backup / Restore / Compact

- `runDailyBackup()` (pornit la boot) — skip daca ultimul fisier e < 24h. Foloseste `db.backup()` online (nu blocheaza writer-ul curent). Retentie: ultimele 7 fisiere `legal-dashboard.YYYY-MM-DD.db`.
- `GET /api/rnpm/backups` — listeaza fisierele din `backups/`.
- `POST /api/rnpm/backups/restore` — restore cu confirmare UI (se face prin `RnpmRestoreModal`).
- `DELETE /api/rnpm/backups` — curatenie manuala.
- `POST /api/rnpm/compact` — VACUUM + WAL truncate; raporteaza `beforeBytes`/`afterBytes`/`durationMs`.
- `POST /api/rnpm/open-db-folder` + `POST /api/rnpm/open-backups-folder` — deschid folderele in file manager (via IPC Electron, validate).

### Captcha

- `POST /api/rnpm/captcha/balance` — `{ captchaKey, captchaProvider? }` → verifica soldul la provider.
- Modurile `sequential` / `race` configurabile per sesiune in `Setari AI`.

---

## Asistenta AI

### Provideri si Modele

| Provider | Model | Key interna | Model ID |
|---|---|---|---|
| **Anthropic** | Claude Haiku 4.5 (Rapid) | `claude-haiku` | `claude-haiku-4-5-20251001` |
| | Claude Sonnet 4.6 (Echilibrat) | `claude-sonnet` | `claude-sonnet-4-6` |
| | Claude Opus 4.6 (Premium) | `claude-opus` | `claude-opus-4-6` |
| **OpenAI** | GPT-5.4 nano (Rapid) | `gpt-5.4-nano` | `gpt-5.4-nano` |
| | GPT-5.4 mini (Echilibrat) | `gpt-5.4-mini` | `gpt-5.4-mini` |
| | GPT-5.4 (Premium) | `gpt-5.4` | `gpt-5.4` |
| **Google** | Gemini 3.1 Flash Lite (Rapid) | `gemini-flash-lite-3` | `gemini-3.1-flash-lite-preview` |
| | Gemini 3 Flash (Echilibrat) | `gemini-flash-3` | `gemini-3-flash-preview` |
| | Gemini 3.1 Pro (Premium) | `gemini-pro-3` | `gemini-3.1-pro-preview` |

Modele permise ca **judecator** in multi-agent: `claude-opus`, `gpt-5.4`, `gemini-pro-3`.

### Autentificare AI

- Cheile se introduc din UI (`Setari AI`) sau prin `backend/.env` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_KEY`).
- **Storage (desktop)**: UI-ul cripteaza blob-ul JSON cu cheile prin IPC `safeStorage:encrypt` (OS keystore — DPAPI pe Windows, Keychain pe macOS, libsecret pe Linux). Ciphertext-ul base64 este tinut in `localStorage` (cheia `portaljust-api-keys-enc`). Plaintext-ul nu atinge discul si traieste doar in memorie in timpul encrypt/decrypt.
- **Fallback**: cand OS keystore-ul este indisponibil (`isEncryptionAvailable() === false`), cheile nu sunt persistate (UI afiseaza stare „cannot save"). Legacy-ul obfuscat (XOR + base64 + reverse) din versiunile < v2.0.2 este citit o singura data la migrare, re-criptat via `safeStorage`, apoi sters.
- **Per-request**: cheile sunt trimise in body-ul JSON al requestului AI. Nu se stocheaza server-side intre requesturi.
- Cap marime plaintext `safeStorage`: **8 KB** | cap marime ciphertext base64: **16 KB**.

### Analiza Simpla (single-agent)

- Endpoint: `POST /api/ai/analyze`
- Body: `{ dosar, model, apiKeys? }` (cap 100 KB)
- Schema validation pe body complet
- Prompt injection defense: date in `<dosar_data>` delimiters + truncare campuri (`obiect` 500, `numeParte` 200, `solutie` 10000)
- Timeout: 60s per apel
- Raspuns: `{ analysis: string }` cu 7 sectiuni (Rezumat / Parti / Starea actuala / Istoricul sedintelor / Ce ar putea urma / Temei juridic / Legaturi)

### Analiza Avansata (multi-agent)

- Endpoint: `POST /api/ai/analyze-multi`
- Body: `{ dosar, analysts: [string, string], judge: string, apiKeys? }`
- 2 analisti in paralel (`Promise.all`) + 1 judecator secvential
- Judecatorul primeste datele originale + ambele analize in `<analiza_1>`/`<analiza_2>` delimiters; verifica, reconciliaza contradictii, corecteaza interpretari gresite.
- Judecatorul prezinta rezultatul ca analiza unitara (nu mentioneaza ca a primit doua analize).
- Rate limiter: consuma **3 unitati** (vs 1 pentru alte endpoints).
- Raspuns: `{ analyses: { analyst1, analyst2 }, judge: { model, text }, final: string }`
- UI: sectiune colapsabila cu selectori model inainte de trigger; dupa analiza, toggle pentru vizualizare side-by-side a analizelor individuale.

### Export PDF Analiza

- Single-agent si multi-agent, format Portrait A4 paleta warm gray.
- Header minimal (titlu + subtitlu + data), card info dosar, continut formatat markdown (heading-uri, bullets, paragrafe), page breaks inteligente (titlul nu ramane orfan), footer per pagina „Legal Dashboard".
- Strip diacritice (limitare font Helvetica — WinAnsi).

---

## Backend — API Endpoints

### Core
- `GET /health` → `{ status: "ok", service: "Legal Dashboard API" }`. Verificat de Electron la boot ca check de identitate anti-port-hijacking.

### Dosare / Termene (SOAP PortalJust)
- `GET /api/dosare` — query: `numarDosar`, `obiectDosar`, `numeParte`, `institutie` (string sau array), `dataStart`, `dataStop`. Validare: max 200 chars/param, control chars respinsi, date reale, max 50 institutii. Cautare SOAP paralela. Raspuns: `{ data: Dosar[], total: number }`.
- `POST /api/dosare/load-more` — paginare server-side pentru rezultate mari.
- `GET /api/termene` / `POST /api/termene/load-more` — aceeasi semantica; extrage sedintele din dosare, sorteaza descrescator dupa data.

### AI
- `POST /api/ai/analyze` (vezi sectiunea AI)
- `POST /api/ai/analyze-multi` (vezi sectiunea AI)

### RNPM
- `POST /api/rnpm/search` — search live (rate limit dedicat `limitSearch`)
- `POST /api/rnpm/bulk` — batch cu SSE (rate limit `limitBulk`)
- `GET /api/rnpm/saved` / `GET /api/rnpm/saved/:id` / `DELETE /api/rnpm/saved/:id` / `DELETE /api/rnpm/saved/all`
- `POST /api/rnpm/saved/delete-batch` / `POST /api/rnpm/saved/export` (`limitExport`)
- `GET /api/rnpm/stats`
- `GET /api/rnpm/searches` / `DELETE /api/rnpm/searches/:id`
- `GET /api/rnpm/backups` / `DELETE /api/rnpm/backups` / `POST /api/rnpm/backups/restore` (`limitSmall`)
- `POST /api/rnpm/open-db-folder` / `POST /api/rnpm/open-backups-folder`
- `POST /api/rnpm/compact`
- `POST /api/rnpm/captcha/balance` (`limitSmall`)

### Middleware

- `secureHeaders` (Hono) cu CSP strict (`default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `style-src 'self' 'unsafe-inline'` pentru Tailwind).
- `cors` — permis doar pe `http://localhost:5173` / `4173` (dev).
- `rateLimit` — aplicat pe `/api/*`, cu cozi separate per endpoint (`limitSearch` / `limitBulk` / `limitExport` / `limitSmall`).
- `mountStaticFrontend` — SPA fallback cu guard anti-path-traversal (`path.relative` + `decodeURIComponent` defensiv).

### Config runtime

| Variabila | Default | Descriere |
|---|---|---|
| `LEGAL_DASHBOARD_PORT` | `3002` | Portul backend-ului |
| `HOST` | `127.0.0.1` | Host bind. LAN blocat fara opt-in. |
| `LEGAL_DASHBOARD_ALLOW_REMOTE` | `""` | `1` = permite HOST non-loopback (opt-in explicit) |
| `LEGAL_DASHBOARD_DB_PATH` | `process.cwd()/legal-dashboard.db` (dev) sau `app.getPath('userData')/legal-dashboard.db` (Electron) | Locatia DB |
| `NODE_ENV` | `"production"` in Electron, `"development"` in dev | Controleaza static-serving |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_AI_KEY` | — | Chei AI din .env (au precedenta asupra celor trimise din UI) |

---

## SOAP Client (portalquery.just.ro)

- Endpoint: `http://portalquery.just.ro/query.asmx`
- Metoda: `CautareDosare` (SOAP 1.1)
- Timeout: 30 secunde
- **Diacritice legacy**: conversie Unicode modern (comma-below) → cedilla (cerinta SOAP)
- **XML escape**: `&`, `<`, `>`, `"`, `'` + stergere control chars
- **Parsing**: regex `extractFirst()` / `extractAll()` (fara dependenta XML)
- **Extrage**: numar, data, institutie, departament, categorieCaz, stadiuProcesual, obiect, parti[], sedinte[]
- Sanitizare SOAP fault (detalii doar in log-ul serverului)
- Teste unitare in `backend/src/soap.test.ts`

---

## SQLite (schema, migratii, WAL, backup)

### Tabele (`backend/src/db/schema.ts`)

```sql
rnpm_searches       (id, owner_id='local', search_type, params_json, total_results, criteriu, created_at)
rnpm_avize          (id, owner_id='local', uuid, identificator, search_type, tip, data,
                     utilizator_autorizat, activ, needs_actualizare, destinatie,
                     tip_act, numar_act, data_inreg, data_expirare, alte_mentiuni,
                     detalii_comune, detail_fetched, search_id,
                     inscriere_initiala_id, inscriere_initiala_uuid,
                     inscriere_modificata_id, inscriere_modificata_uuid,
                     created_at, updated_at,
                     UNIQUE(owner_id, identificator))
rnpm_creditori      (id, owner_id, aviz_id FK, tip_persoana, denumire, prenume, tip_entitate,
                     sediu, nr_identificare, cod, cnp, tara, localitate, judet, cod_postal,
                     alte_date, subscriptor, nr_ordine)
rnpm_debitori       (id, owner_id, aviz_id FK, tip_persoana, calitate, denumire, prenume, ...)
rnpm_bunuri         (id, owner_id, aviz_id FK, tip_bun, categorie, identificare,
                     descriere_id FK -> rnpm_bunuri_descrieri.id, model, serie_sasiu,
                     serie_motor, nr_inmatriculare, referinte_json)
rnpm_bunuri_descrieri (id, text UNIQUE)  -- lookup table pentru dedup descrieri legale
rnpm_istoric        (id, owner_id, aviz_id FK, identificator, uuid, data, tip,
                     inscriere_m_v, inscriere_m_k)
```

- Toate tabelele au `owner_id TEXT NOT NULL DEFAULT 'local'` pentru multi-user ready (bridge pre-web).
- Foreign keys ON (`PRAGMA foreign_keys = ON`) cu `ON DELETE CASCADE` pe relatiile avize → child.
- Index-uri pe `owner_id`, `identificator`, `search_type`, `data`, `aviz_id`, `cod`, `denumire` (cele accesate frecvent in UI).
- Scalar custom `rnpm_norm(s)` — NFD + strip diacritice + lowercase, inregistrat per-connection. Folosit de filtrul „Baza locala" `q` pentru match diacritic-insensitive cu LIKE meta-caractere escape-uite literal.

### Migratii idempotente

- Adaugare coloane `referinte_json`, `inscriere_initiala_id/uuid`, `inscriere_modificata_id/uuid`, `subscriptor`, `nr_ordine` — toate guard-ate cu `PRAGMA table_info` inainte de `ALTER TABLE`.
- **Dedup descriere**: migratie one-shot care muta textele din `rnpm_bunuri.descriere` in `rnpm_bunuri_descrieri` (unique). Necesara pentru ca acelasi clause legal era copiat ~2KB × mii de rows per aviz (fisierul crescuse la ~160MB la 500 avize). Pasi: `INSERT OR IGNORE` texte distinct non-empty → `UPDATE descriere_id` → `ALTER TABLE DROP COLUMN descriere` → `VACUUM` → `PRAGMA wal_checkpoint(TRUNCATE)`. Rularea e detectata pre-open (probe read-only) si triggeaza un **pre-migration backup** in `backups/legal-dashboard.pre-descriere-dedup-YYYY-MM-DD.db`.

### WAL & VACUUM

- `PRAGMA journal_mode = WAL` pentru concurenta read-dominanta.
- Boot check: daca fisierul `-wal` depaseste 32MB, ruleaza `PRAGMA wal_checkpoint(TRUNCATE)` o data ca sa previna bloat-ul dupa VACUUM / mass-UPDATE.
- `compactDb()` expus prin `POST /api/rnpm/compact` — executa TRUNCATE + VACUUM + TRUNCATE si raporteaza `beforeBytes` / `afterBytes` / `durationMs`. Modalul „Info baza locala" afiseaza dim. data + jurnal.

### Backup zilnic

- `runDailyBackup()` in `backend/src/db/backup.ts` porneste la boot. Skip daca ultimul fisier are mtime < 24h. Foloseste `db.backup()` (online, fara lock exclusiv). Retentie: ultimele 7.
- Pre-migration backup e separat (copie de fisier pre-open, nume `pre-<label>-<timestamp>.db`).

### Shutdown

- `closeDb()` idempotent (`before-quit` in Electron; `SIGTERM`/`SIGINT`/`beforeExit` in server mode). Flush-eaza WAL la final.
- Hook global: `globalThis.__legalDashboardShutdown` — expus prin backend-ul bundle-at ca `main.js` sa poata apela shutdown-ul backend-ului in-process inainte sa omoare procesul.

---

## Electron Desktop

### BrowserWindow

- Dimensionare dinamica: 85% latime × 90% inaltime din workArea, cap 1800×1100, min 900×600.
- `backgroundColor: "#090E1A"` — match pentru Tailwind `bg-background` dark (fara flash alb la boot).
- **Title bar custom** (Windows): `titleBarStyle: "hidden"` + `titleBarOverlay: { color: "#090E1A", symbolColor: "#E5E7EB", height: 32 }` — bara navy uniforma, in ton cu continutul dark. Sincronizata dinamic cu tema prin IPC `window:setTheme` (schimba si `nativeTheme.themeSource` → afecteaza si meniul nativ).
- `autoHideMenuBar: true` + `setMenuBarVisibility(false)` — meniul nativ e ascuns; cu `titleBarStyle: "hidden"` pe Windows, tasta Alt **nu** mai toggleaza bara (nu are suprafata unde sa apara). Meniul aplicatiei este construit totusi (`Menu.setApplicationMenu`) pentru acceleratori standard (Ctrl+R reload, Ctrl+P print, Ctrl+Q quit, Cmd+C copy, etc.).

### webPreferences (hardening)

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- `enableRemoteModule: false`
- `devTools: IS_DEV` (dezactivat in productie)

### Preload (`electron/preload.js`)

Expune exact 4 metode prin `contextBridge`, toate cu timeout IPC de 10s ca renderer-ul sa nu inghete la stall (DPAPI stuck, keychain prompt lockup):
- `encryptKeys(plaintext)` → `safeStorage:encrypt`
- `decryptKeys(ciphertextB64)` → `safeStorage:decrypt`
- `isEncryptionAvailable()` → `safeStorage:available`
- `setWindowTheme(theme)` → `window:setTheme`

### Single-instance lock

- `app.requestSingleInstanceLock()` — a doua instanta face `app.quit()` imediat. Previne doi writeri SQLite concurenti (corupere DB).
- `second-instance` event: restore + focus pe fereastra existenta.

### Startup

1. Single-instance check.
2. `whenReady()` → CSP header (`onHeadersReceived`), `registerSafeStorageIpc()`.
3. `startBackend()` — `require(dist-backend/index.cjs)` in proces, apoi polleaza `/health` la 200ms interval cu deadline de 30s.
4. **Identity check**: raspunsul `/health` trebuie sa contina `service: "Legal Dashboard API"` — anti-port-hijacking.
5. `createWindow()` + `buildAppMenu()`.
6. Esec startup → `dialog.showErrorBox` si `app.quit()`.

### Crash handlers

- `uncaughtException` — dialog + `app.exit(1)`. `NON_FATAL_CODES` (`EPIPE`, `EIO`, `ECONNRESET`, `ECONNABORTED`) sunt logate si ignorate ca sa nu scoata aplicatia la probleme benigne de IO.
- `unhandledRejection` — doar log.
- `before-quit` — apeleaza backend shutdown hook prin `globalThis.__legalDashboardShutdown` pentru WAL flush curat.

### Zoom bootstrap

- La `did-finish-load`, daca `getZoomLevel() === 0` (prima pornire / zoom nepersonalizat), aplica `setZoomLevel(-0.5778...)` — match pentru dimensiunea vizuala a aplicatiei PortalJust (~0.9x). Dupa ce utilizatorul foloseste Ctrl+/- o data, zoom-ul persistat per-origin are prioritate la repornire.
- Acceleratie hardware ramane ON default pe Windows (opt-out via `ELECTRON_DISABLE_GPU=1`).

### Navigare restrictionata

- `will-navigate` — permis doar `http://localhost:<PORT>` si `http://127.0.0.1:<PORT>`.
- `setWindowOpenHandler` — orice `window.open` este denied; linkurile validate (HTTPS + whitelist strict `portal.just.ro`, `www.just.ro`, `portalquery.just.ro`, `mj.rnpm.ro`, `www.rnpm.ro`) sunt deschise prin `shell.openExternal`. Restul sunt blocate.

### CSP

```
default-src 'self' http://localhost:<PORT>;
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self' http://localhost:<PORT>;
img-src 'self';
font-src 'self';
object-src 'none';
frame-ancestors 'none';
```

### Context menu

Right-click contextual: Copiaza (daca exista selectie), Lipeste (daca e editabil), Selecteaza tot, Printeaza.

### Packaging

- NSIS Windows: per-user, `allowElevation: false`, desktop + start menu shortcuts, installer/uninstaller icon.
- DMG macOS: x64 + arm64, `category: public.app-category.business`, layout drag-to-Applications.
- Files bundle-ate: `electron/`, `dist-backend/`, `dist-frontend/`, `node_modules/better-sqlite3`, `package.json`. `asarUnpack`: `dist-frontend` + `better-sqlite3` (nativ, nu merge in asar).

---

## Securitate

### Storage chei API
- Chei in OS keystore (DPAPI / Keychain / libsecret) prin `safeStorage`. Plaintext niciodata pe disc.
- Cap marime (anti-abuse): plaintext 8KB, ciphertext base64 16KB.
- Fallback graceful cand keystore-ul lipseste: UI arata „cannot save", nu se scrie plaintext nicaieri.

### Desktop hardening
- `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false`.
- Single-instance lock (anti-corupere SQLite).
- Navigare limitata la localhost; `shell.openExternal` doar cu whitelist strict.
- CSP riguros in Electron + `secureHeaders` in Hono.
- Identity check pe `/health` (anti-port-hijacking).

### Backend hardening
- Loopback-only bind by default (`127.0.0.1`); LAN exposure blocat fara `LEGAL_DASHBOARD_ALLOW_REMOTE=1`.
- Rate limit real-IP pe `/api/*` cu cozi separate per endpoint.
- Path-traversal guard pe static serving (`path.relative` + `decodeURIComponent` defensiv).
- Body size limits: AI 100KB, RNPM search 64KB, RNPM bulk 512KB.
- Schema validation pe payload-urile AI + RNPM (max depth 4, max 500 chars / camp string).
- Prompt injection defense: date in `<dosar_data>`/`<analiza_1>`/`<analiza_2>` delimiters + truncare campuri (obiect 500, numeParte 200, solutie 10000).
- Sanitizare SOAP fault (detalii in server log, nu in raspuns client).
- SOAP fanout cap: max 50 institutii / request.
- DOMPurify pe toate renderele AI (ALLOWED_TAGS: strong, em, b, i).
- **Formula injection fix**: exporturile Excel prefixeaza celulele care incep cu `=`, `+`, `-`, `@` cu apostrof literal (prevent `=IMPORTDATA(...)` cand userul deschide fisierul in Excel).
- **HTTP 499 abort**: serverul raspunde 499 cand client-ul face abort, asa ca rate-limit-urile nu consuma quota pentru request-uri moarte.
- Logging RNPM: doar type / page / field-names, niciodata valori PII.

### RNPM local store
- `owner_id` pe toate tabelele (bridge pre-web).
- `UNIQUE(owner_id, identificator)` previne duplicate pe acelasi aviz.
- `db.backup()` online nu blocheaza scriitorul (safe in productie).
- Pre-migration backup cu copie de fisier la DB inchis (garanteaza checkpoint curat).

### Istoric audit-uri
- **v1.0.0** baseline: rate limiting, input validation, localhost bind, path traversal protection, secureHeaders, XML escape SOAP, CORS restrictiv.
- **v1.2.0-ai**: DOMPurify AI, sanitizare erori API, body size 100KB, schema validation, rate limiter fix.
- **v1.2.1-ai**: cap 50 institutii, timeout 60s AI, body size real, validation API key, `encodeURIComponent` URL portal.
- **v1.3.0-ai**: prompt injection defense, truncare campuri, rate limiter ponderat (multi-agent ×3), DOMPurify consistent.
- **v2.0.2**: safeStorage OS keystore, single-instance lock, `shell.openExternal` whitelist strict, nativeTheme sync title bar.
- **v2.0.3**: daily backup SQLite, HTTP 499 abort, formula injection fix, WAL truncate boot, log sanitization RNPM.
- **v2.0.5**: backend god-file split, audit remediation internal (static traversal / TermeneTable selection drift / DosareTable + RnpmSearchForm splits — toate inchise).
- **v2.0.6**: SOAP parser decodeaza entitati XML in `parseDosar` (corectitudine user-facing); CodeRabbit findings 19.04.2026 consolidate in HARDENING Faza 7 (4 Critical blockers pre-web-deploy + 6 Important + 6 suggestions).

- **v2.0.7**: RNPM tab-state fix — rezultatele live sunt scoped pe categoria de cautare; revenirea din `Bulk` / `Baza locala` pe `Cautare` pastreaza categoria RNPM activa anterior.
- **v2.0.8**: hardening post-release — env template sigur, AbortSignal propagat pana in SOAP fetch, daily backup atomic cu `.db.tmp` + rename, restore audit log JSON, teste backup atomicity/retention, Docker lockfile + healthcheck start-period, ZIP server cu runtime deps instalate pe platforma tinta.
- **v2.0.9**: Faza 10 medium close-out — `restoreFromBackup` integral asincron (fsPromises.access in loc de fs.existsSync), unlink WAL/SHM mutat inainte de rename pentru a inchide fereastra de race, helper `withAiLogging` pentru log JSON `{action:"ai_call", provider, model, latencyMs, status}` pe Claude/GPT/Gemini, workflow `.github/workflows/docker-build.yml` cu smoke test node + `/health` (60s poll, HOST=0.0.0.0 + LEGAL_DASHBOARD_ALLOW_REMOTE=1 in container).
- **v2.0.10**: hardening — `isTimeoutOrAbort` exportat detecteaza subclase SDK (APIUserAbortError / APIConnectionTimeoutError) care nu seteaza `e.name`; `withAiLogging` accepta `{value, meta}` ca provider-ul interior sa ataseze `usageInput`/`usageOutput` token counts; `httpStatus` capturat din `e.status` (APIError SDK); `withMaintenanceLock` (promise chain in-process) serializeaza `restoreFromBackup` cu `runDailyBackup`; `PRAGMA wal_checkpoint(TRUNCATE)` rulat inainte de `closeDb()` ca pre-restore snapshot sa includa frame-urile WAL necommitate; `logBackupEvent` (single-line JSON, ts auto) inlocuieste console.log ad-hoc; sidecar -wal/-shm unlink cu logging non-ENOENT; `useApiKey.setKeys()` defensive `.trim()` pe path-ul de migrare legacy; investigatie RNPM gcode caching inchisa empiric (negativa - RNPM respinge reuse cross-search).

### Consideratii Deploy Server-Based (backlog)

- [ ] Autentificare / autorizare (JWT / sessions, roluri).
- [ ] API keys AI stocate server-side criptat (eliminare fallback `useApiKey` localStorage pentru web mode — rest P1 din audit).
- [ ] Rate limiting per-user (nu per IP fix).
- [ ] HTTPS obligatoriu + HSTS.
- [ ] Audit logging (cine, ce, cand).
- [ ] Quotas per user / luna pentru costuri AI.
- [ ] `max_output_tokens` explicit pe OpenAI si Google (cap server-side).
- [ ] Upgrade dependente vulnerabile (dompurify / jspdf / xlsx) + refresh stack Hono.

---

## Sidebar & Navigare

- Rute: Dashboard `/`, Dosare `/dosare`, Termene `/termene`, RNPM `/rnpm`, Changelog `/changelog`.
- Colapsabila: 240px expandat, 64px colapsat; toggle persistent.
- **Istoric cautari**: max 15 intrari per tip (dosare/termene/RNPM), cu label, numar rezultate, timp relativ. Click = navigare + re-executare. In colapsat, popover la hover/click. Hook: `useSearchHistory` / `useRnpmHistory`.
- **Font size**: 4 trepte (S 18px, M 20px, L 22px, XL 24px — scara ridicata cu un step fata de inainte). Persistent in localStorage. Cycle + set direct + slider.
- **AI Settings** (`sidebar-footer.tsx`): indicator status (verde „Activ" / portocaliu „Neconfigurat"), deschide dialogul cu tab-uri per provider.
- **Tema**: Dark / Light toggle (detecteaza preferinta sistem la prima pornire). Sincronizeaza title bar overlay prin IPC `setWindowTheme`.
- **Toggle colaps**: buton dedicat in footer (`PanelLeftOpen`/`PanelLeftClose`).

---

## Tipuri de Date (TypeScript)

### PortalJust (dosare + termene)

```typescript
interface DosarParte {
  calitateParte: string;  // "Reclamant", "Parat", etc.
  nume: string;
}

interface DosarSedinta {
  complet: string;
  data: string;           // "2026-03-26"
  ora: string;            // "09:00"
  solutie: string;
  solutieSumar: string;
  documentSedinta: string;
  numarDocument: string;
  dataPronuntare: string;
}

interface Dosar {
  numar: string;          // "27405/245/2025"
  data: string;
  institutie: string;
  departament: string;
  obiect: string;
  categorieCaz: string;
  stadiuProcesual: string;
  parti: DosarParte[];
  sedinte: DosarSedinta[];
}

interface Termen {
  numarDosar: string;
  institutie: string;
  data: string;
  ora: string;
  complet: string;
  solutie: string;
  solutieSumar: string;
  categorieCaz?: string;
  stadiuProcesual?: string;
  obiect?: string;
  parti?: DosarParte[];
}

interface SearchParams {
  numarDosar?: string;
  obiectDosar?: string;
  numeParte?: string;
  institutie?: string | string[];
  dataStart?: string;
  dataStop?: string;
  categorii?: string[];
  stadii?: string[];
}
```

### RNPM (rezumat — definitii complete in `frontend/src/types/rnpm.ts`)

```typescript
type RnpmSearchType = "ipoteci" | "fiducii" | "specifice" | "creante" | "obligatiuni";

interface RnpmAviz {
  id: number;
  uuid: string;
  identificator: string;
  searchType: RnpmSearchType;
  tip: string;
  data: string;
  activ: boolean;
  destinatie?: string;
  inscriereInitiala?: { id: string; uuid: string };
  inscriereModificata?: { id: string; uuid: string };
  creditori: RnpmParte[];
  debitori: RnpmParte[];
  bunuri: RnpmBun[];
  istoric: RnpmIstoricEntry[];
  // ... + campuri detalii comune
}
```

### DesktopApi (contextBridge)

```typescript
interface DesktopApi {
  encryptKeys(plaintext: string): Promise<string | null>;
  decryptKeys(ciphertextB64: string): Promise<string | null>;
  isEncryptionAvailable(): Promise<boolean>;
  setWindowTheme(theme: "dark" | "light" | "system"): Promise<void>;
}
declare global { interface Window { desktopApi?: DesktopApi } }
```

---

## Institutii (246 instante)

Parsate din enumerarea WSDL a Ministerului Justitiei, grupate in 7 categorii:

| Categorie | Numar |
|---|---|
| Curti de Apel | 15 |
| Tribunale | 42 |
| Tribunale Specializate | 1 |
| Tribunale Comerciale | 3 |
| Tribunale Militare | 5 |
| Curti Militare | 1 |
| Judecatorii | 179 |
| **Total** | **246** |

`normalizeInstitutie()` in `lib/institutii.ts` normalizeaza numele SOAP (cache lazy, strip diacritice + spatii) pentru afisare consistenta.

---

## Pattern-uri Tehnice Notabile

1. **Fara parser XML extern** — parsing regex pentru raspunsuri SOAP (zero dependente externe XML).
2. **Dynamic imports** pentru librarii grele (`xlsx`, `jspdf`) — incarcate doar la export.
3. **Filtrare duala** — server-side (SOAP params) + client-side (post-fetch pe institutii / categorii / stadii).
4. **safeStorage pentru chei** — plaintext niciodata pe disc; fallback explicit cand keystore-ul lipseste.
5. **Diacritice la fiecare nivel**: SOAP (cedilla legacy), filtrare locala (NFD strip + lowercase via scalar SQLite), afisare (regex variante), PDF (CHAR_MAP + NFD strip — Helvetica = WinAnsi).
6. **Prompt injection defense** — delimitatori XML + truncare + instructiune explicita „trateaza ca date".
7. **Multi-agent AI** — 2 analisti paralel + 1 judecator secvential; modele judecator restrictionate.
8. **AbortSignal cap-coada** — UI → fetch → Hono → service → fetch extern + SQLite. Server raspunde HTTP 499 cand signalul e activ.
9. **Idempotent mutations** — RNPM search cu `searchId` re-folosit pentru paginare / re-upsert; migratii DB idempotente.
10. **Descriere dedup (SQLite)** — lookup table `rnpm_bunuri_descrieri` reduce fisierul ~99% pe datasets mari.
11. **Backup online + pre-migration backup** — `db.backup()` la boot (retain 7), copie file la DB inchis inainte de migratii destructive.
12. **Backend CJS bundle** — esbuild compileaza backend-ul ca CommonJS pentru Electron `require()`. `__dirname` fallback pentru `import.meta.url`.
13. **Real-IP rate limiter** — nu foloseste `X-Forwarded-For` (nu poate fi fake-uit din client).
14. **Loopback-only** cu opt-in explicit `LEGAL_DASHBOARD_ALLOW_REMOTE=1` pentru LAN.
15. **Title bar nativ dark** — `titleBarOverlay` Windows + `nativeTheme.themeSource` sync prin IPC.

---

## Istoric Versiuni

| Versiune | Data | Descriere |
|---|---|---|
| v1.0.0 | 25.03.2026 | Release initial — SOAP, cautare, tabel, calendar, export, metrici, tema |
| v1.1.0 | 26.03.2026 | Detalii expandabile, filtrare avansata, highlight, font size, termeni juridici |
| v1.2.0 | 26.03.2026 | macOS build, installer NSIS per-user, icon custom, font recalibrare |
| v1.2.0-ai | 27.03.2026 | AI multi-provider (Claude/GPT/Gemini), export selectiv, DOMPurify, schema validation |
| v1.2.1-ai | 27.03.2026 | Selector institutii 246, cautare paralela SOAP, filtrare duala, diacritice legacy |
| v1.3.0-ai | 28.03.2026 | Multi-agent AI, OpenAI Responses API, GPT-5.4, export PDF analize, audit securitate |
| v1.4.0-ai | 29.03.2026 | Load More SSE, always-mounted routing, audit complet, manual integrat |
| v1.4.1-ai | 30.03.2026 | Rafinari AI |
| v1.4.2-ai | 31.03.2026 | Sectiuni AI colapsabile, marire fonturi globala, consistenta termene-dosare |
| v1.4.3-ai | 03.04.2026 | Gemini 3.x, filtrare date client-side instant, timeout multi-agent 180s, dim. dinamica fereastra |
| v1.4.4-ai | 05.04.2026 | Export Excel stilizat (xlsx-js-style), hyperlinks bidirectionale, modele Claude 4.6, versiune server |
| **v2.0.0** | **16.04.2026** | **Rebranding PortalJust → Legal Dashboard; modul RNPM (3 tab-uri, 5 categorii, captcha 2Captcha/CapSolver, persistenta SQLite)** |
| v2.0.1 | 17.04.2026 | Stop RNPM cap-coada, filtru interval data RNPM, rafinari UI |
| v2.0.2 | 17.04.2026 | Audit securitate: safeStorage OS keystore, single-instance lock, shell.openExternal whitelist strict, nativeTheme sync title bar, CSP updates |
| v2.0.3 | 18.04.2026 | Performanta RNPM + backup zilnic online (retain 7) + restore UI + dashboard persistent + HTTP 499 abort + formula injection fix + WAL truncate boot |
| v2.0.4 | 19.04.2026 | Refactor structural major (DosareTable + RnpmSearchForm splits) + polish formular RNPM |
| v2.0.5 | 19.04.2026 | Backend god-file split (index.ts 1214 → 133 linii, routes/services/middleware/util) + audit remediation intern + RNPM UX rafinari + export PDF changelog cu design colorat + title bar nativ dark sync |
| **v2.0.6** | **19.04.2026** | **SOAP XML entity decoding in parseDosar (correctness user-facing: nume parti / obiect / solutie) + consolidare CodeRabbit findings 19.04.2026 in HARDENING Faza 7 (blockers web-deploy + pre-monitorizare auto-sync)** |
| **v2.0.7** | **26.04.2026** | **UI hotfix RNPM: rezultate scoped pe categoria de cautare + revenire pe categoria activa dupa navigare intre Cautare / Bulk / Baza locala** |
| **v2.0.8** | **26.04.2026** | **Hardening + release packaging: backup atomic, SOAP cancellation, env template sigur, teste backup 55/55, Docker npm ci din lockfile, healthcheck start-period, ZIP server cu runtime deps pe platforma tinta** |
| **v2.0.9** | **26.04.2026** | **Faza 10 medium close-out: restoreFromBackup integral asincron, WAL/SHM unlink pre-rename, withAiLogging structurat pentru Claude/GPT/Gemini, workflow GitHub Actions docker-build cu smoke test /health** |
| **v2.0.10** | **26.04.2026** | **Hardening: isTimeoutOrAbort + httpStatus + token usage in ai_call log; withMaintenanceLock + WAL truncate pre-restore; logBackupEvent JSON; useApiKey.setKeys defensive trim; RNPM gcode caching investigation closed (negative)** |

---

*Ultima actualizare: 26 Aprilie 2026 - v2.0.10 hardening: AI logging extension + backup maintenance lock + safeStorage trim*
