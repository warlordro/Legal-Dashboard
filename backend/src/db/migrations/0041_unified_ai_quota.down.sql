-- Rollback pragmatic: pool-ul 'ai' redevine pereche ai.single/ai.multi cu
-- ACEEASI limita pe ambele (informatia per-feature originala nu mai exista).
INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
SELECT user_id, 'ai.single', period, limit_usd_milli, updated_at, updated_by
FROM user_quota_overrides WHERE feature = 'ai';
INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
SELECT user_id, 'ai.multi', period, limit_usd_milli, updated_at, updated_by
FROM user_quota_overrides WHERE feature = 'ai';
DELETE FROM user_quota_overrides WHERE feature = 'ai';

-- Granturile: acelasi tratament ca override-urile — DUPLICATE pe ambele
-- feature-uri legacy (CodeRabbit: maparea doar pe ai.single pierdea extra-ul
-- de pe pool-ul ai.multi; pre-0041 pool-urile erau separate, deci fiecare isi
-- primeste copia, exact ca la override-uri).
INSERT INTO user_quota_grants
  (user_id, feature, extra_usd_milli, expires_at, reason, granted_at, granted_by, revoked_at, revoked_by, revoked_reason)
SELECT user_id, 'ai.multi', extra_usd_milli, expires_at, reason, granted_at, granted_by, revoked_at, revoked_by, revoked_reason
FROM user_quota_grants WHERE feature = 'ai';
UPDATE user_quota_grants SET feature = 'ai.single' WHERE feature = 'ai';

DELETE FROM budget_notifications WHERE feature = 'ai';

DELETE FROM _schema_versions WHERE version = 41;
