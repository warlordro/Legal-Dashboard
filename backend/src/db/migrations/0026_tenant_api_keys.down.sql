-- 0026_tenant_api_keys.down.sql - remove tenant API key storage.
-- Not auto-executed by the runner (runner.ts only consumes *.up.sql).

DROP TABLE IF EXISTS tenant_api_keys;
