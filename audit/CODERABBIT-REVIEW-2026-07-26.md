# Review CodeRabbit — Update v2.43.2 security, RNPM, AI, quota, and web features

**Data:** 2026-07-26T00:29:24.232Z  
**Mod:** auto | **base:** `6f326e4` -> **head:** `4ff06ce`  
**Total:** 54 comentarii in 45 fisiere (din 299 analizate)  
**Pe tip:** actionable=54

## Sumar pe fisiere

| Fisier | Comentarii | Tipuri |
|--------|-----------:|--------|
| `SESSION-HANDOFF.md` | 3 | actionable |
| `backend/src/db/avizRepository.ts` | 2 | actionable |
| `backend/src/routes/admin.ts` | 2 | actionable |
| `backend/src/routes/adminRnpm.ts` | 2 | actionable |
| `backend/src/services/keyValidation.ts` | 2 | actionable |
| `docs/superpowers/plans/2026-07-11-fixes-rev3-rnpm-split.md` | 2 | actionable |
| `docs/superpowers/plans/2026-07-12-rnpm-storage-limits.md` | 2 | actionable |
| `frontend/src/pages/admin/Backups.tsx` | 2 | actionable |
| `CHANGELOG.md` | 1 | actionable |
| `DOCUMENTATIE.md` | 1 | actionable |
| `HANDOFF-AUDIT-v2.43.0-rnpm-split-2026-07-11.md` | 1 | actionable |
| `HANDOFF-EXECUTIE-REMEDIERE-AUDIT-v2.43-2026-07-19.md` | 1 | actionable |
| `RUNBOOK.md` | 1 | actionable |
| `backend/src/db/backup.ts` | 1 | actionable |
| `backend/src/db/migrations/0041_unified_ai_quota.down.sql` | 1 | actionable |
| `backend/src/db/rnpmActivity.ts` | 1 | actionable |
| `backend/src/db/rnpmDb.ts` | 1 | actionable |
| `backend/src/index.ts` | 1 | actionable |
| `backend/src/middleware/requireDesktopHeaderGlobal.ts` | 1 | actionable |
| `backend/src/routes/openapi.ts` | 1 | actionable |
| `backend/src/routes/rnpm.ts` | 1 | actionable |
| `backend/src/services/retentionPurge.test.ts` | 1 | actionable |
| `backend/src/soap.ts` | 1 | actionable |
| `deploy/.env.prod.example` | 1 | actionable |
| `deploy/docker-compose.prod.yml` | 1 | actionable |
| `docker-compose.yml` | 1 | actionable |
| `docs/superpowers/plans/2026-07-11-fixes-audit-v2.43-core.md` | 1 | actionable |
| `docs/superpowers/plans/2026-07-11-fixes-rev4-rnpm-split.md` | 1 | actionable |
| `docs/superpowers/plans/2026-07-12-rnpm-autocompact-delete-batch.md` | 1 | actionable |
| `docs/superpowers/plans/2026-07-19-partial-results-portaljust.md` | 1 | actionable |
| `docs/superpowers/plans/2026-07-19-remediere-audit-sec-v2.43.md` | 1 | actionable |
| `docs/superpowers/specs/2026-07-10-rnpm-split-per-user-design.md` | 1 | actionable |
| `frontend/src/components/UserPicker.tsx` | 1 | actionable |
| `frontend/src/components/rnpm/RnpmSavedStats.tsx` | 1 | actionable |
| `frontend/src/data/changelog-entries.tsx` | 1 | actionable |
| `frontend/src/hooks/useDosareAi.ts` | 1 | actionable |
| `frontend/src/lib/adminApi.ts` | 1 | actionable |
| `frontend/src/lib/auditOutcome.ts` | 1 | actionable |
| `frontend/src/lib/export-manual.ts` | 1 | actionable |
| `frontend/src/lib/monitoringRunStatus.ts` | 1 | actionable |
| `frontend/src/lib/quotaFeatureLabels.ts` | 1 | actionable |
| `frontend/src/lib/quotaPeriodLabels.ts` | 1 | actionable |
| `frontend/src/pages/Dosare.tsx` | 1 | actionable |
| `frontend/src/pages/admin/Quota.tsx` | 1 | actionable |
| `scripts/dev-web-local.ps1` | 1 | actionable |

---

## `SESSION-HANDOFF.md`

### L3 — actionable (minor)

**Align the release date with the release contents.**

The handoff calls v2.43.2 a July 21 release but says the work was completed July 26, while the changelog includes July 22 and July 25 changes. Use one authoritative shipped/completed date consistently.

### L136-L140 — actionable (minor)

**Remove the stale “only A/B/C commits” rule.**

The same handoff records later Commits D/E/F and Rev. 5.1. Leaving this as an active rule can cause the next session to follow an obsolete commit workflow.

### L463-L467 — actionable (minor)

**Update the stale target version for the API-envelope risk.**

This remaining issue is labeled “to resolve in v2.42.0” even though the handoff is for v2.43.2. Replace the obsolete milestone with the current follow-up status.

---

## `backend/src/db/avizRepository.ts`

### L541-L543 — actionable (minor)

**A restore starting after commit turns a successful delete into an error response.**

`checkpointRnpmWal` routes through `getRnpmDb`, which throws `RnpmRestoreInProgressError` (or the shutdown error). The rows are already deleted at that point, so the caller gets a failure for a committed mutation and will likely retry. Make the checkpoint best-effort.




<details>
<summary>🐛 Proposed fix</summary>

```diff
-  if (deleted) checkpointRnpmWal(ownerId);
+  if (deleted) {
+    try {
+      checkpointRnpmWal(ownerId);
+    } catch (e) {
+      console.warn("[avizRepository] checkpoint WAL esuat dupa deleteAviz:", e instanceof Error ? e.message : e);
+    }
+  }
```

Apply the same treatment in `deleteAllAvize` (Line 566) and `deleteAvizeByIds` (Line 584).
</details>


Also applies to: 566-567, 584-584

### L546-L561 — actionable (major)

**Assert `foreign_keys=ON` instead of only documenting it.**

The comment correctly warns that a handle without `foreign_keys=ON` leaves orphaned `rnpm_creditori/debitori/bunuri/istoric` rows. Since this function is explicitly designed to accept arbitrary caller-owned handles, make the precondition enforceable rather than a convention.




