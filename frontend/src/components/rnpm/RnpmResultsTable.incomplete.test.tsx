// @vitest-environment jsdom
// Semnalul pentru avizele ramase fara detalii dupa recuperarea automata.
//
// Incident 2026-08-01: pana la 24 din 25 de avize au ramas fara detalii, iar
// utilizatorul a vazut doar status "Necunoscut" — identic cu un aviz al carui
// status chiar e necunoscut la sursa. `detailsFailed` era calculat de backend,
// trimis in raspuns si NICIODATA afisat nicaieri.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RnpmResultsTable, type RnpmResultsTableResult } from "./RnpmResultsTable";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function resultWith(detailsFailed: string[]): RnpmResultsTableResult {
  return {
    searchId: 1,
    total: 2,
    pagesTotal: 1,
    pageSize: 25,
    criteriu: "test",
    nextRnpmPage: null,
    avizIds: [10, null],
    detailsFailed,
    documents: [
      {
        no: 1,
        identificator: { v: "AV-A", k: null },
        utilizatorAutorizat: "U1",
        data: "01.01.2024",
        tip: "Aviz",
        needsActualizare: false,
        activ: true,
      },
      {
        no: 2,
        identificator: { v: "AV-B", k: null },
        utilizatorAutorizat: "U2",
        data: "02.01.2024",
        tip: "Aviz",
        needsActualizare: false,
      },
    ],
  };
}

function mount(result: RnpmResultsTableResult) {
  const nextContainer = document.createElement("div");
  container = nextContainer;
  document.body.appendChild(nextContainer);
  act(() => {
    root = createRoot(nextContainer);
    root.render(<RnpmResultsTable result={result} loading={false} onNeedMore={() => {}} />);
  });
  return nextContainer;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

describe("RnpmResultsTable — avize incomplete", () => {
  it("anunta cate avize au ramas fara detalii", () => {
    const el = mount(resultWith(["AV-B"]));

    expect(el.textContent).toMatch(/1 aviz fara detalii/i);
  });

  it("nu afiseaza nimic cand toate avizele au detalii", () => {
    const el = mount(resultWith([]));

    expect(el.textContent).not.toMatch(/fara detalii/i);
  });
});
