import { describe, expect, it } from "vitest";
import { validateAuthConfig } from "./config.ts";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("PR-9 auth config validation", () => {
  it("fails closed for invalid auth mode and web mode without a JWT secret", () => {
    expect(() =>
      validateAuthConfig({ LEGAL_DASHBOARD_AUTH_MODE: "invalid" } as NodeJS.ProcessEnv),
    ).toThrow(/desktop.*web/i);

    expect(() =>
      validateAuthConfig({ LEGAL_DASHBOARD_AUTH_MODE: "web" } as NodeJS.ProcessEnv),
    ).toThrow(/JWT_SECRET/i);
  });

  it("rejects JWT TTL values above 86400 seconds", () => {
    expect(() =>
      validateAuthConfig({
        LEGAL_DASHBOARD_AUTH_MODE: "web",
        LEGAL_DASHBOARD_JWT_SECRET: SECRET,
        LEGAL_DASHBOARD_JWT_TTL_SECONDS: "86401",
      } as NodeJS.ProcessEnv),
    ).toThrow(/86400/);
  });

  it("accepts desktop mode without a JWT secret", () => {
    expect(() =>
      validateAuthConfig({ LEGAL_DASHBOARD_AUTH_MODE: "desktop" } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
