# Deep Review: Arhitectura, Cod, Bugs si Securitate
## Legal Dashboard -- 22 mai 2026

**Tip audit:** Review complet (read-only, fara modificari de cod)
**Scop:** Arhitectura, calitate cod, bug-uri potentiale, securitate
**Stack:** Hono + SQLite (better-sqlite3) | React 18 + Vite 6 + Tailwind | Electron | Docker + Caddy + oauth2-proxy

---

## Rezumat Executiv

| Categorie | Rating | Observatii |
|---|---|---|
| Arhitectura Backend | **Excelent** | Separare clara pe straturi, middleware bine ordonat, pattern-uri consistente |
| Baza de date | **Excelent** | Migratii robuste cu hash SHA-256, tranzactii corecte, WAL tuning, instance locking |
| API Design | **Foarte Bun** | Predominant RESTful, envelope consistent pe v1, dual legacy/v1 asumat ca tech debt |
| Autentificare/Autorizare | **Foarte Bun** | JWT custom corect, RBAC, owner isolation, dual-mode desktop/web |
| Arhitectura Frontend | **Foarte Bun** | React 18 + TypeScript strict, zero `any` in productie, hooks bine structurate |
| Securitate Electron | **Excelent** | Toate cele 7 webPreferences critice corect configurate, CSP restrictiv, navigation guard |
| Docker & Deployment | **Excelent** | Imagini pinuite prin SHA digest, non-root user, supply-chain hardened |
| Calitate Cod | **Foarte Bun** | Documentatie inline buna, cateva duplicari, fisiere de rute mari |
| Error Handling | **Excelent** | Fara scurgeri de stack trace, audit la eroare, graceful shutdown |
| Testing | **Foarte Bun** | 100+ fisiere de teste, acoperire buna pe utilitare si hooks |

**Verdict general:** Aplicatia este de calitate production-grade cu atentie exceptionala la securitate, auditabilitate si operare. Problemele identificate sunt preponderent de natura organizatorica (duplicare cod, dimensiune fisiere) si nu de securitate sau corectitudine.

---

## 1. Arhitectura

### 1.1 Backend

**Framework:** Hono v4.12.18 pe `@hono/node-server`, TypeScript strict, ESM, Node >= 22.

**Structura:**
```
backend/src/
  index.ts        -- Boot, middleware chain, lifecycle
  auth/           -- JWT custom, config, provider strategy
  db/             -- Schema, 33 migratii, 20+ repo-uri
  middleware/     -- 7 module (owner, rate-limit, origin, role, etc.)
  routes/         -- 12 fisiere de rute
  schemas/        -- Zod schemas
  services/       -- AI, SOAP, exports, monitoring, email, FX
  util/           -- Utilitare pure (envelope, validation, crypto, text)
```

**Lant middleware (ordine):**
1. `logger()` -- request logging
2. `secureHeaders()` -- CSP + security headers
3. `cors()` -- doar in dev
4. `requestIdContext` -- correlation ID
5. `/health` si `/health/detail` -- montate inainte de auth
6. `preAuthRateLimit` -- IP-only pe `/api/*`
7. `ownerContext` -- autentificare (desktop sau JWT)
8. `rateLimit` -- per-owner pe `/api/*`
9. `originGuard` -- CSRF pe `/api/*`

**Separarea pe straturi:** Excelenta. Routele gestioneaza HTTP, serviciile contin logica de business, repo-urile acceseaza date, middleware-ul se ocupa de cross-cutting concerns.

### 1.2 Frontend

**Framework:** React 18.3, TypeScript 5.5, Vite 6.4, Tailwind CSS 3.4.

**Organizare:** ~65 componente, 17 hook-uri custom, 7 module API, routing manual prin `useLocation().pathname`.

**State management:** Fara biblioteca externa. `useState`/`useEffect` + hooks custom + un singur Context (`ConfirmProvider`). State-ul pentru Dosare/Termene este liftat in `App.tsx`.

**Routing:** Manual (conditional rendering), nu `<Routes>`/`<Route>`. Dosare, Termene si RnpmSearch raman montate cu `display: none` pentru a pastra operatiile asincrone la schimbarea tab-ului.

### 1.3 Electron

