# Notite editabile per job + propagare in alerte — Plan de executie (revizuit)

> **Pentru Codex:** Acest plan se executa task-cu-task. Fiecare task: scrie testul rosu intai, fa-l verde cu cod minim, ruleaza biome + tsc + vitest, commit. NU sari peste teste. NU combina mai multe task-uri intr-un singur commit. Toate textele in romana **fara diacritice**.
>
> **Revizia aceasta** (2026-05-14) absoarbe fixurile cerute de review-ul multi-agent: test-architect, api-contract-reviewer, deep-code-reviewer, release-readiness-reviewer. Fata de versiunea initiala: Task 3 eliminat (helper-ul `monitoring.patch` exista deja); Task 1 NU mai modifica testele 413 body-limit; Task 2 foloseste seedJob raw SQL ca in repo; Task 4 mock-uieste `@/lib/monitoringApi`; Task 5 modifica `MonitoringAlert` din `alertsApi.ts` si Alerts.tsx inline (NU exista `AlertCard.tsx`); adaugat tighten pe `MonitoringAddForm.tsx:224` si warning pe legacy >200 chars.

**Goal:** Permite editarea notei per job de monitorizare (max 200 chars) si afiseaza nota in cardul de alerta cand provine din acel job.

**Architecture:** Refoloseste `monitoring_jobs.notes` deja existenta. Nu adauga migration. Tighten zod max la 200. Extinde SELECT in `listAlerts` cu `j.notes`. UI editor inline pe randul Monitorizare via `monitoring.patch(...)` existent. Display bloc discret in Alerts.tsx.

**Tech Stack:** Hono + zod + vitest backend; React + Vite + tailwind frontend; better-sqlite3.

**Branch:** `feat/monitoring-notes-edit`.
- Pleaca din `main` DUPA ce PR-6 (v2.26.0 — `feat/pr6-envelope-migration` commit f3c2844) e merged in main de user.
- Daca PR-6 inca nu e merged in main local cand incepi, pleaca din `feat/pr6-envelope-migration` HEAD si rebase pe main ulterior. NU pleca din alt branch.

**Spec aferent:** `docs/superpowers/specs/2026-05-14-monitoring-notes-edit-and-alerts-design.md`

**Convenții fixe (re-citeste daca te grabesti):**
- Repository-only DB access: SQL raw numai in `backend/src/db/**`.
- `owner_id` scoping pe orice query nou.
- Mesaje romanesti fara diacritice in zod, UI, commit messages.
- Biome + tsc + vitest verde inainte de fiecare commit. Nu trece la urmatorul task daca cel curent are erori.
- Envelope errors din PR-6: `{ data: null, error: { code, message }, requestId }`.
- NU `git push --force`. NU `--no-verify`. NU merge in main fara aprobare user.

---

## Task 1 — Tighten zod max 2000 → 200 (backend + form UI)

**Files:**
- Modifica: `backend/src/schemas/monitoring.ts` (linii ~93 + ~134 — schema `JobCreateBody` si `JobUpdateBody`)
- Modifica: `frontend/src/components/monitoring/MonitoringAddForm.tsx:224` (`maxLength={2000}` → `maxLength={200}`)
- Modifica: `frontend/src/components/monitoring/MonitoringBulkImportCard.tsx` — adauga avertisment vizual pentru randuri cu `notes` > 200 chars (DO NOT modifica logica de upload — doar previewul)
- Test nou: `backend/src/schemas/monitoring.notes-limit.test.ts`
- **NU** modifica `backend/src/routes/monitoring.test.ts:290` si `:483` — acelea sunt teste 413 pe payload size (20KB), NU pe zod. Raman intacte.

### Step 1 — Scrie testul rosu pentru schema

