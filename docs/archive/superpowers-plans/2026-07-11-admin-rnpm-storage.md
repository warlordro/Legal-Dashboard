# Admin RNPM Storage (vizibilitate dimensiuni per user + compact cross-owner) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Rev. 2 (2026-07-11):** corectiile review-ului adversarial Codex integrate (raport: scratchpad `codex-plan-review-result.md`; sesiune Codex `019f52e6-230f-7153-a66c-996759a9e01a`). Verdictul initial: T2 INCORRECT (sursa backup count/bytes + harness), T1/T3/T4/T5 ADJUST. Punctele marcate de Codex UNVERIFIABLE-FROM-EXCERPTS au fost verificate de orchestrator pe cod si sunt bake-uite mai jos: `listRnpmBackups` intoarce `BackupEntry { name, sizeBytes, mtime }` filtrat pe `RNPM_PREFIX` (`backup.ts:452-483`; ENOENT pe jail → lista goala, EACCES/EIO se propaga); `formatBytes` e deja exportat din `@/lib/utils:43` (`toFixed(1)` → "2.0 MB"); `ApiError(message, status, code?, requestId?)` (`rnpmApi.ts:56`); `recordAuditSafe` accepta `ownerId` (pattern T8, `rnpm.ts` rutele backups); `ok(data, c)` (`adminBackups.ts`); `getAuditEvents({action})[0]` = cel mai NOU (pattern consacrat in testele contract existente).

**Goal:** Adminul vede dimensiunile bazelor RNPM per user (fisier viu + backup-uri) si poate declansa compactarea fisierului oricarui user, fara sa astepte ca userul sa o faca singur.

**Architecture:** Un endpoint admin nou read-only (`GET /api/v1/admin/rnpm/usage`, router nou pe envelope, pattern `adminBackups.ts`) care join-uieste userii din repository cu dimensiunile fisierelor `rnpm/<stem>.db` si ale jail-urilor de backup (prin functia publica existenta `listRnpmBackups`); ruta existenta `POST /api/rnpm/compact` invata tintirea cross-owner prin `?ownerId=` cu mecanismul DEJA testat `resolveBackupOwner`. UI: un card nou embedded in tab-ul Setari > Backup, sub backup-urile monolitului.

**Tech Stack:** Hono + better-sqlite3 (backend), React 18 + Vite (frontend), Vitest, Biome.

## Global Constraints

- Branch: `feat/v2.43.0-rnpm-split` (branch-ul curent). **NIMIC pe main.**
- **FARA NICIUN `git commit` / `git add` / `git push` pe durata intregului plan** — cerinta explicita a userului (2026-07-11): commit-urile se fac DOAR la final, dupa OK-ul lui pe implementarea completa. Taskurile se termina cu gate verde; working tree-ul contine numai modificarile scoped asteptate, necomise.
- Prioritate: suprafata WEB (deploy Docker single-container). Desktop-ul functioneaza implicit (aceleasi rute). Smoke-ul Electron impachetat NU e in scope-ul planului (decizie user: web-first; ramane pas de release desktop).
- Repository-only DB access: SQL raw DOAR in `backend/src/db/**`.
- Envelope `{ data, error: { code, message }, requestId }` pe ruta admin noua; rutele `/api/rnpm/*` raman legacy non-envelope.
- Romana fara diacritice in cod sursa si copy UI.
- Frontend NU are @testing-library — teste cu `createRoot` + `act` + evenimente native (pattern `Backups.test.tsx`); mock-uri de module API cu `vi.mock` + `mockReset` in `beforeEach` (capcana: `restoreAllMocks` NU curata istoricul unui `vi.fn` din factory).
- Capcana biome `noAssignInExpressions`: block body la arrow assignments.
- Schimbari chirurgicale; FARA bump de versiune; FARA migratii de schema.
- Numerele de linie sunt de la HEAD `9805ea5` — ancoreaza pe snippet-uri, nu pe numere.

## Decizii luate (asumptii explicite)

