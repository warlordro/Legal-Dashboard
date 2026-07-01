import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { patCapabilityGate } from "./patCapabilityGate.ts";

function appWith(tokenScopes?: string[], tokenId?: string) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tokenScopes", tokenScopes);
    c.set("tokenId", tokenId);
    await next();
  });
  app.use("*", patCapabilityGate);
  app.all("*", (c) => c.text("ok"));
  return app;
}

describe("patCapabilityGate", () => {
  it("allows a scoped PAT on its capability route", async () => {
    const res = await appWith(["dosare"], "tok1").request("/api/dosare?x=1");
    expect(res.status).toBe(200);
  });

  it("blocks a dosare-scoped PAT on the ICCJ route (segment boundary)", async () => {
    const res = await appWith(["dosare"], "tok1").request("/api/dosare-iccj");
    expect(res.status).toBe(403);
  });

  it("default-denies a PAT on /api/ai", async () => {
    const res = await appWith(["dosare", "iccj", "rnpm"], "tok1").request("/api/ai/analyze", { method: "POST" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("PAT_ROUTE_FORBIDDEN");
  });

  it("is a no-op for non-PAT sessions (no tokenId)", async () => {
    const res = await appWith(undefined, undefined).request("/api/ai/analyze", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("allows an iccj-scoped PAT on GET /api/dosare-iccj (ICCJ is GET, fix PAT-001)", async () => {
    const res = await appWith(["iccj"], "tok1").request("/api/dosare-iccj?numarDosar=1/1/2025");
    expect(res.status).toBe(200);
  });

  it("allows an rnpm-scoped PAT on POST /api/rnpm/search", async () => {
    const res = await appWith(["rnpm"], "tok1").request("/api/rnpm/search", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("exact-matches POST /api/rnpm/search: a sub-route (search/:id/filter) is default-denied", async () => {
    const res = await appWith(["rnpm"], "tok1").request("/api/rnpm/search/abc/filter", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("blocks a write method under a GET-only allowed prefix", async () => {
    const res = await appWith(["dosare"], "tok1").request("/api/dosare", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("requires exact scope membership (dosare does not satisfy the iccj requirement)", async () => {
    // route matches iccj cap by method+path, but ["dosare"] lacks "iccj" → INSUFFICIENT_SCOPE
    const res = await appWith(["dosare"], "tok1").request("/api/dosare-iccj");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("returns insufficient_scope when path/method match but scope is absent", async () => {
    // iccj route matches by method+path, but token lacks iccj scope
    const res = await appWith(["dosare", "rnpm"], "tok1").request("/api/dosare-iccj");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("denies an unknown subroute under an allowed prefix (DELETE /api/rnpm/saved/abc)", async () => {
    const res = await appWith(["rnpm"], "tok1").request("/api/rnpm/saved/abc", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("returns pat_cannot_manage_tokens for a PAT on /api/v1/tokens", async () => {
    const res = await appWith(["dosare"], "tok1").request("/api/v1/tokens", { method: "POST" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("PAT_CANNOT_MANAGE_TOKENS");
  });

  it("does not let /api/dosare cap leak into /api/dosare-iccj", async () => {
    const res = await appWith(["dosare"], "tok1").request("/api/dosare-iccj");
    expect(res.status).toBe(403);
  });

  it("v2.2: allows an encoded slash in the QUERY string (numarDosar=4821%2F3%2F2024)", async () => {
    const res = await appWith(["dosare"], "tok1").request("/api/dosare?numarDosar=4821%2F3%2F2024");
    expect(res.status).toBe(200);
  });

  it("blocks an encoded slash in the PATH (suspicious)", async () => {
    const res = await appWith(["dosare"], "tok1").request("/api/dosare%2f..%2fai");
    expect(res.status).toBe(403);
  });
});
