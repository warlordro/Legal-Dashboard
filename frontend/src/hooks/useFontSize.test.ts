// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { useFontSize } from "./useFontSize";

const STORAGE_KEY = "portaljust-font-size";
const MIGRATION_KEY = "portaljust-font-size-migrated-v241";

function setDesktop(on: boolean): void {
  const w = window as unknown as { desktopApi?: unknown };
  w.desktopApi = on ? {} : undefined;
}

type FontSizeApi = ReturnType<typeof useFontSize>;

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const captured: { current: FontSizeApi | null } = { current: null };
  function Probe() {
    captured.current = useFontSize();
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  return {
    get api(): FontSizeApi {
      if (!captured.current) throw new Error("hook not mounted");
      return captured.current;
    },
    unmount() {
      act(() => root?.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  setDesktop(false);
  document.documentElement.style.fontSize = "";
});

afterEach(() => {
  setDesktop(false);
});

describe("useFontSize — trepte si default per platforma", () => {
  it("web: default 16px (Mic) fara storage", () => {
    const h = mount();
    expect(h.api.value).toBe(16);
    expect(h.api.label).toBe("Mic");
    expect(document.documentElement.style.fontSize).toBe("16px");
    h.unmount();
  });

  it("desktop: default 18px (Normal) fara storage", () => {
    setDesktop(true);
    const h = mount();
    expect(h.api.value).toBe(18);
    expect(h.api.label).toBe("Normal");
    h.unmount();
  });

  it("expune 5 trepte 14..22 cu etichete umane", () => {
    const h = mount();
    expect(h.api.steps.map((s) => s.value)).toEqual([14, 16, 18, 20, 22]);
    expect(h.api.steps.map((s) => s.label)).toEqual(["Foarte mic", "Mic", "Normal", "Mare", "Extra"]);
    h.unmount();
  });

  it("mount-ul NU scrie storage (default-ul nu devine alegere)", () => {
    const h = mount();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    h.unmount();
  });

  it("increase persista VALOAREA px, nu indexul", () => {
    const h = mount();
    act(() => h.api.increase());
    expect(h.api.value).toBe(18);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("18");
    h.unmount();
  });

  it("canDecrease/canIncrease respecta capetele", () => {
    localStorage.setItem(STORAGE_KEY, "14");
    localStorage.setItem(MIGRATION_KEY, "1");
    const h = mount();
    expect(h.api.canDecrease).toBe(false);
    expect(h.api.canIncrease).toBe(true);
    h.unmount();
  });
});

describe("useFontSize — compatibilitate legacy si migrare", () => {
  it("mapeaza indexii legacy 0..3 prin [16,18,20,22]", () => {
    localStorage.setItem(MIGRATION_KEY, "1"); // migrarea a rulat deja
    for (const [legacy, px] of [
      ["0", 16],
      ["2", 20],
      ["3", 22],
    ] as const) {
      localStorage.setItem(STORAGE_KEY, legacy);
      const h = mount();
      expect(h.api.value).toBe(px);
      h.unmount();
    }
  });

  it("migrarea web sterge DOAR default-ul auto-persistat ('1') si seteaza flag-ul", () => {
    localStorage.setItem(STORAGE_KEY, "1");
    const h = mount();
    expect(h.api.value).toBe(16); // default web, nu 18-ul auto-persistat
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");
    h.unmount();
  });

  it("migrarea web sterge si valoarea px '18' auto-persistata", () => {
    localStorage.setItem(STORAGE_KEY, "18");
    const h = mount();
    expect(h.api.value).toBe(16);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    h.unmount();
  });

  it("migrarea PASTREAZA alegerile explicite (legacy '3' = Extra)", () => {
    localStorage.setItem(STORAGE_KEY, "3");
    const h = mount();
    expect(h.api.value).toBe(22);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("3"); // neatins de migrare
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");
    h.unmount();
  });

  it("migrarea ruleaza O SINGURA data: un '18' salvat explicit dupa migrare ramane", () => {
    localStorage.setItem(STORAGE_KEY, "1");
    const first = mount();
    first.unmount(); // migrarea a rulat, flag setat

    localStorage.setItem(STORAGE_KEY, "18"); // alegere explicita post-migrare
    const second = mount();
    expect(second.api.value).toBe(18);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("18");
    second.unmount();
  });

  it("desktop: migrarea NU ruleaza (default-ul 18 ramane valid)", () => {
    setDesktop(true);
    localStorage.setItem(STORAGE_KEY, "1");
    const h = mount();
    expect(h.api.value).toBe(18);
    expect(localStorage.getItem(MIGRATION_KEY)).toBeNull();
    h.unmount();
  });

  it("valoare corupta in storage cade pe default", () => {
    localStorage.setItem(MIGRATION_KEY, "1");
    localStorage.setItem(STORAGE_KEY, "banana");
    const h = mount();
    expect(h.api.value).toBe(16);
    h.unmount();
  });
});
