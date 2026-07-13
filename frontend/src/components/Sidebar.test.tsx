// @vitest-environment jsdom

// v2.43.0: Escape inchide popover-ul de istoric colapsat (flyout), la fel ca
// orice dropdown standard — inainte doar click-ul in afara / scroll / resize
// il inchideau.

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetTenantKeyStatusStoreForTests } from "@/hooks/useTenantKeyStatus";

vi.mock("@/lib/api", () => ({
  me: { keyStatus: vi.fn().mockRejectedValue(new Error("no network in test")) },
}));

import { Sidebar } from "./Sidebar";
import type { SearchHistoryEntry } from "@/types";

let host: HTMLDivElement;
let root: Root;

function render(ui: React.ReactNode) {
  // useTheme (via SidebarFooter) leaga tema initiala de prefers-color-scheme;
  // jsdom nu implementeaza matchMedia.
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({
        matches: false,
        media: query,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(<MemoryRouter>{ui}</MemoryRouter>);
  });
}

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  __resetTenantKeyStatusStoreForTests();
  vi.restoreAllMocks();
});

const history: SearchHistoryEntry[] = [
  {
    id: "h1",
    type: "dosare",
    label: "Dosar test",
    params: { source: "portaljust" },
    timestamp: Date.now(),
    resultCount: 1,
  } as SearchHistoryEntry,
];

function noop() {}

describe("Sidebar - popover colapsat", () => {
  it("Escape inchide popover-ul de istoric fara sa afecteze click-outside", () => {
    render(
      <Sidebar
        history={history}
        onHistoryClick={noop}
        onRemoveEntry={noop}
        onClearHistory={noop}
        rnpmHistory={[]}
        onRnpmHistoryClick={noop}
        onRnpmRemoveEntry={noop}
        onRnpmClearHistory={noop}
      />
    );

    // Colapseaza sidebar-ul (butonul din footer, expandat initial => "Inchide meniu").
    const collapseBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.title === "Inchide meniu"
    );
    if (!collapseBtn) throw new Error("Butonul de colaps nu a fost gasit");
    act(() => {
      collapseBtn.click();
    });

    // Deschide popover-ul de istoric cautari.
    const historyBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.title === "Istoric cautari"
    );
    if (!historyBtn) throw new Error("Butonul de istoric nu a fost gasit");
    act(() => {
      historyBtn.click();
    });
    expect(host.textContent).toContain("Istoric Cautari");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.textContent).not.toContain("Istoric Cautari");
  });
});
