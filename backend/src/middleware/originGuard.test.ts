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

// F11-F1 caracterizare: edge cases identificate la review-ul de hardening
// 2026-05-14. originGuard ramane cu loopback bypass intact — protectia
// suplimentara pentru body-less admin POSTs e mutata pe requireDesktopHeader
// (rute admin specifice). Aceste teste fixeaza comportamentul existent +
// cazurile noi descoperite, ca regressie future-proof.
describe("originGuard — F11-F1 edge case characterization", () => {
  it("accepts Origin: 'null' (Electron file://) on loopback", async () => {
    // Electron in prod incarca rendererul de pe file:// — browserul trimite
    // Origin: "null" literal. Combinat cu loopback bypass, request-ul trece.
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "127.0.0.1" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/mutate", {
      method: "POST",
      headers: { host: "127.0.0.1:3002", origin: "null" },
    });

    expect(res.status).toBe(200);
  });

  it("accepts Referer: file://... on loopback", async () => {
    // Variant Referer-only pentru Electron file://. Loopback bypass-ul nu
    // examineaza Origin/Referer, deci trece.
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "127.0.0.1" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/zap", {
      method: "DELETE",
      headers: {
        host: "127.0.0.1:3002",
        referer: "file:///C:/Users/dev/app/index.html",
      },
    });

    expect(res.status).toBe(200);
  });

  it("treats ::ffff:127.0.0.1 (IPv4-mapped IPv6 loopback) as loopback", async () => {
    // Node poate raporta peer-ul IPv4 ca IPv4-mapped IPv6 cand socket-ul
    // backend-ului asculta dual-stack. LOOPBACK_ADDRESSES include forma.
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "::ffff:127.0.0.1" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/mutate", {
      method: "POST",
      headers: { host: "example.com" },
    });

    expect(res.status).toBe(200);
  });

  it("rejects when remote.address is undefined (fail-closed on missing peer info)", async () => {
    // Daca proxy/transport e mis-configurat si nu pune adresa peer-ului,
    // `remoteAddr` devine "" — NU e in LOOPBACK_ADDRESSES, deci cade pe
    // path-ul CSRF normal. Fara Origin/Referer, returneaza 403.
    mockedGetConnInfo.mockReturnValue({
      remote: { address: undefined as unknown as string },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/mutate", {
      method: "POST",
      headers: { host: "dashboard.lan" },
    });

    expect(res.status).toBe(403);
  });

  it("returns envelope-shaped error body (data: null, requestId)", async () => {
    // F11-F1 Stage 1: aliniere cu envelope-ul PR-6 { data, error, requestId }
    // peste tot in surface-ul de API. Verifica ca refuzul include cele 3
    // chei standardizate.
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
      data: null,
      error: { code: "csrf_origin_mismatch", message: expect.any(String) },
      requestId: expect.any(String),
    });
  });

  it("rejects Origin host with port mismatch on non-loopback", async () => {
    // safeHost include portul in `host` URL — `example.com:8080` !=
    // `example.com:3002`. Verifica ca politica nu lasa port-confusion sa
    // bypass-eze CSRF.
    mockedGetConnInfo.mockReturnValue({
      remote: { address: "10.0.0.5" },
    } as ReturnType<typeof getConnInfo>);
    const app = buildApp();

    const res = await app.request("/api/mutate", {
      method: "POST",
      headers: {
        host: "dashboard.lan:3002",
        origin: "http://dashboard.lan:8080",
      },
    });

    expect(res.status).toBe(403);
  });
});
