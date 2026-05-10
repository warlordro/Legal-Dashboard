import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Next } from "hono";

// v2.20.4 fix: pragul anterior (30 req/min) era prea conservator pentru UX
// pe desktop — pagina Alerts cu Refresh + Inchide toate + paginare burst-uia
// usor 30/min si producea 429 in flow normal. 120 acopera bursturi realiste,
// pastreaza protectia impotriva runaway loops (un infinite useEffect tot ar
// fi blocat dupa ~1 min) si ramane izolare per (ip, ownerId) in web mode.
// Exportat ca testele sa nu duplice magic number-ul.
export const RATE_LIMIT = 120;
const RATE_WINDOW = 60000;

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export async function rateLimit(c: Context, next: Next): Promise<Response | void> {
  // SECURITY: rate-limit by real socket address. X-Forwarded-For is spoofable and
  // deliberately ignored. If the runtime cannot surface a remote address (proxy
  // misconfiguration, raw stream, etc.), fail closed — a shared "unknown" bucket
  // would let a single misbehaving caller starve every other client.
  const ip = getConnInfo(c).remote.address;
  if (!ip) {
    return c.json(
      {
        data: null,
        error: { code: "origin_unavailable", message: "Origine indisponibila." },
        requestId: c.get("requestId") ?? "",
      },
      503,
    );
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
      return c.json(
        {
          data: null,
          error: {
            code: "rate_limited",
            message: "Prea multe cereri. Incercati din nou in cateva momente.",
          },
          requestId: c.get("requestId") ?? "",
        },
        429,
      );
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

// PR-9 fix B2: limiter pre-auth, IP-only, montat inainte de ownerContext.
// Scop: floods cu token missing/invalid sunt oprite la nivelul IP fara sa
// loveasca ownerContext la infinit. Bucket separat ca sa nu interfereze cu
// limiter-ul per-owner. Requesturile care trec auth cu succes elibereaza
// bucket-ul dupa next(), astfel traficul valid ramane guvernat doar de
// limiter-ul existing per-owner.
const PRE_AUTH_LIMIT = 60; // failed unauthenticated requests / minut / IP
const PRE_AUTH_PREFIX = "preauth:";
const preAuthMap = new Map<string, { count: number; resetTime: number }>();

function releasePreAuthAttempt(key: string): void {
  const entry = preAuthMap.get(key);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count <= 0) preAuthMap.delete(key);
}

export async function preAuthRateLimit(c: Context, next: Next): Promise<Response | void> {
  const ip = getConnInfo(c).remote.address;
  if (!ip) {
    return c.json(
      {
        data: null,
        error: { code: "origin_unavailable", message: "Origine indisponibila." },
        requestId: c.get("requestId") ?? "",
      },
      503,
    );
  }

  const key = `${PRE_AUTH_PREFIX}${ip}`;
  const now = Date.now();
  const entry = preAuthMap.get(key);

  if (!entry || now > entry.resetTime) {
    preAuthMap.set(key, { count: 1, resetTime: now + RATE_WINDOW });
  } else {
    entry.count += 1;
    if (entry.count > PRE_AUTH_LIMIT) {
      return c.json(
        {
          data: null,
          error: { code: "rate_limited", message: "Prea multe cereri neautentificate." },
          requestId: c.get("requestId") ?? "",
        },
        429,
      );
    }
  }

  await next();

  // Doar path-urile autentificate cu succes elibereaza bucket-ul pre-auth.
  // 3xx/4xx/5xx raman consumate ca sa nu poata fi folosite pentru bypass.
  if (c.res.status >= 200 && c.res.status < 300) {
    releasePreAuthAttempt(key);
  }

  if (preAuthMap.size > 1000) {
    for (const [k, v] of preAuthMap) {
      if (now > v.resetTime) preAuthMap.delete(k);
    }
  }
}

// Export pentru teste: reset bucket-ul intre teste.
export function resetPreAuthRateLimit(): void {
  preAuthMap.clear();
}
