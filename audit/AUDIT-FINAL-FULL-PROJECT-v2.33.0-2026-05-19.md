# AUDIT FINAL — Legal Dashboard v2.33.0 (full project, web mode launch readiness)

> **⚠️ REVIZIE 2026-05-20**: Vezi **§10 Corrigenda post-Codex external review** la final pentru ajustari de severitate si locatie. Sectiunile 1-9 sunt pastrate ca snapshot original 2026-05-19; §10 este sursa de adevar curenta pentru planul de remediere.

- **Data**: 2026-05-19 (original) · 2026-05-20 (corrigenda Codex)
- **Branch**: `main` (v2.33.0 merged in `3a32d5f`)
- **Scope**: ÎNTREGUL proiect (backend + frontend + electron + scripts + ci + deploy), nu doar delta-ul v2.33.0
- **Țintă launch**: web mode **single-tenant multi-user** (Caddy + oauth2-proxy + Google SSO + Hono backend + SQLite/better-sqlite3) — *corectie 2026-05-20: aplicatia serveste o singura firma cu mai multi useri, NU SaaS multi-tenant.*
- **Metodologie**: 8 agenți specializați în paralel (repo-security, backend-reliability, data-validation, database-change, audit-trail, fraud-control, release-readiness, dependency-security) → cross-validation findings (≥2 agenți independenți) → advisor() synthesis → external **codex-rescue review pe codul actual `main`** (2026-05-20)
- **Verdict final** (post-Codex): 🟡 **CONDITIONAL** — lista minima non-negociabila revizuita in §10.4

---

## 1. Executive Summary

| # | Domeniu | Status | Severitate | Est. fix |
|---|--------|--------|-----------|----------|
| 1 | Auth & oauth2-proxy trust boundary | ⚠️ | P0 verificare | 2-4h |
| 2 | Audit log — PII plaintext + log-bomb | ❌ | P0 | 1d |
| 3 | AI reservations — race + 24h purge mismatch | ❌ | P0 | 1-2d |
| 4 | tenantKeys cache — no TTL, stale după rotation | ❌ | P1 | 0.5d |
| 5 | `owner_id DEFAULT 'local'` în web mode | ⚠️ | P1 | 1d (audit + tighten) |
| 6 | Pagination uncapped pe `/saved`, `/searches` | ❌ | P1 | 2h |
| 7 | Per-user captcha cap în web mode | ❌ | P1 | 4h |
| 8 | Scheduler `runJobNow` + FX upsert outside lock | ⚠️ | P1 | 0.5d |
| 9 | CI secrets fixture hardcoded | ⚠️ | P1 | 1h |
| 10 | Alert dispatch fires outside transaction | ⚠️ | P1 | 0.5d |
| 11 | Observability: no APM, no rollback runbook | ❌ | P1 launch | 1-2d |
| 12 | Offsite backup automation absent | ❌ | P1 launch | 0.5d |
| 13 | `.env.example` documentation gaps (6 vars) | ⚠️ | P2 | 1h |
| 14 | Desktop ZERO impact (quotaGuard no-op) | ✅ | — | — |
| 15 | Web-mode 501 gate `rejectCaptchaKeyInWebMode` | ✅ | — | — |
| 16 | Tenant key encryption (32B base64 secret) | ✅ | — | — |
| 17 | Audit log: no plaintext keys, only last4/hadPrevious | ✅ | — | — |
| 18 | ECB FX auto-only, no manual entry, fail-closed | ✅ | — | — |
| 19 | LAN bind opt-in (LEGAL_DASHBOARD_ALLOW_REMOTE) | ✅ | — | — |

**Total remediation estimat**: 5-7 zile de muncă focalizată înainte de cutover web producție.

---

## 2. Critical Failures (❌ P0 — blochează launch)

### P0-1 — Audit log scrie email plaintext (GDPR/PII)
- **Locație**: `backend/src/routes/me.ts:254-258`
- **Problemă**: Pe self-update profile, payload-ul conține `email` plaintext, scris ca atare în `audit_log.details`. Audit log-ul e citit de admin tenant via `/admin/audit` — orice tenant admin poate enumera adresele email ale propriilor useri din log, iar dump-ul DB conține PII clear-text.
- **Fix exact**:
  ```ts
  // me.ts:254
  await auditRepository.append({
    ownerId, actor, action: "self_update_profile",
    details: {
      emailHash: hashEmail(newEmail),   // SHA-256 prefix 16 hex
      emailLast4: newEmail.slice(-4),
      hadPrevious: Boolean(oldEmail),
    },
  });
  ```
