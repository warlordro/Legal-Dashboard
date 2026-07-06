// @vitest-environment jsdom

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyDialog } from "./ApiKeyDialog";
import type { AiMode } from "./dosare-ai-config";

const mockKeyStatus = vi.fn();
const mockGetTenantKeys = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    me: { ...actual.me, keyStatus: (...args: unknown[]) => mockKeyStatus(...args) },
    admin: { ...actual.admin, getTenantKeys: (...args: unknown[]) => mockGetTenantKeys(...args) },
  };
});

vi.mock("@/components/AIUsagePanel", () => ({ AIUsagePanel: () => <div /> }));
vi.mock("@/components/ApiAccessPanel", () => ({ ApiAccessPanel: () => <div>ApiAccessPanelMock</div> }));
vi.mock("@/components/EmailSettingsPanel", () => ({ EmailSettingsPanel: () => <div /> }));
vi.mock("@/components/NotificationStatusPanel", () => ({ NotificationStatusPanel: () => <div /> }));
vi.mock("@/hooks/useAuthMode", () => ({ useAuthMode: vi.fn(() => "desktop") }));
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

import { useAuthMode } from "@/hooks/useAuthMode";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const useAuthModeMock = vi.mocked(useAuthMode);
const useCurrentUserMock = vi.mocked(useCurrentUser);

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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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
    mockKeyStatus.mockResolvedValue({
      authMode: "web",
      tenantKeysConfigured: { anthropic: true, openai: true, google: true, openrouter: true, captcha: true },
    });
    mockGetTenantKeys.mockResolvedValue({
      keys: {
        anthropic: { set: true, last4: "ab12" },
        openai: { set: true, last4: "oa34" },
        google: { set: true, last4: "gg56" },
        openrouter: { set: true, last4: "or78" },
        twocaptcha: { set: true, last4: "cp90" },
        capsolver: { set: false, last4: null },
      },
      captcha: { provider: "2captcha", mode: "sequential" },
      updatedAt: "2026-07-06T00:00:00.000Z",
      updatedBy: null,
    });
    useAuthModeMock.mockReturnValue("desktop");
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

  it("web non-admin: dialogul se deschide cu panourile personale, fara BYOK si fara management PAT", () => {
    useAuthModeMock.mockReturnValue("web");
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

    render(<ApiKeyDialog {...props("native")} />);

    const text = textContent(host);
    // Dialogul NU mai e gol (inainte: return null => butonul "Setari API" parea mort).
    expect(text).toContain("Configurare Chei API");
    expect(text).toContain("configurate de administrator");
    // Fara inputuri BYOK, fara buton de salvare, fara management PAT.
    expect(host.querySelectorAll("input[type=password]").length).toBe(0);
    expect(text).not.toContain("Salveaza");
    expect(text).not.toContain("ApiAccessPanelMock");
  });

  it("shows in web mode for admin users", () => {
    useAuthModeMock.mockReturnValue("web");
    useCurrentUserMock.mockReturnValue({
      user: {
        id: "admin",
        email: "admin@firma.ro",
        displayName: "Admin",
        role: "admin",
        status: "active",
        createdAt: "2026-05-19T00:00:00.000Z",
        lastLoginAt: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<ApiKeyDialog {...props("native")} />);

    expect(textContent(host)).toContain("Configurare Chei API");
  });

  it("web admin: inventarul tenant apare in dialog, cu ultimele 4 caractere", async () => {
    useAuthModeMock.mockReturnValue("web");

    render(<ApiKeyDialog {...props("native")} />);
    await flush();

    const text = textContent(host);
    expect(text).toContain("Chei API tenant");
    expect(text).toContain("Gestioneaza cheile");
    expect(text).toContain("Configurata *ab12");
  });

  it("web: statusul in eroare arata panou neutru cu Reincearca (nu blocheaza dialogul)", async () => {
    useAuthModeMock.mockReturnValue("web");
    mockKeyStatus.mockRejectedValue(new Error("boom"));

    render(<ApiKeyDialog {...props("native")} />);
    await flush();

    const text = textContent(host);
    expect(text).toContain("Nu am putut verifica");
    expect(text).toContain("Reincearca");
    expect(text).toContain("Configurare Chei API");
  });

  it("web non-admin: banner DOAR la lipsa — nimic cand totul e configurat", async () => {
    useAuthModeMock.mockReturnValue("web");
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

    render(<ApiKeyDialog {...props("native")} />);
    await flush();

    expect(textContent(host)).not.toContain("Contacteaza administratorul");
  });

  it("web non-admin: banner amber cand lipsesc configurarile, fara inventar", async () => {
    useAuthModeMock.mockReturnValue("web");
    mockKeyStatus.mockResolvedValue({
      authMode: "web",
      tenantKeysConfigured: { anthropic: false, openai: false, google: false, openrouter: false, captcha: false },
    });
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

    render(<ApiKeyDialog {...props("native")} />);
    await flush();

    const text = textContent(host);
    expect(text).toContain("Contacteaza administratorul");
    expect(text).not.toContain("Gestioneaza cheile");
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
