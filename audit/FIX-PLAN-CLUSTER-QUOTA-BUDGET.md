# Plan de Implementare: Cluster Quota + Budget — Legal Dashboard v2.33.0

**Generat**: 2026-05-19
**Target**: `feat/quota-budget-hardening` → v2.33.0
**Scope**: 7 findings (CRITICAL-1, HIGH-4, MEDIUM-1, MEDIUM-3, MEDIUM-8, MEDIUM-9, LOW-3)
**Estimat total**: ~14-16h implementare + ~3h test/review

---

## Ordine de implementare (dependente)

```
MEDIUM-1  →  CRITICAL-1  →  MEDIUM-3  →  MEDIUM-9
                                ↓
                         HIGH-4 + MEDIUM-8 + LOW-3  (batch — schema comuna 0031)
```

Rationale: MEDIUM-1 stabileste enum-ul `QUOTA_FEATURES` care este importat de CRITICAL-1. HIGH-4, MEDIUM-8 si LOW-3 impart acelasi migration (0031 pe `budget_notifications`) si acelasi fisier de service, deci se implementeaza impreuna ca un singur bloc.

---

## MEDIUM-1 — Enum `feature` in loc de free-form string

**Estimat**: 1.5h | **Regresie desktop**: ZERO (enum backward-compatible, desktop nu are quota in web-mode)

### Problema

`UpsertQuotaSchema` si `CreateGrantSchema` accepta orice string. Admin scrie `"ai_usd"` in loc de `"ai.single"` — grant exista in DB dar `quotaGuard` nu il vede.

### Plan

Defineste `QUOTA_FEATURES` co-locat in `quotaGuard.ts` (co-locatie cu consumerul principal), re-exportat din acolo si importat de `admin.ts` si `budgetWarningService.ts`.

#### `backend/src/middleware/quotaGuard.ts` — adaugare enum

```typescript
// Inainte de `export type QuotaFeature`:

// Canonical feature set — single source of truth consumat de quotaGuard,
// admin route schemas si budgetWarningService. Extensia cere adaugare DOAR
// aici + migration care largeste CHECK in user_quota_overrides/grants.
export const QUOTA_FEATURES = ["ai.single", "ai.multi"] as const;
export type QuotaFeature = (typeof QUOTA_FEATURES)[number];
```

#### `backend/src/routes/admin.ts` — modificare `UpsertQuotaSchema` (linia 109-120) si `CreateGrantSchema` (linia 126-137)

```typescript
// Inainte (linia 111):
feature: z.string().trim().min(1).max(80),

// Dupa — in UpsertQuotaSchema:
import { QUOTA_FEATURES } from "../middleware/quotaGuard.ts";
// ...
feature: z.enum(QUOTA_FEATURES),
```

```typescript
// Inainte (linia 128):
feature: z.string().trim().min(1).max(80),

// Dupa — in CreateGrantSchema:
feature: z.enum(QUOTA_FEATURES),
```

#### `backend/src/services/budgetWarningService.ts` — inlocuire `QuotaFeature` local

```typescript
// Stergere linia 24:
export type QuotaFeature = "ai.single" | "ai.multi";

// Adaugare import:
import { type QuotaFeature } from "../middleware/quotaGuard.ts";
// Tipul QuotaFeature ramane acelasi; re-exportul din budgetWarningService.ts
// se pastreaza (alte fisiere pot importa de acolo):
export type { QuotaFeature };
```

**Nu este nevoie de migration SQL** — CHECK-ul existent pe `feature TEXT NOT NULL CHECK(length(feature) > 0)` ramane; validarea enum se face la nivel Zod inainte de orice INSERT.

#### Test plan MEDIUM-1

1. `PUT /api/v1/admin/users/:id/quota` cu `feature: "ai_usd"` → 400 cu mesaj Zod enum
2. `PUT /api/v1/admin/users/:id/quota` cu `feature: "ai.single"` → 200
3. `POST /api/v1/admin/users/:id/grants` cu `feature: "INVALID"` → 400
4. Tip TypeScript: `QUOTA_FEATURES` exportat si utilizat in toate cele 3 fisiere fara `as const` cast duplicat
5. Vitest: un test de schema unit care ruleaza `UpsertQuotaSchema.safeParse({ feature: "ai.single", limitUsdMilli: 100 })` → `success: true` si `UpsertQuotaSchema.safeParse({ feature: "ai_usd", limitUsdMilli: 100 })` → `success: false`

---

## CRITICAL-1 — Burst TOCTOU race in quotaGuard

**Estimat**: 5h | **Regresie desktop**: ZERO — reservation path gated pe `getAuthMode() === "web"`, desktop continua path-ul curent fara modificari

### Analiza optiuni

**Optiunea B (sync write before c.json)** NU inchide rasa. Fereastra de race nu este microtask-ul (microsecunde), ci durata call-ului AI (secunde). Secventa reala:

```
T+0ms:  Req1 quotaGuard read → sum=$4 (cap $5) → PASS
T+1ms:  Req2 quotaGuard read → sum=$4 (Req1 nu a scris inca nimic) → PASS
T+1ms..T+5s: ambele fac call AI in paralel
T+5s:   Req1 scrie $1 → sum=$5
T+5s+1: Req2 scrie $1 → sum=$6  ← OVERSHOOT cu 20%
```

Mutand scrierile din microtask in sync-before-c.json(), ambele scrieri tot se intampla DUPA ambele citiri. Optiunea B nu rezolva problema.

**Optiunea A (reservation row cu BEGIN IMMEDIATE)** este singura care inchide rasa. La momentul check-ului, `quotaGuard` insereaza un row `status='pending'` in aceeasi tranzactie cu citirea, astfel incat urmatoarele request-uri vor vedea rezervarea in suma.

