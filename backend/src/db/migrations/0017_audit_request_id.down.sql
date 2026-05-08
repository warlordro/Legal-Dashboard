-- 0017_audit_request_id.down.sql - revert request_id column on audit_log.

DROP INDEX IF EXISTS idx_audit_request_id;
ALTER TABLE audit_log DROP COLUMN request_id;
