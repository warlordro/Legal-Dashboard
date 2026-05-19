# PLAN — Quota extension v2.32.0

**Target release**: v2.32.0
**Mode**: web-only feature (desktop ramane neschimbat, BYOK + fara cap)
**Status**: DRAFT — pending review Codex + advisor
**Supersedes (partial)**: `PLAN-admin-tenant-secrets-budgets.md` §3 budget guard. Acel plan a fost livrat partial in v2.30.0 (migration 0026 `tenant_api_keys` + AES-GCM `TENANT_KEY_ENCRYPTION_SECRET`). Bucata `tenant_secrets` din planul vechi e duplicata si NU se mai construieste — `tenant_api_keys` din v2.30.0 e single source pentru chei centralizate.

---

## §0 Decizii inchise (NU se renegociaza in implementare)

| # | Decizie | Valoare | Sursa |
|---|---------|---------|-------|
| D1 | Storage intern al costului | **USD milli** (continuitate `ai_usage`) | precedent v2.30.x |
| D2 | Afisare in UI | **EUR** (cu rate badge) | user 2026-05-19 |
| D3 | Sursa curs FX | **ECB** daily feed (`eurofxref-daily.xml`) | user 2026-05-19 |
| D4 | Manual rate entry | **interzis** in UI | user 2026-05-19 |
| D5 | Period reset | **rolling** (7d / 30d), NU calendar fix | user 2026-05-19 |
| D6 | Unlimited | da, `daily_limit_usd_milli` devine **NULLABLE** + UI checkbox "Fara limita" | user 2026-05-19 |
| D7 | Soft warning prag | **80%** din limita | user 2026-05-19 |
| D8 | Soft warning canal | **email + in-app banner** (next login dupa trigger) | user 2026-05-19 |
| D9 | Extra grant — cine acorda | **orice admin** (fara rol nou) | user 2026-05-19 |
| D10 | Extra grant — semantica | one-shot, suma adaugata peste cap pentru o fereastra cu expirare | derivat |
| D11 | Tenant-aggregate cap | **OUT** din v2.32.0 (deferred, vezi §9) | user 2026-05-19 |
| D12 | Multi-tenant | **NU** (single-tenant per deployment) | mostenit `PLAN-admin-tenant-secrets-budgets §0` |
| D13 | Desktop impact | **ZERO** — `quotaGuard` ramane no-op cand `getAuthMode() !== "web"` | mostenit |
| D14 | FX la boot fara rate | **fail-closed pe EUR display** (UI arata "—" / "EUR indisponibil"); USD ramane intotdeauna afisat; boot NU se blocheaza | revisit Codex+advisor 2026-05-19 |
| D15 | Rolling window seconds | `day=86400s`, `week=604800s`, `month=2592000s` (rolling, NU calendar) | derivat — lock pentru F2 |
| D16 | Banner dismiss | **auto-clear only** (re-evaluat la fiecare poll 5min); fara buton dismiss manual | reconcile advisor — rolling = incompatibil cu manual dismiss |

---

## §1 Scope IN / OUT

**IN v2.32.0**

- Period flexibil per override: `day` (rolling 24h) | `week` (rolling 7d) | `month` (rolling 30d)
- Unlimited: `daily_limit_usd_milli` NULL = fara cap (rulare deplina, dar tot logueaza in `ai_usage`)
- Extra grants: tabel separat `user_quota_grants` cu expirare; suma activa intra in calculul `effectiveLimit`
- Soft warning 80%: prima atingere in fereastra activa → 1 email + 1 banner (deduped pe `(user_id, feature, period_start, period_end)`)
- Hard cap (100%): 429 cu `Retry-After` la finalul ferestrei rolling
- EUR display in `/admin/quota` + `/admin/usage` + envelope detail al 429
- ECB fetch zilnic ~15:00 RO; tabel `fx_rates`; fallback la ultima valoare; banner "stale > 48h" daca fetch esueaza repetat
- Audit log: `budget.override.updated`, `budget.grant.created`, `budget.grant.revoked`, `fx.rate.fetched`, `fx.rate.stale`, `budget.warning.fired`

