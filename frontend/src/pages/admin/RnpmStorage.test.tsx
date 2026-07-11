// @vitest-environment jsdom

// v2.43.x (admin rnpm storage): cardul "Stocare RNPM" din tab Setari > Backup.
// Listeaza dimensiunea bazei RNPM per user + compactare (VACUUM) cross-owner,
// cu confirmare, staleness guard pe reload (pattern 6.7) si 409 prietenos.

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { adminListRnpmUsage, type AdminRnpmUsageRow } from "@/lib/adminRnpmApi";
import { ApiError, rnpmCompactDb } from "@/lib/rnpmApi";
import AdminRnpmStorage from "./RnpmStorage";

vi.mock("@/lib/adminRnpmApi", () => ({
  adminListRnpmUsage: vi.fn(),
}));

vi.mock("@/lib/rnpmApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rnpmApi")>();
  return {
    ...actual,
    rnpmCompactDb: vi.fn(),
  };
});

const usageMock = vi.mocked(adminListRnpmUsage);
const compactMock = vi.mocked(rnpmCompactDb);

let host: HTMLDivElement;
let root: Root;

async function render(ui: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(ui);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clickButton(pattern: RegExp): void {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    pattern.test(b.textContent ?? "")
  );
  if (!button) throw new Error(`Butonul ${pattern} nu a fost gasit`);
  button.click();
}

function dialogButton(pattern: RegExp): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("Dialogul de confirmare nu e deschis");
  const btn = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    pattern.test(b.textContent ?? "")
  );
  if (!btn) throw new Error(`Butonul ${pattern} din dialog nu a fost gasit`);
  return btn;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});

beforeEach(() => {
  usageMock.mockReset();
  compactMock.mockReset();
});

