# Codex Backlog - Legal Dashboard

> Status curent: redeschis 2026-05-05 cu un task nou (vezi mai jos).
> Generat initial: 2026-05-03 (post v2.10.4).
> Inchis (rundă 1): 2026-05-03 — Task B/C livrate in v2.10.5, Task A scos in v2.10.6.
> Redeschis: 2026-05-05.
> Repo: `Legal Dashboard` (Electron + Hono + better-sqlite3).

## Task-uri active

### Task D - Alerte: bulk dismiss (selectie + toate existente)

**Status:** propus 2026-05-05, post v2.13.1. Neimplementat.

#### Context

Pagina `Alerte` are deja:
- checkbox per rand cu Set<number> pentru selectie multipla (introdus in v2.13.0 pentru export);
- buton `Marcheaza pagina` care marcheaza ca *citite* alertele de pe pagina curenta (NU le inchide / dismiss).

Lipseste capacitatea de a inchide (dismiss) alerte in bulk, fie pe selectie, fie pe toate cele existente in inboxul vizibil.

Backend-ul are deja `POST /api/v1/alerts/:id/dismiss` per-alert (single). Pentru bulk e nevoie fie de loop pe client (slow + N audit events + race conditions cu SSE), fie endpoint nou de tip `POST /api/v1/alerts/dismiss-bulk` cu Zod `discriminatedUnion("mode", [ids|filters])` — aceeasi forma ca la export pentru consistenta.

#### Acceptance criteria

- [ ] Buton `Inchide selectia` apare in toolbar-ul de selectie din `Alerts.tsx` cand `selectedIds.size > 0`; disabled altfel.
- [ ] Buton `Inchide toate` (cu confirmare modal) marcheaza dismissed toate alertele care satisfac filtrele curente (jobKind, q, kind, severity, onlyUnread, includeDismissed=false implicit, from, to).
- [ ] Endpoint nou `POST /api/v1/alerts/dismiss-bulk` cu Zod `discriminatedUnion("mode", [{ids: number[]} | {filters: AlertListQuery}])`, cap 10k randuri, audit `alerts.dismiss_bulk` cu `mode + count` in detail_json.
- [ ] WHERE owner_id = ? guard pe ambele moduri (cross-owner protection).
- [ ] Refresh inbox + recompute `unread`/`total` dupa bulk dismiss.
- [ ] SSE stream nu fanout-eaza individual pe fiecare ID (ar inunda clientul); foloseste un singur eveniment `alerts.refresh` cand bulk-ul depaseste un prag (de ex. 50).
- [ ] Test backend pentru: success path (ids + filters), 413 la peste 10k, 0 randuri returneaza 200 cu count: 0, owner-isolation.
- [ ] Test frontend pentru: confirmation modal pentru `Inchide toate` (impact mai mare), counter actualizat dupa dismiss bulk.

#### Note de design

- `Inchide selectia` foloseste mode: "ids" — cap 10k, dar selectia umana realista < 100 randuri.
- `Inchide toate` foloseste mode: "filters" cu filtrele curente; daca `includeDismissed=true` e activ, butonul ramane dezactivat (nu inchidem alerte deja inchise).
- Idempotency: a doua chemare nu schimba nimic (dismissed_at deja setat; UPDATE WHERE dismissed_at IS NULL).
- Audit-ul listeaza `count` (nu `ids[]`) pentru ca un mode: "filters" cu 1000 randuri ar umfla audit_log.

---

## Task-uri inchise / istorice

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
