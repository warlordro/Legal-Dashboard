# Plan — Redesign radical al Dashboard-ului (operational, interactiv, on-demand)

> **Status**: draft v1.0, 2026-05-01 (post-v2.6.8)
> **Owner**: solo dev + Claude Code
> **Scope**: inlocuirea actualului Dashboard (landing static cu hero + 2 carduri ultima cautare + CTA-uri) cu un dashboard operational real — KPI live, timeline, charts, shortcuts, reports on demand.
> **Mod operational**: desktop-first; web-mode compat din ziua 1 (doar `owner_id`-scoped, nimic nou hardcodat).

---

## 0. Diagnostic curent

Fisierul `frontend/src/pages/Dashboard.tsx` (281 linii) este in esenta o pagina de marketing:
- Hero "Legal Dashboard" + paragraf descriere
- `LastDosareCard` + `LastRnpmCard` (cele mai recente 1 cautari, 4 metrici fiecare)
- 2 carduri CTA (`/dosare`, `/termene`) cu icon + descriere + lista bullet
- Grid "Tipuri de proces" (badge-uri statice)
- Card "Informatii API" + "Versiune Aplicatie" cu butoane catre dialog Manual / Changelog
- Modale: `ChangelogDialog`, `ManualDialog`

**Probleme reale**:
1. **Zero feedback operational** — utilizatorul nu vede in cat timp ruleaza joburile, cate alerte are nesusite, cat AI a consumat azi.
2. **Zero shortcuts** — orice actiune cere navigare in 2-3 click-uri.
3. **Zero raportare** — nu exista nicaieri "exporta tot ce s-a intamplat saptamana asta".
4. **Date deja in DB neexpuse** — avem `monitoring_jobs`, `monitoring_runs`, `alerts`, `ai_usage`, `aviz`, `searches` cu istoric; Dashboard-ul nu citeste niciun ranking / agregat.
5. **Static peste tot** — singurele componente "vii" sunt cele 2 LastSearch carduri; restul sunt JSX hardcodat.

---

## 1. Principii directoare

1. **KPI > naratiune.** Pagina sa raspunda in 2 secunde la "ce-i azi de facut?", nu la "ce face aplicatia asta?".
2. **Live cand e ieftin, polled cand e scump.** SSE deja livreaza alerte; alte sectiuni — interval unificat de 30s pe `/dashboard/summary` cu `useEffect + setInterval` cu cleanup. SSE peste polling (vezi §3.1 si §3.8 dedup).
3. **Backend centralizat agregari.** Adaugam un endpoint `/api/v1/dashboard/summary` care intoarce TOT ce vede stripa de KPI in <100ms; nu spamuim 7 endpoint-uri din UI. **Un singur ciclu de refresh** (30s) pentru intreaga stripa.
4. **Owner-scoped.** Toate query-urile noi trec prin `getOwnerId(c)` — zero `WHERE 1=1`, zero hardcodari `'local'`.
5. **Customizabil dar nu over-configurabil.** Utilizatorul poate ascunde widget-uri si reordona; nu cream un page builder.
6. **Reports on demand reuseaza export-ul existent.** `lib/export.ts` are deja XLSX/PDF cu paleta consistenta — extindem cu `buildDashboardReport` ca sa uneasca dosare + termene + monitoring + AI usage intr-un singur fisier.
7. **Zero feature noi de business — doar suprafata noua peste ce exista.** Daca un widget cere DDL nou, mutam in alt PR.

---

## 2. Layout tinta (12-column grid, responsive)

