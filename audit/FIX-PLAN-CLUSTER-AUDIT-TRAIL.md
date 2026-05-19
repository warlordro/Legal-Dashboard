# Plan de Implementare: Cluster Audit Trail Completeness — Legal Dashboard v2.33.0

**Generat**: 2026-05-19
**Target**: `fix/audit-trail-completeness` -> v2.33.0
**Scope**: 5 findings (HIGH-5, MEDIUM-6, MEDIUM-7, LOW-1, LOW-2)
**Estimat total**: ~3.5h implementare + ~1h test/review

---

## Ordine de implementare (dependente)

```
TASK 1 (auditSanitize helpers — preparatory)
   ↓
TASK 2 (MEDIUM-6 wire sanitize)  +  TASK 3 (LOW-1 truncate)
   ↓
TASK 4 (HIGH-5 system.boot/shutdown)  +  TASK 5 (schema verify — likely no-op)
   ↓
TASK 6 (MEDIUM-7 auth.logout)  +  TASK 7 (LOW-2 audit.viewed carve-out)
```

Rationale: TASK 1 livreaza helper-ele `sanitizeSmtpError` + `truncateAuditText` folosite de TASK 2 si TASK 3. Restul sunt point-fixes independente. TASK 5 verifica schema audit_log accepta `owner_id IS NULL` (verificat deja in `auditRepository.ts:111-112` comment — likely no migration needed).

---

## TASK 1 — Helper `backend/src/util/auditSanitize.ts` (preparatory)

**Estimat**: 0.5h | **Regresie desktop**: ZERO (helper pur, fara side-effects)

### Problema

Doua nevoi convergente:
- MEDIUM-6 cere strip recipient email + provider internals din SMTP exception.
- LOW-1 cere truncate text liber (grant reason) inainte de scriere in audit detail.

### Plan

#### `backend/src/util/auditSanitize.ts` (NOU)

```typescript
// Helpers for sanitizing audit detail payloads. Centralised so the rules are
// the same wherever they're applied (today: SMTP errors, grant reasons; future:
// any user-supplied free-form text that lands in audit_log.detail_json).

const EMAIL_REGEX = /\S+@\S+\.\S+/g;
const SMTP_RECIPIENT_LINE = /\b(RCPT TO|MAIL FROM):\s*<[^>]*>/gi;

// Whitelist of err.code values that we permit verbatim. Anything else falls
// back to the generic `unknown` class. List is conservative — extend only when
// a new failure mode is observed in real ops logs.
const SMTP_KNOWN_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAUTH",
  "EENVELOPE",
  "EMESSAGE",
  "EDATA",
  "ESOCKET",
  "EPROTOCOL",
  "ESTREAM",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

export interface SanitizedSmtpError {
  code?: string;
  responseCode?: number;
  message: string;
}

// Strip PII from an SMTP exception so it can be written to audit log.
// - err.code: kept only if whitelisted; otherwise dropped (set to "unknown").
// - err.responseCode: kept verbatim if number in [400, 599] (SMTP reply codes).
// - err.message: scrubbed of email addresses + RCPT/MAIL FROM lines.
export function sanitizeSmtpError(err: unknown): SanitizedSmtpError {
  if (err === null || err === undefined) {
    return { message: "unknown" };
  }
  const e = err as { code?: unknown; responseCode?: unknown; message?: unknown; name?: unknown };

  const out: SanitizedSmtpError = { message: "unknown" };

  if (typeof e.code === "string" && SMTP_KNOWN_CODES.has(e.code)) {
    out.code = e.code;
  } else if (typeof e.code === "string") {
    out.code = "unknown"; // collapsed — never leak unknown codes verbatim
  }

  if (typeof e.responseCode === "number" && e.responseCode >= 400 && e.responseCode <= 599) {
    out.responseCode = e.responseCode;
  }

  const rawMessage = typeof e.message === "string" ? e.message : "";
  if (rawMessage) {
    let scrubbed = rawMessage
      .replace(SMTP_RECIPIENT_LINE, "[recipient redacted]")
      .replace(EMAIL_REGEX, "[email redacted]");
    // Cap length — SMTP banners can be long with hostname/version info.
    if (scrubbed.length > 200) {
      scrubbed = `${scrubbed.slice(0, 200)}…`;
    }
    out.message = scrubbed;
  } else if (typeof e.name === "string") {
    out.message = e.name;
  }

  return out;
}

// Generic free-form text truncator for audit detail fields. Trims whitespace,
// caps at maxLen, appends ellipsis. Returns undefined for nullish input so
// callers can spread the result into detail objects without empty strings.
export function truncateAuditText(value: string | undefined | null, maxLen = 200): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}
```

