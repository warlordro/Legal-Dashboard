# PortalJust Dashboard — Documentatie Completa

## Descriere Generala

Dashboard desktop pentru cautarea dosarelor si termenelor din instantele romanesti via API-ul SOAP public al Ministerului Justitiei (portalquery.just.ro). Include asistenta AI multi-provider pentru analiza juridica a dosarelor, export Excel/PDF, si interfata moderna cu tema dark/light.

- **Versiune curenta**: v1.4.4-ai (AI Enabled)
- **AppId**: ro.portaljust.dashboard
- **Platforma**: Windows (NSIS installer), macOS (DMG), Web (standalone)
- **Limba interfata**: Romana
- **Repository**: github.com/Havocwithin/portaljust-dashboard

---

## Structura Proiect

```
portaljust-dashboard/
├── frontend/          # React + TypeScript + Vite + Tailwind + shadcn/ui
│   └── src/
│       ├── pages/     # Dashboard, Dosare, Termene, Changelog, Manual
│       ├── components/# DosareTable, TermeneTable, Sidebar, CalendarView, ui/
│       ├── hooks/     # useTheme, useFontSize, useApiKey, useSearchHistory
│       ├── lib/       # api.ts, export.ts (Excel/PDF), utils.ts, institutii.ts
│       └── types/     # TypeScript interfaces (Dosar, Termen, etc.)
├── backend/           # Node.js + Hono (port 3001)
│   └── src/
│       ├── index.ts   # API routes, AI endpoint, rate limiter, static serving
│       └── soap.ts    # SOAP client for PortalJust (CautareDosare)
├── electron/          # Electron shell
│   └── main.js        # BrowserWindow, context menu, CSP, security
├── scripts/           # build.js (frontend + backend + copy)
├── build/             # Icons (icon.ico, icon-1024.png)
├── CHANGELOG.md       # Changelog complet per versiune
├── DOCUMENTATIE.md    # Acest fisier
└── release/           # Output installer (.exe, .dmg)
```

---

## Stack Tehnologic

### Frontend
- **React 18.3** + **TypeScript 5.5**
- **Vite 5.4** (dev server + build)
- **Tailwind CSS 3.4** + **shadcn/ui** (componente UI)
- **Recharts 3.8** (grafice/metrici)
- **Lucide React** (iconite)
- **date-fns 3.6** + **react-day-picker 8.10** (calendar)
- **DOMPurify 2.5** (sanitizare XSS)
- **xlsx 0.18** (export Excel, dynamic import)
- **jsPDF 2.5** + **jspdf-autotable 3.8** (export PDF, dynamic import)

### Backend
- **Node.js >= 22** (cu `--experimental-strip-types`)
- **Hono 4.6** (framework HTTP)
- **@hono/node-server 1.13** (server adapter)
- **SOAP XML** parsing manual (regex, fara dependenta externa)

### AI SDKs
- **@anthropic-ai/sdk 0.80** — Anthropic (Claude)
- **openai 6.33** — OpenAI (GPT) via Responses API
- **@google/generative-ai 0.24** — Google (Gemini)

### Desktop
- **Electron 41** + **electron-builder 26**
- **esbuild 0.27** (compilare backend -> CJS)
- NSIS installer Windows (per-user, fara admin)
- DMG macOS (Intel + Apple Silicon)

---

## Comenzi

| Comanda | Descriere |
|---------|-----------|
| `npm run dev:frontend` | Porneste frontend dev server (port 5173) |
| `npm run dev:backend` | Porneste backend dev server (port 3001) |
| `npm run build` | Build frontend (Vite) + backend (esbuild -> CJS) |
| `npm run dist` | Build + electron-builder NSIS installer Windows |
| `npm run dist:mac` | Build + electron-builder DMG macOS |
| `npm run dist:all` | Build + installer Windows + macOS |
| `npm run electron:dev` | Porneste Electron in dev mode |

---

## Pagini si Functionalitati

### 1. Dashboard (`/`)

- Hero section cu numele si descrierea aplicatiei
- **Ultima Cautare** — 4 carduri sumar (nr. dosare, categorii, institutii, parte cautata)
- **Feature cards** — navigare rapida catre Dosare si Termene
- **Tipuri de Procese** — grid: Penal, Civil, Contencios administrativ, Litigii de munca, Faliment, Litigii cu profesionistii, Altele
- **API Info** — endpoint SOAP, metode disponibile, limite
- **Versiune** — badge versiune curenta + buton "Vezi Noutati" (deschide Changelog modal) + buton "Manual" (manual de utilizare)

