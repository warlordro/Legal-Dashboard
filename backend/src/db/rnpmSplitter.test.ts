// v2.43.0 (rnpm-split): splitter-ul one-time care muta datele RNPM din monolit
// in fisierele per user. Protocol crash-safe in 2 faze cu marker durabil;
// failpoints prin onPhase. Splitter-ul NU e montat la boot in acest task.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, getDbPath } from "./schema.ts";
import { __resetRnpmDbForTests, getRnpmDb, getRnpmDbPath, rnpmFileStem } from "./rnpmDb.ts";
import { __resetRnpmActivityForTests } from "./rnpmActivity.ts";
import { assertDiskSpaceForSplit, openMonoSourceReadonly, runRnpmSplitIfNeeded } from "./rnpmSplitter.ts";

const RNPM_TABLES = [
  "rnpm_searches",
  "rnpm_avize",
  "rnpm_creditori",
  "rnpm_debitori",
  "rnpm_bunuri",
  "rnpm_istoric",
  "rnpm_bunuri_descrieri",
] as const;

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpmsplit-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
});

afterEach(async () => {
  closeDb();
  __resetRnpmDbForTests();
  __resetRnpmActivityForTests();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function markerPath(): string {
  return path.join(path.dirname(getDbPath()), "rnpm", ".split-done.json");
}

function readMarkerRaw(): { status: string; owners: string[] } | null {
  if (!fs.existsSync(markerPath())) return null;
  return JSON.parse(fs.readFileSync(markerPath(), "utf8"));
}

function monoCounts(): Record<string, number> {
  const db = getDb();
  const out: Record<string, number> = {};
  for (const t of RNPM_TABLES) {
    out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  }
  return out;
}

// Seed: 2 owneri, descriere PARTAJATA intre ei, _norm populate prin trigger-ele
// conexiunii getDb() (UDF inregistrat acolo).
function seedTwoOwners(): { descComunaId: number; avizIdsA: number[]; avizIdsB: number[] } {
  const db = getDb();
  const descComunaId = Number(
    db.prepare("INSERT INTO rnpm_bunuri_descrieri (text) VALUES ('Descriere comuna')").run().lastInsertRowid
  );
  const descDoarAId = Number(
    db.prepare("INSERT INTO rnpm_bunuri_descrieri (text) VALUES ('Doar a lui A')").run().lastInsertRowid
  );

  const s1 = Number(
    db
      .prepare(
        "INSERT INTO rnpm_searches (owner_id, search_type, params_json, total_results) VALUES ('userA','dupa_nume','{}',2)"
      )
      .run().lastInsertRowid
  );
  const s2 = Number(
    db
      .prepare(
        "INSERT INTO rnpm_searches (owner_id, search_type, params_json, total_results) VALUES ('userB','dupa_cui','{}',1)"
      )
      .run().lastInsertRowid
  );

  const insAviz = db.prepare(
    "INSERT INTO rnpm_avize (owner_id, uuid, identificator, search_type, tip, data, search_id) VALUES (?,?,?,?,?,?,?)"
  );
  const a1 = Number(insAviz.run("userA", "uu-a1", "A-0001", "dupa_nume", "aviz", "2026-01-01", s1).lastInsertRowid);
  const a2 = Number(insAviz.run("userA", "uu-a2", "A-0002", "dupa_nume", "aviz", "2026-01-02", null).lastInsertRowid);
  const a3 = Number(insAviz.run("userB", "uu-b1", "B-0001", "dupa_cui", "aviz", "2026-02-01", s2).lastInsertRowid);

  db.prepare(
    "INSERT INTO rnpm_creditori (owner_id, aviz_id, tip_persoana, denumire) VALUES ('userA',?,'PJ','Banca X')"
  ).run(a1);
  db.prepare(
    "INSERT INTO rnpm_creditori (owner_id, aviz_id, tip_persoana, denumire) VALUES ('userB',?,'PJ','Banca Y')"
  ).run(a3);
  db.prepare(
    "INSERT INTO rnpm_debitori (owner_id, aviz_id, tip_persoana, denumire) VALUES ('userA',?,'PF','Popescu Ștefan')"
  ).run(a1);
  db.prepare("INSERT INTO rnpm_bunuri (owner_id, aviz_id, tip_bun, descriere_id) VALUES ('userA',?,'auto',?)").run(
    a1,
    descComunaId
  );
  db.prepare("INSERT INTO rnpm_bunuri (owner_id, aviz_id, tip_bun, descriere_id) VALUES ('userA',?,'auto',?)").run(
    a2,
    descDoarAId
  );
  db.prepare("INSERT INTO rnpm_bunuri (owner_id, aviz_id, tip_bun, descriere_id) VALUES ('userB',?,'imobil',?)").run(
    a3,
    descComunaId
  );
  db.prepare(
    "INSERT INTO rnpm_istoric (owner_id, aviz_id, identificator, uuid, data, tip) VALUES ('userA',?,'A-0001','uu-a1','2026-01-01','initial')"
  ).run(a1);

  return { descComunaId, avizIdsA: [a1, a2], avizIdsB: [a3] };
}

function openUserFileRO(ownerId: string): Database.Database {
  return new Database(getRnpmDbPath(ownerId), { readonly: true, fileMustExist: true });
}

describe("runRnpmSplitIfNeeded", () => {
  it("muta datele fiecarui owner in fisierul lui (stem collision-safe), pastrand id-urile", () => {
    const seed = seedTwoOwners();
    const result = runRnpmSplitIfNeeded();
    expect(result.split).toBe(true);
    expect([...result.owners].sort()).toEqual(["userA", "userB"]);

    // Fisierele sunt <stem>.db, nu <ownerId>.db.
    const rnpmDir = path.join(path.dirname(getDbPath()), "rnpm");
    expect(fs.existsSync(path.join(rnpmDir, "usera.db"))).toBe(false);
    expect(fs.existsSync(path.join(rnpmDir, `${rnpmFileStem("userA")}.db`))).toBe(true);

    const fileA = openUserFileRO("userA");
    const fileB = openUserFileRO("userB");
    try {
      // Id-urile originale pastrate.
      const idsA = fileA
        .prepare("SELECT id FROM rnpm_avize ORDER BY id")
        .all()
        .map((r) => (r as { id: number }).id);
      expect(idsA).toEqual(seed.avizIdsA);
      const idsB = fileB
        .prepare("SELECT id FROM rnpm_avize ORDER BY id")
        .all()
        .map((r) => (r as { id: number }).id);
      expect(idsB).toEqual(seed.avizIdsB);

      // COUNT per tabela per owner.
      const countOf = (d: Database.Database, t: string) =>
        (d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
      expect(countOf(fileA, "rnpm_searches")).toBe(1);
      expect(countOf(fileA, "rnpm_avize")).toBe(2);
      expect(countOf(fileA, "rnpm_creditori")).toBe(1);
      expect(countOf(fileA, "rnpm_debitori")).toBe(1);
      expect(countOf(fileA, "rnpm_bunuri")).toBe(2);
      expect(countOf(fileA, "rnpm_istoric")).toBe(1);
      expect(countOf(fileA, "rnpm_bunuri_descrieri")).toBe(2);
      expect(countOf(fileB, "rnpm_searches")).toBe(1);
      expect(countOf(fileB, "rnpm_avize")).toBe(1);
      expect(countOf(fileB, "rnpm_creditori")).toBe(1);
      expect(countOf(fileB, "rnpm_debitori")).toBe(0);
      expect(countOf(fileB, "rnpm_bunuri")).toBe(1);
      expect(countOf(fileB, "rnpm_istoric")).toBe(0);
      expect(countOf(fileB, "rnpm_bunuri_descrieri")).toBe(1);

      // Descrierea partajata exista in AMBELE fisiere cu id-ul original.
      const descA = fileA.prepare("SELECT text FROM rnpm_bunuri_descrieri WHERE id = ?").get(seed.descComunaId) as {
        text: string;
      };
      const descB = fileB.prepare("SELECT text FROM rnpm_bunuri_descrieri WHERE id = ?").get(seed.descComunaId) as {
        text: string;
      };
      expect(descA.text).toBe("Descriere comuna");
      expect(descB.text).toBe("Descriere comuna");

      // _norm-urile au fost recalculate identic (UDF determinist).
      const norm = fileA.prepare("SELECT denumire_norm FROM rnpm_debitori").get() as { denumire_norm: string };
      expect(norm.denumire_norm).toBe("popescu stefan");
    } finally {
      fileA.close();
      fileB.close();
    }

    // Monolitul are 0 randuri in TOATE cele 7 tabele rnpm_*.
    const counts = monoCounts();
    for (const t of RNPM_TABLES) expect(counts[t], `mono ${t}`).toBe(0);

    // Marker durabil status=done.
    expect(readMarkerRaw()).toMatchObject({ status: "done" });
  });

  it("este idempotent: al doilea apel nu face nimic (marker done + monolit gol)", () => {
    seedTwoOwners();
    runRnpmSplitIfNeeded();
    const second = runRnpmSplitIfNeeded();
    expect(second).toEqual({ split: false, owners: [] });
  });

  it("instalare fresh (monolit fara randuri rnpm) => marker done direct, split:false", () => {
    getDb();
    const result = runRnpmSplitIfNeeded();
    expect(result).toEqual({ split: false, owners: [] });
    expect(readMarkerRaw()).toMatchObject({ status: "done", owners: [] });
  });

  it("crash INAINTE de marker (dupa owner 1 din 2): re-run reface totul din monolit", () => {
    const seed = seedTwoOwners();
    const before = monoCounts();
    let ownersDone = 0;
    expect(() =>
      runRnpmSplitIfNeeded({
        onPhase: (phase) => {
          if (phase === "owner_done") {
            ownersDone += 1;
            if (ownersDone === 1) throw new Error("failpoint owner_done");
          }
        },
      })
    ).toThrow("failpoint owner_done");

    // Monolitul e INTACT (sursa de adevar), fara marker.
    expect(monoCounts()).toEqual(before);
    expect(readMarkerRaw()).toBeNull();

    // Re-run fara failpoint => ambii owneri corecti, fisierul partial suprascris curat.
    const result = runRnpmSplitIfNeeded();
    expect(result.split).toBe(true);
    const fileA = openUserFileRO("userA");
    const fileB = openUserFileRO("userB");
    try {
      expect((fileA.prepare("SELECT COUNT(*) AS n FROM rnpm_avize").get() as { n: number }).n).toBe(
        seed.avizIdsA.length
      );
      expect((fileB.prepare("SELECT COUNT(*) AS n FROM rnpm_avize").get() as { n: number }).n).toBe(
        seed.avizIdsB.length
      );
    } finally {
      fileA.close();
      fileB.close();
    }
    const counts = monoCounts();
    for (const t of RNPM_TABLES) expect(counts[t]).toBe(0);
  });

  it("crash IN TIMPUL wipe-ului (marker wiping): re-run reia DOAR wipe-ul, nu re-copiaza", () => {
    seedTwoOwners();
    expect(() =>
      runRnpmSplitIfNeeded({
        onPhase: (phase) => {
          if (phase === "marker_wiping") throw new Error("failpoint marker_wiping");
        },
      })
    ).toThrow("failpoint marker_wiping");
    expect(readMarkerRaw()).toMatchObject({ status: "wiping" });

    // Scrie un rand NOU in fisierul per-user al lui userA (fara trigger => fara UDF).
    const fileA = new Database(getRnpmDbPath("userA"));
    try {
      fileA
        .prepare(
          "INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('userA','dupa_nume','{\"nou\":1}')"
        )
        .run();
    } finally {
      fileA.close();
    }

    const result = runRnpmSplitIfNeeded();
    expect(result.split).toBe(true);
    // Monolit golit; randul nou SUPRAVIETUIESTE (dovada ca nu s-a re-copiat).
    const counts = monoCounts();
    for (const t of RNPM_TABLES) expect(counts[t]).toBe(0);
    const check = openUserFileRO("userA");
    try {
      expect((check.prepare("SELECT COUNT(*) AS n FROM rnpm_searches").get() as { n: number }).n).toBe(2);
    } finally {
      check.close();
    }
    expect(readMarkerRaw()).toMatchObject({ status: "done" });
  });

  it("marker done + randuri rnpm reaparute in monolit (restore de monolit vechi) => ABORT boot", () => {
    seedTwoOwners();
    runRnpmSplitIfNeeded();
    // Simuleaza restore-ul unui backup pre-split: randuri rnpm reapar in monolit.
    getDb()
      .prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('userA','dupa_nume','{}')")
      .run();
    const fileABytesBefore = fs.statSync(getRnpmDbPath("userA")).size;

    expect(() => runRnpmSplitIfNeeded()).toThrow(/RUNBOOK/);

    // Fisierele per-user raman neatinse.
    expect(fs.statSync(getRnpmDbPath("userA")).size).toBe(fileABytesBefore);
  });

  it("owner cu id invalid => abort inainte de orice mutare, monolit intact", () => {
    seedTwoOwners();
    getDb()
      .prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('../evil','dupa_nume','{}')")
      .run();
    const before = monoCounts();
    expect(() => runRnpmSplitIfNeeded()).toThrow(/ownerId invalid/);
    expect(monoCounts()).toEqual(before);
    expect(readMarkerRaw()).toBeNull();
  });

  it("spatiu insuficient (getFreeBytes injectat) => abort inainte de orice mutare", () => {
    seedTwoOwners();
    const before = monoCounts();
    expect(() => runRnpmSplitIfNeeded({ getFreeBytes: () => 0 })).toThrow(/spatiu insuficient/);
    expect(monoCounts()).toEqual(before);
    expect(readMarkerRaw()).toBeNull();
  });

  it("bresa FK in monolit => abort cu mesaj care numeste tabela", () => {
    seedTwoOwners();
    // Rand orfan inserat pe o conexiune separata cu FK OFF (monolitul are FK ON).
    const raw = new Database(getDbPath());
    try {
      raw.pragma("foreign_keys = OFF");
      raw
        .prepare(
          "INSERT INTO rnpm_istoric (owner_id, aviz_id, identificator, uuid, data, tip) VALUES ('userA', 99999, 'X','x','2026-01-01','t')"
        )
        .run();
    } finally {
      raw.close();
    }
    const before = monoCounts();
    expect(() => runRnpmSplitIfNeeded()).toThrow(/rnpm_istoric/);
    expect(monoCounts()).toEqual(before);
  });

  it("copil cu owner_id diferit de parinte => abort (consistenta owner parinte-copil)", () => {
    const seed = seedTwoOwners();
    getDb()
      .prepare(
        "INSERT INTO rnpm_creditori (owner_id, aviz_id, tip_persoana, denumire) VALUES ('userB', ?, 'PJ', 'Intrus')"
      )
      .run(seed.avizIdsA[0]);
    const before = monoCounts();
    expect(() => runRnpmSplitIfNeeded()).toThrow(/rnpm_creditori/);
    expect(monoCounts()).toEqual(before);
    expect(readMarkerRaw()).toBeNull();
  });

  it("backup-ul pre-split esueaza (cale de backup blocata) => abort, monolit intact", () => {
    seedTwoOwners();
    // "backups" exista ca FISIER => mkdirSync/VACUUM INTO pe calea de backup pica.
    fs.writeFileSync(path.join(path.dirname(getDbPath()), "backups"), "not a dir");
    const before = monoCounts();
    expect(() => runRnpmSplitIfNeeded()).toThrow();
    expect(monoCounts()).toEqual(before);
    expect(readMarkerRaw()).toBeNull();
  });

  it("sursa monolit a splitter-ului e readonly REAL: scrierile spre ea arunca", () => {
    // Deviere validata cu GPT-5.6 Sol: ATTACH prin URI (mode=ro) nu e suportat de
    // better-sqlite3 (compilat fara SQLITE_USE_URI), iar query_only e pe toata
    // conexiunea; sursa se deschide pe o conexiune separata { readonly: true }.
    seedTwoOwners();
    const src = openMonoSourceReadonly();
    try {
      expect(src.readonly).toBe(true);
      expect(() =>
        src.prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('x','y','{}')").run()
      ).toThrow(/readonly|read-only|attempt to write/i);
      // Citirea vede datele comise de conexiunea live (WAL).
      expect((src.prepare("SELECT COUNT(*) AS n FROM rnpm_searches").get() as { n: number }).n).toBe(2);
    } finally {
      src.close();
    }
  });

  it("dupa split, un INSERT fara id explicit primeste id peste maximul istoric", () => {
    const seed = seedTwoOwners();
    // Ridica high-water mark-ul lui sqlite_sequence peste MAX(id): insereaza + sterge un aviz.
    const db = getDb();
    const ghost = Number(
      db
        .prepare(
          "INSERT INTO rnpm_avize (owner_id, uuid, identificator, search_type, tip, data) VALUES ('userA','uu-ghost','A-GHOST','dupa_nume','aviz','2026-03-01')"
        )
        .run().lastInsertRowid
    );
    db.prepare("DELETE FROM rnpm_avize WHERE id = ?").run(ghost);
    expect(ghost).toBeGreaterThan(Math.max(...seed.avizIdsA, ...seed.avizIdsB));

    runRnpmSplitIfNeeded();

    const fileA = getRnpmDb("userA");
    const fresh = Number(
      fileA
        .prepare(
          "INSERT INTO rnpm_avize (owner_id, uuid, identificator, search_type, tip, data) VALUES ('userA','uu-nou','A-NOU','dupa_nume','aviz','2026-03-02')"
        )
        .run().lastInsertRowid
    );
    // Id-urile sterse istoric peste MAX(id) nu se reemit (preluare sqlite_sequence).
    expect(fresh).toBeGreaterThan(ghost);
  });
});

describe("assertDiskSpaceForSplit", () => {
  it("trece cand spatiul liber e peste 3x volumul bazei si pica sub", () => {
    const db = getDb();
    db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    const size = fs.statSync(getDbPath()).size;
    expect(() => assertDiskSpaceForSplit(getDbPath(), () => size * 4)).not.toThrow();
    expect(() => assertDiskSpaceForSplit(getDbPath(), () => size * 2)).toThrow(/spatiu insuficient/);
  });
});
