# PLAN — Refactor Closeout v2.28.3

**Generat:** 2026-05-17
**Target release:** v2.28.3 (patch)
**Branch:** `chore/refactor-closeout-v2.28.3`
**Estimat efort:** ~3-4h Codex + ~30 min Claude review/merge

---

## 0. Context & Decizia de scope

Auditul `audit/AUDIT-REFACTOR.md` (5 errata G1-G5 + validare cu 5 agenti) a stabilit ca:

- **Tier 3** (P0-new scheduler / P1 AlertPubSub / P2 IdempotencyStore) NU este gating pentru web cutover, sub topologia declarata `SQLite + Litestream forever` + `<100 useri interni` + `1 replica`. Singletonii sunt corecti pe single-instance. → **DEFERRED** cu trigger explicit.
- **Tier 4** (P3 S2/S3, P4 PageFetcher, P6-P11) este ~80% aesthetic. Verificarile cu `deep-code-reviewer` au gasit 4 erori factuale in audit (P10 transaction already wrapped, `useAiAnalysisCache` phantom, Alerts SSE deja in fisier separat `useAlertsStream.ts`, `manual-content.tsx` nu este god component — JSX static pur). → **DEFERRED** cu menu "revisit on touch".
- **Ramane util:** 3 livrari mici cu impact real, zero regresie:
  1. Drop-export cleanup (audit/06 §5+§7) — reduce API surface, LOW risk.
  2. `withRnpmGuards` middleware — inchide auth-drift hazard pe 22 rute RNPM.
  3. 3 teste de characterizare pe invariants I1/I3/I-final-update din `rnpmSearchService.ts`.

**Verdict propriu §8 din audit:** "Sanatos cu datorie tehnica concentrata" — codebase NU cere refactor mandatoriu.

---

## 1. Out of scope (explicit DEFER, NU executa)

| Item | Status | Trigger reactivare |
|------|--------|--------------------|
| P0-new scheduler `JobCancellationSignal` | DEFERRED | Decizie active-active (>1 replica) sau >500 useri activi |
| P1 `AlertPubSub` cu canale tipizate | DEFERRED | Same trigger |
| P2 `IdempotencyStore` interface | DEFERRED | Same trigger; cod actual deja comenteaza `deferred la PR-11+` |
| P3 S1/S2/S3 DosareTable split | DEFERRED | Cand se modifica AI panel sau cand DosareTable creste >900 LOC |
| P4 `PageFetcher` strategy | DEFERRED | Adaugarea unui al 5-lea executor |
| P5 Twin WHERE-builder reconciliere | BLOCKED on product | Product sign-off explicit |
| P6 `useAlertsStream` extract | NU EXISTA | Hook-ul deja exista in `frontend/src/hooks/useAlertsStream.ts` |
| P7 `manual-content.tsx` split | SKIP | JSX static, nu e god component |
| P8 `Monitorizare.tsx` flatten | DEFERRED | "Revisit on touch" |
| P9 `rnpm.ts` domain split | SKIP | Replaced de pasul 2 (`withRnpmGuards`) |
| P10 `alerts.ts` transaction wrap | DEJA DONE | `dismissAlertsByIds` wraps `db.transaction()` |
| P11 `avizRepository.ts` extract | SKIP | `buildAvizWhere` L462 vs L629 acopera coloane diferite (NU duplicare) |
| P12/D1 XLSX unificare | IMPOSSIBLE | `exceljs` vs `xlsx-js-style` incompatible (errata G5) |

---

## 2. Pre-flight verification (Codex face primul lucru)

Inainte de orice modificare, Codex confirma starea de plecare:

```powershell
git status                                # working tree clean
git log --oneline -3                      # head = 9eb9f59 release v2.28.2
npx tsc --noEmit -p backend/tsconfig.json # type-check verde
cd frontend; npx tsc --noEmit; cd ..      # type-check frontend verde
npm test --workspace=backend              # ~200 teste verzi
cd frontend; npm test -- --run; cd ..     # 102 teste verzi
npx biome check                            # zero erori
```

**Acceptance gate pre-flight:** toate 6 comenzi exit 0. Daca oricare pica → STOP, raporteaza, NU continua.

Daca pre-flight verde → creeaza branch:

```powershell
git checkout -b chore/refactor-closeout-v2.28.3
```

