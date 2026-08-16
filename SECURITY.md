# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report privately through **[GitHub Security Advisories](https://github.com/warlordro/Legal-Dashboard/security/advisories/new)**.

Include what you can: affected version, deployment mode (desktop or web), reproduction steps, and impact. I maintain this project alone alongside a full-time job, so expect an acknowledgement within a few days rather than hours. I will tell you whether the report is in scope, what the fix looks like, and when it ships. If you'd like credit in the advisory and release notes, say so.

**Supported versions.** Only the latest release receives security fixes. There are no long-term support branches.

---

## Two deployment models

The threat model differs substantially depending on how the application is run. Read the section that applies to you — the assumptions are not interchangeable.

### Desktop mode (default)

A single-user application. The backend is a local Node.js HTTP server bound to `127.0.0.1`, consumed by the Electron renderer in the same process tree.

Trust assumptions:

- The machine running the application is trusted.
- The operating-system user running the application is trusted.
- **Other users on the same LAN are not trusted.**

There is no authentication in this mode, by design — the OS user *is* the identity. Exposing a desktop-mode backend beyond loopback is refused at boot rather than merely discouraged.

### Web mode

A multi-user service behind authentication, administered by an operator. Sessions are established through Google authentication with an email-domain allowlist; API requests fail closed without a valid session.

Trust assumptions:

- The operator controls the host, the TLS termination, and the reverse proxy in front of the application.
- Authenticated users are trusted with their own data and **not** with each other's.
- The operator is trusted with organisation-level configuration, including AI and captcha keys.
- The network between the client and the reverse proxy is not trusted.

Web mode requires `LEGAL_DASHBOARD_JWT_SECRET` (32+ bytes), an issuer, an audience, and `TENANT_KEY_ENCRYPTION_SECRET`. Boot fails fatally if any are missing — the application will not start in a half-configured state.

**Reference reverse proxy (v2.45.0).** The shipped compose files pin `oauth2-proxy` at `v7.15.3-alpine` by digest, raised from `v7.7.1`. Releases below 7.15.2 carry seven published advisories, three of them critical, and three land on the exact surface these files configure — `skip_auth_routes` combined with `reverse_proxy`: CVE-2026-40575 (authentication bypass via spoofed `X-Forwarded-Uri`), CVE-2025-54576 and CVE-2026-41059 (`skip_auth_routes` bypass via query string and fragment confusion). The backend still authenticates every request itself, so the proxy was never the only gate, but an operator running the older pin was relying on a bypassable outer layer. Operators who deployed before v2.45.0 should redeploy to pick up the new image. The only breaking change between 7.7 and 7.15 that touches this configuration is from v7.11.0 — `skip_auth_routes` is evaluated against the path alone, without the query string — and the shipped routes are path-anchored, so their behaviour is unchanged.

The same release added `--trusted-proxy-ip` (`OAUTH2_PROXY_TRUSTED_PROXY_IPS`). Left unset, the proxy trusts `X-Forwarded-*` headers from any source and logs a warning at startup. This was the silent behaviour of every earlier release too; 7.15.2 makes it visible and fixable.

**Upgrading the pin alone does not close CVE-2026-40575 (v2.46.1).** The advisory requires two further measures, and v2.45.0 shipped neither everywhere. Both are now in all three compose files:

- Every ingress strips the inbound `X-Forwarded-Uri` before it reaches the proxy — a Traefik `customRequestHeaders` label in `docker-compose.yml` and the NAS file, `header_up -X-Forwarded-Uri` in `deploy/Caddyfile`. Without this the ingress is itself the trusted peer, so a client-supplied header is forwarded intact and the proxy evaluates the attacker's path against `skip_auth_routes`.
- `OAUTH2_PROXY_TRUSTED_PROXY_IPS` now defaults to `172.16.0.0/12` rather than being unset. This is a container-network range, not a substitute for the operator's real ingress address: where the proxy's port is reachable from a local network, narrow it to the address the reverse proxy or tunnel actually presents. If the deployment's subnet falls outside the range, programmatic access fails loudly rather than silently. Deployment guidance is in `DEPLOY-NAS.md`.

**Logout confirmation route (v2.46.1).** `GET /delogat` must appear in `OAUTH2_PROXY_SKIP_AUTH_ROUTES`. Until v2.46.1 only the NAS compose declared it, so operators deploying from the other two files got a logout loop: sign-out lands on a gated page, the identity provider re-authenticates silently, and the user returns signed in. The route serves no owner data and only clears the session cookie.

---

## In scope

### Electron surface

