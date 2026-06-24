# Legal Dashboard — RNPM Module Implementation Plan

## Overview

Electron desktop app today, **web-compatible for future deployment**. Every architectural decision must work in both modes — prefer patterns that don't force a rewrite during the web transition.

Searches, views, stores, and exports data from RNPM (Registrul National de Publicitate Mobiliara). Uses 2Captcha API to solve reCAPTCHA v2 for search endpoints, then **eager-fetches** full details via captcha-free view endpoints during the same search session (UUIDs may be ephemeral).

**Location**: `C:\Users\Cezar\Desktop\Claude Code\Legal Dashboard`

## Tech Stack (mirrors PortalJust Dashboard)

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript, Vite, Tailwind CSS + shadcn/ui |
| Backend | Node.js, Hono (HTTP framework) |
| Desktop | Electron |
| Database | SQLite via `better-sqlite3` (persistent local storage) |
| Captcha | 2Captcha API (`@2captcha/captcha-solver`) |
| Export | xlsx (Excel), jsPDF (PDF) |

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Frontend (React SPA)                           │
│  ┌───────────┐ ┌───────────┐ ┌───────────────┐  │
│  │ SearchForm│ │ResultTable│ │ DetailView    │  │
│  │ (5 types) │ │ + Export  │ │ (parts 1-4)   │  │
│  └─────┬─────┘ └─────┬─────┘ └───────┬───────┘  │
│        │              │               │          │
│        └──────────────┴───────────────┘          │
│                       │ REST API                 │
├───────────────────────┼─────────────────────────┤
│  Backend (Hono)       │                         │
│  ┌────────────────────┴──────────────────────┐  │
│  │           RNPM Router                     │  │
│  │  /api/rnpm/search/:type/:page  (POST)     │  │
│  │  /api/rnpm/detail/:uuid        (GET)      │  │
│  │  /api/rnpm/istoric/:uuid       (GET)      │  │
│  │  /api/rnpm/bulk                (POST+SSE) │  │
│  │  /api/rnpm/saved               (GET)      │  │
│  │  /api/rnpm/saved/:id           (DELETE)   │  │
│  └────────┬──────────────────┬───────────────┘  │
│           │                  │                   │
│  ┌────────┴───────┐  ┌──────┴────────┐          │
│  │  2Captcha      │  │  SQLite DB    │          │
│  │  Solver        │  │  (storage)    │          │
│  └────────┬───────┘  └───────────────┘          │
│           │                                      │
├───────────┼──────────────────────────────────────┤
│           │  External                            │
│  ┌────────┴───────┐  ┌───────────────────┐      │
│  │ 2captcha.com   │  │ mj.rnpm.ro/api    │      │
│  │ (solve captcha)│  │ (RNPM registry)   │      │
│  └────────────────┘  └───────────────────┘      │
└──────────────────────────────────────────────────┘
```

## RNPM API Reference (validated via real test)

### Search Endpoints (require reCAPTCHA → 2Captcha)

| Endpoint | Category |
|---|---|
| `POST /api/search/ipoteci/{page}` | Ipoteca mobiliara |
| `POST /api/search/fiducii/{page}` | Fiducie |
| `POST /api/search/specifice/{page}` | Aviz specific |
| `POST /api/search/creante/{page}` | Creante securitizate |
| `POST /api/search/obligatiuni/{page}` | Obligatiuni ipotecare |

**reCAPTCHA sitekey**: `6Lff9LsUAAAAAO1gN9y3YMSyX94MS4Yh5zPqePkT`
**Page size**: 25 results per page
**Each search = 1 captcha solve = ~$0.003, ~20s**

Search response format:
```json
{
  "total": 280,
  "pagesTotal": 12,
  "pageSize": 25,
  "currentPage": 1,
  "documents": [
    {
      "no": 1,
      "identificator": {
        "v": "2015-00038177282217-XYH",   // public ID
        "k": "83821160-bbc5-4532-b254-ab55dc235140"  // UUID for detail fetch
      },
      "utilizatorAutorizat": "CABINET DE AVOCAT BARA CIPRIAN",
      "data": "31.08.2015",
      "tip": "Aviz de ipoteca mobiliara - Aviz Initial",
      "needsActualizare": false
    }
  ],
  "criteriu": "((Cod unic identificare Debitor pj este '14399840'))",
  "eai": false
}
```

### Detail Endpoints (NO captcha required!)

| Endpoint | Data |
|---|---|
| `GET /api/view/inscriere/{uuid}?part=1` | Info generale: tip, data, expirare, operator, stare |
| `GET /api/view/inscriere/{uuid}?part=2` | Creditori: PF + PJ cu denumire, CUI, sediu, J-number |
| `GET /api/view/inscriere/{uuid}?part=3` | Debitori: PF + PJ cu calitate, denumire, CUI, sediu |
| `GET /api/view/inscriere/{uuid}?part=4` | Bunuri: vehicule, mobile, alte (conturi bancare, etc.) |
| `GET /api/view/istoric/{uuid}` | Istoric modificari ale avizului |

### Search Parameters (all categories)

```typescript
interface RnpmSearchParams {
  gcode: string;                          // reCAPTCHA token from 2Captcha
  identificatorInscriere?: string;         // public ID to search by
  tipInscriere?: { type: "1"|"2"; value: string }; // 1=SI, 2=SAU
  destinatieInscriere?: { type: "1"|"2"; value: string };
  activ?: boolean;
  nemodificat?: boolean;
  perioadaStart?: string;                  // YYYY-MM-DD
  perioadaFinal?: string;                  // YYYY-MM-DD
  tipAct?: string;
  nrAct?: { type: "1"|"2"; value: string };
  dataAct?: { type: "1"|"2"; value: string };
  creditorPJ?: { denumire?: string; regCom?: SiSau; CUI?: SiSau };
  CreditorPF?: { nume?: string; prenume?: SiSau; CNP?: SiSau };
  debitorPJ?: { denumire?: string; RegCom?: SiSau; CUI?: SiSau };
  debitorPF?: { nume?: string; prenume?: SiSau; CNP?: SiSau };
  bunV?: { model?: string; serieSasiu?: SiSau; serieMotor?: SiSau; nrImatriculare?: SiSau; descriere?: SiSau };
  bunA?: { categorie?: string; identificare?: SiSau };
  bunM?: { categorie?: string; identificare?: SiSau };
  tertPJ?: { denumire?: string; RegCom?: SiSau; CUI?: SiSau };
  tertPF?: { nume?: string; prenume?: SiSau; CNP?: SiSau };
}

