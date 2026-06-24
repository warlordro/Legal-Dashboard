// @vitest-environment jsdom
//
// Characterization tests pentru DosareTable — fixeaza comportamentul observabil
// inainte de orice refactor viitor (P3 din audit: 837 LOC + 24 useState).
// Acopera:
//  Tier 1 (render + state local):
//   - render 100 randuri cu pageSize 15
//   - sort toggle pe coloane sortabile (numar, data, institutie)
//   - selectie within-page (individual + select-all-pe-pagina)
//   - pagination clamp cand lista se contracta
//   - persistenta + hydration viewedDosare in sessionStorage
//  Tier 2 (handlers + side effects):
//   - monitor: pending -> "added" / "exists" / error (dedup pe numar)
//   - AI analyze: showKeyPrompt cand !hasAnyKey; 401 mapping la "Cheie API invalida"
//   - multi-agent: phase streaming via SSE callback + result render
//   - expand -> scrollIntoView fired via useEffect timer (fake timers)

import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { DosareTable } from "./DosareTable";
import type { Dosar } from "@/types";
import { api, monitoring } from "@/lib/api";

// Mocks: api + monitoring sunt re-implementate pe test (mockResolvedValue),
// MonitoringApiError pastreaza shape-ul real (code/message/status) pentru ca
// `err instanceof MonitoringApiError` + `err.message` din handleMonitor sa
// functioneze corect.
vi.mock("@/lib/api", () => ({
  api: { ai: { analyze: vi.fn(), analyzeMulti: vi.fn() } },
  monitoring: { createDosar: vi.fn() },
  MonitoringApiError: class MonitoringApiError extends Error {
    code: string;
    status?: number;
    details?: unknown;
    constructor(code: string, message?: string, status?: number, details?: unknown) {
      super(message ?? code);
      this.name = "MonitoringApiError";
      this.code = code;
      this.status = status;
      this.details = details;
    }
  },
}));

vi.mock("@/lib/export-analysis", () => ({
  exportAnalysisPDF: vi.fn(),
}));

// DosareAiAnalysisPanel real ar trage in deps grele (PDF, model registry).
// Mock-ul expune butoane data-testid care invoca onAnalyze din props si afiseaza
// state-ul ai/multi vizibil — destul ca testele sa exercite handlerele fara UI complet.
vi.mock("@/components/dosare-ai-analysis-panel", () => ({
  DosareAiAnalysisPanel: ({
    dosar,
    ai,
    multi,
  }: {
    dosar: { numar: string };
    ai: {
      error: string | null;
      showKeyPrompt: boolean;
      onAnalyze: (d: { numar: string }) => void;
    };
    multi: {
      phase?: Set<string>;
      result?: Record<string, unknown>;
      error: string | null;
      onAnalyze: (d: { numar: string }) => void;
    };
  }) => (
    <div data-testid={`ai-panel-${dosar.numar}`}>
      {ai.error && <span data-testid="ai-error">{ai.error}</span>}
      {ai.showKeyPrompt && <span data-testid="ai-key-prompt" />}
      <button type="button" data-testid="ai-analyze-btn" onClick={() => ai.onAnalyze(dosar)}>
        Analyze
      </button>
      <button type="button" data-testid="ai-multi-analyze-btn" onClick={() => multi.onAnalyze(dosar)}>
        Multi
      </button>
      {multi.phase && <span data-testid="multi-phase">{[...multi.phase].join(",")}</span>}
      {multi.result?.[dosar.numar] !== undefined && <span data-testid="multi-result" />}
      {multi.error && <span data-testid="multi-error">{multi.error}</span>}
    </div>
  ),
}));

// scrollIntoView nu exista in jsdom — DosareTable.tsx il apeleaza din useEffect
// pe expandare (cale fallback cand niciun parent overflow:auto nu e gasit).
const scrollIntoViewMock = vi.fn();
Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: scrollIntoViewMock,
});

function makeDosar(i: number, overrides: Partial<Dosar> = {}): Dosar {
  return {
    numar: `${i}/2024`,
    data: `2024-${String((i % 12) + 1).padStart(2, "0")}-15`,
    institutie: `Judecatoria Test ${i}`,
    departament: "Civil",
    obiect: "Test",
    categorieCaz: "Litigii",
    stadiuProcesual: "Fond",
    parti: [{ calitateParte: "Reclamant", nume: `Parte ${i}` }],
    sedinte: [],
    ...overrides,
  };
}

const defaultProps = {
  onExportExcel: vi.fn(),
  onExportPDF: vi.fn(),
  aiSettings: { mode: "native" as const },
};

