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
dotenv.config({ path: path.join(__curdir, "..", ".env"), override: true });

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

app.use("/api/*", rateLimit);

// Readiness flag: schema migrations + prewarm run before serve(), but if the DB
// is locked by another tool or temporarily inaccessible we keep /health serving
// 503 until ready=true. Container orchestrators / Electron splash poll this.
let ready = false;
app.get("/health", (c) => {
  if (!ready) {
    return c.json({ status: "starting", service: "Legal Dashboard API" }, 503);
  }
  return c.json({ status: "ok", service: "Legal Dashboard API" });
});

app.route("/api/rnpm", rnpmRouter);
app.route("/api/dosare", dosareRouter);
app.route("/api/termene", termeneRouter);
app.route("/api/ai", aiRouter);

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
const httpServer = serve({ fetch: app.fetch, port, hostname }, () => {
  ready = true;
  // Defer the daily snapshot until the listener is verified up. Same fire-and-forget
  // semantics as before; keeps it off the boot critical path.
  runDailyBackup().catch((e) => console.warn("[backup] top-level:", e));
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
let shuttingDown = false;
function gracefulShutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${reason} — closing SQLite`);
  try { closeDb(); } catch (e) {
    console.error("[shutdown] closeDb failed:", e);
  }
}
process.on("SIGTERM", () => { gracefulShutdown("SIGTERM"); process.exit(0); });
process.on("SIGINT", () => { gracefulShutdown("SIGINT"); process.exit(0); });
process.on("beforeExit", () => gracefulShutdown("beforeExit"));

// Expose shutdown hook so Electron's `before-quit` can flush WAL without killing the process.
// Uses a globalThis key to survive esbuild's CJS bundle boundary.
(globalThis as unknown as { __legalDashboardShutdown?: () => void }).__legalDashboardShutdown =
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
