import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { rnpmRouter } from "./routes/rnpm.ts";
import { dosareRouter } from "./routes/dosare.ts";
import { termeneRouter } from "./routes/termene.ts";
import { aiRouter } from "./routes/ai.ts";
import { preAuthRateLimit, rateLimit } from "./middleware/rate-limit.ts";
import { originGuard } from "./middleware/originGuard.ts";
import { ownerContext } from "./middleware/owner.ts";
import { getAuthMode, validateAuthConfig } from "./auth/config.ts";
import { getUserById, updateUserRole } from "./db/userRepository.ts";
import { requestIdContext } from "./middleware/requestId.ts";
import {
  monitoringRouter,
  setMonitoringScheduler,
  getMonitoringSchedulerStatus,
} from "./routes/monitoring.ts";
import { nameListsRouter } from "./routes/nameLists.ts";
import { alertsRouter } from "./routes/alerts.ts";
import { aiUsageRouter } from "./routes/aiUsage.ts";
import { meRouter } from "./routes/me.ts";
import { adminRouter } from "./routes/admin.ts";
import { dashboardRouter } from "./routes/dashboard.ts";
import { authRouter } from "./routes/auth.ts";
import { Scheduler } from "./services/monitoring/scheduler.ts";
import { realClock } from "./services/monitoring/clock.ts";
import { createDosarSoapRunner } from "./services/monitoring/dosarSoapRunner.ts";
import { createNameSoapRunner } from "./services/monitoring/nameSoapRunner.ts";
import { drainEmailDispatches } from "./services/email/alertEmailDispatcher.ts";
import { readMailerConfig } from "./services/email/mailer.ts";
import {
  startDailyReportScheduler,
  stopDailyReportScheduler,
} from "./services/email/dailyReportScheduler.ts";
import { cautareDosare } from "./soap.ts";
import { mountStaticFrontend } from "./middleware/static-frontend.ts";
import { markShuttingDown } from "./db/schema.ts";
import { getAvize, getAvizStats } from "./db/avizRepository.ts";
import { runDailyBackup } from "./db/backup.ts";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

// __dirname is provided by:
//   - CJS bundle (esbuild output in production)
//   - Node --experimental-strip-types running .ts directly under CommonJS
// In ESM dev we fall back to import.meta.url. For the CJS bundle, scripts/build.js
// passes --define:import.meta.url="\"\"" so esbuild replaces the token at compile
// time — no empty-import-meta warning, and the branch is dead anyway (__dirname is
// defined) so the empty string is never used.
const __curdir = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
// Audit 2026-04-29 R3: in productie nu suprascriem env-ul oferit de orchestrator
// (Docker / systemd / Kubernetes secrets). `.env` din imagine ramane fallback,
// dar nu poate sterge un secret injectat la runtime.
dotenv.config({
  path: path.join(__curdir, "..", ".env"),
  override: process.env.NODE_ENV !== "production",
});

const app = new Hono();

app.use("*", logger());

// Security headers + CSP (applied to both Electron-served HTML and future web build)
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind emits inline styles
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  })
);