Backend-ul este incarcat **in-process** via `require()` din bundle-ul CJS (`dist-backend/index.cjs`). Node.js HTTP server si Electron main process impart acelasi event loop.

**IPC:** 10 canale totale, toate cu validare input si size caps. Preload bridge expune doar 7 metode prin `contextBridge`.

### 1.4 Deployment (Productie)

```
Caddy (TLS + HSTS + header stripping)
  -> oauth2-proxy (Google OAuth + cookie security)
    -> Backend (expose-only, network-isolated in Docker bridge)
```

Backend-ul este inaccesibil din afara retelei Docker. Doar oauth2-proxy poate ajunge la el.

---

## 2. Baza de Date

### 2.1 Configurare
- **SQLite** via `better-sqlite3` v12.9.0, sincron, in-process
- WAL mode ON, foreign keys ON, `synchronous = NORMAL`, `busy_timeout = 5000`
- Singleton pattern cu `getDb()`, shutdown guard (`shuttingDown` flag)

### 2.2 Migratii
- **33 migratii** secventiale (0001-0033) cu `.up.sql` si `.down.sql`
- Verificare integritate prin SHA-256 hash la fiecare boot
- Self-healing pentru CRLF/LF line-ending drift
- Pre-migration backup automat
- Contiguity check (refuza boot daca exista gaps)

### 2.3 SQL
- Fara ORM. Toate query-urile folosesc prepared statements parametrizate
- Tranzactii explicite in cai critice (monitoring PATCH/DELETE, alerts, quota reservation)
- Pattern consistent: mutatie + audit intr-o singura tranzactie

### 2.4 Indici Potential Lipsa

| Tabel | Recomandare | Motiv |
|---|---|---|
| `audit_log` | Index compozit `(owner_id, ts)` si `(action, ts)` | Tabel monoton crescator, interogat cu multiple combinatii de filtre |
| `monitoring_alerts` | Verificare indici existenti vs. query patterns reale | Interogat intensiv cu `(owner_id, kind, severity, created_at)` |

### 2.5 N+1 Patterns
- `avizRepository.ts` incarca avize cu children (creditori, debitori, bunuri, istoric) prin query-uri separate per aviz. Acceptabil pentru aplicatie desktop single-user cu page size limitat (max 200).

---

## 3. API Design

### 3.1 Endpoint-uri

| Montare | Fisier | Endpoint-uri principale |
|---|---|---|
| `/api/rnpm` | `routes/rnpm.ts` | search, bulk, saved, stats, compact, backups, export |
| `/api/dosare` | `routes/dosare.ts` | GET `/`, POST `/load-more` (SSE) |
| `/api/termene` | `routes/termene.ts` | GET `/`, POST `/load-more` (SSE) |
| `/api/ai` | `routes/ai.ts` | settings, analyze, analyze-multi (SSE) |
| `/api/v1/auth` | `routes/auth.ts` | login (501), logout, oauth2/sync, refresh |
| `/api/v1/me` | `routes/me.ts` | profile, key-status, budget, email-settings |
| `/api/v1/admin` | `routes/admin.ts` | users, audit, keys, quota, grants |
| `/api/v1/dashboard` | `routes/dashboard.ts` | summary, timeline, charts, report |
| `/api/v1/monitoring` | `routes/monitoring.ts` | jobs CRUD, run, bulk-delete, master-switch |
| `/api/v1/alerts` | `routes/alerts.ts` | CRUD, seen/unseen/dismissed, export, SSE stream |
| `/api/v1/name-lists` | `routes/nameLists.ts` | preview, create, commit |

### 3.2 Validare Input
- **Zod** pentru endpoint-uri noi (admin, monitoring, alerts, name lists, AI settings)
- **Manuala** pentru endpoint-uri legacy (rnmp search, dosare, termene)
- **Body size limits** pe fiecare POST/PUT/PATCH
- **Server-side page size caps** (MAX_PAGE_SIZE = 200)

### 3.3 Envelope
- **v1:** `{ data, error: { code, message, details? }, requestId }` -- consistent, cu requestId correlation
- **Legacy:** `{ error: "message" }` sau `{ error: { code, message } }` -- dual pattern asumat ca tech debt

---

