-- 0016_termen_dupa_solutie_kind.down.sql - restore pre-v2.15.0 alert-kind CHECK.
-- Daca exista randuri cu kind='termen_dupa_solutie' in DB, CHECK-ul vechi le
-- respinge si tranzactia esueaza. Operatorul trebuie sa decida explicit:
-- (1) sterge alertele compozite, sau (2) le converteste manual in
-- (solutie_aparuta + termen_new) inainte de rollback.

DROP INDEX IF EXISTS idx_alerts_owner_unread;
DROP INDEX IF EXISTS idx_alerts_run;

ALTER TABLE monitoring_alerts RENAME TO monitoring_alerts_newer;

CREATE TABLE monitoring_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  job_id        INTEGER NOT NULL REFERENCES monitoring_jobs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                CHECK(kind IN (
                  'dosar_new','termen_new','termen_changed','solutie_aparuta',
                  'dosar_disappeared','stadiu_changed','categorie_changed',
                  'dosar_relevant_now','dosar_no_longer_relevant',
                  'aviz_changed','source_error'
                )),
  severity      TEXT NOT NULL DEFAULT 'info'
                CHECK(severity IN ('info','warning','critical')),
  title         TEXT NOT NULL,
  detail_json   TEXT NOT NULL DEFAULT '{}',
  dedup_key     TEXT NOT NULL,
  is_new        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at       TEXT,
  dismissed_at  TEXT,
  run_id        INTEGER REFERENCES monitoring_runs(id) ON DELETE SET NULL,
  UNIQUE(job_id, dedup_key)
);

INSERT INTO monitoring_alerts
  (id, owner_id, job_id, kind, severity, title, detail_json, dedup_key,
   is_new, created_at, read_at, dismissed_at, run_id)
SELECT
  id, owner_id, job_id, kind, severity, title, detail_json, dedup_key,
  is_new, created_at, read_at, dismissed_at, run_id
FROM monitoring_alerts_newer;

DROP TABLE monitoring_alerts_newer;

CREATE INDEX idx_alerts_owner_unread
  ON monitoring_alerts(owner_id, read_at, created_at DESC);
CREATE INDEX idx_alerts_run ON monitoring_alerts(run_id);
