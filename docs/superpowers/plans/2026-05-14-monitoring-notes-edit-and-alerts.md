# Notite editabile per job + propagare in alerte — Plan de executie

> **Pentru Codex:** Acest plan se executa task-cu-task. Fiecare task: scrie testul rosu intai, fa-l verde cu cod minim, ruleaza biome + tsc + vitest, commit. NU sari peste teste. NU combina mai multe task-uri intr-un singur commit. Toate textele in romana **fara diacritice**.

**Goal:** Permite editarea notei per job de monitorizare (max 200 chars) si afiseaza nota in cardul de alerta cand provine din acel job.

**Architecture:** Refoloseste `monitoring_jobs.notes` deja existenta. Nu adauga migration. Tighten zod max la 200. Extinde SELECT in `listAlerts` cu `j.notes`. UI editor inline pe randul Monitorizare. Display bloc discret in `/alerte`.

**Tech Stack:** Hono + zod + vitest backend; React + Vite + tailwind frontend; better-sqlite3.

**Branch:** `feat/monitoring-notes-edit` derivata din `main` dupa merge-ul PR-6 (v2.26.0). NU pleca din `feat/pr6-envelope-migration` — asteapta merge in main si rebase de acolo.

**Spec aferent:** `docs/superpowers/specs/2026-05-14-monitoring-notes-edit-and-alerts-design.md`

---

## Task 1 — Tighten zod max 2000 → 200 (backend)

**Files:**
- Modifica: `backend/src/schemas/monitoring.ts` linii 93 si 134
- Modifica: `backend/src/routes/monitoring.test.ts` (testele cu `x".repeat(20 * 1024)` — linii 290 si 483 — necesita ajustare: trebuie sa demonstreze ca 201 chars falimenteaza, 200 trece)
- Test nou: `backend/src/schemas/monitoring.notes-limit.test.ts`

### Step 1 — Scrie testul rosu pentru schema

Creeaza `backend/src/schemas/monitoring.notes-limit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { JobCreateBodySchema, JobUpdateBodySchema } from "./monitoring";

describe("notes — limita 200 chars", () => {
  it("Create: 200 chars trece", () => {
    const result = JobCreateBodySchema.safeParse({
      kind: "dosar_soap",
      target: { numar_dosar: "1234/2024" },
      notes: "x".repeat(200),
    });
    expect(result.success).toBe(true);
  });

  it("Create: 201 chars esueaza cu mesaj clar", () => {
    const result = JobCreateBodySchema.safeParse({
      kind: "dosar_soap",
      target: { numar_dosar: "1234/2024" },
      notes: "x".repeat(201),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("notes"));
      expect(issue?.message).toMatch(/200/);
    }
  });

  it("Update: 200 chars trece, 201 esueaza", () => {
    expect(JobUpdateBodySchema.safeParse({ notes: "x".repeat(200) }).success).toBe(true);
    expect(JobUpdateBodySchema.safeParse({ notes: "x".repeat(201) }).success).toBe(false);
  });

  it("Update: notes=null trece (stergere explicita)", () => {
    expect(JobUpdateBodySchema.safeParse({ notes: null }).success).toBe(true);
  });
});
```

### Step 2 — Confirma testul esueaza

```bash
npx vitest run backend/src/schemas/monitoring.notes-limit.test.ts
```
Asteptat: testele pentru 201 chars trec (limita curenta e 2000), deci primele teste **pasa eronat**. Testele cu 200 chars vor fi pasul corect — verifica ca **testul cu 201 esuat** apare ca FAIL.

### Step 3 — Aplica fix-ul in schema

In `backend/src/schemas/monitoring.ts:93`:
```ts
// inainte
notes: z.string().max(2000).optional(),
// dupa
notes: z.string().max(200, "Notita maxim 200 caractere").optional(),
```

In `backend/src/schemas/monitoring.ts:134`:
```ts
// inainte
notes: z.string().max(2000).nullable().optional(),
// dupa
notes: z.string().max(200, "Notita maxim 200 caractere").nullable().optional(),
```

### Step 4 — Ajusteaza testele existente care folosesc 20KB

`backend/src/routes/monitoring.test.ts:290` si `:483` foloseau `"x".repeat(20 * 1024)` ca payload prea mare. Logica testului ramane (asteapta esec validare); doar reduce la `"x".repeat(201)` ca sa nu confunde citirea — comportament identic, payload onest.

