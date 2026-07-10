// @vitest-environment jsdom

// v2.43.0 (rnpm-split): pagina admin de backup al MONOLITULUI (tab Setari >
// Backup). Confirmarea la restore e destructiva si spune explicit ca e baza
// COMPLETA (datele RNPM au backup separat per utilizator).

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { adminCreateBackup, adminDeleteBackups, adminListBackups, adminRestoreBackup } from "@/lib/adminBackupsApi";
import AdminBackups from "./Backups";

vi.mock("@/lib/adminBackupsApi", () => ({
  adminListBackups: vi.fn(),
  adminCreateBackup: vi.fn(),
  adminRestoreBackup: vi.fn(),
  adminDeleteBackups: vi.fn(),
}));

const listMock = vi.mocked(adminListBackups);
const createMock = vi.mocked(adminCreateBackup);
const restoreMock = vi.mocked(adminRestoreBackup);
const deleteMock = vi.mocked(adminDeleteBackups);

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

beforeEach(() => {
  listMock.mockReset();
  createMock.mockReset();
  restoreMock.mockReset();
  deleteMock.mockReset();
  listMock.mockResolvedValue([
    { name: "legal-dashboard.2026-07-10.db", sizeBytes: 1024 * 1024, mtime: Date.now() },
    { name: "legal-dashboard.manual-2026-07-09T10-00-00.db", sizeBytes: 2048, mtime: Date.now() - 1000 },
  ]);
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

describe("AdminBackups (embedded)", () => {
  it("randeaza lista backup-urilor monolitului", async () => {
    await render(<AdminBackups embedded />);
    expect(host.textContent).toContain("Backup baza completa");
    expect(host.textContent).toContain("legal-dashboard.2026-07-10.db");
    expect(host.textContent).toContain("legal-dashboard.manual-2026-07-09T10-00-00.db");
  });

  it("restore cere confirmare destructiva cu copy-ul despre baza COMPLETA, apoi apeleaza API-ul", async () => {
    restoreMock.mockResolvedValue({ preRestoreName: "legal-dashboard.pre-restore-x.db" });
    await render(<AdminBackups embedded />);
    await act(async () => {
      clickButton(/^Restaureaza/);
      await Promise.resolve();
    });
    const dialog = confirmDialog();
    expect(dialog.textContent).toContain("backup-ul COMPLET al bazei");
    expect(dialog.textContent).toContain("toti utilizatorii");
    expect(dialog.textContent).toContain("backup separat per utilizator");

    const confirmBtn = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      /Restaureaza/.test(b.textContent ?? "")
    );
    if (!confirmBtn) throw new Error("Butonul de confirmare lipsa");
    await act(async () => {
      confirmBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(restoreMock).toHaveBeenCalledWith("legal-dashboard.2026-07-10.db");
    expect(host.textContent).toContain("Restaurare completa. Snapshot pre-restore: legal-dashboard.pre-restore-x.db");
  });

  it("creeaza backup manual si afiseaza numele", async () => {
    createMock.mockResolvedValue({ name: "legal-dashboard.manual-2026-07-10T12-00-00.db" });
    await render(<AdminBackups embedded />);
    await act(async () => {
      clickButton(/Creeaza backup acum/);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Backup creat: legal-dashboard.manual-2026-07-10T12-00-00.db");
  });

  it("stergerea tuturor backup-urilor cere confirmare destructiva", async () => {
    deleteMock.mockResolvedValue(2);
    await render(<AdminBackups embedded />);
    await act(async () => {
      clickButton(/Sterge toate backup-urile/);
      await Promise.resolve();
    });
    const dialog = confirmDialog();
    expect(dialog.textContent).toContain("bazei complete");
    const confirmBtn = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      /Sterge toate/.test(b.textContent ?? "")
    );
    if (!confirmBtn) throw new Error("Butonul de confirmare lipsa");
    await act(async () => {
      confirmBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("2 backup-uri sterse");
  });
});
