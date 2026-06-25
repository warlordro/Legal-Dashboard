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
});
