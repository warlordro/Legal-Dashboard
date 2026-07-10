// v2.43.0 (rnpm-split): baseline-ul consolidat migrations-rnpm/0001 pentru
// fisierele RNPM per user. Testul de echivalenta structurala e apararea
// principala contra driftului: o migration viitoare care adauga o tabela sau
// coloana rnpm_* in monolit fara pereche in baseline pica aici.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as runner from "./migrations/runner.ts";
import { BACKFILL_SENTINEL, runMigrations } from "./migrations/runner.ts";
import { stripDiacritics } from "../util/textNormalize.ts";
import {
  __resetRnpmActivityForTests,
  beginRnpmRestore,
  endRnpmRestore,
  RnpmRestoreInProgressError,
} from "./rnpmActivity.ts";
import {
  __resetRnpmDbForTests,
  closeRnpmDb,
  compactRnpmDb,
  getRnpmDb,
  getRnpmDbPath,
  markRnpmShuttingDown,
  openRnpmDbRaw,
  rnpmFileStem,
} from "./rnpmDb.ts";

const __testDir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_RNPM_DIR = path.join(__testDir, "migrations-rnpm");
const MIGRATIONS_MONO_DIR = path.join(__testDir, "migrations");

function openWithNorm(p: string): Database.Database {
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.function("rnpm_norm", { deterministic: true }, (s) => (s == null ? "" : stripDiacritics(String(s)).toLowerCase()));
  return db;
}