## 4. Autentificare si Autorizare

### 4.1 Moduri
- **Desktop** (implicit): Toti utilizatorii autentificati ca `"local"`, fara token
- **Web:** JWT HS256 cu implementare custom (fara biblioteca externa)

### 4.2 JWT Custom
- HS256 only, reject alte algoritme
- Validare: semnatura (timing-safe), expirare, not-before, issuer, audience, subject
- Livrare prin HttpOnly cookie (`legal_dashboard_session`) sau Bearer header
- Cookie: `httpOnly: true`, `secure: true` (web prod), `sameSite: "Lax"`

### 4.3 RBAC
- Roluri: `user`, `admin`, `support`, `readonly`
- Admin routes gated cu `requireRole("admin")`
- Owner isolation: toate query-urile de date sunt scoped per `ownerId`

### 4.4 OAuth2 Proxy Bridge
- Validare shared secret cu timing-safe comparison
- Accepta doar `x-auth-request-email` (fallback `x-forwarded-email` eliminat din securitate)
- Utilizatorul trebuie pre-provizionat in DB cu `status === "active"`

---

## 5. Bug-uri si Probleme Potentiale

### 5.1 Severitate RIDICATA

| # | Problema | Locatie | Detalii |
|---|---|---|---|
| B1 | ~~**Fara Error Boundaries**~~ — **REZOLVAT v2.36.0** | Frontend (toata aplicatia) | Nu exista niciun `ErrorBoundary` in codebase. Un crash intr-o singura componenta demonteaza intreaga aplicatie. Critic pentru: AI analysis panel (output imprevizibil), RNMP detail modal, chart rendering. **Recomandare:** ErrorBoundary top-level in `App.tsx` + per-page boundaries. **Inchis in v2.36.0:** componenta `frontend/src/components/ErrorBoundary.tsx` (variante `app` + `page`), boundary `app` montat in `main.tsx` in jurul lui `<App/>`, `PageBoundary` pe cele 12 sloturi de pagina plus Sidebar si ApiKeyDialog. |

### 5.2 Severitate MEDIE

| # | Problema | Locatie | Detalii |
|---|---|---|---|
| B2 | **Stale closure in `handleSearch`** | `frontend/src/pages/Dosare.tsx:150`, `Termene.tsx:124` | `handleSearch` captureaza `state` din closure in loc de functional update. Daca filtrele se schimba intre trigger si finalizare, state-ul filtrelor poate fi suprascris. |
| B3 | **Inflight dedup map local per proces** | `backend/src/routes/rnpm.ts:141` | `inflightRequests` Map nu este partajat intre procese. In deployment web multi-instance, acelasi `clientRequestId` poate executa concurrent. Documentat ca deferred la PR-11+. |
| B4 | **Filtre nememoizate in Dosare/Termene** | `frontend/src/pages/Dosare.tsx:135-141`, `Termene.tsx:105-110` | 4-5 functii de filtrare ruleaza secvential la fiecare render. Pentru dataset-uri mari (1000+ dosare), poate fi lent. |

### 5.3 Informational

| # | Problema | Locatie | Detalii |
|---|---|---|---|
| B5 | **`masterKeyCache` variabila de modul** | `backend/src/util/tenantKeyCrypto.ts:6` | Master key cache in variabila de modul. Scenariul de key rotation la runtime este pur teoretic: `process.env` nu se modifica in timpul rularii unui proces Node, iar la restart cache-ul este oricum gol. Nu necesita actiune. |

### 5.4 Severitate SCAZUTA