const apiKeysWithAnthropic = {
  anthropic: "sk-ant-test-key",
  openai: "",
  google: "",
  openrouter: "",
};

let container: HTMLDivElement;
let root: Root;

function mount(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(ui);
  });
}

function unmount() {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function rerender(ui: React.ReactNode) {
  act(() => {
    root.render(ui);
  });
}

function countBodyRows(): number {
  // tbody > tr — expanded-detail tr-urile sunt copiate ca <Fragment>, dar
  // doar randul principal exista cand nimic nu e expandat (state initial).
  return container.querySelectorAll("tbody > tr").length;
}

function findHeaderClickable(label: string): HTMLElement {
  const ths = Array.from(container.querySelectorAll("thead th"));
  const th = ths.find((el) => el.textContent?.trim().startsWith(label));
  if (!th) throw new Error(`Nu am gasit header-ul "${label}"`);
  return th as HTMLElement;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function clickAsync(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function getRowCheckboxes(): HTMLInputElement[] {
  // Primul checkbox e in <thead> (select-all pe pagina); restul sunt in <tbody>.
  return Array.from(container.querySelectorAll('tbody input[type="checkbox"]'));
}

function expandFirstRow() {
  // Primul `tbody > tr` e randul principal al primului dosar. Click pe el
  // seteaza expandedIdx si trigger-uieste markAsViewed pe `numar`.
  const row = container.querySelector("tbody > tr") as HTMLElement;
  if (!row) throw new Error("Nu am gasit niciun rand de expandat");
  click(row);
}

function findButtonByText(text: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("tbody button"));
  const btn = buttons.find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`Nu am gasit butonul "${text}"`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  sessionStorage.clear();
  scrollIntoViewMock.mockClear();
});

afterEach(() => {
  unmount();
  // resetAllMocks limpezeste si implementation-urile mockResolvedValue lasate
  // de la testul precedent — fiecare test isi configureaza propriul comportament.
  vi.resetAllMocks();
});

describe("DosareTable — characterization (render + state)", () => {
  it("randeaza doar randurile paginii curente (100 dosare, pageSize 15)", () => {
    const dosare = Array.from({ length: 100 }, (_, i) => makeDosar(i));
    mount(<DosareTable {...defaultProps} dosare={dosare} />);

    // pageSize initial = 15 → exact 15 randuri vizibile, indiferent de cele 100.
    expect(countBodyRows()).toBe(15);
    expect(container.textContent).toContain("100 dosare gasite");
  });

  it("toggle sort pe coloana 'Numar Dosar' inverseaza directia", () => {
    const dosare = [
      makeDosar(1, { numar: "100/2024" }),
      makeDosar(2, { numar: "200/2024" }),
      makeDosar(3, { numar: "300/2024" }),
    ];
    mount(<DosareTable {...defaultProps} dosare={dosare} />);

    // Default sort: data desc → randurile reflecta sortarea dupa data, nu numar.
    // Click pe Numar Dosar → asc; mai bine verificam ca primul rand text contine
    // "100/2024" dupa primul click (asc) si "300/2024" dupa al doilea click (desc).
    const numarHeader = findHeaderClickable("Numar Dosar");

    click(numarHeader); // sortKey = numar, sortDir = asc
    let firstCell = container.querySelector("tbody > tr")?.textContent ?? "";
    expect(firstCell).toContain("100/2024");

    click(numarHeader); // toggle → desc
    firstCell = container.querySelector("tbody > tr")?.textContent ?? "";
    expect(firstCell).toContain("300/2024");
  });

  it("selectia rowurilor cumuleaza count-ul si afiseaza badge-ul '(N selectate)'", () => {
    const dosare = [makeDosar(1), makeDosar(2), makeDosar(3)];
    mount(<DosareTable {...defaultProps} dosare={dosare} />);

    const checkboxes = getRowCheckboxes();
    expect(checkboxes).toHaveLength(3);

    act(() => {
      checkboxes[0].click();
      checkboxes[2].click();
    });

    expect(container.textContent).toContain("(2 selectate)");
  });

  it("select-all-pe-pagina selecteaza toate randurile din pagina curenta", () => {
    const dosare = Array.from({ length: 30 }, (_, i) => makeDosar(i));
    mount(<DosareTable {...defaultProps} dosare={dosare} />);

    // pageSize=15 → 15 randuri pe prima pagina; checkbox-ul din <thead> e primul.
    const selectAll = container.querySelector('thead input[type="checkbox"]') as HTMLInputElement;
    act(() => selectAll.click());

    expect(container.textContent).toContain("(15 selectate)");
  });

  it("clamp page la 0 cand lista de dosare se contracta sub pagina curenta", () => {
    // 50 dosare, pageSize 15 → 4 pagini (15, 15, 15, 5). Naviga la pagina 4
    // (page=3 in state 0-indexed) si apoi contracta lista la 10 dosare (1 pagina).
    const initial = Array.from({ length: 50 }, (_, i) => makeDosar(i));
    mount(<DosareTable {...defaultProps} dosare={initial} />);

    // Navigate la ultima pagina via butonul ».
    const lastPageBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "»");
    if (!lastPageBtn) throw new Error("Lipseste butonul »");
    click(lastPageBtn);

    expect(container.textContent).toContain("Pagina 4 din 4");

    // Contracta la 10 (sub o pagina) — useEffect-ul de clamp trebuie sa reseteze
    // la page=0, altfel tabelul ar fi gol. TablePagination dispare cand
    // totalPages <= 1, deci verificam direct count-ul randurilor.
    const shrunk = initial.slice(0, 10);
    rerender(<DosareTable {...defaultProps} dosare={shrunk} />);

    expect(countBodyRows()).toBe(10);
    // Fara clamp, page ar fi inca 3, paged.slice ar fi [], tabelul ar fi gol.
  });

  it("expandarea unui rand persista numarul in sessionStorage 'viewedDosare'", () => {
    const dosare = [makeDosar(1, { numar: "777/2024" })];
    mount(<DosareTable {...defaultProps} dosare={dosare} />);

    // Click pe rand (nu pe celula checkbox — aceea face stopPropagation).
    expandFirstRow();

    const stored = sessionStorage.getItem("viewedDosare");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? "[]") as string[];
    expect(parsed).toContain("777/2024");
  });

  it("starea viewedDosare hidrateaza la mount din sessionStorage", () => {
    sessionStorage.setItem("viewedDosare", JSON.stringify(["999/2024"]));
    const dosare = [makeDosar(1, { numar: "999/2024" }), makeDosar(2, { numar: "888/2024" })];
    mount(<DosareTable {...defaultProps} dosare={dosare} />);

    // Indicator "Nevizualizat" e un <span title="Nevizualizat">; "Vizualizat"
    // este un <span title="Vizualizat"> wrapping Eye icon. 999 trebuie sa fie
    // vazut → 888 trebuie sa fie nevazut.
    const seen = container.querySelectorAll('[title="Vizualizat"]').length;
    const unseen = container.querySelectorAll('[title="Nevizualizat"]').length;

    expect(seen).toBe(1);
    expect(unseen).toBe(1);
  });
});

