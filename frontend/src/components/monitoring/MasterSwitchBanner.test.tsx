// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MasterSwitchBanner } from "./MasterSwitchBanner";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(onResume: () => void, resuming: boolean) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  container = el;
  act(() => {
    const r = createRoot(el);
    root = r;
    r.render(<MasterSwitchBanner onResume={onResume} resuming={resuming} />);
  });
}

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

function findResumeButton(): HTMLButtonElement {
  if (!container) throw new Error("container not mounted");
  const btn = container.querySelector<HTMLButtonElement>("button");
  if (!btn) throw new Error("Resume button not found");
  return btn;
}

describe("MasterSwitchBanner", () => {
  it("renders the explanatory text and the Reia button", () => {
    mount(() => {}, false);
    if (!container) throw new Error("container not mounted");
    expect(container.textContent).toContain("Monitorizarea este oprita pentru contul tau.");
    const btn = findResumeButton();
    expect(btn.textContent).toContain("Reia");
  });

  it("invokes onResume when the Reia button is clicked", () => {
    const onResume = vi.fn();
    mount(onResume, false);
    act(() => {
      findResumeButton().click();
    });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("disables the button when resuming=true", () => {
    mount(() => {}, true);
    const btn = findResumeButton();
    expect(btn.disabled).toBe(true);
  });
});
