// @vitest-environment jsdom
//
// Izolarea istoricului pe utilizator (web mode, browser partajat): un cont NU
// are voie sa vada criteriile cautate de altul, iar cheia veche (nescopata)
// dispare la prima incarcare.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, useEffect } from "react";

let currentUser: { id: string } | null = null;
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ user: currentUser, loading: false, error: null, refresh: async () => {} }),
}));

import { useSearchHistory, PORTALJUST_HISTORY_KEY } from "./useSearchHistory";
import type { SearchParams } from "@/types";

type Api = ReturnType<typeof useSearchHistory>;

let host: HTMLDivElement;
let root: Root | null = null;

function Probe({ capture }: { capture: { current: Api | null } }) {
  const api = useSearchHistory();
  capture.current = api;
  useEffect(() => {
    capture.current = api;
  });
  return null;
}

function renderHook(): { current: Api | null } {
  const capture: { current: Api | null } = { current: null };
  act(() => {
    root = createRoot(host);
    root.render(createElement(Probe, { capture }));
  });
  return capture;
}

// Re-render acelasi mount: simuleaza aterizarea raspunsului /me (identitate
// necunoscuta -> cunoscuta) fara sa remonteze hook-ul.
function rerender(capture: { current: Api | null }): void {
  act(() => {
    root?.render(createElement(Probe, { capture }));
  });
}

function unmount(): void {
  act(() => {
    root?.unmount();
  });
  root = null;
}

const PARAMS: SearchParams = { numeParte: "POPESCU ION" };

beforeEach(() => {
  localStorage.clear();
  currentUser = null;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) unmount();
  host.remove();
});

describe("useSearchHistory — partitionare pe utilizator", () => {
  it("nu persista nimic cat timp utilizatorul nu e cunoscut", () => {
    const hook = renderHook();
    act(() => {
      hook.current?.addEntry("dosare", PARAMS, 3);
    });
    expect(hook.current?.history).toHaveLength(1);
    expect(Object.keys(localStorage)).toHaveLength(0);
  });

  it("scrie sub cheia utilizatorului curent, nu sub cea globala", () => {
    currentUser = { id: "user-a" };
    const hook = renderHook();
    act(() => {
      hook.current?.addEntry("dosare", PARAMS, 3);
    });
    expect(localStorage.getItem(`${PORTALJUST_HISTORY_KEY}::user-a`)).toContain("POPESCU ION");
    expect(localStorage.getItem(PORTALJUST_HISTORY_KEY)).toBeNull();
  });

  it("un alt utilizator pe acelasi browser nu vede istoricul primului", () => {
    currentUser = { id: "user-a" };
    const first = renderHook();
    act(() => {
      first.current?.addEntry("dosare", PARAMS, 3);
    });
    unmount();

    currentUser = { id: "user-b" };
    const second = renderHook();
    expect(second.current?.history).toEqual([]);

    // Iar istoricul primului ramane intact in partitia lui.
    expect(localStorage.getItem(`${PORTALJUST_HISTORY_KEY}::user-a`)).toContain("POPESCU ION");
  });

  it("in web sterge cheia veche nescopata, fara sa o migreze", () => {
    localStorage.setItem(PORTALJUST_HISTORY_KEY, JSON.stringify([{ id: "legacy", label: "CNP 1234567890123" }]));
    currentUser = { id: "user-a" };
    const hook = renderHook();
    expect(localStorage.getItem(PORTALJUST_HISTORY_KEY)).toBeNull();
    expect(hook.current?.history).toEqual([]);
  });

  it("pe desktop migreaza cheia veche in partitia `local`, nu o pierde", () => {
    const w = window as unknown as { desktopApi?: unknown };
    w.desktopApi = {};
    try {
      localStorage.setItem(PORTALJUST_HISTORY_KEY, JSON.stringify([{ id: "vechi", label: "POPESCU ION" }]));
      currentUser = { id: "local" };
      const hook = renderHook();
      expect(hook.current?.history).toHaveLength(1);
      expect(localStorage.getItem(`${PORTALJUST_HISTORY_KEY}::local`)).toContain("POPESCU ION");
      expect(localStorage.getItem(PORTALJUST_HISTORY_KEY)).toBeNull();
    } finally {
      w.desktopApi = undefined;
    }
  });

  it("dupa ce /me se rezolva, incarca partitia si scrie in ea (tranzitia null -> user)", () => {
    localStorage.setItem(`${PORTALJUST_HISTORY_KEY}::user-a`, JSON.stringify([{ id: "vechi", label: "IONESCU" }]));
    currentUser = null;
    const hook = renderHook();
    expect(hook.current?.history).toEqual([]);

    // /me aterizeaza: acelasi mount, identitate noua.
    currentUser = { id: "user-a" };
    rerender(hook);
    expect(hook.current?.history).toHaveLength(1);

    act(() => {
      hook.current?.addEntry("dosare", PARAMS, 3);
    });
    expect(localStorage.getItem(`${PORTALJUST_HISTORY_KEY}::user-a`)).toContain("POPESCU ION");
  });

  it("dupa schimbarea de identitate, prima scriere nu duce datele vechi in partitia noua", () => {
    // Scenariul real: sesiunea se re-minteaza pe alt cont in acelasi tab, fara
    // remontare. Intre randare si incarcarea partitiei noi nu are voie sa existe
    // o fereastra in care intrarile lui A ajung scrise la B.
    currentUser = { id: "user-a" };
    const hook = renderHook();
    act(() => {
      hook.current?.addEntry("dosare", PARAMS, 3);
    });
    expect(hook.current?.history).toHaveLength(1);

    currentUser = { id: "user-b" };
    rerender(hook);
    expect(hook.current?.history).toEqual([]);

    act(() => {
      hook.current?.addEntry("termene", { numarDosar: "1234/3/2026" }, 1);
    });
    const partitiaB = localStorage.getItem(`${PORTALJUST_HISTORY_KEY}::user-b`) ?? "";
    expect(partitiaB).toContain("1234/3/2026");
    expect(partitiaB).not.toContain("POPESCU ION");
    // Partitia lui A ramane exact cum a lasat-o.
    expect(localStorage.getItem(`${PORTALJUST_HISTORY_KEY}::user-a`)).toContain("POPESCU ION");
  });

  it("clearHistory goleste doar partitia utilizatorului curent", () => {
    localStorage.setItem(`${PORTALJUST_HISTORY_KEY}::user-b`, JSON.stringify([{ id: "b" }]));
    currentUser = { id: "user-a" };
    const hook = renderHook();
    act(() => {
      hook.current?.addEntry("dosare", PARAMS, 3);
    });
    act(() => {
      hook.current?.clearHistory();
    });
    expect(localStorage.getItem(`${PORTALJUST_HISTORY_KEY}::user-a`)).toBeNull();
    expect(localStorage.getItem(`${PORTALJUST_HISTORY_KEY}::user-b`)).not.toBeNull();
  });
});
