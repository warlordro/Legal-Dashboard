# Codex Backlog - Legal Dashboard

> Status curent: redeschis 2026-05-07 — Task E (RNPM cap observability).
> Generat initial: 2026-05-03 (post v2.10.4).
> Inchis (rundă 1): 2026-05-03 — Task B/C livrate in v2.10.5, Task A scos in v2.10.6.
> Redeschis: 2026-05-05; Inchis (rundă 2): 2026-05-05 — Task D livrat in v2.14.0.
> Redeschis: 2026-05-07 — Task E (post analiza document tehnic RNPM cap 1500).
> Repo: `Legal Dashboard` (Electron + Hono + better-sqlite3).

## Task-uri active

### Task E - RNPM cap observability (gap audit + status enum rename)

**Status:** activ, neasignat. Origine: analiza document tehnic extern (`solutie_tehnica_rnpm_cap_1500.md`) post v2.18.0.

#### Context

v2.18.0 livreaza tier-2 split pe `destinatieInscriere` cu best-effort + disclosure UI. Gap-ul e calculat la runtime ca `gap = tier1SubTotal - SUM(tier2 subTotals)` si afisat ca un singur numar in banner.

Problema: gap-ul agregat ascunde **trei cauze distincte** care merita raportate separat pentru audit + observability:
1. **Terminal cap exceeded**: bucket cu total > 1500 fara axa de split disponibila (ex. `creante` care n-are destinatii enumerabile, sau `specifice` tier-2 destinatie 5 cu 1744 records).
2. **Silent refusal**: RNPM intoarce `total > 1500` dar `documents: []` pe toate paginile (vezi comentariu `rnpmSearchService.ts:55`).
3. **Residual unclassified**: `SUM(tier-2 children) < tier-1 parent total` — diferenta = records nealocate la nicio destinatie enumerabila (probabil records cu `destinatieInscriere=null`).

In plus, status-ul curent (`recovered`/`partial`/`rejected`) e ambiguu. `rejected` se mapeaza confuz cu HTTP rejection, nu cu "blocat de cap". Document tehnic propune `complete`/`partial`/`blocked_by_rnpm_cap`, mai expresiv.

NOT in scope (analizat si respins explicit):
- Refactor generic `Splitter[]` registry — overengineering pentru 2 splittere fara axa noua de adaugat.
- Pattern `probeRnpm({ pageSize: 1 })` separat de fetch — regresie pe captcha cost (RNPM cere captcha per request, nu per page size).
- Tier-3 "known creditor split" — partial doar la re-fetch, residualul ramane neaccesibil. Vezi PROBLEM-rnpm-cap-1500.md.

#### Acceptance criteria

- [ ] Tip nou `RnpmGapReason = "terminal_cap" | "silent_refusal" | "residual_unclassified"` exportat din `services/rnpmSearchService.ts`.
- [ ] `SplitSubResult` extins cu `gapReason?: RnpmGapReason` cand `status: "partial"` sau `status: "rejected"`.
- [ ] `executeNestedDestinationSplit` distinge intre `terminal_cap` (sub-tip fara destinatii enumerable + total > 1500), `silent_refusal` (response cu `total > MAX_TOTAL_RESULTS && documents.length === 0` la pagina 1), si `residual_unclassified` (calculat la `finally`: `tier1Total - SUM(tier2 subTotals)`).
- [ ] Status enum rename: `rejected` -> `blocked` in `SplitSubResult.status` + propagat in `RnpmSplitProgress.phase` SSE + tipuri frontend (`types/rnpm.ts`, `lib/rnpmApi.ts`). Backwards-compatible: backend accepta vechiul label in tests dar emite cel nou.
- [ ] Banner UI in `pages/RnpmSearch.tsx` arata cele 3 categorii separate cu count + reason humanizat (RO).
- [ ] Audit event `rnpm.cap_hit` la finalul oricarei rulari split cu `status !== "complete"`. Detail JSON: `{ baseQuery, rnpmTotal, recovered, gaps: [{reason, totalReported, splitPath}], appVersion, requestId }`. Limita 16 KiB pe `detail_json` (preventie expansiune pentru cazuri patologice cu multe gaps).
- [ ] Test backend pentru: terminal cap (creante > 1500), silent refusal (mock RNPM cu total>cap + docs=[]), residual unclassified (parent 1822, children sum 1820, gap 2).
- [ ] Test frontend pentru: rendering banner cu 3 reason-uri distincte, status `blocked` afisat ca "Blocat de RNPM" nu "Respins".
- [ ] Documentatie in CHANGELOG.md + in-app `frontend/src/data/changelog-entries.tsx` la version bump (v2.19.0).

