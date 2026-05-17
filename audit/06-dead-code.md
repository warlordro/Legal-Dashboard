# 06 — Dead Code & Unused Dependencies Audit

**Scope:** `backend/src/**` + `frontend/src/**` of Legal Dashboard v2.28.0, perspectiva `main` (exclude tot ce e adaugat de branch-ul `feat/openrouter-toggle-stacks`).
**Mod:** Read-only. Verificare prin grep simbol-name across repo (static + dynamic imports). Lockfile + docs ignorate ca evidenta de utilizare.
**Excluse explicit:** migrations 0023/0024, `ownerAiSettingsRepository.ts` (+test), `PLAN-openrouter-toggle.md`, `CODEX-TASK-openrouter-toggle.md`, `frontend/src/data/changelog-entries.tsx`, toate `*.test.ts(x)`/`*.spec.ts`, intregul `backend/src/db/migrations/**`.

---

## 1. Executive Summary

| Categorie | Count | Severitate | Actiune recomandata |
|---|---|---|---|
| Frontend deps neutilizate (0 referinte) | 2 | MEDIE | `npm uninstall` din `frontend/package.json` |
| Componente React orfane | 1 | MEDIE | Delete fisier |
| Functii frontend exportate, 0 consumeri | 1 | MEDIE | Delete + cleanup comentariu adiacent |
| Exporturi backend folosite doar intern + teste | 6 | LOW | Reduce vizibilitatea (drop `export`) sau pastreaza ca API repository public |
| Exporturi frontend folosite doar in acelasi fisier | 2 | LOW | Drop `export` (interne) |
| Backend deps neutilizate | 0 | — | OK |
| Backend deps underused (1–2 usages) | 0 | — | OK |

**Total findings actionabile:** 12 (2 deps + 10 simboluri).
**Risc supressing biome/tsc:** 0 — toate sunt simple removals fara refactor de comportament.

---

## 2. Frontend — Dependinte neutilizate (0 referinte in `frontend/src/**`)

| Pachet | Versiune | Verificare | Recomandare |
|---|---|---|---|
| `date-fns` | `^3.6.0` | `Grep "date-fns" frontend/src/` → 0 hits | `npm uninstall date-fns --workspace=frontend` |
| `react-day-picker` | `^9.14.0` | `Grep "react-day-picker" frontend/src/` → 0 hits | `npm uninstall react-day-picker --workspace=frontend` |

Ambele pachete apar **doar** in `package.json` + `package-lock.json` + (eventual) docs. Nicio importare statica (`from "date-fns"`) sau dinamica (`import("react-day-picker")`) in `frontend/src/`. Date formatting este facut manual in `frontend/src/lib/format.ts` + `Intl.DateTimeFormat`; picker-ul de date custom (`frontend/src/components/DateRangePicker.tsx` etc.) este implementat fara `react-day-picker`.

**Comanda de verificare finala recomandata:**

```powershell
npx depcheck --workspace=frontend
# sau, daca depcheck nu e instalat:
Get-ChildItem frontend/src -Recurse -Include *.ts,*.tsx | Select-String -Pattern "date-fns|react-day-picker"
```

---

## 3. Frontend — Componente React orfane

Componente in `frontend/src/components/**` care nu sunt importate de nimic in repo.

| Componenta | Fisier | Verificare | Note |
|---|---|---|---|
| `DosarModal` | `frontend/src/components/DosarModal.tsx` | `Grep "DosarModal" frontend/src/` → singura referinta este chiar declaratia (line 8 + 13) | ~80 LOC; nu e linkata din router, dashboard, dosare-page, monitorizare. Pare un draft inlocuit de pagina detaliu `frontend/src/pages/DosareDetail.tsx`. |

**Recomandare:** `git rm frontend/src/components/DosarModal.tsx`. Inainte de delete: confirma cu `Grep -i "dosarmodal" .` (case-insensitive, intregul repo) ca nu apare in storybook/test fixtures.

---

## 4. Frontend — Exporturi dead (functii / consturi cu 0 consumeri externi)

| Simbol | Fisier:line | Status | Recomandare |
|---|---|---|---|
| `rnpmExport(ids: number[])` | `frontend/src/lib/rnpmApi.ts:356` | 0 importuri in `frontend/src/`; doar mentionat in comentariul de la line 350 si in `data/changelog-entries.tsx` | Delete functia + adapteaza comentariul. Export-ul actual de RNPM se face prin `rnpmExportXlsxBlob` / `rnpmExportPdfBlob` (server-streaming). |