---

## 3. PASUL 1 — Drop-export cleanup (audit/06 §5+§7)

**Effort:** ~15 min
**Risk:** LOW (intern doar, zero call-sites externe per audit)
**Commit message:** `refactor: drop dead exports + @internal markers (audit/06 cleanup)`

### 3.1 Drop `export` keyword pe simboluri folosite doar intern

**Frontend (`frontend/src/components/rnpm/rnpm-form-fields.tsx`):**
- Linie ~73: `export function PJPFToggle` → `function PJPFToggle` (folosit doar de `PartyFieldset` in acelasi fisier la L202).
- Linie ~127: `export function PFBlock` → `function PFBlock` (folosit doar de `PartyFieldset` la L206).

**Backend:**

| Fisier:line | Schimbare |
|-------------|-----------|
| `backend/src/db/dashboardActivityRepository.ts:37` | `export const CURATED_AUDIT_ACTIONS` → `const CURATED_AUDIT_ACTIONS` |
| `backend/src/db/dashboardActivityRepository.ts:266` | `export interface AlertsDailyRow` → `interface AlertsDailyRow` |
| `backend/src/db/dashboardActivityRepository.ts:287` | `export interface RunsByDayStatusRow` → `interface RunsByDayStatusRow` |
| `backend/src/db/monitoringRunsRepository.ts:172` | `export interface RunsByStatusRow` → `interface RunsByStatusRow` |
| `backend/src/auth/authProvider.ts:16` | `export interface AuthProvider` → `interface AuthProvider` |

**Important:** verifica fiecare drop cu grep CROSS-FILE inainte de a-l aplica:

```powershell
# Pentru fiecare simbol, verifica zero importuri externe:
Get-ChildItem -Recurse -Include *.ts,*.tsx backend/src,frontend/src `
  | Select-String -Pattern "\b<SIMBOL>\b" `
  | Where-Object { $_.Path -notlike "*<fisier-de-origine>*" -and $_.Path -notlike "*.test.*" }
# Astept 0 hits. Daca apare hit, SKIP acel drop (audit-ul a fost outdated).
```

### 3.2 Adauga `@internal` JSDoc pe exports folosite doar in teste

Aceste exports raman publice pentru testabilitate dar trebuie marcate explicit:

| Fisier:line | Adauga deasupra |
|-------------|------------------|
| `backend/src/services/monitoring/diff/dosarSoap.ts:87` (`computeFilterFingerprint`) | `/** @internal — exported only for tests in diff/dosarSoap.test.ts */` |
| `backend/src/services/email/mailer.ts:140` (`buildSubject`) | `/** @internal — exported only for tests in mailer.test.ts */` |
| `backend/src/services/email/mailer.ts:146` (`buildHtmlBody`) | `/** @internal — exported only for tests in mailer.test.ts */` |
| `backend/src/services/email/mailer.ts:157` (`buildTextBody`) | `/** @internal — exported only for tests in mailer.test.ts */` |

### 3.3 Verificare pas 1

```powershell
npx tsc --noEmit -p backend/tsconfig.json
cd frontend; npx tsc --noEmit; cd ..
npx biome check --write backend/src frontend/src
npm test --workspace=backend
cd frontend; npm test -- --run; cd ..
```

**Acceptance gate:** type-check verde + 0 teste rosii + biome verde.

```powershell
git add -A
git commit -m "refactor: drop dead exports + @internal markers (audit/06 cleanup)"
```

---

## 4. PASUL 2 — `withRnpmGuards` middleware consolidation

**Effort:** ~1-1.5h
**Risk:** MEDIUM (touch 22 endpoint-uri RNPM; acoperit de `rnpm.contract.test.ts`)
**Commit message:** `refactor(rnpm): consolidate withRnpmGuards middleware (auth-drift safety)`

### 4.1 Problema

In `backend/src/routes/rnpm.ts`, 4 helper-uri de guard sunt aplicate inline si inconsistent in 22 endpoint-uri:

- `rejectCaptchaKeyInWebMode(c)` la L225, L457, L573, L1136 (4 sites)
- `parseJsonBody(c)` invocat dupa web-gate
- `isValidCaptchaKey(captchaKey)` la L257, L471, L611 (3 sites — DOAR rutele cu captcha)
- `requireDesktopHeader` middleware deja consistent pe rutele admin L837, L889, L907, L921, L977 (5 sites — NU intra in scope, deja OK)

