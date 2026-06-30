-- v2.40.0: Personal Access Tokens pentru API programatic + MCP (piesa A).
-- Token opac ld_pat_*, hash SHA-256 (lookup pe coloana indexata). expires_at
-- nullable (default fara expirare; optional 30/90/365). captcha_daily_cap
-- nullable (default fara plafon per-token). Revoke instant via revoked_at.
CREATE TABLE api_tokens (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL DEFAULT 'local',
  name              TEXT NOT NULL,
  token_hash        TEXT NOT NULL,
  token_prefix      TEXT NOT NULL,
  scopes            TEXT NOT NULL,
  captcha_daily_cap INTEGER,
  -- ISO 8601 UTC (T...Z) ca sa fie comparabil lexicografic cu expires_at stocat
  -- ISO si cu strftime(...'now') din findActiveTokenByHash (fix review DB-001/R04).
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at        TEXT,
  last_used_at      TEXT,
  last_used_ip      TEXT,
  last_used_ua      TEXT,
  revoked_at        TEXT
);
CREATE UNIQUE INDEX idx_api_tokens_token_hash ON api_tokens(token_hash);
CREATE INDEX idx_api_tokens_owner_id ON api_tokens(owner_id);

-- Per-token captcha accounting: leaga randul de captcha de tokenul care l-a
-- consumat, pentru plafon per-token (A5.3). NULL = consum din sesiune JWT/desktop.
ALTER TABLE captcha_usage ADD COLUMN token_id TEXT;
-- Partial: token_id e NULL pe marea majoritate a randurilor (JWT/desktop) — fix review DB-005.
CREATE INDEX idx_captcha_usage_token_id ON captcha_usage(token_id) WHERE token_id IS NOT NULL;

-- Index pentru detectia "IP nou" pe hot-path-ul PAT (hasPriorTokenUseFromIp) — fix review DB-004.
-- v2.2 (runda 3): WHERE include outcome='ok'. Detectia IP-nou trebuie sa numere DOAR folosirile
-- reusite; altfel o cerere 403 dintr-un IP nou (scrisa cu outcome='denied' + ip) ar pre-seta un
-- rand care suprima alerta la urmatorul request reusit (token furat -> loveste intai forbidden).
-- action+outcome fiind fixe in WHERE, indexul tine doar (target_id, ip).
CREATE INDEX idx_audit_log_token_use ON audit_log(target_id, ip)
  WHERE action = 'api_token.used' AND outcome = 'ok';
