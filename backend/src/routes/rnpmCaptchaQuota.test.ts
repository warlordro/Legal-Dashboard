// rnpmCaptchaQuota — v2.34.0 P1-4. Verifies the captcha quota gate inside
// `withRnpmCaptchaGuards` on the tenant branch (web mode).
//
// Contract under test:
//   - cap NULL (no override, no env)   => pass-through, 1 row recorded per accept
//   - cap N with used < N             => accept, used++ to N
//   - cap N with used >= N            => 429 QUOTA_EXCEEDED + Retry-After + zero new rows
//   - cap 0                            => always blocked
//   - desktop mode (source=body)       => no recording (no cap on BYOK)

import Database from "better-sqlite3";
import { Hono } from "hono";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/config.ts")>();
  return { ...actual, getAuthMode: vi.fn() };
});

vi.mock("../db/tenantKeysRepository.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/tenantKeysRepository.ts")>();
  return { ...actual, getTenantKeys: vi.fn() };
});

import { getAuthMode } from "../auth/config.ts";
import { getTenantKeys } from "../db/tenantKeysRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { upsertOverride } from "../db/userQuotaRepository.ts";
import { withRnpmCaptchaGuards } from "./rnpmGuards.ts";

const mockedGetAuthMode = vi.mocked(getAuthMode);
const mockedGetTenantKeys = vi.mocked(getTenantKeys);

let tmpRoot: string;

const TEST_OWNER = "test-user-uuid";

function buildApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", TEST_OWNER);
    c.set("requestId", "req-test");
    await next();
  });
  app.post("/", async (c) => {
    const guard = await withRnpmCaptchaGuards(c);
    if (!guard.ok) return guard.response;
    return c.json({ ok: true, source: guard.source, captchaKey: guard.captchaKey });
  });
  return app;
}

function tenantWithKey(key: string, provider: "2captcha" | "capsolver" = "2captcha") {
  mockedGetTenantKeys.mockReturnValue({
    anthropic: "",
    openai: "",
    google: "",
    openrouter: "",
    twocaptcha: provider === "2captcha" ? key : "",
    capsolver: provider === "capsolver" ? key : "",
    captchaProvider: provider,
    captchaMode: "sequential",
    updatedAt: "2026-05-19T00:00:00Z",
    updatedBy: "admin",
  });
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-captcha-quota-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  // FK on user_quota_overrides(user_id) -> users(id), so the test user must
  // exist before upsertOverride can write a row.
  getDb()
    .prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)")
    .run(TEST_OWNER, "test@firma.ro", "Test User");
  // biome-ignore lint/performance/noDelete: trebuie unset real ca readDefaultCaptchaQuota sa observe "no default".
  delete process.env.LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA;
  mockedGetAuthMode.mockReturnValue("web");
  tenantWithKey("tenant-key-".padEnd(32, "x"));
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: trebuie unset real, nu undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  // biome-ignore lint/performance/noDelete: idem.
  delete process.env.LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("withRnpmCaptchaGuards captcha quota (P1-4)", () => {
  it("no override and no default env => pass-through, but every accept is recorded", async () => {
    const res1 = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci" }),
    });
    expect(res1.status).toBe(200);
    const res2 = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci" }),
    });
    expect(res2.status).toBe(200);
    const count = (
      getDb().prepare("SELECT COUNT(*) AS n FROM captcha_usage WHERE source = 'tenant'").get() as { n: number }
    ).n;
    expect(count).toBe(2);
  });

  it("override cap 2 => 2 ok, the 3rd request returns 429 QUOTA_EXCEEDED", async () => {
    upsertOverride({
      userId: TEST_OWNER,
      feature: "captcha.rnpm",
      period: "day",
      limitUsdMilli: 2,
      updatedBy: "admin",
    });

    for (let i = 0; i < 2; i += 1) {
      const res = await buildApp().request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "ipoteci" }),
      });
      expect(res.status).toBe(200);
    }

    const blocked = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci" }),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const json = (await blocked.json()) as {
      data: null;
      error: { code: string; details: { used: number; limit: number; period: string; feature: string } };
    };
    expect(json.error.code).toBe("QUOTA_EXCEEDED");
    expect(json.error.details.used).toBe(2);
    expect(json.error.details.limit).toBe(2);
    expect(json.error.details.feature).toBe("captcha.rnpm");

    // Blocked request must NOT add a captcha_usage row.
    const count = (
      getDb().prepare("SELECT COUNT(*) AS n FROM captcha_usage WHERE source = 'tenant'").get() as { n: number }
    ).n;
    expect(count).toBe(2);
  });

  it("override cap 0 => first call already blocked", async () => {
    upsertOverride({
      userId: TEST_OWNER,
      feature: "captcha.rnpm",
      period: "day",
      limitUsdMilli: 0,
      updatedBy: "admin",
    });

    const blocked = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci" }),
    });
    expect(blocked.status).toBe(429);
    const count = (getDb().prepare("SELECT COUNT(*) AS n FROM captcha_usage").get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it("override NULL (unlimited) overrides a non-null default env", async () => {
    process.env.LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA = "1";
    upsertOverride({
      userId: TEST_OWNER,
      feature: "captcha.rnpm",
      period: "day",
      limitUsdMilli: null,
      updatedBy: "admin",
    });

    for (let i = 0; i < 3; i += 1) {
      const res = await buildApp().request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "ipoteci" }),
      });
      expect(res.status).toBe(200);
    }
  });

  it("default env cap 1 (no override) => 1 ok, 2nd blocked", async () => {
    process.env.LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA = "1";

    const ok = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci" }),
    });
    expect(ok.status).toBe(200);

    const blocked = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci" }),
    });
    expect(blocked.status).toBe(429);
    const json = (await blocked.json()) as { error: { details: { source: string } } };
    expect(json.error.details.source).toBe("default");
  });

  it("desktop mode (BYOK source=body) does NOT record captcha_usage", async () => {
    mockedGetAuthMode.mockReturnValue("desktop");
    const captchaKey = "f".repeat(32);

    const res = await buildApp().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captchaKey, type: "ipoteci" }),
    });
    expect(res.status).toBe(200);

    const count = (getDb().prepare("SELECT COUNT(*) AS n FROM captcha_usage").get() as { n: number }).n;
    expect(count).toBe(0);
  });
});
