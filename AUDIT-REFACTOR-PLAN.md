# Plan Audit Refactor — Legal Dashboard

**Data:** 2026-05-16
**Versiune target:** v2.27.5 (HEAD `main`)
**Scope branch:** `main` exclusiv. Branch-ul `feat/openrouter-toggle-stacks` (AI implementation) este complet exclus din audit.
**Obiectiv:** identifica modulele cu prea multe linii, duplicari si over-engineering, prioritizate dupa risc + ROI, fara modificare de cod in faza de audit.

---

## 1. Context dimensional (baseline)

| Workspace | Fisiere | LOC | Hot files (>500 LOC) |
|-----------|---------|-----|----------------------|
| Backend   | 171     | 40 018 | 19 (din care 8 teste) |
| Frontend  | 143     | 31 275 | 11 (din care 0 teste) |
| Electron  | 3       | 748   | — |

**Top 10 candidati refactor (non-test, non-content):**

| # | Fisier | LOC | Domeniu |
|---|--------|-----|---------|
| 1 | `backend/src/routes/rnpm.ts` | 1054 | RNPM HTTP routes |
| 2 | `backend/src/services/rnpmSearchService.ts` | 1019 | RNPM search orchestration |
| 3 | `frontend/src/pages/Alerts.tsx` | 888 | UI alerts |
| 4 | `frontend/src/pages/manual-content.tsx` | 872 | UI manual content |
| 5 | `frontend/src/pages/Monitorizare.tsx` | 775 | UI monitoring |
| 6 | `frontend/src/components/rnpm/RnpmSearchForm.tsx` | 748 | RNPM form |
| 7 | `frontend/src/components/DosareTable.tsx` | 747 | UI dosare table |
| 8 | `backend/src/routes/alerts.ts` | 714 | Alerts HTTP routes |
| 9 | `backend/src/db/avizRepository.ts` | 684 | Repository aviz |
| 10 | `backend/src/db/monitoringAlertsRepository.ts` | 653 | Repository alerts |

**Excluse explicit din audit (motivate):**
- `frontend/src/data/changelog-entries.tsx` (3965 LOC) — content file, by design
- Toate `*.test.ts` / `*.spec.ts` (mari prin natura coverage-ului)
- Cele 8 fisiere noi de pe branch-ul AI (vezi sectiunea 6)
- `backend/src/db/migrations/**` — generate, nu se refactoreaza
- `frontend/src/data/changelog-entries.tsx` — append-only changelog

---

## 2. Wave 1 — Inventory + Detectie (3 agenti paraleli, read-only)

Toti agentii ruleaza pe `main` exclusiv (vezi sectiunea 6) si NU scriu cod.

### Agent A1 — Inventory & Hot-Spot Map
**Tip:** `general-purpose` (sau `Explore` daca scope-ul iese mic)
**Misiune:** scaneaza tot `backend/src` si `frontend/src`, exclud teste si excluderile de mai sus; produce un tabel:

```
file | LOC | functions_count | max_function_loc | nesting_depth_max | domain | risk_flag (HIGH/MED/LOW)
```

Reguli risk_flag:
- HIGH: >500 LOC SAU >1 functie >100 LOC SAU nesting >5
- MED: 300-500 LOC SAU max function 50-100 LOC
- LOW: <300 LOC, functii <50 LOC

**Output:** `audit/01-inventory.md` (tabel sortat dupa risk + LOC desc)

### Agent A2 — Duplication Scan
**Tip:** `general-purpose`
**Misiune:** detecteaza pattern-uri duplicate sau aproape-duplicate:
- SQL row-mapping handlers (mapare `row → entity`)
- Validare envelope `{ data, error, requestId }` per route
- Captcha solving wrapper (2captcha vs CapSolver)
- Fetch wrappers cu timeout + abort (frontend + backend)
- Export columns (XLSX vs CSV vs PDF)
- Form validation pe RNPM (cnp/cui/nume vs)
- Pagination `{ page, pageSize, total }` plumbing
- Error-to-toast translation pe frontend

**Output:** `audit/02-duplication.md` — fiecare cluster cu:
- pattern description (1 paragraf)
- 3-5 file:line exemple
- propunere extract (helper / hook / repository method)
- estimare LOC saved

### Agent A3 — Architecture & God Component Audit
**Tip:** `deep-code-reviewer`
**Misiune:** rigorous review pe top 10 LOC candidate (sectiunea 1), focus:
- Separation of concerns (CQ-7 din CLAUDE.md root): SQL in route handler? state+fetch+UI in acelasi component?
- Mixed responsibilities: orchestration + business logic + IO in aceeasi functie
- `useEffect` cu logica complexa care merita extracted hook
- Repository pattern compliance: SQL raw doar in `backend/src/db/**`
- `useState` count per component (>10 = god component)
- Props drilling vs context

**Output:** `audit/03-architecture.md` cu severity per finding (CRITICAL/HIGH/MED/LOW) + fix sketch.

**Trigger Wave 1:** un singur mesaj cu 3 Agent calls in paralel.

---

## 3. Wave 2 — Refactor Planning (sequential, dupa Wave 1)

### Agent A4 — Refactor Strategy
**Tip:** `refactor-planner`
**Input:** outputurile A1+A2+A3 (consolidate).
**Misiune:** pentru TOP 5 targets (intersectia rezultatelor Wave 1, alese de mine pe baza scor: risk_flag × duplication_hits × architecture_severity), produce:

1. **Refactor plan etapizat** (3-5 pasi mici, fiecare cu PR separat)
2. **Risk assessment** per pas: ce poate sa se rupa, ce trebuie testat manual
3. **Test coverage gap** — ce teste lipsesc pentru a refactora in siguranta
4. **Estimated LOC delta** (current vs post-refactor)
5. **Migration path** — daca atinge contract API/DB, cum se face fara breaking

**Output:** `audit/04-refactor-plans.md` cu cate o sectiune per target.

---

## 4. Wave 3 — Quick Wins (paralel, simplificari low-risk)

### Agent A5 — Code Simplifier
**Tip:** `code-simplifier`
**Misiune:** propune simplificari LOW-RISK (zero behavior change) pe fisierele marcate LOW de A3, plus orice simplificare locala pe care o intalneste in fisierele HIGH/MED dar care nu necesita refactor structural:
- dead code (functii definite nefolosite)
- duplicare locala (acelasi block 2x in acelasi fisier)
- conditii redundante / early returns
- naming inconsistent in acelasi scope (CQ-4)
- unused imports / variables
- Promise chains -> async/await
- `setState` callbacks evitabile

**Output:** `audit/05-quick-wins.md` cu lista file:line + diff propus + verdict (apply imediat / batch in PR / skip).

### Agent A6 — Dead Code & Dependency Audit
**Tip:** `general-purpose`
**Misiune:**
- functii/componente/hooks exportate dar 0 referinte (grep cross-repo)
- imports `lodash`/`ramda`/etc. utilizate <3 ori (candidat eliminare dependency)
- `npm ls --depth=0` + cross-check vs `import` statements pentru deps neutilizate in `package.json` root + workspaces
- React components in `components/` care nu apar in nicio pagina

**Output:** `audit/06-dead-code.md` cu candidates pentru deletion + verificare necesara (ex. `grep -r 'componentName' frontend/src`).

**Trigger Wave 3:** rulate paralel cu Wave 2 (independente).

---

## 5. Consolidare & Verdict

Dupa Wave 1+2+3, eu (Claude principal) produc `audit/00-EXECUTIVE-SUMMARY.md`:

- **Tabel sintetic**: top 10 prioritati de refactor sortate dupa `(impact × frecventa) / effort`
- **Recomandari operationale**: ce se face acum, ce intra in backlog, ce se ignora (cu motivatie)
- **Estimat total LOC eliminabil** (din A2 duplicari + A6 dead code + A5 simplificari)
- **Roadmap propus**: cum se imparte refactorul pe sprint-uri 2-3 saptamani (sequential cu PR-uri mici)
- **Risk register**: ce refactor blocheaza cutover-ul web vs ce poate astepta

---

## 6. Reguli de izolare (branch AI)

**Hard rules pentru toti agentii:**

1. Agentii ruleaza **dupa** ce eu fac `git checkout main` (sau primesc instructiune explicita sa citeasca via `git show main:<path>` ).
2. Daca audit-ul ruleaza pe disk-ul current (`feat/openrouter-toggle-stacks`), excluderi obligatorii (paste-in in fiecare prompt de agent):
   - `backend/src/db/migrations/0023_*`
   - `backend/src/db/migrations/0024_*`
   - `backend/src/db/ownerAiSettingsRepository.ts`
   - `backend/src/db/ownerAiSettingsRepository.test.ts`
   - `PLAN-openrouter-toggle.md`
   - `CODEX-TASK-openrouter-toggle.md`
3. Daca un agent identifica un refactor target care intersecteaza zona AI (ex. `aiSettingsRepository` din main), flag-uieste in output, NU propune refactor.

**Recommended:** rulam audit-ul dupa `git checkout main` ca sa eliminam ambiguitatea. Eu pot face checkout-ul + revin pe branch dupa ce salvez output-urile.

---

## 7. Estimare effort + timeline

| Wave | Agenti | Timp wall-clock estimat | Dependinte |
|------|--------|-------------------------|-----------|
| 1    | 3 paraleli | 8-15 min | niciuna |
| 2    | 1 (refactor-planner) | 10-15 min | Wave 1 complet |
| 3    | 2 paraleli (A5 + A6) | 8-12 min | poate rula in paralel cu Wave 2 |
| Consolidare | Claude principal | 5-10 min | toate de mai sus |
| **TOTAL** | — | **~30-50 min** | — |

---

## 8. Deliverable final

Un folder `audit/` cu:

```
audit/
  00-EXECUTIVE-SUMMARY.md      # priorities + verdict (Claude principal)
  01-inventory.md              # A1 — hot-spot map
  02-duplication.md            # A2 — clusters duplicate
  03-architecture.md           # A3 — god components + concerns
  04-refactor-plans.md         # A4 — staged plans top 5
  05-quick-wins.md             # A5 — simplificari LOW-RISK
  06-dead-code.md              # A6 — dead code + deps neutilizate
```

Audit-ul **nu modifica cod**. Outputurile servesc drept input pentru PR-uri ulterioare, fiecare cu scope ingust (1 target / PR), insotite de teste si gate biome + tsc + vitest per regula `CLAUDE.md`.

---

## 9. Aprobare necesara inainte de start

Inainte de a porni Wave 1, vreau OK pe:

1. Scope-ul exclusiv pe `main` (cu sau fara `git checkout main` upfront)
2. Lista top-10 din sectiunea 1 — adaugi/scoti ceva?
3. Daca preferi sa NU se creeze folder `audit/` si sa primesti totul in chat (default: folderul, ca sa fie persistent si reluabil)
4. Daca vrei o singura runda completa Wave 1+2+3, sau preferi sa validezi dupa Wave 1 inainte de A4 (recomand validare intermediara — A4 e cel mai scump si depinde de calitatea selectiei top-5)
