-- 0003_monitoring_core.down.sql — manual rollback artifact for PR-3.
--
-- Not auto-executed by the runner (runner.ts only consumes *.up.sql). Kept as
-- the documented rollback path per CP-9 (every migration owns its inverse).
--
-- Order: indexes first, then tables. Children before parents so FK
-- ON DELETE CASCADE doesn't fire mid-drop on engines stricter than SQLite.

DROP INDEX IF EXISTS idx_runs_job_time;
DROP TABLE IF EXISTS monitoring_runs;

DROP INDEX IF EXISTS idx_alerts_owner_unread;
DROP TABLE IF EXISTS monitoring_alerts;

DROP INDEX IF EXISTS idx_snap_job_time;
DROP TABLE IF EXISTS monitoring_snapshots;

DROP INDEX IF EXISTS idx_monitoring_client_req;
DROP INDEX IF EXISTS idx_monitoring_owner;
DROP INDEX IF EXISTS idx_monitoring_due;
DROP TABLE IF EXISTS monitoring_jobs;

DELETE FROM _schema_versions WHERE version = 3;
