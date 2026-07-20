# Fixes post-review backend v2.42.0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inchide toate findings-urile confirmate din review-ul paralel (5 agenti) pe delta backend `main...feat/v2.42.0-users-settings`, plus feature-ul nou: cota alocata + consum vizibile in fereastra AI Usage a userului.

**Architecture:** Fixuri chirurgicale pe branch-ul existent `feat/v2.42.0-users-settings`, fara refactor. Invariantul last-admin coboara in repository (tranzactie sincrona better-sqlite3 = inchide cursa check-then-act). Audit-ul post-mutatie devine fail-safe printr-un wrapper central `recordAuditSafe`. Feature-ul de cota reuses `GET /me/budget` aliniat la regula guard-ului.

**Tech Stack:** Node 22 + Hono + better-sqlite3 (backend), React 18 + Vite + Tailwind (frontend), Vitest, Biome.

## Global Constraints

- Branch: `feat/v2.42.0-users-settings` — NIMIC pe main (regula sprint).
- Inainte de FIECARE commit: `npx biome check --write <fisiere>` + `npx tsc --noEmit -p backend/tsconfig.json` (+ `cd frontend && npx tsc --noEmit` daca s-a atins frontend) + testele workspace-ului atins. Niciun push fara toate gate-urile verzi (CLAUDE.md, non-negotiable).
- SQL raw NOU doar in `backend/src/db/**` (repository-only).
- Envelope standard `{ data, error: { code, message }, requestId }` pe orice raspuns nou; `ok()`/`fail()` din `util/envelope.ts`.
- Romana fara diacritice in cod sursa si mesaje.
- Zero features in plus fata de acest plan; schimbari chirurgicale — nu "imbunatati" cod adiacent.
- Dupa teste Node care ating `better-sqlite3`: ruleaza `npm run rebuild:electron` la final de sesiune daca urmeaza smoke Electron.
- Liniile citate din `admin.ts` devin APROXIMATIVE dupa Task 4 (care sterge ~19 linii de pre-check) — ancoreaza edit-urile pe continutul snippet-urilor, nu pe numerele de linie.
- Comenzile de gate se ruleaza intr-un singur shell; pentru pasii de frontend foloseste subshell `(cd frontend && ...)` ca directorul curent sa nu ramana blocat la esec. Nu amesteca sintaxa PowerShell (`2>$null`) in lanturi bash.

## Decizii luate (asumptii explicite — de validat in review adversarial)

1. **Multi-agent overshoot NU se repara** (estimat flat $8, fara re-check inainte de judge): tradeoff DEJA documentat in `quotaGuard.ts:71-73` ("PLAN §12 accepted tradeoff"). Repararea ar insemna respingere mid-stream dupa 2 call-uri analiste platite — UX mai rau decat overshoot-ul. Se pastreaza; comentariul existent acopera.
2. **`/usage/overview` ramane O(n)** dar cu `USAGE_OVERVIEW_CAP` redus 2000 → 500, aliniat la asumptia documentata "zeci de useri". Agregarea set-based e amanata (web enforce real e oricum viitor).
3. **`recordAuditSafe` doar pe site-urile POST-mutatie din `admin.ts`** — audit-urile "denied" pre-raspuns raman cu `recordAudit` (nicio mutatie comisa, un 500 acolo nu minte).
4. **`/me/budget` se aliniaza la regula guard-ului** pentru feature-ul "ai": baseLimit = override ?? `readDefaultQuotaMilli()` si fereastra rolling (`sumAiUsageMilliInWindow`) in loc de `sumAiUsageMilliToday`. Fara asta, cota afisata userului diverge de enforcement (guard blocheaza pe rolling 24h + default env, panoul ar arata "nelimitat").
5. **Acceptate fara fix de cod** (documentate in Task 14): timeout xlsx non-cancelling (512KB cap + admin-only), fallback OpenAI cu timeout fresh (~2x worst-case, deliberat), fereastra queueMicrotask la crash (desktop informativ), 0042 skip silentios pe date neparsabile (probabil 0 randuri), model id nativ `claude-sonnet-5` fara env override (mitigare: schimbare model din UI; verificare GA la tag time), 0040 pre-flight duplicate emails (procedura operationala in RUNBOOK, nu cod).

---

### Task 1: Biome format pass pe static-frontend.ts

**Files:**
- Modify: `backend/src/middleware/static-frontend.ts:67-69`

**Interfaces:** nimic — reformatare pura.

- [ ] **Step 1: Ruleaza formatter-ul**

Run: `npx biome check --write backend/src/middleware/static-frontend.ts`
Expected: 1 fisier fixat (ternarul multi-line de la 67-69 colapsat pe o linie).

- [ ] **Step 2: Verifica ca nu s-a rupt nimic**

Run: `npx biome check backend/src/middleware/static-frontend.ts && npx tsc --noEmit -p backend/tsconfig.json`
Expected: ambele exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/src/middleware/static-frontend.ts
git commit -m "style: biome format pass pe static-frontend.ts (ternar cache-control)"
```

---

### Task 2: Corectii documentatie bump (README + CHANGELOG typo)

**Files:**
- Modify: `README.md:13`
- Modify: `CHANGELOG.md:49`
- Verify: `frontend/src/data/changelog-entries.tsx` (acelasi typo, daca exista)

- [ ] **Step 1: Rescrie paragraful "Ultimul release" din README.md:13**

Inlocuieste integral paragraful care incepe cu `Ultimul release **v2.40.0**` cu:

```markdown
Ultimul release **v2.42.0** - Administrare utilizatori completa in web mode: creare individuala si import xlsx cu template descarcabil (email unic case-insensitive, reactivare conturi sterse), pagina Setari pe taburi cu cele 6 pagini admin integrate, pool unic de cota AI cu granturi temporare si revocare, tab Consum per utilizator (AI + captcha), jurnal de audit cu email-uri si export xlsx, plus modelul Claude Sonnet 5 pe pozitia "Echilibrat". Desktop: zero impact functional. Predecesor **v2.41.0** - fundatia web UX: mediu local de testare cu doua proxy-uri simuland oauth2-proxy, layout web fara chrome Electron, status chei tenant pe roluri si vederi globale pentru Cote si Granturi (baza integrala a v2.42, fara artefact propriu de release).
```

- [ ] **Step 2: Repara typo-ul din CHANGELOG.md:49**

In `CHANGELOG.md:49`, inlocuieste `(Configurata *ultimele4 / Neconfigurata)` cu `(Configurata, cu ultimele 4 caractere ale cheii / Neconfigurata)`.

- [ ] **Step 3: Cauta acelasi typo in changelog-ul in-app**

Run: `Grep "ultimele4" frontend/src/data/changelog-entries.tsx`
Daca exista hit: aplica aceeasi corectie de text.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
# adauga changelog-entries.tsx DOAR daca Step 3 l-a modificat:
# git add frontend/src/data/changelog-entries.tsx
git commit -m "docs: README ultimul release pe v2.42.0 + typo ultimele4 in changelog"
```

---

### Task 3: recordAuditSafe — audit fail-safe dupa mutatii comise

**Files:**
- Modify: `backend/src/db/auditRepository.ts` (adauga functia sub `recordAudit`, ~linia 134)
- Modify: `backend/src/routes/admin.ts` (site-urile post-mutatie)
- Test: `backend/src/routes/admin.test.ts` (sau fisierul de teste al auditRepository, daca exista — verifica cu Glob `backend/src/db/auditRepository.test.ts`)

**Interfaces:**
- Produces: `recordAuditSafe(c: Context | null, action: string, options?: AuditOptions): void` — exportata din `auditRepository.ts`; NU arunca niciodata; la esec scrie `console.error("[audit] write failed for <action>: ...")`.
- Consumes: `recordAudit` existent (semnatura neschimbata).

- [ ] **Step 1: Scrie testul care pica**

In fisierul de teste ales (pattern DB real din admin.test.ts — `mkdtemp` + `getDb()`):