### 1b. Manual de Utilizare

- **12 capitole** detaliate care acopera toate functionalitatile aplicatiei
- Cuprins interactiv — click pe capitol scrolleaza la sectiunea respectiva
- Export PDF — buton de descarcare in header si footer
- PDF generat: Portrait A4, cover page, cuprins, 12 capitole formatate, footer pe fiecare pagina
- Accesibil din Dashboard ca modal full-screen
- Fisier sursa: `frontend/src/pages/Manual.tsx`
- Functie PDF: `exportManualPDF()` in `frontend/src/lib/export.ts`

### 1c. Cautare RNPM (`/rnpm`)

Trei tab-uri (`Cautare` / `Bulk` / `Baza locala`) + modal detaliu partajat (`RnpmDetailModal`).

**5 categorii (tab-uri in formular)**:
- `ipoteci` — Aviz de ipoteca mobiliara (debitor / creditor / destinatie / vehicul / bun alt tip / tert cedat)
- `fiducii` — Fiducie (constituitor / fiduciar / beneficiar / vehicul)
- `specifice` — Aviz specific (parte / bun mobil categorie+identificare)
- `creante` — Aviz de ipoteca - creante securitizate (reprezentant creditor PJ / debitor / descriere bun)
- `obligatiuni` — Aviz de ipoteca - obligatiuni ipotecare (agent PJ/PF / emitent PJ / descriere bun garantie)

**Campuri comune**: identificator inscriere, tip inscriere (SI/SAU), perioada (start/final), tip act, nr act, data act, checkbox "Numai active" / "Nemodificate de alte inscrieri".

**SI/SAU**: combinator booleean pe fiecare camp cu doua variante (ex: nume+prenume). `1=SI` (intersectie), `2=SAU` (uniune).

**Captcha**: reCAPTCHA v2 rezolvat automat prin **2Captcha** sau **CapSolver** (cu fallback 2Captcha opt-in). Configurare in dialog "Setari AI" → card 2Captcha. Cost estimat ~$0.003 per captcha.

**Butonul Stop**: opreste cap-coada — captcha (provider primeste abort prin `Promise.race`), fetch RNPM, fetch detalii paralele, persist SQLite. Abort chain propagat UI → fetch → Hono → service.

**Bulk**: procesare liste (max 100/batch) de CUI / CNP / denumire pe camp ales (debitor/creditor). Progress per item prin SSE (phase: captcha → search → details → done/error).

**Baza locala**: browser SQLite cu filtre:
- Text `q` — diacritic-insensitive pe 9 coloane (identificator/tip/utilizator + creditori/debitori denumire/cod/cnp)
- `searchType` — dropdown pe cele 5 categorii
- `activ` — checkbox "Doar active"
- `dataStart`/`dataStop` — interval date (format ISO, comparat corect pe "dd.mm.yyyy" stocat)
- Cursor `Incarca mai multe` (50 per pagina)
- **Sterge tot** — dubla confirmare, tranzactional (avize + searches).

**Detail modal (5 tab-uri)**: General (Tip / Destinatie / Tip act / Data inregistrare / Expirare / Stadiu / Utilizator) / Creditori / Debitori / Bunuri (cu `BunRefRow` constituitor vs tert) / Istoric.

**Export PDF / Excel**: max 500 avize per operatie (bulk fetch prin `getAvizeByIds`).

### 2. Cautare Dosare (`/dosare`)

- **Formular cautare**: numar dosar, obiect, nume parte, selector institutii, interval date
- **Selector Institutii (Multi-Select)**: 246 instante din WSDL, grupate in 7 categorii:
  - Curti de Apel (15), Tribunale (42), Tribunale Specializate (1), Tribunale Comerciale (3), Tribunale Militare (5), Curti Militare (1), Judecatorii (179)
  - Cautare diacritice-insensitiva, chips vizuale, buton reset, counter rezultate
  - Cautare paralela SOAP cand sunt selectate mai multe institutii
- **Filtrare duala**: server-side (SOAP query) + client-side (post-fetch) pe institutii
- **Filtrare client-side**: Categorii, Stadii procesuale, Roluri parti
- **MetricsPanel**: carduri statistici clickabile ca filtre multiple-choice
- **Tabel dosare** (DosareTable):
  - Coloane sortabile: numar, data, institutie
  - Paginare cu selector pagina (10/15/25/50/100), navigare directa, first/last
  - Checkbox selectie per rand + select all (pagina) + deselect all
  - Export Excel/PDF pe selectie sau tot
  - **Rand expandabil** cu:
    - Grid info: Data Dosar, Departament, Categorie, Stadiu (cu badge-uri colorate)
    - Obiect Dosar
    - Parti — lista cu badge calitate + highlight diacritice-aware pe numele cautat
    - Sedinte — timeline vertical cu data/ora, complet, solutie (badge colorat), document
    - Link portal.just.ro

