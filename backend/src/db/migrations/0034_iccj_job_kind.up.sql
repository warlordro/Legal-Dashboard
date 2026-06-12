-- migrate:foreign_keys=off
-- 0034_iccj_job_kind.up.sql — add 'iccj' to monitoring_jobs.kind CHECK.
--
-- Enables monitoring of Inalta Curte (ICCJ / scj.ro) dosare via the live-proxy
-- runner (kind='iccj'). SQLite cannot ALTER a CHECK in place, so monitoring_jobs
-- is rebuilt.
--
-- monitoring_jobs is a PARENT table: monitoring_snapshots / monitoring_runs /
-- monitoring_alerts (job_id ... ON DELETE CASCADE) and name_lists
-- (monitoring_job_id ... ON DELETE SET NULL) reference it. The rebuild therefore
-- uses the SQLite-canonical "create new / copy / DROP original-by-name / RENAME
-- new to original" order under foreign_keys=OFF (declared via the marker on
-- line 1, which the runner toggles AROUND its transaction — foreign_keys is a
-- no-op inside one). Dropping the ORIGINAL name (not a renamed _old) means child
-- FK references — which point at the name "monitoring_jobs" — are never rewritten
-- and re-bind to the rebuilt table after the RENAME. The runner runs
-- foreign_key_check before commit, so any dangling reference fails loud.
-- Pre-migration backup (schema-upgrade) fires on rebuild (schema.ts).

DROP INDEX IF EXISTS idx_monitoring_due;
DROP INDEX IF EXISTS idx_monitoring_owner;
DROP INDEX IF EXISTS idx_monitoring_client_req;
DROP INDEX IF EXISTS idx_mj_name_list;

CREATE TABLE monitoring_jobs_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id           TEXT NOT NULL,
  kind               TEXT NOT NULL
                     CHECK(kind IN ('dosar_soap','name_soap','aviz_rnpm','iccj')),
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
  name_list_id       INTEGER REFERENCES name_lists(id) ON DELETE RESTRICT,
  UNIQUE(owner_id, target_hash, kind)
);

INSERT INTO monitoring_jobs_new
  (id, owner_id, kind, target_json, target_hash, cadence_sec, active, paused_until,
   alert_config_json, next_run_at, last_run_at, last_status, fail_streak, notes,
   client_request_id, created_at, updated_at, name_list_id)
SELECT
  id, owner_id, kind, target_json, target_hash, cadence_sec, active, paused_until,
  alert_config_json, next_run_at, last_run_at, last_status, fail_streak, notes,
  client_request_id, created_at, updated_at, name_list_id
FROM monitoring_jobs;

DROP TABLE monitoring_jobs;
ALTER TABLE monitoring_jobs_new RENAME TO monitoring_jobs;

CREATE INDEX idx_monitoring_due
  ON monitoring_jobs(next_run_at)
  WHERE active = 1;
CREATE INDEX idx_monitoring_owner ON monitoring_jobs(owner_id, kind);
CREATE UNIQUE INDEX idx_monitoring_client_req
  ON monitoring_jobs(owner_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX idx_mj_name_list ON monitoring_jobs(name_list_id) WHERE name_list_id IS NOT NULL;
