# Legal Dashboard

Desktop app (Electron) cu arhitectura web-ready pentru cautarea rapida a
dosarelor in portalul instantelor, interogarea Registrului National de
Publicitate Mobiliara (RNPM) si monitorizarea automata a dosarelor prin
PortalJust SOAP. Include un modul de analiza AI multi-agent (Claude, OpenAI,
Gemini) cu stocarea cheilor in keystore-ul sistemului de operare prin Electron
`safeStorage`.

Versiune curenta: **2.6.3**. Vezi [CHANGELOG.md](CHANGELOG.md) pentru istoric
si [SECURITY.md](SECURITY.md) pentru threat model. Ultimul release este
**v2.6.3** - patch UX Monitorizare + Alerte: coloana TINTA in tabelul de
joburi `dosar_soap` afiseaza acum numarul ca link extern catre `portal.just.ro`
+ buton mic Search care declanseaza auto-search in lista Dosare (acelasi
mecanism `pendingSearch` ca in inbox-ul Alerte), dropdown-ul de cadenta
prepende un option `"<valoare> (custom)"` cu border amber cand DB-ul are o
valoare in afara optiunilor standard ({4h, 8h, 12h, 24h}) ca UI-ul sa nu mai
afiseze fals "4h" peste un job care ruleaza la 10min, paginarea inbox-ului
de alerte adopta componenta `TablePagination` partajata (la fel ca in Cautare
Dosare / RNPM, page-size selector + numere de pagina + input de salt) si
zoom-ul cardului de alerta scade un pixel suplimentar pe scara fontului
(`zoom: (slider.value - 3) / slider.value`).
Baza ramane v2.6.2 - patch UX inbox alerte: cardul de alerta scaleaza dinamic
sub slider-ul de fonturi prin `zoom`, "Dosar: <numar>" e link extern catre
`portal.just.ro`, butonul navigheaza in Dosare, `solutie_aparuta` include
`solutie_sumar`/`numar_document`/`data_pronuntare` pe detail, "Detalii
suplimentare" afiseaza chei + valori (humanizate, JSON-stringificate, scurtate
la 200ch), `listAlerts` LEFT JOIN `monitoring_jobs` ca alertele vechi sa
primeasca `numar_dosar` din `target_json` chiar daca runner-ul nu enrich-uise
`detail`, linia tehnica `Job/Run/Dedup` scoasa din card.
Baza ramane v2.6.1 - alerte cu context dosar + identitate Windows: alertele
de monitorizare arata acum `numar_dosar` (injectat la nivelul runner-ului),
data formatata `dd.mm.yyyy`, ora, complet, solutie + buton "Cauta dosar" care
declanseaza search in Dosare; `app.setAppUserModelId` rezolva icon-ul
default Electron in taskbar-ul Windows si in native notifications.
Baza ramane v2.6.0 - PR-8 admin pages + roles guard: middleware nou
`requireRole(...allowed)` cu audit `auth.denied`, ruta `GET /api/v1/me`,
suprafata `/api/v1/admin/{users,audit,users/:id/quota}`, migration
`0011_user_quota_overrides`, hook `useCurrentUser` + componenta `AdminGate`,
sidebar conditional `Administrare` si trei pagini admin (`/admin/users`,
`/admin/audit`, `/admin/quota`). Guardrails irreversibile pe `last_admin` 409
(self-demote) si `self_deactivation` 409 (status non-active pe self).
Baza ramane v2.5.1 - PR-7 hardening: closed-lower-bound pe ferestre de timp,
`summary30d` aliniat la UTC-midnight, `purgeOldAiUsage(90)`,
`markShuttingDown()` latch si `inflightRef` AbortController pe refresh.
Baza ramane v2.5.0 - PR-7 AI usage tracking: migration
`0010_ai_usage`, tracking owner-scoped dupa fiecare call SDK AI, cost calculat
ca integer `cost_usd_milli`, endpoint `/api/v1/ai-usage/summary` si panou
"AI Usage" in Setari API cu cost ultimele 24h / 30 zile. Baza ramane PR-6: inbox `Alerte`,
badge cu necitite in sidebar, stream live `/api/v1/alerts/stream`, mark
read/dismiss si notificari native Electron.
PR-5 ramane baza de bulk name lists / `name_soap`: upload XLSX/CSV direct din
Monitorizare, template cu coloanele `numar_dosar`, `nume`, `cadence_sec`,
`notes` si dropdown Excel pentru cadenta, preview/commit pentru liste de nume,
auto-create joburi `name_soap`, runner SOAP pentru subiecti si alerte pe dosare
noi, stadii/categorii/relevanta. Patch-ul v2.3.0 ramane baza de hardening:
backup zilnic, restore
SQLite cu `PRAGMA integrity_check`, drain HTTP 30s, `idx_one_running_per_job`,
RNPM in maintenance lock, audit pe rute destructive, migration runner
self-heal bidirectional si export XLSX/PDF in Web Worker.


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
| `npm test --workspace=backend` | Ruleaza vitest pe backend (524 teste, neschimbate in v2.6.3) |
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
Cheile 2Captcha / CapSolver raman in UI + safeStorage pe desktop; in planul
web/server (PR-9) vor fi mutate server-side in `.env`/config si nu vor fi BYOK
sau trimise din browser.

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
