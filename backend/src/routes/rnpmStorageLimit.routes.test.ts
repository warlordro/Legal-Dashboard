import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/rnpmStorageLimit.ts", () => ({
  assertRnpmStorageWithinLimit: vi.fn(),
  measureRnpmStorage: vi.fn(async () => ({ usedBytes: 0, exists: false })),
  RnpmStorageLimitError: class RnpmStorageLimitError extends Error {
    readonly code = "RNPM_STORAGE_LIMIT";
    constructor(
      readonly usedBytes: number,
      readonly limitBytes: number
    ) {
      super(
        "Spatiul RNPM alocat este plin (600.0 MB din 500.0 MB). Sterge avize (stergerea pe selectie elibereaza automat spatiul) sau compacteaza din zona RNPM."
      );
    }
  },
}));

vi.mock("../services/rnpmSearchService.ts", () => ({
  executeSearch: vi.fn(async () => ({
    searchId: 1,
    total: 0,
    pagesTotal: 1,
    pageSize: 25,
    currentPage: 1,
    criteriu: "",
    documents: [],
    avizIds: [],
    detailsFailed: [],
    gcode: "existing",
    nextRnpmPage: null,
    captchasUsed: 0,
  })),
  executeBulkSearch: vi.fn(async () => undefined),
  executeSplitSearch: vi.fn(async () => ({
    searchId: 1,
    documents: [],
    avizIds: [],
    total: 0,
    upstreamTotal: 0,
    criteriu: "",
    pagesTotal: 1,
    pageSize: 25,
    currentPage: 1,
    detailsFailed: [],
    splitStats: [],
    captchasUsed: 0,
  })),
}));

vi.mock("./rnpmGuards.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rnpmGuards.ts")>();
  return { ...actual, withRnpmCaptchaGuards: vi.fn() };
});

import { assertRnpmStorageWithinLimit, RnpmStorageLimitError } from "../db/rnpmStorageLimit.ts";
import { requestIdContext } from "../middleware/requestId.ts";
import { executeSearch } from "../services/rnpmSearchService.ts";
import { appErrorHandler } from "../util/appErrorHandler.ts";
import { rnpmRouter } from "./rnpm.ts";
import { withRnpmCaptchaGuards } from "./rnpmGuards.ts";

const storageGuard = vi.mocked(assertRnpmStorageWithinLimit);
const captchaGuard = vi.mocked(withRnpmCaptchaGuards);
const searchService = vi.mocked(executeSearch);

function buildApp(): Hono {
  const app = new Hono();
  app.use("*", requestIdContext);
  app.use("*", async (c, next) => {
    c.set("ownerId", "u1");
    await next();
  });
  app.route("/api/v1/rnpm", rnpmRouter);
  app.onError(appErrorHandler);
  return app;
}

beforeEach(() => {
  storageGuard.mockReset();
  captchaGuard.mockReset().mockResolvedValue({
    ok: true,
    source: "body",
    body: {},
    captchaKey: "x".repeat(32),
  });
});

describe("limita RNPM ruleaza inainte de captcha", () => {
  it.each([
    ["/search", { type: "ipoteci", params: {}, captchaKey: "x".repeat(32) }],
    ["/bulk", { items: [], captchaKey: "x".repeat(32) }],
    ["/search-split", { type: "ipoteci", baseParams: {}, subTypeLabels: [], captchaKey: "x".repeat(32) }],
  ])("POST %s intoarce 429 fara Retry-After si fara consum captcha", async (route, body) => {
    storageGuard.mockRejectedValueOnce(new RnpmStorageLimitError(600 * 1024 * 1024, 500 * 1024 * 1024));

    const res = await buildApp().request(`/api/v1/rnpm${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(429);
    expect(res.headers.has("Retry-After")).toBe(false);
    await expect(res.json()).resolves.toMatchObject({
      data: null,
      error: { code: "QUOTA_EXCEEDED", message: expect.stringContaining("Sterge avize") },
      requestId: expect.any(String),
    });
    expect(captchaGuard).not.toHaveBeenCalled();
  });

  it("search sub limita continua prin captcha si ajunge la serviciu", async () => {
    captchaGuard.mockResolvedValueOnce({
      ok: true,
      source: "body",
      body: { type: "ipoteci", params: {}, captchaKey: "x".repeat(32) },
      captchaKey: "x".repeat(32),
    });

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci", params: {}, captchaKey: "x".repeat(32) }),
    });

    expect(res.status).toBe(200);
    expect(storageGuard).toHaveBeenCalledWith("u1");
    expect(captchaGuard).toHaveBeenCalledOnce();
  });

  it("recheck-ul din timpul cautarii intoarce 429 cu cifre, nu 500", async () => {
    captchaGuard.mockResolvedValueOnce({
      ok: true,
      source: "body",
      body: { type: "ipoteci", params: {}, captchaKey: "x".repeat(32) },
      captchaKey: "x".repeat(32),
    });
    // Simuleaza depasirea limitei intre paginile interne: recheck-ul din
    // executeSearch arunca eroarea tipata DIN interiorul run-ului (nu din gate).
    searchService.mockRejectedValueOnce(new RnpmStorageLimitError(600 * 1024 * 1024, 500 * 1024 * 1024));

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci", params: {}, captchaKey: "x".repeat(32) }),
    });

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      data: null,
      error: {
        code: "QUOTA_EXCEEDED",
        message: expect.stringContaining("Sterge avize"),
        details: {
          feature: "rnpm.storage",
          usedBytes: 600 * 1024 * 1024,
          limitBytes: 500 * 1024 * 1024,
        },
      },
      requestId: expect.any(String),
    });
  });

  it("paginarea cu gcode existent este exceptata", async () => {
    captchaGuard.mockResolvedValueOnce({
      ok: true,
      source: "body",
      body: { type: "ipoteci", params: {}, gcode: "existing", captchaKey: "x".repeat(32) },
      captchaKey: "x".repeat(32),
    });

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci", params: {}, gcode: "existing", captchaKey: "x".repeat(32) }),
    });

    expect(res.status).toBe(200);
    expect(storageGuard).not.toHaveBeenCalled();
    expect(captchaGuard).toHaveBeenCalledOnce();
  });
});