### Decizie: Optiunea A cu `status` pe tabela `ai_usage`

Rezervarile merg in `ai_usage` cu un nou camp `status`, astfel `sumAiUsageMilliInWindow` le include automat fara modificari la query.

### Migration SQL: `0032_ai_usage_reservation.up.sql`

**Nota**: 0031 este rezervat pentru batch-ul budget_notifications (HIGH-4+MEDIUM-8+LOW-3). 0032 merge pe ai_usage.

**Fisier**: `backend/src/db/migrations/0032_ai_usage_reservation.up.sql`

```sql
-- 0032_ai_usage_reservation.up.sql - v2.33.0 quota guard reservation support.
--
-- Adauga status='pending'|'confirmed' pe ai_usage pentru a suporta
-- reservation pattern in quotaGuard (web mode). Desktop mode scrie mereu
-- status='confirmed' (default). Pending rows expirate sunt cleanup-ate
-- de scheduler la fiecare ciclu (> RESERVATION_EXPIRE_SECONDS).
--
-- estimated_cost_usd_milli: costul estimat la momentul rezervarii
-- (upper bound per feature). Folosit de sumAiUsageMilliInWindow cand
-- status='pending' (costul real va suprascrie la confirmare).

ALTER TABLE ai_usage ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'
  CHECK(status IN ('pending', 'confirmed'));

ALTER TABLE ai_usage ADD COLUMN estimated_cost_usd_milli INTEGER;

-- Index partial pentru cleanup rapid al rezervarilor expirate.
CREATE INDEX idx_ai_usage_pending
  ON ai_usage(owner_id, ts)
  WHERE status = 'pending';
```

**Fisier**: `backend/src/db/migrations/0032_ai_usage_reservation.down.sql`

```sql
-- 0032_ai_usage_reservation.down.sql
-- Runner-ul nu auto-executa *.down.sql.
DROP INDEX IF EXISTS idx_ai_usage_pending;
-- SQLite nu suporta DROP COLUMN inainte de 3.35.0.
-- Downgrade: restaurare din backup sau recreare tabela.
-- In productie, rollback = restore DB din snapshot pre-migration.
```

### `backend/src/db/aiUsageRepository.ts` — functii noi

Adauga dupa functia `insertAiUsage` existenta:

```typescript
// ---- Reservation pattern (web mode quota guard) ----

export interface InsertReservationInput {
  ownerId: string;
  feature: string;
  estimatedCostUsdMilli: number;
  requestId?: string | null;
}

// Insereaza row pending cu costul estimat. Returneaza id-ul rezervarii
// pentru confirmare ulterioara. TREBUIE apelata din interiorul unei
// tranzactii BEGIN IMMEDIATE (asigurata de quotaGuard).
export function insertAiUsageReservation(input: InsertReservationInput): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO ai_usage
         (owner_id, ts, provider, model, feature, input_tokens, output_tokens,
          cost_usd_milli, estimated_cost_usd_milli, status, request_id)
       VALUES (?, ?, 'unknown', 'pending', ?, 0, 0, ?, ?, 'pending', ?)`
    )
    .run(
      input.ownerId,
      new Date().toISOString(),
      input.feature,
      input.estimatedCostUsdMilli,
      input.estimatedCostUsdMilli,
      input.requestId ?? null
    );
  return Number(info.lastInsertRowid);
}

// Confirma rezervarea cu datele reale. Apelata de recordAiUsageSafely
// dupa ce call-ul AI s-a terminat.
export function confirmAiUsageReservation(
  reservationId: number,
  real: {
    provider: AiUsageProvider;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsdMilli: number;
    httpStatus: number | null;
    wasAborted: boolean;
    routingTag: AiUsageRoutingTag | null;
  }
): void {
  getDb()
    .prepare(
      `UPDATE ai_usage
       SET status = 'confirmed',
           provider = ?,
           model = ?,
           input_tokens = ?,
           output_tokens = ?,
           cost_usd_milli = ?,
           http_status = ?,
           was_aborted = ?,
           routing_tag = ?
       WHERE id = ? AND status = 'pending'`
    )
    .run(
      real.provider,
      real.model,
      real.inputTokens,
      real.outputTokens,
      real.costUsdMilli,
      real.httpStatus,
      real.wasAborted ? 1 : 0,
      real.routingTag ?? null,
      reservationId
    );
}

// Cleanup rezervari expirate (status='pending' mai vechi de N secunde).
// Apelata de scheduler zilnic sau la fiecare ciclu (5min interval).
// Returneaza numarul de rows sterse.
export const RESERVATION_EXPIRE_SECONDS = 300; // 5 minute = upper bound call AI

