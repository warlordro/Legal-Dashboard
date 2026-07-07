// @vitest-environment jsdom

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIUsagePanel } from "./AIUsagePanel";
import { aiUsageApi } from "@/lib/aiUsageApi";
import { me } from "@/lib/api";

vi.mock("@/lib/aiUsageApi", () => ({
  aiUsageApi: { summary: vi.fn() },
}));

vi.mock("@/lib/api", () => ({
  me: { budget: vi.fn() },
}));

// Cardul de cota e gate-uit pe modul web al serverului (tenantMode). Mock
// direct pe hook: evita store-ul partajat la nivel de modul din
// useTenantKeyStatus (care ar cere me.keyStatus + reset intre teste).
const mockTenantMode = vi.fn<() => boolean>(() => true);
vi.mock("@/hooks/useTenantKeyStatus", () => ({
  useTenantKeyStatus: () => ({ tenantMode: mockTenantMode() }),
}));

const EMPTY_SUMMARY = {
  summary24h: { costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 },
  summary30d: { costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 },
  daily: [],
};

function budgetResult(item: {
  effectiveLimitMilli: number | null;
  usedMilli: number;
  limitSource: "override" | "default" | "none";
}) {
  return {
    items: [
      {
        feature: "ai",
        period: "day" as const,
        usedMilli: item.usedMilli,
        baseLimitMilli: item.effectiveLimitMilli,
        extraFromGrantsMilli: 0,
        effectiveLimitMilli: item.effectiveLimitMilli,
        limitSource: item.limitSource,
        limitMilli: item.effectiveLimitMilli,
      },
    ],
    fx: { pair: "USD/EUR" as const, rate: null, rateDate: null, stale: true },
  };
}

let host: HTMLDivElement;
let root: Root;

function render(ui: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(ui);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function textContent(): string {
  return host.textContent ?? "";
}

describe("AIUsagePanel", () => {
  beforeEach(() => {
    vi.mocked(aiUsageApi.summary).mockReset();
    vi.mocked(me.budget).mockReset();
    // Default: server in web mode — testele de card presupun quota enforce activ.
    mockTenantMode.mockReset();
    mockTenantMode.mockReturnValue(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("arata cota chiar daca sumarul de cost e gol (zero apeluri)", async () => {
    vi.mocked(aiUsageApi.summary).mockResolvedValue(EMPTY_SUMMARY);
    vi.mocked(me.budget).mockResolvedValue(
      budgetResult({ effectiveLimitMilli: 5000, usedMilli: 0, limitSource: "default" })
    );

    render(<AIUsagePanel />);
    await flush();

    expect(textContent()).toContain("Cota AI");
    expect(textContent()).toContain("0% consumat");
    expect(textContent()).toContain("Nu exista apeluri AI inregistrate");
  });

  it("afiseaza cota nelimitata cand effectiveLimitMilli e null", async () => {
    vi.mocked(aiUsageApi.summary).mockResolvedValue(EMPTY_SUMMARY);
    vi.mocked(me.budget).mockResolvedValue(
      budgetResult({ effectiveLimitMilli: null, usedMilli: 700, limitSource: "none" })
    );

    render(<AIUsagePanel />);
    await flush();

    expect(textContent()).toContain("Nelimitata");
  });

  it("cand limita efectiva e 0, arata blocat, nu 0% consumat", async () => {
    vi.mocked(aiUsageApi.summary).mockResolvedValue(EMPTY_SUMMARY);
    vi.mocked(me.budget).mockResolvedValue(
      budgetResult({ effectiveLimitMilli: 0, usedMilli: 0, limitSource: "override" })
    );

    render(<AIUsagePanel />);
    await flush();

    expect(textContent()).toContain("Blocata");
    expect(textContent()).not.toContain("0% consumat");
  });

  it("la overshoot textul arata procentul real (150%), dar bara e clamp-uita la 100%", async () => {
    vi.mocked(aiUsageApi.summary).mockResolvedValue(EMPTY_SUMMARY);
    vi.mocked(me.budget).mockResolvedValue(
      budgetResult({ effectiveLimitMilli: 10000, usedMilli: 15000, limitSource: "override" })
    );

    render(<AIUsagePanel />);
    await flush();

    expect(textContent()).toContain("150% consumat");
    const bar = host.querySelector<HTMLDivElement>(".h-full.transition-all");
    expect(bar).not.toBeNull();
    expect(bar?.style.width).toBe("100%");
  });

  it("pe desktop (non-web) cardul de cota NU apare, panoul de cost ramane intact", async () => {
    mockTenantMode.mockReturnValue(false);
    vi.mocked(aiUsageApi.summary).mockResolvedValue({
      summary24h: { costUsd: 1.5, calls: 3, inputTokens: 100, outputTokens: 200 },
      summary30d: { costUsd: 10, calls: 20, inputTokens: 1000, outputTokens: 2000 },
      daily: [],
    });
    vi.mocked(me.budget).mockResolvedValue(
      budgetResult({ effectiveLimitMilli: 0, usedMilli: 0, limitSource: "override" })
    );

    render(<AIUsagePanel />);
    await flush();

    expect(textContent()).toContain("Cost ultimele 24h");
    // Chiar cu un override rezidual "blocat" in DB, pe desktop nu afisam cota.
    expect(textContent()).not.toContain("Cota AI");
    expect(textContent()).not.toContain("Blocata");
  });

  it("daca /me/budget esueaza, panoul de cost ramane intact si fara cardul de cota", async () => {
    vi.mocked(aiUsageApi.summary).mockResolvedValue({
      summary24h: { costUsd: 1.5, calls: 3, inputTokens: 100, outputTokens: 200 },
      summary30d: { costUsd: 10, calls: 20, inputTokens: 1000, outputTokens: 2000 },
      daily: [],
    });
    vi.mocked(me.budget).mockRejectedValue(new Error("boom"));

    render(<AIUsagePanel />);
    await flush();

    expect(textContent()).toContain("Cost ultimele 24h");
    expect(textContent()).not.toContain("Cota AI");
  });
});