**OUT v2.32.0**

- Tenant-aggregate cap (suma totala pe tenant peste suma userilor) → vezi §9
- Per-feature granularity dincolo de `ai.single` / `ai.multi` (RNPM captcha ramane separat, OUT)
- Manual FX override in UI
- Rol separat `billing_admin` (orice admin acorda grants)
- Notificare push / Slack / webhook (doar email + in-app)
- Auto-renew grants

---

## §2 Schema migrations

### 0027_user_quota_overrides_extension.up.sql

```sql
-- Extinde user_quota_overrides pentru period rolling si unlimited (NULL = unlimited).
ALTER TABLE user_quota_overrides RENAME TO user_quota_overrides_old;

CREATE TABLE user_quota_overrides (
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature            TEXT NOT NULL CHECK(length(feature) > 0),
  period             TEXT NOT NULL DEFAULT 'day'
                       CHECK(period IN ('day','week','month')),
  limit_usd_milli    INTEGER CHECK(limit_usd_milli IS NULL OR limit_usd_milli >= 0),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by         TEXT,
  PRIMARY KEY (user_id, feature)
);

INSERT INTO user_quota_overrides (user_id, feature, period, limit_usd_milli, updated_at, updated_by)
SELECT user_id, feature, 'day', daily_limit_usd_milli, updated_at, updated_by
FROM user_quota_overrides_old;

DROP TABLE user_quota_overrides_old;

CREATE INDEX idx_user_quota_overrides_user ON user_quota_overrides(user_id);
```

Down: rebuild cu `daily_limit_usd_milli INTEGER NOT NULL` (pierde period si NULL); doar rollback de urgenta.

### 0028_user_quota_grants.up.sql

```sql
CREATE TABLE user_quota_grants (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature          TEXT NOT NULL CHECK(length(feature) > 0),
  extra_usd_milli  INTEGER NOT NULL CHECK(extra_usd_milli > 0),
  expires_at       TEXT NOT NULL,  -- ISO 8601 UTC; suma activa = SUM unde expires_at > now AND revoked_at IS NULL
  reason           TEXT,
  granted_at       TEXT NOT NULL DEFAULT (datetime('now')),
  granted_by       TEXT NOT NULL,
  revoked_at       TEXT,
  revoked_by       TEXT,
  revoked_reason   TEXT
);

CREATE INDEX idx_grants_active ON user_quota_grants(user_id, feature, expires_at)
  WHERE revoked_at IS NULL;
```

### 0029_fx_rates.up.sql

```sql
CREATE TABLE fx_rates (
  pair        TEXT NOT NULL,            -- 'USD/EUR'
  rate        REAL NOT NULL CHECK(rate > 0),
  rate_date   TEXT NOT NULL,            -- ECB business day (YYYY-MM-DD)
  source      TEXT NOT NULL DEFAULT 'ecb',
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pair, rate_date)
);

CREATE INDEX idx_fx_rates_latest ON fx_rates(pair, rate_date DESC);
```

### 0030_budget_notifications.up.sql

```sql
-- State machine pentru soft warning, NU dedup pe (period_start, period_end).
-- Codex C1: rolling window inseamna period_start se misca la fiecare request, deci
-- UNIQUE pe el ar permite re-fire fals; folosim state machine cu 3 marcaje:
--   above_threshold_since = prima oara cand usedPct a trecut peste 80 in episodul curent
--   fired_at              = cand emailul + bannerul au fost trimise (1 data per episode)
--   cleared_at            = cand usedPct a scazut sub 80 (rolling drop) → urmatorul climb re-fires
-- Un singur row per (user, feature, threshold_pct); reset = SET cleared_at + clear above_threshold_since/fired_at.
CREATE TABLE budget_notifications (
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature               TEXT NOT NULL,
  threshold_pct         INTEGER NOT NULL CHECK(threshold_pct IN (80)),  -- viitor: 50/90
  above_threshold_since TEXT,
  fired_at              TEXT,
  email_sent_at         TEXT,
  cleared_at            TEXT,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, feature, threshold_pct)
);

CREATE INDEX idx_budget_notifications_active
  ON budget_notifications(user_id, feature)
  WHERE fired_at IS NOT NULL AND cleared_at IS NULL;
```

