# Plan de Remediere — v2.33.0 Security Hardening

**Sursa**: Codex external advisor review (NO-GO verdict) + 3 specialized agent investigations
**Data**: 2026-05-19
**Scope**: Fix-uri necesare pe cele 4 cluster plans (`FIX-PLAN-CLUSTER-*.md`) inainte de dispatch catre Codex pentru implementare.

---

## Cum se foloseste acest plan

Acest fisier listeaza **modificarile pe cluster plans existente** (NU pe cod-ul de productie). Workflow:

1. Cezar deschide fiecare cluster plan (`audit/FIX-PLAN-CLUSTER-*.md`).
2. Aplica modificarile listate aici prin Edit/Search-Replace (sau dispach-uieste catre Codex un task care cere "edit cluster plan files per FIX-PLAN-v2.33.0-REMEDIATION.md").
3. Re-ruleaza Codex advisor pass scurt pe cluster files modificate.
4. Daca GO → dispatch cele 4 cluster plans efective catre Codex pentru implementare in cod.

Acest fisier **NU** descrie cod productie schimbat — descrie cum trebuie modificate planurile existente.

---

## BLOCKER-1: `provider='unknown'` violeaza CHECK constraint pe `ai_usage`

**Cluster afectat**: `FIX-PLAN-CLUSTER-QUOTA-BUDGET.md` (CRITICAL-1, reservation pattern)

### Confirmare problema

`backend/src/db/migrations/0010_ai_usage.up.sql:10` (rebuilt identical in `0024_ai_usage_openrouter.up.sql:9` + `0025_ai_usage_owner_default.up.sql:11`) defineste:

```sql
provider TEXT NOT NULL CHECK(provider IN ('anthropic','openai','google','openrouter'))
```

Planul curent in `FIX-PLAN-CLUSTER-QUOTA-BUDGET.md:179` propune:

```sql
INSERT INTO ai_usage (owner_id, feature, provider, model, status, ...)
VALUES (?, ?, 'unknown', 'pending', ...)
```

Asta esueaza la prima reservation in productie cu `SQLITE_CONSTRAINT_CHECK`.

### Fix recomandat: Option C — pass real provider

Route handler-ul **stie deja provider-ul** la momentul quotaGuard apel (selectie facuta inainte de SDK call). Pass-eaza provider real la `insertAiUsageReservation`.

**Modificari in `FIX-PLAN-CLUSTER-QUOTA-BUDGET.md`**:

1. **InsertReservationInput** — adauga field `provider`:
```typescript
export interface InsertReservationInput {
  ownerId: string;
  provider: AiUsageProvider;   // NEW — real provider known at guard time
  feature: string;
  estimatedCostUsdMilli: number;
  requestId?: string | null;
}
```

2. **insertAiUsageReservation INSERT** — schimba `'unknown'` cu `input.provider`:
```sql
INSERT INTO ai_usage (
  owner_id, feature, provider, model, status,
  estimated_cost_usd_milli, cost_usd_milli, request_id, ts
) VALUES (?, ?, ?, 'pending', 'pending', ?, 0, ?, strftime('%s','now')*1000)
```
(`model='pending'` ramane — `CHECK(length(model) > 0)` accepta).

3. **Toate call site-urile** la `insertAiUsageReservation` din quotaGuard / route handlers — adauga argument `provider`.

4. **Migration 0032** — `ADD COLUMN` e safe pe SQLite 3.35+ (Electron 41 = SQLite 3.46), NU necesita table rebuild. Adauga la down migration `DROP COLUMN` real (nu doar "restore backup"):

```sql
-- 0032_ai_usage_reservation.down.sql
DROP INDEX IF EXISTS idx_ai_usage_pending;
ALTER TABLE ai_usage DROP COLUMN estimated_cost_usd_milli;
ALTER TABLE ai_usage DROP COLUMN status;
-- Pe SQLite < 3.35: restore din pre-migration backup snapshot.
```

### Verificare desktop impact

`quotaGuard` returneaza `next()` la `getAuthMode() !== "web"` (line 40). `insertAiUsage` desktop call NU expune `status`, deci default `'confirmed'` se aplica automat. Zero impact.

