import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { ErrorCodes, fail } from "./envelope.ts";

const makeCtx = (requestId?: string): Context =>
  ({
    get: (key: string) => (key === "requestId" ? requestId : undefined),
  }) as unknown as Context;

describe("envelope error codes", () => {
  it("expune toate codurile UPPER_SNAKE_CASE", () => {
    const expected = [
      "INVALID_JSON",
      "INVALID_PARAMS",
      "VALIDATION_ERROR",
      "INVALID_CAPTCHA_KEY",
      "PAYLOAD_TOO_LARGE",
      "LIMIT_EXCEEDED",
      "DUPLICATE_REQUEST",
      "CAPTCHA_BALANCE_UNAVAILABLE",
      "INSUFFICIENT_FUNDS",
      "FILTER_DISABLED",
      "FILTER_TIMEOUT",
      "MISSING_API_KEY",
      "UNKNOWN_MODEL",
      "AI_ANALYSIS_FAILED",
      "WEB_MODE_NOT_IMPLEMENTED",
      "DESKTOP_ONLY",
      "NOT_FOUND",
      "INTERNAL_ERROR",
    ];
    for (const code of expected) {
      expect((ErrorCodes as Record<string, string>)[code]).toBe(code);
    }
  });

  it("fail() include details cand sunt furnizate", () => {
    const env = fail(ErrorCodes.LIMIT_EXCEEDED, "prea multe", makeCtx("req-1"), { total: 1500, limit: 1000 });
    expect(env).toEqual({
      data: null,
      error: { code: "LIMIT_EXCEEDED", message: "prea multe", details: { total: 1500, limit: 1000 } },
      requestId: "req-1",
    });
  });

  it("fail() fara details NU emite cheia details", () => {
    const env = fail(ErrorCodes.INVALID_JSON, "json", makeCtx("req-2"));
    expect(env).toEqual({
      data: null,
      error: { code: "INVALID_JSON", message: "json" },
      requestId: "req-2",
    });
    expect("details" in env.error).toBe(false);
  });

  it("fail() cu requestId lipsa returneaza string gol stabil", () => {
    const env = fail(ErrorCodes.INTERNAL_ERROR, "x", makeCtx(undefined));
    expect(typeof env.requestId).toBe("string");
  });
});
