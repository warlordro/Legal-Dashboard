# Deep Audit Multi-Field — Legal Dashboard

**Data:** 2 iunie 2026  
**Versiune auditata:** v2.36.2  
**Tip:** Read-only — fără modificări de cod  
**Auditor:** Composer 2.5 Fast (Cursor SDK / OpenCode)  
**Scope:** Cod, securitate, fiabilitate, structură, bug-uri

---

## Rezumat executiv

| Domeniu | Rating | Verdict scurt |
|---|---|---|
| **Cod** | Foarte bun | TypeScript strict, Biome curat, convenții consistente, tech debt controlat |
| **Securitate** | Excelent (desktop) / Foarte bun (web) | Hardening excepțional; gap-uri minore la supply chain și code signing |
| **Fiabilitate** | Foarte bun | Scheduler, migrări, shutdown graceful, backup — mature; SQLite rămâne SPOF |
| **Structură** | Foarte bun | Separare clară backend/frontend/Electron; fișiere mari și duplicări |
| **Bug-uri** | Bun | Zero critice deschise; câteva medii (stale closures, dedup multi-instance) |

**Verdict general:** Proiect **production-grade** pentru desktop single-user și deployment web controlat (Caddy + oauth2-proxy). Calitatea depășește media proiectelor interne; atenția la securitate, audit trail și operabilitate este remarcabilă. Problemele rămase sunt preponderent organizatorice (dimensiune fișiere, duplicări) sau specifice scalei web multi-instance, nu defecte fundamentale.

**Verificare locală (2 iun 2026):**
- `biome check` — **PASS** (401 fișiere)
- `tsc --noEmit` backend + frontend — **PASS**
- `vitest run` — **FAIL parțial** — 65/110 fișiere backend eșuate din cauza `better-sqlite3` compilat pentru NODE_MODULE_VERSION 145 vs runtime 137 (mismatch de mediu, nu bug de cod). CI pe tag-uri raportează suite verde.

---

## 1. Cod

### 1.1 Puncte forte

- **TypeScript strict** pe ambele workspace-uri; zero `any` intențional în cod de producție.
- **~110 fișiere de test** (backend ~80, frontend ~30), acoperire bogată pe auth, quota, monitoring, RNPM, exports, middleware.
- **Validare input:** Zod pe rute v1 (admin, monitoring, alerts, AI settings); validare manuală pe rute legacy (dosare, termene, RNPM) — documentată ca tech debt, nu ca neglijență.
- **Prepared statements** exclusiv în accesul DB; `escapeLikeMeta()` pentru query-uri LIKE.
- **Envelope API v1** consistent: `{ data, error: { code, message }, requestId }`; dual-shape legacy documentat și acoperit de teste contract.
- **Documentație inline** excepțională — comentarii explică *de ce*, nu doar *ce*; CHANGELOG granular per versiune.

### 1.2 Probleme și tech debt

| ID | Severitate | Descriere | Locație |
|---|---|---|---|
| C1 | Medie | Dual API legacy (`/api/dosare`) vs v1 (`/api/v1/dosare`) — mentenanță dublă | `backend/src/routes/` |
| C2 | Medie | Fișiere de rută oversized (>700 LOC): `rnpm.ts` (~1144), `monitoring.ts`, `admin.ts`, `alerts.ts` | `backend/src/routes/` |
| C3 | Scăzută | Duplicări: `streamExportResult`, `readLimitedJsonBody`, `parseFilenameFromContentDisposition`, interfețe `DosareState`/`TermeneState`/`ApiKeys` | Multiple fișiere — vezi audit 2026-05-22 §7.1 |
| C4 | Scăzută | Prop drilling masiv — `AppShell` primește ~22 props | `frontend/src/App.tsx` |
| C5 | Scăzută | Routing manual (conditional render) vs `<Routes>` — funcțional dar greu de extins | `frontend/src/App.tsx` |
| C6 | Scăzută | Inconsistență naming: PascalCase vs kebab-case în `components/` | Frontend |

### 1.3 Calitate toolchain

- **Biome** ca linter/formatter unic — simplu, rapid, fără conflict ESLint/Prettier.
- **CI** (`.github/workflows/lint-test.yml`): biome + tsc + vitest pe PR/push main.
- **Lipsă Dependabot/Renovate** — dependențele nu sunt scanate automat (finding S2 din audit anterior, încă deschis).

