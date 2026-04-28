# Legal Dashboard — Context Proiect

## Descriere
Aplicatie Electron desktop pentru cautare dosare si termene (portalquery.just.ro, SOAP) **+ modul RNPM** (Registrul National de Publicitate Mobiliara, via HTTP cu rezolvare captcha 2Captcha / CapSolver). Target final: se va deploya si ca aplicatie web — fiecare decizie arhitecturala trebuie sa supravietuiasca ambelor moduri.

## Versiune Curenta
**v2.1.0** — 27 Aprilie 2026

Vezi `CHANGELOG.md` pentru istoric complet si `SECURITY.md` pentru threat model.

### Sprint curent: monitoring + web mode (PR-0..PR-12)
- ✅ **PR-0** v2.0.11 — migration framework + 0001 baseline (commit `9c3a9aa` pe main)
- ✅ **PR-1** v2.0.12 — `getOwnerId` helper + 5 fix-uri owner_id leak (commit `beca3b6` pe main)
- ✅ **PR-2** v2.0.13 — shadow tables users/sessions + audit_log + `recordAudit()` (commit `c09a855` pe main)
- ✅ **PR-3** v2.1.0 — monitoring core: schema 0003 + helperi (canonicalJson/sedintaKey/envelope/requestId) + repo + rute `/api/v1/monitoring/jobs` + UI minimal (branch `feat/monitoring-core`, post-review hardening absorbit)
- 🚧 **PR-4** (next) — monitoring scheduler + dosar_soap kind (sapt 4-5; precedat de spike empirical PortalJust determinism)

Detalii in [EXECUTION-ROADMAP.md](EXECUTION-ROADMAP.md) si [SESSION-HANDOFF.md](SESSION-HANDOFF.md).

## Structura Proiect
```
legal-dashboard/
├── frontend/          # React 18 + TypeScript + Vite + custom CSS
│   └── src/
│       ├── pages/     # Dashboard, Dosare, Termene, RnpmSearch, Changelog, Manual
│       ├── components/# DosareTable, TermeneTable, Sidebar, MetricsPanel, CalendarView,
│       │              # DosarModal, InstitutieSelect, SearchForm, TermeneMetrics, rnpm/*, ui/
│       ├── hooks/     # useApiKey (safeStorage IPC), useDialog, useFontSize,
│       │              # useRnpmHistory, useSearchHistory, useTheme
│       ├── lib/       # api.ts, rnpmApi.ts, export.ts, rnpmExport.ts,
│       │              # chart-colors.ts, institutii.ts, utils.ts
│       └── types/     # desktop-api.d.ts, index.ts, rnpm.ts
├── backend/           # Node.js 22+ + Hono (port 3002)
│   ├── tsconfig.json  # strict: true, noEmit (type-check only)
│   └── src/
│       ├── index.ts   # Bootstrap: CSP, CORS, mount routers, prewarm, backup, shutdown
│       ├── routes/    # rnpm.ts, dosare.ts (SOAP search), termene.ts, ai.ts (multi-provider)
│       ├── services/  # rnpmSearchService, captchaSolver, rnpmClient,
│       │              # ai.ts (Claude/OpenAI/Gemini), batch-dosare.ts (AbortSignal)
│       ├── middleware/# rate-limit.ts (real-IP), static-frontend.ts (path-traversal guard),
│       │              # owner.ts (getOwnerId helper, PR-1)
│       ├── db/        # schema.ts, avizRepository.ts, searchRepository.ts,
│       │              # backup.ts (owner_id everywhere), auditRepository.ts (recordAudit, PR-2),
│       │              # migrations/ (versioned DDL: 0001 baseline, 0002 users/sessions/audit)
│       ├── util/      # textNormalize (SQLite rnpm_norm diacritic fold), validation.ts
│       ├── soap.ts    # SOAP client pentru PortalJust
│       └── intervals.ts
├── electron/          # Electron shell
│   ├── main.js        # Single-instance lock, CSP, safeStorage IPC, crash handlers
│   └── preload.js     # Context bridge (doar safeStorage, IPC timeout 10s)
├── scripts/           # build.js (esbuild backend → CJS + copy frontend),
│                      # build-server.js (ZIP deploy), generate-icon.mjs
├── biome.json         # Lint + format config
├── README.md          # Setup pentru developeri noi
└── SECURITY.md        # Threat model + protectii
```

## Comenzi
- `npm run electron:dev` — porneste Electron (backend in-process pe 3002)
- `npm run rebuild:electron` — recompileaza `better-sqlite3` pentru ABI-ul Electron dupa teste Node / `npm rebuild`
- `npm run dev:backend` — backend standalone (pentru dev web)
- `npm run dev:frontend` — Vite dev server pe 5173
- `npm run build` — build productie (frontend + backend CJS)
- `npm run dist` — electron-builder pentru Windows NSIS
- `npm test --workspace=backend` — vitest (192 teste in v2.1.0: 99 baseline + 19 canonicalJson + 26 schemas/monitoring + 23 sedintaKey + 25 routes/monitoring integration PR-3)
- `npx tsc --noEmit -p backend/tsconfig.json` — type-check backend
- `cd frontend && npx tsc --noEmit` — type-check frontend
- `npx biome check` — lint + format check
- `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` — kill switch operational pentru a opri temporar claim-ul pe anumite tipuri de joburi de monitoring

