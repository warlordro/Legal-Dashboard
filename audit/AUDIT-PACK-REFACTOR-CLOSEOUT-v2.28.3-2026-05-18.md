# Audit Pack - Refactor Closeout v2.28.3

**Data:** 2026-05-18  
**Scope auditat:** PR #41 / release `v2.28.3` - `release: v2.28.3 - refactor closeout + invariants pin`  
**Branch / refs:** `origin/main` la `cce4246`; PR #41 este `MERGED`; checkout local `main` este ahead cu un commit docs separat (`DISCUTIE-admin-web-cutover.md`), exclus din verdictul v2.28.3.  
**Skill-uri folosite ca lentile:** `/delivery-plan`, `/audit-pack`, `/acceptance-criteria`, `/test-generate`, `/threat-model`, `/dependency-risk`, `/release-readiness`, `/migration-runbook`, `/code-review`, `/architecture-review`, `/security-audit`, `/test-review`, `/engineering-review`.

---

## 0. Executive Verdict

**Verdict final:** **PASS cu riscuri mici/medii documentate.**

Nu exista blocker High/Critical pe cod, arhitectura, securitate, dependency risk sau release-readiness pentru v2.28.3. PR-ul #41 este deja merged in `origin/main`, CI-ul vizibil este verde, iar verificarile locale relevante au trecut dupa repararea ABI-ului Node pentru `better-sqlite3`.

**Ce ramane nerezolvat:**

1. **Medium:** lipseste test route-level pentru `POST /api/v1/rnpm/search-split` in web mode. Helperul are test, dar ruta reala merita sentinel separat.
2. **Medium:** testul nou I3 cu transient error nu demonstreaza complet ca transient error NU reseteaza counterul silent-refusal.
3. **Low:** docs/changelog inca folosesc uneori numele generic `withRnpmGuards` / termenul "middleware", desi codul real exporta `withRnpmCaptchaGuards` ca helper opt-in.
4. **Low:** `PLAN-refactor-closeout.md` pastreaza formularea istorica "22 endpoints/rute" in mai multe locuri; sursa finala corecta este `audit/AUDIT-REFACTOR.md` sectiunea 8 + `CHANGELOG.md`.
5. **Low:** `CLAUDE.md` spune `latest 0021` pentru migrations, dar repo-ul are migrations pana la `0025`.

**Smoke desktop:** nu a fost rulat in acest audit. Dupa testele Node, ABI-ul Electron pentru `better-sqlite3` a fost refacut cu `npm run rebuild:electron`.

---

## 1. Scope si Inventar Diff

### Inclus

- Drop-export cleanup pe simboluri interne.
- `backend/src/routes/rnpmGuards.ts` si wiring in `backend/src/routes/rnpm.ts`.
- Teste noi in `backend/src/routes/rnpmGuards.test.ts`.
- Teste invariants in `backend/src/services/rnpmSearchService.split.test.ts`.
- Version bump `2.28.3` in root/backend/frontend manifests si lockfile.
- Docs closeout: `CHANGELOG.md`, `README.md`, `STATUS.md`, `DOCUMENTATIE.md`, `SESSION-HANDOFF.md`, `CLAUDE.md`, `audit/*`.
- Commit suplimentar `f5d5d02` cu corectie scope: "22 endpoints" -> "3 rute" in sursele finale si envelope assertions pentru guards.

### Exclus

- Commitul local post-merge `d63fee9 docs: discutie extensie admin panel + audit securitate web cutover`.
- Smoke desktop interactiv.
- Refactor structural Tier 3/Tier 4 marcat `DEFERRED`.
- Orice rute AI sau fisiere AI, conform scope-ului initial.

---

## 2. Findings Consolidate

### F1 - Medium - Lipseste test route-level pentru `/search-split` web mode

**Lentile:** `/test-review`, `/test-generate`, `/security-audit`, `/acceptance-criteria`

**Evidence:**

- `withRnpmCaptchaGuards` este aplicat in ruta reala la `backend/src/routes/rnpm.ts:513`.
- Contract tests existente acopera `POST /search`, `POST /bulk`, `POST /captcha/balance` in web mode la `backend/src/routes/rnpm.contract.test.ts:592`, `:604`, `:618`.
- Nu exista test route-level similar pentru `POST /search-split`.
- Helperul izolat este testat in `backend/src/routes/rnpmGuards.test.ts`, dar acesta nu prinde accidental removal din ruta reala.

**Risk:** pentru ca guard-ul este helper opt-in, o stergere accidentala din `/search-split` ar putea trece peste testele helperului.

**Fix minim recomandat:** adauga in `rnpm.contract.test.ts`:

```ts
it("POST /search-split returns 501 in web mode", async () => {
  // same pattern ca /search si /bulk
});
```

**Priority:** P1, 15-20 min.

---

### F2 - Medium - Testul I3 transient-error nu fixeaza complet reset semantics

**Lentile:** `/test-review`, `/test-generate`, `/code-review`

