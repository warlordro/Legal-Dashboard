# Claude Security results

Scanned the whole `Legal Dashboard IF` repository at `c:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF`, revision `c5dd9697e2e3026bb2e16685c99d2111bae07dff` (branch `feat/v2.43.0-rnpm-split`), on 2026-07-24 starting 19:59:47 UTC, in `scan` mode at `medium` effort with no scope narrowing and focus set to attack-surface. Twelve findings survived verification: eight MEDIUM and four LOW, with no HIGH or CRITICAL. Nothing in this report was executed or exploited — every finding is derived from reading the code.

## Coverage

The inventory partitioned the tree into ten components, all of which were examined: `backend-routes-middleware` (routes, middleware, `index.ts`, `soap.ts`, `intervals.ts`), `backend-auth`, `backend-services`, `backend-util`, `backend-db`, `backend-schemas`, `electron-main`, `frontend-app`, `build-deploy-scripts` (scripts, deploy, infra, GitHub workflows) and `config-root` (manifests, lockfile, tool configs).

Completeness was **checked**: every one of the ten top-level directories is accounted for as either scanned or explicitly skipped, and none were left unaccounted. The full component matrix ran — 37 researcher cells dispatched, 37 returned, one researcher per cell — so nothing collapsed to the fast single-researcher shape and no component was dropped by a cap. Five cells were pruned as inapplicable before dispatch (`memory-and-unsafe` on `backend-util`, `backend-auth`, `backend-schemas`, `backend-services`, `backend-db`), because that lens covers buffer overflows, use-after-free and unsafe FFI, which do not apply to managed TypeScript. No candidate was dropped by a cap and no candidate site was left unreviewed.

Because focus was set to attack-surface, every stage spent its effort on production code an attacker can reach and treated tests, fixtures, generated code and vendored trees as background to consult rather than targets to audit. A dedicated secrets pass ran in addition.

Six areas were deliberately not examined, each for a stated reason:

`node_modules` — vendored third-party dependency tree, not project code. Note that this does not mean dependencies went unconsidered: F7 was found by reading the installed `xlsx-js-style` bundle to confirm its version and missing guards.
`build` — static app icon assets, no executable code.
`docs`, `audit`, and the root Markdown files (`README.md`, `CHANGELOG.md`, `SECURITY.md`, `HARDENING.md`, `STATUS.md`, `SESSION-HANDOFF.md`, `EXECUTION-ROADMAP.md`, `PLAN-monitoring-webmode.md`, `PLAN-iccj-integration.md`, `RUNBOOK.md`, `DEPLOY-SERVER.md`, `DOCUMENTATIE.md`) — documentation, historical audit reports and plans; read for context only, not executable production code.
`.claude` and `.git` — tooling configuration and git internals, not part of the shipped application.
Test and fixture files (`backend/src/**/*.test.ts`, `frontend/src/**/*.test.ts(x)`, `backend/src/services/iccj/__fixtures__`, `electron/event-loop-watchdog.test.cjs`) — not production attack surface, covered incidentally when reading sibling production files.
`PowerShell-7.6.4-win-x64.msi` — untracked binary installer artifact present in the working tree, not project source.

## Findings

### F1 — Unbounded XLSX decompression (zip bomb) on the name-list upload path can OOM the shared backend process (MEDIUM, confidence medium)

**Impact.** A single request can drive the Node process to heap/allocation exhaustion. In the containerized web deployment the backend is a single shared process, so an OOM kill denies service to every user until the container restarts; in-flight SQLite work is aborted mid-request.

**Where.** `backend/src/services/nameListParser.ts:347` in `rowsFromXlsxAsync`

**What.** An untrusted, attacker-supplied spreadsheet uploaded to `POST /api/v1/name-lists/preview` reaches ExcelJS's `xlsx.load`, which fully decompresses every ZIP entry into memory with no uncompressed-size cap. The only guards in this codebase bound the *compressed* payload (10 MB) and the *post-parse* row count — neither bounds what decompression allocates.

**Exploit scenario.** The attacker builds a valid-looking `.xlsx` whose `xl/media/x.png` (or `xl/theme/theme1.xml`) entry is roughly 10 MB of DEFLATE-compressed zeroes expanding to several GB. The 25 MB global ceiling and the 10 MB `limitPreviewBody`/`MAX_FILE_BYTES` checks all pass because they measure the compressed upload. `parseNameList` then calls `workbook.xlsx.load`, which reaches `entry.async('nodebuffer')` inside exceljs and allocates the full decompressed entry. The `Promise.race` timeout at `nameListParser.ts:406` returns a 413/400 to the client after 30 s but, as the code comment itself concedes, does not cancel the underlying parse — the allocation keeps growing until the process aborts. Repeating the upload keeps the service down.

