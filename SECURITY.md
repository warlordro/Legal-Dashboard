# Legal Dashboard — Security Model

## Threat model

Legal Dashboard is a **single-user desktop application**. The backend is a local
Node.js HTTP server that binds to `127.0.0.1` by default and is consumed by the
Electron renderer in the same process tree. The deployment assumption is:

> The machine running Legal Dashboard is trusted. The user running the app is
> trusted. Other users on the same LAN are **not** trusted.

Everything below is framed against that assumption. If you intend to run the
backend as a shared service (web-mode), read the "Out of scope" section first
and treat the current defaults as insufficient.

## In scope — what the app protects against

### Desktop attack surface (Electron)

- **Remote code execution via renderer** — `nodeIntegration: false`,
  `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, dedicated
  `preload.js` exposing a minimal `window.desktopApi`. CSP is set in
  `onHeadersReceived` and limits `script-src` to `'self'`.
- **Navigation hijack** — `will-navigate` refuses anything that is not
  `http://localhost:${BACKEND_PORT}` or the `127.0.0.1` equivalent.
- **Popup phishing / OAuth-style open-in-browser tricks** —
  `setWindowOpenHandler` denies all popups; only an explicit allowlist of
  government hosts (`portal.just.ro`, `portalquery.just.ro`, `www.just.ro`,
  `mj.rnpm.ro`, `www.rnpm.ro`) may be opened externally via `shell.openExternal`,
  and only over `https:`.
- **DB corruption from parallel writers** —
  `app.requestSingleInstanceLock()` guarantees one Electron process per
  `userData` directory; a second launch focuses the existing window instead of
  spawning a second backend on the same SQLite file.
- **DevTools exposure in production** — `devTools: IS_DEV` plus a dev-only
  menu entry. Production builds have DevTools off.

### API-key storage (desktop)

- Keys are held in the renderer only transiently. At rest, the renderer calls
  `window.desktopApi.encryptKeys(...)` which round-trips through `ipcMain` to
  `safeStorage.encryptString` — DPAPI on Windows, Keychain on macOS, libsecret
  on Linux. The ciphertext (base64) lands in `localStorage`; plaintext never
  touches disk.
- The IPC bridge caps input sizes (`MAX_PLAINTEXT = 8 KiB`,
  `MAX_CIPHERTEXT_B64 = 16 KiB`) and exposes only three channels:
  `safeStorage:available`, `safeStorage:encrypt`, `safeStorage:decrypt`. No
  file system, shell, or arbitrary-IPC access from the renderer.
- On first launch after upgrade, the legacy obfuscated blob
  (`portaljust-api-keys`) is migrated to the encrypted blob
  (`portaljust-api-keys-enc`) and the legacy entry is removed.
- **Web fallback** (no `desktopApi`) uses reversible base64 + reverse
  obfuscation — explicitly **not** a security control; it exists to keep
  casual localStorage snapshots from leaking keys in cleartext.

### Backend hardening

- **Loopback-only bind by default**. `HOST` is validated against the set
  `{127.0.0.1, localhost, ::1}`. Any other value is ignored unless the operator
  sets `LEGAL_DASHBOARD_ALLOW_REMOTE=1` explicitly; a warning is logged.
