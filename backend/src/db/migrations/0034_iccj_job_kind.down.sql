-- migrate:foreign_keys=off
-- 0034_iccj_job_kind.down.sql — revert the 'iccj' kind from monitoring_jobs.
--
-- Rebuilds monitoring_jobs with the original 3-kind CHECK using the same
-- foreign_keys=OFF parent-rebuild procedure as the up. Any existing kind='iccj'
-- rows must be removed first (they would violate the restored CHECK on copy) —
-- fail loud rather than silently drop monitored jobs.

DROP INDEX IF EXISTS idx_monitoring_due;
DROP INDEX IF EXISTS idx_monitoring_owner;
DROP INDEX IF EXISTS idx_monitoring_client_req;
DROP INDEX IF EXISTS idx_mj_name_list;

CREATE TABLE monitoring_jobs_new (
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

-- v2.37.1: rollback-ul trebuie sa stearga si randul de versiune, altfel
-- runner-ul crede ca migratia e inca aplicata si nu o re-ruleaza la upgrade.
-- CREATE-ul defensiv face down-ul rulabil standalone (DB-uri de test/sintetice
-- fara jurnal); pe un DB real tabela exista deja si linia e no-op.
CREATE TABLE IF NOT EXISTS _schema_versions (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  sha256_up  TEXT NOT NULL
);
DELETE FROM _schema_versions WHERE version = 34;