```ts
import { recordAudit, recordAuditSafe } from "../db/auditRepository.ts";
import { getDb } from "../db/schema.ts";

describe("recordAuditSafe", () => {
  it("nu arunca si logheaza cand scrierea de audit esueaza", () => {
    const db = getDb();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prepareSpy = vi.spyOn(db, "prepare").mockImplementation(() => {
      throw new Error("SQLITE_BUSY: database is locked");
    });
    try {
      expect(() => recordAuditSafe(null, "test.safe_write")).not.toThrow();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("[audit] write failed for test.safe_write"),
        expect.anything()
      );
      // Contrast: recordAudit propaga aceeasi eroare (contractul existent).
      expect(() => recordAudit(null, "test.safe_write")).toThrow("SQLITE_BUSY");
    } finally {
      prepareSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Ruleaza testul — trebuie sa pice**

Run: `npm run test:backend -- --run -t "recordAuditSafe"`
Expected: FAIL — `recordAuditSafe` nu exista.

- [ ] **Step 3: Implementeaza recordAuditSafe**

In `auditRepository.ts`, imediat sub `recordAudit` (dupa linia 133):

```ts
// Varianta pentru site-urile POST-mutatie: mutatia e deja comisa in DB, deci
// un esec al scrierii de audit nu are voie sa transforme succesul intr-un 500
// mincinos (clientul ar retria o operatie deja reusita). Logam structurat si
// continuam. Pentru audit-urile pre-raspuns (denied/blocked) ramane
// recordAudit — acolo nu exista mutatie comisa de protejat.
export function recordAuditSafe(c: Context | null, action: string, options: AuditOptions = {}): void {
  try {
    recordAudit(c, action, options);
  } catch (err) {
    console.error(`[audit] write failed for ${action}:`, err instanceof Error ? err.message : err);
  }
}
```

- [ ] **Step 4: Ruleaza testul — trebuie sa treaca**

Run: `npm run test:backend -- --run -t "recordAuditSafe"`
Expected: PASS.

- [ ] **Step 5: Inlocuieste call-site-urile post-mutatie din admin.ts**

Adauga `recordAuditSafe` la importul din `../db/auditRepository.ts` si inlocuieste `recordAudit` cu `recordAuditSafe` EXACT la aceste site-uri (mutatia e comisa inainte de audit):

1. `admin.ts:278` — `admin.users.create` (reactivare reusita)
2. `admin.ts:306` — `admin.users.create` (insert reusit)
3. `admin.ts:492` — `admin.users.update_role`
4. `admin.ts:527` — `admin.users.update_status`
5. `admin.ts:719` — `admin.tenantKeys.captchaSettings.update`
6. `admin.ts:765` — `admin.tenantKeys.update`
7. `admin.ts:843` — `admin.users.quota_upsert`
8. `admin.ts:879` — `admin.users.quota_delete`
9. `admin.ts:953` — `admin.users.grant_create`
10. `admin.ts:993` — `admin.users.grant_revoke`
11. `admin.ts:664` — `admin.audit.export` (xlsx-ul e DEJA generat; un esec de audit ar transforma munca facuta intr-un 500 fals — acelasi pattern, semnalat de review-panel)

NU atinge: audit-urile `outcome: "denied"` (287, 478, 517) si `audit.viewed` (571) — pre-raspuns, fara mutatie comisa; pentru `audit.viewed` esecul LOUD e preferabil (jurnalizarea vizualizarilor de audit e ea insasi relevanta pentru conformitate). Nu atinge nici blocul deja protejat cu try/catch din `/users/import` (408-430).

- [ ] **Step 6: Gate + commit**

Run: `npx biome check --write backend/src/db/auditRepository.ts backend/src/routes/admin.ts && npx tsc --noEmit -p backend/tsconfig.json && npm run test:backend -- --run`
Expected: totul verde (1665+ teste).

```bash
git add backend/src/db/auditRepository.ts backend/src/routes/admin.ts backend/src/routes/admin.test.ts
git commit -m "fix(audit): recordAuditSafe pe site-urile post-mutatie — succesul comis nu mai poate deveni 500"
```

---

### Task 4: Invariantul last-admin atomic, pe orice admin (nu doar self)

**Files:**
- Modify: `backend/src/db/userRepository.ts` (functii noi sub `updateUserStatus`, ~linia 152)
- Modify: `backend/src/routes/admin.ts:457-533` (PATCH role + PATCH status)
- Test: `backend/src/db/userRepository.test.ts`

**Interfaces:**
- Produces: `class LastAdminError extends Error` (are `name = "LastAdminError"`); `updateUserRoleChecked(id: string, role: UserRole): UserRow`; `updateUserStatusChecked(id: string, status: UserStatus): UserRow` — ambele arunca `LastAdminError` daca mutatia ar lasa 0 admini activi, `Error("user not found: ...")` daca randul lipseste. Exportate din `userRepository.ts`.
- Consumes: `getDb()`, `getUserById()`, constantele `USER_ROLES`/`USER_STATUSES` existente.
- `updateUserRole`/`updateUserStatus` (unchecked) RAMAN exportate — alte call-site-uri (seed, teste) nu se schimba. Verifica cu `Grep "updateUserRole\(|updateUserStatus\(" backend/src --type ts` ca singurele apeluri de RUTA sunt cele din admin.ts.

- [ ] **Step 1: Scrie testele care pica (userRepository.test.ts)**

```ts
import {
  insertUser,
  LastAdminError,
  updateUserRoleChecked,
  updateUserStatusChecked,
} from "./userRepository.ts";

describe("invariantul ultimul admin activ (checked updates)", () => {
  it("blocheaza demotarea singurului admin activ", () => {
    insertUser({ id: "a1", email: "a1@x.ro", displayName: "A1", role: "admin" });
    expect(() => updateUserRoleChecked("a1", "user")).toThrow(LastAdminError);
  });

  it("blocheaza suspendarea singurului admin activ", () => {
    insertUser({ id: "a1", email: "a1@x.ro", displayName: "A1", role: "admin" });
    expect(() => updateUserStatusChecked("a1", "suspended")).toThrow(LastAdminError);
  });

  it("permite demotarea cand ramane alt admin activ", () => {
    insertUser({ id: "a1", email: "a1@x.ro", displayName: "A1", role: "admin" });
    insertUser({ id: "a2", email: "a2@x.ro", displayName: "A2", role: "admin" });
    expect(updateUserRoleChecked("a2", "user").role).toBe("user");
  });

  it("un admin suspendat NU conteaza ca activ la numaratoare", () => {
    insertUser({ id: "a1", email: "a1@x.ro", displayName: "A1", role: "admin" });
    insertUser({ id: "a2", email: "a2@x.ro", displayName: "A2", role: "admin", status: "suspended" });
    expect(() => updateUserRoleChecked("a1", "user")).toThrow(LastAdminError);
  });

  it("suspendarea secventiala a doi admini: primul trece, al doilea e blocat", () => {
    insertUser({ id: "a1", email: "a1@x.ro", displayName: "A1", role: "admin" });
    insertUser({ id: "a2", email: "a2@x.ro", displayName: "A2", role: "admin" });
    updateUserStatusChecked("a2", "suspended");
    expect(() => updateUserStatusChecked("a1", "suspended")).toThrow(LastAdminError);
  });

  it("demotarea unui admin deja suspendat nu e blocata (nu reduce numarul activ)", () => {
    insertUser({ id: "a1", email: "a1@x.ro", displayName: "A1", role: "admin" });
    insertUser({ id: "a2", email: "a2@x.ro", displayName: "A2", role: "admin", status: "suspended" });
    expect(updateUserRoleChecked("a2", "user").role).toBe("user");
  });

  it("mutatiile pe non-admin nu sunt afectate", () => {
    insertUser({ id: "a1", email: "a1@x.ro", displayName: "A1", role: "admin" });
    insertUser({ id: "u1", email: "u1@x.ro", displayName: "U1" });
    expect(updateUserStatusChecked("u1", "suspended").status).toBe("suspended");
  });
});
```

- [ ] **Step 2: Ruleaza — trebuie sa pice**

Run: `npm run test:backend -- --run -t "invariantul ultimul admin"`
Expected: FAIL — exporturile nu exista.

- [ ] **Step 3: Implementeaza in userRepository.ts**

Sub `updateUserStatus` (dupa linia 151):

```ts
// Fix review v2.42.0: invariantul ">=1 admin activ" se verifica IN ACEEASI
// tranzactie cu write-ul si acopera ORICE admin, nu doar self. Guard-ul vechi
// de ruta avea doua lipsuri: (1) nu exista deloc check pe actiunile cross-admin
// si (2) intre requireRole (autorizarea actorului) si write sta await-ul de
// body — doua cereri reciproce (A suspenda B, B suspenda A) treceau amandoua
// de autorizare cand ambii erau inca activi si comiteau ambele write-uri =>
// 0 admini activi (lockout pe toata suprafata admin). Numaratoarea in
// tranzactie sincrona better-sqlite3 inchide ambele.
export class LastAdminError extends Error {
  constructor(id: string) {
    super(`last active admin: ${id}`);
    this.name = "LastAdminError";
  }
}

function assertNotLastActiveAdmin(id: string): void {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND id != ?")
    .get(id) as { n: number };
  if (row.n === 0) throw new LastAdminError(id);
}

export function updateUserRoleChecked(id: string, role: UserRole): UserRow {
  if (!USER_ROLES.includes(role)) throw new Error(`invalid role: ${role}`);
  const db = getDb();
  db.transaction(() => {
    const before = getUserById(id);
    if (before === null) throw new Error(`user not found: ${id}`);
    if (before.role === "admin" && before.status === "active" && role !== "admin") {
      assertNotLastActiveAdmin(id);
    }
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  }).immediate();
  return getUserById(id) as UserRow;
}