<details>
<summary>🛡️ Proposed guard</summary>

```diff
 export function deleteAllAvizeOnHandle(db: Database.Database, ownerId: string): number {
   assertOwnerIdForMutation(ownerId, "deleteAllAvizeOnHandle");
+  if (db.pragma("foreign_keys", { simple: true }) !== 1) {
+    throw new Error("deleteAllAvizeOnHandle: handle fara foreign_keys=ON (cascadele nu ar rula)");
+  }
```
</details>

<details><summary>Sugestie</summary>

```
// v2.43.x (EXT-M-01): corpul delete-all, rulabil si pe un handle DIRECT
// (deschis de backup.ts prin openRnpmDbHandleDirect, sub latch-ul de restore,
// cand registry-ul e inchis). Owner-ul se valideaza AICI, nu doar in wrapper
// — handle-ul direct nu trece prin getRnpmDb. ATENTIE: handle-ul TREBUIE sa
// aiba foreign_keys=ON (cascadele pe creditori/debitori/bunuri/istoric).
export function deleteAllAvizeOnHandle(db: Database.Database, ownerId: string): number {
  assertOwnerIdForMutation(ownerId, "deleteAllAvizeOnHandle");
  if (db.pragma("foreign_keys", { simple: true }) !== 1) {
    throw new Error("deleteAllAvizeOnHandle: handle fara foreign_keys=ON (cascadele nu ar rula)");
  }
  // Sterge avizele (CASCADE curata creditori/debitori/bunuri/istoric) si metadata din rnpm_searches.
  // search_id din rnpm_avize are ON DELETE SET NULL, deci searches nu cad in cascada — le stergem explicit.
  return db.transaction(() => {
    const res = db.prepare("DELETE FROM rnpm_avize WHERE owner_id = ?").run(ownerId);
    db.prepare("DELETE FROM rnpm_searches WHERE owner_id = ?").run(ownerId);
    if (res.changes > 0) cleanupOrphanDescrieri(db);
    return res.changes;
  })();
}
```

</details>

---

## `backend/src/routes/admin.ts`

### L956-L975 — actionable (major)

**Grant base uses the env default unconditionally, diverging from the web-only rule applied elsewhere.**

`budgetWarningService.ts` and `/me/budget` both gate `readDefaultQuotaMilli()` behind `getAuthMode() === "web"` because the guard doesn't enforce it on desktop. Here it's read unconditionally, so on desktop an admin can create a grant on top of a base cap that is never enforced — the opposite of the "grant vs nelimitat se exclud" intent.

<details>
<summary>🔧 Proposed alignment</summary>

```diff
-  const baseLimit = baseOverride ? baseOverride.limit_usd_milli : readDefaultQuotaMilli();
+  const defaultMilli = getAuthMode() === "web" ? readDefaultQuotaMilli() : null;
+  const baseLimit = baseOverride ? baseOverride.limit_usd_milli : defaultMilli;
```
</details>

<details><summary>Sugestie</summary>

```
// v2.42.0 (5.2): grant vs nelimitat se exclud. Baza se calculeaza cu ACEEASI
  // regula ca guard-ul (override ? limit : default env) — altfel tenantii care
  // folosesc doar env-ul default nu ar putea acorda granturi deloc (fix High
  // din review). Baza NULL = buget nelimitat: un extra peste infinit e no-op
  // derutant, refuzam explicit.
  const baseOverride = getOverride(id, "ai");
  const defaultMilli = getAuthMode() === "web" ? readDefaultQuotaMilli() : null;
  const baseLimit = baseOverride ? baseOverride.limit_usd_milli : defaultMilli;
  if (baseLimit === null) {
    return c.json(
      fail(
        "unlimited_budget",
        "Utilizatorul are buget AI nelimitat — granturile nu au efect. Seteaza intai o limita de baza.",
        c
      ),
      422
    );
  }

  const adminId = getActorId(c);
```

</details>

### L1062-L1148 — actionable (major)

**Same env-default asymmetry in `limitSource`, plus a blocking-loop reminder.**

`defaultAiMilli` is read without the web-mode gate, so on desktop the overview reports `limitSource: "default"` with an `effectiveLimitMilli` the guard never applies. Aligning it with `/me/budget` keeps the report and enforcement in sync.

Separately: the cap of 500 users × per-user synchronous queries still blocks the event loop for the whole handler. The set-based `sumAiUsageWindowsByOwner` is a good start; folding `getOverride`, `sumActiveExtraMilli` and `countTenantCaptchaUsageInWindow` into grouped queries would remove the remaining O(n) round trips when you lift the cap.

---

## `backend/src/routes/adminRnpm.ts`

### L26-L48 — actionable (major)

**Listing returns every user unpaginated.**

`/usage` returns one row per user with no `{ page, pageSize, total }` envelope, and the per-row cost is a lock acquisition plus several `stat` calls and a backup-dir listing. With a few hundred users this becomes a slow, unbounded admin request.

As per coding guidelines: "Folosește pagination offset-based cu forma `{ page, pageSize, total }` pentru listările principale."

### L28-L35 — actionable (minor)

**The two reads are not in the same lock window.**

The comment claims a compact/restore writer cannot interleave, but `measureRnpmStorage` takes its own read lock and `withMaintenanceRead(() => listRnpmBackups(...))` takes another; a writer can be granted in between, so the row can still mix generations. Wrap both reads in one `withMaintenanceRead` (or one per whole loop) to match the stated invariant.




<details>
<summary>🔒 Proposed fix</summary>

```diff
-  for (const u of users) {
-    const storage = await measureRnpmStorage(u.id);
-    const backups = await withMaintenanceRead(() => listRnpmBackups(u.id));
+  for (const u of users) {
+    const { storage, backups } = await withMaintenanceRead(async () => ({
+      storage: await measureRnpmStorageUnlocked(u.id),
+      backups: await listRnpmBackups(u.id),
+    }));
```

(Requires exposing an unlocked measurement helper, since `measureRnpmStorage` acquires the read lock itself and the lock is presumably not reentrant — verify before applying.)
</details>

---

## `backend/src/services/keyValidation.ts`

