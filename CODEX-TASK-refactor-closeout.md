# CODEX TASK — Refactor Closeout v2.28.3

**Branch tinta:** `chore/refactor-closeout-v2.28.3`
**Spec completa:** `PLAN-refactor-closeout.md` (citeste TOT inainte sa pornesti)
**Estimat efort:** 3-4h

---

## Mission

Inchide refactor planul Tier 3 + Tier 4 livrand DOAR partea utila (3 commit-uri de cod + 1 commit docs), apoi release v2.28.3 cu PR pe GitHub.

**ZERO regresie** — orice pas care strica teste / type-check / build = STOP si raporteaza, NU continua mascat.

---

## Workflow

### 1. Citeste contextul (NU sari peste)

```
Read PLAN-refactor-closeout.md       — spec detaliata, citeste integral
Read audit/AUDIT-REFACTOR.md §0 §6.5 §8  — errata G1-G5 + invariants critice
Read CLAUDE.md                        — workflow obligatoriu push + checklist version bump
```

### 2. Pre-flight gate

```powershell
git status                                # MUST be clean
git log --oneline -3                      # MUST show 9eb9f59 release v2.28.2 at HEAD
npx tsc --noEmit -p backend/tsconfig.json # MUST be green
cd frontend; npx tsc --noEmit; cd ..      # MUST be green
npm test --workspace=backend              # MUST be green
cd frontend; npm test -- --run; cd ..     # MUST be green
npx biome check                            # MUST be zero errors
```

**Oricare comanda esueaza → STOP. Raporteaza outputul si asteapta instructiuni.**

Daca toate sunt verzi:
```powershell
git checkout -b chore/refactor-closeout-v2.28.3
```

---

### 3. PASUL 1 — Drop-export cleanup (~15 min)

Citeste `PLAN-refactor-closeout.md` §3 pentru detalii.

**ATENTIE:** inainte de fiecare drop, ruleaza grep cross-file ca sa confirmi 0 importuri externe (audit-ul poate fi stale). Lista de drop-uri:

**Frontend:**
- `frontend/src/components/rnpm/rnpm-form-fields.tsx` — `export function PJPFToggle` → `function PJPFToggle` (line ~73)
- `frontend/src/components/rnpm/rnpm-form-fields.tsx` — `export function PFBlock` → `function PFBlock` (line ~127)

**Backend:**
- `backend/src/db/dashboardActivityRepository.ts:37` — `export const CURATED_AUDIT_ACTIONS` → `const CURATED_AUDIT_ACTIONS`
- `backend/src/db/dashboardActivityRepository.ts:266` — `export interface AlertsDailyRow` → `interface AlertsDailyRow`
- `backend/src/db/dashboardActivityRepository.ts:287` — `export interface RunsByDayStatusRow` → `interface RunsByDayStatusRow`
- `backend/src/db/monitoringRunsRepository.ts:172` — `export interface RunsByStatusRow` → `interface RunsByStatusRow`
- `backend/src/auth/authProvider.ts:16` — `export interface AuthProvider` → `interface AuthProvider`

**@internal JSDoc markers (pastreaza export, doar adauga deasupra):**
- `backend/src/services/monitoring/diff/dosarSoap.ts:87` (computeFilterFingerprint)
- `backend/src/services/email/mailer.ts:140,146,157` (buildSubject, buildHtmlBody, buildTextBody)

**Verificare per simbol (CRITICA — NU sari):**
```powershell
Get-ChildItem -Recurse -Include *.ts,*.tsx backend/src,frontend/src `
  | Select-String -Pattern "\b<SIMBOL>\b" `
  | Where-Object { $_.Path -notlike "*<fisier-de-origine>*" -and $_.Path -notlike "*.test.*" -and $_.Path -notlike "*.spec.*" }
```
**0 hits = safe to drop. Orice hit = SKIP drop-ul, raporteaza.**

**Verificare finala pasul 1:**
```powershell
npx tsc --noEmit -p backend/tsconfig.json
cd frontend; npx tsc --noEmit; cd ..
npx biome check --write backend/src frontend/src
npm test --workspace=backend
cd frontend; npm test -- --run; cd ..
```

