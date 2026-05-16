-- 0025 - add DEFAULT 'local' to ai_usage.owner_id (project convention).
-- Rebuild because SQLite cannot ALTER column default in place.
-- Schema otherwise identical to 0024 UP (provider CHECK includes openrouter,
-- routing_tag column present).
-- Pre-migration backup auto-runs via schema-upgrade hook.

CREATE TABLE ai_usage_v25 (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        TEXT NOT NULL DEFAULT 'local',
  ts              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  provider        TEXT NOT NULL CHECK(provider IN ('anthropic','openai','google','openrouter')),
  model           TEXT NOT NULL CHECK(length(model) > 0),
  input_tokens    INTEGER NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
  output_tokens   INTEGER NOT NULL DEFAULT 0 CHECK(output_tokens >= 0),
  cost_usd_milli  INTEGER NOT NULL DEFAULT 0 CHECK(cost_usd_milli >= 0),
  http_status     INTEGER CHECK(http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
  was_aborted     INTEGER NOT NULL DEFAULT 0 CHECK(was_aborted IN (0,1)),
  request_id      TEXT,
  feature         TEXT NOT NULL CHECK(length(feature) > 0),
  routing_tag     TEXT
);

INSERT INTO ai_usage_v25 (
  id, owner_id, ts, provider, model, input_tokens, output_tokens,
  cost_usd_milli, http_status, was_aborted, request_id, feature, routing_tag
)
SELECT
  id, owner_id, ts, provider, model, input_tokens, output_tokens,
  cost_usd_milli, http_status, was_aborted, request_id, feature, routing_tag
FROM ai_usage;

DROP TABLE ai_usage;
ALTER TABLE ai_usage_v25 RENAME TO ai_usage;

CREATE INDEX idx_ai_usage_owner_time ON ai_usage(owner_id, ts DESC);
CREATE INDEX idx_ai_usage_global_time ON ai_usage(ts DESC);
CREATE INDEX idx_ai_usage_owner_feature_time ON ai_usage(owner_id, feature, ts DESC);
