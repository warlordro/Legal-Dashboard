# Stergere backup individual (monolit, admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adminul poate sterge un singur backup al monolitului din Setari > Backup, nu doar toate odata.

**Architecture:** O functie noua de service `deleteBackupByName` in `backend/src/db/backup.ts` (acelasi jail + write lock ca restul operatiilor), o ruta noua `DELETE /api/v1/admin/backups/:name` in routerul existent, un client nou `adminDeleteBackup` in `adminBackupsApi.ts` si un buton de stergere per rand in `Backups.tsx` cu confirmare destructiva.

**Tech Stack:** Hono, better-sqlite3 (doar FS aici), React 18, vitest.

## Global Constraints

- Branch: `feat/v2.43.0-rnpm-split`. Commit local, FARA push.
- Limba UI: romana fara diacritice.
- Fara `git add -A` — staging doar pe cai explicite.
- Validarea numelui refoloseste `assertNameInJail` + `RESTORE_NAME_RE` existente (backup.ts:704-715) — NU se scrie regex nou.
- Stergerea ruleaza sub `withMaintenanceWrite` — aceeasi justificare ca `deleteAllBackups` (backup.ts:1344-1346): un delete in timpul unui restore in zbor ar putea sterge sursa restore-ului sau snapshotul pre-restore.
- Erorile de validare → 400 `INVALID_PARAMS`; erorile tipate de mentenanta se rethrow spre handlerul central (409/503); restul → 500 generic. Identic cu ruta de restore.
- Audit: actiunea `backup.delete` (pereche cu `backup.create`/`backup.restore`/`backup.delete_all`), `targetId` = numele fisierului, outcome `denied`/`error` pe esec — pattern-ul exact din rutele existente.
- Dupa mutatie: buton per rand cu garda `actionInFlightRef` (pattern-ul existent din Backups.tsx), confirmare destructiva cu titlu explicit.

---

### Task 1: Backend — service + ruta `DELETE /:name`

**Files:**
- Modify: `backend/src/db/backup.ts` (dupa `deleteAllBackups`, ~:1349)
- Modify: `backend/src/routes/adminBackups.ts` (dupa `delete("/")`, ~:148)
- Test: `backend/src/routes/adminBackups.test.ts`

**Interfaces:**
- Produces: `deleteBackupByName(name: string): Promise<void>` (export din `backend/src/db/backup.ts`; arunca `BackupValidationError` pe nume invalid sau fisier inexistent). Ruta `DELETE /api/v1/admin/backups/:name` → `200 {"data":{"name":"<name>"}}`.

- [ ] **Step 1: Scrie testele care pica** — adauga in `backend/src/routes/adminBackups.test.ts`:

In testul existent "non-adminul primeste 403 pe toate rutele" adauga:

```ts
    expect(
      (
        await app.request("/api/v1/admin/backups/legal-dashboard.x.db", {
          method: "DELETE",
          headers: DESKTOP,
        })
      ).status
    ).toBe(403);
```

Apoi un `describe` nou la finalul fisierului:

