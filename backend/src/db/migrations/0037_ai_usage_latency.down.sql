-- ALTER TABLE ... DROP COLUMN necesita SQLite >= 3.35.0. better-sqlite3 din
-- proiect e bundled cu SQLite 3.53.0, deci down-ul ruleaza pe runtime-ul aplicatiei.
-- Daca rulezi acest down cu un sqlite3 CLI mai vechi de 3.35, comanda esueaza.
ALTER TABLE ai_usage DROP COLUMN latency_ms;
ALTER TABLE ai_usage DROP COLUMN error_type;

-- CREATE-ul defensiv face down-ul rulabil standalone (DB-uri de test/sintetice
-- fara jurnal); pe un DB real tabela exista deja si linia e no-op.
CREATE TABLE IF NOT EXISTS _schema_versions (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  sha256_up  TEXT NOT NULL
);
DELETE FROM _schema_versions WHERE version = 37;