### L20-L23 — actionable (minor)

**Drain the response body on the redirect-skip path.**

Same concern as in `soap.ts`: the response body isn't cancelled before returning on a 3xx. Since `redirect: "manual"` is used specifically so the key isn't replayed to an unknown redirect target, the abandoned body should also be drained to release the connection promptly, matching the SEC-07 drain pattern used in `rnpmClient.ts`/`streamCap.ts` in this same PR.




<details>
<summary>🔧 Proposed fix</summary>

```diff
     const res = await fetchValidation(field, value);
     if (res.status >= 300 && res.status < 400) {
+      await res.body?.cancel().catch(() => {});
       // redirect:"manual" — nu urmarim redirect-ul cu cheia atasata; validare omisa.
       return { valid: true, validationSkipped: true, reason: "Provider a raspuns cu redirect; validare online omisa." };
     }
```
</details>

<details><summary>Sugestie</summary>

```
if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      // redirect:"manual" — nu urmarim redirect-ul cu cheia atasata; validare omisa.
      return { valid: true, validationSkipped: true, reason: "Provider a raspuns cu redirect; validare online omisa." };
    }
```

</details>

### L57-L63 — actionable (minor)

**Same missing body-drain on the twocaptcha redirect-skip path.**

Mirrors the issue at Line 20-23 in `validateKey`.




<details>
<summary>🔧 Proposed fix</summary>

```diff
   if (res.status >= 300 && res.status < 400) {
+    await res.body?.cancel().catch(() => {});
     // redirect:"manual" — nu urmarim redirect-ul cu cheia atasata; validare omisa.
     return { valid: true, validationSkipped: true, reason: "Provider a raspuns cu redirect; validare online omisa." };
   }
```
</details>

<details><summary>Sugestie</summary>

```
redirect: "manual",
    signal,
  });
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => {});
    // redirect:"manual" — nu urmarim redirect-ul cu cheia atasata; validare omisa.
    return { valid: true, validationSkipped: true, reason: "Provider a raspuns cu redirect; validare online omisa." };
  }
```

</details>

---

## `docs/superpowers/plans/2026-07-11-fixes-rev3-rnpm-split.md`

### L352-L360 — actionable (major)

**Nu folosi filesystem sincron în calea de restore.**

`existsSync` și `readFileSync` sunt propuse pentru validare în timpul restore-ului, deci pot bloca event loop-ul backendului. Mută citirea markerului pe `fs/promises` și fă interfața de validare asincronă sau citește markerul înainte de faza de staging.

As per coding guidelines, backend-ul trebuie să folosească acces asincron prin `fs/promises`, fără filesystem sincron în request handlers.

### L1059-L1069 — actionable (major)

**Păstrează delete-all și compactarea într-o singură operație atomică.**

Acest snippet reintroduce `compactRnpmDbViaWorker` după ștergere, deși planul anterior definește `deleteAllRnpmAndCompact(ownerId)` sub același maintenance lock/latch. Separarea redeschide fereastra de intercalare și diverge semantic de contractul `compacted`.

Ruta trebuie să apeleze helperul atomic și să returneze rezultatul lui.

---

## `docs/superpowers/plans/2026-07-12-rnpm-storage-limits.md`

### L7-L9 — actionable (major)

**Correct the top-level storage guarantee.**

The Goal still promises a worst-case of approximately 1 GB, while Rev. 2/3 says the theoretical footprint is unbounded and the honest product description is “500 MB live data + best-effort backups.” Update the Goal so release documentation and implementation expectations do not preserve the invalid guarantee.





Also applies to: 128-129

### L35-L39 — actionable (major)

**Apply the `used >= limit` boundary consistently.**

The initial interface still says the guard rejects only when `used > limit`, but Rev. 2 explicitly changes admission control to `used >= limit`. Update `assertRnpmStorageWithinLimit`, its tests, and the response examples together; otherwise an exactly-full database will incorrectly admit another search.





Also applies to: 112-116

---

## `frontend/src/pages/admin/Backups.tsx`

### L65-L116 — actionable (major)

**Use a synchronous in-flight ref before `confirm()`, as in `RnpmStorage.tsx`.**

`if (busy) return;` reads async state, so two clicks in the same tick both reach `await confirm(...)`. The second `confirm()` replaces the provider state and orphans the first promise (the exact failure mode documented and fixed with `actionInFlightRef` in `frontend/src/pages/admin/RnpmStorage.tsx`). Same applies to `handleCreate`, where a doubled `adminCreateBackup()` is a non-idempotent write.





<details>
<summary>♻️ Proposed guard</summary>

```diff
+  const actionInFlightRef = useRef(false);
+
   const handleRestore = async (entry: BackupEntry) => {
-    if (busy) return;
-    if (
-      !(await confirm({ ... }))
-    )
-      return;
+    if (actionInFlightRef.current) return;
+    actionInFlightRef.current = true;
+    try {
+      const ok = await confirm({ /* ... */ });
+      if (!ok) return;
+      // ...existing body...
+    } finally {
+      actionInFlightRef.current = false;
+    }
   };
```
</details>

### L109 — actionable (minor)

**Plural incorect pentru un singur backup.**

`1 backup-uri sterse` este gresit gramatical in romana; foloseste forma de singular cand `deleted === 1`.





<details>
<summary>✏️ Fix</summary>

```diff
-      setSuccessMsg(`${deleted} backup-uri sterse.`);
+      setSuccessMsg(deleted === 1 ? "1 backup sters." : `${deleted} backup-uri sterse.`);
```
</details>

<details><summary>Sugestie</summary>

```
setSuccessMsg(deleted === 1 ? "1 backup sters." : `${deleted} backup-uri sterse.`);
```

</details>

---

## `CHANGELOG.md`

### L3-L10 — actionable (minor)

**Use a release date that covers all v2.43.2 changes.**

The heading says `2026-07-21`, but the same release includes changes dated July 22 and July 25. Update the release metadata or split the later changes into a separate release so the public history remains chronological.

---

## `DOCUMENTATIE.md`

### L10 — actionable (minor)

**Align the current-version date with the release contents.**

`v2.43.2` includes changes dated July 22 and July 25 elsewhere in this release, so the July 21 date is stale unless those changes were not shipped together.