### Test plan

`backend/src/util/auditSanitize.test.ts` (NOU):

1. `sanitizeSmtpError(null)` → `{ message: "unknown" }`.
2. `sanitizeSmtpError({ code: "ECONNREFUSED", responseCode: 421, message: "Connection refused to mail.example.com" })` → preserves code, responseCode, message scrubbed.
3. `sanitizeSmtpError(new Error("550 5.7.1 Recipient foo@bar.com refused"))` → message contains `[email redacted]`, no `foo@bar.com`.
4. `sanitizeSmtpError({ code: "WEIRD_INTERNAL_CODE", message: "..." })` → code collapsed to `"unknown"`.
5. `sanitizeSmtpError({ responseCode: 200, message: "..." })` → responseCode dropped (not in 400-599 range).
6. `truncateAuditText(undefined)` → `undefined`.
7. `truncateAuditText("  ")` → `undefined` (whitespace-only).
8. `truncateAuditText("short")` → `"short"`.
9. `truncateAuditText("a".repeat(300), 100)` → length=101 ("…" appended).
10. `sanitizeSmtpError({ message: "RCPT TO:<foo@bar.com> rejected" })` → message contains `[recipient redacted]`.

### Acceptance criteria

- Module exports `sanitizeSmtpError` + `truncateAuditText` cu TypeScript types.
- Toate testele de mai sus trec.
- Zero dependinte externe noi.

### Regresie desktop / Migration safety

N/A — helper pur.

---

## TASK 2 — MEDIUM-6: wire `sanitizeSmtpError` in alertEmailDispatcher

**Estimat**: 0.5h | **Regresie desktop**: ZERO (email path este conditional pe SMTP_HOST setat)

### Problema

`backend/src/services/email/alertEmailDispatcher.ts:107`:
```typescript
detail: {
  reason: "exception",
  message: err instanceof Error ? err.message : String(err),  // ← contains recipient email
},
```

Raw error message din nodemailer poate contine `RCPT TO:<user@example.com>` sau `550 5.7.1 user@example.com refused` → email plaintext in `audit_log.detail_json`.

### Plan

#### `backend/src/services/email/alertEmailDispatcher.ts` (top of file imports)

```typescript
import { sanitizeSmtpError } from "../../util/auditSanitize.ts";
```

#### Modifica catch block (~linia 97-113):

```typescript
} catch (err) {
  console.error("[email] dispatchAlertEmail isolated failure", err);
  try {
    const sanitized = sanitizeSmtpError(err);
    recordAudit(null, "email.dispatch.failed", {
      outcome: "error",
      ownerId: alert.owner_id,
      targetKind: "monitoring_alert",
      targetId: String(alert.id),
      detail: {
        reason: "exception",
        smtp: sanitized,  // { code?, responseCode?, message }
        alertKind: alert.kind,
      },
    });
  } catch (auditErr) {
    console.error("[email] dispatchAlertEmail audit write failed", auditErr);
  }
}
```

#### Verifica si alte locuri unde nodemailer errors sunt audited

```bash
rg -n "recordAudit.*email\." backend/src/
rg -n "err.message" backend/src/services/email/
```

