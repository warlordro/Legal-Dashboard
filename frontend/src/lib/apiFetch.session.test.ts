// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";

const SYNC = "/api/v1/auth/oauth2/sync";

function setDesktop(on: boolean): void {
  const w = window as unknown as { desktopApi?: unknown };
  w.desktopApi = on ? {} : undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setDesktop(false);
});

describe("apiFetch 401 session recovery", () => {
  it("web: re-mints via the bridge and retries the request once on 401", async () => {
    setDesktop(false);
    let meCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === SYNC) return Promise.resolve({ ok: true, status: 200 } as Response);
      meCalls += 1;
      return Promise.resolve({ ok: meCalls > 1, status: meCalls > 1 ? 200 : 401 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/me");

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/v1/me", SYNC, "/api/v1/me"]);
  });

  it("web: does NOT retry when the re-mint itself fails", async () => {
    setDesktop(false);
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input) === SYNC ? ({ ok: false, status: 403 } as Response) : ({ ok: false, status: 401 } as Response)
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/me");

    expect(res.status).toBe(401);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/v1/me", SYNC]); // no retry
  });

  it("web: never intercepts a 401 on the auth endpoints themselves", async () => {
    setDesktop(false);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 401 } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/auth/refresh", { method: "POST" });

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("desktop: never intercepts (auth is local, no bridge call)", async () => {
    setDesktop(true);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 401 } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/me");

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("web: passes through a non-401 response untouched", async () => {
    setDesktop(false);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/me");

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("web: normalizes a Request input — auth endpoint is not intercepted", async () => {
    setDesktop(false);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 401 } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch(new Request("http://localhost/api/v1/auth/refresh", { method: "POST" }));

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1); // skipped via pathname, no re-mint
  });

  it("web: concurrent 401s collapse to a single deduped bridge re-mint", async () => {
    setDesktop(false);
    let syncCalls = 0;
    let openSync: (r: Response) => void = () => {};
    const syncGate = new Promise<Response>((resolve) => {
      openSync = resolve;
    });
    const seen = new Map<string, number>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === SYNC) {
        syncCalls += 1;
        return syncGate;
      }
      const n = seen.get(url) ?? 0;
      seen.set(url, n + 1);
      return Promise.resolve({ ok: n >= 1, status: n >= 1 ? 200 : 401 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const p1 = apiFetch("/api/v1/a");
    const p2 = apiFetch("/api/v1/b");
    // Let both initial requests resolve to 401 and both enter the deduped re-mint
    // before the single bridge POST is allowed to settle.
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    openSync({ ok: true, status: 200 } as Response);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(syncCalls).toBe(1); // one bridge POST shared by both retries
  });

  it("web: a non-auth URL with /api/v1/auth/ only in the query is still intercepted", async () => {
    setDesktop(false);
    let meCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === SYNC) return Promise.resolve({ ok: true, status: 200 } as Response);
      meCalls += 1;
      return Promise.resolve({ ok: meCalls > 1, status: meCalls > 1 ? 200 : 401 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/v1/me?next=/api/v1/auth/x");

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(SYNC); // pathname is /api/v1/me -> re-mint ran
  });
});
