# Audit Profund de Securitate - Legal Dashboard v2.32.0

**Data**: 2026-05-19
**Scope**: Intregul cod livrat pana la v2.32.0 (Electron desktop + Hono backend web mode + monitoring + quota system + tenant key vault)
**Metodologie**: 5 agenti Claude specializati paraleli + 1 agent extern Codex (advisor independent)
**Verdict global**: **Sigur in productie pentru desktop single-tenant. Pentru deploy web multi-instanta sunt 5 blockeri HIGH/CRITICAL care trebuie rezolvati inainte de cutover.**

---

## 1) Executive Summary

| Severitate | Numar findings | Ce blocheaza |
|------------|----------------|--------------|
| CRITICAL | 1 | Web cutover (race condition quota) |
| HIGH | 5 | Web cutover + scaling multi-instanta |
| MEDIUM | 11 | First real users (data quality + ops) |
| LOW | 5 | Cleanup post-launch |
| CLEAN | 3 zone | Owner isolation, JWT revalidation, env kill-switches |

**Status livrare**: Desktop mode (auth_mode=desktop) - **0 blockeri**. Web mode (auth_mode=web) - **6 blockeri inainte de cutover**.

**Recomandare ordine fix**: CRITICAL -> HIGH (in ordinea listata) -> MEDIUM grupate pe domeniu -> LOW oportunistic.

---

## 2) Verdictul agentilor

| Agent | Verdict | Findings unice |
|-------|---------|----------------|
| repo-security-auditor (Claude) | "Mostly safe but contains notable risk" | 3 (1 HIGH proxy IP, 2 MEDIUM headers/URL) |
| data-validation-reviewer (Claude) | "Acceptable but needs tightening" | 3 MEDIUM |
| dependency-security-reviewer (Claude) | "Low supply-chain risk" | 1 MEDIUM digest pinning + 2 LOW |
| workflow-risk-reviewer (Claude) | 1 CRITICAL race, 1 HIGH email, 3 MEDIUM/LOW | 5 |
| audit-trail-reviewer (Claude) | 1 HIGH boot audit, 4 MEDIUM/LOW | 5 |
| **codex (extern)** | "Not web-scale safe yet" | 2 HIGH (SOAP stream, SQLite lock) + 2 MEDIUM + 3 CLEAN |

Convergenta inter-agenti: Codex + workflow-risk-reviewer au flagat **independent** problema bugetului SMTP (HIGH). Codex + repo-security-auditor confirma ca desktop mode si crypto primitivele sunt corecte. Convergenta consolideaza fiability.

---

## 3) Findings ordonate dupa severitate

### CRITICAL-1 — Burst-before-write race in quotaGuard (web mode)

