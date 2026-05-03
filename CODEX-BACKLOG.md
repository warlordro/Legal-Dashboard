# Codex Backlog — Legal Dashboard

> Generat: 2026-05-03 (post v2.10.4)
> Repo: `Legal Dashboard` (Electron + Hono + better-sqlite3)
> Limba codului: romana fara diacritice. Limba comentariilor: ro/en mixt acceptabil.
> Inainte de orice task: citeste [CLAUDE.md](CLAUDE.md) pentru convențiile proiectului.

Acest document descrie 3 task-uri de implementat, fiecare independent. Pot fi executate in orice ordine, dar **Task B** e quick-win (string changes), **Task C** e moderat (backend + frontend additiv), **Task A** are cea mai mare suprafata (mutare invariant in schema + UI editor).

---

## Task A — Editare job monitorizare existent

### Context

In flow-ul actual, dupa ce un job de monitorizare e creat (manual, bulk, sau retroactiv din `Cautare Dosare`), singurul mod de a-i schimba scope-ul institutiilor pentru `name_soap` e `delete + recreate`. Notes-urile si `cadence_sec` sunt deja editabile prin `PATCH /api/v1/monitoring/jobs/:id` dar nu au surface UI.

User-ul vrea sa rafineze monitoring-ul:
1. Adauga sau modifica notitele.
2. Restrange / largeste scope-ul pe `institutie` (doar `name_soap`).

`dosar_soap` NU permite edit pe `numar_dosar` (e identity); singurele editabile raman `cadence_sec` + `notes`.

### Invariantul de spart