export function updateUserStatusChecked(id: string, status: UserStatus): UserRow {
  if (!USER_STATUSES.includes(status)) throw new Error(`invalid status: ${status}`);
  const db = getDb();
  db.transaction(() => {
    const before = getUserById(id);
    if (before === null) throw new Error(`user not found: ${id}`);
    if (before.role === "admin" && before.status === "active" && status !== "active") {
      assertNotLastActiveAdmin(id);
    }
    db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, id);
  }).immediate();
  return getUserById(id) as UserRow;
}
```

- [ ] **Step 4: Ruleaza — trebuie sa treaca**

Run: `npm run test:backend -- --run -t "invariantul ultimul admin"`
Expected: PASS.

- [ ] **Step 5: Rescrie rutele pe functiile checked**

In `admin.ts`, PATCH `/users/:id/role` — STERGE blocul de pre-check 470-489 (comentariu + if) si inlocuieste liniile 491-497 cu:

```ts
  let updated: ReturnType<typeof updateUserRoleChecked>;
  try {
    updated = updateUserRoleChecked(id, parsed.data.role);
  } catch (err) {
    if (err instanceof LastAdminError) {
      // Mesaj identic cu cel istoric pe self-demotion (testele + UI il asteapta);
      // formulare generica pe cazul cross-admin (atins doar sub cursa).
      const message =
        id === getOwnerId(c)
          ? "Nu te poti demota — esti singurul admin. Promoveaza un alt utilizator inainte."
          : "Este singurul admin activ — operatiunea ar lasa organizatia fara admin. Promoveaza un alt utilizator inainte.";
      recordAudit(c, "admin.users.demote_blocked", {
        outcome: "denied",
        targetKind: "user",
        targetId: id,
        detail: { reason: "last_admin", from: before.role, to: parsed.data.role },
      });
      return c.json(fail("last_admin", message, c), 409);
    }
    throw err;
  }
  recordAuditSafe(c, "admin.users.update_role", {
    targetKind: "user",
    targetId: id,
    detail: { before: before.role, after: updated.role },
  });
  return c.json(ok(toUserDto(updated), c), 200);
```

PATCH `/users/:id/status` — PASTREAZA guard-ul self (516-524, mesaj `self_deactivation` neschimbat) si inlocuieste liniile 526-532 cu:

```ts
  let updated: ReturnType<typeof updateUserStatusChecked>;
  try {
    updated = updateUserStatusChecked(id, parsed.data.status);
  } catch (err) {
    if (err instanceof LastAdminError) {
      recordAudit(c, "admin.users.deactivate_blocked", {
        outcome: "denied",
        targetKind: "user",
        targetId: id,
        detail: { reason: "last_admin", from: before.status, to: parsed.data.status },
      });
      return c.json(
        fail("last_admin", "Este singurul admin activ — operatiunea ar lasa organizatia fara admin.", c),
        409
      );
    }
    throw err;
  }
  recordAuditSafe(c, "admin.users.update_status", {
    targetKind: "user",
    targetId: id,
    detail: { before: before.status, after: updated.status },
  });
  return c.json(ok(toUserDto(updated), c), 200);
```

Actualizeaza importul din `../db/userRepository.ts`: adauga `LastAdminError, updateUserRoleChecked, updateUserStatusChecked`; STERGE `updateUserRole, updateUserStatus` din import DOAR daca admin.ts nu le mai foloseste nicaieri (verifica cu Grep in fisier).

NOTA (review-panel): Task 4 SUPRASCRIE la aceste linii edit-urile facute de Task 3 (recordAudit → recordAuditSafe pe update_role/update_status) — snippet-urile de mai sus contin deja forma finala (recordAuditSafe pe succes, recordAudit pe denied). Ancoreaza inlocuirea pe continut, nu pe textul exact pre-Task-3.

- [ ] **Step 6: Ruleaza suita admin — testele self-demotion existente trebuie sa treaca neschimbate**

Run: `npm run test:backend -- --run backend/src/routes/admin.test.ts`
Expected: PASS pe self-demotion (mesajul si codul `last_admin` sunt identice cu inainte). ATENTIE (review-panel): blocarea suspendarii/demotarii ultimului admin activ de catre ALT admin e SCHIMBARE DE COMPORTAMENT INTENTIONATA (inainte trecea). Cauta in admin.test.ts un eventual test care asuma ca suspendarea altui admin reuseste neconditionat — daca exista si pica pe noul 409, actualizeaza-l explicit si noteaza schimbarea in mesajul de commit.

- [ ] **Step 7: Gate + commit**

Run: `npx biome check --write backend/src/db/userRepository.ts backend/src/routes/admin.ts backend/src/db/userRepository.test.ts && npx tsc --noEmit -p backend/tsconfig.json && npm run test:backend -- --run`

```bash
git add backend/src/db/userRepository.ts backend/src/db/userRepository.test.ts backend/src/routes/admin.ts
git commit -m "fix(users): invariantul last-admin atomic in tranzactie, pe orice admin (inchide cursa cross-admin)"
```

---

### Task 5: /analyze-multi — buildPrompt inainte de rezervare (inchide leak-ul pre-stream)

**Files:**
- Modify: `backend/src/routes/ai.ts:303-305`

**Interfaces:** nimic nou — reordonare.

- [ ] **Step 1: Reordoneaza**

In `ai.ts`, inlocuieste liniile 303-305:

```ts
    const quotaReservation = reserveQuotaBudget(c, "ai.multi", reserveProvider);
    if (!quotaReservation.ok) return quotaReservation.response;
    const prompt = buildPrompt(dosar);
```

cu:

```ts
    // buildPrompt INAINTE de rezervare: intre reserveQuotaBudget si intrarea in
    // streamSSE nu mai exista niciun apel care poate arunca, deci un throw aici
    // nu mai poate lasa o rezervare pending orfana (release-ul traieste doar in
    // finally-ul stream-ului). Pandantul patternului reservationToRelease din
    // /analyze.
    const prompt = buildPrompt(dosar);
    const quotaReservation = reserveQuotaBudget(c, "ai.multi", reserveProvider);
    if (!quotaReservation.ok) return quotaReservation.response;
```

- [ ] **Step 2: Gate + commit**

Run: `npx biome check --write backend/src/routes/ai.ts && npx tsc --noEmit -p backend/tsconfig.json && npm run test:backend -- --run backend/src/routes/ai.contract.test.ts backend/src/services/ai.test.ts`
Expected: verde.

```bash
git add backend/src/routes/ai.ts
git commit -m "fix(ai): buildPrompt inainte de rezervarea de cota in analyze-multi — zero fereastra de leak pre-stream"
```

---

### Task 6: Refetch la 409 pe cursa de reactivare (status stale in raspuns + audit)

**Files:**
- Modify: `backend/src/routes/admin.ts:286-297`

**Interfaces:** consuma `getUserById` (deja importat).

- [ ] **Step 1: Inlocuieste blocul 409**

In `admin.ts`, inlocuieste blocul `if (existing !== null) { ... }` (liniile 286-297) cu:

```ts
  if (existing !== null) {
    // Cursa de reactivare: snapshot-ul `existing` e citit inainte ca alt admin
    // sa fi castigat reactivarea — statusul "deleted" din el poate fi deja
    // "active". Refetch, altfel si raspunsul si randul de audit mint permanent.
    const current = getUserById(existing.id) ?? existing;
    recordAudit(c, "admin.users.create", {
      outcome: "denied",
      targetKind: "user",
      targetId: current.id,
      detail: { reason: "email_exists", status: current.status },
    });
    return c.json(
      fail("email_exists", `Exista deja un cont cu acest email (status: ${USER_STATUS_RO[current.status]}).`, c),
      409
    );
  }
```

- [ ] **Step 2: Gate + commit**

Run: `npx biome check --write backend/src/routes/admin.ts && npx tsc --noEmit -p backend/tsconfig.json && npm run test:backend -- --run backend/src/routes/admin.test.ts`

```bash
git add backend/src/routes/admin.ts
git commit -m "fix(users): refetch status inainte de 409 email_exists — cursa de reactivare nu mai scrie status stale in audit"
```

---

### Task 7: getActorId pe atribuirea audit la quota/grants

**Files:**
- Modify: `backend/src/routes/admin.ts:835,944,990`

**Interfaces:** consuma `getActorId` (deja importat si folosit la 713/748).

- [ ] **Step 1: Inlocuieste cele 3 atribuiri**

La liniile 835 (PUT quota), 944 (POST grants), 990 (handleGrantRevoke), inlocuieste:

```ts
  const adminId = getOwnerId(c);
```

cu:

```ts
  // getActorId, nu getOwnerId: sub un token de acces actorul != owner, iar
  // updatedBy/grantedBy + audit-ul trebuie sa atribuie cine a executat efectiv.
  // Aliniat cu rutele de chei (PUT /keys/*).
  const adminId = getActorId(c);
```

(comentariul o singura data, la prima ocurenta; la celelalte doua doar schimbarea de functie).

- [ ] **Step 2: Gate + commit**

Run: `npx biome check --write backend/src/routes/admin.ts && npx tsc --noEmit -p backend/tsconfig.json && npm run test:backend -- --run backend/src/routes/admin.test.ts`

```bash
git add backend/src/routes/admin.ts
git commit -m "fix(admin): getActorId pe updatedBy/grantedBy si audit la quota si grants — atribuire consecventa cu rutele de chei"
```

---

### Task 8: Log server-side pe esecul de parse xlsx

**Files:**
- Modify: `backend/src/services/userImport.ts:86-88`

- [ ] **Step 1: Prinde si logheaza eroarea**

Inlocuieste:

```ts
  } catch {
    return { ok: false, code: "invalid_file", message: "Fisierul nu a putut fi citit ca .xlsx." };
  }