**Preconditions.**
- Attacker holds an account that can reach `POST /api/v1/name-lists/preview` (any authenticated user in web mode; any local user in desktop mode)
- `MONITORING_ENABLED` is not set to `"0"` (the default), so `nameListsRouter` is mounted at `/api/v1/name-lists`
- Attacker uploads a crafted XLSX whose ZIP entries declare a very high compression ratio

**Fix.** Reject the upload before handing it to exceljs by walking the ZIP central directory and summing the declared uncompressed sizes against an explicit cap, rejecting entries whose ratio exceeds a threshold. Alternatively move parsing into a `worker_threads` worker started with a bounded `resourceLimits.maxOldGenerationSizeMb`, so a bomb kills only the worker. Do not rely on the compressed-size cap or the `Promise.race` timeout — neither bounds decompressed memory. (CWE-409)

**Verification.** 3/3 lens verifiers confirmed.

### F2 — Unbounded per-request accumulation of SOAP results in the load-more streaming path (MEDIUM, confidence medium)

**Impact.** One request can pin hundreds of megabytes to gigabytes of heap in the shared process (500 fanout units times up to 1000 dosare, each carrying `parti`/`sedinte` arrays), versus the 5000-record ceiling the non-streaming endpoint enforces with a 413. Sustained or concurrent use exhausts the heap and kills the process for all users.

**Where.** `backend/src/services/batch-dosare.ts:94` in `batchFetchDosare`

