-- Rollback pragmatic: pool-ul 'ai' redevine pereche ai.single/ai.multi cu
-- ACEEASI limita pe ambele (informatia per-feature originala nu mai exista).
INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
SELECT user_id, 'ai.single', period, limit_usd_milli, updated_at, updated_by
FROM user_quota_overrides WHERE feature = 'ai';
INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
SELECT user_id, 'ai.multi', period, limit_usd_milli, updated_at, updated_by
FROM user_quota_overrides WHERE feature = 'ai';
DELETE FROM user_quota_overrides WHERE feature = 'ai';

UPDATE user_quota_grants SET feature = 'ai.single' WHERE feature = 'ai';

DELETE FROM budget_notifications WHERE feature = 'ai';

DELETE FROM _schema_versions WHERE version = 41;
