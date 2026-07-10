import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { rnpmRouter } from "./routes/rnpm.ts";
import { dosareExportRouter, dosareRouter } from "./routes/dosare.ts";
import { dosareIccjRouter, termeneIccjRouter } from "./routes/dosareIccj.ts";
import { termeneExportRouter, termeneRouter } from "./routes/termene.ts";
import { aiRouter } from "./routes/ai.ts";
import { preAuthRateLimit, rateLimit, startRateLimitSweeper, stopRateLimitSweeper } from "./middleware/rate-limit.ts";
import { originGuard } from "./middleware/originGuard.ts";
import { ownerContext } from "./middleware/owner.ts";
import { patCapabilityGate } from "./middleware/patCapabilityGate.ts";
import { patSecurity } from "./middleware/patSecurity.ts";
import { patUsageAudit } from "./middleware/patUsageAudit.ts";
import { apiTokensRouter } from "./routes/apiTokens.ts";
import { openapiRouter } from "./routes/openapi.ts";
import { getAuthMode, validateAuthConfig } from "./auth/config.ts";
import { getUserById, updateUserRole } from "./db/userRepository.ts";
import { requestIdContext } from "./middleware/requestId.ts";
import { monitoringRouter, setMonitoringScheduler, getMonitoringSchedulerStatus } from "./routes/monitoring.ts";
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
import { createIccjRunner } from "./services/monitoring/iccjRunner.ts";
import { fetchIccjDetail, searchIccj } from "./services/iccj/iccjClient.ts";
import { makeIccjFetchCurrentDosar } from "./services/monitoring/iccjFetchCurrent.ts";
import { drainEmailDispatches } from "./services/email/alertEmailDispatcher.ts";
import { isMailerConfigured, readMailerConfig } from "./services/email/mailer.ts";
import { startDailyReportScheduler, stopDailyReportScheduler } from "./services/email/dailyReportScheduler.ts";
import { fetchEcbDailyRates } from "./services/fxFetcher.ts";
import { selectPendingEmailRetries } from "./db/budgetNotificationsRepository.ts";
import { checkBudgetWarningRetry } from "./services/budgetWarningService.ts";
import { purgeExpiredReservations } from "./db/aiUsageRepository.ts";
import { purgeExpiredJti } from "./db/jwtDenylistRepository.ts";
import { cautareDosare } from "./soap.ts";
import { mountStaticFrontend } from "./middleware/static-frontend.ts";
import { getDbPath, markShuttingDown, preMigrationBackup } from "./db/schema.ts";
import { markRnpmShuttingDown } from "./db/rnpmDb.ts";
import { runRnpmSplitIfNeeded } from "./db/rnpmSplitter.ts";
import { recordAudit } from "./db/auditRepository.ts";
import { acquireInstanceLock, flushPendingReclaimAudit, releaseInstanceLock } from "./db/instanceLock.ts";
import { getAvize, getAvizStats } from "./db/avizRepository.ts";
import { runDailyBackup, waitForBackupToSettle } from "./db/backup.ts";
import { ErrorCodes, fail } from "./util/envelope.ts";
import { appErrorHandler } from "./util/appErrorHandler.ts";
import { adminBackupsRouter } from "./routes/adminBackups.ts";
import { decryptKey, encryptKey, getMasterKey } from "./util/tenantKeyCrypto.ts";
import { findUnsupportedTrustedCidrEntries } from "./util/proxyIp.ts";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

// __dirname is provided by:
//   - CJS bundle (esbuild output in production)
//   - Node --experimental-strip-types running .ts directly under CommonJS
// In ESM dev we fall back to import.meta.url. For the CJS bundle, scripts/build.js
// passes --define:import.meta.url="\"\"" so esbuild replaces the token at compile
// time — no empty-import-meta warning, and the branch is dead anyway (__dirname is
// defined) so the empty string is never used.
const __curdir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION: string = (() => {
  try {
    return (require("../../package.json") as { version: string }).version;
  } catch {
    return "unknown";
  }
})();
// Audit 2026-04-29 R3: in productie nu suprascriem env-ul oferit de orchestrator
// (Docker / systemd / Kubernetes secrets). `.env` din imagine ramane fallback,
// dar nu poate sterge un secret injectat la runtime.
dotenv.config({
  path: path.join(__curdir, "..", ".env"),
  override: process.env.NODE_ENV !== "production",
});

