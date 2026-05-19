-- 0028_user_quota_grants.up.sql - v2.32.0 extra grants per user/feature.
--
-- Adminul acorda one-shot suma extra peste capul curent, cu expirare ISO 8601.
-- effectiveLimit in quotaGuard = base_limit + SUM(extra_usd_milli) WHERE NOT
-- revoked AND expires_at > now. Tabela e append-only pe acordari; revocarea
-- seteaza revoked_at fara a sterge randul (audit trail).

CREATE TABLE user_quota_grants (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature          TEXT NOT NULL CHECK(length(feature) > 0),
  extra_usd_milli  INTEGER NOT NULL CHECK(extra_usd_milli > 0),
  expires_at       TEXT NOT NULL,
  reason           TEXT,
  granted_at       TEXT NOT NULL DEFAULT (datetime('now')),
  granted_by       TEXT NOT NULL,
  revoked_at       TEXT,
  revoked_by       TEXT,
  revoked_reason   TEXT
);

CREATE INDEX idx_grants_active ON user_quota_grants(user_id, feature, expires_at)
  WHERE revoked_at IS NULL;
