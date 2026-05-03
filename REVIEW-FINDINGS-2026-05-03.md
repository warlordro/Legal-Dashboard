# Full Review Findings — 2026-05-03

Review type: `/full-review` (8 paralel agents) pe diff-ul necomis curent.
Branch: `main` (uncommitted working tree).
Predecesor commit: `ee2bbed` (v2.10.4).

## Scope diff

Modificari: 8 fisiere modificate + 3 fisiere noi netracked.

**Backend (refactor pur):**
- `backend/src/util/textNormalize.ts` — adaugat helper `buildRnpmLikePattern(q)` ce produce `%${stripDiacritics(q).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`.
- `backend/src/db/avizRepository.ts:362` — folosit helperul.
- `backend/src/db/monitoringAlertsRepository.ts:293` — folosit helperul.
- `backend/src/db/monitoringJobsRepository.ts:198` — folosit helperul.
- `backend/src/services/nameListParser.ts` — comment-only refresh.

**Frontend (refactor + extragere componente):**
- `frontend/src/hooks/useDebouncedValue.ts` (nou) — debounce hook cu callback `onSettle` ce evita cascada `setDebouncedQuery → fetch(currentPage) → setPage(0) → fetch(0)`.
- `frontend/src/components/monitoring/JobKindTabs.tsx` (nou) — tab-bar `Toate / Dosare / Nume` extras din `Alerts.tsx` + `Monitorizare.tsx`.
- `frontend/src/pages/Alerts.tsx` — consuma extragerile; `setPage(0)` inline pe fiecare setter de filtru.
- `frontend/src/pages/Monitorizare.tsx` — idem.
- `frontend/src/lib/alertsApi.ts:113` — `q` trim defensiv inainte de URL encode.

**Dev tooling:**
- `scripts/seed-test-alerts.cjs` (nou) — one-shot seeder ce inserteaza 2 monitoring_jobs sintetice + 30 alerte direct in DB-ul `%APPDATA%/legal-dashboard/legal-dashboard.db`.

---

## Severity legend

| Symbol | Meaning |
|--------|---------|
| ❌ Critical | Trebuie reparat inainte sa rulezi seederul / sa publici |
| ⚠️ High | Repara curand — bug observabil sau risc operational |
| 🟡 Medium | Defense-in-depth, latent, sau dezbatere de design |
| 🟢 Low | Documenteaza sau nice-to-have |

---

## ❌ Critical findings

### C-1. Seederul lasa joburi `active=1` ce vor lovi PortalJust SOAP

**Fisier:** `scripts/seed-test-alerts.cjs:73-75`

**Detalii:** `ensureJob` inserteaza `monitoring_jobs` cu `active=1, cadence_sec=86400, next_run_at=datetime('now', '+1 day')`. La 24h dupa rulare, scheduler-ul productiv (`monitoringJobsRepository.claimDueJobs` la `WHERE active = 1 AND next_run_at <= ?`) va revendica aceste joburi si va apela `dosarSoapRunner` / `nameSoapRunner` cu targeturi sintetice (`numar_dosar="1234/SEED/2026"`, `name_normalized="SC SEED TEST SRL"`). Cleanup-ul existent (linia 92-97) sterge doar alerte cu `dedup_key LIKE 'seed-%'`, NU si joburile parinte.

**Impact:** Trafic SOAP recurent catre `portalquery.just.ro` cu date inventate, alerte `source_error` zilnice in inbox-ul real, fail-streak counter pe joburile fictive.

**Fix:**
```sql
INSERT INTO monitoring_jobs
  (owner_id, kind, target_json, target_hash, cadence_sec, active,
   next_run_at, notes, alert_config_json)
VALUES (?, ?, ?, ?, 86400, 0, NULL,
        '[seed-test-alerts] synthetic test job (inactive)', '{}')
```

**Confirmat de:** deep-code-reviewer, backend-reliability-reviewer, debug-investigator, audit-trail-reviewer.

---

### C-2. `Alerts.tsx` are state-ul `jobKind` tipat mai larg decat e accesibil + cast defensiv mort

**Fisier:** `frontend/src/pages/Alerts.tsx:82` (declaratie state) + `:244` (cast in render)

