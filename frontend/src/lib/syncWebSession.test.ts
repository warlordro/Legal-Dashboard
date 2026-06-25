// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncWebSession } from "./api";

// Pass an explicit signal so the default AbortSignal.timeout(10s) timer is never
// created in tests (avoids dangling handles).
const dummySignal = (): AbortSignal => new AbortController().signal;

function stubFetch(res: { ok: boolean; status: number }): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(res as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("syncWebSession", () => {
  it("POSTs to the oauth2 bridge endpoint", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 });
    await syncWebSession(dummySignal());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/oauth2/sync");
    expect(init.method).toBe("POST");
  });

  it("maps HTTP responses to outcomes", async () => {
    stubFetch({ ok: true, status: 200 });
    expect(await syncWebSession(dummySignal())).toBe("ok");
    stubFetch({ ok: false, status: 403 });
    expect(await syncWebSession(dummySignal())).toBe("not_provisioned");
    stubFetch({ ok: false, status: 503 });
    expect(await syncWebSession(dummySignal())).toBe("unavailable");
    stubFetch({ ok: false, status: 400 });
    expect(await syncWebSession(dummySignal())).toBe("unavailable");
    stubFetch({ ok: false, status: 500 });
    expect(await syncWebSession(dummySignal())).toBe("error");
  });

  it("returns 'error' on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await syncWebSession(dummySignal())).toBe("error");
  });
});