export function purgeExpiredReservations(): number {
  const cutoff = new Date(Date.now() - RESERVATION_EXPIRE_SECONDS * 1000).toISOString();
  const info = getDb()
    .prepare(
      `DELETE FROM ai_usage
       WHERE status = 'pending' AND ts < ?`
    )
    .run(cutoff);
  return info.changes;
}
```

### `backend/src/middleware/quotaGuard.ts` — reservation transaction

Importa functiile noi si adauga helper:

```typescript
import { getDb } from "../db/schema.ts";
import {
  earliestAiUsageTsInWindow,
  insertAiUsageReservation,
  sumAiUsageMilliInWindow,
} from "../db/aiUsageRepository.ts";
```

Adauga dupa `PERIOD_SECONDS`:

```typescript
// Upper-bound cost per feature pentru reservation. Folosit in quotaGuard
// pentru a rezerva spatiu in fereastra inainte de call-ul AI real.
// Trebuie sa fie >= orice call real posibil; eroare pe partea conservativa
// (overshoot la estimat) e mai sigura decat undershoot (bypass quota).
// Valorile = cost worst-case per feature = modelul cel mai scump * max_tokens
// per call (approximat). Ajustat manual la upgrade de modele.
const FEATURE_ESTIMATED_COST_MILLI: Record<QuotaFeature, number> = {
  "ai.single": 2_000,  // ~$2 worst-case: claude-opus-4.6 cu ~25k tokens output
  "ai.multi":  8_000,  // ~$8 worst-case: 5 analisti * claude-opus-4.6 * ~10k tokens
};
```

Modifica functia `quotaGuard` — replace blocul dupa `if (effectiveLimit === 0 || ...)` (liniile 66-83) cu varianta cu reservation:

```typescript
export function quotaGuard(feature: QuotaFeature) {
  return async (c: Context, next: Next) => {
    if (getAuthMode() !== "web") return next();
    const ownerId = getOwnerId(c);
    const override = getOverride(ownerId, feature);
    const defaultMilli = readDefaultQuotaMilli();

    const period: QuotaPeriod = override?.period ?? "day";
    const windowSeconds = PERIOD_SECONDS[period];

    const baseLimit = override ? override.limit_usd_milli : defaultMilli;
    if (baseLimit === null) return next();

    const extraFromGrants = sumActiveExtraMilli(ownerId, feature);
    const effectiveLimit = baseLimit + extraFromGrants;

    const estimatedCost = FEATURE_ESTIMATED_COST_MILLI[feature];

    // BEGIN IMMEDIATE: obtine write lock inainte de citire + rezervare.
    // Previne TOCTOU — N cereri concurente nu pot citi aceeasi valoare
    // si trece toate; fiecare trebuie sa astepte randul sau la lock.
    // better-sqlite3: .transaction().immediate() aplica BEGIN IMMEDIATE.
    let reservationId: number | null = null;
    let blocked = false;

    const db = getDb();
    const reserveTransaction = db.transaction(() => {
      const usedMilli = sumAiUsageMilliInWindow(ownerId, feature, windowSeconds);
      if (effectiveLimit === 0 || usedMilli + estimatedCost > effectiveLimit) {
        blocked = true;
        return;
      }
      reservationId = insertAiUsageReservation({
        ownerId,
        feature,
        estimatedCostUsdMilli: estimatedCost,
        requestId: c.get("requestId") ?? null,
      });
    });

    // .immediate() = BEGIN IMMEDIATE; asigura serialization la nivel SQLite
    // write-lock. Nu folosim .exclusive() pentru a nu bloca reader-ii.
    reserveTransaction.immediate();

    if (blocked) {
      const retryAfter = retryAfterSecondsForWindow(ownerId, feature, windowSeconds);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        fail(ErrorCodes.QUOTA_EXCEEDED, `Bugetul pentru ${feature} a fost depasit. Contacteaza adminul.`, c, {
          limitMilli: effectiveLimit,
          baseLimitMilli: baseLimit,
          extraFromGrantsMilli: extraFromGrants,
          period,
          feature,
          source: override ? "override" : "default",
        }),
        429
      );
    }

    // Stocheaza reservationId in context pentru confirmare de catre
    // recordAiUsageSafely dupa call-ul AI.
    c.set("quotaReservationId", reservationId);
    c.set("quotaFeature", feature);
    return next();
  };
}
```

**Nota privind `.immediate()`**: better-sqlite3 expune `db.transaction(fn)` care returneaza o functie cu proprietatile `.default()`, `.deferred()`, `.immediate()`, `.exclusive()`. Apelul corect este:

```typescript
db.transaction(() => { ... }).immediate();
```

Aceasta genereaza `BEGIN IMMEDIATE` la nivel SQL, obtinand write-lock inainte de prima citire din tranzactie.

### `backend/src/services/aiUsage.ts` — confirmare rezervare in loc de insert nou

Modifica `recordAiUsageSafely` pentru a distinge calea web-cu-reservation de calea desktop-fara-reservation:

```typescript
import {
  insertAiUsage,
  confirmAiUsageReservation,
  type AiUsageProvider,
  type AiUsageRoutingTag,
} from "../db/aiUsageRepository.ts";

// Adauga camp optional in AiUsageTrackingContext:
export interface AiUsageTrackingContext {
  ownerId: string;
  feature: string;
  requestId?: string;
  // Web mode: ID-ul rezervarii create de quotaGuard. NULL = desktop sau
  // feature fara quota guard (ex. monitoring).
  reservationId?: number | null;
}
```

In `recordAiUsageSafely`, modifica corpul `queueMicrotask`:

```typescript
queueMicrotask(() => {
  try {
    const rid = tracking.reservationId;

    if (rid != null) {
      // Web mode cu reservation: confirma row-ul existent cu datele reale.
      // Nu insereaza row nou — evita dublu-counting.
      confirmAiUsageReservation(rid, {
        provider,
        model,
        inputTokens,
        outputTokens,
        costUsdMilli,
        httpStatus,
        wasAborted: wasAborted ?? false,
        routingTag: routingTag ?? null,
      });
    } else {
      // Desktop mode sau feature fara quota guard: insert direct (comportament curent).
      insertAiUsage({
        ownerId: tracking.ownerId,
        provider,
        model,
        feature: tracking.feature,
        inputTokens,
        outputTokens,
        costUsdMilli,
        httpStatus,
        wasAborted,
        requestId: tracking.requestId,
        routingTag,
      });
    }

    if (getAuthMode() === "web") {
      checkBudgetWarning(tracking.ownerId, tracking.feature).catch((warnErr) => {
        console.warn(
          JSON.stringify({
            action: "budget_warning.check_failed",
            owner_id: tracking.ownerId,
            feature: tracking.feature,
            error: warnErr instanceof Error ? warnErr.message : String(warnErr),
            ts: new Date().toISOString(),
          })
        );
      });
    }
  } catch (e) {
    console.warn(
      JSON.stringify({
        action: "ai_usage.persist_failed",
        provider,
        model,
        feature: tracking.feature,
        owner_id: tracking.ownerId,
        request_id: tracking.requestId ?? null,
        error: e instanceof Error ? e.message : String(e),
        ts: new Date().toISOString(),
      })
    );
  }
});
```

### Cum ajunge `reservationId` in `tracking`

In handler-ul AI (ex. `backend/src/routes/ai.ts`), cand construieste `AiUsageTrackingContext`:

```typescript
// Inainte (pattern curent):
const tracking: AiUsageTrackingContext = {
  ownerId,
  feature: "dosar_summary",
  requestId: c.get("requestId"),
};