Creeaza `backend/src/schemas/monitoring.notes-limit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { JobCreateBodySchema, JobUpdateBodySchema } from "./monitoring";

describe("notes — limita 200 chars", () => {
  it("Create: 200 chars trece", () => {
    const result = JobCreateBodySchema.safeParse({
      kind: "dosar_soap",
      target: { numar_dosar: "1234/180/2024" },
      cadence_sec: 14400,
      alert_config: {},
      notes: "x".repeat(200),
    });
    expect(result.success).toBe(true);
  });

  it("Create: 201 chars esueaza cu mesaj romanesc clar", () => {
    const result = JobCreateBodySchema.safeParse({
      kind: "dosar_soap",
      target: { numar_dosar: "1234/180/2024" },
      cadence_sec: 14400,
      alert_config: {},
      notes: "x".repeat(201),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("notes"));
      expect(issue?.message).toMatch(/200/);
    }
  });

  it("Update: 200 chars trece", () => {
    expect(JobUpdateBodySchema.safeParse({ notes: "x".repeat(200) }).success).toBe(true);
  });

  it("Update: 201 chars esueaza", () => {
    expect(JobUpdateBodySchema.safeParse({ notes: "x".repeat(201) }).success).toBe(false);
  });

  it("Update: notes=null trece (stergere explicita)", () => {
    expect(JobUpdateBodySchema.safeParse({ notes: null }).success).toBe(true);
  });
});
```

**Nota:** confirma nume-le exporturilor (`JobCreateBodySchema` vs `MonitoringJobCreateBody` etc.) cu `grep -n "export const.*Body\|export const.*Schema" backend/src/schemas/monitoring.ts`. Foloseste numele real.

### Step 2 — Ruleaza si confirma FAIL

```bash
npx vitest run backend/src/schemas/monitoring.notes-limit.test.ts
```
Asteptat: testele care cer 201 chars sa esueze trec ca PASS gresit (limita curenta e 2000), deci testul efectiv "201 esueaza" iese FAIL. Mesajul de eroare nu va contine "200". Asta e starea de rosu corecta.

### Step 3 — Aplica fix-ul in schema

In `backend/src/schemas/monitoring.ts`, gaseste cele doua aparitii ale `notes: z.string().max(2000)`:

```ts
// Create (linie ~93)
notes: z.string().max(200, "Notita maxim 200 caractere").optional(),

// Update (linie ~134)
notes: z.string().max(200, "Notita maxim 200 caractere").nullable().optional(),
```

### Step 4 — Aliniaza UI-ul de creation

`frontend/src/components/monitoring/MonitoringAddForm.tsx:224`:

```tsx
// inainte
maxLength={2000}
// dupa
maxLength={200}
```

### Step 5 — Avertisment pentru bulk import (truncated rows)

In `frontend/src/components/monitoring/MonitoringBulkImportCard.tsx`, cauta randurile de preview unde se afiseaza `notes` din randul importat. Adauga un mic flag vizual sau text:

- Daca un rand are `notes.length > 200`: marcheaza randul cu un mesaj inline rosu sau warning: `"Notita > 200 chars — va fi respinsa la salvare"`.
- NU trunchia automat — userul trebuie sa scurteze sau sa stearga manual. Fail-fast.

Daca structura componentei face costisitor un warning per-row, e acceptabil un sumar global la cap: `"{n} randuri au notite mai lungi de 200 caractere si vor fi respinse — verifica coloana Note."`.

### Step 6 — Ruleaza testele

```bash
npx vitest run backend/src/schemas/monitoring.notes-limit.test.ts backend/src/routes/monitoring.test.ts
cd frontend && npx vitest run src/components/monitoring && cd ..
```
Asteptat: PASS pe schema + body-limit test (cele 20KB raman intacte si verzi).

### Step 7 — Biome + tsc + commit

```bash
npx biome check --write backend/src/schemas/monitoring.ts backend/src/schemas/monitoring.notes-limit.test.ts frontend/src/components/monitoring/MonitoringAddForm.tsx frontend/src/components/monitoring/MonitoringBulkImportCard.tsx
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
git add backend/src/schemas/monitoring.ts backend/src/schemas/monitoring.notes-limit.test.ts frontend/src/components/monitoring/MonitoringAddForm.tsx frontend/src/components/monitoring/MonitoringBulkImportCard.tsx
git commit -m "feat(monitoring): notes limit 2000 -> 200 chars (zod + UI + bulk warn)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2 — Expune `job_notes` in listAlerts (backend)

**Files:**
- Modifica: `backend/src/db/monitoringAlertsRepository.ts` — SELECT-ul din `listAlerts` (~liniile 355-367) + tipul `MonitoringAlertRow` (~liniile 42-65)
- Verifica: `backend/src/routes/alerts.ts` — daca face pick selectiv sau pass-through (nu face pick acum, dar verifica)
- Test nou: `backend/src/db/monitoringAlertsRepository.notes-join.test.ts`

### Step 1 — Scrie testul rosu

Creeaza `backend/src/db/monitoringAlertsRepository.notes-join.test.ts`. Foloseste **acelasi pattern** ca `monitoringAlertsRepository.test.ts:42-63` (seedJob + seedRun via raw SQL pe `getDb()`):

```ts
import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { insertAlert, listAlerts } from "./monitoringAlertsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

