-- 0009_name_list_item_job_options.down.sql - remove per-row job options.

ALTER TABLE name_list_items DROP COLUMN notes;
ALTER TABLE name_list_items DROP COLUMN cadence_sec;
