// @vitest-environment jsdom

import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiTokensApi", () => ({
  listApiTokens: vi.fn(async () => [
    {
      id: "1",
      name: "mcp-token",
      scopes: ["dosare", "rnpm"],
      tokenPrefix: "ld_pat_ab",
      captchaDailyCap: null,
      expiresAt: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      lastUsedAt: null,
      lastUsedIp: null,
      revokedAt: null,
    },
  ]),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(async () => {}),
  revokeAllApiTokens: vi.fn(async () => {}),
}));

import { ApiAccessPanel } from "./ApiAccessPanel";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { listApiTokens, revokeAllApiTokens, revokeApiToken } from "@/lib/apiTokensApi";

const mockedList = vi.mocked(listApiTokens);
const mockedRevoke = vi.mocked(revokeApiToken);
const mockedRevokeAll = vi.mocked(revokeAllApiTokens);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// v2.42.0 (6.2): panoul foloseste useConfirm — ConfirmProvider obligatoriu.
function panel() {
  return (
    <ConfirmProvider>
      <ApiAccessPanel />
    </ConfirmProvider>
  );
}

// Confirmarea se cauta in [role=alertdialog] — dialogul partajat e randat de
// provider, NU se compara referinte de functii.
function confirmDialogButton(pattern: RegExp): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("Dialogul de confirmare nu e deschis");
  const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    pattern.test(candidate.textContent ?? "")
  );
  if (!button) throw new Error(`Buton lipsa in dialog: ${String(pattern)}`);
  return button;
}

describe("ApiAccessPanel", () => {
  it("loads and renders the owner's tokens", async () => {
    await act(async () => {
      root.render(panel());
    });
    await flush();
    expect(container.textContent).toContain("mcp-token");
    expect(container.textContent).toContain("Creeaza token");
    expect(container.textContent).toContain("Revoca toate");
  });

  it("toggles the create form when the create button is clicked", async () => {
    await act(async () => {
      root.render(panel());
    });
    await flush();
    const createBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Creeaza token");
    expect(createBtn).toBeTruthy();
    await act(async () => {
      createBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[aria-label="Nume token"]')).toBeTruthy();
  });

  it("shows an error message when a revoke fails (no silent swallow)", async () => {
    mockedRevoke.mockRejectedValueOnce(new Error("network"));
    await act(async () => {
      root.render(panel());
    });
    await flush();
    const revokeBtn = container.querySelector('[aria-label="Revoca mcp-token"]') as HTMLButtonElement;
    expect(revokeBtn).toBeTruthy();
    await act(async () => {
      revokeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(container.textContent).toContain("Revocare esuata");
  });

  it("does NOT show the empty-state copy after a failed initial load", async () => {
    mockedList.mockRejectedValueOnce(new Error("network"));
    await act(async () => {
      root.render(panel());
    });
    await flush();
    expect(container.textContent).not.toContain("Niciun token");
    expect(container.textContent).toContain("Nu am putut incarca");
  });

  it("does NOT revoke-all when the confirmation is cancelled", async () => {
    await act(async () => {
      root.render(panel());
    });
    await flush();
    const revokeAllBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Revoca toate");
    await act(async () => {
      revokeAllBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await act(async () => {
      confirmDialogButton(/Anuleaza/i).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(mockedRevokeAll).not.toHaveBeenCalled();
  });

  it("revoke-all ruleaza dupa confirmarea din [role=alertdialog]", async () => {
    await act(async () => {
      root.render(panel());
    });
    await flush();
    const revokeAllBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Revoca toate");
    await act(async () => {
      revokeAllBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await act(async () => {
      confirmDialogButton(/Revoca toate/i).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(mockedRevokeAll).toHaveBeenCalledTimes(1);
  });
});