```ts
describe("DELETE /api/v1/admin/backups/:name — stergere individuala", () => {
  it("sterge DOAR backup-ul cerut, cu sidecar-uri, si scrie audit backup.delete", async () => {
    const app = buildApp("admin1");
    const r1 = await app.request("/api/v1/admin/backups/create", { method: "POST", headers: DESKTOP });
    const name1 = ((await r1.json()) as { data: { name: string } }).data.name;
    const r2 = await app.request("/api/v1/admin/backups/create", { method: "POST", headers: DESKTOP });
    const name2 = ((await r2.json()) as { data: { name: string } }).data.name;
    expect(name1).not.toBe(name2);
    // Sidecar-uri legacy simulate — trebuie sa plece odata cu backup-ul.
    fs.writeFileSync(path.join(getBackupDir(), `${name1}-wal`), "x");
    fs.writeFileSync(path.join(getBackupDir(), `${name1}-shm`), "x");

    const res = await app.request(`/api/v1/admin/backups/${encodeURIComponent(name1)}`, {
      method: "DELETE",
      headers: DESKTOP,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { name: string } }).data.name).toBe(name1);
    expect(fs.existsSync(path.join(getBackupDir(), name1))).toBe(false);
    expect(fs.existsSync(path.join(getBackupDir(), `${name1}-wal`))).toBe(false);
    expect(fs.existsSync(path.join(getBackupDir(), `${name1}-shm`))).toBe(false);
    expect(fs.existsSync(path.join(getBackupDir(), name2))).toBe(true);
    const audit = getAuditEvents({ action: "backup.delete" });
    expect(audit.length).toBe(1);
    expect(audit[0]?.targetId).toBe(name1);
  });

  it("refuza traversal si nume care nu respecta pattern-ul de backup (400)", async () => {
    const app = buildApp("admin1");
    for (const raw of ["%2e%2e%2fetc", "..%5Cx.db", "legal-dashboard.db", "altfisier.db"]) {
      const res = await app.request(`/api/v1/admin/backups/${raw}`, { method: "DELETE", headers: DESKTOP });
      expect(res.status, raw).toBe(400);
    }
  });

  it("backup inexistent → 400, cu audit outcome error", async () => {
    const app = buildApp("admin1");
    const res = await app.request("/api/v1/admin/backups/legal-dashboard.nu-exista.db", {
      method: "DELETE",
      headers: DESKTOP,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Backup inexistent");
    const audit = getAuditEvents({ action: "backup.delete" });
    expect(audit.length).toBe(1);
    expect(audit[0]?.outcome).toBe("error");
  });

  it("cere header-ul desktop in mod desktop", async () => {
    const app = buildApp("admin1");
    const res = await app.request("/api/v1/admin/backups/legal-dashboard.x.db", { method: "DELETE" });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Ruleaza testele — trebuie sa PICE**

Run: `npx vitest run --root backend src/routes/adminBackups.test.ts`
Expected: FAIL — 404 in loc de 200/400 (ruta nu exista).
Nota: linia noua din testul de 403 non-admin e verde si INAINTE de implementare
(`requireRole` e montat cu `use("*")` si raspunde 403 chiar fara ruta) — doar
`describe`-ul nou trebuie sa pice.

- [ ] **Step 3: Implementarea de service** — in `backend/src/db/backup.ts`, imediat dupa `deleteAllBackups` (~:1349):

```ts
// Stergere individuala (Setari > Backup, per rand). Acelasi jail ca restore-ul
// si acelasi write lock ca delete-all: un delete lansat in timpul unui restore
// in zbor ar putea sterge sursa restore-ului sau snapshotul pre-restore.
// Lock-ul e in-process (RWLock) — suficient: aplicatia ruleaza un singur proces
// (single-instance lock pe desktop, un singur node in web mode), premisa intregii
// mentenante din acest fisier. Validarea sta INAINTE de lock: e pura, iar un
// nume-gunoi nu are de ce sa puna un writer in coada (writer-preference ar
// intarzia reader-i noi degeaba).
export async function deleteBackupByName(name: string): Promise<void> {
  const dir = getBackupDir();
  assertNameInJail(dir, name, RESTORE_NAME_RE);
  return withMaintenanceWrite(async () => {
    const target = path.join(dir, name);
    try {
      await fsPromises.unlink(target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
        throw new BackupValidationError("Backup inexistent");
      }
      throw e;
    }
    // Bundle-aware: sidecar-urile legacy pleaca odata cu backup-ul, BEST-EFFORT
    // (exact semantica din deleteAllBackupsInDir). Un sidecar orfan nu se poate
    // atasa altui backup: numele contin timestamp + uniquifier, deci nu se
    // refolosesc.
    for (const suffix of ["-wal", "-shm"] as const) {
      await fsPromises.unlink(target + suffix).catch(() => {
        /* best-effort */
      });
    }
    logBackupEvent({ action: "delete_backup", file: name });
  });
}
```

- [ ] **Step 4: Ruta** — in `backend/src/routes/adminBackups.ts`, dupa `adminBackupsRouter.delete("/", ...)` (~:148); adauga `deleteBackupByName` la importul din `../db/backup.ts`:

```ts
adminBackupsRouter.delete("/:name", requireDesktopHeader, async (c) => {
  const name = c.req.param("name");
  try {
    await deleteBackupByName(name);
    recordAuditSafe(c, "backup.delete", {
      targetKind: "backup",
      targetId: name,
    });
    return c.json(ok({ name }, c));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare stergere backup";
    recordAuditSafe(c, "backup.delete", {
      targetKind: "backup",
      targetId: name,
      outcome: isTypedMaintenanceError(e) ? "denied" : "error",
      detail: { error: msg },
    });
    if (e instanceof BackupValidationError) {
      return c.json(fail(ErrorCodes.INVALID_PARAMS, msg, c), 400);
    }
    rethrowTypedMaintenanceError(e);
    console.error("[adminBackups] delete failed:", e);
    return c.json(
      fail(
        ErrorCodes.INTERNAL_ERROR,
        "Eroare interna. Reincearca sau contacteaza administratorul cu requestId-ul din raspuns.",
        c
      ),
      500
    );
  }
});
```

- [ ] **Step 5: Ruleaza testele — trebuie sa TREACA**

Run: `npx vitest run --root backend src/routes/adminBackups.test.ts`
Expected: PASS (toate, inclusiv cele existente).

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/backup.ts backend/src/routes/adminBackups.ts backend/src/routes/adminBackups.test.ts
git commit -m "feat(admin): stergere individuala de backup al monolitului (DELETE /admin/backups/:name)"
```

