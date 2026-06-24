// @vitest-environment jsdom

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary, PageBoundary } from "./ErrorBoundary";

let host: HTMLDivElement;
let root: Root;

async function render(ui: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(ui);
    await Promise.resolve();
  });
}

function textContent(): string {
  return host.textContent ?? "";
}

// Componenta care arunca controlat. Flag-ul e modul-level ca un re-render dupa
// "Reincearca" sa poata reusi fara remontarea boundary-ului.
let bombArmed = true;
function Bomb() {
  if (bombArmed) {
    throw new Error("kaboom-test");
  }
  return <div>continut recuperat</div>;
}

function findButton(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    bombArmed = true;
    // React logheaza singur eroarea prinsa prin console.error; o silentiem ca
    // testele sa nu fie zgomotoase, dar inspectam apelurile pentru asserts.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("randeaza copiii cand nu apare nicio eroare", async () => {
    await render(
      <ErrorBoundary variant="page">
        <div>continut normal</div>
      </ErrorBoundary>
    );

    expect(textContent()).toContain("continut normal");
  });

  it("variant=app afiseaza fallback-ul de aplicatie cu buton de reincarcare", async () => {
    await render(
      <ErrorBoundary variant="app">
        <Bomb />
      </ErrorBoundary>
    );

    expect(textContent()).toContain("Aplicatia a intampinat o eroare");
    expect(findButton("Reincarca aplicatia")).toBeTruthy();
  });

  it("variant=page afiseaza fallback-ul de sectiune cu label-ul primit", async () => {
    await render(
      <PageBoundary label="Cautare Dosare">
        <Bomb />
      </PageBoundary>
    );

    expect(textContent()).toContain("Aceasta sectiune a intampinat o eroare");
    expect(textContent()).toContain("Cautare Dosare");
    expect(findButton("Reincearca")).toBeTruthy();
  });

  it("butonul Reincearca reseteaza boundary-ul si re-randeaza copiii", async () => {
    await render(
      <PageBoundary label="Sectiune">
        <Bomb />
      </PageBoundary>
    );
    expect(textContent()).toContain("Aceasta sectiune a intampinat o eroare");

    // Copilul nu mai arunca la urmatorul render — retry-ul trebuie sa recupereze.
    bombArmed = false;
    const retryButton = findButton("Reincearca");
    expect(retryButton).toBeTruthy();
    await act(async () => {
      retryButton?.click();
      await Promise.resolve();
    });

    expect(textContent()).toContain("continut recuperat");
    expect(textContent()).not.toContain("Aceasta sectiune a intampinat o eroare");
  });

  it("logheaza in console.error cu prefixul [ErrorBoundary] si label-ul", async () => {
    await render(
      <ErrorBoundary variant="page" label="Sectiune test">
        <Bomb />
      </ErrorBoundary>
    );

    const matched = vi.mocked(console.error).mock.calls.find((call) => call[0] === "[ErrorBoundary]");
    expect(matched).toBeTruthy();
    expect(matched?.[1]).toMatchObject({ label: "Sectiune test" });
  });

  it("ascunde mesajul tehnic al erorii cand DEV este false", async () => {
    vi.stubEnv("DEV", false);

    await render(
      <ErrorBoundary variant="page" label="Sectiune">
        <Bomb />
      </ErrorBoundary>
    );

    expect(textContent()).toContain("Aceasta sectiune a intampinat o eroare");
    expect(textContent()).not.toContain("kaboom-test");
  });

  it("afiseaza mesajul tehnic al erorii cand DEV este true", async () => {
    vi.stubEnv("DEV", true);

    await render(
      <ErrorBoundary variant="page" label="Sectiune">
        <Bomb />
      </ErrorBoundary>
    );

    expect(textContent()).toContain("kaboom-test");
  });
});
