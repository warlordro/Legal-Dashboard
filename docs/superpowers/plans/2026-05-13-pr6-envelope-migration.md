# PR-6 - Envelope migration pentru rutele legacy (rnpm/ai/termene)

> **Pentru Codex:** plan task-by-task, TDD strict, commit-uri mici. Steps folosesc `- [ ]` pentru tracking. Romana fara diacritice. Branch nou `feat/pr6-envelope-migration` de la `main` (`c596400`). Target version: **v2.26.0**.

> **Plan v2 — 2026-05-13** — revizuit dupa multi-agent review (api-contract, release-readiness, backend-reliability, test-architect). Schimbari fata de v1: scope corectat (~100 ocurente, NU ~45), INSUFFICIENT_FUNDS reclasat 402 (NU 503), payload structurat `limit_exceeded` cu `details`, exceptii explicite enumerate, pagination NU se schimba comportamental, frontend `api.ts` migrat obligatoriu (NU verify-only), `rnpm.filter.test.ts` actualizat in acelasi commit cu FILTER_*.

**Goal:** Migrare la envelope standard `{ data, error: { code, message }, requestId }` pentru rutele legacy care inca emit raw `{ error: "string" }` (rnpm, ai, termene). Inchide Batch 1 din `FIXES-TODO.md`.

**Architecture:** Pastram envelope-ul existent din `backend/src/util/envelope.ts` (`ok()` + `fail()`). NU adoptam `@hono/zod-openapi` in acest PR. Migrarea e mecanica DAR cu exceptii enumerate explicit la `Cai excluse / cazuri speciale`. Inlocuim `c.json({ error: "..." }, 4xx)` cu `c.json(fail("CODE", "msg", c [, details]), 4xx)`.

**Tech Stack:** Hono + zod + envelope helper existent + vitest. Frontend `rnpmApi.ts` dual-shape parser deja gata (`frontend/src/lib/rnpmApi.ts:405-414`); `frontend/src/lib/api.ts` are 3 consumer-i string-only care **trebuie migrati la dual-shape in acest PR**.

**Risk:** MEDIU. Mitigare:
1. Frontend `api.ts:64` (`apiFetchBlobWithBody`), `api.ts:129` (`apiFetchStream`), `api.ts:333` (SSE AI judge event handler) — Task 7 le migreaza la dual-shape OBLIGATORIU. Daca lasam string-only, export XLSX/PDF + AI multi-model error UX se rup silentios.
2. Smoke manual extins pe Electron dupa migrare (Task 9 Step 3 — 10 cai, nu 5).
3. Tests existente documentau shape-ul vechi ca migration guard; le rescriem in acelasi commit cu schimbarea backend (NU separat — altfel CI pica).

---

## Decizii semantice (luate inainte de plan)

1. **`INSUFFICIENT_FUNDS` → HTTP 402 Payment Required.** NU 503. Motiv: 503 e "retry later", 402 e "user actionable, nu retry-ui". Reverse proxy-uri / SDK-uri retry-uiesc 503 automat = consum inutil. 402 e semantic corect pentru "sold insuficient la 2Captcha/CapSolver".
2. **`Retry-After: 0` adaugat pe raspunsul 402** ca semnal explicit catre clienti generici sa NU reincerce.
3. **Pagination guard ramane neschimbat comportamental.** NU se introduce `INVALID_PAGE` 400 unde inainte era coercitie silentioasa la 0. Migrarea e shape-only — daca exista deja un guard explicit, primeste envelope; daca exista doar coercitie, ramane coercitie. Motiv: evitam breaking change comportamental pe pagination care nu e in scope-ul PR-ului.
4. **`recordAudit` payloads neschimbate.** Audit events (`rnpm.cap_hit` etc.) sunt persistate in DB, nu emise ca HTTP responses — raman raw, nu primesc envelope.
5. **Detectia `INSUFFICIENT_FUNDS` se tipizeaza la nivel de service, NU prin string-match in handler.** Creem `CaptchaInsufficientFundsError extends Error` in `services/captchaSolver.ts` si handler-ul verifica `e instanceof CaptchaInsufficientFundsError`. Evitam false-positive pe "Could not parse balance response".

---

## Cai EXCLUSE explicit din migrare (NU le atinge)

Codex trebuie sa NU migreze urmatoarele — sunt non-HTTP-JSON sau pastreaza shape special:

1. **Path 499 abort la `rnpm.ts:235-238`** — emite `new Response(JSON.stringify({ error, searchId }), { status: 499 })`. Nu trece prin `c.json()`. `searchId` e citit de frontend pentru partial state. **Lasa-l intact.** Singura modificare permisa: adauga `requestId: getRequestId(c)` in body daca e fix simplu, dar NU schimba shape-ul.

2. **SSE event payloads** — `event:"error"`, `event:"aborted"`, `event:"timeout"`, `event:"progress"` (rnpm.ts ~liniile 485, 716 si vecinatati). Nu sunt HTTP responses. **Lasa-le intact.**

3. **OK paths** — `c.json({ balance })`, `c.json({ ok: true })`, `c.json(payload)` cu status 200/201. **Nu se schimba in PR-6.**

4. **`recordAudit` calls** — audit events catre DB, nu HTTP. **Nu se schimba.**

5. **Console error logging** — `console.error(...)` ramane neschimbat.

Verifica EXPLICIT inainte de Task 4 ca grep-ul tau exclude aceste cai.

---

## Cazuri speciale care necesita migrare cu `details` (NU find-replace mecanic)

1. **`rnpm.ts:242-254` — `limit_exceeded` cu payload structurat.** Forma curenta:
   ```ts
   return c.json({
     error: e.message,
     code: "limit_exceeded",
     total,
     limit,
     splittable: { type: e.splittable.type, ... },
   }, 400);
   ```
   Migrare CORECTA cu `details`:
   ```ts
   return c.json(
     fail(ErrorCodes.LIMIT_EXCEEDED, e.message, c, {
       total,
       limit,
       splittable: e.splittable,
     }),
     400
   );
   ```
   Frontend `rnpmApi.ts` citeste `body.error.details.splittable` pentru butonul split-search. Verifica ca `fail()` accepta al 4-lea arg `details`; daca nu, extinde helper-ul in Task 1.

2. **`rnpm.ts:289` — `FILTER_DISABLED` 503.** Forma curenta: `c.json({ error: "...", code: "FILTER_DISABLED" }, 503)`. Migrare: `c.json(fail(ErrorCodes.FILTER_DISABLED, msg, c), 503)`. **Atentie:** `body.code` (top-level) dispare, `body.error.code` il inlocuieste. **Test `rnpm.filter.test.ts` trebuie actualizat in acelasi commit** — `FilterRouteBody.code` la radacina nu mai exista.

