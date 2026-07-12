import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./captchaSolver.ts", () => ({
  solveRnpmCaptcha: vi.fn(async () => "stub-gcode"),
  CaptchaError: class CaptchaError extends Error {},
}));

import { __resetRnpmActivityForTests } from "../db/rnpmActivity.ts";
import { __resetRnpmDbForTests } from "../db/rnpmDb.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { executeBulkSearch, executeSearch, executeSplitSearch } from "./rnpmSearchService.ts";
import { RnpmClient, type RnpmSearchResult, type RnpmSearchType } from "./rnpmClient.ts";

let tmpRoot: string;

class PagingClient extends RnpmClient {
  calls = 0;

  constructor(private readonly pages = 1) {
    super({ requestDelayMs: 0 });
  }

  override async search(_type: RnpmSearchType, _params: unknown, page = 1): Promise<RnpmSearchResult> {
    this.calls++;
    return {
      total: this.pages,
      pagesTotal: this.pages,
      pageSize: 1,
      currentPage: page,
      documents:
        this.pages === 1
          ? []
          : [
              {
                no: page,
                identificator: { v: `AV-${page}`, k: null },
                utilizatorAutorizat: "",
                data: "12.07.2026",
                tip: "Aviz initial",
                needsActualizare: false,
                activ: true,
              },
            ],
      criteriu: "",
      eai: false,
    };
  }
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-storage-recheck-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
});

afterEach(async () => {
  __resetRnpmActivityForTests();
  __resetRnpmDbForTests();
  closeDb();
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DB_PATH");
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("recheck limita RNPM in servicii", () => {
  it("executeSearch verifica intre batch-urile interne de pagini", async () => {
    const client = new PagingClient(2);
    const storageLimitCheck = vi.fn(async () => {
      throw new Error("storage full");
    });

    await expect(
      executeSearch(
        {
          type: "ipoteci",
          ownerId: "u1",
          params: {},
          captchaKey: "stub-key",
          batchSize: 2,
          fetchDetails: false,
          storageLimitCheck,
        },
        client
      )
    ).rejects.toThrow("storage full");
    expect(client.calls).toBe(1);
    expect(storageLimitCheck).toHaveBeenCalledOnce();
  });

  it("continuarea cu existingGcode termina paginile fara recheck", async () => {
    const client = new PagingClient(2);
    const storageLimitCheck = vi.fn(async () => {
      throw new Error("nu trebuie apelat");
    });

    await expect(
      executeSearch(
        {
          type: "ipoteci",
          ownerId: "u1",
          params: {},
          captchaKey: "stub-key",
          existingGcode: "existing",
          batchSize: 2,
          fetchDetails: false,
          storageLimitCheck,
        },
        client
      )
    ).resolves.toMatchObject({ documents: expect.any(Array) });
    expect(client.calls).toBe(2);
    expect(storageLimitCheck).not.toHaveBeenCalled();
  });

  it("bulk recheck-uieste intre iteme si emite eroare coerenta pe itemul blocat", async () => {
    const client = new PagingClient();
    const progress = vi.fn();
    const storageLimitCheck = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("storage full"));

    await executeBulkSearch(
      [
        { type: "ipoteci", params: {}, label: "unu" },
        { type: "ipoteci", params: {}, label: "doi" },
      ],
      "stub-key",
      "u1",
      progress,
      client,
      undefined,
      undefined,
      undefined,
      undefined,
      storageLimitCheck
    );

    expect(storageLimitCheck).toHaveBeenCalledTimes(2);
    expect(client.calls).toBe(1);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ index: 1, phase: "error", error: "storage full" }));
  });

  it("bulk propaga recheck-ul intre paginile interne ale aceluiasi item", async () => {
    const client = new PagingClient(2);
    const progress = vi.fn();
    const storageLimitCheck = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("storage full in paging"));

    await executeBulkSearch(
      [{ type: "ipoteci", params: {}, label: "unu" }],
      "stub-key",
      "u1",
      progress,
      client,
      undefined,
      undefined,
      undefined,
      undefined,
      storageLimitCheck
    );

    expect(storageLimitCheck).toHaveBeenCalledTimes(2);
    expect(client.calls).toBe(1);
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0, phase: "error", error: "storage full in paging" })
    );
  });

  it("split recheck-uieste intre sub-cautari", async () => {
    const client = new PagingClient();
    const storageLimitCheck = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("storage full"));

    const result = await executeSplitSearch(
      {
        type: "fiducii",
        baseParams: {},
        subTypeLabels: ["unu", "doi"],
        captchaKey: "stub-key",
        ownerId: "u1",
        storageLimitCheck,
      },
      vi.fn(),
      client
    );

    expect(storageLimitCheck).toHaveBeenCalledTimes(2);
    expect(client.calls).toBe(1);
    expect(result.splitStats).toContainEqual(expect.objectContaining({ label: "doi", status: "error" }));
  });

  it("split propaga recheck-ul intre paginile interne ale aceluiasi sub-tip", async () => {
    const client = new PagingClient(2);
    const storageLimitCheck = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("storage full in paging"));

    const result = await executeSplitSearch(
      {
        type: "fiducii",
        baseParams: {},
        subTypeLabels: ["unu"],
        captchaKey: "stub-key",
        ownerId: "u1",
        storageLimitCheck,
      },
      vi.fn(),
      client
    );

    expect(storageLimitCheck).toHaveBeenCalledTimes(2);
    expect(client.calls).toBe(1);
    expect(result.splitStats).toContainEqual(
      expect.objectContaining({ label: "unu", status: "error", reason: "storage full in paging" })
    );
  });
});
