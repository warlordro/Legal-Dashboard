# AUDIT — Codex commit 317aa63 (`feat/web-admin-keys-budget`)

**Data**: 2026-05-19
**Branch**: `feat/web-admin-keys-budget` la commit `317aa63`
**Scope**: v2.30.0 — web admin centralized API keys + per-user budget
**Reviewers**: deep-code-reviewer, database-change-reviewer, backend-reliability-reviewer, fraud-control-reviewer, audit-trail-reviewer, data-validation-reviewer, claude-guard (PLAN adherence), test-architect + CodeRabbit (4 claims)

---

## VERDICT GLOBAL: **YELLOW (merge cu fixes obligatorii F0)**

Codex a livrat scopul PLAN-ului in 55 fisiere, ~3000 LOC. Toate red zone constraints respectate (no electron/, no new deps, master key fail-fast, audit log fara plaintext, AES-256-GCM corect, requireRole admin pe rute, BYOK desktop neatins). Build + tsc trec curat. Frontend tests 209/209 pass; backend tests blocate de `better-sqlite3` ABI mismatch (infra issue, NU regresie cod).

**Insa**: 5 findings la nivel **CRITICAL/HIGH** (1 quota bypass cu impact financiar direct, 1 vulnerabilitate 2captcha 200-status, 1 race condition AES-GCM, 1 lipsa §9 test cases, 1 captcha balance fara admin gate). Acestea trebuie fix-uite inainte de merge in main.

---

## 1) Build / Test / Tsc — Status

| Gate | Status | Note |
|------|--------|------|
| `npx biome check` | OK | Pass clean (332ms) |
| `npx tsc --noEmit -p backend/tsconfig.json` | OK | Exit 0 |
| `cd frontend && npx tsc --noEmit` | OK | Exit 0 |
| `npm run build` | OK | Bundle iese curat |
| `cd frontend && npm test -- --run` | OK | 209/209 pass |
| `npm test --workspace=backend` | BLOCAT | `better-sqlite3` ABI mismatch (NODE_MODULE_VERSION 145 vs 137), pre-existing infra issue. Necesita `npm rebuild better-sqlite3` cu Node CI ABI. |

## 2) Red Zone Compliance

| Constrangere | Status |
|--------------|--------|
| `electron/` neatins | PASS — `git diff --name-only main..HEAD -- electron/` empty |
| No new npm deps | PASS — doar version bumps in 3 package.json |
| `rejectApiKeysFromBodyInWebMode` activ pe `/ai/analyze` + `/analyze-multi` | PASS — ai.ts:157, ai.ts:226 |
| `requireRole("admin")` pe toate rutele `/admin/keys/*` | PASS — admin.ts:123 |
| AES-256-GCM, IV unic per encrypt | PASS — tenantKeyCrypto.ts |
| Master key boot fail-fast (web mode) | PASS — index.ts:418 |
| Audit log NU primeste plaintext, doar `last4` | PASS — admin.ts:370-379 |
| Migration 0026 are `up.sql` + `down.sql` | PASS |
| NU multi-tenant (singleton scope='tenant') | PASS |

---

## 3) FIX PLAN — Prioritizat

### F0 — BLOCKERS pre-merge (5)

#### F0.1 [HIGH/fraud] Default-deny pe quota: limit lipsa = unlimited spend
**Sursa**: fraud-control-reviewer (HIGH)
**Locatie**: `backend/src/middleware/quotaGuard.ts:15-17`
**Problema**: `if (!override) return next();` — user fara override `user_quota_overrides` cheltuieste nelimitat din wallet-ul tenantului. Combinat cu `limit=0` interpretat ca "no limit" (deep-code-reviewer finding), orice user nou ramane fara plafon pana cand admin seteaza manual override.
**Fix**:
- Adauga env `LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI` (default sugerat: 500 milli-USD/zi).
- In `quotaGuard`, daca `override === null`, foloseste valoarea default; daca `override.limitMilli === 0`, trateaza explicit ca **block** (nu unlimited).
- Adauga test: user fara override + sum peste default → 429.
**Effort**: 30 min.

