-- 0022_rnpm_norm_columns.up.sql
--
-- Persistate copii normalizate (rnpm_norm = stripDiacritics + lowercase) ale coloanelor
-- folosite de filtrul textual RNPM. Apelul UDF `rnpm_norm()` pe fiecare LIKE producea ~8s
-- pe 148 randuri × 24 coloane × N tokens; cu coloane materializate filtrul devine un
-- LIKE simplu pe TEXT existent in pagina, fara cost de functie per scan.
--
-- Backfill-ul randurilor existente NU se face aici (UDF nu e garantat sa fie inregistrat
-- pe conexiunea care ruleaza migration-ul in teste). Backfill-ul ruleaza in schema.ts
-- imediat dupa runMigrations, pe conexiunea principala unde rnpm_norm() e registrat.
--
-- Triger-ele folosesc `AFTER UPDATE OF <source-cols>` ca sa nu fie reapelate cand
-- propria lor instructiune UPDATE scrie inapoi in `*_norm` (coloanele _norm nu apar in
-- lista UPDATE OF). Astfel siguranta vs recursivitate e independenta de PRAGMA recursive_triggers.

ALTER TABLE rnpm_avize ADD COLUMN identificator_norm TEXT;
ALTER TABLE rnpm_avize ADD COLUMN tip_norm TEXT;
ALTER TABLE rnpm_avize ADD COLUMN utilizator_autorizat_norm TEXT;
ALTER TABLE rnpm_avize ADD COLUMN numar_act_norm TEXT;
ALTER TABLE rnpm_avize ADD COLUMN tip_act_norm TEXT;
ALTER TABLE rnpm_avize ADD COLUMN alte_mentiuni_norm TEXT;
ALTER TABLE rnpm_avize ADD COLUMN detalii_comune_norm TEXT;
ALTER TABLE rnpm_avize ADD COLUMN inscriere_initiala_id_norm TEXT;
ALTER TABLE rnpm_avize ADD COLUMN inscriere_modificata_id_norm TEXT;

ALTER TABLE rnpm_creditori ADD COLUMN denumire_norm TEXT;
ALTER TABLE rnpm_creditori ADD COLUMN cod_norm TEXT;
ALTER TABLE rnpm_creditori ADD COLUMN cnp_norm TEXT;

ALTER TABLE rnpm_debitori ADD COLUMN denumire_norm TEXT;
ALTER TABLE rnpm_debitori ADD COLUMN cod_norm TEXT;
ALTER TABLE rnpm_debitori ADD COLUMN cnp_norm TEXT;

ALTER TABLE rnpm_bunuri ADD COLUMN tip_bun_norm TEXT;
ALTER TABLE rnpm_bunuri ADD COLUMN categorie_norm TEXT;
ALTER TABLE rnpm_bunuri ADD COLUMN identificare_norm TEXT;
ALTER TABLE rnpm_bunuri ADD COLUMN model_norm TEXT;
ALTER TABLE rnpm_bunuri ADD COLUMN serie_sasiu_norm TEXT;
ALTER TABLE rnpm_bunuri ADD COLUMN serie_motor_norm TEXT;
ALTER TABLE rnpm_bunuri ADD COLUMN nr_inmatriculare_norm TEXT;
ALTER TABLE rnpm_bunuri ADD COLUMN referinte_json_norm TEXT;

ALTER TABLE rnpm_bunuri_descrieri ADD COLUMN text_norm TEXT;

CREATE TRIGGER IF NOT EXISTS trg_rnpm_avize_norm_ins
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

CREATE TRIGGER IF NOT EXISTS trg_rnpm_avize_norm_upd
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

CREATE TRIGGER IF NOT EXISTS trg_rnpm_creditori_norm_ins
AFTER INSERT ON rnpm_creditori
BEGIN
  UPDATE rnpm_creditori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_rnpm_creditori_norm_upd
AFTER UPDATE OF denumire, cod, cnp ON rnpm_creditori
BEGIN
  UPDATE rnpm_creditori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_rnpm_debitori_norm_ins
AFTER INSERT ON rnpm_debitori
BEGIN
  UPDATE rnpm_debitori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_rnpm_debitori_norm_upd
AFTER UPDATE OF denumire, cod, cnp ON rnpm_debitori
BEGIN
  UPDATE rnpm_debitori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_rnpm_bunuri_norm_ins
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

CREATE TRIGGER IF NOT EXISTS trg_rnpm_bunuri_norm_upd
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

CREATE TRIGGER IF NOT EXISTS trg_rnpm_bunuri_descrieri_norm_ins
AFTER INSERT ON rnpm_bunuri_descrieri
BEGIN
  UPDATE rnpm_bunuri_descrieri SET
    text_norm = rnpm_norm(NEW.text)
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_rnpm_bunuri_descrieri_norm_upd
AFTER UPDATE OF text ON rnpm_bunuri_descrieri
BEGIN
  UPDATE rnpm_bunuri_descrieri SET
    text_norm = rnpm_norm(NEW.text)
  WHERE id = NEW.id;
END;