---

## BLOCKER-2: `instanceLock.ts` race conditions (check-then-write + reclaim)

**Cluster afectat**: `FIX-PLAN-CLUSTER-DEPLOYMENT-TOPOLOGY.md` (HIGH-2, lines 43-211)

### Confirmare problema

Implementarea propusa are **doua ferestre de race non-atomice**:

1. **Initial claim**: `readLock()` returneaza null → `writeFileSync()`. Doua replici Docker care boot-eaza simultan vad ambele null si scriu peste — last writer wins silent.

2. **Stale reclaim**: doua procese vad ambele acelasi lockfile stale, ambele `unlinkSync` (al doilea ENOENT swallowed), ambele `writeLock`. Race papered over de comentariul "writeLock overwrite va merge oricum".

### Fix recomandat: open(`wx`) + rename atomic

**Modificari in `FIX-PLAN-CLUSTER-DEPLOYMENT-TOPOLOGY.md` (functia `acquireInstanceLock`)**:

```typescript
import { openSync, writeSync, closeSync, renameSync, readFileSync, unlinkSync, existsSync, readdirSync } from "node:fs";

export function acquireInstanceLock(dataDir: string, appVersion?: string): void {
  if (process.env.LEGAL_DASHBOARD_FORCE_BOOT === "1") {
    console.warn("[instanceLock] LEGAL_DASHBOARD_FORCE_BOOT=1 - boot fortat.");
    forceClaim(dataDir, appVersion);
    cleanupDeadSidecars(dataDir);
    startHeartbeat(dataDir, appVersion);
    return;
  }

  const path = lockPath(dataDir);

  // First atomic claim attempt — 'wx' = O_CREAT|O_EXCL (POSIX) / CREATE_NEW (Win32)
  let fd: number | null = null;
  try {
    fd = openSync(path, "wx");
    writeSync(fd, JSON.stringify(buildRecord(appVersion)));
    closeSync(fd);
    cleanupDeadSidecars(dataDir);
    startHeartbeat(dataDir, appVersion);
    return;
  } catch (err) {
    if (fd !== null) try { closeSync(fd); } catch {}
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    // Lockfile already exists — evaluate ownership
  }

  // Inspect existing lock
  const existing = readLockSafe(path);
  if (existing) {
    const sameHost = existing.hostname === osHostname();
    const heartbeatAge = Date.now() - existing.heartbeatAt;
    const stale = heartbeatAge > STALE_FACTOR * HEARTBEAT_MS;
    const alive = sameHost ? processAlive(existing.pid) : !stale;

    if (alive && !stale) {
      console.error(
        `[instanceLock] Alt proces detine lock-ul: pid=${existing.pid} host=${existing.hostname} ` +
        `heartbeat acum ${heartbeatAge}ms. Refuz boot.`
      );
      writeBootRefusedLog(dataDir, existing, heartbeatAge);
      process.exit(1);
    }
  }

  // Atomic stale reclaim: rename to dead-sidecar (only one process wins)
  const deadPath = `${path}.dead-${existing?.pid ?? "unknown"}-${Date.now()}`;
  try {
    renameSync(path, deadPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Peer reclaimed first — we are loser, refuse boot
      console.error("[instanceLock] Peer reclaim race lost; refuz boot.");
      process.exit(1);
    }
    throw err;
  }

  // Record audit for the reclaim (only the winner reaches here)
  // NOTE: DB not yet open at this point — defer audit OR call after getDb().
  // Recomandare: salveaza reclaim info in-memory, emite audit dupa getDb() init.
  pendingReclaimAudit = {
    previousPid: existing?.pid ?? null,
    previousHostname: existing?.hostname ?? null,
    previousHeartbeatAgeMs: existing ? Date.now() - existing.heartbeatAt : null,
  };

  // Now claim atomically
  try {
    fd = openSync(path, "wx");
    writeSync(fd, JSON.stringify(buildRecord(appVersion)));
    closeSync(fd);
  } catch (err) {
    if (fd !== null) try { closeSync(fd); } catch {}
    // Extremely rare: another process won between rename and our claim
    console.error("[instanceLock] Claim post-reclaim failed:", err);
    process.exit(1);
  }

  cleanupDeadSidecars(dataDir);
  startHeartbeat(dataDir, appVersion);
}

let pendingReclaimAudit: { previousPid: number | null; previousHostname: string | null; previousHeartbeatAgeMs: number | null } | null = null;

export function flushPendingReclaimAudit(): void {
  if (!pendingReclaimAudit) return;
  recordAudit(null, "instance.lock.reclaimed", {
    detail: pendingReclaimAudit,  // <-- detail, NU metadata
  });
  pendingReclaimAudit = null;
}

function cleanupDeadSidecars(dataDir: string): void {
  try {
    const lockBase = ".instance.lock";
    const entries = readdirSync(dataDir).filter((f) => f.startsWith(`${lockBase}.dead-`));
    for (const entry of entries.slice(0, 50)) { // cap to prevent unbounded glob
      try { unlinkSync(join(dataDir, entry)); } catch {}
    }
  } catch {}
}

function writeBootRefusedLog(dataDir: string, peer: LockRecord, heartbeatAge: number): void {
  try {
    const logPath = join(dataDir, "boot-refused.log");
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      myPid: process.pid,
      myHostname: osHostname(),
      peerPid: peer.pid,
      peerHostname: peer.hostname,
      heartbeatAgeMs: heartbeatAge,
    }) + "\n";
    writeFileSync(logPath, entry, { flag: "a" });
  } catch {}
}
```