1. **Ordinea listei o asigura REPOSITORY-UL** (`ORDER BY email ASC` in `listAllUserIdentities`) — UI-ul NU re-sorteaza (corectie Codex: decizia initiala "sortare client-side" contrazicea contractul T1; s-a ales ordinea stabila in repository).
2. **Userii fara fisier RNPM** apar cu `dbSizeBytes: null` (distinge "fara fisier" de "fisier gol"); UI afiseaza "—"; butonul Compacteaza e disabled.
3. **Fisierele orfane** din `rnpm/` (stem fara user) NU sunt in scope (follow-up).
4. **Delete-all cross-owner NU e in scope** (flux separat GDPR/audit).
5. **Refuzurile compactului cross-owner** (cautare activa / restore in curs la tinta) raman pe erorile tipate → 409 central; UI le afiseaza prietenos.
6. **Semantica FS ENOENT-only** (v2.43.0): absent = null/skip; EACCES/EIO se propaga → handlerul central da 500 pe envelope cu requestId (`appErrorHandler.ts`, fallback pe envelope din commit `741af2f`).
7. **Audit**: GET usage NU se auditeaza (read-only, paritate `GET /api/v1/admin/backups`); compactul se auditeaza cu `ownerId` = userul AFECTAT + `detail.targetOwnerId` cand difera de caller, INCLUSIV pe ramura 404 cross-owner (corectie Codex: tentativa admin pe owner fara fisier trebuie sa lase urma).
8. **requireDesktopHeader ramane pe `/compact`**; frontend-ul trimite header-ul automat prin `apiFetch`.
9. **`backupsBytes` = suma `sizeBytes` din `listRnpmBackups`** — snapshot-urile v2.43.0 sunt self-contained (VACUUM INTO, fara sidecars); sidecar-urile bundle-urilor LEGACY (-wal/-shm) nu sunt numarate (subestimare mica, acceptata — filtrarea pe sufix a `listBackups` le exclude oricum din orice listare publica).

---

### Task 1: Repository — listarea identitatilor de user pentru admin

**Files:**
- Modify: `backend/src/db/userRepository.ts` (functie noua la finalul sectiunii de list/get)
- Test: `backend/src/db/userRepository.test.ts` (describe nou, harness-ul de DB temporar existent)

**Interfaces:**
- Consumes: `getDb()` (deja importat), tabela `users`.
- Produces: `listAllUserIdentities(): Array<{ id: string; email: string; display_name: string; status: UserStatus }>` — TOTI userii (toate statusurile: `"active" | "suspended" | "deleted"`), sortati pe email ASC. Task 2 o consuma.

- [ ] **Step 1: Test failing** in `userRepository.test.ts` (corectie Codex: `InsertUserInput` cere OBLIGATORIU `id` — `userRepository.ts:205-214`; `UserStatus` NU are "inactive", valorile sunt `active/suspended/deleted` — `:9`):

```ts
describe("listAllUserIdentities (admin rnpm storage)", () => {
  it("intoarce toti userii, indiferent de status, sortati pe email", () => {
    insertUser({ id: "u-c", email: "c@x.ro", displayName: "C", role: "user" });
    insertUser({ id: "u-a", email: "a@x.ro", displayName: "A", role: "admin" });
    const b = insertUser({ id: "u-b", email: "b@x.ro", displayName: "B", role: "user" });
    updateUserStatus(b.id, "suspended");
    const rows = listAllUserIdentities();
    expect(rows.map((r) => r.email)).toEqual(["a@x.ro", "b@x.ro", "c@x.ro"]);
    expect(rows.find((r) => r.id === "u-b")?.status).toBe("suspended");
    expect(rows[0]).toHaveProperty("display_name");
  });
});
```

(Adapteaza campurile `insertUser` la `InsertUserInput` REAL din fisier — daca cere si alte campuri obligatorii, completeaza-le pe modelul testelor existente din fisier.)

- [ ] **Step 2: Run — FAIL**: `cd backend && npx vitest run src/db/userRepository.test.ts -t "listAllUserIdentities"` (functia nu exista).

- [ ] **Step 3: Implementeaza** in `userRepository.ts`:

