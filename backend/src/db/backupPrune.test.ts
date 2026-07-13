import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pruneBackupJail, pruneBackupJailSync, readRnpmBackupCapBytes } from "./backupPrune.ts";

let dir: string;

beforeEach(async () => {
  dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-backup-prune-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB");
  await fsPromises.rm(dir, { recursive: true, force: true });
});

function write(name: string, bytes = 1, mtimeIndex = 0): void {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.alloc(bytes, 1));
  const date = new Date(Date.UTC(2026, 0, 1 + mtimeIndex));
  fs.utimesSync(file, date, date);
}

describe("readRnpmBackupCapBytes", () => {
  it("default 500 MB; zero si negativ inseamna nelimitat", () => {
    expect(readRnpmBackupCapBytes()).toBe(500 * 1024 * 1024);
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = "0";
    expect(readRnpmBackupCapBytes()).toBeNull();
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = "-1";
    expect(readRnpmBackupCapBytes()).toBeNull();
  });

  it("valoarea invalida revine la 500 MB si avertizeaza o singura data", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = "abc";
    expect(readRnpmBackupCapBytes()).toBe(500 * 1024 * 1024);
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = "Infinity";
    expect(readRnpmBackupCapBytes()).toBe(500 * 1024 * 1024);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("pruneBackupJail RNPM", () => {
  it("foloseste pool-urile reduse 3/2/2/2 numai pentru RNPM", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = "0";
    for (let index = 1; index <= 5; index++) {
      write(`rnpm.2026-01-0${index}.db`, 1, index);
      write(`rnpm.manual-2026-01-0${index}T00-00-00.db`, 1, index);
      write(`rnpm.pre-restore-2026-01-0${index}T00-00-00.db`, 1, index);
      write(`rnpm.pre-schema-upgrade-2026-01-0${index}T00-00-00.db`, 1, index);
    }

    await pruneBackupJail(dir, "rnpm.");
    const names = fs.readdirSync(dir);

    expect(names.filter((name) => /^rnpm\.\d{4}-/.test(name))).toHaveLength(3);
    expect(names.filter((name) => /^rnpm\.manual-/.test(name))).toHaveLength(2);
    expect(names.filter((name) => /^rnpm\.pre-restore-/.test(name))).toHaveLength(2);
    expect(names.filter((name) => /^rnpm\.pre-schema-upgrade-/.test(name))).toHaveLength(2);
  });

  it("plafonul sterge oldest-first cross-pool dar pastreaza podeaua fiecarui pool", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = String(5 / 1024 / 1024);
    const pools = [
      ["rnpm.2026-01-01.db", "rnpm.2026-01-02.db"],
      ["rnpm.manual-2026-01-01.db", "rnpm.manual-2026-01-02.db"],
      ["rnpm.pre-restore-2026-01-01.db", "rnpm.pre-restore-2026-01-02.db"],
      ["rnpm.pre-schema-upgrade-2026-01-01.db", "rnpm.pre-schema-upgrade-2026-01-02.db"],
    ];
    let mtime = 0;
    for (const pool of pools) for (const name of pool) write(name, 1, mtime++);

    const result = await pruneBackupJail(dir, "rnpm.");
    const names = fs.readdirSync(dir);

    for (const [, newest] of pools) expect(names).toContain(newest);
    expect(result.capSatisfied).toBe(true);
    expect(names).toHaveLength(5);
  });

  it("podeaua poate tine jail-ul peste plafon fara a sterge ultima copie", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = String(1 / 1024 / 1024);
    const floor = [
      "rnpm.2026-01-02.db",
      "rnpm.manual-2026-01-02.db",
      "rnpm.pre-restore-2026-01-02.db",
      "rnpm.pre-schema-upgrade-2026-01-02.db",
    ];
    for (const name of floor) write(name, 10);

    const logEvent = vi.fn();
    const result = await pruneBackupJail(dir, "rnpm.", { logEvent });

    expect(result.capSatisfied).toBe(false);
    expect(fs.readdirSync(dir).sort()).toEqual(floor.sort());
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "rnpm_backup_cap", capSatisfied: false }));
  });

  it("protectedNames se aplica fazei pe numar si fazei pe bytes", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = String(3 / 1024 / 1024);
    for (let index = 1; index <= 5; index++) write(`rnpm.2026-01-0${index}.db`, 2, index);
    const protectedName = "rnpm.2026-01-01.db";

    const result = await pruneBackupJail(dir, "rnpm.", { protectedNames: [protectedName] });

    expect(fs.existsSync(path.join(dir, protectedName))).toBe(true);
    expect(result.capSatisfied).toBe(false);
  });

  it("accounting-ul include sidecars si sterge bundle-ul candidat", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = String(5 / 1024 / 1024);
    write("rnpm.2026-01-01.db", 1, 1);
    write("rnpm.2026-01-01.db-wal", 20, 1);
    write("rnpm.2026-01-02.db", 1, 2);

    const result = await pruneBackupJail(dir, "rnpm.");

    expect(result.capSatisfied).toBe(true);
    expect(fs.existsSync(path.join(dir, "rnpm.2026-01-01.db"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "rnpm.2026-01-01.db-wal"))).toBe(false);
  });

  it("capSatisfied foloseste re-stat real si vede sidecar-ul ramas dupa unlink partial", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = String(5 / 1024 / 1024);
    write("rnpm.2026-01-01.db", 1, 1);
    write("rnpm.2026-01-01.db-wal", 20, 1);
    write("rnpm.2026-01-02.db", 1, 2);
    const realUnlink = fsPromises.unlink.bind(fsPromises);
    vi.spyOn(fsPromises, "unlink").mockImplementation(async (file) => {
      if (String(file).endsWith("rnpm.2026-01-01.db-wal")) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      return realUnlink(file as Parameters<typeof realUnlink>[0]);
    });

    const result = await pruneBackupJail(dir, "rnpm.");

    expect(result.capSatisfied).toBe(false);
    expect(fs.existsSync(path.join(dir, "rnpm.2026-01-01.db-wal"))).toBe(true);
  });

  it("curata .db.tmp si il include in accounting daca unlink-ul esueaza", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = String(5 / 1024 / 1024);
    write("rnpm.orfan.db.tmp", 20);
    const realUnlink = fsPromises.unlink.bind(fsPromises);
    vi.spyOn(fsPromises, "unlink").mockImplementation(async (file) => {
      if (String(file).endsWith(".db.tmp")) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      return realUnlink(file as Parameters<typeof realUnlink>[0]);
    });

    const result = await pruneBackupJail(dir, "rnpm.");

    expect(result.capSatisfied).toBe(false);
    expect(fs.existsSync(path.join(dir, "rnpm.orfan.db.tmp"))).toBe(true);
  });

  it("varianta sync folosita de snapshot-ul pre-migrare protejeaza snapshot-ul curent", () => {
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = String(1 / 1024 / 1024);
    write("rnpm.pre-schema-upgrade-old.db", 10, 1);
    write("rnpm.pre-schema-upgrade-current.db", 10, 2);

    const result = pruneBackupJailSync(dir, "rnpm.", {
      protectedNames: ["rnpm.pre-schema-upgrade-current.db"],
    });

    expect(result.capSatisfied).toBe(false);
    expect(fs.existsSync(path.join(dir, "rnpm.pre-schema-upgrade-current.db"))).toBe(true);
  });

  it("varianta sync tolereaza eroarea de relistare dupa pruning si raporteaza cap nesatisfacut", () => {
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = String(1 / 1024 / 1024);
    write("rnpm.2026-01-01.db", 10, 1);
    const logEvent = vi.fn();
    const realReaddir = fs.readdirSync.bind(fs);
    let calls = 0;
    vi.spyOn(fs, "readdirSync").mockImplementation((target, options) => {
      calls++;
      if (calls === 3) throw Object.assign(new Error("EIO simulat"), { code: "EIO" });
      return realReaddir(target, options as never) as never;
    });

    expect(() => pruneBackupJailSync(dir, "rnpm.", { logEvent })).not.toThrow();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "backup_prune_failed", stage: "list_after_count", errnoCode: "EIO" })
    );
  });

  it("varianta async tolereaza eroarea de relistare dupa pruning si raporteaza cap nesatisfacut", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = String(1 / 1024 / 1024);
    write("rnpm.2026-01-01.db", 10, 1);
    const logEvent = vi.fn();
    const realReaddir = fsPromises.readdir.bind(fsPromises);
    let calls = 0;
    vi.spyOn(fsPromises, "readdir").mockImplementation(async (target, options) => {
      calls++;
      if (calls === 3) throw Object.assign(new Error("EIO simulat"), { code: "EIO" });
      return realReaddir(target, options as never) as never;
    });

    await expect(pruneBackupJail(dir, "rnpm.", { logEvent })).resolves.toEqual({ pruned: 0, capSatisfied: false });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "backup_prune_failed", stage: "list_after_count", errnoCode: "EIO" })
    );
  });
});

describe("pruneBackupJail monolit", () => {
  it("pastreaza retain-count-urile vechi si ignora plafonul RNPM", async () => {
    process.env.LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB = String(1 / 1024 / 1024);
    for (let index = 1; index <= 9; index++) write(`legal-dashboard.2026-01-0${index}.db`, 10, index);

    const result = await pruneBackupJail(dir, "legal-dashboard.");

    expect(fs.readdirSync(dir)).toHaveLength(7);
    expect(result.capSatisfied).toBe(true);
  });
});
