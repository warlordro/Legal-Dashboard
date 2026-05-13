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
| `MONITORING_ENABLED` | `1` in Electron | Set to `0` to disable monitoring routes and scheduler. |
| `MONITORING_DISABLED_KINDS` | unset | Comma-separated monitoring kinds to skip in scheduler claims, for example `dosar_soap,name_soap`. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` | unset | Optional SMTP channel for alert emails. Incomplete config disables email without blocking boot. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_AI_KEY` | unset | If set, override in-app keys. Use for server-mode deployments. |
| `CAPTCHA_PROVIDER` / `TWOCAPTCHA_API_KEY` / `CAPSOLVER_API_KEY` | unset | Planned for PR-9 web/server mode. RNPM captcha provider keys must live server-side and must not be accepted from browser clients. Desktop v2.4.0 ignores these and keeps UI + safeStorage. |
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
| 2026-05-12 | v2.21.0 RNPM trust + retention safety: runtime schema validation Stage 1 (`safeParse` + warning, `RNPM_RUNTIME_VALIDATION_ENFORCED=1` fail-loud flag), `activ: null` for unknown RNPM status, migration 0019 `idx_monitoring_runs_started_at`, chunked purge capped at 1M rows per run, and explicit baseline rollback sentinel. |
| 2026-05-12 | v2.22.0 supply chain hardening + polish: GitHub Actions pinned to full git SHAs (defeats tag-repointing attacks on `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `softprops/action-gh-release`); `Dockerfile` base image pinned to multi-arch digest `sha256:8ea2348b...` on both build stages; migrated user-upload XLSX parsing path from `xlsx@0.18.5` to `xlsx-js-style` (closes active prototype-pollution + ReDoS CVEs with no upstream fix); hono `^4.12.17` → `^4.12.18` to close 3 moderate CVEs (CSS injection in JSX SSR, JWT NumericDate validation, Cache middleware Vary headers); `npm audit --omit=dev` remains clean. Polish: `PRAGMA synchronous = NORMAL` (paired with WAL, no corruption risk), `RNPM_SITEKEY` / `RNPM_PAGEURL` / `RNPM_USER_AGENT` externalized via lazy getters reading `process.env` for hot-swap without rebuild. |
| 2026-05-13 | v2.23.0 master switch monitoring (auditability + owner isolation): new endpoints `GET/PUT /api/v1/monitoring/master-switch` with Zod `.strict()` validation (rejects unknown keys / non-boolean payload with `invalid_payload` 422), per-owner upsert via new table `owner_monitoring_settings (owner_id PK, monitoring_enabled, updated_at)` introduced by migration 0020 with partial index `WHERE monitoring_enabled = 0` for scheduler anti-join. Scheduler `claimDueJobs` filters via anti-join — disabled owners never get their jobs claimed even if `next_run_at` is past due. Audit entries `monitoring.master_switch.on` / `.off` carry `actor_id` (owner-id resolved through standard auth pipeline) + `request_id` (propagated from `x-request-id` header) and are written **only** on real state change (no-op call = no audit row, prevents log spam from idempotent UI retries). No new attack surface — same `recordAudit` write path, same envelope, same body cap; no auth-mode coupling (works identically in desktop owner='local' and web). |
