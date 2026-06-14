// Route-level coverage for /api/dosare-iccj (finding M6: dosareIccj router was
// fully untested). These exercise the input-validation guards (badSectie /
// badDate), the upstream-timeout mapping (DOMException TimeoutError -> 504) and
// the operational kill switch (ICCJ_ROUTES_DISABLED -> 503 + Retry-After).
//
// The router is a self-contained Hono instance, so we drive it with
// dosareIccjRouter.request(...) directly (no mount). The only external
// dependency is iccjClient, mocked with the importOriginal spread so the real
// IccjSourceError / IccjParseError classes survive — mapError does
// `instanceof IccjSourceError` BEFORE the DOMException branch, and a bare mock
// factory would import those as undefined and throw inside the catch.

import { describe, expect, it, vi } from "vitest";

vi.mock("../services/iccj/iccjClient.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/iccj/iccjClient.ts")>();
  return {
    ...actual,
    searchIccjEnriched: vi.fn(),
    fetchIccjDetail: vi.fn(),
    searchTermeneByDosarIccj: vi.fn(),
  };
});

import { searchIccjEnriched } from "../services/iccj/iccjClient.ts";
import { dosareIccjRouter } from "./dosareIccj.ts";

type ErrorBody = { error: string; code?: string };

describe("dosareIccj router", () => {
  it("sectie necunoscuta returneaza 400 cu mesaj dedicat", async () => {
    // numeParte satisface gate-ul "cel putin un parametru" ca sa ajunga la badSectie.
    const res = await dosareIccjRouter.request("/?numeParte=Ion&sectie=INVALID");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toBe("Sectie necunoscuta.");
  });

  it("data calendaristic imposibila returneaza 400", async () => {
    // dataStart prezent satisface gate-ul de parametru SI declanseaza badDate
    // (isValidDate respinge 2026-02-31 — roll-over peste luna).
    const res = await dosareIccjRouter.request("/?dataStart=2026-02-31");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toBe("Data trebuie sa fie o data calendaristica valida in format YYYY-MM-DD.");
  });

  it("timeout upstream (DOMException TimeoutError) se mapeaza la 504", async () => {
    vi.mocked(searchIccjEnriched).mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await dosareIccjRouter.request("/?numeParte=Ion");
    errSpy.mockRestore();
    expect(res.status).toBe(504);
    // 504 e retryabil ca si 503, deci poarta Retry-After — fereastra mai scurta (60s).
    expect(res.headers.get("Retry-After")).toBe("60");
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toMatch(/in timp util/);
  });

  it("ICCJ_ROUTES_DISABLED=1 returneaza 503 cu Retry-After si cod ICCJ_DISABLED", async () => {
    const original = process.env.ICCJ_ROUTES_DISABLED;
    process.env.ICCJ_ROUTES_DISABLED = "1";
    try {
      const res = await dosareIccjRouter.request("/?numeParte=Ion");
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("300");
      const body = (await res.json()) as ErrorBody;
      expect(body.code).toBe("ICCJ_DISABLED");
    } finally {
      if (original === undefined) {
        // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
        delete process.env.ICCJ_ROUTES_DISABLED;
      } else {
        process.env.ICCJ_ROUTES_DISABLED = original;
      }
    }
  });
});