### Modificari secundare

1. **Raise STALE_FACTOR la 6** (de la 3) — 30-second window vs event-loop starvation under OOM pressure.

2. **flushPendingReclaimAudit()** — apelat din `index.ts` IMEDIAT dupa `getDb()` initialization (DB ready) si inainte de oricare alt repository write. Asta rezolva problema agentului 3: `recordAudit` necesita DB open.

3. **Module init order verification**: `index.ts` trebuie sa apeleze `acquireInstanceLock(dataDir)` **inainte** de orice import care declanseaza `getDb()` lazy. Adauga comentariu explicit in `index.ts` linia care apeleaza acquire.

4. **Docker volume scope** — adauga in header-ul modulului: "NFS/CIFS volumes nu sunt supportate; SQLite WAL mode oricum nu suporta NFS per upstream SQLite docs. Bind mounts + named volumes ext4/overlay2/NTFS/APFS OK."

5. **Electron coexistence**: lockfile e redundant pe desktop (app.requestSingleInstanceLock acopera), dar cheap. NU conflict.

---

## BLOCKER-3: `metadata:` field nu exista in `AuditOptions`

**Cluster afectat**: 2 lines exact in 2 fisiere

### Confirmare problema

`backend/src/db/auditRepository.ts:13-27` defineste `AuditOptions` cu `detail?: Record<string, unknown> | null` la line 17. **NU exista** field `metadata`. `serializeDetail` la line 105 citeste doar `options.detail`. Daca apelezi cu `{ metadata: { ... } }`:
- TypeScript strict: excess-property error la call site.
- Runtime: `options.detail` = undefined → `serializeDetail` returneaza `"{}"` (data lost silent).

### Fix

**2 line edits**:

1. `audit/FIX-PLAN-CLUSTER-DEPLOYMENT-TOPOLOGY.md:142` — schimba `metadata: {` cu `detail: {` (in `recordAudit(null, "instance.lock.reclaimed", {...})`).

2. `audit/FIX-PLAN-CLUSTER-VALIDATION-IO.md:226` — schimba `metadata: {` cu `detail: {` (in `recordAudit(null, "rnpm.validation.disabled", {...})`).

**Restul call site-urilor** (AUDIT-TRAIL `181, 258, 261, 271, 274, 333, 362, 395, 569, 662` si QUOTA-BUDGET `841-851`) folosesc deja `detail:` corect.

---

## BLOCKER-4: `auth.logout` audit blocat de `ownerContext` skip

**Cluster afectat**: `FIX-PLAN-CLUSTER-AUDIT-TRAIL.md` (TASK 6, lines 563-581)