Aplica acelasi pattern oriunde un raw err.message este pus in detail.

### Acceptance criteria

- Mock dispatchAlertEmail cu error `new Error("550 5.7.1 user@example.com refused")` → `audit_log.detail_json` NU contine `user@example.com`.
- `detail.smtp.code` poate fi `"unknown"` daca err nu are code; nu sparge teste.
- `detail.smtp.responseCode` daca nodemailer attach-eaza number-ul (de obicei la SMTP failures reale).
- `detail.alertKind` ramane pentru forensic (e.g. `monitoring.alert`, fara PII).

### Test plan

`backend/src/services/email/alertEmailDispatcher.test.ts` (extend existing):

1. Mock send → throw `Error("550 user@bad.com bounced")` → audit_log row contain `detail.smtp.message="[email redacted]"` si NU contine `user@bad.com`.
2. Mock send → throw nodemailer error `{ code: "ECONNREFUSED", responseCode: 421, message: "..." }` → toate cele 3 field-uri prezent in detail.smtp.
3. Mock send → success → niciun audit row `email.dispatch.failed` (sanity).

### Regresie desktop

Email path este conditional pe `SMTP_HOST` setat in env. Desktop standard nu are SMTP configurat → niciun audit row scris. Daca user-ul setup-eaza SMTP local pentru testing → audit row scris cu sanitized payload. ZERO impact functional.

### Migration safety

N/A.

---

## TASK 3 — LOW-1: truncate grant `reason` in audit

**Estimat**: 0.25h | **Regresie desktop**: ZERO (admin route — feature web-mode)

### Problema

`backend/src/routes/admin.ts:580,617`:
```typescript
// linia 580 (create grant):
reason: row.reason,

// linia 617 (revoke grant):
reason,  // raw string
```

Camp text liber salvat verbatim in `detail_json`. CreateGrantSchema deja are `z.string().trim().max(500)` la linia 131 — DAR audit-ul scrie raw. Daca admin lipeste accidental PII (CNP, email, password fragment) in reason → ramane in audit pe termen lung.

### Plan

#### `backend/src/routes/admin.ts` — adauga import + aplicare

```typescript
// Imports (existing line 20+):
import { truncateAuditText } from "../util/auditSanitize.ts";

// La linia ~580 (create grant audit detail):
recordAudit(c, "user.quota.grant.created", {
  targetKind: "user_quota_grant",
  targetId: String(row.id),
  detail: {
    userId: row.user_id,
    feature: row.feature,
    grantedMilli: row.granted_milli,
    expiresAt: row.expires_at,
    reason: truncateAuditText(row.reason),  // ← truncated to 200 chars
  },
});

// La linia ~617 (revoke grant):
recordAudit(c, "user.quota.grant.revoked", {
  targetKind: "user_quota_grant",
  targetId: String(grantId),
  detail: {
    grantId,
    reason: truncateAuditText(reason),  // ← truncated to 200 chars
  },
});
```

Zod schema deja constrange la 500 chars; truncate-ul intern la 200 e defense-in-depth (admin-ul vede campul 500-char in UI, dar audit-ul stocheaza max 200 + "…").

### Acceptance criteria

- Create grant cu `reason="x".repeat(500)` → audit_log detail.reason.length === 201 ("…" appended).
- Create grant cu `reason="legitimate explanation"` → audit_log detail.reason === "legitimate explanation".
- Create grant fara reason → audit_log detail nu contine field `reason` (sau `undefined`).
- Revoke grant cu reason large → la fel truncated.

### Test plan

`backend/src/routes/admin.test.ts` (extend existing pe testele de grant):

1. POST `/admin/users/:id/quota/grants` cu reason 600-char → 422 zod (deja blocheaza la 500).
2. POST cu reason 400-char → succes; verifica `listAuditEvents` → reason 201-char (truncated to 200 + "…").
3. POST fara reason → succes; reason absent din detail.

