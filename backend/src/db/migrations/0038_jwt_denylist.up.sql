-- v2.38.0: logout-ul invalideaza tokenul server-side (web mode). Tokenele au
-- claim jti; la logout jti-ul intra aici si authProvider il refuza. Randurile
-- expira natural (purge zilnic pe expires_at, aliniat cu retention-ul existent).
CREATE TABLE jwt_denylist (
  jti TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'local',
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER NOT NULL
);
CREATE INDEX idx_jwt_denylist_expires_at ON jwt_denylist(expires_at);
