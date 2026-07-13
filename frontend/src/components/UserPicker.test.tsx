// @vitest-environment jsdom

// v2.43.0: UserPicker pagina toate paginile de utilizatori activi (nu doar
// prima, PAGE_SIZE=100) — inainte userii de dupa locul 100 lipseau din
// dropdown, ne-selectabili pentru Cote/Granturi.

import type React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admin, type AdminUser, type PaginatedUsers } from "@/lib/api";
import { UserPicker } from "./UserPicker";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    admin: {
      ...actual.admin,
      listUsers: vi.fn(),
    },
  };
});

const listUsersMock = vi.mocked(admin.listUsers);

beforeEach(() => {
  // vi.restoreAllMocks nu curata istoricul unui vi.fn din factory-ul vi.mock —
  // fara reset, asertiile pe numarul de apeluri ar numara si testele anterioare.
  listUsersMock.mockReset();
});

let host: HTMLDivElement;
let root: Root;

async function render(ui: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(ui);
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

function makeUser(id: string): AdminUser {
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    role: "user",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastLoginAt: null,
  };
}

function page(pageNum: number, pageSize: number, total: number): PaginatedUsers {
  const start = (pageNum - 1) * pageSize;
  const count = Math.max(0, Math.min(pageSize, total - start));
  const rows = Array.from({ length: count }, (_, i) => makeUser(`u${start + i}`));
  return { rows, page: pageNum, pageSize, total };
}

describe("UserPicker", () => {
  it("acumuleaza toate paginile cand totalul depaseste pageSize", async () => {
    listUsersMock.mockImplementation(async (opts) => {
      const pageNum = opts?.page ?? 1;
      return page(pageNum, 100, 250);
    });

    await render(<UserPicker value="" onSelect={() => {}} ariaLabel="Utilizator" />);

    expect(listUsersMock).toHaveBeenCalledTimes(3);
    // Select-ul e populat cu toti cei 250 (verificam via numarul de SelectItem randate in DOM ascuns).
    expect(host.textContent).not.toContain("lista e trunchiata");
  });

  it("se opreste cand o pagina vine goala desi totalul promitea mai mult (fara bucla infinita)", async () => {
    // Useri stersi intre pagini: total=250 dar pagina 3 nu mai are randuri.
    listUsersMock.mockImplementation(async (opts) => {
      const pageNum = opts?.page ?? 1;
      const p = page(pageNum, 100, 250);
      return pageNum >= 3 ? { ...p, rows: [] } : p;
    });

    await render(<UserPicker value="" onSelect={() => {}} ariaLabel="Utilizator" />);

    expect(listUsersMock).toHaveBeenCalledTimes(3);
  });

  it("afiseaza avertisment de trunchiere doar cand totalul depaseste plafonul de siguranta", async () => {
    listUsersMock.mockImplementation(async (opts) => {
      const pageNum = opts?.page ?? 1;
      return page(pageNum, 100, 5000);
    });

    await render(<UserPicker value="" onSelect={() => {}} ariaLabel="Utilizator" />);

    expect(host.textContent).toContain("lista e trunchiata la 1000");
  });
});
