-- 0006_name_lists.down.sql — manual rollback artifact.
--
-- Not auto-executed by the runner (runner.ts only consumes *.up.sql). Kept
-- per CP-9 — every migration owns its inverse.
--
-- Ordinea importanta: drop FK invers din monitoring_jobs INAINTE de drop
-- name_lists, altfel SQLite refuza din cauza foreign_keys=ON. Apoi items
-- inainte de lists pentru acelasi motiv.

DROP INDEX IF EXISTS idx_mj_name_list;
ALTER TABLE monitoring_jobs DROP COLUMN name_list_id;

DROP INDEX IF EXISTS idx_nli_job;
DROP INDEX IF EXISTS idx_nli_norm;
DROP INDEX IF EXISTS idx_nli_owner_list;
DROP TABLE IF EXISTS name_list_items;

DROP INDEX IF EXISTS idx_name_lists_owner;
DROP TABLE IF EXISTS name_lists;

DELETE FROM _schema_versions WHERE version = 6;
