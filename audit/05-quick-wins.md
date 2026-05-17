# A5 — Quick Wins (Code Simplifier)

**Generated:** 2026-05-16
**Scope:** LOW-risk files (per `audit/01-inventory.md`) + local simplifications on a few MED/HIGH files. No structural refactor. Excludes AI-branch additions (`0023_*`, `0024_*`, `ownerAiSettingsRepository.*`), all `*.test.ts(x)`, `frontend/src/data/changelog-entries.tsx`, `backend/src/db/migrations/**`.

## Summary

- Apply immediate: 8 items (zero-behavior-change, single-file)
- Batch in PR: 4 grouped batches (cross-file local helpers)
- Skip (false positive / by-design): 5 items
- Estimated LOC reduction: ~120 LOC net (after extracted helpers added back in)

The biggest wins (Batch B1 + B2 + item 1) account for ~80% of the saving. Everything below `Apply immediate #5` is genuinely small but trivially safe.

---

## Apply immediate (zero behavior change, single file)

### 1. Dead export `formatDateTime` in `lib/utils.ts`

**File:** `frontend/src/lib/utils.ts:43-47`
**Pattern:** Exported function with zero call sites in the codebase. Explicitly called out as superseded in `datetime-formatters.ts:5` comment ("lib/utils.ts are deja un `formatDateTime(dateStr, timeStr?)` unused"). Verified by `Grep formatDateTime\(` — only the definition itself and the comment reference exist.

**Before:**
```ts
export function formatDateTime(dateStr: string, timeStr?: string): string {
  const date = formatDate(dateStr);
  if (!timeStr) return date;
  return `${date} ${timeStr}`;
}
```

**After:** delete the 5-line block.

**Verdict:** apply immediate (no callers). LOC saved: 5.

---

### 2. Collapse `describeNestedPhase` into `describeSplitPhase`

**File:** `frontend/src/lib/rnpmProgressPhase.ts:3-50`
**Pattern:** `describeNestedPhase` is a strict subset of `describeSplitPhase` — same 6 case-arms (`captcha → "captcha"`, `search → "cautare"`, `done → "finalizat"`, `blocked → "blocat"`, `skipped → "fara rezultate"`, `error → "eroare"`). The only thing the larger switch adds is 3 extra `nested_*` arms that nested phases cannot hit. Because `RnpmNestedSplitProgress["phase"]` is a strict subtype of `RnpmSplitProgress["phase"]`, the larger function accepts the nested input verbatim.

**Before:** two switch statements, ~28 LOC each (~50 LOC total + 2 exhaustive guards).

**After:**
```ts
// describeSplitPhase handles every nested-phase value too (RnpmNestedSplitProgress["phase"]
// is a strict subset of RnpmSplitProgress["phase"]); keep it as the single entry point.
export const describeNestedPhase = describeSplitPhase as (phase: RnpmNestedSplitProgress["phase"]) => string;
```

**Verdict:** apply immediate. Frontend tests exercise both, so a regression would show up immediately. LOC saved: ~20.

**Caveat:** the exhaustive guard in `describeNestedPhase` is lost, but `describeSplitPhase`'s guard already catches any new enum addition (the nested-phase type is a subset).

---

### 3. Simplify `readInitial()` in `alertsNotificationPref.ts`

**File:** `frontend/src/lib/alertsNotificationPref.ts:10-20`
**Pattern:** Three-branch fallback that collapses to one comparison.

**Before:**
```ts
function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "false") return false;
    if (raw === "true") return true;
    return true;
  } catch {
    return true;
  }
}
```

**After:**
```ts
function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}
```

**Verdict:** apply immediate. Semantics: "default true unless storage explicitly holds `false`". LOC saved: 5.

---

### 4. Drop unused return `;` on Hono middleware (cosmetic, all 3 middleware files)

**Files:**
- `backend/src/middleware/originGuard.ts:46-83`
- `backend/src/middleware/requireDesktopHeader.ts:37-53`

**Pattern:** Both middleware end with the sequence `await next(); return;` — the trailing bare `return` after the last statement of an `async function` is a no-op when the declared return type is `Promise<Response | undefined>`. The flow already returns `undefined` implicitly. Same for the early `await next(); return;` blocks inside.