**Detalii:** State-ul e `useState<AlertJobKind | "all">("all")` desi singurii writeri produc `JobKindFilter = "all" | "dosar_soap" | "name_soap"`. Cast-ul `(jobKind === "aviz_rnpm" ? "all" : jobKind) as JobKindFilter` la linia 244 e dead defensive code. In plus, `load()` la linia ~115 trimite raw `jobKind` la `alertsApi.list` — daca state-ul ajunge totusi la `"aviz_rnpm"`, UI-ul afiseaza "Toate" dar API-ul filtreaza pe `aviz_rnpm` (UI minte despre filtrul activ).

**Fix:**
1. Linia 82: `useState<JobKindFilter>("all")`.
2. Linia 244: `value={jobKind}` (drop cast).
3. Importa `JobKindFilter` din `JobKindTabs.tsx`.

**Confirmat de:** deep-code-reviewer, debug-investigator, test-architect.

---

### C-3. Reset-button creeaza fereastra de 300ms cu rezultate stale

**Fisier:**
- `frontend/src/pages/Alerts.tsx:355-365` (handler "Reseteaza filtrele")
- `frontend/src/pages/Monitorizare.tsx:409-419`

**Detalii:** Comportamentul vechi era `setSearchInput(""); setDebouncedQuery("")` — React batch-uia ambele state-uri intr-un singur fetch. Comportamentul nou e doar `setSearchInput("")` care publica `debouncedQuery=""` abia dupa 300ms. Click pe "Reseteaza filtrele" cand exista o cautare activa = primul refetch cu `q` stale + al doilea 300ms mai tarziu cu `q` curat.

**Impact:** Un fetch risipit + flash de rezultate stale dupa fiecare reset.

**Fix recomandat:** Expune `flushImmediate(value)` din `useDebouncedValue` si apeleaza-l in handler-ele de reset:
```ts
// useDebouncedValue.ts
const flush = useCallback((next: T) => setDebounced(next), []);
return [debounced, flush] as const;
```
Apoi in reset: `flush("")` inainte de `setSearchInput("")`.

**Confirmat de:** debug-investigator, release-readiness-reviewer.

---

## ⚠️ High findings

### H-1. Seeder bypaseaza `insertAlert` — SSE / email / tenant-guard tacut absent

**Fisier:** `scripts/seed-test-alerts.cjs:166-183`

**Detalii:** Inserts directe via prepared `INSERT` ocolesc:
1. Tenant isolation guard (`monitoringAlertsRepository.ts:204-211`).
2. `notifyNewAlert` SSE push.
3. `dispatchAlertEmail` (deci developer-ii ce testeaza email-ul cu seeder-ul vor crede ca e stricat).

**Fix:** Documenteaza explicit gap-ul in header-ul scriptului. Daca SSE/email trebuie testate, fie apeleaza HTTP API-ul, fie importa `insertAlert()` dintr-un build artifact.

---

### H-2. `target_hash` calculat non-canonical, non-determinist

**Fisier:** `scripts/seed-test-alerts.cjs:64-67`

**Detalii:** `sha256(kind + targetJson + Date.now())` in loc de `canonicalSha256(target)` (cum face productia la `monitoringJobsRepository.ts:73`). Consecinte:
1. Un `POST /api/v1/monitoring/jobs` real pentru acelasi target NU va coincide cu hash-ul seed → unique index `(owner_id, target_hash, kind)` nu blocheaza dublarea → user va avea 2 joburi pe acelasi dosar.
2. `Date.now()` in hash = re-rularile produc hash diferit (mitigat doar de check-ul `notes LIKE '[seed-test-alerts]%'`).
3. Orice tool de integrity check va flag-ui rowul ca tampered.

**Fix:** Foloseste `canonicalSha256(target)` (porteaza implementarea ~10-line din `backend/src/util/canonicalJson.ts` in script CJS).

---

### H-3. Cleanup seeder e pattern-based, fara audit log

**Fisier:** `scripts/seed-test-alerts.cjs:92-97`

**Detalii:** `DELETE FROM monitoring_alerts WHERE owner_id = ? AND dedup_key LIKE 'seed-%'` — orice alert real cu `dedup_key` ce incepe cu `seed-` ar fi sters tacut. In plus, scriptul NU apeleaza `recordAudit()` (compara cu `routes/alerts.ts:140` care logheaza chiar si un dismiss user-initiated).

