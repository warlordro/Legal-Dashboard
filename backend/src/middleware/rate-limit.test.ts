import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  rateLimit,
  preAuthRateLimit,
  resetPreAuthRateLimit,
  _resetRateLimitForTest,
  _sweepRateLimitNowForTest,
  RATE_LIMIT,
  TOKEN_RATE_LIMIT,
  clampTokenRateLimit,
} from "./rate-limit.ts";
import { requestIdContext } from "./requestId.ts";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(),
}));

import { getConnInfo } from "@hono/node-server/conninfo";
const mockedGetConnInfo = vi.mocked(getConnInfo);

function buildApp(): Hono {
  const app = new Hono();
  app.use("/api/*", rateLimit);
  app.get("/api/ping", (c) => c.json({ ok: true }));
  return app;
}

beforeEach(() => {
  mockedGetConnInfo.mockReset();
  _resetRateLimitForTest();
  resetPreAuthRateLimit();
});

function buildAppWithOwner(): Hono {
  const app = new Hono();
  // Stand-in for ownerContext: take owner from a header so individual tests
  // can drive owner identity without booting the real auth seam.
  app.use("*", async (c, next) => {
    const owner = c.req.header("x-test-owner") ?? "local";
    c.set("ownerId", owner);
    await next();
  });
  app.use("/api/*", rateLimit);
  app.get("/api/ping", (c) => c.json({ ok: true }));
  return app;
}

// Stand-in ownerContext care seteaza si tokenId (PAT) din header, pentru testele per-token.
function buildAppWithToken(): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", c.req.header("x-test-owner") ?? "local");
    const t = c.req.header("x-test-token");
    if (t) c.set("tokenId", t);
    await next();
  });
  app.use("/api/*", rateLimit);
  app.get("/api/ping", (c) => c.json({ ok: true }));
  app.get("/api/rnpm/saved", (c) => c.json({ ok: true }));
  return app;
}

// Stand-in ownerContext + AI routes registered on BOTH mounted paths, mirroring
// index.ts's dual app.route("/api/ai", aiRouter) / app.route("/api/v1/ai", aiRouter).
function buildAppWithAiRoutes(): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", c.req.header("x-test-owner") ?? "local");
    const t = c.req.header("x-test-token");
    if (t) c.set("tokenId", t);
    await next();
  });
  app.use("/api/*", rateLimit);
  app.post("/api/ai/analyze-multi", (c) => c.json({ ok: true }));
  app.post("/api/v1/ai/analyze-multi", (c) => c.json({ ok: true }));
  return app;
}

// FIX 1 (HIGH): weight-3 must apply on BOTH mounted paths. Pre-fix, the exact-match
// check only covered /api/ai/analyze-multi, so aiRouter's other mount point
// (/api/v1/ai — index.ts) let the multi-agent endpoint through at weight 1.
describe("rateLimit — FIX 1: analyze-multi weight applies on both mounted paths", () => {
  it("consumes weight 3 per request on /api/v1/ai/analyze-multi (regression: dual mount)", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: "10.0.0.70" } } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithAiRoutes();
    const maxRequests = Math.floor(RATE_LIMIT / 3);

    for (let i = 0; i < maxRequests; i++) {
      const res = await app.request("/api/v1/ai/analyze-multi", {
        method: "POST",
        headers: { "x-test-owner": "alice" },
      });
      expect(res.status).toBe(200);
    }
    const limited = await app.request("/api/v1/ai/analyze-multi", {
      method: "POST",
      headers: { "x-test-owner": "alice" },
    });
    expect(limited.status).toBe(429);
  });

  it("also applies weight 3 on the legacy /api/ai/analyze-multi path", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: "10.0.0.71" } } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithAiRoutes();
    const maxRequests = Math.floor(RATE_LIMIT / 3);

    for (let i = 0; i < maxRequests; i++) {
      const res = await app.request("/api/ai/analyze-multi", {
        method: "POST",
        headers: { "x-test-owner": "alice" },
      });
      expect(res.status).toBe(200);
    }
    const limited = await app.request("/api/ai/analyze-multi", {
      method: "POST",
      headers: { "x-test-owner": "alice" },
    });
    expect(limited.status).toBe(429);
  });
});

// FIX 2 (MEDIUM): the per-token (PAT) bucket must also burn `weight` units, not a
// flat 1 — pre-fix, a PAT hammering analyze-multi only counted as 1 unit/call there.
describe("rateLimit — FIX 2: weight applies to the per-token (PAT) bucket", () => {
  it("burns TOKEN_RATE_LIMIT in 1/3 as many requests on the weighted endpoint", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: "10.0.0.72" } } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithAiRoutes();
    const maxRequests = Math.floor(TOKEN_RATE_LIMIT / 3);

    for (let i = 0; i < maxRequests; i++) {
      const res = await app.request("/api/v1/ai/analyze-multi", {
        method: "POST",
        headers: { "x-test-token": "tokC" },
      });
      expect(res.status).toBe(200);
    }
    const limited = await app.request("/api/v1/ai/analyze-multi", {
      method: "POST",
      headers: { "x-test-token": "tokC" },
    });
    expect(limited.status).toBe(429);
  });
});