let tmpRoot: string;
const OWNER = "tenant-notes";

function seedJob(notes: string | null): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at, notes)
       VALUES (?, 'dosar_soap', '{}', ?, 14400, '{}', '2026-05-14T12:00:00.000Z', ?)`
    )
    .run(OWNER, `hash-${Math.random()}`, notes);
  return info.lastInsertRowid as number;
}

function seedRun(jobId: number): number {
  const info = getDb()
    .prepare(
      `INSERT INTO monitoring_runs (owner_id, job_id, started_at, status)
       VALUES (?, ?, ?, 'running')`
    )
    .run(OWNER, jobId, "2026-05-14T10:00:00.000Z");
  return info.lastInsertRowid as number;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-notes-join-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("listAlerts — job_notes propagare", () => {
  it("returneaza job.notes pentru alerta atasata jobului cu notita", () => {
    const jobId = seedJob("Client VIP — anunta inainte de termen");
    const runId = seedRun(jobId);
    insertAlert({
      ownerId: OWNER,
      jobId,
      runId,
      kind: "termen_new",
      severity: "info",
      title: "Termen nou",
      dedupKey: "k1",
    });
    const result = listAlerts({ ownerId: OWNER, page: 1, pageSize: 10 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].job_notes).toBe("Client VIP — anunta inainte de termen");
  });

  it("returneaza null cand jobul nu are notita", () => {
    const jobId = seedJob(null);
    const runId = seedRun(jobId);
    insertAlert({
      ownerId: OWNER,
      jobId,
      runId,
      kind: "termen_new",
      severity: "info",
      title: "T",
      dedupKey: "k2",
    });
    const result = listAlerts({ ownerId: OWNER, page: 1, pageSize: 10 });
    expect(result.rows[0].job_notes).toBeNull();
  });
});
```

### Step 2 — Ruleaza si confirma FAIL

```bash
npx vitest run backend/src/db/monitoringAlertsRepository.notes-join.test.ts
```
Asteptat: FAIL — `job_notes` nu exista pe `MonitoringAlertRow` (TS error la linia `result.rows[0].job_notes`) sau e `undefined` la runtime.

### Step 3 — Adauga `notes` la SELECT si la tipul `MonitoringAlertRow`

In `backend/src/db/monitoringAlertsRepository.ts`:

**SELECT** (~liniile 355-367):
```sql
SELECT a.*,
       j.target_json AS job_target_json,
       j.kind AS job_kind,
       j.notes AS job_notes
FROM monitoring_alerts a
LEFT JOIN monitoring_jobs j
  ON j.id = a.job_id AND j.owner_id = a.owner_id
${whereSql}
ORDER BY a.created_at DESC, a.id DESC
LIMIT ? OFFSET ?
```

**Tipul `MonitoringAlertRow`** (~linia 63):
```ts
// Adauga dupa job_kind:
job_notes?: string | null;
```

Comentariu deasupra (consistent cu cele existente):
```ts
// v2.27.0 — propagata din monitoring_jobs.notes in listAlerts pentru
// afisare in /alerte. Optional: insertAlert / getAlertById nu o populeaza.
```

### Step 4 — Verifica routes/alerts.ts

```bash
grep -n "job_target_json\|job_kind\|MonitoringAlertRow" backend/src/routes/alerts.ts
```
Daca route-ul face pass-through (`return c.json(...)` direct pe rows), `job_notes` e deja expus prin spread `a.*` + LEFT JOIN. Daca face pick selectiv, adauga `job_notes`. Asteptat: pass-through, fara modificari.

### Step 5 — Ruleaza testele

```bash
npx vitest run backend/src/db/monitoringAlertsRepository.notes-join.test.ts backend/src/db/monitoringAlertsRepository.test.ts backend/src/routes/alerts.test.ts
```
Asteptat: PASS pe toate.

### Step 6 — Biome + tsc + commit

