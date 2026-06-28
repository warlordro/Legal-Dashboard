# API programatic + PAT (piesa A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Versiune plan: v2.1** — doua runde de review adversarial (agenti specializati ultracode + review-panel multi-model), **toate findings-urile aplicate INLINE in task-uri**. Sectiunea **"## v2 — Corectii din review adversarial"** de la final e acum un changelog + cross-reference (ce s-a schimbat si unde), nu o lista de TODO-uri separate. Implementatorul urmeaza task-urile pas cu pas; nu mai exista cod inline gresit ("v2 drift" rezolvat). Daca totusi gasesti vreun conflict rezidual intre un snippet si apendice, apendicele are prioritate.

**Goal:** Expune cautarea dosare+termene / ICCJ / RNPM (doar citire) catre un mediu AI extern printr-un Personal Access Token (PAT) opac cu scopes, in web mode, fara impact pe desktop.

**Architecture:** Un PAT (`ld_pat_…`) e dispecerizat in `authProvider` pe prefix; deriva acelasi `ownerId` ca un JWT, deci mosteneste toate cotele per-owner. Accesul e **default-deny + read-only pe metoda**: un gate global lasa PAT-ul doar pe rutele `(metoda, path, scope)` allowlistate; restul → 403. Controale anti-abuz: bypass originGuard doar dupa auth PAT reusit, rate-limit per-token, plafon captcha optional per-token cu contorizare atomica, circuit-breaker ICCJ pe clasa de apelant, page-size cap server-side. Management tokenuri + audit (creare/folosire/revocare) + alerta IP nou + revoke-all. Spec: [docs/superpowers/specs/2026-06-27-api-mcp-integration-design.md](../specs/2026-06-27-api-mcp-integration-design.md).

**Tech Stack:** Node 22, Hono, better-sqlite3 (repository-only DB), zod, vitest, biome. Backend bundled CJS (esbuild). Frontend React 18 + Vite.

## Global Constraints

- Repository-only DB access: SQL raw **doar** in `backend/src/db/**`. Toate tabelele au `owner_id` (DEFAULT `'local'`).
- Migration urmatoare = **0039** (ultima e 0038). Format: `NNNN_nume.up.sql` + `NNNN_nume.down.sql`; down-ul curata defensiv `_schema_versions` (`DELETE FROM _schema_versions WHERE version = 39`).
- Desktop **ZERO impact**: calea PAT e activa doar cand `getAuthMode() === "web"`. In desktop, `tokenId`/`tokenScopes` raman `undefined` → toate gate-urile noi sunt no-op.
- Limba: surse fara diacritice (constraint legacy PortalJust). Comentariile pot fi engleza/romana.
- Tokenul nu se cacheaza pozitiv: validare DB la fiecare request (revoke instant).
- Inainte de push: `npx biome check --write` pe fisierele atinse, `tsc --noEmit` (backend + frontend), `npm run build`, teste. Vezi [CLAUDE.md](../../../CLAUDE.md).
- **ABI caveat:** dupa rularea testelor sub Node, `better-sqlite3` trebuie reconstruit pentru Electron inainte de `electron:dev` (vezi memoria proiect: `npx prebuild-install --runtime=electron --target=<ver>` in `node_modules/better-sqlite3`).
- Envelope standard pentru rutele noi v1: `ok(data, c)` / `fail(code, message, c, details?)` din [backend/src/util/envelope.ts](../../../backend/src/util/envelope.ts). Coduri noi adaugate in `ErrorCodes`.
- Comenzi teste backend (din radacina): `npm test --workspace=backend` sau tintit `cd backend && npx vitest run src/<cale>.test.ts`.

## File Structure

**Create:**
- `backend/src/db/migrations/0039_api_tokens.up.sql` / `.down.sql` — tabela `api_tokens` + coloana `captcha_usage.token_id`.
- `backend/src/db/apiTokenRepository.ts` (+ `.test.ts`) — generare/hash/CRUD token, revoke, last_used, captcha per-token count.
- `backend/src/auth/patProvider.ts` (+ `.test.ts`) — rezolvarea contextului dintr-un PAT (hash → lookup → user activ).
- `backend/src/middleware/patCapabilityGate.ts` (+ `.test.ts`) — `PAT_CAPABILITIES` (single source) + gate default-deny (metoda + segment-boundary path + scope; deny explicit `/api/v1/tokens`).
- `backend/src/middleware/patUsageAudit.ts` (+ `.test.ts`) — audit folosire PAT POST-gate (esantionat) + trigger alerta IP nou.
- `backend/src/middleware/patSecurity.ts` (+ `.test.ts`) — `no-store` pe raspunsuri PAT + HTTPS-only in productie (Phase 5.5).
- `backend/src/services/tokenAlerts.ts` — `notifyTokenNewIp` (peste mailer, dedup).
- `backend/src/services/iccj/iccjBreaker.ts` (+ `.test.ts`) — circuit-breaker global pe clasa de apelant.
- `backend/src/routes/apiTokens.ts` (+ `.test.ts`) — `apiTokensRouter` (creare/listare/revoke/revoke-all), session-only.
- `backend/src/routes/openapi.ts` — `/api/v1/openapi.json`.
- `API.md` (radacina) — ghid consumatori PAT.
- `frontend/src/lib/apiTokensApi.ts` — wrapper fetch peste rutele de tokenuri.
- `frontend/src/components/ApiAccessPanel.tsx` (+ test) — sectiune "Acces API" in Setari.

**Modify:**
- `backend/src/auth/authProvider.ts` — `AuthenticatedContext` (+ `tokenScopes?`, `tokenId?`), dispatch PAT pe prefix `ld_pat_`.
- `backend/src/middleware/owner.ts` — `ContextVariableMap` (+ `tokenScopes`, `tokenId`); `ownerContext` seteaza campurile. (Audit/touch/new-IP NU mai stau aici — sunt in `patUsageAudit` post-gate.)
- `backend/src/middleware/originGuard.ts` — bypass pe `tokenId` prezent (auth PAT reusit).
- `backend/src/middleware/rate-limit.ts` — bucket per-token `tok|<tokenId>`.
- `backend/src/routes/rnpmGuards.ts` — plafon captcha per-token atomic + `token_id` la `recordCaptchaUsage`.
- `backend/src/db/captchaUsageRepository.ts` — `token_id` in insert + `countTokenCaptchaUsageInWindow`.
- `backend/src/db/auditRepository.ts` — `hasPriorTokenUseFromIp(tokenId, ip)`.
- `backend/src/services/iccj/iccjClient.ts` — wrap `searchIccj`/`fetchIccjDetail`/`searchSedinteIccj` cu breaker + `callerClass`.
- monitoring ICCJ runner (ex. `backend/src/services/monitoring/iccjRunner.ts`) — paseaza `callerClass:"monitoring"` la apelurile ICCJ (altfel intra cu greutate "ui" in breaker).
- `backend/src/routes/dosare.ts` — `exactMatch` in raspuns + page-size cap.
- `backend/src/index.ts` — mount `patCapabilityGate` (dupa `ownerContext`), `apiTokensRouter`, `openapi`.
- `backend/src/util/envelope.ts` — coduri noi (`PAT_ROUTE_FORBIDDEN`, `INSUFFICIENT_SCOPE`, `PAT_CANNOT_MANAGE_TOKENS`, `ICCJ_UNAVAILABLE`). (401 PAT = lowercase `invalid_token` via `AuthenticationError`, NU enum.)
- `frontend/src/lib/api.ts` — re-export `apiTokensApi` (sau import direct).
- `frontend/src/components/ApiKeyDialog.tsx` — monteaza `<ApiAccessPanel/>` (web-only, langa `EmailSettingsPanel`).

---

## Phase 1 — DB foundation

### Task 1: Migration 0039 (api_tokens + captcha_usage.token_id)

**Files:**
- Create: `backend/src/db/migrations/0039_api_tokens.up.sql`
- Create: `backend/src/db/migrations/0039_api_tokens.down.sql`
- Test: `backend/src/db/migrations/0039_api_tokens.test.ts`

**Interfaces:**
- Produces: tabela `api_tokens(id, owner_id, name, token_hash, token_prefix, scopes, captcha_daily_cap, created_at, expires_at, last_used_at, last_used_ip, last_used_ua, revoked_at)`; coloana `captcha_usage.token_id`.

- [ ] **Step 1: Write the up migration**

`backend/src/db/migrations/0039_api_tokens.up.sql`:
```sql
-- v2.40.0: Personal Access Tokens pentru API programatic + MCP (piesa A).
-- Token opac ld_pat_*, hash SHA-256 (lookup pe coloana indexata). expires_at
-- nullable (default fara expirare; optional 30/90/365). captcha_daily_cap
-- nullable (default fara plafon per-token). Revoke instant via revoked_at.
CREATE TABLE api_tokens (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL DEFAULT 'local',
  name              TEXT NOT NULL,
  token_hash        TEXT NOT NULL,
  token_prefix      TEXT NOT NULL,
  scopes            TEXT NOT NULL,
  captcha_daily_cap INTEGER,
  -- ISO 8601 UTC (T...Z) ca sa fie comparabil lexicografic cu expires_at stocat
  -- ISO si cu strftime(...'now') din findActiveTokenByHash (fix review DB-001/R04).
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at        TEXT,
  last_used_at      TEXT,
  last_used_ip      TEXT,
  last_used_ua      TEXT,
  revoked_at        TEXT
);
CREATE UNIQUE INDEX idx_api_tokens_token_hash ON api_tokens(token_hash);
CREATE INDEX idx_api_tokens_owner_id ON api_tokens(owner_id);

-- Per-token captcha accounting: leaga randul de captcha de tokenul care l-a
-- consumat, pentru plafon per-token (A5.3). NULL = consum din sesiune JWT/desktop.
ALTER TABLE captcha_usage ADD COLUMN token_id TEXT;
-- Partial: token_id e NULL pe marea majoritate a randurilor (JWT/desktop) — fix review DB-005.
CREATE INDEX idx_captcha_usage_token_id ON captcha_usage(token_id) WHERE token_id IS NOT NULL;

-- Index pentru detectia "IP nou" pe hot-path-ul PAT (hasPriorTokenUseFromIp) — fix review DB-004.
CREATE INDEX idx_audit_log_token_use ON audit_log(action, target_id, ip) WHERE action = 'api_token.used';
```

- [ ] **Step 2: Write the down migration**

`backend/src/db/migrations/0039_api_tokens.down.sql`:
```sql
-- Necesita SQLite >= 3.35.0 pentru DROP COLUMN (better-sqlite3 bundle-uit il suporta;
-- la rollback standalone verifica `sqlite3 --version`). Rollback-ul e MANUAL — runner-ul
-- aplica doar .up.sql (fix review DB-002/REL-DOWN-MANUAL); recovery real = backup pre-migratie.
DROP INDEX IF EXISTS idx_audit_log_token_use;
DROP INDEX IF EXISTS idx_captcha_usage_token_id;
ALTER TABLE captcha_usage DROP COLUMN token_id;
DROP INDEX IF EXISTS idx_api_tokens_owner_id;
DROP INDEX IF EXISTS idx_api_tokens_token_hash;
DROP TABLE IF EXISTS api_tokens;

CREATE TABLE IF NOT EXISTS _schema_versions (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  sha256_up  TEXT NOT NULL
);
DELETE FROM _schema_versions WHERE version = 39;
```

- [ ] **Step 3: Write the failing test**

`backend/src/db/migrations/0039_api_tokens.test.ts` (mirror harness din [aiUsageRepository.test.ts](../../../backend/src/db/aiUsageRepository.test.ts)):
```ts
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../schema.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-mig39-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
});
afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: env trebuie unset real
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("migration 0039", () => {
  it("creates api_tokens with the expected columns", () => {
    const cols = getDb().prepare("PRAGMA table_info(api_tokens)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id", "owner_id", "name", "token_hash", "token_prefix", "scopes",
        "captcha_daily_cap", "created_at", "expires_at", "last_used_at",
        "last_used_ip", "last_used_ua", "revoked_at",
      ])
    );
  });
  it("adds token_id to captcha_usage", () => {
    const cols = getDb().prepare("PRAGMA table_info(captcha_usage)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("token_id");
  });
});
```

- [ ] **Step 4: Run the test**

