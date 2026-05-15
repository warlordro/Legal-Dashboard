-- 0022_rnpm_norm_columns.down.sql
-- DROP TRIGGER + ALTER TABLE DROP COLUMN (SQLite 3.35+).
-- IF EXISTS pe DROP TRIGGER pentru idempotenta.

DROP TRIGGER IF EXISTS trg_rnpm_bunuri_descrieri_norm_upd;
DROP TRIGGER IF EXISTS trg_rnpm_bunuri_descrieri_norm_ins;
DROP TRIGGER IF EXISTS trg_rnpm_bunuri_norm_upd;
DROP TRIGGER IF EXISTS trg_rnpm_bunuri_norm_ins;
DROP TRIGGER IF EXISTS trg_rnpm_debitori_norm_upd;
DROP TRIGGER IF EXISTS trg_rnpm_debitori_norm_ins;
DROP TRIGGER IF EXISTS trg_rnpm_creditori_norm_upd;
DROP TRIGGER IF EXISTS trg_rnpm_creditori_norm_ins;
DROP TRIGGER IF EXISTS trg_rnpm_avize_norm_upd;
DROP TRIGGER IF EXISTS trg_rnpm_avize_norm_ins;

ALTER TABLE rnpm_bunuri_descrieri DROP COLUMN text_norm;

ALTER TABLE rnpm_bunuri DROP COLUMN referinte_json_norm;
ALTER TABLE rnpm_bunuri DROP COLUMN nr_inmatriculare_norm;
ALTER TABLE rnpm_bunuri DROP COLUMN serie_motor_norm;
ALTER TABLE rnpm_bunuri DROP COLUMN serie_sasiu_norm;
ALTER TABLE rnpm_bunuri DROP COLUMN model_norm;
ALTER TABLE rnpm_bunuri DROP COLUMN identificare_norm;
ALTER TABLE rnpm_bunuri DROP COLUMN categorie_norm;
ALTER TABLE rnpm_bunuri DROP COLUMN tip_bun_norm;

ALTER TABLE rnpm_debitori DROP COLUMN cnp_norm;
ALTER TABLE rnpm_debitori DROP COLUMN cod_norm;
ALTER TABLE rnpm_debitori DROP COLUMN denumire_norm;

ALTER TABLE rnpm_creditori DROP COLUMN cnp_norm;
ALTER TABLE rnpm_creditori DROP COLUMN cod_norm;
ALTER TABLE rnpm_creditori DROP COLUMN denumire_norm;

ALTER TABLE rnpm_avize DROP COLUMN inscriere_modificata_id_norm;
ALTER TABLE rnpm_avize DROP COLUMN inscriere_initiala_id_norm;
ALTER TABLE rnpm_avize DROP COLUMN detalii_comune_norm;
ALTER TABLE rnpm_avize DROP COLUMN alte_mentiuni_norm;
ALTER TABLE rnpm_avize DROP COLUMN tip_act_norm;
ALTER TABLE rnpm_avize DROP COLUMN numar_act_norm;
ALTER TABLE rnpm_avize DROP COLUMN utilizator_autorizat_norm;
ALTER TABLE rnpm_avize DROP COLUMN tip_norm;
ALTER TABLE rnpm_avize DROP COLUMN identificator_norm;