```bash
npx biome check --write backend/src/db/monitoringAlertsRepository.ts backend/src/db/monitoringAlertsRepository.notes-join.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/db/monitoringAlertsRepository.ts backend/src/db/monitoringAlertsRepository.notes-join.test.ts
git commit -m "feat(alerts): expune job.notes via LEFT JOIN in listAlerts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3 — (ELIMINAT) — `monitoring.patch` deja exista

`frontend/src/lib/monitoringApi.ts:144-154` are deja:
```ts
patch: async (id, patch: { active?, cadence_sec?, notes?: string | null }) => MonitoringJob
```

UI-ul va folosi direct `monitoring.patch(jobId, { notes })`. **Nu** crea un helper nou (`monitoring.updateNote`) in `lib/api.ts` — duplicare inutila, contrazice arhitectura existenta.

Tranziteaza direct la Task 4.

---

## Task 4 — UI editor inline pe randul Monitorizare

**Files:**
- Modifica: `frontend/src/pages/Monitorizare.tsx` (zona display-ului curent al `job.notes`, ~liniile 587-594)
- Test nou: `frontend/src/pages/Monitorizare.notes-editor.test.tsx`

### Step 1 — Identifica zona si confirma exporturile

```bash
grep -n "job\.notes\|notes" frontend/src/pages/Monitorizare.tsx | head -20
```
Confirma componenta de pagina e default export sau named export `Monitorizare`. Foloseste forma reala in test.

### Step 2 — Scrie testul rosu

Creeaza `frontend/src/pages/Monitorizare.notes-editor.test.tsx`.

**Mock corect:** `@/lib/monitoringApi` (NU `@/lib/api`):

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/monitoringApi", async (orig) => {
  const actual = await orig<typeof import("@/lib/monitoringApi")>();
  return {
    ...actual,
    monitoring: {
      ...actual.monitoring,
      patch: vi.fn(),
    },
  };
});

import { monitoring } from "@/lib/monitoringApi";

// helper renderJob: muta-l intr-un fisier de test-utils daca exista deja unul
// pentru Monitorizare. Daca nu, scrie-l inline. Trebuie sa monteze pagina cu
// un singur job in lista — fie injectand via fetch mock, fie extragand
// NoteEditor intr-un component separat pe care-l testezi direct (PREFERAT —
// mai stabil si mai izolat).

describe("NoteEditor — inline editor pentru notita per job", () => {
  beforeEach(() => {
    (monitoring.patch as ReturnType<typeof vi.fn>).mockReset();
  });

  // Daca NoteEditor e extras intr-un fisier separat
  // (frontend/src/components/monitoring/NoteEditor.tsx — RECOMANDAT), import direct:
  // import { NoteEditor } from "@/components/monitoring/NoteEditor";

  it("click pe notita existenta deschide textarea preincarcata", async () => {
    render(<NoteEditor jobId={1} initialNote="vechi" onSaved={() => {}} />);
    fireEvent.click(screen.getByText("vechi"));
    const textarea = await screen.findByRole("textbox", { name: /notita/i });
    expect(textarea).toHaveValue("vechi");
  });

  it("buton + Adauga notita apare cand notes e null", () => {
    render(<NoteEditor jobId={1} initialNote={null} onSaved={() => {}} />);
    expect(screen.getByRole("button", { name: /adauga notita/i })).toBeInTheDocument();
  });

  it("counter X/200 reflecta lungimea curenta", async () => {
    render(<NoteEditor jobId={1} initialNote={null} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /adauga notita/i }));
    const textarea = await screen.findByRole("textbox", { name: /notita/i });
    fireEvent.change(textarea, { target: { value: "x".repeat(150) } });
    expect(screen.getByText("150/200")).toBeInTheDocument();
  });

  it("textarea are maxLength=200", async () => {
    render(<NoteEditor jobId={1} initialNote={null} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /adauga notita/i }));
    const textarea = await screen.findByRole("textbox", { name: /notita/i });
    expect(textarea).toHaveAttribute("maxLength", "200");
  });

  it("Salveaza apeleaza monitoring.patch cu { notes } si inchide editorul", async () => {
    (monitoring.patch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, notes: "actualizat" });
    const onSaved = vi.fn();
    render(<NoteEditor jobId={1} initialNote="vechi" onSaved={onSaved} />);
    fireEvent.click(screen.getByText("vechi"));
    const textarea = await screen.findByRole("textbox", { name: /notita/i });
    fireEvent.change(textarea, { target: { value: "actualizat" } });
    fireEvent.click(screen.getByRole("button", { name: /salveaza/i }));
    await waitFor(() => expect(monitoring.patch).toHaveBeenCalledWith(1, { notes: "actualizat" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("actualizat"));
  });

  it("textarea gol => Salveaza trimite { notes: null } (stergere)", async () => {
    (monitoring.patch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, notes: null });
    render(<NoteEditor jobId={1} initialNote="vechi" onSaved={() => {}} />);
    fireEvent.click(screen.getByText("vechi"));
    fireEvent.change(await screen.findByRole("textbox", { name: /notita/i }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /salveaza/i }));
    await waitFor(() => expect(monitoring.patch).toHaveBeenCalledWith(1, { notes: null }));
  });

  it("Anuleaza inchide editorul fara API call", async () => {
    render(<NoteEditor jobId={1} initialNote="vechi" onSaved={() => {}} />);
    fireEvent.click(screen.getByText("vechi"));
    fireEvent.change(await screen.findByRole("textbox", { name: /notita/i }), {
      target: { value: "schimbat" },
    });
    fireEvent.click(screen.getByRole("button", { name: /anuleaza/i }));
    expect(monitoring.patch).not.toHaveBeenCalled();
  });

  it("legacy >200: textarea afiseaza warning vizibil", async () => {
    const long = "x".repeat(250); // import vechi
    render(<NoteEditor jobId={1} initialNote={long} onSaved={() => {}} />);
    fireEvent.click(screen.getByText(long.slice(0, 30), { exact: false }));
    expect(await screen.findByText(/depaseste 200/i)).toBeInTheDocument();
  });

  it("eroare backend (envelope) afiseaza mesajul", async () => {
    (monitoring.patch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Notita maxim 200 caractere")
    );
    render(<NoteEditor jobId={1} initialNote="vechi" onSaved={() => {}} />);
    fireEvent.click(screen.getByText("vechi"));
    fireEvent.click(screen.getByRole("button", { name: /salveaza/i }));
    expect(await screen.findByText(/notita maxim 200/i)).toBeInTheDocument();
  });
});
```

