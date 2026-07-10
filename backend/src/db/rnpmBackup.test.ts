// v2.43.0 (rnpm-split): backup multi-target — jail per owner pentru fisierele
// RNPM per user, snapshot-uri self-contained (VACUUM INTO), restore cu garduri
// de concurenta si validare de versiune, retentie pe pool-uri disjuncte.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRnpmManualBackup,
  deleteRnpmBackups,
  getRnpmBackupDir,
  listRnpmBackups,
  restoreRnpmFromBackup,
  runDailyBackup,
} from "./backup.ts";
import { __resetRnpmActivityForTests, beginRnpmSearch, endRnpmSearch, RnpmSearchActiveError } from "./rnpmActivity.ts";
import { __resetRnpmDbForTests, getRnpmDb, getRnpmDbPath, rnpmFileStem } from "./rnpmDb.ts";
import { closeDb, getDb, getDbPath } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpmbackup-"));
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

function seedSearch(ownerId: string, marker: string): void {
  getRnpmDb(ownerId)
    .prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES (?, 'dupa_nume', ?)")
    .run(ownerId, JSON.stringify({ marker }));
}

function countSearches(ownerId: string): number {
  return (getRnpmDb(ownerId).prepare("SELECT COUNT(*) AS n FROM rnpm_searches").get() as { n: number }).n;
}

describe("createRnpmManualBackup + listRnpmBackups", () => {
  it("creeaza rnpm.manual-<stamp>.db in jail-ul stem-ului si listarea il vede", async () => {
    seedSearch("u1", "a");
    const { name } = await createRnpmManualBackup("u1");
    expect(name).toMatch(/^rnpm\.manual-.+\.db$/);
    const jail = getRnpmBackupDir("u1");
    expect(jail).toContain(path.join("backups", "rnpm", rnpmFileStem("u1")));
    expect(fs.existsSync(path.join(jail, name))).toBe(true);

    const entries = await listRnpmBackups("u1");
    expect(entries.map((e) => e.name)).toContain(name);
    // Snapshot self-contained: fara sidecars WAL/SHM.
    expect(fs.existsSync(path.join(jail, `${name}-wal`))).toBe(false);
  });

  it("user fara fisier RNPM: manual backup PROVISIONEAZA si reuseste (backup valid al bazei goale)", async () => {
    expect(fs.existsSync(getRnpmDbPath("u-nou"))).toBe(false);
    const { name } = await createRnpmManualBackup("u-nou");
    expect(fs.existsSync(path.join(getRnpmBackupDir("u-nou"), name))).toBe(true);
    expect(fs.existsSync(getRnpmDbPath("u-nou"))).toBe(true);
  });

  it("jail-urile sunt izolate: u2 nu vede backup-urile lui u1", async () => {
    seedSearch("u1", "a");
    await createRnpmManualBackup("u1");
    expect(await listRnpmBackups("u2")).toEqual([]);
  });
});

