-- v2.42.0 (CodeRabbit): createGrant normalizeaza expires_at la UTC ('...Z')
-- DIN acest release, dar randurile legacy (granturi din v2.32+) pot contine
-- ISO cu offset ('+03:00') stocat brut. Predicatele de "grant activ" compara
-- TEXT cu boundary UTC — un offset ne-normalizat misclasifica randul in
-- fereastra offsetului (ex. un grant expirat de 3h inca numarat activ).
-- Backfill one-time: SQLite parseaza ISO cu offset si il converteste la UTC.
-- Randurile pe care strftime nu le poate parsa raman neatinse (nu stricam
-- date; predicatul le trateaza oricum conservator).
UPDATE user_quota_grants
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at)
WHERE expires_at NOT LIKE '%Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS NOT NULL;
