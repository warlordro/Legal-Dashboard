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
If that variable is inherited, `electron` behaves like Node and
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