describe("clampTokenRateLimit — defensive env parsing", () => {
  it("defaults to 60 for non-finite / non-positive input", () => {
    expect(clampTokenRateLimit(Number.NaN)).toBe(60);
    expect(clampTokenRateLimit(Number.POSITIVE_INFINITY)).toBe(60);
    expect(clampTokenRateLimit(0)).toBe(60);
  });
  it("never returns a negative limit (a negative would 429 every request)", () => {
    expect(clampTokenRateLimit(-5)).toBe(60);
    expect(clampTokenRateLimit(-5)).toBeGreaterThan(0);
  });
  it("floors non-integer values", () => {
    expect(clampTokenRateLimit(60.9)).toBe(60);
  });
  it("caps at the per-owner ceiling (per-token cannot be looser than per-owner)", () => {
    expect(clampTokenRateLimit(1_000_000, 120)).toBe(120);
    expect(clampTokenRateLimit(90, 120)).toBe(90);
  });
  it("the exported TOKEN_RATE_LIMIT is a finite positive integer <= RATE_LIMIT", () => {
    expect(Number.isInteger(TOKEN_RATE_LIMIT)).toBe(true);
    expect(TOKEN_RATE_LIMIT).toBeGreaterThan(0);
    expect(TOKEN_RATE_LIMIT).toBeLessThanOrEqual(RATE_LIMIT);
  });
});

describe("rateLimit — per-token (PAT)", () => {
  it("throttles per-token below the per-owner ceiling", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: "10.0.0.9" } } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithToken();
    let last = 200;
    // TOKEN_RATE_LIMIT (60) < RATE_LIMIT (120): tokenul e blocat inainte ca bucket-ul
    // per-owner sa atinga plafonul.
    for (let i = 0; i < TOKEN_RATE_LIMIT + 1; i++) {
      const res = await app.request("/api/ping", { headers: { "x-test-token": "tokA" } });
      last = res.status;
    }
    expect(last).toBe(429);
    expect(TOKEN_RATE_LIMIT).toBeLessThan(RATE_LIMIT);
  });

  it("rate-limits a PAT even on GET /api/rnpm/saved (fix R05 — no bypass for PATs)", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: "10.0.0.10" } } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithToken();
    let last = 200;
    for (let i = 0; i < TOKEN_RATE_LIMIT + 1; i++) {
      const res = await app.request("/api/rnpm/saved", { headers: { "x-test-token": "tokB" } });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("still exempts a non-PAT GET /api/rnpm/saved from the per-owner limit", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: "10.0.0.11" } } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithToken();
    let last = 200;
    for (let i = 0; i < RATE_LIMIT + 5; i++) {
      const res = await app.request("/api/rnpm/saved"); // fara token → exceptat ca inainte
      last = res.status;
    }
    expect(last).toBe(200);
  });
});

describe("rateLimit — fail-closed semantics", () => {
  it("rejects with 503 when the runtime cannot surface a remote address", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: undefined } } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/ping");

    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      data: null;
      error: { code: string; message: string };
      requestId: string;
    };
    // v2.14.0: rate-limit responses use the standard `{ data, error: { code,
    // message }, requestId }` envelope — same shape every other v1 route
    // emits. Pre-v2.14.0 the body was `{ error: "<string>" }`, which the
    // frontend's unwrapAlerts couldn't parse and surfaced as "Eroare
    // necunoscuta" on rapid clicks.
    expect(body.error.code).toBe("origin_unavailable");
    expect(body.error.message).toMatch(/indisponibil/i);
  });

  it("rejects with 503 on empty-string IP (treated as missing)", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: "" } } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/ping");

    expect(res.status).toBe(503);
  });

  it("allows the request through when the remote address is present", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: "127.0.0.1" } } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/ping");

    expect(res.status).toBe(200);
  });

  it("does not bucket two distinct callers into a shared 'unknown' slot", async () => {
    // Without fail-closed, two anon callers would share one bucket; with
    // fail-closed both get 503 separately and never converge into one bucket.
    mockedGetConnInfo.mockReturnValue({ remote: { address: undefined } } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const a = await app.request("/api/ping");
    const b = await app.request("/api/ping");
    const c = await app.request("/api/ping");

    expect(a.status).toBe(503);
    expect(b.status).toBe(503);
    expect(c.status).toBe(503);
  });
});

