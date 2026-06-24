-- 0011_user_quota_overrides.up.sql - PR-8 admin quota override per user.
--
-- Stores admin-managed daily limits per (user_id, feature). PR-8 only exposes
-- CRUD via /api/v1/admin/users/:id/quota; the AI rate-limit path that consumes
-- these values lands later (planned with PR-9 web cutover).
-- Daily limits use integer milli-USD to match ai_usage.cost_usd_milli precision.

CREATE TABLE user_quota_overrides (
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature               TEXT NOT NULL CHECK(length(feature) > 0),
  daily_limit_usd_milli INTEGER NOT NULL CHECK(daily_limit_usd_milli >= 0),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by            TEXT,
  PRIMARY KEY (user_id, feature)
);

CREATE INDEX idx_user_quota_overrides_user ON user_quota_overrides(user_id);