### 3. Termene & Calendar (`/termene`)

- **Cautare** cu aceleasi campuri ca Dosare
- **Dual view**: Tabel sau Calendar (toggle)
- **Metrici filtrabile**: Viitoare, Trecute, Cu Solutie (logica OR)
- **Tabel termene** (TermeneTable):
  - Coloane: Numar Dosar, Data, Ora, Institutie, Complet, Solutie
  - Badge "Viitor" pe termenele viitoare
  - Rand expandabil: Categorie, Stadiu, Obiect, Solutie completa, Parti
  - Paginare (10/20/50/100)
  - Export Excel/PDF
- **CalendarView**: vizualizare calendar cu detalii expandabile si linkuri portal

### 4. Changelog / Noutati

- Istoric complet al versiunilor cu sectiuni detaliate
- Fiecare versiune: titlu, data, subtitle, icon, badge, sectiuni cu bullet points
- Accesibil din Dashboard (modal) sau din Sidebar

---

## Asistenta AI

### Provideri si Modele

| Provider | Model | Key | Identificator API |
|----------|-------|-----|-------------------|
| **Anthropic** | Claude Haiku 4.5 (Rapid) | `claude-haiku` | `claude-haiku-4-5-20251001` |
| | Claude Sonnet 4.6 (Echilibrat) | `claude-sonnet` | `claude-sonnet-4-6` |
| | Claude Opus 4.6 (Premium) | `claude-opus` | `claude-opus-4-6` |
| **OpenAI** | GPT-5.4 nano (Rapid) | `gpt-5.4-nano` | `gpt-5.4-nano` |
| | GPT-5.4 mini (Echilibrat) | `gpt-5.4-mini` | `gpt-5.4-mini` |
| | GPT-5.4 (Premium) | `gpt-5.4` | `gpt-5.4` |
| **Google** | Gemini 3.1 Flash Lite (Rapid) | `gemini-flash-lite-3` | `gemini-3.1-flash-lite-preview` |
| | Gemini 3 Flash (Echilibrat) | `gemini-flash-3` | `gemini-3-flash-preview` |
| | Gemini 3.1 Pro (Premium) | `gemini-pro-3` | `gemini-3.1-pro-preview` |