```text
+-------------------------------------------------------------+
|  Header: salut + data curenta + buton "Raport saptamanal"   |
+-------------------------------------------------------------+
|  KPI strip (4 carduri mici, 1 linie pe desktop, 2x2 mobile) |
|  [Joburi active] [Alerte nesuse] [Run-uri 24h] [AI cost 24h]|
+-------------------------------------------------------------+
|  Quick actions (6 butoane medii, 1 linie)                   |
|  [Cauta dosar] [Adauga monitorizare] [Cauta RNPM]           |
|  [Vezi alerte] [Vezi termene] [Export raport]               |
+-------------------------------------------------------------+
|  Coloana stanga (8 col)         |  Coloana dreapta (4 col)  |
|  +---------------------------+  |  +---------------------+  |
|  | Activity timeline (live)  |  |  | Last search dosare  |  |
|  | - alerte recente          |  |  | (existent)          |  |
|  | - run-uri monitoring 24h  |  |  +---------------------+  |
|  | - cautari recente         |  |  | Last search RNPM    |  |
|  +---------------------------+  |  | (existent)          |  |
|  +---------------------------+  |  +---------------------+  |
|  | Chart: Alerte / 30 zile   |  |  | Quota AI azi        |  |
|  | (Recharts BarChart)       |  |  | (existent in panel) |  |
|  +---------------------------+  |  +---------------------+  |
|  +---------------------------+  |                           |
|  | Chart: AI cost / 30 zile  |  |                           |
|  | (Recharts LineChart)      |  |                           |
|  +---------------------------+  |                           |
+-------------------------------------------------------------+
|  Setup / version footer (info API, changelog, manual)       |
+-------------------------------------------------------------+
```

---

## 3. Modulele noi — specificatie tehnica

### 3.1 KPI strip

**4 carduri mici** (paleta consistenta cu restul aplicatiei, icon + label + value mare + delta).

**Strategie refresh unificata**: o singura fetch periodica la `/api/v1/dashboard/summary` la **30s** (un singur `setInterval` pe pagina). SSE-ul existent `/api/v1/alerts/stream` aplica delta incremental peste cardul "Alerte nesuse" (count++ la `alert_created`, count-- la `alert_seen`/`alert_dismissed`) ca sa nu astepti urmatorul tick de 30s pentru notificari critice. Restul cardurilor traiesc strict pe ciclul de 30s.

| Card | Sursa | Calcul | Sursa update |
|------|-------|--------|--------------|
| Joburi active | `monitoring_jobs WHERE active=1 AND owner_id=?` | count(*) + breakdown `dosar_soap` / `name_soap` | poll 30s |
| Alerte nesuse | `alerts WHERE seen=0 AND dismissed=0 AND owner_id=?` | count(*) + delta vs 24h in urma | poll 30s + SSE delta (incremental) |
| Run-uri 24h | `monitoring_runs WHERE finished_at >= now-24h AND owner_id=?` | count(ok) / count(error) / count(timeout) | poll 30s |
| AI cost 24h | `ai_usage WHERE created_at >= now-24h AND owner_id=?` | sum(cost_usd_milli) / 1000 + count tokens | poll 30s |

**Click pe card** → naviga la pagina respectiva cu filtru aplicat:
- Joburi active → `/monitorizare?active=1`
- Alerte nesuse → `/alerts?status=unseen`
- Run-uri 24h → `/monitorizare/runs?range=24h` (nou — vezi 3.6)
- AI cost 24h → `/setari?tab=ai-usage&range=24h`

### 3.2 Quick actions

**6 butoane mari** cu icon + label scurt + tooltip explicativ. Toate sunt navigare client-side (Router) sau modal trigger:

| Buton | Actiune |
|-------|---------|
| Cauta dosar | navigate `/dosare` + focus pe input |
| Adauga monitorizare | navigate `/monitorizare?action=new` (deschide form-ul automat) |
| Cauta RNPM | navigate `/rnpm` + focus pe input |
| Vezi alerte | navigate `/alerts` |
| Vezi termene | navigate `/termene` |
| Export raport | deschide modal "Raport on demand" (vezi 3.7) |

Implementare: pattern simplu `<Button asChild><Link>...</Link></Button>` din shadcn/ui cu `to={url}` + state pentru auto-open form.

### 3.3 Activity timeline (coloana stanga, 8 col)

**Stream unificat** in ordine cronologica descrescatoare (ultimele 50 evenimente, scroll lazy mai mult la cerere). Tipuri de evenimente afisate:

| Tip | Sursa | Iconul / culoarea | Detalii pe linie |
|-----|-------|-------------------|------------------|
| `alert` | `alerts` | Bell amber | dosar/nume + sumar diff (max 80ch) + timestamp relativ |
| `monitoring_run_ok` | `monitoring_runs WHERE status='ok'` | CheckCircle emerald | tinta + duration_ms + `alerts_created/patched` |
| `monitoring_run_error` | `monitoring_runs WHERE status='error'` | AlertTriangle red | tinta + error_code + buton "Reincearca acum" (POST `/jobs/:id/run`) |
| `search` | `searches` (PortalJust) | Search blue | query + numar rezultate |
| `rnpm_search` | `rnpm_searches` | FileSearch indigo | query + numar rezultate |

Implementare:
- **Backend**: `GET /api/v1/dashboard/timeline?limit=50&before=<iso>` — UNION ALL cu LIMIT global, ordered by `event_at DESC`. Toate sub-query-urile filtrate pe `owner_id`. Fiecare event are cheia `(kind, id)` stabila (vezi §3.8 dedup).
- **Frontend**: poll la 60s + SSE incremental peste; dedup obligatoriu (vezi §3.8). Polling ramane *fallback determinist* — chiar daca SSE pica/se reconecteaza, urmatorul tick reconciliaza lista.
- **Click pe linie** → naviga la detaliu (alerts / monitoring run detail / dosare cu auto-search / rnpm cu auto-search).

### 3.4 Chart: Alerte / 30 zile (Recharts BarChart)

- X axis: ultimele 30 zile (UTC midnight aliniat ca seria daily existenta in AI usage panel)
- Y axis: count alerte / zi
- Bar segmentat pe tip alert (`structural_change`, `solutie_aparuta`, `name_match`, etc.)
- Tooltip: defalcare per tip + total
- **Sursa**: `GET /api/v1/dashboard/alerts-daily?days=30` — agregat `GROUP BY date(created_at), severity_kind` din `alerts`.
- **Click pe bara**: naviga la `/alerts?from=<date>&to=<date>` (filtru de range).

### 3.5 Chart: AI cost / 30 zile (Recharts LineChart)

- Reuseaza endpoint-ul existent `/api/v1/ai-usage/summary?range=30d` (deja implementeaza UTC-midnight aliniat).
- Doua linii: cost_usd zilnic + cumulative running total pe luna curenta.
- Tooltip: cost + tokens + provider breakdown.
- **Click pe punct** → naviga la `/setari?tab=ai-usage&date=<iso>`.

### 3.6 Run history page (NOU — `/monitorizare/runs`)

**Pre-requisite pentru KPI-card "Run-uri 24h" sa fie clickable.** Pagina lista cu:
- Filtre: range (24h / 7d / 30d / custom), status (ok / error / timeout), kind (`dosar_soap` / `name_soap`), owner.
- Tabel paginate (offset-based, page-size 20 / 50 / 100): timestamp, tinta (link), kind, status, duration, alerts_created, alerts_patched, error_code.
- Buton "Export" → XLSX + PDF (reuseaza pattern din `Monitorizare.tsx` v2.6.7).

**Endpoint**: `GET /api/v1/monitoring/runs?from=&to=&status=&kind=&page=&pageSize=` — owner-scoped, paginat.

### 3.7 Reports on demand (modal + endpoint)

**Modal** declansat din quick action "Export raport":
- Range presets: azi / saptamana curenta / luna curenta / custom (date picker).
- Continut selectabil (checkbox-uri): dosare cautate, termene atinse, monitoring runs, alerte, AI usage.
- Format: XLSX (default) sau PDF.
- Buton "Genereaza".

**Frontend**: builder-ul ruleaza in Web Worker existent (`export.worker.ts`) — extindere cu mesaj `dashboardReport`. Orchestreaza intern `buildDosareXlsx`, `buildTermeneXlsx`, `buildMonitoringXlsx`, `buildAlertsXlsx` (nou), `buildAiUsageXlsx` (nou) intr-un singur workbook cu sheets multiple, sau intr-un PDF cu sectiuni.

**Backend**: `POST /api/v1/reports/range` returneaza JSON aggregat cu toate datele in scope (paginat doar daca `> 5000` rows / sectiune; altfel single-shot). Owner-scoped.

### 3.8 Strategie dedup SSE + polling

