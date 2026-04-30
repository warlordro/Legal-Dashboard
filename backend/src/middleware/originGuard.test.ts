import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { originGuard } from "./originGuard.ts";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(),
}));

import { getConnInfo } from "@hono/node-server/conninfo";
const mockedGetConnInfo = vi.mocked(getConnInfo);

function buildApp(): Hono {
  const app = new Hono();
  app.use("/api/*", originGuard);
  app.get("/api/ping", (c) => c.json({ ok: true }));
  app.post("/api/mutate", (c) => c.json({ ok: true }));
  app.delete("/api/zap", (c) => c.json({ ok: true }));
  return app;
}

beforeEach(() => {
  mockedGetConnInfo.mockReset();
});

describe("originGuard — F2 CSRF defense", () => {
  it("passes GET requests through without checking Origin", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.5" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/ping");

    expect(res.status).toBe(200);
  });

  it("passes loopback callers through even on POST without Origin", async () => {
    // Electron renderer + dev tools fire from the local machine. Origin is
    // omitted by some clients (curl, integration tests) and must not gate
    // them out as long as the TCP peer is loopback.
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "127.0.0.1" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/mutate", {
      method: "POST",
      headers: { host: "example.com" },
    });

    expect(res.status).toBe(200);
  });

  it("rejects cross-origin POST from a non-loopback peer with 403 csrf_origin_mismatch", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.5" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/mutate", {
      method: "POST",
      headers: {
        host: "dashboard.lan",
        origin: "http://attacker.example",
      },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: "csrf_origin_mismatch" },
    });
  });

  it("accepts same-origin POST from a non-loopback peer", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.5" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/mutate", {
      method: "POST",
      headers: {
        host: "dashboard.lan",
        origin: "http://dashboard.lan",
      },
    });

    expect(res.status).toBe(200);
  });

  it("rejects non-loopback POST without Origin and without Referer", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.5" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/mutate", {
      method: "POST",
      headers: { host: "dashboard.lan" },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: "csrf_origin_mismatch" },
    });
  });

  it("falls back to Referer when Origin is absent (same-host -> allowed)", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.5" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/zap", {
      method: "DELETE",
      headers: {
        host: "dashboard.lan",
        referer: "http://dashboard.lan/some/page",
      },
    });

    expect(res.status).toBe(200);
  });

  it("treats ::1 (IPv6 loopback) as loopback", async () => {
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "::1" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/mutate", {
      method: "POST",
      headers: { host: "example.com" },
    });

    expect(res.status).toBe(200);
  });
});