```

cu:

```ts
  } catch (err) {
    // O linie de diagnostic server-side — altfel "user a trimis junk" si
    // "regresie de parser" sunt indistinguibile din raspunsul sanitizat.
    console.error("[userImport] xlsx parse failed:", err instanceof Error ? err.message : err);
    return { ok: false, code: "invalid_file", message: "Fisierul nu a putut fi citit ca .xlsx." };
  }
```

- [ ] **Step 2: Gate + commit**

Run: `npx biome check --write backend/src/services/userImport.ts && npx tsc --noEmit -p backend/tsconfig.json && npm run test:backend -- --run backend/src/services/userImport.test.ts`

```bash
git add backend/src/services/userImport.ts
git commit -m "fix(import): log structurat pe esecul de parse xlsx inainte de mesajul sanitizat"
```

---

### Task 9: Sterge codul mort insertUsersBulk

**Files:**
- Modify: `backend/src/db/userRepository.ts:188-204`
- Modify: `backend/src/db/userRepository.test.ts` (testele care il refera)

- [ ] **Step 1: Confirma ca nu are caller de productie**

Run: `Grep "insertUsersBulk" backend/src frontend/src scripts`
Expected: hit-uri DOAR in `userRepository.ts` (definitie) si `userRepository.test.ts`. Daca apare alt caller, OPRESTE-TE si semnaleaza — nu sterge.

- [ ] **Step 2: Sterge functia si testele ei**

Sterge `insertUsersBulk` (userRepository.ts:188-204; pastreaza `BulkUserInput` — e folosit de `provisionUsersBulk`). Sterge testele din `userRepository.test.ts` care apeleaza `insertUsersBulk` DOAR daca scenariul e acoperit de testele `provisionUsersBulk`; daca un scenariu unic (ex. rol invalid in batch) exista doar pe `insertUsersBulk`, porteaza-l pe `provisionUsersBulk` in loc sa-l stergi.

- [ ] **Step 3: Gate + commit**

Run: `npx biome check --write backend/src/db/userRepository.ts backend/src/db/userRepository.test.ts && npx tsc --noEmit -p backend/tsconfig.json && npm run test:backend -- --run`

```bash
git add backend/src/db/userRepository.ts backend/src/db/userRepository.test.ts
git commit -m "refactor(users): sterge insertUsersBulk (mort — importul foloseste provisionUsersBulk)"
```

---

### Task 10: USAGE_OVERVIEW_CAP 2000 → 500

**Files:**
- Modify: `backend/src/routes/admin.ts:1021-1022`

- [ ] **Step 1: Reduce cap-ul si actualizeaza comentariul**

Inlocuieste liniile 1021-1022:

```ts
const USAGE_OVERVIEW_PAGE = 200;
const USAGE_OVERVIEW_CAP = 2000;
```

cu:

```ts
const USAGE_OVERVIEW_PAGE = 200;
// Cap aliniat la asumptia de design de mai sus ("zeci de useri"): 500 useri x
// ~5 query-uri sincrone = worst-case tolerabil pe event loop. 2000 permitea
// ~10k query-uri blocante intr-un singur handler. ATENTIE la semantica
// truncarii: taierea se face pe ordinea listUsers (created_at DESC) INAINTE de
// sortarea pe consum — peste cap, consumatori mari cu conturi vechi pot lipsi
// din raport; `truncated: true` semnaleaza asta in UI. Fix real la scara:
// agregare set-based (amanata deliberat).
const USAGE_OVERVIEW_CAP = 500;
```

- [ ] **Step 2: Verifica ca niciun test nu depinde de 2000**

Run: `Grep "USAGE_OVERVIEW_CAP|2000" backend/src/routes/admin.test.ts`
Expected: fara asertii pe valoarea 2000; daca exista, actualizeaza-le la 500.

- [ ] **Step 3: Gate + commit**

Run: `npx biome check --write backend/src/routes/admin.ts && npx tsc --noEmit -p backend/tsconfig.json && npm run test:backend -- --run backend/src/routes/admin.test.ts`

```bash
git add backend/src/routes/admin.ts
git commit -m "fix(usage): USAGE_OVERVIEW_CAP redus la 500 — aliniat cu asumptia O(n) documentata"
```

---

### Task 11: Filtrele paginii de audit ajung in export

**Files:**
- Modify: `backend/src/db/auditRepository.ts:330-341` (`listAuditEventsForExport`)
- Modify: `backend/src/routes/admin.ts:639-673` (`AuditExportQuerySchema` + ruta)
- Modify: `frontend/src/pages/admin/Audit.tsx:170-187` (`onExport`)
- Test: `backend/src/services/auditExport.test.ts` sau `backend/src/routes/admin.test.ts`

**Interfaces:**
- Produces: `listAuditEventsForExport(opts: Omit<ListAuditEventsOpts, "limit" | "offset"> = {})` — acelasi return `AuditExportRows`.
- `AuditExportQuerySchema` devine `ListAuditQuerySchema.omit({ page: true, pageSize: true })` — paritate garantata cu GET /audit.

- [ ] **Step 1: Scrie testul care pica**

In `admin.test.ts` (foloseste helper-ele de seed existente pentru audit):

```ts
it("exportul respecta filtrul actorId, nu doar intervalul de date", async () => {
  // seed: 2 evenimente, actori diferiti (foloseste recordAudit direct)
  recordAudit(null, "test.export_filter", { actorId: "user-a", ownerId: "user-a" });
  recordAudit(null, "test.export_filter", { actorId: "user-b", ownerId: "user-b" });

  const res = await appRequestAsAdmin("/api/v1/admin/audit/export?actorId=user-a");
  expect(res.status).toBe(200);
  // Parseaza xlsx-ul cu exceljs (pattern-ul din auditExport.test.ts) si verifica
  // ca exista exact 1 rand de date cu actorul user-a.
});
```

(adapteaza numele helper-ului de request admin la cel folosit in restul fisierului; asertia pe continut foloseste acelasi loader exceljs ca `auditExport.test.ts`).

- [ ] **Step 2: Ruleaza — trebuie sa pice**

Expected: FAIL — query-ul `actorId` e respins de `.strict()` (400) sau ignorat.

- [ ] **Step 3: Extinde repository-ul**

In `auditRepository.ts`, schimba semnatura (linia 330):

```ts
export function listAuditEventsForExport(opts: Omit<ListAuditEventsOpts, "limit" | "offset"> = {}): AuditExportRows {
  const db = getDb();
  const { sql: whereSql, params } = buildAuditWhere(opts);
```

(restul functiei neschimbat — `buildAuditWhere` suporta deja toate campurile).

- [ ] **Step 4: Extinde schema + ruta**

In `admin.ts`, inlocuieste `AuditExportQuerySchema` (639-644) cu:

```ts
// Paritate 1:1 cu filtrele GET /audit — exportul reflecta exact ce vede
// adminul in pagina; doar page/pageSize nu au sens la export.
const AuditExportQuerySchema = ListAuditQuerySchema.omit({ page: true, pageSize: true });
```

In ruta (linia 651-652), inlocuieste:

```ts
  const { since, until } = parsed.data;
  const collected = listAuditEventsForExport({ since, until });
```

cu:

```ts
  const { since, until } = parsed.data;
  const collected = listAuditEventsForExport(parsed.data);
```

si in `recordAuditSafe` de la 664-667 (dupa Task 3) pastreaza `since/until` dar adauga TOATE filtrele acceptate de schema (review-panel: audit-ul exportului trebuie sa documenteze complet ce s-a exportat):

```ts
  recordAuditSafe(c, "admin.audit.export", {
    targetKind: "audit_log",
    detail: {
      since: since ?? null,
      until: until ?? null,
      ownerId: parsed.data.ownerId ?? null,
      actorId: parsed.data.actorId ?? null,
      action: parsed.data.action ?? null,
      actionLike: parsed.data.actionLike ?? null,
      targetKind: parsed.data.targetKind ?? null,
      targetId: parsed.data.targetId ?? null,
      outcome: parsed.data.outcome ?? null,
      requestId: parsed.data.requestId ?? null,
      rows: collected.rows.length,
    },
  });
```

NOTA: verifica intai forma exacta a `ListAuditQuerySchema` (definita mai sus in admin.ts) — daca are defaults pe page/pageSize, `.omit` le scoate curat; daca vreun camp e `.coerce`, ramane compatibil cu query params.

- [ ] **Step 4b (GATE OBLIGATORIU inainte de Step 5): verifica maparea exacta a parametrilor in frontend**

Run: `Grep "actionLike|action:" frontend/src/lib/adminApi.ts` si citeste functia `listAudit`.
Stabileste FARA ambiguitate ce nume de query param trimite pagina pentru campul "actiune" (`action` exact vs `actionLike` substring). Daca lista foloseste `action` exact, exportul trebuie sa trimita tot `action` — altfel garantia "exportul = ce vede adminul" se rupe silentios. OPRESTE-TE si corecteaza snippet-ul de la Step 5 inainte de a edita, nu dupa.

- [ ] **Step 5: Frontend — trimite filtrele curente la export**

In `Audit.tsx`, inlocuieste corpul lui `onExport` (liniile 174-179) cu:

```ts
      const params = new URLSearchParams();
      // Aceleasi filtre ca fetch-ul listei (valorile debounced, nu cele live),
      // ca exportul sa contina exact ce vede adminul in tabel.
      if (debouncedAction) params.set("actionLike", debouncedAction);
      if (debouncedOwnerId) params.set("ownerId", debouncedOwnerId);
      if (debouncedActorId) params.set("actorId", debouncedActorId);
      if (debouncedTargetKind) params.set("targetKind", debouncedTargetKind);
      if (outcome !== "all") params.set("outcome", outcome);
      const since = localDateInputToIso(from, false);
      const until = localDateInputToIso(to, true);
      if (since) params.set("since", since);
      if (until) params.set("until", until);
```

VERIFICA intai in `frontend/src/lib/adminApi.ts` maparea exacta folosita de `listAudit` (`action` vs `actionLike`, etc.) si foloseste ACELEASI nume de query params ca lista.

- [ ] **Step 6: Ruleaza testele — trebuie sa treaca**

Run: `npm run test:backend -- --run backend/src/routes/admin.test.ts` apoi `(cd frontend && npm test -- --run)`
(daca exista test frontend pe Audit, actualizeaza-l; altfel doar type-check).

- [ ] **Step 7: Gate + commit**

Run: `npx biome check --write backend/src/db/auditRepository.ts backend/src/routes/admin.ts frontend/src/pages/admin/Audit.tsx && npx tsc --noEmit -p backend/tsconfig.json && npm run test:backend -- --run` apoi `(cd frontend && npx tsc --noEmit && npm test -- --run)`

```bash
git add backend/src/db/auditRepository.ts backend/src/routes/admin.ts backend/src/routes/admin.test.ts frontend/src/pages/admin/Audit.tsx
git commit -m "fix(audit): exportul xlsx respecta toate filtrele paginii, nu doar intervalul de date"
```

---

### Task 12: Teste P0 — reserveQuotaBudget, lifecycle rezervare, rollback provisionUsersBulk

**Files:**
- Test: `backend/src/middleware/quotaGuard.test.ts` (extinde)
- Test: `backend/src/db/userRepository.test.ts` (extinde)

**Interfaces:** consuma `reserveQuotaBudget`, `releaseAiUsageReservation`, `confirmAiUsageReservation`, `sumAiUsageMilliInWindow` din module existente.

- [ ] **Step 0 (GATE): verifica semnaturile inainte de a scrie testele**

Citeste in `aiUsageRepository.ts` semnaturile exacte pentru `confirmAiUsageReservation` (numele campurilor din payload) si `insertAiUsage`, iar in `userQuotaRepository.ts` daca `upsertOverride` cere `updatedBy`. Confirma in `quotaGuard.test.ts` ca pattern-ul existent seteaza `process.env.LEGAL_DASHBOARD_AUTH_MODE = "web"` per test si ca `getAuthMode()` il citeste la fiecare apel (testele web existente din fisier trec — deci flip-ul runtime functioneaza; pastreaza exact acel pattern). Ajusteaza snippet-urile de mai jos la semnaturile reale INAINTE de a le scrie.

- [ ] **Step 1: Teste reserveQuotaBudget (quotaGuard.test.ts)**

Adauga un `buildReserveApp` linga `buildApp` existent si describe-ul nou:

```ts
import { reserveQuotaBudget } from "./quotaGuard.ts";
import {
  confirmAiUsageReservation,
  releaseAiUsageReservation,
  sumAiUsageMilliInWindow,
} from "../db/aiUsageRepository.ts";

function buildReserveApp(ownerId = "alice") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("ownerId", ownerId);
    await next();
  });
  app.use("*", requestIdContext);
  app.post("/reserve", (c) => {
    const r = reserveQuotaBudget(c, "ai.single", "anthropic");
    if (!r.ok) return r.response;
    return c.json({ reservationId: r.reservationId });
  });
  return app;
}

