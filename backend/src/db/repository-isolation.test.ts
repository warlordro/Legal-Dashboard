// PR-1 regression suite, rescrisa pentru v2.43.0 (rnpm-split).
//
// Din v2.43.0 izolarea RNPM e FIZICA: fiecare owner are fisierul lui SQLite
// (rnpm/<stem>.db), deci "leak cross-tenant" inseamna acum "randuri straine
// ajunse in fisierul altui owner" (posibil doar printr-un restore partial sau
// bug de splitter). Suita verifica:
//   1. Fisiere separate pe disc (nume prin rnpmFileStem, nu ownerId brut);
//      fisierul lui A nu contine NICIUN rand al lui B.
//   2. Happy path — API-urile repository raman owner-scoped in interiorul
//      fisierului propriu.
//   3. FK breach drills — un rand copil cu owner_id nepotrivit FORJAT in
//      fisierul lui A nu e servit de loadAvizChildren/getAvize (defense in
//      depth pentru artefacte de restore).
//   4. getSearchOwnership are DOAR owned/missing — starea "foreign" a disparut
//      (id-urile sunt namespace per fisier; acelasi numar la useri diferiti
//      inseamna cautari diferite, fara leak).

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteAviz,
  deleteAvizeByIds,
  filterRnpmSearchResults,
  getAvize,
  getAvizById,
  getAvizByIdentificator,
  getAvizStats,
  getAvizeByIds,
  saveAvizFull,
  type SaveAvizInput,
} from "./avizRepository.ts";
import { __resetRnpmDbForTests, getRnpmDb, getRnpmDbPath, rnpmFileStem } from "./rnpmDb.ts";
import { getSearchOwnership } from "./searchRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;
let dbPath: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-isolation-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  __resetRnpmDbForTests();
  closeDb();
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DB_PATH");
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

const OWNER_A = "userA";
const OWNER_B = "userB";

function makeSearch(ownerId: string, type: string): number {
  const info = getRnpmDb(ownerId)
    .prepare(
      `INSERT INTO rnpm_searches (owner_id, search_type, params_json, total_results, criteriu)
       VALUES (?, ?, '{}', 0, '')`
    )
    .run(ownerId, type);
  return Number(info.lastInsertRowid);
}

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

