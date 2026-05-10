# Legal Dashboard - Context Proiect

## Descriere
Aplicatie Electron desktop pentru cautare dosare si termene (portalquery.just.ro, SOAP) **+ modul RNPM** (Registrul National de Publicitate Mobiliara, via HTTP cu rezolvare captcha 2Captcha / CapSolver). Target final: se va deploya si ca aplicatie web - fiecare decizie arhitecturala trebuie sa supravietuiasca ambelor moduri.

## Versiune Curenta

**v2.20.7** - 11 Mai 2026

Pentru istoric complet (toate versiunile + breakdown per release) vezi [CHANGELOG.md](CHANGELOG.md) si in-app changelog (pagina `/changelog`).

## Reguli pentru CLAUDE.md (strict)

- **NU** scrie niciodata version history, changelog sau release notes in acest fisier.
- Istoricul versiunilor merge **EXCLUSIV** in [CHANGELOG.md](CHANGELOG.md) — el exista deja si e single source of truth.
- Actualizeaza CLAUDE.md **doar** daca se schimba o conventie activa de cod sau arhitectura.
- La bump de versiune: update doar campul scurt `**vX.Y.Z** - <data>` din "Versiune Curenta" (1-2 linii). Fara paragraf detaliat, fara blocuri "Predecesor", fara tabel sprint.

## Checklist bump de versiune

La fiecare release (vX.Y.Z → vX.Y.Z+1), actualizeaza in ordine:

**Mereu (la orice release):**

1. `package.json` (root + `backend/` + `frontend/`) + `package-lock.json`
2. `frontend/src/data/changelog-entries.tsx` — in-app changelog (necesita restart Electron pentru `__APP_VERSION__`)
3. `CHANGELOG.md` — sectiunea noua de release (single source of truth)
4. `README.md` — campul "Versiune curenta" + brief description
5. `SESSION-HANDOFF.md` — context sprint activ daca exista referinte la versiune / PR livrat
6. `STATUS.md` — campul "Data curenta" + "Versiune curenta reala" la varful fisierului (doar header, restul ramane istoric)
7. `DOCUMENTATIE.md` — campul "Versiune curenta" din sectiunea "Descriere Generala"

**Conditional (doar daca releaseul touch-uieste subiectul):**

8. `SECURITY.md` — daca releaseul aduce schimbari security-relevante (auth, secrets, network surface, CVE patches, threat model). Adauga entry in changelog table la baza fisierului.
9. `HARDENING.md` — daca releaseul inchide o Faza de hardening sau adauga findings noi din `/multi-review`.
10. `EXECUTION-ROADMAP.md` — daca releaseul livreaza un PR sau marcheaza un DoD checkbox.

**Sanity check inainte de commit:** `Grep -i "<vechea_versiune>"` pe toate `.md` la radacina; fiecare hit care nu e parte din istoric (CHANGELOG entry vechi, etc.) trebuie actualizat.

**OBLIGATORIU inainte de commit + push:** ruleaza `npx biome check --write <fisiere modificate>` (sau `npx biome check --write .` pentru tot repo-ul). NU lasa formatare/lint pe utilizator. Aplica biome pe TOATE fisierele atinse in release-ul curent inainte de `git commit` — nu trimite pe GitHub commits care nu trec biome check. Daca biome reformateaza, ruleaza din nou `tsc --noEmit` + `npm run build` ca sa verifici ca nimic nu s-a rupt, apoi commit.

## Markdown convention pentru README/CHANGELOG/SECURITY

- Nu incepe linii cu `+`, `-`, `*` sau `1.` in interiorul unui paragraf — GitHub le randeaza ca bullet list si sparge bold/italic peste boundary. Foloseste virgula sau cuvant ("plus", "si").
- Bold-ul `**...**` care contine newline e fragil — pastreaza-l pe o singura linie cand contine elemente critice (versiune, count teste, etc.).

## Release flow GitHub Actions

- Push pe tag `vX.Y.Z` declanseaza `build-windows.yml` (NSIS installer x64) si `build-mac.yml` (DMG x64+arm64); artefactele sunt atasate automat la GitHub Release.
- Workflow-urile ruleaza `tsc --noEmit` + `vitest run` INAINTE de packaging — fail-ul lor blocheaza release-ul.
- Build manual fara tag: `gh workflow run build-windows.yml` (publica la prerelease `dev-build`).

## Workflow obligatoriu pentru push pe GitHub

Inainte de ORICE `git push origin main` (release sau commit normal), in aceasta ordine:

1. **Biome** — `npx biome check --write` pe fisierele atinse (sau `.` daca scope-ul e larg). Re-stage fisierele modificate de biome.
2. **Type-check** — `npx tsc --noEmit -p backend/tsconfig.json` si `cd frontend && npx tsc --noEmit`. Daca pica, fix-ul nu se opreste.
3. **Build** — `npm run build` ca sa confirmi ca bundle-ul iese curat (Vite + esbuild).
4. **Tests** — `npm test --workspace=backend` + `cd frontend && npm test -- --run` daca scope-ul touch-uieste backend/frontend logic.
5. **Commit + push** — abia dupa ce primele 4 trec curat.

