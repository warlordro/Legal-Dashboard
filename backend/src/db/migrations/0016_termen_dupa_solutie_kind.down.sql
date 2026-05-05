-- 0016_termen_dupa_solutie_kind.down.sql - restore pre-v2.15.0 alert-kind CHECK.
--
-- INTENTIONALLY FAIL-LOUD. Daca exista randuri cu kind='termen_dupa_solutie'
-- in DB, INSERT SELECT-ul de mai jos esueaza pe CHECK constraint, transactia
-- migration runner-ului face ROLLBACK, iar DB-ul ramane pe v0016 — nimic nu
-- se sterge tacit.
--
-- Pentru a face downgrade-ul efectiv, operatorul trebuie EXPLICIT, INAINTE de
-- a porni rollback-ul, sa decida ce face cu alertele compozite:
--
--   (1) Stergere completa (cazul "user-ul nu are nevoie de istoric"):
--       DELETE FROM monitoring_alerts WHERE kind = 'termen_dupa_solutie';
--
--   (2) Conversie back-to-pair (cazul "vrem sa pastram istoricul vizibil pe
--       UI-ul vechi"): scriem doua INSERT-uri manuale (solutie_aparuta +
--       termen_new) extragand from.* / to.* din detail_json al fiecarui
--       compozit, apoi DELETE pe cel original. NU exista script automat
--       pentru asta — runner-ul nostru nu re-scrie alertele istorice.
--
-- Daca un downgrade fortat e necesar fara decizia operatorului, pune un
-- DELETE FROM monitoring_alerts WHERE kind='termen_dupa_solutie'; deasupra
-- DROP INDEX-urilor de mai jos. Asta NU e default — calea sigura e fail-loud.

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