```ts
// v2.43.x (admin rnpm storage): identitatile tuturor userilor pentru join-ul
// cu dimensiunile fisierelor rnpm/<stem>.db — fara paginare (lista e mica,
// conventia UserPicker), toate statusurile (fisierul unui user suspendat/sters
// ocupa disc la fel de mult). Ordinea (email ASC) e CONTRACT: UI nu re-sorteaza.
export function listAllUserIdentities(): Array<{
  id: string;
  email: string;
  display_name: string;
  status: UserStatus;
}> {
  const db = getDb();
  return db.prepare("SELECT id, email, display_name, status FROM users ORDER BY email ASC").all() as Array<{
    id: string;
    email: string;
    display_name: string;
    status: UserStatus;
  }>;
}
```

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/db/userRepository.test.ts`

- [ ] **Step 5: Gate (fara commit)**: `npx biome check --write backend/src/db/userRepository.ts backend/src/db/userRepository.test.ts && npx tsc --noEmit -p backend/tsconfig.json`

---

### Task 2: Endpoint admin `GET /api/v1/admin/rnpm/usage`

**Files:**
- Create: `backend/src/routes/adminRnpm.ts`
- Modify: `backend/src/index.ts` (mount intre `adminBackupsRouter` si `adminRouter`, ~:458-459)
- Test: `backend/src/routes/adminRnpm.test.ts` (nou)

**Interfaces:**
- Consumes: `listAllUserIdentities()` (Task 1); `getRnpmDbPath(ownerId)` din `db/rnpmDb.ts` (PUR read-only — provisioning-ul e DOAR in `getRnpmDb()`, `rnpmDb.ts:131-142`, pe care NU-l apelam); `listRnpmBackups(ownerId)` din `db/backup.ts:482` (filtrare `RNPM_PREFIX`, ENOENT pe jail → `[]`, EACCES/EIO se propaga); `ok` din `util/envelope.ts` (semnatura `ok(data, c)`); `requireRole("admin")`; `fsPromises.stat`.
- Produces: `GET /usage` → `ok({ rows: AdminRnpmUsageRow[] }, c)` cu `AdminRnpmUsageRow = { userId: string; email: string; displayName: string; status: string; dbSizeBytes: number | null; backupCount: number; backupsBytes: number }`. Task 4 consuma exact acest shape.

- [ ] **Step 1: Teste failing** in `adminRnpm.test.ts`. **Harness-ul (corectie Codex): copiaza pattern-ul REAL din `adminBackups.test.ts:1-80`** — acolo exista `buildApp(actAs)` care monteaza routerul pe PATH COMPLET si fixture-uri `u1`/`admin1` create in `beforeEach`; NU exista `adminApp`/`userApp`. In app-ul de test monteaza si `app.onError(appErrorHandler)` (pattern `rnpmBackups.contract.test.ts`) ca testul de propagare EACCES sa vada envelope-ul 500 real. Adauga in `beforeEach` si un al doilea user: `insertUser({ id: "u2", email: "u2@x.ro", displayName: "U2", role: "user" })` (adapteaza la `InsertUserInput` real). Seed-ul fisierului RNPM pentru u1: refoloseste helperul de seed din `rnpmBackups.contract.test.ts` (`seedRnpm`) sau echivalentul minim (un insert de aviz prin repository provisioneaza fisierul); backup-ul lui u1: prin functia publica de create backup RNPM folosita in acelasi fisier de teste.

```ts
describe("GET /api/v1/admin/rnpm/usage", () => {
  it("intoarce envelope cu un rand per user: dimensiune fisier viu + backups", async () => {
    seedRnpm("u1", "a");
    await createRnpmBackup("u1"); // numele REAL al functiei publice — vezi cum creeaza backup testele contract
    const res = await buildApp("admin1").request("/api/v1/admin/rnpm/usage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { rows?: Array<{ userId: string; dbSizeBytes: number | null; backupCount: number; backupsBytes: number }> };
      requestId?: string;
    };
    expect(typeof body.requestId).toBe("string");
    const u1 = body.data?.rows?.find((r) => r.userId === "u1");
    const u2 = body.data?.rows?.find((r) => r.userId === "u2");
    expect((u1?.dbSizeBytes ?? 0) > 0).toBe(true);
    expect(u1?.backupCount).toBe(1);
    expect((u1?.backupsBytes ?? 0) > 0).toBe(true);
    expect(u2?.dbSizeBytes).toBeNull();
    expect(u2?.backupCount).toBe(0);
  });

  it("rolul user primeste 403 (admin-only)", async () => {
    const res = await buildApp("u1").request("/api/v1/admin/rnpm/usage");
    expect(res.status).toBe(403);
  });

  it("eroare FS non-ENOENT la stat pe fisierul unui user => 500 pe envelope (nu date false)", async () => {
    seedRnpm("u1", "a");
    vi.spyOn(fsPromises, "stat").mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
    );
    const res = await buildApp("admin1").request("/api/v1/admin/rnpm/usage");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string }; requestId?: string };
    expect(body.error?.code).toBe("INTERNAL_ERROR");
  });
});
```

(Mock-ul pe `fsPromises.stat` functioneaza — namespace object, pattern consacrat in `rnpmBackup.test.ts`.)

- [ ] **Step 2: Run — FAIL**: `cd backend && npx vitest run src/routes/adminRnpm.test.ts` (fisierul rutei nu exista).

- [ ] **Step 3: Implementeaza** `backend/src/routes/adminRnpm.ts` (corectie Codex: count/bytes prin `listRnpmBackups`, NU readdir brut — readdir ar numara orice entry din jail, inclusiv fisiere care nu sunt backup-uri logice):

```ts
// v2.43.x (admin rnpm storage): vizibilitate admin pe consumul de disc RNPM
// per user — fisierul viu (db+wal+shm) si jail-ul de backup-uri. Read-only,
// envelope standard, fara audit (paritate cu GET /api/v1/admin/backups).
// Erorile FS non-ENOENT se propaga -> appErrorHandler -> 500 pe envelope.
import { Hono } from "hono";
import fsPromises from "node:fs/promises";
import { listRnpmBackups } from "../db/backup.ts";
import { getRnpmDbPath } from "../db/rnpmDb.ts";
import { listAllUserIdentities } from "../db/userRepository.ts";
import { requireRole } from "../middleware/requireRole.ts";
import { ok } from "../util/envelope.ts";

