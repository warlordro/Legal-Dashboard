// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { RnpmResultsTable, type RnpmResultsTableResult } from "./RnpmResultsTable";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const scrollIntoView = vi.fn();
Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: scrollIntoView,
});

function resultWithStatuses(): RnpmResultsTableResult {
  return {
    total: 3,
    pagesTotal: 1,
    pageSize: 50,
    criteriu: "test",
    nextRnpmPage: null,
    avizIds: [null, null, null],
    documents: [
      {
        no: 1,
        identificator: { v: "ACTIV-1", k: null },
        utilizatorAutorizat: "Operator",
        data: "12.05.2026",
        tip: "Aviz initial",
        needsActualizare: false,
        activ: true,
      },
      {
        no: 2,
        identificator: { v: "STINS-1", k: null },
        utilizatorAutorizat: "Operator",
        data: "12.05.2026",
        tip: "Aviz modificator",
        needsActualizare: false,
        activ: false,
      },
      {
        no: 3,
        identificator: { v: "UNKNOWN-1", k: null },
        utilizatorAutorizat: "Operator",
        data: "12.05.2026",
        tip: "Aviz fara status",
        needsActualizare: false,
        activ: null,
      },
    ],
  };
}

function mount(result = resultWithStatuses()) {
  const nextContainer = document.createElement("div");
  container = nextContainer;
  document.body.appendChild(nextContainer);
  act(() => {
    root = createRoot(nextContainer);
    root.render(<RnpmResultsTable result={result} loading={false} onNeedMore={() => {}} />);
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
  scrollIntoView.mockClear();
});

describe("RnpmResultsTable status badges", () => {
  it("randeaza Activ, Stins si Necunoscut pentru cele trei stari RNPM", () => {
    mount();

    expect(container?.textContent).toContain("Activ");
    expect(container?.textContent).toContain("Stins");
    expect(container?.textContent).toContain("Necunoscut");
  });

  it("foloseste stil amber subtil pentru status necunoscut", () => {
    mount();

    const unknownBadge = Array.from(container?.querySelectorAll("span") ?? []).find(
      (el) => el.textContent === "Necunoscut"
    );

    expect(unknownBadge?.className).toContain("bg-amber-50");
    expect(unknownBadge?.className).toContain("text-amber-700");
  });
});
