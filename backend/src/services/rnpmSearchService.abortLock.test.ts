// Gard: abortul sosit CAT TIMP asteptam lock-ul de mentenanta nu trebuie sa
// lase scrierea sa se execute dupa achizitie.
//
// Verificarea existenta (rnpmSearchService.ts, dupa `fetchFullDetail`) se face
// INAINTE de `withMaintenanceRead`. Daca abortul vine dupa acel check, in timpul
// cozii pe lock — fereastra care se lungeste de la secunde la minute cand un
// backup/compact tine writer-ul — persistarea ruleaza oricum, pentru un client
// care a plecat deja.
//
// Politica pinuita aici: dupa ce abortul e observat NU se mai fac scrieri NOI.
// Ce s-a scris deja ramane, intentionat, pentru recuperarea starii partiale.
import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./captchaSolver.ts", () => ({
  solveRnpmCaptcha: vi.fn(async () => "stub-gcode"),
  CaptchaError: class CaptchaError extends Error {},
}));

// Lock-ul de mentenanta: il tinem ocupat ca sa simulam coada reala.
let releaseLock: (() => void) | null = null;
vi.mock("../db/backup.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/backup.ts")>();
  return {
    ...actual,
    withMaintenanceRead: async <T>(fn: () => Promise<T>): Promise<T> => {
      await new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      return fn();
    },
  };
});

import { __resetRnpmActivityForTests } from "../db/rnpmActivity.ts";
import { __resetRnpmDbForTests, getRnpmDb } from "../db/rnpmDb.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { RnpmClient, type RnpmSearchResult, type RnpmSearchType } from "./rnpmClient.ts";
import { executeSearch } from "./rnpmSearchService.ts";

class OneDocClient extends RnpmClient {
  constructor() {
    super({ requestDelayMs: 0 });
  }
  override async search(type: RnpmSearchType, _params: unknown, page: number): Promise<RnpmSearchResult> {
    void type;
    return {
      total: 1,
      pagesTotal: 1,
      pageSize: 25,
      currentPage: page,
      documents: [{ identificator: { k: "uuid-1", v: "ID-1" } }],
      criteriu: "",
      eai: false,
    } as unknown as RnpmSearchResult;
  }
  override async fetchFullDetail(): Promise<never> {
    return { part1: null, part2: null, part3: null, part4: null, istoric: [] } as never;
  }
}

describe("abort in timpul asteptarii pe lock-ul de mentenanta", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    releaseLock = null;
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-abortlock-"));
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

  it("nu persista avizul daca abortul a sosit cat asteptam lock-ul", async () => {
    const controller = new AbortController();

    const run = executeSearch(
      {
        type: "ipoteci",
        ownerId: "t-abort-lock",
        params: {},
        captchaKey: "stub",
        batchSize: 1,
        signal: controller.signal,
      },
      new OneDocClient()
    );

    // Asteptam sa intram in coada pe lock (persistarea e blocata acolo).
    await vi.waitFor(() => expect(releaseLock).not.toBeNull());

    // Abortul vine ACUM: dupa check-ul de dupa fetch, inainte de achizitie.
    controller.abort();
    releaseLock?.();

    await expect(run).rejects.toMatchObject({ name: "AbortError" });

    // Verificare pe baza reala, nu pe un spy: niciun aviz persistat.
    const db = getRnpmDb("t-abort-lock");
    const row = db.prepare("SELECT COUNT(*) AS n FROM rnpm_avize").get() as { n: number };
    expect(row.n).toBe(0);
  });
});