- **Convenția proiectului** o impune deja (vezi `auditSanitize.ts` din v2.33.0 — nu e aplicată pe me.ts).

### P0-2 — `serializeDetail` unbounded → log bomb
- **Locație**: `backend/src/db/auditRepository.ts:32-40`
- **Problemă**: `serializeDetail()` face `JSON.stringify(value)` fără cap pe lungime; un attacker care reușește să pompeze un blob de 10MB într-un câmp `details` (ex. monitoring snapshot diff) poate umfla DB-ul rapid. SQLite single-writer → coadă blocată la INSERT, plus disk fill DoS.
- **Fix exact**:
  ```ts
  function serializeDetail(value: unknown): string {
    const raw = JSON.stringify(value);
    const MAX = 16 * 1024; // 16KB
    if (raw.length > MAX) {
      return JSON.stringify({ _truncated: true, _len: raw.length, head: raw.slice(0, MAX - 200) });
    }
    return raw;
  }
  ```

### P0-3 — AI reservation double-count în multi-agent flow
- **Locații**: `backend/src/db/aiUsageRepository.ts` (`reserveAiUsage`, `sumAiUsageMilliInWindow`) + `backend/src/routes/ai.ts` (multi-agent dispatch) + `backend/src/index.ts` (purge la 24h)
- **Problemă**:
  1. Reservation INSERT scrie `cost_usd_milli=0` și se bazează pe estimate-ul "cap" returnat de sumă fereastră. În flow-ul multi-agent (Claude + OpenAI + Gemini paralel), cele 3 reservation INSERTs **nu se văd reciproc** dacă rulează în paralel — fiecare check citește un total pre-INSERT și concluzionează "OK, încap". Rezultat: tenant poate depăși budget-ul când are 3+ provideri în paralel.
  2. Purge job-ul rulează la **24h** dar reservations expiră la **5min** → fereastra de inflație fals e potențial 24h, denying legitimate calls (DoS-by-quota dacă atacatorul flood-uiește reservations care expiră dar nu sunt cleaned up).
- **Fix exact**:
  - Wrap reservation INSERT + budget check într-o tranzacție `BEGIN IMMEDIATE` (single SQLite writer e oricum serializat — TOCTOU închisă).
  - Purge job interval: scade la 60s (sau hook la fiecare reservation read pentru `WHERE expires_at < now()`).

### P0-4 — oauth2-proxy / sync trust boundary (verificare externă în derulare)
- **Locație**: `backend/src/routes/auth.ts` (POST `/sync`, ~L149)
- **Risc**: dacă shared-secret check nu e constant-time, sau dacă Caddy-ul deployment-ului uită să strip-uiască headerele `X-Forwarded-Email` venite din public internet, atacator extern poate impersona orice email cu un guess de secret + header injection.
- **Status**: codex-rescue verifică acum (constant-time, provisioning safety, header bypass). Tratează ca **P0 până confirmare externă**.
- **Mitigare imediată dacă review-ul scoate gap**: adaugă în README-DEPLOY-SERVER instrucțiune explicită `header_up -X-Forwarded-Email` în site-block Caddy + verifică `timingSafeEqual` la shared-secret.

---

## 3. Warnings (⚠️ P1 — fix înainte de first real users)

### P1-1 — tenantKeys cache fără TTL
- **Locație**: `backend/src/db/tenantKeysRepository.ts:48` (in-process `Map`)
- **Impact**: admin rotește master key → procesele backend care nu au fost restartate continuă să decripteze cu cheia veche din cache → race confuz pe rotație.
- **Fix**: TTL 60s + invalidate pe write.