---

## `HANDOFF-AUDIT-v2.43.0-rnpm-split-2026-07-11.md`

### L169-L179 — actionable (minor)

**Fix the contradictory artifact status.**

Lines 18–19 state that both reports were delivered, but lines 176–177 still mark them as `DE FACUT`. Mark the exact files as delivered or remove the stale rows so the next session does not repeat completed work.

---

## `HANDOFF-EXECUTIE-REMEDIERE-AUDIT-v2.43-2026-07-19.md`

### L5-L7 — actionable (minor)

**Complete the truncated handoff entry.**

Line 7 ends mid-sentence, leaving the session state unclear for the next executor.

---

## `RUNBOOK.md`

### L743-L752 — actionable (major)

**Stop the application before editing the restored monolith.**

This remediation path runs `DELETE` and `VACUUM` directly, but does not instruct the operator to stop Electron/backend first. Concurrent writes or locks can undermine recovery.

<details>
<summary>Suggested runbook addition</summary>

```diff
 1. **Pastreaza fisierele per-user (recomandat — sunt mai noi):** goleste
    randurile rnpm din monolitul restaurat si reporneste:
+   Opreste complet aplicatia/backend-ul inainte de a rula comenzile SQLite.
+   Fa o copie a bazei restaurate si verifica integritatea dupa modificare.
```
</details>

<details><summary>Sugestie</summary>

```
1. **Pastreaza fisierele per-user (recomandat — sunt mai noi):** goleste
   randurile rnpm din monolitul restaurat si reporneste:
   Opreste complet aplicatia/backend-ul inainte de a rula comenzile SQLite.
   Fa o copie a bazei restaurate si verifica integritatea dupa modificare.
```

</details>

---

## `backend/src/db/backup.ts`

### L1184-L1214 — actionable (major)

**`maybeAutoCompactRnpm` can still throw: the pre-measurement runs outside the try/catch.**

`readAutoCompactMinFreeBytes()` is safe, but `measureRnpmFreelistIfPresent` propagates non-ENOENT `stat` errors and `getRnpmDb(ownerId)` throws `RnpmRestoreInProgressError` when the owner is under a restore/compact latch. Since this is the fire-and-forget hook invoked after searches, that rejection escapes the "log a skip reason, never throw" contract that the `catch` below implements.

<details>
<summary>🛡️ Proposed fix</summary>

```diff
   const minFreeBytes = readAutoCompactMinFreeBytes();
-  const measurement = await measureRnpmFreelistIfPresent(ownerId);
+  let measurement: RnpmFreelistMeasurement | null;
+  try {
+    measurement = await measureRnpmFreelistIfPresent(ownerId);
+  } catch (error) {
+    logBackupEvent({
+      action: "rnpm_autocompact_skipped",
+      target: `rnpm:${ownerId}`,
+      reason: autoCompactFailureReason(error),
+      stage: "measure",
+      error: error instanceof Error ? error.message : String(error),
+    });
+    return { attempted: false, compacted: false, freedBytes: 0, reason: autoCompactFailureReason(error) };
+  }
   if (measurement === null || !shouldAutoCompactRnpm(...)) {
```
</details>

<details><summary>Sugestie</summary>

```
export async function maybeAutoCompactRnpm(
  ownerId: string,
  deps: { compact?: typeof compactRnpmIfStillNeeded } = {}
): Promise<RnpmAutoCompactResult> {
  if (process.env.LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_DISABLED === "1") {
    return { attempted: false, compacted: false, freedBytes: 0 };
  }

  const minFreeBytes = readAutoCompactMinFreeBytes();
  let measurement: RnpmFreelistMeasurement | null;
  try {
    measurement = await measureRnpmFreelistIfPresent(ownerId);
  } catch (error) {
    logBackupEvent({
      action: "rnpm_autocompact_skipped",
      target: `rnpm:${ownerId}`,
      reason: autoCompactFailureReason(error),
      stage: "measure",
      error: error instanceof Error ? error.message : String(error),
    });
    return { attempted: false, compacted: false, freedBytes: 0, reason: autoCompactFailureReason(error) };
  }
  if (measurement === null || !shouldAutoCompactRnpm(measurement.freelistBytes, measurement.totalBytes, minFreeBytes)) {
    return { attempted: false, compacted: false, freedBytes: 0 };
  }

  const compact = deps.compact ?? compactRnpmIfStillNeeded;
  const startedAt = Date.now();
  try {
    return await compact(ownerId, minFreeBytes);
  } catch (error) {
    const reason = autoCompactFailureReason(error);
    const durationMs = Date.now() - startedAt;
    logBackupEvent({
      action: "rnpm_autocompact_skipped",
      target: `rnpm:${ownerId}`,
      reason,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return { attempted: true, compacted: false, freedBytes: 0, durationMs, reason };
  }
}
```

</details>

---

## `backend/src/db/migrations/0041_unified_ai_quota.down.sql`

### L13-L17 — actionable (major)

**Grant duplication is not reversible on re-upgrade — extra budget doubles.**

A single `ai` grant becomes `ai.single` + `ai.multi` on down; re-running `0041.up` renames both back to `ai`, so `sumActiveExtraMilli(owner, "ai")` counts `extra_usd_milli` twice. Any down/up cycle silently inflates every user's effective limit.

Cheapest fix: mark the synthetic copy and drop marked rows in `0041.up`.




<details>
<summary>🛠️ Proposed fix (down + matching cleanup in up)</summary>

```diff
 INSERT INTO user_quota_grants
   (user_id, feature, extra_usd_milli, expires_at, reason, granted_by, granted_at, revoked_at, revoked_by, revoked_reason)
-SELECT user_id, 'ai.multi', extra_usd_milli, expires_at, reason, granted_by, granted_at, revoked_at, revoked_by, revoked_reason
+SELECT user_id, 'ai.multi', extra_usd_milli, expires_at,
+       '[dup-0041-down] ' || COALESCE(reason, ''), granted_by, granted_at, revoked_at, revoked_by, revoked_reason
 FROM user_quota_grants WHERE feature = 'ai';
```

In `0041_unified_ai_quota.up.sql`, before the rename:

```sql
DELETE FROM user_quota_grants
WHERE feature = 'ai.multi' AND reason LIKE '[dup-0041-down] %';
```
</details>