let tmpRoot: string;
beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpmdb-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
});
afterEach(async () => {
  __resetRnpmDbForTests();
  __resetRnpmActivityForTests();
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("migrations-rnpm baseline", () => {
  it("aplica baseline-ul pe un fisier fresh si trigger-ele populeaza _norm", () => {
    const db = openWithNorm(path.join(tmpRoot, "u1.db"));
    try {
      const result = runMigrations(db, MIGRATIONS_RNPM_DIR);
      expect(result.applied).toEqual([1]);
      expect(result.backfilled).toBe(false);
      db.prepare(
        "INSERT INTO rnpm_searches (owner_id, search_type, params_json, total_results) VALUES ('u1','dupa_nume','{}',0)"
      ).run();
      db.prepare(
        "INSERT INTO rnpm_avize (owner_id, uuid, identificator, search_type, tip, data) VALUES ('u1','uu','Ștefan-1','dupa_nume','aviz','2026-01-01')"
      ).run();
      const row = db.prepare("SELECT identificator_norm FROM rnpm_avize").get() as { identificator_norm: string };
      expect(row.identificator_norm).toBe("stefan-1");
    } finally {
      db.close();
    }
  });

  it("baseline-ul e ECHIVALENT structural cu tabelele rnpm dintr-un monolit fresh (anti-drift)", () => {
    const mono = openWithNorm(path.join(tmpRoot, "mono.db"));
    const user = openWithNorm(path.join(tmpRoot, "user.db"));
    try {
      runMigrations(mono, MIGRATIONS_MONO_DIR);
      runMigrations(user, MIGRATIONS_RNPM_DIR);
      const tables = [
        "rnpm_searches",
        "rnpm_avize",
        "rnpm_bunuri_descrieri",
        "rnpm_creditori",
        "rnpm_debitori",
        "rnpm_bunuri",
        "rnpm_istoric",
      ];
      for (const t of tables) {
        const cols = (d: Database.Database) =>
          d
            .prepare(`PRAGMA table_info(${t})`)
            .all()
            .map((c: any) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}:${c.pk}`);
        const idx = (d: Database.Database) =>
          d
            .prepare(
              `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND name NOT LIKE 'sqlite_%' ORDER BY name`
            )
            .all(t)
            .map((r: any) => r.name);
        const fks = (d: Database.Database) => d.prepare(`PRAGMA foreign_key_list(${t})`).all();
        const trg = (d: Database.Database) =>
          d
            .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name`)
            .all(t)
            .map((r: any) => r.name);
        expect(cols(user), `coloane ${t}`).toEqual(cols(mono));
        expect(idx(user), `indexuri ${t}`).toEqual(idx(mono));
        expect(fks(user), `FK ${t}`).toEqual(fks(mono));
        expect(trg(user), `triggere ${t}`).toEqual(trg(mono));
      }
      // Anti-drift invers: monolitul nu are tabele rnpm_* necunoscute listei de mai sus.
      const monoRnpm = mono
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rnpm_%' ORDER BY name`)
        .all()
        .map((r: any) => r.name);
      expect(monoRnpm.sort()).toEqual([...tables].sort());
    } finally {
      mono.close();
      user.close();
    }
  });
});

describe("getRnpmDb", () => {
  it("provisioneaza lazy fisierul per owner cu baseline-ul aplicat", () => {
    const db = getRnpmDb("u1");
    expect(fs.existsSync(getRnpmDbPath("u1"))).toBe(true);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rnpm_%' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual([
      "rnpm_avize",
      "rnpm_bunuri",
      "rnpm_bunuri_descrieri",
      "rnpm_creditori",
      "rnpm_debitori",
      "rnpm_istoric",
      "rnpm_searches",
    ]);
    const version = db.prepare("SELECT MAX(version) AS v FROM _schema_versions").get() as { v: number };
    expect(version.v).toBe(1);
  });

  it("NU backfill-uieste sentinel pe fisier fresh (capcana runner)", () => {
    const db = getRnpmDb("u1");
    const row = db.prepare("SELECT sha256_up FROM _schema_versions WHERE version = 1").get() as {
      sha256_up: string;
    };
    expect(row.sha256_up).not.toBe(BACKFILL_SENTINEL);
  });

  it("acelasi handle la apeluri repetate; handle diferit per owner", () => {
    const a1 = getRnpmDb("u1");
    const a2 = getRnpmDb("u1");
    const b = getRnpmDb("u2");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(getRnpmDbPath("u1")).not.toBe(getRnpmDbPath("u2"));
  });

  it("rnpmFileStem e injectiv pe case-insensitive FS si evita nume rezervate", () => {
    expect(rnpmFileStem("UserA")).not.toBe(rnpmFileStem("usera"));
    expect(rnpmFileStem("UserA").toLowerCase()).toBe(rnpmFileStem("UserA")); // stem-ul e deja lowercase
    expect(rnpmFileStem("CON").startsWith("con-")).toBe(true); // sufixul hash face numele portabil
  });

  it("respinge ownerId invalid (traversal, lungime)", () => {
    for (const bad of ["../evil", "a/b", "a\\b", "x".repeat(65), "", "a b"]) {
      expect(() => getRnpmDb(bad), `ownerId: ${JSON.stringify(bad)}`).toThrow(/ownerId invalid/);
    }
  });

  it("refuza reopen dupa markRnpmShuttingDown", () => {
    getRnpmDb("u1");
    markRnpmShuttingDown();
    expect(() => getRnpmDb("u1")).toThrow(/shutdown/);
  });

  it("refuza orice acces in timpul unui restore al ownerului (latch)", () => {
    getRnpmDb("u1");
    beginRnpmRestore("u1");
    try {
      closeRnpmDb("u1");
      expect(() => getRnpmDb("u1")).toThrow(RnpmRestoreInProgressError);
      expect(() => getRnpmDb("u2")).not.toThrow(); // alti owneri neafectati
    } finally {
      endRnpmRestore("u1");
    }
    expect(() => getRnpmDb("u1")).not.toThrow();
  });

  it("esec la initializare => handle-ul e inchis, nu ramane orfan", () => {
    const spy = vi.spyOn(runner, "runMigrations").mockImplementation(() => {
      throw new Error("simulated migration failure");
    });
    expect(() => getRnpmDb("u-fail")).toThrow("simulated migration failure");
    spy.mockRestore();
    // Retry curat dupa esec: fara lock nativ orfan (pe Windows un handle deschis
    // ar bloca rm-ul tmpdir-ului din afterEach cu EBUSY).
    expect(() => getRnpmDb("u-fail")).not.toThrow();
  });

  it("openRnpmDbRaw NU provisioneaza: null pe fisier lipsa, readonly pe fisier existent", () => {
    expect(openRnpmDbRaw("u-nou")).toBeNull();
    expect(fs.existsSync(getRnpmDbPath("u-nou"))).toBe(false);
    getRnpmDb("u1");
    const raw = openRnpmDbRaw("u1");
    expect(raw).not.toBeNull();
    try {
      expect(() =>
        raw?.prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('u1','x','{}')").run()
      ).toThrow(/readonly/i);
    } finally {
      raw?.close();
    }
  });

  it("compactRnpmDb ruleaza VACUUM pe fisierul ownerului", () => {
    const db = getRnpmDb("u1");
    const insert = db.prepare(
      "INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('u1','dupa_nume',?)"
    );
    const blob = "x".repeat(2048);
    for (let i = 0; i < 500; i++) insert.run(blob);
    db.prepare("DELETE FROM rnpm_searches").run();
    const result = compactRnpmDb("u1");
    expect(result.beforeBytes).toBeGreaterThan(0);
    expect(result.afterBytes).toBeGreaterThan(0);
    expect(result.afterBytes).toBeLessThan(result.beforeBytes);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