### P1-2 — `owner_id DEFAULT 'local'` în web mode
- **Locații**: toate migrațiile 0001+
- **Impact**: orice INSERT cu `owner_id` omis (bug în handler nou) absoarbe row-ul în tenant-ul fictiv `local`, scurgând date între tenanți. În desktop e by design; în web e bombă cu ceas.
- **Fix**: în web mode, runtime guard `assert(ownerId !== "local" && ownerId)` în repositories înainte de INSERT. Migrație separată care `DROP DEFAULT` opțional.

### P1-3 — Pagination uncapped
- **Locații**: `backend/src/routes/rnpm.ts:761-772` (`/saved`) + `:1068-1074` (`/searches`)
- **Impact**: tenant cu 100k saved → un GET dă OOM pe Node + freeze SQLite reader.
- **Fix**: forțează `pageSize <= 200` server-side; ignore client override peste cap.

### P1-4 — No per-user captcha cap web mode
- **Locație**: `backend/src/routes/rnpmGuards.ts`
- **Impact**: un user singur poate epuiza budget-ul lunar 2Captcha al tenantului (admin plătește).
- **Fix**: per-user-per-day captcha quota (default 50, configurabil în `/admin/quota`).

### P1-5 — Alert dispatch fires outside transaction
- **Locație**: `backend/src/services/alerts/alertEventService.ts:64`
- **Impact**: `queueMicrotask` dispatch după COMMIT; dacă tranzacția rollback-uiește între INSERT alert și microtask, alertul deja a plecat pe email — alertă fantomă.
- **Fix**: mută dispatch-ul în `after(tx)` hook sau folosește outbox pattern (insert pending → cron picks up commited rows).

### P1-6 — Scheduler `runJobNow` și `upsertFxRate` outside lock
- **Locații**: `backend/src/services/monitoring/scheduler.ts:296-328` + `backend/src/services/fx/fxFetcher.ts:87`
- **Impact**: două procese (HA setup) sau două click-uri rapide pe "Run now" pot dubla runul/FX upsert-ul. Mitigare existentă: `instanceLock.ts` (v2.33.0) — verifică că aceste path-uri trec prin lock.
- **Fix**: wrap `runJobNow` în `withMaintenanceLock(...)`.

### P1-7 — CI secrets fixture hardcoded
- **Locație**: `.github/workflows/docker-build.yml:89,92`
- **Impact**: low-entropy test fixtures committed; nu sunt prod-key, dar pattern-ul slăbește hygiene-ul. Rotește pe rotație de chei prod accidental.
- **Fix**: mută în GitHub repo secrets, chiar și pentru fixtures.

### P1-8 — Observability gap
- **Lipsește**: APM (no Sentry/Rollbar/equivalent), rollback runbook, offsite backup automation.
- **Impact launch**: la primul incident producție, MTTR e nedefinit.
- **Fix**: minim `/health` + Sentry SDK + un `RUNBOOK.md` cu rollback git tag + restore DB din backup.

---

## 4. Manual Checks (🔍)

| Check | Cum verifici | Pass criteria |
|------|--------------|---------------|
| Caddy strip-uiește `X-Forwarded-*` din public | `curl -H "X-Forwarded-Email: admin@evil.com" https://prod/` și verifică log-ul backend | Backend vede email-ul oauth2-proxy, nu cel injectat |
| oauth2-proxy redirect URI matched în Google Console | Test login real | Login funcționează; logout invalidează cookie |
| TENANT_KEY_ENCRYPTION_SECRET ≥ 32 bytes base64 | `echo -n "$SECRET" \| base64 -d \| wc -c` | ≥ 32 |
| LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET ≥ 32 bytes random | la fel | ≥ 32 |
| Backup restore într-un mediu staging | restore + `npm test --workspace=backend` | toate testele trec |
| Rate limit web mode efectiv | `ab -n 500 -c 50 https://prod/api/v1/rnpm/search` | 429 după prag, nu 5xx |
| CSP & secureHeaders prezente în prod | curl response headers | CSP strict, no `unsafe-inline` |
| AI multi-agent budget enforcement | scriptat: 3 calls paralel cu budget aproape epuizat | exact unul trece, restul 402 quota |

---

## 5. Auto-Generated Artefacts

