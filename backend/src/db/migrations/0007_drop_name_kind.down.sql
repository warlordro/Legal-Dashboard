-- 0007_drop_name_kind.down.sql — manual rollback artifact (CP-9).
--
-- Reverses 0007 by re-adding `name_kind` cu DEFAULT 'fizic'. Informatia
-- originala (PF vs PJ) e pierduta dupa drop; rollback-ul e doar pentru
-- shape-equivalence cu schema 0006 in scenarii dev/test.

ALTER TABLE name_list_items ADD COLUMN name_kind TEXT NOT NULL DEFAULT 'fizic'
  CHECK(name_kind IN ('fizic','juridic'));

DELETE FROM _schema_versions WHERE version = 7;
