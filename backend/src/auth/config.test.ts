import { afterEach, describe, expect, it, vi } from "vitest";
import { validateAuthConfig } from "./config.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const WEB_ENV = {
  LEGAL_DASHBOARD_AUTH_MODE: "web",
  LEGAL_DASHBOARD_JWT_SECRET: SECRET,
  LEGAL_DASHBOARD_JWT_ISSUER: "legal-dashboard.test",
  LEGAL_DASHBOARD_JWT_AUDIENCE: "legal-dashboard-api",
} as NodeJS.ProcessEnv;

afterEach(() => {
  vi.restoreAllMocks();
});

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
        ...WEB_ENV,
        LEGAL_DASHBOARD_JWT_TTL_SECONDS: "86401",
      } as NodeJS.ProcessEnv),
    ).toThrow(/86400/);
  });

  it("requires issuer and audience in web mode", () => {
    expect(() =>
      validateAuthConfig({
        LEGAL_DASHBOARD_AUTH_MODE: "web",
        LEGAL_DASHBOARD_JWT_SECRET: SECRET,
        LEGAL_DASHBOARD_JWT_AUDIENCE: "legal-dashboard-api",
      } as NodeJS.ProcessEnv),
    ).toThrow(/JWT_ISSUER/);

    expect(() =>
      validateAuthConfig({
        LEGAL_DASHBOARD_AUTH_MODE: "web",
        LEGAL_DASHBOARD_JWT_SECRET: SECRET,
        LEGAL_DASHBOARD_JWT_ISSUER: "legal-dashboard.test",
      } as NodeJS.ProcessEnv),
    ).toThrow(/JWT_AUDIENCE/);
  });

  it("accepts generic JWT aliases for web auth config", () => {
    expect(() =>
      validateAuthConfig({
        LEGAL_DASHBOARD_AUTH_MODE: "web",
        JWT_SECRET: SECRET,
        JWT_ISSUER: "legal-dashboard.test",
        JWT_AUDIENCE: "legal-dashboard-api",
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it("falls back to generic JWT aliases when LEGAL_DASHBOARD aliases are blank", () => {
    expect(() =>
      validateAuthConfig({
        LEGAL_DASHBOARD_AUTH_MODE: "web",
        LEGAL_DASHBOARD_JWT_SECRET: "",
        LEGAL_DASHBOARD_JWT_ISSUER: "",
        LEGAL_DASHBOARD_JWT_AUDIENCE: "",
        JWT_SECRET: SECRET,
        JWT_ISSUER: "legal-dashboard.test",
        JWT_AUDIENCE: "legal-dashboard-api",
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it("fails production web mode when auth cookies are not secure", () => {
    expect(() =>
      validateAuthConfig({
        ...WEB_ENV,
        NODE_ENV: "production",
        AUTH_COOKIE_SECURE: "0",
      } as NodeJS.ProcessEnv),
    ).toThrow(/AUTH_COOKIE_SECURE=0/);
  });

  it("warns outside production when auth cookies are not secure", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      validateAuthConfig({
        ...WEB_ENV,
        NODE_ENV: "development",
        AUTH_COOKIE_SECURE: "0",
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("AUTH_COOKIE_SECURE=0"));
  });

  it("accepts desktop mode without a JWT secret", () => {
    expect(() =>
      validateAuthConfig({ LEGAL_DASHBOARD_AUTH_MODE: "desktop" } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