### Regresie desktop

ZERO. Grant management este admin-only feature; desktop user-ul nu calls `/admin/...`.

### Migration safety

N/A — comportament strict mai restrictiv.

---

## TASK 4 — HIGH-5: `system.boot` + `system.shutdown` audit events

**Estimat**: 1h | **Regresie desktop**: ZERO functional (audit events sunt log-only, non-blocking)

### Problema

Niciun audit row la lifecycle backend. Compromis prin restart silentios sau scrub WAL = neobservabil din audit timeline. Forensic baseline absent.

### Plan

#### 1. Definire helper si chemarea la boot

`backend/src/index.ts` (sau locul unde startBackend ruleaza):

```typescript
import { recordAudit } from "./db/auditRepository.ts";
import { getAuthMode } from "./auth/mode.ts"; // verify path

const BOOT_TIMESTAMP_MS = Date.now();

async function startBackend(): Promise<void> {
  // ... migrations etc. ...

  // After migrations + DB ready, before scheduler start:
  try {
    recordAudit(null, "system.boot", {
      detail: {
        version: process.env.APP_VERSION ?? "unknown",
        nodeVersion: process.version,
        authMode: getAuthMode(),
        pid: process.pid,
      },
      ownerId: null,
    });
  } catch (err) {
    // Audit failure must not block boot — log only.
    console.error("[boot] system.boot audit write failed:", err);
  }

  // ... start schedulers, server.listen, etc. ...
}
```

#### 2. Shutdown handler

Acelasi fisier (sau `backend/src/shutdown.ts` daca exista). Best-effort, non-blocking:

```typescript
let shutdownTriggered = false;

function recordSystemShutdown(reason: string): void {
  if (shutdownTriggered) return;
  shutdownTriggered = true;
  try {
    recordAudit(null, "system.shutdown", {
      detail: {
        reason,
        uptimeSeconds: Math.round((Date.now() - BOOT_TIMESTAMP_MS) / 1000),
        pid: process.pid,
      },
      ownerId: null,
    });
  } catch (err) {
    console.error("[shutdown] system.shutdown audit write failed:", err);
  }
}

process.on("SIGTERM", () => {
  recordSystemShutdown("SIGTERM");
  // existing graceful shutdown logic — DO NOT exit here, let it run
});
process.on("SIGINT", () => {
  recordSystemShutdown("SIGINT");
  // existing graceful shutdown logic
});
```

#### 3. Electron `before-quit`

`electron/main.js` — la inceput de before-quit handler (inainte de orice cleanup):

```javascript
app.on("before-quit", async (event) => {
  // Best-effort audit pe quit. Daca backend e in-process, putem chema direct;
  // altfel skip (IPC poate fi inchis deja).
  try {
    const { recordAudit } = require("../backend/dist-backend/db/auditRepository.cjs");
    recordAudit(null, "system.shutdown", {
      detail: { reason: "electron_before_quit", pid: process.pid },
      ownerId: null,
    });
  } catch (err) {
    console.error("[main] system.shutdown audit failed:", err);
  }
  // ... existing WAL cleanup, etc ...
});
```

### Acceptance criteria

- La startup, `audit_log` contine row cu `action="system.boot"`, `owner_id=NULL`, `detail.version` setat.
- La SIGTERM, `audit_log` contine row cu `action="system.shutdown"`, `detail.reason="SIGTERM"`, `uptimeSeconds` integer.
- Boot de doua ori intr-un test → 2 rows boot (timestamp-uri diferite).
- Audit write failure NU blocheaza boot (catch in try).
- Pe desktop, dupa `npm run electron:dev` + close → `system.shutdown` cu reason="electron_before_quit".

### Test plan

`backend/src/db/auditRepository.test.ts` (extend) sau `backend/src/index.test.ts` daca exista:

1. Apel `recordAudit(null, "system.boot", { detail: { version: "test" } })` → verifica row in `audit_log` cu `owner_id IS NULL`.
2. Apel `recordAudit(null, "system.shutdown", { detail: { reason: "TEST", uptimeSeconds: 42 } })` → verifica.
3. Verifica audit_log accepta owner_id NULL (deja documentat in auditRepository.ts:111-112). Daca esueaza, vezi TASK 5.

Manual smoke:
```bash
npm run dev:backend &
sleep 2
kill -SIGTERM $!
# Then query DB:
sqlite3 data/legal-dashboard.db "SELECT action, json_extract(detail_json, '$.reason') FROM audit_log WHERE action LIKE 'system.%' ORDER BY id DESC LIMIT 5;"
```

### Regresie desktop

Pe desktop, boot + shutdown vor scrie randuri noi. Volume estimat: 2 randuri / sesiune Electron. Pe pana la 5 ani de uz → ~3650 randuri = trivial.

### Migration safety

N/A — audit_log schema already accepts owner_id NULL (vezi TASK 5).

---

## TASK 5 — Verifica `audit_log.owner_id` accepta NULL (likely no-op)

**Estimat**: 0.25h | **Regresie desktop**: ZERO

### Problema

Auditul folosit la HIGH-5 si MEDIUM-7 trebuie sa accepte `owner_id IS NULL` pentru `system.*` events. Comment-ul din `backend/src/db/auditRepository.ts:111-112` zice:

> "owner-scoped by default; `null` ownerId returns system-level events (matches DDL where owner_id is nullable for system events like 'system.boot')."

DDL deja support — verifica si confirma. Daca lipseste, migration noua.

### Plan

#### 1. Verifica schema actuala

```bash
sqlite3 data/legal-dashboard.db "SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_log';"
```

Sau in cod:
```bash
rg -n "CREATE TABLE.*audit_log" backend/src/db/
```

Confirma: `owner_id TEXT` fara `NOT NULL` constraint. Daca confirmed → no-op, treci la TASK 6.

#### 2. Daca DDL spune `owner_id TEXT NOT NULL` → migration

`backend/src/db/migrations/0033_audit_log_system_events.up.sql`:

```sql
-- v2.33.0: audit_log.owner_id devine nullable pentru system events
-- (`system.boot`, `system.shutdown`, `instance.lock.reclaimed`, etc.)
--
-- SQLite nu permite ALTER COLUMN — recreate table + migrate.
-- Optiunea simpla: daca DDL initial deja avea nullable (comment in
-- auditRepository.ts), aceasta migration nu va fi necesara.

PRAGMA foreign_keys = OFF;

CREATE TABLE audit_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT,                         -- NULL allowed for system events
  actor_id TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now', 'subsec') || 'Z'),
  action TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'denied', 'error')),
  ip TEXT,
  user_agent TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT
);

INSERT INTO audit_log_new
  (id, owner_id, actor_id, ts, action, target_kind, target_id, outcome, ip, user_agent, detail_json, request_id)
SELECT
  id, owner_id, actor_id, ts, action, target_kind, target_id, outcome, ip, user_agent, detail_json, request_id
FROM audit_log;

DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_owner_ts ON audit_log(owner_id, ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_ts ON audit_log(action, ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_kind, target_id);

PRAGMA foreign_keys = ON;
```

#### 3. Down rollback

`0033_audit_log_system_events.down.sql`:

```sql
-- Reverse: doar daca nu exista randuri cu owner_id NULL — altfel ar fi NOT NULL violation.
-- DELETE FROM audit_log WHERE owner_id IS NULL; -- destructive, evita
-- Mai sigur: lasa schema cum e + accepta ca rollback strict NU restaureaza NOT NULL.
SELECT 'audit_log owner_id NOT NULL constraint cannot be safely re-added — manual cleanup required';
```

### Acceptance criteria

