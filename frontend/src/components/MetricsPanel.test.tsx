// @vitest-environment jsdom
//
// Source-awareness pentru MetricsPanel (ICCJ vs PortalJust):
//  - ICCJ pre-enrich: cardul 4 e "Departamente" (nu "Institutii", care la ICCJ ar fi
//    mereu 1), iar Categorii arata "Necesita analiza detaliata" (categorieCaz gol).
//  - PortalJust: ramane "Institutii".
//  - ICCJ post-enrich (categorieCaz + rol): Categorii populat + Analiza Parte vizibil.

import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MetricsPanel } from "./MetricsPanel";
import type { Dosar } from "@/types";

function makeDosar(over: Partial<Dosar>): Dosar {
  return {
    numar: "1/1/2025",
    data: "2025-01-01",
    institutie: "Inalta Curte de Casatie si Justitie",
    departament: "Sectia I civila",
    obiect: "obiect",
    categorieCaz: "",
    stadiuProcesual: "Recurs",
    parti: [{ nume: "POPESCU ION", calitateParte: "" }],
    sedinte: [],
    source: "iccj",
    iccjId: "100",
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

function render(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(ui);
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MetricsPanel source-aware", () => {
  it("ICCJ pre-enrich: shows Departamente, not Institutii, and hides Categorii detail", () => {
    render(
      <MetricsPanel
        source="iccj"
        dosare={[makeDosar({}), makeDosar({ numar: "2/1/2025", iccjId: "101", departament: "Sectia penala" })]}
      />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Departamente");
    expect(text).not.toContain("Institutii");
    expect(text).toContain("Necesita analiza detaliata");
  });

  it("PortalJust: shows Institutii (not Departamente)", () => {
    render(
      <MetricsPanel
        source="portaljust"
        dosare={[
          makeDosar({
            source: undefined,
            iccjId: undefined,
            institutie: "Tribunalul Bucuresti",
            categorieCaz: "Civil",
          }),
        ]}
      />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Institutii");
    expect(text).not.toContain("Departamente");
  });

  it("ICCJ post-enrich: Categorii populated + Analiza Parte shown", () => {
    render(
      <MetricsPanel
        source="iccj"
        searchedName="Popescu"
        dosare={[
          makeDosar({ categorieCaz: "Litigii de munca", parti: [{ nume: "POPESCU ION", calitateParte: "Recurent" }] }),
        ]}
      />
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("Necesita analiza detaliata");
    expect(text).toContain("Analiza Parte");
  });
});