<details><summary>Sugestie</summary>

```
INSERT INTO user_quota_grants
  (user_id, feature, extra_usd_milli, expires_at, reason, granted_by, granted_at, revoked_at, revoked_by, revoked_reason)
SELECT user_id, 'ai.multi', extra_usd_milli, expires_at,
       '[dup-0041-down] ' || COALESCE(reason, ''), granted_by, granted_at, revoked_at, revoked_by, revoked_reason
FROM user_quota_grants WHERE feature = 'ai';
UPDATE user_quota_grants SET feature = 'ai.single' WHERE feature = 'ai';
```

</details>

---

## `backend/src/db/rnpmActivity.ts`

### L39-L46 — actionable (major)

**Restore latch is not re-entrant-safe: overlapping restores for the same owner release the latch early.**

`beginRnpmRestore` silently succeeds if a restore is already in flight, and `endRnpmRestore` deletes unconditionally — so the first `end` unlatches while the second restore is still swapping the file, letting `getRnpmDb` reopen the old handle mid-rename. Either refuse a second concurrent restore or refcount like `activeSearches`.




<details>
<summary>🛡️ Proposed fix: fail-closed on concurrent restore</summary>

```diff
 export function beginRnpmRestore(ownerId: string): void {
   if (hasActiveRnpmSearch(ownerId)) throw new RnpmSearchActiveError();
+  if (restoring.has(ownerId)) throw new RnpmRestoreInProgressError();
   restoring.add(ownerId);
 }
```
</details>

<details><summary>Sugestie</summary>

```
export function beginRnpmRestore(ownerId: string): void {
  if (hasActiveRnpmSearch(ownerId)) throw new RnpmSearchActiveError();
  if (restoring.has(ownerId)) throw new RnpmRestoreInProgressError();
  restoring.add(ownerId);
}

export function endRnpmRestore(ownerId: string): void {
  restoring.delete(ownerId);
}
```

</details>

---

## `backend/src/db/rnpmDb.ts`

### L58-L78 — actionable (major)

**Lazy provisioning does blocking snapshot work on the request thread.**

`getRnpmDb` is invoked from repository calls during HTTP handling, and the first call for an owner with pending migrations runs `VACUUM INTO` plus sync `fs` calls, blocking the event loop for the whole snapshot. Consider warming owner handles at boot (or moving the pre-migration snapshot to the worker used by `snapshotRunner`) so no request path pays it.

As per coding guidelines: "Backend-ul trebuie sa foloseasca acces asincron prin `fs/promises`; nu folosi sync filesystem in handlers."





Also applies to: 146-150

---

## `backend/src/index.ts`

### L903-L915 — actionable (major)

**`runRetentionPurge()` rulează neprotejat în timere — o excepție devine uncaught și omoară procesul.**

Toate celelalte timere din acest bloc (`reservationPurgeInterval`, `jwtPurgeInterval`) au try/catch tocmai pentru asta. Purge-ul atinge DB-ul (poate arunca la `SQLITE_BUSY`, DB închis în timpul shutdown-ului etc.), iar în callback-ul unui `setInterval` excepția nu are handler. Dacă funcția e async, un reject devine unhandled rejection.




<details>
<summary>🛡️ Fix propus</summary>

```diff
+  const safeRetentionPurge = (): void => {
+    try {
+      const r = runRetentionPurge() as unknown;
+      if (r instanceof Promise) r.catch((e) => console.warn("[retention] purge failed:", e));
+    } catch (e) {
+      console.warn("[retention] purge failed:", e instanceof Error ? e.message : e);
+    }
+  };
-  retentionPurgeInterval = setInterval(() => {
-    runRetentionPurge();
-  }, RETENTION_PURGE_INTERVAL_MS);
+  retentionPurgeInterval = setInterval(safeRetentionPurge, RETENTION_PURGE_INTERVAL_MS);
   retentionPurgeInterval.unref?.();
-  retentionInitialTimer = setTimeout(() => {
-    runRetentionPurge();
-  }, 60_000);
+  retentionInitialTimer = setTimeout(safeRetentionPurge, 60_000);
   retentionInitialTimer.unref?.();
```
</details>

<details><summary>Sugestie</summary>

```
// E4: in AMBELE moduri (desktop + web) — finding-ul acopera exact
  // deploy-urile cu MONITORING_ENABLED=0, indiferent de mod.
  const safeRetentionPurge = (): void => {
    try {
      const r = runRetentionPurge() as unknown;
      if (r instanceof Promise) r.catch((e) => console.warn("[retention] purge failed:", e));
    } catch (e) {
      console.warn("[retention] purge failed:", e instanceof Error ? e.message : e);
    }
  };
  retentionPurgeInterval = setInterval(safeRetentionPurge, RETENTION_PURGE_INTERVAL_MS);
  retentionPurgeInterval.unref?.();
  // Timerul de 24h de mai sus nu ruleaza niciodata pe procese cu viata scurta
  // (desktop inchis zilnic) — un run initial amanat 60s dupa boot asigura
  // retentia si pe sesiunile care nu supravietuiesc pana la primul tick.
  retentionInitialTimer = setTimeout(safeRetentionPurge, 60_000);
  retentionInitialTimer.unref?.();
```

</details>

---

## `backend/src/middleware/requireDesktopHeaderGlobal.ts`

### L19 — actionable (major)

**Kill-switch silently disables the SEC-01 CSRF guard.**

`LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING=1` removes the only defense against the loopback simple-request CSRF described in the header comment, with no boot-time warning and no trace in the response. Log it once at startup so a stale escape hatch in someone's environment is visible instead of invisible.





<details>
<summary>🔒 Warn once at module load</summary>

```diff
 const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
+
+if (process.env.LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING === "1") {
+  console.warn(
+    "[sec-01] LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING=1: guard-ul CSRF desktop este DEZACTIVAT. Nu folosi in productie."
+  );
+}
```
</details>

<details><summary>Sugestie</summary>

```
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

if (process.env.LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING === "1") {
  console.warn(
    "[sec-01] LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING=1: guard-ul CSRF desktop este DEZACTIVAT. Nu folosi in productie."
  );
}
```