- `INSERT INTO audit_log (owner_id, action, detail_json) VALUES (NULL, 'system.boot', '{}')` → succes.
- TASK 4 boot test passes.
- Migration runner zero-impact daca DDL deja nullable (idempotent guard).

### Regresie desktop

N/A.

### Migration safety

Daca migration ruleaza:
- Pre-migration backup deja exista (schema-upgrade trigger documentat in CLAUDE.md).
- Rebuild table = atomic la SQLite.
- 0 downtime — single-process write.

---

## TASK 6 — MEDIUM-7: `auth.logout` audit event

**Estimat**: 0.25h | **Regresie desktop**: ZERO (logout flow neschimbat functional)

### Problema

`backend/src/routes/auth.ts:49-56`:
```typescript
authRouter.post("/logout", (c) => {
  deleteCookie(c, AUTH_COOKIE_NAME, { secure: secureCookie(), sameSite: "Lax", path: "/" });
  return c.json(ok({ loggedOut: true }, c), 200);
});
```

Niciun audit. Asymmetric vs `auth.oauth2.sync` care e auditat la linia 104. Sesiuni de zile/saptamani nedocumentate.

### Plan

```typescript
authRouter.post("/logout", (c) => {
  // Audit BEFORE cookie deletion — getActorId(c) trebuie sa returneze ID-ul
  // user-ului inca activ. Daca cookie-ul nu mai e valid (sesiune expirata
  // local), getActorId returneaza "anonymous" oricum, deci audit-ul tot
  // captureaza ce stim.
  try {
    recordAudit(c, "auth.logout", {
      detail: { triggered: "user_request" },
    });
  } catch (err) {
    console.error("[auth] auth.logout audit failed:", err);
  }

  deleteCookie(c, AUTH_COOKIE_NAME, { secure: secureCookie(), sameSite: "Lax", path: "/" });
  return c.json(ok({ loggedOut: true }, c), 200);
});
```

`recordAudit(c, ...)` cu context auto-populeaza `ownerId`, `actorId`, `ip`, `userAgent`, `requestId` din `readContext(c)`.

### Acceptance criteria

- POST `/api/v1/auth/logout` cu cookie valid → 200 + audit row `action="auth.logout"` cu `actor_id` setat.
- POST fara cookie → 200 + audit row cu `actor_id="anonymous"` (sau ce returneaza getActorId).
- Audit failure NU sparge logout (try/catch).

### Test plan

`backend/src/routes/auth.test.ts` (extend existing logout test daca exista, altfel nou):

1. Mock context cu cookie auth valid → POST `/logout` → verifica `listAuditEvents({ action: "auth.logout" })` returneaza row cu actorId corect.
2. POST `/logout` fara cookie → 200 + audit row (anonymous).
3. Audit write throw mocked → logout tot returneaza 200.

### Regresie desktop

Desktop nu foloseste cookie auth (Electron e single-user, `getAuthMode() !== "web"`). Endpoint-ul `/auth/logout` ar putea fi totusi atins din UI; daca da, audit row e scris fara probleme.

### Migration safety

N/A.

---

## TASK 7 — LOW-2: `audit.viewed` event cu carve-out

**Estimat**: 0.5h | **Regresie desktop**: ZERO (admin route, web-mode only feature)

### Problema

`backend/src/routes/admin.ts:287` — GET `/audit` returneaza randuri din audit_log fara sa lase urma cine, ce a filtrat, cand. "Who watches the watchmen" gap.

Risc accesoriu: daca audit-am OARE-ce query (inclusiv dashboard-ul admin care fetch-uieste ultimele 50 randuri), audit_log creste necontrolat — un admin care lasa pagina deschisa + refresh la 10s = 8640 row-uri/zi.

### Plan

Carve-out: audit DOAR cand filtrul e investigativ. Definitie:
- `actorId` setat
- `targetId` setat
- `since` SAU `until` setat
- `actionLike` setat
- `requestId` setat

