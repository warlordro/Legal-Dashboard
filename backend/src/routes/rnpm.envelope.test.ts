import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestIdContext } from "../middleware/requestId.ts";
import { CaptchaInsufficientFundsError, getCaptchaBalance } from "../services/captchaSolver.ts";
import { RnpmError } from "../services/rnpmClient.ts";
import { executeSearch } from "../services/rnpmSearchService.ts";
import { rnpmRouter } from "./rnpm.ts";

vi.mock("../services/captchaSolver.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/captchaSolver.ts")>();
  return {
    ...actual,
    getCaptchaBalance: vi.fn(),
  };
});

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
    getTenantKeys: vi.fn(() => ({
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
    })),
  };
});

type EnvelopeErrorBody = {
  data: null;
  error: { code: string; message: string; details?: Record<string, unknown> };
  requestId: string;
};

function buildApp() {
  const app = new Hono();
  app.use("*", requestIdContext);
  app.route("/api/v1/rnpm", rnpmRouter);
  return app;
}

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_AUTH_MODE");
});

describe("rnpm envelope sentinel", () => {
  it("bodyTooLarge returneaza PAYLOAD_TOO_LARGE envelope", async () => {
    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(70_000) }),
    });

    expect(res.status).toBe(413);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(body.requestId).toEqual(expect.any(String));
  });

  it("web-mode captcha gate returneaza CAPTCHA_NOT_CONFIGURED envelope", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci", params: {}, captchaKey: "x".repeat(20) }),
    });

    expect(res.status).toBe(501);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("CAPTCHA_NOT_CONFIGURED");
  });

  it("captcha balance cu sold insuficient returneaza 402 INSUFFICIENT_FUNDS", async () => {
    vi.mocked(getCaptchaBalance).mockRejectedValueOnce(new CaptchaInsufficientFundsError("Sold insuficient"));

    const res = await buildApp().request("/api/v1/rnpm/captcha/balance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captchaKey: "0".repeat(32), captchaProvider: "2captcha" }),
    });

    expect(res.status).toBe(402);
    expect(res.headers.get("Retry-After")).toBe("0");
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("limit_exceeded pastreaza total, limit si splittable in error.details", async () => {
    vi.mocked(executeSearch).mockRejectedValueOnce(
      new RnpmError("Prea multe rezultate", 400, undefined, "limit_exceeded", { total: 1501, limit: 1500 })
    );

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "ipoteci",
        params: { creditorPJ: { denumire: "test" } },
        captchaKey: "0".repeat(32),
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeErrorBody;
    expect(body.error.code).toBe("LIMIT_EXCEEDED");
    expect(body.error.details).toEqual({
      total: 1501,
      limit: 1500,
      splittable: { type: "ipoteci" },
    });
  });
});
