import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { filterRnpmSearchResults } from "./avizRepository.ts";
import { __resetRnpmDbForTests, getRnpmDb } from "./rnpmDb.ts";
import { closeDb, getDb } from "./schema.ts";

// Bootstrap pattern: foloseste LEGAL_DASHBOARD_DB_PATH (acelasi pattern ca in
// repository-isolation.test.ts). getDb() declanseaza initSchema -> runMigrations
// automat - nu avem nevoie de setDbForTest (nu exista in schema.ts) sau
// import direct la runner.
//
// NOTA factory-uri: coloanele reale din migration 0001 sunt:
//   rnpm_searches: (owner_id, search_type, params_json, total_results, criteriu, created_at)
//     - NU exista `status` sau `started_at`; total_results poate fi 0.
//   rnpm_bunuri:   (aviz_id, owner_id, tip_bun NOT NULL, categorie, identificare,
//                   model, serie_sasiu, serie_motor, nr_inmatriculare,
//                   referinte_json, descriere_id)
//     - NU exista `descriere_proprie`. Text-ul descrierii vine prin descriere_id
//       -> rnpm_bunuri_descrieri.text (content-addressable, fara owner_id).

let tmpRoot: string;
let dbPath: string;
let db: Database.Database;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-filter-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
  // v2.43.0 (rnpm-split): datele rnpm traiesc in fisierul per user; seed-urile
  // merg in fisierul lui "local" (getRnpmDb aplica baseline + UDF rnpm_norm).
  db = getRnpmDb("local");
});

