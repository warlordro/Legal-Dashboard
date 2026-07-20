# Remediere audit securitate + corectitudine v2.43.0 — Plan REV2 (post dublu-review adversarial)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Inchide findings-urile aprobate din auditul sec + corectitudine v2.43.0 (7 PR-uri), TDD, izolat, cu testele care chiar pica inainte de fix si trec dupa.

**Context revizie:** Rev1 a fost supus la doua review-uri adversariale independente pe cod (workflow intern 7 agenti + Codex). Ambele au dat NO-GO pe Rev1 as-is. Rev2 integreaza toate corectiile confirmate + cele doua decizii de owner (2026-07-19): **PR-5 varianta stricta**, **BUG-04 per-owner strict**.

**Tech Stack:** TypeScript strict, Hono, better-sqlite3, vitest, pdfkit, Electron 41, biome.

## Global Constraints

- **Branch:** tot pe branch nou din `feat/v2.43.0-rnpm-split`; NIMIC pe `main`. Commit local per task; **push pe GitLab abia dupa ce toate cele 7 PR-uri sunt verzi**.
- **Pre-push (CLAUDE.md):** `npx biome check --write` pe fisiere atinse → `tsc --noEmit` backend+frontend → `npm run build` → teste. `npm run check` = one-shot.
- **Envelope eroare:** `fail(code, message, c)` → `{ data, error: { code, message }, requestId }`.
- **Kill switch env:** comparatie stricta cu `"1"`, citire directa `process.env`, **plus warn structurat la boot** (precedent `RNPM_RUNTIME_VALIDATION_DISABLED`, index.ts:681-698).
- **Teste:** vitest, `app.request()` pe Hono in-memory; `getConnInfo` mock pentru peer IP; `fetchImpl` injectat pentru rnpmClient; `vi.stubGlobal("fetch")` pentru soap/iccj; DB real pe tmpdir unde e persistenta.
- **Runtime caveat:** un review adversarial a rulat vitest intr-un sandbox care a blocat tmp mkdir (EPERM). La executie, ruleaza suitele intr-un mediu real (Electron rebuild pe ABI Node inainte) si confirma pass real, nu presupune.
- **NU se implementeaza:** PR-4 (portita gcode), PR-7 (plafon joburi) — risc acceptat; PR-3 (Content-Type 415) — amanat; Electron 43 — milestone separat.

---

## Task 0: Branch de remediere

- [ ] **Step 1: Creeaza branch-ul**

```bash
cd "c:/Users/Cezar/Desktop/Claude Code/Legal Dashboard IF"
git checkout feat/v2.43.0-rnpm-split
git checkout -b fix/audit-sec-v2.43-remediere
```

- [ ] **Step 2: Confirma**

Run: `git rev-parse --abbrev-ref HEAD`
Expected: `fix/audit-sec-v2.43-remediere`.

---

# PR-1 — SEC-01: guard CSRF desktop global

**Corectii Rev2:** (a) kill switch cu **warn la boot** (constraint global); (b) comanda de test include `index.test.ts` (3 teste 413/400/413 se vor rupe daca clientul de test nu trimite headerul — trebuie reparate acolo, e comportamentul corect); (c) reparate cele 2 scripturi de load-test (`loadtest-monitoring.js`, `loadtest-name-lists.js`) sa trimita headerul, altfel rularea locala desktop primeste 403; (d) exemptia PAT documentata explicit ca defense-in-depth (cod inactiv in desktop, unde tokenId nu se seteaza).

### Task 1.1: Middleware `requireDesktopHeaderGlobal`

**Files:**
- Create: `backend/src/middleware/requireDesktopHeaderGlobal.ts`
- Test: `backend/src/middleware/requireDesktopHeaderGlobal.test.ts`

**Interfaces:**
- Consumes: `getAuthMode()` din `../auth/config.ts`; `fail` din `../util/envelope.ts`.
- Produces: `export async function requireDesktopHeaderGlobal(c, next)`.

- [ ] **Step 1: Write the failing test** (identic cu Rev1 — 6 cazuri: mutating POST fara header→403, `/jobs/:id/run` fara header→403, cu header→200, SSE GET→200, PAT tokenId→200, web mode→200). Vezi Rev1 Task 1.1 Step 1 pentru corpul complet.

- [ ] **Step 2: Run** `npm test --workspace=backend -- requireDesktopHeaderGlobal --run` → FAIL (modul inexistent).

- [ ] **Step 3: Implementation**

```ts
import type { Context, Next } from "hono";
import { getAuthMode } from "../auth/config.ts";
import { fail } from "../util/envelope.ts";

// SEC-01: originGuard has a loopback bypass, so a hostile page can fire a
// simple-request POST at 127.0.0.1 with no preflight. The custom header
// X-Legal-Dashboard-Desktop cannot be set on a simple cross-origin request, so
// requiring it on every mutating verb forces a CORS preflight the attacker
// cannot satisfy. apiFetch sends it on every call; SSE (GET) stays exempt.
// The tokenId exemption is DEFENSE-IN-DEPTH / future-proofing: in desktop mode
// tokenId is never set (PAT middleware is web-only, index.ts:300-310), so this
// branch is inactive today — it only matters if PAT ever runs in desktop.
const DESKTOP_HEADER = "x-legal-dashboard-desktop";
const DESKTOP_HEADER_VALUE = "1";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function requireDesktopHeaderGlobal(c: Context, next: Next): Promise<Response | undefined> {
  if (getAuthMode() !== "desktop") return void (await next());
  if (process.env.LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING === "1") return void (await next());
  if (!MUTATING.has(c.req.method.toUpperCase())) return void (await next());
  if (c.get("tokenId")) return void (await next());
  if (c.req.header(DESKTOP_HEADER) !== DESKTOP_HEADER_VALUE) {
    return c.json(
      fail("desktop_header_required", "Cerere refuzata: header X-Legal-Dashboard-Desktop lipsa sau invalida.", c),
      403
    );
  }
  await next();
  return;
}
```

- [ ] **Step 4: Run** → PASS (6 teste).

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/requireDesktopHeaderGlobal.ts backend/src/middleware/requireDesktopHeaderGlobal.test.ts
git commit -m "feat(security): guard CSRF desktop global pe mutatii /api/* (SEC-01) cu exemptie PAT + SSE si kill switch"
```

### Task 1.2: Montare + warn la boot pentru kill switch

**Files:**
- Modify: `backend/src/index.ts` (montare dupa originGuard ~L317; warn la boot in blocul de kill switches ~L681-698)

- [ ] **Step 1: Import + montare** dupa `app.use("/api/*", originGuard);`:

```ts
  // SEC-01: desktop CSRF hardening — require the desktop header on every mutating
  // /api/* verb unless PAT. Mounted after ownerContext (tokenId set) + originGuard.
  app.use("/api/*", requireDesktopHeaderGlobal);
```

- [ ] **Step 2: Warn la boot** — langa warn-ul `RNPM_RUNTIME_VALIDATION_DISABLED` (index.ts:681), adauga:

```ts
  if (getAuthMode() === "desktop" && process.env.LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING === "1") {
    console.warn(
      JSON.stringify({
        action: "csrf.hardening.disabled.boot",
        note: "LEGAL_DASHBOARD_DISABLE_CSRF_HARDENING=1: guard-ul CSRF desktop e OPRIT pentru toate mutatiile.",
        ts: new Date().toISOString(),
      })
    );
  }