export const adminRnpmRouter = new Hono();
adminRnpmRouter.use("*", requireRole("admin"));

// DOAR ENOENT inseamna absent (semantica v2.43.0); EACCES/EIO se propaga.
async function sizeOrNull(p: string): Promise<number | null> {
  try {
    return (await fsPromises.stat(p)).size;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw e;
  }
}

export interface AdminRnpmUsageRow {
  userId: string;
  email: string;
  displayName: string;
  status: string;
  dbSizeBytes: number | null;
  backupCount: number;
  backupsBytes: number;
}

adminRnpmRouter.get("/usage", async (c) => {
  const users = listAllUserIdentities(); // ordinea (email ASC) e contractul repository-ului
  const rows: AdminRnpmUsageRow[] = [];
  for (const u of users) {
    const dbPath = getRnpmDbPath(u.id); // pur read-only: NU provisioneaza (asta face doar getRnpmDb)
    const main = await sizeOrNull(dbPath);
    const wal = main === null ? null : await sizeOrNull(`${dbPath}-wal`);
    const shm = main === null ? null : await sizeOrNull(`${dbPath}-shm`);
    // listRnpmBackups: filtrare RNPM_PREFIX + sufix; jail absent (ENOENT) => [];
    // EACCES/EIO se propaga. sizeBytes = snapshot self-contained (VACUUM INTO);
    // sidecar-urile bundle-urilor legacy nu sunt numarate (subestimare acceptata).
    const backups = await listRnpmBackups(u.id);
    rows.push({
      userId: u.id,
      email: u.email,
      displayName: u.display_name,
      status: u.status,
      dbSizeBytes: main === null ? null : main + (wal ?? 0) + (shm ?? 0),
      backupCount: backups.length,
      backupsBytes: backups.reduce((sum, b) => sum + b.sizeBytes, 0),
    });
  }
  return c.json(ok({ rows }, c));
});
```

Mount in `index.ts` (INTRE cele doua mount-uri admin existente, `:458-459`):

```ts
app.route("/api/v1/admin/backups", adminBackupsRouter);
app.route("/api/v1/admin/rnpm", adminRnpmRouter);
app.route("/api/v1/admin", adminRouter);
```

(import: `import { adminRnpmRouter } from "./routes/adminRnpm.ts";`)

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/routes/adminRnpm.test.ts src/routes/adminBackups.test.ts src/index.test.ts`

- [ ] **Step 5: Gate (fara commit)**: `npx biome check --write backend/src/routes/adminRnpm.ts backend/src/routes/adminRnpm.test.ts backend/src/index.ts && npx tsc --noEmit -p backend/tsconfig.json`

---

### Task 3: `POST /api/rnpm/compact` cross-owner pentru admin

**Files:**
- Modify: `backend/src/routes/rnpm.ts` (ruta `/compact`, ~:992)
- Test: `backend/src/routes/rnpmBackups.contract.test.ts`

**Interfaces:**
- Consumes: `resolveBackupOwner(c, requested)` (function declaration la `rnpm.ts:1032` — HOISTED, apelabila din ruta de la :992; verificat de Codex); `compactRnpmDbViaWorker(ownerId)` (`backup.ts:1109` — opereaza exclusiv pe ownerId, ZERO presupuneri caller=owner, verificat de Codex); `isRnpmRestoreInProgress`, `rnpmFileExists`, `recordAuditSafe` (accepta `ownerId` — pattern T8), `isTypedMaintenanceError`, `invalidParams`, `notFound`, `getOwnerId` (toate existente in fisier).
- Produces: `POST /compact?ownerId=<id>` — adminul compacteaza fisierul userului tinta; raspunsul ramane `{ ok: true, beforeBytes, afterBytes, durationMs }`. Task 4 consuma prin `rnpmCompactDb(ownerId?)`.