**Episode lifecycle**:
1. usedPct >= 80 prima oara → set `above_threshold_since = now()`, `fired_at = now()`, dispatch email + banner
2. usedPct ramane >= 80 → no-op (fired_at already set, cleared_at NULL)
3. usedPct scade sub 80 (rolling drop) → set `cleared_at = now()`, clear `above_threshold_since` + `fired_at` (next climb re-fires)
4. Banner shown cand `fired_at IS NOT NULL AND cleared_at IS NULL`

---

## §3 Backend module map

| Path | Status | Rol |
|------|--------|-----|
| `backend/src/db/userQuotaRepository.ts` | EXTEND | `getOverride()` returneaza `{ period, limit_usd_milli \| null }`; add `setOverride()` cu period + unlimited |
| `backend/src/db/userQuotaGrantsRepository.ts` | NEW | `listActive(ownerId, feature)`, `create(...)`, `revoke(id, by, reason)`, `sumActive(ownerId, feature)` |
| `backend/src/db/fxRatesRepository.ts` | NEW | `getLatest('USD/EUR')`, `upsert(rate, rate_date, source)`, `staleSince(threshold)` |
| `backend/src/db/budgetNotificationsRepository.ts` | NEW | `hasFired(user, feature, periodStart, periodEnd, threshold)`, `markFired(...)`, `markEmailSent(...)`, `ackBanner(...)` |
| `backend/src/db/aiUsageRepository.ts` | EXTEND | `sumAiUsageMilliInWindow(ownerId, feature, fromIso, toIso)` (rolling window query, fereastra 24h/7d/30d) |
| `backend/src/middleware/quotaGuard.ts` | EXTEND | rolling window din period; effectiveLimit = base + sumActiveGrants; NULL = unlimited (return next); soft 80% trigger; Retry-After din earliest contributing ai_usage row (vezi mai jos) |
| `backend/src/services/fxFetcher.ts` | NEW | fetch ECB XML zilnic, parse `<Cube currency='USD' rate='1.0823'/>`, upsert; cron 15:00 Europe/Bucharest |
| `backend/src/services/budgetWarningDispatcher.ts` | NEW | dispatch email (foloseste SMTP existent din v2.21+) + marker DB ca banner sa apara la urmatorul login |
| `backend/src/routes/admin/quota.ts` | EXTEND | endpoint `PUT /admin/users/:id/quota` accepta `{ period, limit_usd_milli \| null }`; serializeaza EUR via FX |
| `backend/src/routes/admin/grants.ts` | NEW | `GET /admin/users/:id/grants`, `POST /admin/users/:id/grants`, `DELETE /admin/grants/:id` |
| `backend/src/routes/admin/usage.ts` | NEW | `GET /admin/usage?from=&to=&groupBy=user|feature` → returneaza USD + EUR convertit |
| `backend/src/routes/user/budget.ts` | NEW | `GET /user/budget/status` (consumat de banner: returneaza `{ usedPct, capUsdMilli, capEurMilli, periodEnd, hasGrantsActive, fxRateUsed }`) |

**EUR conversion helper** (`backend/src/util/fx.ts`)
- `toEurMilli(usdMilli: number, rate: number): number` — `Math.round(usdMilli * rate)`; rate persistat in detail_json al 429 (`fx_rate_used`)
- `getEffectiveRate(): { rate, fetchedAt, isStale } | null` — citeste latest din `fx_rates`; daca lipseste → **returneaza null (fail-closed)**; consumatorii randeaza "EUR indisponibil" cand null. NU exista fallback 0.92 in cod (D14).