describe("restoreRnpmFromBackup", () => {
  it("datele scrise DUPA backup dispar la restore; cele pre-backup exista; pre-restore snapshot in jail", async () => {
    seedSearch("u1", "pre-backup");
    const { name } = await createRnpmManualBackup("u1");
    seedSearch("u1", "post-backup");
    expect(countSearches("u1")).toBe(2);

    const { preRestoreName } = await restoreRnpmFromBackup("u1", name);
    expect(preRestoreName).toMatch(/^rnpm\.pre-restore-.+\.db$/);
    expect(fs.existsSync(path.join(getRnpmBackupDir("u1"), preRestoreName))).toBe(true);

    expect(countSearches("u1")).toBe(1);
    const row = getRnpmDb("u1").prepare("SELECT params_json FROM rnpm_searches").get() as { params_json: string };
    expect(JSON.parse(row.params_json).marker).toBe("pre-backup");
  });

  it("restore-ul lui u1 nu atinge fisierul lui u2 si nici monolitul", async () => {
    seedSearch("u1", "a");
    seedSearch("u2", "b");
    const { name } = await createRnpmManualBackup("u1");
    seedSearch("u1", "c");
    const u2Bytes = fs.statSync(getRnpmDbPath("u2")).size;

    await restoreRnpmFromBackup("u1", name);

    expect(countSearches("u2")).toBe(1);
    expect(fs.statSync(getRnpmDbPath("u2")).size).toBe(u2Bytes);
    // Monolitul nu are randuri rnpm si nu e atins de restore-ul per user.
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM rnpm_searches").get() as { n: number }).n).toBe(0);
  });

  it("jail: nume cu separatoare sau traversal => respins fara restore", async () => {
    seedSearch("u1", "a");
    await createRnpmManualBackup("u1");
    for (const bad of [
      "../evil.db",
      "a/b.db",
      "a\\b.db",
      "rnpm.manual-x.db/../../y.db",
      "legal-dashboard.2026-01-01.db",
    ]) {
      await expect(restoreRnpmFromBackup("u1", bad), bad).rejects.toThrow(/invalid/i);
    }
  });

  it("race: cu o cautare activa a ownerului, restore arunca SEARCH_ACTIVE", async () => {
    seedSearch("u1", "a");
    const { name } = await createRnpmManualBackup("u1");
    beginRnpmSearch("u1");
    try {
      await expect(restoreRnpmFromBackup("u1", name)).rejects.toBeInstanceOf(RnpmSearchActiveError);
    } finally {
      endRnpmSearch("u1");
    }
    // Dupa terminarea cautarii, restore-ul functioneaza.
    await expect(restoreRnpmFromBackup("u1", name)).resolves.toBeDefined();
  });

  it("backup dintr-o versiune de schema mai NOUA => reject inainte de swap", async () => {
    seedSearch("u1", "a");
    const { name } = await createRnpmManualBackup("u1");
    // Simuleaza un backup produs de o versiune viitoare: bump _schema_versions.
    const backupPath = path.join(getRnpmBackupDir("u1"), name);
    const forge = new Database(backupPath);
    try {
      forge.prepare("INSERT INTO _schema_versions (version, sha256_up) VALUES (999, 'future')").run();
    } finally {
      forge.close();
    }
    await expect(restoreRnpmFromBackup("u1", name)).rejects.toThrow(/versiune|mai noua/i);
    // Fisierul viu ramane functional.
    expect(countSearches("u1")).toBe(1);
  });

  it("restore de backup legacy cu sidecars (bundle): datele din WAL supravietuiesc", async () => {
    seedSearch("u1", "a");
    await createRnpmManualBackup("u1"); // provisioning + jail existent
    const jail = getRnpmBackupDir("u1");
    const legacyName = "rnpm.2020-01-01.db";
    const legacyPath = path.join(jail, legacyName);

    // Construim un bundle .db + .db-wal: randul al doilea traieste DOAR in WAL.
    // Copiem main + WAL cat timp conexiunea e deschisa (inainte ca close sa
    // checkpoint-uiasca), exact forma backup-urilor legacy copyFile+sidecars.
    const workPath = path.join(tmpRoot, "legacy-work.db");
    const writer = new Database(workPath);
    writer.pragma("journal_mode = WAL");
    writer.exec(
      "CREATE TABLE rnpm_searches (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL DEFAULT 'local', search_type TEXT NOT NULL, params_json TEXT NOT NULL, total_results INTEGER NOT NULL DEFAULT 0, criteriu TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
    );
    writer
      .prepare(
        "INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('u1','dupa_nume','{\"m\":\"main\"}')"
      )
      .run();
    writer.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    writer
      .prepare(
        "INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('u1','dupa_nume','{\"m\":\"wal\"}')"
      )
      .run();
    fs.copyFileSync(workPath, legacyPath);
    fs.copyFileSync(`${workPath}-wal`, `${legacyPath}-wal`);
    writer.close();
    expect(fs.statSync(`${legacyPath}-wal`).size).toBeGreaterThan(0);

    await restoreRnpmFromBackup("u1", legacyName);
    expect(countSearches("u1")).toBe(2);
  });
});

describe("deleteRnpmBackups", () => {
  it("sterge doar jail-ul propriu, bundle-aware", async () => {
    seedSearch("u1", "a");
    seedSearch("u2", "b");
    const { name: n1 } = await createRnpmManualBackup("u1");
    await createRnpmManualBackup("u2");
    // Sidecar orfan langa backup-ul lui u1 (bundle legacy simulat).
    fs.writeFileSync(path.join(getRnpmBackupDir("u1"), `${n1}-wal`), "x");

    const deleted = await deleteRnpmBackups("u1");
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await listRnpmBackups("u1")).toEqual([]);
    expect(fs.existsSync(path.join(getRnpmBackupDir("u1"), `${n1}-wal`))).toBe(false);
    expect((await listRnpmBackups("u2")).length).toBe(1);
  });
});

