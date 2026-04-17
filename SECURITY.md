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