// Dupa:
const tracking: AiUsageTrackingContext = {
  ownerId,
  feature: "dosar_summary",
  requestId: c.get("requestId"),
  reservationId: c.get("quotaReservationId") ?? null,
};
```

Aceasta pattern trebuie aplicata in toate endpoint-urile AI protejate de `quotaGuard`. Grep pentru `AiUsageTrackingContext` sau `recordAiUsageSafely` pentru a le gasi.

### Scheduler cleanup rezervari expirate

In `backend/src/services/monitoring/scheduler.ts`, adauga la ciclul de purge zilnic:

```typescript
import { purgeExpiredReservations } from "../../db/aiUsageRepository.ts";

// In blocul de purge (similar cu purgeOldRuns / purgeOldAiUsage):
const expiredReservations = purgeExpiredReservations();
if (expiredReservations > 0) {
  console.log(JSON.stringify({
    action: "scheduler.purge_expired_reservations",
    count: expiredReservations,
    ts: new Date().toISOString(),
  }));
}
```

Sau, daca e preferabil, adauga un interval separat la fiecare 5 minute:

```typescript
setInterval(() => {
  const n = purgeExpiredReservations();
  if (n > 0) {
    console.log(JSON.stringify({ action: "quota.reservation_purge", count: n, ts: new Date().toISOString() }));
  }
}, 5 * 60 * 1000);
```

### Edge cases CRITICAL-1

**E1 — Handler AI arunca exceptie inainte de call**: `recordAiUsageSafely` nu este apelat → rezervarea ramane `pending`. Va fi curatata de scheduler dupa 5 minute. Fara impact financiar (nu s-a consumat nimic real), dar `sumAiUsageMilliInWindow` va contoriza `estimatedCost` timp de max 5 minute.

**E2 — `confirmAiUsageReservation` cu id gresit / rezervare stearsa deja**: `UPDATE ... WHERE id = ? AND status = 'pending'` → 0 rows changed. Nu arunca exceptie. Row-ul real nu se scrie → cost real pierdut din statistici pentru acel request. Acceptabil (pierdere upstream a unui singur call, nu overshoot).

**E3 — Process crash intre reservation si confirmare**: Rezervarile `pending` raman in DB. La urmatorul start, scheduler-ul le va curata dupa `RESERVATION_EXPIRE_SECONDS`. Timp de curatare: max 5 minute de inflatie artificiala a sumei.

**E4 — Desktop mode cu `reservationId=null`**: Blocul `if (rid != null)` merge pe calea `insertAiUsage` veche. Zero modificare comportament desktop.

**E5 — `sumAiUsageMilliInWindow` include pending rows**: DA, intentionat. Query-ul nu filtreaza pe `status`. Acesta este comportamentul corect — pending rows reprezinta cheltuiala rezervata care trebuie sa conteze la verificarea cap-ului.

### Test plan CRITICAL-1

1. **Unit** — `insertAiUsageReservation` + `confirmAiUsageReservation` + `purgeExpiredReservations` in `aiUsageRepository.test.ts`
2. **Unit** — `quotaGuard` cu mock `getAuthMode()="web"`: verify `db.transaction().immediate()` este apelat
3. **Integration** — 10 request-uri concurente la 90% utilizare → suma finala <= cap (0% overshoot)
4. **Desktop path** — `getAuthMode()="desktop"` → `next()` direct, zero writes la `ai_usage` din guard
5. **Expiry cleanup** — insereaza 3 pending rows cu `ts = now - 6min`, apeleaza `purgeExpiredReservations()` → 3 rows sterse
6. **Stress test** (CI optional) — `wrk -c 100 -d 10s /api/v1/ai/...` cu cap $5 la $4 folositi → niciun request confirmat nu depaseste $5

---

## MEDIUM-3 — LIMIT 200 pe repository queries

**Estimat**: 30min | **Regresie desktop**: ZERO

### Problema

`listGrantsForUser` (linia 57 in `userQuotaGrantsRepository.ts`) si `listOverridesForUser` (linia 52 in `userQuotaRepository.ts`) nu au LIMIT. La poll UI frecvent → N query/s fara bound.

### Fix

#### `backend/src/db/userQuotaGrantsRepository.ts` — linia 56-63

```typescript
// Inainte:
export function listGrantsForUser(userId: string): QuotaGrantRow[] {
  return getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM user_quota_grants
       WHERE user_id = ?
       ORDER BY granted_at DESC, id DESC`
    )
    .all(userId) as QuotaGrantRow[];
}

// Dupa:
export function listGrantsForUser(userId: string, limit = 200): QuotaGrantRow[] {
  return getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM user_quota_grants
       WHERE user_id = ?
       ORDER BY granted_at DESC, id DESC
       LIMIT ?`
    )
    .all(userId, limit) as QuotaGrantRow[];
}
```

#### `backend/src/db/userQuotaRepository.ts` — linia 52-59

```typescript
// Inainte:
export function listOverridesForUser(userId: string): QuotaOverrideRow[] {
  return getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM user_quota_overrides
       WHERE user_id = ?
       ORDER BY feature ASC`
    )
    .all(userId) as QuotaOverrideRow[];
}

// Dupa:
export function listOverridesForUser(userId: string, limit = 200): QuotaOverrideRow[] {
  return getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM user_quota_overrides
       WHERE user_id = ?
       ORDER BY feature ASC
       LIMIT ?`
    )
    .all(userId, limit) as QuotaOverrideRow[];
}
```

**Nu este nevoie de migration SQL** — modificare query only.

**Nota de scop**: Refactorizarea `/me/budget` la single aggregating SQL (mentionata in finding) este un task separat, NU in acest cluster. Adauga in backlog ca `MEDIUM-3b`.

### Test plan MEDIUM-3

1. Insereaza 250 grants pentru acelasi user → `listGrantsForUser(userId)` returneaza exact 200
2. Idem pentru `listOverridesForUser`
3. `listGrantsForUser(userId, 300)` → returneaza toate 250 (limit parametrizat)

---

## MEDIUM-9 — Grant `expires_at` fara upper bound

**Estimat**: 30min | **Regresie desktop**: ZERO

### Problema

Admin poate seta `expires_at = "2099-12-31"` → grant practic perpetuu.

### Fix

#### `backend/src/routes/admin.ts` — `CreateGrantSchema` (linia 126-137)

Adauga al doilea `.refine()` dupa cel existent:

```typescript
const MAX_GRANT_DURATION_SECONDS = 365 * 24 * 60 * 60; // 1 an

