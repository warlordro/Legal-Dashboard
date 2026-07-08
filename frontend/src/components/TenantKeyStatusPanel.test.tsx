// @vitest-environment jsdom

import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetTenantKeyStatusStoreForTests } from "@/hooks/useTenantKeyStatus";

const mockKeyStatus = vi.fn();
const mockGetTenantKeys = vi.fn();
vi.mock("@/lib/api", () => ({
  me: { keyStatus: (...args: unknown[]) => mockKeyStatus(...args) },
  admin: { getTenantKeys: (...args: unknown[]) => mockGetTenantKeys(...args) },
}));

const mockUseCurrentUser = vi.fn();
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

import { TenantKeyStatusPanel } from "./TenantKeyStatusPanel";

const CONFIGURED_ALL = { anthropic: true, openai: true, google: true, openrouter: true, captcha: true };
const CONFIGURED_NONE = { anthropic: false, openai: false, google: false, openrouter: false, captcha: false };

const TENANT_KEYS_RESULT = {
  keys: {
    anthropic: { set: true, last4: "ab12" },
    openai: { set: true, last4: "oa34" },
    google: { set: true, last4: "gg56" },
    openrouter: { set: true, last4: "or78" },
    twocaptcha: { set: true, last4: "cp90" },
    capsolver: { set: false, last4: null },
  },
  captcha: { provider: "2captcha" as const, mode: "sequential" as const },
  updatedAt: "2026-07-06T00:00:00.000Z",
  updatedBy: null,
};

function currentUser(role: "admin" | "user") {
  return {
    user: {
      id: role,
      email: `${role}@firma.ro`,
      displayName: role,
      role,
      status: "active",
      createdAt: "2026-05-19T00:00:00.000Z",
      lastLoginAt: null,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  };
}

let host: HTMLDivElement;
let root: Root;

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(<TenantKeyStatusPanel />);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function text(): string {
  return host.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetTenantKeyStatusStoreForTests();
  mockUseCurrentUser.mockReturnValue(currentUser("user"));
  mockGetTenantKeys.mockResolvedValue(TENANT_KEYS_RESULT);
  (window as unknown as { desktopApi?: unknown }).desktopApi = undefined;
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

describe("TenantKeyStatusPanel", () => {
  it("error: panou neutru cu buton Reincearca, care re-fetch-uieste", async () => {
    mockKeyStatus.mockRejectedValueOnce(new Error("boom"));
    render();
    await flush();
    expect(text()).toContain("Nu am putut verifica");
    const retry = Array.from(host.querySelectorAll("button")).find((b) => /Reincearca/.test(b.textContent ?? ""));
    expect(retry).toBeDefined();
    mockKeyStatus.mockResolvedValueOnce({ authMode: "web", tenantKeysConfigured: CONFIGURED_ALL });
    act(() => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(mockKeyStatus).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain("Nu am putut verifica");
  });

  it("dev-combo (server desktop-auth in browser): nu randeaza nimic, nu minte inventarul", async () => {
    mockUseCurrentUser.mockReturnValue(currentUser("admin"));
    mockKeyStatus.mockResolvedValue({ authMode: "desktop", tenantKeysConfigured: CONFIGURED_NONE });
    render();
    await flush();
    expect(text()).toBe("");
    expect(text()).not.toContain("Neconfigurata");
    expect(mockGetTenantKeys).not.toHaveBeenCalled();
  });

  it("admin ready web: inventar cu ultimele 4 caractere + Gestioneaza cheile", async () => {
    mockUseCurrentUser.mockReturnValue(currentUser("admin"));
    mockKeyStatus.mockResolvedValue({
      authMode: "web",
      tenantKeysConfigured: { ...CONFIGURED_ALL, google: false },
    });
    render();
    await flush();
    expect(text()).toContain("Chei API tenant");
    expect(text()).toContain("Gestioneaza cheile");
    expect(text()).toContain("Configurata *ab12"); // anthropic
    expect(text()).toContain("Configurata *cp90"); // captcha, provider activ 2captcha
    expect(text()).toContain("Neconfigurata"); // google
  });

  it("admin: cand inventarul detaliat pica, badge-urile raman fara sufix (fail-soft)", async () => {
    mockUseCurrentUser.mockReturnValue(currentUser("admin"));
    mockKeyStatus.mockResolvedValue({ authMode: "web", tenantKeysConfigured: CONFIGURED_ALL });
    mockGetTenantKeys.mockRejectedValue(new Error("nope"));
    render();
    await flush();
    expect(text()).toContain("Configurata");
    expect(text()).not.toContain("*ab12");
  });

  it("non-admin cu tot configurat: nimic (banner doar la lipsa)", async () => {
    mockKeyStatus.mockResolvedValue({ authMode: "web", tenantKeysConfigured: CONFIGURED_ALL });
    render();
    await flush();
    expect(text()).toBe("");
  });

  it("non-admin cu lipsuri: un singur banner, fara inventar", async () => {
    mockKeyStatus.mockResolvedValue({ authMode: "web", tenantKeysConfigured: CONFIGURED_NONE });
    render();
    await flush();
    expect(text()).toContain("Contacteaza administratorul");
    expect(text()).toContain("analizele AI si cautarile RNPM");
    expect(text()).not.toContain("Gestioneaza cheile");
    expect(text()).not.toContain("Neconfigurata");
    expect(mockGetTenantKeys).not.toHaveBeenCalled();
  });
});
