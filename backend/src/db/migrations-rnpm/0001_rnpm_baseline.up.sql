-- 0001_rnpm_baseline.up.sql — baseline consolidat pentru fisierele RNPM per user (v2.43.0).
-- Compus din migrations monolit: 0001 (tabele rnpm), 0021 (index owner+search), 0022 (_norm + triggere).
-- Coloanele _norm sunt inline in CREATE TABLE (fisier nou = zero randuri de backfill).
-- ATENTIE: trigger-ele apeleaza UDF-ul rnpm_norm() — conexiunea care ruleaza aceasta migration
-- TREBUIE sa aiba UDF-ul inregistrat INAINTE de runMigrations (vezi registerRnpmNorm in rnpmDb.ts).

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
  identificator_norm        TEXT,
  tip_norm                  TEXT,
  utilizator_autorizat_norm TEXT,
  numar_act_norm            TEXT,
  tip_act_norm              TEXT,
  alte_mentiuni_norm        TEXT,
  detalii_comune_norm       TEXT,
  inscriere_initiala_id_norm  TEXT,
  inscriere_modificata_id_norm TEXT,
  UNIQUE(owner_id, identificator)
);
CREATE INDEX idx_avize_owner         ON rnpm_avize(owner_id);
CREATE INDEX idx_avize_identificator ON rnpm_avize(identificator);
CREATE INDEX idx_avize_search_type   ON rnpm_avize(owner_id, search_type);
CREATE INDEX idx_avize_data          ON rnpm_avize(data);
CREATE INDEX idx_rnpm_avize_owner_search ON rnpm_avize(owner_id, search_id);

-- Lookup dedup pentru texte descriere bunuri. In fisierul per-user NU mai e partajat
-- intre useri (fiecare fisier are copia proprie), dar pastreaza aceeasi forma ca sa nu
-- se schimbe niciun query din avizRepository.
CREATE TABLE rnpm_bunuri_descrieri (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  text      TEXT NOT NULL UNIQUE,
  text_norm TEXT
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
  nr_ordine       INTEGER,
  denumire_norm   TEXT,
  cod_norm        TEXT,
  cnp_norm        TEXT
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
  nr_ordine       INTEGER,
  denumire_norm   TEXT,
  cod_norm        TEXT,
  cnp_norm        TEXT
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
  descriere_id     INTEGER REFERENCES rnpm_bunuri_descrieri(id),
  tip_bun_norm          TEXT,
  categorie_norm        TEXT,
  identificare_norm     TEXT,
  model_norm            TEXT,
  serie_sasiu_norm      TEXT,
  serie_motor_norm      TEXT,
  nr_inmatriculare_norm TEXT,
  referinte_json_norm   TEXT
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

CREATE TRIGGER trg_rnpm_avize_norm_ins
AFTER INSERT ON rnpm_avize
BEGIN
  UPDATE rnpm_avize SET
    identificator_norm = rnpm_norm(NEW.identificator),
    tip_norm = rnpm_norm(NEW.tip),
    utilizator_autorizat_norm = rnpm_norm(NEW.utilizator_autorizat),
    numar_act_norm = rnpm_norm(NEW.numar_act),
    tip_act_norm = rnpm_norm(NEW.tip_act),
    alte_mentiuni_norm = rnpm_norm(NEW.alte_mentiuni),
    detalii_comune_norm = rnpm_norm(NEW.detalii_comune),
    inscriere_initiala_id_norm = rnpm_norm(NEW.inscriere_initiala_id),
    inscriere_modificata_id_norm = rnpm_norm(NEW.inscriere_modificata_id)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_avize_norm_upd
AFTER UPDATE OF
  identificator, tip, utilizator_autorizat, numar_act, tip_act,
  alte_mentiuni, detalii_comune, inscriere_initiala_id, inscriere_modificata_id
ON rnpm_avize
BEGIN
  UPDATE rnpm_avize SET
    identificator_norm = rnpm_norm(NEW.identificator),
    tip_norm = rnpm_norm(NEW.tip),
    utilizator_autorizat_norm = rnpm_norm(NEW.utilizator_autorizat),
    numar_act_norm = rnpm_norm(NEW.numar_act),
    tip_act_norm = rnpm_norm(NEW.tip_act),
    alte_mentiuni_norm = rnpm_norm(NEW.alte_mentiuni),
    detalii_comune_norm = rnpm_norm(NEW.detalii_comune),
    inscriere_initiala_id_norm = rnpm_norm(NEW.inscriere_initiala_id),
    inscriere_modificata_id_norm = rnpm_norm(NEW.inscriere_modificata_id)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_creditori_norm_ins
AFTER INSERT ON rnpm_creditori
BEGIN
  UPDATE rnpm_creditori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_creditori_norm_upd
AFTER UPDATE OF denumire, cod, cnp ON rnpm_creditori
BEGIN
  UPDATE rnpm_creditori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_debitori_norm_ins
AFTER INSERT ON rnpm_debitori
BEGIN
  UPDATE rnpm_debitori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_debitori_norm_upd
AFTER UPDATE OF denumire, cod, cnp ON rnpm_debitori
BEGIN
  UPDATE rnpm_debitori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_bunuri_norm_ins
AFTER INSERT ON rnpm_bunuri
BEGIN
  UPDATE rnpm_bunuri SET
    tip_bun_norm = rnpm_norm(NEW.tip_bun),
    categorie_norm = rnpm_norm(NEW.categorie),
    identificare_norm = rnpm_norm(NEW.identificare),
    model_norm = rnpm_norm(NEW.model),
    serie_sasiu_norm = rnpm_norm(NEW.serie_sasiu),
    serie_motor_norm = rnpm_norm(NEW.serie_motor),
    nr_inmatriculare_norm = rnpm_norm(NEW.nr_inmatriculare),
    referinte_json_norm = rnpm_norm(NEW.referinte_json)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_bunuri_norm_upd
AFTER UPDATE OF
  tip_bun, categorie, identificare, model, serie_sasiu, serie_motor,
  nr_inmatriculare, referinte_json
ON rnpm_bunuri
BEGIN
  UPDATE rnpm_bunuri SET
    tip_bun_norm = rnpm_norm(NEW.tip_bun),
    categorie_norm = rnpm_norm(NEW.categorie),
    identificare_norm = rnpm_norm(NEW.identificare),
    model_norm = rnpm_norm(NEW.model),
    serie_sasiu_norm = rnpm_norm(NEW.serie_sasiu),
    serie_motor_norm = rnpm_norm(NEW.serie_motor),
    nr_inmatriculare_norm = rnpm_norm(NEW.nr_inmatriculare),
    referinte_json_norm = rnpm_norm(NEW.referinte_json)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_bunuri_descrieri_norm_ins
AFTER INSERT ON rnpm_bunuri_descrieri
BEGIN
  UPDATE rnpm_bunuri_descrieri SET
    text_norm = rnpm_norm(NEW.text)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_bunuri_descrieri_norm_upd
AFTER UPDATE OF text ON rnpm_bunuri_descrieri
BEGIN
  UPDATE rnpm_bunuri_descrieri SET
    text_norm = rnpm_norm(NEW.text)
  WHERE id = NEW.id;
END;
