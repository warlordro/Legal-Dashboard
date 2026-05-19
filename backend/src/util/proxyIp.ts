import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import net from "node:net";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function ipv4ToInt(ip: string): number | null {
  const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (net.isIP(normalized) !== 4) return null;
  return normalized.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function cidrContains(cidr: string, ip: string): boolean {
  const [base, rawPrefix] = cidr.split("/");
  const prefix = Number(rawPrefix);
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
  const trusted = cidrs.some((cidr) => cidrContains(cidr, peer));
  if (!trusted) return peer;
  const forwarded = c.req
    .header("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .find((part) => net.isIP(part) !== 0);
  return forwarded || peer;
}

export function isLoopbackAddress(ip: string | null | undefined): boolean {
  return Boolean(ip && LOOPBACK.has(ip));
}