**Fix:**
1. Strange scope-ul: `DELETE FROM monitoring_alerts WHERE owner_id = ? AND job_id IN (SELECT id FROM monitoring_jobs WHERE notes LIKE '[seed-test-alerts]%')`.
2. Inainte de DELETE: `recordAudit(null, 'dev.seed.alerts.cleanup', { ownerId, detail: { count_before } })`.
3. Dupa INSERT: `recordAudit(null, 'dev.seed.alerts.inserted', { ownerId, detail: { job_ids, alert_ids } })`.

---

### H-4. Seederul nu seteaza `busy_timeout` → SQLITE_BUSY cand Electron ruleaza

**Fisier:** `scripts/seed-test-alerts.cjs:35`

**Detalii:** `new Database(DB_PATH)` deschide cu busy timeout 0ms default. SQLite WAL permite reads concurrente dar un singur writer. Daca Electron e mid-write (scheduler tick, alert insert, checkpoint), seederul arunca `SQLITE_BUSY: database is locked` imediat.

**Fix:**
```js
const db = new Database(DB_PATH);
db.pragma("busy_timeout = 5000");
```

---

### H-5. Seed alerte arata identic cu cele reale in UI si exporturi

**Fisier:** `scripts/seed-test-alerts.cjs:116-145`

**Detalii:** Singurii markeri sunt `[SEED N]` prefix in `title` si `seed_seq` in `detail_json`. Lipseste `"test_seeded": true` boolean explicit. `is_new=1` hardcodat la linia 169 → KPI strip-ul (`countUnreadAlerts`) include 30 alerte fictive imediat dupa seed.

**Fix:**
1. Adauga `"test_seeded": true` in fiecare `detail_json` (liniile 117, 135).
2. Schimba `is_new=1` in `is_new=0` (sau seteaza `dismissed_at = datetime('now')`).

---

### H-6. Lipsesc unit-tests pentru `buildRnpmLikePattern`

**Fisier:** lipseste `backend/src/util/textNormalize.test.ts`

**Detalii:** Helperul e folosit in 3 repositories pentru SQL injection safety (escape wildcard). Testarea actuala e doar tranzitorie via tests de route in `alerts.test.ts` + `monitoring.test.ts`. Path-ul `getAvize` (RNPM search) NU are test cu input wildcard. O regresie in `replace(/[\\%_]/g, "\\$&")` (ex. cineva "simplifica" la `replace(/[%_]/g, ...)`) ar permite scurgerea de rows pe RNPM search.

**Fix:** Adauga `backend/src/util/textNormalize.test.ts` cu cazuri:
```ts
expect(buildRnpmLikePattern("50%")).toBe("%50\\%%");
expect(buildRnpmLikePattern("a_b")).toBe("%a\\_b%");
expect(buildRnpmLikePattern("c:\\path")).toBe("%c:\\\\path%");
expect(buildRnpmLikePattern("ȘTEFAN")).toBe("%stefan%");
expect(buildRnpmLikePattern("")).toBe("%%");
expect(buildRnpmLikePattern("   ")).toBe("%   %");
expect(buildRnpmLikePattern("ăîș")).toBe("%ais%");
```

---

### H-7. `getAvize` cu input wildcard nu are test dedicat

**Fisier:** `backend/src/db/repository-isolation.test.ts:250-271`

**Detalii:** Testul existent foloseste doar plain alphanumeric. Adauga doua cazuri:
```ts
it("getAvize: searchText='%' returns zero results (no wildcard bleed)", () => {
  saveAvizFull(makeAviz("local", "IDENT-001"));
  expect(getAvize({ ownerId: "local", searchText: "%" }).total).toBe(0);
});
it("getAvize: searchText='_' returns zero results", () => {
  saveAvizFull(makeAviz("local", "IDENT-001"));
  expect(getAvize({ ownerId: "local", searchText: "_" }).total).toBe(0);
});
```

---

## 🟡 Medium findings

### M-1. Seederul ocoleste migration runner — schema drift tacut

**Fisier:** `scripts/seed-test-alerts.cjs:35`

**Fix:** Adauga schema version probe:
```js
const { user_version } = db.prepare("PRAGMA user_version").get();
if (user_version < 14) {
  console.error("[seed] DB schema too old, run app first to migrate");
  process.exit(1);
}
```

---

### M-2. Seederul nu logheaza audit pentru job creation

**Fisier:** `scripts/seed-test-alerts.cjs:68-76`

**Detalii:** Productia logheaza `monitoring.job.created` la `routes/monitoring.ts:184`. Seederul nu. Forensic review = nimic in audit_log.

