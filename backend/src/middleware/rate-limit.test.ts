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
});

// Bug 2 (v2.42.2): release-ul trebuie sa ruleze si pe caile de EXCEPTIE, dar
// numai cand autentificarea a reusit. Capcana evitata: pe throw-unwind getter-ul
// lazy c.res din Hono instantiaza Response(null) cu status 200 — un check naiv
// de status ar elibera exact tentativele neautentificate esuate.
describe("preAuthRateLimit — release pe caile de exceptie (Bug 2 v2.42.2)", () => {
  it("un throw FARA ownerId setat retine tentativa: a 61-a cerere e 429", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.60" },
    } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    app.use("*", requestIdContext);
    app.use("/api/*", preAuthRateLimit);
    app.post("/api/boom", () => {
      throw new Error("boom");
    });

    for (let i = 0; i < 60; i++) {
      const res = await app.request("/api/boom", { method: "POST" });
      expect(res.status).toBe(500);
    }

    const res61 = await app.request("/api/boom", { method: "POST" });
    expect(res61.status).toBe(429);
  });

  it("un throw DUPA ownerId setat elibereaza tentativa: 100 de cereri raman 500, niciodata 429", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.61" },
    } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    app.use("*", requestIdContext);
    app.use("/api/*", preAuthRateLimit);
    app.use("/api/*", async (c, next) => {
      c.set("ownerId", "user-1");
      await next();
    });
    app.post("/api/boom", () => {
      throw new Error("boom");
    });

    for (let i = 0; i < 100; i++) {
      const res = await app.request("/api/boom", { method: "POST" });
      expect(res.status).toBe(500);
    }
  });

  // Throw-urile non-Error NU sunt prinse de error handler-ul din frame-ul
  // handler-ului (compose-ul Hono le re-arunca), deci next() chiar REJECTEAZA
  // si app.request() insusi rejecteaza — exact calea de unwind pe care
  // release-ul v2.42.0 (dupa next(), fara finally) o sarea complet. Observam
  // bucket-ul prin comportament: o cerere blocata de limiter se REZOLVA cu
  // 429; o cerere care ajunge la handler REJECTEAZA.
  async function requestOutcome(
    app: Hono,
    path: string
  ): Promise<{ kind: "response"; status: number } | { kind: "rejected" }> {
    try {
      const res = await app.request(path, { method: "POST" });
      return { kind: "response", status: res.status };
    } catch {
      return { kind: "rejected" };
    }
  }

  it("un REJECT real al lui next() DUPA ownerId setat elibereaza tentativa (niciodata 429)", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.62" },
    } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    app.use("*", requestIdContext);
    app.use("/api/*", preAuthRateLimit);
    app.use("/api/*", async (c, next) => {
      c.set("ownerId", "user-2");
      await next();
    });
    app.post("/api/boom", () => {
      // throw non-Error intentionat: exact scenariul testat (reject real al lui next())
      throw "boom-string";
    });

    for (let i = 0; i < 100; i++) {
      // Fiecare cerere trebuie sa AJUNGA la handler (reject), nu sa fie
      // oprita de limiter (429) — bucket-ul se elibereaza la fiecare pas.
      expect(await requestOutcome(app, "/api/boom")).toEqual({ kind: "rejected" });
    }
  });

  it("un REJECT real al lui next() FARA ownerId retine tentativa (guard anti-regresie lazy c.res=200)", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.63" },
    } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    app.use("*", requestIdContext);
    app.use("/api/*", preAuthRateLimit);
    app.post("/api/boom", () => {
      // throw non-Error intentionat: exact scenariul testat (reject real al lui next())
      throw "boom-string";
    });

    for (let i = 0; i < 60; i++) {
      expect(await requestOutcome(app, "/api/boom")).toEqual({ kind: "rejected" });
    }

    // A 61-a e oprita de limiter INAINTE de handler → raspuns 429 real.
    expect(await requestOutcome(app, "/api/boom")).toEqual({ kind: "response", status: 429 });
  });
});

