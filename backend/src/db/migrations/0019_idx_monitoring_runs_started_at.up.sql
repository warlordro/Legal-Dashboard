-- 0019_idx_monitoring_runs_started_at.up.sql - accelereaza chunked purge zilnic (Batch 5.1, v2.21.0).
-- Purge-ul existent rula fara index pe started_at; pe DB-uri mari devine full-table scan.
CREATE INDEX IF NOT EXISTS idx_monitoring_runs_started_at ON monitoring_runs(started_at);