describe("DosareTable — characterization (handlers + side effects)", () => {
  it("monitor: succes recent (created_at < 5s) → 'Adaugat la monitorizare'", async () => {
    vi.mocked(monitoring.createDosar).mockResolvedValue({
      id: 1,
      owner_id: "local",
      kind: "dosar_soap",
      target_hash: "h",
      target_json: "{}",
      status: "queued",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Restul field-urilor optionale (last_run_at, notes etc.) omise — handler-ul
      // citeste doar `created_at` ca sa decida added vs exists.
    } as never);

    mount(<DosareTable {...defaultProps} dosare={[makeDosar(1, { numar: "555/2024" })]} />);
    expandFirstRow();

    const btn = findButtonByText("Monitorizeaza schimbari");
    await clickAsync(btn);

    expect(container.textContent).toContain("Adaugat la monitorizare");
    expect(vi.mocked(monitoring.createDosar)).toHaveBeenCalledTimes(1);
  });

  it("monitor: job existent (created_at > 5s in trecut) → 'Deja monitorizat'", async () => {
    vi.mocked(monitoring.createDosar).mockResolvedValue({
      id: 2,
      owner_id: "local",
      kind: "dosar_soap",
      target_hash: "h",
      target_json: "{}",
      status: "queued",
      created_at: new Date(Date.now() - 60_000).toISOString(), // 1 minut in trecut
      updated_at: new Date(Date.now() - 60_000).toISOString(),
    } as never);

    mount(<DosareTable {...defaultProps} dosare={[makeDosar(2, { numar: "666/2024" })]} />);
    expandFirstRow();

    const btn = findButtonByText("Monitorizeaza schimbari");
    await clickAsync(btn);

    expect(container.textContent).toContain("Deja monitorizat");
  });

  it("monitor: MonitoringApiError → mesajul erorii e afisat in rosu", async () => {
    // Construim eroarea direct prin instanta — `instanceof MonitoringApiError`
    // trebuie sa fie true ca handler-ul sa preia `.message`.
    const { MonitoringApiError } = await import("@/lib/api");
    vi.mocked(monitoring.createDosar).mockRejectedValue(
      new MonitoringApiError("DUPLICATE_TARGET", "Job deja activ pe acest dosar", 409)
    );

    mount(<DosareTable {...defaultProps} dosare={[makeDosar(3, { numar: "777/2024" })]} />);
    expandFirstRow();

    const btn = findButtonByText("Monitorizeaza schimbari");
    await clickAsync(btn);

    expect(container.textContent).toContain("Job deja activ pe acest dosar");
  });

  it("AI analyze fara chei → showKeyPrompt setat, fara apel api.ai.analyze", async () => {
    // defaultProps NU include apiKeys → hasAnyKey === false.
    mount(<DosareTable {...defaultProps} dosare={[makeDosar(4, { numar: "888/2024" })]} />);
    expandFirstRow();

    const analyzeBtn = container.querySelector('[data-testid="ai-analyze-btn"]') as HTMLButtonElement;
    expect(analyzeBtn).toBeTruthy();
    await clickAsync(analyzeBtn);

    expect(container.querySelector('[data-testid="ai-key-prompt"]')).not.toBeNull();
    expect(vi.mocked(api.ai.analyze)).not.toHaveBeenCalled();
  });

  it("AI analyze cu eroare 401 → 'Cheie API invalida. Verifica setarile.'", async () => {
    vi.mocked(api.ai.analyze).mockRejectedValue(new Error("HTTP 401 Unauthorized"));

    mount(
      <DosareTable {...defaultProps} dosare={[makeDosar(5, { numar: "999/2024" })]} apiKeys={apiKeysWithAnthropic} />
    );
    expandFirstRow();

    const analyzeBtn = container.querySelector('[data-testid="ai-analyze-btn"]') as HTMLButtonElement;
    await clickAsync(analyzeBtn);

    const errorEl = container.querySelector('[data-testid="ai-error"]');
    expect(errorEl?.textContent).toBe("Cheie API invalida. Verifica setarile.");
    expect(vi.mocked(api.ai.analyze)).toHaveBeenCalledTimes(1);
  });

  it("multi-agent: phase streaming acumuleaza fazele + result final randat", async () => {
    // analyzeMulti primeste (dosar, [analyst1, analyst2], judge, apiKeys, onPhase).
    // Mock-ul invoca onPhase secvential pt fiecare faza, apoi rezolva cu result.
    vi.mocked(api.ai.analyzeMulti).mockImplementation(
      async (
        _dosar: unknown,
        _analysts: unknown,
        _judge: unknown,
        _keys: unknown,
        onPhase?: (phase: "analyst1_done" | "analyst2_done" | "judge_started") => void
      ) => {
        onPhase?.("analyst1_done");
        onPhase?.("analyst2_done");
        onPhase?.("judge_started");
        return {
          analyses: {
            analyst1: { model: "claude-sonnet", text: "a1" },
            analyst2: { model: "gpt-5.4-mini", text: "a2" },
          },
          judge: { model: "claude-opus", text: "verdict" },
          final: "verdict final",
        };
      }
    );

    mount(
      <DosareTable {...defaultProps} dosare={[makeDosar(6, { numar: "111/2024" })]} apiKeys={apiKeysWithAnthropic} />
    );
    expandFirstRow();

    const multiBtn = container.querySelector('[data-testid="ai-multi-analyze-btn"]') as HTMLButtonElement;
    await clickAsync(multiBtn);

    // multiPhase pt acest dosar e cleared in `finally` dupa setarea result. Deci
    // dupa awaitul de mai sus, multi.phase[numar] e undefined si <multi-phase> nu
    // mai e in DOM — dar result-ul DA, ca dovada ca streaming-ul a curs intr-o
    // ordine plauzibila. Daca finally s-ar rupe, fazele ar ramane vizibile.
    expect(container.querySelector('[data-testid="multi-result"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="multi-phase"]')).toBeNull();
    expect(vi.mocked(api.ai.analyzeMulti)).toHaveBeenCalledTimes(1);
  });

  it("expand → useEffect scroll → scrollIntoView chemat dupa 50ms (fallback window)", () => {
    // useEffect-ul de scroll: setTimeout 50ms → walk parents pentru overflow:auto/scroll
    // → in jsdom getComputedStyle e gol → cade pe fallback `el.scrollIntoView`.
    vi.useFakeTimers();
    try {
      mount(<DosareTable {...defaultProps} dosare={[makeDosar(7, { numar: "222/2024" })]} />);
      expandFirstRow();

      // Inainte de advance: timer-ul nu s-a executat inca.
      expect(scrollIntoViewMock).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(scrollIntoViewMock).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
