import Database from "better-sqlite3";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const snapshotFault = vi.hoisted(() => ({ error: null as NodeJS.ErrnoException | null }));

vi.mock("../util/snapshotRunner.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/snapshotRunner.ts")>();
  return {
    ...actual,
    runSnapshotOp: (...args: Parameters<typeof actual.runSnapshotOp>) => {
      if (snapshotFault.error) return Promise.reject(snapshotFault.error);
      return actual.runSnapshotOp(...args);
    },
  };
});

import {
  compactRnpmDbViaWorker,
  compactRnpmIfStillNeeded,
  maybeAutoCompactRnpm,
  readAutoCompactMinFreeBytes,
  shouldAutoCompactRnpm,
} from "./backup.ts";
import { deleteAvizeByIds, saveAvizFull, type SaveAvizInput } from "./avizRepository.ts";
import { __resetRnpmActivityForTests, beginRnpmSearch, endRnpmSearch } from "./rnpmActivity.ts";
import { __resetRnpmDbForTests, getRnpmDb, getRnpmDbPath } from "./rnpmDb.ts";
import { closeDb, getDb } from "./schema.ts";

const OWNER = "autocompact-user";
const MIB = 1024 * 1024;

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-autocompact-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  snapshotFault.error = null;
});

afterEach(async () => {
  snapshotFault.error = null;
  vi.restoreAllMocks();
  __resetRnpmActivityForTests();
  __resetRnpmDbForTests();
  closeDb();
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DB_PATH");
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB");
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_DISABLED");
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function makeAviz(index: number): SaveAvizInput {
  return {
    ownerId: OWNER,
    uuid: `auto-${index}`,
    identificator: `AUTO-${index}`,
    searchType: "ipoteci",
    tip: "aviz",
    data: "12.07.2026",
    creditori: [],
    debitori: [],
    bunuri: [
      {
        tip_bun: "altele",
        categorie: null,
        identificare: `BUN-${index}`,
        descriere: `${index}-${"x".repeat(8 * 1024)}`,
        model: null,
        serie_sasiu: null,
        serie_motor: null,
        nr_inmatriculare: null,
        referinte: [],
      },
    ],
    istoric: [],
  };
}

function createFreelist(ownerId = OWNER): number {
  const ids: number[] = [];
  for (let index = 0; index < 80; index++) ids.push(saveAvizFull(makeAviz(index)));
  expect(deleteAvizeByIds(ids, ownerId)).toBe(ids.length);
  return Number(getRnpmDb(ownerId).pragma("page_count", { simple: true }));
}

async function captureConsoleLog<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string") lines.push(args[0]);
  };
  try {
    return { value: await fn(), lines };
  } finally {
    console.log = original;
  }
}

describe("shouldAutoCompactRnpm", () => {
  it("nu compacteaza sub pragul absolut chiar la procent mare", () => {
    expect(shouldAutoCompactRnpm(5 * MIB, 6 * MIB, 10 * MIB)).toBe(false);
  });

  it("nu compacteaza peste pragul absolut dar sub 20% din fisier", () => {
    expect(shouldAutoCompactRnpm(15 * MIB, 200 * MIB, 10 * MIB)).toBe(false);
  });

  it("compacteaza peste ambele praguri", () => {
    expect(shouldAutoCompactRnpm(50 * MIB, 200 * MIB, 10 * MIB)).toBe(true);
  });

  it("respecta boundary-ul exact pentru pragul absolut", () => {
    expect(shouldAutoCompactRnpm(10 * MIB, 50 * MIB, 10 * MIB)).toBe(true);
    expect(shouldAutoCompactRnpm(10 * MIB - 1, 50 * MIB, 10 * MIB)).toBe(false);
  });

  it("respecta boundary-ul exact de 20%", () => {
    expect(shouldAutoCompactRnpm(20, 100, 10)).toBe(true);
    expect(shouldAutoCompactRnpm(19, 100, 10)).toBe(false);
  });

  it("fisierul gol nu compacteaza si nu imparte la zero", () => {
    expect(shouldAutoCompactRnpm(0, 0, 0)).toBe(false);
  });
});