| Fișier | Checkpoint | Descriere |
|--------|-----------|-----------|
| `audit/AUDIT-FINAL-FULL-PROJECT-v2.33.0-2026-05-19.md` | meta | acest raport |
| (pending — Codex async) | P0-4 | verificare independentă oauth2-proxy + reservation math |

---

## 6. Launch Readiness Verdict

🟡 **CONDITIONAL — DO NOT SHIP PRODUCTION WEB MODE FĂRĂ:**

1. **P0-1** (me.ts plaintext email în audit_log) — fix obligatoriu, GDPR.
2. **P0-2** (auditRepository.serializeDetail unbounded) — cap la 16KB.
3. **P0-3** (AI reservation race + purge mismatch) — tranzacție atomic + purge 60s.
4. **P0-4** (oauth2-proxy trust boundary) — așteaptă verdict codex; aplică mitigarea dacă pică.
5. **P1-3** (pagination uncapped) — fix trivial, dar high impact.
6. **P1-4** (per-user captcha cap) — protejează tenant admin de un user runaway.
7. **Rollback runbook scris + APM setat + offsite backup automation**.

**Desktop mode rămâne 🟢 GO** — toate P0-urile sunt web-only (quotaGuard scurt-circuitează în desktop, audit log nu e expus admin tenant într-un context multi-tenant, oauth2-proxy nu se aplică).

**Estimat total remediere**: 5-7 zile focalizate (≈40-55h dev) + 1-2 zile verificare + smoke + staging.

**Recomandare cutover web**: 2026-05-26 - 2026-05-29 (8 zile) ca fereastră realistă, condiționat de fix-urile de mai sus.

---

## 7. Cross-validated findings — referință rapidă (≥2 agenți independent)

| Finding | Agenți | Severity |
|---------|--------|----------|
| me.ts:254 plaintext email | audit-trail + data-validation | P0 |
| auditRepository serializeDetail unbounded | audit-trail + backend-reliability | P0 |
| AI reservation double-count | fraud-control + backend-reliability | P0 |
| Reservation purge 24h vs 5min | fraud-control + release-readiness | P0 |
| oauth2 X-Forwarded-Email fallback | fraud-control + repo-security | P0 |
| tenantKeys cache no TTL | backend-reliability + database-change | P1 |
| owner_id DEFAULT 'local' web mode | database-change + data-validation | P1 |
| Pagination uncapped saved/searches | api-contract (implicit) + backend-reliability | P1 |
| Per-user captcha cap missing | fraud-control + release-readiness | P1 |
| Scheduler outside lock | backend-reliability + database-change | P1 |
| Alert dispatch outside tx | backend-reliability + audit-trail | P1 |
| CI fixture secrets hardcoded | dependency-security + repo-security | P1 |
| No APM / no rollback runbook | release-readiness (sole) | P1 launch |

---

## 8. Apendice — ce s-a verificat & confirmat curat

- **Tenant key encryption**: AES-256-GCM cu `TENANT_KEY_ENCRYPTION_SECRET` (32B base64); audit log NU primește plaintext (doar last4, hadPrevious, field, validationSkipped, emailHash SHA-256 prefix 16 hex).
- **Desktop ZERO impact**: `quotaGuard` no-op când `getAuthMode() !== "web"`. Toate path-urile noi v2.33.0 sunt gated.
- **Web-mode 501 gate**: `rejectCaptchaKeyInWebMode()` activ pe POST `/rnpm/search`/`/bulk`/`/captcha/balance`.
- **Repository-only DB access**: SQL raw doar în `backend/src/db/**`. Spot-check pe rute confirmat.
- **CSP strict** + `secureHeaders` + `safeStorage` IPC + single-instance lock + crash handlers — toate active.
- **FX BCE auto-only**: manual entry interzis; D14 fail-closed EUR fără fallback 0.92.
- **LAN bind opt-in**: `LEGAL_DASHBOARD_ALLOW_REMOTE=1` + `LEGAL_DASHBOARD_ACK_NO_AUTH` required.
- **XLSX formula-injection escape** (`=+-@\t\r` → prefix `'`).
- **External URL whitelist** exact pe portal.just.ro, www.just.ro, portalquery.just.ro, mj.rnpm.ro, www.rnpm.ro.
- **Backup atomic** + pre-migration backup generic la fiecare schema upgrade.
- **SOAP cancellation** AbortSignal extern + timeout intern 60s.