describe("runDailyBackup — multi-target", () => {
  it("produce si backup-ul monolitului si rnpm.YYYY-MM-DD.db per fisier de pe disc, fara handle persistent", async () => {
    seedSearch("u1", "a");
    seedSearch("u2", "b");
    // Inchide handle-urile din registry: daily-ul NU trebuie sa le redeschida persistent.
    __resetRnpmDbForTests();

    await runDailyBackup();

    const mainDir = path.join(path.dirname(getDbPath()), "backups");
    const mainDated = fs.readdirSync(mainDir).filter((f) => /^legal-dashboard\.\d{4}-\d{2}-\d{2}\.db$/.test(f));
    expect(mainDated.length).toBe(1);

    for (const owner of ["u1", "u2"]) {
      const jail = path.join(mainDir, "rnpm", rnpmFileStem(owner));
      const dated = fs.readdirSync(jail).filter((f) => /^rnpm\.\d{4}-\d{2}-\d{2}\.db$/.test(f));
      expect(dated.length, owner).toBe(1);
      // Fara handle persistent: fisierul sursa se poate redenumi imediat (EBUSY altfel pe Windows).
      const src = getRnpmDbPath(owner);
      fs.renameSync(src, `${src}.probe`);
      fs.renameSync(`${src}.probe`, src);
    }
  });

  it("freshness PER TARGET: main fresh nu sare peste targeturile rnpm fara backup", async () => {
    // Main primeste backup-ul zilei; APOI apare fisierul rnpm al unui user nou.
    await runDailyBackup();
    seedSearch("u1", "a");
    __resetRnpmDbForTests();

    await runDailyBackup();

    const jail = getRnpmBackupDir("u1");
    const dated = fs.readdirSync(jail).filter((f) => /^rnpm\.\d{4}-\d{2}-\d{2}\.db$/.test(f));
    expect(dated.length).toBe(1);
  });

  it("retentie pe pool-uri disjuncte per target: daily 7 / manual 5, monolitul neatins", async () => {
    seedSearch("u1", "a");
    const jail = getRnpmBackupDir("u1");
    fs.mkdirSync(jail, { recursive: true });
    // Mtime vechi pe seed-uri: freshness-ul per target nu trebuie sa sara
    // peste snapshot-ul (si prune-ul) de azi.
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    for (let i = 1; i <= 9; i++) {
      const p = path.join(jail, `rnpm.2026-01-0${i}.db`);
      fs.writeFileSync(p, "x");
      fs.utimesSync(p, old, old);
    }
    for (let i = 1; i <= 7; i++) {
      fs.writeFileSync(path.join(jail, `rnpm.manual-2026-01-0${i}T00-00-0${i}.db`), "x");
    }
    // Un fisier al monolitului NU intra in pool-urile rnpm (prefix diferit).
    const mainDir = path.join(path.dirname(getDbPath()), "backups");
    fs.mkdirSync(mainDir, { recursive: true });
    fs.writeFileSync(path.join(mainDir, "legal-dashboard.2019-01-01.db"), "x");

    __resetRnpmDbForTests();
    await runDailyBackup();

    const after = fs.readdirSync(jail);
    const dated = after.filter((f) => /^rnpm\.\d{4}-\d{2}-\d{2}\.db$/.test(f));
    const manual = after.filter((f) => /^rnpm\.manual-/.test(f));
    // 9 seed + 1 nou = 10 -> prune la 7; manual 7 -> prune la 5.
    expect(dated.length).toBe(7);
    expect(manual.length).toBe(5);
    // Pool-urile nu se fura reciproc: cel mai NOU manual supravietuieste.
    expect(manual).toContain("rnpm.manual-2026-01-07T00-00-07.db");
    // Monolitul neatins de prune-ul jail-ului (fisierul vechi ramane in pool-ul LUI).
    expect(fs.existsSync(path.join(mainDir, "legal-dashboard.2019-01-01.db"))).toBe(true);
  });

  it("prune curata bundle-ul (sidecars) al backup-urilor eliminate", async () => {
    seedSearch("u1", "a");
    const jail = getRnpmBackupDir("u1");
    fs.mkdirSync(jail, { recursive: true });
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    for (let i = 1; i <= 9; i++) {
      const p = path.join(jail, `rnpm.2026-01-0${i}.db`);
      fs.writeFileSync(p, "x");
      fs.utimesSync(p, old, old);
    }
    // Sidecar legacy pe cel mai vechi (care va fi pruned).
    fs.writeFileSync(path.join(jail, "rnpm.2026-01-01.db-wal"), "x");

    __resetRnpmDbForTests();
    await runDailyBackup();

    expect(fs.existsSync(path.join(jail, "rnpm.2026-01-01.db"))).toBe(false);
    expect(fs.existsSync(path.join(jail, "rnpm.2026-01-01.db-wal"))).toBe(false);
  });
});
