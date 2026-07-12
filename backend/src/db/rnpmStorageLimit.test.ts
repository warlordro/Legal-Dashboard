import Database from "better-sqlite3";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compactRnpmDbViaWorker } from "./backup.ts";
import { upsertOverride } from "./userQuotaRepository.ts";
import { __setSnapshotWorkerPathForTests } from "../util/snapshotRunner.ts";
import {
  assertRnpmStorageWithinLimit,
  getRnpmStorageLimitBytes,
  measureRnpmStorage,
  readDefaultRnpmStorageMb,
  RnpmStorageLimitError,
} from "./rnpmStorageLimit.ts";
import { __resetRnpmDbForTests, getRnpmDb, getRnpmDbPath } from "./rnpmDb.ts";
import { closeDb, getDb } from "./schema.ts";

const MIB = 1024 * 1024;
const OWNER = "local";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-storage-limit-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
});

afterEach(async () => {
  vi.restoreAllMocks();
  __setSnapshotWorkerPathForTests(null);
  __resetRnpmDbForTests();
  closeDb();
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DB_PATH");
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB");
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("readDefaultRnpmStorageMb", () => {
  it("foloseste 500 MB cand env-ul lipseste", () => {
    expect(readDefaultRnpmStorageMb()).toBe(500);
  });

  it("zero si valorile negative dezactiveaza limita", () => {
    process.env.LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB = "0";
    expect(readDefaultRnpmStorageMb()).toBeNull();
    process.env.LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB = "-1";
    expect(readDefaultRnpmStorageMb()).toBeNull();
  });

  it("valoarea invalida revine la 500 si avertizeaza o singura data", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const raw of ["abc", "Infinity"]) {
      process.env.LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB = raw;
      expect(readDefaultRnpmStorageMb()).toBe(500);
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("getRnpmStorageLimitBytes", () => {
  it("override-ul in MB castiga fata de default", () => {
    process.env.LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB = "500";
    upsertOverride({ userId: OWNER, feature: "rnpm.storage", period: "day", limitUsdMilli: 7 });
    expect(getRnpmStorageLimitBytes(OWNER)).toBe(7 * MIB);
  });

  it("override zero ramane limita zero, nu nelimitat", () => {
    upsertOverride({ userId: OWNER, feature: "rnpm.storage", period: "day", limitUsdMilli: 0 });
    expect(getRnpmStorageLimitBytes(OWNER)).toBe(0);
  });

  it("override zero blocheaza inclusiv boundary-ul used zero", async () => {
    const ownerId = OWNER;
    upsertOverride({ userId: ownerId, feature: "rnpm.storage", period: "day", limitUsdMilli: 0 });

    await expect(assertRnpmStorageWithinLimit(ownerId)).rejects.toMatchObject({
      code: "RNPM_STORAGE_LIMIT",
      usedBytes: 0,
      limitBytes: 0,
    });
    expect(fs.existsSync(getRnpmDbPath(ownerId))).toBe(false);
  });
});

describe("measureRnpmStorage + assertRnpmStorageWithinLimit", () => {
  it("owner fara fisier are used=0 fara provisioning", async () => {
    const ownerId = "owner-fara-fisier";
    expect(fs.existsSync(getRnpmDbPath(ownerId))).toBe(false);
    await expect(measureRnpmStorage(ownerId)).resolves.toEqual({ usedBytes: 0, exists: false });
    expect(fs.existsSync(getRnpmDbPath(ownerId))).toBe(false);
  });

  it("numara identic db + wal + shm", async () => {
    getRnpmDb(OWNER)
      .prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES (?, 'ipoteci', '{}')")
      .run(OWNER);
    const dbPath = getRnpmDbPath(OWNER);
    const size = async (file: string) =>
      fsPromises
        .stat(file)
        .then((s) => s.size)
        .catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? 0 : Promise.reject(e)));
    const expected = (await size(dbPath)) + (await size(`${dbPath}-wal`)) + (await size(`${dbPath}-shm`));

    await expect(measureRnpmStorage(OWNER)).resolves.toEqual({ usedBytes: expected, exists: true });
  });

  it("propaga erorile FS non-ENOENT", async () => {
    getRnpmDb(OWNER);
    const dbPath = getRnpmDbPath(OWNER);
    const realStat = fsPromises.stat.bind(fsPromises);
    vi.spyOn(fsPromises, "stat").mockImplementation(async (file, options) => {
      if (String(file) === dbPath) throw Object.assign(new Error("access denied"), { code: "EACCES" });
      return realStat(file, options as never);
    });

    await expect(measureRnpmStorage(OWNER)).rejects.toMatchObject({ code: "EACCES" });
  });

  it("incearca checkpoint PASSIVE cand masuratoarea bruta atinge limita", async () => {
    const db = getRnpmDb(OWNER);
    const pragma = vi.spyOn(db, "pragma");
    process.env.LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB = "0.000001";

    await measureRnpmStorage(OWNER);

    expect(pragma).toHaveBeenCalledWith("wal_checkpoint(PASSIVE)");
  });

  it("blocheaza la boundary used egal cu limit si expune cifrele tipat", async () => {
    getRnpmDb(OWNER);
    process.env.LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB = "0.000001";
    const measured = await measureRnpmStorage(OWNER);
    process.env.LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB = String(measured.usedBytes / MIB);

    await expect(assertRnpmStorageWithinLimit(OWNER)).rejects.toEqual(
      expect.objectContaining({
        name: "RnpmStorageLimitError",
        usedBytes: measured.usedBytes,
        limitBytes: measured.usedBytes,
      })
    );
    await expect(assertRnpmStorageWithinLimit(OWNER)).rejects.toBeInstanceOf(RnpmStorageLimitError);
  });

  it("masurarea asteapta compactarea aflata sub maintenance write lock", async () => {
    getRnpmDb(OWNER)
      .prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES (?, 'ipoteci', '{}')")
      .run(OWNER);
    const requireCjs = createRequire(import.meta.url);
    const betterSqlitePath = requireCjs.resolve("better-sqlite3").replace(/\\/g, "\\\\");
    const slowWorker = path.join(tmpRoot, "slow-compact-worker.cjs");
    await fsPromises.writeFile(
      slowWorker,
      "const { parentPort, workerData } = require('node:worker_threads');\n" +
        `const Database = require("${betterSqlitePath}");\n` +
        "parentPort.postMessage({ ready: true });\n" +
        "setTimeout(() => {\n" +
        "  const db = new Database(workerData.srcPath, { readonly: true, fileMustExist: true });\n" +
        "  db.prepare('VACUUM INTO ?').run(workerData.destPath);\n" +
        "  db.close();\n" +
        "  const probe = new Database(workerData.destPath, { readonly: true });\n" +
        "  probe.prepare('PRAGMA integrity_check').all();\n" +
        "  probe.close();\n" +
        "  parentPort.postMessage({ ok: true });\n" +
        "}, 300);\n"
    );
    __setSnapshotWorkerPathForTests(slowWorker);

    const compact = compactRnpmDbViaWorker(OWNER);
    await new Promise((resolve) => setTimeout(resolve, 75));
    let measured = false;
    const measurement = measureRnpmStorage(OWNER).then((value) => {
      measured = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(measured).toBe(false);

    await compact;
    await expect(measurement).resolves.toMatchObject({ exists: true });
    expect(measured).toBe(true);
  });
});
