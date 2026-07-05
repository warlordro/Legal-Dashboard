// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import { useClientSort } from "./useClientSort";

// Acelasi harness minimal ca useDebouncedValue.test — fara @testing-library.

type Row = { name: string | null; n: number };
const rows: Row[] = [
  { name: "banana", n: 3 },
  { name: null, n: 1 },
  { name: "Ana", n: 2 },
];
const accessors = {
  name: (r: Row) => r.name,
  n: (r: Row) => r.n,
};

type HookResult = ReturnType<typeof useClientSort<Row, "name" | "n">>;

function renderSort() {
  const capture: { current: HookResult | null } = { current: null };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  function Probe() {
    capture.current = useClientSort(rows, accessors);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root?.render(createElement(Probe));
  });

  return {
    capture,
    toggle(key: "name" | "n") {
      act(() => capture.current?.toggle(key));
    },
    unmount() {
      act(() => root?.unmount());
      container.remove();
    },
  };
}

describe("useClientSort", () => {
  it("fara sortKey pastreaza ordinea serverului", () => {
    const h = renderSort();
    expect(h.capture.current?.sorted).toEqual(rows);
    h.unmount();
  });

  it("cicleaza asc -> desc -> neactiv, cu null mereu la coada", () => {
    const h = renderSort();
    h.toggle("name");
    expect(h.capture.current?.sorted.map((r) => r.name)).toEqual(["Ana", "banana", null]);
    h.toggle("name");
    expect(h.capture.current?.sorted.map((r) => r.name)).toEqual(["banana", "Ana", null]);
    h.toggle("name");
    expect(h.capture.current?.sortKey).toBeNull();
    expect(h.capture.current?.sorted).toEqual(rows);
    h.unmount();
  });

  it("sorteaza numeric si comuta cheia activa direct pe asc", () => {
    const h = renderSort();
    h.toggle("name");
    h.toggle("n");
    expect(h.capture.current?.sortKey).toBe("n");
    expect(h.capture.current?.sorted.map((r) => r.n)).toEqual([1, 2, 3]);
    h.unmount();
  });
});