type SiSau = { type: "1"|"2"; value: string }; // 1=SI(AND), 2=SAU(OR)
```

## Directory Structure

Follows handler → service → repository layering from CLAUDE.md.

```
legal-dashboard/
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── dashboard.tsx              # Landing page
│   │   │   └── rnpm.tsx                   # RNPM search + results + detail
│   │   ├── components/
│   │   │   ├── rnpm/
│   │   │   │   ├── rnpm-search-form.tsx   # Search form (tabbed: 5 categories)
│   │   │   │   ├── rnpm-results-table.tsx # Results table with cursor pagination
│   │   │   │   ├── rnpm-detail-modal.tsx  # Detail view (parts 1-4 + istoric)
│   │   │   │   └── rnpm-bulk-search.tsx   # Bulk search UI with progress
│   │   │   ├── sidebar.tsx
│   │   │   └── ui/                        # shadcn/ui components
│   │   ├── hooks/
│   │   │   ├── use-theme.ts
│   │   │   ├── use-font-size.ts
│   │   │   └── use-api-key.ts             # 2Captcha key storage
│   │   ├── lib/
│   │   │   ├── api.ts                     # REST + SSE client
│   │   │   └── export.ts                  # Excel/PDF export
│   │   ├── types/
│   │   │   └── index.ts                   # All RNPM types
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── index.ts                       # Hono app entry — thin route handlers only
│   │   ├── routes/
│   │   │   └── rnpm-routes.ts             # Route handlers (validate → delegate to service)
│   │   ├── services/
│   │   │   ├── captcha-solver.ts          # 2Captcha solver service
│   │   │   ├── rnpm-client.ts            # RNPM API client (search + detail fetch)
│   │   │   ├── rnpm-search-service.ts    # Orchestrates captcha + search + eager detail fetch + DB save
│   │   │   └── database/
│   │   │       ├── schema.ts             # SQLite schema creation + migrations
│   │   │       ├── aviz-repository.ts    # CRUD for rnpm_avize + related entities
│   │   │       └── search-repository.ts  # CRUD for rnpm_searches
│   │   └── types/
│   │       └── index.ts                  # Backend-specific types
│   ├── tsconfig.json
│   └── package.json
├── electron/
│   └── main.js                            # BrowserWindow, CSP, security
├── scripts/
│   ├── build.js
│   └── build-server.js
├── package.json                           # Root workspaces
├── .claude/
│   └── CLAUDE.md                          # Project conventions
└── PLAN.md
```

### Layering Rules

- **Route handlers** (`routes/`): validate input, call service, return response. No business logic.
- **Services** (`services/`): orchestrate business logic (captcha → search → detail → save). No raw SQL.
- **Repositories** (`services/database/`): all SQLite access. Only place with raw SQL. Swap point for Postgres later.
- **No module-level singleton state** tied to user activity — pass context per request.

## SQLite Database Schema

All tables include `owner_id` (scoped by owner, default `'local'` for desktop).
All list queries use cursor pagination (`{limit, cursor}`) — no page numbers for local data.

```sql
-- Search history
CREATE TABLE rnpm_searches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL DEFAULT 'local',
  search_type   TEXT NOT NULL,               -- ipoteci|fiducii|specifice|creante|obligatiuni
  params_json   TEXT NOT NULL,               -- search params as JSON
  total_results INTEGER NOT NULL DEFAULT 0,
  criteriu      TEXT,                        -- human-readable criteria from API
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_searches_owner ON rnpm_searches(owner_id);