Combinatia SSE (push, instant) + polling (pull, 30s/60s) creste robustetea (polling-ul reconciliaza dupa reconectare SSE), dar introduce risc de duplicate cand acelasi event ajunge prin ambele cai. Strategia:

**Cheie de dedup canonical**: fiecare event are `(kind, id)` ca tuplu unic — `id` este `alert.id` pentru alerte, `monitoring_runs.id` pentru run-uri, `searches.id` / `rnpm_searches.id` pentru cautari. Cheia se serializeaza ca string `"${kind}:${id}"`.

**KPI strip — card "Alerte nesuse"**:
- State: `{ count: number, knownIds: Set<string> }`.
- La poll (30s): backend intoarce `{ unseenCount, recentIds: string[] }` (ultimele 50 alerte nesuse). Frontend reseteaza `count` la valoarea din backend, `knownIds` reumplut din `recentIds`.
- La SSE `alert_created`: daca `id` nu e in `knownIds` → `count++`, `knownIds.add(id)`. Altfel — ignor (deja contabilizat la ultimul poll).
- La SSE `alert_seen` / `alert_dismissed`: daca `id` IN `knownIds` → `count--`, `knownIds.delete(id)`. Altfel — ignor.
- **Garantie**: contorul converge la valoarea reala in maxim 30s chiar daca SSE rateaza events.

**Activity timeline**:
- State: `events: Event[]`, `keys: Set<string>` derivat din `events.map(e => "${kind}:${id}")`.
- La poll (60s): backend intoarce ultimele 50 events. Frontend reseteaza lista la rezultatul polled (sursa de adevar). Polling ruleaza **neconditional** — nu e dezactivat cand SSE e activ (corectia bug-ului classic "SSE pica → UI ramane stale").
- La SSE `alert_created`: daca cheia NU e in `keys` → `events.unshift(newEvent)`, `keys.add(key)`, trim la 50. Altfel — ignor.
- La SSE pentru alte tipuri (`monitoring_run_completed`, `search_executed`): identic — push prin SSE doar daca exista canal; altfel events apar la urmatorul poll.

**Implicatie API**: endpoint-ul `/dashboard/timeline` trebuie sa garanteze ca `id`-ul intors per `kind` e identic cu cel pe care SSE il emite (acelasi `alerts.id`, nu un tuplu generat in route handler). Test dedicat: `recv` peste poll + SSE simultane, asserta `events.length === uniqueKeys.size`.

---

## 4. Backend — endpoint-uri noi

| Endpoint | Metoda | Body / Query | Output |
|----------|--------|--------------|--------|
| `/api/v1/dashboard/summary` | GET | — | `{ jobs: { active, byKind }, alerts: { unseen, last24h }, runs: { ok, error, timeout, last24h }, ai: { costUsdMilli, tokens, last24h } }` |
| `/api/v1/dashboard/timeline` | GET | `?limit=50&before=<iso>` | `{ events: [{ id, kind, at, title, subtitle, link }], nextBefore: <iso> \| null }` |
| `/api/v1/dashboard/alerts-daily` | GET | `?days=30` | `[{ date, total, byKind: { structural_change, solutie_aparuta, name_match, ... } }]` |
| `/api/v1/monitoring/runs` | GET | `?from=&to=&status=&kind=&page=&pageSize=` | `{ data: [...], page, pageSize, total }` |
| `/api/v1/reports/range` | POST | `{ from, to, sections: ["dosare","termene","monitoring","alerts","ai"] }` | `{ dosare: [...], termene: [...], monitoring: [...], alerts: [...], ai: [...] }` |

**Reguli**:
- Toate trec prin `getOwnerId(c)`.
- Toate scriu audit pe rute non-trivial (range mare, export raport).
- Toate validate cu `validation.ts` (fara `as any`).
- Body limits: summary/timeline/alerts-daily folosesc `limitSmall`; reports/range cu `limitExport`.
- Tests dedicate per endpoint in `backend/src/routes/dashboard.test.ts` (nou) + extinderea suite-ului `monitoring.test.ts` pentru `/runs`.

---

## 5. Frontend — schimbari de structura

