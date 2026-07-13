// @vitest-environment jsdom

// v2.43.0 (EXT-H-03): Enter nu are voie sa confirme global dialogul de
// confirmare — activarea trebuie sa vina de la butonul focalizat. Pe actiuni
// distructive focusul initial sta pe Anuleaza; pe non-destructive ramane pe
// butonul de confirmare (fara regresie).

import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfirmProvider, useConfirm } from "./confirm-dialog";

let container: HTMLDivElement;
let root: Root;
let lastResult: boolean | null;

function Harness({ destructive }: { destructive: boolean }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      data-testid="open"
      onClick={() =>
        void confirm({ message: "Stergi tot?", destructive }).then((v) => {
          lastResult = v;
        })
      }
    >
      deschide
    </button>
  );
}

function mount(destructive: boolean) {
  act(() => {
    root.render(
      <ConfirmProvider>
        <Harness destructive={destructive} />
      </ConfirmProvider>
    );
  });
  act(() => {
    container.querySelector<HTMLButtonElement>('[data-testid="open"]')?.click();
  });
}

const btnByText = (text: string): HTMLButtonElement => {
  const btn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`buton "${text}" negasit`);
  return btn;
};

const pressKey = (key: string) => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  lastResult = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("confirm-dialog — siguranta la tastatura (EXT-H-03)", () => {
  it("Enter cu focus pe Anuleaza rezolva FALSE (activarea vine de la buton, nu global)", async () => {
    mount(true);
    const cancel = btnByText("Anuleaza");
    act(() => cancel.focus());
    // Activarea nativa buton-pe-Enter nu exista in jsdom — simulam click-ul
    // pe care browserul l-ar emite; important e ca handlerul GLOBAL sa nu
    // mai confirme inainte (inainte de fix, pressKey singur rezolva true).
    pressKey("Enter");
    expect(lastResult).not.toBe(true); // handlerul global nu a confirmat
    act(() => cancel.click());
    await act(async () => {});
    expect(lastResult).toBe(false);
  });

  it("pe destructive, focusul initial e pe Anuleaza", () => {
    mount(true);
    expect(document.activeElement).toBe(btnByText("Anuleaza"));
  });

  it("pe non-destructive, focusul initial ramane pe confirmare (fara regresie)", () => {
    mount(false);
    expect(document.activeElement).toBe(btnByText("Continua"));
  });

  it("Escape anuleaza (rezolva false)", async () => {
    mount(true);
    pressKey("Escape");
    await act(async () => {});
    expect(lastResult).toBe(false);
  });
});
