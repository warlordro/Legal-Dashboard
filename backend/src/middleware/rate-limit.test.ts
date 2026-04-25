import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "./rate-limit.ts";

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
});

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