**What.** Query parameters on `POST /api/dosare/load-more` and `/api/termene/load-more` drive up to `MAX_SOAP_FANOUT` (500) SOAP calls of up to 1000 records each, and every returned dosar is retained for the whole request in the `allDosare` Map (plus the route's `existingNumere` Set) with no result-count cap — even though the returned items array is only read for its `.length`.

**Exploit scenario.** The attacker POSTs `/api/dosare/load-more?obiectDosar=<very common term>&dataStart=2019-01-01&dataStop=2026-07-01` with an empty body. That is roughly 90 monthly intervals, each hitting the 1000-result cap and recursively subdividing to `MAX_SPLIT_DEPTH`, so hundreds of thousands of Dosar objects accumulate in `allDosare` and `existingNumere` while the SSE stream is still open (`SSE_TIMEOUT_MS` = 900 s). Opening the connection without reading the response additionally lets the ReadableStream queue filled by `sseEvent` grow unbounded, since the producer never consults `controller.desiredSize`.

**Preconditions.**
- Attacker holds any authenticated session or PAT
- A broad query (common `obiectDosar` or `numeParte`) over a multi-year range so upstream returns near the 1000-result cap per interval; the code's own `subdivideInterval` path shows this is the expected case
- Upstream PortalJust volume could not be measured without executing code

**Fix.** Stop retaining results in the streaming path: track only a running count and the dedup key set instead of the full Dosar objects, and enforce a hard ceiling analogous to `MAX_DOSARE_RESPONSE` that aborts the batch with an error event once exceeded. Additionally gate `sseEvent` on `controller.desiredSize` so a non-reading client cannot grow the stream queue without bound. (CWE-770)

**Verification.** 3/3 lens verifiers confirmed.

### F3 — RNPM per-owner storage quota is fully bypassable by putting any non-empty `gcode` in the search body (MEDIUM, confidence medium)

**Impact.** An account that has already exhausted its RNPM storage allocation can keep writing avize indefinitely, defeating the only per-tenant disk quota in the product. In the web deployment all per-user `rnpm/<stem>.db` files share one filesystem with the monolith DB and its backups, so one tenant can grow past its allotment until the shared volume fills, degrading or halting every other tenant — writes, daily backup, restore and compaction alike.

**Where.** `backend/src/services/rnpmSearchService.ts:371` in `executeSearchInner`

**What.** The client-supplied `gcode` field of the RNPM search body is the only thing deciding whether the per-owner storage quota (`assertRnpmStorageWithinLimit`) runs, both at route admission (`routes/rnpm.ts:244`) and on every subsequent page inside the service loop. The dangerous operation is the unbounded `persistAvizWithDetail` write into the owner's RNPM SQLite file, with no residual limit check anywhere in `backend/src/db/avizRepository.ts`.

**Exploit scenario.** The attacker (any active user) runs one normal RNPM search and reads `gcode` from the 200 response (`routes/rnpm.ts:334`); a bogus string such as `gcode: "x"` works equally well. Their storage usage reaches the 750 MB cap, so a plain search would now get 429 `RNPM_STORAGE_LIMIT`. They re-POST `/api/v1/rnpm/search` with the same params plus `"gcode":"x"`. Because `previewGcode` is a non-empty string, `routes/rnpm.ts:245` is skipped entirely. Inside `executeSearchInner`, `existingGcode` is truthy, so the captcha solve is skipped; if the gcode is stale or invalid, the catch at line 229 simply solves a fresh captcha and retries, and the search proceeds. The pagination loop at line 369 keeps fetching and `persistAvizWithDetail` keeps writing, with line 371 skipped on every iteration. Repeating grows the owner's DB without limit.

**Preconditions.**
- `AUTH_MODE=web` (multi-tenant deployment); on desktop the quota only protects the local user's own disk
- An authenticated, active account with access to `POST /api/v1/rnpm/search`
- A per-owner `rnpm.storage` quota in effect (default 750 MB via `LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB`, or an admin override)
- `LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA` unset (the default), so the captcha-count guard does not bound request volume

**Fix.** Do not let a request-supplied token decide whether an authorization or quota check runs. Either call `assertRnpmStorageWithinLimit(ownerId)` unconditionally on entry to `POST /rnpm/search` and unconditionally in the pagination loop, or bind continuations to server-side state: persist issued gcodes per `(ownerId, searchId)` at admission time and skip the recheck only when the presented gcode matches a record that already passed the check, with the admitted search's remaining page budget bounded. The existing test `rnpmStorageRecheck.test.ts:96` encodes the current behaviour and must be updated with the fix.

**Verification.** 3/3 lens verifiers confirmed.

### F4 — Desktop mode has no authentication and no Host-header validation; DNS rebinding makes an attacker page same-origin and defeats both CSRF gates (MEDIUM, confidence medium)

**Impact.** A remote web page can read and mutate the entire local dataset as the admin `local` owner: exfiltrate all dosare, RNPM, ICCJ and monitoring records, and invoke admin-only routes such as RNPM `DELETE /saved/all`, `POST /compact` and backup management. GET requests are not covered by this middleware at all, so reads face zero gate once the peer is loopback.

**Where.** `backend/src/middleware/requireDesktopHeaderGlobal.ts:22` in `requireDesktopHeaderGlobal`

**What.** In desktop mode every request is auto-authorized as owner `local` (auto-promoted to admin at `backend/src/index.ts:555-565`) and the only anti-CSRF controls are `originGuard`, which returns early for any loopback peer (`backend/src/middleware/originGuard.ts:53`), and this custom-header check. Neither validates the `Host` header against the loopback bind, so a hostile page whose DNS rebinds to 127.0.0.1 becomes same-origin with the backend: no preflight is required, the custom header is trivially set, `Origin == Host` passes, and the response is readable.

**Exploit scenario.** The attacker hosts `evil.example` with TTL=1 pointing at their server. The victim loads `http://evil.example:3002/` while Legal Dashboard is running; the page fetches its own origin in a loop. The attacker flips the A record to 127.0.0.1, so the next fetch hits the local backend with `Host: evil.example:3002`. `originGuard` sees a loopback peer and passes; for mutations the page simply adds `X-Legal-Dashboard-Desktop: 1`, allowed without preflight because the request is same-origin. `POST /api/v1/rnpm/...` and the admin backup routes execute, and every JSON response is readable by the attacker's script.

**Preconditions.**
- Default desktop deployment (Electron), backend listening on 127.0.0.1:3002 with `auth_mode=desktop`, so no credential is ever checked
- Victim has the app running and visits an attacker-controlled web page in any local browser
- Attacker controls a domain with a short-TTL A record they can flip to 127.0.0.1; success depends on browser DNS-pinning behaviour, which could not be tested because executing and fetching are out of scope

**Fix.** Add a Host-header allowlist middleware in front of the router: when the server is bound to loopback, reject with 403 any request whose `Host` is not `127.0.0.1[:port]`, `[::1][:port]` or `localhost[:port]`. This closes rebinding for both reads and writes and does not depend on the custom header or on `originGuard`'s loopback bypass. (CWE-350)

**Verification.** 3/3 lens verifiers confirmed.

### F5 — Tenant-shared 2Captcha API key leaked to any authenticated web user through the RNPM search error message (MEDIUM, confidence medium)

**Impact.** A regular authenticated web user or PAT holder can recover the tenant's paid 2Captcha API key, an admin-only secret they cannot otherwise read (`GET /api/v1/admin/keys` returns only `last4`). The stolen key lets them drain the tenant's captcha wallet from anywhere. The same string is also written to stdout at line 369, so the credential lands in server and aggregated logs.

**Where.** `backend/src/routes/rnpm.ts:370` in the `rnpmRouter.post("/search")` handler

**What.** In web mode the RNPM search uses the tenant-shared captcha key from `tenant_api_keys`. The 2Captcha SDK sends that key as a URL query parameter, node-fetch embeds the full URL in its transport-error message, and this route serializes that raw `err.message` straight into the 500 response body for the requesting non-admin user.

**Exploit scenario.** An authenticated non-admin user repeatedly issues `POST /api/rnpm/search`. During any egress hiccup toward 2captcha.com — provider outage, DNS blip, firewall change — `solveRnpmCaptcha` rejects with `FetchError: request to https://2captcha.com/in.php?key=<TENANT_KEY>&method=userrecaptcha... failed, reason: connect ECONNREFUSED`. `captchaSolver.ts:83` wraps that text unchanged, and this handler returns it as `{"error":{"code":"INTERNAL_ERROR","message":"Eroare 2Captcha: request to https://2captcha.com/in.php?key=<TENANT_KEY>..."}}`, handing the shared paid credential to the caller. The user cannot force the network failure, but only has to be watching when it occurs.

**Preconditions.**
- Deployment runs in web mode (`LEGAL_DASHBOARD_AUTH_MODE=web`)
- A tenant 2Captcha key is configured via `/admin/keys` and 2captcha is the active provider, or the fallback path is used
- The outbound HTTPS call to 2captcha.com fails at the transport layer (DNS failure, egress block, connection reset, TLS error) so node-fetch raises a `FetchError` rather than an API-level error
- Caller has a valid session; no admin role is required for `POST /api/rnpm/search`

**Fix.** Redact provider credentials at the boundary instead of trusting SDK error text: in `captchaSolver.ts` strip `key=`/`clientKey` values and any URL query string from `msg` before constructing `CaptchaError`, and adopt the AI routes' posture (`backend/src/routes/ai.ts:229-231`) in `rnpm.ts` — log the detail server-side but return a fixed generic message to the client rather than `err.message`. Also scrub the key before `console.error`/`console.log` in `captchaSolver.ts` and `rnpm.ts:369`. (CWE-209)

**Verification.** 3/3 lens verifiers confirmed.

### F6 — Renderer origin is authenticated on a different connection than the one it loads: any local process that binds `[::1]:<port>` receives the privileged preload and the safeStorage decrypt oracle (MEDIUM, confidence medium)

**Impact.** A local attacker who cannot otherwise read the victim's DPAPI/Keychain-protected secrets gets the victim's own main process to decrypt them: the hostile page runs at origin `http://localhost:3002`, reads `portaljust-api-keys-enc` from that origin's localStorage, calls `desktopApi.decryptKeys(...)` and receives plaintext Anthropic, OpenAI, Google, OpenRouter, 2Captcha and CapSolver keys. The same page can proxy the real backend so the app looks normal, and it controls everything the renderer can do.

**Where.** `electron/main.js:409` in `createWindow`

**What.** The window is loaded from the hostname `localhost`, but the only identity check on that endpoint — the `bootNonce` comparison at `main.js:270` — is performed over a separate `fetch` connection. The backend binds IPv4-only (`backend/src/index.ts:498` defaults HOST to 127.0.0.1 and `main.js` never sets HOST), so `[::1]:3002` stays free for any local process, and whatever content wins the window's connection inherits the `contextBridge`-exposed `desktopApi.decryptKeys` plus the `http://localhost:3002` localStorage holding the safeStorage ciphertext.

**Exploit scenario.** The attacker — a second local user or a sandboxed process — binds a TCP listener on `[::1]:3002` that reverse-proxies `GET /health` to 127.0.0.1:3002 and serves its own HTML for everything else. The victim launches Legal Dashboard; the backend binds 127.0.0.1:3002 and `main.js` polls `http://localhost:3002/health`, where the squatter relays the real backend's response, so `body.bootNonce === bootNonce` passes — the nonce is echoed on an unauthenticated endpoint any local process can read. `createWindow` then calls `loadURL("http://localhost:3002")`; Chromium connects to `::1` and renders the attacker's page with `preload.js` attached. The page reads `localStorage["portaljust-api-keys-enc"]` from the same origin and calls `window.desktopApi.decryptKeys(enc)`, receiving the plaintext API keys, then exfiltrates them through its own server.

**Preconditions.**
- Attacker can run unprivileged code on the same host under a different local account or in a low-integrity sandbox; loopback ports are machine-wide, not per-user
- OS/Chromium resolves `localhost` to `::1` before 127.0.0.1 (the default on Windows, macOS and most Linux with IPv6 enabled); this could not be executed here to confirm ordering on the target machine
- Backend left at the default IPv4-only bind (HOST unset), which is what `electron/main.js` produces

**Fix.** Load and health-check the literal address the server binds to (`http://127.0.0.1:${BACKEND_PORT}`) instead of the hostname `localhost`, and tighten `isAllowedNavUrl` to that same literal host so a redirect cannot move the window to `::1`. Additionally, stop treating a value echoed by an unauthenticated `/health` as proof of identity: either bind the backend to a randomly chosen ephemeral port obtained in-process, leaving no fixed port to squat, or pass the nonce as a request header that only the real in-process backend can validate, and reject the response if the connection's peer address is not the bound address. (CWE-346)

**Verification.** 3/3 lens verifiers confirmed.

### F7 — Untrusted spreadsheet is deserialized in the renderer by xlsx-js-style@1.2.0, which ships SheetJS 0.18.5 (MEDIUM, confidence medium)

**Impact.** Prototype pollution inside the renderer realm — an `Object.prototype` gadget reachable from a crafted workbook — which can corrupt application-wide object behaviour, plus a ReDoS that hangs the renderer thread. In the Electron build the renderer is sandboxed with `contextIsolation`, so this is corruption and DoS within the app rather than direct RCE; in the planned web deployment the same code runs in the browser tab of every user who imports a file they were sent.

**Where.** `frontend/src/lib/monitoringBulkTemplate.ts:322` in `parseBulkFile`

**What.** An attacker-supplied `.xlsx`/`.xls`/`.csv` that a user imports through `MonitoringBulkImportCard` reaches `XLSX.read()` in-process. The installed `xlsx-js-style` bundle self-reports `a.version="0.18.5"` and contains zero `__proto__` guards, and both documented mitigations — the 10 MB size cap and the `MAX_BULK_DATA_ROWS`/`MAX_BULK_COLS` `!ref` cap — run before or after the parse, never bounding the parser itself. The relevant CVEs are CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS).

