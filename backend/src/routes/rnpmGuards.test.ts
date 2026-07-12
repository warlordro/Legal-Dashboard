import Database from "better-sqlite3";
import { Hono } from "hono";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/config.ts")>();
  return {
    ...actual,
    getAuthMode: vi.fn(),
  };
});

vi.mock("../db/tenantKeysRepository.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/tenantKeysRepository.ts")>();
  return {
    ...actual,
    getTenantKeys: vi.fn(),
  };
});

import { getAuthMode } from "../auth/config.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { getTenantKeys } from "../db/tenantKeysRepository.ts";
import { withRnpmCaptchaGuards } from "./rnpmGuards.ts";

const mockedGetAuthMode = vi.mocked(getAuthMode);
const mockedGetTenantKeys = vi.mocked(getTenantKeys);

let tmpRoot: string;

function buildApp() {
  const app = new Hono();
  // v2.34.0 P1-4: tenant-branch path needs ownerId + requestId in context
  // because `withRnpmCaptchaGuards` reads them for the captcha quota gate.
  app.use("*", async (c, next) => {
    c.set("ownerId", "test-user");
    c.set("requestId", "req-test");
    await next();
  });
  app.post("/", async (c) => {
    const guard = await withRnpmCaptchaGuards(c);
    if (!guard.ok) return guard.response;
    return c.json({
      ok: true,
      source: guard.source,
      body: guard.body,
      captchaKey: guard.captchaKey,
      captchaProvider: guard.captchaProvider,
      captchaMode: guard.captchaMode,
      fallback2CaptchaKey: guard.fallback2CaptchaKey,
    });
  });
  return app;
}

