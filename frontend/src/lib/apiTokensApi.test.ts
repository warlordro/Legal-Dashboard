import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api";
import { createApiToken, listApiTokens, revokeAllApiTokens, revokeApiToken } from "./apiTokensApi";

const mocked = vi.mocked(apiFetch);

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ data }) } as unknown as Response;
}

afterEach(() => vi.clearAllMocks());

describe("apiTokensApi", () => {
  it("listApiTokens GETs and unwraps data", async () => {
    mocked.mockResolvedValue(jsonResponse([{ id: "1", name: "t" }]));
    const rows = await listApiTokens();
    expect(rows).toEqual([{ id: "1", name: "t" }]);
    expect(mocked).toHaveBeenCalledWith("/api/v1/tokens");
  });

  it("createApiToken POSTs JSON and returns the created token (incl. secret)", async () => {
    mocked.mockResolvedValue(jsonResponse({ id: "1", secret: "ld_pat_abc" }));
    const out = (await createApiToken({ name: "t", scopes: ["dosare"] })) as { secret: string };
    expect(out.secret).toBe("ld_pat_abc");
    const [url, init] = mocked.mock.calls[0];
    expect(url).toBe("/api/v1/tokens");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "t", scopes: ["dosare"] });
  });

  it("revokeApiToken DELETEs the id", async () => {
    mocked.mockResolvedValue(jsonResponse({ revoked: true }));
    await revokeApiToken("abc");
    expect(mocked).toHaveBeenCalledWith("/api/v1/tokens/abc", { method: "DELETE" });
  });

  it("revokeAllApiTokens POSTs revoke-all", async () => {
    mocked.mockResolvedValue(jsonResponse({ revoked: 3 }));
    await revokeAllApiTokens();
    expect(mocked).toHaveBeenCalledWith("/api/v1/tokens/revoke-all", { method: "POST" });
  });
});
