import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./captchaSolver.ts", () => ({
  solveRnpmCaptcha: vi.fn(async () => "stub-gcode"),
  CaptchaError: class CaptchaError extends Error {},
}));

import { __resetRnpmActivityForTests } from "../db/rnpmActivity.ts";
import { __resetRnpmDbForTests } from "../db/rnpmDb.ts";
import { closeDb, getDb } from "../db/schema.ts";
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

describe("executeSearch pagesTotal clamp (BUG-06)", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-clamp-"));
    process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
    const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
    seed.close();
    getDb();
  });

  afterEach(async () => {
    __resetRnpmActivityForTests();
    __resetRnpmDbForTests();
    closeDb();
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
    delete process.env.LEGAL_DASHBOARD_DB_PATH;
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  });

  it("clamps an inflated pagesTotal to ceil(total/pageSize)", async () => {
    class InflatedPagesClient extends RnpmClient {
      calls = 0;
      constructor() {
        super({ requestDelayMs: 0 });
      }
      override async search(): Promise<RnpmSearchResult> {
        this.calls++;
        return {
          total: 30,
          pagesTotal: 50,
          pageSize: 25,
          currentPage: this.calls,
          documents: [],
          criteriu: "",
          eai: false,
        } as unknown as RnpmSearchResult;
      }
    }
    const client = new InflatedPagesClient();
    await executeSearch(
      { type: "ipoteci", ownerId: "t", params: {}, captchaKey: "stub", fetchDetails: false },
      client
    ).catch(() => {});
    // ceil(30/25) = 2 pages, NOT the inflated 50 the client advertised.
    expect(client.calls).toBeLessThanOrEqual(2);
  });
});
