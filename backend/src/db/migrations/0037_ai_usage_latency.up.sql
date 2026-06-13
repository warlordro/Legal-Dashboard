-- v2.38.0: persistam latenta si tipul de eroare per call AI (inainte doar
-- stdout JSON, nedurabil in containere).
ALTER TABLE ai_usage ADD COLUMN latency_ms INTEGER;
ALTER TABLE ai_usage ADD COLUMN error_type TEXT;