### Fisiere noi
- `frontend/src/pages/Dashboard.tsx` — rescris (de la 281 linii → ~350 linii, dar majoritatea compozitie de subcomponente).
- `frontend/src/components/dashboard/KpiStrip.tsx`
- `frontend/src/components/dashboard/QuickActions.tsx`
- `frontend/src/components/dashboard/ActivityTimeline.tsx`
- `frontend/src/components/dashboard/AlertsBarChart.tsx`
- `frontend/src/components/dashboard/AiCostLineChart.tsx`
- `frontend/src/components/dashboard/ReportsModal.tsx`
- `frontend/src/pages/MonitoringRuns.tsx` — pagina noua pentru `/monitorizare/runs`.
- `frontend/src/lib/dashboardApi.ts` — wrapper pentru endpoint-urile noi.

### Fisiere modificate
- `frontend/src/App.tsx` — ruta noua `/monitorizare/runs`.
- `frontend/src/components/Sidebar.tsx` — fara modificari (Dashboard ramane prima ruta).
- `frontend/src/lib/export.ts` — extindere cu `buildAlertsXlsx`, `buildAiUsageXlsx`, `buildDashboardReport`.
- `frontend/src/workers/export.worker.ts` — caz nou `dashboardReport`.
- `frontend/src/pages/dashboard-summary-cards.tsx` — refolosit ca-i (LastDosareCard, LastRnpmCard) in coloana dreapta.

### State management
- Folosim pattern-ul existent (state local + fetch direct via `lib/api.ts`); **nu introducem React Query / Zustand**.
- Pentru polling (30s/60s) — `useEffect` cu `setInterval` + cleanup, idiom deja existent in proiect.
- SSE alerts → `useEventSource` deja existent (re-use).

---

## 6. Fazare (3 PR-uri secventiale)

**Strategie versionare**: fiecare PR aduce feature drop vizibil utilizatorului → minor bump (`X.Y.0`). Patch bumps (`X.Y.Z`) raman rezervate pentru hotfix-uri post-PR daca apar regresii (asa cum am procedat la v2.6.4 → v2.6.8). Versiunile de mai jos sunt **ferme**, nu ambivalente.

### PR-A — KPI strip + Quick actions + endpoint summary (1.5 zile)
- DDL: zero schimbari.
- Backend: `/api/v1/dashboard/summary` + tests (incl. test owner-scope cu 2 owners).
- Frontend: `KpiStrip`, `QuickActions`, integrate in Dashboard sub hero (deasupra LastSearch cards). Ramane si layout-ul vechi sub.
- Validare: tsc, vitest, build, smoke desktop.
- **Bump version**: `v2.7.0` (minor — feature drop nou).

### PR-B — Activity timeline + 2 charts + Run history page (3 zile)
- Backend: `/dashboard/timeline`, `/dashboard/alerts-daily`, `/monitoring/runs` + tests.
- Frontend: `ActivityTimeline`, `AlertsBarChart`, `AiCostLineChart`, `MonitoringRuns` page, ruta `/monitorizare/runs`.
- Layout-ul Dashboard rescris la grid-ul tinta din §2 — eliminam tipuriProces grid + CTA cards mari.
- **Recharts dark mode**: pasare explicita a culorilor temei in props (citite din CSS variables / `useTheme()` hook existent in proiect). NU presupune ca Recharts citeste tema automat — Recharts foloseste literal valorile primite in `fill`/`stroke`/`color`. Smoke test obligatoriu in dark mode (axes + tooltip + grid lines + bar/line colors lizibili).
- Validare: tsc, vitest, build, smoke desktop in light + dark mode, screenshot before/after.
- **Bump version**: `v2.8.0` (minor — feature drop major: timeline + 2 charts + pagina noua).

### PR-C — Reports on demand modal + builder Web Worker (2 zile)
- Backend: `/api/v1/reports/range` + tests.
- Frontend: `ReportsModal`, extindere `lib/export.ts` cu `buildDashboardReport`, dispatch in worker.
- Validare: tsc, vitest, build, smoke (XLSX deschis manual + PDF deschis manual), test cu range custom 30 zile + sectiuni multiple.
- **Bump version**: `v2.9.0` (minor — feature drop nou: rapoarte on-demand).