**Hazard real:** un endpoint nou adaugat in viitor poate uita `rejectCaptchaKeyInWebMode` si expune captcha-key flow in web mode. Pattern-ul curent nu enforce-uieste prin tipuri.

### 4.2 Solutie propusa

Creeaza helper compose-abil in `backend/src/routes/rnpmGuards.ts` (fisier nou, ~80 LOC):

```typescript
// backend/src/routes/rnpmGuards.ts
import type { Context, MiddlewareHandler } from "hono";
import { getAuthMode } from "../auth/authMode.ts";
import { ErrorCodes, fail } from "../util/errorEnvelope.ts";

/**
 * Compose-abil guard pentru rutele RNPM care touch-uiesc captcha provider.
 * Toate cele 4 guard-uri trebuie aplicate ca prefix; ordinea conteaza.
 *
 * Ordine:
 *   1. web-mode 501 gate (interzice key-in-body cand auth=web)
 *   2. body parse (json sau 400)
 *   3. captcha-key shape validate (404 / 400)
 */
export type RnpmCaptchaGuardResult =
  | { ok: true; body: Record<string, unknown>; captchaKey: string }
  | { ok: false; response: Response };

export async function withRnpmCaptchaGuards(c: Context): Promise<RnpmCaptchaGuardResult> {
  // 1. web-mode gate
  if (getAuthMode() === "web") {
    return {
      ok: false,
      response: c.json(
        fail(
          ErrorCodes.WEB_MODE_NOT_IMPLEMENTED,
          "RNPM in web mode necesita stocare server-side a cheii captcha. Folositi desktop sau asteptati per-user key storage.",
          c
        ),
        501
      ),
    };
  }

  // 2. body parse — REUTILIZEAZA `parseJsonBody` existent in rnpm.ts (NU duplica)
  //    parseJsonBody returneaza null la JSON invalid; ridica spre caller.
  //    NOTA: vom muta parseJsonBody intr-un fisier shared in pasul de jos.
  const body = await parseJsonBody(c);
  if (body === null) {
    return {
      ok: false,
      response: c.json(
        fail(ErrorCodes.INVALID_JSON, "Body JSON invalid sau prea mare", c),
        400
      ),
    };
  }

  // 3. captcha-key shape
  const captchaKey = (body as { captchaKey?: unknown })?.captchaKey;
  if (!isValidCaptchaKey(captchaKey)) {
    return {
      ok: false,
      response: c.json(
        fail(ErrorCodes.INVALID_CAPTCHA_KEY, "Captcha key invalid (32+ chars hex)", c),
        400
      ),
    };
  }

  return { ok: true, body: body as Record<string, unknown>, captchaKey };
}

/** Helper de validare partajat — muta din rnpm.ts. */
function isValidCaptchaKey(input: unknown): input is string {
  return typeof input === "string" && input.length >= 32 && /^[a-f0-9]+$/i.test(input);
}

/** Helper de parse — muta din rnpm.ts. */
async function parseJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const text = await c.req.text();
    if (!text || text.length === 0) return {};
    return JSON.parse(text);
  } catch {
    return null;
  }
}
```

**ATENTIE — strategie de mutare:**

- `isValidCaptchaKey` si `parseJsonBody` exista deja in `rnpm.ts`. Codex MUTA aceste 2 functii din `rnpm.ts` in `rnpmGuards.ts` ca helpers private (NU export public).
- Daca `parseJsonBody` e folosit si in afara hot-path-ului captcha (e.g. pe rutele `/saved`, `/stats`), EXPORTEAZA-l din `rnpmGuards.ts` si re-importeaza in `rnpm.ts`.
- Grep `parseJsonBody` in tot `backend/src` inainte de mutare — daca apare in alt fisier, ramane in rnpm.ts cu export.

### 4.3 Refactor sites in `rnpm.ts`

Pe cele 3 rute care fac call efectiv la captcha (L224 `/search`, L455 `/bulk`, L571 `/search-split`), inlocuieste secventa:

```typescript
// INAINTE:
const webGate = rejectCaptchaKeyInWebMode(c);
if (webGate) return webGate;
const body = await parseJsonBody(c);
if (body === null) return invalidJson(c);
const { ..., captchaKey, ... } = body ?? {};
if (!isValidCaptchaKey(captchaKey)) return invalidCaptchaKey(c);
```

