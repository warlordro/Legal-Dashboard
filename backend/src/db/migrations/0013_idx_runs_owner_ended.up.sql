CREATE INDEX IF NOT EXISTS idx_runs_owner_ended
  ON monitoring_runs(owner_id, ended_at DESC)
  WHERE ended_at IS NOT NULL;