**Retry-After SQL pattern** (`quotaGuard` la hard 429):
```sql
-- WINDOW_SECONDS din period: day=86400, week=604800, month=2592000 (D15)
SELECT MIN(ts) AS earliest_ts
FROM ai_usage
WHERE owner_id = ?
  AND feature IN (...aliases_for_quota_feature)  -- e.g. ai.single → dosar_summary, dosar_multi_judge
  AND ts > datetime('now', ?);  -- ? = '-86400 seconds' / '-604800 seconds' / '-2592000 seconds'
```
- Daca `earliest_ts` lipseste (degenerate path, usage la limita) → `Retry-After = 60` ca floor
- Altfel: `retryAfterSeconds = max(60, (earliest_ts_epoch + WINDOW_SECONDS) - now_epoch)`
- Codex C2: NU folosi `secondsUntilUtcMidnight()` ca in implementarea zilnic-calendaristica veche; rolling window cere earliest contributing row

---

## §4 Frontend module map

| Path | Status | Rol |
|------|--------|-----|
| `frontend/src/pages/admin/Quota.tsx` | EXTEND | adauga `<select period>` (day/week/month); checkbox "Fara limita" (NULL); afisare EUR cu rate badge ("curs ECB 2026-05-19") |
| `frontend/src/pages/admin/Grants.tsx` | NEW | tab nou sub `/admin/quota` sau pagina noua; lista grants active per user, modal "Acorda extra" (suma EUR, expirare zile, motiv), buton revoca |
| `frontend/src/pages/admin/Usage.tsx` | NEW | tabel agregat usage curent vs cap pe period; EUR display; export CSV |
| `frontend/src/components/BudgetWarningBanner.tsx` | NEW | top-of-app banner randat in layout cand `/user/budget/status` returneaza `usedPct >= 80`; auto-clear when `usedPct < 80` la urmatorul poll (NO manual dismiss — D16); CTA "Cere extra" trimite `mailto:` admin (out of scope form server-side) |
| `frontend/src/components/Sidebar.tsx` | EXTEND | `adminNavItems` adauga `grants` si `usage` |
| `frontend/src/hooks/useBudgetStatus.ts` | NEW | polling 5min `/user/budget/status` cand authMode=web |
| `frontend/src/lib/eur.ts` | NEW | `formatEur(milli, locale='ro-RO')` |

**Constanta**: rolling window se afiseaza ca "ultimele 7 zile" / "ultimele 30 zile" — fara cuvant "calendar".

**Banner reactivity**: `useBudgetStatus` polls la 5min; banner reflecta state-ul ultimului poll. Nu exista state local persistent in banner — daca server returneaza `usedPct < 80`, banner dispare imediat. Acesta e singurul mecanism de inchidere (D16).

---

## §5 ECB FX fetch design

