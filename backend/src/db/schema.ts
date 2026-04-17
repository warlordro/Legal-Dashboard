import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { stripDiacritics } from "../util/textNormalize.ts";

let db: Database.Database | null = null;

export function getDbPath(): string {
  return process.env.LEGAL_DASHBOARD_DB_PATH
    ?? path.join(process.cwd(), "legal-dashboard.db");
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Custom scalar used by the "Baza locala" filter so "Stefan" matches "Ștefan".
  // Registered per-connection; SQLite has no built-in diacritic folding.
  db.function("rnpm_norm", { deterministic: true }, (s) =>
    s == null ? "" : stripDiacritics(String(s)).toLowerCase()
  );

  initSchema(db);
  return db;
}

function initSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS rnpm_searches (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id      TEXT NOT NULL DEFAULT 'local',
      search_type   TEXT NOT NULL,
      params_json   TEXT NOT NULL,
      total_results INTEGER NOT NULL DEFAULT 0,
      criteriu      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_searches_owner ON rnpm_searches(owner_id);

    CREATE TABLE IF NOT EXISTS rnpm_avize (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id             TEXT NOT NULL DEFAULT 'local',
      uuid                 TEXT NOT NULL,
      identificator        TEXT NOT NULL,
      search_type          TEXT NOT NULL,
      tip                  TEXT NOT NULL,
      data                 TEXT NOT NULL,
      utilizator_autorizat TEXT,
      activ                INTEGER DEFAULT 1,
      needs_actualizare    INTEGER DEFAULT 0,
      destinatie           TEXT,
      tip_act              TEXT,
      numar_act            TEXT,
      data_inreg           TEXT,
      data_expirare        TEXT,
      alte_mentiuni        TEXT,
      detalii_comune       TEXT,
      detail_fetched       INTEGER DEFAULT 0,
      search_id            INTEGER REFERENCES rnpm_searches(id) ON DELETE SET NULL,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_id, identificator)
    );
    CREATE INDEX IF NOT EXISTS idx_avize_owner ON rnpm_avize(owner_id);
    CREATE INDEX IF NOT EXISTS idx_avize_identificator ON rnpm_avize(identificator);
    CREATE INDEX IF NOT EXISTS idx_avize_search_type ON rnpm_avize(owner_id, search_type);
    CREATE INDEX IF NOT EXISTS idx_avize_data ON rnpm_avize(data);

    CREATE TABLE IF NOT EXISTS rnpm_creditori (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id        TEXT NOT NULL DEFAULT 'local',
      aviz_id         INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
      tip_persoana    TEXT NOT NULL,
      denumire        TEXT,
      prenume         TEXT,
      tip_entitate    TEXT,
      sediu           TEXT,
      nr_identificare TEXT,
      cod             TEXT,
      cnp             TEXT,
      tara            TEXT,
      localitate      TEXT,
      judet           TEXT,
      cod_postal      TEXT,
      alte_date       TEXT,
      subscriptor     INTEGER,
      nr_ordine       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_creditori_owner ON rnpm_creditori(owner_id);
    CREATE INDEX IF NOT EXISTS idx_creditori_aviz ON rnpm_creditori(aviz_id);
    CREATE INDEX IF NOT EXISTS idx_creditori_cod ON rnpm_creditori(cod);

    CREATE TABLE IF NOT EXISTS rnpm_debitori (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id        TEXT NOT NULL DEFAULT 'local',
      aviz_id         INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
      tip_persoana    TEXT NOT NULL,
      calitate        TEXT,
      denumire        TEXT,
      prenume         TEXT,
      tip_entitate    TEXT,
      sediu           TEXT,
      nr_identificare TEXT,
      cod             TEXT,
      cnp             TEXT,
      tara            TEXT,
      localitate      TEXT,
      judet           TEXT,
      cod_postal      TEXT,
      alte_date       TEXT,
      subscriptor     INTEGER,
      nr_ordine       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_debitori_owner ON rnpm_debitori(owner_id);
    CREATE INDEX IF NOT EXISTS idx_debitori_aviz ON rnpm_debitori(aviz_id);
    CREATE INDEX IF NOT EXISTS idx_debitori_cod ON rnpm_debitori(cod);
    CREATE INDEX IF NOT EXISTS idx_debitori_denumire ON rnpm_debitori(denumire);

    CREATE TABLE IF NOT EXISTS rnpm_bunuri (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id         TEXT NOT NULL DEFAULT 'local',
      aviz_id          INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
      tip_bun          TEXT NOT NULL,
      categorie        TEXT,
      identificare     TEXT,
      descriere        TEXT,
      model            TEXT,
      serie_sasiu      TEXT,
      serie_motor      TEXT,
      nr_inmatriculare TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bunuri_owner ON rnpm_bunuri(owner_id);
    CREATE INDEX IF NOT EXISTS idx_bunuri_aviz ON rnpm_bunuri(aviz_id);

    CREATE TABLE IF NOT EXISTS rnpm_istoric (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id        TEXT NOT NULL DEFAULT 'local',
      aviz_id         INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
      identificator   TEXT NOT NULL,
      uuid            TEXT NOT NULL,
      data            TEXT NOT NULL,
      tip             TEXT NOT NULL,
      inscriere_m_v   TEXT,
      inscriere_m_k   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_istoric_owner ON rnpm_istoric(owner_id);
    CREATE INDEX IF NOT EXISTS idx_istoric_aviz ON rnpm_istoric(aviz_id);
  `);

  // Migration: add referinte_json column to rnpm_bunuri (idempotent)
  const cols = db.prepare(`PRAGMA table_info(rnpm_bunuri)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "referinte_json")) {
    db.exec(`ALTER TABLE rnpm_bunuri ADD COLUMN referinte_json TEXT`);
  }

  // Migration: add inscriere_initiala_id + inscriere_initiala_uuid to rnpm_avize (idempotent).
  // Populated on avize modificatoare to preserve the link back to the parent aviz.
  const avizeCols = db.prepare(`PRAGMA table_info(rnpm_avize)`).all() as { name: string }[];
  if (!avizeCols.some((c) => c.name === "inscriere_initiala_id")) {
    db.exec(`ALTER TABLE rnpm_avize ADD COLUMN inscriere_initiala_id TEXT`);
  }
  if (!avizeCols.some((c) => c.name === "inscriere_initiala_uuid")) {
    db.exec(`ALTER TABLE rnpm_avize ADD COLUMN inscriere_initiala_uuid TEXT`);
  }
  if (!avizeCols.some((c) => c.name === "inscriere_modificata_id")) {
    db.exec(`ALTER TABLE rnpm_avize ADD COLUMN inscriere_modificata_id TEXT`);
  }
  if (!avizeCols.some((c) => c.name === "inscriere_modificata_uuid")) {
    db.exec(`ALTER TABLE rnpm_avize ADD COLUMN inscriere_modificata_uuid TEXT`);
  }

  // Migration: add subscriptor + nr_ordine to rnpm_creditori / rnpm_debitori (idempotent).
  // subscriptor = boolean flag (whether this party signed the aviz). nr_ordine = RNPM's display order.
  for (const t of ["rnpm_creditori", "rnpm_debitori"] as const) {
    const partyCols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
    if (!partyCols.some((c) => c.name === "subscriptor")) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN subscriptor INTEGER`);
    }
    if (!partyCols.some((c) => c.name === "nr_ordine")) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN nr_ordine INTEGER`);
    }
  }
}

export function closeDb(): void {
  if (db) { db.close(); db = null; }
}
