-- Necesita SQLite >= 3.35.0 pentru DROP COLUMN (better-sqlite3 bundle-uit il suporta;
-- la rollback standalone verifica `sqlite3 --version`). Rollback-ul e MANUAL — runner-ul
-- aplica doar .up.sql (fix review DB-002/REL-DOWN-MANUAL); recovery real = backup pre-migratie.
DROP INDEX IF EXISTS idx_audit_log_token_use;
DROP INDEX IF EXISTS idx_captcha_usage_token_id;
ALTER TABLE captcha_usage DROP COLUMN token_id;
DROP INDEX IF EXISTS idx_api_tokens_owner_id;
DROP INDEX IF EXISTS idx_api_tokens_token_hash;
DROP TABLE IF EXISTS api_tokens;

CREATE TABLE IF NOT EXISTS _schema_versions (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  sha256_up  TEXT NOT NULL
);
DELETE FROM _schema_versions WHERE version = 39;
