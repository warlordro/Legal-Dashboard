-- 0015_daily_report_settings.down.sql - SQLite nu suporta DROP COLUMN inainte
-- de versiunea 3.35; recreate-pattern pentru a sterge coloanele adaugate.

CREATE TABLE owner_email_settings_new (
  owner_id      TEXT PRIMARY KEY,
  enabled       INTEGER NOT NULL DEFAULT 0
                CHECK(enabled IN (0,1)),
  to_address    TEXT,
  min_severity  TEXT NOT NULL DEFAULT 'warning'
                CHECK(min_severity IN ('info','warning','critical')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO owner_email_settings_new (owner_id, enabled, to_address, min_severity, created_at, updated_at)
  SELECT owner_id, enabled, to_address, min_severity, created_at, updated_at
  FROM owner_email_settings;

DROP TABLE owner_email_settings;
ALTER TABLE owner_email_settings_new RENAME TO owner_email_settings;

-- v2.37.1: rollback-ul trebuie sa stearga si randul de versiune, altfel
-- runner-ul crede ca migratia e inca aplicata si nu o re-ruleaza la upgrade.
-- CREATE-ul defensiv face down-ul rulabil standalone (DB-uri de test/sintetice
-- fara jurnal); pe un DB real tabela exista deja si linia e no-op.
CREATE TABLE IF NOT EXISTS _schema_versions (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  sha256_up  TEXT NOT NULL
);
DELETE FROM _schema_versions WHERE version = 15;
