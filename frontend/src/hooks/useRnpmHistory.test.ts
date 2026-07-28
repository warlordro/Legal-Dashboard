// @vitest-environment jsdom
//
// Pereche pentru useSearchHistory.test.ts: istoricul RNPM are cheia lui, deci
// partitionarea pe utilizator trebuie pinuita separat (criteriile RNPM contin
// CUI-uri si CNP-uri).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, useEffect } from "react";

let currentUser: { id: string } | null = null;
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ user: currentUser, loading: false, error: null, refresh: async () => {} }),
}));

import { useRnpmHistory, RNPM_HISTORY_KEY } from "./useRnpmHistory";

type Api = ReturnType<typeof useRnpmHistory>;

let host: HTMLDivElement;
let root: Root | null = null;

function renderHook(): { current: Api | null } {
  const capture: { current: Api | null } = { current: null };
  function Probe() {
    const api = useRnpmHistory();
    capture.current = api;
    useEffect(() => {
      capture.current = api;
    });
    return null;
  }
  act(() => {
    root = createRoot(host);
    root.render(createElement(Probe));
  });
  return capture;
}

function unmount(): void {
  act(() => {
    root?.unmount();
  });
  root = null;
}

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

describe("useRnpmHistory — partitionare pe utilizator", () => {
  it("scrie sub cheia contului si nu sub cea globala", () => {
    currentUser = { id: "user-a" };
    const hook = renderHook();
    act(() => {
      hook.current?.addEntry("ipoteci", { debitorPJ: { CUI: { type: "1", value: "32184793" } } }, 46);
    });
    expect(localStorage.getItem(`${RNPM_HISTORY_KEY}::user-a`)).toContain("32184793");
    expect(localStorage.getItem(RNPM_HISTORY_KEY)).toBeNull();
  });

  it("alt cont pe acelasi browser porneste cu istoric gol", () => {
    currentUser = { id: "user-a" };
    const first = renderHook();
    act(() => {
      first.current?.addEntry("ipoteci", { debitorPJ: { CUI: { type: "1", value: "32184793" } } }, 46);
    });
    unmount();

    currentUser = { id: "user-b" };
    const second = renderHook();
    expect(second.current?.history).toEqual([]);
  });

  it("sterge cheia veche nescopata la prima incarcare", () => {
    localStorage.setItem(RNPM_HISTORY_KEY, JSON.stringify([{ id: "legacy", label: "ipoteci · CUI 1234567" }]));
    currentUser = { id: "user-a" };
    const hook = renderHook();
    expect(localStorage.getItem(RNPM_HISTORY_KEY)).toBeNull();
    expect(hook.current?.history).toEqual([]);
  });
});