cu:

```typescript
// DUPA:
const guard = await withRnpmCaptchaGuards(c);
if (!guard.ok) return guard.response;
const { body, captchaKey } = guard;
const { type, params, captchaProvider, fallback2CaptchaKey, captchaMode, startRnpmPage, batchSize, gcode, searchId } = body as {
  // ... same destructuring fara captchaKey
};
```

**Pentru ruta L1136** (`/captcha/balance`): pastreaza doar partea de web-gate (NU are body/captchaKey full validation — verifica codul actual inainte de a aplica `withRnpmCaptchaGuards` complet).

### 4.4 Test nou minimal

Adauga in `backend/src/routes/rnpm.contract.test.ts` (sau creeaza `rnpmGuards.test.ts` daca nu exista contract test):

```typescript
import { describe, it, expect, vi } from "vitest";
import { withRnpmCaptchaGuards } from "./rnpmGuards.ts";

describe("withRnpmCaptchaGuards", () => {
  it("blocheaza web mode cu 501", async () => {
    vi.spyOn(...).mockReturnValue("web"); // mock getAuthMode
    const ctx = makeMockContext({ body: { captchaKey: "a".repeat(32) } });
    const result = await withRnpmCaptchaGuards(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(501);
  });

  it("respinge body JSON invalid cu 400", async () => {
    vi.spyOn(...).mockReturnValue("desktop");
    const ctx = makeMockContext({ rawBody: "not-json{" });
    const result = await withRnpmCaptchaGuards(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it("respinge captchaKey prea scurt cu 400", async () => {
    vi.spyOn(...).mockReturnValue("desktop");
    const ctx = makeMockContext({ body: { captchaKey: "short" } });
    const result = await withRnpmCaptchaGuards(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it("trece in desktop mode cu captchaKey valid", async () => {
    vi.spyOn(...).mockReturnValue("desktop");
    const ctx = makeMockContext({ body: { captchaKey: "f".repeat(32) } });
    const result = await withRnpmCaptchaGuards(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.captchaKey).toBe("f".repeat(32));
  });
});
```

NOTA: Codex foloseste mock context-ul deja existent in `rnpm.contract.test.ts` daca exista. Daca nu, creeaza helper minimal `makeMockContext`.

### 4.5 Verificare pas 2

```powershell
npx tsc --noEmit -p backend/tsconfig.json
npm test --workspace=backend                # toate testele verzi
cd frontend; npm test -- --run; cd ..       # nu trebuie afectat
npx biome check --write backend/src
```

**Acceptance gate:**
- Toate 22 rutele RNPM se compileaza.
- `rnpm.contract.test.ts` (sau echivalent) pasa.
- Cele 4 teste noi `withRnpmCaptchaGuards` pasa.
- Smoke manual: `npm run build` + `npm run electron:dev` → click search RNPM → captcha gate funcționeaza.

```powershell
git add -A
git commit -m "refactor(rnpm): consolidate withRnpmGuards middleware (auth-drift safety)"
```

---

## 5. PASUL 3 — Pin 3 invariants critice in `rnpmSearchService.split.test.ts`

**Effort:** ~1-2h
**Risk:** ZERO (doar adauga tests, nu modifica cod productie)
**Commit message:** `test(rnpm-search): pin I1/I3/I-final-update invariants`

### 5.1 Contextul invariants

`audit/AUDIT-REFACTOR.md` §6.5 listeaza 17 invariants ascunse. 3 sunt critice si NU sunt acoperite de teste astazi:

| Invariant | Fisier:line | Ce strica daca dropped |
|-----------|-------------|------------------------|
| **I1** cross-tenant precheck pe `existingSearchId` | `rnpmSearchService.ts:108-110` | Tenant poate atasa avize pe parent search row al altui tenant |
| **I3** `consecutiveSilentRefusals` reset semantics | `rnpmSearchService.ts:695,704,742,769` | Reset pe transient errors → break fail-fast budget K=3 |
| **I-final-update** `updateSearchTotal` in split `finally{}` | `rnpmSearchService.ts:862` | Abort/timeout → parent search shows 0 in loc de partial → "Grupul K" recovery breaks |

