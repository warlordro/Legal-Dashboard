# Review post-implementare v2.33.0 Security Hardening

**Data**: 2026-05-19
**Branch revizuit**: `feat/v2.33.0-security-hardening`
**Commit principal**: `bbec5fa feat(security): v2.33.0 hardening`
**Scope verdict**: 18 findings cu plan + 4 BLOCKER-uri overlay + cross-check web launch surface
**Verdict global**: **CONDITIONAL** — 2 fixes obligatorii inainte de web launch GO; restul = cleanup follow-up.

---

## 0) Metodologie

Verificarea a folosit:
- 4 review agents specializati paraleli: `backend-reliability-reviewer` (Quota+Budget), `release-readiness-reviewer` (Deployment+Topology), `data-validation-reviewer` (Validation+IO), `audit-trail-reviewer` (Audit Trail).
- 1 `codex:codex-rescue` outside-the-loop confirmation.
- Citiri directe de cod pe conflicte de verdict.
- `npx tsc --noEmit -p backend/tsconfig.json` (PASS, exit 0).
- `npm test --workspace=backend` (1295 passed, 1 skipped, 0 failed).
- `npx biome check` pe cele 31 fisiere sursa modificate (PASS).

Conflicte rezolvate prin citire directa:
- **CRITICAL-1** — Codex live a flagat doua probleme: (a) CHECK constraint fara `'failed'`, (b) `aiUsage.ts:174` direct insert path. Verificat in cod: tipul `AiUsageRow.status` e `'pending' | 'confirmed'` ([aiUsageRepository.ts:20](backend/src/db/aiUsageRepository.ts#L20)) si nu exista nicio scriere cu `'failed'` (failure-ul foloseste DELETE via `releaseAiUsageReservation` sau UPDATE catre `'confirmed'` cu cost real partial). Path-ul direct `insertAiUsage` ([aiUsage.ts:174](backend/src/services/aiUsage.ts#L174)) e calea desktop (`reservationId === null`). Critica Codex aici e incorecta. Verdict: PASS.
- **HIGH-1** — Codex live a flagat ca `reader.cancel()` nu aboarta upstream fetch. Per Web Streams spec si implementarea undici/Node 22 fetch, `cancel()` propaga catre underlying source si elibereaza socket-ul. Verdict: PASS (cu o nota pe fallback path `!response.body`).
- **HIGH-2** — Release-readiness reviewer a flagat un "retry indefinit" pe race-loser. Verificat in cod: cand B intra in catch EEXIST, B fie vede A's heartbeat fresh (throw "Alt proces detine"), fie face renameSync care esueaza ENOENT (throw uncaught), fie ajunge la `writeNewLock` care esueaza EEXIST (throw uncaught). Niciun loop. Race-loser refuza boot via crash. Verdict: PASS (fail-fast functional).

---

## 1) Executive summary — verdict per finding

| # | Finding | Severitate | Verdict | File:line evidenta |
|---|---------|------------|---------|-------------------|
| CRITICAL-1 | Quota race | CRITICAL | **PASS** | [quotaGuard.ts:118-179](backend/src/middleware/quotaGuard.ts#L118-L179), [aiUsageRepository.ts:96-185](backend/src/db/aiUsageRepository.ts#L96-L185) |
| HIGH-1 | SOAP stream cap | HIGH | **PASS** (minor) | [streamCap.ts:21-51](backend/src/util/streamCap.ts#L21-L51), [soap.ts:98-118](backend/src/soap.ts#L98-L118) |
| HIGH-2 | Instance lock atomic | HIGH | **PASS** | [instanceLock.ts:53,113,151](backend/src/db/instanceLock.ts#L53), [index.ts:434-435](backend/src/index.ts#L434-L435) |
| HIGH-3 | Rate-limit proxy resolution | HIGH | **NEEDS-FIX** | [proxyIp.ts:36-41](backend/src/util/proxyIp.ts#L36-L41) — leftmost `.find()` in loc de right-to-left skip-trusted |
| HIGH-4 | SMTP retry budget | HIGH | **PASS** (minor) | [budgetNotificationsRepository.ts:157-200](backend/src/db/budgetNotificationsRepository.ts#L157-L200), [index.ts:546-563,661-663](backend/src/index.ts#L546-L563) |
| HIGH-5 | `system.boot` audit | HIGH | **PASS** (minor) | [index.ts:454-463](backend/src/index.ts#L454-L463) |
| MEDIUM-1 | Feature enum whitelist | MEDIUM | **PASS** (minor) | [quotaGuard.ts:23](backend/src/middleware/quotaGuard.ts#L23), [admin.ts:113,130](backend/src/routes/admin.ts#L113) |
| MEDIUM-2 | RNPM validation gate | MEDIUM | **NEEDS-FIX** | Lipseste warn boot + audit `rnpm.validation.disabled` |
| MEDIUM-3 | LIMIT pe listari grant/override | MEDIUM | **PASS** | [userQuotaGrantsRepository.ts:56-63](backend/src/db/userQuotaGrantsRepository.ts#L56-L63), [userQuotaRepository.ts:52-59](backend/src/db/userQuotaRepository.ts#L52-L59) |
| MEDIUM-4 | Google API header | MEDIUM | **PASS** | [keyValidation.ts:90](backend/src/services/keyValidation.ts#L90) — `x-goog-api-key` |
| MEDIUM-5 | Caddy strip header | MEDIUM | **PASS** (FIX 8 lipseste) | [Caddyfile:26-29](deploy/Caddyfile#L26-L29) |
| MEDIUM-6 | SMTP error sanitize | MEDIUM | **PASS** | [auditSanitize.ts:1-23](backend/src/util/auditSanitize.ts), [alertEmailDispatcher.ts:100](backend/src/services/email/alertEmailDispatcher.ts#L100) |
| MEDIUM-7 | `auth.logout` audit | MEDIUM | **PASS** (minor) | [auth.ts:49-91](backend/src/routes/auth.ts#L49-L91), [auditRepository.ts:19-21](backend/src/db/auditRepository.ts#L19-L21) |
| MEDIUM-8 | Warning cooldown | MEDIUM | **PASS** | [budgetWarningService.ts:134-138](backend/src/services/budgetWarningService.ts#L134-L138) |
| MEDIUM-9 | Grant expires cap (365d) | MEDIUM | **PASS** | [admin.ts:140](backend/src/routes/admin.ts#L140) — Zod `.refine()` |
| MEDIUM-10 | Docker digest pin | MEDIUM | **PASS** | [docker-compose.prod.yml:19,38](deploy/docker-compose.prod.yml#L19), [infra/docker-digests.md](infra/docker-digests.md) |
| MEDIUM-11 | ECB FX plausibility | MEDIUM | **PASS** | [fxFetcher.ts:83-85](backend/src/services/fxFetcher.ts#L83-L85) |
| LOW-1 | Grant reason truncate | LOW | **PASS** (200 chars) | [admin.ts:603,640](backend/src/routes/admin.ts#L603), [auditSanitize.ts:5-10](backend/src/util/auditSanitize.ts#L5-L10) |
| LOW-2 | `audit.viewed` audit | LOW | **PASS** (minor) | [admin.ts:326-342,666-668](backend/src/routes/admin.ts#L326-L342) |
| LOW-3 | `budget.warning.fired` audit | LOW | **PASS** | [budgetWarningService.ts:119-130](backend/src/services/budgetWarningService.ts#L119-L130) |

### BLOCKER overlay (REMEDIATION.md)

| BLOCKER | Verdict | Evidenta |
|---------|---------|----------|
| BLOCKER-1 — `provider` real (nu `'unknown'`) | **PASS** | `AiUsageProvider` union la [aiUsageRepository.ts:3](backend/src/db/aiUsageRepository.ts#L3); call sites `quotaGuard.ts:147-149` + `ai.ts:184-186,283` trec provider real |
| BLOCKER-2 — `openSync wx` + `renameSync` atomic, `STALE_FACTOR=6` | **PASS** | [instanceLock.ts:18,53,113,120](backend/src/db/instanceLock.ts) + flush deferred dupa `getDb()` la [index.ts:434-435](backend/src/index.ts#L434-L435) |
| BLOCKER-3 — `metadata:` -> `detail:` in audit calls | **PASS** | Grep `metadata:` in `recordAudit(` = 0 ocurente in `backend/src/` |
| BLOCKER-4 — `auth.logout` ownerId/actorId override | **PASS** (cu nota) | [auth.ts:71-82](backend/src/routes/auth.ts#L71-L82); `AuditOptions.ownerId` + `.actorId` overrides la [auditRepository.ts:19-21](backend/src/db/auditRepository.ts#L19-L21). Nota: foloseste `verifyAuthToken` (full verify) in loc de `decodeJwtPayload`, deci expired-but-recent JWT logout produce `auditOwnerId=null` (defensible) |

---

## 2) Critical failures (❌)

Niciunul.

---

## 3) NEEDS-FIX obligatorii inainte de web launch GO (⚠️)

### NEEDS-FIX #1 — HIGH-3 rate-limit XFF walk

**Locatie**: [backend/src/util/proxyIp.ts:36-41](backend/src/util/proxyIp.ts#L36-L41)

**Problema**: Implementarea ia **primul** entry valid din `X-Forwarded-For` via `.find(...)`. Plan + standard practice cer parcurgerea **dreapta-stanga**, sarind peste trusted proxy CIDRs, oprindu-se la prima IP non-trusted (clientul real).

**De ce conteaza**: In topologia actuala Caddy seteaza XFF doar la `{remote}` (un singur element), deci leftmost == rightmost si bug-ul nu se manifesta. Insa:
- Orice schimbare in Caddyfile la `header_up X-Forwarded-For {>X-Forwarded-For},{remote}` (append in loc de overwrite) face rate-limiter-ul trivial spoofable.
- Daca tenancy adauga un CDN/WAF in fata (Cloudflare, Fastly), header-ul se prepend-eaza si attacker-ul controleaza leftmost.
- Behavior-ul actual e safe by coincidence, nu by design.

**Fix necesar**: in `proxyIp.ts:30-42` inlocuiti `.find(...)` cu walk dreapta-stanga sarind peste trusted CIDRs:

```typescript
export function readClientIp(c: Context): string | null {
  const peer = getConnInfo(c).remote.address ?? null;
  if (!peer) return null;
  const cidrs = trustedCidrs();
  if (cidrs.length === 0 || !cidrs.some((cidr) => cidrContains(cidr, peer))) {
    return peer;
  }
  const forwarded = c.req.header("x-forwarded-for")?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  for (let i = forwarded.length - 1; i >= 0; i--) {
    const candidate = forwarded[i];
    if (net.isIP(candidate) === 0) continue;
    if (cidrs.some((cidr) => cidrContains(cidr, candidate))) continue;
    return candidate;
  }
  return peer;
}
```

**Severitate**: HIGH (per plan) — confirmat de 2 revieweri independenti (release-readiness + codex live).

---

### NEEDS-FIX #2 — MEDIUM-2 RNPM `rnpm.validation.disabled` boot warning + audit

**Locatie**: [backend/src/index.ts](backend/src/index.ts) (lipseste in totalitate) + [backend/src/services/rnpmClient.ts:278](backend/src/services/rnpmClient.ts#L278)

**Problema**: Plan section MEDIUM-2 cere ca la boot, daca `process.env.RNPM_RUNTIME_VALIDATION_DISABLED === "1"`, sa fie emise:
1. `console.warn` structurat (operator observabil in logs).
2. `recordAudit(null, "rnpm.validation.disabled", { detail: { ... } })`.

Niciuna nu exista in branch. Grep `rnpm.validation.disabled` returneaza 0 hits in `backend/src/`. Singura logica e gardul la `rnpmClient.ts:278` (`if (process.env.RNPM_RUNTIME_VALIDATION_DISABLED === "1") return raw`).

**De ce conteaza**: Operator-ul care flipeaza flag-ul in productie pentru un debug pleaca silent — niciun semnal ca validarea schema-ului RNPM e off pentru toate request-urile. Defeats audit trail purpose for compliance.

**Fix necesar**: in `backend/src/index.ts`, dupa `getDb()` init si inainte de `serve()`:

```typescript
if (process.env.RNPM_RUNTIME_VALIDATION_DISABLED === "1") {
  console.warn(JSON.stringify({
    action: "rnpm.validation.disabled.boot",
    note: "RNPM runtime validation OFF (fail-open) pentru toate request-urile",
    ts: new Date().toISOString(),
  }));
  recordAudit(null, "rnpm.validation.disabled", {
    ownerId: null,
    actorId: "system",
    detail: { source: "env", flag: "RNPM_RUNTIME_VALIDATION_DISABLED" },
  });
}
```

**Severitate**: MEDIUM. Plan obligatoriu.

---

## 4) NEEDS-FIX urgent dar non-blocking pentru web launch (⚠️)

Recomandare: deschide un PR `chore/v2.33.1-followup` imediat dupa v2.33.0 merge.

### NEEDS-FIX #3 — Orphan reservation purge gating

**Locatie**: [backend/src/services/monitoring/scheduler.ts:383](backend/src/services/monitoring/scheduler.ts#L383)

**Problema**: `purgeExpiredReservations()` e apelat exclusiv din scheduler-ul de monitoring. Daca deploy-ul ruleaza cu `MONITORING_ENABLED=0` (sau cu kill switch via `MONITORING_DISABLED_KINDS`), rezervarile orfane (din SDK crashes, microtask errors) acumuleaza si umfla `sumAiUsageMilliInWindow` — clientii valizi primesc 429 cu cota reala inca disponibila.

**Fix**: in `backend/src/index.ts`, alaturi de blocul `budgetWarningRetryInterval` (linii 546-563), gateaza pe `getAuthMode() === "web"`:

```typescript
if (getAuthMode() === "web") {
  const reservationPurgeInterval = setInterval(() => {
    try {
      purgeExpiredReservations();
    } catch (e) {
      console.warn(JSON.stringify({ action: "reservation_purge_failed", error: e instanceof Error ? e.message : String(e) }));
    }
  }, 24 * 60 * 60 * 1000);
  reservationPurgeInterval.unref?.();
}
```

### NEEDS-FIX #4 — HIGH-4 SMTP retry fara jitter

**Locatie**: [backend/src/db/budgetNotificationsRepository.ts:157,186-193](backend/src/db/budgetNotificationsRepository.ts#L157)

**Problema**: `EMAIL_RETRY_BACKOFF_SECONDS = [60, 300, 900, 3600]` deterministic. Cand mai multi useri ating 80% simultan (period roll), timer-ele retry trigger absolute identic — thundering herd pe relay SMTP partajat poate cauza connection-rejected / temporary blacklist.

**Fix**: jitter deterministic per-user pe backoff (hash userId + attempt, modul N%) injectat in comparatia `selectPendingEmailRetries`.

### NEEDS-FIX #5 — Single-agent `/analyze` reservation leak

**Locatie**: [backend/src/routes/ai.ts:193-221](backend/src/routes/ai.ts#L193-L221)

**Problema**: intre `reserveQuotaBudget` (line 193) si `callModel` (line 206), `buildPrompt(dosar)` ruleaza sincron. Daca throw → outer catch (line 217) returneaza `aiFailure` fara `releaseAiUsageReservation`. Multi-agent path are `finally` block la 398-415; single-agent nu. Reservation leak-eaza pana la `purgeExpiredReservations` (300s — vezi si NEEDS-FIX #3).

**Fix**: wrap handler in `try/finally` care apeleaza `releaseAiUsageReservation` la non-confirm exit, mirror multi-agent.

### NEEDS-FIX #6 — MEDIUM-5 FIX 8 defensive test absent

**Locatie**: [deploy/Caddyfile:26-29](deploy/Caddyfile#L26-L29) e corect (strip-ul exista). Lipseste insa testul/proba defensiva ceruta de REMEDIATION FIX 8.

**Problema**: nu exista nicio asertie ca backend-ul ignora un `X-Auth-Request-Email` injectat direct (caz hipotetic: Caddy/oauth2-proxy bypass, port-forward din enclave, dev port-open). Pentru audit complete trebuie:
- **Optiunea A**: `backend/src/middleware/spoofedHeaderReject.test.ts` integration test cu mock Caddy → oauth2-proxy → backend, asertand ca header injectat direct nu produce sesiune.
- **Optiunea B**: gated diagnostic endpoint `GET /api/v1/diag/headers` (env `LEGAL_DASHBOARD_DIAG=1`).

Backend-ul ramane `expose:`-only (nereachable din afara), deci runtime-risk e zero, dar compliance / audit cer dovada explicita.

### NEEDS-FIX #7 — HIGH-5 system.boot detail gaps

**Locatie**: [backend/src/index.ts:457-462](backend/src/index.ts#L457-L462)

**Problema**: plan cere `processId`, `hostname`, `NODE_ENV`, `appVersion` in detail. Implementarea logheaza `version`, `authMode`, `hostname`, `port`. Lipsesc `processId` (`process.pid`) si `NODE_ENV`. Audit-trail incident correlation degradat.

**Fix**: adauga `processId: process.pid, nodeEnv: process.env.NODE_ENV ?? "unknown"` la `detail`.

### NEEDS-FIX #8 — LOW-2 audit.viewed detail lipseste `count`

**Locatie**: [backend/src/routes/admin.ts:326-342](backend/src/routes/admin.ts#L326-L342)

**Problema**: plan cere `{ count, filterApplied }`. Implementarea logheaza filter, dar nu si numarul de rows returnate. Investigatorul nu poate corela "cine a citit cat" doar din audit row.

**Fix**: adauga `count: rows.length` la `detail`.

---

### NEEDS-FIX #9 — MEDIUM-11 fxFetcher low-bound test absent

**Locatie**: [backend/src/services/fxFetcher.test.ts](backend/src/services/fxFetcher.test.ts)

**Problema**: Planul ECB FX plausibility (MEDIUM-11) cere doua teste de plausibility: high-bound (rate `100.0` peste max) si low-bound (rate `0.0001` sub min `0.5`). Implementarea la [fxFetcher.ts:83-85](backend/src/services/fxFetcher.ts#L83-L85) gateaza ambele directii cu `rate < MIN_PLAUSIBLE_RATE || rate > MAX_PLAUSIBLE_RATE`, dar testul acopera doar high-bound. Pentru audit complete + asigurare D14 fail-closed, low-bound trebuie testat explicit.

**Fix**: adauga in `fxFetcher.test.ts` un caz mock ECB cu `rate=0.0001`, asertand ca `upsertFxRate` NU se apeleaza si ca handler-ul propaga eroarea.

**Severitate**: MEDIUM (plan-mandated test acoperire).

---

## 5) Observatii minore / cleanup

Necritice. Pot fi rezolvate oportunistic.

1. **`streamCap.ts:14-18`** — fallback `!response.body` foloseste `response.text()` unbounded inainte de byte check. Pe Node 22 fetch path-ul e dead, dar viola design-ul streaming-only. Recomandare: returneaza `""` cum spune plan.
2. **Class name**: `ResponseTooLargeSignal` (plan ceruse `ResponseTooLargeError`). Public API neaffected (`SoapResponseTooLargeError` preservat in `soap.ts`).
3. **`budgetWarningService.ts:32`** — redeclara `QuotaFeature = "ai.single" | "ai.multi"` local in loc de re-export din `quotaGuard.ts`. Va diverga silent daca `QUOTA_FEATURES` se extinde.
4. **`rnpmClient.test.ts:12`** — cleanup-ul `delete process.env.RNPM_RUNTIME_VALIDATION_ENFORCED` referentiaza variabila opt-in veche (dead). Inlocuit cu `RNPM_RUNTIME_VALIDATION_DISABLED`.
5. **`auditSanitize.ts`** — codul whitelist colapseaza la `"ESMTP"` (nu `"unknown"`). Consistent cu testul; nu e bug, dar plan-ul listase mai multe coduri (`ECONNRESET`, `EDATA`, etc.). Conservatoare e safer.
6. **`budgetWarningService.ts:257-273`** — `dispatchWarningEmail` SMTP failures logheaza in `console` only, nu apeleaza `sanitizeSmtpError` si nu scriu audit. Email failures la budget-warning raman silent in audit log. Gap, nu PII leak.
7. **`streamCap.test.ts`** — lipseste cazul "abort mid-stream via AbortSignal" (plan test case 5).
8. **Untracked scratchpad files la root** (`UsersCezarAppDataLocalTempplan_part2.js`, `UsersCezarAppDataLocalTempwp1.js`) cauzeaza biome failure pe full-repo scan. Recomandare: `.gitignore` sau delete. Non-blocking pe PR.
9. **Boot-refused log structurat lipseste in `instanceLock.ts`** — overlay-ul REMEDIATION cerea `writeBootRefusedLog` pentru cazul "alive peer" (race-loser care vede heartbeat fresh). Implementarea curenta arunca direct `throw new Error("Alt proces detine...")` fara persistare structurata. Pentru un operator debugging un OOM-restart loop, doar stack trace-ul ajunge in stdout — corelare incident dificila fara log separat cu timestamp + previousPid + previousHostname.

---

## 6) Manual checks (🔍)

| Verificare | Cum | Pass criteria |
|------------|-----|---------------|
| Two-replica Docker boot race | `docker compose up --scale backend=2` | Doar un container traieste; al doilea logheaza "Alt proces detine" sau crash cu rename ENOENT |
| Quota race sub presiune concurenta | 50 concurrent /analyze cu cota approaching limit | Niciun overshoot peste limit; rejection 429 cand `pending+confirmed >= limit` |
| Rate-limit spoofing (post-fix HIGH-3) | `curl -H "X-Forwarded-For: 1.1.1.1, <real>" -H "X-Forwarded-For: 2.2.2.2"` | Backend foloseste IP-ul socket-ului real, nu 1.1.1.1 sau 2.2.2.2 |
| SOAP large response | mock portalquery cu response 60MB | `SoapResponseTooLargeError` thrown, fetch abort, socket eliberat |
| ECB FX out-of-range | mock ECB cu rate 100.0 | `upsertFxRate` NU se apeleaza, banner FX afiseaza degraded |
| oauth2-proxy bypass attempt (post-fix #6) | `curl -H "X-Auth-Request-Email: attacker@x.com" :8080` direct la backend | Backend refuza (sesiunea cere JWT cookie, nu header) |
| Instance lock auditat post-reclaim | force crash → restart cu lockfile stale | `audit_log` contine `instance.lock.reclaimed` dupa boot reusit |

---

## 7) Cross-check web launch surface (dincolo de v2.33.0)

Conform handoff-ului SESSION-HANDOFF-v2.33.0-post-codex-review.md sectiunea 3.1.3:

| Constrangere | Status |
|--------------|--------|
| F0/F1 din `AUDIT-codex-317aa63.md` raman rezolvate | PASS — niciun fisier afectat de v2.33.0 nu re-deschide F0/F1 |
| CSP, secureHeaders, IPC, safeStorage neatinse | PASS — niciun diff in `electron/`, `frontend/src/main`, `backend/src/middleware/secureHeaders` |
| Rate limiter, body size limits | PASS structural; **HIGH-3 deschide brut o regresie posibila in cazul mis-config Caddy** (vezi NEEDS-FIX #1) |
| LAN bind opt-in flag intact | PASS — `LEGAL_DASHBOARD_ALLOW_REMOTE` neatins |
| Web-mode 501 gate `rejectCaptchaKeyInWebMode` intact | PASS — `rnpmGuards.ts:101` neatins |
| Manual FX entry forbidden, ECB only | PASS — `fxFetcher.ts` rejecteaza out-of-range, niciun path manual deschis |
| Audit log no-plaintext | PASS — sanitize aplicat in dispatcher; LOG_NOPLAINTEXT verificat via BLOCKER-3 sweep |
| `TENANT_KEY_ENCRYPTION_SECRET=32 bytes base64` | NU verificat in branch; **ramane operational** — verificare la deploy |
| JWT secret rotat/configurat | NU verificat in branch; **ramane operational** |
| Backups configurate cu retention | PASS — politicile pre-existente (D9 backup atomic) neatinse |
| Health endpoint accesibil | PASS — `/health` neatins |
| Monitoring + alerting | PASS — orchestrarea neatinsa; vezi NEEDS-FIX #3 pentru reservation purge edge case |
| Desktop mode functional (quotaGuard no-op) | PASS — verificat in [quotaGuard.ts:70](backend/src/middleware/quotaGuard.ts#L70) si reserveQuotaBudget early-return |
| SOAP cancellation AbortSignal | PASS — combinatie `AbortSignal.any` la [soap.ts:98-100](backend/src/soap.ts#L98-L100) |
| Backup atomic `.tmp + rename` | PASS — neatins |
| `MONITORING_DISABLED_KINDS` kill switch operational | PASS structural; **interactiune cu NEEDS-FIX #3** |

---

## 8) Build verification

| Verificare | Rezultat |
|------------|----------|
| `npx tsc --noEmit -p backend/tsconfig.json` | PASS (exit 0) |
| `cd frontend && npx tsc --noEmit` | PASS (exit 0, no output) |
| `npm run build` (Vite frontend + esbuild backend CJS) | PASS — "=== Build complete! ===" |
| `npm test --workspace=backend` | PASS — 1295 passed, 1 skipped, 0 failed |
| `npx biome check` pe cele 31 fisiere sursa atinse de PR | PASS |
| `npx biome check` full repo | FAIL pe 2 fisiere scratchpad **untracked** la root (non-blocking) |
| Frontend tests | NU rulate in aceasta sesiune (no FE logic changed in this branch in scope; doar `changelog-entries.tsx`) |

---

## 9) Verdict final

**🟡 CONDITIONAL — GO dupa cele 2 fixes obligatorii (NEEDS-FIX #1 + #2)**

### Punch list pana la web launch GO

**Obligatoriu inainte de merge** (sau intr-un commit imediat pe acelasi PR):
1. **NEEDS-FIX #1**: rate-limit XFF walk dreapta-stanga in `proxyIp.ts:30-42`.
2. **NEEDS-FIX #2**: boot warning + `recordAudit(null, "rnpm.validation.disabled", { detail })` in `index.ts`.

**Recomandat in `v2.33.1` follow-up** (poate fi paralel sau imediat dupa merge):
3. NEEDS-FIX #3: independent `purgeExpiredReservations` interval gated pe `getAuthMode() === "web"`.
4. NEEDS-FIX #4: jitter pe SMTP retry backoff.
5. NEEDS-FIX #5: `try/finally` cu `releaseAiUsageReservation` in single-agent `/analyze`.
6. NEEDS-FIX #6: defensive test/diag endpoint pentru Caddy strip.
7. NEEDS-FIX #7: adauga `processId` + `nodeEnv` la `system.boot` detail.
8. NEEDS-FIX #8: adauga `count` la `audit.viewed` detail.
9. NEEDS-FIX #9: low-bound test `fxFetcher.test.ts` (rate `0.0001`).

**Cleanup oportunistic** (sectiune 5 — non-blocking, non-urgent, inclusiv boot-refused log structurat in `instanceLock.ts`).

### Estimat remediation pana la GO

- NEEDS-FIX #1: ~30 min (10 linii cod + 2 teste pe walk direction).
- NEEDS-FIX #2: ~15 min (1 bloc in index.ts + 1 test).
- **Total pana la GO**: ~45 min lucru + 1 push + 1 re-run CI.

### Estimat follow-up v2.33.1

- NEEDS-FIX #3-#9: ~3-4h cumulat.
- Cleanup (sectiune 5): ~1-2h.

---

**Generat**: 2026-05-19 — Claude (Opus 4.7) cu 4 specialized agents (backend-reliability + release-readiness + data-validation + audit-trail) si 1 codex:codex-rescue independent advisor, urmate de verificare directa pe conflicte de verdict si validare build (`tsc` + 1295 teste).