**Before (originGuard.ts:43-46):**
```ts
if (SAFE_METHODS.has(method)) {
  await next();
  return;
}
```
and (originGuard.ts:82-83):
```ts
  await next();
  return;
}
```

**After:**
```ts
if (SAFE_METHODS.has(method)) {
  await next();
  return;
}
// (no change to the early returns — explicit is fine.)
// At end of function, drop the trailing `return;` since it's the last statement.
  await next();
}
```

**Verdict:** apply immediate (Biome may already flag with `noUselessReturn`). LOC saved: 2 per file. Optional polish — debatable whether dropping signal-of-intent is worth it. **If unclear, skip.** Listed because it's a 30-second edit if desired.

---

### 5. `RWLock.hasQueuedWriter()` → array method

**File:** `backend/src/util/rwlock.ts:83-88`
**Pattern:** Manual for-of with single boolean predicate.

**Before:**
```ts
private hasQueuedWriter(): boolean {
  for (const w of this.queue) {
    if (w.kind === "write") return true;
  }
  return false;
}
```

**After:**
```ts
private hasQueuedWriter(): boolean {
  return this.queue.some((w) => w.kind === "write");
}
```

**Verdict:** apply immediate. `Array.some` early-exits identically to the for-of. LOC saved: 3.

---

### 6. `useTheme` — collapse classList branch

**File:** `frontend/src/hooks/useTheme.ts:12-22`
**Pattern:** if/else that toggles a class.

**Before:**
```ts
if (theme === "dark") {
  root.classList.add("dark");
} else {
  root.classList.remove("dark");
}
```

**After:**
```ts
root.classList.toggle("dark", theme === "dark");
```

**Verdict:** apply immediate. `classList.toggle(token, force)` is widely supported and explicit about intent. LOC saved: 3.

---

### 7. `useFontSize.loadStep` — flatten guard

**File:** `frontend/src/hooks/useFontSize.ts:11-22`
**Pattern:** Nested `if (saved !== null)` after a try block, then `if (n >= 0 && n < STEPS.length)`.

**Before:**
```ts
function loadStep(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      const n = Number(saved);
      if (n >= 0 && n < STEPS.length) return n;
    }
  } catch {
    /* localStorage unavailable (private mode / quota); use default */
  }
  return 1;
}
```

**After:**
```ts
function loadStep(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const n = saved == null ? Number.NaN : Number(saved);
    if (Number.isInteger(n) && n >= 0 && n < STEPS.length) return n;
  } catch {
    /* localStorage unavailable (private mode / quota); use default */
  }
  return 1;
}
```

**Verdict:** apply immediate. Slightly more defensive (`Number.isInteger` rejects floats and NaN in one check) and reduces nesting from 3 to 2. LOC saved: 1 (mostly clarity, not LOC).

---

### 8. Rate-limit middleware — use `fail()` envelope helper

**File:** `backend/src/middleware/rate-limit.ts:22-30, 57-67, 138-148, 158-168`
**Pattern:** 4 inline copies of `c.json({ data: null, error: { code, message }, requestId: c.get("requestId") ?? "" }, status)`. Every other middleware (`originGuard.ts`, `requireDesktopHeader.ts`, `owner.ts`) already uses the `fail()` helper from `util/envelope.ts` which does exactly this (and also handles `getRequestId()` instead of the manual `?? ""`).

**Before (rate-limit.ts:22-30):**
```ts
return c.json(
  {
    data: null,
    error: { code: "origin_unavailable", message: "Origine indisponibila." },
    requestId: c.get("requestId") ?? "",
  },
  503
);
```

**After:**
```ts
return c.json(fail("origin_unavailable", "Origine indisponibila.", c), 503);
```

