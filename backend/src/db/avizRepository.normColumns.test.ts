import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { filterRnpmSearchResults } from "./avizRepository.ts";
import { closeDb, getDb } from "./schema.ts";

// Regression suite v2.27.5 — coloanele *_norm materializate (migration 0022) trebuie sa
// fie populate de trigger-e pe INSERT/UPDATE si sa nu schimbe matchedAvizIds vs comportamentul
// pre-materializare (rnpm_norm() apelat per scan). Acopera cele 5 tabele si pattern-urile
// LIKE meta + diacritice + tokens multipli din scenariile reale RNPM.

let tmpRoot: string;
let dbPath: string;
let db: Database.Database;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-norm-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  db = getDb();
});

afterEach(async () => {
  closeDb();
  Reflect.deleteProperty(process.env, "LEGAL_DASHBOARD_DB_PATH");
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function makeSearch(ownerId: string): number {
  const info = db
    .prepare(
      `INSERT INTO rnpm_searches (owner_id, search_type, params_json, total_results, criteriu)
       VALUES (?, 'ipoteci', '{}', 0, '')`
    )
    .run(ownerId);
  return Number(info.lastInsertRowid);
}

function insertAviz(ownerId: string, sid: number, ident: string, extras: Record<string, string | null> = {}): number {
  const info = db
    .prepare(
      `INSERT INTO rnpm_avize (owner_id, search_id, search_type, identificator, tip, data, uuid,
         utilizator_autorizat, numar_act, tip_act, alte_mentiuni, detalii_comune,
         inscriere_initiala_id, inscriere_modificata_id, detail_fetched)
       VALUES (?, ?, 'ipoteci', ?, ?, '01.01.2024', lower(hex(randomblob(8))), ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      ownerId,
      sid,
      ident,
      extras.tip ?? "Aviz",
      extras.utilizator_autorizat ?? null,
      extras.numar_act ?? null,
      extras.tip_act ?? null,
      extras.alte_mentiuni ?? null,
      extras.detalii_comune ?? null,
      extras.inscriere_initiala_id ?? null,
      extras.inscriere_modificata_id ?? null
    );
  return Number(info.lastInsertRowid);
}

describe("rnpm _norm columns - trigger population", () => {
  it("AFTER INSERT pe rnpm_avize populeaza toate cele 9 _norm cols cu diacritice stripped + lowercase", () => {
    const sid = makeSearch("local");
    const avizId = insertAviz("local", sid, "AV-ȘTEFAN-2025", {
      tip: "Ipotecă Mobiliară",
      utilizator_autorizat: "Cabinet ȚU",
      numar_act: "Nr. 50%",
      tip_act: "Contract Cădru",
      alte_mentiuni: "Â menționat",
      detalii_comune: "DEȚINĂTOR",
      inscriere_initiala_id: "PARENT-Â",
      inscriere_modificata_id: "MOD-Î",
    });
    const row = db.prepare("SELECT * FROM rnpm_avize WHERE id = ?").get(avizId) as Record<string, string>;
    expect(row.identificator_norm).toBe("av-stefan-2025");
    expect(row.tip_norm).toBe("ipoteca mobiliara");
    expect(row.utilizator_autorizat_norm).toBe("cabinet tu");
    expect(row.numar_act_norm).toBe("nr. 50%");
    expect(row.tip_act_norm).toBe("contract cadru");
    expect(row.alte_mentiuni_norm).toBe("a mentionat");
    expect(row.detalii_comune_norm).toBe("detinator");
    expect(row.inscriere_initiala_id_norm).toBe("parent-a");
    expect(row.inscriere_modificata_id_norm).toBe("mod-i");
  });

  it("AFTER UPDATE OF source cols actualizeaza _norm; UPDATE pe _norm direct nu recursioneaza", () => {
    const sid = makeSearch("local");
    const avizId = insertAviz("local", sid, "AV-ORIG", { tip: "T1" });
    expect(
      (db.prepare("SELECT tip_norm FROM rnpm_avize WHERE id = ?").get(avizId) as { tip_norm: string }).tip_norm
    ).toBe("t1");
    db.prepare("UPDATE rnpm_avize SET tip = ? WHERE id = ?").run("Ipotecă", avizId);
    expect(
      (db.prepare("SELECT tip_norm FROM rnpm_avize WHERE id = ?").get(avizId) as { tip_norm: string }).tip_norm
    ).toBe("ipoteca");
  });

  it("AFTER INSERT pe rnpm_creditori + rnpm_debitori populeaza denumire_norm / cod_norm / cnp_norm", () => {
    const sid = makeSearch("local");
    const avizId = insertAviz("local", sid, "AV-PARTY");
    db.prepare(
      "INSERT INTO rnpm_creditori (aviz_id, owner_id, tip_persoana, denumire, cod, cnp) VALUES (?, 'local', 'PJ', 'Stefan Bank', 'RO123', '1234567890123')"
    ).run(avizId);
    db.prepare(
      "INSERT INTO rnpm_debitori (aviz_id, owner_id, tip_persoana, denumire, cod, cnp) VALUES (?, 'local', 'PJ', 'Țintea SRL', 'RO456', '9876543210987')"
    ).run(avizId);
    const cred = db
      .prepare("SELECT denumire_norm, cod_norm, cnp_norm FROM rnpm_creditori WHERE aviz_id = ?")
      .get(avizId) as { denumire_norm: string; cod_norm: string; cnp_norm: string };
    expect(cred.denumire_norm).toBe("stefan bank");
    expect(cred.cod_norm).toBe("ro123");
    expect(cred.cnp_norm).toBe("1234567890123");
    const deb = db.prepare("SELECT denumire_norm FROM rnpm_debitori WHERE aviz_id = ?").get(avizId) as {
      denumire_norm: string;
    };
    expect(deb.denumire_norm).toBe("tintea srl");
  });

  it("AFTER INSERT pe rnpm_bunuri + rnpm_bunuri_descrieri populeaza toate _norm cols", () => {
    const sid = makeSearch("local");
    const avizId = insertAviz("local", sid, "AV-BUN");
    const desc = db.prepare("INSERT INTO rnpm_bunuri_descrieri (text) VALUES (?)").run("Tractor Țăran John Deere");
    const descId = Number(desc.lastInsertRowid);
    db.prepare(
      `INSERT INTO rnpm_bunuri (aviz_id, owner_id, tip_bun, categorie, identificare, descriere_id,
         model, serie_sasiu, serie_motor, nr_inmatriculare, referinte_json)
       VALUES (?, 'local', 'bun mobil', 'AutoCat', 'IDENT-Â', ?, 'Model Î', 'SȘ', 'SȚ', 'B-99-XYZ', '{"r":"Ștefan"}')`
    ).run(avizId, descId);
    const b = db.prepare("SELECT * FROM rnpm_bunuri WHERE aviz_id = ?").get(avizId) as Record<string, string>;
    expect(b.tip_bun_norm).toBe("bun mobil");
    expect(b.categorie_norm).toBe("autocat");
    expect(b.identificare_norm).toBe("ident-a");
    expect(b.model_norm).toBe("model i");
    expect(b.serie_sasiu_norm).toBe("ss");
    expect(b.serie_motor_norm).toBe("st");
    expect(b.nr_inmatriculare_norm).toBe("b-99-xyz");
    expect(b.referinte_json_norm).toBe('{"r":"stefan"}');
    const d = db.prepare("SELECT text_norm FROM rnpm_bunuri_descrieri WHERE id = ?").get(descId) as {
      text_norm: string;
    };
    expect(d.text_norm).toBe("tractor taran john deere");
  });

  it("zero regresie - 4-char prefix gaseste avize din bunuri descriere (acelasi behavior ca pre-materializare)", () => {
    const sid = makeSearch("local");
    const a1 = insertAviz("local", sid, "AV-Z1");
    const a2 = insertAviz("local", sid, "AV-Z2");
    const desc1 = db
      .prepare("INSERT INTO rnpm_bunuri_descrieri (text) VALUES (?)")
      .run("Totalitatea creantelor prezente si viitoare");
    const descId1 = Number(desc1.lastInsertRowid);
    db.prepare(
      "INSERT INTO rnpm_bunuri (aviz_id, owner_id, tip_bun, descriere_id) VALUES (?, 'local', 'bun mobil', ?)"
    ).run(a1, descId1);
    // Aviz 2 fara descriere matching.
    const desc2 = db.prepare("INSERT INTO rnpm_bunuri_descrieri (text) VALUES (?)").run("Cu totul altceva");
    db.prepare(
      "INSERT INTO rnpm_bunuri (aviz_id, owner_id, tip_bun, descriere_id) VALUES (?, 'local', 'bun mobil', ?)"
    ).run(a2, Number(desc2.lastInsertRowid));

    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "creantelor" });
    expect(res.matchedAvizIds).toEqual([a1]);
  });

  it("zero regresie - diacritice variant pe creditor (stefan, Stefan, ȘTEFAN -> acelasi rezultat)", () => {
    const sid = makeSearch("local");
    const aviz = insertAviz("local", sid, "AV-DIA");
    db.prepare(
      "INSERT INTO rnpm_creditori (aviz_id, owner_id, tip_persoana, denumire) VALUES (?, 'local', 'PJ', 'Ștefan SRL')"
    ).run(aviz);

    for (const q of ["stefan", "Stefan", "ȘTEFAN", "stefän"]) {
      const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q });
      expect(res.matchedAvizIds, `q="${q}"`).toEqual([aviz]);
    }
  });

  it("zero regresie - referinte_json LIKE pe text JSON (Stefan in payload)", () => {
    const sid = makeSearch("local");
    const aviz = insertAviz("local", sid, "AV-REF");
    db.prepare(
      `INSERT INTO rnpm_bunuri (aviz_id, owner_id, tip_bun, referinte_json)
       VALUES (?, 'local', 'bun mobil', '[{"rol":"constituitor","denumire":"Ștefan SRL"}]')`
    ).run(aviz);
    const res = filterRnpmSearchResults({ ownerId: "local", searchId: sid, q: "stefan" });
    expect(res.matchedAvizIds).toEqual([aviz]);
  });
});