// CORS - only enabled outside production. In production the frontend is served
// from the same origin (Electron / mounted static), so the dev origins must NOT
// be on the allow-list — would let any local app call the API in web mode with
// LEGAL_DASHBOARD_ALLOW_REMOTE=1.
if (process.env.NODE_ENV !== "production") {
  app.use(
    "*",
    cors({
      origin: ["http://localhost:5173", "http://localhost:4173"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      // PR-9 M3: Bearer auth necesita ca preflight-ul sa permita Authorization,
      // altfel browser-ul dev (Vite) nu poate trimite token-ul dupa OPTIONS.
      allowHeaders: ["Content-Type", "Authorization"],
    })
  );
}

// Electron in-process bundle: backend is `require()`'d by main.js. A bare
// `process.exit(1)` here kills Electron silently (window vanishes, no dialog).
// Throw instead — synchronous throws propagate through `require()` → main.js
// catch + showErrorDialog; async throws hit main.js's `uncaughtException`
// handler which also shows a dialog before quitting. Server mode keeps the
// hard exit so the process manager (PM2/systemd/Docker) can restart cleanly.
const IS_ELECTRON_INPROC = typeof process.versions.electron === "string";
function fatalBoot(reason: string, err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[boot] ${reason}:`, msg);
  if (IS_ELECTRON_INPROC) {
    throw err instanceof Error ? err : new Error(`${reason}: ${msg}`);
  }
  process.exit(1);
}

// v2.17.0 — fail-fast on unhandled rejections. Before this, an unhandled
// promise rejection (forgotten await on insertAlert, mailer crash inside
// queueMicrotask, etc.) silently logged a Node deprecation warning and the
// process kept running with broken invariants. In Electron we throw so the
// crash dialog shows; in server mode we exit so the supervisor restarts.
// `process.on("unhandledRejection")` is registered once per process.
process.on("unhandledRejection", (reason: unknown) => {
  console.error("[boot] unhandled rejection:", reason);
  if (IS_ELECTRON_INPROC) {
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
  process.exit(1);
});

try {
  validateAuthConfig();
} catch (e) {
  fatalBoot("auth config invalid", e);
}

// v2.17.0 (origin) — surface SMTP partial-config at boot. The mailer's
// `readMailerConfig` returns null silently when ANY required field is missing
// (host/port/user/pass/from). Pre-fix, an operator who set 4 of 5 SMTP_* vars
// would see "[email] disabled" only on the first dispatch attempt — invisible
// until an alert actually fires. Now we eagerly probe at boot and warn-list
// which pieces are missing so the misconfig is caught before any user impact.
{
  const smtpVars = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];
  const presentVars = smtpVars.filter((v) => (process.env[v] ?? "").trim().length > 0);
  if (presentVars.length > 0 && readMailerConfig() === null) {
    const missing = smtpVars.filter((v) => !((process.env[v] ?? "").trim().length > 0));
    const port = process.env.SMTP_PORT?.trim();
    const portInvalid =
      missing.length === 0 && port !== undefined &&
      !(Number.isFinite(Number(port)) && Number(port) >= 1 && Number(port) <= 65535);
    console.warn(
      `[email] SMTP partial config detected — mailer disabled. Set: ${presentVars.join(", ")}` +
        (missing.length > 0 ? `; missing: ${missing.join(", ")}` : "") +
        (portInvalid ? `; SMTP_PORT="${port}" out of range 1..65535` : ""),
    );
  }
}

// PR-9 fix B3: requestId trebuie sa existe inainte ca ownerContext sa returneze
// 401/403, ca raspunsurile auth sa includa `x-request-id` si `requestId` in
// envelope (fail()).
app.use("*", requestIdContext);

// PR-9 fix B4: /health trebuie sa fie disponibil fara DB user lookup. Mount-uit
// inainte de ownerContext, ca readiness probes sa nu cada cand users.local
// lipseste sau auth web nu are token.
app.get("/health", healthHandler);

// PR-9 fix B2: pre-auth IP-only rate limiter pe /api/* (cheap, no DB).
// Floods cu token missing/invalid se opresc inainte sa loveasca ownerContext.
app.use("/api/*", preAuthRateLimit);

// PR-1 web-readiness seam: populate c.get("ownerId") for every request.
// Desktop remains "local"; PR-9 web mode swaps for JWT-derived user id and
// fails closed for API calls.
app.use("*", ownerContext);

// F2 audit hardening (2026-04-30): CSRF defense on state-changing routes when
// the backend is bound to a non-loopback interface. Mounted unconditionally —
// the middleware itself short-circuits for safe methods + loopback peers, so
// the desktop loopback path stays unchanged. Host/Origin parsing happens only
// for cross-LAN POST/PUT/PATCH/DELETE.
app.use("/api/*", rateLimit);
app.use("/api/*", originGuard);

// Readiness flag: schema migrations + prewarm run before serve(), but if the DB
// is locked by another tool or temporarily inaccessible we keep /health serving
// 503 until ready=true. Container orchestrators / Electron splash poll this.
let ready = false;
function healthHandler(c: Context): Response {
  if (!ready) {
    return c.json({ status: "starting", service: "Legal Dashboard API" }, 503);
  }
  // Tier 3 #12: surface monitoring scheduler liveness so ops can detect
  // "scheduler died but HTTP still up" without scraping logs. Shape:
  //   monitoring: { enabled: bool, running: bool, inflight: number }
  // - enabled=false when MONITORING_ENABLED=0 (kill switch tripped)
  // - running=false but enabled=true is the alert condition: feature is on
  //   but the scheduler crashed or never started.
  const status = getMonitoringSchedulerStatus();
  const monitoring = MONITORING_ENABLED
    ? {
        enabled: true,
        running: status?.running ?? false,
        inflight: status?.inflight ?? 0,
      }
    : { enabled: false, running: false, inflight: 0 };
  return c.json({
    status: "ok",
    service: "Legal Dashboard API",
    monitoring,
  });
}

app.route("/api/rnpm", rnpmRouter);
app.route("/api/dosare", dosareRouter);
app.route("/api/termene", termeneRouter);
app.route("/api/ai", aiRouter);
app.route("/api/v1/ai-usage", aiUsageRouter);
app.route("/api/v1/auth", authRouter);
// PR-8: current-user profile (always mounted) + admin surface (gated by
// requireRole('admin') inside the router so non-admins get 403, not 404).
app.route("/api/v1/me", meRouter);
app.route("/api/v1/admin", adminRouter);
// PR-A (v2.7.0): dashboard summary aggregation endpoint pentru KPI strip.
// Owner-scoped, wrapped in withMaintenanceRead pentru a coexista cu backup/restore.
app.route("/api/v1/dashboard", dashboardRouter);

// Monitoring (routes + scheduler) is default-ON since PR-4 C6: desktop users
// get the feature "for free" on upgrade. The kill switch MONITORING_ENABLED=0
// stays as the ops escape hatch — flip it to take the feature dark without a
// redeploy if an incident requires it. Path is `/api/v1/...` to mark the start
// of the versioned API surface; legacy non-versioned routes above remain
// stable until PR-6 standardizes everything via @hono/zod-openapi.
const MONITORING_ENABLED = process.env.MONITORING_ENABLED !== "0";
let monitoringScheduler: Scheduler | null = null;
if (MONITORING_ENABLED) {
  app.route("/api/v1/monitoring", monitoringRouter);
  app.route("/api/v1/name-lists", nameListsRouter);
  app.route("/api/v1/alerts", alertsRouter);
  console.log("[monitoring] routes mounted at /api/v1/monitoring");
  console.log("[monitoring] name-lists routes mounted at /api/v1/name-lists");
  console.log("[monitoring] alerts routes mounted at /api/v1/alerts");
}

// Serve frontend static files in production
if (process.env.NODE_ENV === "production") {
  mountStaticFrontend(app, path.join(__curdir, "..", "dist-frontend"));
}

const port = Number(process.env.LEGAL_DASHBOARD_PORT) || 3002;
// SECURITY: bind to loopback unless LEGAL_DASHBOARD_ALLOW_REMOTE=1 is set explicitly.
// Without that opt-in, any HOST value other than loopback is rejected — prevents
// accidental LAN exposure via a stray `HOST=0.0.0.0` in a shell session.
const rawHost = process.env.HOST || "127.0.0.1";
const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
let hostname = rawHost;
if (!loopback.has(rawHost) && process.env.LEGAL_DASHBOARD_ALLOW_REMOTE !== "1") {
  console.warn(`[security] HOST=${rawHost} ignored; set LEGAL_DASHBOARD_ALLOW_REMOTE=1 to opt in.`);
  hostname = "127.0.0.1";
}

// F2 (audit 2026-04-30): cand userul a optat explicit pentru bind non-loopback
// (LEGAL_DASHBOARD_ALLOW_REMOTE=1) sau cand HOST configurat ramane non-loopback
// dupa block-ul de mai sus, refuzam boot pana cand operatorul confirma in mod
// explicit, prin LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet, ca a
// inteles ca toate API-urile sunt expuse fara auth pana la PR-9. "WARNING in
// log" e prea usor de scrolled-past — un crash la boot, in schimb, forteaza o
// decizie. Cand ack-ul e prezent, banner-ul ramane (audit trail).
const REMOTE_BIND_ACTIVE =
  process.env.LEGAL_DASHBOARD_ALLOW_REMOTE === "1" || !loopback.has(hostname);
if (REMOTE_BIND_ACTIVE) {
  // PR-9 fix B1: remote bind FARA auth web e refuz pentru ca toti clientii LAN
  // ar aparea ca shared `local` (audit trail inutil, ownership leak). Singurul
  // mod sanatos sa expui pe LAN e auth_mode=web cu JWT secret real.
  const authMode = getAuthMode();
  if (authMode !== "web") {
    fatalBoot(
      "remote bind requires auth_mode=web",
      new Error(
        "LEGAL_DASHBOARD_ALLOW_REMOTE=1 (or non-loopback HOST) este setat dar " +
          `LEGAL_DASHBOARD_AUTH_MODE='${authMode}'. Remote bind cere ` +
          "LEGAL_DASHBOARD_AUTH_MODE=web + LEGAL_DASHBOARD_JWT_SECRET valid. " +
          "Pentru desktop local, lasa hostname pe loopback (127.0.0.1).",
      ),
    );
  }

  const ack = process.env.LEGAL_DASHBOARD_ACK_NO_AUTH;
  if (ack !== "i-understand-no-auth-yet") {
    fatalBoot(
      "remote bind without auth ack",
      new Error(
        "LEGAL_DASHBOARD_ALLOW_REMOTE=1 (or non-loopback HOST) is set but " +
          "LEGAL_DASHBOARD_ACK_NO_AUTH != 'i-understand-no-auth-yet'. " +
          "Remote bind ramane opt-in explicit pana la SSO/deploy final; setati " +
          "LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet ca sa " +
          "confirmati ca intelegeti riscul, sau lasati hostname pe loopback.",
      ),
    );
  }
  console.warn("====================================================================");
  console.warn("WARNING: Legal Dashboard ruleaza pe interfata non-loopback.");
  console.warn(`Auth mode: ${authMode} (JWT validation activ).`);
  console.warn("Toate API-urile sunt accesibile oricarui client cu token valid.");
  console.warn(`Ack acceptat: LEGAL_DASHBOARD_ACK_NO_AUTH=${ack}`);
  console.warn("====================================================================");
}

// v2.19.1 — desktop admin auto-promote. Utilizatorul `local` e singurul user
// in desktop mode. Migration 0002 il seed-uieste cu role=user (default sigur
// pentru web mode multi-tenant), dar pe desktop e contraproductiv:
// `requireRole("admin")` din PR-8 (v2.6.0) blocheaza chiar utilizatorul
// aplicatiei sa-si stearga baza sau sa compacteze (rute admin RNPM /
// monitoring). Promovam idempotent la admin daca rulam in desktop. Web mode
// pastreaza role-urile asa cum sunt (multi-tenant cu provisioning real).
// Pus dupa bind/auth validare ca scenariile de boot esuat sa nu lase scrieri
// in DB (test EBUSY pe Windows in afterEach cleanup).
if (getAuthMode() === "desktop") {
  try {
    const localUser = getUserById("local");
    if (localUser && localUser.role !== "admin") {
      updateUserRole("local", "admin");
      console.log("[boot] desktop mode: promoted local user to admin");
    }
  } catch (e) {
    console.error("[boot] failed to promote local user to admin", e);
  }
}

// Run schema init + descriere migration + prewarm BEFORE binding the port. On
// large DBs, VACUUM/ALTER blocks the event loop for tens of seconds; if serve()
// were already listening we'd serve "ok" /health while real requests starve
// behind the migration. Better: bind only when ready. Electron splash and any
// orchestrator see connection-refused → polled retry, not a misleading 200.
try {
  getAvize({ pageSize: 1 });
  getAvizStats();
} catch (e) {
  // Boot-time DB failure means subsequent requests will fail too. Server mode:
  // exit so the process manager restarts cleanly. Electron in-proc: throw so
  // main.js's `require()` catch path shows a user-visible dialog instead of
  // killing the window silently.
  fatalBoot("schema/prewarm failed", e);
}

// Flip `ready` ONLY when the underlying socket fires `listening`, not on the next
// tick after serve() returns. serve() is sync-returning but listen() is async, so
// without the callback /health would advertise 200 in the gap between return and
// actual port-bind. Worse, EADDRINUSE etc. surface on the server's `error` event
// — without an explicit handler the bind failure becomes an unhandledRejection and
// `ready` would still flip to true.
// Backup recurring (audit 2026-04-29 #7): doar boot-time invocation lasa un
// proces cu uptime de zile fara backup-uri proaspete. Timer-ul ruleaza la 24h;
// `runDailyBackup` are deja freshness guard intern, deci timer-ul nu duplica
// snapshot-uri daca un alt proces a creat unul recent.
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let backupInterval: NodeJS.Timeout | null = null;

const httpServer = serve({ fetch: app.fetch, port, hostname }, () => {
  ready = true;
  // Defer the daily snapshot until the listener is verified up. Same fire-and-forget
  // semantics as before; keeps it off the boot critical path.
  runDailyBackup().catch((e) => console.warn("[backup] top-level:", e));
  backupInterval = setInterval(() => {
    runDailyBackup().catch((e) => console.warn("[backup] periodic:", e));
  }, BACKUP_INTERVAL_MS);
  // unref so a stuck timer doesn't keep Node alive past graceful shutdown.
  backupInterval.unref?.();

  // PR-4: start the scheduler AFTER listen + backup are queued. The scheduler
  // shares the maintenance lock with backup so concurrent ticks pause cleanly
  // for a writer; starting it any earlier would race the schema/prewarm path
  // above.
  if (MONITORING_ENABLED) {
    const dosarSoapRunner = createDosarSoapRunner({ searchDosare: cautareDosare });
    const nameSoapRunner = createNameSoapRunner({ searchDosare: cautareDosare });
    monitoringScheduler = new Scheduler({
      clock: realClock,
      runners: { dosar_soap: dosarSoapRunner, name_soap: nameSoapRunner },
      tickIntervalMs: 60_000,
      claimLimit: 50,
      jitterSecMax: 30,
    });
    setMonitoringScheduler(monitoringScheduler);
    monitoringScheduler.start().catch((e) => {
      console.error("[monitoring] scheduler.start failed:", e);
    });
    console.log("[monitoring] scheduler started (60s tick, claimLimit=50)");
  }

  // v2.13.0: daily report scheduler. Runs at 5min cadence; gates internally on
  // local hour matching DAILY_REPORT_HOUR (default 9). Best-effort on desktop
  // — if the app is closed at the configured hour, the report skips that day.
  // Independent of MONITORING_ENABLED: a user might disable monitoring jobs but
  // still want digests of historical alerts (highly unusual but cheap to allow).
  startDailyReportScheduler();
});
httpServer.on("error", (err: Error) => {
  // Async event: under Electron this becomes uncaughtException → main.js
  // dialog + app.exit(1). Server mode keeps the explicit process exit.
  fatalBoot("HTTP server error", err);
});

// CP-E1: clean DB shutdown on signal or unexpected exit.
// - Server mode: SIGTERM/SIGINT from process manager or Ctrl+C.
// - Electron mode: main.js calls the exported closer on `before-quit` (in-process bundle).
// closeDb() is idempotent (null-guarded in schema.ts).
const SHUTDOWN_DRAIN_MS = 30_000;
let shuttingDown = false;
async function gracefulShutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${reason} — draining HTTP + scheduler + closing SQLite`);

  // Audit 2026-04-29 R1: inchidem socket-ul de listen ca sa nu mai acceptam
  // conexiuni noi, dar pastram conexiunile in-flight pana cand termina (sau
  // pana la timeout-ul de drain). Fara asta, requesturi lung-running (AI/SSE)
  // sunt taiate brutal la SIGTERM.
  const closePromise = new Promise<void>((resolve) => {
    httpServer.close((err) => {
      if (err) console.error("[shutdown] httpServer.close error:", err);
      resolve();
    });
  });
  const drainTimeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      console.warn(`[shutdown] HTTP drain timeout after ${SHUTDOWN_DRAIN_MS}ms — proceeding`);
      resolve();
    }, SHUTDOWN_DRAIN_MS).unref?.();
  });

  // Stop the scheduler in parallel with HTTP drain — both cooperate via the
  // maintenance lock and the abort signal in JobRunner. Order matters only
  // for closeDb() at the end.
  const scheduler = monitoringScheduler;
  monitoringScheduler = null;
  setMonitoringScheduler(null);
  const schedulerStop = scheduler
    ? scheduler.stop().catch((e) => console.error("[shutdown] scheduler.stop failed:", e))
    : Promise.resolve();

  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }

  await Promise.race([Promise.all([closePromise, schedulerStop]), drainTimeout]);

  // v2.10.1 #7: flush queued email dispatches before closing the DB. The
  // dispatcher reads owner_email_settings + writes audit on failure; if the
  // DB is closed first those writes throw under markShuttingDown(). Short
  // timeout — email is best-effort, we don't block shutdown forever.
  try {
    await drainEmailDispatches(5_000);
  } catch (e) {
    console.error("[shutdown] drainEmailDispatches failed:", e);
  }

  // v2.13.0: stop the daily report scheduler and wait for any in-flight tick
  // to settle. Tick reads/writes owner_email_settings + audit_log, same
  // shutdown ordering reasoning as drainEmailDispatches above.
  try {
    await stopDailyReportScheduler();
  } catch (e) {
    console.error("[shutdown] stopDailyReportScheduler failed:", e);
  }

  // markShuttingDown() closes the DB AND latches the open-guard so any
  // microtask-deferred ai_usage write that lost the race against drain
  // throws instead of silently reopening a fresh handle on its way out.
  // Plain closeDb() is fine for tests; production drain wants the latch.
  try { markShuttingDown(); } catch (e) {
    console.error("[shutdown] markShuttingDown failed:", e);
  }
}
process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM").finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT").finally(() => process.exit(0));
});
process.on("beforeExit", () => {
  void gracefulShutdown("beforeExit");
});

// Expose shutdown hook so Electron's `before-quit` can flush WAL without killing the process.
// Uses a globalThis key to survive esbuild's CJS bundle boundary.
(globalThis as unknown as { __legalDashboardShutdown?: () => Promise<void> }).__legalDashboardShutdown =
  () => gracefulShutdown("before-quit");

const APP_VERSION: string = (() => {
  try {
    return (require("../../package.json") as { version: string }).version;
  } catch {
    return "unknown";
  }
})();

console.log("");
console.log(`  Legal Dashboard v${APP_VERSION}`);
console.log(`  Deschide in browser: http://localhost:${port}`);
console.log("");
console.log(`  Server: http://${hostname}:${port}`);
console.log("  Ctrl+C pentru oprire");
console.log("");