### Autentificare AI
- Cheile API se introduc din interfata (Sidebar > AI Settings)
- Se salveaza in `localStorage` (per-provider)
- Se trimit per-request in body-ul JSON
- Backend-ul accepta si chei din `.env`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_KEY`
- Nu exista OAuth — toti providerii necesita API key

### Analiza AI Simpla (Single-Agent)
- Endpoint: `POST /api/ai/analyze`
- Un singur model analizeaza dosarul
- Selector model grupat pe provider cu codare cromatica (violet=Claude, emerald=GPT, blue=Gemini)
- Afisare tip model (Rapid/Echilibrat/Premium) pe fiecare rand de provider pentru modelul selectat
- Prompt structurat cu 7 sectiuni:
  1. Rezumat
  2. Explicatie parti
  3. Starea actuala
  4. Istoricul sedintelor
  5. Ce ar putea urma
  6. Temei juridic (articole de lege relevante)
  7. Legaturi cu alte dosare

### Analiza AI Avansata (Multi-Agent)
- Endpoint: `POST /api/ai/analyze-multi`
- **2 Analisti** analizeaza dosarul in paralel (`Promise.all`)
- **1 Judecator** primeste datele complete ale dosarului + cele 2 analize independente
  - Verifica afirmatiile analistilor contra datelor originale ale dosarului
  - Corecteaza interpretari gresite si adauga aspecte omise de ambii analisti
  - Reconciliaza contradictiile alegand interpretarea sustinuta de datele reale
- Modele judecator permise: Claude Opus 4, GPT-5.4
- Judecatorul nu mentioneaza ca a primit doua analize — prezinta rezultatul ca analiza unitara
- Rezultat: analiza finala reconciliata + optional vizualizare analize individuale side-by-side
- Sectiune colapsabila cu selectori model inainte de analiza

### Export Analiza PDF
- Disponibil atat pentru analiza simpla cat si avansata
- Format: Portrait A4, paleta culori calde (warm gray/stone)
- Structura:
  - Header minimal: titlu + subtitlu + data generare
  - Card info dosar: numar, institutie, obiect, model judecator (la avansata)
  - Continut analiza cu formatare markdown (headinguri, bullets, paragrafe)
  - Page breaks inteligente (titlul nu ramane singur pe pagina)
  - Footer pe fiecare pagina: "PortalJust Dashboard" + numar pagina + data
- Diacriticele sunt stripate (limitare font helvetica din jsPDF)

---

## Export Date

### Excel (.xlsx)
- **Dosare**: 2 sheet-uri (Dosare + Sedinte), coloane auto-dimensionate
- **Termene**: 1 sheet cu 7 coloane
- Se exporta selectia (checkbox) sau toate rezultatele
- Dynamic import `xlsx`

### PDF
- **Dosare**: Landscape A4, header albastru, 8 coloane (inclusiv Parti si Sedinte formatate), paginare
- **Termene**: Landscape A4, 8 coloane
- **Analiza AI**: Portrait A4, design warm gray (vezi sectiunea AI)
- Dynamic import `jspdf` + `jspdf-autotable`

---

## Sidebar si Navigare

- **Navigare**: Dashboard, Cautare Dosare, Termene & Calendar
- **Colapsabila**: 240px expandat, 64px colapsat
- **Istoric cautari**: max 15 intrari, cu tip (dosare/termene), label, numar rezultate, timp relativ
  - Click pe intrare = navigare + re-executare cautare
  - Stergere individuala sau clear all
  - In modul colapsat: popover la hover/click
- **Font size**: 4 trepte (Mic 16px, Normal 18px, Mare 20px, Extra 22px), persistent localStorage
- **AI Settings**: indicator status (verde "Activ" / portocaliu "Neconfigurat")
- **Tema**: Dark / Light toggle (detecteaza preferinta sistem)

---

## Backend — API Endpoints

### `GET /api/dosare`
- Parametri: `numarDosar`, `obiectDosar`, `numeParte`, `institutie` (string sau array), `dataStart`, `dataStop`
- Cautare paralela SOAP pentru institutii multiple (`Promise.all`)
- Validare: max 200 chars/parametru, control chars rejected, date reale, max 50 institutii
- Raspuns: `{ data: Dosar[], total: number }`

### `GET /api/termene`
- Aceiasi parametri ca dosare
- Extrage sedinte din dosare, adauga categorieCaz/stadiuProcesual/obiect/parti
- Sorteaza descrescator dupa data
- Raspuns: `{ data: Termen[], total: number }`

### `POST /api/ai/analyze`
- Body: `{ dosar, model, apiKeys? }`
- Body size limit: 100KB (header + actual)
- Schema validation pe body complet
- Prompt injection defense: date in `<dosar_data>` delimiters, truncare campuri
- Timeout: 60s per apel AI
- Raspuns: `{ analysis: string }`

### `POST /api/ai/analyze-multi`
- Body: `{ dosar, analysts: [string, string], judge: string, apiKeys? }`
- Validari: exact 2 analisti, judge restricted (claude-opus/gpt-5.4), schema validation dosar
- Rate limiter: consuma 3 unitati (vs 1 pentru alte endpoints)
- Prompt injection defense: analize in `<analiza_1>`/`<analiza_2>` delimiters
- Raspuns: `{ analyses: { analyst1, analyst2 }, judge: { model, text }, final: string }`

### `GET /health`
- Raspuns: `{ status: "ok", service: "PortalJust API" }`

### RNPM — `POST /api/rnpm/search`
- Body: `{ type, params, captchaKey, captchaProvider?, fallback2CaptchaKey?, startRnpmPage?, batchSize?, gcode?, searchId? }`
- `type`: `"ipoteci" | "fiducii" | "specifice" | "creante" | "obligatiuni"`
- Body size limit: 64KB; `params` max adancime 4, max 500 chars/camp string.
- Flow: rezolva captcha (2Captcha sau CapSolver) → interogare RNPM → fetch detalii paralel (concurrency 7) → persist SQLite.
- `AbortSignal` suportat cap-coada — client-ul poate opri cautarea oricand (captcha, fetch, detail).
- Raspuns: `{ searchId, total, pagesTotal, pageSize, currentPage, criteriu, documents[], avizIds[], detailsFailed[], gcode, nextRnpmPage }`.

### RNPM — `POST /api/rnpm/bulk`
- Body: `{ items: { type, params, label? }[], captchaKey, captchaProvider?, fallback2CaptchaKey? }` (max 200 items, 512KB total).
- SSE streaming: `event: progress` per item cu `{ index, total, label, phase, resultCount?, searchId?, error? }`.
- Hard timeout 10 min.

### RNPM — Baza locala
- `GET /api/rnpm/saved` — cursor pagination. Query: `limit, cursor, searchType, activ, q, dataStart, dataStop`.
  - `q` — diacritic-insensitive match pe 9 coloane (identificator/tip/utilizator + creditori/debitori denumire/cod/cnp) via scalar SQLite `rnpm_norm`. LIKE meta-caractere escape-uite literal.
  - `dataStart`/`dataStop` — ISO format; compara pe `substr()`-conversia "dd.mm.yyyy" → ISO.
- `GET /api/rnpm/saved/:id` — detaliu full (aviz + creditori + debitori + bunuri cu `referinte_json` + istoric).
- `DELETE /api/rnpm/saved/:id` — stergere individuala.
- `DELETE /api/rnpm/saved/all` — tranzactional: sterge `rnpm_avize` (CASCADE) + `rnpm_searches`.
- `POST /api/rnpm/saved/export` — bulk fetch pentru export (max 500 ids).

### RNPM — Captcha
- `POST /api/rnpm/captcha/balance` — body `{ captchaKey, captchaProvider? }` → verifica sold provider.

---

## SOAP Client (portalquery.just.ro)

- Endpoint: `http://portalquery.just.ro/query.asmx`
- Metoda: `CautareDosare` (SOAP 1.1)
- Timeout: 30 secunde
- **Diacritice legacy**: conversie Unicode modern (comma-below) -> cedilla (cerinta SOAP)
- **XML escape**: `&`, `<`, `>`, `"`, `'` + stergere control chars
- **Parsing**: regex-based `extractFirst()` / `extractAll()` (fara dependenta XML)
- **Extrage**: numar, data, institutie, departament, categorieCaz, stadiuProcesual, obiect, parti[], sedinte[]
- Sanitizare SOAP fault (detalii doar in log server)

