// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as rnpmApi from "@/lib/rnpmApi";
import { useRnpmResultsFilter } from "./useRnpmResultsFilter";

type HookState = ReturnType<typeof useRnpmResultsFilter>;
type HookProps = { searchId: number | null; q: string };

function renderResultsFilter(initialProps: HookProps) {
  const capture: { current: HookState | null } = { current: null };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  function Probe(props: HookProps) {
    const state = useRnpmResultsFilter(props.searchId, props.q);
    useEffect(() => {
      capture.current = state;
    });
    capture.current = state;
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe, initialProps));
  });

  return {
    capture,
    rerender(nextProps: HookProps) {
      act(() => {
        root?.render(createElement(Probe, nextProps));
      });
    },
    unmount() {
      act(() => {
        root?.unmount();
      });
      container.remove();
    },
  };
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe("useRnpmResultsFilter", () => {
  let filterSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    filterSpy = vi.spyOn(rnpmApi, "filterRnpmResults");
  });

  afterEach(() => {
    vi.useRealTimers();
    filterSpy.mockRestore();
  });

  it("query gol - nu apeleaza filterRnpmResults", () => {
    const h = renderResultsFilter({ searchId: 1, q: "" });
    expect(filterSpy).not.toHaveBeenCalled();
    h.unmount();
  });

  it("query 1 caracter - nu apeleaza (sub min)", async () => {
    const h = renderResultsFilter({ searchId: 1, q: "x" });
    await advance(500);
    expect(filterSpy).not.toHaveBeenCalled();
    h.unmount();
  });

  it("searchId null - nu apeleaza", async () => {
    const h = renderResultsFilter({ searchId: null, q: "popescu" });
    await advance(500);
    expect(filterSpy).not.toHaveBeenCalled();
    h.unmount();
  });

  it("query >= 2 caractere - apeleaza dupa debounce 300ms", async () => {
    filterSpy.mockResolvedValueOnce({
      matchedAvizIds: [42],
      matchedCount: 1,
      totalInSearch: 5,
      missingDetails: 0,
      truncated: false,
    });
    const h = renderResultsFilter({ searchId: 1, q: "" });
    h.rerender({ searchId: 1, q: "popescu" });
    await advance(299);
    expect(filterSpy).not.toHaveBeenCalled();
    await advance(1);
    expect(filterSpy).toHaveBeenCalledWith(1, "popescu", expect.any(AbortSignal));
    await advance(0);
    expect(h.capture.current?.data?.matchedCount).toBe(1);
    h.unmount();
  });

  it("schimbare query rapida - doar ultimul fetch este executat", async () => {
    filterSpy.mockResolvedValue({
      matchedAvizIds: [],
      matchedCount: 0,
      totalInSearch: 0,
      missingDetails: 0,
      truncated: false,
    });
    const h = renderResultsFilter({ searchId: 1, q: "" });
    h.rerender({ searchId: 1, q: "pop" });
    h.rerender({ searchId: 1, q: "pope" });
    h.rerender({ searchId: 1, q: "popes" });
    h.rerender({ searchId: 1, q: "popescu" });
    await advance(300);
    expect(filterSpy).toHaveBeenCalledTimes(1);
    expect(filterSpy).toHaveBeenCalledWith(1, "popescu", expect.any(AbortSignal));
    h.unmount();
  });

  it("503 FILTER_DISABLED -> state disabled=true", async () => {
    filterSpy.mockRejectedValueOnce(new rnpmApi.RnpmFilterDisabledError("disabled"));
    const h = renderResultsFilter({ searchId: 1, q: "" });
    h.rerender({ searchId: 1, q: "popescu" });
    await advance(300);
    await advance(0);
    expect(h.capture.current?.disabled).toBe(true);
    expect(h.capture.current?.data).toBeNull();
    expect(h.capture.current?.error).toBeNull();
    h.unmount();
  });

  it("eroare generica -> state error populat", async () => {
    filterSpy.mockRejectedValueOnce(new Error("Eroare server (500)"));
    const h = renderResultsFilter({ searchId: 1, q: "" });
    h.rerender({ searchId: 1, q: "popescu" });
    await advance(300);
    await advance(0);
    expect(h.capture.current?.error).toBe("Eroare server (500)");
    expect(h.capture.current?.disabled).toBe(false);
    expect(h.capture.current?.data).toBeNull();
    h.unmount();
  });
});
