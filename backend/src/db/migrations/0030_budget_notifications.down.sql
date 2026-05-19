-- 0030_budget_notifications.down.sql - remove v2.32.0 soft warning state.
-- Runner-ul nu auto-executa *.down.sql.

DROP INDEX IF EXISTS idx_budget_notifications_active;
DROP TABLE IF EXISTS budget_notifications;