| Control | Implementation |
|---|---|
| Renderer RCE | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, dedicated preload exposing a minimal API |
| Script injection | CSP set in `onHeadersReceived`, `script-src` limited to `'self'` |
| Navigation hijack | `will-navigate` refuses anything that is not the local backend origin |
| Popup phishing | `setWindowOpenHandler` denies all popups; only an explicit allowlist of government hosts opens externally, HTTPS only |
| Parallel-writer DB corruption | `app.requestSingleInstanceLock()` — one process per data directory; a second launch focuses the existing window |
| DevTools exposure | Disabled in production builds |

The external-host allowlist covers the official court, High Court and registry domains. Anything else is refused rather than opened.

### Credential handling

**Desktop.** Keys exist in the renderer only transiently. At rest they round-trip through IPC to `safeStorage` — DPAPI on Windows, Keychain on macOS, libsecret on Linux — and only base64 ciphertext reaches disk. Plaintext is never written. The IPC bridge exposes three channels (`available`, `encrypt`, `decrypt`) with input size caps, and grants no filesystem, shell, or arbitrary-IPC access. Legacy obfuscated key blobs are migrated to encrypted storage on first launch after upgrade and the legacy entry is removed.

**Web.** Admin-configured AI and captcha keys are stored as AES-256-GCM ciphertext with separate IV and tag columns. The master key lives in the environment (`TENANT_KEY_ENCRYPTION_SECRET`) and is never stored in the database. API responses expose only configured/not-configured status and the last four characters. Audit entries never contain plaintext or ciphertext. Non-admin requests cannot supply their own keys in a request body.

**Precedence.** If AI provider keys are present in the backend environment, they take precedence over anything submitted in a request. An operator running the backend as a service cannot have the server's keys overridden by a client.

The browser-only fallback path (no Electron bridge available) uses reversible obfuscation. This is **explicitly not a security control** — it exists so that a casual `localStorage` snapshot does not expose keys in cleartext, and nothing more.

### Backend hardening