Run: `cd backend && npx vitest run src/db/migrations/0039_api_tokens.test.ts`
Expected: PASS (migrations auto-aplicate de `getDb()` la prima conexiune). Daca migration runner-ul cere inregistrare manuala, urmeaza pattern-ul folosit de 0038 in `backend/src/db/schema.ts` si re-ruleaza.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0039_api_tokens.*.sql backend/src/db/migrations/0039_api_tokens.test.ts
git commit -m "feat(db): migration 0039 — api_tokens + captcha_usage.token_id"
```

---

## Phase 2 — Token repository

### Task 2: apiTokenRepository

**Files:**
- Create: `backend/src/db/apiTokenRepository.ts`
- Test: `backend/src/db/apiTokenRepository.test.ts`
- Modify: `backend/src/db/captchaUsageRepository.ts` (token_id + count per-token)

**Interfaces:**
- Produces:
  - `type ApiTokenRow = { id, owner_id, name, token_hash, token_prefix, scopes, captcha_daily_cap, created_at, expires_at, last_used_at, last_used_ip, last_used_ua, revoked_at }`
  - `generateToken(): { secret: string; prefix: string; hash: string }`
  - `createApiToken(input: { ownerId, name, scopes: string[], captchaDailyCap: number | null, expiresAt: string | null }): { row: ApiTokenRow; secret: string }`
  - `findActiveTokenByHash(hash: string): ApiTokenRow | null`
  - `listTokensByOwner(ownerId: string): ApiTokenRow[]`
  - `revokeToken(ownerId: string, id: string): boolean`
  - `revokeAllTokens(ownerId: string): number`
  - `touchLastUsed(id: string, ip: string | null, ua: string | null): void`
  - `countTokenCaptchaUsageInWindow(tokenId: string, windowSeconds: number): number` (in `captchaUsageRepository.ts`)

- [ ] **Step 1: Write the repository**

`backend/src/db/apiTokenRepository.ts`:
```ts
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./schema.ts";
import { assertOwnerIdForMutation } from "../util/ownerGuard.ts";

export const TOKEN_PREFIX = "ld_pat_";

export interface ApiTokenRow {
  id: string;
  owner_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string;
  captcha_daily_cap: number | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  last_used_ua: string | null;
  revoked_at: string | null;
}

