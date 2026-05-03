# Codex Backlog - Legal Dashboard

> Status curent: inchis / document istoric.
> Generat initial: 2026-05-03 (post v2.10.4).
> Inchis: 2026-05-03.
> Repo: `Legal Dashboard` (Electron + Hono + better-sqlite3).

Acest backlog nu mai contine task-uri active.

- Task B si Task C au fost livrate in v2.10.5.
- Task A (`Editare job monitorizare existent`) a fost scos din scope in v2.10.6.
- v2.10.7 este doar patch UX pentru pagina `Monitorizare`: header-ul `Joburi active` afiseaza totalul real paginat, nu doar randurile vizibile pe pagina curenta.

Documentul ramane in repo ca istoric pentru contextul deciziilor si pentru a explica ce s-a livrat din backlog-ul initial.

---

## Task B - Rename Dashboard KPI

**Status:** livrat in v2.10.5.

### Context

KPI-ul `Joburi active` din strip-ul de pe `Dashboard` trebuia redenumit in `Monitorizari active`, iar subtitle-ul tehnic `"X dosar_soap, X name_soap"` trebuia umanizat la `"X Dosare, X Nume"`. Schimbarea a fost strict de label, fara impact pe data flow.

### Fisiere atinse

- `frontend/src/components/dashboard/KpiStrip.tsx`
- documentatia de release si changelog pentru v2.10.5

### Acceptance criteria

- [x] Pagina Dashboard afiseaza `Monitorizari active` + `X Dosare, Y Nume`.
- [x] Restul KPI-urilor (alerte, runs, cost AI) raman intacte.
- [x] Type-check si testele relevante au ramas verzi in release-ul v2.10.5.

---

## Task C - Tab-bar + search pe pagina Alerte

**Status:** livrat in v2.10.5.

### Context

Pagina `Alerte` trebuia sa primeasca paritate cu `Monitorizare` pentru filtrarea dupa sursa jobului si cautarea dupa target:

- tab-bar `Toate / Dosare / Nume` pentru `jobKind`;
- search input debounced peste targetul jobului (`numar_dosar` / `name_normalized`);
- pastrarea filtrelor existente pe event-kind, severitate, unread/dismissed si interval date.

### Implementare livrata

- `backend/src/schemas/alerts.ts`: query schema accepta `jobKind` si `q`.
- `backend/src/routes/alerts.ts`: query-ul este propagat catre repository.
- `backend/src/db/monitoringAlertsRepository.ts`: `listAlerts` filtreaza pe `monitoring_jobs` pentru `jobKind` / `q`, cu match fara diacritice si escape pentru meta-caractere LIKE; `COUNT(*)` foloseste acelasi JOIN cand filtrele target-based sunt active.
- `frontend/src/lib/alertsApi.ts`: `alertsApi.list()` trimite `jobKind` si `q`.
- `frontend/src/pages/Alerts.tsx`: UI cu tab-bar, search debounced, reset de pagina si empty state cu reset.

### Acceptance criteria

- [x] Tab-bar + search input apar pe pagina Alerte.
- [x] Filtrele vechi (kind event, severity, only-unread, include-dismissed, from-to) functioneaza in continuare si se combina cu filtrele noi.
- [x] `jobKind=dosar_soap` ascunde alertele provenite din `name_soap`.
- [x] Cautarea cu/fara diacritice intoarce aceleasi rezultate relevante.
- [x] Wildcard `%` literal nu devine match-all.
- [x] `total` din response ramane count-ul real cand `jobKind` / `q` sunt aplicate.
- [x] Documentatia si changelog-ul au fost actualizate in v2.10.5.

---

## Task A - Editare job monitorizare existent

**Status:** eliminat din scope in v2.10.6.

Motiv: nu face parte din planul curent. Ar schimba contractul de editare al joburilor de monitorizare si ar necesita decizie separata pentru `target`, `target_hash`, deduplicare si compatibilitatea cu alertele/rularile existente.

Daca se reia vreodata, trebuie tratat ca feature nou, nu ca restanta din acest backlog.

---

## Workflow istoric recomandat

Workflow-ul folosit la livrare a fost:

1. Citire `CLAUDE.md`, `SESSION-HANDOFF.md`, `EXECUTION-ROADMAP.md`.
2. Implementare strict pe task-urile aprobate.
3. `npm rebuild better-sqlite3` inainte de testele Node.
4. `npm test --workspace=backend`.
5. `npx tsc --noEmit -p backend/tsconfig.json`.
6. `cd frontend && npx tsc --noEmit`.
7. `npx biome check`.
8. `npm run build`.
9. `npm run rebuild:electron` dupa testele Node.
10. Smoke desktop Electron, nu doar localhost web.