### 5.2 Adauga in `backend/src/services/rnpmSearchService.split.test.ts`

```typescript
// Adauga la finalul fisierului (sau intr-un nou describe):

describe("invariants critice (audit §6.5)", () => {
  beforeEach(async () => {
    // setup DB in-memory existent — reuseaza pattern din celelalte teste
  });

  afterEach(async () => {
    // teardown DB
  });

  // I1: cross-tenant precheck pe existingSearchId
  it("[I1] respinge cross-tenant existingSearchId cu RnpmError(403)", async () => {
    // Setup: creeaza search row cu owner='alice'
    const aliceSearchId = await createSearchRow({ ownerId: "alice", type: "ipoteci" });

    // Act: bob incearca sa atase la search-ul lui alice
    const promise = executeSearch({
      type: "ipoteci",
      params: { cui: "12345" },
      captchaKey: "f".repeat(32),
      captchaProvider: "2captcha",
      captchaMode: "sequential",
      ownerId: "bob",
      startRnpmPage: 1,
      batchSize: 25,
      existingSearchId: aliceSearchId,
    });

    // Assert
    await expect(promise).rejects.toThrow(RnpmError);
    await expect(promise).rejects.toMatchObject({
      code: expect.stringMatching(/forbidden|owner/i),
      status: 403,
    });
  });

  // I3: consecutiveSilentRefusals NU reseteaza pe transient errors
  it("[I3] consecutiveSilentRefusals reset semantics — NU fail-fast la [empty,empty,error,empty]", async () => {
    // Setup: stub RnpmClient ca sa returneze:
    //   page 1: total=0, documents=[]  (empty/silent refusal #1)
    //   page 2: total=0, documents=[]  (silent refusal #2)
    //   page 3: throws RnpmError("transient_network", 503)
    //   page 4: total=0, documents=[]  (silent refusal #3 — counter STILL ar trebui sa fie 2, nu 3)
    // Daca implementarea reseteaza counter-ul pe eroarea de la page 3, page 4 ar lovi K=3 si ar fail-fast.
    // Asteptat: page 4 NU declanseaza fail-fast (counter capped la 2 dupa eroare).

    const stub = vi.fn()
      .mockResolvedValueOnce({ total: 0, documents: [] })
      .mockResolvedValueOnce({ total: 0, documents: [] })
      .mockRejectedValueOnce(new RnpmError("transient", 503))
      .mockResolvedValueOnce({ total: 0, documents: [] });

    // Run executeSearch cu stub si verifica:
    //   - NU s-a aruncat SilentRefusalFailFast
    //   - sau cel putin counter-ul s-a comportat corect (verify via spy/log)
  });

  // I3 partea 2: confirma fail-fast la 3 silent refusals consecutive
  it("[I3] fail-fast la [silent,silent,silent]", async () => {
    const stub = vi.fn()
      .mockResolvedValueOnce({ total: 0, documents: [] })
      .mockResolvedValueOnce({ total: 0, documents: [] })
      .mockResolvedValueOnce({ total: 0, documents: [] });

    await expect(executeSearch({...})).rejects.toThrow(/silent|fail.?fast|refusal/i);
  });

  // I-final-update: updateSearchTotal e apelat in finally{} chiar si la abort
  it("[I-final-update] updateSearchTotal e apelat in finally pe abort mid-split", async () => {
    // Setup: spy on updateSearchTotal din searchRepository
    const updateSpy = vi.spyOn(searchRepo, "updateSearchTotal");

    // Stub fetch ca sa returneze 2 docs apoi sa fie abortat
    const abortController = new AbortController();
    const stub = vi.fn()
      .mockImplementationOnce(async () => {
        // Doc page 1
        return { total: 10, documents: [doc1, doc2] };
      })
      .mockImplementationOnce(async () => {
        // Abort mid-fetch
        abortController.abort();
        throw new DOMException("aborted", "AbortError");
      });

    // Act
    const promise = executeSplitSearch({
      ...baseParams,
      signal: abortController.signal,
      rnpmClient: { fetch: stub } as unknown as RnpmClient,
    });

    await expect(promise).rejects.toThrow();

    // Assert: updateSearchTotal a fost apelat in finally cu numarul partial (2 docs)
    expect(updateSpy).toHaveBeenCalled();
    const lastCall = updateSpy.mock.lastCall;
    expect(lastCall?.[1]).toBe(2); // partial total
  });
});
```

