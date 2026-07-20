// @vitest-environment jsdom

// v2.43.0: delete-all poate reusi la stergere dar esua la compactarea
// automata — backend intoarce {deleted, compacted}; UI trebuie sa arate un
// avertisment informativ (NU o eroare blocanta) cand compacted === false.

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import {
  rnpmCompactDb,
  rnpmCreateBackup,
  rnpmDeleteAllSaved,
  rnpmDeleteBackups,
  rnpmGetStats,
  rnpmListBackups,
  rnpmOpenBackupsFolder,
  rnpmOpenDbFolder,
} from "@/lib/rnpmApi";
import type { RnpmStats } from "@/types/rnpm";
import { RnpmSavedStats } from "./RnpmSavedStats";

vi.mock("@/lib/rnpmApi", () => ({
  rnpmGetStats: vi.fn(),
  rnpmListBackups: vi.fn(),
  rnpmDeleteAllSaved: vi.fn(),
  rnpmOpenDbFolder: vi.fn(),
  rnpmOpenBackupsFolder: vi.fn(),
  rnpmCreateBackup: vi.fn(),
  rnpmDeleteBackups: vi.fn(),
  rnpmCompactDb: vi.fn(),
}));

const getStatsMock = vi.mocked(rnpmGetStats);
const listBackupsMock = vi.mocked(rnpmListBackups);
const deleteAllMock = vi.mocked(rnpmDeleteAllSaved);
// Chemate doar la nevoie in acest test; mock-uite ca modulul sa nu esueze la import.
void rnpmOpenDbFolder;
void rnpmOpenBackupsFolder;
void rnpmCreateBackup;
void rnpmDeleteBackups;
void rnpmCompactDb;

let host: HTMLDivElement;
let root: Root;

async function render(ui: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ConfirmProvider>{ui}</ConfirmProvider>);
    await Promise.resolve();
  });
}

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});

const STATS: RnpmStats = {
  total: 5,
  activ: 5,
  inactiv: 0,
  byType: { ipoteci: 5 },
  db: { sizeBytes: 1024 },
};

beforeEach(() => {
  getStatsMock.mockReset().mockResolvedValue(STATS);
  listBackupsMock.mockReset().mockResolvedValue([]);
  deleteAllMock.mockReset();
});

function clickButton(pattern: RegExp): void {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    pattern.test(b.textContent ?? "")
  );
  if (!button) throw new Error(`Butonul ${pattern} nu a fost gasit`);
  button.click();
}

function confirmDialog(): Element {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("Dialogul de confirmare nu e deschis");
  return dialog;
}

describe("RnpmSavedStats - handleDeleteAll", () => {
  it("compacted=false: avertisment informativ, nu eroare blocanta", async () => {
    deleteAllMock.mockResolvedValue({ deleted: 5, compacted: false });
    await render(<RnpmSavedStats />);
    await act(async () => {
      clickButton(/Baza mea RNPM/);
      await Promise.resolve();
    });

    await act(async () => {
      clickButton(/Sterge baza/);
      await Promise.resolve();
    });
    const dialog = confirmDialog();
    const confirmBtn = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      /Sterge tot/.test(b.textContent ?? "")
    );
    if (!confirmBtn) throw new Error("Butonul de confirmare lipsa");
    await act(async () => {
      confirmBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteAllMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(
      "Avizele au fost sterse, dar eliberarea spatiului pe disc a esuat. Spatiul se recupereaza la urmatoarea compactare reusita."
    );
  });

  it("compacted=true: fara avertisment (comportament neschimbat)", async () => {
    deleteAllMock.mockResolvedValue({ deleted: 5, compacted: true });
    await render(<RnpmSavedStats />);
    await act(async () => {
      clickButton(/Baza mea RNPM/);
      await Promise.resolve();
    });

    await act(async () => {
      clickButton(/Sterge baza/);
      await Promise.resolve();
    });
    const dialog = confirmDialog();
    const confirmBtn = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      /Sterge tot/.test(b.textContent ?? "")
    );
    if (!confirmBtn) throw new Error("Butonul de confirmare lipsa");
    await act(async () => {
      confirmBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteAllMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("eliberarea spatiului pe disc a esuat");
  });
});