</details>

---

## `backend/src/routes/openapi.ts`

### L66-L69 — actionable (minor)

**Document the 413 path too.**

The shared `responses` map lists 200/401/403/429/503, but `/api/dosare` can now answer 413 both for oversized SOAP payloads and for the new `limitHit` fan-out cap. Clients generated from this spec will treat it as undocumented.





<details>
<summary>📘 Add the response entry for this prefix</summary>

```diff
   if (prefix === "/api/dosare") {
     op.description =
       "Raspuns imbogatit: `exactMatch` (boolean, DOAR pe numar dosar) + `parti[].calitateParte`. Forma legacy `{ data, total, exactMatch }`. Optional `failedInstitutii: string[]` = raspuns 200 cu rezultate PARTIALE (instantele listate nu au raspuns, dosarele lor lipsesc; inainte de v2.43.1 acest caz era eroare 500).";
+    (op.responses as Record<string, unknown>)["413"] = {
+      description: "Rezultat prea mare (peste plafonul de dosare sau raspuns SOAP peste cap).",
+    };
   }
```
</details>

<details><summary>Sugestie</summary>

```
if (prefix === "/api/dosare") {
    op.description =
      "Raspuns imbogatit: `exactMatch` (boolean, DOAR pe numar dosar) + `parti[].calitateParte`. Forma legacy `{ data, total, exactMatch }`. Optional `failedInstitutii: string[]` = raspuns 200 cu rezultate PARTIALE (instantele listate nu au raspuns, dosarele lor lipsesc; inainte de v2.43.1 acest caz era eroare 500).";
    (op.responses as Record<string, unknown>)["413"] = {
      description: "Rezultat prea mare (peste plafonul de dosare sau raspuns SOAP peste cap).",
    };
  }
```

</details>

---

## `backend/src/routes/rnpm.ts`

### L247-L261 — actionable (major)

**Restore guard runs after the captcha guard, so a 409'd request still burns captcha quota.**

`withRnpmCaptchaGuards` (Line 247) performs the accounting side effects on the tenant path — `reserveTokenCaptcha` (committed row, fail-closed cap) or `recordCaptchaUsage` — before the `isRnpmRestoreInProgress` check at Line 256. A request rejected with 409 therefore consumes a captcha slot from the per-user/per-token window. The comment claims only the *audit* stays after the guard, but the reservation itself is inside the guard.

The restore latch doesn't depend on the parsed body, so it can move above the guard call. Same ordering applies to `/bulk` (Lines 497-506) and `/search-split` (Lines 639-648).





<details>
<summary>🔧 Proposed reorder for /search</summary>

```diff
+  if (isRnpmRestoreInProgress(ownerId)) {
+    return c.json(
+      fail("RESTORE_IN_PROGRESS", "Restaurare in curs pentru acest cont; reincearca dupa finalizare", c),
+      409
+    );
+  }
   const guard = await withRnpmCaptchaGuards(c, parsedBody);
   if (!guard.ok) return guard.response;
   const { body, captchaKey } = guard;
-  if (isRnpmRestoreInProgress(getOwnerId(c))) {
-    return c.json(
-      fail("RESTORE_IN_PROGRESS", "Restaurare in curs pentru acest cont; reincearca dupa finalizare", c),
-      409
-    );
-  }
```
</details>

<details><summary>Sugestie</summary>

```
if (isRnpmRestoreInProgress(ownerId)) {
    return c.json(
      fail("RESTORE_IN_PROGRESS", "Restaurare in curs pentru acest cont; reincearca dupa finalizare", c),
      409
    );
  }
  const guard = await withRnpmCaptchaGuards(c, parsedBody);
  if (!guard.ok) return guard.response;
  const { body, captchaKey } = guard;
  // v2.43.0 (rnpm-split): gardul de restore loveste imediat dupa parsarea
  // body-ului si INAINTE de streamSSE — un throw dupa ce stream-ul a pornit
  // inseamna 200 deja trimis si eroare in mijlocul stream-ului. Rezolutia
  // configuratiei CAPTCHA a rulat inainte de owner/storage ca web-mode sa-si
  // pastreze raspunsul canonic 501; consumul CAPTCHA ramane dupa limita de
  // stocare. Restore-ul sta inainte de auditul de consum.
```

</details>

---

## `backend/src/services/retentionPurge.test.ts`

### L35-L49 — actionable (major)

**Keep raw SQL fixtures under `backend/src/db/`.**

These service-layer helpers execute raw `INSERT` statements directly. Move the test-only seed helpers into a DB-layer test-support module and call them here.





As per coding guidelines, “Accesul la baza de date este repository-only: SQL raw poate exista doar în `backend/src/db/**`.”

---

## `backend/src/soap.ts`

### L131-L139 — actionable (minor)

**Drain the response body before rejecting on redirect.**

The redirect-detection branch throws without cancelling `response.body`. Redirect responses often carry a small HTML body; leaving it unconsumed can hold the underlying connection open. The PR already applies this exact drain pattern elsewhere for terminal branches (`rnpmClient.ts`'s 400/404/410 handling, `streamCap.ts`'s cap-exceeded path) — this branch should match for consistency.




<details>
<summary>🔧 Proposed fix</summary>

```diff
   if (response.status >= 300 && response.status < 400) {
     console.error(`[soap] redirect neasteptat (status ${response.status}) — refuzat`);
+    await response.body?.cancel().catch(() => {});
     throw new Error("Raspuns neasteptat de la PortalJust (redirect).");
   }
```
</details>

<details><summary>Sugestie</summary>

```
redirect: "manual",
    signal: combinedSignal,
  });

  if (response.status >= 300 && response.status < 400) {
    console.error(`[soap] redirect neasteptat (status ${response.status}) — refuzat`);
    await response.body?.cancel().catch(() => {});
    throw new Error("Raspuns neasteptat de la PortalJust (redirect).");
  }
```

</details>

---

## `deploy/.env.prod.example`

### L87 — actionable (major)

**Align the production default with v2.43.2.**

The repository’s current release and package manifests are `v2.43.2`, but this template still sets `APP_VERSION=2.43.0`. A deployment using the template as-is will run the older image and miss the v2.43.2 changes.

---

## `deploy/docker-compose.prod.yml`

