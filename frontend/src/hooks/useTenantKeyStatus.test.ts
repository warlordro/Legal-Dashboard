// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

const mockKeyStatus = vi.fn();
vi.mock("@/lib/api", () => ({
  me: { keyStatus: (...args: unknown[]) => mockKeyStatus(...args) },
}));

import { useTenantKeyStatus, type UseTenantKeyStatusResult } from "./useTenantKeyStatus";

function setDesktop(on: boolean): void {
  const w = window as unknown as { desktopApi?: unknown };
  w.desktopApi = on ? {} : undefined;
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const captured: { current: UseTenantKeyStatusResult | null } = { current: null };
  function Probe() {
    captured.current = useTenantKeyStatus();
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  return {
    get api(): UseTenantKeyStatusResult {
      if (!captured.current) throw new Error("hook not mounted");
      return captured.current;
    },
    unmount() {
      act(() => root?.unmount());
      container.remove();
    },
  };
}

const CONFIGURED_ALL = { anthropic: true, openai: true, google: true, openrouter: true, captcha: true };
const CONFIGURED_NONE = { anthropic: false, openai: false, google: false, openrouter: false, captcha: false };

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockKeyStatus.mockReset();
  setDesktop(false);
});

afterEach(() => {
  setDesktop(false);
  vi.restoreAllMocks();
});

describe("useTenantKeyStatus", () => {
  it("desktop: state=desktop, nu apeleaza key-status", () => {
    setDesktop(true);
    const h = mount();
    expect(h.api.state.state).toBe("desktop");
    expect(h.api.tenantMode).toBe(false);
    expect(mockKeyStatus).not.toHaveBeenCalled();
    h.unmount();
  });

  it("web ready: mapeaza flag-urile tenant si tenantMode=true", async () => {
    mockKeyStatus.mockResolvedValue({ authMode: "web", tenantKeysConfigured: CONFIGURED_ALL });
    const h = mount();
    expect(h.api.state.state).toBe("loading");
    await flush();
    expect(h.api.state.state).toBe("ready");
    expect(h.api.tenantMode).toBe(true);
    expect(h.api.hasTenantAiKey).toBe(true);
    expect(h.api.tenantAiKeysMissing).toBe(false);
    expect(h.api.tenantCaptchaMissing).toBe(false);
    h.unmount();
  });

  it("web ready fara chei: missing flags true", async () => {
    mockKeyStatus.mockResolvedValue({ authMode: "web", tenantKeysConfigured: CONFIGURED_NONE });
    const h = mount();
    await flush();
    expect(h.api.hasTenantAiKey).toBe(false);
    expect(h.api.tenantAiKeysMissing).toBe(true);
    expect(h.api.tenantCaptchaMissing).toBe(true);
    h.unmount();
  });

  it("web ready doar cu openrouter: hasTenantAiKey=true", async () => {
    mockKeyStatus.mockResolvedValue({
      authMode: "web",
      tenantKeysConfigured: { ...CONFIGURED_NONE, openrouter: true },
    });
    const h = mount();
    await flush();
    expect(h.api.hasTenantAiKey).toBe(true);
    expect(h.api.tenantAiKeysMissing).toBe(false);
    h.unmount();
  });

  it("server desktop-auth in browser: tenantMode=false (nu minte inventarul)", async () => {
    mockKeyStatus.mockResolvedValue({ authMode: "desktop", tenantKeysConfigured: CONFIGURED_NONE });
    const h = mount();
    await flush();
    expect(h.api.state.state).toBe("ready");
    expect(h.api.tenantMode).toBe(false);
    expect(h.api.hasTenantAiKey).toBe(false);
    expect(h.api.tenantAiKeysMissing).toBe(false); // nu tenantMode -> nu raportam lipsa
    h.unmount();
  });

  it("web error: state=error, derivatele false (fail-open la consumatori)", async () => {
    mockKeyStatus.mockRejectedValue(new Error("boom"));
    const h = mount();
    await flush();
    expect(h.api.state.state).toBe("error");
    expect(h.api.tenantMode).toBe(false);
    expect(h.api.tenantCaptchaMissing).toBe(false);
    h.unmount();
  });

  it("refresh re-fetch-uieste si actualizeaza starea", async () => {
    mockKeyStatus.mockResolvedValueOnce({ authMode: "web", tenantKeysConfigured: CONFIGURED_NONE });
    const h = mount();
    await flush();
    expect(h.api.hasTenantAiKey).toBe(false);
    mockKeyStatus.mockResolvedValueOnce({ authMode: "web", tenantKeysConfigured: CONFIGURED_ALL });
    act(() => h.api.refresh());
    await flush();
    expect(h.api.hasTenantAiKey).toBe(true);
    h.unmount();
  });

  it("guard de secventa: raspunsul stale sosit tarziu NU suprascrie unul proaspat", async () => {
    // Request 1 (mount) ramane in zbor; request 2 (refresh) se rezolva primul.
    let resolveFirst: (value: unknown) => void = () => {};
    mockKeyStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    const h = mount();
    expect(h.api.state.state).toBe("loading");

    mockKeyStatus.mockResolvedValueOnce({ authMode: "web", tenantKeysConfigured: CONFIGURED_ALL });
    act(() => h.api.refresh());
    await flush();
    expect(h.api.hasTenantAiKey).toBe(true);

    // Raspunsul stale al primului request aterizeaza acum, cu flag-uri opuse.
    act(() => resolveFirst({ authMode: "web", tenantKeysConfigured: CONFIGURED_NONE }));
    await flush();
    expect(h.api.state.state).toBe("ready");
    expect(h.api.hasTenantAiKey).toBe(true); // starea proaspata a ramas
    h.unmount();
  });

  it("refetch la focus, cu throttle 5s intre fetch-uri", async () => {
    mockKeyStatus.mockResolvedValue({ authMode: "web", tenantKeysConfigured: CONFIGURED_ALL });
    const t0 = 1_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(t0);
    const h = mount();
    await flush();
    expect(mockKeyStatus).toHaveBeenCalledTimes(1);

    // Primul focus: fetch.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(mockKeyStatus).toHaveBeenCalledTimes(2);

    // Al doilea focus sub 5s: throttled, fara fetch.
    nowSpy.mockReturnValue(t0 + 1000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(mockKeyStatus).toHaveBeenCalledTimes(2);

    // Dupa fereastra de 5s: fetch din nou.
    nowSpy.mockReturnValue(t0 + 5001);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(mockKeyStatus).toHaveBeenCalledTimes(3);
    h.unmount();
  });
});