- [ ] **Step 1: Teste failing** in `rnpmBackups.contract.test.ts`. **Harness (corectie Codex): NU exista `buildAdminApp` — foloseste `buildApp("admin1")`** (fixture-urile `u1`/`admin1` exista deja; `seedRnpm`, `DESKTOP`, `getAuditEvents`, `beginRnpmSearch`/`endRnpmSearch` exista in fisier — verifica semnaturile la fata locului). `getAuditEvents({action})[0]` = cel mai nou eveniment (pattern-ul consacrat al fisierului).

```ts
describe("POST /compact cross-owner (admin rnpm storage)", () => {
  it("adminul compacteaza fisierul altui owner prin ?ownerId=", async () => {
    seedRnpm("u1", "a");
    const res = await buildApp("admin1").request("/api/rnpm/compact?ownerId=u1", { method: "POST", headers: DESKTOP });
    expect(res.status).toBe(200);
    const audits = getAuditEvents({ action: "rnpm.compact" });
    expect(audits[0]?.owner_id).toBe("u1"); // userul AFECTAT, nu adminul
    expect(JSON.parse(audits[0]?.detail_json ?? "{}").targetOwnerId).toBe("u1");
  });

  it("non-adminul cu ?ownerId= strain e ignorat silentios (opereaza pe fisierul propriu)", async () => {
    seedRnpm("u1", "a");
    // u1 isi are propriul fisier; tinteste un owner strain si ramane pe al lui
    const res = await buildApp("u1").request("/api/rnpm/compact?ownerId=admin1", { method: "POST", headers: DESKTOP });
    expect(res.status).toBe(200);
    const audits = getAuditEvents({ action: "rnpm.compact" });
    expect(audits[0]?.owner_id).toBe("u1"); // propriul fisier, nu admin1
    expect(JSON.parse(audits[0]?.detail_json ?? "{}").targetOwnerId).toBeUndefined();
  });

  it("ownerId invalid de la admin => 400, nu 500", async () => {
    const res = await buildApp("admin1").request("/api/rnpm/compact?ownerId=..%2F..%2Fetc", {
      method: "POST",
      headers: DESKTOP,
    });
    expect(res.status).toBe(400);
  });

  it("admin pe owner fara fisier => 404 CU audit denied pe ownerul tinta", async () => {
    // u2 exista ca user dar nu are fisier RNPM (insertUser in beforeEach sau aici)
    const res = await buildApp("admin1").request("/api/rnpm/compact?ownerId=u2", { method: "POST", headers: DESKTOP });
    expect(res.status).toBe(404);
    const audits = getAuditEvents({ action: "rnpm.compact" });
    expect(audits[0]?.outcome).toBe("denied");
    expect(audits[0]?.owner_id).toBe("u2");
  });

  it("cautare activa la userul TINTA => 409 cu audit denied pe ownerul tinta", async () => {
    seedRnpm("u1", "a");
    beginRnpmSearch("u1");
    try {
      const res = await buildApp("admin1").request("/api/rnpm/compact?ownerId=u1", { method: "POST", headers: DESKTOP });
      expect(res.status).toBe(409);
      const audits = getAuditEvents({ action: "rnpm.compact" });
      expect(audits[0]?.outcome).toBe("denied");
      expect(audits[0]?.owner_id).toBe("u1");
    } finally {
      endRnpmSearch("u1");
    }
  });
});
```

(NOTA: daca `resolveBackupOwner` valideaza ownerId INAINTE de a verifica rolul, testul 3 poate necesita un ownerId invalid dar URL-safe — verifica implementarea reala si ajusteaza payload-ul; important e contractul 400.)

- [ ] **Step 2: Run — FAIL**: `cd backend && npx vitest run src/routes/rnpmBackups.contract.test.ts -t "compact cross-owner"`

- [ ] **Step 3: Implementeaza** in ruta `/compact` din `rnpm.ts` — pastreaza TOT restul rutei (restore-check-first, `rnpmFileExists`, mesajul generic pe 500, comentariile):

