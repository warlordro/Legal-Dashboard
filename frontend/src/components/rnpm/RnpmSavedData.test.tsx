// @vitest-environment jsdom

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { rnpmDeleteAvizeBatch, rnpmGetSaved } from "@/lib/rnpmApi";
import type { RnpmAvizRecord } from "@/types/rnpm";
import { RnpmSavedData } from "./RnpmSavedData";

vi.mock("@/lib/rnpmApi", () => ({
  rnpmGetSaved: vi.fn(),
  rnpmGetAllSaved: vi.fn(),
  rnpmDeleteAviz: vi.fn(),
  rnpmDeleteAvizeBatch: vi.fn(),
}));

vi.mock("@/lib/rnpmExport", () => ({
  exportRnpmExcel: vi.fn(),
  exportRnpmPDF: vi.fn(),
}));

const getSavedMock = vi.mocked(rnpmGetSaved);
const deleteBatchMock = vi.mocked(rnpmDeleteAvizeBatch);

let host: HTMLDivElement;
let root: Root;

const ITEM: RnpmAvizRecord = {
  id: 7,
  owner_id: "local",
  uuid: "uuid-7",
  identificator: "AVIZ-7",
  search_type: "ipoteci",
  tip: "Aviz initial",
  data: "12.07.2026",
  utilizator_autorizat: null,
  activ: 1,
  needs_actualizare: 0,
  destinatie: null,
  tip_act: null,
  numar_act: null,
  data_inreg: null,
  data_expirare: null,
  alte_mentiuni: null,
  detalii_comune: null,
  inscriere_initiala_id: null,
  inscriere_initiala_uuid: null,
  inscriere_modificata_id: null,
  inscriere_modificata_uuid: null,
  detail_fetched: 1,
  search_id: null,
  created_at: "2026-07-12T00:00:00.000Z",
  updated_at: "2026-07-12T00:00:00.000Z",
};

async function render(ui: React.ReactNode): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ConfirmProvider>{ui}</ConfirmProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clickButton(pattern: RegExp): void {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    pattern.test(candidate.textContent ?? "")
  );
  if (!button) throw new Error(`Butonul ${pattern} nu a fost gasit`);
  button.click();
}

async function deleteSelected(): Promise<void> {
  const checkboxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  const rowCheckbox = checkboxes[2];
  if (!rowCheckbox) throw new Error("Checkbox-ul randului lipseste");
  await act(async () => {
    rowCheckbox.click();
  });
  await act(async () => {
    clickButton(/Sterge \(1\)/);
    await Promise.resolve();
  });
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("Dialogul de confirmare lipseste");
  const confirm = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    /^Sterge$/.test(candidate.textContent ?? "")
  );
  if (!confirm) throw new Error("Butonul de confirmare lipseste");
  await act(async () => {
    confirm.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  getSavedMock.mockReset().mockResolvedValue({ items: [ITEM], total: 1, page: 0, pageSize: 25 });
  deleteBatchMock.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});

describe("RnpmSavedData - autocompact dupa delete-batch", () => {
  it("compacted=false afiseaza avertismentul de eliberare a spatiului", async () => {
    deleteBatchMock.mockResolvedValue({ deleted: 1, compacted: false });
    await render(<RnpmSavedData onOpenDetail={() => undefined} />);

    await deleteSelected();

    expect(host.textContent).toContain(
      "Avizele au fost sterse, dar eliberarea spatiului pe disc a esuat. Spatiul se recupereaza la urmatoarea compactare reusita."
    );
  });

  it("campul compacted absent pastreaza comportamentul fara avertisment", async () => {
    deleteBatchMock.mockResolvedValue({ deleted: 1 });
    await render(<RnpmSavedData onOpenDetail={() => undefined} />);

    await deleteSelected();

    expect(host.textContent).not.toContain("eliberarea spatiului pe disc a esuat");
  });
});
