# Legal Dashboard

Desktop app (Electron) cu arhitectura web-ready pentru cautarea rapida a
dosarelor in portalul instantelor, interogarea Registrului National de
Publicitate Mobiliara (RNPM) si monitorizarea automata a dosarelor prin
PortalJust SOAP. Include un modul de analiza AI multi-agent (Claude, OpenAI,
Gemini) cu stocarea cheilor in keystore-ul sistemului de operare prin Electron
`safeStorage` pe desktop si chei tenant criptate server-side in web mode.

Versiune curenta: **v2.42.2**. Vezi [CHANGELOG.md](CHANGELOG.md) pentru istoric,
[SECURITY.md](SECURITY.md) pentru threat model si [RUNBOOK.md](RUNBOOK.md) pentru procedurile operationale (rollback, restore, forensics). Pentru deploy productie cu Google OAuth2, vezi [DEPLOY-SERVER.md](DEPLOY-SERVER.md).

Ultimul release **v2.42.2** - corectii pe findings-urile review-ului post-merge al v2.42.1: limiterul global de body reordonat inaintea tuturor routerelor (acopera acum si `POST /api/v1/tokens` in web mode) cu exceptii exact-match pentru rutele de export/import cu limite proprii mai mari (export xlsx dosare/termene 25MB, name-lists 10/15MB — in v2.42.1 primeau 413 pe payload-uri normale peste 1MB), release-ul bucket-ului pre-auth de rate limit gardat pe `c.finalized` (throw-ul pre-autentificare ramane contorizat), timeout-ul de shutdown Electron ridicat la 40s peste bugetul intern de drain al backend-ului si ceiling aplicat si pe fereastra proaspata de rate limit. Predecesor **v2.42.1** - patch de securitate si robustete din auditul full-project post-v2.42.0: DevTools inchis in build-urile desktop instalate (plus validare sender IPC si boot nonce la health-check), rate limit AI corect pe ambele mount-uri (`/api/ai` + `/api/v1/ai`) si ponderat pe tokenurile PAT, body limit global 1MB pe `/api/*`, `/health/detail` blocat in web mode, `ownerId` obligatoriu in repository-urile RNPM/cautari (fara default `"local"`) si guard pe rezultatul `finalize()` in scheduler-ul de monitorizare. Predecesor **v2.42.0** - administrare completa a utilizatorilor in web mode: creare individuala si import Excel cu template descarcabil (email unic case-insensitive, migratia 0040, reactivare automata a conturilor sterse), pagina Setari reorganizata pe taburi cu gating pe rol, buget AI unic per utilizator (migratiile 0041/0042 consolideaza ai.single+ai.multi intr-un pool "ai" cu granturi temporare), tab Consum per utilizator pe aceleasi cifre ca enforcementul (cu totaluri si echivalent EUR), audit cu emailuri si raport XLSX exportabil, refresh AI (Claude Sonnet 5 + prompturi system/user separate de date) si doua niveluri de finisaj UX (toast-uri, confirmari unificate, sortare pe coloane, dark mode fara scapari). Predecesor **v2.41.0** - primul val de corectii post-testare web (layout browser, chei tenant in frontend, UX cote).

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
- `MONITORING_DISABLED_KINDS=dosar_soap,name_soap,iccj` exclude tipurile listate din
  claim-ul scheduler-ului fara modificari in DB.
- `ICCJ_ROUTES_DISABLED=1` opreste rutele interactive ICCJ (`/api/dosare-iccj`,
  `/api/termene-iccj`) cu raspuns 503, fara redeploy.

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
- `LEGAL_DASHBOARD_JWT_ISSUER` - required in web mode (boot-ul esueaza fatal daca lipseste)
- `LEGAL_DASHBOARD_JWT_AUDIENCE` - required in web mode (boot-ul esueaza fatal daca lipseste)
- `LEGAL_DASHBOARD_JWT_TTL_SECONDS` - optional, default `3600`
- `LEGAL_DASHBOARD_ALLOW_REMOTE=1` - opt-in pentru bind non-loopback; cere
  `LEGAL_DASHBOARD_AUTH_MODE=web` + JWT valid, altfel boot-ul esueaza

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
