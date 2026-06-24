-- 0020_master_switch.up.sql — per-owner global pause/resume pentru monitoring claim.
--
-- Cand monitoring_enabled = 0, scheduler-ul nu mai claim-uieste niciun job al
-- ownerului, fara sa atinga active/paused_until/next_run_at per job. Re-enable
-- restore-uieste exact starea anterioara: joburile due in fereastra de pauza
-- vor fi claim-uite pe ticks urmatori (next_run_at deja in trecut).
--
-- Default-ul (rand lipsa) e tratat de scheduler ca "enabled" — owneri vechi
-- care n-au atins switch-ul nu sunt blocati.

CREATE TABLE owner_monitoring_settings (
  owner_id            TEXT PRIMARY KEY,
  monitoring_enabled  INTEGER NOT NULL DEFAULT 1
                      CHECK(monitoring_enabled IN (0,1)),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Index pentru scheduler claim: vom face anti-join "WHERE NOT EXISTS (...
-- monitoring_enabled = 0 ...)" deci index pe coloana booleana e util.
CREATE INDEX idx_owner_monitoring_disabled
  ON owner_monitoring_settings(owner_id)
  WHERE monitoring_enabled = 0;
