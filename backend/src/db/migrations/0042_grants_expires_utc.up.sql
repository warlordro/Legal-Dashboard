-- v2.42.0 (10.2b): backfill expires_at la UTC. createGrant normalizeaza la
-- scriere DIN acest sprint, dar randurile legacy (granturi din v2.32+) pot avea
-- ISO cu offset stocat brut, iar predicatele de "grant activ" compara TEXT cu
-- boundary `...Z` — misclasificare in fereastra offsetului. Idempotent.
UPDATE user_quota_grants
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at)
WHERE expires_at NOT LIKE '%Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS NOT NULL;