describe("reserveQuotaBudget", () => {
  it("blocheaza cand used + costEstimat depaseste limita desi used e sub limita", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    // limita 2500, folosit 1000: guard-ul threshold-only ar lasa sa treaca,
    // dar 1000 + 2000 (estimat ai.single) > 2500 => rezervarea refuza.
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 2500 });
    insertAiUsage({
      ownerId: "alice",
      provider: "anthropic",
      model: "claude-sonnet-5",
      feature: "dosar_summary",
      costUsdMilli: 1000,
      ts: new Date().toISOString(),
    });

    const res = await buildReserveApp().request("/reserve", { method: "POST" });

    expect(res.status).toBe(429);
    // Nicio rezervare pending nu a ramas in urma refuzului.
    expect(sumAiUsageMilliInWindow("alice", "ai", 86_400)).toBe(1000);
  });

  it("rezerva la estimat, iar release o scoate complet din fereastra", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 10_000 });

    const res = await buildReserveApp().request("/reserve", { method: "POST" });
    expect(res.status).toBe(200);
    const { reservationId } = (await res.json()) as { reservationId: number };

    // Pending-ul conteaza la estimat (2000) in fereastra...
    expect(sumAiUsageMilliInWindow("alice", "ai", 86_400)).toBe(2000);
    // ...iar release (esec de model) il elimina complet — bugetul nu ramane debitat.
    releaseAiUsageReservation(reservationId);
    expect(sumAiUsageMilliInWindow("alice", "ai", 86_400)).toBe(0);
  });

  it("confirm inlocuieste estimatul cu costul real", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
    upsertOverride({ userId: "alice", feature: "ai", period: "day", limitUsdMilli: 10_000 });

    const res = await buildReserveApp().request("/reserve", { method: "POST" });
    const { reservationId } = (await res.json()) as { reservationId: number };

    confirmAiUsageReservation(reservationId, {
      model: "claude-sonnet-5",
      costUsdMilli: 137,
      inputTokens: 1000,
      outputTokens: 200,
    });
    expect(sumAiUsageMilliInWindow("alice", "ai", 86_400)).toBe(137);
  });
});
```

NOTA: verifica semnatura exacta a `confirmAiUsageReservation` in `aiUsageRepository.ts` inainte de a scrie asertia (numele campurilor din al doilea argument) si ajusteaza payload-ul de confirm la ea.

- [ ] **Step 2: Test rollback provisionUsersBulk (userRepository.test.ts)**

```ts
describe("provisionUsersBulk rollback", () => {
  it("face rollback complet cand o reactivare tinteste un cont ne-sters", () => {
    insertUser({ id: "activ-1", email: "activ@x.ro", displayName: "Activ" }); // status active
    expect(() =>
      provisionUsersBulk({
        inserts: [{ id: "nou-1", email: "nou@x.ro", displayName: "Nou", role: "user" }],
        reactivations: [{ id: "activ-1", displayName: "X", role: "user" }],
      })
    ).toThrow(/user not deleted/);
    // Insertul valid NU a ramas comis — totul sau nimic.
    expect(getUserById("nou-1")).toBeNull();
  });

  it("face rollback complet cand un insert loveste unicitatea emailului", () => {
    insertUser({ id: "existent", email: "dup@x.ro", displayName: "Dup" });
    expect(() =>
      provisionUsersBulk({
        inserts: [
          { id: "ok-1", email: "ok@x.ro", displayName: "Ok", role: "user" },
          { id: "dup-1", email: "DUP@x.ro", displayName: "Dup2", role: "user" },
        ],
        reactivations: [],
      })
    ).toThrow();
    expect(getUserById("ok-1")).toBeNull();
  });
});
```

- [ ] **Step 3: Ruleaza tot**

Run: `npm run test:backend -- --run backend/src/middleware/quotaGuard.test.ts backend/src/db/userRepository.test.ts`
Expected: PASS (daca un test pica, e un bug REAL gasit de review — opreste-te si raporteaza inainte de fix).

- [ ] **Step 4: Gate + commit**

```bash
git add backend/src/middleware/quotaGuard.test.ts backend/src/db/userRepository.test.ts
git commit -m "test(quota,users): reserveQuotaBudget cost-aware + lifecycle rezervare + rollback provisionUsersBulk"
```

---

### Task 13: Teste P1 — caiAtac, down migrations, budget-warnings, cellToString

**Files:**
- Test: `backend/src/services/ai.test.ts` (caiAtac)
- Test: `backend/src/db/migrations/downMigrations.test.ts` (NOU — executie 0040/0042 down; foloseste pattern-ul de aplicare SQL din `0041_unified_ai_quota.test.ts`)
- Test: `backend/src/routes/me.test.ts` (budget-warnings + izolare owner)
- Test: `backend/src/services/userImport.test.ts` (cellToString via workbook real)

- [ ] **Step 1: caiAtac in validateAiBody (ai.test.ts, in describe-ul validateAiBody existent, oglinda testelor parti/sedinte de la liniile ~204-223)**

Citeste INTAI valoarea reala a cap-ului de lista din `services/ai.ts` (constanta `MAX_AI_LIST_ITEMS` sau echivalentul folosit de branch-ul `caiAtac`) si foloseste `cap + 1`, nu un numar hardcodat (review-panel):

```ts
it("respinge un element non-obiect din caiAtac (previne TypeError -> 500)", () => {
  expect(validateAiBody({ ...validBody, caiAtac: [null] })).toMatch(/caiAtac/);
  expect(validateAiBody({ ...validBody, caiAtac: ["text"] })).toMatch(/caiAtac/);
});

