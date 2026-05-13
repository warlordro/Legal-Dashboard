// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, useEffect } from "react";

// Mock the lib namespace re-export — that's what the hook imports
// (`monitoringMasterSwitch` from `@/lib/api`).
const mockGet = vi.fn();
const mockSet = vi.fn();
vi.mock("@/lib/api", () => ({
  monitoringMasterSwitch: {
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args),
  },
}));

import { useMonitoringMasterSwitch, type UseMonitoringMasterSwitchResult } from "./useMonitoringMasterSwitch";

type Capture = { current: UseMonitoringMasterSwitchResult | null };

function renderHook() {
  const capture: Capture = { current: null };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  function Probe() {
    const result = useMonitoringMasterSwitch();
    useEffect(() => {
      capture.current = result;
    });
    capture.current = result;
    return null;
  }

  act(() => {
    const r = createRoot(container);
    root = r;
    r.render(createElement(Probe));
  });

  return {
    capture,
    async flush() {
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => {
        root?.unmount();
      });
      container.remove();
    },
  };
}

beforeEach(() => {
  mockGet.mockReset();
  mockSet.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useMonitoringMasterSwitch", () => {
  it("starts with enabled=null + loading=true, then resolves to the GET value", async () => {
    mockGet.mockResolvedValueOnce({ enabled: true });
    const h = renderHook();
    expect(h.capture.current?.enabled).toBe(null);
    expect(h.capture.current?.loading).toBe(true);
    await h.flush();
    expect(h.capture.current?.enabled).toBe(true);
    expect(h.capture.current?.loading).toBe(false);
    expect(h.capture.current?.error).toBe(null);
    h.unmount();
  });

  it("toggle(false) optimistically flips enabled and settles to server response", async () => {
    mockGet.mockResolvedValueOnce({ enabled: true });
    mockSet.mockResolvedValueOnce({ enabled: false, changed: true });
    const h = renderHook();
    await h.flush();
    expect(h.capture.current?.enabled).toBe(true);

    const before = h.capture.current;
    if (!before) throw new Error("hook not mounted");
    let togglePromise!: Promise<void>;
    act(() => {
      togglePromise = before.toggle(false);
    });
    // Optimistic flip happens synchronously inside toggle() before the await.
    expect(h.capture.current?.enabled).toBe(false);
    expect(h.capture.current?.saving).toBe(true);

    await act(async () => {
      await togglePromise;
    });
    expect(h.capture.current?.enabled).toBe(false);
    expect(h.capture.current?.saving).toBe(false);
    expect(mockSet).toHaveBeenCalledWith(false);
    h.unmount();
  });

  it("reverts and surfaces an error message when set() rejects", async () => {
    mockGet.mockResolvedValueOnce({ enabled: true });
    mockSet.mockRejectedValueOnce(new Error("rate_limited"));
    const h = renderHook();
    await h.flush();
    expect(h.capture.current?.enabled).toBe(true);

    const before = h.capture.current;
    if (!before) throw new Error("hook not mounted");
    let rejected: unknown = null;
    await act(async () => {
      try {
        await before.toggle(false);
      } catch (e) {
        rejected = e;
      }
    });
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toBe("rate_limited");
    expect(h.capture.current?.enabled).toBe(true);
    expect(h.capture.current?.error).toBe("rate_limited");
    expect(h.capture.current?.saving).toBe(false);
    h.unmount();
  });

  it("unmount during an in-flight GET does not throw and does not write to state", async () => {
    let resolveGet!: (v: { enabled: boolean }) => void;
    mockGet.mockImplementationOnce(
      () =>
        new Promise<{ enabled: boolean }>((r) => {
          resolveGet = r;
        })
    );
    const h = renderHook();
    expect(h.capture.current?.enabled).toBe(null);
    // Unmount BEFORE the GET resolves — abort signal should suppress the
    // state write, and resolving the deferred promise afterwards must not
    // throw or warn.
    h.unmount();
    expect(() => resolveGet({ enabled: true })).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
  });
});