| # | Problema | Locatie | Detalii |
|---|---|---|---|
| B6 | **Stale closure `useMonitorRowState`** | `frontend/src/hooks/useMonitorRowState.ts:43` | `handleMonitor` citeste `monitorState[numar]` din closure. Click-uri rapide pe randuri diferite pot rata verificarea de pending. |
| B7 | **Stale closure `useAiSettings`** | `frontend/src/hooks/useAiSettings.ts:62-74` | `setMode` si `setStack` captureaza `settings` din closure. Apeluri rapide pot folosi state vechi. |
| B8 | **`lastTestSendByOwner` crestere nelimitata** | `backend/src/routes/me.ts:272` | Cooldown map nu este curatat. Pentru un server cu multi utilizatori, harta creste indefinit. Fiecare intrare este mica (string + number). |
| B9 | **Temp files la export crash** | `backend/src/routes/rnpm.ts:1015-1017` | Fisierele temporare sunt sterse pe `close` event. Daca serverul crasheaza mid-stream, raman pe disk. Acceptabil pentru desktop. |
| B10 | **IPC timeout necuratat** | `electron/preload.js:7-14` | `setTimeout` in `invokeWithTimeout` nu este sters la resolve. Timer-ul se declanseaza pe o promisiune deja rezolvata (no-op). |
| B11 | **CSP `connect-src` config mort** | `frontend/index.html:7` | CSP include `http://localhost:3001` in `connect-src`, dar backend-ul ruleaza pe portul 3002. Portul 3001 nu este folosit nicaieri in aplicatie. Este configuratie moarta care trebuie stearsa, nu un mismatch functional. |

---

## 6. Securitate

### 6.1 Puncte Forte

#### SQL Injection
- **Zero vectori de injectie.** Toate query-urile folosesc prepared statements parametrizate. LIKE queries escapa meta-caractere prin `escapeLikeMeta()`.

#### XSS
- **DOMPurify** cu allowlist strict (`<strong>`, `<em>`, `<b>`, `<i>`, fara atribute) pentru singurul `dangerouslySetInnerHTML`.
- Fara `eval()`, `innerHTML` assignment, sau `document.write()` in codebase.
- CSP cu `script-src 'self'` blocheaza scripturi inline.

#### CSRF
- **Multi-strat (defensa in profunzime):**
  - `originGuard` -- verificare Origin/Referer vs Host pentru request-uri non-loopback
  - `requireDesktopHeader` (F11-F1, livrat 2026-05-14) -- header custom `X-Legal-Dashboard-Desktop: 1` obligatoriu pe rute admin body-less (compact, open-db-folder, open-backups-folder, DELETE /saved/all, delete-batch, backups/restore). Cross-origin simple-POST nu poate seta acest header fara preflight CORS, care esueaza.
  - `sameSite: "Lax"` pe cookie-uri de sesiune

#### Electron Security
- Toate 7 webPreferences critice corect configurate:
  - `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `enableRemoteModule: false`, `devTools: IS_DEV`, `preload: preload.js`
- Navigation guard cu `URL` parsing strict (nu `startsWith`)
- Popup deny + domain allowlist (5 domenii guvernamentale, exact match)
- CSP complet: `object-src 'none'`, `frame-ancestors 'none'`

#### Docker & Infra
- Imagini pinuite prin SHA digest (defeats tag-repointing)
- Non-root user in container
- Backend network-isolated (expose-only in Docker bridge)
- Caddy: HSTS, header stripping, `-Server`
- Fara secrete in imagini Docker

#### Secrets
- Zero credentiale hardcoded in cod sursa
- Toate `.env` variantele gitignored
- CI genereaza secrete per-run cu `openssl rand`
- API keys criptate at rest prin OS keystore (DPAPI/Keychain/libsecret)

#### Cryptografie
- JWT: HS256 cu timing-safe comparison
- Tenant key encryption: AES-256-GCM cu IV random
- OAuth2 proxy secret: timing-safe comparison
- Request ID: `crypto.randomUUID()`

### 6.2 Vulnerabilitati si Riscuri

#### RIDICAT
- Niciuna gasita.

#### MEDIU

| # | Vulnerabilitate | Locatie | Detalii |
|---|---|---|---|
| S1 | **Binare nesemnate** | SECURITY.md:196-198 | Fara code signing pentru Windows sau macOS. SmartScreen/Gatekeeper warnings la prima rulare. |
| S2 | **Fara Dependabot** | `.github/` | Fara scanare automata a dependentelor. |

#### SCAZUT

| # | Vulnerabilitate | Locatie | Detalii |
|---|---|---|---|
| S3 | **SOAP prin HTTP** | `backend/src/soap.ts:5` | `http://portalquery.just.ro/query.asmx` -- limitare a serviciului guvernamental. Fara date de auth transmise. |
| S4 | **`LEGAL_DASHBOARD_ACK_NO_AUTH` bypass** | `backend/src/index.ts:385-397` | Permite remote binding inainte de SSO complet. Documentat, gated prin multiple env vars. |
| S5 | **Search history in plaintext localStorage** | Frontend hooks | Contine query-uri de cautare (nume, numere dosare). Expected pentru desktop app local. Risc pe calculator partajat. |