## Arhitectura
- **Frontend**: React 18, Vite 5, custom CSS (Tailwind in deps dar deprecat), Recharts, DOMPurify
- **Backend**: Hono + `@hono/node-server`, SOAP XML parsing manual
- **DB**: SQLite via `better-sqlite3`, repositories + schema cu `owner_id DEFAULT 'local'` pe toate tabelele
- **AI**: Anthropic SDK, OpenAI SDK, Google Generative AI SDK
- **Captcha**: 2Captcha + CapSolver (mod sequential sau race)
- **Export**: `xlsx-js-style` cu formula-injection escape (`=+-@\t\r` prefix)
- **Desktop**: Electron 41, single-instance lock, safeStorage (DPAPI / Keychain / libsecret)
- **Build**: esbuild (backend → CJS, `--external:better-sqlite3 --external:electron`), Vite (frontend)

## Securitate (audit intern 19 Aprilie 2026 — v2.0.5; predecesor 17 Aprilie — v2.0.2)
### Protectii active
- **safeStorage IPC** pentru cheile API (DPAPI / Keychain / libsecret), ciphertext in localStorage doar
- **CSP strict** (`script-src 'self'`, fara `unsafe-inline`), `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- **IPC timeout 10s** in preload.js (previne renderer freeze)
- **Single-instance lock** (previne corupere SQLite din writers concurrenti)
- **Crash handlers** (`uncaughtException`, `unhandledRejection`, `before-quit` → cleanup SQLite WAL)
- **DOMPurify** pe toate outputurile AI (HTML render)
- **Rate limiter** per IP via `getConnInfo` (nu trusted proxy headers)
- **Hono `secureHeaders`** + CSP per-response
- **LAN bind opt-in**: `LEGAL_DASHBOARD_ALLOW_REMOTE=1` required altfel `127.0.0.1` hard-forced
- **XLSX formula-injection escape** (`=+-@\t\r` → prefix `'`)
- **Body size limits** (64KB search, 512KB bulk, 4KB small, 100KB AI)
- **Rate limits** dedicated (search, bulk, export, small)
- **External URL whitelist** exact: portal.just.ro, www.just.ro, portalquery.just.ro, mj.rnpm.ro, www.rnpm.ro
- **Backup atomic**: daily backup scrie la `.db.tmp` + rename atomic, cleanup orphan tmp la urmatorul run
- **SOAP cancellation**: `AbortSignal` extern propagat pana in fetch-ul PortalJust, combinat cu timeout intern
- **Monitoring operational kill switch**: `MONITORING_DISABLED_KINDS` exclude tipurile listate din scheduler claim fara modificari in DB
- **Monitoring run retention**: `monitoring_runs` este purjat zilnic la 90 zile pentru a limita cresterea istoricului operational

### Riscuri acceptate
- SOAP HTTP upstream (portalquery.just.ro nu ofera HTTPS) — date publice, fara autentificare
- Unsigned Windows binary — SmartScreen warning la prima instalare (fara cert commercial)
- LAN mode fara auth — user doar dupa opt-in explicit

## Web-readiness bridge (prep pentru deploy server)
- Repository-only DB access — raw SQL doar in `backend/src/db/**`
- `owner_id` column pe toate tabelele (DEFAULT `'local'`)
- Pagination offset-based (`{ page, pageSize, total }`) pe listari principale
- Zero sync fs in handlers (async `fs/promises` everywhere)
- Opt-in `clientRequestId` dedup pe mutations (idempotency)
- No singleton state tied to user activity

## Roadmap & Planuri Active
**Trimestrul curent (sapt 1-13, 2026-04-27 → ~2026-07)**: monitoring desktop + cutover web, livrat in 13 PR-uri secventiale (PR-0 → PR-12).
- [EXECUTION-ROADMAP.md](EXECUTION-ROADMAP.md) — roadmap saptamanal cu DoD checkboxes per PR. **Citeste sectiunea PR curent inainte de orice cod.**
- [PLAN-monitoring-webmode.md](PLAN-monitoring-webmode.md) — master spec tehnic (DDL, API contracts, security model).
- [SESSION-HANDOFF.md](SESSION-HANDOFF.md) — context transfer intre sesiuni (decizii inchise, status PR curent).
- [HARDENING.md](HARDENING.md) — **L274-440 SUPERSEDA de PLAN-monitoring-webmode.md** (vezi banner OBSOLETE). Restul fazelor 1-6 inca relevante.

## Nota Importanta Build
- Backend-ul e compilat ca CJS de esbuild. `import.meta.url` nu functioneaza in CJS.
  Se foloseste `typeof __dirname !== "undefined" ? __dirname : ...` pentru compatibilitate.
- `require("electron")` in `rnpm.ts` e marked external la bundle, rezolvat la runtime in main process.
- `npm run dist:server` — genereaza pachet ZIP deployabil pe server (dist-backend + dist-frontend + Dockerfile + lockfile/manifests). `start.sh` / `start.bat` instaleaza runtime deps cu `npm ci` daca lipseste `node_modules/better-sqlite3`, pentru ca modulul nativ sa fie construit pe platforma tinta.
- Dockerfile foloseste root `package-lock.json` + `npm ci --workspace=backend --omit=dev --build-from-source`; healthcheck are `--start-period=120s`.

## Limba
- Interfata si mesajele sunt in **romana** (fara diacritice in cod sursa — legacy constraint PortalJust)
- Comentariile din cod pot fi in engleza sau romana
