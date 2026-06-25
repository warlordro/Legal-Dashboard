// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

const mockSync = vi.fn();
vi.mock("@/lib/api", () => ({
  syncWebSession: (...args: unknown[]) => mockSync(...args),
}));

import { useSessionKeepAlive } from "./useSessionKeepAlive";

const FIFTY_MIN_MS = 50 * 60 * 1000;

function setDesktop(on: boolean): void {
  const w = window as unknown as { desktopApi?: unknown };
  w.desktopApi = on ? {} : undefined;
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  function Probe() {
    useSessionKeepAlive();
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  return {
    unmount() {
      act(() => root?.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  mockSync.mockReset();
  mockSync.mockResolvedValue("ok");
  setDesktop(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setDesktop(false);
});

describe("useSessionKeepAlive", () => {
  it("web: schedules a 50-min keep-alive interval and clears it on unmount", () => {
    const setSpy = vi.spyOn(window, "setInterval");
    const clearSpy = vi.spyOn(window, "clearInterval");

    const h = mount();
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][1]).toBe(FIFTY_MIN_MS);

    h.unmount();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("web: the interval callback triggers a session re-sync", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const h = mount();
    expect(mockSync).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FIFTY_MIN_MS);
    expect(mockSync).toHaveBeenCalledTimes(1);
    h.unmount();
    vi.useRealTimers();
  });

  it("desktop: never schedules an interval", () => {
    setDesktop(true);
    const setSpy = vi.spyOn(window, "setInterval");

    const h = mount();
    expect(setSpy).not.toHaveBeenCalled();
    h.unmount();
  });
});
