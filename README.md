# Legal Dashboard

**Search, monitoring and AI analysis for Romanian court records and movable-property security interests.**

`v2.46.1` · MIT licensed · Node.js ≥ 22 · Windows, macOS, Docker, bare-metal
58 releases · 2,685 tests (2,242 backend / 443 frontend, Vitest)

*Romanian documentation: [README.ro.md](README.ro.md) · [CHANGELOG.md](CHANGELOG.md) · [SECURITY.md](SECURITY.md) · [RUNBOOK.md](RUNBOOK.md)*

---

## What this is

Romania's judicial and collateral data is public by law and, in practice, close to unusable. It lives behind an undocumented SOAP interface and a captcha-gated registry. There is no API, no bulk access, no official client library, and — until this project — no maintained open-source client either.

Legal Dashboard is that client. It runs as a desktop application or as an authenticated multi-user web service **from the same codebase**, and it turns four separate manual lookups into queryable, exportable, monitorable data.

### The four data sources

| Source | What it is | What the official interface gives you |
|---|---|---|
| **PortalJust** (`portal.just.ro`) | The Ministry of Justice case portal — every case before Romania's 246 courts | A SOAP endpoint with no published schema, one court per query form |
| **ICCJ** (`scj.ro`) | The High Court of Cassation and Justice | A separate website; **not covered by PortalJust at all** |
| **RNPM** | The National Registry of Movable Property Publicity — the register of security interests over movable assets | A captcha on every query, no history, no bulk lookup |
| **AI providers** | Anthropic, OpenAI, Google | — |

If you work in a common-law jurisdiction, RNPM is the rough equivalent of a UCC-1 filing registry: it tells you who has already taken security over a company's movable assets. It is the first thing a lender checks and the last thing anyone wants to check by hand, one captcha at a time, across a portfolio of two hundred companies.

---

## Deployment model

This is software you run yourself, not a service you subscribe to. Each organisation deploys its own instance and keeps its own data — no third party sits between you and the source registries, and no case data leaves infrastructure you control.

The reference deployment runs on a NAS behind a Cloudflare tunnel: traffic enters through Cloudflare (TLS, WAF, DDoS protection), passes the Google authentication layer, and only then reaches the application. No router ports are opened. A conventional server or Docker deployment works the same way — see `npm run dist:server` below.

---

## Features

### Cases and hearings

- Parallel search across **246 courts**, grouped by category (courts of appeal, tribunals, first-instance, military and specialised courts), by case number, subject matter, or party name
- Sortable, paginated results with expandable rows: parties, procedural stage, subject matter, and the full hearing timeline with rulings and a direct link to the official record
- Statistics panel where every card doubles as a filter; calendar view for hearing dates
- **Partial results on failure** — when one court doesn't respond, you get the courts that did, plus a banner naming what's missing, instead of losing the whole query
- Excel and PDF export, on selection or on the full result set

### High Court (ICCJ)

A dedicated module querying `scj.ro` directly, with the same search logic, tables and exports. The official portal does not cover the High Court, so without this the highest court in the country is a blind spot.

### RNPM — movable-property security interests

- All five statutory categories: movable mortgages, fiduciary transfers, specific notices, securitised receivables, mortgage bonds
- Three working modes: single lookup, **bulk lookup of up to 200 identifiers** (company or personal registration numbers, or names) with item-by-item progress, and a **persistent local database** of everything you've ever queried
- Local database is diacritics-insensitive, filterable by type, period and active status, with aggregate statistics (distribution by type, top creditors, top debtors, monthly trend)
- Full detail per filing: creditors, debtors, assets, amendment history

The practical difference from the official site: there, every query starts from zero and leaves no trace. Here, what you searched once stays yours — re-queryable, filterable and comparable over time.

### Automated monitoring and alerts

Track cases and party names and let the application check for you on a schedule. It detects new hearings, delivered rulings, new parties joining a case, and new cases filed against a monitored name. Alerts land in-app and optionally by email, either individually or as a daily digest at a fixed hour. Bulk-dismissable and exportable.

This is the part that changes how the work is done: you stop checking, and start being told.

### AI case analysis

Structured analysis of any case — summary, parties, current posture, hearing history, likely next steps, legal basis, related matters. Nine models across three providers, grouped into fast / balanced / premium tiers.