const CreateGrantSchema = z
  .object({
    feature: z.enum(QUOTA_FEATURES),
    extraUsdMilli: z.number().int().min(1).max(1_000_000_000),
    expiresAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().max(200).optional(),  // 200, nu 500 — vezi LOW-1
  })
  .strict()
  .refine((v) => Date.parse(v.expiresAt) > Date.now(), {
    message: "expiresAt trebuie sa fie in viitor",
    path: ["expiresAt"],
  })
  .refine(
    (v) => Date.parse(v.expiresAt) <= Date.now() + MAX_GRANT_DURATION_SECONDS * 1000,
    {
      message: `expiresAt nu poate depasi ${MAX_GRANT_DURATION_SECONDS / 86400} zile de la creare`,
      path: ["expiresAt"],
    }
  );
```

**Nu este nevoie de migration SQL**.

### Test plan MEDIUM-9

1. `POST /grants` cu `expiresAt = now + 364 zile` → 201
2. `POST /grants` cu `expiresAt = now + 366 zile` → 400 cu mesaj clar
3. `POST /grants` cu `expiresAt = "2099-12-31T23:59:59Z"` → 400

---

## Batch HIGH-4 + MEDIUM-8 + LOW-3 — Budget notifications hardening

**Estimat**: 4h | **Regresie desktop**: ZERO — `checkBudgetWarning` este apelat doar in `getAuthMode() === "web"` (linia 175 in `aiUsage.ts`)

### Migration SQL: `0031_budget_notifications_retry.up.sql`

**Fisier**: `backend/src/db/migrations/0031_budget_notifications_retry.up.sql`

```sql
-- 0031_budget_notifications_retry.up.sql - v2.33.0 budget warning hardening.
--
-- Trei probleme rezolvate printr-o singura migratie:
--
-- HIGH-4 (SMTP retry): adauga email_attempts (INT) si last_email_attempted_at
--   (TEXT) pentru a permite retry-uri cu backoff exponential. Episode activ cu
--   email_sent_at IS NULL si email_attempts < 4 va fi re-incercat. Backoff:
--   60s, 300s, 900s, 3600s.
--
-- MEDIUM-8 (cooldown anti-spam): last_email_attempted_at NU este resetat de
--   clearWarning() — supravietuieste ciclului cleared/re-fired si serveste ca
--   cooldown gate. Re-fire dupa un clear verifica: now - last_email_attempted_at
--   >= 3600s inainte de a trimite email nou.
--
-- LOW-3 (audit row): audit_log row la budget.warning.fired este un write
--   aplicatie (budgetWarningService.ts), nu necesita schema change.

ALTER TABLE budget_notifications ADD COLUMN email_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budget_notifications ADD COLUMN last_email_attempted_at TEXT;

-- Index pentru retry scheduler: episode active cu email neprimit si retry pending.
CREATE INDEX idx_budget_notifications_retry
  ON budget_notifications(user_id, feature, last_email_attempted_at)
  WHERE fired_at IS NOT NULL AND cleared_at IS NULL AND email_sent_at IS NULL;
```

**Fisier**: `backend/src/db/migrations/0031_budget_notifications_retry.down.sql`

```sql
-- 0031_budget_notifications_retry.down.sql
DROP INDEX IF EXISTS idx_budget_notifications_retry;
-- SQLite < 3.35.0 nu suporta DROP COLUMN; rollback = restore din backup.
```

### `backend/src/db/budgetNotificationsRepository.ts` — functii noi si modificari

#### Modificare interfata `BudgetNotificationRow`

```typescript
// Adauga campuri noi:
export interface BudgetNotificationRow {
  user_id: string;
  feature: string;
  threshold_pct: number;
  above_threshold_since: string | null;
  fired_at: string | null;
  email_sent_at: string | null;
  cleared_at: string | null;
  updated_at: string;
  // v2.33.0 HIGH-4 / MEDIUM-8:
  email_attempts: number;
  last_email_attempted_at: string | null;
}