```

- [ ] **Step 3: Type-check + build** → `npx tsc --noEmit -p backend/tsconfig.json && npm run build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(security): monteaza requireDesktopHeaderGlobal + warn la boot cand kill switch-ul e activ (SEC-01)"
```

### Task 1.3: Repara testele + load-testurile care omit headerul

**Files:**
- Modify: `backend/src/index.test.ts` (L535 asteapta 413, L556 asteapta 400, L579 asteapta 413 — requesturile desktop mutante trebuie sa trimita `X-Legal-Dashboard-Desktop: 1`, altfel primesc 403 inaintea body-limitului)
- Modify: `scripts/loadtest-monitoring.js` (`jsonHeaders()` ~L58 → adauga desktop header; afecteaza POST `/jobs` L75, `/jobs/:id/run` L113)
- Modify: `scripts/loadtest-name-lists.js` (helper headers ~L42 → adauga desktop header; POST `/preview` L62, `/commit` L83)

**Rationament:** aceste requesturi sunt clienti desktop LEGITIMI; comportamentul corect e sa trimita headerul (ca `apiFetch`). Fara aceasta reparatie, `npm run check` pica (index.test.ts) si load-testul local da 403.

- [ ] **Step 1: index.test.ts** — la fiecare din cele 3 requesturi (L535/556/579), adauga headerul in `headers`:

```ts
headers: { "content-type": "application/json", "X-Legal-Dashboard-Desktop": "1", ... },
```

(Pastreaza restul headerelor existente; doar adauga desktop header.)

- [ ] **Step 2: loadtest-monitoring.js** — in `jsonHeaders()`:

```js
function jsonHeaders() {
  const h = { "Content-Type": "application/json", "X-Legal-Dashboard-Desktop": "1" };
  if (AUTH) h.Authorization = AUTH;
  return h;
}
```

- [ ] **Step 3: loadtest-name-lists.js** — analog, adauga `"X-Legal-Dashboard-Desktop": "1"` in helper-ul de headers.

- [ ] **Step 4: Ruleaza suita completa care prinde regresia**

Run: `npm test --workspace=backend -- index monitoring alerts rnpm.contract rnpmBackups.contract requireDesktopHeader --run`
Expected: PASS. (Comanda include acum `index` — locul real unde apar 413/400/413.)

- [ ] **Step 5: Smoke desktop**

Run: `npm run electron:dev` — creeaza job, ruleaza-l manual, deschide pagina de alerte (SSE).
Expected: fara 403 pe actiuni UI; stream activ.

- [ ] **Step 6: Commit**

```bash
git add backend/src/index.test.ts scripts/loadtest-monitoring.js scripts/loadtest-name-lists.js
git commit -m "test(security): clientii desktop legitimi (index.test + load-tests) trimit headerul dupa guard-ul global (SEC-01)"
```

---

# PR-2 — SEC-02a: patch Electron (linia 41)

**Corectii Rev2:** (a) modificarea e in **lockfile**, nu inventa diff in `package.json` (specifier-ul `^41.5.0` ramane); (b) tinta exacta (41.10.x) se confirma din registry la executie — accepta orice 41.x rezolvat; (c) **ruleaza `rebuild:electron` DUPA gate-ul de teste**, altfel `better-sqlite3` ramane pe ABI Electron si `npm run check`/`test:backend` pica cu `NODE_MODULE_VERSION` mismatch.

### Task 2.1: Update lockfile + rebuild in ordinea corecta

**Files:**
- Modify: `package-lock.json` (electron 41.5.0 → ultimul 41.x)

- [ ] **Step 1: Update in linia 41**

Run: `npm update electron`
Expected: `package-lock.json` avanseaza in 41.x (nu 42/43). `package.json` NU trebuie sa se schimbe (caret `^41.5.0` acopera range-ul).

- [ ] **Step 2: Confirma versiunea**

Run: `npm ls electron`
Expected: un `electron@41.x` (ultimul patch publicat; nu te bloca pe cifra exacta).

- [ ] **Step 3: Gate de teste pe ABI Node INAINTE de rebuild Electron**

Run: `npm rebuild better-sqlite3 && npm run check`
Expected: PASS (modulul nativ pe ABI Node pentru vitest).

- [ ] **Step 4: Rebuild pentru ABI Electron + smoke**

Run: `npm run rebuild:electron && npm run electron:dev`
Expected: app booteaza; fara eroare de ABI la `better-sqlite3`.

- [ ] **Step 5: Commit**

```bash
git add package-lock.json
git commit -m "chore(electron): update la ultimul patch 41.x (Chromium security) via lockfile (SEC-02a)"
```

**Nota executie:** daca alte PR-uri ruleaza teste dupa PR-2, asigura-te ca `better-sqlite3` e pe ABI Node (`npm rebuild better-sqlite3`) inainte de fiecare `npm run check`, si fa `rebuild:electron` doar pentru smoke-urile Electron.

---

# PR-5 — NEW-02: trusted proxy fail-closed (varianta stricta) + `::1/128`

**Decizie owner (varianta stricta) + corectii Rev2:**
Gate-ul e **decuplat de `REMOTE_BIND_ACTIVE`**. Semnalul periculos real = **web mode + app legat pe loopback + fara TRUSTED_PROXY_CIDR** — aceasta e topologia „reverse proxy pe acelasi host" in care `readClientIp` intoarce peer-ul loopback al proxy-ului, iar originGuard (loopback bypass) devine bypass total. Un web legat DIRECT pe interfata non-loopback (fara proxy) pastreaza peer-ul real → NU e blocat (ramane warn). Astfel se inchide cazul periculos FARA a rupe deploy-ul LAN direct legitim (finding Codex B1).
Plus: (a) apelul fail-closed e plasat **in afara try-ului de boot** (596-705), langa `REMOTE_BIND_ACTIVE` (~L527), ca sa nu fie reambalat gresit ca „schema/prewarm failed"; (b) canonicalizare IPv6 (`::1` == `0:0:0:0:0:0:0:1`); (c) mesajul de warn „IPv4-only" actualizat dupa acceptarea `/128`; (d) pastreaza suportul CIDR IPv4-mapat.

### Task 5.1: Parser CIDR accepta `::1/128` cu canonicalizare

**Files:**
- Modify: `backend/src/util/proxyIp.ts`
- Test: `backend/src/util/proxyIp.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("treats ::1/128 as trusted IPv6 loopback (canonical forms)", () => {
  process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "::1/128";
  expect(readClientIp(fakeContext("::1", "203.0.113.9"))).toBe("203.0.113.9");
});
it("matches expanded ::1 written as 0:0:0:0:0:0:0:1", () => {
  process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "0:0:0:0:0:0:0:1/128";
  expect(readClientIp(fakeContext("::1", "203.0.113.9"))).toBe("203.0.113.9");
});
it("still matches an IPv4-mapped CIDR base", () => {
  process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "::ffff:10.0.0.0/8";
  expect(readClientIp(fakeContext("10.0.0.1", "203.0.113.9"))).toBe("203.0.113.9");
});
it("does not flag ::1/128 as unsupported", () => {
  process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "10.0.0.0/8, ::1/128";
  expect(findUnsupportedTrustedCidrEntries()).toEqual([]);
});
```

- [ ] **Step 2: Run** `npm test --workspace=backend -- proxyIp --run` → FAIL.

- [ ] **Step 3: Implementation**

```ts
// Canonicalize an IPv6 literal so ::1 and 0:0:0:0:0:0:0:1 compare equal.
// URL host parsing compresses IPv6 to its canonical form; IPv4 passes through.
function canonicalIp(ip: string): string | null {
  const v = net.isIP(ip);
  if (v === 4) return ip;
  if (v === 6) {
    try {
      return new URL(`http://[${ip}]`).hostname;
    } catch {
      return null;
    }
  }
  return null;
}

