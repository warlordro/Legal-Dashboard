-- 0032_ai_usage_reservation.up.sql - v2.33.0 quota guard reservation support.
--
-- Pending rows reserve quota before external AI calls start. Desktop inserts
-- continue to use the default confirmed state.

ALTER TABLE ai_usage ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'
  CHECK(status IN ('pending', 'confirmed'));

ALTER TABLE ai_usage ADD COLUMN estimated_cost_usd_milli INTEGER;

CREATE INDEX idx_ai_usage_pending
  ON ai_usage(owner_id, ts)
  WHERE status = 'pending';
