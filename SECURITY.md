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
- **AI key precedence**: if `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
  `GOOGLE_AI_KEY` are set in the backend environment, they take precedence
  over keys submitted in the request body. This lets an operator who runs the
  backend as a service prevent the renderer from overriding the server's keys.
- **SOAP fan-out cap** (`MAX_SOAP_FANOUT = 500`) on `/api/dosare/load-more`
  and `/api/termene/load-more` to prevent an attacker (or a buggy client) from
  amplifying one request into thousands of upstream SOAP calls.

### Background monitoring activity

The monitoring scheduler (introduced in v2.1.0/v2.1.1, `backend/src/services/monitoring/scheduler.ts`) runs background jobs that periodically refresh dosar / termene state from PortalJust SOAP. It inherits the desktop trust model — same OS user, same SQLite, no extra network surface — and adds the following controls:

- **Single-instance enforcement.** The scheduler runs only inside the Electron main process, which is itself gated by `app.requestSingleInstanceLock()`. There is no second writer racing the scheduler against the same SQLite file.
- **Cooperative cancellation.** Every outbound SOAP request is wired through an `AbortSignal` chained to: (a) per-request timeout (`SOAP_REQUEST_TIMEOUT_MS`), and (b) the scheduler's shutdown signal. App-quit flushes in-flight runs instead of leaking sockets or holding SQLite WAL locks past process exit.
- **Maintenance lock (RWLock).** Backup / restore acquire `withMaintenanceWrite` (writer-exclusive); scheduler ticks acquire `withMaintenanceRead`. Backups cannot observe a half-applied job outcome, and the scheduler cannot start a new tick while a backup is running. The lock is writer-preference, so a maintenance request cannot be starved by a busy tick loop.
- **Outcome atomicity.** `finalizeRun` + `markJobOutcome` are wrapped in a single `db.transaction`, so a job's `runs` row, `next_run_at`, and `last_status` move together. A crash mid-tick cannot leave a "succeeded but never advanced" job. Orphaned `running` runs from a previous process are recovered on boot (`recoverOrphanRuns`).
- **Source-error suppression.** A job that fails 5 times consecutively against the upstream source is marked `source_error` and stops scheduling until manual intervention. This bounds noise (audit log, console, retries) when PortalJust is degraded — a single outage cannot generate unbounded retries or fill the audit log.
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
| `LEGAL_DASHBOARD_ALLOW_REMOTE` | unset | Set to `1` to allow non-loopback `HOST` binds. Required for shared / LAN deployments. |
| `LEGAL_DASHBOARD_PORT` | `3002` | Backend port. Electron sets this automatically. |
| `LEGAL_DASHBOARD_DB_PATH` | `%APPDATA%/legal-dashboard/legal-dashboard.db` | SQLite path. Electron sets this. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_AI_KEY` | unset | If set, override in-app keys. Use for server-mode deployments. |
| `NODE_ENV` | `production` in Electron | `development` enables DevTools and the dev menu. |

The 2Captcha / CapSolver key is **not** read from env — it is entered in-app
and persisted via `safeStorage` on desktop (or obfuscated localStorage on web).

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
- **`xlsx` / `xlsx-js-style` parser CVEs (accepted risk).** `npm audit`
  currently flags:
  - `CVE-2023-30533` — Prototype Pollution in SheetJS parser (high)
  - `CVE-2024-22363` — ReDoS in SheetJS (high)

  Both affect the `xlsx.read()` / parsing path when the library is fed an
  attacker-controlled spreadsheet. Legal Dashboard uses `xlsx-js-style`
  **exclusively for `writeFile()`** — generating .xlsx output from data
  already validated inside the app (dosare / termene / avize). There is no
  code path that calls `XLSX.read()` or accepts user-uploaded spreadsheets.
  The CVEs therefore have no reachable attack surface in this deployment.

  Follow-up: when `xlsx-js-style` catches up with upstream (no patch released
  at time of writing) or when we have bandwidth to migrate the 3 export
  pipelines to `exceljs` (~4–6h), the risk is re-evaluated and this
  acceptance is removed. Tracked in `AUDIT_DEFERRED_2026-04-18.md`.
- **Unsigned Windows binaries.** We do not currently code-sign Windows
  installers. SmartScreen will warn on first launch. Obtaining and wiring an
  EV / OV certificate is tracked separately.
- **LAN-mode hardening.** Setting `LEGAL_DASHBOARD_ALLOW_REMOTE=1` exposes the
  backend to every host that can reach the interface. We do **not** currently
  add authentication, TLS, or per-user isolation when that happens. If you
  need this, put the backend behind a reverse proxy with TLS + auth.
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