Daca toate verzi:
```powershell
git add -A
git commit -m "refactor: drop dead exports + @internal markers (audit/06 cleanup)"
```

---

### 4. PASUL 2 — `withRnpmGuards` middleware (~1-1.5h)

Citeste `PLAN-refactor-closeout.md` §4 pentru detalii complete.

**Pasi:**

a) **Citeste mai intai codul actual** ca sa nu te bazezi pe linii hardcodate din plan:
```
Read backend/src/routes/rnpm.ts  (full file, ~1157 LOC)
```

b) **Creeaza** `backend/src/routes/rnpmGuards.ts` cu signature-ul `withRnpmCaptchaGuards(c)` care intoarce `RnpmCaptchaGuardResult` discriminated union (vezi spec §4.2). Muta `isValidCaptchaKey` si `parseJsonBody` din `rnpm.ts` ca helpers private in `rnpmGuards.ts`.

c) **VERIFICA inainte de a muta `parseJsonBody`** — daca e folosit si in alt fisier din `backend/src`, exporta-l din `rnpmGuards.ts` si re-importeaza in `rnpm.ts`. Daca e folosit doar in `rnpm.ts`, mutarea ca privata e OK.

d) **Refactor cele 3 site-uri critice** in `rnpm.ts`:
- `/search` (L224 in versiunea curenta, dar grep dupa `rnpmRouter.post("/search"` ca sa fii sigur)
- `/bulk` (~L455)
- `/search-split` (~L571)

Pattern de inlocuit:
```typescript
// INAINTE (~6 linii repetitive):
const webGate = rejectCaptchaKeyInWebMode(c);
if (webGate) return webGate;
const body = await parseJsonBody(c);
if (body === null) return invalidJson(c);
const { ..., captchaKey, ... } = (body ?? {}) as { ... };
// ... alte param parse-uri ...
if (!isValidCaptchaKey(captchaKey)) return invalidCaptchaKey(c);

// DUPA:
const guard = await withRnpmCaptchaGuards(c);
if (!guard.ok) return guard.response;
const { body, captchaKey } = guard;
const { type, params, captchaProvider, ... } = body as { ... }; // fara captchaKey
```

**NOTA importanta:**
- `/captcha/balance` (~L1136) are doar `rejectCaptchaKeyInWebMode`, NU full pattern. Pastreaza acea ruta cu apel direct la `rejectCaptchaKeyInWebMode` (sau extrage `withRnpmWebModeGate` separat daca preferi simetria). NU forta `withRnpmCaptchaGuards` pe ea.
- Pastreaza `rejectCaptchaKeyInWebMode` (functia ORIGINALA) ca export sau ca local helper pentru `/captcha/balance` — NU o sterge daca o folosesti acolo.

e) **Adauga teste** in `backend/src/routes/rnpmGuards.test.ts` (fisier nou) — 4 teste minime:
- web mode → 501
- body JSON invalid → 400
- captchaKey prea scurt → 400
- desktop + captchaKey valid → ok

Foloseste mocking pattern existent (`vi.mock` pentru `getAuthMode`).

f) **Verificare:**
```powershell
npx tsc --noEmit -p backend/tsconfig.json
npm test --workspace=backend
cd frontend; npm test -- --run; cd ..
npx biome check --write backend/src
```

**Smoke desktop manual (asteapta confirm la user dupa push):**
- Search RNPM cu CUI test → captcha gate functioneaza
- /bulk cu lista de 2 CUI-uri → SSE stream merge
- /search-split cu tip "ipoteci" si limit_exceeded simulat → tier-2 fan-out functioneaza

```powershell
git add -A
git commit -m "refactor(rnpm): consolidate withRnpmGuards middleware (auth-drift safety)"
```

---

### 5. PASUL 3 — 3 teste de invariants (~1-2h)

Citeste `PLAN-refactor-closeout.md` §5 pentru detalii.

**Citeste mai intai codul actual:**
```
Read backend/src/services/rnpmSearchService.ts  (full file, ~1095 LOC) — fii atent la
  L108 (searchBelongsToOwner / getSearchOwnership)
  L653 (consecutiveSilentRefusals = 0)
  L695, L704, L715, L742, L769 (reset/increment/fail-fast sites)
  L862 (updateSearchTotal in finally)
Read backend/src/services/rnpmSearchService.split.test.ts  (fixturi + DB setup)
```

