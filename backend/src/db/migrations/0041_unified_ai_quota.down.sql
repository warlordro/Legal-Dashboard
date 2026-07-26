-- Down pragmatic (ghid 10.2): sterge notificarile 'ai' si versiunea 41.
--
-- OVERRIDE-URI: se recreeaza ai.single + ai.multi cu ACEEASI limita din 'ai'.
-- Duplicarea e SIGURA aici: cheia primara e (user_id, feature), iar up.sql alege UN
-- singur rand (cel mai restrictiv, prin NOT EXISTS + subselect pe rowid), nu aduna.
--
-- GRANTURI: se muta DOAR pe ai.single. Duplicarea lor pe ambele feature-uri, cum se
-- facea inainte, dubla bugetul la fiecare ciclu down->up (x2^N): up.sql colapseaza
-- ambele inapoi in 'ai', extra-ul se aduna per grant, iar copia era identica pe toate
-- coloanele in afara de id, deci indistinctibila. Vezi migration0041Rollback.test.ts.
--
-- NU "repara" asta inapoi spre duplicare: pierderea de functionalitate la rollback
-- (analiza multi ramane fara extra) e compromisul ales DELIBERAT, fiindca alternativa
-- e o dublare tacuta si necorectabila — up.sql e imuabil dupa aplicare (hash in
-- _schema_versions), deci nu poate curata copiile.
INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
SELECT user_id, 'ai.single', period, limit_usd_milli, updated_at, updated_by
FROM user_quota_overrides WHERE feature = 'ai';
INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
SELECT user_id, 'ai.multi', period, limit_usd_milli, updated_at, updated_by
FROM user_quota_overrides WHERE feature = 'ai';
DELETE FROM user_quota_overrides WHERE feature = 'ai';

-- CodeRabbit 1.1: down-ul insera aici o copie 'ai.multi' a fiecarui grant 'ai', pe
-- langa redenumirea originalului in 'ai.single'. Cum up.sql colapseaza AMBELE inapoi
-- in 'ai' iar extra-ul se aduna per grant, un ciclu down->up dubla bugetul fiecarui
-- user (N cicluri: x2^N). Copia era identica pe toate coloanele in afara de id, deci
-- up-ul nu avea cum sa o distinga de un grant real.
--
-- Fixul sta AICI, nu in up.sql: runner-ul trateaza fisierele .up.sql ca imuabile dupa
-- aplicare (hash stocat in _schema_versions.sha256_up; drift real => boot abortat),
-- deci editarea lui ar fi rupt orice instalare care are deja migrarea aplicata.
-- Fisierele .down.sql nu sunt hash-uite.
--
-- Grantul ramane pe 'ai.single'. Consecinta asumata: dupa un rollback, analiza multi
-- nu mai are extra din grant. E o pierdere reala de functionalitate, dar rollback-ul e
-- o operatie de urgenta, nu o stare normala — iar alternativa (bugetul dublat tacut la
-- fiecare ciclu) e mai grava si mai greu de observat.
UPDATE user_quota_grants SET feature = 'ai.single' WHERE feature = 'ai';

DELETE FROM budget_notifications WHERE feature = 'ai';
DELETE FROM _schema_versions WHERE version = 41;
