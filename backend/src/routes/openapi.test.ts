import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { openapiRouter } from "./openapi.ts";

function app() {
  const a = new Hono();
  a.route("/api/v1/openapi.json", openapiRouter);
  return a;
}

describe("openapi.json", () => {
  it("serves a valid OpenAPI 3.1 spec (application/json)", async () => {
    const res = await app().request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const spec = (await res.json()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { securitySchemes: { bearerAuth: { scheme: string } } };
    };
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });

  it("documents the correct method per route (ICCJ = GET, RNPM search = POST)", async () => {
    const spec = (await (await app().request("/api/v1/openapi.json")).json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(spec.paths["/api/dosare"]?.get).toBeDefined();
    expect(spec.paths["/api/dosare-iccj"]?.get).toBeDefined();
    expect(spec.paths["/api/dosare-iccj"]?.post).toBeUndefined();
    expect(spec.paths["/api/rnpm/search"]?.post).toBeDefined();
    // token management routes are documented too
    expect(spec.paths["/api/v1/tokens"]).toBeDefined();
  });

  it("documents all query params the /api/dosare route accepts (institutie, dataStart, dataStop)", async () => {
    const spec = (await (await app().request("/api/v1/openapi.json")).json()) as {
      paths: Record<string, { get?: { parameters?: Array<{ name: string }> } }>;
    };
    const names = (spec.paths["/api/dosare"]?.get?.parameters ?? []).map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(["numarDosar", "numeParte", "obiectDosar", "institutie", "dataStart", "dataStop"])
    );
  });

  it("overrides bearer auth with session-cookie auth on token-management routes", async () => {
    const spec = (await (await app().request("/api/v1/openapi.json")).json()) as {
      components: { securitySchemes: Record<string, unknown> };
      paths: Record<string, Record<string, { security?: Array<Record<string, unknown>> }>>;
    };
    expect(spec.components.securitySchemes.sessionCookie).toBeDefined();
    expect(spec.paths["/api/v1/tokens"].post.security).toEqual([{ sessionCookie: [] }]);
    expect(spec.paths["/api/v1/tokens/revoke-all"].post.security).toEqual([{ sessionCookie: [] }]);
  });
});