**Exploit scenario.** An attacker mails the user a `lista dosare.xlsx` that looks like the official bulk template. The user clicks Import in `MonitoringBulkImportCard`, `handleBulkUpload` passes the raw ArrayBuffer to `parseBulkFile`, and `XLSX.read` parses the crafted workbook with SheetJS 0.18.5. A workbook entry crafted to hit the unguarded property-assignment path writes onto `Object.prototype`, after which every subsequently created plain object in the renderer carries the attacker's property. Alternatively a crafted string field triggers the catastrophic-backtracking regex and freezes the UI thread.

**Preconditions.**
- Victim opens the monitoring bulk-import card and picks an attacker-supplied spreadsheet (social-engineered file, 10 MB or under)
- Application uses the installed `xlsx-js-style@1.2.0`; the root `package.json` has overrides only for jspdf and dompurify, no xlsx patch

**Fix.** Parse the workbook with a maintained library — exceljs is already a backend dependency — or a SheetJS build at 0.20.2 or later, or move parsing to a disposable Web Worker so pollution cannot reach the app realm. Also correct the claims in `monitoringBulkTemplate.ts:29-32` and `SECURITY.md:283` that the migration to xlsx-js-style closed these CVEs: xlsx-js-style 1.2.0 is a fork of the affected 0.18.5. No proof-of-concept was executed; the version and missing-guard facts come from reading `node_modules/xlsx-js-style/dist/xlsx.min.js`, which is why confidence is medium rather than high. (CWE-1321)

