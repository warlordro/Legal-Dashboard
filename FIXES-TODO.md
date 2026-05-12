# FIXES-TODO — Backlog din /full-review v2.20.3

**Sursa:** [.claude/reviews/e62d1c6.md](.claude/reviews/e62d1c6.md) — review multi-agent rulat 2026-05-10 pe SHA `e62d1c6`.
**Verdict review:** CONDITIONAL — desktop v2.20.3 shippable, web cutover nu e gata, zero BLOCKERs.
**Status backlog:** activ. Bifeaza fiecare item cu file:line + commit SHA in PR.

## Legenda severitate

| Symbol | Sens | Trigger |
|---|---|---|
| HIGH | risk reliability / security la prod | fix inainte de prod |
| MED | UX bugs / loguri slabe / cuplaj modest | fix inainte de utilizatori reali |
| LOW | naming / style / nits | nice-to-have |

## Strategie de release propusa

| Versiune | Batch incluse | Tema | Risc agregat |
|---|---|---|---|
| v2.20.4 | 0, 1, 2, 4 | Docs + envelope + observabilitate operator + scheduler/captcha | redus |
| v2.21.0 | 3, 5 | RNPM trust + DB migrations | mediu (touch hot path RNPM + migrations) |
| v2.22.0 | 7, 8 | Supply chain + polish | redus |
| (roadmap) | 6 | Web cutover (PR-9 / PR-11) | tracked separat in EXECUTION-ROADMAP.md |

---

## Batch 0 — Docs & .env hygiene (LOW risk, 30min) ✅ DONE in v2.20.6

Target release: **v2.20.6** (LIVRAT).

- [x] **`.env.example`** — recreat de la zero cu toate cele ~25 env vars folosite in cod (nu doar incremental — fisierul nu exista). Include `RNPM_AUDIT_CAP_HIT_DISABLED`, `DAILY_REPORT_HOUR`, `MIGRATIONS_STRICT`, plus comentariul ca `RNPM_SITEKEY` este public hCaptcha sitekey, NU secret.
- [x] **`CLAUDE.md`** — actualizat "Migrations in `backend/src/db/migrations/` (latest 0016)" -> `0017`.
- [x] **`README.md`** — env vars sectiune sincronizata cu `.env.example` final.

**Risc modificare:** zero — doar docs. **Status:** LIVRAT v2.20.6.

---

## Batch 1 — API envelope consistency (MED risk, 2-3h) — partially DONE

Target release: **v2.20.6 (1.1 only)** + **PR-6** (rest deferred).

Standard envelope (din v2.14.0): `{ data: T | null, error: { code, message } | null, requestId }`. Mai multe rute returneaza inca shape-uri legacy.

- [x] **`backend/src/middleware/requireRole.ts:35-60`** — 401/403 returneaza acum `fail()` cu `data: null` + `requestId`. ✅ LIVRAT v2.20.6 (Batch 1.1).
- [ ] **DEFER PR-6** — **`backend/src/routes/rnpm.ts:108-117`** — web-mode 501 returneaza raw `{ error: "..." }`. Migrare blocata de `rnpm.contract.test.ts` care asertea `expect(typeof body.error).toBe("string")` ca guard de migrare; `util/envelope.ts` cere migrare one-shot odata cu `@hono/zod-openapi`.
- [ ] **DEFER PR-6** — **`backend/src/routes/ai.ts`** — toate caile 4xx/5xx legacy.
- [ ] **DEFER PR-6** — **`bodyTooLarge` 413** in `rnpm.ts` + `termene.ts` — raw `{ error: "Payload prea mare" }`.
- [ ] **DEFER PR-6** — **Pagination 400 vs 422** — `page=0` raspunde 400 cu cod `INVALID_PAGE`; alinieaza-l cu envelope.
- [ ] **DEFER PR-6** — **Captcha balance** — `400 INSUFFICIENT_FUNDS` ar trebui `503 SERVICE_UNAVAILABLE` cu envelope.
- [ ] **DEFER PR-6** — **Zod 422 -> 400** — alineaza la `400 VALIDATION_ERROR`.

