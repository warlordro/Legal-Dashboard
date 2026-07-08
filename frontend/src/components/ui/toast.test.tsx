// @vitest-environment jsdom

// v2.42.0 (6.3): timerele toast — capcanele inchise in review: auto-dismiss
// 4s (7s la error), cap 4 cu evictie FIFO + clearTimeout pe cele scoase,
// dismiss manual care curata timerul propriu, cleanup total la unmount.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast, type ToastOptions } from "./toast";

type ToastFn = (message: string, options?: ToastOptions) => void;

let container: HTMLDivElement;
let root: Root | null = null;
let toastFn: ToastFn | null = null;

function Probe() {
  toastFn = useToast();
  return null;
}

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(createElement(ToastProvider, null, createElement(Probe)));
  });
}

function toast(message: string, options?: ToastOptions) {
  if (!toastFn) throw new Error("provider nemontat");
  const fn = toastFn;
  act(() => fn(message, options));
}

function toastTexts(): string[] {
  return Array.from(document.querySelectorAll("output")).map((o) => o.textContent ?? "");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  toastFn = null;
  container.remove();
  vi.useRealTimers();
});

describe("ToastProvider — timere", () => {
  it("auto-dismiss la 4s pentru success si 7s pentru error", () => {
    mount();
    toast("salvat", { variant: "success" });
    toast("crapat", { variant: "error" });
    expect(toastTexts()).toHaveLength(2);

    act(() => vi.advanceTimersByTime(4000));
    expect(toastTexts().join(" ")).not.toContain("salvat");
    expect(toastTexts().join(" ")).toContain("crapat");

    act(() => vi.advanceTimersByTime(3000));
    expect(toastTexts()).toHaveLength(0);
  });

  it("durationMs suprascrie default-ul", () => {
    mount();
    toast("scurt", { durationMs: 1000 });
    act(() => vi.advanceTimersByTime(999));
    expect(toastTexts()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(toastTexts()).toHaveLength(0);
  });

  it("cap 4 vizibile: al 5-lea evicteaza FIFO si curata timerul celui scos", () => {
    mount();
    for (let i = 1; i <= 5; i += 1) toast(`toast-${i}`);

    const texts = toastTexts();
    expect(texts).toHaveLength(4);
    expect(texts.join(" ")).not.toContain("toast-1");
    expect(texts.join(" ")).toContain("toast-5");

    // Timerul evictatului e curatat: raman exact 4 timere pending (cate unul
    // per toast vizibil), nu 5.
    expect(vi.getTimerCount()).toBe(4);
  });

  it("dismiss manual scoate toast-ul si curata timerul propriu", () => {
    mount();
    toast("de inchis");
    const closeButton = document.querySelector<HTMLButtonElement>('button[aria-label="Inchide notificarea"]');
    expect(closeButton).not.toBeNull();

    act(() => closeButton?.click());
    expect(toastTexts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmount curata TOATE timerele pending", () => {
    mount();
    toast("unu");
    toast("doi", { variant: "error" });
    expect(vi.getTimerCount()).toBe(2);

    act(() => root?.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