**Verification.** 2/3 lens verifiers confirmed.

### F8 — Admin-only PAT management is enforced only in the renderer; `/api/v1/tokens` has no role guard (MEDIUM, confidence medium)

**Impact.** Any authenticated non-admin web user can mint, list and revoke their own Personal Access Tokens despite the product contract restricting this to admins. The minted PAT is a long-lived bearer credential, optionally without expiry, usable outside the browser — so it bypasses the roughly one-hour session cookie lifetime and the SameSite=Strict/origin CSRF protections, and keeps working from any client until explicitly revoked or the account is deactivated. No role, quota or cross-owner escalation results: the token stays owner-scoped and capability-gated, so impact is bounded to unauthorized issuance of a persistent credential for data the user can already read.

**Where.** `frontend/src/components/ApiKeyDialog.tsx:133` in `ApiKeyDialog`

**What.** The documented "PAT management is admin-only in web mode" contract is implemented solely as this renderer conditional and its twin at `Settings.tsx:110`. The backend router at `backend/src/routes/apiTokens.ts` mounts POST/GET/DELETE and revoke-all under `/api/v1/tokens` (`backend/src/index.ts:361`) with only an owner scope and a "a PAT cannot manage PATs" check, never `requireRole("admin")` — so the authorization decision is client-side only.

