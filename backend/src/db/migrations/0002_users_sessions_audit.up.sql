-- 0002_users_sessions_audit.up.sql — shadow tables for auth + audit (PR-2).
--
-- Why now: PR-3 onward writes `audit_log` rows for monitoring CRUD events. The
-- `users` / `user_sessions` tables are introduced as shadow infrastructure —
-- not used by any code path until PR-9 (web mode) flips `getOwnerId(c)` from
-- the hardcoded "local" to a JWT-derived user id. Creating them now means PR-9
-- becomes a pure code change with zero schema migration on web cutover day.
--
-- See PLAN-monitoring-webmode.md §2.1 (auth) and §2.4 (audit_log).
--
-- Seed: a single synthetic user `local` so every desktop owner_id='local' value
-- has a logical FK target. Foreign keys remain logical (no ON DELETE CASCADE on
-- rnpm_* tables) — wiring real FKs requires backfill of historical rows on
-- legacy DBs and is deferred to PR-9 when real users exist.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user'
                CHECK(role IN ('user','admin','support','readonly')),
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('active','suspended','deleted')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  meta_json     TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE user_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  user_agent  TEXT,
  ip          TEXT,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id, revoked_at);

-- Synthetic desktop user. INSERT OR IGNORE so a developer who manually pre-seeds
-- the same row in a fresh DB does not crash the migration.
INSERT OR IGNORE INTO users(id, email, display_name, role)
VALUES ('local', 'local@desktop', 'Local User', 'user');

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT,
  actor_id      TEXT,
  ts            TEXT NOT NULL DEFAULT (datetime('now')),
  action        TEXT NOT NULL,
  target_kind   TEXT,
  target_id     TEXT,
  outcome       TEXT NOT NULL DEFAULT 'ok'
                CHECK(outcome IN ('ok','denied','error')),
  ip            TEXT,
  user_agent    TEXT,
  detail_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_owner_time ON audit_log(owner_id, ts DESC);
CREATE INDEX idx_audit_actor_time ON audit_log(actor_id, ts DESC);