---

## Securitate

### Audit v1.0.0 (Baseline)
- Rate limiting (30 req/min)
- Input validation (max 200 chars, control chars)
- Localhost-only binding (127.0.0.1)
- Path traversal protection
- Security headers (Hono secureHeaders)
- XML escape complet in SOAP
- CORS restrictiv (doar localhost dev ports)

### Audit v1.2.0-ai (AI)
- DOMPurify pe `dangerouslySetInnerHTML` (protectie XSS din raspunsuri AI)
- Sanitizare erori API (fara leak chei/stack traces)
- Body size limit 100KB pe `/api/ai/analyze`
- Schema validation pe AI request body
- Rate limiter fix (nu foloseste X-Forwarded-For)
- Validare date reale (30 feb respins)
- Bind localhost only

### Audit v1.2.1-ai (Institutii)
- Cap 50 institutii per cerere
- Timeout 60s pe apeluri AI
- Validare body size reala (nu doar Content-Length header)
- API key validation (max 256 chars)
- `encodeURIComponent` pe URL-uri portal
- Electron: verificare identitate backend, validare stricta URL `shell.openExternal`
- CSP headers in Electron

### Audit v1.3.0-ai (Multi-Agent)
- **Prompt injection defense**: date dosar in `<dosar_data>` delimiters, analize in `<analiza_1>`/`<analiza_2>` delimiters
- **Truncare campuri prompt**: obiect 500 chars, nume parte 200 chars, solutie 10000 chars
- **Rate limiter ponderat**: endpoint multi-agent consuma 3 unitati
- **Schema validation** pe endpoint multi-agent (reutilizare `validateAiBody`)
- DOMPurify consistent pe toate renderele AI (ALLOWED_TAGS: strong, em, b, i)
- PDF export: fara risc XSS (jsPDF `doc.text()` = plain text)
- SOAP fault sanitizat

### Consideratii pentru Deploy Server-Based (TODO)
Daca aplicatia va fi deployata ca server pentru o companie:
- [ ] Autentificare/autorizare (JWT/sessions, roluri)
- [ ] API keys AI stocate server-side, criptat
- [ ] Rate limiting per-user (nu per IP fix)
- [ ] HTTPS obligatoriu
- [ ] Audit logging (cine, ce, cand)
- [ ] Quotas per user/luna pentru control costuri AI
- [ ] `max_output_tokens` pe OpenAI si Google
- [ ] Limitare arrays parti/sedinte in prompt
- [ ] AbortController cu timeout pe frontend
- [ ] Electron `safeStorage` sau echivalent server pentru chei