describe("readAutoCompactMinFreeBytes", () => {
  it("foloseste default 10 MiB cand env-ul lipseste sau e gol", () => {
    expect(readAutoCompactMinFreeBytes()).toBe(10 * MIB);
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB = "";
    expect(readAutoCompactMinFreeBytes()).toBe(10 * MIB);
  });

  it("accepta zero si fractii finite nenegative", () => {
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB = "0";
    expect(readAutoCompactMinFreeBytes()).toBe(0);
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB = "0.1";
    expect(readAutoCompactMinFreeBytes()).toBe(Math.round(0.1 * MIB));
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB = "1.5";
    expect(readAutoCompactMinFreeBytes()).toBe(Math.round(1.5 * MIB));
  });

  it("revine la default pentru NaN, negativ si non-finit si avertizeaza o data", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const raw of ["abc", "-5", "Infinity"]) {
      process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB = raw;
      expect(readAutoCompactMinFreeBytes()).toBe(10 * MIB);
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("maybeAutoCompactRnpm", () => {
  it("compacteaza un freelist real si reduce page_count", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB = "0.1";
    const beforePages = createFreelist();

    const result = await maybeAutoCompactRnpm(OWNER);

    expect(result).toMatchObject({ attempted: true, compacted: true });
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(Number(getRnpmDb(OWNER).pragma("page_count", { simple: true }))).toBeLessThan(beforePages);
  });

  it("kill switch-ul dezactiveaza semantic autocompact-ul", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_DISABLED = "1";
    const compact = vi.fn<typeof compactRnpmIfStillNeeded>();

    await expect(maybeAutoCompactRnpm(OWNER, { compact })).resolves.toMatchObject({ attempted: false });
    expect(compact).not.toHaveBeenCalled();
  });

  it("nu provisioneaza fisier pentru un owner fara baza RNPM", async () => {
    const ownerId = "owner-fara-fisier";
    expect(fs.existsSync(getRnpmDbPath(ownerId))).toBe(false);

    await expect(maybeAutoCompactRnpm(ownerId)).resolves.toMatchObject({ attempted: false });

    expect(fs.existsSync(getRnpmDbPath(ownerId))).toBe(false);
  });

  it("coalesceaza daca alta cerere a compactat intre masurare si lock", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB = "0.1";
    createFreelist();
    const compact = async (ownerId: string, minFreeBytes: number) => {
      await compactRnpmDbViaWorker(ownerId);
      return compactRnpmIfStillNeeded(ownerId, minFreeBytes);
    };

    await expect(maybeAutoCompactRnpm(OWNER, { compact })).resolves.toMatchObject({
      attempted: true,
      compacted: true,
      coalesced: true,
      freedBytes: 0,
    });
  });

  it("refuzul SEARCH_ACTIVE real nu arunca si emite eveniment de skip", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB = "0.1";
    createFreelist();
    const compact = async (ownerId: string, minFreeBytes: number) => {
      beginRnpmSearch(ownerId);
      try {
        return await compactRnpmIfStillNeeded(ownerId, minFreeBytes);
      } finally {
        endRnpmSearch(ownerId);
      }
    };

    const { value, lines } = await captureConsoleLog(() => maybeAutoCompactRnpm(OWNER, { compact }));

    expect(value).toMatchObject({ attempted: true, compacted: false, reason: "search_active" });
    expect(lines.some((line) => line.includes('"action":"rnpm_autocompact_skipped"'))).toBe(true);
  });

  it("ENOSPC din VACUUM INTO este tolerat si tipat in rezultat", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB = "0.1";
    createFreelist();
    snapshotFault.error = Object.assign(new Error("disk full"), { code: "ENOSPC" });

    await expect(maybeAutoCompactRnpm(OWNER)).resolves.toMatchObject({
      attempted: true,
      compacted: false,
      reason: "enospc",
    });
  });

  it("eroarea netipata a compactarii nu se propaga si este auditata", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB = "0.1";
    createFreelist();
    const compact = vi.fn<typeof compactRnpmIfStillNeeded>().mockRejectedValue(new Error("boom"));

    const { value, lines } = await captureConsoleLog(() => maybeAutoCompactRnpm(OWNER, { compact }));

    expect(value).toMatchObject({ attempted: true, compacted: false, reason: "error" });
    expect(lines.some((line) => line.includes('"action":"rnpm_autocompact_skipped"'))).toBe(true);
  });
});