3. **`rnpm.ts:355` — `FILTER_TIMEOUT` 503.** Acelasi pattern ca `FILTER_DISABLED`.

4. **`rnpm.ts:186, :433, :557` — 409 dedup `clientRequestId`.** Trei puncte: `Cerere deja in curs`, `Bulk deja in curs`, `Split deja in curs`. Migrare cu `fail(ErrorCodes.DUPLICATE_REQUEST, msg, c)`.

5. **`rnpm.ts:837, :927` — 501 Desktop-only (diferit de WEB_MODE_NOT_IMPLEMENTED).** Daca emit "neimplementat in desktop" sau "doar Electron", folosesc `ErrorCodes.DESKTOP_ONLY`, NU `WEB_MODE_NOT_IMPLEMENTED`. Verifica contextul cand le atingi.

---

## File Structure

**Backend (modify):**
- `backend/src/routes/rnpm.ts` — **~69 ocurente** raw `c.json({ error })` (search, bulk, captcha, web-mode, bodyTooLarge, 409 dedup x3, 503 filter x2, 500 catch x7, 501 desktop-only x2, validari params x ~50). Verifica cu `grep -nE 'c\.json\(\s*\{\s*error:' backend/src/routes/rnpm.ts | wc -l`.
- `backend/src/routes/ai.ts` — **~18 ocurente** 4xx/5xx (validare model, body, API keys, judge, errors AI). Verifica cu acelasi grep.
- `backend/src/routes/termene.ts` — **~13 ocurente** distribuite pe 4 rute (bodyTooLarge middleware + parseTermen helper + POST /dosare-termene-excel + POST /search). NU 1.
- `backend/src/util/envelope.ts` — adauga export `ErrorCodes` (constante) + verifica/extinde semnatura `fail()` cu al 4-lea param `details?: Record<string, unknown>`.
- `backend/src/services/captchaSolver.ts` — adauga `CaptchaInsufficientFundsError` class.
- `frontend/src/lib/api.ts` — migreaza 3 consumer-i la dual-shape parser (Task 7, OBLIGATORIU).

**Backend (tests modify):**
- `backend/src/routes/rnpm.contract.test.ts` — ~17+ assertions migrate la envelope.
- `backend/src/routes/rnpm.filter.test.ts` — `FilterRouteBody.code` migrat la `body.error.code` (in acelasi commit cu Task 4!).

**Backend (tests new):**
- `backend/src/routes/ai.contract.test.ts` — 4+ scenarii complete (NU stub gol).
- `backend/src/routes/termene.contract.test.ts` — minimum 4 scenarii (cele 4 rute distincte).
- `backend/src/routes/rnpm.envelope.test.ts` — sentinel pe envelope (bodyTooLarge, captcha 402, web-mode 501, limit_exceeded cu details).
- `backend/src/util/envelope.test.ts` — sentinel pe `ErrorCodes` + `fail()` cu `details` + `fail()` cu `requestId` lipsa.

**Docs (modify):**
- `FIXES-TODO.md` — bifeaza Batch 1 items
- `CHANGELOG.md` — entry v2.26.0
- `frontend/src/data/changelog-entries.tsx` — in-app entry v2.26.0
- `README.md` + `STATUS.md` + `DOCUMENTATIE.md` + `SESSION-HANDOFF.md` + `CLAUDE.md` — bump version

---

## Standard error codes

Adauga in `backend/src/util/envelope.ts` ca constante exportate. Codurile sunt UPPER_SNAKE_CASE, semantice, stabile:

```ts
export const ErrorCodes = {
  // Input / validation
  INVALID_JSON: "INVALID_JSON",
  INVALID_PARAMS: "INVALID_PARAMS",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_CAPTCHA_KEY: "INVALID_CAPTCHA_KEY",

  // Limits / quota
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",

  // Concurrency / idempotency
  DUPLICATE_REQUEST: "DUPLICATE_REQUEST",

  // External / upstream
  CAPTCHA_BALANCE_UNAVAILABLE: "CAPTCHA_BALANCE_UNAVAILABLE",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  FILTER_DISABLED: "FILTER_DISABLED",
  FILTER_TIMEOUT: "FILTER_TIMEOUT",

  // AI
  MISSING_API_KEY: "MISSING_API_KEY",
  UNKNOWN_MODEL: "UNKNOWN_MODEL",
  AI_ANALYSIS_FAILED: "AI_ANALYSIS_FAILED",

  // Mode / availability
  WEB_MODE_NOT_IMPLEMENTED: "WEB_MODE_NOT_IMPLEMENTED",
  DESKTOP_ONLY: "DESKTOP_ONLY",

  // Generic
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
```

---

## Tasks

### Task 1: Extinde `envelope.ts` cu `ErrorCodes` + `details` support + `CaptchaInsufficientFundsError`

**Files:**
- Modify: `backend/src/util/envelope.ts`
- Modify: `backend/src/services/captchaSolver.ts`
- Test: `backend/src/util/envelope.test.ts`

- [ ] **Step 1: Write failing test sentinel**

```ts
// backend/src/util/envelope.test.ts
import { describe, it, expect } from "vitest";
import type { Context } from "hono";
import { ErrorCodes, fail, ok } from "./envelope";

const makeCtx = (requestId?: string): Context => ({
  get: (key: string) => (key === "requestId" ? requestId : undefined),
}) as unknown as Context;

describe("envelope error codes", () => {
  it("expune toate codurile UPPER_SNAKE_CASE", () => {
    const expected = [
      "INVALID_JSON", "INVALID_PARAMS", "VALIDATION_ERROR", "INVALID_CAPTCHA_KEY",
      "PAYLOAD_TOO_LARGE", "LIMIT_EXCEEDED",
      "DUPLICATE_REQUEST",
      "CAPTCHA_BALANCE_UNAVAILABLE", "INSUFFICIENT_FUNDS", "FILTER_DISABLED", "FILTER_TIMEOUT",
      "MISSING_API_KEY", "UNKNOWN_MODEL", "AI_ANALYSIS_FAILED",
      "WEB_MODE_NOT_IMPLEMENTED", "DESKTOP_ONLY",
      "NOT_FOUND", "INTERNAL_ERROR",
    ];
    for (const code of expected) {
      expect((ErrorCodes as Record<string, string>)[code]).toBe(code);
    }
  });

  it("fail() include details cand sunt furnizate", () => {
    const env = fail(ErrorCodes.LIMIT_EXCEEDED, "prea multe", makeCtx("req-1"), { total: 1500, limit: 1000 });
    expect(env).toEqual({
      data: null,
      error: { code: "LIMIT_EXCEEDED", message: "prea multe", details: { total: 1500, limit: 1000 } },
      requestId: "req-1",
    });
  });

  it("fail() fara details NU emite cheia `details` (omis, nu null)", () => {
    const env = fail(ErrorCodes.INVALID_JSON, "json", makeCtx("req-2"));
    expect(env).toEqual({
      data: null,
      error: { code: "INVALID_JSON", message: "json" },
      requestId: "req-2",
    });
    expect("details" in env.error).toBe(false);
  });

  it("fail() cu requestId lipsa returneaza string gol stabil (nu undefined)", () => {
    const env = fail(ErrorCodes.INTERNAL_ERROR, "x", makeCtx(undefined));
    expect(typeof env.requestId).toBe("string");
  });
});
```

