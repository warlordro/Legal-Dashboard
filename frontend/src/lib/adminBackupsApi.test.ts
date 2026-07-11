// v2.43.0 (rnpm-split, C1): adminBackupsApi.ts trebuie sa foloseasca clientul
// standard (apiFetch + unwrapMonitoring) ca sa nu piarda code/status/requestId
// din raspunsurile de eroare envelope. Mock doar pe apiFetch — unwrapMonitoring
// ramane implementarea reala (pattern din ApiKeyDialog.test.tsx).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApiFetch = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  };
});

import { adminCreateBackup, adminDeleteBackups, adminListBackups, adminRestoreBackup } from "./adminBackupsApi";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  mockApiFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adminBackupsApi", () => {
  it("eroarea envelope produce o eroare cu code, status si requestId (nu doar message)", async () => {
    mockApiFetch.mockResolvedValue(
      jsonResponse(409, {
        data: null,
        error: { code: "RESTORE_IN_PROGRESS", message: "Un restore este deja in curs" },
        requestId: "rid-1",
      })
    );

    await expect(adminCreateBackup()).rejects.toMatchObject({
      code: "RESTORE_IN_PROGRESS",
      status: 409,
      requestId: "rid-1",
      message: "Un restore este deja in curs",
    });
  });

  it("adminListBackups intoarce array-ul din data.backups la succes", async () => {
    const backups = [{ name: "legal-dashboard.2026-07-10.db", sizeBytes: 10, mtime: 1 }];
    mockApiFetch.mockResolvedValue(jsonResponse(200, { data: { backups }, requestId: "rid-2" }));

    await expect(adminListBackups()).resolves.toEqual(backups);
  });

  it("adminRestoreBackup intoarce preRestoreName din data la succes", async () => {
    mockApiFetch.mockResolvedValue(
      jsonResponse(200, { data: { preRestoreName: "legal-dashboard.pre-restore-x.db" }, requestId: "rid-3" })
    );

    await expect(adminRestoreBackup("legal-dashboard.x.db")).resolves.toEqual({
      preRestoreName: "legal-dashboard.pre-restore-x.db",
    });
  });

  it("adminDeleteBackups intoarce deleted din data la succes", async () => {
    mockApiFetch.mockResolvedValue(jsonResponse(200, { data: { deleted: 3 }, requestId: "rid-4" }));

    await expect(adminDeleteBackups()).resolves.toBe(3);
  });
});