**Exploit scenario.** A regular `role="user"` employee logs into the web deployment. The Settings page and the API-key dialog hide the PAT panel because of the checks at `Settings.tsx:110` and `ApiKeyDialog.tsx:133`. From the browser console on the app origin, the user sends `POST /api/v1/tokens` with a name, scopes `["dosare","iccj","rnpm"]` and no expiry. The backend router applies only the `PAT_CANNOT_MANAGE_TOKENS` check — the caller is a cookie session, not a PAT — so it returns a fresh `ld_pat_...` secret. The employee stores it externally; after they leave the browser, or the SSO session expires, the token keeps working from scripts, and it survives cookie/jti revocation at logout.

**Preconditions.**
- Deployment runs in web mode (`getAuthMode() === "web"`); the shipped Electron desktop build does not mount `/api/v1/tokens`
- Attacker holds a valid non-admin session cookie (any provisioned, active user)
- Attacker issues the request outside the UI, via curl or fetch from a page in the app origin, since the UI itself hides the panel

**Fix.** Move the decision server-side: add `requireRole("admin")` to the `apiTokensRouter` middleware in `backend/src/routes/apiTokens.ts`, or at the mount in `backend/src/index.ts:361`, so every POST/GET/DELETE/revoke-all is rejected for non-admin callers. Keep the renderer conditionals as UX only. If non-admin self-service PATs are actually intended, update the contract and remove the misleading client-side gates instead of leaving the two out of sync. (CWE-602)

**Verification.** 2/3 lens verifiers confirmed.

### F9 — Unauthenticated CRLF log injection into the auth-denial log via percent-encoded newlines in the request path (LOW, confidence high)

**Impact.** Forged or truncated entries in the operational log stream that is the primary evidence for auth abuse: an attacker can fabricate structured events, spoof other request paths and statuses, and dilute the real `[auth.denied]` trail. No effect on the `audit_log` DB rows, whose write is parameterized, and no code execution.

**Where.** `backend/src/middleware/owner.ts:53` in `writeAuthError`

**What.** The untrusted source is the HTTP request target. Hono's `getPath` runs the pathname through `decodeURI` (`node_modules/hono/dist/cjs/utils/url.js:101-118`), and `%0A`/`%0D` are not in decodeURI's reserved set, so `c.req.path` can contain raw CR/LF. That value is interpolated unescaped into a single-line `console.warn` record that operators and log collectors parse line by line.

**Exploit scenario.** An unauthenticated attacker sends `GET /api/v1/me%0A%7B%22action%22%3A%22http%22...%7D` with no token. `ownerContext` throws `AuthenticationError`, `writeAuthError` runs, and `c.req.path` decodes to `/api/v1/me` followed by a newline and a forged JSON object such as `{"action":"http","method":"GET","path":"/api/v1/admin/users","status":200}`. stdout now contains a second line that a JSON-lines collector ingests as a genuine structured event. By repeating with forged `[auth.denied] ... code=... status=...` lines, the attacker can also bury or contradict the real trail of a credential-stuffing run against the same endpoint.

