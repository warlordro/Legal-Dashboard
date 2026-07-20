import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { requireDesktopHeaderGlobal } from "./requireDesktopHeaderGlobal.ts";

// buildApp monteaza guard-ul global pe /api/*. `withTokenId` simuleaza contextul
// PAT (tokenId setat de patSecurity in web mode) pentru cazul de exemptie.
function buildApp(opts: { withTokenId?: boolean } = {}): Hono {
  const app = new Hono();
  if (opts.withTokenId) {
    app.use("/api/*", async (c, next) => {
      c.set("tokenId", "tok-1");
      await next();
    });
  }
  app.use("/api/*", requireDesktopHeaderGlobal);
  app.post("/api/v1/monitoring/jobs", (c) => c.json({ ok: true }));
  app.post("/api/v1/monitoring/jobs/:id/run", (c) => c.json({ ok: true }));
  app.get("/api/v1/monitoring/alerts/stream", (c) => c.json({ ok: true }));
  return app;
}

const ORIG_AUTH_MODE = process.env.LEGAL_DASHBOARD_AUTH_MODE;
const ORIG_APP_MODE = process.env.APP_MODE;
const ORIG_KILL = process.env.LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING;

beforeEach(() => {
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_AUTH_MODE");
  Reflect.deleteProperty(process.env, "APP_MODE");
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING");
});

afterEach(() => {
  if (ORIG_AUTH_MODE === undefined) Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_AUTH_MODE");
  else process.env.LEGAL_DASHBOARD_AUTH_MODE = ORIG_AUTH_MODE;
  if (ORIG_APP_MODE === undefined) Reflect.deleteProperty(process.env, "APP_MODE");
  else process.env.APP_MODE = ORIG_APP_MODE;
  if (ORIG_KILL === undefined) Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING");
  else process.env.LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING = ORIG_KILL;
});

describe("requireDesktopHeaderGlobal — SEC-01 guard CSRF desktop global", () => {
  it("mutating POST fara header in desktop mode => 403", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const app = buildApp();

    const res = await app.request("/api/v1/monitoring/jobs", { method: "POST" });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({
      data: null,
      error: { code: "desktop_header_required", message: expect.any(String) },
      requestId: expect.any(String),
    });
  });

  it("POST /jobs/:id/run fara header in desktop mode => 403", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const app = buildApp();

    const res = await app.request("/api/v1/monitoring/jobs/42/run", { method: "POST" });

    expect(res.status).toBe(403);
  });

  it("mutating POST cu header valid in desktop mode => 200", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const app = buildApp();

    const res = await app.request("/api/v1/monitoring/jobs", {
      method: "POST",
      headers: { "x-legal-dashboard-desktop": "1" },
    });

    expect(res.status).toBe(200);
  });

  it("SSE GET (metoda non-mutanta) trece fara header => 200", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const app = buildApp();

    const res = await app.request("/api/v1/monitoring/alerts/stream", { method: "GET" });

    expect(res.status).toBe(200);
  });

  it("PAT tokenId setat exempteaza mutatia (defense-in-depth) => 200", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const app = buildApp({ withTokenId: true });

    const res = await app.request("/api/v1/monitoring/jobs", { method: "POST" });

    expect(res.status).toBe(200);
  });

  it("web mode: guard-ul nu se aplica (pass-through) => 200", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    const app = buildApp();

    const res = await app.request("/api/v1/monitoring/jobs", { method: "POST" });

    expect(res.status).toBe(200);
  });
});