describe("izolare fizica — fisiere per owner", () => {
  it("scrierile fiecarui owner merg in fisierul lui (stem collision-safe), nu in monolit", () => {
    saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    saveAvizFull(makeAviz(OWNER_B, "BVB1"));

    // Doua fisiere separate pe disc, numite prin stem, nu prin ownerId brut.
    const pathA = getRnpmDbPath(OWNER_A);
    const pathB = getRnpmDbPath(OWNER_B);
    expect(pathA).not.toBe(pathB);
    expect(path.basename(pathA)).toBe(`${rnpmFileStem(OWNER_A)}.db`);

    // Fisierul lui A nu contine NICIUN rand al lui B, in nicio tabela.
    const fileA = getRnpmDb(OWNER_A);
    for (const t of ["rnpm_searches", "rnpm_avize", "rnpm_creditori", "rnpm_debitori", "rnpm_bunuri", "rnpm_istoric"]) {
      const n = (fileA.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE owner_id != ?`).get(OWNER_A) as { n: number }).n;
      expect(n, `randuri straine in ${t}`).toBe(0);
    }

    // Monolitul nu mai primeste randuri rnpm.
    const monoN = (getDb().prepare("SELECT COUNT(*) AS n FROM rnpm_avize").get() as { n: number }).n;
    expect(monoN).toBe(0);
  });

  it("getSearchOwnership are doar owned/missing — foreign a disparut din contract", () => {
    const sidA = makeSearch(OWNER_A, "ipoteci");
    expect(getSearchOwnership(sidA, OWNER_A)).toBe("owned");
    // In fisierul lui B, id-ul nu exista (fisier gol) => missing, nu foreign.
    expect(getSearchOwnership(sidA, OWNER_B)).toBe("missing");
    expect(getSearchOwnership(999_999, OWNER_A)).toBe("missing");
  });
});

describe("repository isolation — happy path", () => {
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

  it("getAvizById/Identificator scoped by owner — id-ul altui owner e null in fisierul propriu", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    saveAvizFull(makeAviz(OWNER_B, "BVB1"));

    expect(getAvizById(idA, OWNER_A)?.aviz.identificator).toBe("AVA1");
    // In fisierul lui B, idA fie nu exista, fie e alt aviz al lui B — niciodata al lui A.
    const inB = getAvizById(idA, OWNER_B);
    if (inB !== null) expect(inB.aviz.owner_id).toBe(OWNER_B);

    expect(getAvizByIdentificator("BVB1", OWNER_B)?.aviz.owner_id).toBe(OWNER_B);
    expect(getAvizByIdentificator("BVB1", OWNER_A)).toBeNull();
  });

  it("getAvizStats/getAvizeByIds/delete* respect fisierul ownerului", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    const idB = saveAvizFull(makeAviz(OWNER_B, "BVB1"));

    expect(getAvizStats(OWNER_A).total).toBe(1);
    expect(getAvizStats(OWNER_B).total).toBe(1);

    expect(getAvizeByIds([idA], OWNER_A).map((r) => r.aviz.identificator)).toEqual(["AVA1"]);
    expect(getAvizeByIds([idB], OWNER_B).map((r) => r.aviz.identificator)).toEqual(["BVB1"]);

    // delete pe id inexistent in fisierul propriu e no-op; B-ul ramane intact.
    expect(deleteAviz(999_999, OWNER_A)).toBe(false);
    expect(getAvizStats(OWNER_B).total).toBe(1);

    expect(deleteAvizeByIds([idB], OWNER_B)).toBe(1);
    expect(getAvizStats(OWNER_B).total).toBe(0);
    expect(getAvizStats(OWNER_A).total).toBe(1);
  });
});

describe("repository isolation — FK breach defense (artefacte de restore in fisierul propriu)", () => {
  // Helper: forjeaza un rand copil in FISIERUL lui A, cu owner_id al lui B —
  // clasa de bug "restore partial/artefact" contra careia filtrarea owner_id
  // din loadAvizChildren ramane defense in depth si dupa split.
  function forgeBreachChild(fileOwner: string, table: string, columns: Record<string, unknown>): void {
    const db = getRnpmDb(fileOwner);
    const cols = Object.keys(columns);
    const placeholders = cols.map(() => "?").join(", ");
    db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`).run(
      ...cols.map((c) => columns[c] as string | number | null)
    );
  }

  it("fix #1 — loadAvizChildren skips creditori with mismatched owner_id", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    forgeBreachChild(OWNER_A, "rnpm_creditori", {
      owner_id: OWNER_B,
      aviz_id: idA,
      tip_persoana: "PF",
      denumire: "LEAKED-CRED",
      subscriptor: null,
      nr_ordine: null,
    });

    const full = getAvizById(idA, OWNER_A);
    expect(full).not.toBeNull();
    const denumiri = full?.creditori.map((c) => c.denumire);
    expect(denumiri).not.toContain("LEAKED-CRED");
    expect(denumiri).toEqual([`CRED-${OWNER_A}`]);
  });

  it("fix #2 — loadAvizChildren skips debitori with mismatched owner_id", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    forgeBreachChild(OWNER_A, "rnpm_debitori", {
      owner_id: OWNER_B,
      aviz_id: idA,
      tip_persoana: "PJ",
      denumire: "LEAKED-DEB",
      subscriptor: null,
      nr_ordine: null,
    });

    const full = getAvizById(idA, OWNER_A);
    expect(full?.debitori.map((d) => d.denumire)).toEqual([`DEB-${OWNER_A}`]);
  });

  it("fix #3 — loadAvizChildren skips bunuri with mismatched owner_id", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    forgeBreachChild(OWNER_A, "rnpm_bunuri", {
      owner_id: OWNER_B,
      aviz_id: idA,
      tip_bun: "auto",
      identificare: "LEAKED-BUN",
    });

    const full = getAvizById(idA, OWNER_A);
    expect(full?.bunuri.map((b) => b.identificare)).toEqual([`BUN-${OWNER_A}-AVA1`]);
  });

  it("fix #4 — loadAvizChildren skips istoric with mismatched owner_id", () => {
    const idA = saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    forgeBreachChild(OWNER_A, "rnpm_istoric", {
      owner_id: OWNER_B,
      aviz_id: idA,
      identificator: "LEAKED-IST",
      uuid: "leaked-ist-uuid",
      data: "02.02.2026",
      tip: "modificare",
    });

    const full = getAvizById(idA, OWNER_A);
    expect(full?.istoric.map((h) => h.identificator)).toEqual([`IST-${OWNER_A}-AVA1`]);
  });

  it("fix #5 — getAvize EXISTS subqueries reject parties from a different owner", () => {
    saveAvizFull(makeAviz(OWNER_A, "AVA1"));
    const idA = (getAvize({ ownerId: OWNER_A }).items[0] as { id: number }).id;
    forgeBreachChild(OWNER_A, "rnpm_creditori", {
      owner_id: OWNER_B,
      aviz_id: idA,
      tip_persoana: "PF",
      denumire: "LEAK-MATCH-TOKEN",
      subscriptor: null,
      nr_ordine: null,
    });

    const result = getAvize({ ownerId: OWNER_A, searchText: "LEAK-MATCH-TOKEN" });
    expect(result.total).toBe(0);

    const own = getAvize({ ownerId: OWNER_A, searchText: `CRED-${OWNER_A}` });
    expect(own.total).toBe(1);
    expect(own.items[0]?.identificator).toBe("AVA1");
  });

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

  describe("filterRnpmSearchResults — namespace per fisier", () => {
    it("acelasi id numeric la useri diferiti inseamna cautari diferite, fara leak", () => {
      const sidA = makeSearch(OWNER_A, "ipoteci");
      const sidB = makeSearch(OWNER_B, "ipoteci");
      // Ambele fisiere pornesc secventele de la 1 — id-urile COINCID numeric
      // prin design (namespace per fisier), izolarea e data de fisier.
      expect(sidA).toBe(sidB);

      const aA1 = saveAvizFull(
        makeAviz(OWNER_A, "A-1", {
          searchId: sidA,
          debitori: [
            {
              tip_persoana: "PJ",
              calitate: null,
              denumire: "Popescu Ion",
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
        })
      );
      const aB1 = saveAvizFull(
        makeAviz(OWNER_B, "B-1", {
          searchId: sidB,
          debitori: [
            {
              tip_persoana: "PJ",
              calitate: null,
              denumire: "Popescu Maria",
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
        })
      );

      // B filtreaza pe acelasi id numeric: primeste DOAR avizele lui, din fisierul lui.
      const resB = filterRnpmSearchResults({ ownerId: OWNER_B, searchId: sidA, q: "popescu" });
      expect(resB.matchedAvizIds).toEqual([aB1]);

      const resA = filterRnpmSearchResults({ ownerId: OWNER_A, searchId: sidA, q: "popescu" });
      expect(resA.matchedAvizIds).toEqual([aA1]);
      // Continutul e diferit chiar daca id-urile coincid numeric: verificam textul.
      expect(getAvizById(resA.matchedAvizIds[0], OWNER_A)?.debitori[0]?.denumire).toBe("Popescu Ion");
      expect(getAvizById(resB.matchedAvizIds[0], OWNER_B)?.debitori[0]?.denumire).toBe("Popescu Maria");
    });

    it("searchId inexistent in fisierul propriu => SEARCH_NOT_FOUND (anti-enumeration)", () => {
      makeSearch(OWNER_A, "ipoteci");
      expect(() => filterRnpmSearchResults({ ownerId: OWNER_B, searchId: 424_242, q: "x" })).toThrow(
        /Search inexistent/
      );
    });

    it("descriere cu acelasi text in ambele fisiere NU leak cross-tenant", () => {
      const sidA = makeSearch(OWNER_A, "ipoteci");
      const sidB = makeSearch(OWNER_B, "ipoteci");
      const aA1 = saveAvizFull(makeAviz(OWNER_A, "A-DESC-1", { searchId: sidA, bunuri: [] }));
      const aB1 = saveAvizFull(makeAviz(OWNER_B, "B-DESC-1", { searchId: sidB, bunuri: [] }));

      // Acelasi text de descriere exista in AMBELE fisiere (copii independente).
      for (const [owner, avizId] of [
        [OWNER_A, aA1],
        [OWNER_B, aB1],
      ] as const) {
        const db = getRnpmDb(owner);
        const descId = Number(
          db.prepare("INSERT INTO rnpm_bunuri_descrieri (text) VALUES (?)").run("tractor unic descriere")
            .lastInsertRowid
        );
        db.prepare(
          "INSERT INTO rnpm_bunuri (aviz_id, owner_id, tip_bun, descriere_id) VALUES (?, ?, 'bun mobil', ?)"
        ).run(avizId, owner, descId);
      }

      const resA = filterRnpmSearchResults({ ownerId: OWNER_A, searchId: sidA, q: "tractor" });
      expect(resA.matchedAvizIds).toEqual([aA1]);
      const resB = filterRnpmSearchResults({ ownerId: OWNER_B, searchId: sidB, q: "tractor" });
      expect(resB.matchedAvizIds).toEqual([aB1]);
    });
  });
});
