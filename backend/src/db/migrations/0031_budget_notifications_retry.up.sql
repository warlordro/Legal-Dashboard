-- 0031_budget_notifications_retry.up.sql - v2.33.0 budget warning hardening.
--
-- HIGH-4: retry state for budget warning emails.
-- MEDIUM-8: cooldown memory survives clear/refire cycles.
-- LOW-3: audit row is emitted in application code.

ALTER TABLE budget_notifications ADD COLUMN email_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budget_notifications ADD COLUMN last_email_attempted_at TEXT;

CREATE INDEX idx_budget_notifications_retry
  ON budget_notifications(user_id, feature, last_email_attempted_at)
  WHERE fired_at IS NOT NULL AND cleared_at IS NULL AND email_sent_at IS NULL;
