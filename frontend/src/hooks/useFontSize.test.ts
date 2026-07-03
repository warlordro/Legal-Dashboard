// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

// useFontSize captureaza isDesktop la incarcarea modulului, deci fiecare test
// seteaza window.desktopApi INAINTE de import si reseteaza registry-ul de module.

const STORAGE_KEY = "portaljust-font-size";
const MIGRATION_KEY = "portaljust-font-size-migrated-v241";

function setDesktop(on: boolean): void {
  const w = window as unknown as { desktopApi?: unknown };
  w.desktopApi = on ? {} : undefined;
}

async function importHook() {
  const mod = await import("./useFontSize");
  return mod.useFontSize;
}

async function renderHook() {
  const useFontSize = await importHook();
  const { createRoot } = await import("react-dom/client");
  const { createElement, useEffect } = await import("react");
  type Result = ReturnType<typeof useFontSize>;
  const capture: { current: Result | null } = { current: null };
  const container = document.createElement("div");
  document.body.appendChild(container);

  function Probe() {
    const result = useFontSize();
    useEffect(() => {
      capture.current = result;
    });
    capture.current = result;
    return null;
  }

  let root: ReturnType<typeof createRoot> | null = null;
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  const cleanup = () => {
    act(() => root?.unmount());
    container.remove();
  };
  return { capture, cleanup };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.documentElement.style.fontSize = "";
});

afterEach(() => {
  setDesktop(false);
});

describe("loadStep defaults per platforma", () => {
  it("web: default Mic (16px)", async () => {
    setDesktop(false);
    const { capture, cleanup } = await renderHook();
    expect(capture.current?.value).toBe(16);
    expect(document.documentElement.style.fontSize).toBe("16px");
    cleanup();
  });

  it("desktop: default Normal (18px)", async () => {
    setDesktop(true);
    const { capture, cleanup } = await renderHook();
    expect(capture.current?.value).toBe(18);
    expect(document.documentElement.style.fontSize).toBe("18px");
    cleanup();
  });
});

describe("migrarea one-time pe web", () => {
  it("sterge valoarea auto-persistata si aplica noul default 16px", async () => {
    setDesktop(false);
    localStorage.setItem(STORAGE_KEY, "1"); // auto-persistat de versiunile vechi
    const { capture, cleanup } = await renderHook();
    expect(capture.current?.value).toBe(16);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");
    // Migrarea NU e suprascrisa de vreun persist la mount (ordinea conteaza).
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    cleanup();
  });

  it("nu ruleaza a doua oara: alegerea explicita post-migrare e respectata", async () => {
    setDesktop(false);
    localStorage.setItem(MIGRATION_KEY, "1");
    localStorage.setItem(STORAGE_KEY, "2"); // aleasa explicit dupa migrare
    const { capture, cleanup } = await renderHook();
    expect(capture.current?.value).toBe(20);
    cleanup();
  });

  it("nu atinge storage-ul pe desktop", async () => {
    setDesktop(true);
    localStorage.setItem(STORAGE_KEY, "2");
    const { capture, cleanup } = await renderHook();
    expect(capture.current?.value).toBe(20);
    expect(localStorage.getItem(MIGRATION_KEY)).toBeNull();
    cleanup();
  });
});

describe("persistenta doar la alegere explicita", () => {
  it("mount-ul NU scrie default-ul in storage", async () => {
    setDesktop(false);
    const { cleanup } = await renderHook();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    cleanup();
  });

  it("increase() persista valoarea aleasa", async () => {
    setDesktop(false);
    const { capture, cleanup } = await renderHook();
    act(() => capture.current?.increase());
    expect(capture.current?.value).toBe(18);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
    cleanup();
  });
});

describe("validarea valorii stocate", () => {
  it("respinge non-intregi (STEPS[1.5] ar fi undefined)", async () => {
    setDesktop(true);
    localStorage.setItem(STORAGE_KEY, "1.5");
    const { capture, cleanup } = await renderHook();
    expect(capture.current?.value).toBe(18); // default desktop, nu NaN
    cleanup();
  });

  it("respinge out-of-range", async () => {
    setDesktop(true);
    localStorage.setItem(STORAGE_KEY, "9");
    const { capture, cleanup } = await renderHook();
    expect(capture.current?.value).toBe(18);
    cleanup();
  });
});