#### Note de design

- Gap reason enum locked la 3 valori — daca RNPM lanseaza vreodata axa de split aditionala, ramane reason-ul `terminal_cap` ca fallback.
- Audit-ul nu duplica `documents[]` (deja in `rnpm_avize`); doar metadata + counts.
- `requireRole("admin")` NU e necesar pe audit read — pagina history e per-owner.
- Status `complete` cand `gaps.length === 0` SI `recovered === rnpmTotal`. Status `partial` cand `gaps.length > 0` SI `recovered > 0`. Status `blocked` cand `recovered === 0`.
- Compatibilitate UI: dropdown filtru status pe pagina history poate ramane simplu binar (success/blocked) — gap reason e detail in expand.

#### Estimat

3-4h dev + 1h test + 0.5h docs = ~half day. Fara captcha cost extra (gap se calculeaza din date deja fetched in tier-1/tier-2).

### Task D - Alerte: bulk dismiss (selectie + toate existente)

**Status:** livrat in v2.14.0.

#### Context

Pagina `Alerte` are deja:
- checkbox per rand cu Set<number> pentru selectie multipla (introdus in v2.13.0 pentru export);
- buton `Marcheaza pagina` care marcheaza ca *citite* alertele de pe pagina curenta (NU le inchide / dismiss).

Lipseste capacitatea de a inchide (dismiss) alerte in bulk, fie pe selectie, fie pe toate cele existente in inboxul vizibil.

Backend-ul are deja `POST /api/v1/alerts/:id/dismiss` per-alert (single). Pentru bulk e nevoie fie de loop pe client (slow + N audit events + race conditions cu SSE), fie endpoint nou de tip `POST /api/v1/alerts/dismiss-bulk` cu Zod `discriminatedUnion("mode", [ids|filters])` — aceeasi forma ca la export pentru consistenta.

#### Acceptance criteria

- [x] Buton `Inchide selectia` apare in toolbar-ul de selectie din `Alerts.tsx` cand `selectedIds.size > 0`; disabled altfel.
- [x] Buton `Inchide toate` (cu confirmare modal) marcheaza dismissed toate alertele care satisfac filtrele curente (jobKind, q, kind, severity, onlyUnread, includeDismissed=false implicit, from, to).
- [x] Endpoint nou `POST /api/v1/alerts/dismiss-bulk` cu Zod `discriminatedUnion("mode", [{ids: number[]} | {filters: AlertListQuery}])`, cap 10k randuri, audit `alerts.dismiss_bulk` cu `mode + count` in detail_json.
- [x] WHERE owner_id = ? guard pe ambele moduri (cross-owner protection).
- [x] Refresh inbox + recompute `unread`/`total` dupa bulk dismiss.
- [x] SSE stream nu fanout-eaza individual pe fiecare ID; clientul re-fetch dupa raspunsul HTTP.
- [x] Test backend pentru: success path (ids + filters), 413 la peste 10k, 0 randuri returneaza 200 cu count: 0, owner-isolation.
- [x] Test frontend pentru: dismissBulk in `lib/alertsApi.test.ts` (ids/filters payload encoding).

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
