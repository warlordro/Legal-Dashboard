import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import net from "node:net";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function ipv4ToInt(ip: string): number | null {
  const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (net.isIP(normalized) !== 4) return null;
  return normalized.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

// Canonicalize an IPv6 literal so ::1 and 0:0:0:0:0:0:0:1 compare equal.
// URL host parsing compresses IPv6 to its canonical form; IPv4 passes through.
function canonicalIp(ip: string): string | null {
  const v = net.isIP(ip);
  if (v === 4) return ip;
  if (v === 6) {
    try {
      return new URL(`http://[${ip}]`).hostname;
    } catch {
      return null;
    }
  }
  return null;
}

function cidrContains(cidr: string, ip: string): boolean {
  const [base, rawPrefix] = cidr.split("/");
  const prefix = Number(rawPrefix);
  // Pure-IPv6 base (NOT ::ffff: IPv4-mapped): only exact /128 supported.
  if (base && net.isIP(base) === 6 && !base.startsWith("::ffff:")) {
    if (prefix !== 128) return false;
    const a = canonicalIp(base);
    const b = canonicalIp(ip);
    return a !== null && a === b;
  }
  const baseInt = ipv4ToInt(base ?? "");
  const ipInt = ipv4ToInt(ip);
  if (baseInt === null || ipInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (baseInt & mask) === (ipInt & mask);
}

function trustedCidrs(): string[] {
  return (process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function readClientIp(c: Context): string | null {
  const peer = getConnInfo(c).remote.address ?? null;
  if (!peer) return null;
  const cidrs = trustedCidrs();
  if (cidrs.length === 0 || !cidrs.some((cidr) => cidrContains(cidr, peer))) {
    return peer;
  }
  // Walk right-to-left, skipping trusted proxies. The right-most non-trusted
  // entry is the closest hop we still trust to identify the real client. Going
  // leftmost would let any client spoof X-Forwarded-For: "1.1.1.1, <proxy>" and
  // forge the rate-limit key. Trusted entries inserted by our own proxies are
  // skipped; we stop at the first non-trusted IP from the right.
  const forwarded =
    c.req
      .header("x-forwarded-for")
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean) ?? [];
  for (let i = forwarded.length - 1; i >= 0; i--) {
    const candidate = forwarded[i];
    if (net.isIP(candidate) === 0) continue;
    if (cidrs.some((cidr) => cidrContains(cidr, candidate))) continue;
    return candidate;
  }
  return peer;
}

export function isLoopbackAddress(ip: string | null | undefined): boolean {
  return Boolean(ip && LOOPBACK.has(ip));
}

// Returns CIDR entries that this parser cannot honour: IPv4 / IPv4-mapped base
// with a prefix in [0,32], or a pure IPv6 base at exactly /128, are supported;
// everything else (IPv6 non-/128, missing prefix, out-of-range prefix) is
// reported. Caller emits a startup warning so an operator who set an unsupported
// entry is not surprised when it is silently ignored and rate-limit keys flip
// back to peer for every XFF lookup.
export function findUnsupportedTrustedCidrEntries(): string[] {
  return trustedCidrs().filter((entry) => {
    const [base, rawPrefix] = entry.split("/");
    if (!base || rawPrefix === undefined) return true;
    const prefix = Number(rawPrefix);
    // Pure IPv6 base: supported only at /128. IPv4-mapped (::ffff:x) falls through
    // to the IPv4 check below (net.isIP on ::ffff:10.0.0.0 is 6, so strip first).
    if (net.isIP(base) === 6 && !base.startsWith("::ffff:")) {
      return !(Number.isInteger(prefix) && prefix === 128);
    }
    if (net.isIP(base.startsWith("::ffff:") ? base.slice(7) : base) !== 4) return true;
    return !Number.isInteger(prefix) || prefix < 0 || prefix > 32;
  });
}