const app = new Hono();

// v2.43.0 (rnpm-split): mapare centrala a erorilor de concurenta RNPM la 409.
app.onError(appErrorHandler);

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
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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

  // v2.20.8 — Batch 2.2: timestamped backup inainte de exit/throw, ca
  // operatorul sa aiba copia DB-ului in starea exacta in care boot-ul a esuat.
  // Cazul tipic: schema/prewarm failure dupa o migrare partiala; fara backup
  // aici, prima incercare de fix din partea operatorului poate suprascrie WAL-ul
  // si pierde evidenta pentru post-mortem. Best-effort — daca backup-ul esueaza
  // (disk full, permisiuni), log si continuam la exit ca sa nu mascam reason-ul
  // original. Label "schema-upgrade" pastreaza convenția pre-existenta in dir-ul
  // backups/, asa ca cleanup-ul/grouping-ul existent continua sa functioneze.
  try {
    const dbPath = getDbPath();
    if (fs.existsSync(dbPath)) {
      preMigrationBackup(dbPath, "schema-upgrade");
    }
  } catch (backupErr) {
    console.warn(
      "[boot] fatalBoot backup failed (continuing):",
      backupErr instanceof Error ? backupErr.message : backupErr
    );
  }

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
  acquireInstanceLock(path.dirname(getDbPath()), APP_VERSION);
} catch (e) {
  fatalBoot("instance lock failed", e);
}

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
      missing.length === 0 &&
      port !== undefined &&
      !(Number.isFinite(Number(port)) && Number(port) >= 1 && Number(port) <= 65535);
    console.warn(
      `[email] SMTP partial config detected — mailer disabled. Set: ${presentVars.join(", ")}` +
        (missing.length > 0 ? `; missing: ${missing.join(", ")}` : "") +
        (portInvalid ? `; SMTP_PORT="${port}" out of range 1..65535` : "")
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
//
// F15 audit hardening (v2.28.4): /health expune **minim** (status + service)
// pentru probe externe / load balancer / Electron splash. Detaliile
// operationale (authMode, monitoring scheduler state, emailConfigured) leakuiau
// telemetry intern catre orice client neautentificat in mod web. Mutate la
// `/health/detail`, accesibil:
//   - de pe loopback (desktop in-proc + container-internal probes), sau
//   - cu rol `admin` (web cutover: ops loggat).
// Restul publicului primeste 403 fara informatii operationale.
app.get("/health", publicHealthHandler);
app.get("/health/detail", detailedHealthHandler);

// PR-9 fix B2: pre-auth IP-only rate limiter pe /api/* (cheap, no DB).
// Floods cu token missing/invalid se opresc inainte sa loveasca ownerContext.
app.use("/api/*", preAuthRateLimit);

// PR-1 web-readiness seam: populate c.get("ownerId") for every request.
// Desktop remains "local"; PR-9 web mode swaps for JWT-derived user id and
// fails closed for API calls.
app.use("*", ownerContext);

// PAT (piesa A) — suprafata montata DOAR in web mode (desktop ZERO impact). Ordinea e
// INTERLEAVED cu rateLimit + originGuard (globale) ca sa fie corecta la nivel de securitate
// (review-panel runda 4):
//   patUsageAudit (outermost) -> auditeaza ORICE raspuns PAT, inclusiv 426/403/429.
//   patSecurity   -> no-store + HTTPS-only (426).
//   rateLimit     -> per-token + per-owner INAINTE de gate: bucketul per-token numara si
//                    cererile forbidden (un token scurs nu poate spama rute forbidden nelimitat);
//                    openapi devine si el rate-limited.
//   openapi(ruta) -> discovery terminal, INAINTE de gate (reachable de un PAT).
//   patCapabilityGate -> default-deny.
//   originGuard   -> CSRF pe mutatii (global).
//   apiTokensRouter -> DUPA originGuard: mutatiile de tokenuri (create/revoke/revoke-all) sunt
//                    Origin-checked pentru sesiuni; gate-ul deja a respins PAT-urile mai sus.
if (getAuthMode() === "web") {
  app.use("/api/*", patUsageAudit);
  app.use("/api/*", patSecurity);
}

app.use("/api/*", rateLimit);

if (getAuthMode() === "web") {
  app.route("/api/v1/openapi.json", openapiRouter);
  app.use("/api/*", patCapabilityGate);
}

// F2 audit hardening (2026-04-30): CSRF defense on state-changing routes when
// the backend is bound to a non-loopback interface. Mounted unconditionally —
// the middleware itself short-circuits for safe methods + loopback peers, so
// the desktop loopback path stays unchanged. Host/Origin parsing happens only
// for cross-LAN POST/PUT/PATCH/DELETE.
app.use("/api/*", originGuard);

// Bug 1a (v2.42.2): plasa globala 1MB pe /api/*, montata inainte de TOATE
// routerele — POST /api/v1/tokens facea await c.req.json() fara nicio limita
// (orice sesiune autentificata putea bufera sute de MB in procesul partajat).
// Rutele cu payload mare legitim raman guvernate de limitele lor per-ruta
// (25MB export xlsx dosare/termene, 10/15MB name-lists) prin exceptii
// exact-match: bodyLimit din Hono intoarce 413 pe Content-Length fara sa
// apeleze next(), deci plasa montata fara exceptii le-ar umbri (regresia
// v2.42.1 de pe GitHub, Bug 1b — nu o reproduce).
const GLOBAL_BODY_LIMIT = 1024 * 1024;
// Audit advers 2026-07-09: rutele exceptate NU trec cu next() gol — primesc un
// plafon exterior de 25MB (cel mai mare cap per-ruta existent), astfel incat
// limitele lor proprii raman defense-in-depth, nu singura aparare: un refactor
// care ar scapa un bodyLimit per-ruta nu reintroduce buffering nelimitat.
const LARGE_BODY_CEILING = 25 * 1024 * 1024;
const LARGE_BODY_ROUTES = new Set([
  "/api/v1/dosare/export.xlsx",
  "/api/v1/termene/export.xlsx",
  "/api/v1/name-lists",
  "/api/v1/name-lists/preview",
  "/api/v1/name-lists/commit",
]);
const globalBodyLimit = bodyLimit({
  maxSize: GLOBAL_BODY_LIMIT,
  onError: (c) => c.json(fail(ErrorCodes.PAYLOAD_TOO_LARGE, "Payload prea mare", c), 413),
});
const largeBodyCeiling = bodyLimit({
  maxSize: LARGE_BODY_CEILING,
  onError: (c) => c.json(fail(ErrorCodes.PAYLOAD_TOO_LARGE, "Payload prea mare", c), 413),
});
app.use("/api/*", (c, next) =>
  LARGE_BODY_ROUTES.has(c.req.path) ? largeBodyCeiling(c, next) : globalBodyLimit(c, next)
);

// Token-management DUPA originGuard (CSRF) + rateLimit. Gate-ul de mai sus deja respinge
// PAT-urile pe /api/v1/tokens (PAT_CANNOT_MANAGE_TOKENS), deci sesiunile ajung aici Origin-checked.
if (getAuthMode() === "web") {
  app.route("/api/v1/tokens", apiTokensRouter);
}

// Readiness flag: schema migrations + prewarm run before serve(), but if the DB
// is locked by another tool or temporarily inaccessible we keep /health serving
// 503 until ready=true. Container orchestrators / Electron splash poll this.
let ready = false;

const HEALTH_LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// F15 audit hardening (v2.28.4): /health public expune doar `status` +
// `service`. Probele externe (LB, container orchestrator) au tot ce le trebuie:
// 200=ok, 503=starting. Telemetry-ul operational (authMode, monitoring,
// emailConfigured) e disponibil pe `/health/detail` filtrat prin loopback.
function publicHealthHandler(c: Context): Response {
  if (!ready) {
    return c.json({ status: "starting", service: "Legal Dashboard API" }, 503);
  }
  // Bug 9 (v2.42.1): health-check-ul de boot din Electron verifica un nonce
  // generat de main process (protectie port-squat: un alt proces care a ocupat
  // portul nu poate ghici nonce-ul). Campul e emis DOAR cand env-ul e setat de
  // main inainte de require-ul backend-ului in-proc; in web mode e omis
  // neconditionat (audit advers 2026-07-09) — un env setat accidental pe un
  // deployment web nu ajunge pe endpoint-ul public.
  const bootNonce = getAuthMode() !== "web" ? process.env.LEGAL_DASHBOARD_BOOT_NONCE : undefined;
  return c.json({ status: "ok", service: "Legal Dashboard API", ...(bootNonce ? { bootNonce } : {}) });
}

function isLoopbackPeer(c: Context): boolean {
  try {
    const remoteAddr = getConnInfo(c).remote.address ?? "";
    return HEALTH_LOOPBACK_ADDRESSES.has(remoteAddr);
  } catch {
    // getConnInfo may throw in test harnesses without a real socket — treat as
    // non-loopback so the gate stays closed by default.
    return false;
  }
}

function detailedHealthHandler(c: Context): Response {
  if (!ready) {
    return c.json({ status: "starting", service: "Legal Dashboard API" }, 503);
  }
  // Bug 5 (v2.42.1): in web mode gate-ul de loopback nu e suficient — un
  // reverse proxy pe acelasi host (Caddy, oauth2-proxy) atinge ruta ca
  // "loopback" si ar expune telemetrie operationala (authMode, monitoring,
  // emailConfigured) oricarui client neautentificat. Ops in web mode
  // foloseste /health (liveness 200/503); un endpoint admin-only pentru
  // telemetrie (ex. /api/v1/admin/health) e follow-up — vezi triajul F04 din
  // planul 2026-07-09.
  if (getAuthMode() === "web") {
    return c.json({ error: { code: "forbidden", message: "not available in web mode" } }, 403);
  }
  // Loopback gate: desktop in-proc (Electron renderer pe 127.0.0.1) si probele
  // container-internal pot accesa fara auth; orice apel cross-LAN intoarce 403
  // fara informatii operationale.
  if (!isLoopbackPeer(c)) {
    return c.json({ error: { code: "forbidden", message: "loopback required" } }, 403);
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
  // v2.20.8: expune `emailConfigured` la /health/detail ca operatorii sa stie
  // din probe-uri externe (curl /health/detail, Electron splash, monitoring
  // extern) daca canalul SMTP e activ. Deriva din readMailerConfig() — true
  // daca toate SMTP_* sunt setate si SMTP_PORT e in range; false in rest.
  // Matchuieste exact ce vede dispatcher-ul real (isMailerConfigured
  // re-evalueaza la fel).
  const emailConfigured = isMailerConfigured();
  return c.json({
    status: "ok",
    service: "Legal Dashboard API",
    authMode: getAuthMode(),
    loginAvailable: false,
    monitoring,
    emailConfigured,
  });
}

app.route("/api/rnpm", rnpmRouter);
app.route("/api/dosare", dosareRouter);
app.route("/api/dosare-iccj", dosareIccjRouter);
app.route("/api/termene", termeneRouter);
app.route("/api/termene-iccj", termeneIccjRouter);
app.route("/api/v1/dosare", dosareExportRouter);
app.route("/api/v1/termene", termeneExportRouter);
app.route("/api/ai", aiRouter);
app.route("/api/v1/ai", aiRouter);
app.route("/api/v1/ai-usage", aiUsageRouter);
app.route("/api/v1/auth", authRouter);
// PR-8: current-user profile (always mounted) + admin surface (gated by
// requireRole('admin') inside the router so non-admins get 403, not 404).
app.route("/api/v1/me", meRouter);
app.route("/api/v1/admin/backups", adminBackupsRouter);
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

// F2 (audit 2026-04-30) + PR-9 fix B1: remote bind cere auth_mode=web cu JWT
// valid (fatal mai jos). Gate-ul istoric LEGAL_DASHBOARD_ACK_NO_AUTH a fost
// eliminat in v2.38.0 — era redundant cu cerinta de web auth si numele lui
// ("no-auth-yet") nu mai reflecta realitatea. Banner-ul ramane (audit trail).
const REMOTE_BIND_ACTIVE = process.env.LEGAL_DASHBOARD_ALLOW_REMOTE === "1" || !loopback.has(hostname);
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
          "Pentru desktop local, lasa hostname pe loopback (127.0.0.1)."
      )
    );
  }

  console.warn("====================================================================");
  console.warn("WARNING: Legal Dashboard ruleaza pe interfata non-loopback.");
  console.warn(`Auth mode: ${authMode} (JWT validation activ).`);
  console.warn("Toate API-urile sunt accesibile oricarui client cu token valid.");
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