- [ ] **Step 2: Run test - verifica fail**

Run: `npm test --workspace=backend -- --run util/envelope`
Expected: FAIL.

- [ ] **Step 3: Implementare**

Editeaza `backend/src/util/envelope.ts`:
- Adauga `ErrorCodes` map (lista completa de mai sus).
- Extinde semnatura `fail()` la `fail(code: ErrorCode, message: string, c: Context, details?: Record<string, unknown>)`. Daca `details` e furnizat, include in `error.details`; altfel, omite cheia (NU pune null).
- Asigura `requestId` fallback la string gol daca `c.get("requestId")` e undefined.

Editeaza `backend/src/services/captchaSolver.ts`:
- Adauga la sfarsit:
```ts
export class CaptchaInsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptchaInsufficientFundsError";
  }
}
```
- Identifica path-urile care detecteaza insufficient funds in solver (2Captcha "ERROR_ZERO_BALANCE", CapSolver "ERROR_NO_FUNDS" sau mesaje similare). In acele locuri, arunca `throw new CaptchaInsufficientFundsError(detailedMsg)` in loc de `Error` generic.

- [ ] **Step 4: Run test - verifica pass**

Run: aceeasi comanda. Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p backend/tsconfig.json`. Expected: zero erori.

- [ ] **Step 6: Commit**

```bash
git add backend/src/util/envelope.ts backend/src/util/envelope.test.ts backend/src/services/captchaSolver.ts
git commit -m "feat(envelope): ErrorCodes + details support + CaptchaInsufficientFundsError"
```

---

### Task 2: Migrare `rnpm.ts` - web-mode 501 + bodyTooLarge

**Files:**
- Modify: `backend/src/routes/rnpm.ts`
- Modify: `backend/src/routes/rnpm.contract.test.ts`

- [ ] **Step 1: Verifica `requestIdContext` middleware e montat pe routerul rnpm**

Run: `grep -n 'requestId\|requestIdContext' backend/src/index.ts backend/src/app.ts 2>/dev/null`

Asteapta: middleware aplicat global sau pe routerul rnpm. Daca lipseste, opreste-te si raporteaza — `fail()` are nevoie de el pentru `requestId`.

- [ ] **Step 2: Modifica `rejectCaptchaKeyInWebMode` (linii ~125-134)**

Adauga import top of file: `import { fail, ErrorCodes } from "../util/envelope.ts";`

Inlocuieste functia:
```ts
function rejectCaptchaKeyInWebMode(c: import("hono").Context): Response | null {
  if (getAuthMode() !== "web") return null;
  return c.json(
    fail(
      ErrorCodes.WEB_MODE_NOT_IMPLEMENTED,
      "RNPM in web mode necesita stocare server-side a cheii captcha. Folositi desktop sau asteptati per-user key storage.",
      c
    ),
    501
  );
}
```

NOTA: mesajul curent contine "neimplementat in v2.11.0" — ELIMINA versiunea hardcodata.

- [ ] **Step 3: Modifica `bodyTooLarge` helper (linia ~41)**

```ts
const bodyTooLarge = (c: import("hono").Context) =>
  c.json(fail(ErrorCodes.PAYLOAD_TOO_LARGE, "Payload prea mare", c), 413);
```

- [ ] **Step 4: Modifica `rnpm.contract.test.ts` assertions web-mode + bodyTooLarge**

Pentru testele web-mode 501 (~3 teste pe `/search`, `/bulk`, `/captcha/balance`):
```ts
expect(res.status).toBe(501);
const body = await res.json();
expect(body).toMatchObject({
  data: null,
  error: { code: "WEB_MODE_NOT_IMPLEMENTED", message: expect.any(String) },
  requestId: expect.any(String),
});
```

Pentru testele bodyTooLarge 413 (~2 teste):
```ts
expect(res.status).toBe(413);
const body = await res.json();
expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
```

Restul assertions raw `typeof body.error === "string"` raman pana la task-urile urmatoare — NU le toata acum.

- [ ] **Step 5: Run tests**

Run: `npm test --workspace=backend -- --run rnpm.contract`
Expected: testele web-mode + bodyTooLarge PASS; restul **vor pica daca grep-ul prinde alte locuri unde shape-ul vechi se astepta**. Daca pica teste pe cai pe care NU le-ai atins inca, raporteaza-te (e semn ca grep-ul atinge zone neasteptate).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/rnpm.ts backend/src/routes/rnpm.contract.test.ts
git commit -m "refactor(rnpm): web-mode 501 + bodyTooLarge la envelope"
```

---

### Task 3: Migrare `rnpm.ts` - captcha balance 402 INSUFFICIENT_FUNDS + restul captcha endpoint

**Files:**
- Modify: `backend/src/routes/rnpm.ts`
- Modify: `backend/src/routes/rnpm.contract.test.ts`

**Decizie semantica:** HTTP 402, NU 503. Cu `Retry-After: 0` ca semnal explicit non-retry.

- [ ] **Step 1: Modifica `/captcha/balance` (linii ~1091-1109)**

