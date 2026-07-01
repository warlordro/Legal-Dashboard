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

describe("ApiAccessPanel", () => {
  it("loads and renders the owner's tokens", async () => {
    await act(async () => {
      root.render(<ApiAccessPanel />);
    });
    await flush();
    expect(container.textContent).toContain("mcp-token");
    expect(container.textContent).toContain("Creeaza token");
    expect(container.textContent).toContain("Revoca toate");
  });

  it("toggles the create form when the create button is clicked", async () => {
    await act(async () => {
      root.render(<ApiAccessPanel />);
    });
    await flush();
    const createBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Creeaza token");
    expect(createBtn).toBeTruthy();
    await act(async () => {
      createBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[aria-label="Nume token"]')).toBeTruthy();
  });
});