export function hashToken(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// Token = ld_pat_ + 32 bytes base64url (256-bit). Prefix afisat DOAR la inceput
// (review: nu head+tail) — destul pentru identificare, fara a reduce entropia.
export function generateToken(): { secret: string; prefix: string; hash: string } {
  const body = randomBytes(32).toString("base64url");
  const secret = TOKEN_PREFIX + body;
  const prefix = TOKEN_PREFIX + body.slice(0, 8);
  return { secret, prefix, hash: hashToken(secret) };
}

export function createApiToken(input: {
  ownerId: string;
  name: string;
  scopes: string[];
  captchaDailyCap: number | null;
  expiresAt: string | null;
}): { row: ApiTokenRow; secret: string } {
  assertOwnerIdForMutation(input.ownerId, "createApiToken");
  const { secret, prefix, hash } = generateToken();
  const id = randomUUID();
  const db = getDb();
  db.prepare(
    `INSERT INTO api_tokens
       (id, owner_id, name, token_hash, token_prefix, scopes, captcha_daily_cap, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.ownerId, input.name, hash, prefix, input.scopes.join(","),
    input.captchaDailyCap, input.expiresAt
  );
  const row = db.prepare("SELECT * FROM api_tokens WHERE id = ?").get(id) as ApiTokenRow;
  return { row, secret };
}

// Lookup pe hash indexat. Valid = nerevocat + neexpirat. Fara cache pozitiv:
// fiecare request face acest lookup → revoke instant.
export function findActiveTokenByHash(hash: string): ApiTokenRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM api_tokens
        WHERE token_hash = ?
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
    )
    .get(hash) as ApiTokenRow | undefined;
  return row ?? null;
}

export function listTokensByOwner(ownerId: string): ApiTokenRow[] {
  return getDb()
    .prepare("SELECT * FROM api_tokens WHERE owner_id = ? ORDER BY created_at DESC")
    .all(ownerId) as ApiTokenRow[];
}

export function revokeToken(ownerId: string, id: string): boolean {
  assertOwnerIdForMutation(ownerId, "revokeToken");
  const info = getDb()
    .prepare(
      // ISO-Z peste tot (fix review-panel): coloanele de timp raman comparabile intre ele
      // si se serializeaza corect catre UI (new Date(...) parseaza ISO-Z ca UTC, nu local).
      "UPDATE api_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND owner_id = ? AND revoked_at IS NULL"
    )
    .run(id, ownerId);
  return info.changes > 0;
}

export function revokeAllTokens(ownerId: string): number {
  assertOwnerIdForMutation(ownerId, "revokeAllTokens");
  const info = getDb()
    .prepare("UPDATE api_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = ? AND revoked_at IS NULL")
    .run(ownerId);
  return info.changes;
}

// Pentru DELETE idempotent (PAT-009): exista tokenul (orice stare) la acest owner?
export function tokenExistsForOwner(ownerId: string, id: string): boolean {
  return getDb().prepare("SELECT 1 FROM api_tokens WHERE id = ? AND owner_id = ? LIMIT 1").get(id, ownerId) !== undefined;
}

// Throttle ~60s: evita un write pe fiecare request. ip/ua se actualizeaza la
// fel de des; detectia de IP nou se face separat din audit (Task 11).
export function touchLastUsed(id: string, ip: string | null, ua: string | null): void {
  getDb()
    .prepare(
      `UPDATE api_tokens
          SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_used_ip = ?, last_used_ua = ?
        WHERE id = ?
          AND (last_used_at IS NULL OR last_used_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 seconds'))`
    )
    .run(ip, ua, id);
}
```

- [ ] **Step 2: Add per-token captcha count to captchaUsageRepository**

In `backend/src/db/captchaUsageRepository.ts`: extinde `RecordCaptchaUsageInput` cu `tokenId?: string | null`, adauga `token_id` la insert, si adauga functia de count per-token:
```ts
// in RecordCaptchaUsageInput:
  tokenId?: string | null;

// in recordCaptchaUsage INSERT — adauga token_id:
//   INSERT INTO captcha_usage (owner_id, ts, provider, source, request_id, token_id)
//   VALUES (?, ?, ?, ?, ?, ?)
//   ...run(..., input.tokenId ?? null)

// Nota (review-panel): `captcha_usage.ts` e stocat ISO-Z (recordCaptchaUsage scrie
// `new Date().toISOString()`), deci comparatia lexicografica cu strftime(...Z) e corecta —
// acelasi pattern ca `countTenantCaptchaUsageInWindow`. Adauga un test cu randuri vechi+noi.
export function countTokenCaptchaUsageInWindow(tokenId: string, windowSeconds: number): number {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error("windowSeconds must be a positive number");
  }
  const modifier = `-${Math.floor(windowSeconds)} seconds`;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM captcha_usage
        WHERE token_id = ?
          AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`
    )
    .get(tokenId, modifier) as { n: number };
  return row.n;
}
```

- [ ] **Step 3: Write the failing tests**

`backend/src/db/apiTokenRepository.test.ts` (acelasi harness ca Task 1; un user trebuie sa existe pentru FK-uri logice — `owner_id` nu are FK, deci poti folosi un id arbitrar). Acopera: create returneaza secret `ld_pat_…` + prefix scurt; `findActiveTokenByHash` gaseste tokenul, nu il gaseste dupa revoke; `findActiveTokenByHash` nu intoarce un token expirat; `revokeAllTokens` numara corect; `listTokensByOwner` e owner-scoped.
```ts
import { createApiToken, findActiveTokenByHash, hashToken, listTokensByOwner,
  revokeToken, revokeAllTokens } from "./apiTokenRepository.ts";

it("creates a token and finds it by hash, then loses it after revoke", () => {
  const { row, secret } = createApiToken({ ownerId: "alice", name: "t1",
    scopes: ["dosare", "iccj"], captchaDailyCap: null, expiresAt: null });
  expect(secret.startsWith("ld_pat_")).toBe(true);
  expect(row.token_prefix.length).toBeLessThan(secret.length);
  expect(findActiveTokenByHash(hashToken(secret))?.id).toBe(row.id);
  expect(revokeToken("alice", row.id)).toBe(true);
  expect(findActiveTokenByHash(hashToken(secret))).toBeNull();
});

it("does not return an expired token", () => {
  const { secret } = createApiToken({ ownerId: "bob", name: "old",
    scopes: ["dosare"], captchaDailyCap: null, expiresAt: "2000-01-01T00:00:00.000Z" });
  expect(findActiveTokenByHash(hashToken(secret))).toBeNull();
});
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run src/db/apiTokenRepository.test.ts src/db/captchaUsageRepository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/apiTokenRepository.ts backend/src/db/apiTokenRepository.test.ts backend/src/db/captchaUsageRepository.ts
git commit -m "feat(db): apiTokenRepository + per-token captcha accounting"
```

---

## Phase 3 — Auth seam (PAT dispatch)

### Task 3: PAT context resolver + dispatch in authProvider

**Files:**
- Create: `backend/src/auth/patProvider.ts`
- Test: `backend/src/auth/patProvider.test.ts`
- Modify: `backend/src/auth/authProvider.ts`
- Modify: `backend/src/middleware/owner.ts`

**Interfaces:**
- Consumes: `findActiveTokenByHash`, `hashToken` (Task 2); `getUserById` ([userRepository.ts](../../../backend/src/db/userRepository.ts)).
- Produces:
  - `AuthenticatedContext` extins cu `tokenScopes?: string[]`, `tokenId?: string`.
  - `resolvePatContext(c: Context, token: string): AuthenticatedContext` (throws `AuthenticationError(401, "invalid_token", …)`).
  - `ContextVariableMap` cu `tokenScopes?: string[]`, `tokenId?: string`.

- [ ] **Step 1: Write the failing test**

`backend/src/auth/patProvider.test.ts` (harness DB ca Task 1; creeaza un user activ + un token):
```ts
it("resolves a valid PAT to the owner context with scopes", () => {
  // seed: un user activ cu id 'alice' (foloseste userRepository test helper sau INSERT direct)
  const { secret } = createApiToken({ ownerId: "alice", name: "mcp",
    scopes: ["dosare"], captchaDailyCap: null, expiresAt: null });
  // fix review T-04: nu exista helper `fakeCtx` — `_c` nu e citit de resolver,
  // deci paseaza un context aruncabil. Seed user activ via insertUser inainte.
  const ctx = resolvePatContext({} as unknown as Context, secret);
  expect(ctx.ownerId).toBe("alice");
  expect(ctx.tokenScopes).toEqual(["dosare"]);
  expect(ctx.tokenId).toBeDefined();
});

it("rejects a revoked/unknown token with 401 invalid_token", () => {
  expect(() => resolvePatContext({} as unknown as Context, "ld_pat_does_not_exist"))
    .toThrowError(/invalid_token/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/auth/patProvider.test.ts`
Expected: FAIL (`resolvePatContext` not defined).

- [ ] **Step 3: Write patProvider**

`backend/src/auth/patProvider.ts`:
```ts
import type { Context } from "hono";
import { AuthenticationError, type AuthenticatedContext } from "./authProvider.ts";
import { findActiveTokenByHash, hashToken } from "../db/apiTokenRepository.ts";
import { getUserById } from "../db/userRepository.ts";

export function resolvePatContext(_c: Context, token: string): AuthenticatedContext {
  const row = findActiveTokenByHash(hashToken(token));
  if (!row) {
    throw new AuthenticationError(401, "invalid_token", "Token de autentificare invalid.");
  }
  const user = getUserById(row.owner_id);
  if (user === null || user.status !== "active") {
    throw new AuthenticationError(401, "invalid_token", "Token de autentificare invalid.");
  }
  return {
    ownerId: user.id,
    actorId: user.id,
    user,
    tokenScopes: row.scopes.split(",").map((s) => s.trim()).filter(Boolean),
    tokenId: row.id,
  };
}
```

- [ ] **Step 4: Extend AuthenticatedContext + dispatch in authProvider**

In `backend/src/auth/authProvider.ts`:
```ts
// extinde interfata:
export interface AuthenticatedContext {
  ownerId: string;
  actorId: string;
  user: UserRow | null;
  tokenPayload?: AuthJwtPayload;
  tokenScopes?: string[];
  tokenId?: string;
}

// in WebJwtAuthProvider.authenticate, IMEDIAT dupa `const token = readRequestToken(c);`
// si verificarea `if (!token)`:
import { resolvePatContext } from "./patProvider.ts";
import { TOKEN_PREFIX } from "../db/apiTokenRepository.ts";
// ...
    // fix review REL-NO-KILLSWITCH: kill switch operational per-request (ca
    // ICCJ_ROUTES_DISABLED/OPENROUTER_DISABLED). Cand e on, un ld_pat_ cade pe
    // calea JWT si esueaza ca 401 normal; tokenId nu se seteaza → toate gate-urile
    // PAT raman no-op automat. Documenteaza in backend/.env.example.
    if (token.startsWith(TOKEN_PREFIX) && process.env.LEGAL_DASHBOARD_PAT_DISABLED !== "1") {
      return resolvePatContext(c, token);
    }
// restul (verifyAuthToken JWT) ramane neschimbat.
```

- [ ] **Step 5: Set token fields on context in ownerContext**

In `backend/src/middleware/owner.ts`:
```ts
// in ContextVariableMap:
    tokenScopes: string[] | undefined;
    tokenId: string | undefined;

// in ownerContext, dupa c.set("authUser", ...):
    c.set("tokenScopes", authenticated.tokenScopes);
    c.set("tokenId", authenticated.tokenId);
```

- [ ] **Step 6: Run tests**

Run: `cd backend && npx vitest run src/auth/patProvider.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS + typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth/patProvider.ts backend/src/auth/patProvider.test.ts backend/src/auth/authProvider.ts backend/src/middleware/owner.ts
git commit -m "feat(auth): PAT dispatch on ld_pat_ prefix (web mode), owner context unchanged"
```

---

## Phase 4 — Authorization (default-deny + scope + method)

### Task 4: PAT capability gate

**Files:**
- Create: `backend/src/middleware/patCapabilityGate.ts`
- Test: `backend/src/middleware/patCapabilityGate.test.ts`
- Modify: `backend/src/index.ts` (mount dupa `ownerContext`), `backend/src/util/envelope.ts` (coduri noi)

**Interfaces:**
- Consumes: `c.get("tokenScopes")`, `c.get("tokenId")` (Task 3).
- Produces: `PAT_CAPABILITIES: ReadonlyArray<{ method: string; prefix: string; scope: string }>`; `patCapabilityGate` middleware. (Fara `requireScope` — gate-ul global e sursa unica.)

- [ ] **Step 1: Add error codes**

In `backend/src/util/envelope.ts` `ErrorCodes`: adauga `PAT_ROUTE_FORBIDDEN: "PAT_ROUTE_FORBIDDEN"`, `INSUFFICIENT_SCOPE: "INSUFFICIENT_SCOPE"`, `PAT_CANNOT_MANAGE_TOKENS: "PAT_CANNOT_MANAGE_TOKENS"`, `ICCJ_UNAVAILABLE: "ICCJ_UNAVAILABLE"`. (fix review PAT-003: NU adauga `INVALID_TOKEN` — 401-ul PAT emite lowercase `invalid_token` prin `AuthenticationError`, ca restul codurilor 401 din authProvider; casing-ul split 401-lowercase / 403-429-uppercase e intentionat, documenteaza-l in API.md.)

- [ ] **Step 2: Write the failing test**

`backend/src/middleware/patCapabilityGate.test.ts` — foloseste o app Hono minimala cu context fake. Acopera: PAT cu scope `dosare` pe `GET /api/dosare` → next; PAT pe `GET /api/dosare-iccj` (segment boundary!) → 403; PAT pe `/api/ai/...` → 403 `pat_route_forbidden`; path cu `%2F`/`..` → 403; metoda gresita (POST pe o capabilitate GET) → 403; sesiune fara `tokenId` → next (neafectat).
```ts
import { Hono } from "hono";
import { patCapabilityGate } from "./patCapabilityGate.ts";

function appWith(tokenScopes?: string[], tokenId?: string) {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("tokenScopes", tokenScopes); c.set("tokenId", tokenId); await next(); });
  app.use("*", patCapabilityGate);
  app.all("*", (c) => c.text("ok"));
  return app;
}

it("allows a scoped PAT on its capability route", async () => {
  const res = await appWith(["dosare"], "tok1").request("/api/dosare?x=1");
  expect(res.status).toBe(200);
});
it("blocks dosare-scoped PAT on the ICCJ route (segment boundary)", async () => {
  const res = await appWith(["dosare"], "tok1").request("/api/dosare-iccj", { method: "POST" });
  expect(res.status).toBe(403);
});
it("default-denies a PAT on /api/ai", async () => {
  const res = await appWith(["dosare", "iccj", "rnpm"], "tok1").request("/api/ai/analyze", { method: "POST" });
  expect(res.status).toBe(403);
});
it("is a no-op for non-PAT sessions", async () => {
  const res = await appWith(undefined, undefined).request("/api/ai/analyze", { method: "POST" });
  expect(res.status).toBe(200);
});
// fix PAT-001: ICCJ e GET — un PAT cu scope iccj trebuie sa treaca pe GET.
it("allows an iccj-scoped PAT on GET /api/dosare-iccj", async () => {
  const res = await appWith(["iccj"], "tok1").request("/api/dosare-iccj?numarDosar=1/1/2025");
  expect(res.status).toBe(200);
});
// T-02: metoda read-only — POST pe un prefix allowlistat doar pe GET, cu scope-ul corect.
it("blocks a write method under a GET-only allowed prefix", async () => {
  const res = await appWith(["dosare"], "tok1").request("/api/dosare", { method: "POST" });
  expect(res.status).toBe(403); // PAT_ROUTE_FORBIDDEN (metoda nu matchuieste cap GET)
});
// T-09: scope membership exact, nu substring.
it("requires exact scope membership (no substring match)", async () => {
  // o capabilitate ipotetica ce cere 'dosare_admin' nu e satisfacuta de scope 'dosare'
  const res = await appWith(["dosare"], "tok1").request("/api/dosare-iccj");
  expect(res.status).toBe(403); // lipseste scope 'iccj'
});
// subruta necunoscuta sub un prefix permis (alt metoda/destinatie) → 403.
it("denies an unknown subroute under an allowed prefix", async () => {
  const res = await appWith(["rnpm"], "tok1").request("/api/rnpm/saved/abc", { method: "DELETE" });
  expect(res.status).toBe(403);
});
// PAT-005: rutele de management tokenuri → cod dedicat, nu PAT_ROUTE_FORBIDDEN.
it("returns pat_cannot_manage_tokens for a PAT on /api/v1/tokens", async () => {
  const res = await appWith(["dosare"], "tok1").request("/api/v1/tokens", { method: "POST" });
  expect(res.status).toBe(403);
  expect((await res.json()).error.code).toBe("PAT_CANNOT_MANAGE_TOKENS");
});
// segment-boundary: dosare-scoped NU ajunge la ICCJ desi '/api/dosare' e prefix textual.
it("does not let /api/dosare cap leak into /api/dosare-iccj", async () => {
  const res = await appWith(["dosare"], "tok1").request("/api/dosare-iccj");
  expect(res.status).toBe(403);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/middleware/patCapabilityGate.test.ts`
Expected: FAIL (`patCapabilityGate` not defined).

- [ ] **Step 4: Write patCapabilityGate**

`backend/src/middleware/patCapabilityGate.ts`:
```ts
import type { Context, Next } from "hono";
import { ErrorCodes, fail } from "../util/envelope.ts";

// Single source of truth: ce poate atinge un PAT. Default-deny in afara listei.
// Doar citire: GET + POST-urile de cautare verificate. ATENTIE (fix review PAT-001):
// RNPM search e POST; ICCJ search (dosare-iccj/termene-iccj) e GET — verificat in
// dosareIccjRouter.get/termeneIccjRouter.get. Revizuieste la FIECARE ruta noua.
export const PAT_CAPABILITIES: ReadonlyArray<{ method: string; prefix: string; scope: string }> = [
  { method: "GET", prefix: "/api/dosare", scope: "dosare" },
  { method: "GET", prefix: "/api/termene", scope: "dosare" },
  { method: "GET", prefix: "/api/dosare-iccj", scope: "iccj" },
  { method: "GET", prefix: "/api/termene-iccj", scope: "iccj" },
  { method: "POST", prefix: "/api/rnpm/search", scope: "rnpm" },
  { method: "GET", prefix: "/api/rnpm/saved", scope: "rnpm" },
];

// Match pe granita de segment, case-insensitiv, trailing-slash canonic (fix
// review-panel): "/api/dosare" NU acopera "/api/dosare-iccj"; "/api/dosare/" == "/api/dosare".
function normPath(p: string): string {
  const lower = p.toLowerCase();
  return lower.length > 1 && lower.endsWith("/") ? lower.slice(0, -1) : lower;
}
function pathMatches(path: string, prefix: string): boolean {
  const p = normPath(path);
  const pre = normPath(prefix);
  return p === pre || p.startsWith(pre + "/");
}

// Respinge path-uri ambigue inainte de authz (encoded slash / dot-segment / backslash).
// fix review-panel HIGH: verifica DOAR componenta de path, NU query-string-ul —
// altfel `?numarDosar=4821%2F3%2F2024` (slash encodat legitim) ar da 403 si ar
// rupe cazul principal de cautare dosare.
function isSuspiciousPath(rawUrl: string): boolean {
  let p = rawUrl;
  try {
    p = new URL(rawUrl).pathname;
  } catch {
    /* rawUrl deja relativ → foloseste-l ca atare */
  }
  const lower = p.toLowerCase();
  return lower.includes("%2f") || lower.includes("%2e") || lower.includes("%5c") || p.includes("..");
}

export async function patCapabilityGate(c: Context, next: Next): Promise<Response | undefined> {
  const tokenId = c.get("tokenId");
  if (!tokenId) {
    // JWT complet / desktop → neafectat.
    await next();
    return;
  }
  const scopes = c.get("tokenScopes") ?? [];
  const method = c.req.method.toUpperCase();
  const path = c.req.path; // Hono path normalizat

  if (isSuspiciousPath(c.req.url)) {
    return c.json(fail(ErrorCodes.PAT_ROUTE_FORBIDDEN, "Cerere refuzata: path ambiguu.", c), 403);
  }

  // fix PAT-005/REL-MGMT-GUARD-DEAD: rutele de management tokenuri sunt session-only.
  // Gate-ul (montat pe /api/*) le prinde inaintea router-ului, deci emite AICI codul
  // corect (pat_cannot_manage_tokens), nu PAT_ROUTE_FORBIDDEN generic. Sursa unica.
  if (normPath(path).startsWith("/api/v1/tokens")) {
    return c.json(fail(ErrorCodes.PAT_CANNOT_MANAGE_TOKENS, "Un token nu poate administra tokenuri.", c), 403);
  }

  const cap = PAT_CAPABILITIES.find((x) => x.method === method && pathMatches(path, x.prefix));
  if (!cap) {
    return c.json(fail(ErrorCodes.PAT_ROUTE_FORBIDDEN, "Tokenul nu are acces la aceasta ruta.", c), 403);
  }
  if (!scopes.includes(cap.scope)) {
    return c.json(fail(ErrorCodes.INSUFFICIENT_SCOPE, `Tokenul nu are scope-ul ${cap.scope}.`, c), 403);
  }
  await next();
  return;
}
// NOTA (fix review-panel): `requireScope` per-router a fost ELIMINAT (era dead code —
// nu se monta nicaieri). Gate-ul global cu `PAT_CAPABILITIES` e sursa unica de adevar
// pentru metoda + path + scope (DRY/YAGNI).
```

- [ ] **Step 5: Mount the gate after ownerContext**

In `backend/src/index.ts`, imediat dupa `app.use("*", ownerContext);` (linia 233) si inainte de `app.use("/api/*", rateLimit);`:
```ts
import { patCapabilityGate } from "./middleware/patCapabilityGate.ts";
app.use("/api/*", patCapabilityGate);
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd backend && npx vitest run src/middleware/patCapabilityGate.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/middleware/patCapabilityGate.ts backend/src/middleware/patCapabilityGate.test.ts backend/src/index.ts backend/src/util/envelope.ts
git commit -m "feat(auth): PAT default-deny capability gate (method + segment-boundary path + scope)"
```

---

## Phase 5 — CSRF bypass, per-token rate limit, page-size cap

### Task 5: originGuard Bearer bypass on successful PAT auth

**Files:**
- Modify: `backend/src/middleware/originGuard.ts`
- Test: `backend/src/middleware/originGuard.test.ts` (extinde)

**Interfaces:**
- Consumes: `c.get("tokenId")` (set de ownerContext care ruleaza inaintea originGuard — confirmat in index.ts).

- [ ] **Step 1: Write the failing test**

In `backend/src/middleware/originGuard.test.ts`: un POST non-loopback fara Origin/Referer dar cu `tokenId` setat → trece; acelasi fara `tokenId` (sesiune cookie) → 403.
```ts
it("bypasses origin check for a successfully-authenticated PAT", async () => {
  // construieste un context cu remote non-loopback + c.set("tokenId","tok1"), fara Origin
  // asteapta next() apelat (nu 403)
});
it("still rejects a non-loopback cookie POST with no Origin", async () => {
  // fara tokenId → 403 csrf_origin_mismatch
});
```

- [ ] **Step 2: Add the bypass**

In `backend/src/middleware/originGuard.ts`, dupa bypass-ul de loopback (`if (isLoopbackAddress(remoteAddr)) {...}`) si inainte de citirea Host:
```ts
  // Bearer/PAT nu e ambient → imun la CSRF. Gate pe AUTH PAT REUSIT (tokenId
  // setat de ownerContext), NU pe prezenta header-ului: un `Bearer garbage`
  // esueaza la auth (401) inainte sa ajunga aici, deci nu poate ocoli originGuard.
  if (c.get("tokenId")) {
    await next();
    return;
  }
```

- [ ] **Step 3: Run tests**

Run: `cd backend && npx vitest run src/middleware/originGuard.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/middleware/originGuard.ts backend/src/middleware/originGuard.test.ts
git commit -m "feat(security): originGuard bypass on successful PAT auth (CSRF-immune Bearer)"
```

### Task 6: Per-token rate limit

**Files:**
- Modify: `backend/src/middleware/rate-limit.ts`
- Test: `backend/src/middleware/rate-limit.test.ts` (extinde)

**Interfaces:**
- Consumes: `c.get("tokenId")`.
- Produces: `TOKEN_RATE_LIMIT` const; bucket `tok|<tokenId>` aplicat in `rateLimit`.

- [ ] **Step 1: Write the failing tests**

```ts
import { _resetRateLimitForTest } from "./rate-limit.ts";
beforeEach(() => _resetRateLimitForTest()); // T-14: izolare intre teste

it("throttles per-token below the per-owner ceiling", async () => {
  // simuleaza > TOKEN_RATE_LIMIT requesturi cu acelasi tokenId → 429
});
// fix R05/REL-RATELIMIT-BYPASS: ruta exceptata GET /api/rnpm/saved NU mai scapa un PAT.
it("rate-limits a PAT even on GET /api/rnpm/saved", async () => {
  // > TOKEN_RATE_LIMIT requesturi PAT pe /api/rnpm/saved cu acelasi tokenId → 429
});
```

- [ ] **Step 2: Implement**

`fail(...)` AICI e helperul LOCAL din `rate-limit.ts` (`fail(c, status, code, message)`), NU envelope-ul global `fail(code, message, c)` — semnaturi diferite intentionat, nu confunda.

Pune verificarea per-token la INCEPUTUL lui `rateLimit`, **inainte** de early-return-ul `GET /api/rnpm/saved` (rate-limit.ts:39-42), altfel un PAT pe ruta exceptata scapa neplafonat (fix R05). Suplimentar, conditioneaza scutirea pe `!tokenId`:
```ts
export const TOKEN_RATE_LIMIT = Number(process.env.LEGAL_DASHBOARD_TOKEN_RATE_LIMIT) || 60;
const tokenRateLimitMap = new Map<string, { count: number; resetTime: number }>();

// in rateLimit(), DUPA `readClientIp` (now/ip), INAINTE de early-return-ul /api/rnpm/saved:
  const tokenId = c.get("tokenId");
  if (tokenId) {
    const tkey = `tok|${tokenId}`;
    const tentry = tokenRateLimitMap.get(tkey);
    if (!tentry || now > tentry.resetTime) {
      tokenRateLimitMap.set(tkey, { count: 1, resetTime: now + RATE_WINDOW });
    } else {
      tentry.count += 1;
      if (tentry.count > TOKEN_RATE_LIMIT) {
        return fail(c, 429, "rate_limited", "Prea multe cereri pentru acest token.");
      }
    }
  }
// si schimba scutirea existenta ca PAT-urile sa NU fie exceptate:
//   if (c.req.method === "GET" && c.req.path.startsWith("/api/rnpm/saved") && !c.get("tokenId")) { next(); return; }
```
Adauga `tokenRateLimitMap` la `sweepExpiredEntries` si la `_resetRateLimitForTest` (altfel state-ul curge intre teste + creste nelimitat — fix PAT-010/T-14).

- [ ] **Step 3: Run tests** — `cd backend && npx vitest run src/middleware/rate-limit.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/middleware/rate-limit.ts backend/src/middleware/rate-limit.test.ts
git commit -m "feat(security): per-token rate limit bucket"
```

### Task 7: Server-side page-size cap on PAT read routes

**Files:**
- Modify: `backend/src/routes/dosare.ts` (si orice ruta PAT cu marime controlata de client)
- Test: extinde testele de ruta existente

**Interfaces:**
- RNPM are deja `clampPageSize` / `MAX_PAGE_SIZE = 200` ([rnpm.ts:45-53](../../../backend/src/routes/rnpm.ts#L45-L53)) — confirma ca se aplica pe calea PAT.
- ICCJ pagineaza `?page=N` cu cap natural 1000 — fara `limit` controlat de client.

- [ ] **Step 1: Audit + test**

Scrie un test care confirma ca un `pageSize`/`limit` exagerat din query e plafonat server-side pe rutele PAT-accesibile (dosare/rnpm/saved). Pentru rute fara parametru de marime (dosare SOAP, ICCJ), documenteaza ca marimea e marginita upstream (SOAP 1000 / ICCJ page) — niciun client override.
```ts
it("clamps an oversized pageSize on the saved RNPM list", async () => {
  // GET /api/rnpm/saved?pageSize=1000000 → raspunsul foloseste pageSize <= MAX_PAGE_SIZE
});
```

- [ ] **Step 2: Apply clamp where missing** — daca vreo ruta PAT citeste `limit`/`pageSize` din query fara clamp, aplica `clampPageSize(raw, fallback)` (mut-l intr-un helper partajat daca e duplicat). Pentru dosare GET (SOAP) nu exista `limit` client → nicio schimbare; documenteaza in cod.

- [ ] **Step 3: Run tests + Commit**

```bash
git add backend/src/routes/dosare.ts backend/src/routes/rnpm.ts
git commit -m "feat(security): server-side page-size cap on PAT-reachable read routes"
```

---

## Phase 5.5 — Controale PAT obligatorii (no-store, HTTPS-only, mount conditional)

### Task 7.5: patSecurity middleware (no-store + HTTPS-only)

**Files:**
- Create: `backend/src/middleware/patSecurity.ts` (+ `.test.ts`)
- Modify: `backend/src/index.ts` (monteaza `patSecurity` intre `ownerContext` si `patCapabilityGate`)

**De ce intre ownerContext si gate:** are nevoie de `tokenId` (setat de ownerContext) si trebuie sa fie EXTERIOR gate-ului ca `no-store` sa acopere si raspunsurile 403 ale gate-ului (fix review-panel).

- [ ] **Step 1: Write the failing tests** — PAT GET → header `Cache-Control: no-store`; JWT/desktop → fara no-store; in `NODE_ENV=production` fara `x-forwarded-proto: https` → 426 (chiar si de pe peer loopback); cu `x-forwarded-proto: https` → trece; un PAT 403-uit de gate tot primeste `no-store`.

- [ ] **Step 2: Implement**
```ts
import type { Context, Next } from "hono";
import { ErrorCodes, fail } from "../util/envelope.ts";

export async function patSecurity(c: Context, next: Next): Promise<Response | undefined> {
  const isPat = !!c.get("tokenId");
  // HTTPS-only in productie (fix review-panel): cere x-forwarded-proto https; NU
  // permite bypass pe peer loopback in prod (un reverse-proxy local cu proto=http
  // ar ocoli). Dev/loopback se controleaza explicit cu LEGAL_DASHBOARD_PAT_ALLOW_HTTP=1.
  if (isPat && process.env.NODE_ENV === "production" && process.env.LEGAL_DASHBOARD_PAT_ALLOW_HTTP !== "1") {
    if (c.req.header("x-forwarded-proto") !== "https") {
      return c.json(fail(ErrorCodes.PAT_ROUTE_FORBIDDEN, "PAT necesita HTTPS.", c), 426);
    }
  }
  await next();
  if (isPat) {
    // mutat pe raspunsul final → acopera si 403-ul gate-ului care ruleaza dupa.
    c.res.headers.set("Cache-Control", "no-store");
    c.res.headers.set("Pragma", "no-cache");
  }
  return;
}
```

- [ ] **Step 3: Commit**
```bash
git add backend/src/middleware/patSecurity.ts backend/src/middleware/patSecurity.test.ts backend/src/index.ts
git commit -m "feat(security): PAT no-store + HTTPS-only middleware"
```

### Task 7.6: Mount conditional (web-mode) + teste desktop/kill-switch/timing

**Files:**
- Modify: `backend/src/index.ts` (mount conditional)
- Test: `backend/src/auth/authProvider.test.ts` / `backend/src/index.test.ts`

- [ ] **Step 1: Conditional mount (fix REL-CONDITIONAL-MOUNT)** — monteaza suprafata PAT DOAR in web mode (pattern `MONITORING_ENABLED` din index.ts:341), ca desktop sa nu expuna deloc token-mgmt/OpenAPI/gate:
```ts
import { getAuthMode } from "./auth/config.ts";
if (getAuthMode() === "web") {
  app.use("/api/*", patSecurity);
  app.use("/api/*", patCapabilityGate);
  app.use("/api/*", patUsageAudit);
  app.route("/api/v1/openapi.json", openapiRouter); // inainte de gate ca discovery
  app.route("/api/v1/tokens", apiTokensRouter);
}
```
(Ordinea relativa: `ownerContext` (existent) → `patSecurity` → `patCapabilityGate` → `patUsageAudit` → `rateLimit`/`originGuard` existente. OpenAPI montat inaintea gate-ului.)

- [ ] **Step 2: Desktop zero-impact test (T-05)** — `LEGAL_DASHBOARD_AUTH_MODE=desktop` + header `Authorization: Bearer ld_pat_anything`: `getAuthProvider().authenticate(c)` → `tokenId`/`tokenScopes` undefined, `ownerId==="local"`, si spy pe `findActiveTokenByHash` confirma ZERO apeluri DB (PAT-shaped header ignorat complet).

- [ ] **Step 3: Kill-switch per-request test** — `LEGAL_DASHBOARD_PAT_DISABLED=1` + token `ld_pat_` valid → 401 (cade pe calea JWT); fara env → rezolva. Citit per-request (env verificat in `authenticate`, care ruleaza per cerere). Documenteaza in `backend/.env.example`.

- [ ] **Step 4: Timing-401 test (A8)** — `resolvePatContext` intoarce acelasi 401 generic `invalid_token` si pentru token inexistent, si pentru user inactiv (fara ramificare observabila pe existenta randului). Blocheaza comportamentul cu un test.

- [ ] **Step 5: Commit**
```bash
git add backend/src/index.ts backend/src/auth/authProvider.test.ts backend/src/index.test.ts backend/.env.example
git commit -m "feat(security): web-mode conditional mount + desktop/kill-switch/timing tests"
```

---

## Phase 6 — RNPM captcha per-token cap (atomic)

### Task 8: Per-token captcha cap in withRnpmCaptchaGuards

**Files:**
- Modify: `backend/src/routes/rnpmGuards.ts`
- Test: `backend/src/routes/rnpmCaptchaQuota.test.ts` (extinde)

**Interfaces:**
- Consumes: `c.get("tokenId")`, `findActiveTokenByHash`→ row deja rezolvat? Nu: in guard avem doar `tokenId`. Adauga `getTokenCaptchaCap(tokenId): number | null` in `apiTokenRepository` (SELECT captcha_daily_cap). `countTokenCaptchaUsageInWindow` (Task 2).

- [ ] **Step 1: Add getTokenCaptchaCap to apiTokenRepository**

```ts
export function getTokenCaptchaCap(tokenId: string): number | null {
  const row = getDb().prepare("SELECT captcha_daily_cap FROM api_tokens WHERE id = ?").get(tokenId) as
    | { captcha_daily_cap: number | null } | undefined;
  return row?.captcha_daily_cap ?? null;
}
```

- [ ] **Step 2: Write the failing test**

In `backend/src/routes/rnpmCaptchaQuota.test.ts` (apeluri SECVENTIALE — better-sqlite3 e sincron, nu exista race in-proces; atomicitatea cross-writer e data de `BEGIN IMMEDIATE` la nivel SQLite si e moot sub single-instance, spec A9): cu `tokenId` setat si `captcha_daily_cap = 2`, primele 2 cereri trec, a 3-a → 429 `quota_exceeded`; cu cap `null` → trece (doar quota per-user). Verifica si ca exista **exact UN** rand `captcha_usage` per cerere acceptata (count==1, `token_id` setat pe calea cu cap, `null` pe calea fara) — disprobeaza dublu-record-ul (R02).

- [ ] **Step 3: Implement atomic per-token cap**

In `withRnpmCaptchaGuards`, ramura `source === "tenant"`, DUPA verificarea quota per-user existenta si INAINTE de `recordCaptchaUsage`: daca `const tokenId = c.get("tokenId")` e setat si `getTokenCaptchaCap(tokenId)` nu e null, ruleaza o rezervare atomica:
```ts
import { getTokenCaptchaCap } from "../db/apiTokenRepository.ts";
import { countTokenCaptchaUsageInWindow } from "../db/captchaUsageRepository.ts";
import { getDb } from "../db/schema.ts";
// ...
const tokenId = c.get("tokenId");
if (tokenId) {
  const cap = getTokenCaptchaCap(tokenId);
  if (cap !== null) {
    // Token CU plafon → fail-CLOSED (rezolutie conflict review-panel): daca tranzactia
    // pica (ex. SQLITE_BUSY), respinge 503 retry — NU accepta peste plafon, NU 500.
    let blocked = false;
    try {
      getDb().transaction(() => {
        const used = countTokenCaptchaUsageInWindow(tokenId, 86_400);
        if (cap === 0 || used >= cap) { blocked = true; return; }
        recordCaptchaUsage({ ownerId, provider: resolved.provider, source: "tenant",
          requestId: getRequestId(c), tokenId });
      }).immediate();
    } catch (err) {
      console.error("[rnpm.guards] token captcha reservation failed", err);
      c.header("Retry-After", "5");
      return { ok: false, response: c.json(
        fail(ErrorCodes.QUOTA_EXCEEDED, "Rezervare captcha indisponibila, reincearca.", c,
          { feature: "captcha.token", retry: true }), 503) };
    }
    if (blocked) {
      c.header("Retry-After", "86400");
      return { ok: false, response: c.json(
        fail(ErrorCodes.QUOTA_EXCEEDED, "Plafonul de captcha al tokenului a fost atins.", c,
          { feature: "captcha.token", cap }), 429) };
    }
    // captcha-ul a fost deja inregistrat in tranzactie (cu token_id); sari peste
    // recordCaptchaUsage-ul de mai jos pentru calea cu tokenId+cap.
    return { ok: true, source: "tenant", body: body as Record<string, unknown>,
      captchaKey: resolved.captchaKey, captchaProvider: resolved.provider, captchaMode: resolved.mode };
  }
}
// Calea FARA cap (sau fara tokenId): aceasta E inlocuirea apelului existent
// recordCaptchaUsage din rnpmGuards.ts:124-133 (NU un al doilea apel — fix R02) —
// adauga doar `tokenId` si pastreaza try/catch-ul existent (fail-OPEN, record-and-accept).
try {
  recordCaptchaUsage({ ownerId, provider: resolved.provider, source: "tenant",
    requestId: getRequestId(c), tokenId: tokenId ?? null });
} catch (err) {
  console.error("[rnpm.guards] captcha usage record failed", err);
}
```
(Pastreaza ordinea: quota per-user existenta ramane prima poarta; plafonul per-token e SUB ea. Token CU plafon = fail-closed; token FARA plafon = fail-open, ca semantica existenta "overcount, never undercount".)

- [ ] **Step 4: Run tests + Commit**

```bash
git add backend/src/routes/rnpmGuards.ts backend/src/db/apiTokenRepository.ts backend/src/routes/rnpmCaptchaQuota.test.ts
git commit -m "feat(security): atomic per-token RNPM captcha cap"
```

---

## Phase 7 — ICCJ circuit-breaker per caller-class

### Task 9: iccjBreaker + wrap network entry points

**Files:**
- Create: `backend/src/services/iccj/iccjBreaker.ts`
- Test: `backend/src/services/iccj/iccjBreaker.test.ts`
- Modify: `backend/src/services/iccj/iccjClient.ts` (wrap `searchIccj`, `fetchIccjDetail`, `searchSedinteIccj` cu `callerClass`)

**Interfaces:**
- Produces:
  - `type IccjCaller = "ui" | "monitoring" | "pat"`
  - `class IccjBreakerOpenError extends Error`
  - `withBreaker<T>(caller: IccjCaller, fn: () => Promise<T>): Promise<T>` — arunca `IccjBreakerOpenError` cand e deschis pentru clasa respectiva; inregistreaza esecuri de distres upstream.
  - `_resetBreakerForTest()`
- `IccjRequestOptions` (in iccjClient) primeste `callerClass?: IccjCaller` (default `"ui"`).

- [ ] **Step 1: Write the failing test**

`backend/src/services/iccj/iccjBreaker.test.ts`: dupa N esecuri de distres breaker-ul se deschide; in starea deschisa, un apel `pat` arunca imediat; un apel `ui` in half-open (dupa cooldown) primeste un singur probe; PAT ramane blocat in half-open pana la inchidere.
```ts
it("opens after threshold distress failures and blocks PAT first", async () => {
  for (let i = 0; i < BREAKER_THRESHOLD; i++) {
    await expect(withBreaker("ui", async () => { throw new IccjSourceError("HTTP 503"); })).rejects.toThrow();
  }
  await expect(withBreaker("pat", async () => "x")).rejects.toThrow(IccjBreakerOpenError);
});
```

- [ ] **Step 2: Implement iccjBreaker**

`backend/src/services/iccj/iccjBreaker.ts`:
```ts
export type IccjCaller = "ui" | "monitoring" | "pat";

export class IccjBreakerOpenError extends Error {
  readonly code = "ICCJ_BREAKER_OPEN";
  constructor() { super("ICCJ temporar indisponibil (circuit breaker deschis)."); this.name = "IccjBreakerOpenError"; }
}

const BREAKER_THRESHOLD = Number(process.env.ICCJ_BREAKER_THRESHOLD) || 8; // esecuri distres / fereastra
const BREAKER_WINDOW_MS = 60_000;
const BREAKER_COOLDOWN_MS = Number(process.env.ICCJ_BREAKER_COOLDOWN_MS) || 30_000;

// fix review R01/T-03: schema PONDERATA, NU contor global plat. PAT-ul induce
// 0.25 din greutatea unui esec UI/monitoring → un PAT in bucla nu mai poate
// tranti breaker-ul pentru ceilalti, dar un outage real scj.ro (care loveste si
// UI+monitoring cu greutate 1) tot il deschide la rata normala. Open state ramane
// global (o data deschis, toata lumea cedeaza; PAT cedeaza primul in half-open).
const PAT_DISTRESS_WEIGHT = 0.25;
let failures: Array<{ t: number; w: number }> = []; // esecuri distres ponderate
let openedAt: number | null = null;    // cand s-a deschis
let halfOpenProbeInFlight = false;

function distress(err: unknown): boolean {
  // doar semnale de stare reala scj.ro: HTTP 429/403/5xx + timeout. Erorile de
  // parse (markup drift) NU sunt distres upstream.
  const msg = err instanceof Error ? err.message : String(err);
  // fix review R03: include 403 (anti-bot scj.ro); scoate AbortError (anularea de
  // catre apelant NU e distres upstream; timeout-urile reale prind via "timeout").
  return /HTTP (403|429|5\d\d)|too large|timeout/i.test(msg);
}

export function _resetBreakerForTest(): void { failures = []; openedAt = null; halfOpenProbeInFlight = false; }

export async function withBreaker<T>(caller: IccjCaller, fn: () => Promise<T>, now = Date.now()): Promise<T> {
  failures = failures.filter((f) => now - f.t < BREAKER_WINDOW_MS);

  if (openedAt !== null) {
    const elapsed = now - openedAt;
    if (elapsed < BREAKER_COOLDOWN_MS) {
      // in cooldown TOATE clasele cedeaza (breaker complet deschis) — fix comentariu review-panel.
      throw new IccjBreakerOpenError();
    }
    // half-open: doar UI/monitoring primesc UN probe controlat de sistem; PAT blocat.
    if (caller === "pat" || halfOpenProbeInFlight) throw new IccjBreakerOpenError();
    halfOpenProbeInFlight = true;
    try {
      const out = await fn();
      openedAt = null; failures = []; halfOpenProbeInFlight = false; // succes → inchide
      return out;
    } catch (err) {
      halfOpenProbeInFlight = false;
      // fix review-panel: doar un esec de DISTRES reopeneste. Un esec non-distres
      // (parse/markup drift) inseamna ca scj.ro a RASPUNS → upstream viu → inchide,
      // ca breaker-ul sa nu ramana blocat la nesfarsit pe o eroare de parsing.
      if (distress(err)) { openedAt = now; failures = []; }
      else { openedAt = null; failures = []; }
      throw err;
    }
  }

  try {
    return await fn();
  } catch (err) {
    if (distress(err)) {
      failures.push({ t: now, w: caller === "pat" ? PAT_DISTRESS_WEIGHT : 1 });
      if (failures.length > 1000) failures = failures.slice(-1000); // cap dur (blind spot review-panel)
      // fix review-panel HIGH (math): cu rate ~60/min × 0.25 = 15 ≥ prag 8, un
      // SINGUR PAT in bucla ar fi deschis breaker-ul global. Plafoneaza
      // contributia totala PAT sub prag → PAT singur NU poate deschide; un outage
      // real scj.ro (loveste si UI/monitoring cu w=1) il deschide normal.
      const patScore = failures.filter((f) => f.w < 1).reduce((s, f) => s + f.w, 0);
      const nonPatScore = failures.filter((f) => f.w >= 1).reduce((s, f) => s + f.w, 0);
      const score = Math.min(patScore, BREAKER_THRESHOLD - 1) + nonPatScore;
      if (score >= BREAKER_THRESHOLD) openedAt = now;
    }
    throw err;
  }
}
```

- [ ] **Step 3: Wrap the 3 entry points**

In `backend/src/services/iccj/iccjClient.ts`: adauga `callerClass?: IccjCaller` la `IccjRequestOptions`, si infasoara corpul de retea al lui `searchIccj`, `fetchIccjDetail`, `searchSedinteIccj` in `withBreaker(options?.callerClass ?? "ui", async () => { ... })`. Rutele PAT pasează `callerClass: "pat"`; `iccjRunner` (monitoring) pasează `"monitoring"`; UI implicit `"ui"`.

- [ ] **Step 4: Route returns 503 on breaker open**

In rutele ICCJ (`dosare-iccj`, `termene-iccj`): prinde `IccjBreakerOpenError` → `c.json(fail(ErrorCodes.ICCJ_UNAVAILABLE, err.message, c), 503)`.

- [ ] **Step 5: Run tests + Commit**

```bash
git add backend/src/services/iccj/iccjBreaker.ts backend/src/services/iccj/iccjBreaker.test.ts backend/src/services/iccj/iccjClient.ts backend/src/routes/dosareIccj.ts backend/src/routes/termeneIccj.ts
git commit -m "feat(reliability): global ICCJ circuit-breaker with per-caller-class isolation"
```

---

## Phase 8 — Token management routes + audit + new-IP alert

### Task 10: apiTokensRouter (session-only)

**Files:**
- Create: `backend/src/routes/apiTokens.ts`
- Test: `backend/src/routes/apiTokens.test.ts`
- Modify: `backend/src/index.ts` (mount `/api/v1/tokens`)

**Interfaces:**
- Consumes: `createApiToken`, `listTokensByOwner`, `revokeToken`, `revokeAllTokens` (Task 2); `getOwnerId` ([owner.ts](../../../backend/src/middleware/owner.ts)); `ok`/`fail` (envelope).
- Produces: `apiTokensRouter`. Rute: `POST /api/v1/tokens`, `GET /api/v1/tokens`, `DELETE /api/v1/tokens/:id`, `POST /api/v1/tokens/revoke-all`.

- [ ] **Step 1: Write the failing test**

`backend/src/routes/apiTokens.test.ts` (cu `ownerContext` montat → ownerId din auth, nu din param): creare returneaza `secret` o singura data + prefix; listarea nu include `token_hash`/`secret`; PAT (`tokenId` setat) pe oricare ruta → 403 `pat_cannot_manage_tokens`; validare scopes invalid / camp extra (`.strict()`) / nume cu control chars → 400; **T-12 owner-isolation (IDOR):** alice nu poate revoca/vedea tokenul lui bob (`DELETE /api/v1/tokens/:bobId` ca alice → 404); **T-11 idempotenta:** `DELETE` pe un token deja revocat → 200 (`alreadyRevoked`), `revoke-all` pe owner fara tokenuri → 0 fara eroare; **PAT-007:** `captchaDailyCap` peste tenantMax → 422.

- [ ] **Step 2: Implement router**

`backend/src/routes/apiTokens.ts`:
```ts
import { Hono } from "hono";
import { z } from "zod";
import { getOwnerId } from "../middleware/owner.ts";
import { ErrorCodes, fail, ok } from "../util/envelope.ts";
import { createApiToken, listTokensByOwner, revokeAllTokens, revokeToken, tokenExistsForOwner } from "../db/apiTokenRepository.ts";
import { recordAudit } from "../db/auditRepository.ts";

export const apiTokensRouter = new Hono();

// Session-only: un PAT NU poate crea/lista/revoca tokenuri (anti-escaladare).
apiTokensRouter.use("*", async (c, next) => {
  if (c.get("tokenId")) {
    return c.json(fail(ErrorCodes.PAT_CANNOT_MANAGE_TOKENS, "Un token nu poate administra tokenuri.", c), 403);
  }
  await next();
});

const SCOPES = ["dosare", "iccj", "rnpm"] as const;
// .strict() respinge campuri necunoscute; name trim + charset afisabil (fix review-panel).
const createSchema = z.object({
  name: z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N} ._@()\-]+$/u, "caractere invalide in nume"),
  scopes: z.array(z.enum(SCOPES)).nonempty().refine((a) => new Set(a).size === a.length, "duplicate scopes"),
  captchaDailyCap: z.number().int().min(0).max(100_000).nullable().optional(),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable().optional(),
}).strict();

// PAT-007: plafonul per-token nu poate depasi maximul tenantului. tenantMax din
// env MAX_TOKEN_CAPTCHA_CAP (sau quota tenant captcha.rnpm daca e configurata).
function tenantMaxCaptchaCap(): number {
  const raw = Number(process.env.MAX_TOKEN_CAPTCHA_CAP);
  return Number.isFinite(raw) && raw > 0 ? raw : 100_000;
}

function expiresAtFromDays(days: number | null | undefined): string | null {
  if (!days) return null;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

apiTokensRouter.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail(ErrorCodes.VALIDATION_ERROR, "Date invalide.", c, parsed.error.issues), 400);
  // PAT-007: plafonul cerut nu poate depasi maximul tenantului (check runtime).
  if (parsed.data.captchaDailyCap != null && parsed.data.captchaDailyCap > tenantMaxCaptchaCap()) {
    return c.json(fail(ErrorCodes.VALIDATION_ERROR, `captchaDailyCap depaseste maximul (${tenantMaxCaptchaCap()}).`, c), 422);
  }
  const ownerId = getOwnerId(c);
  const { row, secret } = createApiToken({
    ownerId, name: parsed.data.name, scopes: parsed.data.scopes,
    captchaDailyCap: parsed.data.captchaDailyCap ?? null,
    expiresAt: expiresAtFromDays(parsed.data.expiresInDays),
  });
  // fix review DB-003/REL-AUDIT-SIG: primul arg e Context, NU ownerId string.
  recordAudit(c, "api_token.created", { outcome: "ok", targetKind: "api_token",
    targetId: row.id, detail: { scopes: parsed.data.scopes } });
  return c.json(ok({ id: row.id, name: row.name, scopes: parsed.data.scopes, tokenPrefix: row.token_prefix,
    captchaDailyCap: row.captcha_daily_cap, expiresAt: row.expires_at, createdAt: row.created_at, secret }, c), 201);
});

apiTokensRouter.get("/", (c) => {
  const rows = listTokensByOwner(getOwnerId(c)).map((r) => ({
    id: r.id, name: r.name, scopes: r.scopes.split(",").filter(Boolean), tokenPrefix: r.token_prefix,
    captchaDailyCap: r.captcha_daily_cap, expiresAt: r.expires_at, createdAt: r.created_at,
    lastUsedAt: r.last_used_at, lastUsedIp: r.last_used_ip, revokedAt: r.revoked_at,
  }));
  return c.json(ok(rows, c), 200);
});

apiTokensRouter.delete("/:id", (c) => {
  const ownerId = getOwnerId(c);
  const id = c.req.param("id");
  const okRevoke = revokeToken(ownerId, id);
  if (okRevoke) {
    recordAudit(c, "api_token.revoked", { outcome: "ok", targetKind: "api_token", targetId: id });
    return c.json(ok({ revoked: true }, c), 200);
  }
  // fix PAT-009: DELETE idempotent. Token existent dar deja revocat → 200 (post-conditia
  // "token inactiv" e deja satisfacuta); doar tokenul cu adevarat inexistent → 404.
  if (tokenExistsForOwner(ownerId, id)) return c.json(ok({ revoked: true, alreadyRevoked: true }, c), 200);
  return c.json(fail(ErrorCodes.NOT_FOUND, "Token inexistent.", c), 404);
});

apiTokensRouter.post("/revoke-all", (c) => {
  const ownerId = getOwnerId(c);
  const count = revokeAllTokens(ownerId);
  recordAudit(c, "api_token.revoked_all", { outcome: "ok", targetKind: "api_token", detail: { count } });
  return c.json(ok({ revoked: count }, c), 200);
});
```

- [ ] **Step 3: Mount** — in `backend/src/index.ts`: `import { apiTokensRouter } from "./routes/apiTokens.ts"; app.route("/api/v1/tokens", apiTokensRouter);`

- [ ] **Step 4: Run tests + Commit**

```bash
git add backend/src/routes/apiTokens.ts backend/src/routes/apiTokens.test.ts backend/src/index.ts
git commit -m "feat(api): token management routes (session-only, anti-escalation)"
```

### Task 11: Audit on PAT use + new-IP alert

**Files:**
- Create: `backend/src/middleware/patUsageAudit.ts` (+ `.test.ts`) — middleware POST-gate care emite audit + new-IP.
- Create: `backend/src/services/tokenAlerts.ts` — `notifyTokenNewIp` (peste mailer-ul existent).
- Modify: `backend/src/db/auditRepository.ts` (`hasPriorTokenUseFromIp`)
- Modify: `backend/src/index.ts` (monteaza `patUsageAudit` DUPA `patCapabilityGate`)

**Interfaces:**
- Consumes: `touchLastUsed` (Task 2), `recordAudit`, mailer (`isMailerConfigured` + send) din infra existenta.
- Produces: `hasPriorTokenUseFromIp(tokenId, ip): boolean`; `patUsageAudit` middleware; `notifyTokenNewIp(c, tokenId, ip): Promise<void>`.

**De ce middleware separat post-gate (fix R07/REL-ALERT-BEFORE-AUTHZ):** `ownerContext` ruleaza INAINTE de `patCapabilityGate`, deci emiterea de acolo ar loga `outcome:"ok"` + ar trimite email pentru cereri ce vor fi 403. Acest middleware ruleaza dupa gate si ramifica pe statusul final.

- [ ] **Step 1: Add audit query**

In `backend/src/db/auditRepository.ts` (coloanele `action`/`target_id`/`ip` exista in `audit_log` — confirmat in auditRepository.ts; index partial `idx_audit_log_token_use` din migration 0039 acopera acest query):
```ts
export function hasPriorTokenUseFromIp(tokenId: string, ip: string): boolean {
  return getDb().prepare(
    `SELECT 1 FROM audit_log WHERE action = 'api_token.used' AND target_id = ? AND ip = ? LIMIT 1`
  ).get(tokenId, ip) !== undefined;
}
```
Retentie: evenimentele `api_token.*` sunt purjate de `purgeOldAuditLog(90)` existent (purja TOT `audit_log`), deci retentia de 90 zile din spec e pastrata fara cod nou.

- [ ] **Step 2: notifyTokenNewIp helper**

`backend/src/services/tokenAlerts.ts` — subtire peste mailer; no-op daca SMTP nu e configurat; dedup in-proces per `(tokenId, ip)` pe fereastra (un email, nu un flood la burst multi-IP):
```ts
import type { Context } from "hono";
import { isMailerConfigured /*, sendMail */ } from "<mailer-existent>";
const sentRecently = new Map<string, number>(); // `${tokenId}|${ip}` -> ts
const DEDUP_MS = 60 * 60 * 1000;
export async function notifyTokenNewIp(c: Context, tokenId: string, ip: string): Promise<void> {
  if (!isMailerConfigured()) return;
  const key = `${tokenId}|${ip}`;
  const last = sentRecently.get(key);
  const now = c.get("requestTs") ?? Date.now(); // sau Date.now() direct in runtime
  if (last && now - last < DEDUP_MS) return;
  sentRecently.set(key, now);
  // sendMail owner-scoped: subiect "Token API folosit din IP nou", corp cu tokenId scurt + ip.
}
```

- [ ] **Step 3: patUsageAudit middleware (post-gate)**

`backend/src/middleware/patUsageAudit.ts` — montat DUPA `patCapabilityGate`. Ruleaza `await next()`, apoi ramifica pe status:
```ts
import type { Context, Next } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { recordAudit, hasPriorTokenUseFromIp } from "../db/auditRepository.ts";
import { touchLastUsed } from "../db/apiTokenRepository.ts";
import { notifyTokenNewIp } from "../services/tokenAlerts.ts";

// Esantionare: o folosire auditata per (token, ip) per zi (nu 1 INSERT + 1 SELECT/request).
const auditedToday = new Map<string, string>(); // `${tokenId}|${ip}` -> YYYY-MM-DD

export async function patUsageAudit(c: Context, next: Next): Promise<void> {
  const tokenId = c.get("tokenId");
  if (!tokenId) { await next(); return; } // doar PAT
  await next();
  let ip: string | null = null;
  try { ip = getConnInfo(c).remote.address ?? null; } catch { ip = null; }
  const ua = c.req.header("user-agent") ?? null;
  const denied = c.res.status >= 400; // gate-ul a respins (403) → audit denied, fara email
  const day = new Date().toISOString().slice(0, 10);
  const key = `${tokenId}|${ip ?? "?"}`;
  try {
    if (denied) {
      recordAudit(c, "api_token.used", { outcome: "denied", targetKind: "api_token",
        targetId: tokenId, ip, userAgent: ua, detail: { path: c.req.path, status: c.res.status } });
      return;
    }
    const newIp = ip ? !hasPriorTokenUseFromIp(tokenId, ip) : false;
    touchLastUsed(tokenId, ip, ua);
    if (auditedToday.get(key) !== day || newIp) {
      auditedToday.set(key, day);
      recordAudit(c, "api_token.used", { outcome: "ok", targetKind: "api_token",
        targetId: tokenId, ip, userAgent: ua, detail: { newIp, path: c.req.path } });
    }
    if (newIp && ip) void notifyTokenNewIp(c, tokenId, ip).catch(() => {});
  } catch (err) {
    console.error("[patUsageAudit] failed", err); // niciodata nu darama requestul
  }
}
```
Monteaza in `index.ts` DUPA `patCapabilityGate`: `app.use("/api/*", patUsageAudit);`

- [ ] **Step 4: Tests** — (T-13) mailer arunca → audit-ul tot se scrie, raspunsul tot 200, fara exceptie; al doilea request din acelasi IP/zi NU re-trimite email si NU re-scrie audit (esantionare); un IP nou → email o data; o cerere 403 (PAT pe `/api/ai`) → audit `outcome:"denied"`, FARA email.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/patUsageAudit.ts backend/src/middleware/patUsageAudit.test.ts backend/src/services/tokenAlerts.ts backend/src/db/auditRepository.ts backend/src/index.ts
git commit -m "feat(security): post-gate PAT usage audit + sampled new-IP alert"
```

---

## Phase 9 — Result enrichment (A5.6, partea backend)

### Task 12: exactMatch flag pe dosare

**Files:**
- Modify: `backend/src/routes/dosare.ts`
- Test: extinde testele de ruta dosare

**Note:** `calitate` per parte vine deja in raspuns din [soap.ts:193-195](../../../backend/src/soap.ts#L193-L195) (`calitateParte`) — niciun fetch suplimentar. Auto-load-more "automat / un prompt" e comportament al stratului MCP (piesa B); backend-ul piesa A doar (a) expune `exactMatch`, (b) pastreaza paginarea/`nextRnpmPage` existenta, (c) plafoneaza marimea (Task 7).

**Domeniu (fix PAT-004):** in piesa A `exactMatch` e DOAR pe numar dosar — documenteaza explicit asta in API.md (nu lasa campul ambiguu pe cautari de nume; match pe nume normalizat e deferat piesei urmatoare).

- [ ] **Step 1: Write the failing tests**

```ts
it("flags exactMatch when the docket number matches exactly", async () => {
  // GET /api/dosare?numarDosar=4821/3/2024 unde un rezultat are numar === query → exactMatch: true
});
it("keeps existing response fields (data, total) when adding exactMatch", async () => {
  // assert ca raspunsul are inca { data, total } + exactMatch (extensie, NU inlocuire — fix PAT-012)
});
```

- [ ] **Step 2: Implement** — raspunsul curent e `{ data, total }` ([dosare.ts:176](../../../backend/src/routes/dosare.ts#L176)); `exactMatch` se ADAUGA (extensie, nu inlocuire — campurile existente raman, desktop zero-impact):
```ts
const q = (numarDosar ?? "").trim();
const exactMatch = q.length > 0 && dosare.some((d) => d.numar === q);
return c.json({ data: dosare, total: dosare.length, exactMatch }); // data+total pastrate identic
```

- [ ] **Step 3: Run + Commit**

```bash
git add backend/src/routes/dosare.ts
git commit -m "feat(api): exactMatch flag on dosare search (A5.6)"
```

---

## Phase 10 — Documentation

### Task 13: OpenAPI 3.1 + API.md

**Files:**
- Create: `backend/src/routes/openapi.ts` (+ mount `/api/v1/openapi.json`)
- Create: `API.md`

- [ ] **Step 1: Implement openapi.json (reachable)** — handler ce intoarce OpenAPI 3.1 static (obiect JS) din `PAT_CAPABILITIES` (importat, nu duplicat): securitate `bearerAuth`, metoda corecta per ruta (ICCJ = **GET**), paginare PER ENDPOINT (vezi Step 2), campuri imbogatite (`exactMatch` doar pe numar dosar; `parti[].calitateParte`), rute tokenuri. **Reachability (fix review-panel):** monteaza ruta `/api/v1/openapi.json` INAINTE de `patCapabilityGate` (e doc de discovery; altfel gate-ul ar da 403 unui PAT care isi citeste propriul spec).

- [ ] **Step 2: Write API.md** — sectiuni:
  - Obtinere PAT (UI Setari → Acces API), folosire (`Authorization: Bearer`, **HTTPS-only in productie**).
  - Scopes (tabel). **Prerechizit scope `rnpm` (PAT-006):** necesita cheie captcha tenant configurata de admin, altfel 501 `CAPTCHA_NOT_CONFIGURED`.
  - **Paginare PER ENDPOINT (PAT-008):** ICCJ `?page=N` (1-20); RNPM `startRnpmPage` (body) → `nextRnpmPage` (raspuns); dosare/termene fara paginare. NU documenta un `page` generic.
  - **Forme de raspuns PER RUTA (PAT-002):** rutele legacy (`/api/dosare`, `/api/termene`, ICCJ) intorc `{ data, total[, page] }` la succes si `{ error: string }` (fara `code`/`requestId`) la eroare; `/api/rnpm/saved` = obiect paginat brut; doar `/api/v1/*` + token-mgmt garanteaza envelope-ul `{ data, error:{code,message}, requestId }`. Spune consumatorilor sa ramifice pe status HTTP + `Retry-After` (uniforme) si sa citeasca `error` ca `string | {code,message}`.
  - Coduri eroare: **401 `invalid_token`** (lowercase — fix PAT-003, NU `INVALID_TOKEN`), 403 `PAT_ROUTE_FORBIDDEN`/`INSUFFICIENT_SCOPE`/`PAT_CANNOT_MANAGE_TOKENS`, 429 `rate_limited`/`QUOTA_EXCEEDED`, 503 `ICCJ_UNAVAILABLE`/captcha-retry. Nota: 401 e lowercase by design (house style `AuthenticationError`), 403/429 uppercase (`ErrorCodes`) — split intentionat.
  - Exemple curl + nota: `Authorization` nu apare in loguri (logger logheaza doar method/path/status).

- [ ] **Step 3: Smoke test (T-15)** — `GET /api/v1/openapi.json` → 200, `Content-Type: application/json`, `body.openapi` incepe cu "3.", `paths` contine cel putin o ruta PAT; reachable de un PAT (montat inainte de gate).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/openapi.ts backend/src/routes/openapi.test.ts backend/src/index.ts API.md
git commit -m "docs(api): OpenAPI 3.1 spec + API.md consumer guide"
```

---

## Phase 11 — Frontend ("Acces API")

### Task 14: ApiAccessPanel in Setari

**Files:**
- Create: `frontend/src/lib/apiTokensApi.ts`
- Create: `frontend/src/components/ApiAccessPanel.tsx`
- Modify: `frontend/src/components/ApiKeyDialog.tsx` (monteaza `<ApiAccessPanel/>` langa `EmailSettingsPanel`, doar web)

**Interfaces:**
- Consumes: `apiFetch` din [frontend/src/lib/api.ts](../../../frontend/src/lib/api.ts); pattern modal/hook din [ApiKeyDialog.tsx](../../../frontend/src/components/ApiKeyDialog.tsx) + [useApiKey.ts](../../../frontend/src/hooks/useApiKey.ts).

- [ ] **Step 1: apiTokensApi** — wrapper peste `apiFetch`:
```ts
import { apiFetch } from "./api.ts";
export async function listApiTokens() { const r = await apiFetch("/api/v1/tokens"); return (await r.json()).data; }
export async function createApiToken(body: { name: string; scopes: string[]; captchaDailyCap?: number | null; expiresInDays?: 30 | 90 | 365 | null; }) {
  const r = await apiFetch("/api/v1/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json()).data; // contine secret o singura data
}
export async function revokeApiToken(id: string) { await apiFetch(`/api/v1/tokens/${id}`, { method: "DELETE" }); }
export async function revokeAllApiTokens() { await apiFetch("/api/v1/tokens/revoke-all", { method: "POST" }); }
```

- [ ] **Step 2: ApiAccessPanel.tsx** — componenta cu: lista tokenuri (nume, prefix, scopes, ultima folosire + IP), buton "Creeaza token" → modal (nume, checkbox-uri scopes, select expirare 30/90/365 sau fara, input optional plafon captcha) care la submit afiseaza secretul O SINGURA DATA cu buton copy + avertisment; buton revoke per rand; buton "Revoca toate". Urmeaza stilul `ApiKeyDialog`. **Doar in web runtime** — randeaza panel-ul doar cand `isWebRuntime()` din [api.ts](../../../frontend/src/lib/api.ts) (desktop pastreaza BYOK in modalul existent; `window.desktopApi === undefined` = web).

- [ ] **Step 3: Mount** in `frontend/src/components/ApiKeyDialog.tsx` (modalul de setari care gazduieste deja `EmailSettingsPanel`), sub sectiunea existenta de API keys, gated pe `isWebRuntime()`.

- [ ] **Step 4: Typecheck + build + Commit**

```bash
cd frontend && npx tsc --noEmit && npm run build
git add frontend/src/lib/apiTokensApi.ts frontend/src/components/ApiAccessPanel.tsx frontend/src/components/ApiKeyDialog.tsx
git commit -m "feat(ui): Acces API token management panel"
```

---

## Phase 12 — Integration & release

### Task 15: End-to-end + release chores

- [ ] **Step 1: Full check** — `npm run check` (lint + typecheck + toate testele).
- [ ] **Step 2: Desktop smoke** — `npm run build` + relansare Electron; confirma ca in desktop nimic nu s-a schimbat (PAT path inactiv: `getAuthMode()!=="web"`), cautarile dosare/ICCJ/RNPM merg ca inainte. Rebuild `better-sqlite3` pentru Electron daca ai rulat testele sub Node.
- [ ] **Step 3: Web smoke** — porneste backend web mode + oauth2-proxy; creeaza un token din UI; cu `curl -H "Authorization: Bearer ld_pat_…" https://.../api/dosare?...` confirma 200; pe `/api/ai/...` confirma 403; revoke → 401.
- [ ] **Step 4: Version bump** — urmeaza `## Checklist bump de versiune` din [CLAUDE.md](../../../CLAUDE.md) (package.json x3 + lock, changelog-entries.tsx, CHANGELOG.md, README, SECURITY.md — auth/network surface nou, etc.).
- [ ] **Step 5: Commit + PR** — biome + tsc + build + teste verde, apoi commit de release + PR.

---

## v2 — Corectii din review adversarial multi-agent (CHANGELOG, aplicate inline in v2.1)

Review adversarial cu 6 agenti specializati (database, reliability, api, tests, release; security a picat mid-stream — acoperit de review-panel ulterior) + verificare adversariala per finding. **16 HIGH confirmate.** In **v2.1 toate corectiile (HIGH + Medium + Low) au fost aplicate INLINE in task-urile lor** — sectiunea de mai jos e un changelog/cross-reference (ce s-a schimbat si in ce task), nu o lista de TODO-uri ramase. Severitati intre paranteze.

### Deja aplicate inline (rezumat)
PAT-001 (ICCJ = GET nu POST in `PAT_CAPABILITIES`); DB-001/R04/REL-EXPIRES (`strftime('%Y-%m-%dT%H:%M:%fZ','now')` pe `expires_at` + `created_at` ISO); DB-003/REL-AUDIT-SIG (`recordAudit(c, …)` in Task 10); R03 (regex distress include 403, scoate AbortError); R01/T-03 (breaker ponderat, `PAT_DISTRESS_WEIGHT=0.25`); DB-004 (index `idx_audit_log_token_use`); DB-005 (index partial captcha); DB-002/REL-DOWN-MANUAL (nota rollback manual + SQLite 3.35); REL-NO-KILLSWITCH (`LEGAL_DASHBOARD_PAT_DISABLED`); PAT-003 (fara `INVALID_TOKEN` enum, casing intentionat); T-04 (fara `fakeCtx`).

### Task 3 (auth seam)
(REL-NO-KILLSWITCH) Documenteaza `LEGAL_DASHBOARD_PAT_DISABLED=1` in `backend/.env.example` + test: token valid cu env=1 → 401; fara env → rezolva. (T-05, HIGH) Adauga test desktop zero-impact: `LEGAL_DASHBOARD_AUTH_MODE=desktop` + header `Authorization: Bearer ld_pat_anything` → `tokenId`/`tokenScopes` undefined, `ownerId==="local"`, si spy pe `findActiveTokenByHash` confirma ZERO apeluri DB.

### Task 4 (capability gate)
(T-02, CRITICAL) Test metoda read-only: `POST /api/dosare` cu scope `["dosare"]` → 403 `PAT_ROUTE_FORBIDDEN` (path matchuieste cap GET dar metoda nu); `DELETE /api/rnpm/saved/abc` cu scope `["rnpm"]` → 403. Aceste teste pica daca scoti clauza `x.method === method`. (T-09) Test scope exact: scope `["dosare"]` pe o capabilitate ce cere `"dosare_admin"` → 403 (membership exact pe set, nu substring). (PAT-005/REL-MGMT-GUARD-DEAD, MEDIUM) Gate-ul global pe `/api/*` prinde `/api/v1/tokens` inaintea guard-ului din router → emite `PAT_ROUTE_FORBIDDEN`, nu `PAT_CANNOT_MANAGE_TOKENS`. Alege o sursa unica: adauga in gate o verificare explicita `if (tokenId && path.startsWith("/api/v1/tokens")) → 403 PAT_CANNOT_MANAGE_TOKENS` INAINTE de allowlist (recomandat), si actualizeaza testul Task 10 sa ruleze cu gate-ul montat (integration).

### Task 5 (originGuard) + Task 6 (rate-limit)
(T-10, MEDIUM) Corpuri complete de test pe stack-ul real Hono (`app.request()`): (1) PAT valid cross-origin → 200; (2) JWT Bearer cross-origin → 403 (CSRF tot se aplica); (3) PAT cu hash gresit cross-origin → 401 (fara fallback pe cookie). (T-01, belt-and-suspenders) `Authorization: Bearer garbage` + cookie JWT valid → 401, cookie ignorat. (R05/REL-RATELIMIT-BYPASS, MEDIUM) `rateLimit` face early-return pe `GET /api/rnpm/saved` INAINTE de calculul per-token → un PAT scapa neplafonat. Fix: conditioneaza scutirea pe `!c.get("tokenId")`: `if (method==="GET" && path.startsWith("/api/rnpm/saved") && !c.get("tokenId")) { next(); return; }`. Test: PAT peste `TOKEN_RATE_LIMIT` pe `/api/rnpm/saved` → 429. (T-14) `beforeEach(_resetRateLimitForTest)` in testul Task 6.

### Task 8 (captcha cap)
(R02/REL-CAPTCHA-CALLSITE, clarificare) MODIFICA apelul existent `recordCaptchaUsage` din `rnpmGuards.ts:124-133` (adauga `tokenId: tokenId ?? null`) — NU adauga unul paralel; calea cu cap face early-return deci nu ajunge la el → exact un INSERT per request acceptat. (R06, MEDIUM) Inveleste `getDb().transaction(...).immediate()` in try/catch; pe eroare (ex. SQLITE_BUSY) log + fallback la record-and-accept (semantica "overcount, never undercount"), nu 500. (T-08/R08, LOW) Scoate cuvantul "atomicitate"/"concurenta" din test — better-sqlite3 e sincron, apelurile se serializeaza; test secvential (cap=2 → al 3-lea da 429) + comentariu ca atomicitatea cross-writer e data de `BEGIN IMMEDIATE` la nivel SQLite (moot sub single-instance, spec A9). (PAT-007, MEDIUM) `captchaDailyCap` max hardcodat 100k vs `tenantMax`: adauga check runtime in handler (422 daca `> tenantMax`) sau env `MAX_TOKEN_CAPTCHA_CAP`.

### Task 9 (ICCJ breaker)
(T-07, HIGH) 3 teste half-open deterministe cu `now` injectat (fara `setTimeout`): (a) single-flight — a doua chemare in half-open cat prima e in zbor → `IccjBreakerOpenError`; (b) PAT blocat in half-open cat UI primeste probe-ul; (c) probe esuat → revine OPEN. (T-03, CRITICAL) Test izolare pe clasa: deschide breaker-ul cu esecuri `pat` ponderate; o chemare `ui` la acelasi `now` NU e blocata cat timp scorul ponderat PAT n-a atins pragul (validare a schemei ponderate deja patch-uite).

### Task 10 (token routes)
(PAT-009, LOW) `DELETE /:id` pe un token deja revocat → 200 (idempotent), nu 404 `Token inexistent`: separa "negasit" de "deja revocat". (T-11) Test: `revokeToken` de 2 ori → ambele fara eroare, token ramane revocat; `revokeAllTokens` pe owner fara tokenuri → 0, fara exceptie. (T-12, IDOR, MEDIUM) Test izolare owner: alice nu poate revoca/lista tokenul lui bob (`DELETE /api/v1/tokens/:bobId` ca alice → 404), cu `ownerContext` montat (ownerId din auth, nu din param).

### Task 11 (audit + new-IP) — RESTRUCTURARE (R07/REL-ALERT-BEFORE-AUTHZ, HIGH)
NU emite audit/touch/new-IP din `ownerContext` (ruleaza inainte de capability gate → ar loga `outcome:"ok"` si ar trimite email pentru cereri ce vor fi 403, plus write-amplification + `recordAudit` neinvelit ce poate 500-ui hot-path-ul). In schimb: muta emisia DUPA ce gate-ul autorizeaza (in `patCapabilityGate` pe calea de succes dupa `await next()` cu status < 400, sau un middleware post-authz dedicat). (1) Cererile 403 → audit `outcome:"denied"`, FARA email, esantionate. (2) Inveleste `recordAudit` in try/catch + `console.error` (ca authProvider.ts:100-112 / owner.ts:59-61). (3) Esantioneaza per spec A3 (prima folosire/zi per `(token, ip)`) — nu 1 INSERT + 1 SELECT scan per request (index-ul partial `idx_audit_log_token_use` ajuta query-ul ramas). (4) Dedup email new-IP: un email per `(token, ip)` per fereastra. (T-13) Test: mailer arunca → audit-ul tot se scrie, raspunsul tot 200, fara exceptie propagata. (R09 — rezolvat) `audit_log` are coloane reale `action`/`target_id`/`ip` (vezi auditRepository.ts) → `hasPriorTokenUseFromIp` e corect; adauga test ca prinde drift de nume coloane.

### Task 12 (exactMatch)
(PAT-004, MEDIUM) `exactMatch` acopera doar `numarDosar`. Pentru piesa A: documenteaza explicit in API.md ca `exactMatch` e doar pe numar dosar; match pe nume normalizat (`stripSearchDots`) e deferat (sau implementeaza-l acum daca vrei paritate cu spec A5.6). Nu lasa campul ambiguu (mereu false pe cautari de nume).

### Task 13 (OpenAPI + API.md)
(PAT-002, MEDIUM) Documenteaza forme de raspuns PER RUTA: rutele legacy (`/api/dosare`, `/api/termene`, ICCJ search) intorc `{ data, total[, page] }` la succes si `{ error: string }` (fara `code`/`requestId`) la eroare; `/api/rnpm/saved` intoarce obiect paginat brut; doar rutele `/api/v1/*` + token-mgmt garanteaza envelope-ul `{ data, error:{code,message}, requestId }`. Spune consumatorilor sa ramifice pe status HTTP + `Retry-After` (uniforme) si sa citeasca `error` ca `string | {code,message}`. (PAT-008, MEDIUM) Paginare PER ENDPOINT, nu generic `page`: ICCJ `?page=N` (1-20); RNPM `startRnpmPage`/`nextRnpmPage`; dosare/termene fara paginare. (PAT-006, MEDIUM) Sectiune prerechizite scope `rnpm`: necesita cheie captcha tenant configurata de admin, altfel 501 `CAPTCHA_NOT_CONFIGURED`. (PAT-003) 401 = lowercase `invalid_token`; 403/429 = uppercase; noteaza ca split-ul e intentionat. (T-15) Smoke test: `GET /api/v1/openapi.json` → 200, `body.openapi` incepe cu "3.", `paths` contine cel putin o ruta PAT.

### REL-DROPPED-CONTROLS (CRITICAL) — controale A5 lipsa, faza noua
Adauga o faza/task (Phase 5.5) cu:
(1) `Cache-Control: no-store` pe raspunsurile PAT — middleware post-`patCapabilityGate` care, daca `c.get("tokenId")`, seteaza `c.header("Cache-Control","no-store")`. Test: prezent pe GET PAT, absent pe JWT/desktop.
(2) HTTPS-only PAT in productie (defense-in-depth peste oauth2-proxy TLS): daca `NODE_ENV==="production"` + `x-forwarded-proto !== "https"` + peer non-loopback → 426/400. Gate pe env ca dev/loopback sa nu fie afectat. Test prod-non-TLS reject + dev pass.
(3) Timing constant-ish 401 (test A8): `resolvePatContext` intoarce acelasi 401 generic pentru token inexistent si user inactiv — adauga test ce blocheaza comportamentul.
(4) Redactare loguri = VERIFICA + documenteaza: `logger()` (index.ts:81) logheaza doar method/path/status, nu Authorization — nota in API.md + checklist "nu dump-a request headers nicaieri".

### REL-CONDITIONAL-MOUNT (MEDIUM)
Spec A1/A8 cer mount conditional la boot, nu doar gate per-request. Monteaza `patCapabilityGate`, `apiTokensRouter` si `openapi` doar cand `getAuthMode()==="web"` (pattern-ul `MONITORING_ENABLED` din index.ts:341). Desktop nu mai expune deloc suprafata token-mgmt/OpenAPI.

### Review-panel runda 2 (2026-06-28) — aplicate + ramase

Plan v2 trecut prin review-panel multi-model (Opus 4.8 / GPT-5.5 / Kimi K2.7 / GLM-5.2 / Qwen3.7 + sinteza). Verdict: **NU gata de single-pass dispatch** din cauza "v2 drift" (snippet-uri inline vs apendice) — rezolvat de banner-ul autoritar de la inceput.

**Aplicate dupa runda 2 (inline):** banner "apendice autoritar"; `isSuspiciousPath` doar pe pathname (HIGH — altfel `%2F` din `numarDosar` da 403, rupe cazul principal) + backslash; breaker plafoneaza contributia PAT sub prag (HIGH math — PAT singur nu mai deschide); Task 11 inline marcat SUPERSEDED + `recordAudit(c,…)`; typo-uri (`cd backend` dublu, `.filter(Boolean)` pe scopes, proza Task 8).

**APLICATE INLINE IN v2.1 (toate — nu mai exista "ramase"):**
1. ✅ Timestamps ISO-Z (`touchLastUsed`/`revokeToken`/`revokeAllTokens` strftime — Task 2). 2. ✅ Nota `captcha_usage.ts` ISO-Z + test (Task 2). 3. ✅ `fail()` local clarificat (Task 6). 4. ✅ Captcha try/catch: fail-closed capped (503) / fail-open uncapped (Task 8). 5. ✅ `exactMatch` extensie + assertion campuri (Task 12). 6. ✅ `pathMatches` case+trailing-slash + test subruta necunoscuta (Task 4). 7. ✅ Schema `.strict()` + name charset (Task 10). 8. ✅ `no-store` middleware EXTERIOR gate-ului, header pe `c.res` (Task 7.5). 9. ✅ HTTPS-only `x-forwarded-proto` in prod, fara bypass loopback (Task 7.5). 10. ✅ Docs `invalid_token` lowercase + paginare per-endpoint + forme per-ruta (Task 13). 11. ✅ `iccjRunner` in Modify + `callerClass:"monitoring"` (Task 9 / File Structure). 12. ✅ Retentie audit acoperita de `purgeOldAuditLog(90)` existent — documentat (Task 11 + Self-Review). 13. ✅ `notifyTokenNewIp` task dedicat + dedup (Task 11). 14. ✅ Teste T-02…T-15 ca pasi in task-urile lor (Task 4/6/8/9/10/11/12/13/7.6).

**Lows aplicate:** ✅ `requireScope` STERS (dead code, Task 4); ✅ dedup email new-IP (Task 11); ✅ half-open non-distres → close (Task 9); ✅ openapi montat inainte de gate (Task 13/7.6); ✅ comentariu cooldown corectat (Task 9); ✅ host frontend real `ApiKeyDialog.tsx` + `isWebRuntime()` (Task 14); ✅ nota spec ICCJ GET (spec A4). **Blind spots:** ✅ kill switch per-request + test (Task 7.6); ✅ cap array `failures` (Task 9).

**Verdict:** toate findings-urile din ambele runde sunt acum INLINE in task-uri. Nu mai exista "v2 drift" — un implementator care urmeaza checkbox-urile obtine varianta corecta. Banner-ul autoritar ramane ca centura de siguranta.

## Self-Review

> **Nota onestitate (fix REL-DROPPED-CONTROLS):** prima versiune a planului afirma fals acoperire completa A5/A8. Real: controalele no-store / HTTPS-only / timing-401 NU erau in task-uri (acum in apendicele v2, faza 5.5); A8 are goluri de teste enumerate in apendice (T-02/03/05/07/09/10/11/12/13/15). Codul critic e complet DOAR dupa aplicarea apendicelui v2.

**Spec coverage:** A1 (scop, desktop zero-impact) → Task 3/15. A2 (model token + audit) → Task 1/2/11. A3 (cusatura auth, fara cache pozitiv, 401/403 contract) → Task 3/4. A4 (scope + metoda read-only) → Task 4. A5.0 (default-deny segment) → Task 4. A5.1 (originGuard Bearer) → Task 5. A5.2 (rate-limit per-token) → Task 6. A5.3 (captcha cap atomic) → Task 8. A5.4 (ICCJ breaker per-clasa) → Task 9. A5.5 (page-size cap) → Task 7. A5.6 (load-more + exactMatch + calitate) → Task 12 (+ nota: auto-continuare = piesa B). A6 (rute + UI + revoke-all + new-IP) → Task 10/11/14. A7 (OpenAPI + API.md) → Task 13. A8 (teste) → distribuite per task. A9 (out of scope) — respectat (export exclus, fara store partajat multi-instanta, fara re-auth).

**Divergente fata de spec (de validat la review):** (1) audit-ul reuseste `audit_log`/`recordAudit` in loc de o tabela noua `api_token_audit_events` (DRY; detectia IP nou via query pe `audit_log`; retentia de 90 zile e acoperita de `purgeOldAuditLog` existent care purja TOT `audit_log`, deci nu se pierde). (2) `requireScope` per-router a fost ELIMINAT (dead code) — `PAT_CAPABILITIES` + gate-ul global sunt sursa unica.

**Placeholder scan:** fara TBD/„add error handling”; codul critic e complet. Partile frontend/OpenAPI dau structura + cod cheie + pattern citat (nu placeholder).

**Type consistency:** `tokenScopes: string[]` / `tokenId: string` consistente intre `AuthenticatedContext`, `ContextVariableMap`, gate, rate-limit, rnpmGuards. `ApiTokenRow` consistent intre repository si consumatori. `IccjCaller` consistent intre breaker si client.

---

## Execution Handoff

(Se completeaza dupa review-ul adversarial + review-panel.)