**Evidence:**

- Testul nou este in `backend/src/services/rnpmSearchService.split.test.ts:693`.
- Scenariul actual este `[silent, silent, error, success]`.
- Invariantul real cere ca transient error sa NU reseteze counterul de silent refusals.

**Risk:** daca un refactor gresit reseteaza counterul pe transient error, scenariul actual poate ramane verde deoarece urmatorul item este success. Testul demonstreaza "nu fail-fast prea devreme", dar nu demonstreaza "error nu reseteaza counterul".

**Fix minim recomandat:** adauga un scenariu `[silent, silent, transient error, silent, next]` si aserteaza ca al patrulea silent devine al treilea refuz consecutiv si declanseaza fail-fast pentru rest.

**Priority:** P1, 20-30 min.

---

### F3 - Low - Docs folosesc nume/termen prea generic pentru guard

**Lentile:** `/code-review`, `/architecture-review`, `/audit-pack`

**Evidence:**

- Codul real exporta `withRnpmCaptchaGuards` in `backend/src/routes/rnpmGuards.ts:10`.
- `CHANGELOG.md:12` foloseste `withRnpmGuards` si "middleware".
- `frontend/src/data/changelog-entries.tsx:45` si `:58` folosesc `withRnpmGuards`.
- `audit/AUDIT-REFACTOR.md:482` clarifica deja ca este helper opt-in.

**Risk:** mentenatorii pot cauta numele gresit sau pot presupune enforcement router-level, desi hazard-ul auth-drift ramane partial open.

**Fix minim recomandat:** in docs si in-app changelog, foloseste `withRnpmCaptchaGuards` si formularea "helper opt-in pentru 3 rute", nu "middleware" generic.

**Priority:** P2, docs-only.

---

### F4 - Low - Plan artifact pastreaza formularea stale "22 endpoints"

**Lentile:** `/audit-pack`, `/release-readiness`, `/engineering-review`

**Evidence:**

- `PLAN-refactor-closeout.md:18`, `:322`, `:527`, `:548`, `:631` inca spun 22 endpoints/rute.
- Sursele finale corecteaza scope-ul la 3 rute: `CHANGELOG.md:12`, `audit/AUDIT-REFACTOR.md:482`, commit `f5d5d02`.

**Risk:** confuzie la audituri viitoare daca cineva trateaza planul initial ca sursa de adevar post-executie.

**Fix minim recomandat:** fie patch docs-only in plan, fie adauga banner scurt: "Historical plan; final executed scope is 3 routes per AUDIT-REFACTOR sectiunea 8".

**Priority:** P2, docs-only.

---

### F5 - Low - `CLAUDE.md` are latest migration stale

**Lentile:** `/migration-runbook`, `/release-readiness`

**Evidence:**

- `CLAUDE.md:83` spune `latest 0021`.
- `backend/src/db/migrations` contine fisiere pana la `0025_ai_usage_owner_default.*`.

**Risk:** handoff/dev-agent confusion la audituri migration sau release viitoare. Nu afecteaza v2.28.3, care nu adauga migration.

**Fix minim recomandat:** docs-only update `latest 0025`.

**Priority:** P3.

---

## 3. Acceptance Criteria Review

### Criterii indeplinite

- 4+ commit-uri separate livrate pentru plan, cleanup, guard refactor, invariants, docs/version.
- Drop-export cleanup compileaza si nu are consumatori externi detectati.
- `withRnpmCaptchaGuards` aplica acelasi pattern pe cele 3 rute relevante: `/search`, `/bulk`, `/search-split`.
- `/captcha/balance` ramane doar cu web-mode gate direct, conform planului.
- Testele guard acopera web mode, invalid JSON, captchaKey scurt, captchaKey lipsa si desktop valid.
- Testele invariants acopera I1 cross-tenant, I3 fail-fast si I-final-update in `finally`.
- Version bump si changelog/in-app changelog sunt prezente.
- `npm audit --omit=dev` este verde.

### Criterii partiale / cu risc ramas

- "Auth-drift safety" este doar partial: guard-ul este helper opt-in, nu middleware structural.
- `search-split` nu are test contract route-level pentru web-mode 501.
- I3 transient reset semantics are nevoie de un scenariu mai puternic.
- Smoke desktop ramane manual.

---

## 4. Threat Model

### Assets

- Chei captcha 2Captcha / CapSolver.
- Date RNPM persistate local in SQLite.
- Identitate owner (`owner_id`) si auth mode desktop/web.
- Cost real al captcha solves in requesturi bulk/split.

### Trust boundaries

- Desktop renderer -> backend local.
- Browser/web mode -> backend server-side, unde cheile captcha nu trebuie transmise din browser.
- Backend -> captcha provider extern.
- Backend -> SQLite.

### Abuse/failure cases relevante

