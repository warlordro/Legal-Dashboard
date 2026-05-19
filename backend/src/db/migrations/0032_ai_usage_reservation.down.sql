-- 0032_ai_usage_reservation.down.sql
DROP INDEX IF EXISTS idx_ai_usage_pending;
ALTER TABLE ai_usage DROP COLUMN estimated_cost_usd_milli;
ALTER TABLE ai_usage DROP COLUMN status;