---

**Status final**: 🟡 CONDITIONAL pentru web; 🟢 GO pentru desktop. Lista de mai sus e prioritizată — execută top-down, retestează după fiecare fix, refă smoke staging cu config Caddy real înainte de cutover.

---

## 10. Corrigenda post-Codex external review (2026-05-20)

Codex (agent ID `ad85e78014c5edcd2`) a verificat fiecare finding pe codul actual din `main` (commit `3a32d5f`). User a confirmat **single-tenant multi-user** ca model de deploy (nu SaaS multi-tenant).

### 10.1 Schimbari de verdict / locatie

| Finding original | Verdict Codex | Detaliu |
|------------------|---------------|---------|
| **P0-1** plaintext email | ✅ CONFIRMAT, **locatie corectata** | Endpoint real: `me.email_settings.update` pe `backend/src/routes/me.ts:248-257` (nu `self_update_profile`). Payload-ul `before/after` include `toAddress` brut. **Fix imbunatatit**: hash/last4 + **whitelist explicit campuri auditabile**, nu serializa `before/after` raw. |
| **P0-2** serializeDetail unbounded | ✅ CONFIRMAT integral | Cap 16KB — DA |
| **P0-3** AI reservation double-count | ⚠️ **DOWNGRADE la P1** | Race-ul double-count e **deja INCHIS** prin tranzactia `.immediate()` in `backend/src/middleware/quotaGuard.ts:140-155` (check `sumAiUsageMilliInWindow` + `insertAiUsageReservation` atomic). Ramane **doar purge mismatch** 24h vs 5min expiry → P1 operational. |
| **P0-4** oauth2 trust boundary | ⚠️ **DOWNGRADE la P1** | `timingSafeEqual` exista in `auth.ts:121`; `deploy/Caddyfile` strip-uieste headers externe. **Fragilitate reziduala**: `auth.ts:149` cade pe `c.req.header("x-forwarded-email")` daca Caddy e misconfigurat. **Fix**: elimina fallback-ul din backend, nu doar documenteaza. |
| **P1-1** tenantKeys cache no TTL | ✅ CONFIRMAT (`tenantKeysRepository.ts:48-61`) | TTL 60s + invalidate pe write — DA |
| **P1-2** `owner_id DEFAULT 'local'` | ⚠️ **Downgrade severitate** | In single-tenant nu mai e "leak inter-firme", e doar **igiena user-isolation** (un user vede ce e al lui in saved/searches). Fix util dar nu blocker launch. |
| **P1-3** pagination uncapped | ✅ CONFIRMAT (`rnpm.ts:761-772, 1068`) | `pageSize` / `limit` neclamp-uiti server-side. Cap 200 — DA |
| **P1-4** per-user captcha cap | ✅ CONFIRMAT (`rnpmGuards.ts:109-121`) | Tenant key resolved fara contor per user — un user singur poate epuiza budget firmei. |
| **P1-5** scheduler outside lock | ⚠️ PARTIAL, **locatie corectata** | `runJobNow` foloseste `withMaintenanceRead` (READ-lock, NU exclusiv) in `scheduler.ts:264`; `fxFetcher.ts:87` face DB write **fara nici un lock**. Fix: exclusive lock doar pe sectiunile DB critice, nu pe fetch extern. |
| **P1-6** alert dispatch outside tx | ✅ CONFIRMAT (`alertEventService.ts:64-68`) | `queueMicrotask` dispatch — outbox pattern OK. |
| **P1-7** CI fixtures hardcoded | ✅ CONFIRMAT (`docker-build.yml:89,92`) | Muta in GitHub repo secrets. |
| **P1-8** APM / runbook / offsite | ✅ CONFIRMAT | `backend/src/db/backup.ts:48-74` are doar local 7-day retention; zero Sentry/Rollbar in `package.json`. |

### 10.2 Finding ratat de panel — verificat Codex

