// @vitest-environment jsdom

// v2.42.0 (6.4): fix-ul critic useDialog — onClose sta intr-un REF, efectul
// depinde DOAR de [open]. Testele acopera exact regresia din review: o closure
// onClose recreata la render NU trebuie sa demonteze/remonteze efectul (care
// ar fura focusul din elementul activ), iar Escape apeleaza mereu closure-ul
// cel mai recent.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDialog } from "./useDialog";

function Dialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useDialog<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return (
    <div ref={ref} data-testid="dialog" tabIndex={-1}>
      <input aria-label="camp" />
      <button type="button">Ok</button>
    </div>
  );
}

let container: HTMLDivElement;
let root: Root | null = null;

function mount(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
}

function rerender(ui: React.ReactNode) {
  act(() => root?.render(ui));
}

// Focusul initial se muta in queueMicrotask — flush explicit.
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

describe("useDialog — focus", () => {
  it("la deschidere muta focusul pe primul element focusabil", async () => {
    mount(<Dialog open onClose={() => {}} />);
    await flushMicrotasks();
    expect((document.activeElement as HTMLElement | null)?.getAttribute("aria-label")).toBe("camp");
  });

  it("re-render cu onClose closure NOUA nu fura focusul din elementul activ", async () => {
    mount(<Dialog open onClose={() => {}} />);
    await flushMicrotasks();

    // Userul muta focusul pe buton (nu pe primul focusabil).
    const button = container.querySelector<HTMLButtonElement>("button");
    act(() => button?.focus());
    expect(document.activeElement).toBe(button);

    // Fiecare render la caller creeaza alta closure. Daca efectul ar depinde
    // de onClose, cleanup+re-run ar muta focusul inapoi pe primul focusabil.
    rerender(<Dialog open onClose={() => {}} />);
    await flushMicrotasks();
    expect(document.activeElement).toBe(button);
  });

  it("Escape apeleaza closure-ul onClose cel mai recent, nu pe cel de la montare", async () => {
    const first = vi.fn();
    const second = vi.fn();
    mount(<Dialog open onClose={first} />);
    await flushMicrotasks();

    rerender(<Dialog open onClose={second} />);
    pressEscape();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("la inchidere restaureaza focusul pe elementul activ dinainte de deschidere", async () => {
    const outside = document.createElement("button");
    outside.textContent = "declansator";
    document.body.appendChild(outside);
    outside.focus();

    mount(<Dialog open={false} onClose={() => {}} />);
    rerender(<Dialog open onClose={() => {}} />);
    await flushMicrotasks();
    expect(document.activeElement).not.toBe(outside);

    rerender(<Dialog open={false} onClose={() => {}} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