### L84 — actionable (major)

**Update the image fallback to v2.43.2.**

This compose file still defaults to `legal-dashboard:2.43.0`, while the current release and package manifests are `v2.43.2`. Without an explicit `APP_VERSION`, production deploys the older release.

---

## `docker-compose.yml`

### L82 — actionable (major)

**Update the image fallback to v2.43.2.**

The compose file still defaults to `legal-dashboard:2.43.0`, but the current release and package manifests are `v2.43.2`. Deployments without an explicit `APP_VERSION` will therefore run the older image.

---

## `docs/superpowers/plans/2026-07-11-fixes-audit-v2.43-core.md`

### L19-L20 — actionable (major)

**Nu excepta rutele RNPM de la envelope-ul standard.**

Linia 19 impune intenționat răspunsuri non-envelope pentru RNPM, ceea ce contrazice cerința repository-wide și ar face Task 9 să livreze un contract API inconsistent. Aplică envelope-ul standard și pe RNPM sau documentează o excepție aprobată separat.

As per coding guidelines, `backend/src/**/*.{ts,tsx}` trebuie să folosească envelope-ul `{ data, error: { code, message }, requestId }`.

---

## `docs/superpowers/plans/2026-07-11-fixes-rev4-rnpm-split.md`

### L441-L449 — actionable (major)

**Folosește acces asincron pentru rezervarea numelui.**

`uniqueManualBackupName` execută `fs.existsSync` pe calea backup-ului manual, blocând thread-ul backendului. Transformă helperul în `async`, verifică existența prin `fs/promises` și păstrează rezervarea sub același lock.

As per coding guidelines, backend-ul trebuie să folosească acces asincron prin `fs/promises`.

---

## `docs/superpowers/plans/2026-07-12-rnpm-autocompact-delete-batch.md`

### L34-L35 — actionable (major)

**Synchronize Task 1 with the final Rev. 3 contract.**

The earlier implementation steps still instruct measurement through `getRnpmDb`, but Rev. 3 explicitly forbids that after acquiring the restore latch and requires a direct handle. The earlier return type also omits `coalesced`, `durationMs`, and `reason`. Update the task interface and implementation recipe so workers cannot follow the unsafe/stale path.





Also applies to: 65-65, 140-152

---

## `docs/superpowers/plans/2026-07-19-partial-results-portaljust.md`

### L350-L358 — actionable (major)

**Add the contract documentation files to Task 3.**

Step 3(g) makes `API.md` and `backend/src/routes/openapi.ts` mandatory, but they are missing from the task’s Files list and commit command. Add both files to the task, tests, and final verification so PAT/MCP consumers receive the `failedInstitutii` partial-result contract.





Also applies to: 567-573

---

## `docs/superpowers/plans/2026-07-19-remediere-audit-sec-v2.43.md`

### L1-L5 — actionable (major)

**Restore or remove this truncated plan.**

The file is incomplete and cannot serve as an implementation plan: it ends mid-sentence after “workflow-ul de verificare independ”. Restore the full document or remove the partial artifact before merge to avoid tooling and reviewer confusion.

---

## `docs/superpowers/specs/2026-07-10-rnpm-split-per-user-design.md`

### L40-L49 — actionable (major)

**Use one canonical owner-to-path mapping everywhere.**

The layout defines `stem = lowercase(ownerId) + sha256(ownerId)[0..10]`, but later sections use `rnpm/local.db` and `backups/rnpm/<ownerId>/`. This creates an inconsistent database/jail contract and can make backups inaccessible or route an owner to a different path. Define and use the hashed stem for desktop, repositories, backup jails, and route parameters consistently.





Also applies to: 100-101, 146-149

---

## `frontend/src/components/UserPicker.tsx`

### L97-L102 — actionable (minor)

**Truncation notice claims the 1000 cap even when the anti-loop guard stopped paging.**