**NOTA pentru Codex:** scrierea exacta a fixturei depinde de signature-urile reale din `rnpmSearchService.ts` si `rnpmClient.ts`. Codex citeste fisierul si adapteaza imports/types. Helper-ele de setup DB sunt deja in split.test.ts L20-30 (vezi `Database`, `closeDb`, `getDb`). Nu reinventa wheel-ul.

### 5.3 Verificare pas 3

```powershell
npm test --workspace=backend -- rnpmSearchService.split.test.ts
# Astept: cele 3 teste noi pasa + cele existente raman verzi

npx tsc --noEmit -p backend/tsconfig.json
npx biome check --write backend/src
```

**Acceptance gate:**
- 3 teste noi PASS (NU SKIP).
- Toate testele existente raman verzi.

```powershell
git add -A
git commit -m "test(rnpm-search): pin I1/I3/I-final-update invariants"
```

---

## 6. PASUL 4 — Close audit (docs + memory)

**Effort:** ~20-30 min
**Risk:** ZERO (doar docs)
**Commit message:** `docs(audit): close refactor plan — Tier 3/4 deferred per validation`

### 6.1 Update `audit/AUDIT-REFACTOR.md` §8 verdict

Inlocuieste continutul §8 cu (mentine restul fisierului intact):

```markdown
## 8. Verdict final [CLOSED 2026-05-17 — v2.28.3]

**Stare codebase:** 🟢 **Sanatos cu datorie tehnica concentrata DEFERRED.**

Auditul a fost validat cu 5 agenti specializati (refactor-planner, backend-reliability,
release-readiness, deep-code-reviewer, test-architect) inainte de v2.28.3. Concluzii:

### Tier 3 — Web cutover blockers: DEFERRED

P0-new (scheduler), P1 (AlertPubSub), P2 (IdempotencyStore) NU sunt blocker-i sub
topologia declarata in `PLAN-monitoring-webmode.md`:

- SQLite + Litestream forever = single-writer prin fizica
- <100 useri interni = 1 replica suficient
- Singletoni corecti pe single-instance

**Trigger reactivare:** decizie active-active (>1 replica simultan) sau >500 useri
activi simultan. Pana atunci, codul actual e correct, fara latent bugs in deployul tinta.

### Tier 4 — God components: DEFERRED + 4 erori factuale identificate

- P3 S1/S2/S3: `useAiAnalysisCache` NU EXISTA in cod (errata G4). DosareTable e deja
  decomposed cu 4 hooks + AI panel sibling (`DosareAiAnalysisPanel`).
- P6 Alerts.tsx SSE: hook-ul deja exista in `frontend/src/hooks/useAlertsStream.ts:112-183`
  cu reconnect exponential corect. Audit-ul a citat fisierul gresit.
- P7 manual-content.tsx: JSX static, zero state/effect. Category error.
- P10 alerts.ts dismiss-bulk: tranzactia EXISTA deja la `monitoringAlertsRepository.ts:574`
  (wraps loop-ul de chunk-uri in `db.transaction`). Bug-ul nu exista.
- P11 avizRepository.ts: `buildAvizWhere` L462 vs L629 acopera coloane diferite
  (12 vs 24) — NU duplicare.

**Restul P-urilor (P3/P4/P6/P8/P9):** "Revisit on touch" — split numai cand
schimbarea functionala loveste fisierul respectiv.

### Livrat in v2.28.3 (refactor closeout)

- Drop-export cleanup pe 7 simboluri (`audit/06` §5+§7)
- `withRnpmGuards` middleware: 22 endpoints RNPM cu pattern consistent
- 3 teste de characterizare pe invariants I1/I3/I-final-update din rnpmSearchService

**Effort total livrat:** ~3-4h.
**Effort total economisit prin defer:** ~60h (Tier 3 22h + Tier 4 ramas 38h).
```

### 6.2 Update `audit/06-dead-code.md` §10

Marcheaza actiunile #1-#3 ca **DONE** (deja erau done pre-v2.28.3, doar nu erau documentate) si actiunea #4 (drop-export pe 5+2 simboluri) ca **DONE in v2.28.3** + #5 (`@internal` JSDoc) ca **DONE in v2.28.3**.