**Verdict:** apply immediate. Behavior identical (envelope's `getRequestId(c)` returns `""` when absent, matching the current fallback). LOC saved: ~30 across the 4 sites. **Important:** test file `rate-limit.test.ts` already asserts against the envelope shape (`{ data: null, error: { code: ... }, requestId }`), no test changes needed.

---

## Batch in PR (group similar items)

### Batch B1 — Repository pagination clamps (`clampLimit` / `clampOffset`)

**Files:**
- `backend/src/db/userRepository.ts:42-52` (clampLimit, clampOffset; ceiling 200)
- `backend/src/db/auditRepository.ts:185-195` (clampAuditLimit, clampAuditOffset; ceiling 500)
- `backend/src/routes/dashboard.ts:201-…` (clampLimit; takes string param + max arg)

**Pattern:** Same shape (parse number, clamp to [1, max], default if invalid) repeated 3+ times with only the ceiling differing. Two of three signatures are identical except for the `MAX` constant.

**Extract proposal:** add to `backend/src/util/validation.ts`:
```ts
export function clampInt(value: unknown, opts: { min: number; max: number; default: number }): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : Number(value);
  if (!Number.isFinite(n)) return opts.default;
  return Math.min(Math.max(Math.floor(n), opts.min), opts.max);
}
```
Then `clampLimit(opts.limit)` becomes `clampInt(opts.limit, { min: 1, max: 200, default: 50 })`.

**Estimated LOC saved:** ~20 (5 helpers × 4-5 lines each, replaced by 1 generic).
**Risk:** LOW. Behavior must match exactly — write a 5-line vitest table that covers the 3 callers' (input → expected) tuples before deleting the local helpers.

---

### Batch B2 — `loadHistory` / `saveHistory` in two history hooks

**Files:**
- `frontend/src/hooks/useSearchHistory.ts:7-18`
- `frontend/src/hooks/useRnpmHistory.ts:7-18`

**Pattern:** Both define identical `loadHistory<T>` (try/catch → JSON.parse from a STORAGE_KEY) and `saveHistory<T>` (JSON.stringify → localStorage.setItem) and `clearHistory` (remove key + setState([])). Only the storage key + label builder + entry shape differ. They also share an identical `removeEntry`/`addEntry` shape — but `addEntry` is type-specific (different filter predicate, different meta arg). Just lift the storage IO.

**Extract proposal:** create `frontend/src/hooks/_localStorageList.ts`:
```ts
export function readJsonList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}
export function writeJsonList<T>(key: string, entries: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(entries)); } catch { /* quota / privacy */ }
}
export function clearJsonList(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
```
Then both hooks import these and drop their local copies (also gain consistent quota-error swallowing — current `saveHistory` calls have no try/catch, which throws on quota-exceeded in private mode).

**Estimated LOC saved:** ~15 (3 small helpers × 2 files - 1 shared module).
**Risk:** LOW. Add a behavior bonus (saves don't throw on private mode). Worth a one-line test asserting `readJsonList("missing")` returns `[]`.

---

### Batch B3 — Local `stripDiacritics` mirror

**Files:**
- `backend/src/util/textNormalize.ts:6-12` — canonical
- `frontend/src/lib/rnpmFilterTokens.ts:7-10` — UI mirror (intentional, separate runtime)
- `frontend/src/lib/pdf-helpers.ts:21-33` — different (manual character map, no NFD; needed for jsPDF Helvetica which lacks combining marks)

**Pattern:** Three implementations of "strip diacritics". The frontend mirror in `rnpmFilterTokens.ts` is by-design (no shared runtime with backend), and `pdf-helpers.ts` uses a different strategy (manual map vs NFD) for a documented reason.

**Extract proposal:** keep `pdf-helpers.ts` as-is (different problem). For `rnpmFilterTokens.ts` + frontend uses, lift the NFD helper into `frontend/src/lib/textNormalize.ts` (new) so any future frontend caller doesn't add a 4th copy. Single-line module:
```ts
const COMBINING_MARKS_RE = /\p{M}/gu;
export const stripDiacritics = (s: string): string => s.normalize("NFD").replace(COMBINING_MARKS_RE, "");
```

**Estimated LOC saved:** ~6 today, **but** anchors the convention so the next person who needs diacritic-stripping on the frontend doesn't paste it inline.
**Risk:** LOW. Pure function.

---

### Batch B4 — Periodic-sweep helper in `rate-limit.ts`

**File:** `backend/src/middleware/rate-limit.ts:73-76, 95-101, 178-182`
**Pattern:** Three near-identical sweep loops over the two maps:
- inline cleanup at end of `rateLimit` (lines 73-76, single-map version)
- `sweepExpiredEntries` (95-101, sweeps both)
- inline cleanup at end of `preAuthRateLimit` (178-182, single-map version)

The 5-min `setInterval` (`sweepExpiredEntries`) already sweeps both; the two inline burst-spike cleanups are partial duplicates of the function (`rateLimit` sweeps only `rateLimitMap`; `preAuthRateLimit` sweeps only `preAuthMap`).

**Extract proposal:** factor the per-map sweep into one helper, then have both inline paths call it on their own map:
```ts
function sweepExpired<T extends { resetTime: number }>(map: Map<string, T>, now: number): void {
  for (const [k, v] of map) if (now > v.resetTime) map.delete(k);
}
```
Then `sweepExpiredEntries(now)` becomes `sweepExpired(rateLimitMap, now); sweepExpired(preAuthMap, now);`, and the two inline blocks become single-line calls.

**Estimated LOC saved:** ~10. Reduces the surface area where the "sweep buckets when over 1000 entries" policy lives (currently 3 places, becomes 1 helper + 3 thin call sites).
**Risk:** LOW. Same iteration, just parametrized.

---

## Skip (intentional or risky)

### S1. Backend `todayRo` + frontend `todayRo` duplicate definitions

**Files:** `backend/src/util/xlsxHelpers.ts:1-3`, `frontend/src/lib/excel-helpers.ts:5-7`
**Why skip:** Different runtimes (Node vs browser). Sharing would require a shared workspace package, which is structural change — out of quick-win scope. Already covered indirectly by Cluster 3 in `02-duplication.md`.

---

### S2. `formatRoDateTime` (backend) ↔ `formatIsoDateTime` (frontend)

**Files:** `backend/src/util/dateFormat.ts:30-35`, `frontend/src/lib/datetime-formatters.ts:9-21`
**Why skip:** Same parsing logic but the formatter object signatures differ (backend uses explicit `Europe/Bucharest`; frontend uses default locale). Conscious split per `datetime-formatters.ts` header comment. Frontend includes browser-specific tz handling. Cross-runtime extract needs a workspace package — structural, out of scope.

---

### S3. Per-source SQL repetition in `dashboardActivityRepository.ts`

**File:** `backend/src/db/dashboardActivityRepository.ts`
**Pattern:** `listAlertsBefore` ↔ `listAlertsInRange`, `listFinalizedRunsBefore` ↔ `listFinalizedRunsInRange`, `listCuratedAuditBefore` ↔ `listCuratedAuditInRange` — three pairs of "cursor" vs "range" variants of the same SELECT.
**Why skip:** Looks duplicate but the WHERE clauses are genuinely different (`ts <cmp> ?` vs `ts >= ? AND ts <= ?`) and the binding order changes. The pairs are already factored as well as is practical without dynamic SQL string concatenation, which would hurt readability and the prepared-statement plan cache. Leave as is.

---

### S4. Backend `monitoring_runs` insert vs `monitoring_snapshots` insert tenant guard

**Files:** `backend/src/db/monitoringRunsRepository.ts:48-55`, `backend/src/db/monitoringSnapshotsRepository.ts:58-65`
**Pattern:** Both run the same `SELECT 1 FROM monitoring_jobs WHERE id = ? AND owner_id = ?` guard with the same throw shape. Tempting to extract `assertJobBelongsToOwner(jobId, ownerId)`.
**Why skip:** Each tenant-isolation check has a different error message ("insertRunning:" vs "insertSnapshot:") that surfaces in logs at the failing call site. Extracting to a common helper loses the caller name in the message unless you pass it as an arg — at which point the helper saves 1 line per caller. Net-zero gain for the test suite reorg cost. Leave.

---

### S5. `stripDiacritics` in `pdf-helpers.ts`

**File:** `frontend/src/lib/pdf-helpers.ts:21-33`
**Why skip:** Already noted in B3. Manual-map approach is intentional (jsPDF Helvetica needs single-byte chars, not just unicode-stripped). NFD approach would still leave `ăâî...` after combining-mark removal if the source string was already pre-composed. **Different problem, not a duplicate.**

---

## Notes

- Items 1, 2, 8, B1 give roughly 60% of the LOC saving and are the highest-value picks.
- Item 8 is also a consistency win: every other middleware uses `fail()`; rate-limit is the only outlier.
- Batch B2 has a behavioral bonus (private-mode safety on writes) that's worth calling out in the PR description.
- None of these touch RNPM hot paths, captcha solver, scheduler, or any AI-branch file.
- All items verified against current code on `feat/openrouter-toggle-stacks` (read-only).