it("respinge caiAtac peste limita de elemente", () => {
  const many = Array.from({ length: MAX_AI_LIST_ITEMS + 1 }, () => ({}));
  expect(validateAiBody({ ...validBody, caiAtac: many })).toBeTruthy();
});
```

(preia `validBody` si stilul asertiilor exact din testele `parti` invecinate; daca mesajul exact difera, asertia pe `/caiAtac/` ramane valida; daca constanta nu e exportata, foloseste valoarea ei literala cu un comentariu care o citeaza).

- [ ] **Step 2: Executie down 0040 + 0042 (fisier nou downMigrations.test.ts)**

```ts
import fsPromises from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../schema.ts";

// ESM: __dirname nu exista (review-panel, 3 modele) — deriva-l din import.meta.url.
const migrationsDir = path.dirname(fileURLToPath(import.meta.url));

// Executa efectiv .down.sql pentru 0040 si 0042 (0041 are testul lui dedicat).
// downSchemaVersions.test.ts verifica doar textual DELETE-ul de versiune;
// aici rulam SQL-ul pe un DB migrat real.
let tmpRoot: string;
const originalDbPath = process.env.LEGAL_DASHBOARD_DB_PATH;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-down-mig-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  getDb(); // aplica toate migratiile up
});

afterEach(async () => {
  closeDb();
  if (originalDbPath === undefined) delete process.env.LEGAL_DASHBOARD_DB_PATH;
  else process.env.LEGAL_DASHBOARD_DB_PATH = originalDbPath;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function runDown(version: string): void {
  const file = fs.readdirSync(migrationsDir).find((f) => f.startsWith(version) && f.endsWith(".down.sql"));
  if (!file) throw new Error(`down file missing for ${version}`);
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
  getDb().exec(sql);
}

describe("down migrations 0040/0042 se executa curat pe un DB migrat", () => {
  it("0040 down sterge indexul NOCASE si versiunea", () => {
    runDown("0040");
    const idx = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_email_nocase'")
      .get();
    expect(idx).toBeUndefined();
    const ver = getDb().prepare("SELECT version FROM _schema_versions WHERE version = 40").get();
    expect(ver).toBeUndefined();
  });

  it("0042 down sterge doar versiunea (backfill-ul UTC e ireversibil prin design)", () => {
    runDown("0042");
    const ver = getDb().prepare("SELECT version FROM _schema_versions WHERE version = 42").get();
    expect(ver).toBeUndefined();
  });
});
```

NOTA: verifica in `0041_unified_ai_quota.test.ts` cum se obtine calea directorului de migratii si cum se citesc fisierele SQL — reuse exact acelasi mecanism (numele tabelei de versiuni `_schema_versions` de confirmat acolo).

- [ ] **Step 3: GET /me/budget-warnings (me.test.ts, pattern-ul describe-urilor /me/budget existente)**

```ts
describe("GET /api/v1/me/budget-warnings", () => {
  it("returneaza warning-ul activ pe pool-ul ai", async () => {
    // Aprinde episodul direct in repository (fired, necurateat):
    // foloseste helperul public din budgetNotificationsRepository — verifica
    // numele exact (markFired / upsertState) inainte de a scrie testul.
    fireWarningForTest("alice", "ai", 80);
    const res = await appAs("alice").request("/api/v1/me/budget-warnings");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].feature).toBe("ai");
    expect(body.data.items[0].thresholdPct).toBe(80);
  });

  it("nu returneaza warning-ul altui owner (izolare)", async () => {
    fireWarningForTest("alice", "ai", 80);
    const res = await appAs("bob").request("/api/v1/me/budget-warnings");
    const body = await res.json();
    expect(body.data.items).toEqual([]);
  });

  it("un warning curatat nu mai apare", async () => {
    fireWarningForTest("alice", "ai", 80);
    clearWarningForTest("alice", "ai", 80);
    const res = await appAs("alice").request("/api/v1/me/budget-warnings");
    const body = await res.json();
    expect(body.data.items).toEqual([]);
  });
});
```

(`appAs`/helper-ele de seed: reuse cele din me.test.ts; `fireWarningForTest`/`clearWarningForTest` = apelurile repository reale din `budgetNotificationsRepository.ts` — citeste API-ul lui intai si foloseste functiile publice existente, NU adauga exporturi noi).

- [ ] **Step 4: cellToString pe celule hyperlink si Date (userImport.test.ts)**

ATENTIE (review-panel): in `cellToString`, branch-ul `text` castiga INAINTEA branch-ului `hyperlink` (userImport.ts:58-62) — un test cu `{ text: "ana@firma.ro", hyperlink: ... }` nu exercita branch-ul hyperlink. Testeaza AMBELE contracte separat:

```ts
it("celula hyperlink cu text: textul afisat castiga (contractul cellToString)", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Utilizatori");
  ws.addRow(["email", "nume", "rol"]);
  const row = ws.addRow([]);
  row.getCell(1).value = { text: "ana@firma.ro", hyperlink: "mailto:altceva@firma.ro" };
  row.getCell(2).value = "Ana Pop";
  row.getCell(3).value = "user";
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  const result = await parseUserImport(buffer);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBe("ana@firma.ro");
  }
});

it("celula hyperlink FARA text: se extrage adresa din mailto (branch-ul hyperlink)", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Utilizatori");
  ws.addRow(["email", "nume", "rol"]);
  const row = ws.addRow([]);
  row.getCell(1).value = { hyperlink: "mailto:ana@firma.ro" } as ExcelJS.CellValue;
  row.getCell(2).value = "Ana Pop";
  row.getCell(3).value = "user";
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  const result = await parseUserImport(buffer);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBe("ana@firma.ro");
  }
});

it("celula Date pe coloana de nume nu arunca si nu produce [object Object]", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Utilizatori");
  ws.addRow(["email", "nume", "rol"]);
  ws.addRow(["d@firma.ro", new Date("2026-01-15T00:00:00Z"), "user"]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  const result = await parseUserImport(buffer);

  expect(result.ok).toBe(true);
  if (result.ok) {
    // Data devine string ISO — rand valid (nume ne-gol), fara crash.
    expect(result.rows[0]?.displayName).toContain("2026-01-15");
  }
});
```

- [ ] **Step 5: Ruleaza tot + commit**

Run: `npm run test:backend -- --run`
Expected: PASS integral. Daca un down SQL sau warning pica: bug real — raporteaza inainte de fix.

```bash
git add backend/src/services/ai.test.ts backend/src/db/migrations/downMigrations.test.ts backend/src/routes/me.test.ts backend/src/services/userImport.test.ts
git commit -m "test: caiAtac validateAiBody + executie down 0040/0042 + budget-warnings cu izolare owner + celule xlsx hyperlink/Date"
```

---

### Task 14: Documentatie operationala (RUNBOOK + CHANGELOG note de upgrade)

**Files:**
- Modify: `RUNBOOK.md` (sectiune noua la final, inainte de changelog-ul intern daca exista)
- Modify: `CHANGELOG.md` (in sectiunea v2.42.0, subsectiune noua "Note de upgrade")
- Modify: `SESSION-HANDOFF.md` (stare post-fixes)

- [ ] **Step 1: RUNBOOK — sectiune rollback migratii 0040-0042**

Adauga in `RUNBOOK.md`:

```markdown
## Rollback si pre-flight pentru migratiile v2.42.0 (0040-0042)

**Pre-flight OBLIGATORIU inainte de upgrade pe un tenant web** (migration 0040
adauga index unic case-insensitive pe users.email si BLOCHEAZA boot-ul daca
exista duplicate istorice):

    SELECT lower(email) AS e, COUNT(*) AS n FROM users GROUP BY e HAVING n > 1;

Zero randuri = upgrade sigur. Randuri gasite = rezolva manual duplicatele
(pastreaza contul corect, marcheaza-l pe celalalt cu email placeholder unic)
INAINTE de a porni versiunea noua.

**Rollback = restore din backup, NU reinstalare de build vechi.** Runner-ul de
migratii refuza boot-ul cand DB-ul are versiune de schema mai mare decat
fisierele de pe disc, deci un downgrade de aplicatie dupa 0040-0042 nu porneste.
Procedura corecta: opreste aplicatia, restaureaza
`backups/legal-dashboard.pre-schema-upgrade-*.db` (generat automat inainte de
migrare), apoi porneste versiunea veche.

**0041 down.sql este best-effort, NU inversa fidela**: valorile per-pool
originale (ai.single vs ai.multi) sunt pierdute la consolidare, iar granturile
se duplica pe ambele pool-uri legacy la down. Nu rula down-ul decat daca
backup-ul nu exista; nu rula up dupa down fara sa cureti intai
user_quota_grants.
```

- [ ] **Step 2: CHANGELOG — note de upgrade in sectiunea v2.42.0**

Adauga subsectiunea (respecta conventia markdown — fara linii care incep cu caractere de lista in interiorul paragrafelor):

```markdown
### Note de upgrade