// Actualizeaza COLUMNS:
const COLUMNS =
  "user_id, feature, threshold_pct, above_threshold_since, fired_at, email_sent_at, " +
  "cleared_at, updated_at, email_attempts, last_email_attempted_at";
```

#### Modificare `clearWarning` — NU reseteaza `last_email_attempted_at`

```typescript
// Query-ul ramane neschimbat; documentatia inline e adaugata:
export function clearWarning(userId: string, feature: string, thresholdPct: number): boolean {
  assertFeature(feature);
  assertThreshold(thresholdPct);
  const info = getDb()
    .prepare(
      `UPDATE budget_notifications
         SET cleared_at = datetime('now'),
             above_threshold_since = NULL,
             fired_at = NULL,
             email_sent_at = NULL,
             updated_at = datetime('now')
             -- email_attempts si last_email_attempted_at intentionat neatinse:
             -- supravietuiesc clearului ca memoria de cooldown anti-spam.
       WHERE user_id = ? AND feature = ? AND threshold_pct = ?
         AND fired_at IS NOT NULL AND cleared_at IS NULL`
    )
    .run(userId, feature, thresholdPct);
  return info.changes > 0;
}
```

#### Functie noua `incrementEmailAttempt`

```typescript
// Incrementeaza contorul de incercari si seteaza last_email_attempted_at.
// Apelata INAINTE de fiecare tentativa de trimitere email (success sau fail).
// Conditie: fired_at IS NOT NULL AND cleared_at IS NULL (episode activ).
export function incrementEmailAttempt(userId: string, feature: string, thresholdPct: number): boolean {
  assertFeature(feature);
  assertThreshold(thresholdPct);
  const info = getDb()
    .prepare(
      `UPDATE budget_notifications
         SET email_attempts = email_attempts + 1,
             last_email_attempted_at = datetime('now'),
             updated_at = datetime('now')
       WHERE user_id = ? AND feature = ? AND threshold_pct = ?
         AND fired_at IS NOT NULL AND cleared_at IS NULL`
    )
    .run(userId, feature, thresholdPct);
  return info.changes > 0;
}
```

#### Functie noua `selectPendingEmailRetries`

```typescript
// Backoff schedule: [60, 300, 900, 3600] secunde dupa fiecare attempt.
// Attempt 0: nu a mai incercat -> retryable imediat daca fired_at e recenta.
// Attempt N: backoff[N-1] secunde dupa last_email_attempted_at.
// Dupa 4 attempt-uri (backoff[3] = 3600s, 1h) -> nu mai incearca automat.
export const EMAIL_RETRY_BACKOFF_SECONDS = [60, 300, 900, 3600] as const;
export const EMAIL_MAX_ATTEMPTS = EMAIL_RETRY_BACKOFF_SECONDS.length;

export interface PendingEmailRetry {
  userId: string;
  feature: string;
  thresholdPct: number;
}

// Returneaza episode-urile active cu email_sent_at IS NULL si retry pending
// (backoff-ul a trecut). LIMIT 50 pentru a evita burst de email la repornire.
export function selectPendingEmailRetries(now: Date = new Date()): PendingEmailRetry[] {
  const rows = getDb()
    .prepare(
      `SELECT user_id, feature, threshold_pct,
              email_attempts, last_email_attempted_at
       FROM budget_notifications
       WHERE fired_at IS NOT NULL
         AND cleared_at IS NULL
         AND email_sent_at IS NULL
         AND email_attempts < ?
       ORDER BY fired_at ASC
       LIMIT 50`
    )
    .all(EMAIL_MAX_ATTEMPTS) as Array<{
      user_id: string;
      feature: string;
      threshold_pct: number;
      email_attempts: number;
      last_email_attempted_at: string | null;
    }>;

  const nowMs = now.getTime();
  return rows
    .filter((r) => {
      if (r.last_email_attempted_at === null) return true; // niciodata incercat
      const lastMs = Date.parse(r.last_email_attempted_at);
      if (Number.isNaN(lastMs)) return true;
      const backoffIdx = Math.min(r.email_attempts - 1, EMAIL_RETRY_BACKOFF_SECONDS.length - 1);
      const backoffMs = EMAIL_RETRY_BACKOFF_SECONDS[backoffIdx] * 1000;
      return nowMs - lastMs >= backoffMs;
    })
    .map((r) => ({
      userId: r.user_id,
      feature: r.feature,
      thresholdPct: r.threshold_pct,
    }));
}
```

### `backend/src/services/budgetWarningService.ts` — cooldown + retry + audit

#### Modificare `checkBudgetWarning` — adauga cooldown gate pe email

Constante noi la top:
```typescript
const EMAIL_COOLDOWN_SECONDS = 3600; // 1h intre re-fire-uri (MEDIUM-8)
```

In `checkBudgetWarning`, dupa `const fired = fireWarning(...)`:

```typescript
const fired = fireWarning({ userId: ownerId, feature: quotaFeature, thresholdPct: WARNING_THRESHOLD_PCT });
if (!fired) {
  return { state: "noop", pct };
}

// LOW-3: audit row la fire nou de episode.
// recordAudit(null, ...) = context-less path (no HTTP request context here).
recordAudit(null, "budget.warning.fired", {
  ownerId,
  actorId: "system",
  detail: {
    feature: quotaFeature,
    thresholdPct: WARNING_THRESHOLD_PCT,
    pct: Math.round(pct),
    usedMilli,
    effectiveLimit,
    period,
  },
});