function cidrContains(cidr: string, ip: string): boolean {
  const [base, rawPrefix] = cidr.split("/");
  const prefix = Number(rawPrefix);
  // Pure-IPv6 base (NOT ::ffff: IPv4-mapped): only exact /128 supported.
  if (base && net.isIP(base) === 6) {
    if (prefix !== 128) return false;
    const a = canonicalIp(base);
    const b = canonicalIp(ip);
    return a !== null && a === b;
  }
  const baseInt = ipv4ToInt(base ?? "");
  const ipInt = ipv4ToInt(ip);
  if (baseInt === null || ipInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (baseInt & mask) === (ipInt & mask);
}

export function findUnsupportedTrustedCidrEntries(): string[] {
  return trustedCidrs().filter((entry) => {
    const [base, rawPrefix] = entry.split("/");
    if (!base || rawPrefix === undefined) return true;
    const prefix = Number(rawPrefix);
    // Pure IPv6 base: supported only at /128. IPv4-mapped (::ffff:x) falls through
    // to the IPv4 check below (net.isIP on ::ffff:10.0.0.0 is 6, so strip first).
    if (net.isIP(base) === 6 && !base.startsWith("::ffff:")) {
      return !(Number.isInteger(prefix) && prefix === 128);
    }
    if (net.isIP(base.startsWith("::ffff:") ? base.slice(7) : base) !== 4) return true;
    return !Number.isInteger(prefix) || prefix < 0 || prefix > 32;
  });
}
```

- [ ] **Step 4: Run** → PASS (inclusiv testele XFF existente).

- [ ] **Step 5: Commit**

```bash
git add backend/src/util/proxyIp.ts backend/src/util/proxyIp.test.ts
git commit -m "fix(proxy): accepta ::1/128 (canonicalizat) ca trusted loopback IPv6, pastreaza IPv4-mapat (NEW-02)"
```

### Task 5.2: fatalBoot (varianta stricta) plasat in afara try-ului de boot

**Files:**
- Modify: `backend/src/index.ts` (nou apel ~dupa L527 unde `REMOTE_BIND_ACTIVE` e calculat; actualizeaza warn-ul „IPv4-only" ~L639-655)
- Test: `backend/src/util/trustedProxyBootCheck.test.ts`

**Interfaces:**
- Produces: `export function assertTrustedProxyForWeb(env, hostname): void` — arunca cand `getAuthMode(env)==="web"`, `hostname` e loopback (127.0.0.1/localhost/::1), si CIDR gol.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { assertTrustedProxyForWeb } from "./trustedProxyBootCheck.ts";

describe("assertTrustedProxyForWeb (strict)", () => {
  const web = { LEGAL_DASHBOARD_AUTH_MODE: "web" } as NodeJS.ProcessEnv;
  it("throws: web + loopback bind + empty CIDR (co-located proxy topology)", () => {
    expect(() => assertTrustedProxyForWeb({ ...web }, "127.0.0.1")).toThrow(/TRUSTED_PROXY_CIDR/);
  });
  it("passes: web + loopback + CIDR set", () => {
    expect(() => assertTrustedProxyForWeb({ ...web, LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR: "127.0.0.1/32" }, "127.0.0.1")).not.toThrow();
  });
  it("passes: web + direct non-loopback bind + empty CIDR (real peer, no proxy)", () => {
    expect(() => assertTrustedProxyForWeb({ ...web }, "0.0.0.0")).not.toThrow();
  });
  it("passes: desktop mode", () => {
    expect(() => assertTrustedProxyForWeb({ LEGAL_DASHBOARD_AUTH_MODE: "desktop" }, "127.0.0.1")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run** `npm test --workspace=backend -- trustedProxyBootCheck --run` → FAIL (modul inexistent).

- [ ] **Step 3: Implementation** — `backend/src/util/trustedProxyBootCheck.ts`:

```ts
import { getAuthMode } from "../auth/config.ts";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

// NEW-02 (strict): web mode on a loopback bind means a reverse proxy on the same
// host fronts the app — client requests then arrive with a loopback peer, and
// originGuard's loopback bypass becomes a total CSRF/rate-limit bypass unless
// TRUSTED_PROXY_CIDR is set. Fail closed. A direct non-loopback web bind keeps
// the real peer, so the CIDR stays optional there (handled by the boot warn).
export function assertTrustedProxyForWeb(env: NodeJS.ProcessEnv, hostname: string): void {
  if (getAuthMode(env) !== "web") return;
  if (!LOOPBACK_HOSTS.has(hostname)) return;
  if ((env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR ?? "").trim() !== "") return;
  throw new Error(
    "Web mode legat pe loopback (127.0.0.1) presupune un reverse proxy pe acelasi host. " +
      "Fara LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR, X-Forwarded-For e ignorat si originGuard " +
      "trateaza orice client venit prin proxy ca loopback (bypass CSRF). " +
      "Seteaza CIDR-ul retelei proxy-ului (ex. 127.0.0.1/32 pentru proxy co-locat). " +
      "Vezi DEPLOY-SERVER.md / RUNBOOK.md."
  );
}
```

- [ ] **Step 4: Run** → PASS (4 teste).

- [ ] **Step 5: Cableaza in index.ts, IN AFARA try-ului de boot** — imediat dupa blocul `REMOTE_BIND_ACTIVE` (dupa L527), inainte de L529:

```ts
import { assertTrustedProxyForWeb } from "./util/trustedProxyBootCheck.ts";
// ...
try {
  assertTrustedProxyForWeb(process.env, hostname);
} catch (err) {
  fatalBoot("trusted proxy required for web loopback bind", err instanceof Error ? err : new Error(String(err)));
}
```

- [ ] **Step 6: Actualizeaza warn-ul stale „IPv4-only"** (index.ts:639-655) — dupa acceptarea `/128`, comentariul si nota nu mai sunt „IPv4-only". Corecteaza textul: parserul accepta acum IPv4/IPv4-mapat + IPv6 loopback `/128`; entry-urile ramase nesuportate (IPv6 non-`/128`, prefix invalid) sunt inca ignorate.

- [ ] **Step 7: Type-check + smoke desktop + smoke web-loopback cu CIDR**

Run: `npx tsc --noEmit -p backend/tsconfig.json && npm run electron:dev`
Expected: desktop booteaza normal (auth_mode=desktop → no-op). (Optional: seteaza `LEGAL_DASHBOARD_AUTH_MODE=web` + loopback fara CIDR local si confirma ca fatalul porneste cu mesajul clar.)

- [ ] **Step 8: Commit**

```bash
git add backend/src/util/trustedProxyBootCheck.ts backend/src/util/trustedProxyBootCheck.test.ts backend/src/index.ts
git commit -m "feat(security): fail-closed strict web+loopback fara TRUSTED_PROXY_CIDR (NEW-02) + warn IPv4-only actualizat"
```

### Task 5.3: Previne regresia — actualizeaza clientii web+loopback existenti

**Rationament (REGRESIE identificata):** gate-ul strict din 5.2 face fatal `web + loopback + CIDR gol`. Scriptul de smoke web local `scripts/dev-web-local.ps1` ruleaza EXACT asa (auth_mode=web pe 127.0.0.1, fara CIDR) → fara aceasta reparatie, `dev-web-local` nu ar mai porni. Fixul e o singura linie: scriptul isi declara intentia (proxy co-locat = loopback).

**Files:**
- Modify: `scripts/dev-web-local.ps1` (langa L127, in blocul de env backend)
- Modify: `.env.example` (L19), `backend/.env.example` (L51) — nota ca pe web+loopback devine necesar

- [ ] **Step 1: dev-web-local.ps1** — adauga, langa celelalte `$env:` (dupa L127):

```powershell
# PR-5 (fail-closed strict): web mode pe loopback presupune proxy co-locat.
# Smoke-ul local nu are proxy real, deci declaram explicit loopback ca trusted.
$env:LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR = "127.0.0.1/32"
```

- [ ] **Step 2: .env.example** — actualizeaza comentariul L19 din `# OPTIONAL ... lasa gol pe desktop` in: `# OPTIONAL pe desktop / non-loopback web; OBLIGATORIU pe web+loopback (proxy co-locat), altfel boot fatal`. Analog `backend/.env.example:51`.

- [ ] **Step 3: Smoke web local (confirma ca porneste)**

Run: `pwsh scripts/dev-web-local.ps1` (sau echivalentul din memory `smoke-fara-token-handling` — browser prin proxy, fara token handling inline)
Expected: backend-ul devine healthy pe `/health`; NU fatalBoot.

- [ ] **Step 4: Commit**

```bash
git add scripts/dev-web-local.ps1 .env.example backend/.env.example
git commit -m "fix(dev): dev-web-local declara TRUSTED_PROXY_CIDR loopback dupa gate-ul strict (NEW-02, anti-regresie)"
```

---

# PR-6 — SEC-04 + SEC-07: redirect manual + cap raspuns

**Corectii Rev2:** (a) toate testele de redirect folosesc `status: 302` (NU 0 — `Response` arunca `RangeError` pe status 0); (b) test SOAP care exercita **efectiv** guard-ul 3xx (nu doar existenta optiunii); (c) test RNPM cap care asteapta **`code: "response_too_large"`** (nu `{name:"RnpmError"}` generic — schema validation arunca deja RnpmError inainte de fix); (d) matrice de acoperire pe search/detail/history + succes/eroare; (e) NU folosi `searchIccjEnriched` pentru testul warmSession (postSearch arunca pe `<html>`); testeaza cap-ul cu semnalul comun, fara re-crearea timeout-ului.

### Task 6.1: `redirect: "manual"` pe keyValidation

**Files:**
- Modify: `backend/src/services/keyValidation.ts` (6 fetch-uri + tratare 3xx)
- Test: `backend/src/services/keyValidation.test.ts` (NOU)

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateKey } from "./keyValidation.ts";
afterEach(() => vi.restoreAllMocks());

