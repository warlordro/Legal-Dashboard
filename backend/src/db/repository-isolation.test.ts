// PR-1 regression suite: latent owner_id leaks (PLAN §3).
//
// Why: on desktop the only owner_id in use is "local" — nothing leaks today.
// In web mode (PR-9) two users share the same SQLite. If a SELECT forgets a
// `WHERE owner_id = ?` filter, user A could see user B's rows the moment a
// foreign-key breach happens (bug-introduced or partial restore).
//
// What this suite tests:
//   1. Happy path — A's queries return only A's data, B's queries only B's.
//   2. FK breach drills — manually insert a child row with mismatched
//      owner_id and assert the repository query does NOT surface it.
//
// FK breach is NOT achievable through the public API (saveAvizFull uses one
// owner_id for the whole transaction). We synthesise it via raw INSERTs to
// exercise exactly the defense-in-depth path.
//
// Skeleton extensibil: add new repos here as they ship in PR-3+ rather than
// scattering owner_id assertions across feature suites.

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteAviz,
  deleteAvizeByIds,
  getAvize,
  getAvizById,
  getAvizByIdentificator,
  getAvizStats,
  getAvizeByIds,
  saveAvizFull,
  type SaveAvizInput,
} from "./avizRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;
let dbPath: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-isolation-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  // Touch the db so getDb() takes the existing-file path; migration runner
  // will install the baseline schema regardless.
  const seed = new Database(dbPath);
  seed.close();
  // Force schema init now so the first repository call doesn't pay it.
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

const OWNER_A = "userA";
const OWNER_B = "userB";

function makeAviz(ownerId: string, identificator: string, extra?: Partial<SaveAvizInput>): SaveAvizInput {
  return {
    ownerId,
    uuid: `uuid-${ownerId}-${identificator}`,
    identificator,
    searchType: "ipoteci",
    tip: "aviz",
    data: "01.01.2026",
    creditori: [
      {
        tip_persoana: "PF",
        calitate: null,
        denumire: `CRED-${ownerId}`,
        prenume: null,
        tip_entitate: null,
        sediu: null,
        nr_identificare: null,
        cod: null,
        cnp: null,
        tara: null,
        localitate: null,
        judet: null,
        cod_postal: null,
        alte_date: null,
        subscriptor: null,
        nr_ordine: null,
      },
    ],
    debitori: [
      {
        tip_persoana: "PJ",
        calitate: null,
        denumire: `DEB-${ownerId}`,
        prenume: null,
        tip_entitate: "SRL",
        sediu: null,
        nr_identificare: null,
        cod: null,
        cnp: null,
        tara: null,
        localitate: null,
        judet: null,
        cod_postal: null,
        alte_date: null,
        subscriptor: null,
        nr_ordine: null,
      },
    ],
    bunuri: [
      {
        tip_bun: "auto",
        categorie: null,
        identificare: `BUN-${ownerId}-${identificator}`,
        descriere: `desc ${ownerId}`,
        model: null,
        serie_sasiu: null,
        serie_motor: null,
        nr_inmatriculare: null,
        referinte: [],
      },
    ],
    istoric: [
      {
        identificator: `IST-${ownerId}-${identificator}`,
        uuid: `ist-${ownerId}`,
        data: "01.01.2026",
        tip: "modificare",
        inscriere_m_v: null,
        inscriere_m_k: null,
      },
    ],
    ...extra,
  };
}

describe("repository isolation — happy path (no FK breach)", () => {
  it("getAvize never returns rows from a different owner", () => {
    saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    saveAvizFull(makeAviz(OWNER_A, "AVA2"));
    saveAvizFull(makeAviz(OWNER_B, "BVB1"));

    const aPage = getAvize({ ownerId: OWNER_A });
    expect(aPage.total).toBe(2);
    for (const row of aPage.items) expect(row.owner_id).toBe(OWNER_A);

    const bPage = getAvize({ ownerId: OWNER_B });
    expect(bPage.total).toBe(1);
    expect(bPage.items[0]?.identificator).toBe("BVB1");
  });

  it("getAvizById/Identificator scoped by owner — different-owner id is null", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    saveAvizFull(makeAviz(OWNER_B, "BVB1"));

    expect(getAvizById(idA, OWNER_A)?.aviz.identificator).toBe("AVA1");
    expect(getAvizById(idA, OWNER_B)).toBeNull();

    expect(getAvizByIdentificator("BVB1", OWNER_B)?.aviz.owner_id).toBe(OWNER_B);
    expect(getAvizByIdentificator("BVB1", OWNER_A)).toBeNull();
  });

  it("getAvizStats/getAvizeByIds/delete* respect owner_id", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    const idB = saveAvizFull(makeAviz(OWNER_B, "BVB1"));

    expect(getAvizStats(OWNER_A).total).toBe(1);
    expect(getAvizStats(OWNER_B).total).toBe(1);

    expect(getAvizeByIds([idA, idB], OWNER_A).map((r) => r.aviz.identificator)).toEqual(["AVA1"]);
    expect(getAvizeByIds([idA, idB], OWNER_B).map((r) => r.aviz.identificator)).toEqual(["BVB1"]);

    // delete with the wrong owner is a no-op
    expect(deleteAviz(idB, OWNER_A)).toBe(false);
    expect(getAvizStats(OWNER_B).total).toBe(1);

    expect(deleteAvizeByIds([idA, idB], OWNER_B)).toBe(1);
    expect(getAvizStats(OWNER_B).total).toBe(0);
    expect(getAvizStats(OWNER_A).total).toBe(1);
  });
});

