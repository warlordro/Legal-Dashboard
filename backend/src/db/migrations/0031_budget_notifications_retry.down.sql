-- 0031_budget_notifications_retry.down.sql
DROP INDEX IF EXISTS idx_budget_notifications_retry;
ALTER TABLE budget_notifications DROP COLUMN last_email_attempted_at;
ALTER TABLE budget_notifications DROP COLUMN email_attempts;