---

## Electron Desktop

- **BrowserWindow**: 1400x900 default, 900x600 minim
- **Securitate**: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- **Backend startup**: porneste server, polleaza `/health` pana raspunde
- **Navigare**: restrictionata la localhost:3001
- **Deschidere externa**: doar URL-uri `*.just.ro` (HTTPS), validare stricta
- **Context menu**: Copiaza, Lipeste, Selecteaza tot, Printeaza
- **CSP**: `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`
- **macOS**: ramane activ la inchidere fereastra, re-creeaza fereastra la dock click
- **Installer**: NSIS per-user (fara admin), desktop + start menu shortcuts

---

## Tipuri de Date (TypeScript)

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
  institutie: string;     // raw SOAP value
  departament: string;
  obiect: string;
  categorieCaz: string;   // "Penal", "Civil", etc.
  stadiuProcesual: string; // "Fond", "Apel", "Recurs"
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

---

## Institutii (246 instante)

Parsate din enumerarea WSDL a Ministerului Justitiei, grupate in 7 categorii:

| Categorie | Numar |
|-----------|-------|
| Curti de Apel | 15 |
| Tribunale | 42 |
| Tribunale Specializate | 1 |
| Tribunale Comerciale | 3 |
| Tribunale Militare | 5 |
| Curti Militare | 1 |
| Judecatorii | 179 |
| **Total** | **246** |

Functia `normalizeInstitutie()` normalizeaza numele din SOAP (cache lazy, strip diacritice + spatii) pentru afisare consistenta.

---

## Pattern-uri Tehnice Notabile

1. **Fara parser XML extern** — parsing regex pentru raspunsuri SOAP (zero dependente)
2. **Dynamic imports** pentru librarii grele (xlsx, jspdf) — nu se incarca pana nu e nevoie
3. **Filtrare duala** — server-side (SOAP params) + client-side (post-fetch) pe institutii
4. **Per-request API keys** — niciodata stocate server-side, trimise din localStorage
5. **Diacritice la fiecare nivel**: SOAP (cedilla legacy), cautare (NFD stripping), afisare (regex variante), filtrare (comparatie insensitiva)
6. **Prompt injection defense** — delimitatori XML + truncare + instructiune explicita "trateaza ca date"
7. **Multi-agent AI** — 2 analisti paralel + 1 judecator secvential, modele judecator restrictionate
8. **Segmentare text concatenat** — dictionar ~80 termeni juridici pentru splitarea cuvintelor lipite din SOAP
9. **Backend CJS** — esbuild compileaza backend ca CommonJS (Electron compatibility), `__dirname` fallback pentru `import.meta.url`

---

## Istoric Versiuni

| Versiune | Data | Descriere |
|----------|------|-----------|
| v1.0.0 | 25.03.2026 | Release initial — SOAP, cautare, tabel, calendar, export, metrici, tema |
| v1.1.0 | 26.03.2026 | Detalii expandabile, filtrare avansata, highlight, font size, termeni juridici |
| v1.2.0 | 26.03.2026 | macOS build, installer NSIS per-user, icon custom, font recalibrare |
| v1.2.0-ai | 27.03.2026 | AI multi-provider (Claude/GPT/Gemini), export selectiv, DOMPurify, schema validation |
| v1.2.1-ai | 27.03.2026 | Selector institutii 246, cautare paralela SOAP, filtrare duala, diacritice legacy |
| v1.3.0-ai | 28.03.2026 | Multi-agent AI, OpenAI Responses API, GPT-5.4, export PDF analize, audit securitate, fix macOS crash |
| v1.4.0-ai | 29.03.2026 | Load More SSE, always-mounted routing, security audit complet, manual utilizare integrat, text lizibilitate |
| v1.4.2-ai | 31.03.2026 | Sectiuni AI colapsabile, marire fonturi globala, consistenta termene cu dosare, descriere model selectat |
| v1.4.3-ai | 03.04.2026 | Gemini 3.x, filtrare date client-side instant, timeout multi-agent 180s, dimensionare dinamica fereastra |
| v1.4.4-ai | 05.04.2026 | Export Excel stilizat (xlsx-js-style), hyperlinks interne bidirectionale, filenames dinamice, modele Claude 4.6, versiune server |

---

*Ultima actualizare: 5 Aprilie 2026*
