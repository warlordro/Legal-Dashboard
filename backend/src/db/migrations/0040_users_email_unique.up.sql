-- v2.42.0: unicitatea emailului devine garantie de DB (case-insensitive).
-- Pana acum unicitatea era doar conventie (seed-admin + bridge fac lookup pe
-- email); crearea userilor din UI (individual + import bulk) are nevoie de
-- garantie atomica — check-then-insert ar lasa race intre request-uri.
-- Daca indexul nu se poate crea (dubluri istorice), migration-ul esueaza LOUD:
-- opereaza manual dublurile (vezi RUNBOOK) si reporneste. Pre-migration backup
-- ruleaza automat inainte de orice migration.
CREATE UNIQUE INDEX idx_users_email_nocase ON users(email COLLATE NOCASE);