// Bug 3 (v2.42.1): analyze-multi costa 3 apeluri AI; routerul AI e montat dublu
// (/api/ai si /api/v1/ai). Weight-ul trebuie aplicat pe AMBELE path-uri si pe
// AMBELE bucket-uri (per-owner si per-token) — altfel ruta v1 permite ~3x
// bugetul intentionat, iar un PAT nu e ponderat deloc.
describe("weight 3x analyze-multi — ambele mount-uri + per-token (Bug 3 v2.42.1)", () => {
  function buildAppWithMulti(withToken: boolean): Hono {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("ownerId", "owner-w");
      if (withToken) c.set("tokenId", "tok-w");
      await next();
    });
    app.use("/api/*", rateLimit);
    app.post("/api/v1/ai/analyze-multi", (c) => c.json({ ok: true }));
    return app;
  }

  it("mount-ul /api/v1/ai/analyze-multi consuma 3 unitati pe bucketul per-owner (a 41-a cerere e 429)", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: "10.0.0.70" } } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithMulti(false);
    // RATE_LIMIT=120, weight 3 => 40 de cereri incap exact; a 41-a depaseste.
    for (let i = 0; i < RATE_LIMIT / 3; i++) {
      const res = await app.request("/api/v1/ai/analyze-multi", { method: "POST" });
      expect(res.status).toBe(200);
    }
    const over = await app.request("/api/v1/ai/analyze-multi", { method: "POST" });
    expect(over.status).toBe(429);
  });

  it("bucketul per-token pondereaza si el: TOKEN_RATE_LIMIT/3 cereri incap, urmatoarea e 429", async () => {
    mockedGetConnInfo.mockReturnValue({ remote: { address: "10.0.0.71" } } as ReturnType<typeof getConnInfo>);
    const app = buildAppWithMulti(true);
    for (let i = 0; i < TOKEN_RATE_LIMIT / 3; i++) {
      const res = await app.request("/api/v1/ai/analyze-multi", { method: "POST" });
      expect(res.status).toBe(200);
    }
    const over = await app.request("/api/v1/ai/analyze-multi", { method: "POST" });
    expect(over.status).toBe(429);
  });
});

// Bug 4 (v2.42.2): pe fereastra noua/expirata bucket-ul se seta la count=weight
// FARA verificarea plafonului — cu LEGAL_DASHBOARD_TOKEN_RATE_LIMIT sub 3
// (clamp-ul permite 1-2), primul request ponderat din fiecare fereastra scapa
// neplafonat. Limita se citeste la import, deci testul re-importa modulul cu
// env-ul setat (module proaspete = maps proaspete).
describe("plafon pe fereastra proaspata (Bug 4 v2.42.2)", () => {
  it("TOKEN_RATE_LIMIT=2: primul analyze-multi (weight 3) dintr-o fereastra noua e 429", async () => {
    vi.resetModules();
    const prev = process.env.LEGAL_DASHBOARD_TOKEN_RATE_LIMIT;
    process.env.LEGAL_DASHBOARD_TOKEN_RATE_LIMIT = "2";
    try {
      const { rateLimit: freshRateLimit } = await import("./rate-limit.ts");
      mockedGetConnInfo.mockReturnValue({ remote: { address: "10.0.0.80" } } as ReturnType<typeof getConnInfo>);
      const app = new Hono();
      app.use("*", async (c, next) => {
        c.set("ownerId", "owner-f");
        c.set("tokenId", "tok-f");
        await next();
      });
      app.use("/api/*", freshRateLimit);
      app.post("/api/v1/ai/analyze-multi", (c) => c.json({ ok: true }));

      const res = await app.request("/api/v1/ai/analyze-multi", { method: "POST" });
      expect(res.status).toBe(429);
    } finally {
      if (prev === undefined) {
        // biome-ignore lint/performance/noDelete: env trebuie unset real
        delete process.env.LEGAL_DASHBOARD_TOKEN_RATE_LIMIT;
      } else {
        process.env.LEGAL_DASHBOARD_TOKEN_RATE_LIMIT = prev;
      }
      vi.resetModules();
    }
  });
});