### 6.3 Endpoint-uri Exempte de Auth
- `GET /health` si `GET /health/detail` (detail are loopback gate)
- `POST /api/v1/auth/login` (returneaza 501)
- `POST /api/v1/auth/logout` (verifica token best-effort)
- `POST /api/v1/auth/oauth2/sync` (gated prin shared secret)

---

## 7. Calitate Cod

### 7.1 Cod Duplicat

| Functie/Pattern | Fisiere | Recomandare |
|---|---|---|
| `streamExportResult` | `dosare.ts:68-90`, `termene.ts:74-96`, `alerts.ts:615-637` | Extrage in utilitar comun |
| `readLimitedJsonBody` | `monitoring.ts:47-82`, `nameLists.ts:73-110` | Extrage in utilitar comun |
| `safeJsonParse` | `monitoring.ts:203-209`, `admin.ts:673-679`, `dashboard.ts:210-218` | Extrage in utilitar comun |
| `parseFilenameFromContentDisposition` | `api.ts:67`, `rnpmApi.ts:386`, `alertsApi.ts:63` | Extrage in utilitar comun |
| `DosareState` interface | `App.tsx:29`, `Dashboard.tsx:25`, `Dosare.tsx:87` | Defineste o singura data in `types/` |
| `TermeneState` interface | `App.tsx`, `Dashboard.tsx`, `Termene.tsx` | Defineste o singura data in `types/` |
| `ApiKeys` interface | `useApiKey.ts:11`, `DosareTable.tsx:39`, `dosare-ai-analysis-panel.tsx:15`, `useDosareAi.ts:12` | Defineste o singura data in `types/` |
| Markdown-to-JSX renderer | `dosare-ai-analysis-panel.tsx` (3 blocuri: L200-226, L453-478, L503-523) | Extrage componenta `<MarkdownRenderer>` |
| Error banner pattern | `Dosare.tsx:344`, `Termene.tsx:318`, `Monitorizare.tsx:444`, `Alerts.tsx:557` | Extrage componenta `<ErrorBanner>` |
| `filterByDate` | `Dosare.tsx:63`, `Termene.tsx:58` | Extrage in utilitar comun |

### 7.2 Fisiere Mari

| Fisier | Linii | Observatie |
|---|---|---|
| `routes/rnpm.ts` | 1144 | Necesita descompunere |
| `pages/Alerts.tsx` | 920 | Amesteca orchestrare date, UI si business logic |
| `pages/Monitorizare.tsx` | 808 | IIFE inline greu de urmarit (L478-736) |
| `routes/admin.ts` | 718 | |
| `routes/alerts.ts` | 772 | |
| `components/dosare-ai-analysis-panel.tsx` | 537 | Markdown rendering duplicat de 3 ori |
| `components/DosareTable.tsx` | 548 | |
| `components/Sidebar.tsx` | 452 | History rendering duplicat (expanded + collapsed) |
| `lib/api.ts` | 519 | Barrel re-export, bine structurat |

### 7.3 Prop Drilling
- `AppShell` primeste **22 props** (`App.tsx:51-103`): state objects, setters, history arrays, callbacks, API key state, captcha settings, pending search state.
- **Recomandare:** Context pentru search history si API keys.

### 7.4 Naming Conventions
- **Inconsistenta minora** in denumirea fisierelor: PascalCase (`DosareTable.tsx`, `SearchForm.tsx`) vs kebab-case (`dosare-ai-analysis-panel.tsx`, `sidebar-footer.tsx`).

### 7.5 Dead Code
- `_onConfigureApiKey` in `DosareTable.tsx:65` -- prop destructurat dar nefolosit (prefixat cu `_`).

---

## 8. Performanta