---

### Task 2: Frontend — client API + buton per rand

**Files:**
- Modify: `frontend/src/lib/adminBackupsApi.ts`
- Modify: `frontend/src/pages/admin/Backups.tsx`
- Test: `frontend/src/lib/adminBackupsApi.test.ts`, `frontend/src/pages/admin/Backups.test.tsx`

**Interfaces:**
- Consumes: `DELETE /api/v1/admin/backups/:name` → `200 {"data":{"name":"<name>"}}` (Task 1).
- Produces: `adminDeleteBackup(name: string): Promise<void>` in `adminBackupsApi.ts`.

- [ ] **Step 1: Testul de client care pica** — in `frontend/src/lib/adminBackupsApi.test.ts`, adauga importul `adminDeleteBackup` la importul existent si testul:

```ts
  it("adminDeleteBackup apeleaza DELETE pe numele encodat si rezolva la succes", async () => {
    mockApiFetch.mockResolvedValue(
      jsonResponse(200, { data: { name: "legal-dashboard.manual-x.db" }, requestId: "rid-5" })
    );

    await expect(adminDeleteBackup("legal-dashboard.manual-x.db")).resolves.toBeUndefined();
    expect(mockApiFetch).toHaveBeenCalledWith("/api/v1/admin/backups/legal-dashboard.manual-x.db", {
      method: "DELETE",
    });
  });
```

- [ ] **Step 2: Ruleaza — FAIL** (`adminDeleteBackup` nu exista)

Run: `cd frontend && npx vitest run src/lib/adminBackupsApi.test.ts`

- [ ] **Step 3: Clientul** — in `frontend/src/lib/adminBackupsApi.ts`:

```ts
export async function adminDeleteBackup(name: string): Promise<void> {
  await unwrapMonitoring<{ name: string }>(
    await apiFetch(`${BASE}/${encodeURIComponent(name)}`, { method: "DELETE" })
  );
}
```

- [ ] **Step 4: Ruleaza — PASS**, apoi testele de pagina care pica — in `frontend/src/pages/admin/Backups.test.tsx`: adauga `adminDeleteBackup: vi.fn()` in `vi.mock`, importa-l, `const deleteOneMock = vi.mocked(adminDeleteBackup)` + `deleteOneMock.mockReset()` in `beforeEach`, si testele:

```ts
  it("stergerea unui singur backup cere confirmare destructiva si apeleaza API-ul cu numele randului", async () => {
    deleteOneMock.mockResolvedValue(undefined);
    await render(<AdminBackups embedded />);
    await act(async () => {
      clickButton(/^Sterge$/);
      await Promise.resolve();
    });
    const dialog = confirmDialog();
    expect(dialog.textContent).toContain("Sterge backup");
    expect(dialog.textContent).toContain("legal-dashboard.2026-07-10.db");
    const confirmBtn = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      /^Sterge$/.test(b.textContent ?? "")
    );
    if (!confirmBtn) throw new Error("Butonul de confirmare lipsa");
    await act(async () => {
      confirmBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(deleteOneMock).toHaveBeenCalledWith("legal-dashboard.2026-07-10.db");
    expect(deleteOneMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Backup sters: legal-dashboard.2026-07-10.db");
  });

  it("anularea dialogului de stergere nu apeleaza API-ul si lasa garda libera", async () => {
    await render(<AdminBackups embedded />);
    await act(async () => {
      clickButton(/^Sterge$/);
      await Promise.resolve();
    });
    const cancel = Array.from(confirmDialog().querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      /anuleaza/i.test(b.textContent ?? "")
    );
    if (!cancel) throw new Error("Butonul de anulare lipsa");
    await act(async () => {
      cancel.click();
      await Promise.resolve();
    });
    expect(deleteOneMock).not.toHaveBeenCalled();
    await act(async () => {
      clickButton(/^Sterge$/);
      await Promise.resolve();
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });
```

