-- 0011_user_quota_overrides.down.sql - remove PR-8 admin quota override table.

DROP TABLE IF EXISTS user_quota_overrides;
