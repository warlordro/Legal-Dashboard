// @vitest-environment jsdom

// v2.42.0 (6.8): sortare client-side — cele 3 cazuri cerute de ghid.
import { describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import { useClientSort, type UseClientSortResult } from "./useClientSort";

interface Row {
  name: string | null;
  count: number;
}

const ROWS: Row[] = [
  { name: "banana", count: 10 },
  { name: null, count: 2 },
  { name: "Ana", count: 30 },
  { name: "castravete", count: 20 },
];

const ACCESSORS: Record<string, (r: Row) => unknown> = {
  name: (r) => r.name,
  count: (r) => r.count,
};

function mount(rows: Row[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const captured: { current: UseClientSortResult<Row> | null } = { current: null };
  function Probe() {
    captured.current = useClientSort(rows, ACCESSORS);
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  return {
    get api(): UseClientSortResult<Row> {
      if (!captured.current) throw new Error("hook not mounted");
      return captured.current;
    },
    unmount() {
      act(() => root?.unmount());
      container.remove();
    },
  };
}

describe("useClientSort", () => {
  it("neactiv: pastreaza ordinea serverului; al treilea toggle revine la ea", () => {
    const h = mount(ROWS);
    expect(h.api.sorted.map((r) => r.count)).toEqual([10, 2, 30, 20]);
    expect(h.api.sortKey).toBeNull();

    act(() => h.api.toggle("count")); // asc
    act(() => h.api.toggle("count")); // desc
    act(() => h.api.toggle("count")); // neactiv
    expect(h.api.sortKey).toBeNull();
    expect(h.api.sorted.map((r) => r.count)).toEqual([10, 2, 30, 20]);
    h.unmount();
  });

  it("ciclul asc/desc cu null MEREU la coada, indiferent de directie", () => {
    const h = mount(ROWS);
    act(() => h.api.toggle("name"));
    expect(h.api.sortDir).toBe("asc");
    expect(h.api.sorted.map((r) => r.name)).toEqual(["Ana", "banana", "castravete", null]);

    act(() => h.api.toggle("name"));
    expect(h.api.sortDir).toBe("desc");
    expect(h.api.sorted.map((r) => r.name)).toEqual(["castravete", "banana", "Ana", null]);
    h.unmount();
  });

  it("sortare numerica + comutarea cheii reseteaza pe asc", () => {
    const h = mount(ROWS);
    act(() => h.api.toggle("count"));
    expect(h.api.sorted.map((r) => r.count)).toEqual([2, 10, 20, 30]);

    // Comutarea pe alta cheie porneste ciclul de la asc, nu continua desc.
    act(() => h.api.toggle("name"));
    expect(h.api.sortKey).toBe("name");
    expect(h.api.sortDir).toBe("asc");
    h.unmount();
  });
});
