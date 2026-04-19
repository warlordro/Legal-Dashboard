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

// CORS - only needed in development
app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://localhost:4173"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.use("/api/*", rateLimit);

app.get("/health", (c) => c.json({ status: "ok", service: "Legal Dashboard API" }));

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

serve({ fetch: app.fetch, port, hostname });

// E: prewarm SQLite page cache so the first /rnpm/saved + /rnpm/stats after launch
// don't pay the cold-disk cost (hot index pages loaded once, reused for every request).
try {
  getAvize({ pageSize: 1 });
  getAvizStats();
} catch (e) {
  console.warn("[prewarm] failed:", e instanceof Error ? e.message : e);
}

// Daily snapshot — skipped if the most recent backup is <24h old, so extra launches
// in the same day don't duplicate work. Keeps the last 7 files.
runDailyBackup().catch((e) => console.warn("[backup] top-level:", e));

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

console.log("");
console.log("  Legal Dashboard v1.0.0");
console.log(`  Deschide in browser: http://localhost:${port}`);
console.log("");
console.log(`  Server: http://${hostname}:${port}`);
console.log("  Ctrl+C pentru oprire");
console.log("");
