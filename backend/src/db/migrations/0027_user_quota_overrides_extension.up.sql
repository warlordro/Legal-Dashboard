-- 0027_user_quota_overrides_extension.up.sql - v2.32.0 quota extension.
--
-- Extinde user_quota_overrides pentru rolling window (day/week/month) si
-- unlimited (limit_usd_milli NULL = fara cap). Mostenit din PR-8: tabela
-- pastreaza cheia primara (user_id, feature). Migrarea face copy-then-drop
-- ca sa pastreze datele existente; period implicit 'day' pe randuri vechi.

ALTER TABLE user_quota_overrides RENAME TO user_quota_overrides_old;

CREATE TABLE user_quota_overrides (
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature            TEXT NOT NULL CHECK(length(feature) > 0),
  period             TEXT NOT NULL DEFAULT 'day'
                       CHECK(period IN ('day','week','month')),
  limit_usd_milli    INTEGER CHECK(limit_usd_milli IS NULL OR limit_usd_milli >= 0),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by         TEXT,
  PRIMARY KEY (user_id, feature)
);

INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
SELECT user_id, feature, 'day', daily_limit_usd_milli, updated_at, updated_by
FROM user_quota_overrides_old;

DROP TABLE user_quota_overrides_old;

CREATE INDEX idx_user_quota_overrides_user ON user_quota_overrides(user_id);
