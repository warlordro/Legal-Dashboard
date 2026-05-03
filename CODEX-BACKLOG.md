# Codex Backlog — Legal Dashboard

> Generat: 2026-05-03 (post v2.10.4)
> Repo: `Legal Dashboard` (Electron + Hono + better-sqlite3)
> Limba codului: romana fara diacritice. Limba comentariilor: ro/en mixt acceptabil.
> Inainte de orice task: citeste [CLAUDE.md](CLAUDE.md) pentru convențiile proiectului.

Acest document descrie 2 task-uri de implementat, fiecare independent. Pot fi executate in orice ordine, dar **Task B** e quick-win (string changes), iar **Task C** e moderat (backend + frontend additiv).

---

## Task B — Rename Dashboard KPI

### Context

KPI-ul `Joburi active` din strip-ul de pe `Dashboard` trebuie redenumit in `Monitorizari active`, iar subtitle-ul tehnic `"X dosar_soap, X name_soap"` trebuie umanizat la `"X Dosare, X Nume"`. Schimbare strict label, fara impact pe data flow.

### Files

**[frontend/src/components/dashboard/KpiStrip.tsx:96](frontend/src/components/dashboard/KpiStrip.tsx#L96)**:

```ts
// Inainte
const jobsByKind = `${data.jobs.byKind.dosar_soap} dosar_soap, ${data.jobs.byKind.name_soap} name_soap`;

// Dupa
const jobsByKind = `${data.jobs.byKind.dosar_soap} Dosare, ${data.jobs.byKind.name_soap} Nume`;
```

**[frontend/src/components/dashboard/KpiStrip.tsx:114](frontend/src/components/dashboard/KpiStrip.tsx#L114)**:

```tsx
// Inainte
label="Joburi active"

// Dupa
label="Monitorizari active"
```

Verifica si **[frontend/src/components/dashboard/KpiStrip.tsx:4](frontend/src/components/dashboard/KpiStrip.tsx#L4)** — comentariul `"Joburi active (cu byKind tooltip)"` se schimba in `"Monitorizari active (cu byKind tooltip)"`.

### Tests

Cauta cu `Grep "Joburi active"` in `frontend/` daca exista test snapshot pe label-ul vechi; daca da, regenereaza snapshot-ul (si confirma ca textul nou apare).

### Acceptance criteria

- [ ] Pagina Dashboard afiseaza "Monitorizari active" + "X Dosare, Y Nume".
- [ ] Restul KPI-urilor (alerte, runs, etc.) raman intacte.
- [ ] Type-check curat. Tests: `npm test --workspace=backend` + `cd frontend && npx tsc --noEmit`.

---

## Task C — Tab-bar + search pe pagina Alerte (paritate cu Monitorizare)

### Context

Pe pagina `Monitorizare` exista deja (din v2.10.4):
- Tab-bar `Toate / Dosare / Nume` care filtreaza dupa kind-ul jobului (`dosar_soap` / `name_soap`).
- Search input debounced 300ms care matcheaza diacritic-insensitive peste `numar_dosar` + `name_normalized`.

Pe pagina `Alerte` filtrele actuale sunt: `<select>` pe `kind` (event-kind: `dosar_new`, `termen_changed`, ...), `<select>` pe `severity`, checkboxes pe `onlyUnread` / `includeDismissed`, range pe `from / to`.

**Decizie de design (confirmata)** — **optiunea 1 (additiv)**:
- Pastram select-ul existent `kind` (event-kind) ca filtru fin pe ce s-a intamplat.
- Adaugam tab-bar nou pentru `jobKind` (job-source-kind) — filtru ortogonal pe sursa.
- Adaugam search input pe `q` peste targetul jobului (numar_dosar / name_normalized).

`AlertKind` (event) si `jobKind` (sursa) sunt dimensiuni diferite — nu se inlocuiesc.

### Backend

**[backend/src/schemas/alerts.ts](backend/src/schemas/alerts.ts)** sau echivalent (cauta `AlertsListQuerySchema` / `ListAlertsOptions` cu `Grep`):

Adauga in query schema:

```ts
jobKind: z.enum(["dosar_soap", "name_soap", "aviz_rnpm"]).optional(),
q: z.string().trim().min(1).max(100).optional(),
```

**[backend/src/db/monitoringAlertsRepository.ts:267 listAlerts](backend/src/db/monitoringAlertsRepository.ts#L267)**:

Lista filtrelor existente live pe `monitoring_alerts a`. Cele noi se aplica pe `monitoring_jobs j` (deja LEFT JOIN-uit). Fii atent: LEFT JOIN inseamna ca alertele cu job sters au `j.*` NULL — daca filtrezi pe `j.kind` sau `j.target_json`, ele cad. Asta e comportamentul dorit (fara target nu poti face match pe nume/dosar).

Adauga in `ListAlertsOptions`:

```ts
jobKind?: "dosar_soap" | "name_soap" | "aviz_rnpm";
q?: string;
```

Adauga in WHERE-ul intern (dupa filtrele existente):

```ts
if (opts.jobKind) {
  where.push("j.kind = ?");
  params.push(opts.jobKind);
}
if (opts.q) {
  where.push(`(
    rnpm_norm(json_extract(j.target_json, '$.numar_dosar')) LIKE ? ESCAPE '\\'
    OR rnpm_norm(json_extract(j.target_json, '$.name_normalized')) LIKE ? ESCAPE '\\'
  )`);
  const escaped = stripDiacritics(opts.q).toLowerCase().replace(/[\\%_]/g, "\\$&");
  const like = `%${escaped}%`;
  params.push(like, like);
}
```

**Atentie**: `WHERE` actual filtreaza pe `a.*` (alerte). Daca filtrezi pe `j.*` cu `LEFT JOIN`, alertele orphan (job sters) sunt **excluse** — comportament corect dar de mentionat in comentariu.

`COUNT(*)` actual ruleaza din `monitoring_alerts a` fara JOIN. Cand `jobKind` sau `q` sunt prezente, schimba COUNT-ul sa includa LEFT JOIN si filtrele noi (altfel `total` va fi gresit). Patternul:

```ts
const needsJoin = opts.jobKind !== undefined || opts.q !== undefined;
const joinSql = needsJoin
  ? "LEFT JOIN monitoring_jobs j ON j.id = a.job_id AND j.owner_id = a.owner_id"
  : "";
const total = (
  db
    .prepare(`SELECT COUNT(*) AS n FROM monitoring_alerts a ${joinSql} ${whereSql}`)
    .get(...params) as { n: number }
).n;
```

Importa `stripDiacritics` din `../util/textNormalize.ts` daca nu e deja in fisier.

**[backend/src/routes/alerts.ts](backend/src/routes/alerts.ts)** — propaga `jobKind` + `q` din query la `listAlerts`.

**[frontend/src/lib/alertsApi.ts](frontend/src/lib/alertsApi.ts)** — adauga `jobKind?` + `q?` in `alertsApi.list({...})` params si propaga in URLSearchParams (la fel ca pentru `kind`/`severity`/`onlyUnread`).

### Frontend

**[frontend/src/pages/Alerts.tsx](frontend/src/pages/Alerts.tsx)** — adauga state nou:

```ts
const [jobKind, setJobKind] = useState<"all" | "dosar_soap" | "name_soap">("all");
const [searchInput, setSearchInput] = useState("");
const [debouncedQuery, setDebouncedQuery] = useState("");

// Debounce 300ms (acelasi pattern din Monitorizare.tsx).
useEffect(() => {
  const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 300);
  return () => clearTimeout(t);
}, [searchInput]);

// Reset page la schimbare jobKind sau q (alaturi de cele existente).
useEffect(() => {
  setPage(0);
}, [jobKind, debouncedQuery]);
```

Adauga in `load()`:

```ts
jobKind: jobKind === "all" ? undefined : jobKind,
q: debouncedQuery || undefined,
```

Si in dependency arrays.

**Layout UI** — adauga deasupra Card-ului existent de filtre (sau la inceputul lui), cu pattern-ul exact din `Monitorizare.tsx:367-414`:

```tsx
<div className="mb-3 flex flex-wrap items-center gap-2">
  <div
    role="tablist"
    aria-label="Filtreaza alertele dupa tipul jobului"
    className="inline-flex rounded-md border border-input bg-background p-0.5"
  >
    {(["all", "dosar_soap", "name_soap"] as const).map((k) => {
      const label = k === "all" ? "Toate" : k === "dosar_soap" ? "Dosare" : "Nume";
      const active = jobKind === k;
      return (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => setJobKind(k)}
          className={cn(
            "rounded px-3 py-1 text-xs font-medium transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {label}
        </button>
      );
    })}
  </div>
  <div className="relative min-w-[260px] flex-1 max-w-md">
    <Input
      type="text"
      value={searchInput}
      onChange={(e) => setSearchInput(e.target.value)}
      placeholder="Cauta dupa nume sau numar dosar..."
      className="pr-8"
      aria-label="Cautare in alerte"
    />
    {searchInput && (
      <button
        type="button"
        onClick={() => setSearchInput("")}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Sterge cautarea"
        title="Sterge cautarea"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
</div>
```

Importa `Input` si `X` (lucide-react) si `cn` din `@/lib/utils` daca nu sunt deja. **Pastreaza filtrele existente neschimbate** — tab-bar + search se aseaza deasupra, restul (kind select / severity / checkboxes / from-to) ramane sub.

Empty state: cand jobKind/q produc lista goala dar exista alerte total, afiseaza "Niciun rezultat pentru filtrele aplicate. Reseteaza filtrele." cu link care reseteaza `jobKind="all"` + `searchInput=""`.

### Tests

Backend — `backend/src/routes/alerts.test.ts`:
- `?jobKind=dosar_soap` filtreaza doar alertele provenite din job-uri `dosar_soap`.
- `?q=1234` matcheaza diacritic-insensitive `numar_dosar`.
- `?q=stefan` (fara diacritice) matcheaza job cu `name_normalized="STEFAN POPESCU"` si invers (`?q=Ștefan` matcheaza `STEFAN`).
- `?q=%` nu degenereaza in match-all (escape verificat).
- `?q=...&jobKind=name_soap` AND-ed corect.
- `total` din response = count-ul real cand `jobKind` / `q` sunt aplicate.
- Reuseaza pattern din `backend/src/routes/monitoring.test.ts` (interface partajata `QListResponse`, `expect(r.status).toBe(200)`).

Frontend — `frontend/src/pages/Alerts.test.tsx` (daca exista; daca nu, smoke-test prin TypeScript ca componenta compileaza).

### Acceptance criteria

- [ ] Tab-bar + search input apar deasupra filtrelor existente pe pagina Alerte.
- [ ] Filtrele vechi (kind event, severity, only-unread, include-dismissed, from-to) functioneaza identic.
- [ ] `jobKind=dosar_soap` ascunde alertele provenite din `name_soap` (verificat manual + test).
- [ ] Cautare cu/fara diacritice intoarce aceleasi rezultate.
- [ ] Wildcard `%` literal NU matcheaza tot.
- [ ] Backend tests >= 698 + 5 noi (4 q-tests + 1 jobKind-test) → `>= 703 teste`.
- [ ] Type-check backend + frontend curat.
- [ ] Documentatia: bump versiune in [CLAUDE.md](CLAUDE.md), [CHANGELOG.md](CHANGELOG.md), [frontend/src/data/changelog-entries.tsx](frontend/src/data/changelog-entries.tsx) + [package.json](package.json) (toate workspace-urile au acelasi numar).

---

## Workflow recomandat

1. **Citeste [CLAUDE.md](CLAUDE.md)** sectiunea "Versiune Curenta" + "Comenzi" inainte de orice cod.
2. **Inainte de teste:** `npm rebuild better-sqlite3` (Node ABI). **Dupa teste:** `npm run rebuild:electron` (Electron ABI).
3. **Comanda de teste:** `npm test --workspace=backend` (vitest run, NOT watch).
4. **Type-check:** `npx tsc --noEmit -p backend/tsconfig.json` + `cd frontend && npx tsc --noEmit`.
5. **Lint:** `npx biome check`.
6. **Build prod inainte de smoke desktop:** `npm run build` (esbuild backend → CJS, Vite frontend → dist-frontend). Electron-ul foloseste `dist-backend/index.cjs`, NU `src/`.
7. **Bump versiune:** modificari NUMAI in 1 PR (nu mix). Verifica cu `Grep "vX.Y.Z-old"` ca toate referintele s-au actualizat (CLAUDE.md, CHANGELOG.md, README.md, package.json-urile, changelog-entries.tsx).
8. **Commit message:** `feat: vX.Y.Z - <one-line>` (vezi `git log` pentru style).