**Risc modificare:** MEDIU — schimba shape-ul de eroare consumat de UI. **Decizie 2026-05-10 (v2.20.6):** singura migrare facuta in afara PR-6 e `requireRole.ts` (admin guard) pentru ca pre-migration shape-ul era deja `{ error: { code, message } }` raw — schimbarea la `fail()` e strict aditiva (`data: null` + `requestId` adaugate). Migrarea pe rute care emit raw `{ error: "..." }` (string) ar sparge `rnpm.contract.test.ts` si frontend client (`api.ts` fallback dual-shape NU e o invitatie la migrare incrementala — e doar safety net pentru PR-6). Restul Batch-ului 1 ramane in PR-6 (`@hono/zod-openapi`).

---

## Batch 2 — Operator visibility (MED risk, 2h) ✅ DONE in v2.20.8

Target release: **v2.20.8** (LIVRAT).

- [x] **`backend/src/services/monitoring/nameSoapRunner.ts`** — emis alert `source_partial` cu severity `warning` cand cel putin o institutie esueaza dar restul reusesc, in spate de feature flag `MONITORING_PARTIAL_ALERTS_ENABLED=1` (default OFF, 24-48h observatie). ✅ LIVRAT v2.20.8.
- [x] **`backend/src/db/migrate.ts` (fatalBoot path)** — adaugat `preMigrationBackup("schema-upgrade")` inainte de `process.exit(1)`. ✅ LIVRAT v2.20.8.
- [x] **`/health` endpoint** — expune acum `emailConfigured: boolean` derivat din `SMTP_HOST`. ✅ LIVRAT v2.20.8.
- [x] **`backend/src/db/backup.ts`** — auto-revert face acum cleanup explicit pe `-wal`/`-shm` orfane. ✅ LIVRAT v2.20.8.
- [x] **VACUUM splash UX** — splash full-screen blocking (`role="alertdialog"`, `aria-busy`) peste Baza locala RNPM in timpul `POST /compact`; ESC/backdrop/X-button blocate. ✅ LIVRAT v2.20.8.

**Risc modificare:** SCAZUT-MEDIU. **Status:** LIVRAT v2.20.8. Feature flag `MONITORING_PARTIAL_ALERTS_ENABLED=1` ramane OFF default; flip dupa 24-48h observatie.

---

## Batch 3 - RNPM trust hardening (MED-HIGH risk, 4-6h) - partially DONE in v2.21.0

Target release: **v2.21.0** (eject din v2.20.4 ca sa testam izolat).

- [x] **`backend/src/services/rnpmClient.ts:232`** - `return await res.json() as RnpmSearchResult` era doar TypeScript cast, fara validare runtime. Adaugat `RnpmSearchResultSchema` Zod cu `safeParse` + warning si fail-loud optional prin `RNPM_RUNTIME_VALIDATION_ENFORCED=1`. DONE v2.21.0.
- [x] **`backend/src/services/rnpmSearchService.ts:211`** - `firstResult.total > MAX_TOTAL_RESULTS` (1500) bypass-a guardul cand `total` era `undefined`. Adaugat `typeof firstResult.total === "number"` type-guard explicit. DONE v2.20.9.
- [x] **`backend/src/services/rnpmAvizMapper.ts:237`** - default `activ: true` pe necunoscut era dezinformant. Implementat `activ: null`, UI/export "Necunoscut" si persistenta DB fara coercitie la `1`. DONE v2.21.0.
- [ ] **`backend/src/routes/rnpm.ts:91-94`** - `parseClientRequestId` accepta `:` ca separator dar standardul (alte module) folosesc doar alfanumerice + `-`/`_`. Decide: scrub `:` sau aliniaza toate modulele la acelasi regex.
- [ ] **Captcha charset validation** - input fields permit caractere nestandard. Adauga whitelist alfanumeric + `-_` + length cap (la max ce serviciul accepta).
- [x] **SOAP response cap** - adaugat `Content-Length` check inainte de `await res.text()` (cap la 8MB) pentru a preveni DoS la upstream raw. DONE v2.20.9.
- [x] **XLSX export formula prefix** - verificat prin sentinel test ca toate caracterele vulnerabile (`=+-@\t\r`) sunt prefixate cu `'`. DONE v2.20.9.