**Adauga in `rnpmSearchService.split.test.ts`** (la finalul fisierului, intr-un nou `describe`):

```typescript
describe("invariants critice (audit §6.5)", () => {
  // 4 teste: I1, I3 part 1 (NU fail-fast la error in middle), I3 part 2 (fail-fast la 3 silent), I-final-update
});
```

Spec exacta in `PLAN-refactor-closeout.md` §5.2. ADAPTEAZA semnaturile la codul real (citeste import-urile + types din file-ul curent, NU copy-paste orb din plan).

**Acceptance criteria pentru fiecare test:**
- NU `.skip()`, NU `.todo()` — toate 3 (sau 4) trebuie active si PASS
- Daca un test e prea greu de scris (e.g. mocking deep dependencies), raporteaza-l detaliat si propune fixture alternativa — NU lasa test gol/skipped
- Tests trebuie sa testeze BEHAVIOUR (intrare → iesire observabila), NU implementation details

**Verificare:**
```powershell
npm test --workspace=backend -- rnpmSearchService.split.test.ts
npx tsc --noEmit -p backend/tsconfig.json
npx biome check --write backend/src
```

```powershell
git add -A
git commit -m "test(rnpm-search): pin I1/I3/I-final-update invariants"
```

---

### 6. PASUL 4 — Close audit + docs + version bump (~20-30 min)

Citeste `PLAN-refactor-closeout.md` §6 pentru detalii.

**Fisiere de update (in ordine):**

a) `audit/AUDIT-REFACTOR.md` — inlocuieste §8 cu noua sectiune (spec exacta in plan §6.1).

b) `audit/06-dead-code.md` — marcheaza in §10 actiunile 1-3 ca **[DONE pre-v2.28.3]** si 4-5 ca **[DONE in v2.28.3]**.

c) `CHANGELOG.md` — adauga sectiune `## v2.28.3 — 2026-05-17` la varf (spec in plan §6.3).

d) `frontend/src/data/changelog-entries.tsx` — adauga entry v2.28.3 in pattern-ul existent (citeste fisierul, copiaza structura unei entry existente, adapteaza continutul).

e) `package.json` (root) — `"version": "2.28.3"`
   `backend/package.json` — `"version": "2.28.3"`
   `frontend/package.json` — `"version": "2.28.3"`

f) `package-lock.json` — regenereaza:
```powershell
npm install
```
(asta updateaza lockfile-ul cu noile versions; NU adauga deps noi)

g) `README.md` — campul "Versiune curenta" → `**v2.28.3**`

h) `STATUS.md` — "Data curenta" si "Versiune curenta reala" la varf

i) `DOCUMENTATIE.md` — campul "Versiune curenta" din sectiunea "Descriere Generala"

j) `SESSION-HANDOFF.md` — daca exista referinte la sprint activ ce trebuie updatate

k) `CLAUDE.md` — sectiunea "Versiune Curenta" → `**v2.28.3** - 17 Mai 2026`

**Sanity check:**
```powershell
Get-ChildItem -Recurse -Include *.md `
  | Select-String -Pattern "v2\.28\.2" `
  | Where-Object { $_.Path -notlike "*CHANGELOG.md" -and $_.Path -notlike "*changelog-entries*" -and $_.Path -notlike "*audit/AUDIT*" }
# 0 hits = clean (toate v2.28.2 ramase sunt in istoric, nu in headers active)
```

```powershell
git add -A
git commit -m "docs(audit): close refactor plan — Tier 3/4 deferred per validation"
```

---

### 7. PASUL 5 — Release + Push + PR (~10-15 min)

```powershell
# Workflow obligatoriu CLAUDE.md
npx biome check --write .
npx tsc --noEmit -p backend/tsconfig.json
cd frontend; npx tsc --noEmit; cd ..
npm run build
npm test --workspace=backend
cd frontend; npm test -- --run; cd ..
```