```ts
rnpmRouter.post("/captcha/balance", limitSmall, async (c) => {
  const webGate = rejectCaptchaKeyInWebMode(c);
  if (webGate) return webGate;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(fail(ErrorCodes.INVALID_JSON, "JSON invalid", c), 400);
  }
  const { captchaKey, captchaProvider } = (body ?? {}) as { captchaKey?: unknown; captchaProvider?: unknown };
  if (typeof captchaKey !== "string") {
    return c.json(fail(ErrorCodes.INVALID_CAPTCHA_KEY, "Cheie lipsa", c), 400);
  }
  try {
    const balance = await getCaptchaBalance(captchaKey, parseProvider(captchaProvider));
    return c.json({ balance }); // OK path NU se schimba
  } catch (e) {
    if (e instanceof CaptchaInsufficientFundsError) {
      c.header("Retry-After", "0"); // signal non-retry
      return c.json(fail(ErrorCodes.INSUFFICIENT_FUNDS, e.message, c), 402);
    }
    const msg = e instanceof Error ? e.message : "Eroare";
    return c.json(fail(ErrorCodes.CAPTCHA_BALANCE_UNAVAILABLE, msg, c), 400);
  }
});
```

Adauga import: `import { CaptchaInsufficientFundsError } from "../services/captchaSolver.ts";`

- [ ] **Step 2: SCOATE migrarea `INVALID_PAGE`**

Decizia: NU se introduce 400 INVALID_PAGE in PR-6. Coercitia silentioasa la 0/clamp ramane. Daca exista deja un guard explicit care emite raw `{ error: "page invalid" }, 400`, ATUNCI il migrezi la envelope cu acelasi cod si status. Daca NU exista, NU adauga unul nou. Comportamentul observabil NU se schimba.

Run: `grep -n 'page' backend/src/routes/rnpm.ts | grep -i 'invalid\|negative\|error'`

Daca apar matches cu `c.json({ error... })`, migra-le la envelope `INVALID_PARAMS`. Daca nu, sari step-ul.

- [ ] **Step 3: Adauga test pentru 402 INSUFFICIENT_FUNDS**

In `rnpm.contract.test.ts`, la inceputul fisierului asigura-te ca exista `vi.mock("../services/captchaSolver.ts", ...)` declarat global. Daca NU exista, adauga:

```ts
import { vi } from "vitest";

vi.mock("../services/captchaSolver.ts", () => ({
  getCaptchaBalance: vi.fn(),
  CaptchaInsufficientFundsError: class extends Error {
    constructor(message: string) { super(message); this.name = "CaptchaInsufficientFundsError"; }
  },
}));
```

Apoi adauga in `describe("POST /api/v1/rnpm/captcha/balance ...")`:

