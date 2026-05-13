-- 0021_idx_rnpm_avize_owner_search.up.sql - accelereaza filterRnpmSearchResults (v2.24.0).
-- Filter-ul peste rezultatele unei cautari RNPM porneste de la (owner_id, search_id);
-- fara index dedicat, fiecare query face full-table scan pe rnpm_avize.
CREATE INDEX IF NOT EXISTS idx_rnpm_avize_owner_search
  ON rnpm_avize(owner_id, search_id);