### 6.3 Update `CHANGELOG.md`

Adauga sectiune noua la varf:

```markdown
## v2.28.3 — 2026-05-17

### Cleanup & invariants pin

- Drop-export cleanup pe 7 simboluri folosite doar intern (audit/06 §5+§7).
- `withRnpmGuards` middleware: consolidare guard-uri pe 22 endpoints RNPM —
  inchide auth-drift hazard (un endpoint viitor NU mai poate uita web-mode gate).
- 3 teste de characterizare pe `rnpmSearchService.ts` invariants I1 (cross-tenant
  precheck), I3 (silent-refusals reset), I-final-update (updateSearchTotal in finally).
- Refactor closeout: Tier 3 (web blockers) + restul Tier 4 (god components) marcate
  DEFERRED in `audit/AUDIT-REFACTOR.md` §8 dupa validare cu 5 agenti. Trigger
  reactivare = decizie active-active / >500 useri activi.
```

### 6.4 Update `frontend/src/data/changelog-entries.tsx` (in-app changelog)

Adauga entry corespunzator v2.28.3 — vezi pattern existent in fisier.

### 6.5 Update `README.md`, `STATUS.md`, `DOCUMENTATIE.md`, `SESSION-HANDOFF.md`

Per checklist `CLAUDE.md` "Bump versiunii":
- `README.md` campul "Versiune curenta"
- `STATUS.md` "Data curenta" + "Versiune curenta reala"
- `DOCUMENTATIE.md` "Versiune curenta"
- `SESSION-HANDOFF.md` daca exista referinte la sprint activ

### 6.6 Update `package.json` (root + backend + frontend) + `package-lock.json`

`"version": "2.28.3"` in toate 3 fisiere `package.json`.

### 6.7 Commit

```powershell
git add -A
git commit -m "docs(audit): close refactor plan — Tier 3/4 deferred per validation"
```

---

## 7. PASUL 5 — Release v2.28.3

**Effort:** ~10-15 min
**Risk:** LOW (workflow standard)
**Commit message:** `release: v2.28.3 — refactor closeout + invariants pin`

### 7.1 Workflow obligatoriu (per CLAUDE.md "Workflow obligatoriu pentru push pe GitHub")

```powershell
# 1. Biome pe tot ce am atins
npx biome check --write .

# 2. Type-check
npx tsc --noEmit -p backend/tsconfig.json
cd frontend; npx tsc --noEmit; cd ..

# 3. Build
npm run build

# 4. Tests
npm test --workspace=backend
cd frontend; npm test -- --run; cd ..
```

**Acceptance gate:** toate 4 verzi. Daca biome reformateaza, re-stage + recommit follow-up.

### 7.2 Smoke desktop (manual, dupa push)

User face manual:

```powershell
npm run electron:dev
```

Verifica:
- App porneste fara erori in console
- Sidebar arata "v2.28.3" (verifica ca `__APP_VERSION__` s-a reinjectat — restart Electron daca arata vechi)
- Click pe Dashboard → load OK
- Click pe RNPM → search test cu CUI 12345 → captcha gate functioneaza (NU 500 / NU regresie)
- Click pe Monitorizare → list load OK
- Click pe Changelog → vezi v2.28.3 entry

### 7.3 Final push

