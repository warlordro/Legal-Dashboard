import type { Context, Next } from "hono";
import { readClientIp } from "../util/proxyIp.ts";

// v2.20.4 fix: pragul anterior (30 req/min) era prea conservator pentru UX
// pe desktop — pagina Alerts cu Refresh + Inchide toate + paginare burst-uia
// usor 30/min si producea 429 in flow normal. 120 acopera bursturi realiste,
// pastreaza protectia impotriva runaway loops (un infinite useEffect tot ar
// fi blocat dupa ~1 min) si ramane izolare per (ip, ownerId) in web mode.
// Exportat ca testele sa nu duplice magic number-ul.
export const RATE_LIMIT = 120;
const RATE_WINDOW = 60000;

// PAT per-token request ceiling, stricter than the per-owner limit, applied only on the
// PAT path (after tokenId resolution). Configurable via env.
//
// Defensive clamp (review 2026-07-01): `Number(env) || 60` lets toxic values through — a
// NEGATIVE value is truthy (`-5 || 60` => -5), so `count > -5` is always true and EVERY PAT
// request would 429 (DoS by misconfiguration). Non-finite / <= 0 => default 60; non-integer
// => floored; above the per-owner ceiling => capped at RATE_LIMIT (a per-token limit looser
// than the per-owner one is pointless).
export function clampTokenRateLimit(raw: number, ceiling: number = RATE_LIMIT): number {
  if (!Number.isFinite(raw) || raw <= 0) return Math.min(60, ceiling);
  return Math.min(Math.floor(raw), ceiling);
}
export const TOKEN_RATE_LIMIT = clampTokenRateLimit(Number(process.env.LEGAL_DASHBOARD_TOKEN_RATE_LIMIT));

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const tokenRateLimitMap = new Map<string, { count: number; resetTime: number }>();

// Standard envelope for limiter failures (503 fail-closed, 429 throttle).
// Inlined in fiecare loc inseamna o copie de envelope per branch (4x) — sub un singur helper se vede mai usor cand schema evolueaza.
function fail(c: Context, status: 429 | 503, code: string, message: string): Response {
  return c.json(
    {
      data: null,
      error: { code, message },
      requestId: c.get("requestId") ?? "",
    },
    status
  );
}

export async function rateLimit(c: Context, next: Next): Promise<Response | undefined> {
  // SECURITY: rate-limit by real socket address. X-Forwarded-For is spoofable and
  // deliberately ignored. If the runtime cannot surface a remote address (proxy
  // misconfiguration, raw stream, etc.), fail closed — a shared "unknown" bucket
  // would let a single misbehaving caller starve every other client.
  const ip = readClientIp(c);
  if (!ip) {
    return fail(c, 503, "origin_unavailable", "Origine indisponibila.");
  }
  const now = Date.now();

  // PAT (piesa A): bucket per-token, aplicat DUPA rezolvarea PAT (tokenId setat de
  // ownerContext). Rulat INAINTE de scutirea /api/rnpm/saved ca un PAT sa NU scape
  // neplafonat pe ruta exceptata (fix R05). Flood-urile cu token invalid sunt deja
  // oprite de preAuthRateLimit (IP) inainte de lookup DB.
  const tokenId = c.get("tokenId");
  if (tokenId) {
    const tkey = `tok|${tokenId}`;
    const tentry = tokenRateLimitMap.get(tkey);
    if (!tentry || now > tentry.resetTime) {
      tokenRateLimitMap.set(tkey, { count: 1, resetTime: now + RATE_WINDOW });
    } else {
      tentry.count += 1;
      if (tentry.count > TOKEN_RATE_LIMIT) {
        return fail(c, 429, "rate_limited", "Prea multe cereri pentru acest token.");
      }
    }
  }

  // Local DB reads (RNPM saved/* GETs) bypass upstream rate limit — DOAR non-PAT (fix R05).
  if (c.req.method === "GET" && c.req.path.startsWith("/api/rnpm/saved") && !tokenId) {
    await next();
    return undefined;
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
      return fail(c, 429, "rate_limited", "Prea multe cereri. Incercati din nou in cateva momente.");
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
  tokenRateLimitMap.clear();
}

// v2.20.8: periodic sweep ca sa nu acumulam entries pe procese long-running
// chiar daca nu se atinge plafonul de 1000. Inline cleanup ramane (catches
// growth spikes intre tick-uri); intervalul curata buckets idle linistit.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function sweepExpiredEntries(now: number): void {
  for (const [k, v] of rateLimitMap) {
    if (now > v.resetTime) rateLimitMap.delete(k);
  }
  for (const [k, v] of tokenRateLimitMap) {
    if (now > v.resetTime) tokenRateLimitMap.delete(k);
  }
  for (const [k, v] of preAuthMap) {
    if (now > v.resetTime) preAuthMap.delete(k);
  }
}

export function startRateLimitSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepExpiredEntries(Date.now()), SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

export function stopRateLimitSweeper(): void {
  if (!sweepTimer) return;
  clearInterval(sweepTimer);
  sweepTimer = null;
}

// Test helper: drive sweep deterministic fara real timers.
export function _sweepRateLimitNowForTest(now = Date.now()): void {
  sweepExpiredEntries(now);
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

export async function preAuthRateLimit(c: Context, next: Next): Promise<Response | undefined> {
  const ip = readClientIp(c);
  if (!ip) {
    return fail(c, 503, "origin_unavailable", "Origine indisponibila.");
  }

  const key = `${PRE_AUTH_PREFIX}${ip}`;
  const now = Date.now();
  const entry = preAuthMap.get(key);

  if (!entry || now > entry.resetTime) {
    preAuthMap.set(key, { count: 1, resetTime: now + RATE_WINDOW });
  } else {
    entry.count += 1;
    if (entry.count > PRE_AUTH_LIMIT) {
      return fail(c, 429, "rate_limited", "Prea multe cereri neautentificate.");
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