```ts
it("returneaza 402 INSUFFICIENT_FUNDS cand provider raporteaza fonduri insuficiente", async () => {
  const captchaSolver = await import("../services/captchaSolver.ts");
  const { getCaptchaBalance, CaptchaInsufficientFundsError } = captchaSolver;
  vi.mocked(getCaptchaBalance).mockRejectedValueOnce(
    new CaptchaInsufficientFundsError("Sold insuficient (2Captcha)")
  );

  const res = await buildApp().request("/api/v1/rnpm/captcha/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ captchaKey: "0".repeat(32), captchaProvider: "2captcha" }),
  });

  expect(res.status).toBe(402);
  expect(res.headers.get("Retry-After")).toBe("0");
  const body = await res.json();
  expect(body.error.code).toBe("INSUFFICIENT_FUNDS");
  expect(body.error.message).toContain("Sold insuficient");
  expect(body.requestId).toEqual(expect.any(String));
});

it("returneaza 400 CAPTCHA_BALANCE_UNAVAILABLE pentru alte erori provider (NU false-positive pe 'balance')", async () => {
  const { getCaptchaBalance } = await import("../services/captchaSolver.ts");
  vi.mocked(getCaptchaBalance).mockRejectedValueOnce(new Error("Could not parse balance response"));

  const res = await buildApp().request("/api/v1/rnpm/captcha/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ captchaKey: "0".repeat(32), captchaProvider: "2captcha" }),
  });

  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("CAPTCHA_BALANCE_UNAVAILABLE");
});
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace=backend -- --run rnpm.contract`
Expected: noile teste PASS + restul nemodificate.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/rnpm.ts backend/src/routes/rnpm.contract.test.ts
git commit -m "refactor(rnpm): captcha balance 402 INSUFFICIENT_FUNDS via typed error"
```

---

### Task 4: Migrare `rnpm.ts` - cai 4xx/5xx ramase + actualizare `rnpm.filter.test.ts`

**Files:**
- Modify: `backend/src/routes/rnpm.ts`
- Modify: `backend/src/routes/rnpm.contract.test.ts`
- **Modify (in acelasi commit): `backend/src/routes/rnpm.filter.test.ts`** — `FilterRouteBody.code` se muta la `body.error.code`.

Scop: ~60 ocurente raw ramase in rnpm.ts dupa Task 2-3. Migrare sistematica + exceptii enumerate.

- [ ] **Step 1: Inventariere finala**

Ruleaza 3 grep-uri si **noteaza count-urile**:

```bash
grep -nE 'c\.json\(\s*\{\s*error:' backend/src/routes/rnpm.ts | wc -l
grep -nE 'c\.json\(\s*\{\s*error:' backend/src/routes/rnpm.ts > /tmp/rnpm-remaining.txt
grep -n '"code"' backend/src/routes/rnpm.ts
```

- Total raw `{ error: ` ar trebui sa fie ~60 dupa Task 2+3 (sub initialul de 69).
- A doua grep listeaza fiecare locatie ramasa cu line number.
- A treia grep gaseste ocurente cu `code` la top-level (din care `FILTER_DISABLED`, `FILTER_TIMEOUT`, `limit_exceeded` sunt deja listate in "Cazuri speciale"; orice alt match e suspect — verifica manual).

- [ ] **Step 2: Mapare la coduri (lista exhaustiva)**

Pentru fiecare locatie:

| Mesaj / context | Cod | Status |
|----|----|----|
| `"JSON invalid"` | `INVALID_JSON` | 400 |
| `"Tip cautare invalid"`, `"Parametri lipsa"` | `INVALID_PARAMS` | 400 |
| Zod validation errors | `VALIDATION_ERROR` | 400 |
| `"Cheie captcha lipsa sau invalida"` | `INVALID_CAPTCHA_KEY` | 400 |
| Limit exceeded (vezi cazul special) | `LIMIT_EXCEEDED` + `details` | 400 |
| 409 dedup x3 (`Cerere/Bulk/Split deja in curs`) | `DUPLICATE_REQUEST` | 409 |
| `FILTER_DISABLED` (vezi cazul special) | `FILTER_DISABLED` | 503 |
| `FILTER_TIMEOUT` (vezi cazul special) | `FILTER_TIMEOUT` | 503 |
| 500 catch generic (`"Eroare interna"`, fallback) | `INTERNAL_ERROR` | 500 |
| 501 desktop-only (linii ~837, ~927) | `DESKTOP_ONLY` | 501 |
| 404 not found | `NOT_FOUND` | 404 |

NU schimba status-urile decat unde e specificat in tabel.

- [ ] **Step 3: Aplica migrarea per locatie**

Pentru fiecare locatie din `/tmp/rnpm-remaining.txt`:
1. Identifica codul corect din tabel.
2. Inlocuieste `c.json({ error: msg }, status)` cu `c.json(fail(ErrorCodes.CODE, msg, c), status)`.
3. Pentru cazurile speciale, foloseste forma cu `details` (vezi sectiunea "Cazuri speciale").

Verifica EXCLUDERILE: NU atinge `new Response(...)` la linia ~235 (499 abort) si NU atinge SSE event payloads.

- [ ] **Step 4: Actualizeaza `rnpm.filter.test.ts` in acelasi commit**

Tipul `FilterRouteBody` are `code?: string` la radacina. Schimba la:

```ts
type FilterRouteBody = {
  data: null;
  error: { code: "FILTER_DISABLED" | "FILTER_TIMEOUT"; message: string };
  requestId: string;
};
```

Toate assertions `expect(body.code).toBe("FILTER_DISABLED")` → `expect(body.error.code).toBe("FILTER_DISABLED")`.

- [ ] **Step 5: Adauga sentinel envelope test pentru rnpm**

Creeaza `backend/src/routes/rnpm.envelope.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../testHelpers/buildApp.ts";

vi.mock("../services/captchaSolver.ts", () => ({
  getCaptchaBalance: vi.fn(),
  CaptchaInsufficientFundsError: class extends Error {
    constructor(message: string) { super(message); this.name = "CaptchaInsufficientFundsError"; }
  },
}));

describe("rnpm envelope contract", () => {
  it("toate raspunsurile 4xx/5xx au shape { data: null, error: { code, message }, requestId }", async () => {
    const app = buildApp();
    const cases = [
      { method: "POST", path: "/api/v1/rnpm/search", body: "{}", expectStatus: 400 },
      { method: "POST", path: "/api/v1/rnpm/captcha/balance", body: "{}", expectStatus: 400 },
    ];
    for (const tc of cases) {
      const res = await app.request(tc.path, {
        method: tc.method,
        headers: { "Content-Type": "application/json" },
        body: tc.body,
      });
      expect(res.status).toBe(tc.expectStatus);
      const body = await res.json();
      expect(body).toMatchObject({
        data: null,
        error: { code: expect.any(String), message: expect.any(String) },
        requestId: expect.any(String),
      });
    }
  });

  it("LIMIT_EXCEEDED include details.splittable in envelope", async () => {
    // Setup: stub `executeSearch` sa arunce RnpmError cu code limit_exceeded + splittable type.
    // Asserta: body.error.code === "LIMIT_EXCEEDED" && body.error.details.splittable.type definit.
    // Daca stub-ul e prea complex aici, lasa skip si adauga TODO — coverage-ul e in rnpm.contract.test.ts.
  });
});
```

- [ ] **Step 6: Run tests**

Run: `npm test --workspace=backend -- --run rnpm`
Expected: toate testele rnpm PASS (~80+ teste).

Daca pica teste pe cai pe care credeai ca le-ai migrat: verifica manual ca grep-ul nu a ratat o locatie.

- [ ] **Step 7: Verifica DoD intermediar**

Run: `grep -nE 'c\.json\(\s*\{\s*error:' backend/src/routes/rnpm.ts`
Expected: ZERO matches in rnpm.ts (singura exceptie permisa: `new Response(...)` la 499, care nu apare in acest grep).

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/rnpm.ts backend/src/routes/rnpm.contract.test.ts \
        backend/src/routes/rnpm.filter.test.ts backend/src/routes/rnpm.envelope.test.ts
git commit -m "refactor(rnpm): toate caile 4xx/5xx legacy migrate la envelope (filter test inclus)"
```

---

### Task 5: Migrare `ai.ts` - toate cele ~18 cai 4xx/5xx

**Files:**
- Modify: `backend/src/routes/ai.ts`
- Create: `backend/src/routes/ai.contract.test.ts`

- [ ] **Step 1: Inventariere**

Run: `grep -nE 'c\.json\(\s*\{\s*error:' backend/src/routes/ai.ts`

Expected: ~18 ocurente cu status 400 si 500.

- [ ] **Step 2: Mapare coduri**

| Mesaj / context | Cod | Status |
|----|----|----|
| `"Model necunoscut."` | `UNKNOWN_MODEL` | 400 |
| `"NO_API_KEY"` / `"Cheie API lipsa"` | `MISSING_API_KEY` | 400 |
| `"Body invalid."` / JSON parse fail | `INVALID_JSON` | 400 |
| `"Lipsesc datele dosarului."` | `INVALID_PARAMS` | 400 |
| `"Trebuie exact 2 modele analist."` | `INVALID_PARAMS` | 400 |
| `"Format apiKeys invalid."` | `INVALID_PARAMS` | 400 |
| Zod validation errors | `VALIDATION_ERROR` | 400 |
| `"Eroare la analiza AI..."` (catch SDK) | `AI_ANALYSIS_FAILED` | 500 |
| Generic 500 fallback | `INTERNAL_ERROR` | 500 |

- [ ] **Step 3: Aplica migrarea**

Adauga import: `import { fail, ErrorCodes } from "../util/envelope.ts";`

Inlocuieste fiecare `c.json({ error: msg }, status)` cu `c.json(fail(code, msg, c), status)`.

- [ ] **Step 4: Creeaza `ai.contract.test.ts` cu 4 scenarii COMPLETE (NU stub gol)**

```ts
// backend/src/routes/ai.contract.test.ts
// Sentinel pentru envelope shape pe rutele AI (PR-6, v2.26.0).
import { describe, expect, it } from "vitest";
import { buildApp } from "../testHelpers/buildApp.ts";

describe("AI routes - envelope shape", () => {
  it("POST /api/ai/analyze fara body returneaza INVALID_JSON 400 envelope", async () => {
    const res = await buildApp().request("/api/ai/analyze", { method: "POST" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      data: null,
      error: { code: "INVALID_JSON", message: expect.any(String) },
      requestId: expect.any(String),
    });
  });

  it("POST /api/ai/analyze cu model necunoscut returneaza UNKNOWN_MODEL 400", async () => {
    const res = await buildApp().request("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "model-care-nu-exista",
        dosar: { nrDosar: "123/2024", instanta: "JUDECATORIA BUCURESTI" },
        apiKeys: { anthropic: "sk-test" },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNKNOWN_MODEL");
  });

  it("POST /api/ai/analyze cu model valid dar fara apiKeys returneaza MISSING_API_KEY", async () => {
    const res = await buildApp().request("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-7", // confirma cu numele real din ai.ts modelMap
        dosar: { nrDosar: "123/2024", instanta: "JUDECATORIA BUCURESTI" },
        apiKeys: {},
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_API_KEY");
  });

  it("POST /api/ai/judge cu < 2 modele analist returneaza INVALID_PARAMS", async () => {
    const res = await buildApp().request("/api/ai/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        analystModels: ["claude-opus-4-7"], // doar 1, trebuie 2
        judgeModel: "claude-opus-4-7",
        dosar: { nrDosar: "123/2024" },
        apiKeys: { anthropic: "sk-test" },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_PARAMS");
  });
});
```

**Codex:** verifica numele REAL al endpoint-urilor `ai.ts` (`/api/ai/analyze`, `/api/ai/judge` sau `/api/ai/...` — citeste `ai.ts` ca sa confirmi) si numele modelelor din `modelMap`. Daca difera, ajusteaza testele.

- [ ] **Step 5: Run tests**

Run: `npm test --workspace=backend -- --run ai`
Expected: toate cele 4 teste PASS.

- [ ] **Step 6: Verifica DoD intermediar**

Run: `grep -nE 'c\.json\(\s*\{\s*error:' backend/src/routes/ai.ts`
Expected: ZERO matches.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/ai.ts backend/src/routes/ai.contract.test.ts
git commit -m "refactor(ai): toate caile 4xx/5xx legacy migrate la envelope"
```

---

### Task 6: Migrare `termene.ts` - toate cele ~13 cai (NU doar bodyTooLarge)

**Files:**
- Modify: `backend/src/routes/termene.ts`
- Create: `backend/src/routes/termene.contract.test.ts`

Scope real: 4 rute distincte cu erori (bodyTooLarge middleware + parseTermen helper + POST /dosare-termene-excel + POST /search).

- [ ] **Step 1: Inventariere**

Run: `grep -nE 'c\.json\(\s*\{\s*error:' backend/src/routes/termene.ts`

Expected: ~13 ocurente. Listeaza-le toate.

- [ ] **Step 2: Mapare coduri (similar ai.ts/rnpm.ts)**

Aplica acelasi tabel ca la Task 4 + Task 5. Cazuri specifice termene:
- bodyTooLarge → `PAYLOAD_TOO_LARGE` 413
- SOAP upstream error (catch) → `INTERNAL_ERROR` 500 (sau `UPSTREAM_UNAVAILABLE` daca distinctibil)
- Format dosar invalid → `INVALID_PARAMS` 400
- Lista goala / format invalid input → `INVALID_PARAMS` 400

Adauga import `fail, ErrorCodes`.

- [ ] **Step 3: Aplica migrarea**

Inlocuieste fiecare ocurenta. Verifica cu grep dupa.

- [ ] **Step 4: Creeaza `termene.contract.test.ts` cu minimum 4 scenarii**

```ts
// backend/src/routes/termene.contract.test.ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../testHelpers/buildApp.ts";

describe("termene routes - envelope shape", () => {
  it("POST /api/termene/search peste body limit returneaza PAYLOAD_TOO_LARGE 413 envelope", async () => {
    const bigBody = JSON.stringify({ payload: "x".repeat(700_000) }); // > limit
    const res = await buildApp().request("/api/termene/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bigBody,
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(body.requestId).toEqual(expect.any(String));
  });

  it("POST /api/termene/search fara body returneaza INVALID_JSON sau INVALID_PARAMS 400 envelope", async () => {
    const res = await buildApp().request("/api/termene/search", { method: "POST" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      data: null,
      error: { code: expect.any(String), message: expect.any(String) },
      requestId: expect.any(String),
    });
  });

  it("POST /api/termene/search cu format invalid returneaza INVALID_PARAMS 400 envelope", async () => {
    const res = await buildApp().request("/api/termene/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ /* lipsesc campuri required */ }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_PARAMS");
  });

  it("POST /api/termene/dosare-termene-excel cu lista goala returneaza INVALID_PARAMS 400", async () => {
    const res = await buildApp().request("/api/termene/dosare-termene-excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dosare: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_PARAMS");
  });
});
```

**Codex:** verifica path-urile reale din `termene.ts` (`/api/termene/...` exact) si ajusteaza testele.

- [ ] **Step 5: Run tests**

Run: `npm test --workspace=backend -- --run termene`
Expected: toate 4 teste PASS.

- [ ] **Step 6: Verifica DoD intermediar**

Run: `grep -nE 'c\.json\(\s*\{\s*error:' backend/src/routes/termene.ts`
Expected: ZERO matches.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/termene.ts backend/src/routes/termene.contract.test.ts
git commit -m "refactor(termene): toate cele 13 cai 4xx/5xx legacy migrate la envelope"
```

---

### Task 7: Frontend - migrare consumer-i string-only la dual-shape parser

**Files:**
- Modify: `frontend/src/lib/api.ts` (3 locatii confirmate: ~64, ~129, ~333)
- Modify: `frontend/src/lib/api.test.ts` daca exista; altfel creeaza-l

**Scope:** acest task NU e verify-only. Multi-agent review confirma ca `api.ts` are 3 consumer-i string-only care vor cadea pe fallback generic "Eroare server (4xx)" daca raman netraductibili dupa migrarea backend.

- [ ] **Step 1: Identifica exact cele 3 locatii**

Run: `grep -nE 'data\.error|res\.error|response\.error' frontend/src/lib/api.ts`

Asteapta minimum 3 hits in jurul liniilor 64, 129, 333.

- [ ] **Step 2: Adauga helper dual-shape la inceputul fisierului**

```ts
// frontend/src/lib/api.ts (top)
type EnvelopeError = { code?: string; message?: string };

function extractErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      const msg = (err as EnvelopeError).message;
      if (typeof msg === "string") return msg;
    }
  }
  return fallback;
}
```

- [ ] **Step 3: Inlocuieste cele 3 consumer-i**

In fiecare locatie unde se citeste `data.error` direct ca string, inlocuieste cu apel la `extractErrorMessage(data, fallbackMsg)`.

Exemple:
- `api.ts:64` (`unwrapBlob`):
  ```ts
  // inainte: throw new Error(typeof data.error === "string" ? data.error : `Eroare server (${res.status})`);
  throw new Error(extractErrorMessage(data, `Eroare server (${res.status})`));
  ```
- `api.ts:129` (SSE/load-more): acelasi pattern.
- `api.ts:333` (SSE event handler AI judge): acelasi pattern, dar pe `data` din SSE event payload — verifica forma reala emisa de backend (poate fi `{ error: "..." }` sau `{ data: null, error: { ... } }`).

- [ ] **Step 4: Test pentru helper**

Creeaza/extinde `frontend/src/lib/api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
// Daca extractErrorMessage e exportat, importa-l. Altfel testeaza prin parent function cu fetch mock.

describe("extractErrorMessage", () => {
  it("citeste string error legacy", () => {
    expect(extractErrorMessage({ error: "Eroare X" }, "fallback")).toBe("Eroare X");
  });
  it("citeste envelope error.message", () => {
    expect(extractErrorMessage({ data: null, error: { code: "PAYLOAD_TOO_LARGE", message: "Payload prea mare" }, requestId: "x" }, "fallback")).toBe("Payload prea mare");
  });
  it("returneaza fallback cand error lipseste", () => {
    expect(extractErrorMessage({ data: {} }, "fallback")).toBe("fallback");
  });
  it("returneaza fallback cand error e null", () => {
    expect(extractErrorMessage({ error: null }, "fallback")).toBe("fallback");
  });
});
```

Daca `extractErrorMessage` nu e exportat, exporta-l doar pentru testare (cu `// internal export` comment).

- [ ] **Step 5: Run tests + typecheck**

```bash
cd frontend
npm test -- --run
npx tsc --noEmit
```

Expected: toate teste PASS + zero erori tsc.

- [ ] **Step 6: Verifica si `rnpmApi.ts` ramane intact**

Run: `grep -n 'extractErrorMessage\|typeof.*error' frontend/src/lib/rnpmApi.ts`

`rnpmApi.ts:405-414` are deja dual-shape inline. Optional: refactor sa foloseasca `extractErrorMessage` pentru consistenta. Daca ai timp, OK; altfel lasa-l intact.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat(frontend): dual-shape error parser pentru consumer-ii api.ts (PR-6 backend prep)"
```

---

### Task 8: Release bump v2.26.0

**Files:** (toate la radacina + frontend changelog)

- [ ] **Step 1: Bump versiuni**

Editeaza:
- `package.json` root: `"version": "2.26.0"`
- `backend/package.json`: `"version": "2.26.0"`
- `frontend/package.json`: `"version": "2.26.0"`

Run: `npm install --package-lock-only`.

- [ ] **Step 2: Update `CHANGELOG.md`**

Adauga sectiune noua sus, deasupra v2.25.0:

```markdown
## [v2.26.0] - 2026-05-14

### Backend - Envelope migration (PR-6, Batch 1 FIXES-TODO closure)
- `rnpm.ts` (~69 cai), `ai.ts` (~18 cai), `termene.ts` (~13 cai) migrate la envelope `{ data, error: { code, message }, requestId }`. Cai legacy `{ error: "string" }` eliminate complet.
- `INSUFFICIENT_FUNDS` 402 Payment Required (cu `Retry-After: 0`) pe captcha balance — semantic corect pentru sold insuficient, NU 503 (evitam retry inutil de la SDK-uri / proxy-uri).
- Detectia insufficient funds tipizata via `CaptchaInsufficientFundsError` in `services/captchaSolver.ts` — fara false-positive pe mesaje cu "balance" generic.
- `LIMIT_EXCEEDED` 400 cu `details.splittable` pentru cautari RNPM peste limita (frontend pastreaza butonul split-search).
- `WEB_MODE_NOT_IMPLEMENTED` 501, `DESKTOP_ONLY` 501, `PAYLOAD_TOO_LARGE` 413, `DUPLICATE_REQUEST` 409, `FILTER_DISABLED`/`FILTER_TIMEOUT` 503 — toate cu envelope shape.
- Tests: ~30 assertions actualizate in `rnpm.contract.test.ts`; nou `ai.contract.test.ts`, `termene.contract.test.ts`, `rnpm.envelope.test.ts`, `envelope.test.ts`. `rnpm.filter.test.ts` migrat la `body.error.code`.

### Frontend
- `frontend/src/lib/api.ts` — 3 consumer-i string-only (unwrapBlob, SSE load-more, SSE AI judge event) migrati la dual-shape parser via helper `extractErrorMessage`. Fara modificare in `rnpmApi.ts` (avea deja dual-shape inline).

### Excluse din migrare (intentionat)
- Path 499 abort RNPM (`new Response(...)` cu `searchId` pentru partial state).
- SSE event payloads (`event:"error"`, `event:"aborted"`, `event:"timeout"`, `event:"progress"`).
- Audit events (`rnpm.cap_hit` etc.) — persistate in DB, nu HTTP responses.
- Pagination — NU se introduce `INVALID_PAGE` 400 nou; coercitia silentioasa ramane (evitam breaking change comportamental).

### Compatibilitate
- Frontend `rnpmApi.ts` + `api.ts` au acum dual-shape parser — migrarea NU sparge UI desktop.
- Consumatori externi: shape-ul de eroare e acum object `{ code, message }` in loc de string. Update parser-ul daca consumi `/api/v1/rnpm/*`, `/api/ai/*` sau `/api/termene/*` din alt client.
```

- [ ] **Step 3: Update `frontend/src/data/changelog-entries.tsx`**

Adauga entry v2.26.0 sus (sintetic, 1-2 paragrafe in RO).

- [ ] **Step 4: Update root .md docs**

- `README.md` → "Versiune curenta"
- `STATUS.md` → "Versiune curenta reala" + "Data curenta"
- `DOCUMENTATIE.md` → "Versiune curenta"
- `SESSION-HANDOFF.md` → adauga sectiune "Sprint inchis 2026-05-14 — PR-6 envelope migration"
- `CLAUDE.md` → bump scurt in "Versiune Curenta"
- `FIXES-TODO.md` → bifeaza Batch 1 items + marcheaza DONE in v2.26.0

- [ ] **Step 5: Sanity check pe grep**

Run: `grep -li "v2.25.0" *.md`
Pentru fiecare hit, verifica daca e referinta istorica (CHANGELOG, SESSION-HANDOFF entry vechi). Daca apare ca "versiune curenta" in alta parte, update.

- [ ] **Step 6: Biome + tsc + build final**

```bash
npx biome check --write backend/src/routes backend/src/util backend/src/services frontend/src/lib *.md
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
npm run build
npm test --workspace=backend -- --run
cd frontend && npm test -- --run && cd ..
```

Toate verzi obligatoriu.

- [ ] **Step 7: Commit release bump**

```bash
git add package.json package-lock.json backend/package.json frontend/package.json \
        CHANGELOG.md README.md STATUS.md DOCUMENTATIE.md SESSION-HANDOFF.md \
        CLAUDE.md FIXES-TODO.md frontend/src/data/changelog-entries.tsx
git commit -m "$(cat <<'EOF'
release: v2.26.0 - PR-6 envelope migration pentru rute legacy

Closure Batch 1 FIXES-TODO: rnpm/ai/termene migrate la envelope standard
{ data, error: { code, message }, requestId }. INSUFFICIENT_FUNDS 402 (cu
Retry-After: 0) via CaptchaInsufficientFundsError typed. LIMIT_EXCEEDED
cu details.splittable. WEB_MODE_NOT_IMPLEMENTED 501, DESKTOP_ONLY 501,
PAYLOAD_TOO_LARGE 413, DUPLICATE_REQUEST 409, FILTER_DISABLED/TIMEOUT 503
toate envelope. Frontend api.ts: 3 consumer-i migrati la dual-shape via
extractErrorMessage helper.

Excluse intentionat: 499 abort path, SSE event payloads, audit events,
pagination coercion.
EOF
)"
```

---

### Task 9: Smoke desktop extins + push + tag

- [ ] **Step 1: Verifica ABI better-sqlite3 (preventiv)**

```bash
cd node_modules/better-sqlite3
npx --yes prebuild-install --runtime=electron --target=41.5.0 --arch=x64 --platform=win32 --verbose
cd "C:/Users/Cezar/Desktop/Claude Code/Legal Dashboard"
```

(Vezi memory `feedback_better_sqlite3_electron_abi.md`.)

- [ ] **Step 2: Lansare Electron**

```bash
unset ELECTRON_RUN_AS_NODE
npm run electron:dev
```

(Vezi memory `project_electron_run_as_node_leak.md`.)

- [ ] **Step 3: Smoke checklist extins (10 cai, NU 5)**

**RNPM:**
1. RNPM search cu captcha key invalid → mesaj UI "Cheie captcha lipsa sau invalida" (din `body.error.message`).
2. RNPM search happy path (CUI valid, captcha valid) → rezultate afisate, fara erori in DevTools.
3. RNPM search cu rezultate peste limit (LIMIT_EXCEEDED) → butonul "Split search" apare in UI (verifica `details.splittable` ajunge la frontend).
4. RNPM bulk upload xlsx prea mare (>512KB) → mesaj 413 "Payload prea mare".
5. RNPM captcha balance happy path → afisare numeric correct.
6. RNPM captcha balance cu key invalida → mesaj 400 acceptabil din envelope.
7. RNPM captcha balance cu cont epuizat (simulate prin key real dar gol) → 402 INSUFFICIENT_FUNDS, mesaj UI clar, NU retry automat.

**AI:**
8. AI analyze fara cheie configurata → mesaj envelope MISSING_API_KEY in UI (NU "Eroare server (400)").
9. AI multi-model judge happy path → rezultate afisate.

**Termene:**
10. Termene search happy path (cu un dosar valid) → rezultate SOAP afisate.

Pentru fiecare cale: verifica in DevTools Network ca response body are forma `{ data, error: { code, message }, requestId }` (sau OK shape pe happy paths).

- [ ] **Step 4: Push branch + tag**

```bash
git push origin feat/pr6-envelope-migration
git checkout main
git merge --no-ff feat/pr6-envelope-migration -m "Merge feat/pr6-envelope-migration - v2.26.0"
git push origin main
git tag -a v2.26.0 -m "v2.26.0 - PR-6 envelope migration pentru rutele legacy"
git push origin v2.26.0
```

Tag-ul declanseaza GitHub Actions: NSIS Windows + DMG macOS + Docker server build.

- [ ] **Step 5: Monitor builds**

Run: `gh run list --workflow=build-windows.yml --limit 3` (si pentru `build-mac.yml`, `build-server.yml` daca exista).
Asteapta status `completed` cu `conclusion: success` pe toate trei.

---

## Definition of Done

- [ ] Toate sub-items din Batch 1 FIXES-TODO bifate
- [ ] ZERO ocurente `c.json({ error: "string" }, ...)` in `rnpm.ts`, `ai.ts`, `termene.ts` (verificat cu `grep -nE 'c\.json\(\s*\{\s*error:'`)
- [ ] Cai excluse explicit ramase intact: `new Response(...)` 499 abort, SSE event payloads, audit events, pagination coercion
- [ ] `rnpm.contract.test.ts`, `rnpm.filter.test.ts`, `rnpm.envelope.test.ts`, `ai.contract.test.ts`, `termene.contract.test.ts`, `envelope.test.ts` toate verzi
- [ ] `frontend/src/lib/api.ts` cei 3 consumer-i string-only migrati la dual-shape via `extractErrorMessage`
- [ ] Smoke desktop pe Electron pasat (cele 10 cai din Task 9 Step 3)
- [ ] `npm run build` curat + biome curat
- [ ] Tag `v2.26.0` pe GitHub + workflows builds verzi

---

## Notes pentru Codex

1. **NU adopta `@hono/zod-openapi`** — refactor major separat, out of scope.
2. **Status codes:** NU schimba decat unde e specificat explicit (captcha balance INSUFFICIENT_FUNDS → 402). Tot restul (400/413/501/503/500) raman cu acelasi numar HTTP — doar shape-ul body se schimba.
3. **OK paths NU se schimba.** `c.json({ balance })`, `c.json({ ok: true })`, etc. raman intacte.
4. **Cazurile speciale** (`limit_exceeded` cu `details`, `FILTER_*`, 409 dedup, 501 desktop-only, 499 abort exclus, SSE excluse) sunt enumerate sus — citeste sectiunea inainte de Task 4.
5. **`rnpm.filter.test.ts` se modifica in acelasi commit cu Task 4** — altfel CI pica.
6. **`extractErrorMessage` se adauga in `api.ts`, NU duplicat in fiecare consumer.**
7. **Daca un test legacy pica si NU e pe error shape**, opreste-te si raporteaza.
8. **Commits mici per task.** Task 2/3/4/5/6/7/8 sunt commit-uri separate. NU bundlui.
9. **Pastreaza mesajele user-facing in romana fara diacritice.** Codurile in UPPER_SNAKE_CASE engleza (semantic stabil).
10. **Daca `fail()` actual NU accepta `details` ca al 4-lea arg, extinde semnatura in Task 1 + adauga test sentinel.**