### 8.1 Frontend
- **Code splitting:** `manualChunks` in Vite pentru recharts, xlsx, jspdf
- **Lazy loading:** MetricsPanel, TermeneMetrics, Changelog, Manual (cu `<Suspense>`)
- **Web Worker:** Export XLSX/PDF off main thread
- **Dynamic imports:** `await import("@/lib/export-manual")` in Dashboard
- **`useMemo`/`useCallback`:** 127 match-uri, utilizate extensiv
- **Fara `React.memo`:** Nicio componenta nu foloseste `React.memo()`. Nu este critic pentru arhitectura actuala.

### 8.2 Backend
- **`better-sqlite3` sincron:** Potrivit pentru single-user desktop. Poate fi limitant in web mode cu concurenta mare.
- **WAL mode + busy_timeout:** Configuratie corecta pentru concurrenta limitata.
- **Rate limiting two-tier:** 60 req/min/IP pre-auth + 120 req/min per-owner post-auth.

---

## 9. CI/CD

| Workflow | Trigger | Permisiuni | Observatii |
|---|---|---|---|
| `lint-test.yml` | PR + push la main | `contents: read` | Biome lint, typecheck, tests |
| `docker-build.yml` | Tag `v*` + manual | `contents: read` | Build + smoke test, secrete per-run |
| `build-windows.yml` | Tag `v*` + manual | `contents: write` | NSIS, `--publish never` |
| `build-mac.yml` | Tag `v*` + manual | `contents: write` | DMG x64+arm64, `--publish never` |

**Toate actiunile GitHub sunt pinuite prin SHA digest complet.** Supply-chain hardened.

---

## 10. Recomandari Prioritizate

### Prioritate RIDICATA
1. ~~**Adauga Error Boundaries** in frontend -- cel putin unul top-level in `App.tsx` si per-page. Un crash intr-o componenta nu trebuie sa demonteze toata aplicatia.~~ **REZOLVAT v2.36.0** -- boundary `app` montat in `main.tsx`, `PageBoundary` pe toate sloturile de pagina plus Sidebar si ApiKeyDialog.

### Prioritate MEDIE
2. **Extrage cod duplicat** -- `streamExportResult`, `parseFilenameFromContentDisposition`, `safeJsonParse`, `readLimitedJsonBody` in utilitare comune.
3. **Unifica tipurile duplicate** -- `DosareState`, `TermeneState`, `ApiKeys` intr-un singur loc (`types/`).
4. **Adauga React.memo** pe componente cu props complexe (`DosareTable`, `TermeneTable`, `Sidebar`).
5. **Memoizeaza filtrele** in `Dosare.tsx` si `Termene.tsx` cu `useMemo`.
6. **Configureaza Dependabot** pentru scanare automata a dependentelor.
7. **Code signing** pentru Windows si macOS (HARDENING.md Faza 6).

### Prioritate SCAZUTA
8. **Descompune fisierele mari** -- `rnpm.ts` (1144 linii), `Alerts.tsx` (920 linii), `admin.ts` (718 linii).
9. **Sterge CSP config mort** -- elimina `http://localhost:3001` din `connect-src` in `frontend/index.html:7`. Portul 3001 nu este folosit nicaieri; backend-ul ruleaza pe 3002, iar in productie se foloseste `'self'` (same-origin).
10. **Curata `_onConfigureApiKey`** din `DosareTable.tsx`.
11. **Adauga `engines` field** in `package.json` pentru Node >= 22.
12. **Unifica naming convention** pentru fisiere (PascalCase sau kebab-case, nu amestecat).

---

## 11. Concluzie

Legal Dashboard este o aplicatie **matura si bine construita**, cu o postura de securitate exceptionala pentru un proiect de aceasta dimensiune. Arhitectura este clara si bine documentata, deciziile sunt deliberate si justificate inline, iar atentia la detalii operationale (migratii, audit, graceful shutdown, rate limiting) este remarcabila.

Problemele identificate sunt in principal de natura organizatorica (duplicare cod, dimensiune fisiere, lipsa Error Boundaries) si nu reprezinta riscuri critice de securitate sau corectitudine. CSRF-ul pe loopback (F11-F1) este deja inchis prin `requireDesktopHeader` (livrat 2026-05-14). Problemele de securitate ramase (binare nesemnate, lipsa Dependabot) sunt trackuite in HARDENING.md.

**Scor general: 8.5/10**