describe("AdminRnpmStorage (embedded)", () => {
  it("randeaza un rand per user cu dimensiuni formatate si — pentru user fara fisier", async () => {
    usageMock.mockResolvedValue([
      {
        userId: "u1",
        email: "a@x.ro",
        displayName: "A",
        status: "active",
        dbSizeBytes: 2 * 1024 * 1024,
        backupCount: 1,
        backupsBytes: 1024,
      },
      {
        userId: "u2",
        email: "b@x.ro",
        displayName: "B",
        status: "suspended",
        dbSizeBytes: null,
        backupCount: 0,
        backupsBytes: 0,
      },
    ]);
    await render(
      <ConfirmProvider>
        <AdminRnpmStorage embedded />
      </ConfirmProvider>
    );
    expect(host.textContent).toContain("a@x.ro");
    expect(host.textContent).toContain("2.0 MB"); // formatBytes real: toFixed(1)
    expect(host.textContent).toContain("—");
  });

  it("butonul Compacteaza cere confirmare si apeleaza rnpmCompactDb cu ownerId-ul randului", async () => {
    usageMock.mockResolvedValue([
      {
        userId: "u1",
        email: "a@x.ro",
        displayName: "A",
        status: "active",
        dbSizeBytes: 4096,
        backupCount: 1,
        backupsBytes: 2048,
      },
    ]);
    compactMock.mockResolvedValue({ beforeBytes: 4096, afterBytes: 2048, durationMs: 12 });

    await render(
      <ConfirmProvider>
        <AdminRnpmStorage embedded />
      </ConfirmProvider>
    );

    await act(async () => {
      clickButton(/Compacteaz/);
      await Promise.resolve();
    });

    await act(async () => {
      dialogButton(/Compacteaz/).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(compactMock).toHaveBeenCalledWith("u1");
    expect(usageMock).toHaveBeenCalledTimes(2); // mount + reload post-compact
    expect(host.textContent).toContain("Compactat: 4.0 KB -> 2.0 KB");
  });

  it("raspunsul stale al listei nu suprascrie un reload mai nou", async () => {
    const p1 = deferred<AdminRnpmUsageRow[]>();
    const p2 = deferred<AdminRnpmUsageRow[]>();
    usageMock.mockReturnValueOnce(p1.promise).mockReturnValueOnce(p2.promise);

    await render(
      <ConfirmProvider>
        <AdminRnpmStorage embedded />
      </ConfirmProvider>
    );

    // mount -> load#1 (P1 pending). Reincarca -> load#2 (P2 pending), abort load#1.
    await act(async () => {
      clickButton(/Reincarca/);
      await Promise.resolve();
    });

    // P2 (lista noua) rezolva primul.
    await act(async () => {
      p2.resolve([
        {
          userId: "u2",
          email: "nou@x.ro",
          displayName: "Nou",
          status: "active",
          dbSizeBytes: 1024,
          backupCount: 0,
          backupsBytes: 0,
        },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    // P1 (lista veche) rezolva ultimul — nu trebuie sa suprascrie.
    await act(async () => {
      p1.resolve([
        {
          userId: "u1",
          email: "vechi@x.ro",
          displayName: "Vechi",
          status: "active",
          dbSizeBytes: 4096,
          backupCount: 0,
          backupsBytes: 0,
        },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("nou@x.ro");
    expect(host.textContent).not.toContain("vechi@x.ro");
  });

  it("double-click pe Compacteaza porneste O SINGURA compactare (guard sincron pre-confirm)", async () => {
    usageMock.mockResolvedValue([
      {
        userId: "u1",
        email: "a@x.ro",
        displayName: "A",
        status: "active",
        dbSizeBytes: 4096,
        backupCount: 0,
        backupsBytes: 0,
      },
    ]);
    compactMock.mockResolvedValue({ beforeBytes: 4096, afterBytes: 2048, durationMs: 12 });

    await render(
      <ConfirmProvider>
        <AdminRnpmStorage embedded />
      </ConfirmProvider>
    );

    // Doua clickuri rapide INAINTE de confirmare: al doilea nu are voie sa
    // porneasca un al doilea confirm() (care ar orfana promisiunea primului).
    await act(async () => {
      clickButton(/Compacteaz/);
      clickButton(/Compacteaz/);
      await Promise.resolve();
    });

    await act(async () => {
      dialogButton(/Compacteaz/).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(compactMock).toHaveBeenCalledTimes(1);
    // Guard-ul se elibereaza: un click ulterior redeschide confirmarea normal.
    await act(async () => {
      clickButton(/Compacteaz/);
      await Promise.resolve();
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () => {
      dialogButton(/Anuleaz/).click();
      await Promise.resolve();
    });
  });

  it("unmount in timpul compactarii: fara reload si fara setState post-unmount", async () => {
    usageMock.mockResolvedValue([
      {
        userId: "u1",
        email: "a@x.ro",
        displayName: "A",
        status: "active",
        dbSizeBytes: 4096,
        backupCount: 0,
        backupsBytes: 0,
      },
    ]);
    const pending = deferred<{ beforeBytes: number; afterBytes: number; durationMs: number }>();
    compactMock.mockReturnValue(pending.promise);

    await render(
      <ConfirmProvider>
        <AdminRnpmStorage embedded />
      </ConfirmProvider>
    );

    await act(async () => {
      clickButton(/Compacteaz/);
      await Promise.resolve();
    });
    await act(async () => {
      dialogButton(/Compacteaz/).click();
      await Promise.resolve();
    });
    expect(usageMock).toHaveBeenCalledTimes(1); // doar load-ul de la mount

    // Unmount cu compactarea in zbor, apoi rezolvarea ei tarzie.
    await act(async () => {
      root.unmount();
    });
    await act(async () => {
      pending.resolve({ beforeBytes: 4096, afterBytes: 2048, durationMs: 12 });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Fara reload pornit dupa unmount (usageMock ramane la load-ul initial).
    expect(usageMock).toHaveBeenCalledTimes(1);
    // Remontam un root gol ca afterEach-ul (root.unmount) sa ramana valid.
    root = createRoot(host);
  });

  it("409 (operatie RNPM in curs la userul tinta) se afiseaza ca mesaj prietenos", async () => {
    usageMock.mockResolvedValue([
      {
        userId: "u1",
        email: "a@x.ro",
        displayName: "A",
        status: "active",
        dbSizeBytes: 4096,
        backupCount: 0,
        backupsBytes: 0,
      },
    ]);
    compactMock.mockRejectedValue(new ApiError("Exista o cautare RNPM in curs", 409, "SEARCH_ACTIVE"));

    await render(
      <ConfirmProvider>
        <AdminRnpmStorage embedded />
      </ConfirmProvider>
    );

    await act(async () => {
      clickButton(/Compacteaz/);
      await Promise.resolve();
    });

    await act(async () => {
      dialogButton(/Compacteaz/).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("operatie RNPM in curs");
  });
});
