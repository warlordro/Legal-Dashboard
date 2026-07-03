// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, useEffect } from "react";

const mockAnalyze = vi.fn();
const mockAnalyzeMulti = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    ai: {
      analyze: (...args: unknown[]) => mockAnalyze(...args),
      analyzeMulti: (...args: unknown[]) => mockAnalyzeMulti(...args),
    },
  },
}));

import { useDosareAi, type UseDosareAiResult } from "./useDosareAi";
import type { TenantKeys, TenantKeysConfigured } from "./useTenantKeyStatus";
import type { Dosar } from "@/types";

const BYOK_KEYS = { anthropic: "sk-ant-x", openai: "", google: "", openrouter: "" };

function tenantReady(configured: Partial<TenantKeysConfigured> = {}): TenantKeys {
  const cfg: TenantKeysConfigured = {
    anthropic: false,
    openai: false,
    google: false,
    openrouter: false,
    captcha: false,
    ...configured,
  };
  const hasAi = cfg.anthropic || cfg.openai || cfg.google || cfg.openrouter;
  return {
    status: { state: "ready", serverAuthMode: "web", configured: cfg },
    tenantMode: true,
    hasTenantAiKey: hasAi,
    tenantCaptchaMissing: !cfg.captcha,
    tenantAiKeysMissing: !hasAi,
    refresh: vi.fn(),
  };
}

function tenantError(): TenantKeys {
  return {
    status: { state: "error" },
    tenantMode: false,
    hasTenantAiKey: false,
    tenantCaptchaMissing: false,
    tenantAiKeysMissing: false,
    refresh: vi.fn(),
  };
}

const DOSAR = { numar: "123/2026", parti: [], sedinte: [] } as unknown as Dosar;

function renderHook(args: Parameters<typeof useDosareAi>[0]) {
  const capture: { current: UseDosareAiResult | null } = { current: null };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  function Probe() {
    const result = useDosareAi(args);
    useEffect(() => {
      capture.current = result;
    });
    capture.current = result;
    return null;
  }

  act(() => {
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
  mockAnalyze.mockResolvedValue({ analysis: "ok" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useDosareAi — tenant mode (web)", () => {
  it("deriva modelele disponibile din cheile tenant, nu din cele locale", () => {
    const { capture, cleanup } = renderHook({
      apiKeys: { anthropic: "", openai: "", google: "", openrouter: "" },
      aiSettings: { mode: "native" },
      tenantKeys: tenantReady({ openai: true }),
    });
    const providers = new Set(capture.current?.ai.availableModels.map((m) => m.provider));
    expect(providers).toEqual(new Set(["openai"]));
    expect(capture.current?.ai.hasAnyKey).toBe(true);
    cleanup();
  });

  it("trimite body-ul FARA apiKeys (altfel backend-ul raspunde 501 in web)", async () => {
    const { capture, cleanup } = renderHook({
      apiKeys: BYOK_KEYS, // chei locale reziduale — nu au voie sa plece pe fir
      aiSettings: { mode: "native" },
      tenantKeys: tenantReady({ anthropic: true }),
    });
    await act(async () => {
      await capture.current?.ai.onAnalyze(DOSAR);
    });
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    expect(mockAnalyze.mock.calls[0][2]).toBeUndefined();
    cleanup();
  });

  it("fara nicio cheie AI tenant: prompt de chei, fara call API", async () => {
    const { capture, cleanup } = renderHook({
      apiKeys: BYOK_KEYS,
      aiSettings: { mode: "native" },
      tenantKeys: tenantReady({ captcha: true }), // doar captcha, zero AI
    });
    expect(capture.current?.ai.hasAnyKey).toBe(false);
    expect(capture.current?.ai.availableModels).toHaveLength(0);
    await act(async () => {
      await capture.current?.ai.onAnalyze(DOSAR);
    });
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(capture.current?.ai.showKeyPrompt).toBe(true);
    cleanup();
  });

  it("loading/error (fail-open): toate modelele raman selectabile si body-ul pleaca fara chei", async () => {
    const { capture, cleanup } = renderHook({
      apiKeys: { anthropic: "", openai: "", google: "", openrouter: "" },
      aiSettings: { mode: "native" },
      tenantKeys: tenantError(),
    });
    // Fail-open: nu stim inca starea cheilor tenant — nu blocam UI-ul.
    expect(capture.current?.ai.hasAnyKey).toBe(true);
    expect(capture.current?.ai.availableModels.length).toBeGreaterThan(0);
    await act(async () => {
      await capture.current?.ai.onAnalyze(DOSAR);
    });
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    expect(mockAnalyze.mock.calls[0][2]).toBeUndefined();
    cleanup();
  });

  it("openrouter mode: disponibilitatea vine din cheia openrouter tenant", () => {
    const { capture, cleanup } = renderHook({
      apiKeys: { anthropic: "", openai: "", google: "", openrouter: "" },
      aiSettings: { mode: "openrouter" },
      tenantKeys: tenantReady({ openrouter: true }),
    });
    expect(capture.current?.ai.hasAnyKey).toBe(true);
    expect(capture.current?.ai.availableModels.length).toBeGreaterThan(0);
    cleanup();
  });
});

describe("useDosareAi — BYOK (desktop / fara tenantKeys)", () => {
  it("fara tenantKeys: comportament istoric — cheile locale guverneaza si pleaca in body", async () => {
    const { capture, cleanup } = renderHook({
      apiKeys: BYOK_KEYS,
      aiSettings: { mode: "native" },
    });
    const providers = new Set(capture.current?.ai.availableModels.map((m) => m.provider));
    expect(providers).toEqual(new Set(["anthropic"]));
    await act(async () => {
      await capture.current?.ai.onAnalyze(DOSAR);
    });
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    expect(mockAnalyze.mock.calls[0][2]).toBe(BYOK_KEYS);
    cleanup();
  });

  it("dev combo (browser + backend desktop): serverAuthMode desktop pastreaza BYOK", () => {
    const devCombo: TenantKeys = {
      status: {
        state: "ready",
        serverAuthMode: "desktop",
        configured: { anthropic: false, openai: false, google: false, openrouter: false, captcha: false },
      },
      tenantMode: false,
      hasTenantAiKey: false,
      tenantCaptchaMissing: false,
      tenantAiKeysMissing: false,
      refresh: vi.fn(),
    };
    const { capture, cleanup } = renderHook({
      apiKeys: BYOK_KEYS,
      aiSettings: { mode: "native" },
      tenantKeys: devCombo,
    });
    const providers = new Set(capture.current?.ai.availableModels.map((m) => m.provider));
    expect(providers).toEqual(new Set(["anthropic"]));
    cleanup();
  });
});
