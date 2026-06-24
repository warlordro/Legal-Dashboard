-- 0018_source_partial_kind.up.sql - v2.20.8 Batch 2.1: add 'source_partial' alert kind.
--
-- nameSoapRunner.fetchForTarget loops peste mai multe institutii cand target-ul are
-- `institutie: string[]`. Inainte de v2.20.8 cazul de partial-success (ex. 4/5
-- institutii reusite, 1 esuata) ramanea doar in `console.warn` — operatorul vede
-- diff-ul corect partial dar nu stie ca o institutie a esuat (silent gap in
-- monitoring). Adaugam `source_partial` ca alert kind distinct fata de
-- `source_error` (care ramane pentru cazul "all institutions failed").
--
-- SQLite nu permite ALTER pe CHECK, deci pattern-ul cunoscut: rebuild de tabela cu
-- pastrare integrala a randurilor existente. Trigger-uit prin pre-migration backup
-- automat (vezi schema.ts:88) la urcare.

DROP INDEX IF EXISTS idx_alerts_owner_unread;
DROP INDEX IF EXISTS idx_alerts_run;

ALTER TABLE monitoring_alerts RENAME TO monitoring_alerts_old;

CREATE TABLE monitoring_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  job_id        INTEGER NOT NULL REFERENCES monitoring_jobs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                CHECK(kind IN (
                  'dosar_new','termen_new','termen_changed','termen_dupa_solutie',
                  'solutie_aparuta','dosar_disappeared','stadiu_changed',
                  'categorie_changed','dosar_relevant_now','dosar_no_longer_relevant',
                  'aviz_changed','source_error','source_partial'
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
FROM monitoring_alerts_old;

DROP TABLE monitoring_alerts_old;

CREATE INDEX idx_alerts_owner_unread
  ON monitoring_alerts(owner_id, read_at, created_at DESC);
CREATE INDEX idx_alerts_run ON monitoring_alerts(run_id);