Consolidarea cotelor AI (migration 0041) pastreaza RATA CEA MAI RESTRICTIVA
dintre ai.single si ai.multi ca limita a pool-ului unic "ai". Utilizatorii care
aveau limite asimetrice (ex. multi mult peste single) pot vedea 429 pe analiza
multi-agent dupa upgrade — adminul trebuie sa revada limitele in pagina Cote si
sa le reaseze la valorile dorite. Inainte de upgrade pe un tenant web, ruleaza
pre-flight-ul de duplicate de email din RUNBOOK (migration 0040 opreste boot-ul
pe duplicate istorice case-insensitive).
```

- [ ] **Step 3: Commit**

(SESSION-HANDOFF se actualizeaza ABIA in Task 16, dupa ce tot planul e aplicat — altfel handoff-ul ar afirma o stare care nu exista inca daca executia se opreste aici; review-panel.)

```bash
git add RUNBOOK.md CHANGELOG.md
git commit -m "docs(ops): pre-flight 0040 + rollback prin backup + note de upgrade cota consolidata"
```

---

### Task 15: Feature — cota alocata si consumul ei in fereastra AI Usage a userului

**Files:**
- Modify: `backend/src/routes/me.ts:145-195` (GET /budget — aliniere la regula guard-ului + `limitSource`)
- Modify: `backend/src/routes/me.test.ts` (testele /budget existente + 1 nou)
- Modify: `frontend/src/components/AIUsagePanel.tsx` (tile nou "Cota alocata" cu bara de progres)
- Verify/Modify: `frontend/src/lib/` — API-ul client pentru /me/budget (exista deja pentru `BudgetIndicator`; gaseste-l cu `Grep "me/budget" frontend/src/lib` si reuse; NU crea client nou)
- Test: `frontend/src/components/AIUsagePanel.test.tsx` (daca exista; altfel creeaza-l pe pattern-ul `BudgetIndicator.test.tsx`)

**Interfaces:**
- Produces (backend): item-ul `feature: "ai"` din `GET /api/v1/me/budget` primeste `baseLimitMilli` cu fallback pe `readDefaultQuotaMilli()` (nu doar override) + camp nou `limitSource: "override" | "default" | "none"`, si `usedMilli` calculat pe fereastra ROLLING (`sumAiUsageMilliInWindow`), identic cu guard-ul. Campurile existente raman (compatibilitate BudgetIndicator).
- Produces (frontend): AIUsagePanel afiseaza, lânga tile-urile de cost, cota alocata + consumul din ea cand `effectiveLimitMilli !== null`; "Nelimitat" cand e null.

- [ ] **Step 1: Teste backend care pica (me.test.ts)**

Review-panel: default-ul env se aplica DOAR in web mode (guard-ul enforce-uieste doar acolo — `quotaGuard.ts:101`; pe desktop panoul afiseaza deja "nu exista quota enforce" si NU trebuie sa apara o cota falsa). Testele seteaza explicit modul:

```ts
it("bugetul ai foloseste default-ul env cand nu exista override (aliniat cu guard-ul, web mode)", async () => {
  process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
  process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI = "5000";
  const res = await appAs("alice").request("/api/v1/me/budget");
  const body = await res.json();
  const ai = body.data.items.find((i: { feature: string }) => i.feature === "ai");
  expect(ai.baseLimitMilli).toBe(5000);
  expect(ai.effectiveLimitMilli).toBe(5000);
  expect(ai.limitSource).toBe("default");
});

it("pe desktop default-ul env NU produce limita afisata (guard-ul nu enforce-uieste)", async () => {
  process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
  process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI = "5000";
  const res = await appAs("alice").request("/api/v1/me/budget");
  const body = await res.json();
  const ai = body.data.items.find((i: { feature: string }) => i.feature === "ai");
  expect(ai.effectiveLimitMilli).toBeNull();
  expect(ai.limitSource).toBe("none");
});

it("consumul ai e pe fereastra rolling 24h, nu pe ziua calendaristica", async () => {
  process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
  process.env.LEGAL_DASHBOARD_DEFAULT_AI_QUOTA_MILLI = "5000";
  // 23h in urma = alta zi calendaristica (daca testul ruleaza inainte de 23:00),
  // dar INAUNTRUL ferestrei rolling — sumAiUsageMilliToday l-ar fi pierdut.
  const ts23hAgo = new Date(Date.now() - 23 * 3_600_000).toISOString();
  insertAiUsage({ ownerId: "alice", provider: "anthropic", model: "claude-sonnet-5", feature: "dosar_summary", costUsdMilli: 700, ts: ts23hAgo });
  const res = await appAs("alice").request("/api/v1/me/budget");
  const body = await res.json();
  const ai = body.data.items.find((i: { feature: string }) => i.feature === "ai");
  expect(ai.usedMilli).toBe(700);
});
```

(adauga ambele env-uri la lista restore din afterEach, pattern-ul quotaGuard.test.ts; ajusteaza semnatura insertAiUsage la cea reala).

- [ ] **Step 2: Implementeaza in me.ts**

Adauga importurile `readDefaultQuotaMilli, PERIOD_SECONDS` din `../middleware/quotaGuard.ts` (si STERGE constanta locala `PERIOD_SECONDS` din me.ts:25-29 — duplicat semnalat de review-panel; verifica intai cu Grep ca nu o mai foloseste alta ruta din fisier) si inlocuieste corpul map-ului din `/budget` (liniile 165-185) cu:

```ts
        items: features.map((feature) => {
          const override = overrideByFeature.get(feature) ?? null;
          const period: QuotaPeriod = override?.period ?? "day";
          // v2.42.0 (fix review + feature cota vizibila): pentru pool-ul "ai",
          // ACEEASI regula ca quotaGuard — override ?? default env (DOAR in web
          // mode, unde guard-ul chiar enforce-uieste; pe desktop o cota din env
          // ar fi o minciuna sub bannerul "nu exista quota enforce") si
          // fereastra ROLLING, nu ziua calendaristica. Celelalte feature-uri
          // (ex. captcha.rnpm) raman pe semantica lor istorica — schimbarea e
          // scoped pe "ai" ca sa nu mute cifrele altor consumatori.
          const defaultForFeature = feature === "ai" && getAuthMode() === "web" ? readDefaultQuotaMilli() : null;
          const baseLimit = override ? override.limit_usd_milli : defaultForFeature;
          const extraFromGrants = sumActiveExtraMilli(ownerId, feature);
          const effectiveLimit = baseLimit === null ? null : baseLimit + extraFromGrants;
          const usedMilli =
            feature === "ai"
              ? sumAiUsageMilliInWindow(ownerId, feature, PERIOD_SECONDS[period])
              : period === "day"
                ? sumAiUsageMilliToday(ownerId, feature)
                : sumAiUsageMilliInWindow(ownerId, feature, PERIOD_SECONDS[period]);
          return {
            feature,
            period,
            usedMilli,
            baseLimitMilli: baseLimit,
            extraFromGrantsMilli: extraFromGrants,
            effectiveLimitMilli: effectiveLimit,
            limitSource: override ? ("override" as const) : baseLimit !== null ? ("default" as const) : ("none" as const),
            // Legacy alias for old clients — equals effectiveLimitMilli.
            limitMilli: effectiveLimit,
          };
        }),
```

(`getAuthMode` e deja importat in me.ts:19.) Ruleaza testele /budget existente — daca vreunul asuma semantica "azi calendaristic" pe "ai" si pica, actualizeaza-l la rolling window cu comentariu (usage-ul seeded `new Date().toISOString()` e in ambele ferestre, deci majoritatea trec neatinse).

- [ ] **Step 2b: Consumatorii existenti ai /me/budget (review-panel)**

Run: `Grep -i "azi|astazi|today" frontend/src/components/BudgetIndicator.tsx frontend/src/components/BudgetIndicator.test.tsx`
`usedMilli` pe "ai" trece de la "azi calendaristic" la "ultimele 24h rolling": daca BudgetIndicator sau bannerul de warning au etichete "azi", schimba-le in "ultimele 24h" (sau echivalentul perioadei), altfel eticheta minte. Verifica si ca tipul TS partajat al item-ului de buget din frontend (`Grep "effectiveLimitMilli" frontend/src/lib frontend/src/types`) primeste campul nou `limitSource` — altfel gate-ul `tsc` pica; auditeaza orice `toEqual` pe item-ul complet in me.test.ts si adauga campul.

- [ ] **Step 3: Ruleaza backend**

Run: `npm run test:backend -- --run backend/src/routes/me.test.ts`
Expected: PASS (testul nou + cele existente).

- [ ] **Step 4: Frontend — tile-ul de cota in AIUsagePanel**

Gaseste clientul existent pentru /me/budget (`Grep "me/budget" frontend/src/lib frontend/src/hooks frontend/src/components/BudgetIndicator.tsx`) si tipul item-ului. In `AIUsagePanel.tsx`:

1. Incarca bugetul in paralel cu summary-ul (acelasi `load`, `Promise.allSettled` ca un esec de buget sa NU strice panoul de costuri):

```ts
  const [budget, setBudget] = useState<MeBudgetItem | null>(null);
  // in load(), dupa aiUsageApi.summary:
  const [summaryRes, budgetRes] = await Promise.allSettled([
    aiUsageApi.summary(controller.signal),
    budgetApi.get(controller.signal), // numele real al clientului gasit la pasul de verificare
  ]);
  if (controller.signal.aborted) return;
  if (summaryRes.status === "rejected") throw summaryRes.reason;
  setData(summaryRes.value);
  setBudget(
    budgetRes.status === "fulfilled"
      ? (budgetRes.value.items.find((i) => i.feature === "ai") ?? null)
      : null
  );
  setState("ready");