There is also a **multi-agent mode**: two models analyse the same case in parallel, and a third premium-tier model reviews both, reconciles contradictions, and corrects misreadings before anything reaches the user. Truncated analyses are detected and flagged rather than served as if complete. Output exports to PDF.

---

## Two run modes, one codebase

| | Desktop | Web |
|---|---|---|
| Install | Installer per machine (Windows / macOS) | None — a link |
| Access | Only the machine it's installed on | Any browser |
| Users | Single, local | Team, with accounts and roles |
| API keys | Each user supplies their own | Configured once by an admin, for everyone |
| AI cost | Uncontrolled | Per-user budget and quota, with consumption reporting |
| Updates | Reinstall | Automatic on next load |
| Audit | Local | Centralised, exportable |

**Web mode specifics:** Google OAuth with an email-domain allowlist; sessions established on load, refreshed in the background, self-recovering on expiry; explicit logout with a confirmation page that warns the Google session is still live in the browser. Each user sees only their own data — the RNPM store is **physically separated per account**, one SQLite file each, with its own storage cap. Admins get tabbed settings, per-user AI quotas and grants, per-user consumption, and an exportable audit log.

**Programmatic access:** the application can issue read-only personal access tokens, scoped per module (cases, ICCJ, RNPM), with optional expiry and a daily cap. The token is shown once; only its fingerprint is stored. Any request outside the granted scope is refused. Token management is admin-only.

---

## Quick start

**Prerequisites:** Node.js ≥ 22 (the backend uses `--experimental-strip-types`), Git. Optionally a 2Captcha or CapSolver account for RNPM, and an Anthropic / OpenAI / Google API key for the AI module.

```bash
git clone https://github.com/warlordro/Legal-Dashboard.git legal-dashboard
cd legal-dashboard
npm install                              # root + backend + frontend (workspaces)
cp backend/.env.example backend/.env     # optional: API keys via env
npm run electron:dev                     # backend on :3002, Electron window
```

First boot creates the database at `app.getPath("userData")/legal-dashboard.db`.

> **Note on network environment:** the court portal is selective about which networks it answers. If case search times out on your host, try running from a different connection — the RNPM, ICCJ and AI modules are unaffected either way.

### Common commands

| Command | What it does |
|---|---|
| `npm run electron:dev` | Start the desktop app |
| `npm run dev:backend` | Backend only (Node + TS direct) on :3002 |
| `npm run dev:frontend` | Vite dev server on :5173 (renderer only) |
| `npm run build` | Production build (frontend + backend CJS bundle) |
| `npm run dist` | Windows NSIS installer |
| `npm run dist:mac` | macOS DMG (x64 + arm64) |
| `npm run dist:server` | Deployable server ZIP for bare-metal / Docker |
| `npm test --workspace=backend` | Backend test suite (Vitest) |
| `cd frontend && npm test -- --run` | Frontend test suite |
| `npx tsc --noEmit -p backend/tsconfig.json` | Type-check backend |
| `npx biome check` | Lint + format check |
| `npm run rebuild:electron` | Rebuild `better-sqlite3` for the Electron ABI after running Node tests |

> **If a large number of backend tests fail at once**, it is almost certainly not your code: `better-sqlite3` is a native module and gets compiled against one Node ABI at a time. Run `npm rebuild better-sqlite3` before the test suite, and `npm run rebuild:electron` before launching the desktop app again.

---

## Architecture

```
electron/main.js              main process: single-instance lock, CSP, safeStorage IPC, backend bundle
electron/preload.js           context bridge (safeStorage only)
backend/src/index.ts          Hono server on :3002 — AI routes, PortalJust SOAP, RNPM
backend/src/routes/           API v1: monitoring jobs, manual runs, RNPM search/bulk/export
backend/src/services/         scheduler, diffing, SOAP runners, clock/test seams
backend/src/db/               SQLite (better-sqlite3), versioned migrations, owner-scoped
                              repositories, audit and monitoring tables
frontend/src/                 React 18 SPA (Vite), REST + SSE to the backend
```

**Monitoring internals.** The scheduler runs `dosar_soap` and `name_soap` jobs, stores snapshots, diffs hearings / rulings / parties, and writes an audit trail. A unique index (`idx_one_running_per_job`) plus state-guarded finalisation guarantees one running job at a time — crash recovery cannot produce duplicates.

**Operational kill switches**, no redeploy required:

- `MONITORING_ENABLED=0` — unmounts monitoring routes and the scheduler
- `MONITORING_DISABLED_KINDS=dosar_soap,name_soap,iccj` — excludes job kinds from scheduler claims, no DB changes
- `ICCJ_ROUTES_DISABLED=1` — interactive ICCJ routes return 503

**Auth modes.** `desktop` (default) is a single local identity with no token validation, used when the backend runs in-process under Electron. `web` validates JWTs on `Authorization: Bearer` or the `legal_dashboard_session` cookie, and requires `LEGAL_DASHBOARD_JWT_SECRET` (32+ bytes), issuer and audience — boot fails fatally if they're missing. Non-loopback binding requires explicit opt-in via `LEGAL_DASHBOARD_ALLOW_REMOTE=1`, which in turn requires web mode and a valid JWT.

`/health` stays public and non-sensitive in all modes. Full environment reference in `backend/.env.example`.

---

## Security

See **[SECURITY.md](SECURITY.md)** for the full threat model, and **[RUNBOOK.md](RUNBOOK.md)** for rollback, restore and forensics procedures.

Summary of the posture:

- API keys are stored in the OS keychain via Electron `safeStorage` on desktop, and as server-side encrypted per-tenant keys in web mode. In web mode users never see or supply keys.
- Per-user physical data separation for RNPM (one SQLite file per account), with a one-time crash-safe split and a verified pre-split backup.
- Self-service backup and restore scoped strictly to the user's own data, with concurrency guards and a verified pre-restore snapshot. Full-database backup is admin-only, with automatic retention across disjoint pools.
- LAN exposure is blocked by default. Session revocation is enforced server-side on logout. The session cookie is hardened against cross-site use. Captcha keys are redacted from all error output. The audit log records the real visitor address, not the proxy's.
- Every recent release goes through a written plan, adversarial review before and after implementation, and verification against a live instance. Automated checks (types, tests, build) block publication.

Out of scope, stated explicitly: unsigned Windows binaries, LAN mode without authentication. Details in SECURITY.md.

---

## Legal and ethical notes

Worth being explicit about, since this project automates access to state systems.

**All data reached by this application is public by law.** Court records are public under Romanian procedural law; RNPM is a public register whose entire purpose is to give notice to third parties. Nothing here circumvents an access-control decision about *who* may see the data — only the friction in *how* it is served.

**RNPM captcha.** The registry gates legally-public data behind a captcha, with no API and no bulk access. The application solves it so that portfolio-scale due diligence is possible at all. Requests are rate-limited and quota-capped per user, and the application queries only what that user would otherwise type in by hand. It does not crawl, enumerate, or mirror the registry.

**No scraping of the court portal.** Case data comes from the Ministry of Justice's own SOAP interface, which is the intended machine-readable channel.

**Personal data.** Case records contain personal data. Deployers are controllers under GDPR and are responsible for their own lawful basis, retention, and access control. The application provides the tooling — per-user separation, audit logging, storage caps, scoped tokens — but the compliance obligation sits with whoever runs it.

---

## Project status

Functional: cases, hearings, ICCJ, RNPM, monitoring with email alerts, AI analysis, user administration, programmatic API. The web deployment is live and verified against a real instance with Google authentication.

Remaining work is operational rather than product-level: exposing the programmatic API on the public deployment (it works locally, the route isn't live yet), packaging the application as an MCP server for AI assistants, and OAuth for external integrations.

The desktop application remains fully supported, with Windows and macOS installers, for local-only workflows.

---

## Contributing

This has been a single-maintainer project. I'd genuinely welcome that changing.

Useful to know before you start: I'm a financial-risk and AML professional rather than a trained software engineer, and much of this codebase was written with AI assistance and then hardened by review and tests. If you find something that looks confidently wrong, it probably is — an issue explaining why is more valuable to me than a polite silence.

Areas where help would matter most:

- Extracting the PortalJust SOAP and RNPM integration layers into standalone, publishable libraries — they're the parts other people would actually want
- Test coverage on the frontend, which trails the backend considerably (443 tests against 2,242)
- Accessibility, which has had no serious attention
- Anything in the Romanian-only documentation that should be in English

Open an issue before a large PR so we don't duplicate work. `main` is protected; changes go through pull requests with CI (type-check, tests, build) passing.

---

## License

MIT — see [LICENSE](LICENSE).
