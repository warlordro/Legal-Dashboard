-- 0018_source_partial_kind.down.sql - restore pre-v2.20.8 alert-kind CHECK.
--
-- INTENTIONALLY FAIL-LOUD: daca exista randuri cu kind='source_partial' in DB,
-- INSERT SELECT-ul de mai jos esueaza pe CHECK constraint, transactia runner-ului
-- face ROLLBACK, iar DB-ul ramane pe v0018. Nimic nu se sterge tacit. Operatorul
-- care vrea sa faca downgrade-ul efectiv trebuie sa decida explicit:
--
--   (1) Stergere completa:
--       DELETE FROM monitoring_alerts WHERE kind = 'source_partial';
--
--   (2) Convertire la 'source_error' (pierde nuanta "partial"):
--       UPDATE monitoring_alerts SET kind = 'source_error' WHERE kind = 'source_partial';

DROP INDEX IF EXISTS idx_alerts_owner_unread;
DROP INDEX IF EXISTS idx_alerts_run;

ALTER TABLE monitoring_alerts RENAME TO monitoring_alerts_newer;

CREATE TABLE monitoring_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  job_id        INTEGER NOT NULL REFERENCES monitoring_jobs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                CHECK(kind IN (
                  'dosar_new','termen_new','termen_changed','termen_dupa_solutie',
                  'solutie_aparuta','dosar_disappeared','stadiu_changed',
                  'categorie_changed','dosar_relevant_now','dosar_no_longer_relevant',
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