[backend/src/schemas/monitoring.ts:128-130](backend/src/schemas/monitoring.ts#L128) zice astazi:

```ts
// PATCH only allows safe field changes — kind/target are immutable so the
// target_hash UNIQUE constraint can't be bypassed by mutating the target of
// an existing job (would orphan snapshots/alerts otherwise).
```

Invariantul e prea conservator: snapshot-urile/alertele sunt atasate prin `job_id`, NU prin `target_hash` — deci NU se orfaneaza la schimbarea targetului. Singurul risc real e:

1. **Coliziune `(owner_id, target_hash, kind)` UNIQUE** — alt job al aceluiasi owner are deja noul target_hash.
2. **Diff intermitent** la prima rulare dupa edit — `case_removed` / `case_added` in masa cand scope-ul `institutie` se schimba (comportament corect, dar trebuie comunicat in UI).

### Backend — schema

**[backend/src/schemas/monitoring.ts](backend/src/schemas/monitoring.ts)** — extinde `JobUpdateBodySchema`:

```ts
// Permite si schimbarea scope-ului institutie DOAR pentru name_soap.
// kind ramane immutable (schimbarea kind-ului ar invalida runner-ul care
// ruleaza dupa el). dosar_soap.numar_dosar e identity-ul jobului — NU se
// modifica. aviz_rnpm e placeholder, nu primeste edit deocamdata.
export const JobUpdateBodySchema = z
  .object({
    cadence_sec: z.number().int().min(600).max(86400).optional(),
    active: z.boolean().optional(),
    paused_until: z.iso.datetime().nullable().optional(),
    alert_config: AlertConfigSchema.partial().optional(),
    notes: z.string().max(2000).nullable().optional(),
    // NEW: doar name_soap; valida ca array de stringuri non-vide. Lista
    // goala = "fara restrictie" (toate instantele).
    target: z
      .object({
        institutie: z.array(z.string().trim().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Cel putin un camp trebuie modificat",
  });
```

Sterge / rescrie comentariul de la linia 128-130 ca sa reflecte noua decizie.

### Backend — repository

**[backend/src/db/monitoringJobsRepository.ts](backend/src/db/monitoringJobsRepository.ts)** — extinde `updateJob` (linia ~240):

1. Daca `patch.target?.institutie` e prezent:
   - Citeste rândul existent. Daca `kind !== "name_soap"` → arunca eroare `cannot_edit_target_on_non_name_soap` (HTTP 422 in route).
   - Construieste noul `target_json`: `{ name_normalized: <existent>, institutie: patch.target.institutie }` (drop `institutie` daca e `[]` ca sa pastram forma "fara restrictie").
   - Recomputa `target_hash` cu `canonicalSha256` (vezi linia 73 pentru pattern).
   - Verifica coliziune: `SELECT id FROM monitoring_jobs WHERE owner_id=? AND target_hash=? AND kind=? AND id<>?` → daca exista, arunca `target_collision` (HTTP 409 in route).
   - Aplica UPDATE cu noul `target_json` + `target_hash` in **aceeasi tranzactie** ca restul patch-ului.
2. Audit log: actiunea ramane `monitoring.job.updated`, dar adauga in payload campul `changed_target: true` cand institutie s-a schimbat.

### Backend — route

**[backend/src/routes/monitoring.ts](backend/src/routes/monitoring.ts)** — la PATCH-ul existent (linia ~272):

- Mapeaza `cannot_edit_target_on_non_name_soap` → 422 cu `{ error: { code: "invalid_target_edit" } }`.
- Mapeaza `target_collision` → 409 cu `{ error: { code: "target_collision", message: "Alt job monitorizeaza deja acest target." } }`.
- Restul (200 + audit) ramane neschimbat.

### Frontend — UI editor

**[frontend/src/pages/Monitorizare.tsx](frontend/src/pages/Monitorizare.tsx)** — adauga buton "Editare" (icon `Pencil` din lucide-react) in coloana actiuni a fiecarui rand, langa butoanele existente (Pauza/Activare/Sterge).

Componenta noua: `frontend/src/components/monitoring/MonitoringEditDialog.tsx`:
- Props: `{ job: MonitoringJob; onClose(): void; onSaved(): void }`.
- Continut:
  - Camp readonly: tinta (`numar_dosar` sau `name_normalized` din `formatMonitoringTarget`).
  - Textarea `notes` (max 2000 char, counter live).
  - Slider/select `cadence_sec` cu optiuni preset `1h / 4h / 8h / 24h` (paritate cu MonitoringAddForm).
  - **DOAR pentru `name_soap`**: `InstitutieSelect` (multi, pre-completat din `getNameSoapInstitutie(job)`).
- Footer: Salveaza (cu loading state) + Anuleaza.
- La salvare: PATCH cu doar campurile schimbate; `onSaved()` reapeleaza `monitoring.list()`.
- Eroare 409 (target_collision) → afiseaza in dialog, nu inchide.
- La largirea / restrangerea scope-ului → afiseaza un **toast de avertizare** dupa salvare: *"Schimbarea scope-ului poate genera alerte de tipul Dosar nou / Dosar disparut la urmatoarea rulare. Comportament normal — dosarele iesite din scope sunt raportate ca disparute."*

### Tests

Backend (`backend/src/db/monitoringJobsRepository.test.ts` + `backend/src/routes/monitoring.test.ts`):
- `updateJob` cu `target.institutie` pe `name_soap` → recomputeaza `target_hash`, success.
- `updateJob` cu `target` pe `dosar_soap` → 422 cu `invalid_target_edit`.
- `updateJob` cu `target.institutie = []` → seteaza scope la "all", target_hash recomputeaza fara `institutie` field.
- `updateJob` care creaza coliziune cu alt job al aceluiasi owner → 409 cu `target_collision`.
- `updateJob` cu doar `notes` (path-ul existent) → ramane backward-compatible, nu touch target_hash.
- Audit row primeste `changed_target: true` cand institutie s-a schimbat.

Frontend (`frontend/src/components/monitoring/MonitoringEditDialog.test.tsx`):
- Render pe `name_soap` → `InstitutieSelect` vizibil; pe `dosar_soap` → ascuns.
- Submit cu campuri schimbate → apel PATCH cu doar diff-ul.
- 409 → mesaj inline, dialog ramane deschis.

### Acceptance criteria

- [ ] PATCH `name_soap` cu institutie schimbata returneaza 200 si `target_hash` din response e recalculat.
- [ ] PATCH `dosar_soap` cu `target` in body returneaza 422.
- [ ] Coliziunea de target_hash returneaza 409, nu 500, si nu modifica DB-ul.
- [ ] Snapshot-urile + alertele vechi raman atasate la `job_id` (verificat prin SELECT in test).
- [ ] In UI, butonul "Editare" deschide modal-ul; salvarea actualizeaza randul fara reload de pagina.
- [ ] Type-check backend + frontend curat. Toate testele backend (>= 698) verzi.
- [ ] Documentatia: actualizat [CLAUDE.md](CLAUDE.md) sectiunea "Versiune Curenta" + [CHANGELOG.md](CHANGELOG.md) + [frontend/src/data/changelog-entries.tsx](frontend/src/data/changelog-entries.tsx).

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