### Confirmare problema

`backend/src/middleware/owner.ts:29-31` (`shouldAuthenticatePath`) returneaza `false` pentru `/api/v1/auth/logout`. Astfel `ownerContext` apeleaza `next()` fara sa seteze `ownerId` / `actorId` pe context. Cand handler-ul de logout face `recordAudit(c, ...)`:

- `readContext(c)` → `getOwnerId(c)` (line 51)
- `getOwnerId` la lines 95-99: `c.get("ownerId")` = undefined → in **web mode** arunca `"ownerId missing from authenticated web request context"`.

Planul curent wrap-uieste `recordAudit` in try/catch, dar consecinta e ca audit row-ul ajunge cu `owner_id=NULL` + `actor_id=NULL` — **non-atributabil**, defeating the purpose.

### Fix recomandat: Option A — extract JWT inainte de cookie clear

**Modificari in `FIX-PLAN-CLUSTER-AUDIT-TRAIL.md` TASK 6**:

```typescript
// backend/src/routes/auth.ts (logout handler)

function decodeJwtPayload(token: string): { sub?: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

authRouter.post("/logout", (c) => {
  // Extract actor identity BEFORE cookie clear. No verify needed -- only
  // reading sub claim for audit attribution, not granting access.
  let auditOwnerId: string | null = null;
  let auditActorId: string | null = null;
  try {
    const raw = getCookie(c, AUTH_COOKIE_NAME);
    if (raw) {
      const payload = decodeJwtPayload(raw);
      auditOwnerId = payload?.sub ?? null;
      auditActorId = payload?.sub ?? null;
    }
  } catch { /* best-effort */ }

  try {
    // recordAudit(null, ...) bypass-uieste readContext / getOwnerId,
    // furnizam explicit ownerId/actorId in options.
    recordAudit(null, "auth.logout", {
      ownerId: auditOwnerId,
      actorId: auditActorId,
      ip: readRemoteIp(c),
      userAgent: c.req.header("user-agent") ?? null,
      detail: { triggered: "user_request" },
    });
  } catch (err) {
    console.error("[auth] auth.logout audit failed:", err);
  }

  deleteCookie(c, AUTH_COOKIE_NAME, { secure: secureCookie(), sameSite: "Lax", path: "/" });
  return c.json(ok({ loggedOut: true }, c), 200);
});
```

### Prerequisite verification

Inainte de a modifica planul, confirma in `auditRepository.ts:13-27` ca `AuditOptions` expune **explicit** `ownerId?: string | null` si `actorId?: string | null` (suprascriere fata de `readContext`). Daca nu, adauga acele field-uri ca prim sub-task in TASK 6.

---

## FIX-BEFORE-DISPATCH 5: CRITICAL-1 worst-case estimates fragile

**Cluster afectat**: `FIX-PLAN-CLUSTER-QUOTA-BUDGET.md:267-276, 513-520`

### Problema

Planul foloseste constante hand-maintained pentru `estimatedCostUsdMilli` per provider × feature. Daca pricing OpenRouter / Anthropic / Google se schimba (pricing drift 6 luni), reservation row sub-estimeaza si quota race recurge.

### Fix

Adauga in `FIX-PLAN-CLUSTER-QUOTA-BUDGET.md` o sectiune noua **"Estimate derivation"**:

1. Surse de adevar pentru estimate (in ordine de preferinta):
   - `backend/src/services/aiPricingRegistry.ts` (exista? — agent verify) — `getMaxCostMilli(provider, feature)`.
   - Daca registry nu exista: fallback la constanta env-override `LEGAL_DASHBOARD_QUOTA_ESTIMATE_MULTIPLIER` (default 2x).

2. Test obligatoriu: pentru fiecare provider × feature, `actualCostMilli <= estimatedCostMilli * 1.5` pe sample de 100 calls reale (CI smoke gated).

3. Daca registry **nu exista** in cod, creeaza-l ca pre-requisite **inainte** de a livra CRITICAL-1 — altfel estimate-urile raman frozen constants si problema reapare.

**Acceptable interim**: ramane pe constante hand-maintained DOAR daca registry-ul e tracked ca follow-up PR v2.34.0 cu test gating la 1.5x ratio.