// MEDIUM-8: cooldown gate — verifica daca a mai fost trimis email recent.
// Folosim last_email_attempted_at (supravietuieste clear-ului) nu email_sent_at
// (resetat la clear). Previne spam la oscilatie 79%/81%.
const now = options.now ?? new Date();
const currentState = getState(ownerId, quotaFeature, WARNING_THRESHOLD_PCT);
const cooldownActive =
  currentState?.last_email_attempted_at != null &&
  now.getTime() - Date.parse(currentState.last_email_attempted_at) < EMAIL_COOLDOWN_SECONDS * 1000;

if (cooldownActive) {
  return { state: "fired", pct, emailDispatched: false };
}

// HIGH-4: incrementeaza contorul INAINTE de trimitere (chiar daca esueaza).
incrementEmailAttempt(ownerId, quotaFeature, WARNING_THRESHOLD_PCT);

const emailDispatched = await dispatchWarningEmail(
  ownerId,
  quotaFeature,
  { usedMilli, effectiveLimit, period, pct },
  options.sendEmail ?? sendComposedEmail,
  now
);

return { state: "fired", pct, emailDispatched };
```

#### Import `recordAudit` si `incrementEmailAttempt` in `budgetWarningService.ts`

```typescript
import { recordAudit } from "../db/auditRepository.ts";
import {
  clearWarning,
  fireWarning,
  getState,
  incrementEmailAttempt,
  isWarningActive,
  markEmailSent,
  selectPendingEmailRetries,
} from "../db/budgetNotificationsRepository.ts";
```

### Retry scheduler — apel periodic

In `backend/src/services/monitoring/scheduler.ts` sau intr-un interval dedicat in `backend/src/index.ts`:

```typescript
import { selectPendingEmailRetries } from "../db/budgetNotificationsRepository.ts";
import { checkBudgetWarningRetry } from "../services/budgetWarningService.ts";

setInterval(async () => {
  if (getAuthMode() !== "web") return;
  const pending = selectPendingEmailRetries();
  for (const p of pending) {
    await checkBudgetWarningRetry(p.userId, p.feature, p.thresholdPct).catch((err) => {
      console.warn(JSON.stringify({
        action: "budget_warning.retry_failed",
        userId: p.userId,
        feature: p.feature,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }));
    });
  }
}, 2 * 60 * 1000);
```

Adauga in `budgetWarningService.ts` functia `checkBudgetWarningRetry`:

```typescript
// Retry explicit pentru episode activ cu email_sent_at IS NULL.
// Apelat de scheduler, NU de hot path. Re-trimite email daca backoff-ul a trecut.
export async function checkBudgetWarningRetry(
  ownerId: string,
  usageFeature: string,
  thresholdPct: number,
  options: CheckBudgetWarningOptions = {}
): Promise<CheckBudgetWarningResult> {
  const quotaFeature = quotaFeatureOf(usageFeature);
  if (!quotaFeature) return { state: "skipped", reason: "not_quota_feature" };

  const state = getState(ownerId, quotaFeature, thresholdPct);
  if (!state || state.fired_at === null || state.cleared_at !== null || state.email_sent_at !== null) {
    return { state: "noop" };
  }

  // Re-calculeaza context curent pentru email (valorile se pot fi schimbat).
  const override = getOverride(ownerId, quotaFeature);
  const defaultMilli = readDefaultQuotaMilli();
  const baseLimit = override ? override.limit_usd_milli : defaultMilli;
  if (baseLimit === null) return { state: "skipped", reason: "unlimited" };

  const period: QuotaPeriod = override?.period ?? "day";
  const extraFromGrants = sumActiveExtraMilli(ownerId, quotaFeature);
  const effectiveLimit = baseLimit + extraFromGrants;
  const usedMilli = sumAiUsageMilliInWindow(ownerId, quotaFeature, PERIOD_SECONDS[period]);
  const pct = (usedMilli / effectiveLimit) * 100;

  // Daca pct a scazut sub 80% intre timp, clear episode.
  if (pct < WARNING_THRESHOLD_PCT) {
    clearWarning(ownerId, quotaFeature, thresholdPct);
    return { state: "cleared", pct };
  }

  // Incrementeaza si trimite.
  incrementEmailAttempt(ownerId, quotaFeature, thresholdPct);
  const emailDispatched = await dispatchWarningEmail(
    ownerId,
    quotaFeature,
    { usedMilli, effectiveLimit, period, pct },
    options.sendEmail ?? sendComposedEmail,
    options.now ?? new Date()
  );

  return { state: "noop", pct, emailDispatched };
}
```

### Edge cases batch HIGH-4+MEDIUM-8+LOW-3

**E1 — Process crash intre `incrementEmailAttempt` si `dispatchWarningEmail`**: `email_attempts` este deja incrementat, `email_sent_at` ramane NULL. La urmatorul retry, backoff-ul va tine cont de `last_email_attempted_at`. Comportament corect: nu trimite imediat dupa restart, respecta backoff-ul.

**E2 — Oscilatie 79%/81% in acelasi minut**: Prima traversare la 80% → `fired=true` + `incrementEmailAttempt` + email trimis + `last_email_attempted_at=now`. Scadere la 79% → `clearWarning` (email_attempts si last_email_attempted_at raman). Re-urcare la 80% → `fireWarning` → `fired=true` → cooldown gate: `now - last_email_attempted_at < 3600s` → `emailDispatched=false`. Banner se re-arata, email NU se re-trimite pana la 1h.

**E3 — Admin scoate SMTP config dupa fire**: `getEmailSettings` returneaza null → `dispatchWarningEmail` returneaza false. `email_attempts` e incrementat, `email_sent_at` ramane NULL. La re-configurare SMTP, scheduler-ul va re-trimite daca `email_attempts < EMAIL_MAX_ATTEMPTS` si backoff-ul a trecut.

### Test plan batch HIGH-4+MEDIUM-8+LOW-3

1. **HIGH-4 retry**: `checkBudgetWarning` la 85% cu SMTP fail → `emailDispatched=false`, `email_attempts=1`. Dupa 61s, `checkBudgetWarningRetry` → al doilea email trimis cu succes → `email_sent_at` setata.
2. **HIGH-4 backoff**: 4 fail-uri → `email_attempts=4` → `selectPendingEmailRetries` returneaza 0 rows.
3. **MEDIUM-8 cooldown — oscilatie**: fire la 80% (email trimis), clear la 79%, re-fire la 80% < 1h → `emailDispatched=false`, banner vizibil.
4. **MEDIUM-8 cooldown dupa 1h**: re-fire la 80%, `last_email_attempted_at = now - 3601s` → email trimis.
5. **LOW-3 audit**: `checkBudgetWarning` la fire → `recordAudit(null, "budget.warning.fired", ...)` → `getAuditEvents({ action: "budget.warning.fired" })` returneaza 1 row.
6. **Cleanup test**: `clearWarning` NU reseteaza `email_attempts` si `last_email_attempted_at`.
7. **Schema test**: `selectPendingEmailRetries` cu 0 episode active → array gol.

---

## Verificari pre-commit

In ordinea din CLAUDE.md:

```bash
# 1. Biome pe fisierele atinse
npx biome check --write backend/src/middleware/quotaGuard.ts \
  backend/src/routes/admin.ts \
  backend/src/services/aiUsage.ts \
  backend/src/services/budgetWarningService.ts \
  backend/src/db/aiUsageRepository.ts \
  backend/src/db/userQuotaGrantsRepository.ts \
  backend/src/db/userQuotaRepository.ts \
  backend/src/db/budgetNotificationsRepository.ts \
  backend/src/db/auditRepository.ts

