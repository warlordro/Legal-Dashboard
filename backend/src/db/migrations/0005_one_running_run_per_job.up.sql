-- 0005_one_running_run_per_job.up.sql — defense-in-depth pentru status guard
-- pe finalize() (audit 2026-04-29 #10).
--
-- Background. Inainte de aceasta migrare, finalize() facea UPDATE doar dupa
-- id, fara sa verifice status. Un finalizer intarziat (de ex. un finalizer
-- original care soseste dupa un recovery sweep) putea suprascrie o tranzitie
-- terminala deja inregistrata, corupand timeline-ul rulajelor. finalize()
-- adauga acum AND status='running' in clauza WHERE; acest index forteaza la
-- nivel de DB invariantul mai puternic — un singur run `running` per job_id
-- in orice moment.
--
-- Decizie. Index UNIQUE partial pe (job_id) WHERE status='running'. SQLite >=
-- 3.8 (martie 2014) suporta partial indexes; better-sqlite3 ship-uieste >= 3.42
-- pe toate platformele suportate. Constrangerea blocheaza tentativa de a
-- introduce un al doilea run `running` pentru acelasi job (ex: claim
-- duplicate, race manual-trigger), nu doar la finalize ci si la insertRunning.
--
-- Note operationale.
--   * recoverOrphanRuns() ruleaza la boot ca sa marcheze rinduri stale ca
--     `aborted`, deci la momentul aplicarii migrarii nu ar trebui sa existe
--     conflicte. Daca migrarea esueaza pe o instalare cu mai multe rinduri
--     `running` neasteptate, operatorul ruleaza explicit
--     `UPDATE monitoring_runs SET status='aborted' WHERE status='running'`
--     inainte de re-run.
--   * Constrangerea NU acopera kindurile dezactivate prin
--     MONITORING_DISABLED_KINDS — inactiv = nu ruleaza, deci nu se inregistreaza
--     rinduri `running`.

CREATE UNIQUE INDEX idx_one_running_per_job
  ON monitoring_runs(job_id)
  WHERE status = 'running';
