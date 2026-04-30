-- 0012_monitoring_runs_alerts_patched.up.sql - F10 audit hardening.
--
-- Adds a separate counter for enrichment patches applied to existing alert
-- detail_json (e.g. solutie_aparuta backfill via enrichSolutieAlertsForJob).
-- Without this, an enrichment-heavy tick reports alerts_created=0 even though
-- meaningful work happened. SQLite supports ADD COLUMN with DEFAULT 0 in-place
-- (no table rebuild). Existing rows are backfilled to 0 by the DEFAULT.

ALTER TABLE monitoring_runs ADD COLUMN alerts_patched INTEGER NOT NULL DEFAULT 0;