```

2. Randare — OBLIGATORIU (review-panel, finding HIGH): cardul de cota se randeaza ca FRATE al blocurilor loading/error/empty, IMEDIAT dupa blocul `{state === "loading" && ...}` si INAINTE de `{empty && ...}` — NU inauntrul blocului `state === "ready" && data && !empty` de la linia 177. Un user cu cota alocata si zero apeluri (empty) TREBUIE sa isi vada cota. Extrage cardul intr-o componenta locala `QuotaCard` in acelasi fisier si insereaza:

```tsx
      {state === "ready" && <QuotaCard budget={budget} />}
```

cu componenta (sub `MetricRow`, la finalul fisierului):

```tsx
const PERIOD_RO: Record<string, string> = { day: "in ultimele 24h", week: "pe saptamana", month: "pe luna" };

function QuotaCard({ budget }: { budget: MeBudgetItem | null }) {
  // budget null = fetch-ul de buget a esuat sau nu a rulat — fail-open, nu
  // afisam nimic (panoul de costuri ramane functional).
  if (budget === null) return null;
  if (budget.effectiveLimitMilli === null) {
    return <p className="mt-3 text-[11px] text-muted-foreground">Cota AI: nelimitata pentru contul curent.</p>;
  }
  // limita 0 = deny-all pentru guard (blocheaza orice apel) — afiseaza blocat,
  // nu "0% consumat" cu bara verde (exact inversul realitatii; review-panel).
  const denyAll = budget.effectiveLimitMilli === 0;
  const rawPct = denyAll ? 100 : (budget.usedMilli / budget.effectiveLimitMilli) * 100;
  const barPct = Math.min(100, rawPct); // bara nu depaseste containerul la overshoot
  const tone = denyAll || rawPct >= 90 ? "bg-red-500" : rawPct >= 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Cota alocata ({PERIOD_RO[budget.period] ?? budget.period})
        </p>
        <p className="text-xs text-muted-foreground">
          {budget.limitSource === "override" ? "limita individuala" : "limita implicita tenant"}
        </p>
      </div>
      <p className="text-lg font-bold">
        {formatUsd(budget.usedMilli / 1000)}
        <span className="text-sm font-normal text-muted-foreground">
          {" "}din {formatUsd(budget.effectiveLimitMilli / 1000)}
        </span>
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${barPct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {denyAll
          ? "Limita este 0 — apelurile AI sunt blocate pentru contul curent."
          : `${Math.round(rawPct)}% consumat`}
        {!denyAll &&
          budget.extraFromGrantsMilli > 0 &&
          ` (include ${formatUsd(budget.extraFromGrantsMilli / 1000)} din granturi)`}
      </p>
    </div>
  );
}
```

3. Fetch-ul de buget NU are voie sa strice panoul: `Promise.allSettled` de la punctul 1 acopera rejection-ul (budget ramane `null` → cardul nu apare); verifica in plus ca abort-ul la unmount nu lasa unhandled rejection (pattern-ul `controller.signal.aborted` existent).

- [ ] **Step 5: Test frontend**

In `AIUsagePanel.test.tsx` (nou sau existent), pe pattern-ul de mock fetch din `BudgetIndicator.test.tsx`:

Corectii review-panel incluse: primul test ruleaza pe summary GOL tocmai ca sa probeze ca cota apare si fara apeluri (cardul e in afara gate-ului `!empty`); "nelimitat" inseamna ITEM cu `effectiveLimitMilli: null`, NU absenta item-ului; fetch-ul de buget esuat = fara card, panoul de costuri intact.

```tsx
it("afiseaza cota alocata si procentul consumat chiar si fara apeluri (summary gol)", async () => {
  mockBudgetItem({ feature: "ai", period: "day", usedMilli: 2500, effectiveLimitMilli: 10000, extraFromGrantsMilli: 0, baseLimitMilli: 10000, limitSource: "default" });
  mockSummaryEmpty();
  render(<AIUsagePanel />);
  expect(await screen.findByText(/din \$10\.00/)).toBeInTheDocument();
  expect(screen.getByText(/25% consumat/)).toBeInTheDocument();
});

it("afiseaza nelimitat cand item-ul are effectiveLimitMilli null", async () => {
  mockBudgetItem({ feature: "ai", period: "day", usedMilli: 0, effectiveLimitMilli: null, extraFromGrantsMilli: 0, baseLimitMilli: null, limitSource: "none" });
  mockSummaryWithData();
  render(<AIUsagePanel />);
  expect(await screen.findByText(/nelimitata/)).toBeInTheDocument();
});

it("limita 0 se afiseaza ca blocat, nu ca 0% consumat", async () => {
  mockBudgetItem({ feature: "ai", period: "day", usedMilli: 0, effectiveLimitMilli: 0, extraFromGrantsMilli: 0, baseLimitMilli: 0, limitSource: "override" });
  mockSummaryEmpty();
  render(<AIUsagePanel />);
  expect(await screen.findByText(/blocate/)).toBeInTheDocument();
});

it("fetch-ul de buget esuat nu strica panoul de costuri (fara card)", async () => {
  mockBudgetFailure();
  mockSummaryWithData();
  render(<AIUsagePanel />);
  expect(await screen.findByText(/Cost ultimele 30 zile/)).toBeInTheDocument();
  expect(screen.queryByText(/Cota alocata/)).not.toBeInTheDocument();
});
```

- [ ] **Step 6: Gate complet + commit**

Run: `npx biome check --write backend/src/routes/me.ts backend/src/routes/me.test.ts frontend/src/components/AIUsagePanel.tsx frontend/src/components/AIUsagePanel.test.tsx && npm run typecheck && npm run test:backend -- --run` apoi `(cd frontend && npm test -- --run)`

```bash
git add backend/src/routes/me.ts backend/src/routes/me.test.ts frontend/src/components/AIUsagePanel.tsx frontend/src/components/AIUsagePanel.test.tsx
git commit -m "feat(usage): cota alocata + consum vizibile in panoul AI Usage; /me/budget aliniat la regula guard-ului (default env + rolling window)"
```

---

### Task 16: Gate final complet + push

**Files:** niciunul nou.

- [ ] **Step 1: Suita completa**

Run: `npm run check`
Expected: biome + typecheck + toate testele (backend ~1670+, frontend ~330+) verzi.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: bundle frontend + backend CJS curat.

- [ ] **Step 3: SESSION-HANDOFF — actualizeaza sectiunea "URMEAZA" (mutat din Task 14)**

Inlocuieste blocul "URMEAZA (pasul imediat al sesiunii noi)" cu starea reala: review backend FACUT (5 agenti paraleli) + review-panel adversarial pe plan FACUT, fixurile din `docs/superpowers/plans/2026-07-07-fixes-review-backend-v2.42.md` aplicate integral, urmatorul pas = smoke pe `dev-web-local.ps1` + decizia de merge (user).

```bash
git add SESSION-HANDOFF.md
git commit -m "docs: handoff — fixuri post-review aplicate integral"
```

- [ ] **Step 4: Push**

```bash
git push origin feat/v2.42.0-users-settings
```

- [ ] **Step 5: Raporteaza userului** starea finala: lista commit-urilor, testele noi, ce a ramas deliberat nefixat (sectiunea "Decizii luate") si ca urmeaza smoke pe `dev-web-local.ps1` + decizia de merge.

---

## In afara scope-ului (explicit, cu motivatie)

1. Enforcement mid-flow pe /analyze-multi (re-check inainte de judge) — tradeoff documentat `quotaGuard.ts:71-73`, UX-ul respingerii mid-stream e mai rau decat overshoot-ul. Nota review-panel (GPT, advisory): un check ieftin STRICT inainte de faza de judge (nu abort pe analisti) ar economisi exact un call platit la overshoot — rafinament valid, bounded-cost, candidat pentru HARDENING.md, nu blocker.
2. Agregare set-based pe /usage/overview — amanata; cap-ul redus la 500 acopera asumptia reala.
3. Anularea parse-ului ExcelJS la timeout — cap 512KB + admin-only raman apararea; auto-documentat in cod.
4. Env override pentru model id nativ (`claude-sonnet-5`) — mitigare existenta: user schimba modelul din UI; verificare GA la tag time (operational).
5. Logging pe randurile sarite de backfill-ul 0042 — probabilitate ~0 de randuri afectate (createGrant normalizeaza la scriere din v2.41).
6. Scriere sincrona usage (eliminarea queueMicrotask) — fereastra de crash e microtask-level; costul de latenta nu se justifica pe desktop informativ.
7. Envelope pe GET/PUT /ai/settings (forma legacy `{ mode }`) — mostenire pre-v2.41 documentata deja in SESSION-HANDOFF ca risc separat, cere schimbare coordonata FE+BE; nu face parte din findings-urile acestui review.
8. Teste backlog LOW din raportul test-architect (branch-urile auditExport capDetail/label fallback, warning combinat single+multi in budgetWarningService, fallback decrypt-throw in resolveEffectiveAiMode, edge-case-uri unicode pe canonicalizeEmail) — gap-uri de acoperire fara defect identificat; raman pe backlog-ul HARDENING.md.
