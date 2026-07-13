// Contract de URL pentru rnpmDeleteBackups (fix review panel): componenta
// mock-uieste functia intreaga, deci query-ul ?ownerId= (cheie + encoding) si
// back-compat-ul fara argument (callerul self-service RnpmSavedStats) nu erau
// acoperite nicaieri.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
  extractErrorMessage: vi.fn(async () => "err"),
}));

import { apiFetch } from "@/lib/api";
import { rnpmDeleteBackups } from "./rnpmApi";

const apiFetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue(new Response(JSON.stringify({ deleted: 2 }), { status: 200 }));
});

describe("rnpmDeleteBackups", () => {
  it("cu ownerId trimite DELETE cu query-ul ?ownerId= encodat", async () => {
    const deleted = await rnpmDeleteBackups("u?&1");
    expect(deleted).toBe(2);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetchMock.mock.calls[0];
    expect(url).toBe("/api/rnpm/backups?ownerId=u%3F%261");
    expect(init).toMatchObject({ method: "DELETE" });
  });

  it("fara argument trimite DELETE fara query string (self-service, back-compat)", async () => {
    const deleted = await rnpmDeleteBackups();
    expect(deleted).toBe(2);
    const [url] = apiFetchMock.mock.calls[0];
    expect(url).toBe("/api/rnpm/backups");
  });
});
