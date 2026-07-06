// @vitest-environment jsdom

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminKeys from "./Keys";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { useTenantKeys } from "@/hooks/useTenantKeys";

vi.mock("@/hooks/useTenantKeys", () => ({
  useTenantKeys: vi.fn(),
}));

const saveKeyMock = vi.fn();
const saveCaptchaSettingsMock = vi.fn();
const refreshMock = vi.fn();
let host: HTMLDivElement;
let root: Root;

function hookValue(overrides: Partial<ReturnType<typeof useTenantKeys>> = {}) {
  return {
    data: {
      keys: {
        anthropic: { set: true, last4: "abcd" },
        openai: { set: false, last4: null },
        google: { set: false, last4: null },
        openrouter: { set: false, last4: null },
        twocaptcha: { set: true, last4: "2222" },
        capsolver: { set: false, last4: null },
      },
      captcha: { provider: "2captcha" as const, mode: "sequential" as const },
      updatedAt: "2026-05-19T01:00:00.000Z",
      updatedBy: "admin",
    },
    loading: false,
    error: null,
    savingField: null,
    refresh: refreshMock,
    saveKey: saveKeyMock,
    saveCaptchaSettings: saveCaptchaSettingsMock,
    ...overrides,
  };
}

// v2.42.0 (6.2): pagina foloseste useConfirm — ConfirmProvider OBLIGATORIU in
// render, altfel hook-ul arunca.
async function render(ui: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ConfirmProvider>{ui}</ConfirmProvider>);
    await Promise.resolve();
  });
}

// Confirmarea se cauta in [role=alertdialog] (dialogul partajat), nu prin
// referinte — dialogul e randat de provider, in afara componentei testate.
function confirmDialogButton(pattern: RegExp): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("Dialogul de confirmare nu e deschis");
  const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    pattern.test(candidate.textContent ?? "")
  );
  if (!button) throw new Error(`Buton lipsa in dialog: ${String(pattern)}`);
  return button;
}

function textContent(element: Element): string {
  return element.textContent ?? "";
}

function buttonByText(pattern: RegExp): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    pattern.test(textContent(candidate))
  );
  if (!button) throw new Error(`Button missing: ${String(pattern)}`);
  return button;
}

function inputByPlaceholder(pattern: RegExp): HTMLInputElement {
  const input = Array.from(host.querySelectorAll<HTMLInputElement>("input")).find((candidate) =>
    pattern.test(candidate.placeholder)
  );
  if (!input) throw new Error(`Input missing: ${String(pattern)}`);
  return input;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function changeInput(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AdminKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTenantKeys).mockReturnValue(hookValue());
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders statuses with last4 only", async () => {
    await render(<AdminKeys />);

    expect(textContent(host)).toContain("Chei API");
    // v2.42.0 (6.5): etichete umane — Configurata *last4, nu "set *".
    expect(textContent(host)).toContain("Configurata *abcd");
    expect(textContent(host)).not.toContain("sk-");
  });

  it("saves a key value", async () => {
    await render(<AdminKeys />);

    changeInput(inputByPlaceholder(/sk-/i), "sk-new");
    await click(buttonByText(/Salveaza/i));

    expect(saveKeyMock).toHaveBeenCalledWith("anthropic", "sk-new");
  });

  // v2.42.0 (6.2): stergerea cere confirmare prin dialogul partajat.
  it("clears an existing key DOAR dupa confirmare", async () => {
    await render(<AdminKeys />);

    await click(buttonByText(/Sterge/i));
    expect(saveKeyMock).not.toHaveBeenCalled(); // inca nu — dialogul e deschis
    await click(confirmDialogButton(/Sterge/i));

    expect(saveKeyMock).toHaveBeenCalledWith("anthropic", "");
  });

  it("anularea din dialog NU sterge cheia", async () => {
    await render(<AdminKeys />);

    await click(buttonByText(/Sterge/i));
    await click(confirmDialogButton(/Anuleaza/i));

    expect(saveKeyMock).not.toHaveBeenCalled();
  });

  it("saves captcha settings", async () => {
    await render(<AdminKeys />);

    await click(buttonByText(/CapSolver/i));
    await click(buttonByText(/^Race/i));
    await click(buttonByText(/Salveaza captcha/i));

    expect(saveCaptchaSettingsMock).toHaveBeenCalledWith("capsolver", "race");
  });
});
