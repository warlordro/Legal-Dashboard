-- 0003_monitoring_core.up.sql — core monitoring schema (PR-3).
--
-- Adds 4 tables that power continuous monitoring of court cases & RNPM avize:
--   - monitoring_jobs       (persistent watch request: dosar / name / aviz)
--   - monitoring_snapshots  (last observed payload mirror per job, for diff)
--   - monitoring_alerts     (events derived from diff or appearance)
--   - monitoring_runs       (per-run audit/debug rows for the scheduler)
--
-- See PLAN-monitoring-webmode.md §2.2 for the canonical DDL spec; this file
-- mirrors it line-for-line. Validation of JSON columns is enforced at the
-- route layer with Zod, NOT via SQLite `json_valid` CHECK constraints (per
-- PLAN §2.2 header decision — keeps drift recovery cheap).
--
-- owner_id is TEXT NOT NULL on every table; populated today by getOwnerId(c)
-- which returns "local" on desktop. PR-9 (web mode) flips that helper to
-- return the JWT-derived user id with no schema change required.
--
-- The scheduler in PR-4 pulls due jobs via the partial index idx_monitoring_due
-- so paused/inactive jobs never enter a full table scan. UNIQUE(owner_id,
-- target_hash, kind) on monitoring_jobs prevents duplicate watches per user.
-- UNIQUE(job_id, dedup_key) on monitoring_alerts is the idempotency anchor for
-- the diff engine (re-running the same diff must not double-emit alerts).

CREATE TABLE monitoring_jobs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id           TEXT NOT NULL,
  kind               TEXT NOT NULL
                     CHECK(kind IN ('dosar_soap','name_soap','aviz_rnpm')),
  target_json        TEXT NOT NULL,
  target_hash        TEXT NOT NULL,
  cadence_sec        INTEGER NOT NULL DEFAULT 14400
                     CHECK(cadence_sec BETWEEN 600 AND 86400),
  active             INTEGER NOT NULL DEFAULT 1,
  paused_until       TEXT,
  alert_config_json  TEXT NOT NULL DEFAULT '{}',
  next_run_at        TEXT NOT NULL,
  last_run_at        TEXT,
  last_status        TEXT CHECK(last_status IN ('ok','error','partial','skipped')),
  fail_streak        INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  client_request_id  TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(owner_id, target_hash, kind)
);

-- Partial index for the scheduler's "due jobs" query. We deliberately omit a
-- `paused_until <= datetime('now')` predicate: SQLite freezes the value of
-- `datetime('now')` at index-creation time, which would silently exclude rows
-- that pause-then-unpause from ever appearing in the index again. Instead the
-- scheduler filters paused_until at query time; the index narrows to active
-- rows only, which is enough to keep the scan tight.
CREATE INDEX idx_monitoring_due
  ON monitoring_jobs(next_run_at)
  WHERE active = 1;

CREATE INDEX idx_monitoring_owner ON monitoring_jobs(owner_id, kind);

CREATE UNIQUE INDEX idx_monitoring_client_req
  ON monitoring_jobs(owner_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE monitoring_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  job_id        INTEGER NOT NULL REFERENCES monitoring_jobs(id) ON DELETE CASCADE,
  observed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  payload_hash  TEXT NOT NULL,
  payload_json  TEXT NOT NULL
);
CREATE INDEX idx_snap_job_time ON monitoring_snapshots(job_id, observed_at DESC);

CREATE TABLE monitoring_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  job_id        INTEGER NOT NULL REFERENCES monitoring_jobs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                CHECK(kind IN ('dosar_new','termen_new','termen_changed','solutie_aparuta','dosar_disappeared','aviz_changed','source_error')),
  severity      TEXT NOT NULL DEFAULT 'info'
                CHECK(severity IN ('info','warning','critical')),
  title         TEXT NOT NULL,
  detail_json   TEXT NOT NULL DEFAULT '{}',
  dedup_key     TEXT NOT NULL,
  is_new        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at       TEXT,
  dismissed_at  TEXT,
  UNIQUE(job_id, dedup_key)
);
CREATE INDEX idx_alerts_owner_unread ON monitoring_alerts(owner_id, read_at, created_at DESC);

CREATE TABLE monitoring_runs (
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
CREATE INDEX idx_runs_job_time ON monitoring_runs(job_id, started_at DESC);
