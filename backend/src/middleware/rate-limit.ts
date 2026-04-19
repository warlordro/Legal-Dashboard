import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Next } from "hono";

const RATE_LIMIT = 30;
const RATE_WINDOW = 60000;

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export async function rateLimit(c: Context, next: Next): Promise<Response | void> {
  // SECURITY: rate-limit by real socket address (falls back to a shared bucket if unknown).
  // X-Forwarded-For is spoofable and deliberately ignored.
  const ip = getConnInfo(c).remote.address || "unknown";
  const now = Date.now();
  // Local DB reads (RNPM saved/* GETs) bypass upstream rate limit
  if (c.req.method === "GET" && c.req.path.startsWith("/api/rnpm/saved")) {
    return next();
  }
  const entry = rateLimitMap.get(ip);

  // SECURITY: Multi-agent endpoint consumes 3 rate limit units (3 AI calls)
  const weight = c.req.path === "/api/ai/analyze-multi" ? 3 : 1;

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: weight, resetTime: now + RATE_WINDOW });
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
