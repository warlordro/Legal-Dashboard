// @vitest-environment jsdom

// v2.43.0 (rnpm-split): copy-ul modalului de restore e per-USER ("baza mea
// RNPM"), succes fara "reporneste aplicatia" (reopen lazy), iar mesajul real
// din envelope (ex. SEARCH_ACTIVE) ajunge in starea de eroare, nu in fallback.

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { rnpmListBackups, rnpmRestoreBackup } from "@/lib/rnpmApi";
import { RnpmRestoreModal } from "./RnpmRestoreModal";

vi.mock("@/lib/rnpmApi", () => ({
  rnpmListBackups: vi.fn(),
  rnpmRestoreBackup: vi.fn(),
}));

const listMock = vi.mocked(rnpmListBackups);
const restoreMock = vi.mocked(rnpmRestoreBackup);

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
  restoreMock.mockReset();
  listMock.mockResolvedValue([{ name: "rnpm.manual-2026-07-10T00-00-00.db", sizeBytes: 4096, mtime: Date.now() }]);
});

function confirmDialogButton(pattern: RegExp): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("Dialogul de confirmare nu e deschis");
  const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    pattern.test(candidate.textContent ?? "")
  );
  if (!button) throw new Error("Butonul de confirmare nu a fost gasit");
  return button;
}

function clickButton(pattern: RegExp): void {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    pattern.test(b.textContent ?? "")
  );
  if (!button) throw new Error(`Butonul ${pattern} nu a fost gasit`);
  button.click();
}

describe("RnpmRestoreModal (v2.43.0)", () => {
  it("titlul si confirmarea vorbesc despre baza MEA RNPM, nu despre toata baza", async () => {
    await render(<RnpmRestoreModal onClose={() => {}} onRestored={() => {}} />);
    expect(host.textContent).toContain("Restaurare baza mea RNPM");

    await act(async () => {
      clickButton(/Restaureaza/);
      await Promise.resolve();
    });
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("DOAR datele tale RNPM");
    expect(dialog?.textContent).toContain("NU este afectat");
    expect(dialog?.textContent).toContain("rnpm.pre-restore-");
  });

  it("succes: mesaj cu snapshotul pre-restore, FARA 'reporneste aplicatia'; onRestored ruleaza dupa delay", async () => {
    restoreMock.mockResolvedValue({ preRestoreName: "rnpm.pre-restore-2026.db" });
    const timeouts: Array<() => void> = [];
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 2500) {
        timeouts.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return origSetTimeout(fn, ms);
    }) as typeof setTimeout);

    const onRestored = vi.fn();
    await render(<RnpmRestoreModal onClose={() => {}} onRestored={onRestored} />);
    await act(async () => {
      clickButton(/Restaureaza/);
      await Promise.resolve();
    });
    await act(async () => {
      confirmDialogButton(/Restaureaza/).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(restoreMock).toHaveBeenCalledWith("rnpm.manual-2026-07-10T00-00-00.db");
    expect(host.textContent).toContain("Restaurare completa. Snapshot pre-restore: rnpm.pre-restore-2026.db");
    expect(host.textContent).not.toContain("eporneste aplicatia");

    // Lantul onRestored -> (RnpmSavedStats) onAfterDeleteAll reseteaza starea
    // cautarii din UI — protectia pentru searchId-uri cache-uite dupa restore.
    expect(onRestored).not.toHaveBeenCalled();
    await act(async () => {
      for (const fn of timeouts) fn();
    });
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it("eroarea reala din envelope (SEARCH_ACTIVE) ajunge in starea de eroare, nu in fallback generic", async () => {
    restoreMock.mockRejectedValue(new Error("Exista o cautare RNPM in curs pentru acest cont"));
    await render(<RnpmRestoreModal onClose={() => {}} onRestored={() => {}} />);
    await act(async () => {
      clickButton(/Restaureaza/);
      await Promise.resolve();
    });
    await act(async () => {
      confirmDialogButton(/Restaureaza/).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Exista o cautare RNPM in curs");
  });
});
