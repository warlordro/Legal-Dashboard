import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { getTenantKeys } from "../db/tenantKeysRepository.ts";
import { withRnpmCaptchaGuards } from "./rnpmGuards.ts";

const mockedGetAuthMode = vi.mocked(getAuthMode);
const mockedGetTenantKeys = vi.mocked(getTenantKeys);

function buildApp() {
  const app = new Hono();
  app.post("/", async (c) => {
    const guard = await withRnpmCaptchaGuards(c);
    if (!guard.ok) return guard.response;
    return c.json({
      ok: true,
      body: guard.body,
      captchaKey: guard.captchaKey,
      captchaProvider: guard.captchaProvider,
      captchaMode: guard.captchaMode,
    });
  });
  return app;
}

describe("withRnpmCaptchaGuards", () => {
  beforeEach(() => {
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
      body: { captchaKey, type: "ipoteci" },
      captchaKey,
    });
  });
});
