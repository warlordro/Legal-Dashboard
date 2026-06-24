// @vitest-environment jsdom

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { AlertNoteBlock } from "@/components/alerts/AlertNoteBlock";

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

function text(): string {
  return host.textContent ?? "";
}

describe("AlertNoteBlock", () => {
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("randeaza prefix Notita + textul cand note e setat", () => {
    render(<AlertNoteBlock note="Client VIP" />);
    expect(text()).toContain("Notita:");
    expect(text()).toContain("Client VIP");
  });

  it("nu randeaza nimic cand note e null sau gol", () => {
    render(<AlertNoteBlock note={null} />);
    expect(host.firstChild).toBeNull();

    act(() => {
      root.unmount();
    });
    host.remove();

    render(<AlertNoteBlock note="" />);
    expect(host.firstChild).toBeNull();
  });

  it("nu randeaza pentru whitespace pur", () => {
    render(<AlertNoteBlock note="   " />);
    expect(host.firstChild).toBeNull();
  });
});
