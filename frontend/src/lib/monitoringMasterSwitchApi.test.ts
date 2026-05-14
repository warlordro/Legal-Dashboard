// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { monitoringMasterSwitch } from "./monitoringMasterSwitchApi";
import { MonitoringApiError } from "./api";

// Stub the global fetch the same way alertsApi.test.ts does — apiFetch is a
// thin pass-through that calls fetch(), so we don't need a vi.mock of "./api".

let lastCalledUrl: string | null = null;
let lastInit: RequestInit | undefined;

function envelopeOk<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId: "test-req-id" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function envelopeError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ data: null, error: { code, message }, requestId: "test-req-id" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  lastCalledUrl = null;
  lastInit = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("monitoringMasterSwitch.get", () => {
  it("GETs the bare /master-switch path and returns enabled flag from envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        lastCalledUrl = url;
        lastInit = init;
        return envelopeOk({ enabled: true });
      })
    );
    const result = await monitoringMasterSwitch.get();
    expect(lastCalledUrl).toBe("/api/v1/monitoring/master-switch");
    expect(lastInit?.method).toBeUndefined();
    expect(result).toEqual({ enabled: true });
  });

  it("forwards the abort signal in the request init", async () => {
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined;
        return envelopeOk({ enabled: false });
      })
    );
    const ctrl = new AbortController();
    await monitoringMasterSwitch.get({ signal: ctrl.signal });
    expect(observedSignal).toBe(ctrl.signal);
  });
});

describe("monitoringMasterSwitch.set", () => {
  it("PUTs JSON body { enabled: true } with the right content-type and returns { enabled, changed }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        lastCalledUrl = url;
        lastInit = init;
        return envelopeOk({ enabled: true, changed: true });
      })
    );
    const result = await monitoringMasterSwitch.set(true);
    expect(lastCalledUrl).toBe("/api/v1/monitoring/master-switch");
    expect(lastInit?.method).toBe("PUT");
    const headers = new Headers(lastInit?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(lastInit?.body as string)).toEqual({ enabled: true });
    expect(result).toEqual({ enabled: true, changed: true });
  });

  it("PUTs { enabled: false } when called with false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        lastInit = init;
        return envelopeOk({ enabled: false, changed: false });
      })
    );
    await monitoringMasterSwitch.set(false);
    expect(JSON.parse(lastInit?.body as string)).toEqual({ enabled: false });
  });

  it("rejects with MonitoringApiError when the server returns 422 invalid_payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelopeError("invalid_payload", "Body invalid.", 422))
    );
    await expect(monitoringMasterSwitch.set(true)).rejects.toBeInstanceOf(MonitoringApiError);
    try {
      await monitoringMasterSwitch.set(true);
    } catch (e) {
      expect(e).toBeInstanceOf(MonitoringApiError);
      const err = e as MonitoringApiError;
      expect(err.code).toBe("invalid_payload");
      expect(err.status).toBe(422);
      expect(err.message).toBe("Body invalid.");
    }
  });
});
