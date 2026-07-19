import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import net from "node:net";

// Parse a CIDR prefix LEXICALLY: only 1-3 ASCII digits are a valid prefix. An
// empty prefix (`127.0.0.1/`) or a non-numeric one must NOT coerce to 0 —
// Number("") === 0 would silently trust ALL of IPv4. Returns null for anything
// that is not a plain decimal integer; range ([0,32]/128) is checked by callers.
function parseCidrPrefix(rawPrefix: string | undefined): number | null {
  if (rawPrefix === undefined || !/^\d{1,3}$/.test(rawPrefix)) return null;
  return Number(rawPrefix);
}

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
  const prefix = parseCidrPrefix(rawPrefix);
  if (prefix === null) return false;
  // Pure-IPv6 base (NOT ::ffff: IPv4-mapped): only exact /128 supported.
  if (base && net.isIP(base) === 6 && !base.startsWith("::ffff:")) {
    if (prefix !== 128) return false;
    const a = canonicalIp(base);
    const b = canonicalIp(ip);
    return a !== null && a === b;
  }
  const baseInt = ipv4ToInt(base ?? "");
  const ipInt = ipv4ToInt(ip);
  if (baseInt === null || ipInt === null || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (baseInt & mask) === (ipInt & mask);
}

function trustedCidrs(raw?: string): string[] {
  return (raw ?? process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

// Single source of truth for "is this CIDR entry honoured by cidrContains":
// IPv4 / IPv4-mapped (::ffff:x) base with a lexical prefix in [0,32], or a pure
// IPv6 base at exactly /128. Everything else (IPv6 non-/128, missing/non-numeric
// prefix, out-of-range prefix) is unsupported. findUnsupportedTrustedCidrEntries
// and hasSupportedTrustedCidr both derive from this so the boot gate and the
// runtime XFF walk never diverge on what counts as a real entry.
function isSupportedTrustedCidrEntry(entry: string): boolean {
  const [base, rawPrefix] = entry.split("/");
  if (!base) return false;
  const prefix = parseCidrPrefix(rawPrefix);
  if (prefix === null) return false;
  if (net.isIP(base) === 6 && !base.startsWith("::ffff:")) return prefix === 128;
  if (net.isIP(base.startsWith("::ffff:") ? base.slice(7) : base) !== 4) return false;
  return prefix >= 0 && prefix <= 32;
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

// Loopback IP classifier shared by originGuard (peer) and, via
// isLoopbackHostname, the boot gate. Covers the whole 127.0.0.0/8 range,
// IPv4-mapped 127.x (::ffff:127.x) and every textual form of ::1 (canonicalized
// so 0:0:0:0:0:0:0:1 compares equal). One definition — no divergent string sets.
const CANONICAL_IPV6_LOOPBACK = canonicalIp("::1");

export function isLoopbackAddress(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const asInt = ipv4ToInt(ip); // strips ::ffff: and validates IPv4
  if (asInt !== null) return asInt >>> 24 === 127;
  return canonicalIp(ip) === CANONICAL_IPV6_LOOPBACK;
}

// Boot-time bind-host classifier: the same loopback-IP logic plus the
// "localhost" alias, which resolves to loopback but is not itself an IP literal.
export function isLoopbackHostname(host: string): boolean {
  return host === "localhost" || isLoopbackAddress(host);
}

// Returns CIDR entries that this parser cannot honour (see
// isSupportedTrustedCidrEntry). Caller emits a startup warning so an operator who
// set an unsupported entry is not surprised when it is silently ignored and
// rate-limit keys flip back to peer for every XFF lookup. Optional `raw` lets the
// boot gate classify a candidate value without touching process.env.
export function findUnsupportedTrustedCidrEntries(raw?: string): string[] {
  return trustedCidrs(raw).filter((entry) => !isSupportedTrustedCidrEntry(entry));
}

// True when at least one configured CIDR entry is actually honoured by the
// parser. The web-loopback boot gate requires this: an empty list OR a list made
// exclusively of unsupported entries leaves originGuard's loopback bypass wide
// open, so both must fail closed.
export function hasSupportedTrustedCidr(raw?: string): boolean {
  return trustedCidrs(raw).some(isSupportedTrustedCidrEntry);
}
