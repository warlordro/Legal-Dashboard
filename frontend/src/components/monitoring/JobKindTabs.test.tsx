// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { JobKindTabs, type JobKindFilter } from "./JobKindTabs";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(value: JobKindFilter, onChange: (k: JobKindFilter) => void, ariaLabel = "test-tablist") {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(<JobKindTabs value={value} onChange={onChange} ariaLabel={ariaLabel} />);
  });
}

function rerender(value: JobKindFilter, onChange: (k: JobKindFilter) => void, ariaLabel = "test-tablist") {
  act(() => {
    root!.render(<JobKindTabs value={value} onChange={onChange} ariaLabel={ariaLabel} />);
  });
}

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

function tabs(): HTMLButtonElement[] {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
}

describe("JobKindTabs", () => {
  it("renders one tab per kind with the correct labels", () => {
    mount("all", () => {});
    expect(tabs().map((t) => t.textContent)).toEqual(["Toate", "Dosare", "Nume", "ICCJ"]);
  });

  it("marks aria-selected=true only on the active tab", () => {
    mount("dosar_soap", () => {});
    const all = tabs();
    expect(all[0]?.getAttribute("aria-selected")).toBe("false");
    expect(all[1]?.getAttribute("aria-selected")).toBe("true");
    expect(all[2]?.getAttribute("aria-selected")).toBe("false");
  });

  it("applies the ariaLabel to the tablist container", () => {
    mount("all", () => {}, "Filtreaza dupa tip");
    const list = container!.querySelector('[role="tablist"]');
    expect(list?.getAttribute("aria-label")).toBe("Filtreaza dupa tip");
  });

  it("invokes onChange with the clicked tab's key", () => {
    const onChange = vi.fn();
    mount("all", onChange);
    act(() => {
      tabs()[2]?.click();
    });
    expect(onChange).toHaveBeenCalledWith("name_soap");
  });

  it("uses roving tabindex (only the active tab is focusable)", () => {
    mount("name_soap", () => {});
    const all = tabs();
    expect(all[0]?.tabIndex).toBe(-1);
    expect(all[1]?.tabIndex).toBe(-1);
    expect(all[2]?.tabIndex).toBe(0);
  });

  it("ArrowRight moves to the next tab and calls onChange", () => {
    const onChange = vi.fn();
    mount("all", onChange);
    const all = tabs();
    all[0]?.focus();
    act(() => {
      all[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("dosar_soap");
  });

  it("ArrowLeft on the first tab wraps to the last", () => {
    const onChange = vi.fn();
    mount("all", onChange);
    const all = tabs();
    all[0]?.focus();
    act(() => {
      all[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("iccj");
  });

  it("Home/End jump to the first/last tab", () => {
    const onChange = vi.fn();
    mount("dosar_soap", onChange);
    const all = tabs();
    all[1]?.focus();
    act(() => {
      all[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("all");

    rerender("dosar_soap", onChange);
    const refreshed = tabs();
    refreshed[1]?.focus();
    act(() => {
      refreshed[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("iccj");
  });

  it("ignores non-navigation keys (Enter, Space, Tab fall through to default)", () => {
    const onChange = vi.fn();
    mount("all", onChange);
    const all = tabs();
    all[0]?.focus();
    act(() => {
      all[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      all[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