### Step 3 — Run FAIL

```bash
cd frontend && npx vitest run src/pages/Monitorizare.notes-editor.test.tsx
```

### Step 4 — Implementeaza `NoteEditor`

**Recomandat:** extrage intr-un fisier separat `frontend/src/components/monitoring/NoteEditor.tsx`. Asta tine `Monitorizare.tsx` curat (deja e mare) si face testul stabil — direct unit-test pe componenta, fara sa monteze pagina intreaga.

```tsx
// frontend/src/components/monitoring/NoteEditor.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { monitoring } from "@/lib/monitoringApi";

export interface NoteEditorProps {
  jobId: number;
  initialNote: string | null;
  onSaved: (next: string | null) => void;
}

export function NoteEditor({ jobId, initialNote, onSaved }: NoteEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return initialNote ? (
      <button
        type="button"
        onClick={() => {
          setValue(initialNote);
          setEditing(true);
        }}
        className="mt-1 block max-w-[420px] truncate text-left text-xs italic text-muted-foreground hover:text-foreground cursor-pointer"
        title={initialNote}
      >
        {initialNote}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1 text-xs italic text-muted-foreground hover:text-foreground"
      >
        + Adauga notita
      </button>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = value.trim() === "" ? null : value;
      await monitoring.patch(jobId, { notes: next });
      onSaved(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare salvare");
    } finally {
      setSaving(false);
    }
  };

  const isLegacyOverflow = (initialNote?.length ?? 0) > 200;

  return (
    <div className="mt-1 space-y-1">
      <textarea
        aria-label="Notita"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={200}
        rows={2}
        className="w-full max-w-[420px] rounded border border-border bg-background px-2 py-1 text-xs"
        disabled={saving}
      />
      {isLegacyOverflow && (
        <div className="text-[11px] text-amber-700 dark:text-amber-400">
          Notita veche depaseste 200 caractere — scurteaza inainte de Salveaza.
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-muted-foreground">{value.length}/200</span>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          Salveaza
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
          Anuleaza
        </Button>
        {error && <span className="text-red-500">{error}</span>}
      </div>
    </div>
  );
}
```

