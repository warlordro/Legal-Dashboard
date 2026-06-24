-- 0010_ai_usage.up.sql - PR-7 AI usage tracking.
--
-- Every AI provider call writes one owner-scoped row after the SDK call returns
-- or throws. Costs are stored as integer milli-USD to avoid floating-point drift.

CREATE TABLE ai_usage (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        TEXT NOT NULL,
  ts              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  provider        TEXT NOT NULL CHECK(provider IN ('anthropic','openai','google')),
  model           TEXT NOT NULL CHECK(length(model) > 0),
  input_tokens    INTEGER NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
  output_tokens   INTEGER NOT NULL DEFAULT 0 CHECK(output_tokens >= 0),
  cost_usd_milli  INTEGER NOT NULL DEFAULT 0 CHECK(cost_usd_milli >= 0),
  http_status     INTEGER CHECK(http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
  was_aborted     INTEGER NOT NULL DEFAULT 0 CHECK(was_aborted IN (0,1)),
  request_id      TEXT,
  feature         TEXT NOT NULL CHECK(length(feature) > 0)
);

CREATE INDEX idx_ai_usage_owner_time ON ai_usage(owner_id, ts DESC);
CREATE INDEX idx_ai_usage_global_time ON ai_usage(ts DESC);
CREATE INDEX idx_ai_usage_owner_feature_time ON ai_usage(owner_id, feature, ts DESC);
