-- 0012_monitoring_runs_alerts_patched.down.sql - manual rollback artifact.
--
-- Not auto-executed by the runner (runner.ts only consumes *.up.sql). Kept
-- per CP-9 — every migration owns its inverse. SQLite 3.35+ supports DROP
-- COLUMN directly; we use a table rebuild to remain safe under older runtimes
-- that better-sqlite3 may bundle.

BEGIN TRANSACTION;

CREATE TABLE monitoring_runs_tmp (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id       TEXT NOT NULL,
  job_id         INTEGER NOT NULL REFERENCES monitoring_jobs(id) ON DELETE CASCADE,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  status         TEXT NOT NULL CHECK(status IN ('running','ok','error','timeout','aborted')),
  http_status    INTEGER,
  error_code     TEXT,
  error_message  TEXT,
  alerts_created INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER
);

INSERT INTO monitoring_runs_tmp
  (id, owner_id, job_id, started_at, ended_at, status, http_status,
   error_code, error_message, alerts_created, duration_ms)
SELECT
  id, owner_id, job_id, started_at, ended_at, status, http_status,
  error_code, error_message, alerts_created, duration_ms
FROM monitoring_runs;

DROP TABLE monitoring_runs;
ALTER TABLE monitoring_runs_tmp RENAME TO monitoring_runs;

CREATE INDEX idx_runs_job_time ON monitoring_runs(job_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_running_per_job
  ON monitoring_runs(job_id) WHERE status = 'running';

DELETE FROM _schema_versions WHERE version = 12;

COMMIT;