describe("repository isolation — FK breach defense (PLAN §3 fixes #1-#5)", () => {
  // Helper: forge a child row whose aviz_id points to OWNER_A's aviz but whose
  // own owner_id is OWNER_B. Simulates the post-restore / partial-rollback bug
  // class that the §3 fixes guard against.
  function forgeBreachChild(table: string, columns: Record<string, unknown>): void {
    const db = getDb();
    const cols = Object.keys(columns);
    const placeholders = cols.map(() => "?").join(", ");
    db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`).run(
      ...cols.map((c) => columns[c] as string | number | null)
    );
  }

  it("fix #1 — loadAvizChildren skips creditori with mismatched owner_id", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    forgeBreachChild("rnpm_creditori", {
      owner_id: OWNER_B,
      aviz_id: idA,
      tip_persoana: "PF",
      denumire: "LEAKED-CRED",
      subscriptor: null,
      nr_ordine: null,
    });

    const full = getAvizById(idA, OWNER_A);
    expect(full).not.toBeNull();
    const denumiri = full!.creditori.map((c) => c.denumire);
    expect(denumiri).not.toContain("LEAKED-CRED");
    expect(denumiri).toEqual([`CRED-${OWNER_A}`]);
  });

  it("fix #2 — loadAvizChildren skips debitori with mismatched owner_id", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    forgeBreachChild("rnpm_debitori", {
      owner_id: OWNER_B,
      aviz_id: idA,
      tip_persoana: "PJ",
      denumire: "LEAKED-DEB",
      subscriptor: null,
      nr_ordine: null,
    });

    const full = getAvizById(idA, OWNER_A);
    expect(full!.debitori.map((d) => d.denumire)).toEqual([`DEB-${OWNER_A}`]);
  });

  it("fix #3 — loadAvizChildren skips bunuri with mismatched owner_id", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    forgeBreachChild("rnpm_bunuri", {
      owner_id: OWNER_B,
      aviz_id: idA,
      tip_bun: "auto",
      identificare: "LEAKED-BUN",
    });

    const full = getAvizById(idA, OWNER_A);
    expect(full!.bunuri.map((b) => b.identificare)).toEqual([`BUN-${OWNER_A}-AVA1`]);
  });

  it("fix #4 — loadAvizChildren skips istoric with mismatched owner_id", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    forgeBreachChild("rnpm_istoric", {
      owner_id: OWNER_B,
      aviz_id: idA,
      identificator: "LEAKED-IST",
      uuid: "leaked-ist-uuid",
      data: "02.02.2026",
      tip: "modificare",
    });

    const full = getAvizById(idA, OWNER_A);
    expect(full!.istoric.map((h) => h.identificator)).toEqual([`IST-${OWNER_A}-AVA1`]);
  });

  it("fix #5 — getAvize EXISTS subqueries reject parties from a different owner", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    // Forge a creditor row keyed to A's aviz, with text matching only OWNER_B's namespace.
    forgeBreachChild("rnpm_creditori", {
      owner_id: OWNER_B,
      aviz_id: idA,
      tip_persoana: "PF",
      denumire: "LEAK-MATCH-TOKEN",
      subscriptor: null,
      nr_ordine: null,
    });

    // Searching as A with the breach token — pre-fix the EXISTS subquery would
    // match the B-owned creditor and surface aviz_A. Post-fix: zero results.
    const result = getAvize({ ownerId: OWNER_A, searchText: "LEAK-MATCH-TOKEN" });
    expect(result.total).toBe(0);

    // Sanity: A's own creditor name still finds A's aviz.
    const own = getAvize({ ownerId: OWNER_A, searchText: `CRED-${OWNER_A}` });
    expect(own.total).toBe(1);
    expect(own.items[0]?.identificator).toBe("AVA1");
  });

  // H-7: defend `getAvize` searchText against LIKE wildcard injection. Without
  // the `\` escape in `buildRnpmLikePattern` + `ESCAPE '\\'` clause, a user
  // typing "%" would surface every row in the table.
  it("getAvize: searchText='%' returns zero results (no wildcard bleed)", () => {
    saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    saveAvizFull(makeAviz(OWNER_A, "AVA2"));
    const result = getAvize({ ownerId: OWNER_A, searchText: "%" });
    expect(result.total).toBe(0);
  });

  it("getAvize: searchText='_' returns zero results (no single-char wildcard)", () => {
    saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    saveAvizFull(makeAviz(OWNER_A, "AVA2"));
    const result = getAvize({ ownerId: OWNER_A, searchText: "_" });
    expect(result.total).toBe(0);
  });

  it("getAvize: searchText='\\' (literal backslash) returns zero results", () => {
    saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    const result = getAvize({ ownerId: OWNER_A, searchText: "\\" });
    expect(result.total).toBe(0);
  });
});
