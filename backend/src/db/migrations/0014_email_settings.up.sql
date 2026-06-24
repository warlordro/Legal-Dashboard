-- 0014_email_settings.up.sql - per-owner email notification preferences (PR-11).
--
-- Default OFF: email is an optional channel beside the in-app alerts inbox,
-- SSE stream, and native OS notifications. Missing SMTP_* env vars must not
-- block boot or alert insertion.

CREATE TABLE owner_email_settings (
  owner_id      TEXT PRIMARY KEY,
  enabled       INTEGER NOT NULL DEFAULT 0
                CHECK(enabled IN (0,1)),
  to_address    TEXT,
  min_severity  TEXT NOT NULL DEFAULT 'warning'
                CHECK(min_severity IN ('info','warning','critical')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
