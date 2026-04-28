-- 0004_runs_fk_on_snapshots_and_alerts.up.sql — link snapshots & alerts to the run that produced them.
--
-- Background. PR-3 schema (0003) related monitoring_snapshots and
-- monitoring_alerts to monitoring_jobs only. Forensic queries ("which run
-- emitted this alert?", "which snapshot did THIS run write?") had to fall
-- back on `job_id + created_at` proximity against monitoring_runs.started_at,
-- which is fragile (multiple runs in flight, manual-trigger reruns, retention
-- sweeps). /full-review #9 flagged the missing FK as a HIGH severity gap that
-- should land before PR-9 (web mode) makes the table public to multiple users.
--
-- Decision. Add `run_id INTEGER REFERENCES monitoring_runs(id) ON DELETE SET NULL`
-- on both tables (nullable so the column can be backfilled lazily — historical
-- rows from PR-3/PR-4 stay legal under the new schema). Index it so the
-- forensic query path ("snapshots/alerts for this run id") doesn't full-scan.
--
-- SQLite specifics that drove the form below:
--   * `PRAGMA foreign_keys = ON` is set in schema.ts:53 BEFORE the runner
--     fires, so the new constraint enforces on subsequent INSERTs.
--   * `ALTER TABLE ... ADD COLUMN ... REFERENCES ...` is allowed under
--     foreign_keys=ON only when the new column has a NULL default; we omit
--     DEFAULT entirely, so it defaults to NULL and the migration succeeds.
--   * No data migration: existing rows keep run_id=NULL (best-effort lineage).
--     PR-9 won't depend on backfill — the diff/runner code will simply start
--     populating run_id on every new write from this commit forward.
--   * Indexes are non-partial (covering NULL too) because SQLite uses them
--     for `WHERE run_id = ?` and we never filter on run_id IS NULL.

ALTER TABLE monitoring_snapshots
  ADD COLUMN run_id INTEGER REFERENCES monitoring_runs(id) ON DELETE SET NULL;

ALTER TABLE monitoring_alerts
  ADD COLUMN run_id INTEGER REFERENCES monitoring_runs(id) ON DELETE SET NULL;

CREATE INDEX idx_snap_run ON monitoring_snapshots(run_id);
CREATE INDEX idx_alerts_run ON monitoring_alerts(run_id);
