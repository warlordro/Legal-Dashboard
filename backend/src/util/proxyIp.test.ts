import type { Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findUnsupportedTrustedCidrEntries,
  hasSupportedTrustedCidr,
  isLoopbackAddress,
  isLoopbackHostname,
  readClientIp,
} from "./proxyIp.ts";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(),
}));

import { getConnInfo } from "@hono/node-server/conninfo";

function fakeContext(peer: string | null, xff?: string, cfIp?: string): Context {
  vi.mocked(getConnInfo).mockReturnValue({
    remote: { address: peer ?? undefined, port: 0, addressType: "IPv4" },
  } as unknown as ReturnType<typeof getConnInfo>);
  const headers: Record<string, string | undefined> = {
    "x-forwarded-for": xff,
    "cf-connecting-ip": cfIp,
  };
  return {
    req: { header: (name: string) => headers[name] },
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

  // Deployul pe NAS: Cloudflare -> cloudflared -> oauth2-proxy -> backend.
  // XFF se pierde pe traseu, CF-Connecting-IP nu.
  it("prefera CF-Connecting-IP cand peer-ul e de incredere si XFF lipseste", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "172.16.0.0/12";
    expect(readClientIp(fakeContext("172.20.0.3", undefined, "203.0.113.9"))).toBe("203.0.113.9");
  });

  it("CF-Connecting-IP are prioritate fata de XFF", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "172.16.0.0/12";
    expect(readClientIp(fakeContext("172.20.0.3", "8.8.8.8", "203.0.113.9"))).toBe("203.0.113.9");
  });

  it("ignora CF-Connecting-IP cand peer-ul NU e de incredere (client direct nu il poate falsifica)", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "172.16.0.0/12";
    expect(readClientIp(fakeContext("203.0.113.5", undefined, "1.1.1.1"))).toBe("203.0.113.5");
  });

  it("ignora un CF-Connecting-IP invalid si cade pe XFF", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "172.16.0.0/12";
    expect(readClientIp(fakeContext("172.20.0.3", "8.8.8.8", "nu-e-ip"))).toBe("8.8.8.8");
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

  it("no longer trusts all IPv4 for an empty prefix (127.0.0.1/) and flags it", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "127.0.0.1/";
    // Empty prefix must not coerce to /0 (Number("") === 0 = trust everything).
    expect(readClientIp(fakeContext("203.0.113.5", "1.1.1.1, 2.2.2.2"))).toBe("203.0.113.5");
    expect(findUnsupportedTrustedCidrEntries()).toEqual(["127.0.0.1/"]);
  });

  it("flags a garbage entry as unsupported", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "garbage";
    expect(findUnsupportedTrustedCidrEntries()).toEqual(["garbage"]);
  });

  it("keeps 0.0.0.0/0 valid (trusts every IPv4)", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "0.0.0.0/0";
    expect(findUnsupportedTrustedCidrEntries()).toEqual([]);
    expect(hasSupportedTrustedCidr()).toBe(true);
    // /0 trusts every IPv4, so peer + every XFF hop are trusted -> fall back to peer.
    expect(readClientIp(fakeContext("10.0.0.1", "198.51.100.4"))).toBe("10.0.0.1");
  });

  it("flags ::ffff:127.0.0.1/128 as unsupported (mapped base needs prefix <= 32)", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "::ffff:127.0.0.1/128";
    expect(findUnsupportedTrustedCidrEntries()).toEqual(["::ffff:127.0.0.1/128"]);
  });

  it("flags only the invalid entry in a mixed list, still reports at least one supported", () => {
    process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "garbage, 127.0.0.1/32";
    expect(findUnsupportedTrustedCidrEntries()).toEqual(["garbage"]);
    expect(hasSupportedTrustedCidr()).toBe(true);
  });

  it("reports no supported entry for a garbage-only / empty list", () => {
    expect(hasSupportedTrustedCidr("garbage, ::ffff:127.0.0.1/128")).toBe(false);
    expect(hasSupportedTrustedCidr("")).toBe(false);
    expect(hasSupportedTrustedCidr("127.0.0.1/32")).toBe(true);
  });
});

describe("isLoopbackHostname", () => {
  it("covers localhost, all of 127.0.0.0/8, expanded ::1 and v4-mapped loopback", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("127.0.0.2")).toBe(true);
    expect(isLoopbackHostname("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isLoopbackHostname("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects real non-loopback binds", () => {
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
    expect(isLoopbackHostname("10.0.0.1")).toBe(false);
  });
});

describe("isLoopbackAddress", () => {
  it("recognises loopback IPv4, IPv6 and v4-mapped forms", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("covers the whole 127.0.0.0/8 range, expanded ::1 and v4-mapped 127.x", () => {
    expect(isLoopbackAddress("127.0.0.2")).toBe(true);
    expect(isLoopbackAddress("127.255.255.254")).toBe(true);
    expect(isLoopbackAddress("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.5")).toBe(true);
  });

  it("rejects non-loopback addresses + null", () => {
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackAddress(null)).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
