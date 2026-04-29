import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { rnpmRouter } from "./routes/rnpm.ts";
import { dosareRouter } from "./routes/dosare.ts";
import { termeneRouter } from "./routes/termene.ts";
import { aiRouter } from "./routes/ai.ts";
import { rateLimit } from "./middleware/rate-limit.ts";
import { ownerContext } from "./middleware/owner.ts";
import { requestIdContext } from "./middleware/requestId.ts";
import {
  monitoringRouter,
  setMonitoringScheduler,
  getMonitoringSchedulerStatus,
} from "./routes/monitoring.ts";
import { nameListsRouter } from "./routes/nameLists.ts";
import { Scheduler } from "./services/monitoring/scheduler.ts";
import { realClock } from "./services/monitoring/clock.ts";
import { createDosarSoapRunner } from "./services/monitoring/dosarSoapRunner.ts";
import { createNameSoapRunner } from "./services/monitoring/nameSoapRunner.ts";
import { cautareDosare } from "./soap.ts";
import { mountStaticFrontend } from "./middleware/static-frontend.ts";
import { closeDb } from "./db/schema.ts";
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
      allowHeaders: ["Content-Type"],
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

// PR-1 web-readiness seam: populate c.get("ownerId") for every request.
// Desktop and Faza 1 = "local"; PR-9 swaps for JWT-derived user id. Mounted
// before rateLimit so a future per-owner rate-limit can read the variable.
app.use("*", ownerContext);

// PR-3: per-request correlation id, surfaced on /api/v1/* envelope responses
// and on `x-request-id` response header. Must run after ownerContext but
// before any handler that uses recordAudit (audit_log can't see requestId yet,
// but downstream loggers will).
app.use("*", requestIdContext);

app.use("/api/*", rateLimit);

// Readiness flag: schema migrations + prewarm run before serve(), but if the DB
// is locked by another tool or temporarily inaccessible we keep /health serving
// 503 until ready=true. Container orchestrators / Electron splash poll this.
let ready = false;
app.get("/health", (c) => {
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
});

app.route("/api/rnpm", rnpmRouter);
app.route("/api/dosare", dosareRouter);
app.route("/api/termene", termeneRouter);
app.route("/api/ai", aiRouter);

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
  console.log("[monitoring] routes mounted at /api/v1/monitoring");
  console.log("[monitoring] name-lists routes mounted at /api/v1/name-lists");
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
      claimLimit: 25,
      jitterSecMax: 30,
    });
    setMonitoringScheduler(monitoringScheduler);
    monitoringScheduler.start().catch((e) => {
      console.error("[monitoring] scheduler.start failed:", e);
    });
    console.log("[monitoring] scheduler started (60s tick, claimLimit=25)");
  }
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

  try { closeDb(); } catch (e) {
    console.error("[shutdown] closeDb failed:", e);
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
