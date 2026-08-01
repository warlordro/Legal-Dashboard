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
import { solveRnpmCaptcha } from "./captchaSolver.ts";
import { executeSearch } from "./rnpmSearchService.ts";
import { RnpmClient, RnpmError, type RnpmSearchResult, type RnpmSearchType } from "./rnpmClient.ts";

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
    const result = await executeSearch(
      { type: "ipoteci", ownerId: "t", params: {}, captchaKey: "stub", fetchDetails: false },
      client
    );
    // ceil(30/25) = 2 pages, NOT the inflated 50 the client advertised. Asertia
    // EXACTA prinde regresia in ambele sensuri: 50 (clamp sters) SI 0/1 (setup picat
    // devreme). `.catch` a fost eliminat ca un throw de mediu sa NU treaca fals.
    expect(client.calls).toBe(2);
    expect(result.pagesTotal).toBe(2);
  });
});

describe("executeSearch — continuare cu sesiune RNPM expirata", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    vi.mocked(solveRnpmCaptcha).mockClear();
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-expired-"));
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

  it("reia sesiunea de la pagina 1 inainte de a cere pagina ceruta", async () => {
    // Reproduce comportamentul observat in productie 2026-08-01: gcode-ul vechi
    // primeste 410, iar un gcode PROASPAT deschide o sesiune goala in care
    // pagina 2 inca nu exista — deci cererea directa a paginii 2 raspunde tot
    // 410. Fara incalzirea paginii 1, retry-ul arde un captcha platit degeaba.
    class ExpiredSessionClient extends RnpmClient {
      readonly calls: Array<{ page: number; gcode: string }> = [];
      private readonly materialized = new Set<string>();
      constructor() {
        super({ requestDelayMs: 0 });
      }
      override async search(type: RnpmSearchType, params: { gcode?: string }, page: number): Promise<RnpmSearchResult> {
        void type;
        const gcode = String(params.gcode);
        this.calls.push({ page, gcode });
        if (gcode === "gcode-expirat") throw new RnpmError("Eroare RNPM search (410)", 410);
        if (page > 1 && !this.materialized.has(gcode)) throw new RnpmError("Eroare RNPM search (410)", 410);
        this.materialized.add(gcode);
        return {
          total: 30,
          pagesTotal: 2,
          pageSize: 25,
          currentPage: page,
          documents: [{ identificator: { k: `uuid-${page}`, v: `ID-${page}` } }],
          criteriu: "",
          eai: false,
        } as unknown as RnpmSearchResult;
      }
    }

    const client = new ExpiredSessionClient();
    const result = await executeSearch(
      {
        type: "ipoteci",
        ownerId: "t-expired",
        params: {},
        captchaKey: "stub",
        startRnpmPage: 2,
        existingGcode: "gcode-expirat",
        batchSize: 1,
        fetchDetails: false,
      },
      client
    );

    // Secventa exacta: pagina ceruta cu gcode mort -> 410; apoi, cu gcode nou,
    // INTAI pagina 1 (incalzire), abia apoi pagina ceruta.
    expect(client.calls).toEqual([
      { page: 2, gcode: "gcode-expirat" },
      { page: 1, gcode: "stub-gcode" },
      { page: 2, gcode: "stub-gcode" },
    ]);
    expect(result.total).toBe(30);
    // Un SINGUR captcha per expirare. Bug-ul din productie il platea si il
    // arunca; o regresie care reintroduce un al doilea solve se vede aici.
    expect(vi.mocked(solveRnpmCaptcha)).toHaveBeenCalledTimes(1);
  });

  it("cere pagina 1 inainte de pagina ceruta si cand nu exista gcode deloc", async () => {
    // Apelant API/PAT: `startRnpmPage > 1` fara gcode. Inainte platea DOUA
    // captcha (una pentru cererea directa care lua 410, alta pentru retry).
    class FreshSessionOnlyClient extends RnpmClient {
      readonly calls: Array<{ page: number; gcode: string }> = [];
      private readonly materialized = new Set<string>();
      constructor() {
        super({ requestDelayMs: 0 });
      }
      override async search(type: RnpmSearchType, params: { gcode?: string }, page: number): Promise<RnpmSearchResult> {
        void type;
        const gcode = String(params.gcode);
        this.calls.push({ page, gcode });
        if (page > 1 && !this.materialized.has(gcode)) throw new RnpmError("Eroare RNPM search (410)", 410);
        this.materialized.add(gcode);
        return {
          total: 30,
          pagesTotal: 2,
          pageSize: 25,
          currentPage: page,
          documents: [{ identificator: { k: `uuid-${page}`, v: `ID-${page}` } }],
          criteriu: "",
          eai: false,
        } as unknown as RnpmSearchResult;
      }
    }

    const client = new FreshSessionOnlyClient();
    await executeSearch(
      {
        type: "ipoteci",
        ownerId: "t-fresh-only",
        params: {},
        captchaKey: "stub",
        startRnpmPage: 2,
        batchSize: 1,
        fetchDetails: false,
      },
      client
    );

    expect(client.calls).toEqual([
      { page: 1, gcode: "stub-gcode" },
      { page: 2, gcode: "stub-gcode" },
    ]);
    // Un singur captcha, nu doua.
    expect(vi.mocked(solveRnpmCaptcha)).toHaveBeenCalledTimes(1);
  });

  it("reia sesiunea si cand expirarea apare in bucla de paginare", async () => {
    // Acelasi bug, celalalt loc cu retry: gcode-ul e viu pentru pagina ceruta,
    // dar moare inainte de pagina urmatoare din aceeasi cerere.
    class MidLoopExpiryClient extends RnpmClient {
      readonly calls: Array<{ page: number; gcode: string }> = [];
      private readonly materialized = new Set<string>();
      constructor() {
        super({ requestDelayMs: 0 });
      }
      override async search(type: RnpmSearchType, params: { gcode?: string }, page: number): Promise<RnpmSearchResult> {
        void type;
        const gcode = String(params.gcode);
        this.calls.push({ page, gcode });
        if (gcode === "gcode-viu") {
          if (page >= 3) throw new RnpmError("Eroare RNPM search (410)", 410);
        } else if (page > 1 && !this.materialized.has(gcode)) {
          throw new RnpmError("Eroare RNPM search (410)", 410);
        }
        this.materialized.add(gcode);
        return {
          total: 75,
          pagesTotal: 3,
          pageSize: 25,
          currentPage: page,
          documents: [{ identificator: { k: `uuid-${page}`, v: `ID-${page}` } }],
          criteriu: "",
          eai: false,
        } as unknown as RnpmSearchResult;
      }
    }

    const client = new MidLoopExpiryClient();
    await executeSearch(
      {
        type: "ipoteci",
        ownerId: "t-expired-loop",
        params: {},
        captchaKey: "stub",
        startRnpmPage: 2,
        existingGcode: "gcode-viu",
        batchSize: 2,
        fetchDetails: false,
      },
      client
    );

    // Pagina 3 expira; dupa captcha-ul nou se cere INTAI pagina 1, apoi 3.
    expect(client.calls).toEqual([
      { page: 2, gcode: "gcode-viu" },
      { page: 3, gcode: "gcode-viu" },
      { page: 1, gcode: "stub-gcode" },
      { page: 3, gcode: "stub-gcode" },
    ]);
  });
});