# 2. Type-check
npx tsc --noEmit -p backend/tsconfig.json

# 3. Build
npm run build

# 4. Tests
npm test --workspace=backend
```

**Pitfall specific biome**: `.immediate()` pe `db.transaction(fn)` — biome poate obiectua la chaining daca nu e pe linie separata. Forma sigura:

```typescript
const tx = db.transaction(() => { ... });
tx.immediate();
```

---

## Rezumat fisiere create/modificate

| Fisier | Tip | Finding |
|--------|-----|---------|
| `backend/src/db/migrations/0031_budget_notifications_retry.up.sql` | NOU | HIGH-4, MEDIUM-8 |
| `backend/src/db/migrations/0031_budget_notifications_retry.down.sql` | NOU | HIGH-4, MEDIUM-8 |
| `backend/src/db/migrations/0032_ai_usage_reservation.up.sql` | NOU | CRITICAL-1 |
| `backend/src/db/migrations/0032_ai_usage_reservation.down.sql` | NOU | CRITICAL-1 |
| `backend/src/middleware/quotaGuard.ts` | MODIFICAT | CRITICAL-1, MEDIUM-1 |
| `backend/src/services/aiUsage.ts` | MODIFICAT | CRITICAL-1 |
| `backend/src/db/aiUsageRepository.ts` | MODIFICAT | CRITICAL-1 |
| `backend/src/db/budgetNotificationsRepository.ts` | MODIFICAT | HIGH-4, MEDIUM-8 |
| `backend/src/services/budgetWarningService.ts` | MODIFICAT | HIGH-4, MEDIUM-8, LOW-3 |
| `backend/src/routes/admin.ts` | MODIFICAT | MEDIUM-1, MEDIUM-9 |
| `backend/src/db/userQuotaGrantsRepository.ts` | MODIFICAT | MEDIUM-3 |
| `backend/src/db/userQuotaRepository.ts` | MODIFICAT | MEDIUM-3 |

---

## Estimat ore per finding

| Finding | Ore |
|---------|-----|
| MEDIUM-1 (enum) | 1.5h |
| CRITICAL-1 (reservation TOCTOU) | 5h |
| MEDIUM-3 (LIMIT 200) | 0.5h |
| MEDIUM-9 (expires cap) | 0.5h |
| HIGH-4 + MEDIUM-8 + LOW-3 (budget batch) | 4.5h |
| Tests + biome + type-check | 3h |
| **Total** | **~15h** |

---

## Constrangeri NON-NEGOTIABLE verificate

- Desktop ZERO impact: `quotaGuard` short-circuit la `getAuthMode() !== "web"`; `checkBudgetWarning` apelat doar sub `if (getAuthMode() === "web")`; `checkBudgetWarningRetry` gated pe `if (getAuthMode() !== "web") return` in scheduler.
- Repository-only DB: toate SQL-urile noi merg in `backend/src/db/**Repository.ts`; `budgetWarningService.ts` nu are SQL direct.
- Audit log fara plaintext: `recordAudit(null, "budget.warning.fired", ...)` contine doar `pct`, `usedMilli`, `effectiveLimit`, `period`, `feature` — fara email, fara user display name, fara last4.
- D14 fail-closed EUR / D15 rolling seconds / D16 banner auto-clear: netinse de acest cluster.
- `ai_usage` tracking ramane owner-scoped, dupa call extern, fara SQLite lock peste I/O: calea desktop continua cu `queueMicrotask` + `insertAiUsage`; calea web foloseste `confirmAiUsageReservation` tot in `queueMicrotask`, tot async, fara lock in microtask.
