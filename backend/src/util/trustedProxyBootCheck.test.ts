import { describe, expect, it } from "vitest";
import { assertTrustedProxyForWeb } from "./trustedProxyBootCheck.ts";

describe("assertTrustedProxyForWeb (strict)", () => {
  const web = { LEGAL_DASHBOARD_AUTH_MODE: "web" } as NodeJS.ProcessEnv;
  it("throws: web + loopback bind + empty CIDR (co-located proxy topology)", () => {
    expect(() => assertTrustedProxyForWeb({ ...web }, "127.0.0.1")).toThrow(/TRUSTED_PROXY_CIDR/);
  });
  it("passes: web + loopback + CIDR set", () => {
    expect(() =>
      assertTrustedProxyForWeb({ ...web, LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR: "127.0.0.1/32" }, "127.0.0.1")
    ).not.toThrow();
  });
  it("passes: web + direct non-loopback bind + empty CIDR (real peer, no proxy)", () => {
    expect(() => assertTrustedProxyForWeb({ ...web }, "0.0.0.0")).not.toThrow();
  });
  it("passes: desktop mode", () => {
    expect(() => assertTrustedProxyForWeb({ LEGAL_DASHBOARD_AUTH_MODE: "desktop" }, "127.0.0.1")).not.toThrow();
  });
});