Cauta:
```bash
grep -n "20 \* 1024" backend/src/routes/monitoring.test.ts
```
Inlocuieste fiecare aparitie cu `201`.

### Step 5 — Ruleaza toate testele

```bash
npx vitest run backend/src/schemas/monitoring.notes-limit.test.ts backend/src/routes/monitoring.test.ts
```
Asteptat: PASS.

### Step 6 — Biome + tsc + commit

```bash
npx biome check --write backend/src/schemas/monitoring.ts backend/src/schemas/monitoring.notes-limit.test.ts backend/src/routes/monitoring.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/schemas/monitoring.ts backend/src/schemas/monitoring.notes-limit.test.ts backend/src/routes/monitoring.test.ts
git commit -m "feat(monitoring): notes limit 2000 -> 200 chars cu mesaj romanesc

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2 — Expune `job_notes` in listAlerts (backend)

**Files:**
- Modifica: `backend/src/db/monitoringAlertsRepository.ts` linia 357-360 (SELECT) + tipul `MonitoringAlertRow`
- Modifica: `backend/src/routes/alerts.ts` (mapping spre raspuns, daca exista)
- Test nou: `backend/src/db/monitoringAlertsRepository.notes-join.test.ts`

### Step 1 — Scrie testul rosu

Creeaza `backend/src/db/monitoringAlertsRepository.notes-join.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, openDb } from "./connection";
import { runMigrations } from "./migrations/runner";
import { createJob } from "./monitoringJobsRepository";
import { insertAlert, listAlerts } from "./monitoringAlertsRepository";

describe("listAlerts — job_notes propagare", () => {
  beforeEach(() => {
    openDb(":memory:");
    runMigrations();
  });
  afterEach(() => closeDb());

  it("intoarce job.notes pentru alerta atasata jobului cu notita", () => {
    const ownerId = "owner-1";
    const job = createJob(ownerId, {
      kind: "dosar_soap",
      target: { numar_dosar: "1234/180/2024" },
      target_hash: "h1",
      cadence_sec: 14400,
      alert_config: {},
      notes: "Client VIP — anunta inainte de termen",
      next_run_at: new Date().toISOString(),
    });
    insertAlert({
      ownerId,
      jobId: job.id,
      kind: "termen_new",
      severity: "info",
      title: "Termen nou",
      detailJson: "{}",
      dedupKey: "k1",
    });

    const result = listAlerts({ ownerId, page: 1, pageSize: 10 });
    expect(result.rows[0].job_notes).toBe("Client VIP — anunta inainte de termen");
  });

  it("returneaza null cand jobul nu are notita", () => {
    const ownerId = "owner-2";
    const job = createJob(ownerId, {
      kind: "dosar_soap",
      target: { numar_dosar: "9999/180/2024" },
      target_hash: "h2",
      cadence_sec: 14400,
      alert_config: {},
      next_run_at: new Date().toISOString(),
    });
    insertAlert({
      ownerId,
      jobId: job.id,
      kind: "termen_new",
      severity: "info",
      title: "T",
      detailJson: "{}",
      dedupKey: "k2",
    });
    const result = listAlerts({ ownerId, page: 1, pageSize: 10 });
    expect(result.rows[0].job_notes).toBeNull();
  });
});
```

### Step 2 — Ruleaza si confirma FAIL

```bash
npx vitest run backend/src/db/monitoringAlertsRepository.notes-join.test.ts
```
Asteptat: FAIL — campul `job_notes` nu exista pe `MonitoringAlertRow` (TS error) sau e `undefined` (runtime).

### Step 3 — Modifica SELECT-ul si tipul

In `backend/src/db/monitoringAlertsRepository.ts` cauta linia 357-360:
```sql
SELECT a.*,
       j.target_json AS job_target_json,
       j.kind AS job_kind
FROM monitoring_alerts a
```
Modifica la:
```sql
SELECT a.*,
       j.target_json AS job_target_json,
       j.kind AS job_kind,
       j.notes AS job_notes