In `frontend/src/pages/Monitorizare.tsx` (~zona linia 587-594), inlocuieste blocul curent (read-only `{job.notes && ...}`) cu:

```tsx
import { NoteEditor } from "@/components/monitoring/NoteEditor";

// in JSX, in randul jobului, sub target:
<NoteEditor
  jobId={job.id}
  initialNote={job.notes}
  onSaved={(next) => {
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, notes: next } : j)));
  }}
/>
```

Confirma cu Read inainte de Edit — codul existent poate sa difere subtil (e.g. `jobs` vs `data.rows`). Foloseste setter-ul real al listei.

### Step 5 — Run PASS

```bash
cd frontend && npx vitest run src/pages/Monitorizare.notes-editor.test.tsx
```

### Step 6 — Biome + tsc + commit

```bash
npx biome check --write frontend/src/components/monitoring/NoteEditor.tsx frontend/src/pages/Monitorizare.tsx frontend/src/pages/Monitorizare.notes-editor.test.tsx
cd frontend && npx tsc --noEmit && cd ..
git add frontend/src/components/monitoring/NoteEditor.tsx frontend/src/pages/Monitorizare.tsx frontend/src/pages/Monitorizare.notes-editor.test.tsx
git commit -m "feat(monitoring): editor inline NoteEditor pentru notita per job (max 200)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5 — Display `job_notes` in cardul de alerta (Alerts.tsx)

**Files:**
- Modifica: `frontend/src/lib/alertsApi.ts` — tipul `MonitoringAlert` adauga `job_notes?: string | null` (sub `job_kind`, ~linia 40)
- Modifica: `frontend/src/pages/Alerts.tsx` — adauga blocul `Notita: ...` inline in cardul de alerta (~liniile 720-790, in zona dupa `dl ctx.facts` sau dupa `ctx.fallback`)
- Test nou: `frontend/src/pages/Alerts.notes-display.test.tsx`

**Nota:** **NU exista** `AlertCard.tsx` ca fisier separat — randarea e inline in `Alerts.tsx`. NU crea componenta noua.

### Step 1 — Test rosu

Creeaza `frontend/src/pages/Alerts.notes-display.test.tsx`. Cel mai simplu test: extrage micro-componenta `<AlertNoteBlock note={...}/>` intr-un fisier nou `frontend/src/components/alerts/AlertNoteBlock.tsx` si testeaz-o izolat. Asta evita montarea Alerts.tsx + setup retrofit pentru fetch/router.

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertNoteBlock } from "@/components/alerts/AlertNoteBlock";

describe("AlertNoteBlock", () => {
  it("randeaza prefix Notita + textul cand note e setat", () => {
    render(<AlertNoteBlock note="Client VIP" />);
    expect(screen.getByText(/Notita:/)).toBeInTheDocument();
    expect(screen.getByText("Client VIP")).toBeInTheDocument();
  });

  it("nu randeaza nimic cand note e null sau gol", () => {
    const { container } = render(<AlertNoteBlock note={null} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<AlertNoteBlock note="" />);
    expect(c2.firstChild).toBeNull();
  });

  it("nu randeaza pentru whitespace pur", () => {
    const { container } = render(<AlertNoteBlock note="   " />);
    expect(container.firstChild).toBeNull();
  });
});
```

### Step 2 — Run FAIL

```bash
cd frontend && npx vitest run src/pages/Alerts.notes-display.test.tsx
```

### Step 3 — Componenta + integrare

Creeaza `frontend/src/components/alerts/AlertNoteBlock.tsx`:

```tsx
export interface AlertNoteBlockProps {
  note: string | null | undefined;
}

export function AlertNoteBlock({ note }: AlertNoteBlockProps) {
  if (!note || note.trim() === "") return null;
  return (
    <div className="mt-2 border-l-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs italic text-foreground/80">
      <span className="font-semibold not-italic mr-1">Notita:</span>
      {note}
    </div>
  );
}
```

In `frontend/src/lib/alertsApi.ts`, in interfata `MonitoringAlert` (~linia 40), dupa `job_kind`:

```ts
// v2.27.0 — propagat din monitoring_jobs.notes prin LEFT JOIN in listAlerts.
job_notes?: string | null;
```