**Fix:** Apeleaza `recordAudit(null, 'dev.seed.job.created', { ownerId, targetKind: 'monitoring_job', targetId: String(id), detail: { kind, notes } })` dupa INSERT.

---

### M-3. Seed alerte au `run_id = NULL` → lineage rupt

**Fisier:** `scripts/seed-test-alerts.cjs:167-181`

**Detalii:** Alertele reale fac join `monitoring_alerts.run_id → monitoring_runs.outcome_json`. Cele sintetice nu — query-uri forensic nu pot reconstrui "ce run a produs alerta X".

**Fix optional:** Insereaza un `monitoring_runs` row sintetic per kind, foloseste-i `id` ca `run_id` pe alerte.

---

### M-4. Garda whitespace pe `q` doar la route boundary

**Fisier:**
- `backend/src/db/monitoringJobsRepository.ts:185`
- `backend/src/db/monitoringAlertsRepository.ts:288`

**Detalii:** `if (opts.q)` accepta `"   "` (truthy). Schemele Zod pe routes blocheaza la HTTP boundary, dar callers interni / future tests pot ocoli. `buildRnpmLikePattern("   ")` produce `"%   %"` — match pe orice rand cu trei spatii in target JSON.

**Fix:** `if (opts.q?.trim())` in ambele repos.

---

### M-5. Tranzactionalitate seeder fragmentata

**Fisier:** `scripts/seed-test-alerts.cjs` (linii 80-184)

**Detalii:** `ensureJob` + `cleanup` + alert insert sunt 3 tranzactii separate. Crash intre ele = stat partial: joburi sintetice create dar alerte lipsa.

**Fix:** Wrap totul intr-un singur `db.transaction(() => { ... })`.

---

### M-6. Nu exista CLI confirmation gate pentru live DB

**Fisier:** `scripts/seed-test-alerts.cjs:25-31, 33`

**Detalii:** Default-ul (`%APPDATA%/legal-dashboard/legal-dashboard.db`) tinteste DB-ul productiv real. Niciun `--confirm` flag, niciun `--dry-run`.

**Fix:** Cere `SEED_CONFIRM=1` env, sau prompt 3-secunde la stdin daca path-ul rezolva la `%APPDATA%`.

---

## 🟢 Low findings

### L-1. Helper contract enforced doar prin comentariu

**Fisier:** `backend/src/util/textNormalize.ts:13-17`

**Detalii:** Comentariul "All call sites MUST pair this with `ESCAPE '\\'`" e singura aplicare. Un caller viitor ce uita `ESCAPE '\\'` ar produce rezultate tacut incorecte pentru input cu `\`.

**Fix optional:** Returneaza `{ pattern: string; escape: "\\" }` ca tuple sau redenumeste in `buildRnpmLikeEscapedPattern`. Sau adauga `@example` JSDoc cu SQL-ul pereche.

---

### L-2. `useDebouncedValue` initial-mount fires `onSettle` la 300ms

**Fisier:** `frontend/src/hooks/useDebouncedValue.ts:17-23`

**Detalii:** La mount, `useEffect` ruleaza, programeaza `setTimeout(300ms)` care apeleaza `setDebounced(initialValue)` (no-op) + `onSettle(initialValue)`. In `Alerts.tsx` + `Monitorizare.tsx` `onSettle = () => setPage(0)` → `setPage(0)` cand pagina e deja 0 = no-op acum, dar trap pentru viitor (deep-link cu `?page=N`).

**Fix:** Documenteaza in JSDoc:
```ts
/**
 * NOTE: onSettle fires once at t=delayMs after mount with the initial value.
 * If you initialize page from URL/storage, read it AFTER first settle.
 */