The condition is `total > users.length`, which is also true when a page comes back empty while `total` promised more (users deleted mid-pagination — exactly the second test's scenario: 200 loaded of 250, message says "trunchiata la 1000"). Gate the cap wording on actually hitting `MAX_USERS`.




<details>
<summary>🐛 Proposed fix</summary>

```diff
-        {!loading && total > users.length && (
+        {!loading && total > users.length && (
           <p className="text-xs text-muted-foreground">
-            Se afiseaza {users.length} din {total} utilizatori activi — lista e trunchiata la {MAX_USERS}, unii
-            utilizatori pot lipsi din dropdown.
+            Se afiseaza {users.length} din {total} utilizatori activi
+            {users.length >= MAX_USERS ? ` — lista e trunchiata la ${MAX_USERS}` : ""}, unii utilizatori pot lipsi din
+            dropdown.
           </p>
         )}
```
</details>

<details><summary>Sugestie</summary>

```
{!loading && total > users.length && (
          <p className="text-xs text-muted-foreground">
            Se afiseaza {users.length} din {total} utilizatori activi
            {users.length >= MAX_USERS ? ` — lista e trunchiata la ${MAX_USERS}` : ""}, unii utilizatori pot lipsi din
            dropdown.
          </p>
        )}
```

</details>

---

## `frontend/src/components/rnpm/RnpmSavedStats.tsx`

### L127-L144 — actionable (minor)

**Backup creation isn't guarded against modal close mid-flight.**

The modal's ESC handler (line 103), backdrop click (line 226), and close button (line 242) only check `compacting` to block closing. `creatingBackup` isn't included, so closing the modal while `handleCreateBackup` is in-flight lets `setCompactMsg`/`setFolderError`/`setCreatingBackup` fire after `StatsModal` unmounts.




<details>
<summary>🔒 Proposed fix</summary>

```diff
   useEffect(() => {
     const onKey = (e: KeyboardEvent) => {
-      if (e.key === "Escape" && !compacting) onClose();
+      if (e.key === "Escape" && !compacting && !creatingBackup) onClose();
     };
     window.addEventListener("keydown", onKey);
     return () => window.removeEventListener("keydown", onKey);
-  }, [onClose, compacting]);
+  }, [onClose, compacting, creatingBackup]);
```
Apply the analogous `!creatingBackup` guard to the backdrop `onClick` (line 226) and the close button's `disabled`/`title` (lines 242-244).
</details>

---

## `frontend/src/data/changelog-entries.tsx`

### L43-L46 — actionable (minor)

**Keep the in-app release date consistent.**

The entry is dated July 21, while the same v2.43.2 release contains changes dated July 22 and July 25 in the repository changelog. Sync this metadata with the authoritative release date.

---

## `frontend/src/hooks/useDosareAi.ts`

### L83-L106 — actionable (minor)

**Fereastra de „loading" pe desktop trimite request fără chei.**

`byokMode` e adevărat doar când `tenant.state.state === "desktop"`. Cât timp `useTenantKeyStatus` e încă în `loading` pe desktop, `bodyKeys` e `undefined`, iar `providerHasKey` face fail-open → un click pe Analiza în acel interval pleacă fără chei BYOK și primește `NO_API_KEY` de la backend, deși cheile locale există.

O opțiune simplă: tratează starea nerezolvată ca BYOK când `apiKeys` există local.





<details>
<summary>🐛 Fix propus</summary>

```diff
-  const byokMode = tenant.state.state === "desktop";
+  // Pana la rezolvarea statusului tenant, pe desktop cheile locale raman valabile:
+  // doar starea "ready" (web) exclude BYOK din body.
+  const byokMode = tenant.state.state !== "ready";
   const bodyKeys = byokMode ? apiKeys : undefined;
```
</details>

---

## `frontend/src/lib/adminApi.ts`

### L157-L172 — actionable (major)

**Make these admin listings offset-paginated.**

The API contract only signals `truncated`; it provides no way to request records beyond the cap. Add `page`/`pageSize` request parameters and return `page`, `pageSize`, and `total` with each list, then update these client wrappers and UI pagination.





As per coding guidelines, “Folosește pagination offset-based cu forma `{ page, pageSize, total }` pentru listările principale.”


Also applies to: 214-221, 471-474, 520-527

---

## `frontend/src/lib/auditOutcome.ts`

### L12-L13 — actionable (minor)

**Use a generic localized fallback for unknown outcomes.**

`outcomeLabel` is a display helper, so interpolating an unrecognized backend value violates the no-raw-token UI contract. Return `Necunoscut` and update its fallback test.





As per coding guidelines, “nu afișa token-uri raw în DOM.”

---

## `frontend/src/lib/export-manual.ts`

### L404-L409 — actionable (major)

**Distinguish desktop and web storage in the save instructions.**

Line 398 still says the key is stored locally for every mode, while these lines state that web keys are stored server-side. Update the earlier instruction so users are not given an incorrect local-only retention expectation.

<details>
<summary>Suggested wording</summary>

```diff
- Apasa "Salveaza" — cheia este stocata local pe calculatorul tau
+ Apasa "Salveaza" — pe desktop cheia este stocata local; in web este stocata server-side per utilizator
```
</details>

<details><summary>Sugestie</summary>

```
addBullet(
    "Apasa \"Salveaza\" — pe desktop cheia este stocata local; in web este stocata server-side per utilizator"
  );
```

</details>

---

## `frontend/src/lib/monitoringRunStatus.ts`

### L11-L14 — actionable (minor)

**Do not render unknown monitoring status tokens.**

The own-property guard is correct, but the fallback inserts `status` directly into a display string. Use a generic localized fallback and update the corresponding test cases.





As per coding guidelines, “nu afișa token-uri raw în DOM.”

---

## `frontend/src/lib/quotaFeatureLabels.ts`

### L31-L33 — actionable (minor)

**Do not expose unknown backend tokens in UI labels.**

This fallback is intended for table display but renders the raw `feature` token. Return a generic localized label such as `Necunoscut`; retain the token only in non-DOM diagnostics, and update the associated tests.





As per coding guidelines, “nu afișa token-uri raw în DOM.”

---

## `frontend/src/lib/quotaPeriodLabels.ts`

### L14-L20 — actionable (minor)

**Keep unknown period tokens out of rendered labels.**

The runtime fallback embeds the backend token in a UI label. Use a generic localized fallback and adjust the test accordingly.





As per coding guidelines, “nu afișa token-uri raw în DOM.”

---

## `frontend/src/pages/Dosare.tsx`

### L89-L93 — actionable (minor)

**Pluralization bug when exactly 4 institutions fail.**

`labels.length - 3` can be `1`, producing "si alte 1 instante" — wrong Romanian plural/count agreement.




<details>
<summary>🐛 Proposed fix</summary>

```diff
 function formatFailedInstitutii(tokens: string[]): string {
   const labels = tokens.map((t) => getInstitutieLabel(t));
   if (labels.length <= 3) return labels.join(", ");
-  return `${labels.slice(0, 3).join(", ")} si alte ${labels.length - 3} instante`;
+  const remaining = labels.length - 3;
+  const suffix = remaining === 1 ? "si inca o instanta" : `si alte ${remaining} instante`;
+  return `${labels.slice(0, 3).join(", ")} ${suffix}`;
 }
```
</details>

<details><summary>Sugestie</summary>

```
function formatFailedInstitutii(tokens: string[]): string {
  const labels = tokens.map((t) => getInstitutieLabel(t));
  if (labels.length <= 3) return labels.join(", ");
  const remaining = labels.length - 3;
  const suffix = remaining === 1 ? "si inca o instanta" : `si alte ${remaining} instante`;
  return `${labels.slice(0, 3).join(", ")} ${suffix}`;
}
```

</details>

---

## `frontend/src/pages/admin/Quota.tsx`

### L292-L298 — actionable (minor)

**Empty-state copy contradicts the storage default described above.**

The header text (Lines 256-257) states storage falls back to the configured default, but this empty state asserts every user has an unlimited budget without qualifying that it covers AI/captcha only in the same terms. Align the wording (e.g. mention that RNPM storage uses the configured default) so admins don't read "nelimitat" as applying to storage too.

---

## `scripts/dev-web-local.ps1`

### L40-L58 — actionable (minor)

**Clean up child processes on interactive cancellation.**

`Stop-Started()` only runs via `Fail()`. Cancelling the script during startup can leave its backend/proxy children alive, causing the next run to fail its port precheck. Add cancellation/exit cleanup that calls `Stop-Started()` on unsuccessful termination.

---