**Preconditions.**
- Backend running in web mode; in desktop mode `DesktopAuthProvider` never throws `AuthenticationError`, so `writeAuthError` is unreachable
- Attacker can reach any `/api/*` path; no credentials are needed, since the 401 path is what triggers the log write
- Logs are collected or reviewed as line-oriented or JSON-lines text (Docker stdout collection, per DEPLOY-SERVER.md)

**Fix.** Sanitize before interpolation — log `JSON.stringify(c.req.path)`, or replace `[\r\n]` — or switch this line to the structured `JSON.stringify` form already used by the access logger at `backend/src/index.ts:106`. Applying the same treatment to `backend/src/routes/rnpmGuards.ts:97`, which interpolates `c.req.path` into a plaintext warn line, closes the sibling case. (CWE-117)

**Verification.** 3/3 lens verifiers confirmed.

### F10 — Cross-owner job existence and liveness oracle: scheduler in-flight probe runs before the owner check on DELETE /jobs/:id (LOW, confidence high)

**Impact.** An authenticated tenant can distinguish "job id N belongs to another owner and is executing right now" (409 `job_in_flight`) from "job id N does not exist or is not mine" (404). Job ids are sequential integers, so this yields a cross-tenant inventory and run-schedule oracle. No other owner's data content is returned and no cross-owner mutation occurs, so impact is confined to metadata disclosure — which is exactly what the surrounding code sets out to prevent, per its own comment at lines 407-408.

**Where.** `backend/src/routes/monitoring.ts:303` in the `monitoringRouter.delete("/jobs/:id")` handler

**What.** The attacker-controlled path param `id` (`routes/monitoring.ts:283`) is looked up in the scheduler's global `inflight` Map — keyed by jobId with no owner dimension (`services/monitoring/scheduler.ts:234`) — and produces a distinct 409 response *before* the owner-scoped `getJobById(ownerId, id)` check inside the transaction at line 312. The authorization decision is therefore made after a state-revealing one.

**Exploit scenario.** Tenant B enumerates job ids 1..N with `POST /api/v1/monitoring/jobs/bulk-delete {"ids":[1..100]}` — 100 probes per request. Ids returned in `inflight_ids` (`routes/monitoring.ts:402`) are jobs that exist, are not B's, and are executing at that instant; ids in `not_found_ids` are unknown-or-foreign-but-idle. Repeating the poll builds a map of which job ids exist across all tenants and the cadence at which each fires, leaking how many monitors other tenants run and when. The same signal is available one id at a time via `DELETE /jobs/:id`, where a foreign running job answers 409 while a nonexistent one answers 404.

**Preconditions.**
- Multi-owner deployment (`LEGAL_DASHBOARD_AUTH_MODE=web`); in desktop mode every request is owner `local`, so there is no second tenant to probe
- Monitoring enabled (default: `MONITORING_ENABLED !== "0"`) and the scheduler wired via `setMonitoringScheduler`
- Attacker holds any valid low-privilege session; no admin role needed
- The probed job must be mid-run at probe time, and the attacker can poll to widen the window

**Fix.** Move the ownership resolution ahead of the in-flight probe in both handlers: resolve `const before = getJobById(ownerId, id)` first and return 404 when it is null, then consult `scheduler.getInflightAbortController(id)` only for rows the caller owns. This must be fixed in two places — `routes/monitoring.ts:293-304` (DELETE /jobs/:id) and `routes/monitoring.ts:397-404` (POST /jobs/bulk-delete, where the `inflight_ids.push(id); continue;` branch precedes `getJobById`). Alternatively, key the scheduler's inflight map on `(ownerId, jobId)` and have `getInflightAbortController` require the ownerId.

**Verification.** 3/3 lens verifiers confirmed.

### F11 — Newline-bearing `institutie` query parameter is interpolated into a console log line (LOW, confidence medium)

**Impact.** Forged log lines in the backend's stdout stream. An operator, or a log shipper that parses line-oriented output, can be misled about what happened, and genuine incident evidence can be diluted or contradicted. No code execution and no data access.

**Where.** `backend/src/routes/termene.ts:154` in the `termeneRouter.get("/")` multi-institution fan-out catch

**What.** The `institutie` query values are attacker-controlled and pass through `validateParams`, whose control-character class deliberately omits `\n` (0x0a), `\r` (0x0d) and `\t` (0x09). The value is then interpolated raw into a `console.error` template string, letting a caller forge whole log records.

