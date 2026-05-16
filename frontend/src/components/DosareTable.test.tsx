// @vitest-environment jsdom
//
// Characterization tests pentru DosareTable — fixeaza comportamentul observabil
// inainte de orice refactor viitor (P3 din audit: 837 LOC + 24 useState).
// Acopera: render 100 randuri, sort toggle pe coloanele sortabile (numar, data,
// institutie), selectie within-page, pagination clamp cand lista se contracta,
// si persistenta `viewedDosare` in sessionStorage.

import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { DosareTable } from "./DosareTable";
import type { Dosar } from "@/types";

// Mocks: api+monitoring sunt folosite doar prin handlers triggered de butoane AI/Monitor.
// Testele aici nu exercita acele fluxuri, deci stub-uri minime sunt suficiente.
vi.mock("@/lib/api", () => ({
  api: { ai: { analyze: vi.fn(), analyzeMulti: vi.fn() } },
  monitoring: { createDosar: vi.fn() },
  MonitoringApiError: class extends Error {},
}));

vi.mock("@/lib/export-analysis", () => ({
  exportAnalysisPDF: vi.fn(),
}));

// DosareAiAnalysisPanel + dosare-ai-config tug in heavy AI deps; nu sunt
// necesare pentru caracterizarea tabelului (header, sort, pagination, selection).
vi.mock("@/components/dosare-ai-analysis-panel", () => ({
  DosareAiAnalysisPanel: () => null,
}));

// scrollIntoView nu exista in jsdom — DosareTable.tsx il apeleaza in useEffect
// pe expandare.
Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
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
  aiSettings: { mode: "native" as const, stack: "western" as const },
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

function getRowCheckboxes(): HTMLInputElement[] {
  // Primul checkbox e in <thead> (select-all pe pagina); restul sunt in <tbody>.
  return Array.from(container.querySelectorAll('tbody input[type="checkbox"]'));
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  unmount();
  vi.clearAllMocks();
});

describe("DosareTable — characterization", () => {
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
    const row = container.querySelector("tbody > tr") as HTMLElement;
    click(row);

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