afterEach(async () => {
  __resetRnpmDbForTests();
  closeDb();
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DB_PATH");
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function makeSearch(db: Database.Database, ownerId: string, type: string): number {
  const info = db
    .prepare(
      `INSERT INTO rnpm_searches (owner_id, search_type, params_json, total_results, criteriu)
       VALUES (?, ?, '{}', 0, '')`
    )
    .run(ownerId, type);
  return Number(info.lastInsertRowid);
}

function makeAviz(
  db: Database.Database,
  opts: {
    ownerId: string;
    searchId: number;
    identificator: string;
    tip?: string;
    detailFetched?: 0 | 1;
    detaliComune?: string;
    tipAct?: string;
    alteMentiuni?: string;
  }
): number {
  const info = db
    .prepare(
      `INSERT INTO rnpm_avize (owner_id, search_id, search_type, identificator, tip,
         detail_fetched, detalii_comune, tip_act, alte_mentiuni, data, uuid)
       VALUES (?, ?, 'ipoteci', ?, ?, ?, ?, ?, ?, '01.01.2024', lower(hex(randomblob(8))))`
    )
    .run(
      opts.ownerId,
      opts.searchId,
      opts.identificator,
      opts.tip ?? "Aviz",
      opts.detailFetched ?? 1,
      opts.detaliComune ?? "",
      opts.tipAct ?? "",
      opts.alteMentiuni ?? ""
    );
  return Number(info.lastInsertRowid);
}

function makeDebitor(
  db: Database.Database,
  opts: { avizId: number; ownerId: string; denumire: string; cod?: string; cnp?: string }
): void {
  db.prepare(
    `INSERT INTO rnpm_debitori (aviz_id, owner_id, tip_persoana, denumire, cod, cnp)
     VALUES (?, ?, 'PJ', ?, ?, ?)`
  ).run(opts.avizId, opts.ownerId, opts.denumire, opts.cod ?? "", opts.cnp ?? "");
}

function makeCreditor(
  db: Database.Database,
  opts: { avizId: number; ownerId: string; denumire: string; cod?: string; cnp?: string }
): void {
  db.prepare(
    `INSERT INTO rnpm_creditori (aviz_id, owner_id, tip_persoana, denumire, cod, cnp)
     VALUES (?, ?, 'PJ', ?, ?, ?)`
  ).run(opts.avizId, opts.ownerId, opts.denumire, opts.cod ?? "", opts.cnp ?? "");
}

// makeBun acopera toate coloanele text relevante pentru filtru. `tipBun` e NOT NULL
// in schema, asa ca are default "bun mobil". `descriereText` insereaza in
// rnpm_bunuri_descrieri (content-addressable, fara owner_id) si leaga prin descriere_id.
function makeBun(
  db: Database.Database,
  opts: {
    avizId: number;
    ownerId: string;
    tipBun?: string;
    categorie?: string;
    identificare?: string;
    model?: string;
    serieSasiu?: string;
    serieMotor?: string;
    nrInmatriculare?: string;
    referinteJson?: string;
    descriereText?: string;
  }
): void {
  let descriereId: number | null = null;
  if (opts.descriereText !== undefined) {
    const desc = db.prepare("INSERT INTO rnpm_bunuri_descrieri (text) VALUES (?)").run(opts.descriereText);
    descriereId = Number(desc.lastInsertRowid);
  }
  db.prepare(
    `INSERT INTO rnpm_bunuri (aviz_id, owner_id, tip_bun, categorie, identificare,
       model, serie_sasiu, serie_motor, nr_inmatriculare, referinte_json, descriere_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    opts.avizId,
    opts.ownerId,
    opts.tipBun ?? "bun mobil",
    opts.categorie ?? null,
    opts.identificare ?? null,
    opts.model ?? null,
    opts.serieSasiu ?? null,
    opts.serieMotor ?? null,
    opts.nrInmatriculare ?? null,
    opts.referinteJson ?? null,
    descriereId
  );
}

describe("filterRnpmSearchResults", () => {
  it("happy path - matchuieste pe debitor.denumire", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-001" });
    const a2 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-002" });
    const a3 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-003" });
    makeDebitor(db, { avizId: a1, ownerId: "local", denumire: "Popescu Marin" });
    makeDebitor(db, { avizId: a2, ownerId: "local", denumire: "Ionescu Vasile" });
    makeDebitor(db, { avizId: a3, ownerId: "local", denumire: "Georgescu Ana" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "popescu" });

    expect(res.matchedAvizIds).toEqual([a1]);
    expect(res.matchedCount).toBe(1);
    expect(res.totalInSearch).toBe(3);
    expect(res.missingDetails).toBe(0);
    expect(res.truncated).toBe(false);
  });

  it("diacritic-insensitive - 'stefan' matchuieste 'Stefan'", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-100" });
    makeDebitor(db, { avizId: a1, ownerId: "local", denumire: "Stefan SRL" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "stefan" });
    expect(res.matchedCount).toBe(1);
    expect(res.matchedAvizIds).toEqual([a1]);
  });

  it("DISTINCT - aviz cu 3 bunuri matching nu se duplica", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-200" });
    makeBun(db, { avizId: a1, ownerId: "local", model: "combina John Deere" });
    makeBun(db, { avizId: a1, ownerId: "local", model: "combina Claas" });
    makeBun(db, { avizId: a1, ownerId: "local", model: "combina New Holland" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "combina" });
    expect(res.matchedAvizIds).toHaveLength(1);
    expect(res.matchedAvizIds).toEqual([a1]);
    expect(res.matchedCount).toBe(1);
  });

  it("EXISTS pe rnpm_bunuri_descrieri.text via JOIN", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-300" });
    makeBun(db, { avizId: a1, ownerId: "local", descriereText: "tractor agricol John Deere 6195" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "john deere" });
    expect(res.matchedAvizIds).toEqual([a1]);
  });

  it("matchuieste pe creditor.denumire", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-CRED-1" });
    const a2 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-CRED-2" });
    makeCreditor(db, { avizId: a1, ownerId: "local", denumire: "Banca Exemplu" });
    makeCreditor(db, { avizId: a2, ownerId: "local", denumire: "Alta Banca" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "exemplu" });
    expect(res.matchedAvizIds).toEqual([a1]);
  });

  it("cross-tenant izolation pe avize", () => {
    // v2.43.0 (rnpm-split): fiecare owner seed-uieste in FISIERUL lui.
    const dbA = getRnpmDb("ownerA");
    const dbB = getRnpmDb("ownerB");
    const sidA = makeSearch(dbA, "ownerA", "ipoteci");
    const sidB = makeSearch(dbB, "ownerB", "ipoteci");
    const aA = makeAviz(dbA, { ownerId: "ownerA", searchId: sidA, identificator: "AV-A" });
    makeDebitor(dbA, { avizId: aA, ownerId: "ownerA", denumire: "Comun" });
    const aB = makeAviz(dbB, { ownerId: "ownerB", searchId: sidB, identificator: "AV-B" });
    makeDebitor(dbB, { avizId: aB, ownerId: "ownerB", denumire: "Comun" });

    const resA = filterRnpmSearchResults({ ownerId: "ownerA", searchId: sidA, q: "comun" });
    expect(resA.matchedAvizIds).toEqual([aA]);
    expect(resA.matchedCount).toBe(1);
    expect(resA.totalInSearch).toBe(1);
    // Id-urile pot COINCIDE numeric intre fisiere (aA === aB e posibil prin
    // design); identitatea se verifica pe continut, in fisierul lui A.
    const row = dbA.prepare("SELECT identificator FROM rnpm_avize WHERE id = ?").get(resA.matchedAvizIds[0]) as {
      identificator: string;
    };
    expect(row.identificator).toBe("AV-A");
    expect(aB).toBeGreaterThan(0);
  });

  it("cross-tenant izolation pe rnpm_bunuri_descrieri content-addressable", () => {
    const dbA = getRnpmDb("ownerA");
    const dbB = getRnpmDb("ownerB");
    const sidA = makeSearch(dbA, "ownerA", "ipoteci");
    const sidB = makeSearch(dbB, "ownerB", "ipoteci");
    const aA = makeAviz(dbA, { ownerId: "ownerA", searchId: sidA, identificator: "AV-DA" });
    const aB = makeAviz(dbB, { ownerId: "ownerB", searchId: sidB, identificator: "AV-DB" });
    // Acelasi text de descriere exista in AMBELE fisiere (copii independente).
    for (const [d, aviz, owner] of [
      [dbA, aA, "ownerA"],
      [dbB, aB, "ownerB"],
    ] as const) {
      const desc = d.prepare("INSERT INTO rnpm_bunuri_descrieri (text) VALUES (?)").run("descriere comuna tractor");
      d.prepare("INSERT INTO rnpm_bunuri (aviz_id, owner_id, tip_bun, descriere_id) VALUES (?, ?, 'bun mobil', ?)").run(
        aviz,
        owner,
        Number(desc.lastInsertRowid)
      );
    }

    const resA = filterRnpmSearchResults({ ownerId: "ownerA", searchId: sidA, q: "tractor" });
    expect(resA.matchedAvizIds).toEqual([aA]);
    const rowA = dbA.prepare("SELECT identificator FROM rnpm_avize WHERE id = ?").get(resA.matchedAvizIds[0]) as {
      identificator: string;
    };
    expect(rowA.identificator).toBe("AV-DA");
    expect(aB).toBeGreaterThan(0);
  });

  it("searchId neexistent -> RnpmSearchNotFoundError", () => {
    expect(() => filterRnpmSearchResults({ ownerId: "local", searchId: 999999, q: "test" })).toThrow(
      /Search inexistent/
    );
  });

  it("searchId inexistent in fisierul callerului -> RnpmSearchNotFoundError (anti-enumeration)", () => {
    // v2.43.0 (rnpm-split): id-urile sunt namespace per fisier; fisierul lui
    // ownerB nu are search-ul, indiferent ce id exista la ownerA.
    const sidA = makeSearch(getRnpmDb("ownerA"), "ownerA", "ipoteci");
    expect(() => filterRnpmSearchResults({ ownerId: "ownerB", searchId: sidA + 1000, q: "test" })).toThrow(
      /Search inexistent/
    );
  });

  it("missingDetails counter corect", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-D1", detailFetched: 1 });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-D2", detailFetched: 1 });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-D3", detailFetched: 0 });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-D4", detailFetched: 0 });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-D5", detailFetched: 1 });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "av-" });
    expect(res.missingDetails).toBe(2);
    expect(res.totalInSearch).toBe(5);
  });

  it("totalInSearch numara avizele din search indiferent de match", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-T1" });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-T2" });
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "zzz-no-match" });
    expect(res.matchedCount).toBe(0);
    expect(res.totalInSearch).toBe(2);
  });

  it("truncare la limit - matchedCount > limit, matchedAvizIds capped", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    for (let i = 0; i < 25; i++) {
      const a = makeAviz(db, { ownerId: "local", searchId: sid, identificator: `AV-TR-${i}` });
      makeDebitor(db, { avizId: a, ownerId: "local", denumire: "TruncTest SRL" });
    }
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "trunctest", limit: 10 });
    expect(res.matchedCount).toBe(25);
    expect(res.matchedAvizIds).toHaveLength(10);
    expect(res.truncated).toBe(true);
  });

  it("LIKE meta - '%' este literal, nu wildcard", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AAA" });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AB%C" });
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "%" });
    expect(res.matchedAvizIds.length).toBe(1);
  });

  it("LIKE meta - '_' este literal, nu wildcard single-char", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AAA" });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "A_A" });
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "_" });
    expect(res.matchedAvizIds.length).toBe(1);
  });

  it("LIKE meta - backslash literal", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "path\\to\\file" });
    makeAviz(db, { ownerId: "local", searchId: sid, identificator: "no-backslash" });
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "path\\to" });
    expect(res.matchedAvizIds).toEqual([a1]);
  });

  it("AbortSignal pre-call - throw AbortError fara DB hit", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const ctl = new AbortController();
    ctl.abort();
    expect(() => filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "test", signal: ctl.signal })).toThrow(
      /Aborted/
    );
  });

  it("matchedAvizIds returnate in ordine ASC pe id", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = makeAviz(db, { ownerId: "local", searchId: sid, identificator: `AV-ORD-${i}` });
      makeDebitor(db, { avizId: a, ownerId: "local", denumire: "OrderToken" });
      ids.push(a);
    }
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "ordertoken" });
    expect(res.matchedAvizIds).toEqual(ids);
  });
});

describe("filterRnpmSearchResults - multi-token AND", () => {
  it("token1 in debitor si token2 in descriere bun -> match", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const avizId = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-AND-001" });
    makeDebitor(db, { avizId, ownerId: "local", denumire: "ALTEX ROMANIA SRL" });
    makeBun(db, {
      avizId,
      ownerId: "local",
      descriereText: "Totalitatea creantelor prezente si viitoare",
    });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "altex totalitatea" });

    expect(res.matchedAvizIds).toEqual([avizId]);
    expect(res.matchedCount).toBe(1);
  });

  it("token1 in debitor si token2 nicaieri -> no match", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const avizId = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-AND-002" });
    makeDebitor(db, { avizId, ownerId: "local", denumire: "ALTEX ROMANIA SRL" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "altex inexistent" });

    expect(res.matchedAvizIds).toEqual([]);
    expect(res.matchedCount).toBe(0);
  });

  it("3 tokens AND, fiecare in alt camp", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const avizId = makeAviz(db, {
      ownerId: "local",
      searchId: sid,
      identificator: "AV-AND-003",
      tip: "Ipoteca mobiliara",
      detaliComune: "contract cadru finantare",
    });
    makeCreditor(db, { avizId, ownerId: "local", denumire: "BANCA EXEMPLU" });
    makeBun(db, { avizId, ownerId: "local", model: "John Deere 6195" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "banca john contract" });

    expect(res.matchedAvizIds).toEqual([avizId]);
    expect(res.matchedCount).toBe(1);
  });

  it("dedup tokens evita conditii duplicate si pastreaza match-ul", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const avizId = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-AND-004" });
    makeDebitor(db, { avizId, ownerId: "local", denumire: "Stefan SRL" });

    const res = filterRnpmSearchResults({
      ownerId: "local",
      searchId: sid,
      q: "Stefan stefan \u0218TEFAN",
    });

    expect(res.matchedAvizIds).toEqual([avizId]);
    expect(res.matchedCount).toBe(1);
  });

  it("q whitespace-only intoarce toate avizele search-ului", () => {
    const sid = makeSearch(db, "local", "ipoteci");
    const a1 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-AND-005" });
    const a2 = makeAviz(db, { ownerId: "local", searchId: sid, identificator: "AV-AND-006" });

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "   \t  " });

    expect(res.matchedAvizIds).toEqual([a1, a2]);
    expect(res.matchedCount).toBe(2);
  });
});