**Exploit scenario.** The attacker calls `GET /api/v1/termene?numeParte=A&institutie=Tribunalul%20Bucuresti&institutie=X%0A2026-07-24%20%5Bauth%5D%20admin%20login%20ok`. `validateParams` accepts the second value because its rejection class skips 0x0a. The bogus institution makes the SOAP envelope carry an out-of-range enum, PortalJust answers with a `soap:Fault`, `callSoap` throws, the per-institution `.catch` runs, and the embedded newline splits the message into two lines in the process log — the second being a fabricated authentication record.

**Preconditions.**
- Attacker can issue `GET /api/v1/termene` with two or more `institutie` values; this branch only runs when `institutii.length > 1`
- The SOAP call for the injected institution must reject — an invalid enum value producing a `soap:Fault`, or a response over `SOAP_MAX_RESPONSE_BYTES` — so the `.catch` at line 153 fires

**Fix.** Extend the rejection class in `validateParams` (`backend/src/util/validation.ts:42`) to cover `\x09`, `\x0a` and `\x0d`, or — better for the sink itself — stop interpolating and log structurally, e.g. `console.error("[termene] cautare esuata", JSON.stringify({ institutie: inst, error: msg }))`, matching the pattern already used by `logFilterEvent` in `routes/rnpm.ts`. (CWE-117)

**Verification.** 3/3 lens verifiers confirmed.

### F12 — SMTP relay credentials sent over opportunistic, strippable TLS (LOW, confidence medium)

**Impact.** An attacker positioned between the backend container and the SMTP relay — a shared or hostile network, a compromised egress hop — can suppress the STARTTLS capability and capture the relay username and password in plaintext, then use the relay to send mail as the deployment, and read the alert bodies (dosar numbers, monitored party names) in transit.

**Where.** `backend/src/services/email/mailer.ts:59` in `getTransport`

**What.** `SMTP_USER`/`SMTP_PASS`, a real relay credential read from env in `readMailerConfig`, are handed to `nodemailer.createTransport` with `secure` defaulting to `port === 465` and no `requireTLS`. On the common submission port 587 the connection therefore only upgrades to TLS if the server advertises STARTTLS, and an on-path attacker who strips the advertisement gets the AUTH exchange in cleartext.

**Exploit scenario.** The deployment configures `SMTP_HOST=smtp.provider.tld`, `SMTP_PORT=587` and leaves `SMTP_SECURE` unset, so `readMailerConfig` computes `secure=false`. When a monitoring alert fires, nodemailer opens a plaintext connection and issues EHLO; an on-path attacker rewrites the EHLO response to omit `250-STARTTLS`. nodemailer, having no `requireTLS` constraint, proceeds to AUTH LOGIN over the cleartext socket, disclosing `SMTP_USER` and `SMTP_PASS` to the attacker along with the message body.

**Preconditions.**
- Email alerts enabled: `SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM` all set, since the mailer is disabled otherwise
- `SMTP_SECURE` unset or `"false"` and `SMTP_PORT != 465`, e.g. the usual 587 or 25
- Attacker has an on-path position on the route from the backend to the SMTP relay

**Fix.** Pass `requireTLS: true`, leaving `tls.rejectUnauthorized` at its default, whenever `config.secure === false`, so nodemailer aborts instead of falling back to cleartext when STARTTLS is missing. Optionally validate at boot that `SMTP_SECURE=false` is a deliberate choice. (CWE-319)

**Verification.** 2/3 lens verifiers confirmed.

## What was verified

An inventory agent partitioned the repository, one threat modeller ran per component, and 37 researcher cells swept the component-by-category matrix with a breadth sweep and a dedicated secrets pass on top — 123 agents in total. Those produced 29 candidate findings, 25 after deduplication, each of which faced a three-lens adversarial panel that voted on reachability, impact and defences: 75 panel votes in all, with a two-of-three majority required to survive. Thirteen candidates were rejected outright and twelve survived, nine of them unanimously and three on a 2-1 split (F7, F8, F12), which is why those three cannot claim high confidence. No candidate site was left unreviewed and no candidate was dropped by a cap. Nothing in this report was executed: no tests were run, no exploit was fired, and no proof-of-concept was validated — every finding is derived from reading the code, which is why confidence is capped at medium for findings whose exploitability depends on runtime behaviour such as browser DNS pinning or `localhost` resolution order. The verification status stamped for this run is recorded in the revision stamp beside this report.