- **Bind address.** Loopback only by default; `HOST` is validated against `{127.0.0.1, localhost, ::1}`. Non-loopback binding requires `LEGAL_DASHBOARD_ALLOW_REMOTE=1`, which in turn requires web auth mode and a valid JWT secret. Desktop mode on a LAN is refused at boot.
- **Rate limiting** is keyed on the real socket address, so `X-Forwarded-For` spoofing cannot bypass the limiter. Loopback receives a higher ceiling because all such traffic is the same user.
- **Pre-auth bucket.** `/api/*` has an IP-only limiter ahead of owner resolution, so floods carrying missing or invalid tokens cannot exhaust HMAC verification and user lookups. A successful authentication releases the pre-auth bucket; the request is then governed by the per-owner limiter.
- **CSP on every response** via Hono `secureHeaders`: `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
- **Session handling (web).** Logout revokes the session server-side rather than only clearing the client. The session cookie is `HttpOnly`, `Secure` in web mode, and hardened against cross-site use. The logout confirmation page states explicitly that the upstream Google session remains active in the browser — relevant on shared machines.
- **Fan-out cap.** A hard limit of 500 upstream SOAP calls per request prevents one client call, buggy or malicious, from amplifying into thousands.
- **Body-size limits** apply before JSON parsing on mutation routes, so oversized payloads are rejected before large objects are allocated.
- **Email isolation.** SMTP credentials are read only from server-side environment variables. Per-owner email delivery defaults to off. HTML alert bodies escape their payloads. SMTP failures are logged without blocking alert insertion, in-app delivery, or the alerts inbox.
- **`/health`** is mounted before authentication and stays public and non-sensitive: no personal data, no database statistics. Readiness probes work without a token.

### Multi-tenant isolation (web mode)

- **Physical data separation.** Each account gets its own registry SQLite file, with a per-account storage cap that cannot be circumvented. The migration from a shared store was a one-time, crash-safe split with a verified pre-split backup.
- **Cross-owner access returns 404, not 403**, so status codes do not disclose that another owner's records exist. The distinction is preserved only in the audit log, as explicit `*_denied` actions.
- **Backup and restore** are self-service but scoped strictly to the caller's own data, with cooldowns, concurrency guards against simultaneous search and restore, and a verified pre-restore snapshot. Full-database backup is admin-only, with automatic retention across disjoint pools.
- **Programmatic access** is read-only. Personal access tokens are scoped per module, support optional expiry and a daily cap, and are shown once — only a fingerprint is stored. Requests outside the granted scope are refused. Token management is admin-only.
- **Audit log** records the real visitor address rather than the reverse proxy's. Entries created before this change do not carry an address and are not backfilled retroactively.
- **AI spend** is governed by a shared quota pool with per-user grants, with per-user consumption reporting. Truncated model responses are detected and flagged rather than served as complete.

### Background monitoring

The scheduler refreshes case state from the official SOAP interface on a timer. It inherits the deployment's trust model and adds:

- **Single-instance enforcement.** The scheduler runs inside the backend process in both deployment modes. Startup acquires the database-directory instance lock before the scheduler starts, so a second process cannot race it against the same database.
- **Cooperative cancellation.** Every outbound request is wired to an abort signal chained to a per-request timeout and to the scheduler's shutdown signal. Quitting flushes in-flight runs instead of leaking sockets or holding WAL locks past process exit.
- **Outcome atomicity.** Run finalisation and job-outcome updates share a single transaction, so the run row, next scheduled time and last status move together. A crash mid-tick cannot leave a job "succeeded but never advanced". Orphaned running rows from a previous process are recovered at boot.
- **Database-level uniqueness.** A unique partial index on `monitoring_runs(job_id) WHERE status='running'` enforces one running run per job. Even a buggy scheduler reset cannot insert a duplicate — the database rejects it. This removes a class of finalisation race that was previously guarded only in code.
- **Maintenance lock.** Backup and restore take a writer-exclusive lock; scheduler ticks take a read lock. Backups cannot observe a half-applied outcome, and no tick starts while a backup runs. The lock is writer-preference, so maintenance cannot be starved by a busy tick loop.
- **Restore integrity.** `PRAGMA integrity_check` runs against a candidate file before it is promoted. Sidecar WAL/SHM unlink failures are surfaced rather than silently ignored, so a full disk does not pass as success.
- **Graceful shutdown.** On `SIGTERM`/`SIGINT` the HTTP server drains in-flight requests with a 30-second timeout before the scheduler stops and the database closes.
- **Source-error suppression.** A job failing five consecutive times against a degraded upstream is parked as `source_error` and stops scheduling until manual intervention. One outage cannot generate unbounded retries or flood the audit log.
- **Kill switches**, no redeploy required: `MONITORING_ENABLED=0` unmounts routes and scheduler; `MONITORING_DISABLED_KINDS` excludes job kinds from scheduler claims without mutating rows; `ICCJ_ROUTES_DISABLED=1` returns 503 on the interactive High Court routes.
- **Retention.** Run history is purged daily on a 90-day window. The purge timer stops with the scheduler.
- **No new network surface.** The scheduler calls only the endpoints already used by foreground search, bound by the same external-host allowlist.

The scheduler does not add authentication or encryption to its own outbound calls; those are inherited from the foreground path.

### Data at rest and data exported

- **Spreadsheet formula injection.** Any exported string cell beginning with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with a single quote, so Excel and LibreOffice render it as text instead of evaluating it. Applied to every generated sheet.
- **Markup sanitisation.** Markdown and HTML pass through DOMPurify with a four-tag allowlist (`strong`, `em`, `b`, `i`) and no permitted attributes — no URLs, no script vectors.
- **Prompt-path bounding.** Court-decision text is truncated before entering the AI prompt path, limiting both token spend and prompt-injection surface.
- **Secret redaction.** Captcha keys are stripped from all error output, including messages surfaced to the UI.

---

## Out of scope

Stated explicitly so operators can make their own risk decisions:

- **Unsigned Windows binaries.** Releases are not code-signed. Verify checksums if provenance matters to you.
- **Desktop mode exposed on a network.** Refused at boot, and unsupported if forced.
- **Operator-side infrastructure.** TLS termination, reverse-proxy configuration, host hardening and OS patching are the operator's responsibility. The reference deployment terminates TLS at a CDN edge and opens no inbound router ports, but that topology is a recommendation, not an enforced control.
- **Compromise of a trusted machine or OS account.** Malware with the user's privileges can read anything the user can read, including keychain-decrypted keys.
- **Upstream sources.** Availability, accuracy and integrity of the official court and registry systems are outside this project's control. Displayed records link back to the official source so they can be verified independently.
- **Third-party captcha and AI providers.** Requests routed to them are governed by their own terms and security posture.

---

## Data protection note

Case records contain personal data. Operators deploying this application are controllers under the GDPR and are responsible for their own lawful basis, retention policy and access control. The application provides the tooling — per-user separation, audit logging, storage caps, scoped read-only tokens, and self-service backup, restore, export and deletion of the user's own RNPM records — but the compliance obligation belongs to whoever runs it.
