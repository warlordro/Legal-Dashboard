-- 0001_baseline.up.sql — initial schema captured for the migration framework (PR-0).
--
-- This file represents the full v2.0.10 schema in its FINAL post-ALTER shape:
--   - rnpm_avize:    inscriere_initiala_id/uuid + inscriere_modificata_id/uuid included
--   - rnpm_creditori/rnpm_debitori: subscriptor + nr_ordine included
--   - rnpm_bunuri:   referinte_json + descriere_id included; legacy `descriere` column
--                    intentionally absent (deduped into rnpm_bunuri_descrieri lookup)
--
-- Legacy installs (v2.0.10 and earlier) DO NOT execute this file; the runner backfills
-- _schema_versions(1, '__backfilled_v1__') because the live DB already contains these
-- tables. Fresh DBs (CI, new installs) execute this and store the real sha256 hash.
--
-- Table creation order satisfies foreign-key dependencies under PRAGMA foreign_keys=ON.

CREATE TABLE rnpm_searches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL DEFAULT 'local',
  search_type   TEXT NOT NULL,
  params_json   TEXT NOT NULL,
  total_results INTEGER NOT NULL DEFAULT 0,
  criteriu      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_searches_owner ON rnpm_searches(owner_id);

CREATE TABLE rnpm_avize (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id                 TEXT NOT NULL DEFAULT 'local',
  uuid                     TEXT NOT NULL,
  identificator            TEXT NOT NULL,
  search_type              TEXT NOT NULL,
  tip                      TEXT NOT NULL,
  data                     TEXT NOT NULL,
  utilizator_autorizat     TEXT,
  activ                    INTEGER DEFAULT 1,
  needs_actualizare        INTEGER DEFAULT 0,
  destinatie               TEXT,
  tip_act                  TEXT,
  numar_act                TEXT,
  data_inreg               TEXT,
  data_expirare            TEXT,
  alte_mentiuni            TEXT,
  detalii_comune           TEXT,
  detail_fetched           INTEGER DEFAULT 0,
  search_id                INTEGER REFERENCES rnpm_searches(id) ON DELETE SET NULL,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  inscriere_initiala_id    TEXT,
  inscriere_initiala_uuid  TEXT,
  inscriere_modificata_id  TEXT,
  inscriere_modificata_uuid TEXT,
  UNIQUE(owner_id, identificator)
);
CREATE INDEX idx_avize_owner         ON rnpm_avize(owner_id);
CREATE INDEX idx_avize_identificator ON rnpm_avize(identificator);
CREATE INDEX idx_avize_search_type   ON rnpm_avize(owner_id, search_type);
CREATE INDEX idx_avize_data          ON rnpm_avize(data);

-- Content-addressable lookup for bun descriere texts (~99% dedup vs inline column).
-- Note: no owner_id by design — content-addressable shared lookup (HARDENING.md CM5).
CREATE TABLE rnpm_bunuri_descrieri (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  text  TEXT NOT NULL UNIQUE
);

CREATE TABLE rnpm_creditori (
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
CREATE INDEX idx_creditori_owner ON rnpm_creditori(owner_id);
CREATE INDEX idx_creditori_aviz  ON rnpm_creditori(aviz_id);
CREATE INDEX idx_creditori_cod   ON rnpm_creditori(cod);

CREATE TABLE rnpm_debitori (
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
CREATE INDEX idx_debitori_owner    ON rnpm_debitori(owner_id);
CREATE INDEX idx_debitori_aviz     ON rnpm_debitori(aviz_id);
CREATE INDEX idx_debitori_cod      ON rnpm_debitori(cod);
CREATE INDEX idx_debitori_denumire ON rnpm_debitori(denumire);

CREATE TABLE rnpm_bunuri (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id         TEXT NOT NULL DEFAULT 'local',
  aviz_id          INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
  tip_bun          TEXT NOT NULL,
  categorie        TEXT,
  identificare     TEXT,
  model            TEXT,
  serie_sasiu      TEXT,
  serie_motor      TEXT,
  nr_inmatriculare TEXT,
  referinte_json   TEXT,
  descriere_id     INTEGER REFERENCES rnpm_bunuri_descrieri(id)
);
CREATE INDEX idx_bunuri_owner        ON rnpm_bunuri(owner_id);
CREATE INDEX idx_bunuri_aviz         ON rnpm_bunuri(aviz_id);
CREATE INDEX idx_bunuri_descriere_id ON rnpm_bunuri(descriere_id);

CREATE TABLE rnpm_istoric (
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
CREATE INDEX idx_istoric_owner ON rnpm_istoric(owner_id);
CREATE INDEX idx_istoric_aviz  ON rnpm_istoric(aviz_id);