-- Avize (notices) — main table
CREATE TABLE rnpm_avize (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id            TEXT NOT NULL DEFAULT 'local',
  uuid                TEXT NOT NULL,           -- k field (UUID for API calls — may be ephemeral)
  identificator       TEXT NOT NULL,           -- v field (public ID: 2015-00038177282217-XYH)
  search_type         TEXT NOT NULL,           -- which category
  tip                 TEXT NOT NULL,           -- Aviz Initial, Aviz Reducere, etc.
  data                TEXT NOT NULL,           -- date (DD.MM.YYYY)
  utilizator_autorizat TEXT,
  activ               INTEGER DEFAULT 1,      -- boolean
  needs_actualizare   INTEGER DEFAULT 0,

  -- Part 1: general info (eager-fetched during search)
  destinatie          TEXT,
  tip_act             TEXT,
  numar_act           TEXT,
  data_inreg          TEXT,
  data_expirare       TEXT,
  alte_mentiuni        TEXT,

  -- Part 4: bunuri description
  detalii_comune      TEXT,                   -- long text description of assets

  -- Metadata
  detail_fetched      INTEGER DEFAULT 0,      -- 1 if parts 1-4 have been fetched
  search_id           INTEGER REFERENCES rnpm_searches(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(owner_id, uuid)
);

CREATE INDEX idx_avize_owner ON rnpm_avize(owner_id);
CREATE INDEX idx_avize_identificator ON rnpm_avize(identificator);
CREATE INDEX idx_avize_search_type ON rnpm_avize(owner_id, search_type);
CREATE INDEX idx_avize_data ON rnpm_avize(data);

-- Creditori (creditors) — part 2
CREATE TABLE rnpm_creditori (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        TEXT NOT NULL DEFAULT 'local',
  aviz_id         INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
  tip_persoana    TEXT NOT NULL,              -- PF or PJ
  denumire        TEXT,                       -- name (PJ) or nume (PF)
  prenume         TEXT,                       -- only PF
  tip_entitate    TEXT,                       -- societate pe actiuni, etc.
  sediu           TEXT,
  nr_identificare TEXT,                       -- J-number for PJ
  cod             TEXT,                       -- CUI
  cnp             TEXT,                       -- only PF
  tara            TEXT,
  localitate      TEXT,
  judet           TEXT,
  cod_postal      TEXT,
  alte_date       TEXT
);

CREATE INDEX idx_creditori_owner ON rnpm_creditori(owner_id);
CREATE INDEX idx_creditori_aviz ON rnpm_creditori(aviz_id);
CREATE INDEX idx_creditori_cod ON rnpm_creditori(cod);

-- Debitori (debtors) — part 3
CREATE TABLE rnpm_debitori (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        TEXT NOT NULL DEFAULT 'local',
  aviz_id         INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
  tip_persoana    TEXT NOT NULL,              -- PF or PJ
  calitate        TEXT,                       -- Constituitor debitor, etc.
  denumire        TEXT,
  prenume         TEXT,
  tip_entitate    TEXT,
  sediu           TEXT,
  nr_identificare TEXT,
  cod             TEXT,                       -- CUI
  cnp             TEXT,
  tara            TEXT,
  localitate      TEXT,
  judet           TEXT,
  cod_postal      TEXT,
  alte_date       TEXT
);

CREATE INDEX idx_debitori_owner ON rnpm_debitori(owner_id);
CREATE INDEX idx_debitori_aviz ON rnpm_debitori(aviz_id);
CREATE INDEX idx_debitori_cod ON rnpm_debitori(cod);
CREATE INDEX idx_debitori_denumire ON rnpm_debitori(denumire);

-- Bunuri (assets) — part 4
CREATE TABLE rnpm_bunuri (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        TEXT NOT NULL DEFAULT 'local',
  aviz_id         INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
  tip_bun         TEXT NOT NULL,              -- vehicul|mobil|alt
  categorie       TEXT,                       -- Cont bancar, etc.
  identificare    TEXT,                       -- IBAN, serie sasiu, etc.
  descriere       TEXT,
  model           TEXT,                       -- for vehicles
  serie_sasiu     TEXT,
  serie_motor     TEXT,
  nr_inmatriculare TEXT
);

CREATE INDEX idx_bunuri_owner ON rnpm_bunuri(owner_id);
CREATE INDEX idx_bunuri_aviz ON rnpm_bunuri(aviz_id);

-- Istoric (history) — timeline of modifications
CREATE TABLE rnpm_istoric (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        TEXT NOT NULL DEFAULT 'local',
  aviz_id         INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
  identificator   TEXT NOT NULL,
  uuid            TEXT NOT NULL,
  data            TEXT NOT NULL,
  tip             TEXT NOT NULL,
  inscriere_m_v   TEXT,                       -- modified inscription ref
  inscriere_m_k   TEXT
);

CREATE INDEX idx_istoric_owner ON rnpm_istoric(owner_id);
CREATE INDEX idx_istoric_aviz ON rnpm_istoric(aviz_id);
```

## Implementation Steps

### Step 1 — Project Scaffolding
- [ ] Initialize monorepo (root package.json with workspaces: backend, frontend)
- [ ] Setup backend: Hono, TypeScript, `@2captcha/captcha-solver`, `better-sqlite3`
- [ ] Setup frontend: Vite + React + TypeScript, Tailwind CSS, shadcn/ui
- [ ] Setup Electron shell (main.js)
- [ ] Build scripts (esbuild for backend, Vite for frontend)
- [ ] Create `.claude/CLAUDE.md` with project conventions
- **Verify**: `npm run dev:backend` starts on port 3001, `npm run dev:frontend` on port 5173

### Step 2 — Backend: Database Repositories (`backend/src/services/database/`)
- [ ] `schema.ts` — SQLite initialization with schema above; all tables include `owner_id`
- [ ] `aviz-repository.ts` — CRUD: `saveAviz()`, `getAvize({ ownerId, limit, cursor, filters })`, `getAvizById()`, `deleteAviz()`
- [ ] `search-repository.ts` — CRUD: `saveSearch()`, `getSearches({ ownerId, limit, cursor })`
- [ ] All list queries use cursor pagination: `{ limit, cursor }` → `{ items, nextCursor }`
- [ ] All queries scoped by `owner_id`
- **Verify**: unit tests for insert + query round-trip with cursor pagination

### Step 3 — Backend: 2Captcha Solver (`backend/src/services/captcha-solver.ts`)
- [ ] `solveCaptcha(apiKey: string): Promise<string>` — calls 2Captcha API with RNPM sitekey
- [ ] Polls `getTaskResult` every 5s, max 60s timeout
- [ ] Returns the `gRecaptchaResponse` token
- [ ] Error handling: insufficient balance, timeout, invalid key
- **Verify**: integration test with real 2Captcha key (single solve)

### Step 4 — Backend: RNPM API Client (`backend/src/services/rnpm-client.ts`)
- [ ] `searchRnpm(type, params, gcode, page): Promise<SearchResult>` — search all 5 categories
- [ ] `fetchAvizDetail(uuid): Promise<AvizDetail>` — fetches parts 1-4 + istoric in parallel
- [ ] Configurable delay between requests (default 2s) to avoid rate limiting
- **Verify**: integration test with one real search

### Step 5 — Backend: Search Service (`backend/src/services/rnpm-search-service.ts`)
Orchestrates the full search flow — no business logic in route handlers.
- [ ] `executeSearch(type, params, captchaKey, ownerId)` — solve captcha → search → **eager-fetch details** for each result → save all to DB → return results
- [ ] `executeBulkSearch(searches, captchaKey, ownerId, onProgress)` — iterate searches with SSE progress
- [ ] Eager detail fetch: for each search result, immediately fetch parts 1-4 + istoric (UUIDs may be ephemeral — don't defer)
- [ ] Concurrent detail fetches: batch 5 at a time with 500ms delay between batches
- **Verify**: end-to-end test: search → details → DB save

### Step 6 — Backend: Route Handlers (`backend/src/routes/rnpm-routes.ts`)
Thin handlers — validate input, delegate to service, return response.
- [ ] `POST /api/rnpm/search` — validate `{type, params, captchaKey}` → `searchService.executeSearch()` → return results
- [ ] `GET /api/rnpm/detail/:id` — `avizRepository.getAvizById(id, ownerId)` → return from DB (already eager-fetched)
- [ ] `POST /api/rnpm/bulk` — SSE: `searchService.executeBulkSearch()` → stream progress
- [ ] `GET /api/rnpm/saved` — `avizRepository.getAvize({ ownerId, limit, cursor, filters })` → return `{ items, nextCursor }`
- [ ] `DELETE /api/rnpm/saved/:id` — `avizRepository.deleteAviz(id, ownerId)`
- [ ] `GET /api/rnpm/export` — `avizRepository.getAvizeByIds()` → format as xlsx/pdf → return file
- [ ] Rate limiting, input validation at route boundary
- **Verify**: curl tests against running backend

### Step 7 — Frontend: Types (`frontend/src/types/index.ts`)
- [ ] `RnpmSearchType` — union of 5 category types
- [ ] `RnpmSearchParams` — all search parameters (strict types, no `any`)
- [ ] `RnpmSearchResult` — API response with RNPM pagination (pages, totals)
- [ ] `RnpmDocument` — single aviz from search results
- [ ] `RnpmAvizDetail` — parts 1-4 combined
- [ ] `RnpmCreditor`, `RnpmDebitor`, `RnpmBun`, `RnpmIstoric` — detail types
- [ ] `CursorPage<T>` — `{ items: T[], nextCursor: string | null }` for local DB queries
- **Verify**: `npx tsc --noEmit`

### Step 8 — Frontend: API Client (`frontend/src/lib/api.ts`)
- [ ] `searchRnpm(type, params, captchaKey)` — POST to backend (returns results with details already fetched)
- [ ] `bulkSearch(searches, captchaKey, onProgress)` — SSE for bulk
- [ ] `getSaved(filters, cursor, limit)` — query saved avize with cursor pagination
- [ ] `getAvizDetail(id)` — GET from local DB (details were eager-fetched during search)
- [ ] `exportData(format, ids)` — trigger export
- **Verify**: compiles, types match backend responses

### Step 9 — Frontend: Search Form (`frontend/src/components/rnpm/rnpm-search-form.tsx`)
- [ ] Tabbed interface for 5 search categories
- [ ] Common fields: identificator, tip inscriere, perioada, activ/nemodificat
- [ ] Entity fields: creditor PF/PJ, debitor PF/PJ, tert PF/PJ (with CUI, CNP, nume, denumire)
- [ ] Asset fields: vehicule (model, sasiu, motor, nr inmatriculare), bunuri mobile, alte bunuri
- [ ] SI/SAU toggles (AND/OR) on multi-value fields
- [ ] Search button triggers captcha solve + search + eager detail fetch
- [ ] Loading state: "Se rezolva captcha..." → "Se cauta..." → "Se preiau detalii (5/25)..."
- **Verify**: form renders, submits correctly, all fields map to API params

### Step 10 — Frontend: Results Table (`frontend/src/components/rnpm/rnpm-results-table.tsx`)
- [ ] Columns: Nr, Identificator, Data, Tip, Utilizator Autorizat, Actiuni
- [ ] RNPM pagination (server-side, 25/page) — each page needs new captcha
- [ ] Click on row → open detail modal (data already available from eager fetch)
- [ ] Checkbox selection for bulk export
- [ ] "Salveaza in DB" button — stores selected results locally
- [ ] Sort by date, type
- **Verify**: renders real data, pagination works

### Step 11 — Frontend: Detail Modal (`frontend/src/components/rnpm/rnpm-detail-modal.tsx`)
- [ ] Tab 1: Info Generale (part 1) — tip, data, expirare, operator, stare
- [ ] Tab 2: Creditori (part 2) — table with all creditor details
- [ ] Tab 3: Debitori (part 3) — table with all debtor details
- [ ] Tab 4: Bunuri (part 4) — categorized list (vehicule, conturi, alte)
- [ ] Tab 5: Istoric (timeline of modifications)
- [ ] Export button (single aviz → PDF)
- **Verify**: all tabs render real data

### Step 12 — Frontend: Bulk Search (`frontend/src/components/rnpm/rnpm-bulk-search.tsx`)
- [ ] Input: textarea for multiple CUI/CNP values (one per line) or CSV upload
- [ ] Select search type and field (debitor CUI, creditor denumire, etc.)
- [ ] Progress bar: "Cautare 3/15 — Se rezolva captcha... Se preiau detalii..."
- [ ] Results accumulate as searches complete (with details)
- [ ] Estimated time + cost display (N searches x ~25s x $0.003 — includes detail fetch time)
- [ ] Cancel button
- **Verify**: runs 3+ searches sequentially with real captcha solving

### Step 13 — Frontend: Saved Data View
- [ ] Tab/page for browsing locally saved avize from SQLite
- [ ] Full-text search across all stored fields (debitor, creditor, bunuri)
- [ ] Cursor-based pagination (load more / infinite scroll)
- [ ] Filter by: search type, date range, active status
- [ ] Bulk export (Excel/PDF) of filtered results
- [ ] Delete individual or bulk
- **Verify**: CRUD operations with cursor pagination

### Step 14 — Integration: App Shell
- [ ] Sidebar navigation: Dashboard, Cautare RNPM, Date Salvate
- [ ] 2Captcha API key configuration in settings dialog
- [ ] Theme (dark/light) + font size controls
- [ ] App.tsx routing: `HashRouter` for desktop, `BrowserRouter` ready for web
- [ ] State management at App level (like PortalJust Dashboard pattern)
- **Verify**: full navigation flow works

### Step 15 — Export (`frontend/src/lib/export.ts`)
- [ ] Excel: one sheet per category (avize, creditori, debitori, bunuri)
- [ ] PDF: formatted report with all aviz details
- [ ] Both single-aviz and bulk export
- **Verify**: generated files open correctly in Excel and PDF reader

### Step 16 — Electron Shell
- [ ] electron/main.js: BrowserWindow, CSP headers, security
- [ ] Build scripts: esbuild (backend) + Vite (frontend)
- [ ] electron-builder config for Windows installer
- **Verify**: `npm run dist` produces working .exe

## Cost Model

Includes eager detail fetching (parts 1-4 + istoric for each result, batched 5 concurrent).

| Operation | Captcha Solves | Cost | Time |
|---|---|---|---|
| Single search (1 page, 25 results + details) | 1 | $0.003 | ~25s (20s captcha + 5s details) |
| Single search (all pages, 280 results + details) | 12 | $0.036 | ~8 min |
| Bulk: 10 CUI searches (first page + details each) | 10 | $0.03 | ~4.5 min |
| Bulk: 50 CUI searches (first page + details each) | 50 | $0.15 | ~22 min |

**Important**: each page of results requires a separate captcha solve. Details are fetched eagerly during search because UUIDs may be ephemeral. Detail fetching is captcha-free and costs $0.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| RNPM changes sitekey | Store sitekey in config, easy to update |
| RNPM rate-limits our IP | Configurable delay between requests (2-5s default) |
| 2Captcha slow/down | Timeout + retry + user notification |
| RNPM API structure changes | Types are in one file, easy to update |
| Token expires before use (~120s) | Solve captcha immediately before search, no pre-solving |
| UUIDs are ephemeral (session-scoped?) | Eager-fetch all details during search session; store locally in SQLite |
| Large result sets (1500+) | Warn user, cap at configurable max pages |