```ts
rnpmRouter.post("/compact", requireDesktopHeader, requireRole("admin", "user"), async (c) => {
  // v2.43.x (admin rnpm storage): adminul poate tinti alt owner prin
  // ?ownerId= — acelasi mecanism ca la backups (resolveBackupOwner: non-admin
  // e ignorat silentios, ownerId invalid de la admin = 400).
  let ownerId: string;
  try {
    ownerId = resolveBackupOwner(c, c.req.query("ownerId"));
  } catch (e) {
    return invalidParams(c, e instanceof Error ? e.message : "ownerId invalid");
  }
  const caller = getOwnerId(c);
  const targetDetail = ownerId === caller ? undefined : ownerId;
  // ... restore-check-first EXISTENT, cu audit pe ramura 404 (corectie Codex:
  // tentativa admin pe owner fara fisier trebuie sa lase urma in audit):
  if (!isRnpmRestoreInProgress(ownerId) && !(await rnpmFileExists(getRnpmDbPath(ownerId)))) {
    recordAuditSafe(c, "rnpm.compact", {
      targetKind: "rnpm_db",
      ownerId,
      outcome: "denied",
      detail: { error: "rnpm_db_not_found", targetOwnerId: targetDetail },
    });
    return notFound(c, "Baza RNPM nu exista inca pentru acest cont");
  }
  // ... try/catch EXISTENT, cu ownerId + targetOwnerId adaugate in AMBELE audituri:
  //   succes:  recordAuditSafe(c, "rnpm.compact", { targetKind: "rnpm_db", ownerId,
  //              detail: { beforeBytes: result.beforeBytes, afterBytes: result.afterBytes, targetOwnerId: targetDetail } });
  //   eroare:  recordAuditSafe(c, "rnpm.compact", { targetKind: "rnpm_db", ownerId,
  //              outcome: isTypedMaintenanceError(e) ? "denied" : "error",
  //              detail: { error: msg, targetOwnerId: targetDetail } });
});
```

- [ ] **Step 4: Run — PASS**: `cd backend && npx vitest run src/routes/rnpmBackups.contract.test.ts src/routes/rnpm.contract.test.ts`

- [ ] **Step 5: Gate (fara commit)**: `npx biome check --write backend/src/routes/rnpm.ts backend/src/routes/rnpmBackups.contract.test.ts && npx tsc --noEmit -p backend/tsconfig.json`

---

### Task 4: Frontend — client API + card admin "Stocare RNPM"

**Files:**
- Create: `frontend/src/lib/adminRnpmApi.ts` + `frontend/src/lib/adminRnpmApi.test.ts`
- Modify: `frontend/src/lib/rnpmApi.ts` (functia `rnpmCompactDb`, ~:367)
- Create: `frontend/src/pages/admin/RnpmStorage.tsx` + `frontend/src/pages/admin/RnpmStorage.test.tsx`
- Modify: `frontend/src/pages/Settings.tsx` (tab-ul "backup", ~:155-161)

**Interfaces:**
- Consumes: `apiFetch` + `unwrapMonitoring` din `@/lib/api` (`unwrapMonitoring<T>(res: Response)` — primeste UN Response, verificat `api.ts:496`); `formatBytes` din `@/lib/utils` (EXISTA exportat la `utils.ts:43`, `toFixed(1)` → "2.0 MB" — corectie Codex: NU extrage/duplica); `rnpmCompactDb` din `rnpmApi.ts:367`; `ApiError` din `rnpmApi.ts:56` (constructor `(message, status, code?, requestId?)` — verificat); `useConfirm`/`ConfirmProvider` din `@/components/ui/confirm-dialog`; `Card/Button/Badge`.
- Produces: `adminListRnpmUsage(signal?: AbortSignal): Promise<AdminRnpmUsageRow[]>`; `rnpmCompactDb(ownerId?: string)`; componenta default-export `AdminRnpmStorage({ embedded })` montata in Settings.

- [ ] **Step 1: Teste failing** — `adminRnpmApi.test.ts` (pattern EXACT `adminBackupsApi.test.ts`: `vi.mock("@/lib/api")` cu `importOriginal`, `jsonResponse`, `mockReset` in `beforeEach`):