In `frontend/src/pages/Alerts.tsx`:
- Import `AlertNoteBlock` la varful fisierului.
- In randarea cardului de alerta, dupa blocul `ctx.fallback` (sau imediat dupa `<h2>` titlu — alege un loc consistent vizual; recomand sub `ctx.fallback` ca sa fie ultimul detaliu vizibil), insereaza:

```tsx
<AlertNoteBlock note={alert.job_notes} />
```

### Step 4 — Run PASS

```bash
cd frontend && npx vitest run src/pages/Alerts.notes-display.test.tsx
```

### Step 5 — Biome + tsc + commit

```bash
npx biome check --write frontend/src/components/alerts/AlertNoteBlock.tsx frontend/src/lib/alertsApi.ts frontend/src/pages/Alerts.tsx frontend/src/pages/Alerts.notes-display.test.tsx
cd frontend && npx tsc --noEmit && cd ..
git add frontend/src/components/alerts/AlertNoteBlock.tsx frontend/src/lib/alertsApi.ts frontend/src/pages/Alerts.tsx frontend/src/pages/Alerts.notes-display.test.tsx
git commit -m "feat(alerts): afiseaza job.notes in cardul de alerta cand exista

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6 — Verificare integrata desktop (manual)

**NU commit-uiesti nimic in acest task** — doar valideaza si raporteaza statusul.

### Step 1 — Build + restart Electron

```bash
npm run build
# PowerShell: scrub ELECTRON_RUN_AS_NODE leak inainte de electron:dev
$env:ELECTRON_RUN_AS_NODE = ""
# Daca better-sqlite3 ABI mismatch (NODE_MODULE_VERSION) — preventiv:
# cd node_modules/better-sqlite3 && npx prebuild-install --runtime=electron --target=41.5.0
npm run electron:dev
```

### Step 2 — Checklist smoke (toate trebuie sa treaca)

- [ ] Pagina `/monitorizare`: pe un job FARA nota, butonul "+ Adauga notita" e vizibil. Click → textarea + counter `0/200`.
- [ ] Tastez 50 caractere → counter `50/200`. Salveaza → mesajul devine read-only italic sub target.
- [ ] Re-click pe nota → textarea preincarcata cu valoarea curenta.
- [ ] Sterg tot textul si Salveaza → revine la butonul "+ Adauga notita".
- [ ] Lipesc 250 caractere → textarea taie la 200 (maxLength); counter `200/200`.
- [ ] Pe un job cu nota legacy >200 (daca exista in DB local), warning-ul amber apare.
- [ ] Pagina `/alerte`: alertele provenite din job-uri cu nota afiseaza blocul amber "Notita: ...". Cele fara nota raman compacte.
- [ ] Edit nota din /monitorizare pe un job care are alerte deja emise → revin la /alerte → blocul reflecta valoarea noua (live read).
- [ ] **Scheduler-continuity**: noteaza `next_run_at` al unui job inainte de a-i edita nota; dupa PATCH, `next_run_at` ramane neschimbat (PATCH-ul de notes nu reseteaza scheduling-ul). Verifica via `/api/v1/monitoring/jobs?q=...` sau direct in DB.
- [ ] Bulk import: incarca un CSV cu o coloana `notes` care contine un rand >200 chars → preview-ul marcheaza randul ca warning si la commit randul respectiv e respins/skipat (NU silent-truncate).
- [ ] Owner-isolation: testul automat `monitoring.test.ts` "Owner isolation — GET/PATCH/DELETE /jobs/:id" trebuie sa fie verde dupa modificarile din Task 1. Nu test manual.

Daca toate trec → Task 7. Daca esueaza ceva → raporteaza eroarea exacta, nu trece mai departe.

---

## Task 7 — Release bump v2.26.0 → v2.27.0

**Files:**
- `package.json` (root + `backend/` + `frontend/`) + `package-lock.json`
- `frontend/src/data/changelog-entries.tsx` — entry nou v2.27.0
- `CHANGELOG.md` — sectiune noua
- `README.md` — "Versiune curenta"
- `CLAUDE.md` — "Versiune Curenta" (1-2 linii, fara paragraf detaliat)
- `STATUS.md` — "Versiune curenta reala" + "Data curenta"
- `DOCUMENTATIE.md` — "Versiune curenta"
- `SESSION-HANDOFF.md` — daca exista referinta la versiune
- `EXECUTION-ROADMAP.md` — daca livrarea bifeaza un DoD checkbox sau PR

### Step 1 — Bump versiune

Edit manual fiecare `package.json` (root, `backend/`, `frontend/`): `"version": "2.26.0"` → `"version": "2.27.0"`. Apoi:
```bash
npm install --package-lock-only
```

### Step 2 — Adauga entry in CHANGELOG.md + changelog-entries.tsx

Entry CHANGELOG.md (sus, deasupra v2.26.0):

```markdown
## v2.27.0 — 2026-05-14

