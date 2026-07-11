// @vitest-environment jsdom

// v2.43.0: selectFromOverview e async (admin.getUser) — un raspuns intarziat
// pentru un rand vechi nu trebuie sa suprascrie o selectie mai noua (guard
// AbortController, pattern 6.7 din commit 733e7e2).

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";
import { admin, type AdminUser, type GlobalQuotaOverridesResult } from "@/lib/api";
import AdminQuota from "./Quota";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    admin: {
      ...actual.admin,
      listAllQuotaOverrides: vi.fn(),
      listUsers: vi.fn(),
      listQuota: vi.fn(),
      getUser: vi.fn(),
    },
  };
});

const listAllQuotaOverridesMock = vi.mocked(admin.listAllQuotaOverrides);
const listUsersMock = vi.mocked(admin.listUsers);
const listQuotaMock = vi.mocked(admin.listQuota);
const getUserMock = vi.mocked(admin.getUser);

let host: HTMLDivElement;
let root: Root;

async function render(ui: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <ToastProvider>
        <ConfirmProvider>{ui}</ConfirmProvider>
      </ToastProvider>
    );
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

function makeUser(id: string, email: string): AdminUser {
  return {
    id,
    email,
    displayName: id,
    role: "user",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastLoginAt: null,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  listUsersMock.mockResolvedValue({ rows: [], page: 1, pageSize: 100, total: 0 });
  listQuotaMock.mockResolvedValue({ userId: "any", overrides: [] });
  const overview: GlobalQuotaOverridesResult = {
    truncated: false,
    overrides: [
      {
        userId: "userA",
        email: "usera@example.com",
        displayName: "userA",
        role: "user",
        status: "active",
        feature: "ai",
        period: "day",
        limitUsdMilli: 1000,
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: null,
      },
      {
        userId: "userB",
        email: "userb@example.com",
        displayName: "userB",
        role: "user",
        status: "active",
        feature: "ai",
        period: "day",
        limitUsdMilli: 2000,
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: null,
      },
    ],
  };
  listAllQuotaOverridesMock.mockResolvedValue(overview);
});

function clickEditFor(email: string): void {
  const row = Array.from(host.querySelectorAll("tr")).find((tr) => tr.textContent?.includes(email));
  if (!row) throw new Error(`Randul pentru ${email} nu a fost gasit`);
  const button = row.querySelector("button");
  if (!button) throw new Error(`Butonul Editeaza pentru ${email} nu a fost gasit`);
  button.click();
}

describe("AdminQuota - selectFromOverview staleness guard", () => {
  it("un raspuns getUser intarziat pentru randul vechi nu suprascrie selectia noua", async () => {
    const userA = makeUser("userA", "usera@example.com");
    const userB = makeUser("userB", "userb@example.com");
    const deferredA = deferred<AdminUser>();
    getUserMock.mockImplementation(async (id: string) => {
      if (id === "userA") return deferredA.promise;
      if (id === "userB") return userB;
      throw new Error(`getUser neasteptat: ${id}`);
    });

    await render(<AdminQuota embedded />);

    // Click Editeaza pe randul A — porneste fetch-ul lent, inca nerezolvat.
    await act(async () => {
      clickEditFor("usera@example.com");
      await Promise.resolve();
    });

    // Click Editeaza pe randul B — fetch rapid, rezolvat imediat.
    await act(async () => {
      clickEditFor("userb@example.com");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("userb@example.com");

    // Raspunsul intarziat pentru A ateriza ACUM, dupa ce B a fost deja selectat.
    await act(async () => {
      deferredA.resolve(userA);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Selectia trebuie sa ramana B — A nu trebuie sa suprascrie.
    expect(host.textContent).toContain("userb@example.com");
    expect(host.textContent).not.toContain("usera@example.com");
  });
});
