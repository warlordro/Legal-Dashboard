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

## Batch 0 — Docs & .env hygiene (LOW risk, 30min)

Target release: **v2.20.4**.

- [ ] **`.env.example`** — adauga `RNPM_AUDIT_CAP_HIT_DISABLED=` (OPTIONAL — disable cap-hit audit for legacy ingestion). Cod-ul foloseste deja flagul, doar documentatia lipseste.
- [ ] **`.env.example`** — adauga `DAILY_REPORT_HOUR=` (OPTIONAL — hour 0-23 pentru raportul de monitoring; default 8).
- [ ] **`.env.example`** — adauga `MIGRATIONS_STRICT=` (OPTIONAL — `1` = abort la sha mismatch fara self-heal).
- [ ] **`.env.example`** — comentariu pentru `RNPM_SITEKEY=` ca e public hCaptcha sitekey, NU secret.
- [ ] **`CLAUDE.md`** — actualizeaza "Migrations in `backend/src/db/migrations/` (latest 0016)" -> `0017`.
- [ ] **`README.md`** — sanity-check ca lista env vars din setup este sincronizata cu `.env.example` final.

**Risc modificare:** zero — doar docs. **Mitigare:** review prin `Grep -i "process.env"` sa confirm 1:1 cu `.env.example`.

---

## Batch 1 — API envelope consistency (MED risk, 2-3h)

Target release: **v2.20.4**.

Standard envelope (din v2.14.0): `{ data: T | null, error: { code, message } | null, requestId }`. Mai multe rute returneaza inca shape-uri legacy.

- [ ] **`backend/src/middleware/requireRole.ts:35-60`** — 401/403 returneaza `{ error: { code, message } }` fara `data: null` si fara `requestId`. Foloseste `fail()` din `util/envelope.ts`.
- [ ] **`backend/src/routes/rnpm.ts:108-117`** — web-mode 501 returneaza raw `{ error: "..." }`. Migreaza la `fail("WEB_MODE_NOT_SUPPORTED", "...")`.
- [ ] **`backend/src/routes/ai.ts`** — verifica raspunsurile error pentru aceeasi inconsecventa (toate caile 4xx/5xx).
- [ ] **`backend/src/middleware/bodyTooLarge.ts`** (sau echivalent) — 413 raspunde cu envelope-ul standard.
- [ ] **Pagination 400 vs 422** — `page=0` raspunde 400 cu cod `INVALID_PAGE`; alinieaza-l cu envelope.
- [ ] **Captcha balance** — `400 INSUFFICIENT_FUNDS` ar trebui sa fie `503 SERVICE_UNAVAILABLE` cu envelope (nu e fault de input).
- [ ] **Zod 422 -> 400** — schimba `422` pe validation errors la `400 VALIDATION_ERROR` ca sa eliminam doua coduri pentru acelasi caz.

**Risc modificare:** MEDIU — schimba shape-ul de eroare consumat de UI. **Mitigare:** (a) frontend deja are helper care citeste `error.message` cu fallback; (b) adauga test integration per ruta care verifica `data: null` + `requestId` prezente; (c) deploy in v2.20.4 cu rollback rapid pe localStorage daca apar regressii UX.

---

## Batch 2 — Operator visibility (MED risk, 2h)

Target release: **v2.20.4**.

- [ ] **`backend/src/services/monitoring/nameSoapRunner.ts:185-209`** — `failedInstitutii` doar `console.warn`. Emite alert kind `source_partial` (sau extinde unul existent) ca operatorul sa vada partial-success in UI Alerts.
- [ ] **`backend/src/db/migrate.ts` (fatalBoot path)** — adauga `preMigrationBackup("schema-upgrade")` inainte de `process.exit(1)` ca operatorul sa aiba timestamped DB la troubleshoot.
- [ ] **`/health` endpoint** — expune `emailConfigured: boolean` (deriv din `SMTP_HOST` prezent) ca admin sa vada explicit daca alertele email sunt active.
- [ ] **`backend/src/db/backup.ts:326-345`** — auto-revert face copyFile doar pe `.db`, lasa `-wal`/`-shm` orfane. Adauga cleanup explicit + comment.
- [ ] **VACUUM splash UX** — operatiunea blocheaza UI; afiseaza splash/progress in renderer cand ruleaza compactare.

**Risc modificare:** SCAZUT-MEDIU. Schimbarea pe `nameSoapRunner` poate genera spam de alerte la prima rulare daca multe institutii sunt down — debounce per `(jobId, institutie)` sau rate-limit la X/zi. **Mitigare:** feature flag `MONITORING_PARTIAL_ALERTS_ENABLED=1` la rollout, monitorizat 24-48h.

---

## Batch 3 — RNPM trust hardening (MED-HIGH risk, 4-6h)

Target release: **v2.21.0** (eject din v2.20.4 ca sa testam izolat).

