# Fixuri audit consolidat v2.43.0 — core functional (A, B, C, E + G quick-wins) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Rev. 2 (2026-07-11):** planul a trecut printr-un review adversarial Codex pe codul real (raport complet: `docs/superpowers/plans/2026-07-11-fixes-audit-v2.43-core.review-codex.md`). Verdictul initial: Task 7/9/12/15 INCORRECT (ar fi livrat comportament gresit), Task 8 HIGH, restul ajustari de teste. TOATE corectiile sunt integrate mai jos — aceasta revizie e forma de executat.

**Goal:** Inchide clusterele functionale P0 + P1 din `audit/AUDIT-CONSOLIDAT-v2.43.0-rnpm-split-2026-07-11.md` — data-safety (A), audit trail (B), contract API (C1), security hardening (E2–E6) plus quick-wins G — pe branch-ul `feat/v2.43.0-rnpm-split`, fara sa atinga deploy-ul Dokploy.

**Architecture:** Fixuri chirurgicale, un commit per task, toate pe branch (nimic pe main). Backend-ul sta in fisierele existente (`backup.ts`, `instanceLock.ts`, `rnpm.ts`, `adminBackups.ts`, `index.ts`, `rnpmDb.ts`); extractii noi: operatia atomica delete-all+compact (Task 7), helperul de handle direct RNPM (Task 7), helperul de retentie (Task 12). Frontend-ul se atinge doar functional. Testele urmeaza pattern-urile REALE per fisier: backend `rnpmBackups.contract.test.ts` / `rnpm.contract.test.ts` / `adminBackups.test.ts` / `backup.test.ts` / `rnpmBackup.test.ts` / `instanceLock.test.ts` / `index.test.ts`; frontend `createRoot` + `act` (NU exista @testing-library in repo — vezi `Backups.test.tsx`).

**Tech Stack:** Node 22 + Hono ^4 + better-sqlite3 (backend CJS bundle), React 18 + Vite (frontend), Vitest, Biome.

## Global Constraints

- **Branch: `feat/v2.43.0-rnpm-split`** — TOT lucrul aici. **NIMIC pe main** (main e urmarit de Dokploy → push pe main = deploy pe productie). Push pe remote DOAR la final, cu confirmarea userului.
- **Zero lucru pe infra**: nu se ating Dockerfile, workflows, config Dokploy/Cloudflare.
- **Commit per task** dupa gate-ul taskului: `npx biome check --write <fisiere>` → `npx tsc --noEmit -p backend/tsconfig.json` (+ `cd frontend && npx tsc --noEmit` la fisiere frontend) → testele fisierelor atinse. Fara push.
- **FARA bump de versiune** — bump + CHANGELOG la release, separat.
- Envelope `{ data, error: { code, message }, requestId }` DOAR pe `adminBackups.ts` (suprafata noua); rutele rnpm raman legacy non-envelope (conventie documentata in envelope.ts).
- Repository-only DB access: SQL raw DOAR in `backend/src/db/**`.
- Romana fara diacritice in cod sursa si mesaje.
- Schimbari chirurgicale — nu "imbunatati" cod adiacent.
- Numerele de linie sunt de la HEAD `a9630b9` — ancoreaza pe snippet-uri, nu pe numere.
- Frontend NU are @testing-library — testele folosesc `createRoot` + `act` + evenimente native (pattern `Backups.test.tsx`).

## Decizii luate (asumptii explicite)

1. **Cluster D (accesibilitate) EXCLUS integral** — decizia userului. EXCEPTIE: **A4/EXT-H-03 RAMANE** (bug functional de siguranta la tastatura, nu screen-reader).
2. **Itemi desktop-only EXCLUSI**: E1, EXT-M-10, INT-M3, smoke Electron impachetat (derogare explicita user — vezi Task 16; smoke-ul Electron ramane OBLIGATORIU inainte de tag-ul de release v2.43.0, doar nu in acest batch).
3. **Dokploy safety prin deploy atomic same-origin**; C2 amanat (Faza 2); nota ops: Cloudflare NU trebuie sa cache-uiasca `index.html`.
4. **A1/EXT-H-01**: la shutdown cu writeri de mentenanta nesettled dupa plafon, instance lock-ul NU se elibereaza (recuperat ca stale la urmatorul boot dupa ~30s = HEARTBEAT_MS×STALE_FACTOR).
5. **Heartbeat (A1a)**: eroare tranzitorie = skip tick logat + contor; 3 esecuri consecutive (15s < prag stale 30s) sau mismatch citit cu succes = shutdown GRACEFUL. `gracefulShutdown` devine idempotent prin promise-join (apel repetat = acelasi promise), ca `.finally(exit)` din heartbeat sa astepte drain-ul real, nu sa-l taie.
6. **A6 forma atomica**: `deleteAllRnpmAndCompact(ownerId)` sub `withMaintenanceWrite` + `beginRnpmRestore`; delete pe handle direct CONFIGURAT (pragmas identice cu registry — vezi Task 7, corectie Codex HIGH: fara `foreign_keys=ON` cascadele NU ruleaza si raman randuri copil orfane).
7. **Mesaje generice pe 500** doar pe raspunsul HTTP; textul complet ramane in log server-side; 400/409/503 tipate isi pastreaza mesajele.
8. **Strategie de executie pe batch-uri (decizia userului, 2026-07-11)** — orchestrator si reviewer: modelul principal al sesiunii (Fable); taskurile mecanice la subagenti Sonnet 5, cu review pe diff-ul FIECARUI task; checkpoint + raport dupa fiecare batch:

   | Batch | Taskuri | Executant | Continut |
   |---|---|---|---|
   | 1 | 1–4 | Subagenti Sonnet 5 + review orchestrator per diff | Mecanice P0 |
   | 2 | 5–7 | Orchestratorul (Fable), direct | Delicate pe concurenta: heartbeat, shutdown/lock, delete-all atomic |
   | 3 | 8–15 | Subagenti Sonnet 5 + review orchestrator per diff | Mecanice P1 |
   | 4 | 16 | Orchestratorul | Gate final + smoke + review advers pe diff-ul integral; push DOAR cu confirmarea userului |

   Ordinea 1→2→3 e intentionata (5–7 refactorizeaza `backup.ts`/`rnpm.ts`; batch 3 lucreaza pe forma finala). Batch-urile si taskurile din interiorul unui batch ruleaza SECVENTIAL.

9. **Corectiile review-ului Codex sunt normative.** Unde acest plan si raportul Codex diverg, castiga raportul (el e verificat pe cod la linii exacte). Referinte cheie din raport: helperi reali `beginRnpmSearch`/`endRnpmSearch` (`rnpmActivity.ts:23`); teste contract in `rnpmBackups.contract.test.ts:355,369` (SEARCH_ACTIVE), `:225` (cross-owner detail), `:291` (stats path); `rnpm.contract.test.ts:330` (stats path); `adminBackups.test.ts:72` (shape-uri flat); `MonitoringApiError`/`unwrapMonitoring` (`frontend/src/lib/api.ts:480,496`); pragmas RNPM (`rnpmDb.ts:118-123`); FK CASCADE in `migrations-rnpm/0001_rnpm_baseline.up.sql:70,97,126,152`; `latestBackupMtime` NEprins de catch (`backup.ts:1282`); validarea restore inainte de staging (`backup.ts:861,935`); mock copyFile pattern (`rnpmBackup.test.ts:662`); `intervals.test.ts` = date utils, NU timere server.

10. **Starea verificata in cod (2026-07-11, HEAD a9630b9)**: heartbeat fara try/catch (`instanceLock.ts:264-281`); `readLock` intoarce null si pe eroare I/O (`instanceLock.ts:65`); `waitForBackupToSettle` void (`backup.ts:1255`); release neconditionat (`index.ts:982`); enumerare rnpm muta (`backup.ts:1317`); `recordAudit` care arunca pe delete-uri (`rnpm.ts:884,907`); Enter global (`confirm-dialog.tsx:47-55`); confirm restore fara title (`Backups.tsx:65`); `db.path` in `/stats` (`rnpm.ts:926,938`); logger Hono cu query (`index.ts:95`); SMTP brut (`mailer.ts:186,212,232`); purge doar in scheduler (`scheduler.ts:386-439`); blocul de timere standalone e WEB-ONLY (`index.ts:745-809`).

---

### Task 1: A2 — daily backup: erorile de enumerare RNPM devin vizibile (fail-explicit)

**Files:**
- Modify: `backend/src/db/backup.ts` (`runDailyBackupImpl`, liniile 1309-1329)
- Test: `backend/src/db/backup.test.ts`

**Interfaces:**
- Consumes: `logBackupEvent` (privat), `getRnpmDataDir` din `./rnpmDb.ts`.
- Produces: eveniment `{"action":"daily_backup_failed","target":"rnpm:*","stage":"enumerate_rnpm","errnoCode":...}` pe stdout.

Verdict Codex: **CORRECT** — se executa ca in Rev. 1.

- [ ] **Step 1: Test failing in `backup.test.ts`** (foloseste scheletul de tmp dataDir existent in fisier; `getRnpmDataDir()` devine FISIER → readdir ENOTDIR):

```ts
describe("daily backup — enumerarea rnpm fail-explicit (EXT-H-02)", () => {
  it("eroare non-ENOENT la readdir(rnpm/) emite daily_backup_failed stage=enumerate_rnpm si NU opreste backup-ul monolitului", async () => {
    const rnpmPath = getRnpmDataDir();
    await fsPromises.rm(rnpmPath, { recursive: true, force: true });
    await fsPromises.writeFile(rnpmPath, "not a directory");
    const logSpy = vi.spyOn(console, "log");
    await runDailyBackup();
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const failLine = lines.find((l) => l.includes('"stage":"enumerate_rnpm"'));
    expect(failLine).toBeDefined();
    expect(failLine).toContain('"action":"daily_backup_failed"');
    expect(failLine).toContain('"errnoCode":"ENOTDIR"');
    expect(lines.some((l) => l.includes('"action":"daily_backup"') && l.includes('"target":"main"'))).toBe(true);
    logSpy.mockRestore();
  });

  it("ENOENT pe directorul rnpm ramane silentios (pre-split, fara useri)", async () => {
    await fsPromises.rm(getRnpmDataDir(), { recursive: true, force: true });
    const logSpy = vi.spyOn(console, "log");
    await runDailyBackup();
    expect(logSpy.mock.calls.map((c) => String(c[0])).some((l) => l.includes("enumerate_rnpm"))).toBe(false);
    logSpy.mockRestore();
  });
});
```

(Verifica valoarea exacta a `target`-ului pentru monolit in `mainTarget()` si ajusteaza asertia daca e alta decat `"main"`.)

- [ ] **Step 2: Run — FAIL**: `cd backend && npx vitest run src/db/backup.test.ts -t "enumerarea rnpm"`

- [ ] **Step 3: Implementeaza** — inlocuieste catch-ul mut din `runDailyBackupImpl`:

```ts
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    // ENOENT = pre-split / fara useri — benign. ORICE altceva (EACCES, EIO,
    // ENOTDIR, ACL/storage) inseamna ca recovery set-ul NU contine bazele
    // RNPM per user si run-ul NU are voie sa para reusit silentios.
    if (code !== "ENOENT") {
      logBackupEvent({
        action: "daily_backup_failed",
        target: "rnpm:*",
        stage: "enumerate_rnpm",
        errnoCode: code ?? null,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
```

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/db/backup.test.ts`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/db/backup.ts backend/src/db/backup.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/db/backup.ts backend/src/db/backup.test.ts
git commit -m "fix(backup): daily backup nu mai inghite erorile de enumerare rnpm (EXT-H-02)"
```

---

### Task 2: A3 + B1c — recordAuditSafe pe delete-urile self-service + audit pe refuzuri

**Files:**
- Modify: `backend/src/routes/rnpm.ts` (rutele `DELETE /saved/all`, `POST /saved/delete-batch`, liniile 861-912)
- Test: `backend/src/routes/rnpmBackups.contract.test.ts` (corectie Codex: aici traiesc deja cazurile SEARCH_ACTIVE pentru delete-all/batch, la :355 si :369 — extinde-le, nu crea fisier nou)

**Interfaces:**
- Consumes: `recordAuditSafe` (deja importat, `rnpm.ts:28`); helperi de test REALI: `beginRnpmSearch`/`endRnpmSearch` din `db/rnpmActivity.ts:23` (NU exista beginRnpmSearchActivity).
- Produces: audit `aviz.delete_all`/`aviz.delete_batch` cu `outcome:"denied"` pe refuz; succesul comis nu mai poate da 500 din audit.

- [ ] **Step 1: Test failing** — in `rnpmBackups.contract.test.ts`, langa cazurile SEARCH_ACTIVE existente (:355, :369), adauga asertii de audit:

```ts
it("refuzul SEARCH_ACTIVE pe DELETE /saved/all scrie audit cu outcome=denied", async () => {
  beginRnpmSearch(OWNER);
  try {
    const res = await app.request("/saved/all", { method: "DELETE", headers: DESKTOP_HEADERS });
    expect(res.status).toBe(409);
    const events = getAuditEvents({ action: "aviz.delete_all" });
    expect(events[0]?.outcome).toBe("denied");
  } finally {
    endRnpmSearch(OWNER);
  }
});
```

(Refoloseste `OWNER`/`DESKTOP_HEADERS`/setup-ul din describe-ul existent al fisierului. Analog pentru delete-batch.)

- [ ] **Step 2: Run — FAIL**: `cd backend && npx vitest run src/routes/rnpmBackups.contract.test.ts -t "denied"`

- [ ] **Step 3: Implementeaza** — in ambele rute: audit denied inainte de return-ul 409 si `recordAudit` → `recordAuditSafe` pe calea de succes:

```ts
  if (hasActiveRnpmSearch(ownerId)) {
    recordAudit(c, "aviz.delete_all", {
      outcome: "denied",
      targetKind: "aviz",
      detail: { reason: "search_active" },
    });
    return c.json(
      fail("SEARCH_ACTIVE", "Exista o cautare RNPM in curs pentru acest cont; reincearca dupa finalizare", c),
      409
    );
  }
```

si post-mutatie:

```ts
  // Mutatia e COMISA — un esec al scrierii de audit nu are voie sa intoarca
  // 500 (clientul ar repeta un delete deja terminat). Contract Rev. 4.
  recordAuditSafe(c, "aviz.delete_all", { targetKind: "aviz", detail: { deleted: count, compacted } });
```

(Identic `aviz.delete_batch` cu `detail: { requested: numIds.length, deleted }`.)

NOTA pentru Task 7: guard-ul explicit `hasActiveRnpmSearch` din `/saved/all` va fi INLOCUIT acolo de eroarea tipata din DB layer — pastreaza testele de audit valide (asertiile raman: 409 + outcome denied), doar sursa refuzului se schimba.

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/routes/rnpmBackups.contract.test.ts`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/routes/rnpm.ts backend/src/routes/rnpmBackups.contract.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/routes
git commit -m "fix(rnpm): recordAuditSafe pe delete-urile comise + audit denied pe refuzuri SEARCH_ACTIVE (INT-H3, B1)"
```

---

### Task 3: A4 — dialogul de confirmare nu mai confirma pe Enter global

**Files:**
- Modify: `frontend/src/components/ui/confirm-dialog.tsx`
- Create: `frontend/src/components/ui/confirm-dialog.test.tsx`

**Interfaces:**
- Consumes: `Button` suporta ref (forwardRef, `button.tsx:9`).
- Produces: acelasi API `useConfirm()`; Enter activeaza DOAR butonul focalizat; pe `destructive: true` focus initial pe "Anuleaza"; pe non-destructive focusul RAMANE pe confirmare (regresie de verificat).

Corectie Codex: repo-ul NU are @testing-library — testele se scriu cu `createRoot` + `act` + evenimente native, pe modelul `Backups.test.tsx:27`.

- [ ] **Step 1: Teste failing** (adapteaza scheletul de mount/unmount din `Backups.test.tsx` — container + `createRoot` + `act`):

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfirmProvider, useConfirm } from "./confirm-dialog";

let container: HTMLDivElement;
let root: Root;
let lastResult: boolean | null;

function Harness({ destructive }: { destructive: boolean }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      data-testid="open"
      onClick={() => void confirm({ message: "Stergi tot?", destructive }).then((v) => (lastResult = v))}
    >
      deschide
    </button>
  );
}

function mount(destructive: boolean) {
  act(() => {
    root.render(
      <ConfirmProvider>
        <Harness destructive={destructive} />
      </ConfirmProvider>
    );
  });
  act(() => {
    container.querySelector<HTMLButtonElement>('[data-testid="open"]')?.click();
  });
}

const btnByText = (text: string): HTMLButtonElement => {
  const btn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`buton "${text}" negasit`);
  return btn;
};