describe("validateKey redirect safety (SEC-04)", () => {
  it("sends redirect:manual and treats a 3xx as validation-skipped (not a hard reject)", async () => {
    const seen: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      seen.push(init as RequestInit);
      return new Response(null, { status: 302 }); // 302 is constructible; hits the 3xx guard
    });
    const r = await validateKey("anthropic", "sk-test");
    expect(seen[0]?.redirect).toBe("manual");
    expect(r.valid).toBe(true);
    expect(r.validationSkipped).toBe(true);
  });
  it("passes redirect:manual for every provider branch", async () => {
    const seen: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      seen.push(init as RequestInit);
      return new Response("{}", { status: 200 });
    });
    for (const f of ["anthropic", "openai", "google", "openrouter", "capsolver"] as const) {
      await validateKey(f, "k");
    }
    expect(seen.every((i) => i.redirect === "manual")).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npm test --workspace=backend -- keyValidation --run` → FAIL (redirect undefined; 3xx nu e tratat).

- [ ] **Step 3: Implementation** — adauga `redirect: "manual"` la fiecare fetch din `validateTwoCaptcha` si `fetchValidation`. In `validateKey`, inainte de check-urile 4xx:

```ts
    const res = await fetchValidation(field, value);
    if (res.status >= 300 && res.status < 400) {
      // redirect:"manual" — nu urmarim redirect-ul cu cheia atasata; validare omisa.
      return { valid: true, validationSkipped: true, reason: "Provider a raspuns cu redirect; validare online omisa." };
    }
```

Analog in `validateTwoCaptcha` inainte de `res.status >= 400`. (Nu tratam `status === 0` — undici pe Node intoarce `302, type:basic`, nu opaqueredirect; ramura 3xx e cea reala.)

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/keyValidation.ts backend/src/services/keyValidation.test.ts
git commit -m "fix(security): redirect:manual pe validarea cheilor API + matrice provideri (SEC-04)"
```

### Task 6.2: `redirect: "manual"` pe SOAP + test care exercita guard-ul

**Files:**
- Modify: `backend/src/soap.ts` (`callSoap` fetch + guard 3xx dupa fetch)
- Test: `backend/src/soap.test.ts`

- [ ] **Step 1: Write the failing test** (exercita EFECTIV ramura 3xx — mock intoarce 302):

```ts
it("rejects a 3xx redirect on the SOAP fetch (SEC-04)", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    expect((init as RequestInit).redirect).toBe("manual");
    return new Response(null, { status: 302 });
  });
  await expect(cautareDosare({ numeParte: "x" })).rejects.toThrow(/redirect/i);
});
```

- [ ] **Step 2: Run** `npm test --workspace=backend -- soap --run` → FAIL (nu arunca pe 302; redirect undefined).

- [ ] **Step 3: Implementation** — `redirect: "manual"` in optiunile fetch din `callSoap`; guard dupa fetch (inainte de citirea body-ului):

```ts
  if (response.status >= 300 && response.status < 400) {
    console.error(`[soap] redirect neasteptat (status ${response.status}) — refuzat`);
    throw new Error("Raspuns neasteptat de la PortalJust (redirect).");
  }
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/soap.ts backend/src/soap.test.ts
git commit -m "fix(security): redirect:manual + guard 3xx pe fetch-ul SOAP PortalJust (SEC-04)"
```

### Task 6.3: Cap dimensiune raspuns in rnpmClient (search/detail/history)

**Files:**
- Modify: `backend/src/services/rnpmClient.ts` (`search` :281-287, `fetchPart` :300-309, `fetchIstoric` :311-331)
- Test: `backend/src/services/rnpmClient.test.ts`

**Interfaces:**
- Consumes: `readResponseTextWithCap`, `ResponseTooLargeSignal` din `../util/streamCap.ts`.
- Produces: `RNPM_MAX_RESPONSE_BYTES` (default 20MB, env override); peste cap → `RnpmError(..., "response_too_large")`.

- [ ] **Step 1: Write the failing test** (asteapta CODUL explicit + acopera search + detail):

```ts
function oversizedFetch(): typeof fetch {
  const huge = "x".repeat(40 * 1024 * 1024);
  return (vi.fn(async () =>
    new Response(`{"pad":"${huge}"}`, { status: 200, headers: { "content-length": String(40 * 1024 * 1024 + 12) } })
  )) as unknown as typeof fetch;
}
it("search rejects an oversized response with code response_too_large", async () => {
  const client = new RnpmClient({ requestDelayMs: 0, fetchImpl: oversizedFetch() });
  await expect(client.search("creante", { gcode: "captcha" }, 1)).rejects.toMatchObject({
    name: "RnpmError", code: "response_too_large",
  });
});
it("fetchPart rejects an oversized response with code response_too_large", async () => {
  const client = new RnpmClient({ requestDelayMs: 0, fetchImpl: oversizedFetch() });
  await expect(client.fetchPart("uuid", 1)).rejects.toMatchObject({ code: "response_too_large" });
});
```

