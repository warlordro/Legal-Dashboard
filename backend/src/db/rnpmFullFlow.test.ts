// v2.43.0 (rnpm-split): full-flow — monolit cu 2 owneri -> split -> backup
// manual u1 -> modificare date u1 -> restore u1 -> datele u1 revin, u2 si
// monolitul neatinse.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRnpmManualBackup, restoreRnpmFromBackup } from "./backup.ts";
import { __resetRnpmActivityForTests } from "./rnpmActivity.ts";
import { __resetRnpmDbForTests, getRnpmDb, getRnpmDbPath } from "./rnpmDb.ts";
import { runRnpmSplitIfNeeded } from "./rnpmSplitter.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpmflow-"));
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

describe("full-flow split -> backup -> restore per user", () => {
  it("restore-ul lui u1 readuce datele lui, fara sa atinga u2 sau monolitul", async () => {
    // 1. Seed monolit cu 2 owneri (pre-split).
    const mono = getDb();
    for (const [owner, ident] of [
      ["u1", "U1-0001"],
      ["u2", "U2-0001"],
    ] as const) {
      mono
        .prepare("INSERT INTO rnpm_avize (owner_id, uuid, identificator, search_type, tip, data) VALUES (?,?,?,?,?,?)")
        .run(owner, `uu-${ident}`, ident, "dupa_nume", "aviz", "2026-01-01");
    }

    // 2. Split.
    const result = runRnpmSplitIfNeeded();
    expect(result.split).toBe(true);
    expect((mono.prepare("SELECT COUNT(*) AS n FROM rnpm_avize").get() as { n: number }).n).toBe(0);

    // 3. Backup manual u1.
    const { name } = await createRnpmManualBackup("u1");

    // 4. Modificare date u1 (stergere aviz + insert nou POST-backup — fix C3:
    // randul promis de comentariu chiar se insereaza, ca restore-ul sa aiba
    // ce sa FACA SA DISPARA, nu doar ce sa readuca).
    const u1 = getRnpmDb("u1");
    u1.prepare("DELETE FROM rnpm_avize").run();
    u1.prepare(
      "INSERT INTO rnpm_avize (owner_id, uuid, identificator, search_type, tip, data) VALUES (?,?,?,?,?,?)"
    ).run("u1", "uu-U1-POST", "U1-POST", "dupa_nume", "aviz", "2026-02-01");
    const monoBytes = fs.statSync(path.join(tmpRoot, "legal-dashboard.db")).size;
    const u2CountBefore = (getRnpmDb("u2").prepare("SELECT COUNT(*) AS n FROM rnpm_avize").get() as { n: number }).n;

    // 5. Restore u1.
    await restoreRnpmFromBackup("u1", name);

    // 6. Datele u1 revin (avizul original, cu uuid-ul original), iar randul
    // post-backup a DISPARUT.
    const rows = getRnpmDb("u1").prepare("SELECT uuid, identificator FROM rnpm_avize").all() as {
      uuid: string;
      identificator: string;
    }[];
    expect(rows.map((r) => r.identificator)).toEqual(["U1-0001"]);
    expect(rows.map((r) => r.uuid)).toEqual(["uu-U1-0001"]);

    // u2 si monolitul neatinse.
    expect((getRnpmDb("u2").prepare("SELECT COUNT(*) AS n FROM rnpm_avize").get() as { n: number }).n).toBe(
      u2CountBefore
    );
    expect(fs.statSync(path.join(tmpRoot, "legal-dashboard.db")).size).toBe(monoBytes);
    expect(fs.existsSync(getRnpmDbPath("u2"))).toBe(true);
  });
});
