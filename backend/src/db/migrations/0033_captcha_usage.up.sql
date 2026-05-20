-- 0033_captcha_usage.up.sql — v2.34.0 P1-4 per-user captcha quota.
--
-- Every successful captcha resolution through `withRnpmCaptchaGuards` on the
-- tenant branch writes one row. The guard counts rows in the rolling window
-- (mirror semantica `sumAiUsageMilliInWindow` din `ai_usage`) si compara cu
-- override-ul `user_quota_overrides(feature = 'captcha.rnpm')` (interpretat ca
-- numar de captcha-uri, NU milli-USD) sau cu default-ul din env
-- `LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA`.
--
-- source = 'tenant' (cheia comuna a firmei, plata din wallet-ul firmei) sau
-- 'body' (BYOK desktop, doar pentru audit completitudine — nu intra in cap pe
-- firma). In `web` mode `source` e mereu 'tenant'.

CREATE TABLE captcha_usage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     TEXT NOT NULL,
  ts           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  provider     TEXT NOT NULL CHECK(provider IN ('2captcha','capsolver')),
  source       TEXT NOT NULL CHECK(source IN ('tenant','body')),
  request_id   TEXT
);

CREATE INDEX idx_captcha_usage_owner_time ON captcha_usage(owner_id, ts DESC);
