# Fix: fallback captcha ignorat in web mode (tenant keys) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In web mode, cand tenantul are AMBELE chei captcha salvate, `withRnpmCaptchaGuards` propaga cheia celuilalt provider ca `fallback2CaptchaKey`, astfel incat modurile `race` si `sequential` (fallback-on-failure) sa functioneze identic cu desktop-ul.

**Architecture:** Fix complet localizat in `backend/src/routes/rnpmGuards.ts`. `resolveCaptchaKeyForRoute` citeste deja `getTenantKeys()` si alege cheia provider-ului selectat; adaugam cheia CELUILALT provider ca `fallbackKey` optional in `CaptchaResolution`, apoi o propagam in cele DOUA return-uri `ok:true` de pe calea tenant din `withRnpmCaptchaGuards` (calea token-cap si calea record-and-accept). Rutele (`/search`, `/bulk`, `/search/split`) deja prefera `guard.fallback2CaptchaKey ?? body.fallback2CaptchaKey`, deci nu se ating. `solveRnpmCaptcha` accepta deja fallback si valideaza lungimea (>=10) — cheie tenant goala (`""`) se paseaza ca `undefined`.

**Tech Stack:** TypeScript (backend Hono), vitest, biome.

## Global Constraints

- Romana fara diacritice in cod sursa (legacy constraint PortalJust).
- Repository-only DB access — acest fix NU atinge `db/**`.
- NU loga valoarea cheilor (nici in teste); logurile existente raporteaza doar `fallback=<provider|none>`.
- Fara bump de versiune. Fara push (push doar cu confirmarea userului).
- Gate inainte de commit: `npx biome check --write` pe fisierele atinse -> `npx tsc --noEmit -p backend/tsconfig.json` -> testele backend afectate.
- Serverul dev-web-local ruleaza (PID backend 39232, porturi 3002-3004) — NU-l opri; testele folosesc DB-uri temp izolate si nu ating porturile.

---

### Task 1: `resolveCaptchaKeyForRoute` intoarce si cheia de fallback; `withRnpmCaptchaGuards` o propaga

**Files:**
- Modify: `backend/src/routes/rnpmGuards.ts:64-67` (tipul `CaptchaResolution`)
- Modify: `backend/src/routes/rnpmGuards.ts:258-274` (`resolveCaptchaKeyForRoute`)
- Modify: `backend/src/routes/rnpmGuards.ts:172-179` si `:201-208` (cele doua return-uri tenant din `withRnpmCaptchaGuards`)
- Test: `backend/src/routes/rnpmGuards.test.ts`

**Interfaces:**
- Consumes: `getTenantKeys(): TenantKeys` (are campurile `twocaptcha: string`, `capsolver: string`, `captchaProvider`, `captchaMode`).
- Produces: `CaptchaResolution` varianta tenant-ok primeste camp nou optional `fallbackKey?: string`; `RnpmCaptchaGuardResult` ok:true pe sursa `tenant` populeaza `fallback2CaptchaKey` (campul EXISTA deja in tip la linia 60, doar nu era setat). Rutele existente il consuma neschimbate.

- [ ] **Step 1: Scrie testele care pica (3 teste noi in `rnpmGuards.test.ts`)**

Adauga in describe-ul existent `withRnpmCaptchaGuards` (harness-ul `buildApp()` trebuie extins sa expuna si `fallback2CaptchaKey` in raspuns — adauga linia `fallback2CaptchaKey: guard.fallback2CaptchaKey,` in obiectul `c.json({...})` de la linia 46-53):

```ts
it("in web mode cu ambele chei salvate propaga cheia celuilalt provider ca fallback2CaptchaKey", async () => {
  mockedGetAuthMode.mockReturnValue("web");
  mockedGetTenantKeys.mockReturnValue({
    anthropic: "",
    openai: "",
    google: "",
    openrouter: "",
    twocaptcha: "tenant-2captcha-key",
    capsolver: "tenant-capsolver-key",
    captchaProvider: "capsolver",
    captchaMode: "race",
    updatedAt: "2026-05-19T00:00:00Z",
    updatedBy: "admin",
  });

  const res = await buildApp().request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "ipoteci" }),
  });

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    ok: true,
    source: "tenant",
    captchaKey: "tenant-capsolver-key",
    captchaProvider: "capsolver",
    captchaMode: "race",
    fallback2CaptchaKey: "tenant-2captcha-key",
  });
});

it("in web mode cu provider 2captcha si capsolver salvat, fallback-ul e cheia capsolver", async () => {
  mockedGetAuthMode.mockReturnValue("web");
  mockedGetTenantKeys.mockReturnValue({
    anthropic: "",
    openai: "",
    google: "",
    openrouter: "",
    twocaptcha: "tenant-2captcha-key",
    capsolver: "tenant-capsolver-key",
    captchaProvider: "2captcha",
    captchaMode: "sequential",
    updatedAt: "2026-05-19T00:00:00Z",
    updatedBy: "admin",
  });

  const res = await buildApp().request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "ipoteci" }),
  });

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    ok: true,
    source: "tenant",
    captchaKey: "tenant-2captcha-key",
    captchaProvider: "2captcha",
    captchaMode: "sequential",
    fallback2CaptchaKey: "tenant-capsolver-key",
  });
});

it("in web mode cu o singura cheie salvata fallback2CaptchaKey ramane absent", async () => {
  mockedGetAuthMode.mockReturnValue("web");
  mockedGetTenantKeys.mockReturnValue({
    anthropic: "",
    openai: "",
    google: "",
    openrouter: "",
    twocaptcha: "",
    capsolver: "tenant-capsolver-key",
    captchaProvider: "capsolver",
    captchaMode: "race",
    updatedAt: "2026-05-19T00:00:00Z",
    updatedBy: "admin",
  });

  const res = await buildApp().request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "ipoteci" }),
  });

  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json).toMatchObject({ ok: true, source: "tenant", captchaKey: "tenant-capsolver-key" });
  expect(json.fallback2CaptchaKey).toBeUndefined();
});
```

