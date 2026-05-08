-- 0017_audit_request_id.up.sql - v2.20.3 Grupul J: leaga audit_log de envelope.
--
-- Pana acum, requestId din `{data, error, requestId}` (vezi util/envelope.ts +
-- middleware/requestId.ts) era vizibil in raspunsuri si in `ai_usage` dar NU in
-- `audit_log`. Daca un user raporta un denied 403 cu requestId X, oncall nu
-- putea jumpui de la log-ul HTTP la randul de audit fara matching pe ts +
-- actor_id (slow + fragil pe burst-uri).
--
-- Adauga coloana TEXT nullable (legacy rows raman cu NULL — backfill skip)
-- + index opt-in pe (request_id) pentru cautari rare in admin Audit page.

ALTER TABLE audit_log ADD COLUMN request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_request_id ON audit_log(request_id) WHERE request_id IS NOT NULL;
