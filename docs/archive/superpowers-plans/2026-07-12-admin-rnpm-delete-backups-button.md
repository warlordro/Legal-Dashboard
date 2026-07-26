# Buton "Sterge backup-urile" per user in cardul Stocare RNPM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adminul poate sterge toate backup-urile RNPM ale unui user din cardul Setari > Backup > Stocare RNPM, pentru eliberare de spatiu (inclusiv pentru useri cu status Sters, care nu-si mai pot face self-service).

**Architecture:** Frontend-only. Backend-ul exista deja: `DELETE /api/rnpm/backups?ownerId=<id>` (admin cross-owner via `resolveBackupOwner`, audit `backup.rnpm.delete_all` cu ownerul afectat, sub maintenance write lock — verificat `backend/src/routes/rnpm.ts:1204-1234`). Se extinde clientul `rnpmDeleteBackups` cu `ownerId?` (acelasi pattern ca `rnpmCompactDb`) si se adauga butonul destructiv per rand in `RnpmStorage.tsx`, refolosind guard-urile existente (ref sincron anti double-click + `mountedRef` + staleness pe reload).

**Tech Stack:** React 18 + TypeScript, vitest + jsdom, biome.

## Global Constraints

- Romana fara diacritice in cod sursa. Copy UI in romana, fara jargon englez vizibil.
- Fix frontend-only: NU se atinge backend-ul (endpoint-ul exista si e testat in `rnpmBackups.contract.test.ts`).
- Callerul existent `RnpmSavedStats.tsx:157` apeleaza `rnpmDeleteBackups()` fara argument — semnatura noua trebuie sa fie backward-compatible (`ownerId?: string`).
- Gate inainte de commit: `npx biome check --write` pe fisierele atinse -> `cd frontend && npx tsc --noEmit` -> `npx vitest run src/pages/admin/RnpmStorage.test.tsx` + suita frontend.
- Fara push (doar cu confirmarea userului). Serverul dev-web-local NU se opreste.

---

### Task 1: `rnpmDeleteBackups(ownerId?)` + buton destructiv per rand

**Files:**
- Modify: `frontend/src/lib/rnpmApi.ts:373-377` (`rnpmDeleteBackups`)
- Modify: `frontend/src/pages/admin/RnpmStorage.tsx` (buton + handler + busy state pe actiune)
- Test: `frontend/src/pages/admin/RnpmStorage.test.tsx`

**Interfaces:**
- Consumes: `rnpmDeleteBackups(ownerId?: string): Promise<number>` (numarul de fisiere sterse), `useConfirm()` cu `destructive: true` (focus initial pe Anuleaza — EXT-H-03), `adminListRnpmUsage` pentru reload.
- Produces: nimic nou pentru alte module.

- [ ] **Step 1: Testele care pica (3 teste noi in `RnpmStorage.test.tsx`)**

Mock-ul `rnpmApi` primeste si `rnpmDeleteBackups: vi.fn()` (langa `rnpmCompactDb`), cu `const deleteBackupsMock = vi.mocked(rnpmDeleteBackups);` si reset in `beforeEach`.

```tsx
it("butonul Sterge backup-urile cere confirmare destructiva si apeleaza rnpmDeleteBackups cu ownerId-ul randului", async () => {
  usageMock.mockResolvedValue([
    {
      userId: "u1",
      email: "a@x.ro",
      displayName: "A",
      status: "active",
      dbSizeBytes: 4096,
      backupCount: 2,
      backupsBytes: 2048,
    },
  ]);
  deleteBackupsMock.mockResolvedValue(2);

  await render(
    <ConfirmProvider>
      <AdminRnpmStorage embedded />
    </ConfirmProvider>
  );

  await act(async () => {
    clickButton(/Sterge backup-urile/);
    await Promise.resolve();
  });

  // Dialog destructiv: focusul initial sta pe Anuleaza (EXT-H-03).
  expect(document.activeElement?.textContent).toMatch(/Anuleaz/);

  await act(async () => {
    dialogButton(/^Sterge$/).click();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(deleteBackupsMock).toHaveBeenCalledWith("u1");
  expect(usageMock).toHaveBeenCalledTimes(2); // mount + reload post-delete
  expect(host.textContent).toContain("Backup-uri sterse: 2");
});

it("butonul Sterge backup-urile e dezactivat cand userul nu are backup-uri", async () => {
  usageMock.mockResolvedValue([
    {
      userId: "u1",
      email: "a@x.ro",
      displayName: "A",
      status: "active",
      dbSizeBytes: 4096,
      backupCount: 0,
      backupsBytes: 0,
    },
  ]);

  await render(
    <ConfirmProvider>
      <AdminRnpmStorage embedded />
    </ConfirmProvider>
  );

  const btn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    /Sterge backup-urile/.test(b.textContent ?? "")
  );
  expect(btn).toBeTruthy();
  expect(btn?.disabled).toBe(true);
});

it("409 la stergerea backup-urilor se afiseaza ca mesaj prietenos", async () => {
  usageMock.mockResolvedValue([
    {
      userId: "u1",
      email: "a@x.ro",
      displayName: "A",
      status: "active",
      dbSizeBytes: 4096,
      backupCount: 1,
      backupsBytes: 1024,
    },
  ]);
  deleteBackupsMock.mockRejectedValue(new ApiError("Restore in curs", 409, "RESTORE_IN_PROGRESS"));

  await render(
    <ConfirmProvider>
      <AdminRnpmStorage embedded />
    </ConfirmProvider>
  );

  await act(async () => {
    clickButton(/Sterge backup-urile/);
    await Promise.resolve();
  });
  await act(async () => {
    dialogButton(/^Sterge$/).click();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(host.textContent).toContain("operatie RNPM in curs");
});
```