**Verificare:**

```powershell
Get-ChildItem frontend/src -Recurse -Include *.ts,*.tsx `
  | Select-String -Pattern "\brnpmExport\b" `
  | Where-Object { $_.Path -notlike "*rnpmApi.ts" -and $_.Path -notlike "*changelog-entries*" }
# Astept 0 linii.
```

---

## 5. Frontend — Exporturi folosite doar intern (drop `export`)

Pot ramane functii/componente — dar `export`-ul nu aduce nimic util si umfla suprafata API.

| Simbol | Fisier:line | Singurul consumer | Recomandare |
|---|---|---|---|
| `PJPFToggle` | `frontend/src/components/rnpm/rnpm-form-fields.tsx:73` | `PartyFieldset` la line 202 (acelasi fisier) | Drop `export` (devine helper privat) |
| `PFBlock` | `frontend/src/components/rnpm/rnpm-form-fields.tsx:127` | `PartyFieldset` la line 206 (acelasi fisier) | Drop `export` (devine helper privat) |

---

## 6. Backend — Dependinte

| Pachet | Status | Note |
|---|---|---|
| `@2captcha/captcha-solver` | USED | `services/captchaSolver.ts` |
| `@anthropic-ai/sdk` | USED | `services/ai/anthropic*.ts` |
| `@google/generative-ai` | USED | `services/ai/gemini*.ts` |
| `@hono/node-server` | USED | `index.ts` bootstrap |
| `better-sqlite3` | USED | `db/connection.ts` + electron asarUnpack |
| `csv-parse` | USED | import bulk CSV in rute import |
| `dotenv` | USED | `index.ts` boot |
| `exceljs` | USED | `services/export/*Stream*.ts` (server streaming) |
| `hono` | USED | router principal |
| `nodemailer` | USED | `services/email/mailer.ts` |
| `openai` | USED | `services/ai/openai*.ts` |
| `pdfkit` | USED | `util/pdfStream.ts` |
| `zod` | USED | toate rutele |

**Verdict backend:** nicio dependinta neutilizata, nicio dependinta cu 1–2 usages care sa fie candidat de inlining.

---

## 7. Backend — Exporturi folosite doar intern + teste (drop `export` candidate)

Sunt exporturi `public` care nu au consumer in `backend/src/` cu exceptia fisierului propriu si a test file-ului aferent. Pot ramane publice daca exista intentia de a fi extinse, dar in starea curenta sunt suprafata API neutilizata.

| Simbol | Fisier:line | Singurul consumer extern | Recomandare |
|---|---|---|---|
| `CURATED_AUDIT_ACTIONS` | `backend/src/db/dashboardActivityRepository.ts:37` | Doar referinta in comentariul din `routes/dashboard.ts:163` (NU import). | Drop `export` (devine const local). |
| `AlertsDailyRow` interface | `backend/src/db/dashboardActivityRepository.ts:266` | Folosit doar intern in `aggregateAlertsByDay()` (line 284). Niciun import in `routes/`. | Drop `export` sau muta la signatura inline. |
| `RunsByDayStatusRow` interface | `backend/src/db/dashboardActivityRepository.ts:287` | Folosit doar intern in `aggregateRunsByDayStatus()` (line 309). | Drop `export`. |
| `RunsByStatusRow` interface | `backend/src/db/monitoringRunsRepository.ts:172` | Folosit doar in `aggregateFinalizedRunsByStatusSince()` (line 177+187), acelasi fisier. | Drop `export`. |
| `computeFilterFingerprint` | `backend/src/services/monitoring/diff/dosarSoap.ts:87` | Doar test-ul `diff/dosarSoap.test.ts` + apel intern. | Pastreaza export pentru testabilitate (test file il importa). Marcheaza `@internal`. |
| `buildSubject` / `buildHtmlBody` / `buildTextBody` | `backend/src/services/email/mailer.ts:140,146,157` | Doar test-ul `mailer.test.ts` + apel intern in `sendAlertEmail()`. | Pastreaza export pentru testabilitate. Marcheaza `@internal`. |
| `AuthProvider` interface | `backend/src/auth/authProvider.ts:16` | Folosit doar ca `implements` in acelasi fisier. `middleware/owner.ts` importa `AuthenticatedContext` + `getAuthProvider`, NU `AuthProvider`. | Drop `export`. |

