-- 0020_master_switch.down.sql
DROP INDEX IF EXISTS idx_owner_monitoring_disabled;
DROP TABLE IF EXISTS owner_monitoring_settings;
DELETE FROM _schema_versions WHERE version = 20;