**Total estimat**: 6.5 zile lucrate de un dev solo cu Claude Code (incl. doc updates si handoff). Versiuni dupa secventa: `2.7.0` → `2.8.0` → `2.9.0`.

---

## 7. Riscuri & mitigari

| Risc | Mitigare |
|------|----------|
| Endpoint `/dashboard/summary` lent (joins peste 4 tabele) | EXPLAIN QUERY PLAN; toate au index pe `owner_id` + `created_at`/`finished_at`; cap explicit la 24h fereastra. |
| Polling spam pe 4 carduri × 60s × N useri (in mod web) | un singur endpoint `/summary` per refresh ciclu; cache 30s in repository (Map<ownerId, {payload, expiry}>). |
| Activity timeline UNION mare blocheaza UI | cap LIMIT 50 in fiecare sub-query, ORDER BY in fiecare, apoi UNION ALL + ORDER BY exterior + LIMIT 50; covered indexes pe `created_at DESC`. |
| Reports on demand cu range mare (1 luna × 5 sectiuni) | streamed JSON sau pagination implicita: daca total > 5000 rows / sectiune, intoarcem cursor + UI ruleaza N requests. Web Worker pentru build XLSX. |
| Layout-ul nou rupe userii obisnuiti | Pastram in-app changelog cu screenshot before/after; LastSearch cards raman vizibile in coloana dreapta. |
| Charts adauga bundle size mare | Recharts e deja in bundle (folosit in `MetricsPanel`, `TermeneMetrics`). Zero dep noi. |

---

## 8. Definition of Done (per PR)

- [ ] tsc backend + frontend curat (zero erori)
- [ ] vitest backend pass (suite existenta + tests noi)
- [ ] build frontend curat (Vite)
- [ ] Smoke desktop: Dashboard se incarca <2s la prima vizita; 0 erori in DevTools console
- [ ] CHANGELOG.md + STATUS.md + SESSION-HANDOFF.md + CLAUDE.md `Versiune Curenta` + EXECUTION-ROADMAP.md status line + `frontend/src/data/changelog-entries.tsx` actualizate
- [ ] Owner-scoping verificat (test cu 2 owner_id distincti — fiecare vede doar ce-i al lui)
- [ ] Audit log scrie pe rutele non-trivial
- [ ] Body limits + rate limits aplicate
- [ ] Commit + push origin/main

---

## 9. Decizii deschise (pentru cand reluam discutia)

1. **Ordinea fata de PR-9 (Auth pluggable)?** PR-9 e in EXECUTION-ROADMAP ca next. Dashboard redesign-ul (PR-A..C) il putem face fie inainte (motivatie: feedback util in desktop chiar acum), fie dupa (motivatie: web cutover-ul beneficiaza enorm de un dashboard vizibil). **Recomandare**: PR-A (KPI strip + summary) inainte de PR-9 — e izolat, e vizibil, e ieftin; PR-B + PR-C dupa PR-9 ca sa avem `user.id` real cand layout-ul cere customization per-user.
2. **Customization/drag-and-drop**? Initial **OUT of scope** — daca userul cere, adaugam in PR-D (4-a) cu `react-grid-layout` + persist in `meta_json` din `users`.
3. **Dark mode pe charts?** Recharts NU respecta tema automat — foloseste valorile literale primite in props (`fill`, `stroke`, `color`). PR-B include task explicit: pasare culori tema din CSS variables / `useTheme()` hook existent + smoke test in dark mode (axes + tooltip + grid lines + bars/lines lizibili). Nu mai e "decizie deschisa" — e cerinta DoD pentru PR-B.
4. **Rapoarte schedulate (cron)?** OUT of scope. Ramane on-demand. Daca apare nevoie, devine PR-E cu `monitoring_jobs` extins cu `kind='report_email'`.

---

**Concluzie**: Plan ferm pentru un dashboard operational real, ancorat in date deja existente in DB, livrabil in 3 PR-uri secventiale (~6.5 zile dev). Zero schimbari de DDL, zero deps noi. Ordinea recomandata: PR-A acum, PR-9 (Auth pluggable) urmator, PR-B + PR-C dupa.