---

## FIX-BEFORE-DISPATCH 6: SMTP sanitize incomplet (hostname leak)

**Cluster afectat**: `FIX-PLAN-CLUSTER-AUDIT-TRAIL.md` TASK 1-2 (lines 32-34, 94-105, 127-129)

### Problema

`sanitizeSmtpError` propus pastreaza `mail.example.com` / `smtp.example.com` ca "provider internals" — dar acestea **sunt** internals si pot leak-ui topology backend in audit log.

### Fix

Extinde `EMAIL_REGEX` cu un al doilea regex pentru hostnames de SMTP:

```typescript
const EMAIL_REGEX = /\S+@\S+\.\S+/g;
const SMTP_HOST_REGEX = /\b(?:mail|smtp|relay|mx)[-.][\w.-]+\.[a-z]{2,}\b/gi;

function sanitizeSmtpError(err: Error & { code?: string }): string {
  // Whitelist err.code
  const codeWhitelist = ["ECONNREFUSED", "ETIMEDOUT", "EAUTH", "EENVELOPE", "ESOCKET", "EMESSAGE"];
  const code = codeWhitelist.includes(err.code ?? "") ? err.code : "ESMTP";

  // Sanitize message: redact emails + SMTP hostnames
  let msg = (err.message ?? "").slice(0, 200);
  msg = msg.replace(EMAIL_REGEX, "[email]");
  msg = msg.replace(SMTP_HOST_REGEX, "[smtp-host]");
  // Strip RCPT TO / MAIL FROM lines
  msg = msg.replace(/(RCPT TO|MAIL FROM)[:\s][^\s]+/gi, "$1 [addr]");

  return `${code}: ${msg.slice(0, 200)}`;
}
```

Adauga test: `sanitizeSmtpError({ message: "Cannot connect to smtp.gmail.com:587", code: "ECONNREFUSED" })` → returneaza string fara `smtp.gmail.com`.

---

## FIX-BEFORE-DISPATCH 7: Quota rollback documentat ca DB restore

**Cluster afectat**: `FIX-PLAN-CLUSTER-QUOTA-BUDGET.md:144-152, 650-690`

### Problema

Planul documenteaza rollback ca "restore DB snapshot". Dar SQLite 3.35+ (Electron 41 = 3.46) suporta `DROP COLUMN` nativ. Rollback poate fi pure code-level.

### Fix

Update sectiunea Rollback din QUOTA-BUDGET:

```markdown
### Rollback path

**Pe SQLite 3.35+ (Electron 41 + Docker oficial):**
```bash
# 1. Stop backend
docker compose stop backend

# 2. Manual SQL pe DB:
sqlite3 /data/legal-dashboard.db <<SQL
DROP INDEX IF EXISTS idx_ai_usage_pending;
ALTER TABLE ai_usage DROP COLUMN estimated_cost_usd_milli;
ALTER TABLE ai_usage DROP COLUMN status;
DELETE FROM _schema_versions WHERE version = 32;
SQL

# 3. Revert backend code la v2.32.0 si restart
```

**Pe SQLite < 3.35**: restore din pre-migration snapshot (auto-creat de
hardening v2.16.1 — vezi `backup-*-schema-upgrade.db`).
```

---

## FIX-BEFORE-DISPATCH 8: Caddy strip-header smoke insufficient

**Cluster afectat**: `FIX-PLAN-CLUSTER-DEPLOYMENT-TOPOLOGY.md:488-494`

### Problema

Smoke-ul propus verifica `docker compose logs caddy | grep X-Auth-Request-Email → empty`. Asta NU dovedeste ca backend-ul nu a primit header-ul — doar ca Caddy nu l-a log-uit.

### Fix

Adauga un endpoint defensiv in backend pentru integration test:

**Optiune A** (best): Adauga test integration `backend/src/middleware/spoofedHeaderReject.test.ts` care:
1. Boot-eaza backend cu mock Caddy → oauth2-proxy stack local.
2. Trimite request cu `curl -H "X-Auth-Request-Email: attacker@x.com"`.
3. Inspecteaza request-ul ajuns la backend (header capture middleware) → asertie `c.req.header("x-auth-request-email")` egal cu valoarea injectata de **oauth2-proxy** (sesiunea reala) sau NULL daca neautentificat, NU cu valoarea attacker.

