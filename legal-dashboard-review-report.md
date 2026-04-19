# Legal Dashboard Engineering Review

Data: 2026-04-19
Target: `C:\Users\Cezar\Desktop\Claude Code\Legal Dashboard`

## Scop

Raport tehnic orientat spre development pentru:
- code quality
- security posture
- component architecture
- remediation planning

## Ce Am Verificat

- `backend/src/index.ts`
- `backend/src/routes/rnpm.ts`
- `backend/src/services/rnpmSearchService.ts`
- `backend/src/db/schema.ts`
- `backend/src/db/searchRepository.ts`
- `backend/src/db/avizRepository.ts`
- `electron/main.js`
- `electron/preload.js`
- `frontend/src/App.tsx`
- `frontend/src/hooks/useApiKey.ts`
- `frontend/src/hooks/useDialog.ts`
- `frontend/src/components/DosarModal.tsx`
- `frontend/src/components/DosareTable.tsx`
- `frontend/src/components/InstitutieSelect.tsx`
- `frontend/src/components/TermeneTable.tsx`
- `frontend/src/components/rnpm/RnpmDetailModal.tsx`
- `frontend/src/components/rnpm/RnpmSavedStats.tsx`
- `frontend/src/components/rnpm/RnpmSearchForm.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/export.ts`
- `frontend/src/lib/rnpmExport.ts`
- `frontend/package.json`
- `backend/package.json`

## Validare Rulata

- `npx tsc --noEmit -p backend/tsconfig.json` — OK
- `npx tsc --noEmit -p frontend/tsconfig.json` — OK
- `npm audit --omit=dev --json` in `backend` — advisories moderate pe `hono` si `@hono/node-server`
- `npm audit --omit=dev --json` in `frontend` — advisories pe `dompurify`, `jspdf`, `jspdf-autotable`, `xlsx`
- `npm test --workspace=backend` — esuat in mediu curent din cauza `spawn EPERM`; fara verdict util pe test suite

## Executive Summary

Aplicatia este intr-o stare tehnica mai buna decat intr-o iteratie anterioara. Doua probleme importante au fost deja corectate:
- protectia de path traversal din static serving
- eliminarea logging-ului RNPM cu payload sensibil

Problemele active, relevante pentru development, sunt:
- secret management incompatibil cu un deployment web real
- dependente vulnerabile exact in fluxuri folosite in productie
- dialoguri/modale implementate inconsistent
- fisiere mari, cu responsabilitati amestecate, care reduc testabilitatea
- framework stack backend ramas in urma fata de advisories curente

## Findings

### [P1] Secret Management Incompatibil Cu Web Mode

**Root cause**
Hook-ul de chei API are fallback pe `localStorage` cand `safeStorage` nu este disponibil. In acest mod, persistenta este doar obfuscata, nu securizata.

**Evidence**
- `frontend/src/hooks/useApiKey.ts:19-20`
- `frontend/src/hooks/useApiKey.ts:56-63`
- `frontend/src/hooks/useApiKey.ts:139-148`

**Detaliu tehnic**
- `ENC_KEY` este folosit doar daca `window.desktopApi` si `safeStorage` sunt disponibile.
- In fallback, `saveLegacy()` scrie cheile in `localStorage`.
- Obfuscarea este reversibila si nu reprezinta control de securitate.

**Impact**
- incompatibil cu obiectivul declarat de web deployment
- expunere a cheilor la XSS, extensii de browser, profile compromise, backup-uri locale
- poate genera o falsa impresie de protectie in cod si documentatie

**Remediere recomandata**
- elimina complet persistenta client-side a cheilor pentru web mode
- muta cheile pe backend si ruleaza AI numai cu chei server-side
- alternativ, foloseste tokenuri scurte emise de backend, nu chei brute in browser
- pana exista acest model, dezactiveaza AI in web mode

**Work items**
- separa explicit `desktop secret flow` de `web secret flow`
- adauga feature flag sau runtime guard pentru AI in web
- actualizeaza `SECURITY.md` ca sa reflecte clar comportamentul permis

### [P1] Dependente Vulnerabile Pe Fluxuri Active

**Root cause**
Frontend-ul ruleaza in productie cu versiuni auditabile vulnerabile pentru sanitizare si export.

**Evidence**
- `frontend/package.json:14-16`
- `frontend/package.json:24-25`
- `frontend/src/components/DosareTable.tsx:2`
- `frontend/src/components/DosareTable.tsx:757-962`
- `frontend/src/lib/export.ts:128`
- `frontend/src/lib/export.ts:370`
- `frontend/src/lib/export.ts:438`
- `frontend/src/lib/export.ts:511`
- `frontend/src/lib/export.ts:731`
- `frontend/src/lib/rnpmExport.ts:159`
- `frontend/src/lib/rnpmExport.ts:451`

