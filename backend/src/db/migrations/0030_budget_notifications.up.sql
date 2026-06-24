-- 0030_budget_notifications.up.sql - v2.32.0 soft warning state machine.
--
-- State machine pentru soft warning (80%): NU dedup pe (period_start, period_end)
-- pentru ca rolling window inseamna period_start se misca la fiecare request,
-- deci o UNIQUE pe el ar permite re-fire fals. Folosim 3 marcaje:
--   above_threshold_since = prima oara cand usedPct a trecut peste threshold
--   fired_at              = cand emailul + bannerul au fost trimise (1 / episode)
--   cleared_at            = cand usedPct a scazut sub threshold (rolling drop)
-- Episode lifecycle:
--   1. usedPct >= 80 prima oara -> set above_threshold_since=now, fired_at=now,
--      dispatch email + banner.
--   2. usedPct ramane >= 80 -> no-op (fired_at already set, cleared_at NULL).
--   3. usedPct scade sub 80 -> set cleared_at=now, clear above_threshold_since
--      + fired_at (urmatorul climb re-fires episode nou).
--   4. Banner visible cand fired_at IS NOT NULL AND cleared_at IS NULL.

CREATE TABLE budget_notifications (
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature               TEXT NOT NULL,
  threshold_pct         INTEGER NOT NULL CHECK(threshold_pct IN (80)),
  above_threshold_since TEXT,
  fired_at              TEXT,
  email_sent_at         TEXT,
  cleared_at            TEXT,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, feature, threshold_pct)
);

CREATE INDEX idx_budget_notifications_active
  ON budget_notifications(user_id, feature)
  WHERE fired_at IS NOT NULL AND cleared_at IS NULL;
