-- v2.42.0: limita AI devine POOL unic — feature-ul de cota "ai" acopera toate
-- analizele (single + multi). Consolidam datele legacy:
--
-- 1. Override-uri: daca userul nu are deja un rand 'ai', promovam randul ai.*
--    CEL MAI RESTRICTIV (limita numerica cea mai mica; NULL=nelimitat pierde
--    in fata oricarei limite) — principiul "cand consolidezi plafoane, nu
--    largesti accidental bugetul".
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
    ORDER BY (y.limit_usd_milli IS NULL) ASC, y.limit_usd_milli ASC, y.rowid ASC
    LIMIT 1
  );

DELETE FROM user_quota_overrides WHERE feature IN ('ai.single', 'ai.multi');

-- 2. Granturi: migreaza pe pool-ul unic (extra-ul ramane per grant, se aduna).
UPDATE user_quota_grants SET feature = 'ai' WHERE feature IN ('ai.single', 'ai.multi');

-- 3. Starea de warning (banner 80% + email): episodele legacy per-feature nu
--    se pot combina deterministic — le stergem; daca pool-ul e inca peste
--    prag, warning-ul se rearma la urmatorul apel AI (fire + email).
DELETE FROM budget_notifications WHERE feature IN ('ai.single', 'ai.multi');