**Audit summary**
- `dompurify` — advisories moderate
- `jspdf` — advisories high/critical
- `jspdf-autotable` — afectat prin `jspdf`
- `xlsx` — advisories high

**Detaliu tehnic**
- `DOMPurify` este folosit direct pe continut AI in `DosareTable`.
- `jsPDF` este folosit in exporturile user-facing.
- `xlsx-js-style` este folosit pentru scriere `.xlsx`; `xlsx` apare in runtime pentru tipuri/referinte si trebuie reevaluat daca este necesar ca dependenta prod.

**Impact**
- suprafata reala pe render AI si export PDF
- risc de exploit chain prin continut AI sau date externe
- debt de patching care va creste in timp

**Remediere recomandata**
- upgrade imediat `dompurify`
- upgrade sau inlocuire `jspdf` / `jspdf-autotable`
- verifica daca `xlsx` poate fi eliminat din dependente runtime
- reruleaza smoke tests pe:
  - AI output rendering
  - export PDF dosare
  - export PDF termene
  - export RNPM PDF
  - export XLSX dosare/termene/RNPM

**Work items**
- creeaza un task separat doar pentru `dependency hardening`
- dupa upgrade, adauga un mini test matrix manual sau automat pe exporturi

### [P2] Dialog System Inconsistent

**Root cause**
Exista un hook comun bun pentru dialoguri, dar aplicatia nu il foloseste uniform. Mai multe modaluri isi implementeaza singure escape handling, close logic si focus behavior.

**Evidence**
- Primitive existent: `frontend/src/hooks/useDialog.ts:6-41`
- Folosire buna: `frontend/src/App.tsx:229`, `:286-288`
- Implementari paralele:
  - `frontend/src/components/DosarModal.tsx:13-26`
  - `frontend/src/components/rnpm/RnpmDetailModal.tsx:15-20`
  - `frontend/src/components/rnpm/RnpmSavedStats.tsx:60`, `:99`, `:193`, `:352`, `:376`, `:402`
  - `frontend/src/components/InstitutieSelect.tsx:57-71`, `:152-159`
- Scrolling problematic:
  - `frontend/src/components/rnpm/RnpmDetailModal.tsx:91`

**Detaliu tehnic**
- `useDialog` deja rezolva:
  - focus initial
  - `Escape`
  - body scroll lock
  - restore focus
- unele modaluri nu seteaza `role="dialog"` / `aria-modal`
- unele asculta direct `window.addEventListener("keydown", ...)`
- `RnpmDetailModal` face `window.scrollBy(...)` la schimbarea tabului

**Impact**
- a11y inconsistent
- comportament diferit intre ecrane
- risc de bug-uri la focus si scroll
- cost mare de mentenanta, fiindca fiecare modal urmeaza propriile reguli

**Remediere recomandata**
- extrage un `DialogShell` sau un primitive comun
- obliga toate modalurile sa foloseasca:
  - `useDialog`
  - `role="dialog"`
  - `aria-modal="true"`
  - focus trap / restore focus
  - scroll doar in containerul modalului
- elimina `window.scrollBy` din `RnpmDetailModal`

**Work items**
- standardizeaza:
  - `DosarModal`
  - `RnpmDetailModal`
  - `StatsModal`
  - `RestoreModal`
  - `InstitutieSelect`

### [P3] Fisiere Monolitice Si Responsabilitati Amestecate

**Root cause**
Mai multe componente si module au crescut incremental fara separare clara intre UI, state orchestration, rendering si infrastructura.

**Evidence**
- `frontend/src/components/DosareTable.tsx` — 1063 linii
- `frontend/src/components/rnpm/RnpmSearchForm.tsx` — 863 linii
- `frontend/src/App.tsx` — 502 linii
- `backend/src/index.ts` — 1214 linii

**Detaliu tehnic**
- `DosareTable` combina:
  - tabel/paginare/selectie
  - mark-as-viewed
  - AI single-agent
  - AI multi-agent
  - sanitizare HTML
  - export analysis
- `RnpmSearchForm` combina:
  - state pentru toate tipurile RNPM
  - mapping request payload
  - confirm flows
  - UI sections multiple
- `backend/src/index.ts` combina:
  - bootstrap
  - middleware
  - rate limiting
  - SOAP routes
  - AI routes
  - static serving
  - shutdown lifecycle