**Risc modificare:** MEDIU-RIDICAT - schimba comportament observabil (default `activ`, validare runtime poate respinge raspunsuri valide nevazute inainte). **Mitigare:**
- 2-stage rollout pentru Zod schema: (1) `safeParse` + log warning fara block, (2) `parse` cu fail loud dupa 1 sprint observat.
- Default `activ: null` rendere UI "necunoscut" - adauga test snapshot pentru ambele cazuri (cunoscut, necunoscut).
- Feature flag `RNPM_RUNTIME_VALIDATION_ENFORCED=1` pentru transition phase.

---
## Batch 4 — Scheduler & captcha reliability (MED risk, 3h) ✅ DONE in v2.20.8

Target release: **v2.20.8** (LIVRAT).

- [x] **`backend/src/services/monitoring/scheduler.ts`** — fire-and-forget `void this.runOne(...)` are acum `.catch` care logheaza jobId + runId + `error.message` (fara stack). ✅ LIVRAT v2.20.8.
- [x] **`backend/src/services/captchaSolver.ts` getBalance** — adaugat `AbortSignal.timeout(15_000)` pe ambele helpere (2Captcha + CapSolver). ✅ LIVRAT v2.20.8.
- [x] **`backend/src/services/captchaSolver.ts` race-mode sleep** — sleep-ul din poll-ul `getResult` foloseste acum `Promise.race([sleep, signalPromise])`. ✅ LIVRAT v2.20.8.
- [x] **Daily report scheduler retry cu backoff** — pana la 3 incercari cu backoff `[5min, 15min, 45min]`, audit `retry_exhausted` dupa epuizare. State `Map<ownerId, retryState>` in-memory. ✅ LIVRAT v2.20.8.
- [x] **`backend/src/middleware/rate-limit.ts`** — adaugat `setInterval(5min)` periodic sweep pe langa cleanup-ul threshold-based existent. ✅ LIVRAT v2.20.8.

**Risc modificare:** SCAZUT-MEDIU. **Status:** LIVRAT v2.20.8. Scheduler `.catch` logging include `jobId` + `runId` + `error.message` (fara stack), ca tabela `monitoring_runs` sa nu se umple cu zgomot.

---

## Batch 5 - DB migrations & retention (MED risk, 2-3h) DONE in v2.21.0

Target release: **v2.21.0** (impreuna cu Batch 3).

- [x] **`backend/src/db/monitoringRunsRepository.ts:147-153`** - `DELETE FROM monitoring_runs WHERE started_at < ?` ruleaza acum chunked (`LIMIT 1000` default) cu safety cap 1M randuri per apel. Adaugata migration 0019 `idx_monitoring_runs_started_at` pentru cursorul de retention. DONE v2.21.0.
- [x] **Migration down consistency** - 0002..0018 au perechi `.down.sql` existente; testul runner-ului acopera prezenta perechilor. VALIDAT v2.21.0.
- [x] **`0001_baseline.down.sql`** - adaugat sentinel explicit care arunca eroare "baseline cannot be rolled back, restore from backup". DONE v2.21.0.

**Risc modificare:** MEDIU - orice schimbare in migrations atinge boot-ul. **Mitigare:**
- Pre-migration backup deja exista (v2.16.1) pentru rebuild-uri.
- Testeaza Migration 0019 pe DB-ul de productie copy local cu 100k+ runs sintetice.
- Testeaza migration runner + down-file consistency in `vitest`.

---
## Batch 6 — Web cutover prerequisites (out of scope acum)

Tracked in **`EXECUTION-ROADMAP.md`** sub PR-9 si PR-11. Nu duplicam aici.

