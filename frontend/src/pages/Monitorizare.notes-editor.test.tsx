// @vitest-environment jsdom

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "@/components/monitoring/NoteEditor";
import { monitoring } from "@/lib/monitoringApi";

vi.mock("@/lib/monitoringApi", async (orig) => {
  const actual = await orig<typeof import("@/lib/monitoringApi")>();
  return {
    ...actual,
    monitoring: {
      ...actual.monitoring,
      patch: vi.fn(),
    },
  };
});

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

function findByText(text: string | RegExp): HTMLElement {
  const nodes = Array.from(host.querySelectorAll<HTMLElement>("button, span, div"));
  const found = nodes.find((node) =>
    typeof text === "string" ? textContent(node).includes(text) : text.test(textContent(node))
  );
  if (!found) throw new Error(`Nu am gasit textul ${String(text)}`);
  return found;
}

function getButton(name: RegExp): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    name.test(textContent(button))
  );
  if (!found) throw new Error(`Nu am gasit butonul ${String(name)}`);
  return found;
}

function getTextarea(): HTMLTextAreaElement {
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Notita"]');
  if (!textarea) throw new Error("Nu am gasit textarea Notita");
  return textarea;
}

async function waitFor(assertion: () => void) {
  const deadline = Date.now() + 1000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("NoteEditor - inline editor pentru notita per job", () => {
  beforeEach(() => {
    vi.mocked(monitoring.patch).mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("click pe notita existenta deschide textarea preincarcata", () => {
    render(<NoteEditor jobId={1} initialNote="vechi" onSaved={() => {}} />);
    click(findByText("vechi"));
    expect(getTextarea().value).toBe("vechi");
  });

  it("buton + Adauga notita apare cand notes e null", () => {
    render(<NoteEditor jobId={1} initialNote={null} onSaved={() => {}} />);
    expect(getButton(/adauga notita/i)).toBeTruthy();
  });

  it("counter X/200 reflecta lungimea curenta", () => {
    render(<NoteEditor jobId={1} initialNote={null} onSaved={() => {}} />);
    click(getButton(/adauga notita/i));
    changeTextarea(getTextarea(), "x".repeat(150));
    expect(findByText("150/200")).toBeTruthy();
  });

  it("textarea are maxLength=200", () => {
    render(<NoteEditor jobId={1} initialNote={null} onSaved={() => {}} />);
    click(getButton(/adauga notita/i));
    expect(getTextarea().getAttribute("maxLength")).toBe("200");
  });

  it("Salveaza apeleaza monitoring.patch cu { notes } si inchide editorul", async () => {
    vi.mocked(monitoring.patch).mockResolvedValueOnce({ id: 1, notes: "actualizat" } as never);
    const onSaved = vi.fn();
    render(<NoteEditor jobId={1} initialNote="vechi" onSaved={onSaved} />);
    click(findByText("vechi"));
    changeTextarea(getTextarea(), "actualizat");
    click(getButton(/salveaza/i));
    await waitFor(() => expect(monitoring.patch).toHaveBeenCalledWith(1, { notes: "actualizat" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("actualizat"));
  });

  it("textarea gol => Salveaza trimite { notes: null } (stergere)", async () => {
    vi.mocked(monitoring.patch).mockResolvedValueOnce({ id: 1, notes: null } as never);
    render(<NoteEditor jobId={1} initialNote="vechi" onSaved={() => {}} />);
    click(findByText("vechi"));
    changeTextarea(getTextarea(), "   ");
    click(getButton(/salveaza/i));
    await waitFor(() => expect(monitoring.patch).toHaveBeenCalledWith(1, { notes: null }));
  });

  it("Anuleaza inchide editorul fara API call", () => {
    render(<NoteEditor jobId={1} initialNote="vechi" onSaved={() => {}} />);
    click(findByText("vechi"));
    changeTextarea(getTextarea(), "schimbat");
    click(getButton(/anuleaza/i));
    expect(monitoring.patch).not.toHaveBeenCalled();
  });

  it("legacy >200: textarea afiseaza warning vizibil", () => {
    const long = "x".repeat(250);
    render(<NoteEditor jobId={1} initialNote={long} onSaved={() => {}} />);
    click(findByText(long.slice(0, 30)));
    expect(findByText(/depaseste 200/i)).toBeTruthy();
  });

  it("eroare backend envelope afiseaza mesajul", async () => {
    vi.mocked(monitoring.patch).mockRejectedValueOnce(new Error("Notita maxim 200 caractere"));
    render(<NoteEditor jobId={1} initialNote="vechi" onSaved={() => {}} />);
    click(findByText("vechi"));
    click(getButton(/salveaza/i));
    await waitFor(() => expect(findByText(/notita maxim 200/i)).toBeTruthy());
  });
});
