-- 0036_openrouter_stack_western.down.sql - data-fix ireversibil (nu putem sti
-- care owneri aveau 'chinese'). No-op pe date.

-- Rollback-ul trebuie sa stearga si randul de versiune, altfel runner-ul crede
-- ca migratia e inca aplicata si nu o re-ruleaza la upgrade. CREATE-ul defensiv
-- face down-ul rulabil standalone (DB-uri de test/sintetice fara jurnal); pe un
-- DB real tabela exista deja si linia e no-op.
CREATE TABLE IF NOT EXISTS _schema_versions (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  sha256_up  TEXT NOT NULL
);
DELETE FROM _schema_versions WHERE version = 36;