**Toate 6 verzi = ready to push. Oricare rosu = STOP, fix, recommit, retry.**

Daca biome reformateaza in `--write` faza:
```powershell
git add -A
git commit -m "style: biome format pass v2.28.3"
```

**Push + PR:**
```powershell
git push -u origin chore/refactor-closeout-v2.28.3
gh pr create --title "release: v2.28.3 — refactor closeout + invariants pin" --body "$(cat <<'EOF'
## Summary
- Drop-export cleanup pe 7 simboluri folosite doar intern (audit/06 §5+§7)
- `withRnpmGuards` middleware: consolidare guard-uri pe 3 site-uri RNPM (auth-drift safety)
- 3 teste de characterizare pin I1/I3/I-final-update in rnpmSearchService.split.test.ts
- Refactor closeout: Tier 3 + restul Tier 4 marcate DEFERRED in audit/AUDIT-REFACTOR.md §8 — vezi `PLAN-refactor-closeout.md` pentru rationale + decizii inchise

## Test plan
- [x] biome check --write . → zero erori
- [x] tsc --noEmit pe ambele workspaces → verde
- [x] npm test --workspace=backend → toate testele verzi (3-4 noi adaugate)
- [x] cd frontend && npm test -- --run → 102+ teste verzi
- [x] npm run build → bundle iese curat
- [ ] Smoke desktop manual (USER): RNPM search + Monitorizare load + Dashboard + sidebar arata v2.28.3

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Returneaza URL-ul PR-ului in raspuns la user.**

---

## Constraints critice (NU le incalca)

1. **Branch separat** — `chore/refactor-closeout-v2.28.3`, NU push direct pe `main`.
2. **NU schimba scope** — daca apare ceva ce ar trebui facut dar NU e in plan, raporteaza si asteapta confirm, NU lipi de PR.
3. **NU skip teste** — orice `.skip()` / `.todo()` adaugat la cele 3-4 teste noi = fail. Daca un test e prea complex, raporteaza in mod explicit cu fixture-ul partial scris si propune alternativa.
4. **NU `--no-verify`** la commit / `--no-edit` la rebase / `--force` la push pe niciun moment.
5. **Biome obligatoriu** inainte de fiecare commit care touch-uieste cod (`npx biome check --write` pe fisierele atinse, re-stage si recommit follow-up daca reformateaza).
6. **Type-check obligatoriu** dupa fiecare commit care touch-uieste TS — daca pica, fix-ul nu se opreste si NU continui la urmatorul pas.
7. **Acceptance gate strict** intre pasi — daca PASUL 2 are teste rosii dupa modificare, NU treci la PASUL 3 cu "fix later".
8. **Smoke desktop** ramane pe user (Codex nu ruleaza Electron interactive) — semnaleaza in PR body ca smoke desktop e checkbox neverificat de tine.
9. **NU atinge fisiere AI** (`backend/src/routes/ai.ts`, `backend/src/services/ai/**`, `frontend/src/components/ai/**`) — sunt in afara scope-ului refactor closeout. Daca biome zice ca trebuie reformatate, OK; daca cere refactor structural, raporteaza.
10. **NU schimba decizii inchise** — listate in `PLAN-refactor-closeout.md` §11.

---

## Daca te blochezi

- Type errors care nu se rezolva in <15 min → raporteaza outputul `tsc` complet si asteapta.
- Test failure care pare ca testul nou e gresit, NU codul productie → REDU-l, NU patch-ui cod productie ca sa treaca testul.
- Conflict in `parseJsonBody` mutare (folosit in mai multe fisiere) → exporta din `rnpmGuards.ts`, re-importeaza, raporteaza decizia in commit message.
- Audit-ul cere drop pe un simbol care ARE consumers externi (descoperit la grep cross-file) → SKIP acel drop, raporteaza in commit message + comentariu in §10 din `audit/06-dead-code.md`.

---

## Output asteptat la final

- 4-5 commit-uri pe branch `chore/refactor-closeout-v2.28.3`
- 1 PR pe GitHub cu URL returnat la user
- Toate gate-urile verzi pre-push
- Mesaj scurt la user: "PR ready: <URL>. Smoke desktop ramane pe tine."
