# Legal Dashboard

Desktop app (Electron) + future web build pentru cautarea rapida a dosarelor in
portalul instantelor si interogarea Registrului National de Publicitate Mobiliara
(RNPM). Include un modul de analiza AI multi-agent (Claude, OpenAI, Gemini) cu
stocarea cheilor in keystore-ul sistemului de operare prin Electron `safeStorage`.

Versiune curenta: **2.0.9**. Vezi [CHANGELOG.md](CHANGELOG.md) pentru istoric si
[SECURITY.md](SECURITY.md) pentru threat model.

## Prerequisite

- **Node.js ≥ 22** (backend foloseste `--experimental-strip-types`)
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
| `npm test --workspace=backend` | Ruleaza vitest pe backend (55 teste in v2.0.9) |
| `npx tsc --noEmit -p backend/tsconfig.json` | Type-check backend |
| `cd frontend && npx tsc --noEmit` | Type-check frontend |
| `npx biome check` | Lint + format check (warnings non-bloquant) |

## Server / Docker deploy

`npm run dist:server` genereaza `server-release/portaljust-server-<version>.zip`.
ZIP-ul include `package-lock.json` + manifestele workspace si scripturile `start.sh` /
`start.bat` instaleaza runtime deps cu `npm ci` la prima pornire daca lipseste
`node_modules/better-sqlite3`. Motiv: `better-sqlite3` este modul nativ si trebuie
compilat pe platforma tinta.

Docker foloseste acelasi lockfile prin `npm ci --workspace=backend --omit=dev` si
are `start-period=120s` pe healthcheck pentru boot-uri lente cu prewarm/migrari DB.

## Configurare

Toate variabilele de environment sunt in [backend/.env.example](backend/.env.example).
Cheile API pentru AI pot fi setate fie in `.env` (precedence), fie din UI (salvate
local prin safeStorage). Vezi `SECURITY.md` pentru detalii.

Port backend default: `3002`. Suprascrie cu `LEGAL_DASHBOARD_PORT`.
LAN exposure blocat by default; opt-in explicit cu `LEGAL_DASHBOARD_ALLOW_REMOTE=1`.

## Arhitectura (scurt)

- `electron/main.js` — main process: single-instance lock, CSP, safeStorage IPC, backend bundle load
- `electron/preload.js` — context bridge (doar safeStorage)
- `backend/src/index.ts` — Hono server (port 3002). Rute AI, SOAP PortalJust, RNPM
- `backend/src/routes/rnpm.ts` — search + bulk + baza locala + export
- `backend/src/db/**` — SQLite (better-sqlite3), repositories + schema cu `owner_id` pentru multi-user
- `frontend/src/**` — React 19 SPA (Vite), comunica cu backend prin REST/SSE
- `dist-backend/`, `dist-frontend/` — output de build

## Securitate

Vezi [SECURITY.md](SECURITY.md) pentru threat model complet, protectii desktop/backend
si scope out-of-scope (cod fara semnatura Windows, LAN mode fara auth, etc.).