// v2.43.0 (rnpm-split): splitter-ul one-time ruleaza DUPA toate gate-urile
// fatale de configuratie (instance lock, auth config, remote bind) si INAINTE
// de prewarm/scheduler/serve — prewarm-ul de mai jos deschide deja fisiere
// per-user prin getRnpmDb, deci datele trebuie mutate intai. Fail-closed:
// orice esec de split opreste boot-ul (monolitul ramane sursa de adevar).
try {
  const splitResult = runRnpmSplitIfNeeded({ appVersion: APP_VERSION });
  if (splitResult.split) console.log(`[boot] rnpm split complet: ${splitResult.owners.length} owneri`);
} catch (e) {
  fatalBoot("rnpm split failed", e);
}

// Run schema init + descriere migration + prewarm BEFORE binding the port. On
// large DBs, VACUUM/ALTER blocks the event loop for tens of seconds; if serve()
// were already listening we'd serve "ok" /health while real requests starve
// behind the migration. Better: bind only when ready. Electron splash and any
// orchestrator see connection-refused → polled retry, not a misleading 200.
try {
  // Boot prewarm: ownerId-ul nu conteaza functional (rezultatul nu e folosit),
  // dar F2 cere ca apelul sa il primeasca explicit; trecem `"local"` pentru
  // simetrie cu desktop adapter — singura cale prin care porneste codul azi.
  getAvize({ ownerId: "local", pageSize: 1 });
  flushPendingReclaimAudit();
  // Bug 6 (v2.42.1): ownerId e acum obligatoriu in repository — prewarm-ul de
  // boot (desktop-only path) il paseaza explicit.
  getAvizStats("local");
  if (getAuthMode() === "web") {
    getMasterKey();
    // Round-trip probe: encrypt + decrypt a non-secret sentinel so a
    // misconfigured master key (length-32 but wrong, mid-rotation drift, or a
    // crypto polyfill regression) fails BOOT instead of failing the first real
    // admin /keys PUT later. Sentinel is generated per boot — never logs or
    // touches the DB. F1.5 (audit 2026-05-19).
    try {
      const probe = `boot-probe-${Date.now()}`;
      const round = decryptKey(encryptKey(probe));
      if (round !== probe) {
        throw new Error("tenant key crypto round-trip mismatch");
      }
    } catch (probeErr) {
      fatalBoot("tenant key crypto self-test failed", probeErr);
    }
  }
  recordAudit(null, "system.boot", {
    ownerId: null,
    actorId: "system",
    detail: {
      version: APP_VERSION,
      authMode: getAuthMode(),
      hostname,
      port,
      processId: process.pid,
      nodeEnv: process.env.NODE_ENV ?? "unknown",
    },
  });

  // LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR e IPv4-only in parser. Entry-urile IPv6
  // (sau prefixele invalide) sunt acceptate de env loader dar ignorate de
  // cidrContains, ceea ce inseamna ca XFF venit prin proxy IPv6 ar fi tratat ca
  // peer non-trusted si rate-limit key-ul ar flip-ui pe peer la fiecare call.
  // Warn-ul la boot face vizibila configurarea fara efect inainte sa devina
  // incident operational.
  const unsupportedProxyCidrs = findUnsupportedTrustedCidrEntries();
  if (unsupportedProxyCidrs.length > 0) {
    console.warn(
      JSON.stringify({
        action: "proxy.trusted_cidr.unsupported",
        note: "LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR contine entry-uri non-IPv4 / prefix invalid; sunt ignorate de XFF walk.",
        entries: unsupportedProxyCidrs,
        ts: new Date().toISOString(),
      })
    );
  }

  // MEDIUM-2: cand operator-ul opreste runtime validation pe schema RNPM
  // pentru un debug, semnalam explicit la boot + lasam trace in audit log. Fara
  // asta, flipul `RNPM_RUNTIME_VALIDATION_DISABLED=1` ramane silent in
  // operationale si UI continua sa accepte payload-uri nevalidate fara ca
  // auditul sa stie cand a inceput fereastra. Operatorul vede warn-ul in
  // stdout, complianta vede entry-ul dedicat in audit_log.
  if (process.env.RNPM_RUNTIME_VALIDATION_DISABLED === "1") {
    console.warn(
      JSON.stringify({
        action: "rnpm.validation.disabled.boot",
        note: "RNPM runtime validation OFF (fail-open) pentru toate request-urile",
        ts: new Date().toISOString(),
      })
    );
    try {
      recordAudit(null, "rnpm.validation.disabled", {
        ownerId: null,
        actorId: "system",
        detail: { source: "env", flag: "RNPM_RUNTIME_VALIDATION_DISABLED" },
      });
    } catch (err) {
      console.error("[boot] rnpm.validation.disabled audit failed:", err);
    }
  }
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

// v2.32.0 ECB FX refresh: la 6h. ECB publica zilnic 16:00 CET — 4 ferestre/zi
// asigura ca surprindem update-ul indiferent de fusul orar al serverului. La
// boot rulam o data sincron-deferred (fire-and-forget) ca pe primul afisaj EUR
// sa avem fie rate proaspat, fie ultimul cunoscut. D14 fail-closed: la eroare,
// UI afiseaza "EUR indisponibil" in loc sa fabrice un fallback.
const FX_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
let fxRefreshInterval: NodeJS.Timeout | null = null;
let budgetWarningRetryInterval: NodeJS.Timeout | null = null;
// Web-mode quota reservations expire via `purgeExpiredReservations`, normally
// called by the monitoring scheduler (services/monitoring/scheduler.ts:383). In
// deploys that disable monitoring (MONITORING_ENABLED=0 or all kinds disabled),
// orphan reservations from crashed SDK calls would inflate
// sumAiUsageMilliInWindow until the next restart — valid clients receive 429
// against a budget that is actually free. Run an independent timer in web
// mode only; desktop has neither quotas nor reservations.
//
// v2.34.0 P1-purge: interval scazut de la 24h la 60s. Reservation expira la
// 5min (RESERVATION_EXPIRE_SECONDS=300 in aiUsageRepository); cu purge 24h,
// fereastra in care reservations expirate dar nepurjate inflateaza falsa
// utilizare poate ajunge 24h => DoS-by-quota daca un atacator pompeaza
// reservations care expira fara settle. 60s = fereastra max de inflatie.
const RESERVATION_PURGE_INTERVAL_MS = 60_000;
let reservationPurgeInterval: NodeJS.Timeout | null = null;
// Web-mode jwt_denylist purge. `purgeExpiredJti` normally runs inside the
// monitoring scheduler daily loop (scheduler.ts:439). With MONITORING_ENABLED=0
// the scheduler is off, so revoked-JTI rows past expiry are never purged and
// jwt_denylist grows unbounded (rows harmless but accumulate). Run an
// independent daily timer in web mode only, mirroring reservationPurgeInterval.
const JWT_PURGE_INTERVAL_MS = 86_400_000;
let jwtPurgeInterval: NodeJS.Timeout | null = null;

async function refreshFxRatesSafely(label: string): Promise<void> {
  try {
    const result = await fetchEcbDailyRates();
    if (result.ok) {
      console.log(
        JSON.stringify({
          action: "fx.refresh.ok",
          label,
          pair: result.pair,
          rate: result.rate,
          rate_date: result.rateDate,
          ts: new Date().toISOString(),
        })
      );
    } else {
      console.warn(
        JSON.stringify({
          action: "fx.refresh.fail",
          label,
          reason: result.reason,
          observedRate: result.observedRate,
          ts: new Date().toISOString(),
        })
      );
    }
  } catch (err) {
    console.error("[fx] refresh threw", {
      label,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

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

  // v2.32.0: ECB FX refresh — fire-and-forget la boot + recurring every 6h.
  // Non-blocking: D14 fail-closed daca primul fetch esueaza (UI EUR indisponibil).
  refreshFxRatesSafely("boot");
  fxRefreshInterval = setInterval(() => {
    refreshFxRatesSafely("periodic");
  }, FX_REFRESH_INTERVAL_MS);
  fxRefreshInterval.unref?.();

  if (getAuthMode() === "web") {
    budgetWarningRetryInterval = setInterval(() => {
      const pending = selectPendingEmailRetries();
      for (const item of pending) {
        checkBudgetWarningRetry(item.userId, item.feature, item.thresholdPct).catch((err) => {
          console.warn(
            JSON.stringify({
              action: "budget_warning.retry_failed",
              userId: item.userId,
              feature: item.feature,
              error: err instanceof Error ? err.message : String(err),
              ts: new Date().toISOString(),
            })
          );
        });
      }
    }, 120_000);
    budgetWarningRetryInterval.unref?.();

    reservationPurgeInterval = setInterval(() => {
      try {
        const purged = purgeExpiredReservations();
        if (purged > 0) {
          console.log(
            JSON.stringify({
              action: "quota.reservation_purged",
              source: "standalone_interval",
              deleted_count: purged,
              ts: new Date().toISOString(),
            })
          );
        }
      } catch (err) {
        console.warn(
          JSON.stringify({
            action: "quota.reservation_purge_failed",
            error: err instanceof Error ? err.message : String(err),
            ts: new Date().toISOString(),
          })
        );
      }
    }, RESERVATION_PURGE_INTERVAL_MS);
    reservationPurgeInterval.unref?.();

    jwtPurgeInterval = setInterval(() => {
      try {
        const deletedJti = purgeExpiredJti();
        if (deletedJti > 0) {
          console.log(
            JSON.stringify({
              action: "jwt_denylist.purged",
              source: "standalone_interval",
              deleted_count: deletedJti,
              ts: new Date().toISOString(),
            })
          );
        }
      } catch (err) {
        console.error("[jwt] purgeExpiredJti threw, continuing", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, JWT_PURGE_INTERVAL_MS);
    jwtPurgeInterval.unref?.();
  }

  // PR-4: start the scheduler AFTER listen + backup are queued. The scheduler
  // shares the maintenance lock with backup so concurrent ticks pause cleanly
  // for a writer; starting it any earlier would race the schema/prewarm path
  // above.
  if (MONITORING_ENABLED) {
    const dosarSoapRunner = createDosarSoapRunner({ searchDosare: cautareDosare });
    const nameSoapRunner = createNameSoapRunner({ searchDosare: cautareDosare });
    // ICCJ live-proxy runner: search by numar → fetch full detail → diff. A
    // source/parse failure throws (IccjSourceError) and is mapped to an error
    // outcome inside the runner, so a transient upstream issue never writes a
    // false-empty snapshot. A genuine "not found" returns null.
    // v2.37.1: logica e extrasa + testata in services/monitoring/iccjFetchCurrent.ts.
    const iccjRunner = createIccjRunner({
      fetchCurrentDosar: makeIccjFetchCurrentDosar({ searchIccj, fetchIccjDetail }),
    });
    monitoringScheduler = new Scheduler({
      clock: realClock,
      runners: { dosar_soap: dosarSoapRunner, name_soap: nameSoapRunner, iccj: iccjRunner },
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

  // v2.20.8: sweep periodic pe rate-limit buckets. Inline cleanup-ul (size>1000)
  // tot ramane ca safety; tick-ul de 5min ataca buckets idle care altfel ar
  // ramane pana la urmatorul spike. .unref() in startup ca timer-ul sa nu tina
  // procesul viu peste graceful shutdown.
  startRateLimitSweeper();
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
  try {
    recordAudit(null, "system.shutdown", {
      ownerId: null,
      actorId: "system",
      detail: { reason, version: APP_VERSION },
    });
  } catch (err) {
    console.error("[shutdown] system.shutdown audit failed:", err);
  }

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
  if (fxRefreshInterval) {
    clearInterval(fxRefreshInterval);
    fxRefreshInterval = null;
  }
  if (budgetWarningRetryInterval) {
    clearInterval(budgetWarningRetryInterval);
    budgetWarningRetryInterval = null;
  }
  if (reservationPurgeInterval) {
    clearInterval(reservationPurgeInterval);
    reservationPurgeInterval = null;
  }
  if (jwtPurgeInterval) {
    clearInterval(jwtPurgeInterval);
    jwtPurgeInterval = null;
  }

  // v2.20.8: stop rate-limit sweep timer la shutdown. Idempotent (no-op daca
  // sweeper-ul nu a pornit, ex. boot failure inainte de listen).
  stopRateLimitSweeper();

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

  // v2.43.0 (rnpm-split): asteapta backup-ul in curs (daily/manual) cu timeout
  // — un VACUUM INTO intrerupt de close arunca in mijlocul snapshot-ului.
  try {
    await waitForBackupToSettle(10_000);
  } catch (e) {
    console.error("[shutdown] waitForBackupToSettle failed:", e);
  }

  // v2.43.0 (rnpm-split): inchide si latch-uieste registry-ul de fisiere RNPM
  // per user inainte de monolit — aceeasi ratiune de guard ca markShuttingDown.
  try {
    markRnpmShuttingDown();
  } catch (e) {
    console.error("[shutdown] markRnpmShuttingDown failed:", e);
  }

  // markShuttingDown() closes the DB AND latches the open-guard so any
  // microtask-deferred ai_usage write that lost the race against drain
  // throws instead of silently reopening a fresh handle on its way out.
  // Plain closeDb() is fine for tests; production drain wants the latch.
  try {
    markShuttingDown();
  } catch (e) {
    console.error("[shutdown] markShuttingDown failed:", e);
  }
  releaseInstanceLock();
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
(globalThis as unknown as { __legalDashboardShutdown?: () => Promise<void> }).__legalDashboardShutdown = () =>
  gracefulShutdown("before-quit");

console.log("");
console.log(`  Legal Dashboard v${APP_VERSION}`);
console.log(`  Deschide in browser: http://localhost:${port}`);
console.log("");
console.log(`  Server: http://${hostname}:${port}`);
console.log("  Ctrl+C pentru oprire");
console.log("");