FROM monitoring_alerts a
```

Cauta tipul `MonitoringAlertRow` in acelasi fisier (sau in fisierul de tipuri import-at). Adauga:
```ts
job_notes?: string | null;
```

Daca tipul e definit intr-un alt fisier (`backend/src/db/monitoringAlertsRepository.ts` exporta typically), urmareste imports si actualizeaza-l acolo.

### Step 4 — Verifica ce expune `routes/alerts.ts` la client

```bash
grep -n "job_target_json\|job_kind\|job_notes" backend/src/routes/alerts.ts
```
Daca `routes/alerts.ts` face pick selectiv pe raspuns (omit job_target_json+job_kind), adauga `job_notes` in acelasi fel. Daca trimite tot rândul direct (`return c.json(rows)`), e deja expus.

### Step 5 — Ruleaza testele si confirma PASS

```bash
npx vitest run backend/src/db/monitoringAlertsRepository.notes-join.test.ts backend/src/routes/alerts.test.ts
```

### Step 6 — Biome + commit

```bash
npx biome check --write backend/src/db/monitoringAlertsRepository.ts backend/src/db/monitoringAlertsRepository.notes-join.test.ts backend/src/routes/alerts.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/db/monitoringAlertsRepository.ts backend/src/db/monitoringAlertsRepository.notes-join.test.ts backend/src/routes/alerts.ts
git commit -m "feat(alerts): expune job.notes via LEFT JOIN in listAlerts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3 — Frontend API client pentru updateNote

**Files:**
- Modifica: `frontend/src/lib/api.ts` sau dedicat `monitoring` namespace daca exista
- Test nou: `frontend/src/lib/monitoring.updateNote.test.ts` (sau extinde existentul daca exista)

### Step 1 — Identifica monitoring API namespace

```bash
grep -n "monitoring\." frontend/src/lib/api.ts | head -20
grep -n "monitoring " frontend/src/lib/*.ts | head -20
```
Daca exista deja un obiect `monitoring` cu `createDosar`, `createName`, etc., adauga acolo. Daca nu, creeaza helper inline `updateMonitoringJobNote(id, note)`.

### Step 2 — Scrie testul rosu

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { monitoring } from "./api"; // sau wherever helper is exported

describe("monitoring.updateNote", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("PATCH /api/v1/monitoring/jobs/:id cu body { notes }", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 42, notes: "noua" }), { status: 200 })
    );
    const result = await monitoring.updateNote(42, "noua");
    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/monitoring/jobs/42");
    expect(call[1]?.method).toBe("PATCH");
    const body = JSON.parse(call[1]?.body as string);
    expect(body).toEqual({ notes: "noua" });
    expect(result.notes).toBe("noua");
  });

  it("trimite notes: null pentru stergere", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 42, notes: null }), { status: 200 })
    );
    await monitoring.updateNote(42, null);
    const body = JSON.parse(
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body as string
    );
    expect(body).toEqual({ notes: null });
  });

  it("propaga eroare envelope cu mesaj", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: null, error: { code: "INVALID_PARAMS", message: "Notita maxim 200 caractere" } }),
        { status: 400 }
      )
    );
    await expect(monitoring.updateNote(42, "x".repeat(201))).rejects.toThrow("Notita maxim 200 caractere");
  });
});
```

### Step 3 — FAIL run

```bash
cd frontend && npx vitest run src/lib/monitoring.updateNote.test.ts
```

### Step 4 — Adauga implementarea

In `frontend/src/lib/api.ts` (sau wherever monitoring helpers stau), adauga:

```ts
async updateNote(id: number, notes: string | null): Promise<{ id: number; notes: string | null }> {
  const res = await apiFetch(`/api/v1/monitoring/jobs/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractErrorMessage(data, "Eroare la salvarea notitei"));
  }
  return data;
}
```

Foloseste `extractErrorMessage` din `frontend/src/lib/api.ts` (livrat in PR-6, task 7).

### Step 5 — PASS + biome + commit

```bash
cd frontend && npx vitest run src/lib/monitoring.updateNote.test.ts
cd ..
npx biome check --write frontend/src/lib/api.ts frontend/src/lib/monitoring.updateNote.test.ts
cd frontend && npx tsc --noEmit
cd ..
git add frontend/src/lib/api.ts frontend/src/lib/monitoring.updateNote.test.ts
git commit -m "feat(frontend): monitoring.updateNote PATCH helper cu envelope error parse

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4 — UI editor inline pe randul Monitorizare

**Files:**
- Modifica: `frontend/src/pages/Monitorizare.tsx` (zona 587-594 cu display-ul curent)
- Test nou: `frontend/src/pages/Monitorizare.notes-editor.test.tsx` (rendering + interactiune)

### Step 1 — Scrie testul rosu

Creeaza `frontend/src/pages/Monitorizare.notes-editor.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return {
    ...actual,
    monitoring: {
      ...actual.monitoring,
      updateNote: vi.fn().mockResolvedValue({ id: 1, notes: "actualizat" }),
    },
  };
});