Aceasta regula este non-negotiable: niciun push pe GitHub fara biome verificat. Daca biome reformateaza dupa commit-ul de release, fa un commit follow-up `style: biome format pass` si push imediat.

## Structura Proiect

```
legal-dashboard/
- frontend/   # React 18 + TypeScript + Vite + Tailwind
    src/{pages, components, hooks, lib, types}
- backend/    # Node.js 22+ + Hono (port 3002)
    src/{routes, auth, services, middleware, db, util, soap.ts}
    tsconfig.json (strict: true, noEmit - type-check only)
- electron/   # main.js, preload.js, notifications.js (extras in v2.12.0)
- scripts/    # build.js (esbuild backend -> CJS), build-server.js (ZIP), generate-icon.mjs
- biome.json, README.md, SECURITY.md
```

Modulele individuale sunt descoperite la nevoie cu Glob/Grep. Constrangeri arhitecturale cheie:
- Repository-only DB access: SQL raw doar in `backend/src/db/**`
- `owner_id` pe toate tabelele (DEFAULT `'local'`)
- Migrations in `backend/src/db/migrations/` (latest 0017)
- Backend bundled CJS (esbuild) - vezi `## Nota Importanta Build`
- Tabele monitoring: `monitoring_jobs`, `monitoring_runs`, `monitoring_snapshots`, `monitoring_alerts`, `owner_email_settings`

## Comenzi
- `npm run electron:dev` - porneste Electron (backend in-process pe 3002)
- `npm run rebuild:electron` - recompileaza `better-sqlite3` pentru ABI-ul Electron dupa teste Node / `npm rebuild`
- `npm run dev:backend` - backend standalone (pentru dev web)
- `npm run dev:frontend` - Vite dev server pe 5173
- `npm run build` - build productie (frontend + backend CJS)
- `npm run dist` - electron-builder pentru Windows NSIS
- `npm run dist:mac` - electron-builder pentru macOS DMG (x64 + arm64; pe runner macOS)
- `npm run dist:server` - ZIP server deployabil; Docker Build ruleaza in GitHub Actions la push pe `main`
- `npm test --workspace=backend` - vitest backend (844 teste in v2.20.7)
- `cd frontend && npm test -- --run` - vitest frontend (100 teste)
- `npx tsc --noEmit -p backend/tsconfig.json` - type-check backend
- `cd frontend && npx tsc --noEmit` - type-check frontend
- `npx biome check` - lint + format check
- `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` - kill switch operational pentru a opri temporar claim-ul pe anumite tipuri de joburi
- `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`/`SMTP_SECURE` - canal email optional pentru alerte; lipsa/incomplet = email disabled, boot normal

## Arhitectura
- **Frontend**: React 18, Vite 5, Tailwind + clsx + tailwind-merge (`cn()` helper), Recharts, DOMPurify
- **Backend**: Hono + `@hono/node-server`, SOAP XML parsing manual
- **DB**: SQLite via `better-sqlite3`, repositories + schema cu `owner_id DEFAULT 'local'` pe toate tabelele
- **AI**: Anthropic SDK, OpenAI SDK, Google Generative AI SDK
- **Captcha**: 2Captcha + CapSolver (mod sequential sau race)
- **Export**: `xlsx-js-style` cu formula-injection escape (`=+-@\t\r` prefix)
- **Desktop**: Electron 41, single-instance lock, safeStorage (DPAPI / Keychain / libsecret)
- **Build**: esbuild (backend -> CJS, `--external:better-sqlite3 --external:electron`), Vite (frontend)

## Securitate (audit intern 19 Aprilie 2026 - v2.0.5)
### Protectii active
- **safeStorage IPC** pentru cheile API (DPAPI / Keychain / libsecret), ciphertext in localStorage doar
- **CSP strict** (`script-src 'self'`, fara `unsafe-inline`), `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- **IPC timeout 10s** in preload.js (previne renderer freeze)
- **Single-instance lock** (previne corupere SQLite din writers concurrenti)
- **Crash handlers** (`uncaughtException`, `unhandledRejection`, `before-quit` -> cleanup SQLite WAL)
- **DOMPurify** pe toate outputurile AI (HTML render)
- **Rate limiter** per IP via `getConnInfo` (nu trusted proxy headers); 503/429 emit envelope standard `{ data, error: { code, message }, requestId }` (v2.14.0)
- **Hono `secureHeaders`** + CSP per-response
- **LAN bind opt-in**: `LEGAL_DASHBOARD_ALLOW_REMOTE=1` required altfel `127.0.0.1` hard-forced
- **XLSX formula-injection escape** (`=+-@\t\r` -> prefix `'`)
- **Body size limits** (64KB search, 512KB bulk, 4KB small, 100KB AI, 256KB bulk dismiss)
- **Rate limits** dedicated (search, bulk, export, small)
- **External URL whitelist** exact: portal.just.ro, www.just.ro, portalquery.just.ro, mj.rnpm.ro, www.rnpm.ro
- **Backup atomic**: daily backup scrie la `.db.tmp` + rename atomic, cleanup orphan tmp la urmatorul run
- **Pre-migration backup generic** (v2.16.1): orice migration rebuild trigger-uieste backup `schema-upgrade` automat
- **SOAP cancellation**: `AbortSignal` extern propagat pana in fetch-ul PortalJust, combinat cu timeout intern (60s in v2.14.1+)
- **Monitoring operational kill switch**: `MONITORING_DISABLED_KINDS` exclude tipurile listate din scheduler claim fara modificari in DB
- **Monitoring run retention**: `monitoring_runs` purjat zilnic la 90 zile pentru a limita cresterea istoricului operational
- **AI usage tracking**: orice call SDK reusit sau pornit si esuat scrie owner-scoped in `ai_usage` dupa call, fara SQLite lock peste I/O extern
- **Admin guards**: `requireRole("admin")` pe rutele care opereaza pe state global (RNPM `DELETE /saved/all`, `POST /compact`, backup management)
- **Web-mode 501 gate**: `rejectCaptchaKeyInWebMode()` blocheaza POST `/rnpm/search`/`/bulk`/`/captcha/balance` cand `getAuthMode() === "web"` (necesita per-user key storage server-side)