**Optiune B** (lite): adauga middleware temporar in backend pe `/api/v1/diag/headers` (gated `LEGAL_DASHBOARD_DIAG=1`) care intoarce ce headers a primit. Smoke manual cu `curl -H "X-Auth-Request-Email:..."` → response NU contine valoarea injectata.

Update sectiunea "Test plan" in MEDIUM-5 cu acest paragraf.

---

## FIX-BEFORE-DISPATCH 9: Ordinea de dispatch — Quota+Budget PRIMA

**Cluster afectat**: `FIX-PLAN-v2.33.0-INDEX.md:28-31`

### Problema

Index-ul recomanda ordine: Audit Trail → Validation+IO → Deployment+Topology → Quota+Budget (cel mai izolat la cel mai complex). Codex recomanda inversare: **Quota+Budget primul**, fiindca:
- Singurul CRITICAL.
- Schema migration risk (migration 0032).
- Impact financiar direct (overshoot quota = bani pierduti).
- Cel mai mult de testat sub presiune (concurrent calls).

### Fix

Update `FIX-PLAN-v2.33.0-INDEX.md` sectiunea **2) Ordine dispatch**:

```markdown
## 2) Ordine dispatch recomandata catre Codex

Cele 4 clustere sunt independente. Ordinea recomandata (de la high-impact la izolat):

1. **Quota + Budget** (15h, CRITICAL + complex) - PR-D — dispach primul ca sa
   inchizi blast radius-ul cel mai mare cat mai devreme.
2. **Deployment + Topology** (5.5h, HIGH x2 + infra)
3. **Validation + External I/O** (5h, HIGH-1 + 3 MEDIUM)
4. **Audit Trail** (3.5h, cel mai izolat, low risk)
```

---

## Suma modificari per cluster

| Cluster file | Linii modificate | Tip schimbare |
|--------------|------------------|---------------|
| FIX-PLAN-CLUSTER-QUOTA-BUDGET.md | ~5 sectiuni | BLOCKER-1 fix, FIX 5/7 documentation, ordinea in index |
| FIX-PLAN-CLUSTER-DEPLOYMENT-TOPOLOGY.md | ~3 sectiuni | BLOCKER-2 fix (atomic open/rename), BLOCKER-3 line 142, FIX 8 |
| FIX-PLAN-CLUSTER-VALIDATION-IO.md | 1 line | BLOCKER-3 line 226 |
| FIX-PLAN-CLUSTER-AUDIT-TRAIL.md | TASK 6 rewrite | BLOCKER-4 fix |
| FIX-PLAN-v2.33.0-INDEX.md | section 2 | FIX 9 dispatch order |

---

## Workflow pentru Cezar

1. **Read** acest fisier complet.
2. **Edit** fiecare cluster plan listat conform sectiunilor (Find&Replace + manual paragraf rewrite). Sau dispach catre Codex un single task:

```
Task: Aplica modificarile descrise in audit/FIX-PLAN-v2.33.0-REMEDIATION.md
asupra fisierelor mentionate. NU modifica cod productie — doar fisierele de
plan din audit/. Commit cu mesaj: "docs(audit): apply v2.33.0 remediation
plan to cluster fix files".

Branch: chore/v2.33.0-plan-remediation
Push si gh pr create dupa finalizare.
```

3. **Re-run advisor** (codex:codex-rescue) pe cluster files modificate pentru second-opinion green light.

4. **GO/NO-GO**: daca advisor returneaza GO, dispach cele 4 cluster plans separate catre Codex pentru implementare in cod.

---

**Generat de**: Claude (Opus 4.7) cu 3 specialized agents (database-change-reviewer, backend-reliability-reviewer, audit-trail-reviewer) + 1 codex:codex-rescue external advisor pass.
**Inchidere**: dupa ce Codex implementeaza cele 4 cluster plans → v2.33.0 release.
