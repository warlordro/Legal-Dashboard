-- 0019_idx_monitoring_runs_started_at.down.sql - rollback index.
DROP INDEX IF EXISTS idx_monitoring_runs_started_at;
DELETE FROM _schema_versions WHERE version = 19;
