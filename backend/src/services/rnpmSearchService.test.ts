import { describe, expect, it, vi } from "vitest";

vi.mock("./captchaSolver.ts", () => ({
  solveRnpmCaptcha: vi.fn(async () => "stub-gcode"),
  CaptchaError: class CaptchaError extends Error {},
}));

import { executeSearch } from "./rnpmSearchService.ts";
import { RnpmClient, type RnpmError, type RnpmSearchResult, type RnpmSearchType } from "./rnpmClient.ts";

class CorruptTotalClient extends RnpmClient {
  constructor(private readonly total: unknown) {
    super({ requestDelayMs: 0 });
  }

  override async search(type: RnpmSearchType): Promise<RnpmSearchResult> {
    void type;
    return {
      total: this.total,
      pagesTotal: 1,
      pageSize: 25,
      currentPage: 1,
      documents: [],
      criteriu: "",
      eai: false,
    } as unknown as RnpmSearchResult;
  }
}

describe("executeSearch RNPM first result guard", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("arunca limit_exceeded daca firstResult.total este %s", async (_label, total) => {
    await expect(
      executeSearch(
        {
          type: "ipoteci",
          ownerId: "test-owner",
          params: {},
          captchaKey: "stub-key",
        },
        new CorruptTotalClient(total)
      )
    ).rejects.toMatchObject({
      name: "RnpmError",
      code: "limit_exceeded",
      status: 400,
      details: { total: null, limit: 1500 },
    } satisfies Partial<RnpmError>);
  });
});