```

---

### L-3. Lipseste test pentru `useDebouncedValue`

**Fisier:** lipseste `frontend/src/hooks/useDebouncedValue.test.ts`

**Fix:** Adauga cu `vi.useFakeTimers()`:
- valoarea publicata dupa `delayMs`
- `onSettle` apelat o data cu valoarea settled
- churn rapid → doar valoarea finala
- unmount inainte de settle → `onSettle` NU se apeleaza
- callback identity change nu reseteaza timer-ul

---

### L-4. Lipseste test pentru `JobKindTabs`

**Fisier:** lipseste `frontend/src/components/monitoring/JobKindTabs.test.tsx`

**Fix:**
- `aria-selected=true` doar pe tab-ul activ
- click → `onChange(key)` cu cheia corecta
- `ariaLabel` aplicat pe `tablist` container

---

### L-5. Lipseste test pentru `alertsApi.list` URL construction

**Fisier:** lipseste sau nu acopera `alertsApi.list`

**Fix:**
- `q="   abc   "` → URL contine `q=abc`
- `q="   "` → URL NU contine parametrul `q`
- `jobKind="all"` → omis
- `jobKind="aviz_rnpm"` → trimis (documenteaza comportamentul curent)

---

### L-6. Tehnic-debt pre-existent: LIKE injection in admin paths

**Fisier:**
- `backend/src/db/auditRepository.ts:203-204` (`action LIKE ?` fara `ESCAPE`)
- `backend/src/db/userRepository.ts:58-62` (`email LIKE ? OR display_name LIKE ?`)

**Detalii:** Admin-only, owner-scoped → blast radius mic. Worst case: admin tasteaza `%` si vede toate randurile. Nu a fost introdus de acest PR dar a iesit la suprafata in audit.

**Fix optional:** Introdu `escapeLikeMeta(s)` langa `buildRnpmLikePattern`, adopta in cele doua repos cu `LIKE ? ESCAPE '\\'`.

---

### L-7. `JobKindTabs` lipseste arrow-key navigation (a11y)

**Fisier:** `frontend/src/components/monitoring/JobKindTabs.tsx`

**Detalii:** Componentul are `role="tablist"` + `role="tab"` dar nu implementeaza `ArrowLeft`/`ArrowRight` per WAI-ARIA Authoring Practices Guide.

**Fix optional:** Adauga `onKeyDown` care muta focus intre tab-uri.

---

### L-8. `LEGAL_DASHBOARD_DB_PATH` nevalidat → poate crea fisier oriunde

**Fisier:** `scripts/seed-test-alerts.cjs:25-31`

**Detalii:** `better-sqlite3` creeaza fisier daca path-ul nu exista. Typo / env var atacator-controlat = SQLite header creat la path arbitrar user-writable. Limitat de privilegiile user-ului, opt-in via invocare explicita.

**Fix optional:** Valideaza ca path-ul e sub `process.env.APPDATA` sau `$HOME/.config` decat daca `--allow-path` flag e setat.

---

### L-9. Trim redundant in `alertsApi.ts:113`

**Fisier:** `frontend/src/lib/alertsApi.ts:113`

**Detalii:** `useDebouncedValue(searchInput.trim(), ...)` deja face trim inainte ca valoarea sa ajunga la `alertsApi.list`. `.trim()` la linia 113 e no-op in path-ul normal — defense-in-depth pentru viitori callers.

**Fix:** Niciun (acceptat ca belt-and-suspenders), optional adauga JSDoc note.

---

## Verdict global

🟡 **CONDITIONAL** — Diff-ul e mergeable ca refactor commit fara version bump, dar:

1. **Trebuie reparat inainte sa rulezi seederul:** C-1 (`active=0`), C-2 (narrow `jobKind` state).
2. **Trebuie decis** despre C-3 (reset-button stale fetch) — fix-now sau accept-and-document.
3. **Should fix soon:** H-1 → H-7 (mai ales H-6 testul pentru helper).
4. **Document la pasul urmator:** L-2 (initial-mount onSettle).

Pentru a fi **🟢 READY**: rezolva toate ❌ + adauga unit test pentru `buildRnpmLikePattern`.

---

## Estimat fix time

| Categorie | Estimare |
|-----------|----------|
| C-1 (seeder `active=0`) | 1 min |
| C-2 (narrow `jobKind` state) | 2 min |
| C-3 (flushImmediate) | 15 min |
| H-1..H-7 (seeder hardening + tests) | ~90 min |
| M-1..M-6 | ~60 min |
| L-1..L-9 | ~120 min (totul, optional) |

**Total minim pentru 🟢 READY:** ~30 min (C-1 + C-2 + H-6).
**Total complet (toate ❌ + ⚠️):** ~2 ore.

---

## Files modified by this review

Niciunul. Acest document e rezumatul findings-urilor — nu am editat cod.

---

*Generat din: deep-code-reviewer + backend-reliability-reviewer + debug-investigator + test-architect + audit-trail-reviewer + release-readiness-reviewer + repo-security-auditor + claude-guard.*