// Import dupa mock
import { Monitorizare } from "./Monitorizare";
import { monitoring } from "@/lib/api";

describe("Monitorizare — editor inline notita", () => {
  // ... setup helpers pentru renderJob({ id: 1, notes: "vechi", ... })

  it("click pe notita existenta deschide textarea preincarcata", async () => {
    // render cu un job care are notes="vechi"
    fireEvent.click(screen.getByText("vechi"));
    const textarea = await screen.findByRole("textbox", { name: /notita/i });
    expect(textarea).toHaveValue("vechi");
  });

  it("buton + Adauga notita apare cand notes e null", () => {
    // render cu job notes=null
    expect(screen.getByRole("button", { name: /adauga notita/i })).toBeInTheDocument();
  });

  it("counter 200/200 cand textarea atinge limita", async () => {
    fireEvent.click(screen.getByRole("button", { name: /adauga notita/i }));
    const textarea = await screen.findByRole("textbox", { name: /notita/i });
    fireEvent.change(textarea, { target: { value: "x".repeat(200) } });
    expect(screen.getByText("200/200")).toBeInTheDocument();
  });

  it("textarea respinge >200 via maxLength", async () => {
    fireEvent.click(screen.getByRole("button", { name: /adauga notita/i }));
    const textarea = await screen.findByRole("textbox", { name: /notita/i });
    expect(textarea).toHaveAttribute("maxLength", "200");
  });

  it("Salveaza apeleaza monitoring.updateNote si inchide editorul", async () => {
    fireEvent.click(screen.getByText("vechi"));
    const textarea = await screen.findByRole("textbox", { name: /notita/i });
    fireEvent.change(textarea, { target: { value: "actualizat" } });
    fireEvent.click(screen.getByRole("button", { name: /salveaza/i }));
    await waitFor(() => expect(monitoring.updateNote).toHaveBeenCalledWith(1, "actualizat"));
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(screen.getByText("actualizat")).toBeInTheDocument();
  });

  it("Anuleaza inchide editorul fara API call", async () => {
    fireEvent.click(screen.getByText("vechi"));
    fireEvent.change(await screen.findByRole("textbox", { name: /notita/i }), {
      target: { value: "schimbat" },
    });
    fireEvent.click(screen.getByRole("button", { name: /anuleaza/i }));
    expect(monitoring.updateNote).not.toHaveBeenCalled();
    expect(screen.getByText("vechi")).toBeInTheDocument();
  });
});
```

### Step 2 — Run FAIL

```bash
cd frontend && npx vitest run src/pages/Monitorizare.notes-editor.test.tsx
```

### Step 3 — Implementeaza editor

In `frontend/src/pages/Monitorizare.tsx`, in jurul liniei 587-594, inlocuieste blocul `{job.notes && (...)}` cu un sub-component:

```tsx
<NoteEditor
  jobId={job.id}
  initialNote={job.notes}
  onSaved={(newNote) => {
    // optimistic update pe state-ul listei
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, notes: newNote } : j)));
  }}