Nota pentru `clickButton(/^Sterge$/)`: butonul de delete-all are textul "Sterge toate backup-urile", deci `/^Sterge$/` prinde DOAR butonul de rand (primul rand din lista mock).

- [ ] **Step 5: Handler + buton in `Backups.tsx`** — langa `handleDeleteAll`:

```tsx
  const handleDelete = async (entry: BackupEntry) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    try {
      if (busy) return;
      if (
        !(await confirm({
          title: "Sterge backup",
          message: `Stergi backup-ul ${entry.name}?\n\nActiunea este ireversibila. Celelalte backup-uri nu sunt afectate.`,
          confirmLabel: "Sterge",
          destructive: true,
        }))
      )
        return;
      setBusy(`delete:${entry.name}`);
      setError(null);
      setSuccessMsg(null);
      try {
        await adminDeleteBackup(entry.name);
        setSuccessMsg(`Backup sters: ${entry.name}.`);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Eroare la stergerea backup-ului");
      } finally {
        setBusy(null);
      }
    } finally {
      actionInFlightRef.current = false;
    }
  };
```

Adauga `adminDeleteBackup` la importul din `@/lib/adminBackupsApi` si actualizeaza comentariul valorilor `busy` (Backups.tsx:~31) ca sa includa forma noua `delete:<nume backup>`. In randul listei, dupa butonul "Restaureaza":

```tsx
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => void handleDelete(b)}
                  className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 disabled:opacity-50"
                >
                  {busy === `delete:${b.name}` ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Sterge
                </Button>
```

- [ ] **Step 6: Ruleaza testele frontend — PASS**

Run: `cd frontend && npx vitest run src/lib/adminBackupsApi.test.ts src/pages/admin/Backups.test.tsx`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/adminBackupsApi.ts frontend/src/lib/adminBackupsApi.test.ts frontend/src/pages/admin/Backups.tsx frontend/src/pages/admin/Backups.test.tsx
git commit -m "feat(admin): buton de stergere per backup in Setari > Backup"
```

---

### Task 3: Gate complet

- [ ] **Step 1:** `npx biome check --write` pe cele 7 fisiere atinse (3 backend + 4 frontend); daca reformateaza, re-stage si amendeaza commit-ul respectiv sau commit separat `style:`.
- [ ] **Step 2:** `npx tsc --noEmit -p backend/tsconfig.json` si `cd frontend && npx tsc --noEmit` — curat.
- [ ] **Step 3:** `npm run build` — curat.
- [ ] **Step 4:** `npm test --workspace=backend` si `cd frontend && npm test -- --run` — baseline 2148 backend (dupa fixul de cause) / 401 frontend, plus testele noi.
- [ ] **Step 5:** Smoke live in mediul web pornit: sterge un backup din UI, verifica lista si linia `delete_backup` in `.dev-web-local/backend.out.log`. FARA push.

## Review adversarial (2026-07-26, procesat)

Plan trecut prin fable-advisor (verdict: SOUND) si Codex cu perimetru inchis (verdict:
SOUND WITH FIXES). Integrate: asertiuni de audit pe `targetId`/`outcome`, garda pe butonul
de anulare in test, validarea mutata inaintea lock-ului, nota single-process + best-effort
pe sidecars, nota despre 403-ul verde pre-implementare, comentariul `busy`, countul de
fisiere din gate (7). Respinse cu dovezi: "smoke-ul trebuie pe Electron" (prioritatea
proiectului e web; smoke Electron doar la tag desktop), "selectorul `/^Sterge$/` e ambiguu"
(regex ancorat — "Sterge toate backup-urile" nu face match; verificat de advisor pe DOM),
"validarea inainte de lock e patternul din restore" (restore valideaza IN lock; mutarea e
imbunatatire, nu aliniere), test de fault-injection pe sidecars (supra-acoperire fata de
conventia delete-all, nume nereutilizabile).

## Ce NU face acest plan (decizii)

- Nu adauga stergere individuala pentru backup-urile RNPM per user (zona self-service are doar delete-all; extindere separata daca se cere).
- Nu adauga cooldown pe "Creeaza backup acum" — discutie separata (v. sesiunea 2026-07-26).
- Nu schimba semantica delete-all si nici retention-ul backup-urilor zilnice.