**Impact**
- testabilitate scazuta
- review mai greu
- refactoruri mai costisitoare
- risc mai mare de regresii transversale

**Remediere recomandata**
- `DosareTable`
  - extrage AI panel
  - extrage analysis renderer
  - extrage table selection/export toolbar
  - extrage expanded row details
- `RnpmSearchForm`
  - extrage field builders per search type
  - extrage request mapper
  - extrage reusable fieldsets
- `backend/src/index.ts`
  - separa route modules
  - separa AI handlers
  - separa static serving
  - separa middleware config / startup lifecycle

### [P3] Hono Stack Ramane In Urma

**Root cause**
Versiunile `hono` si `@hono/node-server` sunt vechi fata de advisories curente.

**Evidence**
- `backend/package.json:15`
- `backend/package.json:18`

**Observatie tehnica**
- din codul actual, impactul direct pare mai mic:
  - static serving-ul vulnerabil standard nu este folosit
  - cookie write helpers nu par expuse pe suprafata critica
- totusi, framework-ul ramane nerefresh-uit si auditul continua sa raporteze advisories

**Impact**
- debt de securitate
- potentiale surprize la viitoare schimbari de cod
- mentenanta defensiva mai slaba decat trebuie

**Remediere recomandata**
- upgrade `hono`
- upgrade `@hono/node-server`
- reruleaza:
  - route smoke tests
  - static serving checks
  - health endpoint
  - RNPM route sanity checks

## Ce Nu Mai Este Finding Activ

Aceste probleme erau relevante anterior, dar nu mai sunt findings curente in codul inspectat acum:

### Static Path Traversal Fixat

**Evidence**
- `backend/src/index.ts:1121-1142`

**Observatie**
- static serving-ul foloseste `path.relative(...)`
- `decodeURIComponent` este tratat defensiv
- verificarea de escape din director este corecta

### Logging RNPM Sensibil Eliminat

**Evidence**
- `backend/src/services/rnpmSearchService.ts:90-101`

**Observatie**
- se logheaza doar tipul cautarii, pagina si lista campurilor prezente
- valorile PII nu mai sunt scrise in log

### Selectia Din TermeneTable Este Stabilizata

**Evidence**
- `frontend/src/components/TermeneTable.tsx:154-173`
- `frontend/src/pages/Termene.tsx:167-201`

**Observatie**
- cheile de selectie/export sunt acum stabile
- deduplicarea din `loadMore` foloseste aceeasi semantica de cheie

## Elemente Pozitive De Pastrat

- Electron hardening este bun:
  - `nodeIntegration: false`
  - `contextIsolation: true`
  - `sandbox: true`
  - preload minim
- secret storage pe desktop foloseste `safeStorage`
- backend-ul este loopback-first
- exista limite clare pe body size, fanout si rate limiting
- protectia la formula injection exista in:
  - `frontend/src/lib/export.ts:56`
  - `frontend/src/lib/rnpmExport.ts:15`
- type-check-ul trece pe ambele parti ale aplicatiei

## Ordine Recomandata De Implementare

### Faza 1: Security Hardening

- elimina fallback-ul de persistare chei in web mode
- upgrade `dompurify`
- upgrade/inlocuire `jspdf` si `jspdf-autotable`
- reevalueaza dependenta `xlsx`

### Faza 2: UI Infrastructure

- standardizeaza toate modalurile pe un primitive comun
- elimina logica duplicata de `Escape`, focus si scroll
- adauga reguli unice pentru `role`, `aria-modal`, focus restore

### Faza 3: Refactor Structural

- sparge `DosareTable`
- sparge `RnpmSearchForm`
- sparge `backend/src/index.ts`
- muta logicile grele in hook-uri si module pure, usor testabile

### Faza 4: Framework Hygiene

- upgrade `hono` stack
- reruleaza auditul
- reruleaza smoke tests

## Gaps De Validare

- testele backend nu au putut fi validate in mediul curent din cauza `spawn EPERM`
- nu exista in aceasta sesiune confirmare executabila pentru:
  - fluxurile complete de export
  - regresii de modal focus management
  - smoke tests RNPM dupa potentiale upgrade-uri de dependente

## Concluzie

Din perspectiva development, proiectul are o baza buna, dar are inca doua tipuri clare de lucru:
- hardening real pe secrete si dependente
- refactor pentru reducerea complexitatii structurale

Partea buna este ca o parte din riscurile semnalate anterior au fost deja rezolvate. Partea care ramane de facut este bine delimitata si poate fi atacata incremental, fara rescriere ampla, daca ordinea de implementare este corecta.
