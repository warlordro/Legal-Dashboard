-- 0027_user_quota_overrides_extension.down.sql - rollback v2.32.0 quota extension.
-- Pierde period si NULL (unlimited). Doar rollback de urgenta.
-- Runner-ul nu auto-executa *.down.sql (vezi runner.ts comment).

ALTER TABLE user_quota_overrides RENAME TO user_quota_overrides_new;

CREATE TABLE user_quota_overrides (
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature               TEXT NOT NULL CHECK(length(feature) > 0),
  daily_limit_usd_milli INTEGER NOT NULL CHECK(daily_limit_usd_milli >= 0),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by            TEXT,
  PRIMARY KEY (user_id, feature)
);

INSERT INTO user_quota_overrides (user_id, feature, daily_limit_usd_milli, updated_at, updated_by)
SELECT user_id, feature, COALESCE(limit_usd_milli, 0), updated_at, updated_by
FROM user_quota_overrides_new
WHERE limit_usd_milli IS NOT NULL;

DROP TABLE user_quota_overrides_new;

CREATE INDEX idx_user_quota_overrides_user ON user_quota_overrides(user_id);
