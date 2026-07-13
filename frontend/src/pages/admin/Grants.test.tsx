// @vitest-environment jsdom

// v2.43.0: selectFromActive e async (admin.getUser) — un raspuns intarziat
// pentru un rand vechi nu trebuie sa suprascrie o selectie mai noua (guard
// AbortController, pattern 6.7 din commit 733e7e2).

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";
import { admin, type AdminUser, type GlobalActiveGrantsResult } from "@/lib/api";
import AdminGrants from "./Grants";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    admin: {
      ...actual.admin,
      listActiveGrants: vi.fn(),
      listUsers: vi.fn(),
      listGrants: vi.fn(),
      getUser: vi.fn(),
    },
  };
});

const listActiveGrantsMock = vi.mocked(admin.listActiveGrants);
const listUsersMock = vi.mocked(admin.listUsers);
const listGrantsMock = vi.mocked(admin.listGrants);
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
  listGrantsMock.mockResolvedValue({ userId: "any", grants: [] });
  const active: GlobalActiveGrantsResult = {
    truncated: false,
    grants: [
      {
        id: 1,
        userId: "userA",
        email: "usera@example.com",
        displayName: "userA",
        role: "user",
        status: "active",
        feature: "ai",
        extraUsdMilli: 1000,
        expiresAt: "2027-01-01T00:00:00.000Z",
        reason: null,
        grantedAt: "2026-01-01T00:00:00.000Z",
        grantedBy: "admin",
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
      },
      {
        id: 2,
        userId: "userB",
        email: "userb@example.com",
        displayName: "userB",
        role: "user",
        status: "active",
        feature: "ai",
        extraUsdMilli: 2000,
        expiresAt: "2027-01-01T00:00:00.000Z",
        reason: null,
        grantedAt: "2026-01-01T00:00:00.000Z",
        grantedBy: "admin",
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
      },
    ],
  };
  listActiveGrantsMock.mockResolvedValue(active);
});

function clickEditFor(email: string): void {
  const row = Array.from(host.querySelectorAll("tr")).find((tr) => tr.textContent?.includes(email));
  if (!row) throw new Error(`Randul pentru ${email} nu a fost gasit`);
  const button = Array.from(row.querySelectorAll("button")).find((b) => /Editeaza/.test(b.textContent ?? ""));
  if (!button) throw new Error(`Butonul Editeaza pentru ${email} nu a fost gasit`);
  button.click();
}

describe("AdminGrants - selectFromActive staleness guard", () => {
  it("un raspuns getUser intarziat pentru randul vechi nu suprascrie selectia noua", async () => {
    const userA = makeUser("userA", "usera@example.com");
    const userB = makeUser("userB", "userb@example.com");
    const deferredA = deferred<AdminUser>();
    getUserMock.mockImplementation(async (id: string) => {
      if (id === "userA") return deferredA.promise;
      if (id === "userB") return userB;
      throw new Error(`getUser neasteptat: ${id}`);
    });

    await render(<AdminGrants embedded />);

    await act(async () => {
      clickEditFor("usera@example.com");
      await Promise.resolve();
    });

    await act(async () => {
      clickEditFor("userb@example.com");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("userb@example.com");

    await act(async () => {
      deferredA.resolve(userA);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("userb@example.com");
    expect(host.textContent).not.toContain("usera@example.com");
  });
});
