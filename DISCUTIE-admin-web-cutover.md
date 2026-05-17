# Discutie — Extensie Admin Panel + Audit Securitate Web Cutover

> **Status**: draft pentru discutie 2026-05-19. Nu e plan executiv, e baza de conversatie.
> Dupa aliniere → spargere in PR-uri concrete cu DoD checkboxes.

## Context

- Refactor Tier 3 + Tier 4 din `audit/AUDIT-REFACTOR.md` abandonate 2026-05-18.
- Roadmap monitoring + web cutover: tot codul PR-0 ... PR-11 e LIVRAT (vezi `EXECUTION-ROADMAP.md`).
- PR-10 (Litestream/GCS) + PR-12 (GDPR/hash-chain) eliminate 2026-05-03.
- Singurul pas ramas pentru cutover real = deploy operational (VPS + Docker + DNS + TLS + OAuth Google Workspace).
- **Inainte de deploy real** vrem 2 chestiuni rezolvate:
  1. Admin panel extins cu functionalitatile necesare pentru operare web.
  2. Audit serios de securitate (codebase + infra + threat model).

---

## Partea 1 — Extensie Admin Panel

### 1.1 Status actual (PR-8 livrat in `v2.7.x`)

**Backend** `/api/v1/admin/*` ([backend/src/routes/admin.ts](backend/src/routes/admin.ts)):

| Endpoint | Functionalitate | Guardrails |
|---|---|---|
| `GET /users` | list + paginare + search + filtre rol/status | — |
| `GET /users/:id` | detaliu user | 404 daca lipseste |
| `PATCH /users/:id/role` | schimba rol | `last_admin` 409 (refuza demotare ultim admin) |
| `PATCH /users/:id/status` | schimba status (active / suspended / deleted) | `self_deactivation` 409 |
| `GET /audit` | search audit_log | filtre: owner/actor/action/actionLike/targetKind/targetId/outcome/since/until/requestId |
| `GET /users/:id/quota` | list overrides quota AI | — |
| `PUT /users/:id/quota` | upsert override | milli-USD, body 4KB cap |
| `DELETE /users/:id/quota/:feature` | sterge override | idempotent 200 |

Toate rutele:
- gated cu `requireRole('admin')`
- audit pe write-uri cu `detail.before/after` pentru forensics
- envelope standard `{ data, error, requestId }`

**Frontend** ([frontend/src/pages/admin/](frontend/src/pages/admin)):

| Pagina | Contine |
|---|---|
| `/admin/users` | tabel cu paginare, filtre, dropdown role/status inline cu confirm-dialog |
| `/admin/audit` | tabel cu filtre (outcome, datetime range local TZ), paginare 50/pagina |
| `/admin/quota` | search user → list/add/edit/delete AI quotas |

Wrap [AdminGate](frontend/src/components/AdminGate.tsx) → 403 placeholder daca rol != admin. Server-side `requireRole` ramane autoritate.