Default dashboard load (page=1, pageSize=50, restul empty) = NU audit. Eliminate feedback loops: NU audit cand `action === "audit.viewed"` (singular) este filtrul (admin care investigheaza dovada altcuiva de audit-viewing).

#### `backend/src/routes/admin.ts:287-340` — modifica handler

```typescript
adminRouter.get("/audit", (c) => {
  const parsed = ListAuditQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams.entries()));
  if (!parsed.success) {
    return c.json(fail("invalid_query", "Query invalid", c, parsed.error.issues), 400);
  }
  const {
    page, pageSize, ownerId, actorId, action, actionLike,
    targetKind, targetId, outcome, since, until, requestId,
  } = parsed.data;

  const result = listAuditEvents({
    ownerId, actorId, action, actionLike, targetKind, targetId,
    outcome, since, until, requestId,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  // LOW-2: audit-the-audit-viewer carve-out.
  // Only investigative queries get logged. Default dashboard polls (no filter)
  // and recursive self-views (filter on audit.viewed) skip.
  const isInvestigative =
    actorId !== undefined ||
    targetId !== undefined ||
    since !== undefined ||
    until !== undefined ||
    actionLike !== undefined ||
    requestId !== undefined;
  const isSelfFilter = action === "audit.viewed";

  if (isInvestigative && !isSelfFilter) {
    try {
      recordAudit(c, "audit.viewed", {
        detail: {
          filters: {
            ownerId: ownerId ?? null,
            actorId: actorId ?? null,
            action: action ?? null,
            actionLike: actionLike ?? null,
            targetKind: targetKind ?? null,
            targetId: targetId ?? null,
            outcome: outcome ?? null,
            since: since ?? null,
            until: until ?? null,
            requestId: requestId ?? null,
          },
          page,
          pageSize,
          resultCount: result.rows.length,
        },
      });
    } catch (err) {
      console.error("[admin] audit.viewed audit failed:", err);
    }
  }

  return c.json(
    ok(
      {
        rows: result.rows.map((r) => ({ /* ...existing serialization... */ })),
      },
      c
    )
  );
});
```

### Acceptance criteria

- GET `/admin/audit?page=1&pageSize=50` (default dashboard) → 200, NO `audit.viewed` row scris.
- GET `/admin/audit?actorId=user-xyz&pageSize=20` → 200, audit row scris cu `detail.filters.actorId="user-xyz"`.
- GET `/admin/audit?action=audit.viewed&pageSize=50` → 200, NO audit row scris (carve-out anti-recursion).
- GET `/admin/audit?since=2026-05-19&until=2026-05-20` → audit row scris.
- Audit-the-audit detail contine filtrele + page + pageSize + resultCount; NU contine raw rows.
- Audit write failure NU sparge endpoint-ul.

### Test plan

`backend/src/routes/admin.audit.test.ts` (NOU sau extend existing):

1. Default GET → assert no `audit.viewed` row.
2. GET cu `actorId` → assert 1 audit row, filter populated.
3. GET cu `action="audit.viewed"` → assert no recursive row.
4. GET cu `actionLike="auth.%"` → assert audit row, `detail.filters.actionLike="auth.%"`.
5. Multiple queries succesive cu filtre → multiple audit rows (no dedup).

### Regresie desktop

Endpoint-ul `/admin/audit` exista doar in admin UI (web-mode feature). Desktop poll-uri aceste rute? — NU; UI desktop nu are admin tab. ZERO impact.

### Migration safety

N/A.

---

## Constrangeri NON-NEGOTIABLE (carry-forward)