```ts
it("adminListRnpmUsage intoarce rows din envelope si paseaza signal-ul", async () => {
  const rows = [{ userId: "u1", email: "a@x.ro", displayName: "A", status: "active", dbSizeBytes: 1024, backupCount: 2, backupsBytes: 2048 }];
  mockApiFetch.mockResolvedValue(jsonResponse(200, { data: { rows }, requestId: "rid-1" }));
  const ac = new AbortController();
  await expect(adminListRnpmUsage(ac.signal)).resolves.toEqual(rows);
  expect(mockApiFetch).toHaveBeenCalledWith("/api/v1/admin/rnpm/usage", { signal: ac.signal });
});

it("eroarea envelope pastreaza code/status/requestId", async () => {
  mockApiFetch.mockResolvedValue(
    jsonResponse(500, { data: null, error: { code: "INTERNAL_ERROR", message: "Eroare interna" }, requestId: "rid-2" })
  );
  await expect(adminListRnpmUsage()).rejects.toMatchObject({ status: 500, requestId: "rid-2" });
});
```

si `RnpmStorage.test.tsx` (createRoot + act; mock pe `@/lib/adminRnpmApi` si `@/lib/rnpmApi`; monteaza sub `ConfirmProvider`):

```tsx
it("randeaza un rand per user cu dimensiuni formatate si — pentru user fara fisier", async () => {
  usageMock.mockResolvedValue([
    { userId: "u1", email: "a@x.ro", displayName: "A", status: "active", dbSizeBytes: 2 * 1024 * 1024, backupCount: 1, backupsBytes: 1024 },
    { userId: "u2", email: "b@x.ro", displayName: "B", status: "suspended", dbSizeBytes: null, backupCount: 0, backupsBytes: 0 },
  ]);
  await render(<ConfirmProvider><AdminRnpmStorage embedded /></ConfirmProvider>);
  expect(host.textContent).toContain("a@x.ro");
  expect(host.textContent).toContain("2.0 MB"); // formatBytes real: toFixed(1)
  expect(host.textContent).toContain("—");
});

it("butonul Compacteaza cere confirmare si apeleaza rnpmCompactDb cu ownerId-ul randului", async () => {
  // click pe "Compacteaza" la u1 -> dialogul de confirmare apare -> click pe
  // butonul de confirmare (gaseste-l dupa text, ca in confirm-dialog.test.tsx)
  // -> compactMock called with "u1" -> lista se reincarca (usageMock chemat din nou).
});

it("raspunsul stale al listei nu suprascrie un reload mai nou", async () => {
  // usageMock intoarce intai un promise controlat P1 (lista veche), apoi P2 (lista noua);
  // declanseaza reload (dupa un compact reusit), rezolva P2, APOI P1;
  // asertie: host-ul arata datele din P2 (pattern-ul staleness din Quota.test.tsx).
});

it("409 (operatie RNPM in curs la userul tinta) se afiseaza ca mesaj prietenos", async () => {
  // compactMock.mockRejectedValue(new ApiError("Exista o cautare RNPM in curs", 409, "SEARCH_ACTIVE"));
  // dupa click+confirm: host.textContent contine "operatie RNPM in curs" (nu crash, nu mesajul brut de retea).
});
```

(Scheletele 2-4 se concretizeaza pe harness-ul real: `confirm-dialog.test.tsx` are pattern-ul de gasit butoane dupa text; `Quota.test.tsx` are pattern-ul de promise-uri controlate pentru staleness.)

- [ ] **Step 2: Run — FAIL**: `cd frontend && npx vitest run src/lib/adminRnpmApi.test.ts src/pages/admin/RnpmStorage.test.tsx`

- [ ] **Step 3: Implementeaza**

(a) `adminRnpmApi.ts` (corectie Codex: parametrul `signal` e OBLIGATORIU in semnatura — fara el AbortController-ul din componenta nu anuleaza nimic):

```ts
// v2.43.x (admin rnpm storage): client pentru GET /api/v1/admin/rnpm/usage —
// envelope standard, erori prin unwrapMonitoring (code/status/requestId pastrate).
import { apiFetch, unwrapMonitoring } from "@/lib/api";

export interface AdminRnpmUsageRow {
  userId: string;
  email: string;
  displayName: string;
  status: string;
  dbSizeBytes: number | null;
  backupCount: number;
  backupsBytes: number;
}

export async function adminListRnpmUsage(signal?: AbortSignal): Promise<AdminRnpmUsageRow[]> {
  const data = await unwrapMonitoring<{ rows: AdminRnpmUsageRow[] }>(
    await apiFetch("/api/v1/admin/rnpm/usage", { signal })
  );
  return data.rows;
}
```

(b) `rnpmApi.ts` — parametru optional (backward-compatible):

```ts
export async function rnpmCompactDb(ownerId?: string): Promise<RnpmCompactResult> {
  const qs = ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : "";
  const res = await apiFetch(`${BASE}/compact${qs}`, { method: "POST" });
  return jsonOrThrow<RnpmCompactResult>(res);
}
```