Highlights din review (de mentionat in PR-uri cand le atingi):
- Per-user secret storage server-side (RNPM captcha keys) — astazi blocat de `rejectCaptchaKeyInWebMode()`.
- SSO Workspace gating cu `owner_id` real (nu `'local'`).
- Litestream / GCS backup — eliminat din scope (vezi memory `project_pr10_pr12_eliminated`).
- CSP recheck pentru web mode (relax `'self'` doar daca strict necesar).

---

## Batch 7 — Supply chain hardening (LOW risk, 1-2h)

Target release: **v2.22.0**.

- [ ] **`.github/workflows/build-windows.yml` + `build-mac.yml`** — pin la SHA pentru `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `softprops/action-gh-release` (exemplu: `actions/checkout@<sha> # v6.0.0`). Mutable tags `@v6` pot fi mutate.
- [ ] **`Dockerfile`** — pin base image la digest (`node:22-alpine@sha256:...`) in loc de tag.
- [ ] **Migrare `xlsx` -> `xlsx-js-style`** — `xlsx` are CVE-uri vechi; `xlsx-js-style` e fork mentinut. Verifica daca usage actual e deja pe `xlsx-js-style` (din `CLAUDE.md` da, dar audit inca o data).
- [ ] **`npm audit --omit=dev`** — ruleaza si fixeaza ce ramane HIGH/CRITICAL inainte de release.

**Risc modificare:** SCAZUT. **Mitigare:** SHA pin nu schimba comportament; adauga in CHANGELOG nota despre cum se face refresh la SHA-uri (renovate/dependabot).

---

## Batch 8 — Polish (LOW risk, 2h)

Target release: **v2.22.0**.

- [ ] **PRAGMA gate Phase 2** — verifica daca `journal_mode=WAL` + `synchronous=NORMAL` sunt aplicate consecvent la boot in toate code-paths (in-process electron, standalone backend, tests).
- [ ] **`dotenv override:false`** — la `dotenv.config({ override: false })` ca sa nu suprascrie env-ul OS care e prioritar in prod.
- [ ] **WAL cleanup ENOENT-only** — la shutdown, `fs.unlink` pe `-wal`/`-shm` ar trebui sa swallow doar ENOENT, nu orice eroare.
- [ ] **Sitekey / UA env-ify** — hardcoded values pentru hCaptcha sitekey + User-Agent ar trebui in env (nu pentru secret, ci pentru tunnig fara rebuild).
- [ ] **SOAP CDATA TODO** — verifica TODO-urile lasate in `soap.ts` pentru CDATA edge cases.

**Risc modificare:** ZERO-SCAZUT. **Mitigare:** doar runs full vitest + smoke desktop.

---

## Decizii pendente (nu blocheaza inceputul Batch 0+1+2)

Aceste 4 alegeri trebuie facute inainte de v2.21.0; pana atunci pot ramane TBD:

1. **`activ` default** — `null` cu UI "necunoscut" (recomandare review) vs `false` (conservator). Impact: snapshot tests + UI legends.
2. **Zod schema RNPM** — 2-stage rollout (safeParse+warn -> throw) vs immediate throw. Impact: risc de a respinge raspunsuri valide nevazute.
3. **Migration 0019** - resolved in v2.21.0: index + chunked purge in acelasi release.
4. **`source_partial` alert kind** — include in v2.20.4 batch 2 sau decuplat? Impact: UI Alerts schema + traduceri.

---

## Cum se inchide un item

Un item se considera inchis cand:
1. Codul e merged in `main` cu commit SHA + PR # mentionate.
2. Test integration (cand aplicabil) acopera comportamentul nou.
3. Daca atinge env vars / docs, sanity check cu `Grep` pentru consistenta.
4. La release bump (vezi `CLAUDE.md` "Checklist bump de versiune"), bifeaza intrarea aici cu commit-ul.

## Re-running /full-review

Ruleaza `/full-review` din nou pe SHA-ul tinta dupa fiecare batch livrat ca sa verifici carry-forward (Resolved / Still present / Stale). Synthesis se salveaza in `.claude/reviews/<sha>.md`.
