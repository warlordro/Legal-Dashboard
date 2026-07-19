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

  it("throws: web + loopback + CIDR with no parser-supported entry (garbage-only)", () => {
    expect(() =>
      assertTrustedProxyForWeb({ ...web, LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR: "garbage" }, "127.0.0.1")
    ).toThrow(/garbage/);
  });

  it("throws: web + loopback + only unsupported IPv4-mapped /128 entry", () => {
    expect(() =>
      assertTrustedProxyForWeb({ ...web, LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR: "::ffff:127.0.0.1/128" }, "127.0.0.1")
    ).toThrow(/::ffff:127\.0\.0\.1\/128/);
  });

  it("passes: web + loopback + mixed list containing at least one supported entry", () => {
    expect(() =>
      assertTrustedProxyForWeb({ ...web, LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR: "garbage, 127.0.0.1/32" }, "127.0.0.1")
    ).not.toThrow();
  });

  it("passes: web + loopback + 0.0.0.0/0 (explicitly valid)", () => {
    expect(() =>
      assertTrustedProxyForWeb({ ...web, LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR: "0.0.0.0/0" }, "127.0.0.1")
    ).not.toThrow();
  });

  it("gate triggers on any 127.0.0.0/8 bind, not just 127.0.0.1", () => {
    expect(() => assertTrustedProxyForWeb({ ...web }, "127.0.0.2")).toThrow(/TRUSTED_PROXY_CIDR/);
  });

  it("gate triggers on expanded IPv6 loopback bind (0:0:0:0:0:0:0:1)", () => {
    expect(() => assertTrustedProxyForWeb({ ...web }, "0:0:0:0:0:0:0:1")).toThrow(/TRUSTED_PROXY_CIDR/);
  });

  it("gate triggers on IPv4-mapped loopback bind (::ffff:127.0.0.1)", () => {
    expect(() => assertTrustedProxyForWeb({ ...web }, "::ffff:127.0.0.1")).toThrow(/TRUSTED_PROXY_CIDR/);
  });

  it("gate triggers on localhost bind", () => {
    expect(() => assertTrustedProxyForWeb({ ...web }, "localhost")).toThrow(/TRUSTED_PROXY_CIDR/);
  });
});
