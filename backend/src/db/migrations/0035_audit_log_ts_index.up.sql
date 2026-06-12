-- 0035_audit_log_ts_index.up.sql - index pentru purge-ul de retentie (v2.37.1, review cluster 5).
-- purgeOldAuditLog sterge pe `ts < ?`, dar singurele indexuri existente incep cu
-- owner_id / actor_id — filtrul pe ts singur cadea pe full-table scan sub write
-- lock. Cu indexul + chunking-ul din auditRepository, fiecare batch e scurt.
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);
