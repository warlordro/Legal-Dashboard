-- v2.42.0 (5.2): consolidarea pool-ului "ai" — o singura limita pentru toate
-- tipurile de analiza AI.
-- 1. Override-uri: promoveaza randul ai.* CEL MAI RESTRICTIV la 'ai'.
--    Restrictivitatea se compara pe RATA ZILNICA (limita/zilele perioadei:
--    day=1, week=7, month=30), NU pe numarul brut — altfel "900/luna" ar
--    castiga in fata lui "1000/zi" desi e mult mai LARG. NULL pierde mereu.
INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
SELECT o.user_id, 'ai', o.period, o.limit_usd_milli, o.updated_at, o.updated_by
FROM user_quota_overrides o
WHERE o.feature IN ('ai.single', 'ai.multi')
  AND NOT EXISTS (
    SELECT 1 FROM user_quota_overrides x WHERE x.user_id = o.user_id AND x.feature = 'ai'
  )
  AND o.rowid = (
    SELECT y.rowid FROM user_quota_overrides y
    WHERE y.user_id = o.user_id AND y.feature IN ('ai.single', 'ai.multi')
    ORDER BY (y.limit_usd_milli IS NULL) ASC,
             (CAST(y.limit_usd_milli AS REAL) /
               CASE y.period WHEN 'day' THEN 1 WHEN 'week' THEN 7 ELSE 30 END) ASC,
             y.rowid ASC
    LIMIT 1
  );
DELETE FROM user_quota_overrides WHERE feature IN ('ai.single', 'ai.multi');
-- 2. Granturi pe pool-ul unic (extra-ul se aduna per grant).
UPDATE user_quota_grants SET feature = 'ai' WHERE feature IN ('ai.single', 'ai.multi');
-- 3. Episoadele de warning legacy nu se pot combina deterministic — se sterg;
--    warning-ul se rearma la urmatorul apel AI daca pool-ul e peste prag.
DELETE FROM budget_notifications WHERE feature IN ('ai.single', 'ai.multi');
