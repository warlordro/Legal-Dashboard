import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  rateLimit,
  preAuthRateLimit,
  resetPreAuthRateLimit,
  _resetRateLimitForTest,
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

describe("rateLimit — fail-closed semantics", () => {
  it("rejects with 503 when the runtime cannot surface a remote address", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: undefined } } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/ping");

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringMatching(/indisponibil/i) });
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
    // Without fail-closed, two anon callers would share a 30-req bucket; with
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

    // Drain owner alice. RATE_LIMIT is 30; the 30 should pass, the 31st 429.
    for (let i = 0; i < 30; i++) {
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
    // Owner alice from IP_A burns 30; owner alice from IP_B is independent
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
        }) as ReturnType<typeof getConnInfo>,
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
        401,
      ),
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
});