### Adaugat
- **Notite editabile per job de monitorizare** (max 200 chars) — utilizatorul poate scrie un memo atasat unui job direct din pagina /monitorizare (click pe nota sau "+ Adauga notita"). Persistent, owner-scoped, salvat via `PATCH /api/v1/monitoring/jobs/:id`.
- **Notita atasata alertelor** — cardurile din /alerte afiseaza blocul "Notita: ..." cand alerta provine dintr-un job cu notita setata. Read live, fara snapshot — editarea notitei se reflecta imediat in alerte deja emise.

### Modificat
- Limita backend pentru `monitoring_jobs.notes` redusa de la 2000 la 200 caractere (zod). Existing rows >200 raman intacte la citire; doar write nou e respins. Mesaj eroare in romana.
- `MonitoringAddForm` aliniat la noua limita (maxLength=200).
- `MonitoringBulkImportCard` semnaleaza randurile cu notita >200 caractere in preview.
```

Entry oglinda in `frontend/src/data/changelog-entries.tsx` cu acelasi continut, format obisnuit din fisier (urmareste structura entry-urilor existente — `<ChangelogEntry version="2.27.0" date="2026-05-14" .../>` sau similar).

### Step 3 — Restul .md-urilor

```bash
grep -l "2\.26\.0" *.md
```
Update fiecare hit relevant (NU CHANGELOG entries vechi — alea raman istoric). Atentie:
- `CLAUDE.md` "Versiune Curenta" — doar 1 linie scurta.
- `STATUS.md` header.
- `EXECUTION-ROADMAP.md` — daca exista checkbox sau row de release ce trebuie bifat, bifeaza-l aici.

### Step 4 — Sanity verde + commit + tag

```bash
npx biome check --write .
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
npm run build
npm test --workspace=backend
cd frontend && npm test -- --run && cd ..

git add -A
git commit -m "release: v2.27.0 — notite editabile per job + propagare in alerte

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git tag v2.27.0
# NU push automat — asteapta confirmare user pentru push (regula CLAUDE.md).
```

### Step 5 — Restart Electron pentru `__APP_VERSION__`

Inchide Electron rulant, apoi:
```bash
$env:ELECTRON_RUN_AS_NODE = ""
npm run electron:dev
```
Verifica sidebar/Dashboard arata `v2.27.0`.

### Step 6 — Push (numai dupa OK user)

```bash
git push origin feat/monitoring-notes-edit
git push origin v2.27.0
```

---

## Reguli generale Codex (re-confirmare)

- **NU merge in main** pana la review explicit de user.
- **NU push --force** niciodata. Conflict la push → opreste-te si raporteaza exact eroarea.
- **NU --no-verify** la commit. Hook esueaza → fix root cause, re-stage, NEW commit.
- **NU sari peste teste**. Rosu intai, verde dupa. Daca un test e greu de scris → raporteaza, nu il scoate.
- **NU adauga features in plus** — stricta scope-ul fiecarui task. Fara icoane noi, fara refactor pe componente vecine.
- **Romana fara diacritice** in cod, comentarii, commit messages, UI text, mesaje zod.
- **Biome + tsc + vitest** trebuie sa treaca verde inainte de fiecare commit per task. Daca nu trec, opreste task-ul si raporteaza eroarea exact (cu output-ul comenzii).
- **owner_id scoping**: orice query nou trebuie sa filtreze pe owner. Repository-only DB access — SQL doar in `backend/src/db/**`.
- **Web-readiness**: zero modificari care leaga state-ul de un singleton sau de procesul main; PATCH-ul ramane stateless.
- **Envelope errors** (PR-6): 400 INVALID_PARAMS pe zod fail, 404 NOT_FOUND pe owner-mismatch (deja in vigoare).
