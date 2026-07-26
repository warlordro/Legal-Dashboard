// CodeRabbit 1.3: pre-migrarea bazei RNPM e sincrona si, pe web, prima cerere a
// fiecarui user dupa un upgrade ingheata tot serverul. Prewarm-ul de boot muta munca
// inaintea lui `serve()`.
//
// Testul acopera cele doua garantii care conteaza: fisierele existente sunt incalzite,
// iar userii FARA baza RNPM nu capata una la boot (altfel prewarm-ul ar provisiona
// fisiere orfane pentru fiecare user din tabela).
import Database from "better-sqlite3";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __resetRnpmDbForTests, getRnpmDb, getRnpmDbPath, prewarmRnpmMigrations } from "./rnpmDb.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-prewarm-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
});

afterEach(async () => {
  __resetRnpmDbForTests();
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("prewarmRnpmMigrations (CodeRabbit 1.3)", () => {
  it("NU provisioneaza fisiere pentru userii fara baza RNPM", () => {
    // u1 are baza (o cream prin getRnpmDb), u2 nu a folosit niciodata RNPM.
    getRnpmDb("u1");
    __resetRnpmDbForTests();
    expect(fs.existsSync(getRnpmDbPath("u1"))).toBe(true);
    expect(fs.existsSync(getRnpmDbPath("u2"))).toBe(false);

    const result = prewarmRnpmMigrations(["u1", "u2"]);

    // u1 e la zi (nimic de migrat), u2 nu are fisier — ambii `skipped`, zero munca.
    expect(result.warmed).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.failed).toBe(0);
    // Garantia care conteaza: u2 tot nu are fisier.
    expect(fs.existsSync(getRnpmDbPath("u2"))).toBe(false);
  });

  it("un owner invalid nu opreste restul si nu arunca", () => {
    getRnpmDb("u1");
    __resetRnpmDbForTests();

    // ".." e respins de assertValidOwnerId din getRnpmDbPath -> intra pe ramura de esec.
    const result = prewarmRnpmMigrations(["..", "u1"]);

    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("sare peste bazele FARA migrari pending (boot obisnuit nu face nimic)", () => {
    getRnpmDb("u1");
    __resetRnpmDbForTests();

    // Baza e la zi -> nimic de migrat -> skipped, nu warmed.
    expect(prewarmRnpmMigrations(["u1"])).toMatchObject({ warmed: 0, skipped: 1, failed: 0 });
  });

  it("incalzeste o baza cu migrari pending si NU lasa handle-ul deschis", () => {
    getRnpmDb("u1");
    __resetRnpmDbForTests();
    // Simulam un upgrade: stergem ultima versiune din ledger, deci migrarea redevine pending.
    const raw = new Database(getRnpmDbPath("u1"));
    const max = (raw.prepare("SELECT MAX(version) AS v FROM _schema_versions").get() as { v: number }).v;
    raw.prepare("DELETE FROM _schema_versions WHERE version = ?").run(max);
    raw.close();

    expect(prewarmRnpmMigrations(["u1"])).toMatchObject({ warmed: 1, skipped: 0, failed: 0 });

    // Proprietatea care conteaza pentru finding: prima cerere reala nu mai plateste
    // migrarea, iar boot-ul nu a lasat handle-uri deschise.
    expect(prewarmRnpmMigrations(["u1"])).toMatchObject({ warmed: 0, skipped: 1 });
  });

  it("lista goala e no-op", () => {
    expect(prewarmRnpmMigrations([])).toMatchObject({ warmed: 0, skipped: 0, failed: 0 });
  });
});
