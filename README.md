# Legal Dashboard

Desktop app (Electron) cu arhitectura web-ready pentru cautarea rapida a
dosarelor in portalul instantelor, interogarea Registrului National de
Publicitate Mobiliara (RNPM) si monitorizarea automata a dosarelor prin
PortalJust SOAP. Include un modul de analiza AI multi-agent (Claude, OpenAI,
Gemini) cu stocarea cheilor in keystore-ul sistemului de operare prin Electron
`safeStorage` pe desktop si chei tenant criptate server-side in web mode.

Versiune curenta: **v2.37.0**. Vezi [CHANGELOG.md](CHANGELOG.md) pentru istoric,
[SECURITY.md](SECURITY.md) pentru threat model si [RUNBOOK.md](RUNBOOK.md) pentru procedurile operationale (rollback, restore, forensics). Pentru deploy productie cu Google OAuth2, vezi [DEPLOY-SERVER.md](DEPLOY-SERVER.md).

Ultimul release **v2.37.0** - Integrare ICCJ (Inalta Curte de Casatie si Justitie) via live-proxy scraping pe scj.ro: cautare dosare cu toggle de sursa (PortalJust vs ICCJ), termene-pe-dosar (toate datele unui dosar), imbogatire server-side a rezultatelor (categorie + rolul partilor + sedinte), metrici source-aware (Departamente in loc de Institutii, Analiza Parte) si monitoring `iccj` (migrarea 0034). Plus rundele de review (10 agenti + Codex) cu 10 fix-uri de corectitudine/fiabilitate: identitate monitoring pe `iccj_id`, conversie data DD.MM.YYYY catre scj.ro, izolarea timeout-urilor per-item, parser fail-loud la markup drift, dedup joburi, deep-link source-aware, kill-switch `ICCJ_ROUTES_DISABLED` + parametri env.

Istoric complet al versiunilor anterioare in [CHANGELOG.md](CHANGELOG.md) si in-app changelog (pagina `/changelog`).


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
| `npm run dist:mac` | Build + `electron-builder` pentru macOS DMG (x64 + arm64; normal ruleaza pe runner macOS) |
| `npm run dist:server` | Genereaza ZIP server deployabil pentru bare-metal / Docker context |
| `npm test --workspace=backend` | Ruleaza vitest pe backend (900 teste in v2.22.0) |
| `cd frontend && npm test -- --run` | Ruleaza vitest pe frontend (92 teste in v2.22.0) |
| `npx tsc --noEmit -p backend/tsconfig.json` | Type-check backend |
| `cd frontend && npx tsc --noEmit` | Type-check frontend |
| `npx biome check` | Lint + format check (warnings non-bloquant) |

## Monitoring

Feature-ul de monitorizare este pornit implicit pe desktop incepand din v2.2.0.
Scheduler-ul ruleaza joburi `dosar_soap` si `name_soap`, salveaza snapshot-uri,
detecteaza diferente intre sedinte/solutii/subiecti monitorizati si scrie audit
log pentru mutatiile relevante. v2.4.0 adauga bulk import pentru nume si runner
`name_soap`; v2.3.0 a adaugat finalize state-guarded + index unic
`idx_one_running_per_job` la nivel de DB, deci un singur run `running` simultan
per job - recovery-ul de crash nu mai poate produce duplicate.

Kill switch-uri operationale:

- `MONITORING_ENABLED=0` opreste mount-ul rutelor si scheduler-ul.
- `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` exclude tipurile listate din
  claim-ul scheduler-ului fara modificari in DB.

Tipul `aviz_rnpm` ramane rezervat pentru o etapa viitoare; `name_soap` este activ in v2.4.0+.

## Server / Docker deploy

`npm run dist:server` genereaza `server-release/legal-dashboard-server-<version>.zip`.
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
Cheile 2Captcha / CapSolver raman in UI + safeStorage pe desktop; in planul
web/server (PR-9) vor fi mutate server-side in `.env`/config si nu vor fi BYOK
sau trimise din browser.

Notificarile email sunt optionale. Pentru a activa canalul SMTP, completeaza
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` si optional
`SMTP_SECURE` in `backend/.env`, apoi activeaza destinatarul din dialogul de
configurare al aplicatiei. Fara aceste variabile, aplicatia porneste normal si
email-ul ramane dezactivat. In web mode, adresa de login este precompletata ca
destinatar propus; pe desktop (`local@desktop`) campul ramane manual.

Port backend default: `3002`. Suprascrie cu `LEGAL_DASHBOARD_PORT`.
LAN exposure blocat by default; opt-in explicit cu `LEGAL_DASHBOARD_ALLOW_REMOTE=1`.

## Auth modes (PR-9)

Aplicatia suporta doua moduri de autentificare:

- **desktop** (default): single-user `local` identity, no token validation.
  Folosit cand backend-ul ruleaza in-process via Electron.
- **web**: JWT validation pe `Authorization: Bearer <token>` sau cookie
  `legal_dashboard_session`. Cere `LEGAL_DASHBOARD_JWT_SECRET` (32+ bytes).

### Env vars

- `LEGAL_DASHBOARD_AUTH_MODE` - `desktop` | `web` (default `desktop`)
- `LEGAL_DASHBOARD_JWT_SECRET` - required pentru web mode
- `LEGAL_DASHBOARD_JWT_ISSUER` - optional, default `legal-dashboard`
- `LEGAL_DASHBOARD_JWT_AUDIENCE` - optional
- `LEGAL_DASHBOARD_JWT_TTL_SECONDS` - optional, default `3600`
- `LEGAL_DASHBOARD_ALLOW_REMOTE=1` - opt-in pentru bind non-loopback; cere
  `LEGAL_DASHBOARD_AUTH_MODE=web` + `LEGAL_DASHBOARD_ACK_NO_AUTH`
- `LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet` - confirmare boot
  pentru bind non-loopback

### Setup user pentru web mode

JWT `sub` trebuie sa mapeze la o coloana activa `users.id`. Pre-seedati userii
manual pana la PR-10/PR-11 (server-side sessions + Google SSO). `/api/v1/auth/login`
returneaza 501 in acest sprint - login-ul real vine in PR-11.

### `/health`

`/health` ramane public si non-sensitive in toate modurile.

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