**Locatie**: [backend/src/middleware/quotaGuard.ts:62](backend/src/middleware/quotaGuard.ts#L62) + [backend/src/services/aiUsage.ts:156](backend/src/services/aiUsage.ts#L156)

**Sursa**: workflow-risk-reviewer

**Problema**: `quotaGuard` citeste `sumAiUsageMilliInWindow` la pornirea request-ului, apoi blocheaza doar daca cheltuiala curenta > cap. `ai_usage` se scrie insa prin `queueMicrotask` **dupa** ce raspunsul a fost deja flush-uit catre client. Concurent, N request-uri AI simultane la 79% utilizare citesc toate aceeasi valoare 79%, toate trec guard-ul, toate cheltuiesc, si scrierea ulterioara poate impinge totalul mult peste cap (overshoot empiric ~N x cost_per_request).

**Scenariu exploit**: User cu cap 5 USD/zi, deja la 4 USD/zi (80%). Trimite 10 request-uri AI in paralel din UI (poll burst). Toate vad 4 USD < 5 USD -> trec. Cost real total: 14 USD. Cap depasit cu 280%.

**Impact**: Pierderi financiare directe per tenant (mai grav in web mode unde adminul plateste din buget tenant). Bypass control buget = fraud-control risk daca un user compromis automatizeaza burst-uri.

**Fix recomandat**:
```ts
// quotaGuard.ts - inlocuieste read-only check cu lock optimistic
await db.transaction(() => {
  const current = sumAiUsageMilliInWindow(userId, feature, windowSeconds);
  const estimated = current + estimatedCostMilli;
  if (estimated > capMilli) throw new QuotaExceeded(...);
  // Insereaza row de "reservation" cu status=pending; finalize la flush
  insertAiUsageReservation({ userId, feature, estimatedCostMilli, ... });
})();
```
Sau, mai simplu, refactor `queueMicrotask` -> sincron inainte de `c.json()`, acceptand penalty latenta ~2-5ms per request.

**Confidence**: HIGH

---

### HIGH-1 — SOAP raspuns fara streaming cap

**Locatie**: [backend/src/soap.ts:113](backend/src/soap.ts#L113)

**Sursa**: codex (advisor extern)

**Problema**: `PortalJustSoapClient` verifica `Content-Length` header, dar daca upstream raspunde cu `Transfer-Encoding: chunked` sau fara header de lungime, `response.text()` materializeaza intreg corpul in memorie inainte ca verificarea de 50MB sa se aplice. Un upstream defect/malitios poate stream-ui sute de MB pana la OOM.

**Impact**: Crash backend (process restart prin PM2/Docker), denial-of-service per instanta. In desktop mode = crash Electron renderer/main. Bypass eficient al limitelor explicite documentate in `SECURITY.md`.

**Fix recomandat**:
```ts
// Inlocuieste response.text() cu stream reader cu cap explicit
const reader = response.body.getReader();
const chunks: Uint8Array[] = [];
let total = 0;
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  total += value.byteLength;
  if (total > SOAP_MAX_RESPONSE_BYTES) {
    reader.cancel();
    throw new Error(`SOAP response exceeds ${SOAP_MAX_RESPONSE_BYTES} bytes`);
  }
  chunks.push(value);
}
const text = Buffer.concat(chunks).toString("utf8");
```

**Confidence**: HIGH

---

### HIGH-2 — Backup/maintenance lock in-process; scale-out unsafe

**Locatie**: [backend/src/db/backup.ts:7](backend/src/db/backup.ts#L7)

**Sursa**: codex (advisor extern)

**Problema**: `maintenanceLock` este variabila JavaScript in-process. Deploy production (vezi `deploy/docker-compose.prod.yml`) mounteaza un singur volum `/data` cu un singur fisier SQLite. Daca cineva scaleaza `backend` la 2 containere (ex. update zero-downtime), ambele instante au scheduler-ul activ pe acelasi fisier, ambele backup-uri scriu la acelasi path `.db.tmp` -> corupere DB / pierdere snapshot.

**Impact**: Pierdere date sub scaling. Vulnerabilitate la "ops mistake" mai degraba decat exploit, dar consecinta = severa.

**Fix recomandat**:
```ts
// Optiune A: fail-closed boot daca alt proces detine WAL lock
import { existsSync } from "fs";
const walLockPath = `${dbPath}-wal-lock`;
if (existsSync(walLockPath) && process.env.LEGAL_DASHBOARD_FORCE_BOOT !== "1") {
  throw new Error("Database in use by another backend instance");
}
// Optiune B: SQLite advisory lock via PRAGMA application_id
db.exec("PRAGMA application_id = 0xDEADBEEF");
```
Documenteaza explicit "single backend instance" in `deploy/README.md` pana cand este implementata replica/Litestream.

**Confidence**: HIGH

---

### HIGH-3 — Rate limiter + originGuard collapsate sub oauth2-proxy

**Locatie**: [backend/src/middleware/rate-limit.ts](backend/src/middleware/rate-limit.ts) + [backend/src/middleware/originGuard.ts](backend/src/middleware/originGuard.ts)

**Sursa**: repo-security-auditor

**Problema**: Cele doua middleware citesc IP-ul de la `getConnInfo` (socket peer). Sub `deploy/docker-compose.prod.yml`, intregul trafic intra prin oauth2-proxy in container ID partajat. Rezultat: toti userii partajeaza **acelasi bucket** rate-limit. Un singur user noisy / atacator epuizeaza limita pentru intregul tenant. Pe bridge-ul OAuth2 pre-auth, brute-force devine practic neumblat.

**Impact**: Cross-tenant DoS in productie. Pe `POST /api/v1/auth/oauth2/sync` bridge: brute-force timing-safe compare lipsit de throttling efectiv.

**Fix recomandat**:
```ts
// Adauga LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR env var
function getEffectiveClientIp(c: Context): string {
  const socketPeer = getConnInfo(c).remote.address ?? "unknown";
  const trustedCidr = process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR;
  if (trustedCidr && ipInCidr(socketPeer, trustedCidr)) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  return socketPeer;
}
```

**Confidence**: HIGH

---

### HIGH-4 — Budget warning email silently lost on SMTP failure

**Locatie**: [backend/src/services/budgetWarningService.ts:104](backend/src/services/budgetWarningService.ts#L104), [budgetWarningService.ts:175-178](backend/src/services/budgetWarningService.ts#L175-L178)

**Sursa**: workflow-risk-reviewer + codex (convergent)

**Problema**: Episode de warning >=80% se marcheaza `fired_at` in DB. La fail SMTP, `email_sent_at` ramane NULL dar episode-ul ramane "active" (`cleared_at` NULL). Urmatoarele check-uri vad episode-ul activ -> `fireWarning=false` -> nu re-incearca email. User ramane nestiut peste cap pana cand cheltuiala scade sub 80% si re-creste, declansand nou episode.

**Impact**: Userii admin nu sunt notificati cand bugetele tenant-ului ajung in zona critica. Silent failure care submineaza intregul flow operational al sistemului quota.

**Fix recomandat**:
```ts
// Retry cu backoff pentru episode-urile active cu email_sent_at IS NULL
const STALE_WARNING_RETRY_SECONDS = [60, 300, 900, 3600];
function selectStalePendingWarnings(): BudgetNotification[] {
  return db.prepare(`
    SELECT * FROM budget_notifications
    WHERE cleared_at IS NULL AND email_sent_at IS NULL
      AND fired_at < unixepoch() - ?
    LIMIT 50
  `).all(STALE_WARNING_RETRY_SECONDS[0]);
}
// La fiecare tick scheduler, incearca re-send pentru pending stale
```

**Confidence**: HIGH

---

### HIGH-5 — Lipseste audit row pentru `system.boot`

**Locatie**: [backend/src/index.ts](backend/src/index.ts) (locul unde lifecycle-ul backend porneste)

**Sursa**: audit-trail-reviewer

**Problema**: Niciun audit event nu este scris la boot-up backend in web mode. Compromis prin restart silentios / scrub WAL e nedetectabil din timeline-ul audit. Pentru compliance (auditori cer dovada continuitatii loggings), gap-ul este material.

**Impact**: Lipsa baseline pentru investigatie incident. Nu se poate dovedi "X a vazut Y in audit log la ora Z" daca exista intervale fara dovada ca sistemul rula.

**Fix recomandat**:
```ts
// In index.ts dupa migrate complete
import { writeAuditLog } from "./services/auditLog";
writeAuditLog({
  ownerId: "system",
  action: "system.boot",
  detail: { version: APP_VERSION, mode: getAuthMode(), nodeVersion: process.version },
});
process.on("SIGTERM", () => {
  writeAuditLog({ ownerId: "system", action: "system.shutdown", detail: { reason: "SIGTERM" } });
});
```

**Confidence**: HIGH

---

### MEDIUM-1 — `feature` string admin = free-form, fara enum constraint

**Locatie**: [backend/src/routes/admin.ts:111,128](backend/src/routes/admin.ts#L111)

**Sursa**: data-validation-reviewer

**Problema**: `UpsertQuotaSchema` si `CreateGrantSchema` accepta orice `z.string().min(1).max(80)` pentru camp `feature`. Admin tasteaza `"ai_chat_usd"` accidental in loc de `"ai_usd"` (cel din `quotaGuard`); grant-ul exista in DB dar este unreachable. Niciun warning, niciun audit mismatch.

**Fix recomandat**: Definire `QUOTA_FEATURE_ENUM = ["ai_usd"] as const` co-locat cu `quotaGuard.ts`; schema -> `z.enum(QUOTA_FEATURE_ENUM)`. UI admin foloseste acelasi array pentru dropdown.

**Confidence**: HIGH

---

### MEDIUM-2 — RNPM runtime validation default-OFF

**Locatie**: [backend/src/services/rnpmClient.ts:278](backend/src/services/rnpmClient.ts#L278)

**Sursa**: data-validation-reviewer

**Problema**: `if (RNPM_RUNTIME_VALIDATION_ENFORCED !== "1") return data as RnpmSearchResult` - in productie default Zod schema failure este silently bypass-uit, data este raw-cast. `RnpmSearchResultSchema` foloseste deja `z.array(z.unknown())` pentru `documents` (fara field-level shape).

**Fix recomandat**: Inverteaza default-ul - `RNPM_RUNTIME_VALIDATION_DISABLED=1` ca opt-out. Adauga `z.string()` constraint pe `numar_dosar`, `data_inregistrare`, `parti`.

**Confidence**: HIGH

---

### MEDIUM-3 — Unbounded SELECT in repository quota

**Locatie**: [backend/src/db/userQuotaGrantsRepository.ts:57](backend/src/db/userQuotaGrantsRepository.ts#L57), [backend/src/db/userQuotaRepository.ts:52](backend/src/db/userQuotaRepository.ts#L52)

**Sursa**: data-validation-reviewer

**Problema**: `listGrantsForUser` / `listOverridesForUser` - `SELECT ... WHERE user_id = ?` fara LIMIT. `/me/budget` apoi face N+1 query (`sumAiUsageMilliInWindow` per override). Poll UI -> N x query/secunda.

**Fix recomandat**: Adauga `LIMIT 200`. Refactor `/me/budget` la single aggregating SQL.

**Confidence**: HIGH

---

### MEDIUM-4 — Google API key in URL query string

**Locatie**: [backend/src/services/keyValidation.ts:89](backend/src/services/keyValidation.ts#L89)

**Sursa**: repo-security-auditor

**Problema**: `...?key=${encodeURIComponent(value)}` - URL query params persista in access logs (CDN, TLS terminator, upstream Google logs).

**Fix recomandat**: `headers: { "x-goog-api-key": value }`, drop `?key=`.

**Confidence**: HIGH

---

### MEDIUM-5 — Caddy nu strip `X-Proxy-Auth` de la client

**Locatie**: [deploy/Caddyfile](deploy/Caddyfile)

**Sursa**: repo-security-auditor

**Problema**: oauth2-proxy injecteaza `X-Proxy-Auth` prin `OAUTH2_PROXY_INJECT_REQUEST_HEADERS`, dar Caddy nu strip-uieste header-ul de la client inainte de forward. Defense-in-depth gap daca oauth2-proxy v7.7.1 ar avea regresie de injection-vs-passthrough.

**Fix recomandat**: `header_up -X-Proxy-Auth` in reverse_proxy block-ul Caddy.

**Confidence**: MEDIUM

---

### MEDIUM-6 — Raw SMTP exception in audit detail_json leaks email

**Locatie**: [backend/src/services/alertEmailDispatcher.ts:107](backend/src/services/alertEmailDispatcher.ts#L107)

**Sursa**: audit-trail-reviewer

**Problema**: La fail SMTP, exception-ul raw (care contine recipient email plaintext) este scris in `detail_json` audit. Plaintext email = identificator personal in audit log -> incalcare principiu "no PII in audit".

**Fix recomandat**: `detail.error = sanitizeSmtpError(err)` (extrage cod + class, drop recipient). Email-ul ramane disponibil prin `emailHash` (SHA-256 prefix-16) consecvent cu restul audit.

**Confidence**: HIGH

---

### MEDIUM-7 — Nu se auditeaza `auth.logout`

**Locatie**: [backend/src/routes/auth.ts](backend/src/routes/auth.ts) (handler logout)

**Sursa**: audit-trail-reviewer

**Problema**: `auth.login` se auditeaza, dar `auth.logout` lipseste. Sesiunile lungi nedocumentate = gap forensic.

**Fix recomandat**: Adauga `writeAuditLog({ action: "auth.logout", ... })` in logout handler.

**Confidence**: HIGH

---

### MEDIUM-8 — Warning oscillation 79%/81% = email spam

**Locatie**: [backend/src/services/budgetWarningService.ts](backend/src/services/budgetWarningService.ts)

**Sursa**: workflow-risk-reviewer

**Problema**: Cheltuiala oscileaza in jur de 80% prag (peste/sub) -> fire warning, clear, fire din nou, clear din nou. Niciun cooldown -> N email-uri per ora.

**Fix recomandat**: Adauga `min_email_interval_seconds = 3600` (1 ora cooldown) intre warning fire-uri pentru acelasi (user, feature, window).

**Confidence**: HIGH

---

### MEDIUM-9 — Grant `expires_at` fara upper bound

**Locatie**: [backend/src/routes/admin.ts:134](backend/src/routes/admin.ts#L134)

**Sursa**: workflow-risk-reviewer

**Problema**: Admin poate seta `expires_at = "2099-12-31T23:59:59Z"` -> grant practic perpetuu. Lipsa cap = audit-bypass posibil (admin malitios scapa de revizuiri periodice).

**Fix recomandat**: Cap maxim 1 an: `if (expiresAt > now + 365 * 86400) throw ValidationError`.

**Confidence**: HIGH

---

### MEDIUM-10 — Docker compose images nu sunt digest-pinned

**Locatie**: [deploy/docker-compose.prod.yml:19,38](deploy/docker-compose.prod.yml#L19)

**Sursa**: dependency-security-reviewer

**Problema**: `caddy:2.8-alpine` + `quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine` - tag floating (digest poate fi rescris de mainteneri). Dockerfile-ul backend este digest-pinned corect.

**Fix recomandat**:
```yaml
image: caddy:2.8-alpine@sha256:<digest>
image: quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine@sha256:<digest>
```

**Confidence**: HIGH

---

### MEDIUM-11 — FX rate plausibility check missing

**Locatie**: [backend/src/services/fxFetcher.ts:43](backend/src/services/fxFetcher.ts#L43)

**Sursa**: codex (advisor extern)

**Problema**: Verifica doar `> 0`. ECB ar putea raporta `0.000001` (bug feed / atac MITM peste TLS rotten cert) -> stocat ca `USD/EUR=1000000` -> `/me/budget` returneaza valoarea aberanta.

**Fix recomandat**: Plausibility band: `if (rate < 0.5 || rate > 2.0) return { ok: false, reason: "implausible_rate" }`. Rata istorica USD/EUR e in banda [0.7, 1.5] de 30+ ani.

**Confidence**: HIGH

---

### LOW-1 — Grant `reason` 500 chars verbatim in audit

**Locatie**: [backend/src/routes/admin.ts:580,617](backend/src/routes/admin.ts#L580)

**Sursa**: audit-trail-reviewer

**Problema**: Camp text liber salvat ca-atare in `detail_json`. Risc accidental: admin lipeste accidental PII / secrete in reason.

**Fix recomandat**: Truncheaza la 200 chars + log warning daca reason original > 200.

**Confidence**: MEDIUM

---

### LOW-2 — Admin audit viewer nu se auditeaza

**Locatie**: [backend/src/routes/admin.ts](backend/src/routes/admin.ts) (handler `GET /audit-logs`)

**Sursa**: audit-trail-reviewer

**Problema**: Cine consulta audit log-urile nu este la randul lui auditat -> "who watches the watchmen" gap.

**Fix recomandat**: `writeAuditLog({ action: "audit.viewed", detail: { filters, count } })` in handler.

**Confidence**: MEDIUM

---

### LOW-3 — Lipseste audit row pentru `budget.warning.fired`

**Locatie**: [backend/src/services/budgetWarningService.ts](backend/src/services/budgetWarningService.ts)

**Sursa**: workflow-risk-reviewer

**Problema**: Episode de warning se scriu doar in `budget_notifications`, nu si in `audit_logs`. Inconsistenta cu restul flow-urilor business-critical.

**Fix recomandat**: Dublu-scrie - `budget_notifications` + audit log row.

**Confidence**: MEDIUM

---

### LOW-4 — `@google/generative-ai` package status

**Sursa**: dependency-security-reviewer

**Problema**: Package este probabil in maintenance-mode (Google migreaza la `@google/genai`). Risc viitor: lipsa CVE patches.

**Fix recomandat**: Tracking; nu actiune imediata.

**Confidence**: LOW

---

### LOW-5 — `@2captcha/captcha-solver` transitive `node-fetch`

**Sursa**: dependency-security-reviewer

**Problema**: Dependency tree contine `node-fetch` v2 (varianta cu CVE-uri historice rezolvate, dar range deschis).

**Fix recomandat**: Lock fix in `package-lock.json` (deja pinned). Nu actiune.

**Confidence**: LOW

---

## 4) Zone curate (CLEAN per codex)

| Zona | Locatie | Constatare |
|------|---------|------------|
| Owner isolation in JOINs | `avizRepository.ts:371,653`, `monitoringAlertsRepository.ts:365`, `dashboardActivityRepository.ts:126` | Toate JOIN-urile fac scope prin owner-bearing rows. Zero leak cross-tenant detectat. |
| JWT role revalidation | `authProvider.ts:81`, `requireRole.ts:28,47` | Admin role este citit DB-side per request, NU trust din JWT claim. Token compromis nu escaleaza la admin. |
| Env kill-switches | `ai.ts:57,489`, `monitoringJobsRepository.ts:365`, `index.ts:336,348` | Comportament `MONITORING_DISABLED_KINDS` / `OPENROUTER_DISABLED` matches CLAUDE.md doc. |

Aditional, primitivele crypto confirmate corecte de repo-security-auditor:

| Componenta | Stare |
|------------|-------|
| AES-256-GCM tenant keys | `randomBytes(12)` IV per encrypt, master key validat exact 32 bytes |
| JWT HS256 | `timingSafeEqual` signature compare |
| OAuth2 bridge | `timingSafeEqual` shared secret |
| Audit logs | `emailHash` SHA-256 prefix-16, fara plaintext |
| Electron | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP strict, IPC timeout 10s, single-instance lock, `will-navigate` userinfo guard, exact-host whitelist |
| Boot probe | Crypto round-trip probe activ |
| LAN bind | Fail-closed, opt-in explicit |
| SOAP | AbortSignal propagat (caveat: streaming cap lipsa - vezi HIGH-1) |
| Export XLSX | Formula-injection escape activ |

---

## 5) Plan remediere recomandat

### Sprint imediat (blocheaza web cutover)
**Estimare: ~12-16 ore**

1. CRITICAL-1: Quota race - refactor `queueMicrotask` -> sincron sau introdu reservation row. **4h**
2. HIGH-1: SOAP streaming cap. **2h**
3. HIGH-2: Backup cross-process lock (PRAGMA application_id sau fail-closed boot). **1h**
4. HIGH-3: Trusted proxy CIDR pentru rate-limit + originGuard. **2h**
5. HIGH-4: SMTP retry pentru pending warnings. **3h**
6. HIGH-5: `system.boot` audit event. **30min**

### Sprint pre first-users
**Estimare: ~8-10 ore**

7-17. Toate MEDIUM-urile (enum feature, RNPM validation, LIMIT 200, Google header, Caddy strip, SMTP sanitization, auth.logout audit, warning cooldown, expires_at cap, Docker digest-pin, FX bounds).

### Cleanup oportunistic
18-22. LOW-urile - in cadrul urmatoarei iteratii care touch-uieste zonele.

---

## 6) Convergente importante intre agenti

Convergente independente (acelasi finding gasit de 2 agenti separati, fara cross-pollination):

| Finding | Agenti convergenti |
|---------|-------------------|
| Budget warning SMTP retry missing | workflow-risk-reviewer + codex |
| Desktop crypto primitive solid | repo-security-auditor + codex |
| Repository-only DB pattern respectat | repo-security-auditor + data-validation-reviewer |
| Owner isolation OK | repo-security-auditor + codex (CLEAN) |
| Audit log NU contine plaintext (in afara de SMTP exception bug) | audit-trail-reviewer + repo-security-auditor |

Aceste convergente cresc confidence-ul intregului audit.

---

## 7) Concluzii

**Desktop mode v2.32.0**: PASS - 0 blockeri. Modul auth=desktop nu este afectat de HIGH-3 (rate-limit proxy), HIGH-2 (multi-instance), HIGH-4 (SMTP retry doar daca SMTP e configurat in desktop, ceea ce e neobisnuit). CRITICAL-1 e teoretic posibil in desktop daca user-ul are AI cap setat, dar exploit-ul cere user adversarial impotriva propriei masini = unrealistic.

**Web mode cutover**: BLOCAT pe 6 issues HIGH/CRITICAL listate in sprint imediat. Estimare totala ~12-16 ore lucru implementare + ~4 ore review/test.

**Recomandare strategica**: NU porni cutover-ul web pana cand:
1. CRITICAL-1 (quota race) - rezolvat + test stress 100 concurrent
2. HIGH-1, HIGH-2, HIGH-3 - rezolvate + smoke test
3. HIGH-4, HIGH-5 - rezolvate (mai putin critice operational, dar audit-trail blocker pentru compliance)

Versiunile target sugerate: v2.33.0 (CRITICAL + HIGH bundle) -> v2.34.0 (MEDIUM bundle) -> web cutover dupa v2.34.0.

---

**Fisiere generate**: doar acest fisier (`audit/AUDIT-PACK-SECURITY-DEEP-2026-05-19.md`).
**Agenti consultati**: 6 (5 Claude specializati + 1 Codex extern).
**Total findings**: 22 (1 CRITICAL, 5 HIGH, 11 MEDIUM, 5 LOW) + 3 zone CLEAN.
