-- 0029_fx_rates.up.sql - v2.32.0 ECB FX rate cache.
--
-- Stocheaza pair = 'USD/EUR' (1 USD = X EUR) calculat din ECB daily feed
-- (`eurofxref-daily.xml`) ca 1 / rate(EUR/USD). rate_date e business day-ul ECB
-- (YYYY-MM-DD), source default 'ecb'. PRIMARY KEY (pair, rate_date) face
-- upsert-ul idempotent in cazul retry-urilor in aceeasi zi.

CREATE TABLE fx_rates (
  pair        TEXT NOT NULL,
  rate        REAL NOT NULL CHECK(rate > 0),
  rate_date   TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'ecb',
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pair, rate_date)
);

CREATE INDEX idx_fx_rates_latest ON fx_rates(pair, rate_date DESC);
