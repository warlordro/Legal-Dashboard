-- 0009_name_list_item_job_options.up.sql - preserve per-row job options from
-- the XLSX/CSV bulk template.
--
-- PR-5's UI template carries cadence_sec + notes per row. Store them on
-- name_list_items so idempotent /commit replays can continue creating jobs
-- with the same cadence/notes after the original HTTP request has gone away.

ALTER TABLE name_list_items
  ADD COLUMN cadence_sec INTEGER CHECK(cadence_sec IS NULL OR cadence_sec BETWEEN 600 AND 86400);

ALTER TABLE name_list_items
  ADD COLUMN notes TEXT;
