import Database from "better-sqlite3";
import { Hono } from "hono";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestIdContext } from "../middleware/requestId.ts";

vi.mock("../services/rnpmSearchService.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/rnpmSearchService.ts")>();
  return {
    ...actual,
    executeSearch: vi.fn(),
  };
});

vi.mock("../db/tenantKeysRepository.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/tenantKeysRepository.ts")>();
  return {
    ...actual,
    getTenantKeys: vi.fn(),
  };
});

import { closeDb, getDb } from "../db/schema.ts";
import { getTenantKeys } from "../db/tenantKeysRepository.ts";
import { executeSearch } from "../services/rnpmSearchService.ts";
import { rnpmRouter } from "./rnpm.ts";

const mockedGetTenantKeys = vi.mocked(getTenantKeys);
const mockedExecuteSearch = vi.mocked(executeSearch);

let tmpRoot: string;

function buildApp() {
  const app = new Hono();
  app.use("*", requestIdContext);
  // Calea tenant a guard-ului cere ownerId autentificat in context (in web
  // mode getOwnerId arunca daca lipseste) — acelasi setup ca rnpmGuards.test.ts.
  app.use("*", async (c, next) => {
    c.set("ownerId", "test-user");
    await next();
  });
  app.route("/api/v1/rnpm", rnpmRouter);
  return app;
}

const SEARCH_RESULT = {
  searchId: 1,
  total: 0,
  pagesTotal: 0,
  pageSize: 25,
  currentPage: 1,
  criteriu: "",
  documents: [],
  avizIds: [],
  detailsFailed: 0,
  gcode: "g",
  nextRnpmPage: null,
  captchasUsed: 1,
} as unknown as Awaited<ReturnType<typeof executeSearch>>;

describe("POST /search — sursa fallback2CaptchaKey per auth mode", () => {
  beforeEach(async () => {
    // Calea tenant a guard-ului atinge DB-ul (quota captcha + audit), deci
    // fiecare test primeste un SQLite izolat cu migrations aplicate.
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-fallback-"));
    process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
    const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
    seed.close();
    getDb();
    mockedExecuteSearch.mockResolvedValue(SEARCH_RESULT);
  });

  afterEach(async () => {
    closeDb();
    vi.clearAllMocks();
    Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DB_PATH");
    Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_AUTH_MODE");
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  });

  it("in web mode ignora fallback2CaptchaKey din body (nu BYOK prin fallback)", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
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

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "ipoteci",
        params: { creditorPJ: { denumire: "test" } },
        fallback2CaptchaKey: "malicious-body-fallback-key",
      }),
    });

    expect(res.status).toBe(200);
    expect(mockedExecuteSearch).toHaveBeenCalledTimes(1);
    const input = mockedExecuteSearch.mock.calls[0]?.[0];
    expect(input?.captchaKey).toBe("tenant-capsolver-key");
    expect(input?.fallback2CaptchaKey).toBeUndefined();
  });

  it("in desktop mode fallback2CaptchaKey din body ajunge in continuare la executeSearch", async () => {
    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "ipoteci",
        params: { creditorPJ: { denumire: "test" } },
        captchaKey: "0".repeat(32),
        captchaProvider: "capsolver",
        fallback2CaptchaKey: "desktop-fallback-key-12345",
        captchaMode: "race",
      }),
    });

    expect(res.status).toBe(200);
    expect(mockedExecuteSearch).toHaveBeenCalledTimes(1);
    const input = mockedExecuteSearch.mock.calls[0]?.[0];
    expect(input?.captchaKey).toBe("0".repeat(32));
    expect(input?.fallback2CaptchaKey).toBe("desktop-fallback-key-12345");
    expect(input?.captchaMode).toBe("race");
  });
});
