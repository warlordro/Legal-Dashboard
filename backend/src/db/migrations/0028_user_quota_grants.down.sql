-- 0028_user_quota_grants.down.sql - remove v2.32.0 grants.
-- Runner-ul nu auto-executa *.down.sql.

DROP INDEX IF EXISTS idx_grants_active;
DROP TABLE IF EXISTS user_quota_grants;
