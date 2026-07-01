import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { patSecurity } from "./patSecurity.ts";

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

type Handler = (c: import("hono").Context) => Response | Promise<Response>;

function appWith(tokenId: string | undefined, handler?: Handler) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (tokenId) c.set("tokenId", tokenId);
    await next();
  });
  app.use("*", patSecurity);
  app.all("*", handler ?? ((c) => c.text("ok")));
  return app;
}

describe("patSecurity", () => {
  it("sets Cache-Control: no-store (+ Pragma) on a PAT GET response", async () => {
    const res = await appWith("tok1").request("/api/dosare");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("pragma")).toBe("no-cache");
  });

  it("does NOT set no-store for a non-PAT (JWT/desktop) request", async () => {
    const res = await appWith(undefined).request("/api/dosare");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("propagates no-store onto a downstream 403 response (header set before next)", async () => {
    const res = await appWith("tok1", (c) => c.json({ data: null }, 403)).request("/api/ai");
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a PAT over non-HTTPS in production with 426", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.LEGAL_DASHBOARD_PAT_ALLOW_HTTP;
    const res = await appWith("tok1").request("/api/dosare"); // no x-forwarded-proto
    expect(res.status).toBe(426);
  });

  it("allows a PAT over HTTPS in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.LEGAL_DASHBOARD_PAT_ALLOW_HTTP;
    const res = await appWith("tok1").request("/api/dosare", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("allows non-HTTPS PAT in production when LEGAL_DASHBOARD_PAT_ALLOW_HTTP=1 (dev/loopback escape)", async () => {
    process.env.NODE_ENV = "production";
    process.env.LEGAL_DASHBOARD_PAT_ALLOW_HTTP = "1";
    const res = await appWith("tok1").request("/api/dosare");
    expect(res.status).toBe(200);
  });

  it("does not enforce HTTPS for non-PAT requests in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.LEGAL_DASHBOARD_PAT_ALLOW_HTTP;
    const res = await appWith(undefined).request("/api/dosare");
    expect(res.status).toBe(200);
  });
});
