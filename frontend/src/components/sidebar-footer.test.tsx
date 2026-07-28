// @vitest-environment jsdom

// Butonul de delogare exista doar in web: pe desktop sesiunea e locala si nu
// exista de unde te deloga.

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetTenantKeyStatusStoreForTests } from "@/hooks/useTenantKeyStatus";

vi.mock("@/lib/api", () => ({
  me: { keyStatus: vi.fn().mockRejectedValue(new Error("no network in test")) },
}));

const logoutMock = vi.fn();
vi.mock("@/lib/authApi", () => ({
  logout: () => logoutMock(),
}));

import { SidebarFooter } from "./sidebar-footer";

let host: HTMLDivElement;
let root: Root;

function setDesktop(on: boolean): void {
  const w = window as unknown as { desktopApi?: unknown };
  if (on) {
    w.desktopApi = {};
  } else {
    w.desktopApi = undefined;
  }
}

function render(ui: React.ReactNode) {
  // useTheme leaga tema initiala de prefers-color-scheme; jsdom nu are matchMedia.
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
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
    root.render(ui);
  });
}

// Cauta si in `title`: in modul collapsed butonul are doar iconita, iar
// eticheta traieste exclusiv in atribut.
function logoutButton(): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").includes("Delogare") || b.getAttribute("title") === "Delogare"
  ) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  logoutMock.mockReset();
  __resetTenantKeyStatusStoreForTests();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  setDesktop(false);
});

describe("SidebarFooter — delogare", () => {
  it("afiseaza butonul in web", () => {
    setDesktop(false);
    render(<SidebarFooter collapsed={false} onToggleCollapsed={() => {}} />);
    expect(logoutButton()).toBeDefined();
  });

  it("nu afiseaza butonul pe desktop", () => {
    setDesktop(true);
    render(<SidebarFooter collapsed={false} onToggleCollapsed={() => {}} />);
    expect(logoutButton()).toBeUndefined();
  });

  it("in modul collapsed butonul exista, cu eticheta in title", () => {
    setDesktop(false);
    render(<SidebarFooter collapsed={true} onToggleCollapsed={() => {}} />);
    const btn = logoutButton();
    expect(btn).toBeDefined();
    expect(btn?.getAttribute("title")).toBe("Delogare");
  });

  it("clickul declanseaza delogarea", () => {
    setDesktop(false);
    render(<SidebarFooter collapsed={false} onToggleCollapsed={() => {}} />);
    act(() => {
      logoutButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });
});