- [ ] **Step 2: Run** `npm test --workspace=backend -- rnpmClient --run` → FAIL (azi arunca `schema_violation`, nu `response_too_large`).

- [ ] **Step 3: Implementation** — constanta + helper; extrage signal-ul intr-o variabila si REUTILIZEAZA-l la citire (NU re-apela `withRnpmTimeout` — ar dubla bugetul):

```ts
import { readResponseTextWithCap, ResponseTooLargeSignal } from "../util/streamCap.ts";

const RNPM_MAX_RESPONSE_BYTES = (() => {
  const raw = Number.parseInt(process.env.RNPM_MAX_RESPONSE_BYTES ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 20 * 1024 * 1024;
})();

async function readRnpmJson(res: Response, signal: AbortSignal): Promise<unknown> {
  let text: string;
  try {
    text = await readResponseTextWithCap(res, RNPM_MAX_RESPONSE_BYTES, signal);
  } catch (err) {
    if (err instanceof ResponseTooLargeSignal) {
      throw new RnpmError(`Raspuns RNPM prea mare (${err.bytes} bytes).`, 502, undefined, "response_too_large");
    }
    throw err;
  }
  return JSON.parse(text); // JSON invalid ramane SyntaxError, ca azi
}
```

In `search`: extrage `const composed = withRnpmTimeout(signal);` inainte de fetch, foloseste-l la fetch SI la `readRnpmJson(res, composed)`; error-path `res.text()` → `readResponseTextWithCap(res, RNPM_MAX_RESPONSE_BYTES, composed).catch(() => "")`. La fel in `fetchPart`. In `fetchIstoric` foloseste `composed` care EXISTA deja (L317).

- [ ] **Step 4: Run** → PASS (+ testele de timeout existente).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rnpmClient.ts backend/src/services/rnpmClient.test.ts
git commit -m "fix(security): cap dimensiune raspuns RNPM (search/detail/history, cod response_too_large) fara dublare timeout (SEC-07)"
```

### Task 6.4: Cap pe iccjClient warmSession

**Files:**
- Modify: `backend/src/services/iccj/iccjClient.ts` (:468)
- Test: `backend/src/services/iccj/iccjClient.test.ts`

**Corectie Rev2:** NU testa prin `searchIccjEnriched` (postSearch face JSON.parse pe `<html>` → IccjSourceError inainte SI dupa fix). Testeaza cap-ul direct: fie exportand `warmSession` pentru test, fie asertand ca inlocuirea nu buffereaza (cel mai simplu: verifica ca `readResponseTextWithCap` e apelat prin comportament — un raspuns cu `content-length` peste cap nu arunca in afara, warmSession prinde si intoarce cookie-ul). Daca `warmSession` nu e exportabil fara refactor, marcheaza cap-ul aici ca acoperit de type-check + smoke si adauga doar un test de non-regresie pe drenare.

- [ ] **Step 1: Implementation** — inlocuieste `await res.arrayBuffer().catch(() => {});` cu:

```ts
    await readResponseTextWithCap(res, ICCJ_MAX_RESPONSE_BYTES, signal).catch(() => "");
```

(`readResponseTextWithCap` si `ICCJ_MAX_RESPONSE_BYTES` sunt deja importate/definite in fisier.)

- [ ] **Step 2: Type-check + suita iccj**

Run: `npx tsc --noEmit -p backend/tsconfig.json && npm test --workspace=backend -- iccjClient --run`
Expected: PASS (fara regresie pe cautarea enriched existenta).

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/iccj/iccjClient.ts
git commit -m "fix(security): drenare cu cap in iccj warmSession in loc de arrayBuffer nelimitat (SEC-07)"
```

### Task 6.5: Note risc acceptat in SECURITY.md (BUG-02 + SEC-09)

