// v2.43.x (admin rnpm storage): adminRnpmApi.ts foloseste clientul standard
// (apiFetch + unwrapMonitoring) ca sa nu piarda code/status/requestId din
// raspunsurile de eroare envelope. Mock doar pe apiFetch — unwrapMonitoring
// ramane implementarea reala (pattern din adminBackupsApi.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApiFetch = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  };
});

import { adminListRnpmUsage } from "./adminRnpmApi";

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

describe("adminRnpmApi", () => {
  it("adminListRnpmUsage intoarce rows din envelope si paseaza signal-ul", async () => {
    const rows = [
      {
        userId: "u1",
        email: "a@x.ro",
        displayName: "A",
        status: "active",
        dbSizeBytes: 1024,
        backupCount: 2,
        backupsBytes: 2048,
      },
    ];
    // CodeRabbit 1.6: ruta e paginata — raspunsul poarta si page/pageSize/total.
    mockApiFetch.mockResolvedValue(
      jsonResponse(200, { data: { rows, page: 1, pageSize: 20, total: rows.length }, requestId: "rid-1" })
    );
    const ac = new AbortController();
    await expect(adminListRnpmUsage({}, ac.signal)).resolves.toEqual({
      rows,
      page: 1,
      pageSize: 20,
      total: rows.length,
    });
    expect(mockApiFetch).toHaveBeenCalledWith("/api/v1/admin/rnpm/usage", { signal: ac.signal });
  });

  it("eroarea envelope pastreaza code/status/requestId", async () => {
    mockApiFetch.mockResolvedValue(
      jsonResponse(500, {
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Eroare interna" },
        requestId: "rid-2",
      })
    );
    await expect(adminListRnpmUsage()).rejects.toMatchObject({ status: 500, requestId: "rid-2" });
  });
});
