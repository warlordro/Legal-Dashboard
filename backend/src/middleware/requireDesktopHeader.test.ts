import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { requireDesktopHeader } from "./requireDesktopHeader.ts";

function buildApp(): Hono {
  const app = new Hono();
  app.use("/api/admin/*", requireDesktopHeader);
  app.post("/api/admin/compact", (c) => c.json({ ok: true }));
  app.delete("/api/admin/wipe", (c) => c.json({ ok: true }));
  return app;
}

// Test-urile salveaza si restaureaza variabila de mediu; configurez explicit
// `LEGAL_DASHBOARD_AUTH_MODE` pentru fiecare scenariu.
const ORIG_AUTH_MODE = process.env.LEGAL_DASHBOARD_AUTH_MODE;
const ORIG_APP_MODE = process.env.APP_MODE;

beforeEach(() => {
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_AUTH_MODE");
  Reflect.deleteProperty(process.env, "APP_MODE");
});

afterEach(() => {
  if (ORIG_AUTH_MODE === undefined) Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_AUTH_MODE");
  else process.env.LEGAL_DASHBOARD_AUTH_MODE = ORIG_AUTH_MODE;
  if (ORIG_APP_MODE === undefined) Reflect.deleteProperty(process.env, "APP_MODE");
  else process.env.APP_MODE = ORIG_APP_MODE;
});

describe("requireDesktopHeader — F11-F1 Stage 2", () => {
  it("rejects POST in desktop mode when header lipseste", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const app = buildApp();

    const res = await app.request("/api/admin/compact", { method: "POST" });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({
      data: null,
      error: { code: "desktop_header_required" },
    });
  });

  it("rejects POST in desktop mode when header are valoare gresita", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const app = buildApp();

    const res = await app.request("/api/admin/compact", {
      method: "POST",
      headers: { "x-legal-dashboard-desktop": "0" },
    });

    expect(res.status).toBe(403);
  });

  it("rejects DELETE in desktop mode when header lipseste", async () => {
    // DELETE poate declansa preflight, dar middleware-ul nu face exceptii
    // pe metoda — fail-closed.
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const app = buildApp();

    const res = await app.request("/api/admin/wipe", { method: "DELETE" });

    expect(res.status).toBe(403);
  });

  it("accepts POST in desktop mode cand header e prezent", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const app = buildApp();

    const res = await app.request("/api/admin/compact", {
      method: "POST",
      headers: { "x-legal-dashboard-desktop": "1" },
    });

    expect(res.status).toBe(200);
  });

  it("default auth mode (lipsa env) e desktop — header obligatoriu", async () => {
    // getAuthMode() default e "desktop" cand variabilele lipsesc.
    const app = buildApp();

    const res = await app.request("/api/admin/compact", { method: "POST" });

    expect(res.status).toBe(403);
  });

  it("APP_MODE=desktop are acelasi comportament cu LEGAL_DASHBOARD_AUTH_MODE", async () => {
    process.env.APP_MODE = "desktop";
    const app = buildApp();

    const res = await app.request("/api/admin/compact", { method: "POST" });

    expect(res.status).toBe(403);
  });

  it("passes through in web mode (header nu se aplica)", async () => {
    // In web mode, autentificarea/sesiune SSO gateaza intrarea — middleware-ul
    // nu mai cere headerul desktop.
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    const app = buildApp();

    const res = await app.request("/api/admin/compact", { method: "POST" });

    expect(res.status).toBe(200);
  });

  it("envelope shape complete pe refuz (data: null, error, requestId)", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const app = buildApp();

    const res = await app.request("/api/admin/compact", { method: "POST" });

    const body = await res.json();
    expect(body).toMatchObject({
      data: null,
      error: { code: "desktop_header_required", message: expect.any(String) },
      requestId: expect.any(String),
    });
  });
});
