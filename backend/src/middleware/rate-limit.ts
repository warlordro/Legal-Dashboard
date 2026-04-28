import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Next } from "hono";

const RATE_LIMIT = 30;
const RATE_WINDOW = 60000;

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export async function rateLimit(c: Context, next: Next): Promise<Response | void> {
  // SECURITY: rate-limit by real socket address. X-Forwarded-For is spoofable and
  // deliberately ignored. If the runtime cannot surface a remote address (proxy
  // misconfiguration, raw stream, etc.), fail closed — a shared "unknown" bucket
  // would let a single misbehaving caller starve every other client.
  const ip = getConnInfo(c).remote.address;
  if (!ip) {
    return c.json({ error: "Origine indisponibila." }, 503);
  }
  const now = Date.now();
  // Local DB reads (RNPM saved/* GETs) bypass upstream rate limit
  if (c.req.method === "GET" && c.req.path.startsWith("/api/rnpm/saved")) {
    return next();
  }

  // Tier 3 #15: bucket per (ip, ownerId). On desktop ownerId is always
  // "local" so behavior is unchanged (one bucket per IP, just like before).
  // In LAN / web mode, two owners behind the same NAT or egress proxy now
  // get independent buckets — owner A exhausting their ceiling cannot DOS
  // owner B. ownerContext runs before this middleware in the global mount
  // order; if a route ever runs without it, fall back to "local" so the
  // key is still well-formed (no map pollution from undefined values).
  const ownerId = c.get("ownerId") ?? "local";
  const key = `${ip}|${ownerId}`;
  const entry = rateLimitMap.get(key);

  // SECURITY: Multi-agent endpoint consumes 3 rate limit units (3 AI calls)
  const weight = c.req.path === "/api/ai/analyze-multi" ? 3 : 1;

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: weight, resetTime: now + RATE_WINDOW });
  } else {
    entry.count += weight;
    if (entry.count > RATE_LIMIT) {
      return c.json({ error: "Prea multe cereri. Incercati din nou in cateva momente." }, 429);
    }
  }

  // Cleanup old entries periodically
  if (rateLimitMap.size > 1000) {
    for (const [key, val] of rateLimitMap) {
      if (now > val.resetTime) rateLimitMap.delete(key);
    }
  }

  await next();
}

// Test-only: clear the singleton map between tests so per-test budgets are
// independent. Not exported through any public surface; underscore prefix
// flags it as "do not call from production code".
export function _resetRateLimitForTest(): void {
  rateLimitMap.clear();
}
