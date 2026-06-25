// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, useEffect } from "react";

// Mock the lib barrel — the hook imports `syncWebSession` from `@/lib/api`.
const mockSync = vi.fn();
vi.mock("@/lib/api", () => ({
  syncWebSession: (...args: unknown[]) => mockSync(...args),
}));

import { useSessionBootstrap, type SessionBootstrap } from "./useSessionBootstrap";

type Capture = { current: SessionBootstrap | null };

function setDesktop(on: boolean): void {
  const w = window as unknown as { desktopApi?: unknown };
  w.desktopApi = on ? {} : undefined;
}

function renderHook() {
  const capture: Capture = { current: null };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  function Probe() {
    const result = useSessionBootstrap();
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
  mockSync.mockReset();
  setDesktop(false);
});

afterEach(() => {
  setDesktop(false);
});

describe("useSessionBootstrap", () => {
  it("desktop runtime: ready immediately, no session sync", () => {
    setDesktop(true);
    const h = renderHook();
    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("ok");
    expect(mockSync).not.toHaveBeenCalled();
    h.unmount();
  });

  it("web runtime: gated until sync settles, then ready (ok)", async () => {
    mockSync.mockResolvedValue("ok");
    const h = renderHook();
    expect(h.capture.current?.ready).toBe(false); // gate active before cookie minted
    await h.flush();
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("ok");
    h.unmount();
  });

  it("web runtime: surfaces not_provisioned but still unblocks", async () => {
    mockSync.mockResolvedValue("not_provisioned");
    const h = renderHook();
    await h.flush();
    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("not_provisioned");
    h.unmount();
  });

  it("web runtime: transient error still flips ready (no hang)", async () => {
    mockSync.mockResolvedValue("error");
    const h = renderHook();
    await h.flush();
    expect(h.capture.current?.ready).toBe(true);
    expect(h.capture.current?.status).toBe("error");
    h.unmount();
  });
});