- **Endpoint**: `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (HTTPS, no auth)
- **Parse**: XML simplu, extract `<Cube currency='USD' rate='X'/>` din `<Cube time='YYYY-MM-DD'>`. Conversie: ECB publica `EUR/USD` (1 EUR = X USD), deci `USD/EUR = 1 / X`. Stocheaza `1/X` cu 6 zecimale.
- **Cron**: 15:00 Europe/Bucharest (16:00 CET ECB publishing window + margin); reuse scheduler-ul existent din monitoring runtime (`backend/src/services/scheduler.ts`).
- **Retry**: 3 incercari la 5 / 15 / 30 minute interval; daca toate esueaza → audit `fx.rate.fetch_failed` cu detail + alerta admin.
- **Weekend / holiday**: ECB nu publica → fetch returneaza acelasi rate ca vineri (rate_date nu se schimba) → cache hit, nici un upsert nou; banner "stale" nu apare pana > 48h fara update nou in zi business.
- **Boot ordering (advisor)**:
  - Server bind pe port 3002 ramane SINCRON; fetch ECB ruleaza async dupa bind, NU blocheaza pornirea.
  - Daca `fx_rates` e gol si fetch initial pica → `getEffectiveRate()` returneaza `null` → fail-closed pe EUR display (D14): API si UI afiseaza USD normal + "EUR indisponibil" in locul valorii EUR. Hard 429 ramane functional (cap-ul logic e in USD milli, EUR e doar display).
  - Audit `fx.rate.fetch_failed` emis la fiecare retry pierdut; cand fetch reuseste, audit `fx.rate.fetched`.
- **Audit detail_json** la 429: `{ feature, usedUsdMilli, capUsdMilli, usedEurMilli: number | null, capEurMilli: number | null, fxRate: number | null, fxDate: string | null, fxSource: 'ecb' }` — campurile EUR sunt `null` cand rate lipseste.

---

## §6 Faze de livrare

| Faza | Continut | Test gate |
|------|----------|-----------|
| **F1** | Migrations 0027-0030 + repositories noi + `fxRatesRepository` (CRUD doar, fara fetcher) | vitest backend per repo + runner migration; type-check |
| **F2** | `quotaGuard` extension (rolling window + unlimited + grants summed) + `aiUsageRepository.sumInWindow` | unit test guard cu 6 scenarios (under, at-80, at-100, unlimited, grant-active, grant-expired) |
| **F3** | ECB fetcher + scheduler hook + boot fail-safe | integration test cu mock fetch (vitest msw); test rate stale > 48h fires banner |
| **F4** | Admin UI: Quota period+unlimited, Grants page, Usage page, EUR display | vitest frontend per pagina; smoke web mode `npm run dev:frontend` |
| **F5** | Soft warning dispatcher (email + banner) + `BudgetWarningBanner` component + audit entries | unit: dispatcher dedup; smoke: setezi cap=100, faci 80 USD usage, primesti email + banner la next API call |

Fiecare faza se inchide cu: biome + tsc + vitest backend + vitest frontend + smoke local. Niciun PR nu pleaca fara cele 4.

**Commit per faza (advisor)**: dupa ce gate-urile trec, commit local imediat (F1 → commit; F2 → commit; …). NU acumula F1-F5 intr-un singur commit final — restorability si bisect-ability cer commits per faza.

---

## §7 Non-regression boundaries (red zone)

- `getAuthMode() !== "web"` → `quotaGuard` returneaza `next()` instant; ZERO query DB, ZERO impact desktop
- ECB fetcher se inregistreaza in scheduler doar daca `getAuthMode() === "web"` (desktop nu face network outbound nemotivat)
- `LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI` (env fallback existent) ramane valid; daca un user n-are override → `effectiveLimit = defaultMilli` (period = `day`, rolling 24h pentru consistenta)
- Audit log NU primeste valori plaintext de chei API (constraint mostenit din v2.30.0)
- Migration 0027 face copy-then-drop ca sa pastreze datele existente din `user_quota_overrides` (period implicit `day` la migrare)
- `rejectApiKeysFromBodyInWebMode` ramane activ (constraint v2.30.0)

---

## §8 Test plan (vitest)

**Backend**

- `userQuotaRepository.test.ts` — extends pe period + NULL limit
- `userQuotaGrantsRepository.test.ts` — sumActive ignora revocate + expirate
- `fxRatesRepository.test.ts` — upsert pe (pair, rate_date), getLatest, staleSince
- `budgetNotificationsRepository.test.ts` — state machine: fire-once / clear / re-fire dupa drop
- `quotaGuard.test.ts` — adauga 6 scenarii noi (rolling, unlimited, grant active, grant expirat, soft trigger, hard 429)
- `fxFetcher.test.ts` — parse ECB XML real (snapshot), 1/X conversie corecta, fallback la stale, retry policy
- `budgetWarningDispatcher.test.ts` — dedup, email SMTP-disabled path (banner-only), trigger doar prima oara

**Frontend**

- `Quota.test.tsx` — UI period select, checkbox unlimited, EUR display
- `Grants.test.tsx` — create + revoke flow
- `BudgetWarningBanner.test.tsx` — render >= 80%, hide < 80%, dismiss action
- `eur.test.ts` — format ro-RO ("12,34 EUR")

**Numar tinta**: +~25 teste backend, +~12 teste frontend.

---

## §9 Deferred — tenant-aggregate cap

**Ce ar fi**: in plus fata de capul per user (X EUR / luna fiecare), un cap pe tenant intreg (Y EUR / luna pentru toata firma). Cazuri tipice:
- Adminul are 8 useri × 50 EUR/luna = 400 EUR/luna cap teoretic, dar nu vrea sa cheltuiasca peste 250 EUR/luna pe firma → `tenant_aggregate_cap = 250 EUR` opreste TOATE call-urile cand suma cumulata pe tenant trece de 250, indiferent de capul individual.

**De ce OUT v2.32.0**:
- Adauga un al doilea strat de guard (per-user AND tenant); double-check pe fiecare request creste latency
- Necesita schema `tenant_config` (sau extensie pe tenant_api_keys) + alta migration
- Nu e blocant pentru launch — adminul poate seta capurile per user agresiv ca workaround

**Intra in**: v2.33.0 sau backlog, dupa observatii operationale 2-4 saptamani.

---

## §10 Open questions ramase (raspuns inainte de code F1)

| # | Intrebare | Default propus |
|---|-----------|----------------|
| Q1 | Email "soft warning" — sender = `SMTP_FROM` existent sau adresa dedicata `budget@<tenant>`? | reuse `SMTP_FROM` |
| Q2 | Banner dismissal — persista per (user, period) sau se reafiseaza la fiecare refresh pana cap se reseteaza? | persista per period (UNIQUE `banner_acked_at`) |
| Q3 | "Cere extra" CTA in banner — `mailto:` doar, sau in-app form catre admin? | `mailto:` in v2.32.0; form in v2.33.0 |
| Q4 | Grants — limit superior per grant (ex. max 200 EUR / grant)? | NU in v2.32.0; constraint doar `extra_usd_milli > 0` |

Daca user spune "default" → continuam asa. Altfel — un singur round de feedback inainte de F1.

---

## §11 Cross-references

- Curs FX folosit la 429: scris in audit `detail_json.fx_rate_used` (cerinta din §5)
- ai_usage history: ramane neschimbat (USD milli); NU se touch-uieste, doar se citeste in fereastra rolling
- Web-readiness bridge (CLAUDE.md): toate query-urile noi prin repository, `owner_id` pe toate tabelele noi (DEFAULT lipsa = explicit owner_id la insert)
- Feedback memory `[[user-dispatches-codex-tasks]]`: dupa ce planul e final, eu scriu prompt-ul Codex intr-un fisier `CODEX-TASK-quota-extension-v2.32.0.md` si userul dispatch-uieste

---

## §12 Acceptance criteria v2.32.0

- [ ] Migrations 0027-0030 reversibile, backfill 0027 nu pierde date din `user_quota_overrides` existent
- [ ] `quotaGuard` raspunde corect la 6 scenarii (vezi F2)
- [ ] ECB fetch trece prima rulare la deploy; banner "stale" apare cand fetch lipseste > 48h
- [ ] Admin UI: poate seta period + unlimited + acorda grant + revoca grant fara reload
- [ ] User cu 80 USD din 100 USD primeste 1 email (nu 5) si vede banner pana la cap reset
- [ ] User cu 100 USD din 100 USD primeste 429 cu `Retry-After` corect pentru period (24h / 7d / 30d ramas)
- [ ] Desktop: `quotaGuard` NU intercepteaza nimic; usage tracking ramane functional
- [ ] Toate audit events scrise; nicio cheie API in detail_json
- [ ] Biome + tsc + vitest backend + vitest frontend toate pass
- [ ] Smoke: web mode → 80%+ banner → 100% 429; desktop → unchanged

---

**Status fisier**: DRAFT pentru review. User dispatch Codex pentru contraperspective, apoi advisor (Claude) pentru reconcile. Cod F1 incepe dupa OK explicit.