**Sidebar** ([frontend/src/components/Sidebar.tsx:37-41](frontend/src/components/Sidebar.tsx#L37)):
- `adminNavItems` separat sub `mainNavItems`
- vizibil doar pe `isAdmin && !isDesktop` (desktop user-ul `local` are admin role dar UI-ul ascunde sectiunea)

### 1.2 Gap-uri identificate

#### Prioritate P1 — necesare la day 1 web

**A. Sessions active + force-logout** (`/admin/sessions`)
- Data exista in tabela `sessions` (PR-2).
- API lipseste complet.
- Util pentru: revoke session compromis, vezi cine e logat acum, log out user inainte de role demotion.
- Backend nou: `GET /api/v1/admin/sessions`, `DELETE /api/v1/admin/sessions/:id`, `DELETE /api/v1/admin/users/:id/sessions` (revoke all for user).

**B. AI usage global** (`/admin/ai-usage`)
- Data exista (PR-7 `ai_usage` table).
- Expusa doar per-user prin `/api/v1/ai-usage/summary`.
- Admin vrea: top-N owneri pe cost ultimele 24h/30d, breakdown per feature/model, daily trend.
- Backend nou: `GET /api/v1/admin/ai-usage/top?window=24h|30d`, `GET /api/v1/admin/ai-usage/trend`.

**C. Monitoring health** (`/admin/monitoring`)
- Data exista in `monitoring_runs` + `monitoring_alerts`.
- Lipseste un panou consolidat.
- Continut: nr. joburi active per kind, distributie `fail_streak`, count `source_error` ultimele 24h, joburi `aborted` recente, scheduler last tick timestamp, claim throughput.
- Backend nou: `GET /api/v1/admin/monitoring/health`.

**D. System config readonly** (`/admin/system`)
- Pe web fara SSH e singurul mod de a vedea state-ul runtime.
- Continut: feature flags active (`MONITORING_DISABLED_KINDS`, `OPENROUTER_DISABLED`, `LEGAL_DASHBOARD_AUTH_MODE`, `MONITORING_ENABLED`), SMTP enabled da/nu, captcha provider keys configurate da/nu (NU expune valori), versiune app, schema migration version, uptime process.
- Backend nou: `GET /api/v1/admin/system/info` — niciodata expune valori sensibile, doar status booleans.

#### Prioritate P2 — utile post-stabilizare

**E. Backup history + manual trigger** (`/admin/backups`)
- Pe desktop exista in modalul "Info baza locala".
- Pe web ramane orfan.
- Continut: lista ultime 30 zile cu success/fail, dimensiune, button "Backup acum".
- Backend exista partial (backup repository) — necesita endpoint admin-scoped.

**F. Email dispatcher view** (`/admin/email`)
- Continut: list `owner_email_settings`, cine e enabled, ce adresa, test send button.
- Util pentru debug "de ce X nu primeste alerte".

**G. Rate limit hits** (`/admin/abuse`)
- Continut: IP-uri / owneri care au lovit limita ultimele 24h.
- Data partial in audit_log + rate limiter logs.

#### Prioritate P3 — cand vine SSO Workspace real

**H. First-login provisioning**
- Daca strategia e auto-provision cu rol implicit `user`: nu necesita UI.
- Daca strategia e admin-approval: pagina `/admin/pending-users` cu approve/reject.

### 1.3 Amplasare propusa

```
Sidebar > Administrare/
  Utilizatori       /admin/users       EXISTA
  Sesiuni           /admin/sessions    NEW P1
  Audit             /admin/audit       EXISTA
  Cote AI           /admin/quota       EXISTA
  Consum AI         /admin/ai-usage    NEW P1
  Monitorizare      /admin/monitoring  NEW P1
  Sistem            /admin/system      NEW P1
  Backups           /admin/backups     NEW P2
  Email             /admin/email       NEW P2
  Abuz              /admin/abuse       NEW P2
```

Toate gated identic (`requireRole('admin')` + `AdminGate`), toate emit audit pe writes. Pattern preluat 1:1 din `admin.ts` existent. Estimari brute:
- P1 (4 pagini): ~16-20h codare + ~6h teste
- P2 (3 pagini): ~10h codare + ~4h teste
- P3 (1 pagina, conditional): ~4h

---

## Partea 2 — Audit Securitate Serios

> **Scop**: inainte de a expune aplicatia pe internet sub `https://legal.firma.ro`, parcurgem un audit pe 12 capitole. Output dorit per capitol: tabel **Status** (PASS / WARN / FAIL) + Finding + Fix.

### Capitole de audit (de discutat maine ordinea + adancimea)

#### S1. Auth + Sessions

- JWT secret: lungime, rotatie, fallback la reboot, storage server-side.
- Session lifecycle: expiry, refresh token rotation, revocation across all clients.
- Cookie flags: `HttpOnly`, `Secure`, `SameSite=Lax` minimum, `__Host-` prefix.
- Logout invalidation: server-side blacklist sau short-lived JWT + refresh?
- CSRF: cookie-based session → necesita token CSRF pe POST/PUT/PATCH/DELETE; verifica daca implementarea PR-9 are token-ul sau se bazeaza pe `SameSite`.

#### S2. OAuth2 / OIDC Google Workspace

- `state` parameter cu nonce per cerere — verifica daca PR-9 il valideaza.
- PKCE flow obligatoriu (chiar daca client public nu, web confidential client tot benefits).
- Redirect URI strict match (whitelist exacta, fara wildcard).
- Domain restriction `hd=firma.ro` la authorize + verificare server-side a `email_verified` + `hd` claim in ID token.
- ID token verification: `iss` (`https://accounts.google.com`), `aud` (client_id), `exp`, `nbf`, `nonce`.
- Token storage: server-side sessions (NU expune `access_token` la browser).

#### S3. API Surface Exposure

- Rate limits per-IP vs per-user: in desktop e per-IP via `getConnInfo`; in web `X-Forwarded-For` de la reverse proxy — exista risc spoof daca proxy-ul nu strip-uieste headerele de client.
- Body limits: verificate per ruta? RNPM bulk 512KB, search 64KB, AI 100KB — sunt aliniate cu reality?
- Expensive endpoints: AI multi-analyze (timeout 480s/1020s pe chinese stack), RNPM search-split (45min), monitoring job manual run — toate gated cu quota / role?
- 404 vs 401 vs 403: leak de existence prin status code?

#### S4. Multi-tenant Isolation

- `owner_id` enforcement: PR-1 a fix-at 5 leakuri. Re-grep azi pentru orice raw `SELECT ... WHERE owner_id = ?` lipsa (verifica ca toate cele 20+ tabele cu `owner_id` sunt scoped in EVERY query).
- Helper `getOwnerId(c)` folosit consistent? Sau exista call-uri raw la `c.get('ownerId')` fara fallback?
- Admin endpoints: cand admin face actiuni cross-tenant, `owner_id` se schimba corect in repo calls?
- SSE stream `/api/v1/alerts/stream`: verifica ca filter-ul de owner aplica pre-emit, NU post-emit.

#### S5. Audit Log Integrity

- Append-only enforcement: SQLite trigger care refuza UPDATE/DELETE pe `audit_log`?
- Tamper detection: hash-chain a fost eliminat (PR-12), dar verifica ca admin nu poate sterge prin alta ruta.
- PII in audit_log: `detail_json` poate contine email-uri / CNP-uri? Daca da, retention policy aliniata cu GDPR daca scope-ul se schimba la per-firma.
- Audit log retention: 1 an default? cron purge livrat?

#### S6. Secrets Management

- Env vars vs Docker secrets vs Vault: in docker-compose preconizat e `.env` file — adecvat?
- Secrete care NU trebuie sa apara in logs: `SMTP_PASS`, `OPENROUTER_API_KEY`, JWT secret, OAuth client secret, captcha provider keys. Verifica masking in logger.
- Git history scan: `git log -p | grep -E "(api_key|secret|password|token)" -i` — clean?
- Backup-uri SQLite — daca contin secrete in cleartext (api keys cifrate pe desktop dar nu pe web)?
- Captcha keys server-side: `rejectCaptchaKeyInWebMode` blocheaza body-supplied — verifica ca alternative server-side e implementata corect cand vine cutover real.

#### S7. CSP + Headers

- CSP curent: `script-src 'self'` strict pe desktop. Pe web: PDF.js / xlsx-style chunks lazy-loaded de la `/assets/` — verifica `script-src 'self'` ramane suficient.
- HSTS: max-age=31536000, includeSubDomains, preload — config in reverse proxy.
- `frame-ancestors 'none'` (anti-clickjacking).
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy`: dezactiveaza camera/microphone/geolocation.
- CORS: in desktop loopback only; pe web origin explicit `https://legal.firma.ro`, NU `*`.

#### S8. Input Validation

- Zod schemas pe toate rutele cu body? Verifica `bulk-dismiss` discriminated union (livrat v2.14.0).
- Query string limits: `pageSize` cap, `search` length, regex anchored.
- File upload: name list XLSX/CSV — header parser hardened impotriva XXE? `xlsx` lib are CVE history (prototype pollution) — verifica versiunea curenta + alternativele.
- Zip bombs: XLSX e ZIP — limit decompress ratio?

#### S9. SQL Injection / Repository Discipline

- Toate query-urile prin `better-sqlite3` prepared statements?
- Grep pentru template literals cu `${}` in SQL strings → daca exista, e finding.
- Dynamic ORDER BY / LIMIT: whitelisted columns?
- Migration files: nu contin user input la runtime — clean.

#### S10. Dependency Audit

- `npm audit --production` — snapshot azi, urmaresc CVEs HIGH/CRITICAL.
- `package-lock.json` review pe top-level deps: versiuni pin-uite la SemVer minor sau patch?
- Renovate / Dependabot configurat in GitHub?
- Lista deps cu istoric de CVE: `xlsx`, `node-fetch` (daca exista), `better-sqlite3` (native, ABI risk distinct).

#### S11. Docker / Infra Hardening

- Base image: `node:22-alpine` slim? sau `distroless`?
- Non-root user in Dockerfile: `USER node`.
- Read-only filesystem mount cu `tmpfs` pentru `/tmp`.
- Capabilities drop: `--cap-drop=ALL` minimum.
- Health check: `/health` exista — verifica ca NU expune info sensibile.
- Network: reverse proxy bind doar pe 443; backend bind doar pe loopback in Docker network.
- TLS: TLS 1.3 minimum, certificate management (Let's Encrypt auto-renew).
- Reverse proxy hardening: rate limit la nivel proxy (Caddy / Traefik), connection limits.

#### S12. Data Leakage in Logs / Errors

- Error responses: leak stack trace in production? Verifica `NODE_ENV=production` strip-eaza.
- Log redaction: emails / CNP-uri / tokens — masked in logger?
- Audit log entries: `detail` field nu contine plaintext secrets.
- SOAP error responses cached / logged?

### Output dorit din audit

Per capitol:
1. Status global: PASS / WARN / FAIL
2. Findings concrete cu file:line + severity (LOW/MED/HIGH/CRITICAL)
3. Fix proposal (cod sau config)
4. Verification step

Tooling propus:
- `npm audit` + `osv-scanner` pentru CVE-uri tranzitive
- `gitleaks` pe history pentru secrets
- Manual review pe routes/middleware (auditori interni: deep-code-reviewer + repo-security-auditor agents)
- Browser smoke: penetration testing usor cu Burp Suite Community pe staging

### Discutie pentru maine

1. Ordinea: incepem cu admin panel extension sau audit?
   - Optiunea A: audit intai → fix findings → DUPA extindem admin (mai sigur).
   - Optiunea B: extindem admin → audit cuprinde tot la final (mai eficient ca timing).
2. Scope audit: toate 12 capitole sau prioritizam S1+S2+S4+S6 (auth/owner/secrets) ca P0?
3. Tooling: rulam agentii interni (`repo-security-auditor`, `deep-code-reviewer`, `backend-reliability-reviewer`) sau audit manual cu tine ca pereche?
4. Deliverable: doc separat `AUDIT-SECURITY-WEB-CUTOVER.md` cu findings, sau capitol nou in `SECURITY.md` existent?
5. Threshold de blocare deploy: orice CRITICAL = stop, HIGH = decizie caz-cu-caz?

---

## Trasabilitate

- Memorie referinta: `project_pr10_pr12_eliminated` (roadmap status), `refactor-tier3-tier4` (abandonate 2026-05-18)
- Sursa admin existent: `audit/AUDIT-REFACTOR.md` §8 [CLOSED 2026-05-17]
- Sursa cutover web: `EXECUTION-ROADMAP.md` saptamana 9 (PR-8) si saptamana 10-11 (PR-9)
- Versiune curenta: v2.28.3 (2026-05-17)