- **CSP** on every backend response via Hono `secureHeaders`:
  `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`
  (Tailwind runtime), `img-src 'self' data:`, `object-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
- **Rate limiting keyed on the real socket IP** via
  `getConnInfo(c).remote.address` — header-spoofing (`X-Forwarded-For`) cannot
  bypass the limiter. Loopback gets a higher ceiling than other addresses
  because all traffic is the same user.
- **Auth pluggable seam (PR-9 branch).** `LEGAL_DASHBOARD_AUTH_MODE=desktop`
  remains the default and sets the seeded `local` identity. In
  `LEGAL_DASHBOARD_AUTH_MODE=web`, API requests fail closed unless they carry a
  valid HS256 session token/JWT via `Authorization: Bearer ...` or the
  `legal_dashboard_session` HttpOnly cookie; the token subject must map to an
  active row in `users`. Missing/invalid/expired tokens do not fall back to
  `local`. This is the backend seam only; real Google Workspace SSO/deploy/TLS
  cutover remains out of scope for this branch.
- **Web mode este auth seam, nu produs web self-service.**
  `LEGAL_DASHBOARD_AUTH_MODE=web` activeaza validarea JWT
  (issuer/audience/secret) si forteaza cookies `Secure`. Nu este livrat un
  endpoint `/login` first-party: tokenele trebuie emise de un IdP extern
  (Google Workspace, Auth0, etc.) si injectate prin cookie
  `legal_dashboard_session`. `/health` expune `authMode` si
  `loginAvailable:false` pentru ca operatorii sa nu confunde modul web cu un
  produs deploy-ready out-of-the-box.
- **Boot guard remote+desktop refused (PR-9).** `LEGAL_DASHBOARD_ALLOW_REMOTE=1`
  cere `LEGAL_DASHBOARD_AUTH_MODE=web`, JWT secret valid si ack explicit.
  Desktop/local pe LAN este refuzat la boot.
- **Pre-auth rate limit (PR-9).** `/api/*` are un bucket IP-only inainte de
  `ownerContext`, ca floods cu token missing/invalid sa nu epuizeze la infinit
  HMAC/user lookup. Requesturile autentificate cu succes elibereaza bucket-ul
  pre-auth si raman guvernate de limiter-ul per-owner.
- **`/health` public si non-sensitive.** Ruta este mount-uita inainte de auth si
  nu contine PII sau statistici DB; readiness probes functioneaza fara token.
- **AI key precedence**: if `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
  `GOOGLE_AI_KEY` are set in the backend environment, they take precedence
  over keys submitted in the request body. This lets an operator who runs the
  backend as a service prevent the renderer from overriding the server's keys.
- **Web tenant API keys (v2.30.0)**: in `LEGAL_DASHBOARD_AUTH_MODE=web`,
  admin-configured AI and captcha keys are stored in `tenant_api_keys` as
  AES-256-GCM ciphertext with separate iv/tag columns. The master key is
  `TENANT_KEY_ENCRYPTION_SECRET`, required in web mode and not stored in the
  database. API responses expose only configured/not-configured status and
  `last4`; audit details never include plaintext or ciphertext. Non-admin
  web requests still cannot supply BYOK `apiKeys`/`captchaKey` in the body.
- **SOAP fan-out cap** (`MAX_SOAP_FANOUT = 500`) on `/api/dosare/load-more`
  and `/api/termene/load-more` to prevent an attacker (or a buggy client) from
  amplifying one request into thousands of upstream SOAP calls.
- **Email notifier isolation (PR-11).** SMTP credentials are read only from
  server-side `SMTP_*` environment variables. Per-owner email settings default
  to disabled, HTML email bodies escape alert payloads, and SMTP failures are
  logged without blocking alert insert, SSE, native notifications, or the
  in-app alerts inbox.

### Background monitoring activity

The monitoring scheduler (live and hardened in v2.2.0, further hardened in v2.3.0 and extended with `name_soap` in v2.4.0, `backend/src/services/monitoring/scheduler.ts`) runs background jobs that periodically refresh dosar / termene state from PortalJust SOAP. It inherits the desktop trust model - same OS user, same SQLite, no extra network surface - and adds the following controls:

- **Single-instance enforcement.** The scheduler runs only inside the Electron main process, which is itself gated by `app.requestSingleInstanceLock()`. There is no second writer racing the scheduler against the same SQLite file.
- **Cooperative cancellation.** Every outbound SOAP request is wired through an `AbortSignal` chained to: (a) per-request timeout (`SOAP_REQUEST_TIMEOUT_MS`), and (b) the scheduler's shutdown signal. App-quit flushes in-flight runs instead of leaking sockets or holding SQLite WAL locks past process exit.
- **Maintenance lock (RWLock).** Backup / restore acquire `withMaintenanceWrite` (writer-exclusive); scheduler ticks acquire `withMaintenanceRead`. Backups cannot observe a half-applied job outcome, and the scheduler cannot start a new tick while a backup is running. The lock is writer-preference, so a maintenance request cannot be starved by a busy tick loop.
- **Outcome atomicity.** `finalizeRun` + `markJobOutcome` are wrapped in a single `db.transaction`, so a job's `runs` row, `next_run_at`, and `last_status` move together. A crash mid-tick cannot leave a "succeeded but never advanced" job. Orphaned `running` runs from a previous process are recovered on boot (`recoverOrphanRuns`).
- **One-running-run-per-job DB enforcement (v2.3.0).** Migration `0005_one_running_run_per_job.up.sql` adds a UNIQUE partial index `idx_one_running_per_job` on `monitoring_runs(job_id) WHERE status='running'`. Even a buggy scheduler reset cannot insert a duplicate `running` row — the DB rejects it. Removes a class of finalize races that pre-v2.3.0 were guarded only at code level.
- **Restore integrity check (v2.3.0).** `restoreFromBackup` runs `PRAGMA integrity_check` against the candidate file before promoting it; sidecar WAL/SHM unlinks are detected for non-ENOENT errors so a disk-full does not pass silently.
- **Graceful shutdown drain (v2.3.0).** On `SIGTERM`/`SIGINT` the HTTP server drains in-flight requests with a 30-second timeout before the scheduler is stopped and the DB is closed. Eliminates a class of dropped-request races on Quit.
- **Source-error suppression.** A job that fails 5 times consecutively against the upstream source is marked `source_error` and stops scheduling until manual intervention. This bounds noise (audit log, console, retries) when PortalJust is degraded — a single outage cannot generate unbounded retries or fill the audit log.
- **Per-kind operational kill switch.** `MONITORING_DISABLED_KINDS` excludes listed kinds (`dosar_soap`, `name_soap`, `aviz_rnpm`) from scheduler claims without mutating job rows. This lets an operator pause one runner class while keeping the rest of the app live.
- **Body-size limits on monitoring mutations.** Monitoring POST/PATCH/manual-run routes use a dedicated request body cap before JSON parsing. Oversized payloads are rejected before they can allocate large request objects.
- **Run retention purge.** `monitoring_runs` history is purged daily with a 90-day retention window. The purge timer is stopped with the scheduler, so shutdown does not leave background work behind.
- **Owner scoping.** Every scheduler-driven mutation carries the owning `owner_id` into `recordAudit`. Cross-owner mutations from the API surface are rejected as `404` (not `403`) so status codes do not disclose the existence of other owners' jobs; the differentiation is preserved only in the audit log (`*_denied` actions).
- **No external network beyond the existing allowlist.** The scheduler only calls the same PortalJust SOAP endpoints already used by foreground search. It does not introduce new outbound hosts and is bound by the same external-URL allowlist.

The scheduler does **not** add authentication, encryption, or rate-limiting to its own outbound calls — those are inherited from the foreground SOAP path. It also does **not** run on the web (server-mode) deployment until per-owner rate-limiting and per-tenant isolation land; see "Out of scope".

### Data-at-rest / data-exported

- **XLSX formula-injection escape**. On export, any string cell whose value
  begins with `=`, `+`, `-`, `@`, `\t`, or `\r` is prefixed with a single
  quote so it is rendered as text by Excel / LibreOffice instead of evaluated
  as a formula. Applied to every sheet produced by
  `frontend/src/lib/export.ts` and `rnpmExport.ts`.
- **Markdown / HTML sanitization** uses DOMPurify with an allowlist of
  `[strong, em, b, i]` and `ALLOWED_ATTR: []` — no attributes, no URLs, no
  script vectors.
- **Solutie truncation** (`TRUNCATE_SOLUTIE = 5000`) limits the size of
  court-decision text that round-trips through the AI prompt path, bounding
  the token spend and prompt-injection surface.

## Environment configuration

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Non-loopback values are ignored unless `LEGAL_DASHBOARD_ALLOW_REMOTE=1`. |
| `LEGAL_DASHBOARD_ALLOW_REMOTE` | unset | Set to `1` to allow non-loopback `HOST` binds. Requires web auth + explicit ack. |
| `LEGAL_DASHBOARD_ACK_NO_AUTH` | unset | Must be `i-understand-no-auth-yet` when remote bind is enabled. |
| `LEGAL_DASHBOARD_PORT` | `3002` | Backend port. Electron sets this automatically. |
| `LEGAL_DASHBOARD_DB_PATH` | `%APPDATA%/legal-dashboard/legal-dashboard.db` | SQLite path. Electron sets this. |
| `LEGAL_DASHBOARD_AUTH_MODE` | `desktop` | Auth provider selector. `desktop` keeps `local`; `web` requires signed JWT/session auth. |
| `APP_MODE` | unset | Backward-compatible alias for `LEGAL_DASHBOARD_AUTH_MODE` when the primary variable is unset. |
| `LEGAL_DASHBOARD_JWT_SECRET` / `JWT_SECRET` | unset | Required in web auth mode; minimum 32 characters. |
| `LEGAL_DASHBOARD_JWT_ISSUER` / `LEGAL_DASHBOARD_JWT_AUDIENCE` | unset | Optional JWT claim checks in web auth mode. |
| `LEGAL_DASHBOARD_JWT_TTL_SECONDS` | `3600` | TTL for refreshed web auth session tokens; allowed range `60..86400`. |
| `LEGAL_DASHBOARD_AUTH_TOKEN_TTL_SECONDS` | unset | Legacy alias for JWT TTL. |
| `LEGAL_DASHBOARD_AUTH_COOKIE_SECURE` | secure in web mode | Set to `0` only for local HTTP testing. |
| `TENANT_KEY_ENCRYPTION_SECRET` | unset | Required in web auth mode for centralized tenant API keys. Must decode from base64 to exactly 32 bytes. Store separately from DB backups; losing it requires re-entering all tenant keys from `/admin/keys`. |
| `MONITORING_ENABLED` | `1` in Electron | Set to `0` to disable monitoring routes and scheduler. |
| `MONITORING_DISABLED_KINDS` | unset | Comma-separated monitoring kinds to skip in scheduler claims, for example `dosar_soap,name_soap`. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` | unset | Optional SMTP channel for alert emails. Incomplete config disables email without blocking boot. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_AI_KEY` / `OPENROUTER_API_KEY` | unset | If set, override tenant DB keys in web mode and in-app keys on desktop. Normal web setup should prefer `/admin/keys`. |
| `NODE_ENV` | `production` in Electron | `development` enables DevTools and the dev menu. |

Desktop v2.4.0: the 2Captcha / CapSolver key is **not** read from env; it is
entered in-app and persisted via `safeStorage` on desktop. Planned PR-9
web/server mode: captcha provider keys move to server-side env/config and are
not BYOK / not supplied by the browser client.

## Out of scope — what the app does **not** protect against

- **Malicious code running as the same OS user.** `safeStorage` decrypts
  transparently for the logged-in user; any process running as that user can
  call the same IPC (via a hijacked renderer) or read DPAPI-protected secrets.
  Defense here is OS-level (antivirus, least-privilege user accounts).
- **Compromised dependency (supply-chain attack).** npm packages are trusted
  at install time. No hash pinning beyond `package-lock.json`; no runtime
  allowlisting. If `xlsx-js-style`, `better-sqlite3`, or `@hono/node-server`
  ships a malicious update, the app is compromised. Mitigation: review
  lockfile diffs, use `npm ci` in CI, run `npm audit` regularly.
- **`xlsx` parser CVEs — REZOLVAT in v2.6.4.** Backend-ul foloseste acum
  `exceljs@^4.4.0` pentru `XLSX.read()`-ul reachable via
  `/api/v1/name-lists/preview` si `/commit` (PR-5, bulk import Monitorizare).
  `xlsx@0.18.5` ramane in `devDependencies` doar pentru fixture-urile de
  test — nu mai ajunge in bundle-ul productie. Mitigari active in
  `nameListParser.ts`: cap 10MB body, max 50K rows, max 20 cols, timeout 30s
  pe parse (Promise.race). Frontend-ul pastreaza `xlsx-js-style.writeFile()`
  pentru EXPORT (date deja validate intern, nu primeste spreadsheets de la
  atacatori) — neafectat de CVE-uri pe path-ul write-only.
- **Unsigned Windows binaries.** We do not currently code-sign Windows
  installers. SmartScreen will warn on first launch. Obtaining and wiring an
  EV / OV certificate is tracked separately.
- **LAN-mode hardening (v2.6.4 — fail-closed by default).** Setting
  `LEGAL_DASHBOARD_ALLOW_REMOTE=1` (or HOST non-loopback) refuza acum pornirea
  backend-ului pana cand operatorul confirma explicit ack-ul `LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet`.
  Cand ack-ul e prezent, request-urile state-changing (POST/PUT/PATCH/DELETE)
  de la peers non-loopback sunt validate prin `originGuard` middleware:
  Origin/Referer trebuie sa match-uiasca Host-ul, altfel 403
  `csrf_origin_mismatch`. Loopback (desktop la el insusi) trece liber pe
  toate metodele. Remote bind in `desktop` mode este refuzat; TLS, SSO real si
  token revocation raman pentru PR-10+.
- **SOAP traffic to `portalquery.just.ro`.** Upstream is HTTP-by-default for a
  legacy government service. The app uses HTTPS where the endpoint supports
  it, but certain portals do not; this is intentional and documented here so
  nobody tries to "fix" it without understanding the compatibility impact.
- **Screenshot / clipboard exfiltration by other apps.** Standard desktop
  threat model — not something the app can prevent.

## Reporting a vulnerability

File an issue with the `security` label, or email the maintainer directly if
the report should be private. Please include:

- Version (`package.json` version string or commit hash)
- OS + Electron version (`Ajutor → Despre Legal Dashboard`)
- Reproduction steps and observed vs. expected behaviour
- Whether the issue requires local OS access, network access, or a specific
  configuration (`LEGAL_DASHBOARD_ALLOW_REMOTE=1`, custom `HOST`, etc.)

## Change log

| Date | Change |
|---|---|
| 2026-05-20 | v2.34.0 web hardening (4 P0 + 8 P1 din auditul intern v2.33.0): **P0 — Auth surface:** Google OAuth2 device-code GET handler eliminat (POST-only); `device_codes` rate-limit per `(ip, ua)` pe 5s/min/30min cu fail-closed cand UA lipseste (P0-1). Admin guards intarite pe rutele `/admin/tenant-keys` (`POST/DELETE`) — operatorul admin trebuie sa fie owner-ul tenantului (`requireTenantOwner`), nu doar membru `requireRole("admin")` (P0-2). `/admin/users/:id/grants` modificarile non-revoke (`grant_create`, `extend`) blocate cu `cannot_modify_own_grants` cand admin-ul opereaza pe propriul user (P0-4). Bodu request RNPM `apiKey`/`captchaKey` warning hardening: log line schimbat sa includa stack trace + `X-Auth-Source` header pentru forensics (P1-5). **P1 — Reliability + rate-limit:** SOAP fan-out retry budget per request: max 3 retries pe failure tranzient (timeout, ECONNRESET, 502/503/504); peste, returneaza ultimul error (P1-1). `captcha/balance` per-tenant TTL cache 5min (la fiecare provider) — anti-spam pe upstream cand UI poll-uieste `/admin/keys` (P1-2). Per-tenant tenant-key owner guard pe `/admin/tenant-keys` (verificare suplimentara peste `requireRole("admin")`) — protejeaza fata de "admin la tenant X cere POST cu `tenantId=Y`" (P1-3). Captcha quota schimbata din **cost-based** in **count-based** per-user: `getCaptchaQuotaState` + `incrementCaptchaQuotaUsage` (atomic, in tranzactie); 3 ferestre rolling 24h/7d/30d cu intent-recording la guard accept (NU dupa upstream success — risk overcount-never-undercount). Override per-user via `user_quota_overrides` cu FK la `users(id)`. UI `/admin/quota` dual-unit (req / USD-milli) cu legenda explicita (P1-4). RNPM body-key warning structured logging (P1-5). Web mode owner-scoped tenant key guard suplimentar pe `/admin/tenant-keys` (P1-6). **P1 — Operational readiness:** CI smoke-test fixtures via `openssl rand` fallback in `.github/workflows/docker-build.yml` — `${{ secrets.CI_JWT_SECRET || steps.fixtures.outputs.jwt_secret }}` pattern, no inline literal secrets (P1-7). Offsite backup hook in `backup.ts`: env-configurable shell command `LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD` invoked dupa `rename` atomic; fail-open (local backup ramane chiar daca hook failure); structured JSON `offsite_backup` / `offsite_backup_failed` log line. 4 teste POSIX-only `it.skipIf(isWindows)` in `backup.test.ts`. RUNBOOK.md (~400 linii, 12 sectiuni Ro fara diacritice) acopera incident playbooks (boot fail, DB corruption, restore local + offsite, tenant key loss, rollback, quota reset, JWT rotation, forensics) + Sentry SDK amanat la v2.35.0 cu workaround documentat (stdout structured JSON e grep-friendly cu Loki/Promtail/fluent-bit) (P1-8). **Test coverage:** 1334 pass / 5 skipped backend. **Verificare:** biome check pass, `tsc --noEmit` pass backend + frontend, `npm run build` pass. **Desktop:** ZERO impact — toate schimbarile gateuite pe `getAuthMode() === "web"` sau pe web-only routes. |
| 2026-05-19 | v2.33.0 security hardening: closes CRITICAL-1 + 5 HIGH + 11 MEDIUM + 3 LOW across quota/budget, deployment topology, validation I/O and audit trail. Quota reservations are web-only, atomic and provider-specific; pending estimates count in rolling budget windows while desktop remains a no-op. Deployment adds SQLite instance locking before DB init, stale reclaim audit, explicit trusted proxy CIDR for `X-Forwarded-For`, Caddy header stripping and digest-pinned reverse-proxy images. External I/O now has streaming SOAP byte caps, RNPM runtime validation fail-closed by default (`RNPM_RUNTIME_VALIDATION_DISABLED=1` is the rollback switch), Google key validation via header and BCE FX plausibility fail-closed with no manual fallback. Audit log keeps secrets out: key/captcha events expose only metadata, SMTP errors are sanitized, logout attribution avoids plaintext/session resurrection, `audit.viewed` is emitted only for investigative filters, and `system.boot` / `system.shutdown` provide minimal operational traceability. |
| 2026-05-19 | v2.32.0 quota policies extension (web mode only): `quotaGuard` middleware now enforces rolling-window budgets per feature (day=86400s, week=604800s, month=2592000s — locked seconds; no manual override) and treats `effective_limit_milli = base_limit + Σ active_grants` (NULL = unlimited, no enforcement). New tables: `user_quota_grants` (admin-issued extra credit with `expires_at` ISO; revocation idempotent via `revoked_at`/`revoke_reason`), `fx_rates` (BCE USD/EUR with `fetched_at`/`stale` derivation), `budget_notifications` (state machine: `above_threshold_since`/`fired_at`/`cleared_at`/`email_sent_at`). 80% soft warning fires email+banner once per episode, auto-clears when consumption drops below threshold (no manual close API — anti-spam by design). FX feed pulls `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` daily at 16:30 CET via 10s `AbortController`; boot fail-safe single-shot fetch. **D14 fail-closed EUR display:** UI shows `"EUR indisponibil"` if `fx.rate IS NULL` or `fx.stale === true` (rate older than 48h) — no hardcoded fallback rate, no manual entry. Admin grant routes (`POST/DELETE /api/v1/admin/users/:id/grants`, `DELETE /api/v1/admin/grants/:id`) require `requireRole("admin")`; audit `admin.users.grant_create` / `admin.users.grant_revoke` records `feature`, `extraUsdMilli`, `expiresAt`, optional reason — never includes plaintext API keys or master secret. `quotaGuard` short-circuits when `getAuthMode() !== "web"` — desktop ZERO impact (no DB writes, no enforcement, no warnings). No change to rate-limits, body caps, CORS allow-list, AI HTML sanitization, or renderer URL whitelist (BCE fetch is server-side only and bypasses Electron CSP `connect-src 'self'`). |
| 2026-05-19 | v2.31.0 server deployment stack (bridge `/auth/oauth2/sync` for oauth2-proxy): new POST endpoint accepts `X-Auth-Request-Email` / `X-Forwarded-Email` only when paired with a shared secret `X-Proxy-Auth` compared via `timingSafeEqual`; secret read from `LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET` (fallback `OAUTH2_PROXY_SHARED_SECRET`) with minimum length 32 chars (fail-closed if missing/too-short — endpoint returns `bridge_disabled` 503). Endpoint is also gated by `LEGAL_DASHBOARD_AUTH_MODE=web` (returns 400 `desktop_only` otherwise). Endpoint never auto-provisions users: missing user returns 403 `not_provisioned`; suspended user returns 403 `account_inactive`. Audit log writes `auth.oauth2.sync` events with **only** `emailHash` (SHA-256 hex prefix, 16 chars) — never plaintext. Successful path mints an HS256 JWT identical to `/auth/login` (same `signAuthToken` / `writeSessionCookie` path → HttpOnly + Secure + SameSite=Lax + Path=/). Deploy stack (`deploy/docker-compose.prod.yml`): Caddy 2.8 auto-TLS + oauth2-proxy v7.7.1-alpine + backend in single network; backend uses `expose: 3002` (no `ports:` — unreachable from host network); oauth2-proxy `pass_authorization_header=false` + `pass_access_token=false` prevents Google tokens from leaking to backend or its logs; `OAUTH2_PROXY_INJECT_REQUEST_HEADERS="X-Proxy-Auth=${PROXY_BRIDGE_SECRET}"` ensures only the proxy can call the bridge. Caddyfile adds HSTS (max-age=63072000+preload), Referrer-Policy `no-referrer`, X-Content-Type-Options nosniff, X-Frame-Options DENY, -Server. `scripts/seed-admin.mjs` provisions the first admin idempotently (no plaintext password ever stored; web users never use password auth). New backend test file `auth.oauth2.test.ts` (12 tests) pins all failure modes: secret unset/short, bad/missing `X-Proxy-Auth`, missing/malformed email, user not provisioned, suspended user, audit log contains no plaintext email, desktop_only rejection. No change to existing rate-limits, body cap, CORS allow-list, AI HTML sanitization, or external URL whitelist. |
| 2026-05-19 | v2.30.0 web admin centralized keys: `tenant_api_keys` stores Anthropic/OpenAI/Google/OpenRouter/2Captcha/CapSolver keys encrypted with AES-256-GCM under `TENANT_KEY_ENCRYPTION_SECRET`; `/admin/keys` is admin-only and returns only `set`/`last4`; audit rows never include plaintext/ciphertext. Web non-admin BYOK remains blocked, AI quota enforcement returns `QUOTA_EXCEEDED` with `Retry-After`, and RNPM captcha in web mode resolves provider/mode/key server-side from tenant DB. Desktop safeStorage/BYOK behavior remains unchanged. |
| 2026-05-16 | v2.28.0 OpenRouter AI routing: admin settings are owner-scoped through `owner_ai_settings`, web mode keeps API keys server-side only (`OPENROUTER_API_KEY` env; body-supplied keys remain rejected), and `OPENROUTER_DISABLED=1` provides an immediate operational kill switch with no silent fallback to native providers. Multi-agent requests reject mixed OpenRouter stacks with `STACK_MIX_FORBIDDEN`, so routing/cost attribution cannot silently cross the selected stack boundary. `ai_usage` accepts provider `openrouter` and records `routing_tag`; no change to AI HTML sanitization, URL whitelist, or owner isolation rules. |
| 2026-05-13 | v2.25.0 RNPM multi-token filter: tokenizer caps filter evaluation at `FILTER_TOKEN_MAX_COUNT = 8` tokens, deduplicates case-insensitive/diacritics-insensitive input, and keeps every token owner-scoped through the existing `owner_id + search_id` filter path. Query logging remains raw-query-free (`qLen` only), LIKE patterns continue through `buildRnpmLikePattern()`, and the existing kill switch `RNPM_RESULTS_FILTER_DISABLED=1` remains valid. |
| 2026-05-13 | Previous RNPM results filter: new POST-only `POST /api/rnpm/search/:searchId/filter` keeps raw `q` out of URL logs, structured route logs record `qLen` instead of query text, and ownership precheck returns the same 404 for missing vs cross-owner `searchId` (anti-enumeration). Filter query stays owner-scoped through `owner_id + search_id`, caps response IDs at 1500, times out after 5s, exposes `missingDetails` without leaking detail content, and can be disabled through `RNPM_RESULTS_FILTER_DISABLED=1` if DB contention or a regression appears. |
| 2026-04-17 | Initial security model: Electron hardening, safeStorage-backed keys, loopback bind, CSP, real-IP rate limit, SOAP fan-out cap, XLSX formula escape. |
| 2026-04-18 | Documented accept of `xlsx` / `xlsx-js-style` parser CVEs (write-only usage, no reachable surface). Deferred items tracked in `AUDIT_DEFERRED_2026-04-18.md`. |
| 2026-04-28 | Added "Background monitoring activity" section: scheduler trust model, AbortSignal cancellation, RWLock maintenance gate, outcome atomicity, source_error suppression, owner-scoped audit. |
| 2026-04-29 | Synced monitoring security notes for v2.2.0: per-kind kill switch, mutation body caps, run retention purge, and environment variables. |
| 2026-04-29 | v2.4.0 PR-5: bulk name lists / `name_soap`, mixed monitoring XLSX template, preview/commit with strict parser caps for `xlsx@0.18.5`, auto-create jobs cap 100, name SOAP runner alerts, and post-review transaction hardening for name list replay/archive races. |
| 2026-04-29 | v2.3.0 audit remediation hardening: migration 0005 `idx_one_running_per_job` UNIQUE partial index, restore SQLite with `PRAGMA integrity_check`, recurring 24h backup timer, graceful shutdown HTTP drain 30s, RNPM `executeSearch` under `withMaintenanceRead`, audit on RNPM destructive routes (`POST /saved/delete-batch`, `DELETE /saved/:id`, `DELETE /searches/:id`), cross-tenant `existingSearchId` check via `belongsToOwner`, migration runner bidirectional CRLF self-heal + `MIGRATIONS_STRICT=1` CI gate, dependency bumps (dompurify, jspdf, jspdf-autotable). |
| 2026-05-08 | v2.20.0 RNPM cap observability: audit event `rnpm.cap_hit` emitted by `POST /api/v1/rnpm/search-split` whenever `upstreamTotal != recovered` or sub-types end in `blocked` / `partial`. Detail captures `type`, `criteriu`, `upstreamTotal`, `recovered`, `gap`, `gapByReason` (terminal_cap / silent_refusal / residual_unclassified), and `blockedLabels`. Owner-scoped via `recordAudit(c, ...)`. No new attack surface — same `audit_log` table, same write path. |
| 2026-05-08 | v2.20.2 RNPM cap_hit audit hardening: `criteriu` (CUI/CNP/nume) removed from audit detail (GDPR — was being persisted in plaintext alongside structured cap-hit shape); audit emit wrapped in local try/catch so `audit_log` write failure no longer flips the SSE stream into `error` event (caller-side isolation). |
| 2026-05-08 | v2.20.3 RNPM hardening (post-/full-review): (1) audit `rnpm.cap_hit` now carries `requestId` (correlation between server log and client envelope); (2) migration 0017 adds `idx_audit_log_created_at` + `purgeOldAuditLog` (90-day retention, runs daily through `purgeWorker`) so audit table can no longer grow unbounded; (3) split SSE differentiates `aborted` (client signal abort) from `timeout` (server-side) from `error` (other failure) for forensics; (4) tier-1 / tier-2 loops fail-fast at K=3 consecutive upstream errors (`upstream_throttled` reason) instead of burning every captcha during throttling; (5) caller-side `captchasUsed` accumulates from `result.captchasUsed` (includes internal retries like `search_retry` on invalid gcode) instead of pre-incrementing; (6) `validateSubTypeLabels` (helper service `rnpmSubTypes.ts`, mirror of frontend canonical `TIP_AVIZ_BY_CATEGORY`) blocks arbitrary-label payloads in `subTypeLabels` (allow-list, prefix-exact); (7) operational kill switch `RNPM_AUDIT_CAP_HIT_DISABLED=1` skips the `audit_log` insert without restart. |
| 2026-05-10 | v2.20.4 defense-in-depth tuning (UX): (1) rate-limit per `(ip, ownerId)` raised from 30 to 120 req/min — anti-runaway protection still active (an infinite useEffect loop is still capped at ~120 hits before 429), but normal Alerts page UX (Refresh + Inchide toate + paginate) no longer false-positives. Pre-auth rate-limit unchanged at 60 failed/min/IP. (2) `/api/rnpm/bulk` SSE timeout raised from 10 min to 60 min to support 200-CUI batches without orphaned hanging streams; not a security change but listed for traceability since it widens the resource-consumption window. No threat-model change — `bodyLimit`, fail-closed-on-missing-IP, web-mode 501 gate, and per-(ip, ownerId) bucket isolation all unchanged. *(NOTE v2.20.5: 60 min was undersized for the 200-CUI ipoteci worst case (~83 min) — re-bumped to 90 min in v2.20.5; resource-consumption-window note remains.)* |
| 2026-05-10 | v2.20.5 hotfix: (security-relevant lines only) (1) `/api/rnpm/bulk` SSE timeout raised from 60 min to 90 min (`SSE_TIMEOUT_MS` 3600000 → 5400000) so a single stream of up to 200 CUI on the slowest category (ipoteci, ~25s/item worst case) cannot starve mid-flight and leave the upstream captcha-already-consumed but no-result-returned. Resource-consumption window widens from 60 min to 90 min per stream — still capped, still per-(ip, ownerId) rate-limited at 120 req/min. (2) Root `package.json` regression fix: scripts/build/devDependencies blocks were stripped accidentally in the v2.20.4 release commit, causing the v2.20.4 GitHub Actions build (Docker, macOS, Windows) to fail on `npm run build` ("Missing script"). Not a security regression by itself — but it meant v2.20.4 produced no signed artifacts; v2.20.5 restores the toolchain so signed installers ship again. No threat-model change. |
| 2026-05-12 | v2.20.9 safety hardening: SOAP response cap 8MB before body read, RNPM `firstResult.total` type-guard before split cap decisions, and XLSX formula-escape sentinel for `=+-@\t\r`. |
| 2026-05-12 | v2.21.0 RNPM trust + retention safety: runtime schema validation; v2.33.0 makes invalid payloads fail closed by default and keeps `RNPM_RUNTIME_VALIDATION_DISABLED=1` as rollback, `activ: null` for unknown RNPM status, migration 0019 `idx_monitoring_runs_started_at`, chunked purge capped at 1M rows per run, and explicit baseline rollback sentinel. |
| 2026-05-12 | v2.22.0 supply chain hardening + polish: GitHub Actions pinned to full git SHAs (defeats tag-repointing attacks on `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `softprops/action-gh-release`); `Dockerfile` base image pinned to multi-arch digest `sha256:8ea2348b...` on both build stages; migrated user-upload XLSX parsing path from `xlsx@0.18.5` to `xlsx-js-style` (closes active prototype-pollution + ReDoS CVEs with no upstream fix); hono `^4.12.17` → `^4.12.18` to close 3 moderate CVEs (CSS injection in JSX SSR, JWT NumericDate validation, Cache middleware Vary headers); `npm audit --omit=dev` remains clean. Polish: `PRAGMA synchronous = NORMAL` (paired with WAL, no corruption risk), `RNPM_SITEKEY` / `RNPM_PAGEURL` / `RNPM_USER_AGENT` externalized via lazy getters reading `process.env` for hot-swap without rebuild. |
| 2026-05-13 | v2.23.0 master switch monitoring (auditability + owner isolation): new endpoints `GET/PUT /api/v1/monitoring/master-switch` with Zod `.strict()` validation (rejects unknown keys / non-boolean payload with `invalid_payload` 422), per-owner upsert via new table `owner_monitoring_settings (owner_id PK, monitoring_enabled, updated_at)` introduced by migration 0020 with partial index `WHERE monitoring_enabled = 0` for scheduler anti-join. Scheduler `claimDueJobs` filters via anti-join — disabled owners never get their jobs claimed even if `next_run_at` is past due. Audit entries `monitoring.master_switch.on` / `.off` carry `actor_id` (owner-id resolved through standard auth pipeline) + `request_id` (propagated from `x-request-id` header) and are written **only** on real state change (no-op call = no audit row, prevents log spam from idempotent UI retries). No new attack surface — same `recordAudit` write path, same envelope, same body cap; no auth-mode coupling (works identically in desktop owner='local' and web). |
| 2026-05-14 | v2.27.2 Faza 11 / F11-F1 OriginGuard hardening (work-in-progress integration): backend `requireDesktopHeader` middleware now applied on POST/DELETE admin body-less routes (RNPM `DELETE /saved/all`, `POST /compact`, backup-management actions, monitoring master-switch toggle) — requests missing `X-Legal-Dashboard-Desktop: 1` are refused with envelope-shape `{ data: null, error: { code, message }, requestId }`. Frontend `apiClient` injects the header on every request to the backend in Electron mode so the gate is transparent for the desktop UI. `originGuard` itself now returns the same envelope shape on refusals (previously raw JSON body), keeping the contract uniform across HTTP error paths. **Note:** F11 is still work-in-progress for web mode (header gate not yet wired to per-user / SSO context); the desktop gate is shipped, the web cutover remains to be finalized in a follow-up release. Tests: backend `requireDesktopHeader` + `originGuard` envelope pinned with edge-case coverage before hardening began (commit `6a8b2b9`). No new attack surface — same body cap, same audit pipeline; the change tightens an existing trust boundary instead of opening a new one. |
| 2026-05-15 | v2.27.3 attack surface reduction (export PDF revert): removed `POST /api/v1/dosare/export.pdf` + `POST /api/v1/termene/export.pdf` handlers and their backing services `dosareExportPdf.ts` + `termeneExportPdf.ts`. PDF generation for `/dosare` and `/termene` reverted to frontend jsPDF + jspdf-autotable running in a Web Worker (no network round-trip to backend, no server-side PDF stream attack surface for those flows). PDFKit streaming kept for RNPM (~50k pages possible) and alerts exports — both still gated behind existing rate-limits + body cap. Export XLSX path unchanged. No new attack surface; net reduction by removing two authenticated POST endpoints that previously accepted client-supplied JSON arrays. |
| 2026-05-16 | v2.27.5 RNPM filter performance fix (not a security change per se, listed for completeness): materialized `*_norm` columns on `rnpm_avize`, `rnpm_creditori`, `rnpm_debitori`, `rnpm_bunuri`, `rnpm_bunuri_descrieri` via migration 0022. 10 `AFTER INSERT/UPDATE OF` triggers populate them automatically; idempotent post-migration backfill in `schema.ts`. Read-path `avizRepository.ts` reads `col_norm` directly instead of calling JS UDF `rnpm_norm()` per-row x 24 columns. Eliminates ~8s renderer freeze on filter input over 148-result page. No change to SQL surface (still raw SQL only in `backend/src/db/**`), no change to owner_id enforcement (same `WHERE owner_id = ?` pre-filter), no change to the AI HTML sanitization path, no change to the URL whitelist. UDF stays registered on the connection in `schema.ts`; migration `.up.sql` only contains `CREATE TRIGGER` (lazy UDF resolution at fire time). Regression coverage: 7 new tests pin trigger population + diacritic/JSON/4-char-prefix scenarios. Tests pass for `avizRepository.normColumns.test.ts` and the existing `filterRnpmSearchResults.explain.test.ts` (updated to reflect the new SQL shape). |
| 2026-05-15 | v2.27.4 CI least-privilege + Faza 11 hardening close-out: `lint-test.yml` now declares `permissions: contents: read` explicitly (was inheriting the default repo-wide `GITHUB_TOKEN` scope) — read-only is sufficient because the job neither pushes nor creates releases. Added `concurrency` block (`cancel-in-progress: true`) so superseded runs on the same ref are cancelled, reducing the window where a stale job could still race against a freshly-pushed commit on the same branch. Faza 11 close-out: `scripts/rebuild-electron.cjs` removes `shell: true` from the `npm rebuild` spawn (replaced with explicit `where`/`which` resolver for `npm.cmd`) — closes the small command-injection seam introduced by passing the command line through a shell interpreter. Backend `auth.ts` / `health.ts` route handler split clarifies the trust seam between authenticated POST `/login` (form parse + bcrypt) and unauthenticated `/health` (boot probe). Biome cleanup PR-0..PR-8 closed without altering DOMPurify (kept active in all four AI sanitization call-sites — PR-4 centralized them into `frontend/src/lib/aiSanitize.ts` without disabling), without touching the external URL whitelist (`portal.just.ro`, `www.just.ro`, `portalquery.just.ro`, `mj.rnpm.ro`, `www.rnpm.ro`), and preserving `delete process.env.X` as a statement (NOT rewritten as a string assignment). Plus a documentation entry on PortalJust upstream data quality: legacy ANSI/cp1250 → UTF-8 transcoding occasionally substitutes `?` characters in `solutie`/`solutieSumar` — accepted upstream data loss, not a client-side bug, not exploitable. No new attack surface; net reduction from the CI scope tightening and the script-spawn change. |
| 2026-05-18 | v2.28.4 audit pack remediation 2026-05-18 — 16 findings F1-F16 across 5 merged PRs. **PR1 — Security hotfix:** F1 explicit `bodyLimit` middleware applied per-route (search 64KB, bulk 512KB, small 4KB, AI 100KB, bulk dismiss 256KB) — closes implicit-cap inheritance gap where some route handlers relied on Hono default; F4 monitoring master-switch toggle now retries the audit-log INSERT on transient SQLite BUSY (single retry with 50ms backoff) so concurrent admin toggles cannot lose the audit row. **PR2 — Backend hygiene:** F6 AI request cancellation propagates `AbortSignal` from HTTP client → SDK call → provider stream (covers Anthropic/OpenAI/Gemini/OpenRouter stacks); F7 `/api/rnpm/load-more` now declares explicit 4KB `bodyLimit` (was relying on implicit small route cap); F10 structured logger redacts `Authorization`, `X-2Captcha-Api-Key`, `X-CapSolver-Api-Key`, `X-OpenRouter-Api-Key` headers in audit + access logs (zero-leak even on debug-level dumps). **PR3 — Frontend hardening:** F5 XLSX import path now caps row-count at 10k and column count at 64 before parse-time materialization (previously caps applied only at write-time); F11 `aiSanitize.ts` DOMPurify config now strict-mode (FORBID_TAGS `script|style|iframe|object|embed|form`, FORBID_ATTR `on*|formaction|srcdoc|xlink:href`); F12 null-safe selectors on `frontend/src/pages/Monitorizare.tsx` and `Alerte.tsx` (no more `data!.field` non-null assertions); F14 explicit `focus-trap` on modals (RNPM bulk export, AI multi-agent picker, alert dismiss confirm) so keyboard navigation cannot escape into the background page mid-flow. **PR4 — Web pre-cutover:** F2 `ownerId` is now a **required** parameter on the repository surface (`SaveSearchInput`, `GetSearchesOptions`, `UpsertAvizInput`, `GetAvizeOptions`, `ExecuteSearchInput`, `SplitSearchInput`) — desktop adapter resolves it to `"local"` via `getOwnerId(c)` middleware, web mode throws if missing instead of silently falling back to `"local"` (closes cross-tenant data spill window for the upcoming web cutover); F15 `/health` split into **public minimal** (`{ status, service }` only) + new `/health/detail` loopback-gated route via `getConnInfo` (allow-list `127.0.0.1`, `::1`, `::ffff:127.0.0.1`) that exposes `authMode`, `monitoring`, `emailConfigured`, `loginAvailable` — closes info-leak vector where an unauthenticated public probe disclosed operational telemetry useful for reconnaissance. **PR5 — Docs/ops:** F8 migration writer now requires a paired `down.sql` (CI gate fails the PR if missing); F9 Dockerfile multi-stage base images re-pinned to current digests `sha256:f44b8e8...` (rotated from v2.22.0 pins); F13 CORS policy explicit list (`Origin` echo only for `app.localhost`, `localhost:5173`, file://, `LEGAL_DASHBOARD_ALLOW_REMOTE=1` LAN bind subnet) — no wildcards; F16 `check-worktree.cjs` enforces clean tree before `npm run dist`/`dist:server`/`dist:mac` so accidental local debug code cannot ship in signed artifacts. **Test coverage:** +1 new test on `index.test.ts` (`/health` public response strips operational telemetry) + 4 modified tests on `index.test.ts` (3 `/health` → `/health/detail` migration + 1 unchanged); 18+ test callsites updated in `rnpmSearchService.split.test.ts` / `rnpm.contract.test.ts` / `rnpmSearchService.test.ts` to pass explicit `ownerId` (web pre-cutover compatibility). |