- Endpoint RNPM nou care primeste `captchaKey` fara web-mode gate.
- Validare incompleta care permite secret-in-browser in `AUTH_MODE=web`.
- Double-submit/cost amplification pe captcha flows.
- Cross-tenant `existingSearchId` in RNPM search service.

### Mitigari existente in v2.28.3

- `rejectCaptchaKeyInWebMode` returneaza `WEB_MODE_NOT_IMPLEMENTED` 501 pentru rute captcha in web mode.
- `withRnpmCaptchaGuards` centralizeaza web gate + JSON parse + captchaKey validation.
- I1 cross-tenant test aserteaza 403 si zero upstream client calls.
- Changelog si audit marcheaza explicit ca helperul ramane opt-in.

### Residual threat

Guard-ul nu este router-level middleware. Riscul actual este de regresie viitoare, nu de vulnerabilitate confirmata in cele 3 rute existente.

---

## 5. Dependency Risk

**Verdict:** Sound.

**Evidence:**

- `package.json`, `backend/package.json`, `frontend/package.json` si `package-lock.json` au schimbari version-only la `2.28.3`.
- Nu au fost adaugate dependinte noi.
- `npm audit --omit=dev --json` a raportat 0 vulnerabilities.

**Known environment risk:** `better-sqlite3` are ABI diferit Node/Vitest vs Electron. Pentru audit, Node ABI a fost refacut cu `npm rebuild better-sqlite3`; dupa validare, Electron ABI a fost refacut cu `npm run rebuild:electron`.

---

## 6. Migration Runbook

**Verdict:** No migration.

v2.28.3 nu adauga, modifica sau sterge fisiere SQL migration. Nu exista backfill, DDL sau data correction.

**Rollback:** revert PR #41 sau tag previous `v2.28.2`; nu exista schema rollback.

**Operational note:** dupa orice test Node care reconstruieste `better-sqlite3`, ruleaza `npm run rebuild:electron` inainte de smoke desktop.

---

## 7. Release Readiness

**Verdict:** Ready with documented residual risks.

### Remote evidence

- PR #41: `MERGED`.
- PR title: `release: v2.28.3 - refactor closeout + invariants pin`.
- GitHub checks:
  - CodeRabbit: pass.
  - `lint-test`: pass.

### Local evidence run in this audit

```text
npm audit --omit=dev --json
  -> 0 vulnerabilities

npx biome check .
  -> 352 files checked, no fixes

npx tsc --noEmit -p backend/tsconfig.json
  -> pass

cd frontend; npx tsc --noEmit
  -> pass

npm rebuild better-sqlite3
  -> required after Node ABI miss; pass outside sandbox

npm test --workspace=backend -- rnpmGuards.test.ts rnpmSearchService.split.test.ts
  -> 2 files, 20 tests passed

npm test --workspace=backend
  -> 90 files passed; 1098 passed, 1 skipped

cd frontend; npm test -- --run
  -> 26 files passed; 200 tests passed

npm run build
  -> pass outside sandbox; first sandbox run failed on Vite/esbuild access denied

npm run rebuild:electron
  -> pass outside sandbox after Node test validation

git diff --check origin/main..HEAD
  -> pass
```

### Remaining release checks

- Desktop smoke manual: RNPM search, `/bulk`, `/search-split`, Monitorizare load, Dashboard, sidebar/changelog `v2.28.3`.
- Electron ABI a fost refacut dupa audit; daca rulezi din nou teste Node inainte de smoke, refa iar `npm run rebuild:electron`.

---

## 8. Delivery Plan / Actions

### P1 - Strengthen route-level guard tests

- Add `/search-split` web-mode 501 test in `rnpm.contract.test.ts`.
- Add dual-invalid precedence tests if the documented behavior should remain fixed.

### P1 - Strengthen I3 invariant test

- Add `[silent, silent, transient error, silent]` scenario to prove transient error does not reset the counter.

### P2 - Docs precision patch

- Rename `withRnpmGuards` -> `withRnpmCaptchaGuards` in user-facing/changelog docs where referring to actual code.
- Replace "middleware" with "helper opt-in" unless talking about the deferred structural design.
- Mark stale "22 endpoints" statements in `PLAN-refactor-closeout.md` as historical or correct them to 3 routes.

### P3 - Handoff docs cleanup

- Update `CLAUDE.md` migration note from `latest 0021` to `latest 0025`.

---

## 9. Audit-Pack Conclusion

v2.28.3 is a safe closeout release for the actual shipped code. The main engineering value is modest but useful: dead export cleanup, RNPM captcha guard consolidation on the three real routes, and regression tests around RNPM search invariants. The important honesty correction landed in `f5d5d02`: the guard is not structural middleware over 22 endpoints; it is an opt-in helper on 3 routes.

The next best move is not more broad refactor. It is a tiny follow-up docs/test patch:

1. one route-level `/search-split` web-mode test,
2. one stronger I3 transient reset test,
3. docs naming correction for `withRnpmCaptchaGuards`,
4. `CLAUDE.md` latest migration update.
