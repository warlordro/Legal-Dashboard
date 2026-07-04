// @vitest-environment jsdom

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyDialog } from "./ApiKeyDialog";
import type { AiMode } from "./dosare-ai-config";

vi.mock("@/components/AIUsagePanel", () => ({ AIUsagePanel: () => <div /> }));
vi.mock("@/components/ApiAccessPanel", () => ({ ApiAccessPanel: () => <div data-testid="pat-panel" /> }));
vi.mock("@/components/EmailSettingsPanel", () => ({ EmailSettingsPanel: () => <div /> }));
vi.mock("@/components/NotificationStatusPanel", () => ({ NotificationStatusPanel: () => <div /> }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: vi.fn(() => ({
    user: {
      id: "local",
      email: "local@desktop",
      displayName: "Local",
      role: "admin",
      status: "active",
      createdAt: "2026-05-19T00:00:00.000Z",
      lastLoginAt: null,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  })),
}));

import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { TenantKeys, TenantKeysConfigured } from "@/hooks/useTenantKeyStatus";

const useCurrentUserMock = vi.mocked(useCurrentUser);

// Desktop: fara fetch, politica BYOK — echivalentul useTenantKeyStatus in Electron.
function tenantDesktop(): TenantKeys {
  return {
    status: { state: "desktop" },
    tenantMode: false,
    hasTenantAiKey: false,
    tenantCaptchaMissing: false,
    tenantAiKeysMissing: false,
    refresh: vi.fn(),
  };
}

// Web tenant mode confirmat de server, cu combinatia de chei configurate data.
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

let host: HTMLDivElement;
let root: Root;

function render(ui: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(ui);
  });
}

function textContent(element: Element): string {
  return element.textContent ?? "";
}

function getButton(name: RegExp): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    name.test(textContent(button))
  );
  if (!found) throw new Error(`Nu am gasit butonul ${String(name)}`);
  return found;
}

function inputByPlaceholder(pattern: RegExp): HTMLInputElement {
  const found = Array.from(host.querySelectorAll<HTMLInputElement>("input")).find((input) =>
    pattern.test(input.placeholder)
  );
  if (!found) throw new Error(`Nu am gasit inputul ${String(pattern)}`);
  return found;
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function changeInput(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function props(mode: AiMode) {
  return {
    onClose: vi.fn(),
    tenantKeys: tenantDesktop(),
    apiKey: {
      setKey: vi.fn(),
      clearKey: vi.fn(),
      hasKey: false,
      hasAnthropic: false,
      hasOpenai: false,
      hasGoogle: false,
      hasOpenrouter: false,
      hasTwoCaptcha: false,
      hasCapSolver: false,
      captchaProvider: "2captcha" as const,
      setCaptchaProvider: vi.fn(),
      captchaMode: "sequential" as const,
      setCaptchaMode: vi.fn(),
      aiSettings: {
        mode,
        setMode: vi.fn(),
        settings: { mode },
        loading: false,
        error: null,
      },
    },
  };
}

describe("ApiKeyDialog OpenRouter mode", () => {
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useCurrentUserMock.mockReturnValue({
      user: {
        id: "local",
        email: "local@desktop",
        displayName: "Local",
        role: "admin",
        status: "active",
        createdAt: "2026-05-19T00:00:00.000Z",
        lastLoginAt: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  it("tenant mode: non-adminul vede statusul read-only, fara BYOK, fara buton admin, fara PAT", () => {
    useCurrentUserMock.mockReturnValue({
      user: {
        id: "u-1",
        email: "u@firma.ro",
        displayName: "User",
        role: "user",
        status: "active",
        createdAt: "2026-05-19T00:00:00.000Z",
        lastLoginAt: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<ApiKeyDialog {...props("native")} tenantKeys={tenantReady({ anthropic: true, captcha: true })} />);

    const text = textContent(host);
    expect(text).toContain("Chei API — nivel tenant");
    expect(text).toContain("gestionate de administratorul tenantului");
    // Fara formular BYOK: niciun input de cheie si niciun buton Salveaza.
    expect(host.querySelectorAll("input").length).toBe(0);
    expect(text).not.toContain("Salveaza");
    expect(text).not.toContain("Gestioneaza cheile");
    expect(host.querySelector("[data-testid='pat-panel']")).toBeNull();
  });

  it("browser cu key-status error: panou neutru cu Reincearca, NICIODATA formularul BYOK", () => {
    const tenantErr: TenantKeys = {
      status: { state: "error" },
      tenantMode: false,
      hasTenantAiKey: false,
      tenantCaptchaMissing: false,
      tenantAiKeysMissing: false,
      refresh: vi.fn(),
    };
    render(<ApiKeyDialog {...props("native")} tenantKeys={tenantErr} />);

    const text = textContent(host);
    expect(text).toContain("Starea cheilor nu a putut fi incarcata");
    expect(text).toContain("Reincearca");
    // Invariant F3.4: pe web nu se randeaza BYOK nici pe stari tranzitorii —
    // formularul ar minti ca salveaza local si ar tine chei in state.
    expect(host.querySelectorAll("input").length).toBe(0);
    expect(text).not.toContain("Salveaza");
  });

  it("tenant mode: adminul vede butonul spre Administrare si panoul PAT, tot fara BYOK", () => {
    render(<ApiKeyDialog {...props("native")} tenantKeys={tenantReady({ openai: true })} />);

    const text = textContent(host);
    expect(text).toContain("Gestioneaza cheile");
    expect(host.querySelector("[data-testid='pat-panel']")).not.toBeNull();
    expect(host.querySelectorAll("input").length).toBe(0);
    // Statusul per cheie reflecta raspunsul serverului.
    expect(text).toContain("OpenAI");
    expect(text).toContain("Configurata");
  });

  it("renders the three native slots in native mode", () => {
    render(<ApiKeyDialog {...props("native")} />);

    expect(textContent(host)).toContain("Anthropic");
    expect(textContent(host)).toContain("OpenAI");
    expect(textContent(host)).toContain("Google");
    expect(textContent(host)).not.toContain("OpenRouter API Key");
  });

  it("renders only the OpenRouter slot in openrouter mode", () => {
    render(<ApiKeyDialog {...props("openrouter")} />);

    expect(textContent(host)).toContain("OpenRouter API Key");
    expect(textContent(host)).not.toContain("Anthropic");
    expect(textContent(host)).not.toContain("OpenAI");
    expect(textContent(host)).not.toContain("Google");
  });

  it("saves the OpenRouter key through the fourth key slot", () => {
    const p = props("openrouter");
    render(<ApiKeyDialog {...p} />);

    changeInput(inputByPlaceholder(/sk-or-v1/i), "  sk-or-v1-test  ");
    click(getButton(/salveaza/i));

    expect(p.apiKey.setKey).toHaveBeenCalledWith("openrouter", "  sk-or-v1-test  ");
  });

  it("calls the mode setter from the toggle", () => {
    const p = props("openrouter");
    render(<ApiKeyDialog {...p} />);

    click(getButton(/^Native$/i));

    expect(p.apiKey.aiSettings.setMode).toHaveBeenCalledWith("native");
  });
});
