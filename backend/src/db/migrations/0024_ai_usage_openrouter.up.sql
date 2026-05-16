-- 0024 - widen ai_usage.provider CHECK to include 'openrouter'.
-- Rebuild because SQLite cannot ALTER CHECK constraint in place.
-- Pre-migration backup auto-runs via schema-upgrade hook.

CREATE TABLE ai_usage_new (
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

INSERT INTO ai_usage_new (
  id, owner_id, ts, provider, model, input_tokens, output_tokens,
  cost_usd_milli, http_status, was_aborted, request_id, feature
)
SELECT
  id, owner_id, ts, provider, model, input_tokens, output_tokens,
  cost_usd_milli, http_status, was_aborted, request_id, feature
FROM ai_usage;

DROP TABLE ai_usage;
ALTER TABLE ai_usage_new RENAME TO ai_usage;

CREATE INDEX idx_ai_usage_owner_time ON ai_usage(owner_id, ts DESC);
CREATE INDEX idx_ai_usage_global_time ON ai_usage(ts DESC);
CREATE INDEX idx_ai_usage_owner_feature_time ON ai_usage(owner_id, feature, ts DESC);
