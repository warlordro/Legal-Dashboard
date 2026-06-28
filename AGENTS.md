# Codex Project Instructions

## Operating Model

For complex work, use the global AI-team model from `$orchestrate-ai-team`.

Use it when the user mentions Tonone, global model, AI team, specialist agents,
or role names such as Apex, Helm, Warden, Prism, Spine, Flux, Relay, Atlas,
Proof, Vigil, or Cortex. Also use it for cross-functional tasks such as
planning, review, takeover/recon, architecture, security, release, product
briefs, and implementation that spans several areas.

Keep it lightweight. Choose only the roles needed, explain the active roles
briefly when useful, then execute normally. Do not add ceremony to simple
one-step tasks.

## Project State Source

Read `CLAUDE.md` before starting a new development PR. It carries the fuller
current sprint context, accepted risks, web-readiness bridge, build notes, and
runtime traps. Then read `SESSION-HANDOFF.md` for the immediate next-session
handoff and `EXECUTION-ROADMAP.md` for the active PR checklist.

## Scope Discipline

Execute the agreed plan. You may make local implementation changes, bug fixes,
and small connective edits needed to complete that plan.

Do not make fundamental or critical changes to architecture, product behavior,
data model, workflows, migrations, or the agreed plan without stopping first.
If you find a problem, inconsistency, missing requirement, migration risk, or a
better approach that would materially change the plan, report it to the user
first. Explain the issue and the recommended fix, then wait for explicit
approval before changing those files.

Do not remove or replace existing working behavior unless the current agreed
plan explicitly says to do so.

## Electron Smoke

Always smoke the desktop Electron app, not a web-only localhost flow.

When the user asks to open the app without showing a terminal, launch Electron
detached/hidden (for example `Start-Process ... -WindowStyle Hidden`) and keep
only the Electron app window visible. Do not open Windows Terminal or an
integrated VS Code terminal unless the user explicitly asks for a visible
terminal/log window.

On this machine, the shell environment may contain `ELECTRON_RUN_AS_NODE=1`.
If that variable is inherited, `electron` behave like Node and
`require("electron").app` is `undefined`. Before launching the app, clear it
for the Electron process, for example:

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
npm.cmd run electron:dev
```

or launch through `cmd.exe` with:

```cmd
set ELECTRON_RUN_AS_NODE=& .\node_modules\.bin\electron.cmd .
```

Other launch traps:

- `better-sqlite3` has different native ABI builds for Node/Vitest and
  Electron. Node tests may require `npm rebuild better-sqlite3`; after tests,
  run `npm run rebuild:electron` before opening Electron.
- If a stale Electron process holds the single-instance lock, close it from
  Task Manager or stop the orphan `electron.exe` process before relaunch.
- If port `3002` is already used by a leftover backend, Electron startup can
  fail. Stop the old backend before relaunch.
- The backend bundle is CJS; use the existing `typeof __dirname !==
  "undefined" ? __dirname : ...` pattern, not raw `import.meta.url`.

## Cursor Cloud specific instructions

This runs on a headless Linux VM (Ubuntu), not Windows. The Windows/PowerShell
guidance in "Electron Smoke" above does not apply here; use the notes below.
Standard commands live in `CLAUDE.md` / `README.md` — only the non-obvious cloud
caveats are captured here.

- **Running the standalone backend needs a Node flag.** `npm run dev:backend`
  and `npm run start` invoke `node --experimental-strip-types`, which fails on
  this codebase because several files use TypeScript parameter properties
  (`constructor(public readonly ...)`) — strip-only mode cannot transform those
  on any Node 22/24. Run these with `NODE_OPTIONS=--experimental-transform-types`
  (e.g. `NODE_OPTIONS=--experimental-transform-types npm run dev:backend`). The
  esbuild bundle (`npm run build`) and vitest already handle this, so only the
  raw-node dev/start paths need the flag.

- **A plain browser at `http://localhost:5173` will NOT load the app in the
  default desktop config.** In desktop auth mode the SPA's web-session bootstrap
  calls `POST /api/v1/auth/oauth2/sync`, which the backend rejects with
  `desktop_only` (400), so the UI shows a "Sesiunea web nu a putut fi
  initializata" error. The browser/Vite path only works with
  `LEGAL_DASHBOARD_AUTH_MODE=web` + an oauth2-proxy session bridge. For
  smoke-testing the product, run the Electron desktop app instead (below), where
  `window.desktopApi` exists and no web session is needed. `dev:backend` +
  `dev:frontend` are still useful for backend API testing via curl and for
  frontend hot-reload work.

- **Launching Electron on the VM:** the desktop is on `DISPLAY=:1` and the
  container has no setuid sandbox, so Electron must run with `--no-sandbox`.
  Before launching: free port `3002` (stop any `dev:backend`) and run
  `npm run rebuild:electron` if Node tests / `npm install` last built
  `better-sqlite3` for the Node ABI (see the ABI trap above). Then:
  `unset ELECTRON_RUN_AS_NODE; DISPLAY=:1 ./node_modules/.bin/electron --no-sandbox .`
  (`npm run electron:dev` does not pass `--no-sandbox`). The in-process backend
  serves the built SPA at `http://localhost:3002`; run `npm run build` first if
  `dist-frontend/` / `dist-backend/` are stale. Benign `dbus` connection errors
  in the log can be ignored.

- **Tests:** `npm test` runs ~1490 tests. The 6 tests in
  `backend/src/index.test.ts` (full in-process HTTP server boot + `fetch`) time
  out / misbehave under the vitest worker harness in this sandbox even though the
  real server boots fine standalone (verified via `curl /health`); treat those 6
  as an environment limitation, not a regression. The rest pass.

- **External services:** the PortalJust SOAP upstream
  (`http://portalquery.just.ro`) is reachable from the VM, so real dosar searches
  work end-to-end. RNPM/ICCJ/AI features need captcha/API keys and are optional.
