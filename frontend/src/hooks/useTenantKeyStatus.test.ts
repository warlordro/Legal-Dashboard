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
});