/>
```

`NoteEditor` (componenta noua intr-un fisier separat sau inline in acelasi `.tsx` daca e mic):

```tsx
function NoteEditor({ jobId, initialNote, onSaved }: {
  jobId: number;
  initialNote: string | null;
  onSaved: (n: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return initialNote ? (
      <button
        type="button"
        onClick={() => { setValue(initialNote); setEditing(true); }}
        className="mt-1 max-w-[420px] truncate text-left text-xs italic text-muted-foreground hover:text-foreground font-sans cursor-pointer"
        title={initialNote}
      >
        {initialNote}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1 text-xs text-muted-foreground hover:text-foreground italic"
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
      await monitoring.updateNote(jobId, next);
      onSaved(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare salvare");
    } finally {
      setSaving(false);
    }
  };

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

### Step 4 — Run PASS

```bash
cd frontend && npx vitest run src/pages/Monitorizare.notes-editor.test.tsx
```

### Step 5 — Biome + tsc + commit

```bash
npx biome check --write frontend/src/pages/Monitorizare.tsx frontend/src/pages/Monitorizare.notes-editor.test.tsx
cd frontend && npx tsc --noEmit && cd ..
git add frontend/src/pages/Monitorizare.tsx frontend/src/pages/Monitorizare.notes-editor.test.tsx
git commit -m "feat(monitoring): editor inline pentru notita per job (max 200 chars)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5 — Display `job_notes` in carduri alerte

**Files:**
- Modifica: componenta de alert card in `frontend/src/pages/Alerts.tsx` (sau `frontend/src/components/alerts/AlertCard.tsx` daca exista — verifica)
- Modifica: tipul `Alert` din `frontend/src/types/alert.ts` (sau wherever) — adauga `job_notes?: string | null`
- Test nou: `frontend/src/pages/Alerts.notes-display.test.tsx`

### Step 1 — Identifica componenta corecta

```bash
grep -rn "AlertCard\|alert\.title\|alert\.detail" frontend/src --include="*.tsx" | head -20
```

### Step 2 — Test rosu

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertCard } from "@/components/alerts/AlertCard"; // sau wherever

describe("AlertCard — afisare job_notes", () => {
  it("randeaza bloc Notita cand job_notes e setat", () => {
    render(<AlertCard alert={{ id: 1, title: "Termen nou", job_notes: "Client VIP", ... }} />);
    expect(screen.getByText(/Notita:/)).toBeInTheDocument();
    expect(screen.getByText("Client VIP")).toBeInTheDocument();
  });

  it("nu randeaza blocul cand job_notes e null sau lipsa", () => {
    render(<AlertCard alert={{ id: 1, title: "Termen nou", job_notes: null, ... }} />);
    expect(screen.queryByText(/Notita:/)).not.toBeInTheDocument();
  });
});
```

### Step 3 — FAIL run

```bash
cd frontend && npx vitest run src/pages/Alerts.notes-display.test.tsx
```

### Step 4 — Adauga tipul + render bloc

Adauga in tipul de alert:
```ts
export interface Alert {
  // ... existing
  job_notes?: string | null;
}
```

In componenta de alert card, dupa corpul alertei (titlu + detail), adauga:
```tsx
{alert.job_notes && (
  <div className="mt-2 border-l-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs italic text-foreground/80">
    <span className="font-semibold not-italic mr-1">Notita:</span>
    {alert.job_notes}
  </div>
)}
```

### Step 5 — PASS + biome + commit

```bash
cd frontend && npx vitest run src/pages/Alerts.notes-display.test.tsx
cd ..
npx biome check --write frontend/src/pages/Alerts.tsx frontend/src/types/alert.ts frontend/src/pages/Alerts.notes-display.test.tsx
cd frontend && npx tsc --noEmit && cd ..
git add frontend/src/pages/Alerts.tsx frontend/src/types/alert.ts frontend/src/pages/Alerts.notes-display.test.tsx
git commit -m "feat(alerts): afiseaza job.notes in cardul de alerta cand exista

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6 — Verificare integrata desktop

**Manual smoke** dupa build local. NU comiti nimic in acest task — doar valideaza.

### Step 1 — Build + restart Electron

```bash
npm run build
# scrub ELECTRON_RUN_AS_NODE in caz ca e leaked:
$env:ELECTRON_RUN_AS_NODE = ""
npm run electron:dev
```

### Step 2 — Checklist smoke

- [ ] Pagina `/monitorizare`: pe un job existent FARA nota, butonul "+ Adauga notita" apare. Click → textarea + counter `0/200`.
- [ ] Tastez 50 caractere → counter `50/200`. Salveaza → mesajul devine read-only italic sub target.
- [ ] Re-click pe nota → textarea preincarcata cu valoarea curenta.
- [ ] Sterg tot textul → Salveaza → revine la butonul "+ Adauga notita".
- [ ] Incerc sa lipesc 250 caractere → textarea taie la 200 (maxLength).
- [ ] Pagina `/alerte`: alertele provenite din job-uri cu nota afiseaza blocul amber "Notita: ...". Cele fara nota raman compacte.
- [ ] Editez nota din /monitorizare → revin la /alerte → blocul Notita reflecta valoarea noua (live read).
- [ ] Owner isolation: nu pot edita un job al altui owner (manual: ar trebui sa returneze 404 — nu testam manual, ne incredem in testul automat).

Daca toate trec, treci la Task 7.

---

## Task 7 — Release bump v2.27.0

**Files:**
- `package.json` (root + `backend/` + `frontend/`) + `package-lock.json`
- `frontend/src/data/changelog-entries.tsx` — entry nou v2.27.0
- `CHANGELOG.md` — sectiune noua
- `README.md` — campul "Versiune curenta"
- `CLAUDE.md` — campul "Versiune Curenta" (1-2 linii)
- `STATUS.md` — "Versiune curenta reala" + "Data curenta"
- `DOCUMENTATIE.md` — "Versiune curenta"
- `SESSION-HANDOFF.md` — daca exista referinta la versiune

### Step 1 — Bump versiune in toate manifestele

```bash
# Editeaza manual fiecare package.json: "version": "2.26.0" -> "2.27.0"
# Apoi regenereaza lockfile-ul:
npm install --package-lock-only
```

### Step 2 — Adauga entry in changelog-entries.tsx + CHANGELOG.md

Entry CHANGELOG.md (sus, deasupra v2.26.0):

```markdown
## v2.27.0 — 2026-05-14

### Adaugat
- **Notite editabile per job de monitorizare** — utilizatorul poate scrie un memo de max 200 caractere atasat unui job (Monitorizare → click pe nota sau "+ Adauga notita"). Persistent, owner-scoped, PATCH `/api/v1/monitoring/jobs/:id`.
- **Notita atasata alertelor** — cardurile din `/alerte` afiseaza blocul "Notita: ..." cand alerta provine dintr-un job cu notita setata. Read live, fara snapshot — editarea notitei se reflecta imediat in alerte deja emise.

### Modificat
- Limita backend pentru `monitoring_jobs.notes` redusa de la 2000 la 200 chars (zod). Existing rows >200 raman intacte; doar write nou e respins. Mesaj eroare romanesc.
```

Entry in `frontend/src/data/changelog-entries.tsx` cu acelasi continut, format obisnuit.

### Step 3 — Restul .md-urilor

Cauta toate referintele la versiunea veche:
```bash
grep -l "2\.26\.0" *.md
```
Update fiecare cu 2.27.0.

### Step 4 — Final checks + commit + tag

```bash
npx biome check --write .
npx tsc --noEmit -p backend/tsconfig.json && cd frontend && npx tsc --noEmit && cd ..
npm run build
npm test --workspace=backend
cd frontend && npm test -- --run && cd ..

git add -A
git commit -m "release: v2.27.0 — notite editabile per job + propagare in alerte

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git tag v2.27.0
git push origin feat/monitoring-notes-edit
git push origin v2.27.0
```

### Step 5 — Restart Electron pentru `__APP_VERSION__`

```bash
# In sesiunea Electron deja rulanta:
# Inchide aplicatia, apoi:
$env:ELECTRON_RUN_AS_NODE = ""
npm run electron:dev
```
Verifica sidebar/Dashboard arata `v2.27.0`.

---

## Reguli generale Codex

- **NU merge in main** pana la review explicit de user.
- **NU push --force** niciodata. Daca apare conflict la push, opreste-te si raporteaza.
- **NU skip --no-verify** la commit. Daca pre-commit hook esueaza, fix root cause.
- **Toate fisierele .test.ts/.test.tsx** trebuie sa fie owner-scoped (folosesc `ownerId` distinct unde se aplica).
- **Romana fara diacritice** in cod, comentarii, commit messages, UI text.
- **Biome + tsc + vitest** trebuie sa treaca verde inainte de fiecare commit. Daca nu trec, opreste task-ul si raporteaza eroarea exact.
- **NU adauga features in plus** — nu schimba styling-ul existent al notitei display, nu adauga icoane, nu refactoreaza componente vecine. Tine-te strict de scope-ul fiecarui task.