(c) `RnpmStorage.tsx` — card embedded pe modelul `Backups.tsx` (`export default function AdminRnpmStorage({ embedded = false })`):
- Fetch la mount SI la reload cu **AbortController tinut in ref + anulare a requestului precedent + anulare la unmount + fara setState dupa abort** (exact pattern-ul staleness din `Quota.tsx`/`Grants.tsx`, commit `9805ea5`).
- Stari: `loading/error/rows/busyOwnerId/successMsg`.
- Tabel: Email (+displayName; `Badge` cu statusul cand nu e "active"), "Baza" (`formatBytes(dbSizeBytes)` sau "—"), "Backup-uri" (`{count} ({formatBytes(bytes)})`), actiune "Compacteaza" per rand (disabled cand `dbSizeBytes === null` sau `busyOwnerId !== null`).
- Lista se afiseaza IN ORDINEA primita (repository-ul garanteaza email ASC — decizia 1; fara sortare client).
- Confirmare prin `useConfirm` (NON-destructive): "Compactezi baza RNPM a userului <email>? Operatia elibereaza spatiul nefolosit si poate dura cateva secunde."
- Pe succes: `successMsg` discret "Compactat: <before> -> <after>" (formatBytes) + reload lista.
- Pe `ApiError` cu `status === 409`: mesaj "Userul are o operatie RNPM in curs (cautare sau restaurare); reincearca dupa finalizare." Alte erori: mesajul erorii.

(d) `Settings.tsx` — in tab-ul "backup", sub `AdminBackups`, in ACELASI `AdminGate` si `Suspense` (corectie Codex — un singur Suspense pentru ambele carduri):

```tsx
const AdminRnpmStorage = lazy(() => import("@/pages/admin/RnpmStorage"));
// ...
{activeTab === "backup" && (
  <AdminGate>
    <Suspense fallback={fallback}>
      <AdminBackups embedded />
      <AdminRnpmStorage embedded />
    </Suspense>
  </AdminGate>
)}
```

- [ ] **Step 4: Run — PASS**: `cd frontend && npx vitest run && npx tsc --noEmit`

- [ ] **Step 5: Gate (fara commit)**: `npx biome check --write` pe toate fisierele atinse.

---

### Task 5: Gate final integral (fara commit)

Ordinea e OBLIGATORIE (corectie Codex: rebuild-ul Electron inaintea oricarui pas Node ar reintroduce mismatch-ul ABI):

- [ ] **Step 1**: `npm rebuild better-sqlite3` (asigura ABI-ul Node), apoi `npm run check` — backend + frontend integral verde.
- [ ] **Step 2**: `npm run build` — bundle curat.
- [ ] **Step 3**: Smoke web local (`pwsh -File scripts/dev-web-local.ps1 -SkipBuild` + script Node cu cookie in memorie, pattern `smoke-web.mjs` din scratchpad):
  - GET `/api/v1/admin/rnpm/usage` ca admin → envelope cu rows (userul admin + userul normal).
  - Ca user normal: intai un search/insert RNPM minim ca sa-i existe fisierul (altfel compactul propriu da legitim 404 — corectie Codex), apoi POST `/api/rnpm/compact?ownerId=<adminul>` ca user normal → verifica pe raspuns + usage ca s-a compactat fisierul PROPRIU al userului normal, nu al adminului (ignorare silentioasa).
  - POST `/api/rnpm/compact?ownerId=<userul normal>` ca ADMIN → 200; usage-ul reflecta compactarea; (audit-ul cu owner_id = userul normal e acoperit de testele contract — smoke-ul verifica doar comportamentul HTTP).
  - Opreste stack-ul la final (`Stop-Process` pe PID-urile raportate).
- [ ] **Step 4**: `npm run rebuild:electron` — ULTIMUL pas, dupa orice test/proces Node (mediul dev desktop ramane functional; smoke-ul Electron impachetat NU e in scope — pas de release desktop, decizie user web-first).
- [ ] **Step 5**: Raport catre user cu diff-ul complet — **COMMIT DOAR DUPA OK-ul LUI EXPLICIT**.

## Follow-up (in afara scope-ului, de notat)

1. Fisiere orfane in `rnpm/` (stem fara user) — detectie + curatare admin.
2. Alerta de dimensiune (prag configurabil) pe usage.
3. Delete-all cross-owner cu flux GDPR dedicat.
4. Numararea bytes-ilor sidecar pentru bundle-urile legacy de backup (subestimare mica azi).
