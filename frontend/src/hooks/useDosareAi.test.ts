// @vitest-environment jsdom

// Testeaza derivarea BYOK-vs-tenant din useDosareAi (ghid 3.2): in web mode
// cheile personale NU pleaca in body (undefined — serverul rezolva tenant);
// pe desktop pleaca; fara nicio cheie disponibila se deschide promptul, fara
// apel API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import type { Dosar } from "@/types";

const mockAnalyze = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    ai: {
      analyze: (...args: unknown[]) => mockAnalyze(...args),
      analyzeMulti: vi.fn(),
    },
  },
}));

const mockTenant = vi.fn();
vi.mock("@/hooks/useTenantKeyStatus", () => ({
  useTenantKeyStatus: () => mockTenant(),
}));

import { useDosareAi, type UseDosareAiResult } from "./useDosareAi";

const CONFIGURED_ALL = { anthropic: true, openai: true, google: true, openrouter: true, captcha: true };
const CONFIGURED_NONE = { anthropic: false, openai: false, google: false, openrouter: false, captcha: false };

function tenantDesktop() {
  return {
    state: { state: "desktop" as const },
    tenantMode: false,
    hasTenantAiKey: false,
    tenantAiKeysMissing: false,
    tenantCaptchaMissing: false,
    configured: null,
    refresh: vi.fn(),
  };
}

function tenantWebReady(configured: typeof CONFIGURED_ALL) {
  return {
    state: { state: "ready" as const, serverAuthMode: "web" as const, configured },
    tenantMode: true,
    hasTenantAiKey: configured.anthropic || configured.openai || configured.google || configured.openrouter,
    tenantAiKeysMissing: !(configured.anthropic || configured.openai || configured.google || configured.openrouter),
    tenantCaptchaMissing: !configured.captcha,
    configured,
    refresh: vi.fn(),
  };
}

const API_KEYS = { anthropic: "k-ant", openai: "k-oai", google: "k-goo", openrouter: "k-or" };
const DOSAR = { numar: "123/299/2026" } as unknown as Dosar;

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const captured: { current: UseDosareAiResult | null } = { current: null };
  function Probe() {
    captured.current = useDosareAi({ apiKeys: API_KEYS, aiSettings: { mode: "native" } });
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  return {
    get api(): UseDosareAiResult {
      if (!captured.current) throw new Error("hook not mounted");
      return captured.current;
    },
    unmount() {
      act(() => root?.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  mockAnalyze.mockReset();
  mockAnalyze.mockResolvedValue({ analysis: "ok" });
  mockTenant.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDosareAi — chei per runtime", () => {
  it("desktop (BYOK): cheile locale pleaca in body", async () => {
    mockTenant.mockReturnValue(tenantDesktop());
    const h = mount();
    await act(async () => {
      await h.api.ai.onAnalyze(DOSAR);
    });
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    expect(mockAnalyze.mock.calls[0][2]).toEqual(API_KEYS);
    h.unmount();
  });

  it("web ready: body-ul pleaca FARA chei (undefined — serverul rezolva tenant)", async () => {
    mockTenant.mockReturnValue(tenantWebReady(CONFIGURED_ALL));
    const h = mount();
    await act(async () => {
      await h.api.ai.onAnalyze(DOSAR);
    });
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    expect(mockAnalyze.mock.calls[0][2]).toBeUndefined();
    h.unmount();
  });

  it("web ready fara nicio configurare: prompt de configurare, fara apel API", async () => {
    mockTenant.mockReturnValue(tenantWebReady(CONFIGURED_NONE));
    const h = mount();
    expect(h.api.ai.hasAnyKey).toBe(false);
    await act(async () => {
      await h.api.ai.onAnalyze(DOSAR);
    });
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(h.api.ai.showKeyPrompt).toBe(true);
    h.unmount();
  });
});
