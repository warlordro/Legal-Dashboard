-- 0004_runs_fk_on_snapshots_and_alerts.down.sql — manual rollback artifact.
--
-- Not auto-executed by the runner (runner.ts only consumes *.up.sql). Kept as
-- the documented rollback path per CP-9 (every migration owns its inverse).
--
-- DROP COLUMN requires SQLite >= 3.35 (March 2021); better-sqlite3 ships a
-- newer engine on every supported platform, so this is safe in practice. If
-- a rollback ever runs against an older engine it would error before any
-- destructive write — preferable to silently leaving the column behind.
--
-- Order: indexes first, then columns. SQLite drops indexes that reference a
-- column when the column is dropped, but doing it explicitly keeps the
-- intent obvious in code review.

DROP INDEX IF EXISTS idx_alerts_run;
DROP INDEX IF EXISTS idx_snap_run;

ALTER TABLE monitoring_alerts DROP COLUMN run_id;
ALTER TABLE monitoring_snapshots DROP COLUMN run_id;

DELETE FROM _schema_versions WHERE version = 4;
