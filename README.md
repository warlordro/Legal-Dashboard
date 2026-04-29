# Legal Dashboard

Desktop app (Electron) cu arhitectura web-ready pentru cautarea rapida a
dosarelor in portalul instantelor, interogarea Registrului National de
Publicitate Mobiliara (RNPM) si monitorizarea automata a dosarelor prin
PortalJust SOAP. Include un modul de analiza AI multi-agent (Claude, OpenAI,
Gemini) cu stocarea cheilor in keystore-ul sistemului de operare prin Electron
`safeStorage`.

Versiune curenta: **2.3.0**. Vezi [CHANGELOG.md](CHANGELOG.md) pentru istoric
si [SECURITY.md](SECURITY.md) pentru threat model. Ultimul release este patch-ul
de audit remediation peste v2.2.0: backup zilnic recurent, restore SQLite cu
PRAGMA integrity check, graceful shutdown cu drain HTTP 30s, finalize state-guarded
+ index unic `idx_one_running_per_job` (migration 0005), executeSearch RNPM sub
`withMaintenanceRead`, audit pe rutele destructive RNPM, migration runner cu
self-heal bidirectional pe line endings (sha256 normalizat + `sha256Raw` +
`sha256Crlf` + `MIGRATIONS_STRICT=1` pentru CI) si export XLSX/PDF mutat integral
in Web Worker pe toate fluxurile (RNPM + AI + Manual).

## Prerequisite

- **Node.js >= 22** (backend foloseste `--experimental-strip-types`)
- **Git**
- Optional, doar pentru reCAPTCHA RNPM: cont 2Captcha sau CapSolver (cu credit)
- Optional, doar pentru modulul AI: cheie API Anthropic / OpenAI / Google

## Setup local (5 pasi)

```bash
git clone <repo-url> legal-dashboard
cd legal-dashboard
npm install                  # instaleaza root + backend + frontend (workspaces)
cp backend/.env.example backend/.env    # edit daca vrei API keys din .env
npm run electron:dev         # porneste Electron (backend pe 3002, window)
```

Primul boot creeaza DB-ul la `app.getPath("userData")/legal-dashboard.db`.

## Comenzi utile

| Comanda | Ce face |
|---|---|
| `npm run electron:dev` | Porneste aplicatia desktop |
| `npm run rebuild:electron` | Recompileaza `better-sqlite3` pentru ABI-ul Electron dupa teste Node / `npm rebuild` |
| `npm run dev:backend` | Ruleaza backend-ul separat (Node + TS direct) pe 3002 |
| `npm run dev:frontend` | Ruleaza Vite dev server pe 5173 (doar renderer) |
| `npm run build` | Build productie (frontend + backend CJS bundle) |
| `npm run dist` | Build + `electron-builder` pentru Windows NSIS |
| `npm test --workspace=backend` | Ruleaza vitest pe backend (357 teste in v2.3.0) |
| `npx tsc --noEmit -p backend/tsconfig.json` | Type-check backend |
| `cd frontend && npx tsc --noEmit` | Type-check frontend |
| `npx biome check` | Lint + format check (warnings non-bloquant) |

## Monitoring

Feature-ul de monitorizare este pornit implicit pe desktop incepand din v2.2.0.
Scheduler-ul ruleaza joburi `dosar_soap`, salveaza snapshot-uri, detecteaza
diferente intre sedinte/solutii si scrie audit log pentru mutatiile relevante.
v2.3.0 adauga finalize state-guarded + index unic `idx_one_running_per_job` la
nivel de DB, deci un singur run `running` simultan per job — recovery-ul de
crash nu mai poate produce duplicate.

Kill switch-uri operationale:

- `MONITORING_ENABLED=0` opreste mount-ul rutelor si scheduler-ul.
- `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` exclude tipurile listate din
  claim-ul scheduler-ului fara modificari in DB.

Tipurile `name_soap` si `aviz_rnpm` raman rezervate pentru PR-5+.

## Server / Docker deploy

`npm run dist:server` genereaza `server-release/portaljust-server-<version>.zip`.
ZIP-ul include `package-lock.json` + manifestele workspace si scripturile
`start.sh` / `start.bat` instaleaza runtime deps cu `npm ci` la prima pornire
daca lipseste `node_modules/better-sqlite3`. Motiv: `better-sqlite3` este modul
nativ si trebuie compilat pe platforma tinta.

Docker foloseste acelasi lockfile prin `npm ci --workspace=backend --omit=dev`
si are `start-period=120s` pe healthcheck pentru boot-uri lente cu prewarm /
migrari DB.

## Configurare

Toate variabilele de environment sunt in [backend/.env.example](backend/.env.example).
Cheile API pentru AI pot fi setate fie in `.env` (precedence), fie din UI
(salvate local prin safeStorage). Vezi `SECURITY.md` pentru detalii.

Port backend default: `3002`. Suprascrie cu `LEGAL_DASHBOARD_PORT`.
LAN exposure blocat by default; opt-in explicit cu `LEGAL_DASHBOARD_ALLOW_REMOTE=1`.

## Arhitectura (scurt)

- `electron/main.js` - main process: single-instance lock, CSP, safeStorage IPC,
  backend bundle load
- `electron/preload.js` - context bridge (doar safeStorage)
- `backend/src/index.ts` - Hono server (port 3002), bootstrap scheduler, rute AI,
  SOAP PortalJust, RNPM
- `backend/src/routes/monitoring.ts` - API v1 pentru joburi de monitorizare,
  manual run si body-size limits dedicate
- `backend/src/services/monitoring/**` - scheduler, diff, runner `dosar_soap`,
  clock/test seams
- `backend/src/routes/rnpm.ts` - search + bulk + baza locala + export
- `backend/src/db/**` - SQLite (better-sqlite3), migrari versionate,
  repositories cu `owner_id`, audit si monitoring tables
- `frontend/src/**` - React 18 SPA (Vite), comunica cu backend prin REST/SSE
- `dist-backend/`, `dist-frontend/` - output de build

## Securitate

Vezi [SECURITY.md](SECURITY.md) pentru threat model complet, protectii
desktop/backend si scope out-of-scope (cod fara semnatura Windows, LAN mode
fara auth, etc.).