**Note:** Ultimele doua intrari (`computeFilterFingerprint`, `buildSubject`/`buildHtmlBody`/`buildTextBody`) raman exportate ca **internal API pentru teste** — alternativa este `@internal` JSDoc + Biome rule ca sa nu fie consumat extern. Nu sunt dead-code stricte.

**Counter pur "drop export":** 4 simboluri (`CURATED_AUDIT_ACTIONS`, `AlertsDailyRow`, `RunsByDayStatusRow`, `RunsByStatusRow`, `AuthProvider` interface) — restul de 4 (mailer helpers + computeFilterFingerprint) raman expuse pentru testabilitate.

---

## 8. Backend — Verificari care au trecut clean (nimic gasit)

- Toate utilitarele din `util/` (`pdfStream`, `monitoringDate`, `interval`, `slug`, `csv`, etc.) — fiecare are cel putin 2 consumeri in afara fisierului propriu.
- Toate rutele din `routes/` sunt montate in `index.ts`.
- Toate repository-urile din `db/` au consumer (rute sau servicii).
- Toate serviciile AI (`services/ai/**`) sunt apelate via `services/ai/aiProvider.ts` (router).
- `services/batch-dosare.ts` re-exporta `generateMonthlyIntervals` din `util/interval.ts` — apelat din `routes/dosare.ts`. Re-export-ul este consumat (nu este dead).
- `services/captchaSolver.ts` exporta `CaptchaError` / `CaptchaInsufficientFundsError` / `CaptchaMode` — consumate de `routes/rnpm.ts` si `services/rnpm/*`. OK.

---

## 9. Recomandari de verificare automata (rulate dupa cleanup)

Inainte de orice delete, ruleaza:

```powershell
# 1. depcheck pentru dependintele neutilizate
npx depcheck

# 2. type-check ambele workspaces
npx tsc --noEmit -p backend/tsconfig.json
npx tsc --noEmit -p frontend/tsconfig.json

# 3. lint + format
npx biome check

# 4. teste
npm test --workspace=backend
cd frontend && npm test -- --run

# 5. build complet (esbuild backend + Vite frontend)
npm run build
```

Pentru detectie viitoare a dead-code in mod continuu, considera `knip` (mai sofisticat decat depcheck — vede orphan exports):

```powershell
npx knip --workspace frontend
npx knip --workspace backend
```

---

## 10. Lista de actiuni propuse (prioritizate)

| # | Actiune | Impact | Risc | Estimare |
|---|---|---|---|---|
| 1 | **[DONE pre-v2.28.3]** `npm uninstall date-fns react-day-picker --workspace=frontend` | -2 deps in lockfile, ~600 KB node_modules | 0 (zero usages) | 2 min |
| 2 | **[DONE pre-v2.28.3]** Delete `frontend/src/components/DosarModal.tsx` | -80 LOC | 0 (orfan) | 2 min |
| 3 | **[DONE pre-v2.28.3]** Delete `rnpmExport()` din `frontend/src/lib/rnpmApi.ts` + cleanup comentariu line 350 | -25 LOC | 0 (functia nu e apelata) | 5 min |
| 4 | **[DONE in v2.28.3]** Drop `export` pe `PJPFToggle`, `PFBlock`, `CURATED_AUDIT_ACTIONS`, `AlertsDailyRow`, `RunsByDayStatusRow`, `RunsByStatusRow`, `AuthProvider` interface | -7 exports din suprafata API | LOW (intern doar) | 10 min |
| 5 | **[DONE in v2.28.3]** Adauga `@internal` JSDoc pe `computeFilterFingerprint`, `buildSubject`, `buildHtmlBody`, `buildTextBody` | semnaleaza ca sunt export-pentru-teste | 0 | 5 min |

**Estimare totala remediation:** ~25 min + 1 ciclu CI complet (lint/tsc/tests/build).

---

## 11. Verdict

**Nivel cleanliness:** 🟢 BUN.
**Total dead code real (delete candidates):** ~110 LOC + 2 npm deps.
**Suprafata API redusa cu drop-export:** -9 simboluri.
**Niciun "big risk":** nu exista god-files cu exporturi multiple dead; codul este in general bine impachetat.

Recomandare: aplica actiunile #1–#3 imediat (zero risc), iar #4–#5 in PR separat de "API surface tightening" cu review explicit pentru fiecare drop, pentru ca un drop `export` blocheaza importuri viitoare planificate.