- [ ] **`backend/src/services/rnpmClient.ts:232`** — `return await res.json() as RnpmSearchResult` e doar TypeScript cast, fara validare runtime. Adauga `RnpmSearchResultSchema = z.object({...}).passthrough()` + `safeParse` cu warning log la rollout, apoi `parse` (throw) dupa 1 release stabil.
- [ ] **`backend/src/services/rnpmSearchService.ts:211`** — `firstResult.total > MAX_TOTAL_RESULTS` (1500) — daca `total` e `undefined`, comparatia e `false` si bypass-eaza guardul. Adauga `typeof firstResult.total === "number"` type-guard explicit.
- [ ] **`backend/src/services/rnpmAvizMapper.ts:237`** — `activ: typeof part1.activ === "boolean" ? part1.activ : (doc.activ ?? true)`. Default `true` pe necunoscut e dezinformant. Decizie de luat: (a) `null` cu UI "necunoscut" sau (b) `false` (mai conservator). **Recomandare:** `null` + tag UI, ca nu pierdem signal.
- [ ] **`backend/src/routes/rnpm.ts:91-94`** — `parseClientRequestId` accepta `:` ca separator dar standardul (alte module) folosesc doar alfanumerice + `-`/`_`. Decide: scrub `:` sau aliniaza toate modulele la acelasi regex.
- [ ] **Captcha charset validation** — input fields permit caractere nestandard. Adauga whitelist alfanumeric + `-_` + length cap (la max ce serviciul accepta).
- [ ] **SOAP response cap** — adauga `Content-Length` check inainte de `await res.text()` (cap la 8MB) pentru a preveni DoS la upstream raw.
- [ ] **XLSX export formula prefix** — verifica ca toate cele 5-7 caractere vulnerabile (`=+-@\t\r`) sunt prefixate cu `'`; audit prin Grep.

**Risc modificare:** MEDIU-RIDICAT — schimba comportament observabil (default `activ`, validare runtime poate respinge raspunsuri valide nevazute inainte). **Mitigare:**
- 2-stage rollout pentru Zod schema: (1) `safeParse` + log warning fara block, (2) `parse` cu fail loud dupa 1 sprint observat.
- Default `activ: null` rendere UI "necunoscut" — adauga test snapshot pentru ambele cazuri (cunoscut, necunoscut).
- Feature flag `RNPM_RUNTIME_VALIDATION_ENFORCED=1` pentru transition phase.

---

## Batch 4 — Scheduler & captcha reliability (MED risk, 3h)

Target release: **v2.20.4**.

- [ ] **`backend/src/services/monitoring/scheduler.ts:302`** — `void this.runOne(job, runId, nowIso)` fire-and-forget fara `.catch`. Inlocuieste cu `.catch((err) => { auditLog(...); markRunFailed(runId) })` ca erorile uncaught sa nu lase run-uri "stuck".
- [ ] **`backend/src/services/captchaSolver.ts:220-229`** — `getBalance()` helpers nu au timeout/AbortSignal. Adauga `AbortSignal.timeout(15_000)` sa nu bloce admin requests indefinit.
- [ ] **`backend/src/services/captchaSolver.ts:106-107`** — race mode: sleep loop are `signal.aborted` check DUPA sleep. Foloseste `Promise.race([sleep, signalPromise])` ca abort-ul sa fie imediat.
- [ ] **Daily report scheduler** — daca emailul esueaza, retry cu exponential backoff (3 incercari, 5min/15min/45min) inainte sa picteze run-ul ca `failed`.
- [ ] **`backend/src/middleware/rate-limit.ts:65`** — cleanup ruleaza doar la threshold; adauga periodic sweep (`setInterval` 5min) pentru caz bursty + idle.

**Risc modificare:** SCAZUT-MEDIU. **Mitigare:** scheduler `.catch` audit logging trebuie sa includa `jobId` + `runId` + `error.message` (nu stack complet) pentru ca tabela `monitoring_runs` sa nu se umple cu zgomot.

---

## Batch 5 — DB migrations & retention (MED risk, 2-3h)

Target release: **v2.21.0** (impreuna cu Batch 3).

- [ ] **`backend/src/db/monitoringRunsRepository.ts:147-153`** — `DELETE FROM monitoring_runs WHERE started_at < ?` ruleaza unbounded zilnic la 90 zile retention. Pe DB-uri mari (100k+ runs) blocheaza. **Decizie:** (a) split in migration noua + chunked purge (`LIMIT 1000` in loop) sau (b) doar adauga index. **Recomandare:** combinat — Migration 0018 cu `CREATE INDEX IF NOT EXISTS idx_monitoring_runs_started_at` + chunked purge in repository.
- [ ] **9 migrations fara `.down.sql`** — Migrations 0002..0017 cu exceptia 0001_baseline; adauga macar stub `DELETE FROM _schema_versions WHERE version = N;` daca rollback adevarat e prea complex.
- [ ] **`0001_baseline.down.sql`** — adauga macar stub care arunca eroare explicita "baseline cannot be rolled back, restore from backup".

**Risc modificare:** MEDIU — orice schimbare in migrations atinge boot-ul. **Mitigare:**
- Pre-migration backup deja exista (v2.16.1) pentru rebuild-uri.
- Testeaza Migration 0018 pe DB-ul de productie copy local cu 100k+ runs sintetice.
- Adauga test E2E care ruleaza migrations + rollback in `vitest`.

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
3. **Migration 0018** — combined (index + chunked purge) vs split (doar index acum, purge in 0019). Impact: durata 1 release.
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