🆕 **P1-NEW: `tenant_api_keys` singleton** — *Codex flagged, dar **invalid pentru modelul nostru***
- **Locatie**: `backend/src/db/migrations/0026_tenant_api_keys.up.sql:3-5` — `scope TEXT PRIMARY KEY CHECK(scope='tenant')` (un singur rand fizic in DB).
- **Codex ipoteza**: ar fi P1 in SaaS multi-tenant (al doilea tenant suprascrie cheile primului).
- **Realitate confirmata user 2026-05-20**: aplicatia e **single-tenant multi-user** — singleton e design corect (admin firmei seteaza cheile o singura data, toti userii consuma).
- **Verdict final**: ❌ **ANULAT** — nu e finding. Documenteaza explicit modelul "single-tenant multi-user" in `SECURITY.md` ca sa eviti confuzia la audit-uri viitoare.

### 10.3 Findings deja inchise inainte de audit

- ✅ **Race AI reservation** (raportul initial il punea P0): `quotaGuard.ts:140-155` are tranzactie `.immediate()` corecta. Doar purge interval ramane.
- ✅ **oauth2-proxy secret check**: `timingSafeEqual` deja folosit in `auth.ts:121`.
- ✅ **Caddy header strip**: `deploy/Caddyfile` are `header_up -X-Forwarded-*` (verificat in repo).

### 10.4 Lista MINIMA non-negociabila revizuita pentru cutover web

Ordine de executie sugerata (blast radius + dependenta):

| # | Cod | Locatie | Fix | Est |
|---|-----|---------|-----|-----|
| 1 | P0-1 | `backend/src/routes/me.ts:248-257` | Whitelist campuri auditabile + hash/last4 pe email; nu serializa `before/after` raw | 1.5h |
| 2 | P0-2 | `backend/src/db/auditRepository.ts:32-40` | Cap 16KB cu `_truncated` marker pe `serializeDetail` | 30min |
| 3 | P1-purge (ex P0-3) | `backend/src/index.ts` (purge job) | Reservation purge interval scade de la 24h la 60s | 30min |
| 4 | P0-4-edit | `backend/src/routes/auth.ts:149` | Elimina fallback `c.req.header("x-forwarded-email")`; cere strict header validat post-secret-check | 45min |
| 5 | P1-3 | `backend/src/routes/rnpm.ts:761-772, 1068` | Clamp `pageSize`/`limit` server-side max 200, ignora client override peste cap | 1h |
| 6 | P1-4 | `backend/src/routes/rnpmGuards.ts` + migrație noua | Per-user-per-day captcha quota (default 50, configurabil `/admin/quota`) | 4h |
| 7 | P1-6 | `backend/src/services/alerts/alertEventService.ts:64` | Outbox pattern: insert pending → cron picks up post-commit | 3h |
| 8 | P1-5 | `scheduler.ts:264` + `fxFetcher.ts:87` | Exclusive maintenance lock pe `runJobNow` + `upsertFxRate` | 2h |
| 9 | P1-1 | `backend/src/db/tenantKeysRepository.ts:48` | TTL 60s + invalidate pe write | 1h |
| 10 | P1-7 | `.github/workflows/docker-build.yml:89,92` | Muta fixtures in GitHub repo secrets | 30min |
| 11 | P1-8 | `RUNBOOK.md` + Sentry SDK + backup script | Rollback runbook + APM + offsite backup automation (S3/rclone) | 1-2 zile |
| 12 | P1-2 | repositories cu `owner_id` write paths | Runtime guard `assert(ownerId && ownerId !== "local")` in web mode — igiena | 4h |

**Estimat total**: ~3 zile dev focalizat (24h activa) pentru #1-#10, +1-2 zile pentru #11, +0.5 zile pentru #12 → **realist 5 zile** pana la cutover, +1 zi staging smoke.

### 10.5 Verdict final consolidat (post-Codex)

🟡 **CONDITIONAL pentru web** — lista §10.4 e MINIMA, nu opționala. Daca timpul preseaza, #11 (APM + runbook) poate ramane in primele 24h post-launch cu plan documentat. Restul (#1-#10, #12) trebuie inchise pre-launch.

🟢 **GO pentru desktop** — toate gap-urile sunt web-only sau gated de `quotaGuard` no-op desktop.

**Cutover realist**: 2026-05-25 → 2026-05-27 (5-6 zile lucrate de la 2026-05-20).