---

## 2. Securitate

### 2.1 Puncte forte (exemplare)

#### Electron
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`
- Preload minimal (`window.desktopApi` — 7 metode, size caps)
- Navigation guard strict (`URL` parsing, nu `startsWith`)
- Popup deny + allowlist extern (5 domenii guvernamentale, `https:` only)
- Single-instance lock → protecție SQLite
- CSP restrictiv în `onHeadersReceived`

#### Backend
- **Fail-closed auth** în web mode — fără fallback la `local`
- JWT HS256 custom: timing-safe compare, issuer/audience/exp/nbf
- **Tenant API keys:** AES-256-GCM, master key din env, never plaintext in audit
- **Rate limiting** pe IP real (socket), nu X-Forwarded-For spoofable
- **Pre-auth rate limit** înainte de ownerContext
- **originGuard** CSRF pentru non-loopback
- **requireDesktopHeader** pe rute admin body-less
- **CSP + secureHeaders** pe toate răspunsurile
- Boot guard: remote + desktop auth refuzat
- SOAP fan-out cap (500), body size limits, stream caps

#### Docker / Prod
- Imagini pinuite SHA digest
- Non-root user (`app`)
- Backend network-isolated (expose-only)
- Caddy: HSTS, header stripping
- oauth2-proxy → shared secret bridge
- Fără secrete în imagini

#### Date / Export
- XLSX formula injection escape (`=+-@\t\r` prefix)
- DOMPurify allowlist strict pe singurul `dangerouslySetInnerHTML`
- AI prompt truncation (`TRUNCATE_SOLUTIE = 5000`)

### 2.2 Riscuri și gap-uri

| ID | Severitate | Descriere | Recomandare |
|---|---|---|---|
| S1 | Medie | Binare nesemnate (Windows/macOS) — SmartScreen/Gatekeeper warnings | Code signing cert (cost) |
| S2 | Medie | Fără Dependabot — CVE-uri npm nedetectate automat | `.github/dependabot.yml` |
| S3 | Medie | Date dosare trimise la provideri AI terți (Anthropic, OpenAI, Google, OpenRouter) — egress PII/juridic | Consent dialog + PRIVACY.md (backlog HARDENING.md) |
| S4 | Scăzută | Web fallback localStorage pentru chei AI (base64 obfuscation) — nu e security control | Eliminare în web mode (backlog Faza 2) |
| S5 | Scăzută | SOAP PortalJust via HTTP (limitare guvernamentală) | N/A — upstream |
| S6 | Scăzută | `LEGAL_DASHBOARD_ACK_NO_AUTH` permite remote fără SSO complet | Documentat, multi-gated; doar lab |
| S7 | Scăzută | Istoric căutări în localStorage plaintext | Acceptabil desktop; risc pe PC partajat |
| S8 | Info | RNPM scraping + captcha solving — surface extern, PII în `rnpm-dumps/` (gitignored) | Retention policy, disk encryption |

### 2.3 Autentificare — observații

- Desktop: identitate `local` — corect pentru threat model documentat
- Web: JWT + oauth2-proxy bridge; `/login` returnează 501 (IdP extern)
- RBAC: `user`, `admin`, `support`, `readonly` — testat
- Owner isolation: query-uri scoped `owner_id`; cross-owner → 404 (nu 403)
- Endpoint-uri publice: `/health`, `/auth/login` (501), `/auth/logout`, `/auth/oauth2/sync` (shared secret)

**Opinie:** Modelul de securitate este **coerent cu threat model-ul declarat**. Nu am identificat vectori critici de SQL injection, XSS, CSRF sau RCE în renderer.

---

## 3. Fiabilitate

### 3.1 Puncte forte

| Componentă | Mecanism | Evaluare |
|---|---|---|
| **Migrări SQLite** | 33 migrări, SHA-256 hash, self-heal CRLF, pre-migration backup, gap detection | Excelent |
| **Instance lock** | Fișier lock + audit reclaim | Excelent |
| **Monitoring scheduler** | RWLock maintenance, orphan recovery, fail_streak backoff, source_error suppression, cooperative AbortSignal | Excelent |
| **Shutdown** | Electron: 5s drain cap; Server: 30s HTTP drain + scheduler stop | Foarte bun |
| **Backup/Restore** | Daily backup, integrity_check pre-restore, WAL/SHM cleanup | Foarte bun |
| **Email alerts** | Fail-isolated — SMTP failure nu blochează alert insert/SSE | Foarte bun |
| **Rate limiter** | Periodic sweep (5 min) + threshold cleanup | Bun |
| **FX rates** | ECB fetch cu fallback | Bun |

### 3.2 Riscuri fiabilitate

| ID | Severitate | Descriere | Impact |
|---|---|---|---|
| R1 | Medie | SQLite single-writer — bottleneck la scale web multi-user | Migrare Postgres (roadmap) |
| R2 | Medie | `inflightRequests` Map local per proces — dedup clientRequestId nu funcționează multi-instance | Documentat deferred PR-11+ |
| R3 | Scăzută | `lastTestSendByOwner` Map fără TTL — creștere nelimitată pe server long-running | Cleanup periodic |
| R4 | Scăzută | Temp files export RNPM rămân la crash mid-stream | Acceptabil desktop |
| R5 | Scăzută | Daily report retry state in-memory — pierdut la restart | Re-schedule la boot |
| R6 | Info | Electron backend in-process — shared event loop cu UI | Event-loop watchdog există |

### 3.3 Observabilitate

- Request ID correlation (`X-Request-ID`)
- Audit log structurat (`audit_log` table) — acțiuni sensibile, fără plaintext secrets
- `/health` + `/health/detail` (detail gated loopback)
- Boot warnings pentru SMTP partial config, auth misconfig
- **Lipsă:** Sentry/APM (amanat v2.35.0 în HARDENING.md)

---

## 4. Structură

### 4.1 Arhitectură generală

```
Legal Dashboard (monorepo npm workspaces v2.36.2)
├── electron/          → Main process, preload, notifications, watchdog
├── backend/           → Hono API, SQLite, services, 33 migrations
├── frontend/          → React 18 + Vite 6 + Tailwind, SPA
├── deploy/            → Caddy + oauth2-proxy + docker-compose.prod
├── scripts/           → Build, deploy smoke, seed-admin, load tests
└── audit/             → 14+ audit artifacts anterioare
```

**Pattern backend:** Routes → Services → Repositories → SQLite  
**Middleware chain:** logger → secureHeaders → cors(dev) → requestId → health → preAuthRateLimit → ownerContext → rateLimit → originGuard

### 4.2 Deployment modes

1. **Desktop (primary):** Electron + in-process backend, loopback, safeStorage keys
2. **Docker lab:** Single container, loopback bind default
3. **Web prod:** Caddy TLS → oauth2-proxy (Google) → backend isolated

### 4.3 Evaluare structurală

| Aspect | Rating | Note |
|---|---|---|
| Separare straturi | Excelent | Middleware, auth, db, services decuplate |
| Modularitate frontend | Bun | Hooks bine structurate; pages oversized |
| Testabilitate | Foarte bun | DI via env, temp DBs, contract tests |
| Extensibilitate web | Medie | SQLite + single-process dedup limitează |
| Documentație | Excelent | SECURITY.md, RUNBOOK.md, CHANGELOG, 14 audit docs |

### 4.4 Recomandări structurale (non-urgente)

1. Extrage utilitare duplicate (`streamExportResult`, `parseFilenameFromContentDisposition`)
2. Descompune `routes/rnpm.ts` în sub-module (search, export, backup, saved)
3. Context React pentru search history + API keys (reduce prop drilling)
4. Mută interfețe partajate (`DosareState`, `ApiKeys`) în `frontend/src/types/`
5. Adaugă Dependabot + eventual Sentry

---

## 5. Bug-uri

### 5.1 Critice — 0 deschise

- **B1 (Error Boundaries)** — **ÎNCHIS v2.36.0**: `ErrorBoundary` + `PageBoundary` pe 12 sloturi + Sidebar + ApiKeyDialog

### 5.2 Medii — deschise

| ID | Bug | Locație | Detalii |
|---|---|---|---|
| B2 | Stale closure în `handleSearch` | `Dosare.tsx:146`, `Termene.tsx:116` | Capturează `state` din closure; filtre pot fi suprascrise dacă se schimbă între trigger și finalizare |
| B3 | Inflight dedup per-proces | `routes/rnpm.ts` | Multi-instance web: același `clientRequestId` poate rula concurrent |
| B4 | Filtre nememoizate | `Dosare.tsx`, `Termene.tsx` | 4-5 funcții filtrare secvențial la fiecare render; lent la 1000+ dosare |

### 5.3 Scăzute — deschise

| ID | Bug | Locație |
|---|---|---|
| B5 | Stale closure `useMonitorRowState` | `hooks/useMonitorRowState.ts:43` |
| B6 | Stale closure `useAiSettings` | `hooks/useAiSettings.ts:62-74` |
| B7 | IPC timeout necuratat | `electron/preload.js:7-14` |
| B8 | CSP `connect-src` port mort 3001 | `frontend/index.html` — backend e 3002 |
| B9 | `parseClientRequestId` acceptă `:` | `routes/rnpm.ts:91-94` — inconsistent cu alte module |
| B10 | Captcha charset validation incompletă | FIXES-TODO Batch 3 — whitelist lipsă |

### 5.4 Rezolvate recent (v2.36.x)

| Versiune | Fix |
|---|---|
| v2.36.2 | SOAP `numeParte` — strip puncte (`D.O.O.` → `DOO`) pentru index PortalJust |
| v2.36.1 | UI highlight/filtre — exclude tokeni formă juridică (SC, SRL, SA) |
| v2.36.0 | Error Boundaries — izolare crash per secțiune |

### 5.5 Backlog FIXES-TODO (parțial deschis)

- Batch 3 RNPM: `parseClientRequestId` separator `:`, captcha charset whitelist
- Batch 6 Web cutover: tracked în EXECUTION-ROADMAP.md

---

## 6. Matrice risc consolidată

| Prioritate | Count | Acțiune recomandată |
|---|---|---|
| **P0 — Blocker prod** | 0 | — |
| **P1 — Înainte de firme externe** | 3 | Consent AI + PRIVACY.md, Dependabot, code signing |
| **P2 — Calitate/perf** | 4 | Stale closures Dosare/Termene, descompunere rnpm.ts, memoizare filtre |
| **P3 — Nice-to-have** | 6+ | Deduplicări, Context API, CSP cleanup, IPC timer |

---

## 7. Comparație cu auditul anterior (2026-05-22)

Auditul `DEEP-REVIEW-ARCHITECTURE-CODE-BUGS-SECURITY-2026-05-22.md` a evaluat v2.33.x–v2.35.x. Între timp:

| Finding anterior | Status v2.36.2 |
|---|---|
| B1 Error Boundaries lipsă | **Rezolvat** v2.36.0 |
| S2 Fără Dependabot | **Deschis** |
| S1 Binare nesemnate | **Deschis** |
| B2–B11 (medie/scăzut) | **Deschise** — neatinse |
| HARDENING Faza 3 Error boundaries | **Livrat** (dar HARDENING.md neactualizat — checkbox-uri vechi) |

**Opinie:** Progresul post-audit este focalizat și chirurgical (Error Boundaries, legal suffix UI, SOAP dot-strip). Backlog-ul structural rămâne stabil — nu s-a degradat, dar nici nu s-a redus semnificativ.

---

## 8. Concluzie

Legal Dashboard v2.36.2 este un proiect **madur, bine documentat și conștient de securitate**, cu o arhitectură care reflectă iterare disciplinată (33 migrări, 14 documente audit, CHANGELOG de 6600+ linii). Threat model-ul desktop este implementat corect; tranziția web este parțială dar gated explicit.

**Recomandare deployment:**
- **Desktop single-user:** Shippable acum. Zero blockers.
- **Web intern (Google OAuth, Caddy):** Shippable cu configurare corectă JWT + tenant keys + oauth2-proxy.
- **Web multi-tenant SaaS extern:** Necesită Postgres, dedup distribuit, consent GDPR, code signing, Dependabot — roadmap existent în HARDENING.md.

**Top 5 acțiuni (prioritate descrescătoare):**
1. Dependabot pentru supply chain
2. Consent dialog + PRIVACY.md (date juridice → AI providers)
3. Fix stale closure `handleSearch` (Dosare/Termene)
4. Descompunere `routes/rnpm.ts` + extragere duplicări
5. Code signing pentru distribuție externă

---

*Audit read-only. Niciun fișier sursă nu a fost modificat. Verificare toolchain: biome PASS, tsc PASS, vitest FAIL parțial (better-sqlite3 ABI mismatch local).*
