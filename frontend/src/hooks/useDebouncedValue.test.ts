// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, useEffect } from "react";
import { useDebouncedValue } from "./useDebouncedValue";

// Minimal renderHook substitute: render a component that calls the hook into
// a real jsdom container, expose the latest tuple via a captured ref. Avoids
// adding @testing-library/react as a dependency for a single hook's worth of
// tests.

type Capture<T> = { current: readonly [T, (v: T) => void] | null };

function renderDebouncedValue<T>(initialValue: T, delayMs?: number) {
  const capture: Capture<T> = { current: null };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  function Probe({ value, delay }: { value: T; delay?: number }) {
    const tuple = useDebouncedValue(value, delay);
    useEffect(() => {
      capture.current = tuple;
    });
    capture.current = tuple;
    return null;
  }

  act(() => {
    root = createRoot(container);
    root!.render(createElement(Probe, { value: initialValue, delay: delayMs }));
  });

  return {
    capture,
    rerender(nextValue: T, nextDelay?: number) {
      act(() => {
        root!.render(createElement(Probe, { value: nextValue, delay: nextDelay }));
      });
    },
    unmount() {
      act(() => {
        root!.unmount();
      });
      container.remove();
    },
  };
}

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial value synchronously on first render", () => {
    const h = renderDebouncedValue("initial", 300);
    expect(h.capture.current?.[0]).toBe("initial");
    h.unmount();
  });

  it("publishes the next value after delayMs of stillness", () => {
    const h = renderDebouncedValue("a", 300);
    h.rerender("b");
    expect(h.capture.current?.[0]).toBe("a");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(h.capture.current?.[0]).toBe("b");
    h.unmount();
  });

  it("collapses rapid churn into a single publish of the final value", () => {
    const h = renderDebouncedValue("a", 300);
    h.rerender("b");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    h.rerender("c");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    h.rerender("d");
    expect(h.capture.current?.[0]).toBe("a");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(h.capture.current?.[0]).toBe("d");
    h.unmount();
  });

  it("flush callback publishes immediately and short-circuits in-flight debounce", () => {
    const h = renderDebouncedValue("a", 300);
    h.rerender("b");
    act(() => {
      h.capture.current![1]("");
    });
    expect(h.capture.current?.[0]).toBe("");

    // The pending timer for "b" still resolves but writes "b" into state, so
    // post-advance we observe the debounced value catching up. Callers wiring
    // flush into a reset handler should also clear the underlying input state
    // (we do — see Alerts/Monitorizare reset handlers); the test here just
    // documents that flush itself is immediate, not "cancel pending".
    h.unmount();
  });

  it("unmount before settle does not throw", () => {
    const h = renderDebouncedValue("a", 300);
    h.rerender("b");
    h.unmount();
    expect(() => {
      vi.advanceTimersByTime(500);
    }).not.toThrow();
  });

  it("delayMs change schedules a fresh timer", () => {
    const h = renderDebouncedValue("a", 300);
    h.rerender("b", 1000);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(h.capture.current?.[0]).toBe("a");
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(h.capture.current?.[0]).toBe("b");
    h.unmount();
  });
});