- [ ] **Step 2: Ruleaza testele si confirma ca pica**

Run: `npx vitest run src/routes/rnpmGuards.test.ts` (din `backend/`)
Expected: primele 2 teste noi FAIL (`fallback2CaptchaKey` = `undefined`, asteptat cheia celuilalt provider); al 3-lea trece deja (documenteaza contractul). Cele 8 teste vechi raman verzi.

- [ ] **Step 3: Implementarea minima in `rnpmGuards.ts`**

3a. Tipul `CaptchaResolution` (linia 64-67) — adauga `fallbackKey`:

```ts
export type CaptchaResolution =
  | { source: "body" }
  | { source: "tenant"; ok: true; captchaKey: string; provider: CaptchaProvider; mode: CaptchaMode; fallbackKey?: string }
  | { source: "tenant"; ok: false; response: Response };
```

3b. `resolveCaptchaKeyForRoute` (linia 258-274) — calculeaza cheia celuilalt provider; string gol devine `undefined`:

```ts
export function resolveCaptchaKeyForRoute(c: Context): CaptchaResolution {
  if (getAuthMode() !== "web") return { source: "body" };
  const tenant = getTenantKeys();
  const provider = tenant.captchaProvider;
  const key = provider === "capsolver" ? tenant.capsolver : tenant.twocaptcha;
  const otherKey = provider === "capsolver" ? tenant.twocaptcha : tenant.capsolver;
  if (!key) {
    return {
      source: "tenant",
      ok: false,
      response: c.json(
        fail(ErrorCodes.CAPTCHA_NOT_CONFIGURED, "Cheia captcha nu e configurata. Contacteaza adminul.", c),
        501
      ),
    };
  }
  return { source: "tenant", ok: true, captchaKey: key, provider, mode: tenant.captchaMode, fallbackKey: otherKey || undefined };
}
```

3c. Cele doua return-uri `ok: true` de pe calea tenant din `withRnpmCaptchaGuards` — adauga campul. Return-ul caii token-cap (linia 172-179):

```ts
        return {
          ok: true,
          source: "tenant",
          body: body as Record<string, unknown>,
          captchaKey: resolved.captchaKey,
          captchaProvider: resolved.provider,
          captchaMode: resolved.mode,
          fallback2CaptchaKey: resolved.fallbackKey,
        };
```

Return-ul caii record-and-accept (linia 201-208):

```ts
    return {
      ok: true,
      source: "tenant",
      body: body as Record<string, unknown>,
      captchaKey: resolved.captchaKey,
      captchaProvider: resolved.provider,
      captchaMode: resolved.mode,
      fallback2CaptchaKey: resolved.fallbackKey,
    };
```

- [ ] **Step 4: Ruleaza testele si confirma ca trec**

Run: `npx vitest run src/routes/rnpmGuards.test.ts` (din `backend/`)
Expected: PASS toate (8 vechi + 3 noi).

- [ ] **Step 5: Teste adiacente (regresie pe consumatori)**

Run: `npx vitest run src/routes/rnpm.contract.test.ts src/routes/rnpmCaptchaQuota.test.ts src/routes/rnpm.envelope.test.ts src/services/captchaSolver.test.ts` (din `backend/`)
Expected: PASS. Daca vreun test mock-uieste `getTenantKeys` cu ambele chei si asserteaza absenta fallback-ului, actualizeaza-l la contractul NOU (fallback prezent), nu reveni fixul.

- [ ] **Step 6: Gate + commit**

```bash
npx biome check --write backend/src/routes/rnpmGuards.ts backend/src/routes/rnpmGuards.test.ts
npx tsc --noEmit -p backend/tsconfig.json
```

Expected: biome curat (re-ruleaza vitest daca reformateaza), tsc fara erori.

```bash
git add backend/src/routes/rnpmGuards.ts backend/src/routes/rnpmGuards.test.ts docs/superpowers/plans/2026-07-12-fix-captcha-fallback-web-mode.md
git commit -m "fix(rnpm): web mode propaga a doua cheie tenant ca fallback captcha — race/sequential fallback functioneaza si pe web, nu doar desktop (observat la ban de proxy CapSolver in human testing)"
```

---

## Decizii (context pentru reviewer)

1. **Race in web consuma ambele portofele per captcha** — intentionat: adminul alege explicit modul "Race (in paralel)" in UI si a salvat ambele chei; semantica devine identica cu desktop-ul (unde clientul trimite ambele chei). Sequential = fallback doar la esec (cost suplimentar doar pe failure path).
2. **Ruta `/captcha/balance` NU se atinge** — interogheaza soldul unui provider anume; fallback-ul nu are sens acolo.
3. **Frontend NU se atinge** — in web mode browserul nu trimite chei; UI-ul de admin (provider/mod) exista deja.
4. **`rejectCaptchaKeyInWebMode` neatins** — foloseste doar bratul `ok:false`.

## Verificare finala (dupa commit)

Smoke pe mediul dev-web-local care ruleaza deja: o cautare RNPM din tab-ul admin trebuie sa logheze `[captcha] solve start provider=capsolver mode=race fallback=2captcha` in `.dev-web-local/backend.out.log`. ATENTIE: backend-ul care ruleaza e build-ul VECHI — pentru smoke real trebuie rebuild + restart, DOAR cu acordul userului (serverul e in human testing; alternativ smoke-ul se amana pana la urmatoarea repornire naturala).