- [ ] **Step 2: Ruleaza si confirma RED**

Run: `cd frontend && npx vitest run src/pages/admin/RnpmStorage.test.tsx`
Expected: cele 3 teste noi FAIL (butonul nu exista); cele 6 vechi raman verzi.

- [ ] **Step 3: Implementarea**

3a. `frontend/src/lib/rnpmApi.ts` — extinde semnatura (pattern `rnpmCompactDb`):

```ts
export async function rnpmDeleteBackups(ownerId?: string): Promise<number> {
  const qs = ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : "";
  const res = await apiFetch(`${BASE}/backups${qs}`, { method: "DELETE" });
  const data = await jsonOrThrow<{ deleted: number }>(res);
  return data.deleted;
}
```

3b. `frontend/src/pages/admin/RnpmStorage.tsx`:
- Import `Trash2` din lucide-react si `rnpmDeleteBackups` din `@/lib/rnpmApi`.
- `busyOwnerId: string | null` devine `busy: { ownerId: string; action: "compact" | "delete" } | null` (spinnerul apare pe butonul corect; toate butoanele se dezactiveaza cand `busy !== null` — acelasi comportament ca azi).
- `compactInFlightRef` se redenumeste `actionInFlightRef` (guard-ul sincron acopera ambele dialoguri — un singur confirm() deschis o data).
- Handler nou, simetric cu `handleCompact`:

```tsx
const handleDeleteBackups = async (row: AdminRnpmUsageRow) => {
  if (actionInFlightRef.current) return;
  actionInFlightRef.current = true;
  try {
    const ok = await confirm({
      title: "Sterge backup-urile RNPM",
      message: `Stergi toate backup-urile RNPM ale userului ${row.email} (${row.backupCount}, ${formatBytes(row.backupsBytes)})? Operatia nu poate fi anulata.`,
      confirmLabel: "Sterge",
      destructive: true,
    });
    if (!ok || !mountedRef.current) return;
    setBusy({ ownerId: row.userId, action: "delete" });
    setError(null);
    setSuccessMsg(null);
    try {
      const deleted = await rnpmDeleteBackups(row.userId);
      if (!mountedRef.current) return;
      setSuccessMsg(`Backup-uri sterse: ${deleted}.`);
      await load();
    } catch (e) {
      if (!mountedRef.current) return;
      if (e instanceof ApiError && e.status === 409) {
        setError("Userul are o operatie RNPM in curs (cautare sau restaurare); reincearca dupa finalizare.");
      } else {
        setError(e instanceof Error ? e.message : "Eroare la stergerea backup-urilor RNPM.");
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  } finally {
    actionInFlightRef.current = false;
  }
};
```

- Butonul, in celula de actiuni langa Compacteaza (stilul rosu al butonului delete-all din `Backups.tsx:136`):

```tsx
<Button
  type="button"
  variant="outline"
  size="sm"
  disabled={row.backupCount === 0 || busy !== null}
  onClick={() => void handleDeleteBackups(row)}
  className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 disabled:opacity-50"
>
  {busy?.ownerId === row.userId && busy.action === "delete" ? (
    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Trash2 className="h-3.5 w-3.5" />
  )}
  Sterge backup-urile
</Button>
```

- Spinnerul de pe Compacteaza devine conditionat pe `busy?.ownerId === row.userId && busy.action === "compact"`; `disabled` pe Compacteaza si Reincarca trece pe `busy !== null`.
- Copy-ul descriptiv al cardului se completeaza cu stergerea: "... Stergerea backup-urilor elibereaza spatiul din jail-ul de backup al userului."

- [ ] **Step 4: Ruleaza si confirma GREEN**

Run: `cd frontend && npx vitest run src/pages/admin/RnpmStorage.test.tsx src/components/rnpm/RnpmSavedStats.test.tsx`
Expected: PASS toate (9 in RnpmStorage; RnpmSavedStats neafectat — apel fara argument).

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write frontend/src/lib/rnpmApi.ts frontend/src/pages/admin/RnpmStorage.tsx frontend/src/pages/admin/RnpmStorage.test.tsx
cd frontend && npx tsc --noEmit && npx vitest run
```

Expected: biome curat, tsc ok, suita frontend verde.

```bash
git add frontend/src/lib/rnpmApi.ts frontend/src/pages/admin/RnpmStorage.tsx frontend/src/pages/admin/RnpmStorage.test.tsx docs/superpowers/plans/2026-07-12-admin-rnpm-delete-backups-button.md
git commit -m "feat(admin): buton Sterge backup-urile per user in cardul Stocare RNPM — endpoint-ul cross-owner existent (audit backup.rnpm.delete_all), confirmare destructiva cu count+dimensiune, guard sincron partajat cu Compacteaza"
```

---

## Decizii (context pentru reviewer)

1. **Granularitate delete-all per user, nu per fisier** — decizia userului (optiunea B): pentru eliberare de spatiu e suficient; jail-ul e oricum plafonat de pool-urile de retentie. Delete individual pe monolit (optiunea A) = backlog.
2. **Zero backend** — endpoint-ul exista, e auditat si acoperit de contract-teste; `requireDesktopHeader` e pass-through in web mode (aceeasi cale ca Compacteaza, validata in smoke-ul E2E al feature-ului admin-rnpm-storage).
3. **Butonul e activ si pentru useri fara baza vie** (`dbSizeBytes === null`) daca au backup-uri — exact cazul userului sters cu jail ramas pe disc. Conditia de disable e `backupCount === 0`, nu `dbSizeBytes === null` (diferit de Compacteaza).