describe("withRnpmCaptchaGuards", () => {
  beforeEach(async () => {
    // v2.34.0 P1-4: the tenant-branch captcha quota gate touches the DB, so
    // every test gets an isolated SQLite file with migrations applied.
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-guards-"));
    process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
    const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
    seed.close();
    getDb();
    // biome-ignore lint/performance/noDelete: env must be truly unset, not undefined.
    delete process.env.LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA;
    mockedGetAuthMode.mockReturnValue("desktop");
    mockedGetTenantKeys.mockReturnValue({
      anthropic: "",
      openai: "",
      google: "",
      openrouter: "",
      twocaptcha: "",
      capsolver: "",
      captchaProvider: "2captcha",
      captchaMode: "sequential",
      updatedAt: "2026-05-19T00:00:00Z",
      updatedBy: null,
    });
  });

  afterEach(async () => {
    closeDb();
    // biome-ignore lint/performance/noDelete: env must be truly unset.
    delete process.env.LEGAL_DASHBOARD_DB_PATH;
    // biome-ignore lint/performance/noDelete: env must be truly unset.
    delete process.env.LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA;
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returneaza 501 in web mode cand tenantul nu are cheia captcha configurata", async () => {
    mockedGetAuthMode.mockReturnValue("web");

    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captchaKey: "f".repeat(32) }),
    });

    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({
      data: null,
      error: { code: "CAPTCHA_NOT_CONFIGURED" },
    });
  });

  it("in web mode ignora captchaKey din body si foloseste cheia tenantului", async () => {
    mockedGetAuthMode.mockReturnValue("web");
    mockedGetTenantKeys.mockReturnValue({
      anthropic: "",
      openai: "",
      google: "",
      openrouter: "",
      twocaptcha: "",
      capsolver: "tenant-capsolver-key",
      captchaProvider: "capsolver",
      captchaMode: "race",
      updatedAt: "2026-05-19T00:00:00Z",
      updatedBy: "admin",
    });

    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captchaKey: "body-key-should-not-win", type: "ipoteci" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      body: { captchaKey: "body-key-should-not-win", type: "ipoteci" },
      captchaKey: "tenant-capsolver-key",
      captchaProvider: "capsolver",
      captchaMode: "race",
    });
  });

  it("respinge body JSON invalid cu 400", async () => {
    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json{",
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_JSON" },
    });
  });

  it("respinge captchaKey prea scurt cu 400", async () => {
    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captchaKey: "short" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_CAPTCHA_KEY" },
    });
  });

  it("respinge captchaKey lipsa din body cu 400", async () => {
    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_CAPTCHA_KEY" },
    });
  });

  it("trece in desktop mode cu captchaKey valid", async () => {
    const captchaKey = "f".repeat(32);

    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captchaKey, type: "ipoteci" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      source: "body",
      body: { captchaKey, type: "ipoteci" },
      captchaKey,
    });
  });

  it("in web mode propaga tripletul (key, provider, mode) ca 2captcha sequential cu source tenant", async () => {
    mockedGetAuthMode.mockReturnValue("web");
    mockedGetTenantKeys.mockReturnValue({
      anthropic: "",
      openai: "",
      google: "",
      openrouter: "",
      twocaptcha: "tenant-2captcha-key",
      capsolver: "",
      captchaProvider: "2captcha",
      captchaMode: "sequential",
      updatedAt: "2026-05-19T00:00:00Z",
      updatedBy: "admin",
    });

    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      source: "tenant",
      captchaKey: "tenant-2captcha-key",
      captchaProvider: "2captcha",
      captchaMode: "sequential",
    });
  });

  it("in web mode cu ambele chei salvate propaga cheia celuilalt provider ca fallback2CaptchaKey", async () => {
    mockedGetAuthMode.mockReturnValue("web");
    mockedGetTenantKeys.mockReturnValue({
      anthropic: "",
      openai: "",
      google: "",
      openrouter: "",
      twocaptcha: "tenant-2captcha-key",
      capsolver: "tenant-capsolver-key",
      captchaProvider: "capsolver",
      captchaMode: "race",
      updatedAt: "2026-05-19T00:00:00Z",
      updatedBy: "admin",
    });

    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      source: "tenant",
      captchaKey: "tenant-capsolver-key",
      captchaProvider: "capsolver",
      captchaMode: "race",
      fallback2CaptchaKey: "tenant-2captcha-key",
    });
  });

  it("in web mode cu provider 2captcha si capsolver salvat, fallback-ul e cheia capsolver", async () => {
    mockedGetAuthMode.mockReturnValue("web");
    mockedGetTenantKeys.mockReturnValue({
      anthropic: "",
      openai: "",
      google: "",
      openrouter: "",
      twocaptcha: "tenant-2captcha-key",
      capsolver: "tenant-capsolver-key",
      captchaProvider: "2captcha",
      captchaMode: "sequential",
      updatedAt: "2026-05-19T00:00:00Z",
      updatedBy: "admin",
    });

    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      source: "tenant",
      captchaKey: "tenant-2captcha-key",
      captchaProvider: "2captcha",
      captchaMode: "sequential",
      fallback2CaptchaKey: "tenant-capsolver-key",
    });
  });

  it("in web mode cu o singura cheie salvata fallback2CaptchaKey ramane absent", async () => {
    mockedGetAuthMode.mockReturnValue("web");
    mockedGetTenantKeys.mockReturnValue({
      anthropic: "",
      openai: "",
      google: "",
      openrouter: "",
      twocaptcha: "",
      capsolver: "tenant-capsolver-key",
      captchaProvider: "capsolver",
      captchaMode: "race",
      updatedAt: "2026-05-19T00:00:00Z",
      updatedBy: "admin",
    });

    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci" }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ ok: true, source: "tenant", captchaKey: "tenant-capsolver-key" });
    expect(json.fallback2CaptchaKey).toBeUndefined();
  });

  it("in web mode body.captchaKey ramane in body dar declanseaza un warning structurat", async () => {
    mockedGetAuthMode.mockReturnValue("web");
    mockedGetTenantKeys.mockReturnValue({
      anthropic: "",
      openai: "",
      google: "",
      openrouter: "",
      twocaptcha: "tenant-2captcha-key",
      capsolver: "",
      captchaProvider: "2captcha",
      captchaMode: "sequential",
      updatedAt: "2026-05-19T00:00:00Z",
      updatedBy: "admin",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captchaKey: "leaked-body-key" }),
    });

    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls[0]?.[0];
    expect(typeof msg).toBe("string");
    expect(String(msg)).not.toContain("leaked-body-key");
    expect(String(msg)).toContain("body.captchaKey ignored");
    warnSpy.mockRestore();
  });
});
