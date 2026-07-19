import type { Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findUnsupportedTrustedCidrEntries, isLoopbackAddress, readClientIp } from "./proxyIp.ts";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(),
}));

import { getConnInfo } from "@hono/node-server/conninfo";

function fakeContext(peer: string | null, xff?: string): Context {
  vi.mocked(getConnInfo).mockReturnValue({
    remote: { address: peer ?? undefined, port: 0, addressType: "IPv4" },
  } as unknown as ReturnType<typeof getConnInfo>);
  return {
    req: {
      header: (name: string) => (name === "x-forwarded-for" ? xff : undefined),
    },
  } as unknown as Context;
}

describe("readClientIp", () => {
  const ORIGINAL_ENV = process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR;

  beforeEach(() => {
    vi.mocked(getConnInfo).mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
      delete process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR;
    } else {
      process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = ORIGINAL_ENV;
    }
  });

  it("returns peer address when no trusted CIDR configured", () => {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
    delete process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR;
    expect(readClientIp(fakeContext("203.0.113.5", "1.1.1.1, 2.2.2.2"))).toBe("203.0.113.5");
  });

  it("returns peer when peer is NOT in trusted CIDR (XFF ignored)", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "10.0.0.0/8";
    expect(readClientIp(fakeContext("203.0.113.5", "1.1.1.1, 2.2.2.2"))).toBe("203.0.113.5");
  });

  it("walks XFF right-to-left, picks rightmost non-trusted IP", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "10.0.0.0/8";
    // Peer trusted, XFF: "<attacker>, <real>, <internal hop>". Right-to-left:
    // 10.0.0.5 trusted skip, 203.0.113.7 non-trusted -> return.
    expect(readClientIp(fakeContext("10.0.0.1", "1.1.1.1, 203.0.113.7, 10.0.0.5"))).toBe("203.0.113.7");
  });

  it("ignores attacker-controlled leftmost XFF entry", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "10.0.0.0/8";
    expect(readClientIp(fakeContext("10.0.0.1", "1.1.1.1, 198.51.100.4"))).toBe("198.51.100.4");
  });

  it("falls back to peer when XFF entries are all trusted", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "10.0.0.0/8";
    expect(readClientIp(fakeContext("10.0.0.1", "10.0.0.2, 10.0.0.3"))).toBe("10.0.0.1");
  });

  it("skips malformed XFF entries", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "10.0.0.0/8";
    expect(readClientIp(fakeContext("10.0.0.1", "not-an-ip, 198.51.100.9, 10.0.0.5"))).toBe("198.51.100.9");
  });

  it("returns null when no peer is available", () => {
    expect(readClientIp(fakeContext(null))).toBe(null);
  });

  it("treats ::1/128 as trusted IPv6 loopback (canonical forms)", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "::1/128";
    expect(readClientIp(fakeContext("::1", "203.0.113.9"))).toBe("203.0.113.9");
  });

  it("matches expanded ::1 written as 0:0:0:0:0:0:0:1", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "0:0:0:0:0:0:0:1/128";
    expect(readClientIp(fakeContext("::1", "203.0.113.9"))).toBe("203.0.113.9");
  });

  it("still matches an IPv4-mapped CIDR base", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "::ffff:10.0.0.0/8";
    expect(readClientIp(fakeContext("10.0.0.1", "203.0.113.9"))).toBe("203.0.113.9");
  });

  it("does not flag ::1/128 as unsupported", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "10.0.0.0/8, ::1/128";
    expect(findUnsupportedTrustedCidrEntries()).toEqual([]);
  });
});

describe("isLoopbackAddress", () => {
  it("recognises loopback IPv4, IPv6 and v4-mapped forms", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects non-loopback addresses + null", () => {
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackAddress(null)).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
