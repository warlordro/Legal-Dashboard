-- 0005_one_running_run_per_job.down.sql — manual rollback artifact.
--
-- Not auto-executed by the runner (runner.ts only consumes *.up.sql). Kept
-- per CP-9 — every migration owns its inverse.

DROP INDEX IF EXISTS idx_one_running_per_job;

DELETE FROM _schema_versions WHERE version = 5;