- Audit log NU primeste plaintext — doar `last4`, `hadPrevious`, `field`, `validationSkipped` pentru key writes. Aici: sanitizeSmtpError redacteaza email, truncateAuditText limiteaza reason — same principle extins la free-form text.
- Master key NEVER logged; captcha key values NEVER in audit log.
- `recordAudit(c: Context | null, action: string, options)` cu `c=null` pentru system events.
- `owner_id` nullable pentru `system.*` events (verificat sau migrated in TASK 5).
- Repository-only DB access — toate audit writes prin `recordAudit()` din `backend/src/db/auditRepository.ts`.
- Desktop ZERO impact: `system.boot`/`system.shutdown` fire in ambele moduri, payload mic (~100 bytes/event); `audit.logout`+`audit.viewed`+grant truncation = web-mode admin features.
- D14/D15/D16 — neatins.
- LAN bind opt-in — neatins.
- Web-mode 501 gate — neatins.
- Biome obligatoriu inainte de push.

## Checklist pre-push

```bash
# 1. Biome write pe fisierele atinse
npx biome check --write \
  backend/src/util/auditSanitize.ts \
  backend/src/util/auditSanitize.test.ts \
  backend/src/services/email/alertEmailDispatcher.ts \
  backend/src/services/email/alertEmailDispatcher.test.ts \
  backend/src/routes/admin.ts \
  backend/src/routes/admin.test.ts \
  backend/src/routes/admin.audit.test.ts \
  backend/src/routes/auth.ts \
  backend/src/routes/auth.test.ts \
  backend/src/index.ts \
  electron/main.js

# Daca migration 0033 e necesar:
npx biome check --write backend/src/db/migrations/0033_audit_log_system_events.up.sql

# 2. Type-check
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..

# 3. Build
npm run build

# 4. Tests
npm test --workspace=backend
cd frontend && npm test -- --run && cd ..

# 5. Smoke desktop:
#    - npm run electron:dev → verify boot audit row cu sqlite3
#    - Close Electron → verify shutdown audit row
#
# 6. Smoke web (staging):
#    - Login admin, deschide /admin/audit → no audit.viewed row
#    - Filter by actorId → audit.viewed row appears
#    - Trigger alert email cu SMTP unreachable → audit.dispatch.failed cu sanitized SMTP message
```

## Files atinse

| Fisier | Tip change | Linii afectate |
|--------|-----------|----------------|
| `backend/src/util/auditSanitize.ts` | NOU | ~75 |
| `backend/src/util/auditSanitize.test.ts` | NOU | ~80 |
| `backend/src/services/email/alertEmailDispatcher.ts` | EDIT | imports + linia 97-113 |
| `backend/src/services/email/alertEmailDispatcher.test.ts` | EDIT | append sanitize tests |
| `backend/src/routes/admin.ts` | EDIT | imports + 287-340 + 580 + 617 |
| `backend/src/routes/admin.test.ts` | EDIT | adauga teste grant reason truncation |
| `backend/src/routes/admin.audit.test.ts` | NOU | ~150 |
| `backend/src/routes/auth.ts` | EDIT | 49-56 + import recordAudit |
| `backend/src/routes/auth.test.ts` | EDIT | adauga auth.logout test |
| `backend/src/index.ts` | EDIT | system.boot + SIGTERM/SIGINT shutdown |
| `electron/main.js` | EDIT | before-quit shutdown audit |
| `backend/src/db/migrations/0033_audit_log_system_events.up.sql` | NOU (conditional) | ~30 |
| `backend/src/db/migrations/0033_audit_log_system_events.down.sql` | NOU (conditional) | ~5 |

## Dispatch instructions catre Codex

> Implementeaza planul din `audit/FIX-PLAN-CLUSTER-AUDIT-TRAIL.md` exact.
> Branch: `fix/audit-trail-completeness`.
> Primul pas: verifica `audit_log` DDL actuala — daca `owner_id` deja nullable, sari TASK 5 (migration). Altfel scrie migration 0033.
> Dupa biome + tsc + build + tests, fa commit + push + `gh pr create`.

---

**Status**: dispatch-ready. Toate sectiunile au cod copy-paste-ready si acceptance criteria verificabile.