**Files:**
- Modify: `SECURITY.md` (sectiunea „Riscuri acceptate", NU un rand de changelog datat)

- [ ] **Step 1: Adauga cele doua note** (in „Riscuri acceptate", o linie fiecare, fara bullet la inceput de paragraf):

Portita de stocare RNPM prin replay gcode (BUG-02/NEW-01) — risc acceptat pe deploy intern cu utilizatori de incredere; redeschidere daca apar conturi externe organizatiei.

Absenta unui plafon de joburi de monitorizare per owner (SEC-09) — risc acceptat pe deploy intern; mitigari active (cadence 600s, claim 50/tick, rate limit 120/min, dedup target_hash); redeschidere la conturi externe sau infometare reala a scheduler-ului.

- [ ] **Step 2: Commit**

```bash
git add SECURITY.md
git commit -m "docs(security): note risc acceptat BUG-02 + SEC-09 in Riscuri acceptate (pre-web)"
```

---

# PR-8 — Corectitudine: BUG-04, BUG-03, BUG-06, SEC-05/06

### Task 8.1: BUG-04 — retry in afara orei, DAR strict per-owner

**Files:**
- Modify: `backend/src/services/email/dailyReportScheduler.ts`
- Test: `backend/src/services/email/dailyReportScheduler.test.ts`

**Decizie owner: per-owner strict.** Cand tick-ul se trezeste in afara orei (pentru ca EXISTA un retry due), proceseaza **doar** ownerii cu retry due; ownerii FARA entry de retry NU primesc trimiterea initiala in afara orei. Plus: ramura `retry_exhausted` trebuie sa ruleze si in afara orei (altfel attempts=MAX ramane orfan).

**Interfaces:**
- Produces: `hasDueRetry(todayLocal, nowMs): boolean` (retry due astazi, attempts<MAX, nowMs>=nextAttemptAt) SAU `hasExhaustedOrDue(...)` care include si attempts>=MAX (ca sa curete orfanul). Gate: `if (offHour && !anyRetryWork) return baseResult;`. In bucla: cand `offHour === true`, `continue` pentru orice owner FARA entry de retry (nici due, nici exhausted).

- [ ] **Step 1: Write the failing tests** (trei cazuri — due retry ruleaza off-hour; owner fara retry NU e trimis off-hour; exhausted se curata off-hour):

```ts
it("runs a due retry off-hour but does NOT send to owners without a pending retry", async () => {
  _resetDailyReportRetryStateForTest();
  // seed: owner-A cu alerta ieri + email enabled; owner-B la fel (fresh, fara retry)
  seedOwnerEmail("owner-A"); seedAlertYesterday("owner-A");
  seedOwnerEmail("owner-B"); seedAlertYesterday("owner-B");
  const send = vi.fn()
    .mockResolvedValueOnce({ ok: false, reason: "smtp" })   // A @ 09:30 fail
    .mockResolvedValue({ ok: true });
  const at930 = new Date(2026, 4, 3, 9, 30, 0);
  const at1005 = new Date(2026, 4, 3, 10, 5, 0); // off-hour, A retry due (09:35)
  await runDailyReportTick({ now: () => at930, reportHour: () => 9, mailerConfigured: () => true, send });
  send.mockClear();
  const r = await runDailyReportTick({ now: () => at1005, reportHour: () => 9, mailerConfigured: () => true, send });
  // Only owner-A (retry due) is sent off-hour; owner-B is NOT touched.
  expect(send).toHaveBeenCalledTimes(1);
  expect(r.emailsSent).toBe(1);
});

it("clears an exhausted retry off-hour (retry_exhausted audit)", async () => {
  // seed owner-A, fail 3x within hour, then a 4th tick off-hour must run the exhausted branch
  // ... (foloseste seedAlertYesterday + send mock care da ok:false de 3 ori)
});
```

Nota autoring (helperi reali existenti: `seedJob`, `seedRun`, `seedAlertAt`, `_resetDailyReportRetryStateForTest`): `seedOwnerEmail`/`seedAlertYesterday` NU exista — seedeaza direct in DB `owner_email_settings` (enabled=1, to_address) + o alerta via `seedAlertAt` cu `createdAt` in `yesterdayLocal`. Copiaza pattern-ul din `beforeEach`-ul suitei.

- [ ] **Step 2: Run** `npm test --workspace=backend -- dailyReportScheduler --run` → FAIL (azi tick off-hour intoarce fired:false).

- [ ] **Step 3: Implementation**

```ts
function retryWorkState(todayLocal: string, nowMs: number): { anyDue: boolean } {
  let anyDue = false;
  for (const retry of retryByOwner.values()) {
    if (retry.date !== todayLocal) continue;
    if (retry.attempts >= MAX_RETRY_ATTEMPTS) { anyDue = true; continue; } // exhausted cleanup counts
    if (nowMs >= retry.nextAttemptAt) anyDue = true;
  }
  return { anyDue };
}
```

Gate (inlocuieste L157) — calculeaza `nowMs`/`todayLocal` inainte:

```ts
  const nowMs = now.getTime();
  const todayLocal = formatLocalDate(now);
  const offHour = now.getHours() !== configuredHour;
  if (offHour && !retryWorkState(todayLocal, nowMs).anyDue) return baseResult;
```

In bucla, la inceputul iteratiei per owner (dupa `if (!owner.enabled || !owner.toAddress) continue;`), cand suntem off-hour, sari peste ownerii fara entry de retry:

```ts
    const retry = retryByOwner.get(owner.ownerId);
    if (offHour && (!retry || retry.date !== todayLocal)) continue; // per-owner: off-hour = doar retry-uri
```

Restul logicii de retry (exhausted L187, backoff L213) ramane; exhausted ruleaza acum si off-hour pentru ownerii cu entry.

- [ ] **Step 4: Run** → PASS (+ testele existente hour-gate/exhausted).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/email/dailyReportScheduler.ts backend/src/services/email/dailyReportScheduler.test.ts
git commit -m "fix(email): retry daily report off-hour STRICT per-owner + curata exhausted off-hour (BUG-04)"
```

### Task 8.2: BUG-03 — mapeaza SQLITE_CONSTRAINT_UNIQUE la 409

**Files:**
- Modify: `backend/src/services/monitoring/scheduler.ts` (in jurul `insertRunning`)
- Test: `backend/src/services/monitoring/scheduler.test.ts`

**Corectie Rev2:** match pe `code === "SQLITE_CONSTRAINT_UNIQUE"` + `message.includes("monitoring_runs.job_id")` — SQLite raporteaza `tabela.coloana`, NU numele indexului.

- [ ] **Step 1: Write the failing test** (identic cu Rev1 Task 8.2 — insereaza direct un run `running`, apoi `runJobNow` → asteapta `code: "in_flight"`).

- [ ] **Step 2: Run** → FAIL (azi arunca `SQLITE_CONSTRAINT_UNIQUE`, nu `in_flight`).

- [ ] **Step 3: Implementation**

```ts
      try {
        runId = insertRunning({ ownerId: job.owner_id, jobId: job.id, startedAt: nowIso });
      } catch (err) {
        const code = (err as { code?: string }).code ?? "";
        const msg = err instanceof Error ? err.message : "";
        if (code === "SQLITE_CONSTRAINT_UNIQUE" && msg.includes("monitoring_runs.job_id")) {
          const e = new Error("already in flight") as Error & { code?: string };
          e.code = "in_flight";
          throw e;
        }
        throw err;
      }
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/monitoring/scheduler.ts backend/src/services/monitoring/scheduler.test.ts
git commit -m "fix(monitoring): mapeaza SQLITE_CONSTRAINT_UNIQUE(monitoring_runs.job_id) la 409 in_flight (BUG-03)"
```

### Task 8.3: BUG-06 — clamp pagesTotal (bucla + contract) cu test marginit

**Files:**
- Modify: `backend/src/services/rnpmSearchService.ts` (dupa L273-275; bucla L363; `nextRnpmPage` L413 si contractul returnat ~L436)
- Test: `backend/src/services/rnpmSearchService.test.ts`

**Corectii Rev2:** (a) clampeaza SI valoarea `pagesTotal` returnata in contract (nu doar bucla si nextRnpmPage); (b) testul foloseste `pagesTotal` moderat (ex. 50) cu documents goale, NU 1M (evita 1M await-uri → timeout); asteapta numar mic de call-uri.

**Caveat acceptat (regresie de nisa):** clamp-ul se bazeaza pe `total`. Daca RNPM SUBRAPORTEAZA `total` dar `pagesTotal` e corect, o cautare legitima ar putea fi taiata devreme. Riscul e mic (codul deja se increde in `total` la guard-ul MAX_TOTAL_RESULTS) si preferabil unei bucle nemarginite. Daca apare vreodata in practica, alternativa e `Math.min(pagesTotal, MAX_TOTAL_RESULTS/pageSize)` in loc de `ceil(total/pageSize)`.

- [ ] **Step 1: Write the failing test**

```ts
it("clamps an inflated pagesTotal to ceil(total/pageSize)", async () => {
  class InflatedPagesClient extends RnpmClient {
    calls = 0;
    constructor() { super({ requestDelayMs: 0 }); }
    override async search(): Promise<RnpmSearchResult> {
      this.calls++;
      return { total: 30, pagesTotal: 50, pageSize: 25, currentPage: this.calls,
        documents: [], criteriu: "", eai: false } as unknown as RnpmSearchResult;
    }
  }
  const client = new InflatedPagesClient();
  await executeSearch({ type: "ipoteci", ownerId: "t", params: {}, captchaKey: "stub" }, client).catch(() => {});
  expect(client.calls).toBeLessThanOrEqual(2); // ceil(30/25)=2, nu 50
});
```

(Adapteaza semnatura `executeSearch` la cea reala; foloseste `fetchDetails:false`/DB tmpdir ca in split.test.ts daca e nevoie de persistenta.)

- [ ] **Step 2: Run** → FAIL (`client.calls` ~50).

- [ ] **Step 3: Implementation** — dupa `const pageSize = firstResult.pageSize;`:

```ts
  // BUG-06: RNPM ocasional intoarce un pagesTotal umflat; clampeaza la numarul
  // real de pagini derivat din total (pageSize>0), altfel bucla face un fetch
  // per pagina goala. total/pageSize vin din primul raspuns validat (guard-ul de
  // MAX_TOTAL_RESULTS de mai sus le acopera).
  const pagesTotalClamped = pageSize > 0 ? Math.min(pagesTotal, Math.max(Math.ceil(total / pageSize), 1)) : 1;
```

Foloseste `pagesTotalClamped` in: conditia buclei (L363), `nextRnpmPage` (L413), SI valoarea `pagesTotal` din obiectul returnat de serviciu (~L436) — ca sa nu scape contractul `pagesTotal=umflat`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rnpmSearchService.ts backend/src/services/rnpmSearchService.test.ts
git commit -m "fix(rnpm): clamp pagesTotal (bucla + nextRnpmPage + contract) la ceil(total/pageSize) (BUG-06)"
```

### Task 8.4: SEC-06 — decodeXmlEntities nu arunca pe code points invalide

**Files:**
- Modify: `backend/src/soap.ts` (`decodeXmlEntities`)
- Test: `backend/src/soap.test.ts`

(Identic cu Rev1 Task 8.4 — `safeCodePoint` + `isValidXmlChar` acopera NUL, controale, surogate 0xD800-0xDFFF, >0x10FFFF → U+FFFD. Confirmat CORECT de ambele review-uri.)

- [ ] **Step 1-5:** vezi Rev1 Task 8.4 (test rosu `&#x110000;`/`&#xD800;`/`&#0;` → `�`, valide raman; implementare `safeCodePoint`; commit).

### Task 8.5: SEC-05 — sanitizeaza faultstring (cu biome-ignore)

**Files:**
- Modify: `backend/src/soap.ts` (block L145-150)
- Test: `backend/src/soap.test.ts`

**Corectii Rev2:** (a) regex-ul cu caractere control brute necesita `// biome-ignore lint/suspicious/noControlCharactersInRegex: sanitize log input` (precedent soap.ts:57), altfel gate-ul Biome pica; (b) include si separatorii de linie Unicode (U+0085, U+2028, U+2029) care pot sparge liniile in unele sink-uri.

- [ ] **Step 1: Write the failing test** (identic cu Rev1 Task 8.5 — control chars stripped + cap 500; plus un caz cu ` `).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implementation**

```ts
  if (!response.ok || text.includes("soap:Fault")) {
    const rawFault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] ?? "necunoscut";
    // SEC-05: strip C0/C1 control chars + Unicode line separators + cap before
    // logging (upstream is plain HTTP, content is attacker-influenceable).
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional sanitization of log input
    const fault = rawFault.replace(/[ -  ]/g, " ").slice(0, 500);
    console.error("SOAP Fault detalii:", fault);
    throw new Error("Eroare la comunicarea cu serviciul PortalJust.");
  }
```

- [ ] **Step 4: Run** `npm test --workspace=backend -- soap --run && npx biome check backend/src/soap.ts` → PASS (teste + biome).

- [ ] **Step 5: Commit**

```bash
git add backend/src/soap.ts backend/src/soap.test.ts
git commit -m "fix(soap): sanitizeaza + trunchiaza faultstring la logare (control chars + line seps, biome-ignore) (SEC-05)"
```

---

# PR-9 — Igiena marunta

### Task 9.1: BUG-01 — try/catch cu fs.stat IN try + test care verifica cleanup

**Files:**
- Modify: `backend/src/services/alertsExportPdf.ts` (`buildAlertsPdf`)
- Test: `backend/src/services/alertsExportPdf.test.ts`

**Corectii Rev2:** (a) `fs.stat` INAUNTRUL try-ului (paritate reala cu rnpmExportPdf, acopera gap-ul (b) din audit); (b) testul verifica before/after ca nu ramane tmp orfan (nu doar `rejects.toThrow`).

- [ ] **Step 1: Write the failing test**

```ts
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

it("leaves no orphan tmp PDF when drawing throws (BUG-01)", async () => {
  const before = (await readdir(tmpdir())).filter((f) => f.startsWith("alerts-pdf-"));
  const poisoned = [new Proxy({}, { get() { throw new Error("boom"); } })] as never;
  await expect(buildAlertsPdf(poisoned)).rejects.toThrow();
  const after = (await readdir(tmpdir())).filter((f) => f.startsWith("alerts-pdf-"));
  expect(after.length).toBeLessThanOrEqual(before.length);
});
```

(Daca proxy-ul nu declanseaza throw in drawTable, forteaza un rand cu tip care pica la formatare; scopul verificabil ramane before/after pe tmp.)

- [ ] **Step 2: Run** → FAIL (tmp orfan sau unhandled stream error).

- [ ] **Step 3: Implementation** — wrap draw + `doc.end()` + `finishWriteStream` + **`fs.stat`** in try:

```ts
  try {
    drawTable(doc, rows, 82, 1);
    doc.end();
    await finishWriteStream(stream, tmpPath);
    const stat = await fs.stat(tmpPath);
    return { filepath: tmpPath, filename: alertsFilename("pdf", rows.length), mime: MIME_PDF, byteLength: stat.size };
  } catch (err) {
    doc.destroy();
    stream.destroy();
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/alertsExportPdf.ts backend/src/services/alertsExportPdf.test.ts
git commit -m "fix(export): cleanup tmp la orice throw in buildAlertsPdf (fs.stat in try) — paritate reala (BUG-01)"
```

### Task 9.2: SEC-08 — sender-check IPC notificari, FAIL-CLOSED

**Files:**
- Modify: `electron/notifications.js` (`registerNotificationIpc`); `electron/main.js` (apel L350)

**Corectie Rev2:** parametrul `isTrustedIpcSender` e **obligatoriu**, fallback **fail-closed** (nu `() => true`).

- [ ] **Step 1: main.js** — paseaza guard-ul: `registerNotificationIpc(ipcMain, isTrustedIpcSender);`

- [ ] **Step 2: notifications.js**

```js
function registerNotificationIpc(ipcMain, isTrustedIpcSender) {
  if (typeof isTrustedIpcSender !== "function") {
    throw new Error("registerNotificationIpc necesita isTrustedIpcSender (fail-closed)");
  }
  const guard = isTrustedIpcSender;
  ipcMain.handle("notification:getStatus", (event) => (guard(event) ? getNotificationStatus() : null));
  ipcMain.handle("notification:test", (event) =>
    guard(event)
      ? showNativeNotification({ title: "Legal Dashboard - notificari active",
          body: "Aceasta este o notificare de test pentru alertele de monitorizare.",
          tag: "legal-dashboard-notification-test" })
      : undefined
  );
  ipcMain.handle("notification:show", (event, payload) => (guard(event) ? showNativeNotification(payload) : undefined));
}
```

- [ ] **Step 3: Smoke** — `npm run electron:dev`: test + show din UI merg; getStatus intoarce statusul.

- [ ] **Step 4: Commit**

```bash
git add electron/notifications.js electron/main.js
git commit -m "fix(electron): sender-check fail-closed pe handlerele IPC de notificari (SEC-08)"
```

### Task 9.3: SEC-10 — will-redirect mirror (identic Rev1 Task 9.3)

`electron/main.js`: extrage `isAllowedNavUrl`, ataseaza pe `will-navigate` SI `will-redirect`. Smoke. Commit `fix(electron): oglindeste validarea navigatiei pe will-redirect (SEC-10)`.

### Task 9.4: BUG-05 — try/finally splitter (identic Rev1 Task 9.4)

`backend/src/db/rnpmSplitter.ts`: muta `src` in try/finally garantand `src.close()`. Verificare: `npm test --workspace=backend -- rnpmSplitter rnpmDb --run`. Commit `fix(rnpm): try/finally garanteaza inchiderea handle-ului sursa in splitter (BUG-05)`.

**Nota Rev2:** testul „al doilea split reuseste" NU dovedeste inchiderea (SQLite permite multiple read-only). Fixul e structural-corect; nu adauga un test fals-verde — verifica prin type-check + suita existenta, sau adauga un test care forteaza `new Database(tmpPath)` sa arunce (tmpPath in director inexistent) si asigura ca nu ramane exceptie neprinsa.

### Task 9.5: BUG-08 — unref timer shutdown (identic Rev1 Task 9.5)

`electron/main.js` before-quit: `t.unref?.()` pe timer-ul de 75s. Smoke. Commit `fix(electron): unref pe timer-ul de shutdown drain (BUG-08)`.

### Task 9.6: SEC-11 — respinge placeholder JWT + curata template-ul

**Files:**
- Modify: `backend/src/auth/config.ts` (`requireJwtSecret`); `docker-compose.web.example.yml:49`
- Test: `backend/src/auth/config.test.ts`

(Identic cu Rev1 Task 9.6 — regex `REPLACE_WITH|CHANGE_ME|YOUR_SECRET` respinge placeholder-ul de 48 chars; test rosu; accepta secret real.)

**Corectie Rev2:** PR-ul chiar modifica `docker-compose.web.example.yml:49` — inlocuieste placeholder-ul care trece check-ul (`REPLACE_WITH_32_PLUS_CHAR_SECRET_FROM_SECRET_MGR`) cu un placeholder care e evident invalid ODATA cu regex-ul (ex. pastreaza `REPLACE_WITH_...` — acum e respins la boot, ceea ce e comportamentul dorit: template necompletat = fatal). Confirma coerenta: commit-ul include `config.ts` + testul + `docker-compose.web.example.yml`.

- [ ] Commit: `fix(auth): respinge placeholder-ele de JWT secret din template (SEC-11)`

---

# PR-10 — Docs + deploy

### Task 10.1: SEC-03 — corecteaza „write-only" xlsx FARA a edita istoric datat

**Files:**
- Modify: `SECURITY.md` (sectiunea activa „Riscuri acceptate", NU randul de changelog datat L256), `STATUS.md` (L65 — doar segmentul fals), `SESSION-HANDOFF.md` (L472-475 — doar segmentul fals)

**Corectie Rev2:** NU rescrie randuri de changelog/istoric datate (L256 2026-04-18, STATUS.md istoric — imutabile per CLAUDE.md). La STATUS.md:65 / SESSION-HANDOFF.md:474 editeaza **chirurgical doar** bucata falsa „write-only prin xlsx-js-style"; **pastreaza** „xlsx@0.18.5 nu mai e pe path-ul de input user" (corect). Adauga corectia activa in „Riscuri acceptate" sau un rand NOU de changelog cu data curenta.

- [ ] **Step 1:** In `SECURITY.md` „Riscuri acceptate" adauga clarificarea: parserul (`XLSX.read`, monitoringBulkTemplate.ts:318) e reachable pe path-ul de import preview; risc mitigat de validare interna + `Promise.race` timeout, dar NU „write-only".
- [ ] **Step 2:** STATUS.md:65 / SESSION-HANDOFF.md:474 — inlocuieste doar „write-only prin xlsx-js-style" cu formularea corecta (xlsx-js-style e folosit si la parsare preview), fara a atinge restul.
- [ ] **Step 3: Commit** `docs(security): corecteaza claim stale 'write-only' xlsx fara a rescrie istoric datat (SEC-03)`

### Task 10.2: SEC-13 — sync versiuni deploy + scoate domeniul (identic Rev1 Task 10.2)

`docker-compose.yml` (L32 domeniu, L82 default), `deploy/docker-compose.prod.yml` (L84), `deploy/.env.prod.example` (L87) → `2.43.0` + comentariu generic. Sanity: `grep -rEn "2\.35\.0|2\.38\.0|2\.39\.0|instantfactoring" docker-compose.yml deploy/`. Commit `docs(deploy): sync APP_VERSION 2.43.0 + scoate domeniul concret (SEC-13)`.

### Task 10.3: BUG-10 — corecteaza TOATE pasajele stale despre chei

**Files:**
- Modify: `frontend/src/pages/manual-content.tsx` (L727 **si L618-619 si L730**), `frontend/src/lib/export-manual.ts` (L406-407, L470 **si L473**)

**Corectie Rev2:** Rev1 rata pasaje active. De corectat TOATE:
- manual-content.tsx:727 (web „obfuscate reversibil"), :618-619 („doar local, nu pe niciun server" + obfuscare localStorage), :730 („nu exista server intermediar" — fals pe web).
- export-manual.ts:406-407, :470 (obfuscare localStorage), :473 („nu exista server intermediar").

Formulare corecta: desktop = safeStorage/OS keystore; web = server-side per-tenant (`tenant_api_keys` AES-256-GCM), backend-ul detine cheile si face requesturile.

- [ ] **Step 1-2:** editeaza toate cele 6 locatii coerent (fara sa se contrazica intre ele).
- [ ] **Step 3: Type-check** `cd frontend && npx tsc --noEmit` → PASS.
- [ ] **Step 4: Commit** `docs(manual): corecteaza TOATE pasajele stale despre stocarea cheilor API (BUG-10)`

### Task 10.4: SEC-12 — tracking uuid/exceljs (identic Rev1 Task 10.4)

`SECURITY.md`: rand NOU (data curenta) de tracking uuid 8.3.2 tranzitiv via exceljs. Commit `docs(security): tracking uuid/exceljs GHSA-w5hq-g745-h8pq (SEC-12)`.

---

# Finalizare

### Task F1: Verificare completa + push pe GitLab

- [ ] **Step 1: ABI Node pentru teste** — `npm rebuild better-sqlite3` (daca PR-2 a lasat modulul pe ABI Electron).
- [ ] **Step 2: biome** — `npx biome check --write` pe fisierele atinse; re-stage; commit `style: biome format pass` daca reformateaza.
- [ ] **Step 3: `npm run check`** (lint + typecheck + toate testele) → PASS integral. **Confirma pass REAL, nu presupune** (vezi runtime caveat).
- [ ] **Step 4: Build** — `npm run build` → bundle curat.
- [ ] **Step 5: Smoke final desktop** — `npm run rebuild:electron && npm run electron:dev`: boot, mutatii 200, SSE, notificari, shutdown curat.
- [ ] **Step 6: Push** (doar dupa tot verde):

```bash
git push -u origin fix/audit-sec-v2.43-remediere
```

---

## Ordine recomandata

**PR-1 → PR-2 → PR-5 → PR-6 → PR-8 (BUG-04 primul) → PR-9 → PR-10 → F1.** PR-uri izolate; commit-uri locale; un singur push la final.

## Rezumat corectii Rev2 fata de Rev1 (din dublul review adversarial)

BUG-03 match pe `SQLITE_CONSTRAINT_UNIQUE`+`monitoring_runs.job_id` (nu numele indexului). keyValidation/SOAP teste cu `status:302` (nu 0). rnpmClient cap: signal reutilizat (fara dublare timeout) + test asteapta `code:"response_too_large"` + acopera detail. iccj warmSession testat fara `searchIccjEnriched`. BUG-04 per-owner strict + exhausted off-hour. BUG-06 clampeaza si contractul + test marginit (nu 1M). SEC-05 `biome-ignore` + line separators. BUG-01 `fs.stat` in try + test before/after. SEC-08 fail-closed. PR-1 warn la boot pentru kill switch + repara `index.test.ts` + load-testuri. PR-2 doar lockfile + rebuild dupa gate teste. PR-5 gate strict decuplat de remoteBind (web+loopback+CIDR gol=fatal) + plasat in afara try boot + canonicalizare IPv6 + warn actualizat. PR-10 SEC-03 fara istoric datat + BUG-10 toate pasajele. Exemptia PAT documentata ca defense-in-depth.