// Tier 3 #15: per-owner bucket isolation. Today buckets are keyed only by IP,
// so a noisy owner sharing a NAT (or, post-PR-9, two web-mode tenants behind
// the same egress proxy) can DOS every other owner. After the fix, the bucket
// key is `${ip}|${ownerId}` so each owner has their own ceiling.
describe("rateLimit — per-owner isolation", () => {
  it("owner A exhausting their bucket does NOT affect owner B on the same IP", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.5" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithOwner();

    // Drain owner alice up to RATE_LIMIT requests; the next one must 429.
    for (let i = 0; i < RATE_LIMIT; i++) {
      const r = await app.request("/api/ping", {
        headers: { "x-test-owner": "alice" },
      });
      expect(r.status).toBe(200);
    }
    const aliceExhausted = await app.request("/api/ping", {
      headers: { "x-test-owner": "alice" },
    });
    expect(aliceExhausted.status).toBe(429);

    // Owner bob (same IP, different owner) must still pass — proves buckets
    // are isolated by owner. With the pre-fix IP-only key this asserts 429
    // and FAILS, which is the regression we are guarding against.
    const bobAllowed = await app.request("/api/ping", {
      headers: { "x-test-owner": "bob" },
    });
    expect(bobAllowed.status).toBe(200);
  });

  it("owner A and owner B share the same rate budget when on different IPs (sanity)", async () => {
    // Owner alice from IP_A burns RATE_LIMIT; owner alice from IP_B is independent
    // because the IP component still scopes the bucket.
    mockedGetConnInfo.mockReturnValueOnce({
      remote: { address: "10.0.0.10" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithOwner();

    // Alternate IP per request — each request gets exactly one mock return.
    const ips = ["10.0.0.10", "10.0.0.11"];
    let i = 0;
    mockedGetConnInfo.mockImplementation(
      () =>
        ({
          remote: { address: ips[i++ % ips.length] },
        }) as ReturnType<typeof getConnInfo>
    );

    // Two requests, same owner, different IPs — both pass and seed two buckets.
    const r1 = await app.request("/api/ping", {
      headers: { "x-test-owner": "alice" },
    });
    const r2 = await app.request("/api/ping", {
      headers: { "x-test-owner": "alice" },
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it("requests with no owner in context fall back to the default 'local' bucket", async () => {
    // Forward-compat with web-mode: even if a route somehow runs before
    // ownerContext, rateLimit still produces a deterministic bucket key.
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.99" },
    } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    // No ownerContext → c.get("ownerId") is undefined → rate-limit must
    // synthesize "local" so the bucket key is still well-formed.
    app.use("/api/*", rateLimit);
    app.get("/api/ping", (c) => c.json({ ok: true }));

    const r = await app.request("/api/ping");
    expect(r.status).toBe(200);
  });
});

// v2.14.0 — 429 envelope shape regression. Pre-fix the body was a bare
// `{ error: "Prea multe cereri..." }`, which the Alerts page's unwrapAlerts
// could not parse and surfaced as the generic "Eroare necunoscuta" toast on
// rapid-click dismiss. Locking the standard `{ data, error: { code, message },
// requestId }` envelope here so any future regression is caught in CI.
describe("rateLimit — 429 response envelope", () => {
  it("emits the standard {data, error:{code,message}, requestId} envelope on 429", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.42" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithOwner();

    // Burn the RATE_LIMIT budget for one (ip, owner) bucket.
    for (let i = 0; i < RATE_LIMIT; i++) {
      const r = await app.request("/api/ping", {
        headers: { "x-test-owner": "alice" },
      });
      expect(r.status).toBe(200);
    }

    const limited = await app.request("/api/ping", {
      headers: { "x-test-owner": "alice" },
    });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as {
      data: null;
      error: { code: string; message: string };
      requestId: string;
    };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toMatch(/prea multe cereri/i);
    expect(typeof body.requestId).toBe("string");
  });
});

// v2.20.8 — Batch 4.5: sweep periodic ca sa nu acumulam entries pe long-running.
describe("rateLimit — periodic sweep (Batch 4.5)", () => {
  it("sweep removes entries whose resetTime is in the past", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.60" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithOwner();

    // Seed bucket cu o cerere.
    const r1 = await app.request("/api/ping", {
      headers: { "x-test-owner": "alice" },
    });
    expect(r1.status).toBe(200);

    // Force-sweep cu un now mult in viitor (peste fereastra de 60s).
    _sweepRateLimitNowForTest(Date.now() + 5 * 60_000);

    // Drain pana la RATE_LIMIT noi cereri trebuie sa treaca — daca sweep-ul a
    // sters entry-ul, bucket-ul reincepe de la 0; daca nu, contorul precedent
    // ar fi tras peste limita mai devreme.
    for (let i = 0; i < RATE_LIMIT; i++) {
      const r = await app.request("/api/ping", {
        headers: { "x-test-owner": "alice" },
      });
      expect(r.status).toBe(200);
    }
  });

  it("sweep keeps entries whose resetTime is still in the future", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.61" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithOwner();

    // Burn the bucket up to limit.
    for (let i = 0; i < RATE_LIMIT; i++) {
      const r = await app.request("/api/ping", {
        headers: { "x-test-owner": "bob" },
      });
      expect(r.status).toBe(200);
    }

    // Sweep cu now = acum (entry inca valid → nu trebuie sters).
    _sweepRateLimitNowForTest(Date.now());

    // Urmatoarea cerere trebuie sa fie 429 — sweep-ul nu a sters bucket-ul.
    const limited = await app.request("/api/ping", {
      headers: { "x-test-owner": "bob" },
    });
    expect(limited.status).toBe(429);
  });
});

describe("PR-9 fix B2 - pre-auth rate limit", () => {
  it("returns 429 on the 61st failed unauthenticated request from the same IP", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.50" },
    } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    app.use("*", requestIdContext);
    app.use("/api/*", preAuthRateLimit);
    app.get("/api/ping", (c) =>
      c.json(
        {
          data: null,
          error: { code: "unauthorized", message: "Authentication token is required." },
          requestId: c.get("requestId"),
        },
        401
      )
    );

    for (let i = 0; i < 60; i++) {
      const res = await app.request("/api/ping");
      expect(res.status).toBe(401);
    }

    const limited = await app.request("/api/ping");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      data: null,
      error: { code: "rate_limited" },
      requestId: expect.any(String),
    });
  });

  it("retine bucket-ul pentru requesturi care ajung in 404", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.52" },
    } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    app.use("*", requestIdContext);
    app.use("/api/*", preAuthRateLimit);

    for (let i = 0; i < 60; i++) {
      const res = await app.request("/api/missing");
      expect(res.status).toBe(404);
    }

    const limited = await app.request("/api/missing");
    expect(limited.status).toBe(429);
  });

  it("retine bucket-ul pentru requesturi care ajung in 500", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.53" },
    } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    app.use("*", requestIdContext);
    app.use("/api/*", preAuthRateLimit);
    app.get("/api/boom", (c) => c.json({ error: "boom" }, 500));

    for (let i = 0; i < 60; i++) {
      const res = await app.request("/api/boom");
      expect(res.status).toBe(500);
    }

    const limited = await app.request("/api/boom");
    expect(limited.status).toBe(429);
  });

  it("retine bucket-ul pentru requesturi care ajung in 403", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.54" },
    } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    app.use("*", requestIdContext);
    app.use("/api/*", preAuthRateLimit);
    app.get("/api/denied", (c) =>
      c.json(
        {
          data: null,
          error: { code: "forbidden", message: "Acces interzis." },
          requestId: c.get("requestId"),
        },
        403
      )
    );

    for (let i = 0; i < 60; i++) {
      const res = await app.request("/api/denied");
      expect(res.status).toBe(403);
    }

    const limited = await app.request("/api/denied");
    expect(limited.status).toBe(429);
  });

  it("does not consume the pre-auth bucket for successful authenticated requests", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.51" },
    } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    app.use("*", requestIdContext);
    app.use("/api/*", preAuthRateLimit);
    app.get("/api/ping", (c) => c.json({ ok: true, requestId: c.get("requestId") }));

    for (let i = 0; i < 61; i++) {
      const res = await app.request("/api/ping", {
        headers: { authorization: "Bearer valid-token-shape" },
      });
      expect(res.status).toBe(200);
    }
  });

  // FIX 3 (MEDIUM): release must run in `finally`. Pre-fix, `await next()` was
  // followed by a bare conditional release — if the downstream handler threw AFTER
  // ownerContext set ownerId, the release line never ran, and the pre-auth bucket
  // (shared per-IP) silently accumulated toward PRE_AUTH_LIMIT.
  it("releases the pre-auth bucket even when the downstream handler throws after auth succeeds", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.55" },
    } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    app.use("*", requestIdContext);
    app.use("/api/*", preAuthRateLimit);
    app.get("/api/boom-auth", (c) => {
      c.set("ownerId", "alice"); // simulates ownerContext having authenticated successfully
      throw new Error("downstream boom");
    });

    // Pre-fix, the leaked bucket would exhaust by request #61 and this loop would
    // see a spurious 429 instead of Hono's default 500 for the thrown error.
    for (let i = 0; i < 100; i++) {
      const res = await app.request("/api/boom-auth");
      expect(res.status).toBe(500);
    }
  });
});