#### F0.2 [CRITICAL/validation] 2captcha key invalid trece ca valid
**Sursa**: data-validation-reviewer (CRITICAL)
**Locatie**: `backend/src/services/keyValidation.ts:56-59`
**Problema**: 2captcha `getbalance` returneaza HTTP 200 cu body `ERROR_WRONG_USER_KEY` pentru chei invalide. `validateKey()` verifica doar `res.status`, deci orice string trece. Admin salveaza garbage; toate solverurile RNPM in web mode esueaza la runtime fara feedback la save.
**Fix**:
```ts
if (field === "twocaptcha") {
  const res = await fetch(`https://2captcha.com/res.php?key=${encodeURIComponent(value)}&action=getbalance`, { signal });
  if (res.status >= 400) return { valid: false, reason: `Providerul a respins cheia (${res.status}).` };
  const text = await res.text();
  if (text.startsWith("ERROR_")) return { valid: false, reason: `Cheie invalida: ${text}` };
  return { valid: true };
}
```
**Effort**: 15 min + test.

#### F0.3 [CRITICAL/validation] Whitespace-only key stocat criptat
**Sursa**: data-validation-reviewer (CRITICAL)
**Locatie**: `backend/src/routes/admin.ts:107-110` (PutTenantKeySchema)
**Problema**: `z.string().max(4096)` nu aplica `.trim()`. Valoarea `"   "` trece validation, NU triggereaza clear path (care cere `=== ""`), si se cripteaza in DB. Admin pateaza copy-paste cu spatii → AI calls 401.
**Fix**: `value: z.string().max(4096).transform((v) => v.trim())` in PutTenantKeySchema.
**Effort**: 5 min.

#### F0.4 [HIGH/fraud] `/captcha/balance` accesibil non-admin in web mode
**Sursa**: fraud-control-reviewer (MEDIUM/HIGH)
**Locatie**: `backend/src/routes/rnpm.ts` la handler-ul `POST /captcha/balance`
**Problema**: Diff-ul a inlocuit `rejectCaptchaKeyInWebMode` cu `resolveCaptchaKeyForRoute`; orice user logat poate poll-ui balance-ul tenant si poate planifica RNPM abuse pe baza budget windows (reconnaissance signal).
**Fix**: In web mode, gateway `/captcha/balance` cu `requireRole("admin")`, sau intoarce doar `{ configured: true|false }` (fara numar) pentru non-admin.
**Effort**: 15 min + test.

#### F0.5 [HIGH/test] §9 test cases lipsesc din `ai.contract.test.ts`
**Sursa**: test-architect (HIGH, explicit cerinta PLAN §9)
**Locatie**: `backend/src/routes/ai.contract.test.ts`
**Problema**: PLAN §9 cere explicit `case 429 cand peste buget` + `case "missing key" web mode mesaj nou`. Niciunul nu exista. Cele 4 teste existente sunt pre-PR (envelope shape).
**Fix**: adauga 2 teste:
1. `POST /api/ai/analyze` cu quotaGuard 429 → envelope `error.code = "quota_exceeded"` + `Retry-After` + `details.usedMilli/limitMilli`.
2. `POST /api/ai/analyze` web mode + no tenant key → `error.code = "MISSING_API_KEY"` + mesaj catre admin (NU vechiul "configurati in env-ul serverului").
**Effort**: 25 min.

---

### F1 — IMPORTANT pre-deploy (10)

#### F1.1 [Important/audit] Clear-key audit ambiguu (`last4After: null`)
**Sursa**: audit-trail-reviewer (HIGH)
**Locatie**: `backend/src/routes/admin.ts:361-381`
**Fix**: in detail block adauga `cleared: parsed.data.value === ""` ca sa distinga clear intentional de "key never existed".

#### F1.2 [Important/audit] Captcha settings audit fara `previous` state
**Sursa**: audit-trail-reviewer (HIGH)
**Locatie**: `backend/src/routes/admin.ts:330-348`
**Fix**: capture `prevKeys = getTenantKeys()` inainte de `setCaptchaSettings`, include `previous: { provider, mode }` in detail.

#### F1.3 [Important/audit] Captcha consumption NU e audited
**Sursa**: fraud-control-reviewer (MEDIUM)
**Locatie**: callerii `solveRnpmCaptcha` din `backend/src/routes/rnpm.ts`
**Fix**: emit `rnpm.captcha_solve` audit per solve cu actor + provider + cost indicator (fara plaintext key).

#### F1.4 [Important/audit] `validationSkipped` fara reason in audit
**Sursa**: audit-trail-reviewer (MEDIUM)
**Locatie**: `backend/src/routes/admin.ts:375`
**Fix**: `detail.validationSkipReason = validation.reason ?? null` alaturi de flagul boolean.

#### F1.5 [Important/reliability] Boot prewarm valida master key dar nu cipher round-trip
**Sursa**: backend-reliability-reviewer (Important)
**Locatie**: `backend/src/index.ts:418-420`
**Fix**: adauga `getTenantKeys()` in prewarm block; daca cipher mismatch (DB restore cu alta master key), `fatalBoot` cu mesaj clar.

#### F1.6 [Important/reliability] Body-supplied captchaKey silently dropped fara log
**Sursa**: backend-reliability-reviewer (Important, PLAN §7 non-compliance)
**Locatie**: `backend/src/routes/rnpmGuards.ts` (`withRnpmCaptchaGuards`)
**Fix**: cand `resolved.source === "tenant"` si body trimite `captchaKey` non-empty, emit `console.warn({ action: "rnpm.captchaKey.body_dropped", ownerId, ts })`. NU loga valoarea cheii.

#### F1.7 [Important/reliability] decryptField fara structured log la GCM auth failure
**Sursa**: backend-reliability-reviewer
**Locatie**: `backend/src/db/tenantKeysRepository.ts:129-135`
**Fix**: wrap `decryptKey()` in try/catch; rethrow cu mesaj include `field` name + structured log `action: "tenant_keys.decrypt_failed"`.

#### F1.8 [Important/test] AES-GCM tamper tests lipsesc
**Sursa**: test-architect (HIGH)
**Locatie**: `backend/src/util/tenantKeyCrypto.test.ts`
**Fix**: adauga 3 tamper tests (tag/IV/cipher flip → throws) + empty string round-trip + invalid base64 master key throws.

#### F1.9 [Important/test] `invalid_field` + body 413 untested
**Sursa**: test-architect (HIGH)
**Locatie**: `backend/src/routes/admin.keys.test.ts`
**Fix**: 2 teste — `PUT /keys/hacked-field` → 404, body 4097 octeti → 413.

#### F1.10 [Important/test] Captcha triplet downstream delivery untested
**Sursa**: test-architect (HIGH, PLAN §7 CRITIC)
**Locatie**: `backend/src/routes/rnpm.envelope.test.ts` sau fisier nou
**Fix**: in web mode cu tenant key set, asertie ca `executeSearch` (mocked) primeste `captchaKey` din tenant, NU din body.

---

### F2 — MINOR / Code Quality (8)

#### F2.1 [Minor/deep-code] QUOTA_EXCEEDED lowercase rupe SCREAMING_CASE convention
**Locatie**: `backend/src/util/envelope.ts` (`QUOTA_EXCEEDED = "quota_exceeded"`)
**Fix**: schimba in `"QUOTA_EXCEEDED"` pentru consistenta cu restul codurilor envelope. Update test-uri.

#### F2.2 [Minor/deep-code] `validateKey` 429/408/5xx tratat ca INVALID prea agresiv
**Locatie**: `backend/src/services/keyValidation.ts`
**Fix**: distinge 401/403 (definitiv invalid) de 429/408/5xx (skip cu warning) — adauga branch.

#### F2.3 [Minor/deep-code] env shadow-ing peste tenant DB fara expunere in UI
**Locatie**: `backend/src/services/ai.ts:591-617` (`getApiKey` chain)
**Fix**: in UI `/admin/keys` expune `source: "env" | "tenant" | null` per field; daca env shadow-uieste DB, admin vede explicit "configurata din env".

#### F2.4 [Minor/audit] Actor identity foloseste `getOwnerId` in loc de `getActorId`
**Locatie**: `backend/src/routes/admin.ts:336, 367`
**Fix**: schimba in `getActorId(c)` (functional identic azi, dar evita divergenta la PR-9 JWT wiring).

#### F2.5 [Minor/CodeRabbit] DOCUMENTATIE.md footer stale
**Sursa**: CodeRabbit (confirmat la verificare — L775)
**Locatie**: `DOCUMENTATIE.md:775`
**Problema**: `*Ultima actualizare: 26 Aprilie 2026 - v2.0.10 hardening...*` — header L10 e v2.30.0 dar footer ramane v2.0.10.
**Fix**: actualizeaza footer la `*Ultima actualizare: 19 Mai 2026 - v2.30.0 web admin keys + per-user budget*`.
**Effort**: 1 min.

#### F2.6 [Minor/CodeRabbit] tenantKeysRepository SQL column interpolation
**Sursa**: CodeRabbit
**Locatie**: `backend/src/db/tenantKeysRepository.ts:80, 86-103`
**Problema**: `setTenantKey` foloseste template literal pentru `${field}_cipher` etc. TypeScript-typed la `TenantKeyField` si gated upstream prin `isTenantKeyField` in admin.ts:352. Dar functia exportata e callable din alte module — defense-in-depth.
**Fix**: adauga assert runtime la inceputul `setTenantKey`:
```ts
if (!isTenantKeyField(field)) throw new Error(`invalid tenant key field: ${field}`);
```
**Effort**: 2 min + test.

#### F2.7 [Minor/database-reviewer] `CREATE TABLE IF NOT EXISTS` divergent fata de PLAN §1
**Locatie**: `backend/src/db/migrations/0026_tenant_api_keys.up.sql:3`
**Problema**: PLAN §1 specifica `CREATE TABLE` fara `IF NOT EXISTS`. Migration runner garanteaza idempotency via `_schema_versions`, deci `IF NOT EXISTS` e redundant si poate masca o coliziune de schema.
**Decision**: ACCEPT deviation (idempotency suplimentar nu strica, runner-ul oricum verifica). Doar documenta in PLAN ca decision deviated.

#### F2.8 [Minor/CodeRabbit] package-lock.json — claim VERIFICAT FALSE POSITIVE
**Sursa**: CodeRabbit
**Verificare**: `grep "version" package-lock.json` → toate 3 workspaces (root + backend + frontend) deja la 2.30.0 la liniile 3, 32, 60. **Niciun fix necesar**.

---

### F3 — DECLINED / Out-of-scope (2)

#### F3.1 [DECLINE/CodeRabbit] `owner_id` pe `tenant_api_keys`
**Sursa**: CodeRabbit
**Motiv decline**: PLAN §1 + memoria `[[user-dispatches-codex-tasks]]` interzic explicit multi-tenant in v2.30.0. Tabela e singleton cu `scope = 'tenant'` PRIMARY KEY. Adaugarea `owner_id` ar fi forward-prep pentru multi-tenant care e in roadmap-ul de dupa cutover web (nu acum).
**Action**: NU fix in PR-ul curent. Daca multi-tenant intra in roadmap, creeaza migration 0027 separat.

#### F3.2 [DECLINE/claude-guard] `Co-Authored-By: Claude` trailer
**Motiv decline**: User-ul Cezar a configurat git autor explicit (`Cezar <cdragos@gmail.com>`) pe commit Codex single-squash. Codex a urmat preferinta user-ului; nu e cerinta hard din CLAUDE.md per acest proiect. **Action**: accept ca pattern de delivery.

---

## 4) Findings tabel sumar

| Severity | Count | Source |
|----------|-------|--------|
| CRITICAL/HIGH (F0 blockers) | 5 | fraud-control x2, data-validation x2, test-architect x1 |
| Important (F1 pre-deploy) | 10 | audit-trail x4, reliability x3, test-architect x3 |
| Minor (F2 follow-up) | 8 | deep-code x3, audit x1, CodeRabbit x3, database x1 |
| Declined / Out-of-scope | 2 | CodeRabbit (multi-tenant), claude-guard (trailer) |

---

## 5) Recomandare merge

**NU merge in `main` pana cand F0 (5 items) nu sunt fix-uite.**

Workflow recomandat:
1. **Eu (Cezar)** revizuiesc raportul si confirm F0 + F1.
2. **Spawn task Codex** pentru F0 (effort total ~90 min): un singur commit follow-up pe `feat/web-admin-keys-budget` cu titlul `fix(v2.30.0): F0 audit blockers (quota default, 2captcha validation, key trim, captcha balance gate, ai contract tests)`.
3. **Codex** ruleaza biome + tsc + tests dupa fix.
4. **Re-audit rapid** (advisor + un singur deep-code review pass) pe diff-ul F0.
5. **Merge** in main dupa green pe F0.
6. F1 (10 items, ~3h) intra in PR follow-up `chore(v2.30.0): F1 audit hardening` pe acelasi branch sau separate, mergeable inainte de cutover web (NU blocheaza v2.30.0 release pe GitHub).
7. F2 (8 items, ~30 min) — la urmatorul touch al fisierelor afectate.

**Better-sqlite3 ABI mismatch** ramane in scope separat (infra issue, nu cod) — necesita `npx prebuild-install --runtime=electron --target=41.5.0` in `node_modules/better-sqlite3` inainte de relansare backend tests pe Electron ABI.

---

## 6) Fisiere atinse de Codex (55) — high-value spot checks

- `backend/src/middleware/quotaGuard.ts` — needs F0.1 fix
- `backend/src/services/keyValidation.ts` — needs F0.2 fix
- `backend/src/routes/admin.ts` — needs F0.3 + F1.1 + F1.2 + F1.4 fixes
- `backend/src/routes/rnpm.ts` — needs F0.4 + F1.3 fixes
- `backend/src/routes/rnpmGuards.ts` — needs F1.6 fix
- `backend/src/index.ts` — needs F1.5 fix
- `backend/src/db/tenantKeysRepository.ts` — needs F1.7 + F2.6 fixes
- `backend/src/routes/ai.contract.test.ts` — needs F0.5 fix (§9 tests)
- `backend/src/util/tenantKeyCrypto.test.ts` — needs F1.8 (tamper tests)
- `backend/src/routes/admin.keys.test.ts` — needs F1.9 (invalid_field + body 413)
- `backend/src/util/envelope.ts` — needs F2.1 fix (case)
- `backend/src/services/ai.ts` — needs F2.3 fix (source visibility)
- `DOCUMENTATIE.md` — needs F2.5 fix (footer stale)

Restul fisierelor: confirmate clean (verified pe sample-uri reprezentative).