### Riscuri acceptate
- SOAP HTTP upstream (portalquery.just.ro nu ofera HTTPS) - date publice, fara autentificare
- Unsigned Windows binary - SmartScreen warning la prima instalare (fara cert commercial)
- LAN mode fara auth - user doar dupa opt-in explicit

## Conventii cross-stack

- **Phase/status enums backend → UI**: orice enum emis de backend (SSE phase, alert kind, run status, etc.) trebuie tradus prin `frontend/src/lib/<domain>Phase.ts` inainte de afisare. Pattern stabilit: `frontend/src/lib/rnpmGapReason.ts` (v2.20.0), `frontend/src/lib/rnpmProgressPhase.ts` (v2.20.1) — pure helpers + unit tests, fara raw token-uri in DOM.
- **Index display**: internal counter poate fi 0-based, in UI afiseaza `${i + 1}/${total}` (ex. `Split 1/7`, nu `Split 0/7`).

## Web-readiness bridge (prep pentru deploy server)
- Repository-only DB access - raw SQL doar in `backend/src/db/**`
- `owner_id` column pe toate tabelele (DEFAULT `'local'`)
- Pagination offset-based (`{ page, pageSize, total }`) pe listari principale
- Zero sync fs in handlers (async `fs/promises` everywhere)
- Opt-in `clientRequestId` dedup pe mutations (idempotency)
- No singleton state tied to user activity

## Roadmap & Planuri Active
**Trimestrul curent (sapt 1-13, 2026-04-27 -> ~2026-07)**: monitoring desktop + cutover web, livrat in 13 PR-uri secventiale (PR-0 -> PR-12).
- [EXECUTION-ROADMAP.md](EXECUTION-ROADMAP.md) - roadmap saptamanal cu DoD checkboxes per PR. **Citeste sectiunea PR curent inainte de orice cod.**
- [PLAN-monitoring-webmode.md](PLAN-monitoring-webmode.md) - master spec tehnic (DDL, API contracts, security model).
- [SESSION-HANDOFF.md](SESSION-HANDOFF.md) - context transfer intre sesiuni (decizii inchise, status PR curent).
- [HARDENING.md](HARDENING.md) - **L274-440 SUPERSEDA de PLAN-monitoring-webmode.md** (vezi banner OBSOLETE). Restul fazelor 1-6 inca relevante.

## Nota Importanta Build
- Backend-ul e compilat ca CJS de esbuild. `import.meta.url` nu functioneaza in CJS.
  Se foloseste `typeof __dirname !== "undefined" ? __dirname : ...` pentru compatibilitate.
- `require("electron")` in `rnpm.ts` e marked external la bundle, rezolvat la runtime in main process.
- `npm run dist:server` - genereaza pachet ZIP deployabil pe server (dist-backend + dist-frontend + Dockerfile + lockfile/manifests). `start.sh` / `start.bat` instaleaza runtime deps cu `npm ci` daca lipseste `node_modules/better-sqlite3`, pentru ca modulul nativ sa fie construit pe platforma tinta.
- Dockerfile foloseste root `package-lock.json` + `npm ci --workspace=backend --omit=dev --build-from-source`; healthcheck are `--start-period=120s`.
- **La fiecare release bump**: actualizeaza TOATE `.md` (README, CHANGELOG, ROADMAP, SESSION-HANDOFF, etc.) + `frontend/src/data/changelog-entries.tsx` (in-app changelog) + manifest/lockfile. Verifica cu Grep pe versiunea veche inainte de a inchide release-ul. Restart Electron deja rulat pentru ca `__APP_VERSION__` sa se reinjecteze in sidebar/Dashboard.

## Limba
- Interfata si mesajele sunt in **romana** (fara diacritice in cod sursa - legacy constraint PortalJust)
- Comentariile din cod pot fi in engleza sau romana
