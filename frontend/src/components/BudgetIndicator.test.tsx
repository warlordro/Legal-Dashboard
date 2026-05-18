// @vitest-environment jsdom

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetIndicator } from "./BudgetIndicator";
import { me } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  me: {
    budget: vi.fn(),
  },
}));

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

function textContent(element: Element): string {
  return element.textContent ?? "";
}

describe("BudgetIndicator", () => {
  beforeEach(() => {
    vi.mocked(me.budget).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders used and limit for a configured feature", async () => {
    vi.mocked(me.budget).mockResolvedValue({
      items: [{ feature: "ai.single", usedMilli: 1250, limitMilli: 5000 }],
    });

    await render(<BudgetIndicator />);

    expect(textContent(host)).toContain("Buget AI");
    expect(textContent(host)).toContain("$1.250 / $5.000");
  });

  it("hides when limit is null", async () => {
    vi.mocked(me.budget).mockResolvedValue({
      items: [{ feature: "ai.single", usedMilli: 1250, limitMilli: null }],
    });

    await render(<BudgetIndicator />);

    expect(textContent(host)).toBe("");
  });

  it("does not fetch when disabled", async () => {
    await render(<BudgetIndicator enabled={false} />);

    expect(me.budget).not.toHaveBeenCalled();
    expect(textContent(host)).toBe("");
  });
});
