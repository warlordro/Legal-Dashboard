// @vitest-environment jsdom

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyDialog } from "./ApiKeyDialog";
import type { AiMode, OpenRouterStack } from "./dosare-ai-config";

vi.mock("@/components/AIUsagePanel", () => ({ AIUsagePanel: () => <div /> }));
vi.mock("@/components/EmailSettingsPanel", () => ({ EmailSettingsPanel: () => <div /> }));
vi.mock("@/components/NotificationStatusPanel", () => ({ NotificationStatusPanel: () => <div /> }));

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

function props(mode: AiMode, stack: OpenRouterStack = "western") {
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
        stack,
        setMode: vi.fn(),
        setStack: vi.fn(),
        settings: { mode, openrouter_stack: stack },
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

  it("shows stack toggle only in openrouter mode", () => {
    render(<ApiKeyDialog {...props("native")} />);
    expect(textContent(host)).not.toContain("Vestic");
    act(() => root.unmount());
    host.remove();

    render(<ApiKeyDialog {...props("openrouter")} />);
    expect(textContent(host)).toContain("Vestic");
    expect(textContent(host)).toContain("Chinezesc");
  });

  it("saves the OpenRouter key through the fourth key slot", () => {
    const p = props("openrouter");
    render(<ApiKeyDialog {...p} />);

    changeInput(inputByPlaceholder(/sk-or-v1/i), "  sk-or-v1-test  ");
    click(getButton(/salveaza/i));

    expect(p.apiKey.setKey).toHaveBeenCalledWith("openrouter", "  sk-or-v1-test  ");
  });

  it("calls mode and stack setters from the toggles", () => {
    const p = props("openrouter", "western");
    render(<ApiKeyDialog {...p} />);

    click(getButton(/^Native$/i));
    click(getButton(/Chinezesc/i));

    expect(p.apiKey.aiSettings.setMode).toHaveBeenCalledWith("native");
    expect(p.apiKey.aiSettings.setStack).toHaveBeenCalledWith("chinese");
  });
});
