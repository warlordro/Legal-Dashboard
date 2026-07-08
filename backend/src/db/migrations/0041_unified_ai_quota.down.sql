-- Down pragmatic (ghid 10.2): recreeaza ai.single + ai.multi cu ACEEASI limita
-- din 'ai'; granturile se DUPLICA pe ambele feature-uri legacy (pre-0041
-- pool-urile erau separate — maparea doar pe ai.single ar pierde extra-ul de
-- pe multi); sterge notificarile 'ai' si versiunea 41.
INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
SELECT user_id, 'ai.single', period, limit_usd_milli, updated_at, updated_by
FROM user_quota_overrides WHERE feature = 'ai';
INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
SELECT user_id, 'ai.multi', period, limit_usd_milli, updated_at, updated_by
FROM user_quota_overrides WHERE feature = 'ai';
DELETE FROM user_quota_overrides WHERE feature = 'ai';

INSERT INTO user_quota_grants
  (user_id, feature, extra_usd_milli, expires_at, reason, granted_by, granted_at, revoked_at, revoked_by, revoked_reason)
SELECT user_id, 'ai.multi', extra_usd_milli, expires_at, reason, granted_by, granted_at, revoked_at, revoked_by, revoked_reason
FROM user_quota_grants WHERE feature = 'ai';
UPDATE user_quota_grants SET feature = 'ai.single' WHERE feature = 'ai';

DELETE FROM budget_notifications WHERE feature = 'ai';
DELETE FROM _schema_versions WHERE version = 41;
