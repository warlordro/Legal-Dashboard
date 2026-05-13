// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as rnpmApi from "@/lib/rnpmApi";
import { RnpmResultsTable, type RnpmResultsTableResult } from "./RnpmResultsTable";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const scrollIntoView = vi.fn();
Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: scrollIntoView,
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockResult: RnpmResultsTableResult = {
  searchId: 1,
  total: 3,
  pagesTotal: 1,
  pageSize: 50,
  criteriu: "test",
  nextRnpmPage: null,
  avizIds: [10, 20, 30],
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
      activ: true,
    },
    {
      no: 3,
      identificator: { v: "AV-C", k: null },
      utilizatorAutorizat: "U3",
      data: "03.01.2024",
      tip: "Aviz",
      needsActualizare: false,
      activ: true,
    },
  ],
};

function mount(result: RnpmResultsTableResult = mockResult) {
  const nextContainer = document.createElement("div");
  container = nextContainer;
  document.body.appendChild(nextContainer);
  act(() => {
    root = createRoot(nextContainer);
    root.render(<RnpmResultsTable result={result} loading={false} onNeedMore={() => {}} onOpenDetail={() => {}} />);
  });
}

function filterInput(): HTMLInputElement {
  const input = container?.querySelector<HTMLInputElement>(
    'input[aria-label="Filtru text peste rezultatele cautarii RNPM"]'
  );
  if (!input) throw new Error("filter input missing");
  return input;
}

async function typeFilter(value: string) {
  const input = filterInput();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe("RnpmResultsTable - filter integration", () => {
  let filterSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    filterSpy = vi.spyOn(rnpmApi, "filterRnpmResults");
  });

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
    vi.useRealTimers();
    filterSpy.mockRestore();
  });

  it("inputul de filter este vizibil cand result.searchId exista", () => {
    mount();
    expect(filterInput()).toBeTruthy();
  });

  it("type query -> randuri vizibile reduse la matched", async () => {
    filterSpy.mockResolvedValueOnce({
      matchedAvizIds: [10],
      matchedCount: 1,
      totalInSearch: 3,
      missingDetails: 0,
      truncated: false,
    });
    mount();
    await typeFilter("av-a");
    await advance(300);
    await advance(0);
    expect(filterSpy).toHaveBeenCalled();
    expect(container?.textContent).toContain("AV-A");
    expect(container?.textContent).not.toContain("AV-B");
  });

  it("disabled state - input disabled + banner", async () => {
    filterSpy.mockRejectedValueOnce(new rnpmApi.RnpmFilterDisabledError("disabled"));
    mount();
    await typeFilter("test");
    await advance(300);
    await advance(0);
    expect(container?.textContent).toContain("Filtru indisponibil");
    expect(filterInput().disabled).toBe(true);
  });

  it("truncated=true - banner 'Afisez primele N'", async () => {
    filterSpy.mockResolvedValueOnce({
      matchedAvizIds: Array.from({ length: 1500 }, (_, i) => i + 1),
      matchedCount: 2000,
      totalInSearch: 5000,
      missingDetails: 0,
      truncated: true,
    });
    mount();
    await typeFilter("abc");
    await advance(300);
    await advance(0);
    expect(container?.textContent).toContain("Afisez primele 1500");
  });

  it("missingDetails > 0 - banner non-blocant", async () => {
    filterSpy.mockResolvedValueOnce({
      matchedAvizIds: [10],
      matchedCount: 1,
      totalInSearch: 3,
      missingDetails: 5,
      truncated: false,
    });
    mount();
    await typeFilter("abc");
    await advance(300);
    await advance(0);
    expect(container?.textContent).toContain("5 avize fara detalii");
  });

  it("eroare generica - mesaj rosu", async () => {
    filterSpy.mockRejectedValueOnce(new Error("Eroare server (500)"));
    mount();
    await typeFilter("abc");
    await advance(300);
    await advance(0);
    expect(container?.textContent).toContain("Eroare server");
  });

  it("counter matchedCount/totalInSearch afisat cand filter activ", async () => {
    filterSpy.mockResolvedValueOnce({
      matchedAvizIds: [10],
      matchedCount: 1,
      totalInSearch: 3,
      missingDetails: 0,
      truncated: false,
    });
    mount();
    await typeFilter("abc");
    await advance(300);
    await advance(0);
    expect(container?.textContent).toContain("1 din 3 avize");
  });
});
