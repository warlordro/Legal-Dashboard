// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, useEffect } from "react";

const mockApiFetch = vi.fn();
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { useTenantKeyStatus, type TenantKeys } from "./useTenantKeyStatus";

function setDesktop(on: boolean): void {
  const w = window as unknown as { desktopApi?: unknown };
  w.desktopApi = on ? {} : undefined;
}

function okResponse(payload: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve({ data: payload }),
  } as unknown as Response;
}

async function renderHook() {
  const capture: { current: TenantKeys | null } = { current: null };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  function Probe() {
    const result = useTenantKeyStatus();
    useEffect(() => {
      capture.current = result;
    });
    capture.current = result;
    return null;
  }

  await act(async () => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  const cleanup = () => {
    act(() => root?.unmount());
    container.remove();
  };
  return { capture, cleanup };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  setDesktop(false);
});

describe("useTenantKeyStatus", () => {
  it("desktop: nu face fetch si raporteaza state desktop (BYOK)", async () => {
    setDesktop(true);
    const { capture, cleanup } = await renderHook();
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(capture.current?.status.state).toBe("desktop");
    expect(capture.current?.tenantMode).toBe(false);
    expect(capture.current?.tenantCaptchaMissing).toBe(false);
    cleanup();
  });

  it("web tenant mode: deriva flag-urile din raspunsul serverului", async () => {
    setDesktop(false);
    mockApiFetch.mockResolvedValue(
      okResponse({
        authMode: "web",
        tenantKeysConfigured: { anthropic: true, openai: false, google: false, openrouter: false, captcha: false },
      })
    );
    const { capture, cleanup } = await renderHook();
    expect(mockApiFetch).toHaveBeenCalledWith("/api/v1/me/key-status");
    expect(capture.current?.status.state).toBe("ready");
    expect(capture.current?.tenantMode).toBe(true);
    expect(capture.current?.hasTenantAiKey).toBe(true);
    expect(capture.current?.tenantCaptchaMissing).toBe(true);
    expect(capture.current?.tenantAiKeysMissing).toBe(false);
    cleanup();
  });

  it("dev combo (browser + backend desktop-auth): tenantMode ramane false", async () => {
    setDesktop(false);
    mockApiFetch.mockResolvedValue(
      okResponse({
        authMode: "desktop",
        tenantKeysConfigured: { anthropic: false, openai: false, google: false, openrouter: false, captcha: false },
      })
    );
    const { capture, cleanup } = await renderHook();
    expect(capture.current?.status.state).toBe("ready");
    expect(capture.current?.tenantMode).toBe(false);
    // Fail-open: niciun blocaj definitiv in afara tenant mode.
    expect(capture.current?.tenantCaptchaMissing).toBe(false);
    expect(capture.current?.tenantAiKeysMissing).toBe(false);
    cleanup();
  });

  it("fetch esuat: state error, fara blocaje definitive (fail-open)", async () => {
    setDesktop(false);
    mockApiFetch.mockRejectedValue(new Error("network down"));
    const { capture, cleanup } = await renderHook();
    expect(capture.current?.status.state).toBe("error");
    expect(capture.current?.tenantMode).toBe(false);
    expect(capture.current?.tenantCaptchaMissing).toBe(false);
    expect(capture.current?.tenantAiKeysMissing).toBe(false);
    cleanup();
  });

  it("refetch la window focus (statusul stale nu supravietuieste revenirii in tab)", async () => {
    setDesktop(false);
    mockApiFetch.mockResolvedValue(
      okResponse({
        authMode: "web",
        tenantKeysConfigured: { anthropic: false, openai: false, google: false, openrouter: false, captcha: true },
      })
    );
    const { capture, cleanup } = await renderHook();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(capture.current?.tenantCaptchaMissing).toBe(false);

    mockApiFetch.mockResolvedValue(
      okResponse({
        authMode: "web",
        tenantKeysConfigured: { anthropic: false, openai: false, google: false, openrouter: false, captcha: false },
      })
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(capture.current?.tenantCaptchaMissing).toBe(true);
    cleanup();
  });
});
