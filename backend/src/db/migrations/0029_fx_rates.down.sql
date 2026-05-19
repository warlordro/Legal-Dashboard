-- 0029_fx_rates.down.sql - remove v2.32.0 FX cache.
-- Runner-ul nu auto-executa *.down.sql.

DROP INDEX IF EXISTS idx_fx_rates_latest;
DROP TABLE IF EXISTS fx_rates;
