-- 0002_users_sessions_audit.down.sql — manual rollback artifact for PR-2.
--
-- Not auto-executed by the runner (runner.ts only consumes *.up.sql). Kept as
-- the documented rollback path per CP-9 (every migration owns its inverse).
--
-- Order: indexes first, then tables. user_sessions before users so the FK
-- ON DELETE CASCADE doesn't fire mid-drop on engines stricter than SQLite.

DROP INDEX IF EXISTS idx_audit_actor_time;
DROP INDEX IF EXISTS idx_audit_owner_time;
DROP TABLE IF EXISTS audit_log;

DROP INDEX IF EXISTS idx_user_sessions_user;
DROP TABLE IF EXISTS user_sessions;

DROP TABLE IF EXISTS users;

DELETE FROM _schema_versions WHERE version = 2;