```powershell
git push -u origin chore/refactor-closeout-v2.28.3
gh pr create --title "release: v2.28.3 — refactor closeout + invariants pin" --body "$(cat <<'EOF'
## Summary
- Drop-export cleanup pe 7 simboluri (audit/06 §5+§7)
- `withRnpmGuards` middleware consolidat pe 22 endpoints RNPM
- 3 teste de characterizare pin I1/I3/I-final-update in rnpmSearchService
- Refactor closeout: Tier 3 + restul Tier 4 marcate DEFERRED in audit/§8

## Validation
- 5 agenti specializati au confirmat ca Tier 3 NU este gating sub topologia
  declarata (SQLite + Litestream + 1 replica + <100 useri interni)
- 4 erori factuale gasite in audit (P10 deja done, P6 in fisier separat, P3
  useAiAnalysisCache phantom, P7 nu e god component) — corectate in §8

## Test plan
- [x] biome check --write . — zero erori
- [x] tsc --noEmit pe ambele workspaces — verde
- [x] npm test --workspace=backend — toate testele verzi (3 noi adaugate)
- [x] cd frontend && npm test -- --run — 102+ teste verzi
- [x] npm run build — bundle iese curat
- [ ] Smoke desktop manual (user) — RNPM search + Monitorizare load + Dashboard

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 8. Post-Codex verification (Claude-side agents)

Dupa ce Codex face push la branch, USER ruleaza in sesiunea Claude principala:

```
verifica PR-ul cu 5 agenti in paralel: deep-code-reviewer pe diff complet,
backend-reliability-reviewer pe withRnpmGuards changes, test-architect pe
rnpmSearchService.split.test.ts additions, claude-guard pentru CLAUDE.md
compliance, release-readiness-reviewer pre-merge.
```

Claude lanseaza in paralel:

1. **deep-code-reviewer** — review pe full diff: cauta typos, missed renames, accidental behavior changes.
2. **backend-reliability-reviewer** — focus pe `withRnpmGuards`: verifica ca cele 3 rute critice (/search, /bulk, /search-split) pastreaza EXACT acelasi behavior 501/400/400 ca inainte. Verifica ca `/captcha/balance` nu a fost rupt.
3. **test-architect** — verifica ca cele 3 teste noi (I1, I3, I-final-update) pin invariants real (nu mock-uri prea slabe care s-ar putea verzifica chiar daca cod-ul ar fi rupt).
4. **claude-guard** — verifica compliance CLAUDE.md: biome verde, version bumps pe toate fisierele listate in checklist, changelog-entries.tsx updated, README/STATUS/DOCUMENTATIE updated.
5. **release-readiness-reviewer** — rollback story, blast radius, smoke checklist.

**Gate de merge:** toti 5 trec verde sau cu doar `[Low]` findings. Orice `[High]` sau `[Critical]` finding → fix inainte de merge.

---

## 9. Rollback plan

Daca dupa merge se descopera regresie:

```powershell
git revert <merge-sha>     # nu rebase, nu force push
npm version 2.28.4 --no-git-tag-version
# patch follow-up
```

**Zero schema migration** in v2.28.3 → rollback trivial, fara data fix.

---

## 10. Acceptance gates (rezumat)

| Gate | Criteriu | Cine verifica |
|------|----------|---------------|
| Pre-flight | tsc+biome+tests+build verzi pe main | Codex |
| Post pasul 1 | tsc+tests verzi dupa drop-export | Codex |
| Post pasul 2 | rnpm.contract.test verde + 4 teste noi withRnpmCaptchaGuards verzi + smoke desktop RNPM | Codex + USER |
| Post pasul 3 | 3 teste noi I1/I3/I-final-update verzi (NOT skipped) | Codex |
| Post pasul 4 | toate .md updated per checklist CLAUDE.md | Codex + claude-guard |
| Pre-push | biome+tsc+build+tests verzi | Codex |
| Post-push | 5-agent review verde | USER + Claude |
| Smoke desktop | App porneste, RNPM search OK, version sidebar v2.28.3 | USER |
| Merge | toate gate-urile verzi | USER |

---

## 11. Decizii inchise (NU le redeschide)

1. Tier 3 (P0-new, P1, P2) NU se livreaza acum. Trigger explicit pentru reactivare = decizie active-active.
2. Tier 4 (P3 S2/S3, P4, P6, P7, P8, P9, P11) NU se livreaza acum. "Revisit on touch".
3. P12/D1 XLSX builder unificat este IMPOSIBIL TEHNIC (exceljs vs xlsx-js-style). Errata G5.
4. P10 alerts.ts dismiss-bulk transaction EXISTA deja. NU mai e in scope.
5. Audit-ul a avut 4-5 erori factuale; corectiile sunt documentate in §8 noua.
6. NU schimba decizia "SQLite + Litestream forever" (e in PLAN-monitoring-webmode.md).

---

## 12. Links

- `audit/AUDIT-REFACTOR.md` — master audit (cu errata G1-G5)
- `audit/06-dead-code.md` — dead code findings (subset relevant pentru pasul 1)
- `CLAUDE.md` — workflow obligatoriu + checklist version bump
- `PLAN-monitoring-webmode.md` — strategie web cutover (SQLite + Litestream + 1 replica)
- `CHANGELOG.md` — version history