const pressKey = (key: string) => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  lastResult = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("confirm-dialog — siguranta la tastatura (EXT-H-03)", () => {
  it("Enter cu focus pe Anuleaza rezolva FALSE (activarea vine de la buton, nu global)", async () => {
    mount(true);
    const cancel = btnByText("Anuleaza");
    act(() => cancel.focus());
    // Activarea nativa buton-pe-Enter nu exista in jsdom — simulam click-ul
    // pe care browserul l-ar emite; important e ca handlerul GLOBAL sa nu
    // mai confirme inainte (inainte de fix, pressKey singur rezolva true).
    pressKey("Enter");
    expect(lastResult).not.toBe(true); // handlerul global nu a confirmat
    act(() => cancel.click());
    await act(async () => {});
    expect(lastResult).toBe(false);
  });

  it("pe destructive, focusul initial e pe Anuleaza", () => {
    mount(true);
    expect(document.activeElement).toBe(btnByText("Anuleaza"));
  });

  it("pe non-destructive, focusul initial ramane pe confirmare (fara regresie)", () => {
    mount(false);
    expect(document.activeElement).toBe(btnByText("Continua"));
  });

  it("Escape anuleaza (rezolva false)", async () => {
    mount(true);
    pressKey("Escape");
    await act(async () => {});
    expect(lastResult).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL**: `cd frontend && npx vitest run src/components/ui/confirm-dialog.test.tsx` (primul test: handlerul global confirma `true` azi).

- [ ] **Step 3: Implementeaza** in `confirm-dialog.tsx` — ref pentru Cancel, focus conditionat, FARA ramura Enter in handlerul global:

```tsx
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
```

```tsx
  useEffect(() => {
    if (!state) return;
    // EXT-H-03: pe actiuni distructive focusul initial sta pe Anuleaza —
    // Enter apasat din inertie nu are voie sa execute stergerea/restaurarea.
    (state.destructive ? cancelBtnRef : confirmBtnRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
      // FARA ramura globala pe Enter (EXT-H-03): activarea vine nativ de la
      // butonul focalizat; un Enter oriunde altundeva nu confirma nimic.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);
```

```tsx
  <Button ref={cancelBtnRef} variant="outline" size="sm" onClick={() => close(false)}>
    {state.cancelLabel ?? "Anuleaza"}
  </Button>
```

- [ ] **Step 4: Run — PASS**: `cd frontend && npx vitest run src/components/ui/confirm-dialog.test.tsx`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write frontend/src/components/ui/confirm-dialog.tsx frontend/src/components/ui/confirm-dialog.test.tsx
cd frontend && npx tsc --noEmit && cd ..
git add frontend/src/components/ui
git commit -m "fix(ui): Enter nu mai confirma global dialogul de confirmare; focus initial pe Anuleaza la destructive (EXT-H-03)"
```

---

### Task 4: A5 + INT-M12 — titlu corect la restore monolit + reload post-restore

**Files:**
- Modify: `frontend/src/pages/admin/Backups.tsx` (`handleRestore`, liniile 65-88)
- Test: `frontend/src/pages/admin/Backups.test.tsx` (harness-ul propriu existent, :27 si :81)

Corectii Codex: reload-ul se testeaza cu FAKE TIMERS (timerul real de 2s ar declansa navigare jsdom dupa unmount) si se verifica separat ca reload-ul se programeaza DOAR dupa succes, nu dupa cancel/eroare.

- [ ] **Step 1: Teste failing** in `Backups.test.tsx`, cu harness-ul existent:

```tsx
it("confirmarea de restore are titlul 'Restaureaza backup', nu fallback-ul de stergere", async () => {
  // ... deschide dialogul de restore cu harness-ul existent ...
  expect(container.textContent).toContain("Restaureaza backup");
  expect(container.textContent).not.toContain("Confirmare stergere");
});

it("reload-ul se programeaza DOAR dupa restore reusit (nu la cancel/eroare)", async () => {
  vi.useFakeTimers();
  const reloadSpy = vi.fn();
  // jsdom: window.location.reload nu e configurabil direct — foloseste pattern-ul
  // existent din suita frontend sau injecteaza prin Object.defineProperty pe un
  // obiect location mock-uit; daca suita are deja un helper, refoloseste-l.
  // Caz 1: cancel -> avanseaza 3s -> reloadSpy NEapelat.
  // Caz 2: restore cu mock resolved -> avanseaza 3s -> reloadSpy apelat o data.
  // Caz 3: restore cu mock rejected -> avanseaza 3s -> reloadSpy NEapelat.
  vi.useRealTimers();
});
```

(Scheletul concret al cazurilor 1-3 urmeaza pattern-ul mock-urilor `adminBackupsApi` deja prezente in fisier.)

- [ ] **Step 2: Run — FAIL**: `cd frontend && npx vitest run src/pages/admin/Backups.test.tsx`

- [ ] **Step 3: Implementeaza** in `handleRestore`:

```tsx
      !(await confirm({
        title: "Restaureaza backup",
        message:
          "Restaurezi backup-ul COMPLET al bazei — toate modulele, toti utilizatorii (datele RNPM au backup separat per utilizator)?\n\nBaza curenta va fi salvata automat inainte de suprascriere. Dupa restore este recomandata repornirea aplicatiei.",
        confirmLabel: "Restaureaza",
        destructive: true,
      }))
```

si pe calea de succes:

```tsx
      const { preRestoreName } = await adminRestoreBackup(entry.name);
      setSuccessMsg(`Restaurare completa. Snapshot pre-restore: ${preRestoreName}. Aplicatia se reincarca...`);
      // INT-M12: dupa restaurarea monolitului TOT state-ul clientului e stale
      // (useri, alerte, setari). Reload complet dupa un beat vizibil.
      setTimeout(() => window.location.reload(), 2000);
```

- [ ] **Step 4: Run — PASS**: `cd frontend && npx vitest run src/pages/admin/Backups.test.tsx`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write frontend/src/pages/admin/Backups.tsx frontend/src/pages/admin/Backups.test.tsx
cd frontend && npx tsc --noEmit && cd ..
git add frontend/src/pages/admin
git commit -m "fix(admin): titlu corect la confirmarea de restore monolit + reload post-restore doar la succes (INT-H11, INT-M12)"
```

---

### Task 5: A1a — heartbeat-ul lock-ului tolereaza erori tranzitorii si moare graceful

**Files:**
- Modify: `backend/src/db/instanceLock.ts` (heartbeat, liniile 264-281)
- Modify: `backend/src/index.ts` (`gracefulShutdown` devine idempotent prin promise-join)
- Test: `backend/src/db/instanceLock.test.ts`

**Interfaces:**
- Consumes: `globalThis.__legalDashboardShutdown` (`index.ts:994`).
- Produces: `__setHeartbeatFatalHandlerForTests(fn | null)`; evenimente `instance_lock.heartbeat_skip` (console.warn) si `instance_lock.ownership_lost` (console.error).

Corectii Codex integrate: (a) `readLock` intoarce null si pe eroare I/O (`instanceLock.ts:65`), deci ramura `latest === null` NU ajunge in catch — trebuie sa emita EA INSASI `heartbeat_skip`; (b) testele verifica evenimentul structurat, nu doar ca fatal nu s-a apelat; (c) fake timers cu cleanup `vi.useRealTimers()`; (d) `gracefulShutdown` are azi early-return pe `shuttingDown === true` (`index.ts:865`) → `.finally(exit)` din heartbeat ar taia drain-ul deja pornit; fix: promise-join.

- [ ] **Step 1: Teste failing in `instanceLock.test.ts`** (pattern-ul de acquire existent; `vi.useFakeTimers()` in beforeEach, `vi.useRealTimers()` in afterEach; `__setHeartbeatFatalHandlerForTests(null)` + release in afterEach):

```ts
describe("heartbeat resilient (INT-H1) + dual-holder (INT-H2)", () => {
  it("lock ilizibil tranzitoriu => skip tick cu instance_lock.heartbeat_skip logat, fara fatal; isi revine", () => {
    const fatal = vi.fn();
    __setHeartbeatFatalHandlerForTests(fatal);
    const warnSpy = vi.spyOn(console, "warn");
    acquireInstanceLock(dataDir);
    const lockFile = join(dataDir, ".instance.lock");
    const saved = readFileSync(lockFile, "utf8");
    writeFileSync(lockFile, "{corupt");
    vi.advanceTimersByTime(5_000);
    expect(fatal).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.map((c) => String(c[0])).some((l) => l.includes("instance_lock.heartbeat_skip"))).toBe(true);
    writeFileSync(lockFile, saved);
    vi.advanceTimersByTime(5_000);
    expect(fatal).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("lock ilizibil 3 tick-uri consecutive => fatal (fail-safe inainte de pragul de stale)", () => {
    const fatal = vi.fn();
    __setHeartbeatFatalHandlerForTests(fatal);
    acquireInstanceLock(dataDir);
    writeFileSync(join(dataDir, ".instance.lock"), "{corupt");
    vi.advanceTimersByTime(15_000);
    expect(fatal).toHaveBeenCalledTimes(1);
  });

  it("INT-H2: dupa reclaim de catre holder B, holderul A detecteaza mismatch la PRIMUL tick si NU rescrie lock-ul lui B", () => {
    const fatal = vi.fn();
    __setHeartbeatFatalHandlerForTests(fatal);
    acquireInstanceLock(dataDir);
    const lockFile = join(dataDir, ".instance.lock");
    const stolen = { ...JSON.parse(readFileSync(lockFile, "utf8")), pid: 99999, nonce: "b-nonce" };
    writeFileSync(lockFile, JSON.stringify(stolen));
    vi.advanceTimersByTime(5_000);
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(lockFile, "utf8")).nonce).toBe("b-nonce");
  });
});
```

- [ ] **Step 2: Run — FAIL**: `cd backend && npx vitest run src/db/instanceLock.test.ts -t "heartbeat"`

- [ ] **Step 3: Implementeaza**

(a) `instanceLock.ts` — hook + handler fatal + interval rescris:

```ts
const HEARTBEAT_MAX_MISSES = 3; // 3 x 5s = 15s < prag stale 30s (HEARTBEAT_MS x STALE_FACTOR)
let heartbeatFatalOverrideForTests: ((reason: string) => void) | null = null;
export function __setHeartbeatFatalHandlerForTests(fn: ((reason: string) => void) | null): void {
  heartbeatFatalOverrideForTests = fn;
}

function heartbeatFatal(reason: string): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  // Lock-ul NU mai e al nostru (sau nu-l mai putem mentine) — nu-l stergem.
  current = null;
  dataDirForRelease = null;
  if (heartbeatFatalOverrideForTests) {
    heartbeatFatalOverrideForTests(reason);
    return;
  }
  console.error(JSON.stringify({ action: "instance_lock.ownership_lost", reason, ts: new Date().toISOString() }));
  const shutdown = (globalThis as { __legalDashboardShutdown?: () => Promise<void> }).__legalDashboardShutdown;
  const exit = (): void => process.exit(1);
  if (shutdown) {
    // gracefulShutdown e idempotent prin promise-join (vezi index.ts) —
    // daca un shutdown e deja in curs, asteptam ACELASI drain, nu-l taiem.
    // Plafon 10s: procesul nu mai detine lock-ul; celalalt holder scrie deja.
    const cap = setTimeout(exit, 10_000);
    cap.unref?.();
    void shutdown().finally(exit);
  } else {
    exit();
  }
}
```

```ts
  let heartbeatMisses = 0;
  const logHeartbeatSkip = (reason: string): void => {
    console.warn(
      JSON.stringify({
        action: "instance_lock.heartbeat_skip",
        misses: heartbeatMisses,
        reason,
        ts: new Date().toISOString(),
      })
    );
  };
  heartbeat = setInterval(() => {
    if (!current) return;
    try {
      const latest = readLock(path);
      if (latest) {
        if (latest.pid !== current.pid || latest.hostname !== current.hostname || latest.nonce !== current.nonce) {
          // Continut citit CU SUCCES si apartine altcuiva: ownership pierdut
          // real (reclaim). Imediat — orice write SQLite ulterior = dual-writer.
          heartbeatFatal("lock detinut de alt proces (mismatch pid/hostname/nonce)");
          return;
        }
        heartbeatMisses = 0;
      } else {
        // readLock intoarce null si pe I/O error si pe JSON corupt (nu doar
        // pe absenta) — posibil tranzitoriu (AV/EBUSY, fereastra unui reclaim).
        // Skip tick LOGAT (corectie Codex: ramura asta nu trece prin catch).
        heartbeatMisses++;
        logHeartbeatSkip("lock absent sau ilizibil la citire");
        if (heartbeatMisses >= HEARTBEAT_MAX_MISSES) {
          heartbeatFatal(`lock ilizibil ${heartbeatMisses} tick-uri consecutive`);
        }
        return;
      }
      current.heartbeatAt = Date.now();
      const tempPath = `${path}.heartbeat-${current.pid}-${Date.now()}`;
      writeFileSync(tempPath, JSON.stringify(current));
      renameSync(tempPath, path);
    } catch (e) {
      heartbeatMisses++;
      logHeartbeatSkip(e instanceof Error ? e.message : String(e));
      if (heartbeatMisses >= HEARTBEAT_MAX_MISSES) {
        heartbeatFatal(`heartbeat esuat ${heartbeatMisses} tick-uri consecutive`);
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
```

(b) `index.ts` — `gracefulShutdown` idempotent prin promise-join (inlocuieste early-return-ul pe `shuttingDown`):

```ts
let shutdownPromise: Promise<void> | null = null;
function gracefulShutdown(signal: string): Promise<void> {
  // Idempotent prin JOIN, nu early-return: al doilea apelant (ex. heartbeat
  // fatal peste un SIGTERM in curs) asteapta ACELASI drain complet in loc sa
  // primeasca un promise rezolvat instant si sa faca exit peste drain.
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = gracefulShutdownImpl(signal);
  return shutdownPromise;
}
```

(redenumeste functia existenta in `gracefulShutdownImpl` si pastreaza-i corpul; verifica ca flag-ul intern `shuttingDown` folosit de alte cai ramane setat ca inainte).

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/db/instanceLock.test.ts src/db/instanceLock.gate.test.ts src/index.test.ts`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/db/instanceLock.ts backend/src/db/instanceLock.test.ts backend/src/index.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/db/instanceLock.ts backend/src/db/instanceLock.test.ts backend/src/index.ts
git commit -m "fix(lock): heartbeat tolerant cu skip-uri logate + shutdown graceful idempotent la ownership pierdut (INT-H1, INT-H2)"
```

---

### Task 6: A1b / EXT-H-01 — shutdown-ul nu elibereaza lock-ul cat exista writeri; recheck dupa acquire

**Files:**
- Modify: `backend/src/db/backup.ts` (`withMaintenanceWrite`:73-91, `waitForBackupToSettle`:1255-1265)
- Modify: `backend/src/index.ts` (`gracefulShutdownImpl`, blocul 958-982)
- Test: `backend/src/db/backup.test.ts` + `backend/src/index.test.ts`

**Interfaces:**
- Produces: `waitForBackupToSettle(timeoutMs): Promise<boolean>`; plafonul de settle la shutdown devine configurabil prin env `LEGAL_DASHBOARD_SETTLE_TIMEOUT_MS` (default 30000) — necesar testului de lock-retention.

Corectii Codex integrate: (a) testul cu writer in coada trebuie sa astepte un setImmediate dupa pornirea primului writer (`RWLock.withWrite` face `await acquireWrite()` INAINTE sa invoce callback-ul — `rwLock.ts:34` — altfel `releaseFirst` ramane no-op si testul blocheaza); (b) test REAL pe decizia din index.ts (timeout false ⇒ lock-ul NU se elibereaza); (c) timerul pierzator din race se curata.

- [ ] **Step 1: Teste failing in `backup.test.ts`**:

```ts
describe("shutdown vs maintenance writers (EXT-H-01)", () => {
  it("writer aflat in coada la markMaintenanceShuttingDown e refuzat cu MaintenanceShutdownError (recheck dupa acquire)", async () => {
    let releaseFirst: () => void = () => {};
    const first = withMaintenanceWrite(
      () => new Promise<void>((r) => (releaseFirst = r))
    );
    // Corectie Codex: withWrite face await acquireWrite() inainte de callback —
    // asteapta un tick ca primul writer sa detina efectiv lock-ul si
    // releaseFirst sa fie legat, altfel testul blocheaza pe no-op.
    await new Promise((r) => setImmediate(r));
    const queued = withMaintenanceWrite(async () => "a-rulat");
    markMaintenanceShuttingDown();
    releaseFirst();
    await expect(queued).rejects.toBeInstanceOf(MaintenanceShutdownError);
    await first;
  });

  it("waitForBackupToSettle: false la timeout cu writer blocat, true dupa settle", async () => {
    let release: () => void = () => {};
    const hung = withMaintenanceWrite(() => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setImmediate(r));
    await expect(waitForBackupToSettle(50)).resolves.toBe(false);
    release();
    await hung;
    await expect(waitForBackupToSettle(50)).resolves.toBe(true);
  });
});
```

si in `index.test.ts` (pattern `importFreshIndex` + `__legalDashboardShutdown`):

```ts
it("lock-ul de instanta NU se elibereaza cand un maintenance writer nu face settle in plafon", async () => {
  const port = randomPort();
  const dbPath = await makeTmpDb();
  await importFreshIndex({
    LEGAL_DASHBOARD_PORT: String(port),
    LEGAL_DASHBOARD_DB_PATH: dbPath,
    LEGAL_DASHBOARD_SETTLE_TIMEOUT_MS: "100",
  });
  await waitForHealth(port);
  const { withMaintenanceWrite } = await import("./db/backup.ts");
  let release: () => void = () => {};
  void withMaintenanceWrite(() => new Promise<void>((r) => (release = r)));
  await new Promise((r) => setImmediate(r));
  const shutdown = (globalThis as { __legalDashboardShutdown?: () => Promise<void> }).__legalDashboardShutdown;
  await shutdown?.();
  const lockPath = join(dirname(dbPath), ".instance.lock");
  expect(existsSync(lockPath)).toBe(true); // lock retinut intentionat
  release();
});
```

- [ ] **Step 2: Run — FAIL**: `cd backend && npx vitest run src/db/backup.test.ts -t "shutdown vs maintenance"`

- [ ] **Step 3: Implementeaza**

`withMaintenanceWrite` — recheck dupa acquire:

```ts
export function withMaintenanceWrite<T>(fn: () => Promise<T>): Promise<T> {
  // Verificat INAINTE de coada (writer preference) SI din nou DUPA acquire
  // (EXT-H-01): un writer care astepta cand s-a ridicat flag-ul nu are voie
  // sa inceapa o mutatie pe care shutdown-ul n-o va mai astepta.
  if (maintenanceShuttingDown) return Promise.reject(new MaintenanceShutdownError());
  const p = maintenanceLock.withWrite(async () => {
    if (maintenanceShuttingDown) throw new MaintenanceShutdownError();
    return fn();
  });
  maintenanceWritesInFlight.add(p);
  void p
    .finally(() => {
      maintenanceWritesInFlight.delete(p);
    })
    .catch(() => {
      /* esecul e propagat callerului prin `p` */
    });
  return p;
}
```

`waitForBackupToSettle` — boolean + timer curatat:

```ts
export async function waitForBackupToSettle(timeoutMs = 10_000): Promise<boolean> {
  const pending = [...maintenanceWritesInFlight];
  if (pending.length === 0) return true;
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise<boolean>((r) => {
        timer = setTimeout(() => r(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

`index.ts` — plafon din env + retentie lock:

```ts
  const settleTimeoutMs = Number(process.env.LEGAL_DASHBOARD_SETTLE_TIMEOUT_MS) || 30_000;
  let maintenanceSettled = true;
  try {
    markMaintenanceShuttingDown();
    maintenanceSettled = await waitForBackupToSettle(settleTimeoutMs);
    if (!maintenanceSettled) {
      console.error(
        JSON.stringify({
          action: "shutdown.maintenance_unsettled",
          detail: "writer de mentenanta inca in zbor dupa plafon",
          timeoutMs: settleTimeoutMs,
          ts: new Date().toISOString(),
        })
      );
    }
  } catch (e) {
    maintenanceSettled = false;
    console.error("[shutdown] waitForBackupToSettle failed:", e);
  }
```

si release-ul conditionat (inlocuieste `releaseInstanceLock();` de la final):

```ts
  // EXT-H-01: lock-ul se elibereaza DOAR daca writerii au settled. Altfel
  // ramane pe disc (fail-safe): instanta noua il vede stale dupa ~30s si il
  // recupereaza prin gate — nu porneste curat PESTE un swap in zbor.
  if (maintenanceSettled) {
    releaseInstanceLock();
  } else {
    console.error(
      JSON.stringify({
        action: "shutdown.lock_retained",
        detail: "instance lock pastrat intentionat; recuperat ca stale la urmatorul boot",
        ts: new Date().toISOString(),
      })
    );
  }
```

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/db/backup.test.ts src/index.test.ts`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/db/backup.ts backend/src/index.ts backend/src/db/backup.test.ts backend/src/index.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/db/backup.ts backend/src/index.ts backend/src/db/backup.test.ts backend/src/index.test.ts
git commit -m "fix(shutdown): recheck shutdown dupa acquire + lock retinut cand writerii nu au settled (EXT-H-01)"
```

---

### Task 7: A6 / EXT-M-01 — delete-all + compact atomic (corectat: handle direct CONFIGURAT)

**Files:**
- Modify: `backend/src/db/rnpmDb.ts` (extrage helper de handle direct cu pragmas — corectie Codex HIGH)
- Modify: `backend/src/db/avizRepository.ts` (extrage `deleteAllAvizeOnHandle` cu validare owner)
- Modify: `backend/src/db/backup.ts` (extrage `compactRnpmUnderLatch`; adauga `deleteAllRnpmAndCompact`)
- Modify: `backend/src/routes/rnpm.ts` (`DELETE /saved/all`)
- Test: `backend/src/db/rnpmBackup.test.ts`

**Interfaces:**
- Produces: `openRnpmDbHandleDirect(dbPath: string)` (rnpmDb.ts) — handle cu ACELEASI pragmas ca registry-ul; `deleteAllAvizeOnHandle(db, ownerId): number` (avizRepository, cu `assertOwnerIdForMutation` inauntru); `deleteAllRnpmAndCompact(ownerId): Promise<{ deleted: number; compacted: boolean }>` (backup.ts).

**Corectii Codex HIGH integrate:** (1) `new Database(dbPath)` gol NU are `foreign_keys=ON` → DELETE pe `rnpm_avize` NU executa cascadele si lasa `rnpm_creditori`/`rnpm_debitori`/`rnpm_bunuri`/`rnpm_istoric` orfane (FK-urile cu `ON DELETE CASCADE` sunt in `0001_rnpm_baseline.up.sql:70,97,126,152`); pragmas-urile registry-ului sunt la `rnpmDb.ts:118-123`. (2) `fsPromises.access` cu catch generic clasifica EACCES/EIO drept "absent" → succes fals `{deleted:0}`; doar ENOENT = absent.

- [ ] **Step 1: Teste failing in `rnpmBackup.test.ts`** (setup-ul existent de owner + seed; corectie Codex: seed cu COPII + verificare `foreign_key_check`):

```ts
describe("deleteAllRnpmAndCompact (EXT-M-01)", () => {
  it("cu cautare activa: refuza cu RnpmSearchActiveError si NU sterge nimic", async () => {
    seedAvizCuCopii(OWNER); // aviz + creditori + debitori + bunuri + istoric
    beginRnpmSearch(OWNER);
    try {
      await expect(deleteAllRnpmAndCompact(OWNER)).rejects.toBeInstanceOf(RnpmSearchActiveError);
      expect(getAvizStats(OWNER).total).toBeGreaterThan(0);
    } finally {
      endRnpmSearch(OWNER);
    }
  });

  it("sterge avizele SI toate tabelele copil (cascadele ruleaza pe handle-ul direct)", async () => {
    seedAvizCuCopii(OWNER);
    const res = await deleteAllRnpmAndCompact(OWNER);
    expect(res.deleted).toBeGreaterThan(0);
    expect(res.compacted).toBe(true);
    const db = openRnpmDbHandleDirect(getRnpmDbPath(OWNER));
    try {
      for (const t of ["rnpm_avize", "rnpm_searches", "rnpm_creditori", "rnpm_debitori", "rnpm_bunuri", "rnpm_istoric"]) {
        const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
        expect(n, t).toBe(0);
      }
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("izolare: delete-all pe owner A nu atinge datele lui owner B", async () => {
    seedAvizCuCopii(OWNER_A);
    seedAvizCuCopii(OWNER_B);
    await deleteAllRnpmAndCompact(OWNER_A);
    expect(getAvizStats(OWNER_B).total).toBeGreaterThan(0);
  });

  it("owner fara fisier: deleted=0, fara provisioning implicit", async () => {
    const res = await deleteAllRnpmAndCompact("owner-fara-fisier");
    expect(res.deleted).toBe(0);
    expect(fs.existsSync(getRnpmDbPath("owner-fara-fisier"))).toBe(false);
  });

  it("eroare FS non-ENOENT la verificarea fisierului se PROPAGA (nu succes fals)", async () => {
    // Fa getRnpmDbPath(OWNER) sa pointeze intr-un parinte care e FISIER, nu
    // director (stat => ENOTDIR), sau mock pe fsPromises.stat cu EACCES.
    await expect(deleteAllRnpmAndCompact(OWNER_CU_PATH_INACCESIBIL)).rejects.toMatchObject({ code: expect.stringMatching(/EACCES|ENOTDIR|EIO/) });
  });
});
```

(`seedAvizCuCopii` = helper nou in test, construit pe insert-urile de repository existente in fisier; daca suita are deja un seeder complet, refoloseste-l.)

- [ ] **Step 2: Run — FAIL**: `cd backend && npx vitest run src/db/rnpmBackup.test.ts -t "deleteAllRnpmAndCompact"`

- [ ] **Step 3: Implementeaza**

(a) `rnpmDb.ts` — extrage pragmas-urile din calea de open existenta (:118-123) intr-un helper REFOLOSIT de ambele cai (zero duplicare):

```ts
// v2.43.x (Task 7): pragmas-urile de conexiune intr-un singur loc — orice
// handle pe un fisier RNPM (registry SAU direct, sub latch de restore) are
// nevoie de ACELASI set; in special foreign_keys=ON, fara de care DELETE pe
// rnpm_avize nu executa cascadele si lasa tabelele copil orfane.
function applyRnpmConnectionPragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
}

export function openRnpmDbHandleDirect(dbPath: string): Database.Database {
  const db = new Database(dbPath, { fileMustExist: true });
  applyRnpmConnectionPragmas(db);
  return db;
}
```

(calea de open existenta de la :118-123 apeleaza acum `applyRnpmConnectionPragmas` — verifica sa nu ramana pragma duplicat).

(b) `avizRepository.ts`:

```ts
// v2.43.x (EXT-M-01): corpul delete-all, rulabil si pe un handle DIRECT
// (deschis de backup.ts sub latch, cand registry-ul e inchis). Owner-ul se
// valideaza AICI, nu doar in wrapper (handle-ul direct nu trece prin getRnpmDb).
export function deleteAllAvizeOnHandle(db: DatabaseType, ownerId: string): number {
  assertOwnerIdForMutation(ownerId, "deleteAllAvizeOnHandle");
  return db.transaction(() => {
    const res = db.prepare("DELETE FROM rnpm_avize WHERE owner_id = ?").run(ownerId);
    db.prepare("DELETE FROM rnpm_searches WHERE owner_id = ?").run(ownerId);
    if (res.changes > 0) cleanupOrphanDescrieri(db);
    return res.changes;
  })();
}

export function deleteAllAvize(ownerId: string): number {
  const db = getRnpmDb(ownerId);
  const changes = deleteAllAvizeOnHandle(db, ownerId);
  if (changes > 0) checkpointRnpmWal(ownerId);
  return changes;
}
```

(c) `backup.ts` — extrage corpul compactarii (liniile 1000-1043, NEmodificate) in `compactRnpmUnderLatch(ownerId, dbPath)` privat, refolosit de `compactRnpmDbViaWorker` (care pastreaza wrapperul withMaintenanceWrite + begin/end); apoi:

```ts
export async function deleteAllRnpmAndCompact(ownerId: string): Promise<{ deleted: number; compacted: boolean }> {
  const dbPath = getRnpmDbPath(ownerId);
  return withMaintenanceWrite(async () => {
    if (isRnpmRestoreInProgress(ownerId)) throw new RnpmRestoreInProgressError();
    beginRnpmRestore(ownerId); // refuza atomic SEARCH_ACTIVE + latch pe scrierile noi
    try {
      let exists = true;
      try {
        await fsPromises.stat(dbPath);
      } catch (e) {
        // Corectie Codex: DOAR ENOENT inseamna absent; EACCES/EIO/ENOTDIR se
        // propaga — altfel raportam succes fals {deleted:0} peste o problema FS.
        if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
        exists = false;
      }
      let deleted = 0;
      let compacted = true;
      if (exists) {
        closeRnpmDb(ownerId);
        const db = openRnpmDbHandleDirect(dbPath); // pragmas identice cu registry
        try {
          deleted = deleteAllAvizeOnHandle(db, ownerId);
          db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
        } finally {
          db.close();
        }
        try {
          await compactRnpmUnderLatch(ownerId, dbPath);
        } catch (e) {
          compacted = false; // delete-ul e comis; esecul compactarii ramane vizibil, nu fatal
          logBackupEvent({
            action: "rnpm_compact_failed",
            target: `rnpm:${ownerId}`,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return { deleted, compacted };
    } finally {
      endRnpmRestore(ownerId);
    }
  });
}
```

(d) `rnpm.ts` — ruta:

```ts
rnpmRouter.delete("/saved/all", requireDesktopHeader, requireRole("admin", "user"), async (c) => {
  const ownerId = getOwnerId(c);
  try {
    const { deleted, compacted } = await deleteAllRnpmAndCompact(ownerId);
    recordAuditSafe(c, "aviz.delete_all", { targetKind: "aviz", detail: { deleted, compacted } });
    return c.json({ deleted, compacted });
  } catch (e) {
    if (e instanceof RnpmSearchActiveError || e instanceof RnpmRestoreInProgressError) {
      recordAudit(c, "aviz.delete_all", {
        outcome: "denied",
        targetKind: "aviz",
        detail: { reason: e instanceof RnpmSearchActiveError ? "search_active" : "restore_in_progress" },
      });
    }
    rethrowTypedMaintenanceError(e);
    console.error("[rnpm] delete-all failed:", e);
    return internalError(c, "Eroare interna la stergere. Reincearca sau contacteaza administratorul.");
  }
});
```

Testele de audit din Task 2 raman valide (409 + denied), doar sursa refuzului e acum eroarea tipata. Curata importurile orfane (`hasActiveRnpmSearch` daca nu mai are consumatori in fisier; `compactRnpmDbViaWorker` RAMANE pentru `POST /compact`).

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/db/rnpmBackup.test.ts src/db/backup.test.ts src/routes/rnpmBackups.contract.test.ts src/db/rnpmFullFlow.test.ts src/db/rnpmDb.test.ts`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/db/rnpmDb.ts backend/src/db/avizRepository.ts backend/src/db/backup.ts backend/src/routes/rnpm.ts backend/src/db/rnpmBackup.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add -A backend/src
git commit -m "fix(rnpm): delete-all + compact atomic pe handle direct configurat (foreign_keys=ON) sub un singur write lock (EXT-M-01)"
```

---

### Task 8: B1 — integritatea trail-ului de audit (corectat: scope owner + audit split durabil)

**Files:**
- Modify: `backend/src/util/appErrorHandler.ts` (`isTypedMaintenanceError`)
- Modify: `backend/src/routes/rnpm.ts` (rutele backups + compact)
- Modify: `backend/src/routes/adminBackups.ts` (catch-uri)
- Modify: `backend/src/index.ts` (audit split idempotent la boot)
- Test: `backend/src/routes/rnpmBackups.contract.test.ts`

**Corectii Codex integrate:** (1) in DELETE `/backups`, `owner` e declarat IN try (`rnpm.ts:1121`) — folosit in catch nu compileaza; rezolva owner-ul INAINTE de try. (2) `recordAudit("rnpm.split")` one-shot dupa return se pierde definitiv daca scrierea esueaza dupa markerul `done` (`rnpmSplitter.ts:585-598` scrie markerul inainte de return; boot-urile urmatoare intorc `split:false`) — fix: backfill idempotent la FIECARE boot. (3) Testul cross-owner trebuie sa asserteze coloana `owner_id`, nu doar detail JSON (testul existent la `rnpmBackups.contract.test.ts:225` verifica doar detail).

- [ ] **Step 1: Teste failing** in `rnpmBackups.contract.test.ts` (extinde testul cross-owner existent de la :225):

```ts
it("restore cross-owner de admin scrie audit cu owner_id = ownerul AFECTAT (coloana indexata, nu doar detail)", async () => {
  // ... setup-ul cross-owner existent ...
  const events = getAuditEvents({ action: "backup.rnpm.restore" });
  expect(events[0]?.owner_id).toBe(OWNER_B); // numele campului: verifica shape-ul getAuditEvents
});

it("refuzul tipat (restore in curs) pe create e clasificat denied, nu error", async () => {
  beginRnpmRestore(OWNER);
  try {
    const res = await app.request("/backups/create", { method: "POST", headers: DESKTOP_HEADERS });
    expect(res.status).toBe(409);
    const events = getAuditEvents({ action: "backup.rnpm.create" });
    expect(events[0]?.outcome).toBe("denied");
  } finally {
    endRnpmRestore(OWNER);
  }
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implementeaza**

(a) `appErrorHandler.ts`:

```ts
export function isTypedMaintenanceError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && TYPED_MAINTENANCE_CODES.has(code);
}
```

(b) `rnpm.ts` — DELETE `/backups`: muta rezolvarea owner-ului INAINTE de try (validarea isi pastreaza propriul catch → 400):

```ts
rnpmRouter.delete("/backups", requireDesktopHeader, requireRole("admin", "user"), async (c) => {
  let owner: string;
  try {
    owner = resolveBackupOwner(c, c.req.query("ownerId"));
  } catch (e) {
    return invalidParams(c, e instanceof Error ? e.message : "ownerId invalid");
  }
  try {
    const deleted = await deleteRnpmBackups(owner);
    recordAuditSafe(c, "backup.rnpm.delete_all", {
      targetKind: "backup",
      ownerId: owner,
      detail: { deleted, targetOwnerId: owner === getOwnerId(c) ? undefined : owner },
    });
    return c.json({ deleted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Eroare stergere backups";
    recordAuditSafe(c, "backup.rnpm.delete_all", {
      targetKind: "backup",
      ownerId: owner,
      outcome: isTypedMaintenanceError(e) ? "denied" : "error",
      detail: { error: msg },
    });
    if (e instanceof BackupValidationError) return invalidParams(c, msg);
    rethrowTypedMaintenanceError(e);
    console.error("[rnpm] delete backups failed:", e);
    return internalError(c, "Eroare interna la stergerea backup-urilor.");
  }
});
```

Pe restore (`owner` e deja rezolvat inainte de try acolo): adauga `ownerId: owner` pe AMBELE audituri (succes + eroare) si `outcome: isTypedMaintenanceError(e) ? "denied" : "error"` pe eroare. Pe create: `outcome: isTypedMaintenanceError(e) ? "denied" : "error"`. Pe `POST /compact`: `recordAuditSafe(c, "rnpm.compact", { targetKind: "rnpm_db", detail: { beforeBytes, afterBytes } })` la succes; in catch `recordAuditSafe(c, "rnpm.compact", { outcome: isTypedMaintenanceError(e) ? "denied" : "error", targetKind: "rnpm_db", detail: { error: msg } })` inainte de rethrow.

(c) `adminBackups.ts` — in cele 3 catch-uri: `outcome: isTypedMaintenanceError(e) ? "denied" : "error"` (import din `../util/appErrorHandler.ts`).

(d) `index.ts` — audit split IDEMPOTENT la boot (nu one-shot). Dupa blocul `runRnpmSplitIfNeeded` (liniile 545-550), in try-ul de prewarm (inainte de `system.boot`, linia ~568):

```ts
  // B1 (corectie Codex): auditul splitului trebuie sa fie DURABIL. Markerul
  // done se scrie inainte de return in splitter; daca recordAudit ar esua
  // aici, boot-urile urmatoare intorc split:false si evenimentul s-ar pierde
  // definitiv. Backfill idempotent: marker done + zero randuri rnpm.split in
  // audit_log => inserteaza acum (o interogare pe boot, ieftina).
  if (isRnpmSplitDone() && getAuditEvents({ action: "rnpm.split", limit: 1 }).length === 0) {
    recordAudit(null, "rnpm.split", {
      ownerId: null,
      actorId: "system",
      detail: { version: APP_VERSION, backfilled: true },
    });
  }
```

`isRnpmSplitDone()`: daca `rnpmSplitter.ts` nu exporta deja un check de marker, exporta unul minimal (citirea markerului `done` exista deja intern la `rnpmSplitter.ts:545` — refoloseste-o, nu duplica parsarea). Owners count nu mai e necesar in audit (markerul nu-l pastreaza; `backfilled: true` + version sunt suficiente pentru trasabilitate).

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/routes/rnpmBackups.contract.test.ts src/routes/adminBackups.test.ts src/index.test.ts`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/util/appErrorHandler.ts backend/src/routes/rnpm.ts backend/src/routes/adminBackups.ts backend/src/index.ts backend/src/routes/rnpmBackups.contract.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add -A backend/src
git commit -m "fix(audit): ownerId pe coloana indexata la op cross-owner, audit compact, split backfill idempotent, refuzuri denied (INT-H4)"
```

---

### Task 9: C1 — coduri inregistrate + client care pastreaza code/status/requestId (corectat)

**Files:**
- Modify: `backend/src/util/envelope.ts`, `backend/src/routes/adminBackups.ts`, `backend/src/routes/rnpm.ts`, `backend/src/middleware/requireDesktopHeader.ts`
- Modify: `frontend/src/lib/adminBackupsApi.ts` (corectie Codex: foloseste `unwrapMonitoring` EXISTENT, nu inca un parser local), `frontend/src/lib/rnpmApi.ts`
- Test: `backend/src/routes/adminBackups.test.ts` (asserteaza azi shape-urile flat la :72 — se actualizeaza), test client nou

**Corectii Codex integrate:** obiectivul ".code pastrat in client" NU era atins pentru admin backups (parserul local arunca `new Error`); repo-ul ARE deja implementarea standard: `MonitoringApiError` (`frontend/src/lib/api.ts:480`) + `unwrapMonitoring` (`api.ts:496`) care pastreaza code/status/details/requestId. `ApiError`-ul nou din rnpmApi pastreaza si `requestId`.

- [ ] **Step 1: Teste failing**

Backend, in `adminBackups.test.ts` (inlocuieste asertiile flat de la :72+):

```ts
it("GET / intoarce envelope { data: { backups }, requestId }", async () => {
  const res = await adminApp.request("/", { method: "GET" });
  const body = (await res.json()) as { data?: { backups?: unknown[] }; requestId?: string };
  expect(Array.isArray(body.data?.backups)).toBe(true);
  expect(typeof body.requestId).toBe("string");
});
```

Frontend, test client nou `frontend/src/lib/adminBackupsApi.test.ts` (mock `apiFetch` sa intoarca un Response de eroare envelope):

```ts
it("eroarea envelope produce MonitoringApiError cu code, status si requestId", async () => {
  // mock apiFetch -> new Response(JSON.stringify({ data: null, error: { code: "RESTORE_IN_PROGRESS", message: "..." }, requestId: "rid-1" }), { status: 409 })
  await expect(adminCreateBackup()).rejects.toMatchObject({
    code: "RESTORE_IN_PROGRESS",
    status: 409,
    requestId: "rid-1",
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implementeaza**

(a) `envelope.ts` — adauga in `ErrorCodes` (valorile pe sarma raman cele istorice):

```ts
  // v2.43.x (C1): coduri de concurenta/mentenanta emise de rutele de backup
  // si handlerul central. COOLDOWN/DESKTOP_HEADER_REQUIRED raman lowercase pe
  // sarma — clientii existenti le compara ca stringuri.
  SEARCH_ACTIVE: "SEARCH_ACTIVE",
  RESTORE_IN_PROGRESS: "RESTORE_IN_PROGRESS",
  MAINTENANCE_SHUTDOWN: "MAINTENANCE_SHUTDOWN",
  COOLDOWN: "cooldown",
  DESKTOP_HEADER_REQUIRED: "desktop_header_required",
```

(b) Inlocuieste literalele la emitere: `fail("SEARCH_ACTIVE", ...)` (rnpm.ts, inclusiv cele din Task 2), `fail("cooldown", ...)` (rnpm.ts:1051), `fail("desktop_header_required", ...)` (requireDesktopHeader.ts:46 — importa ErrorCodes).

(c) `adminBackups.ts` — succesele pe envelope: `return c.json(ok({ backups }, c));` / `ok({ name }, c)` / `ok({ preRestoreName }, c)` / `ok({ deleted }, c)` (import `ok`).

(d) `adminBackupsApi.ts` — STERGE parserul local `jsonOrThrow` si foloseste standardul existent:

```ts
import { apiFetch, unwrapMonitoring } from "@/lib/api";

export async function adminListBackups(): Promise<BackupEntry[]> {
  const { backups } = await unwrapMonitoring<{ backups: BackupEntry[] }>(await apiFetch(BASE));
  return backups;
}

export async function adminCreateBackup(): Promise<{ name: string }> {
  const { name } = await unwrapMonitoring<{ name: string }>(await apiFetch(`${BASE}/create`, { method: "POST" }));
  return { name };
}

export async function adminRestoreBackup(name: string): Promise<{ preRestoreName: string }> {
  const { preRestoreName } = await unwrapMonitoring<{ preRestoreName: string }>(
    await apiFetch(`${BASE}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
  );
  return { preRestoreName };
}

export async function adminDeleteBackups(): Promise<number> {
  const { deleted } = await unwrapMonitoring<{ deleted: number }>(await apiFetch(BASE, { method: "DELETE" }));
  return deleted;
}
```

(Verifica semnatura exacta `unwrapMonitoring` in `api.ts:496` — daca primeste Promise<Response> direct, simplifica apelurile.)

(e) `rnpmApi.ts` — `ApiError` care pastreaza si requestId (rutele rnpm raman legacy, dar erorile lor envelope au requestId):

```ts
export class ApiError extends Error {
  readonly code?: string;
  readonly status: number;
  readonly requestId?: string;
  constructor(message: string, status: number, code?: string, requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
```

si in `jsonOrThrow` extrage `code` din `error.code` si `requestId` din body inainte de throw.

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/routes/adminBackups.test.ts && cd ../frontend && npx vitest run src/lib/adminBackupsApi.test.ts src/pages/admin/Backups.test.tsx`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/util/envelope.ts backend/src/routes/adminBackups.ts backend/src/routes/rnpm.ts backend/src/middleware/requireDesktopHeader.ts frontend/src/lib/adminBackupsApi.ts frontend/src/lib/rnpmApi.ts
npx tsc --noEmit -p backend/tsconfig.json && cd frontend && npx tsc --noEmit && cd ..
git add -A backend/src frontend/src
git commit -m "fix(api): ErrorCodes complet, envelope pe adminBackups, client pe unwrapMonitoring cu code/status/requestId pastrate (INT-H5)"
```

---

### Task 10: E2 — logger fara query string (PII juridic afara din loguri)

**Files:**
- Modify: `backend/src/index.ts` (linia 95 + importul `logger`)
- Test: `backend/src/index.test.ts`

**Corectii Codex integrate:** testul NU foloseste `?numeParte=...` real (ar porni apel SOAP real → retea/timeout); foloseste o cale care se opreste determinist INAINTE de SOAP — validarea de la `dosare.ts:104` intoarce 400 local. Spy-ul pe `console.log` se instaleaza INAINTE de `importFreshIndex`.

- [ ] **Step 1: Test failing** in `index.test.ts`:

```ts
it("logger-ul HTTP nu scrie query string-ul (PII juridic) — doar pathname", async () => {
  const logSpy = vi.spyOn(console, "log"); // INAINTE de importFreshIndex
  const port = randomPort();
  await importFreshIndex({ LEGAL_DASHBOARD_PORT: String(port), LEGAL_DASHBOARD_DB_PATH: await makeTmpDb() });
  await waitForHealth(port);
  // Cerere care pica determinist la validare (400) INAINTE de orice apel SOAP:
  const res = await fetch(`http://127.0.0.1:${port}/api/dosare?marker=NUME-FOARTE-SENSIBIL`);
  expect(res.status).toBe(400);
  const lines = logSpy.mock.calls.map((c) => c.map(String).join(" "));
  expect(lines.some((l) => l.includes("NUME-FOARTE-SENSIBIL"))).toBe(false);
  expect(lines.some((l) => l.includes('"path":"/api/dosare"') && l.includes('"status":400'))).toBe(true);
  logSpy.mockRestore();
});
```

(Confirma pe `dosare.ts:100-104` ca cererea fara parametri obligatorii intoarce 400 local; daca `marker` singur nu produce 400, foloseste combinatia de query care pica la validare fara SOAP.)

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implementeaza** — inlocuieste `app.use("*", logger());`:

```ts
// E2 (audit v2.43.0): logger-ul Hono scria URL-ul COMPLET — nume de parti,
// numere de dosar si filtre juridice ajungeau in stdout (persistat pe
// Docker/colectoare). Logam doar pathname + status + durata; requestId-ul e
// setat de requestIdContext downstream si citit din header-ul de raspuns.
app.use("*", async (c, next) => {
  const t0 = Date.now();
  await next();
  const { pathname } = new URL(c.req.url);
  console.log(
    JSON.stringify({
      action: "http",
      method: c.req.method,
      path: pathname,
      status: c.res.status,
      ms: Date.now() - t0,
      requestId: c.res.headers.get("x-request-id") ?? undefined,
      ts: new Date().toISOString(),
    })
  );
});
```

Sterge importul `logger` din `hono/logger`.

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/index.test.ts -t "logger"`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/index.ts backend/src/index.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/index.ts backend/src/index.test.ts
git commit -m "fix(logs): logger HTTP pathname-only — query-urile juridice (PII) nu mai ajung in stdout (EXT-M-07)"
```

---

### Task 11: E3 — erorile SMTP se logheaza sanitizat

**Files:**
- Modify: `backend/src/services/email/mailer.ts` (catch-urile de la :186, :212, :232)
- Test: `backend/src/services/email/mailer.test.ts`

**Corectii Codex integrate:** testul din Rev. 1 era fals-verde: fara `setSmtpEnv()` mailerul e disabled si `sendMail` nu se apeleaza; fara `mocks.sendMail.mockRejectedValue(...)` nu exista eroare; `JSON.stringify(new Error(...))` NU include `message` (non-enumerabil), deci adresa nu aparea nici inainte de fix.

- [ ] **Step 1: Test failing** (foloseste helperii REALI din `mailer.test.ts`: `setSmtpEnv()` + mock-ul de transport existent):

```ts
it.each([
  ["sendAlertEmail", () => sendAlertEmail(FIXTURE_ALERT, { toAddress: "victima@firma.ro" } as EmailSettings)],
  ["sendComposedEmail", () => sendComposedEmail("victima@firma.ro", { subject: "s", html: "<p>h</p>", text: "t" })],
  ["sendTestEmail", () => sendTestEmail("victima@firma.ro")],
])("%s: esecul sendMail se logheaza SANITIZAT (fara adresa in stdout/stderr)", async (_name, run) => {
  setSmtpEnv(); // altfel mailerul e disabled si sendMail nu e apelat
  mocks.sendMail.mockRejectedValueOnce(
    Object.assign(new Error("RCPT TO:<victima@firma.ro> refused"), { code: "EENVELOPE", responseCode: 550 })
  );
  const errSpy = vi.spyOn(console, "error");
  const result = await run();
  expect(result.ok).toBe(false);
  // Serializare corecta (corectie Codex): Error.message e non-enumerabil in
  // JSON.stringify — extrage-l explicit.
  const dump = errSpy.mock.calls
    .flat()
    .map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a)))
    .join("\n");
  expect(dump).not.toContain("victima@firma.ro");
  expect(dump).toContain("EENVELOPE");
  errSpy.mockRestore();
});
```

(Numele exacte ale helperilor/mock-urilor — `setSmtpEnv`, `mocks.sendMail`, fixture de alerta — se preiau din fisier; adapteaza.)

- [ ] **Step 2: Run — FAIL** (azi se logheaza obiectul Error brut, iar `dump` contine adresa via `a.message`).

- [ ] **Step 3: Implementeaza** — in cele 3 catch-uri:

```ts
    console.error("[email] sendAlertEmail failed", sanitizeSmtpError(err));
```

(analog `sendComposedEmail`/`sendTestEmail`; import `sanitizeSmtpError` din `../../util/auditSanitize.ts`).

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/services/email/mailer.test.ts`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/services/email/mailer.ts backend/src/services/email/mailer.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/services/email
git commit -m "fix(email): erorile SMTP se logheaza prin sanitizeSmtpError, nu brute (EXT-M-08)"
```

---

### Task 12: E4 — retentie audit_log/ai_usage independenta de scheduler (corectat: ambele moduri, helper testabil)

**Files:**
- Create: `backend/src/services/retentionPurge.ts` + `backend/src/services/retentionPurge.test.ts`
- Modify: `backend/src/index.ts` (timer in AMBELE moduri + cleanup la shutdown)

**Corectii Codex HIGH integrate:** (1) blocul de timere standalone e WEB-ONLY (`index.ts:745-809`) — un timer pus acolo lasa desktop + `MONITORING_ENABLED=0` neacoperit, adica exact scenariul din finding; timerul NOU sta IN AFARA `if (getAuthMode() === "web")`, in ambele moduri. (2) try/catch SEPARAT per repository (schedulerul le separa intentionat la `scheduler.ts:386` si `:419` — eroarea AI nu are voie sa sara purge-ul de audit). (3) `intervals.test.ts` e pentru utilitare de date, NU timere server — helper nou testabil direct. (4) Un singur contract de log, testat exact.

**Interfaces:**
- Produces: `runRetentionPurge(): { aiUsageDeleted: number; auditDeleted: number; errors: string[] }` — apelat de timerul din index.ts; log per-repo `ai_usage.purged` / `audit_log.purged` cu `source: "standalone_interval"` (acelasi contract ca schedulerul, sursa distincta).

- [ ] **Step 1: Test failing** in `retentionPurge.test.ts` (DB temporar pe pattern-ul testelor de repository):

```ts
describe("runRetentionPurge (EXT-M-09)", () => {
  it("purjeaza randurile mai vechi de 90 zile din ai_usage si audit_log", () => {
    insertAiUsageRowAgedDays(95);   // helper pe pattern-ul fixture-urilor existente
    insertAuditRowAgedDays(95);
    const res = runRetentionPurge();
    expect(res.aiUsageDeleted).toBe(1);
    expect(res.auditDeleted).toBe(1);
    expect(res.errors).toEqual([]);
  });

  it("eroarea pe purge-ul AI NU sare purge-ul de audit (try/catch separat)", () => {
    insertAuditRowAgedDays(95);
    vi.spyOn(aiUsageRepository, "purgeOldAiUsage").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const res = runRetentionPurge();
    expect(res.auditDeleted).toBe(1);
    expect(res.errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — FAIL** (fisierul nu exista).

- [ ] **Step 3: Implementeaza**

`retentionPurge.ts`:

```ts
// E4 (audit v2.43.0): retentia audit_log + ai_usage (90d) rula DOAR in
// scheduler-ul de monitoring; cu MONITORING_ENABLED=0 tabelele cresteau
// nelimitat. Helper testabil, apelat de un timer zilnic din index.ts in
// AMBELE moduri (desktop + web). Cu scheduler-ul pornit devine duplicat
// zilnic idempotent (DELETE pe fereastra de timp) — inofensiv.
// try/catch SEPARAT per repository (contract identic cu scheduler-ul):
// eroarea unui purge nu are voie sa-l sara pe celalalt.

import { purgeOldAuditLog } from "../db/auditRepository.ts";
import { purgeOldAiUsage } from "../db/aiUsageRepository.ts";

export const RETENTION_DAYS = 90;

export function runRetentionPurge(): { aiUsageDeleted: number; auditDeleted: number; errors: string[] } {
  const errors: string[] = [];
  let aiUsageDeleted = 0;
  let auditDeleted = 0;
  try {
    aiUsageDeleted = purgeOldAiUsage(RETENTION_DAYS);
    if (aiUsageDeleted > 0) {
      console.log(
        JSON.stringify({
          action: "ai_usage.purged",
          source: "standalone_interval",
          deleted_count: aiUsageDeleted,
          retention_days: RETENTION_DAYS,
          ts: new Date().toISOString(),
        })
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`ai_usage: ${msg}`);
    console.error("[retention] purgeOldAiUsage threw, continuing", { error: msg });
  }
  try {
    auditDeleted = purgeOldAuditLog(RETENTION_DAYS);
    if (auditDeleted > 0) {
      console.log(
        JSON.stringify({
          action: "audit_log.purged",
          source: "standalone_interval",
          deleted_count: auditDeleted,
          retention_days: RETENTION_DAYS,
          ts: new Date().toISOString(),
        })
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`audit_log: ${msg}`);
    console.error("[retention] purgeOldAuditLog threw, continuing", { error: msg });
  }
  return { aiUsageDeleted, auditDeleted, errors };
}
```

(Verifica numele exacte ale exporturilor `purgeOldAiUsage`/`purgeOldAuditLog` in repository-uri — schedulerul le importa deja.)

`index.ts` — declaratie langa celelalte timere + pornire IN AFARA blocului web-only (imediat dupa el), + cleanup in shutdown:

```ts
const RETENTION_PURGE_INTERVAL_MS = 86_400_000;
let retentionPurgeInterval: NodeJS.Timeout | null = null;
```

```ts
  // E4: in AMBELE moduri (desktop + web) — finding-ul acopera exact
  // deploy-urile cu MONITORING_ENABLED=0, indiferent de mod.
  retentionPurgeInterval = setInterval(() => {
    runRetentionPurge();
  }, RETENTION_PURGE_INTERVAL_MS);
  retentionPurgeInterval.unref?.();
```

```ts
  if (retentionPurgeInterval) {
    clearInterval(retentionPurgeInterval);
    retentionPurgeInterval = null;
  }
```

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/services/retentionPurge.test.ts src/index.test.ts`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/services/retentionPurge.ts backend/src/services/retentionPurge.test.ts backend/src/index.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/services/retentionPurge.ts backend/src/services/retentionPurge.test.ts backend/src/index.ts
git commit -m "fix(retention): purge zilnic audit_log + ai_usage independent de monitoring, in ambele moduri, helper testabil (EXT-M-09)"
```

---

### Task 13: E5 — fara path-uri absolute in API si fara mesaje interne brute pe 500 (scope complet)

**Files:**
- Modify: `backend/src/routes/rnpm.ts` (`/stats`:925-938; 500-urile rutelor backups; corectie Codex: SI `/open-db-folder`:958, `/open-backups-folder`:1152)
- Modify: `backend/src/routes/adminBackups.ts` (cele 4 catch-uri)
- Modify: `frontend/src/types/rnpm.ts`:192, `frontend/src/components/rnpm/RnpmSavedStats.tsx` (:118-127, :304-311 + importurile `Copy`/`Check` de la :3)
- Test: corectie Codex — testele contractuale EXISTENTE care cer path-ul se actualizeaza: `backend/src/routes/rnpm.contract.test.ts:330` si `backend/src/routes/rnpmBackups.contract.test.ts:291`

- [ ] **Step 1: Teste failing** — actualizeaza cele DOUA teste contractuale existente (asserteaza azi `db.path`) si adauga:

```ts
it("GET /rnpm/stats nu expune path-ul absolut al fisierului", async () => {
  const res = await app.request("/stats", { headers: AUTH_HEADERS });
  const body = (await res.json()) as { db?: Record<string, unknown> };
  expect("path" in (body.db ?? {})).toBe(false);
  expect(typeof body.db?.sizeBytes).toBe("number");
});
```

- [ ] **Step 2: Run — FAIL** (testul nou pica; cele doua existente inca trec — vor fi actualizate la Step 3).

- [ ] **Step 3: Implementeaza**

(a) `/stats`: ambele raspunsuri devin `db: { sizeBytes: ... }` (fara `path`).

(b) 500-uri generice pe TOATA suprafata rnpm backups + open-folder (corectie Codex — `/open-db-folder` si `/open-backups-folder` returnau si ele mesaje brute Electron/OS):

```ts
    console.error("[rnpm] <ruta> failed:", e); // textul complet ramane server-side
    return internalError(c, "Eroare interna. Reincearca sau contacteaza administratorul cu requestId-ul din raspuns.");
```

(analog in adminBackups.ts cu `fail(ErrorCodes.INTERNAL_ERROR, "Eroare interna...", c)`). NU se ating: 400 `BackupValidationError` (mesaj util), 409/503 tipate (rethrow), audit-urile (`detail: { error: msg }` ramane cu mesajul complet).

(c) Frontend: `types/rnpm.ts` → `db: { sizeBytes: number };` in `RnpmSavedStats.tsx`: sterge afisarea path-ului + butonul de copy + state-ul `copied` + timeout-ul lui + importurile `Copy`/`Check` (raman doar daca au alti consumatori in fisier). "Deschide folderul" RAMANE (nu are nevoie de path client-side).

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/routes/rnpm.contract.test.ts src/routes/rnpmBackups.contract.test.ts src/routes/adminBackups.test.ts && cd ../frontend && npx tsc --noEmit`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/routes/rnpm.ts backend/src/routes/adminBackups.ts frontend/src/types/rnpm.ts frontend/src/components/rnpm/RnpmSavedStats.tsx backend/src/routes/rnpm.contract.test.ts backend/src/routes/rnpmBackups.contract.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add -A backend/src frontend/src
git commit -m "fix(security): fara path absolut in /rnpm/stats, mesaje generice pe toate 500-urile rnpm/admin backups + open-folder (EXT-L-03, EXT-L-04)"
```

---

### Task 14: E6 — directiva no-store garantata pe API (corectat: merge de directive, nu guard pe prezenta)

**Files:**
- Modify: `backend/src/index.ts` (dupa `app.use("*", requestIdContext);`)
- Test: `backend/src/index.test.ts`

**Corectii Codex integrate:** guard-ul `if (!has("Cache-Control"))` lasa SSE-urile (care au DOAR `no-cache` — `dosare.ts:337`, `termene.ts:364`) stocabile si nu adauga `private` rutelor cu `no-store` existent (`dosare.ts:88`, `rnpm.ts:1226`). Fix: MERGE de directive — adauga `no-store`/`private` fara sa stearga `no-cache`. Testul nu foloseste rute care pornesc SOAP real.

- [ ] **Step 1: Teste failing** in `index.test.ts`:

```ts
it("raspunsurile /api/* contin directiva no-store si private (inclusiv 4xx si rutele cu politici proprii)", async () => {
  const port = randomPort();
  await importFreshIndex({ LEGAL_DASHBOARD_PORT: String(port), LEGAL_DASHBOARD_DB_PATH: await makeTmpDb() });
  await waitForHealth(port);
  // Ruta deterministe locala (400 la validare, fara SOAP):
  const res = await fetch(`http://127.0.0.1:${port}/api/dosare?marker=x`);
  const cc = res.headers.get("cache-control") ?? "";
  expect(cc).toContain("no-store");
  expect(cc).toContain("private");
  // 404 API:
  const res404 = await fetch(`http://127.0.0.1:${port}/api/v1/ruta-inexistenta`);
  expect(res404.headers.get("cache-control") ?? "").toContain("no-store");
});
```

(Plus, in fisierul de teste al unei rute SSE deja testate local — daca exista harness — asertia ca `no-cache` SUPRAVIETUIESTE si `no-store` e adaugat. Daca nu exista harness SSE local, verificarea SSE se face la smoke-ul din Task 16 si se noteaza explicit in raportul batch-ului.)

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implementeaza**:

```ts
// E6 (audit v2.43.0): raspunsurile API autentificate nu aveau no-store decat
// pe PAT/export. MERGE de directive (corectie Codex): rutele cu politici
// proprii (SSE no-cache, exporturi no-store) le PASTREAZA — adaugam doar ce
// lipseste, nu suprascriem.
app.use("/api/*", async (c, next) => {
  await next();
  const existing = c.res.headers.get("Cache-Control");
  const directives = new Set(
    (existing ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean)
  );
  directives.add("no-store");
  directives.add("private");
  c.res.headers.set("Cache-Control", [...directives].join(", "));
});
```

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/index.test.ts -t "no-store"`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/index.ts backend/src/index.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add backend/src/index.ts backend/src/index.test.ts
git commit -m "fix(security): directiva no-store + private garantata pe /api/* prin merge de directive (EXT-L-05)"
```

---

### Task 15: G quick-wins (corectat: semantica publica vs prune best-effort)

**Files:**
- Modify: `backend/src/routes/rnpm.ts` (typeof ownerId in restore body; `fs.existsSync` → helper async la :925 si :972)
- Modify: `backend/src/db/backup.ts` (`listBackups`:235-242; `listBackupsWithMeta` stat catch :417-425; `pruneOld` si `latestBackupMtime` devin tolerante; prune in catch-ul de staging :549-563)
- Test: `backend/src/db/backup.test.ts`, `backend/src/db/rnpmBackup.test.ts`, `backend/src/routes/rnpmBackups.contract.test.ts`

**Corectii Codex HIGH integrate:** (1) `fileExists` cu catch generic ar fi mascat EACCES/EIO drept "absent" — DOAR ENOENT inseamna false, restul se propaga. (2) `listBackups` e PRIVAT — testarea se face prin `listBackupsWithMeta()`/`listRnpmBackups()` (`backup.ts:433`). (3) `latestBackupMtime` e apelat in `dailyBackupTarget` IN AFARA catch-ului de snapshot (`backup.ts:1282`) — propagarea bruta ar fi rupt daily backup-ul; si `pruneOld` ruleaza DUPA mutatii comise (`createManualBackupForTarget`:1207, RNPM :1228) — o eroare de listare in prune NU are voie sa transforme un backup deja creat in 500. Semantica separata: listarea PUBLICA propaga non-ENOENT; prune/mtime interne devin tolerante (log + safe default). (4) Testul prune-on-failure cu "backup text invalid" NU ajunge la staging (validarea ruleaza inainte — `backup.ts:861,935`); se foloseste backup VALID + esec injectat in staging (mock `copyFile`, pattern existent la `rnpmBackup.test.ts:662`).

- [ ] **Step 1: Teste failing**:

```ts
// backup.test.ts
it("listBackupsWithMeta propaga erorile non-ENOENT de listare (EXT-L-01)", async () => {
  // backup dir = FISIER, nu director => readdir ENOTDIR
  await expect(listBackupsWithMeta()).rejects.toMatchObject({ code: "ENOTDIR" });
});

it("pruneOld tolereaza erorile de listare (log + 0), fara sa arunce (post-mutatie safe)", async () => {
  // acelasi aranjament ENOTDIR; pruneOld e exersat prin createManualBackup:
  // snapshot-ul reuseste, prune-ul logheaza backup_prune_failed si NU arunca.
  const logSpy = vi.spyOn(console, "log");
  await expect(createManualBackup()).resolves.toMatchObject({ name: expect.any(String) });
  expect(logSpy.mock.calls.map((c) => String(c[0])).some((l) => l.includes("backup_prune_failed"))).toBe(true);
  logSpy.mockRestore();
});

// rnpmBackup.test.ts — prune pe failure de staging (pattern mock copyFile :662)
it("restore esuat la STAGING aplica prune pe pool-ul pre-restore (EXT-M-04)", async () => {
  // seed: 5 snapshot-uri pre-restore existente + backup VALID
  // mock fsPromises.copyFile sa arunce la copierea in staging (dupa snapshot)
  await expect(restoreRnpmFromBackup(OWNER, VALID_BACKUP)).rejects.toThrow();
  const preRestoreFiles = listPreRestoreFiles(OWNER); // helper local pe readdir
  expect(preRestoreFiles.length).toBeLessThanOrEqual(5); // PRE_RESTORE_RETAIN
});

// rnpmBackups.contract.test.ts
it("POST /backups/restore cu body.ownerId non-string intoarce 400, nu 500", async () => {
  const res = await app.request("/backups/restore", {
    method: "POST",
    headers: { ...DESKTOP_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ name: "x.db", ownerId: 123 }),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implementeaza**

(a) `rnpm.ts` restore — typeof guard inainte de `resolveBackupOwner`:

```ts
  const requestedOwner = (body as { ownerId?: unknown }).ownerId;
  if (requestedOwner !== undefined && typeof requestedOwner !== "string") {
    return invalidParams(c, "ownerId invalid");
  }
```

(b) `rnpm.ts` — helper async cu semantica ENOENT-only (inlocuieste ambele `fs.existsSync`):

```ts
async function rnpmFileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (e) {
    // DOAR ENOENT = absent; EACCES/EIO/ENOTDIR se propaga — altfel un fisier
    // real dar inaccesibil ar raporta "nu exista baza" (corectie Codex).
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw e;
  }
}
```

(c) `backup.ts`:

- `listBackups` (privat): `return []` DOAR pe ENOENT; restul se propaga (listarea publica prin `listBackupsWithMeta`/`listRnpmBackups` devine explicita).
- `listBackupsWithMeta` (stat per fisier, :417-425): skip DOAR pe ENOENT; restul se propaga.
- `pruneOld`: prinde INTERN erorile de listare — log `backup_prune_failed` + return 0 (ruleaza post-mutatie; nu are voie sa strice un succes comis).
- `latestBackupMtime`: prinde erorile de listare — log + return null (daily backup incearca snapshot-ul in loc sa moara la freshness check).
- Catch-ul de staging din `performRestore` (:549-563), dupa `rm(stagingDir)`:

```ts
    // EXT-M-04: snapshot-ul pre-restore creat mai sus ramane (plasa de
    // siguranta), dar pool-ul se plafoneaza si pe failure — retry-uri repetate
    // nu mai acumuleaza fisiere nelimitat. Best-effort: pruneOld e tolerant.
    await pruneOld(t.dir, t.prefix).catch(() => {
      /* pruneOld logheaza intern; eroarea reala de staging ramane cea aruncata */
    });
```

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/db/backup.test.ts src/db/rnpmBackup.test.ts src/routes/rnpmBackups.contract.test.ts`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/routes/rnpm.ts backend/src/db/backup.ts backend/src/db/backup.test.ts backend/src/db/rnpmBackup.test.ts backend/src/routes/rnpmBackups.contract.test.ts
npx tsc --noEmit -p backend/tsconfig.json
git add -A backend/src
git commit -m "fix(rnpm): typeof ownerId, fs async ENOENT-only, listare publica fail-explicit vs prune tolerant, prune pe failure paths (INT-M9, INT-M10, EXT-L-01, EXT-M-04)"
```

---

### Task 16: Gate final complet + verificare (corectat: build CJS + rebuild electron)

- [ ] **Step 1: Suita completa + build** (corectie Codex: `npm run check` NU include build-ul CJS):

```bash
npm run check
npm run build
```

Expected: ambele PASS. Repara orice regresie inainte de a merge mai departe.

- [ ] **Step 2: Rebuild nativ pentru mediul de dev al userului** (dupa testele Node care ating better-sqlite3):

```bash
npm run rebuild:electron
```

- [ ] **Step 3: Smoke local web** — porneste stack-ul web local (scriptul documentat al proiectului, ex. `dev-web-local.ps1`, cu setup-ul de autentificare admin din acelasi flux; fara extragere manuala de tokenuri). Verifica: listare/creare/restore backup din Setari (admin, envelope nou), delete-all RNPM cu `{deleted, compacted}`, absenta query string-urilor in consola backend, header `Cache-Control` cu `no-store` pe un GET API si pe un stream SSE (DevTools). NU se fac push-uri.

- [ ] **Step 4: Derogare smoke Electron** — decizia userului (2026-07-11): desktop-ul NU e in scope-ul acestui batch; smoke-ul Electron impachetat ramane OBLIGATORIU inainte de tag-ul de release v2.43.0 (pas de release, nu de batch). Noteaza explicit in raportul final.

- [ ] **Step 5: Commit de inchidere (daca au ramas fisiere) + raport** — rezumatul comiturilor + ce a ramas pe Faza 2. Push DOAR cu confirmarea userului.

---

## Follow-up Faza 2 (plan separat, dupa ce Faza 1 e verde)

1. **C2** — alias-uri legacy `/me/budget` + versionare `/api/rnpm/backups*`; nota ops: Cloudflare NU cache-uieste `index.html`.
2. **EXT-M-03 + INT-M13** — idempotency durabila restore/compact (`clientRequestId` + ledger persistent).
3. **EXT-M-05 (FE+BE)** — `busyOperation` unic in `RnpmSavedStats` + status separat pentru hook-ul offsite.
4. **EXT-M-02** — preflight disc realist pentru split.
5. **INT-M7** — `0041.down` dubleaza bugetul; **INT-M8** — pre-split VACUUM cu staging; **INT-M11** — `createGrant` idempotent.
6. **EXT-L-02** — AbortController/cleanup pe fetch-urile si timerele ramase.
7. **F1/F2** — copy: "tenant"/"Feature"/"user", manualul custodiei cheilor (EXT-M-11), glosar backup/restaurare, format data/valuta.
8. **INT-M1** — daily backup lock O(N useri) (gate de load-test); **INT-M2** — kill-switch splitter; **INT-M14** — teste crash-injection splitter.

**Excluse permanent (deciziile userului, 2026-07-11):** cluster D (a11y) integral; E1, EXT-M-10, INT-M3 si orice item strict desktop/Electron (cu exceptia smoke-ului Electron pre-release, care ramane pas de release).
