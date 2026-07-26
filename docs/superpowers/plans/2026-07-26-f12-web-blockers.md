# Plan implementare — F12-F8, F12-F5, F12-F3 (+ CodeRabbit 1.2)

> **Pentru agenti:** SUB-SKILL OBLIGATORIU: `superpowers:subagent-driven-development` (recomandat) sau
> `superpowers:executing-plans` pentru executie task cu task. Pasii folosesc checkbox (`- [ ]`).

**Goal:** Inchide cele trei findings de securitate care blocheaza web deploy-ul, plus fixul CodeRabbit 1.2
care sta in acelasi bloc de cod, in patru commituri separate reversibile individual.

**Arhitectura:** Trei fixuri independente ca fisiere, dar doua dintre ele (F12-F3, 1.2) ating acelasi bloc de
admitere din `backend/src/routes/rnpm.ts` si se fac intr-o singura trecere, in commituri distincte. F12-F5 se
repara la SURSA (`captchaSolver.ts`), nu la sink — sunt sase sinkuri, nu unul. F12-F8 e un middleware pe router
plus migrarea a doua fisiere de test care nu seed-uiau user rows.

**Tech stack:** Node 22 + Hono + TypeScript strict, vitest, better-sqlite3, biome.

## Decizii luate de user (2026-07-26, nu le redeschide)

**F12-F8: PAT-urile sunt admin-only.** `requireRole("admin")` pe router. Rutele raman owner-scoped prin
`getOwnerId`, deci "admin-only" inseamna ca doar adminii pot MINTA tokenuri (fiecare pe contul lui), nu ca
adminii administreaza tokenurile altora. Aliniaza backendul cu ce presupune deja UI-ul
(`ApiKeyDialog.tsx:133`, `Settings.tsx:110`).

**F12-F3: se renunta complet la scutirea pe `gcode`.** Limita de stocare se verifica intotdeauna, in ambele
puncte. Un user peste limita nu mai poate termina o cautare in curs pana nu elibereaza spatiu. Varianta cu
`gcode` legat de `searchId` a fost respinsa explicit — nu o adauga in HARDENING.md ca follow-up.

## Global Constraints

Branch: `feat/v2.43.0-rnpm-split`. NICIODATA push pe `main` (Dokploy deployeaza de acolo).

Fara `git add -A`. `PowerShell-7.6.4-win-x64.msi` de la radacina nu e in `.gitignore`. Staging doar pe cai explicite.

Nu se atinge infra: Dokploy, `docker-compose.yml`, `deploy/`.

Nu se rezolva "pe drum" celelalte 9 findings F12 din HARDENING.md si niciun alt finding CodeRabbit in afara
de 1.2 — delta-ul trebuie sa ramana reviewabil.

Cod sursa fara diacritice (constrangere legacy PortalJust). Mesaje UI in romana.

Gate inainte de FIECARE commit, in ordinea din CLAUDE.md: `npx biome check --write <fisiere atinse>` →
`npx tsc --noEmit -p backend/tsconfig.json` → `npm run build` → `npm test --workspace=backend`.

Baseline de referinta la `4ff06ce`: **2078 teste backend trecute / 8 skipped, 395 teste frontend.** La finalul
planului trebuie sa fie 2087 backend (9 teste noi, detaliate per task) si 395 frontend neatinse.

Fals pozitiv cunoscut la biome: `npx biome check .` pe tot repo-ul raporteaza 1 eroare intr-un artefact de scan
cu CRLF, `CLAUDE-SECURITY-20260724-195947/CLAUDE-SECURITY-REVISION-c5dd9697e2e3-dirty.json`. Directorul se
auto-ignora si nu e tracked. NU e blocker.

**Acest fisier de plan contine lanturi de exploatare cu file:line.** Intra in acelasi cos ca commitul de
documentatie de securitate deja nepushuit: NU se urca pe GitLab fara autorizare explicita a userului.

---

## Structura fisierelor

| Fisier | Rol in acest plan | Task |
|--------|-------------------|------|
| `backend/src/routes/apiTokens.ts` | Modificat: `requireRole("admin")` dupa gate-ul de PAT | 1 |
| `backend/src/routes/openapi.ts` | Modificat: nota de securitate reflecta admin-only | 1 |
| `backend/src/routes/apiTokens.test.ts` | Modificat: seed user rows + 2 teste noi | 1 |
| `backend/src/routes/apiTokensCsrf.test.ts` | Modificat: seed user row pentru "alice" | 1 |
| `backend/src/services/captchaSolver.ts` | Modificat: helper de redactare + 2 call sites | 2 |
| `backend/src/services/captchaSolver.test.ts` | Modificat: 2 teste noi de redactare | 2 |
| `backend/src/routes/rnpm.ts` | Modificat: mesaj generic la `:370`; admitere fara ramura pe `gcode`; gard restore mutat | 2, 3, 4 |
| `backend/src/services/rnpmSearchService.ts` | Modificat: recheck fara `if (!existingGcode)` | 3 |
| `backend/src/services/rnpmStorageRecheck.test.ts` | Modificat: testul de la `:96` inversat | 3 |
| `backend/src/routes/rnpmStorageLimit.routes.test.ts` | Modificat: 500 generic (T2); testul `:166-183` inversat + 429 cu `gcode` arbitrar (T3); 409 inainte de captcha pe 3 rute (T4) | 2, 3, 4 |
| `HARDENING.md` | Modificat: cele 3 marcate rezolvate in Faza 12 | 5 |

---

## Task 1: F12-F8 — `requireRole("admin")` pe `/api/v1/tokens*`

**Files:**
- Modify: `backend/src/routes/apiTokens.ts:14-27`
- Modify: `backend/src/routes/openapi.ts:77` (nota de securitate a rutelor de tokenuri)
- Test: `backend/src/routes/apiTokens.test.ts` (beforeEach + 2 teste noi)
- Test: `backend/src/routes/apiTokensCsrf.test.ts:41-47` (beforeEach)

**Interfaces:**
- Consuma: `requireRole(...allowed: UserRole[])` din `backend/src/middleware/requireRole.ts:23` —
  intoarce middleware Hono; 401 `unauthorized` daca `getUserById(ownerId)` e null, 403 `forbidden` daca
  statusul nu e `active` sau rolul nu e in lista.
- Consuma: `insertUser({ id, email, displayName, role? })` din `backend/src/db/userRepository.ts:233`.
- Produce: nimic pentru taskurile urmatoare.

**De ce e sigur:** routerul e montat DOAR in web mode (`backend/src/index.ts:360-362`,
`if (getAuthMode() === "web")`). Pe desktop ruta nu exista, deci nu exista suprafata de regresie.

**Ordinea middleware-urilor conteaza:** gate-ul de PAT ramane PRIMUL. Un PAT trebuie sa primeasca in
continuare `PAT_CANNOT_MANAGE_TOKENS`, nu un 401/403 de rol — altfel se pierde semnalul ca escaladarea
PAT→PAT e blocata intentionat, nu accidental.

- [ ] **Step 1: Scrie testele care pica**

In `backend/src/routes/apiTokens.test.ts`, adauga in `describe("apiTokensRouter", ...)`:

```ts
  it("F12-F8: o sesiune de user non-admin nu poate emite tokenuri (403 forbidden)", async () => {
    const res = await createToken(buildApp(), { name: "x", scopes: ["dosare"] }, "dan");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("forbidden");

    const list = await buildApp().request("/api/v1/tokens", { headers: { "x-test-owner": "dan" } });
    expect(list.status).toBe(403);
    const revokeAll = await buildApp().request("/api/v1/tokens/revoke-all", {
      method: "POST",
      headers: { "x-test-owner": "dan" },
    });
    expect(revokeAll.status).toBe(403);
  });

  it("F12-F8: gate-ul de PAT ramane INAINTEA gardului de rol (codul nu devine 401/forbidden)", async () => {
    // Regresie pe ORDINE: daca cineva muta requireRole inaintea gate-ului de PAT,
    // un PAT al unui owner fara user row ar primi 401 "unauthorized" in loc de
    // semnalul canonic de anti-escaladare.
    const res = await buildApp("nobody", "tok1").request("/api/v1/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", scopes: ["dosare"] }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("PAT_CANNOT_MANAGE_TOKENS");
  });
```

- [ ] **Step 2: Ruleaza si confirma ca pica**

```
npx vitest run backend/src/routes/apiTokens.test.ts -t "F12-F8"
```

Asteptat: primul test FAIL cu 201 in loc de 403 (nu exista niciun gard de rol). Al doilea test TRECE deja
(gate-ul de PAT e singurul existent) — e un test de blocare a ordinii, nu de comportament nou.

- [ ] **Step 3: Adauga gardul de rol**

In `backend/src/routes/apiTokens.ts`, adauga importul dupa linia 3:

```ts
import { requireRole } from "../middleware/requireRole.ts";
```

si insereaza dupa middleware-ul existent (dupa linia 27, inainte de `const SCOPES`):

```ts
// F12-F8 (2026-07-26): pana acum "doar adminii emit PAT-uri" traia EXCLUSIV in UI
// (ApiKeyDialog.tsx, Settings.tsx). Un apel direct cu cookie de sesiune de user
// normal crea un token valid. Un gard doar in frontend nu e gard. Ruta e montata
// numai in web mode (index.ts), deci zero suprafata desktop. Ordinea conteaza:
// gardul de rol sta DUPA gate-ul de PAT, ca un PAT sa primeasca in continuare
// PAT_CANNOT_MANAGE_TOKENS (anti-escaladare), nu 401/403 de rol.
apiTokensRouter.use("*", requireRole("admin"));
```

- [ ] **Step 4: Migreaza harness-ul de test (seed user rows)**

Fara asta pica TOATE testele existente din ambele fisiere: `requireRole` face `getUserById(ownerId)`, nu
gaseste rand si intoarce 401 "User not found".

In `backend/src/routes/apiTokens.test.ts`, adauga la importuri:

```ts
import { insertUser } from "../db/userRepository.ts";
```

si in `beforeEach`, imediat dupa `getDb();`:

```ts
  // F12-F8: routerul cere acum rol admin. Ownerii folositi in teste ca EMITENTI
  // de tokenuri au nevoie de rand real cu role=admin; "dan" ramane user normal
  // ca sa exercite 403-ul.
  insertUser({ id: "alice", email: "alice@x.ro", displayName: "Alice", role: "admin" });
  insertUser({ id: "bob", email: "bob@x.ro", displayName: "Bob", role: "admin" });
  insertUser({ id: "carol", email: "carol@x.ro", displayName: "Carol", role: "admin" });
  insertUser({ id: "dan", email: "dan@x.ro", displayName: "Dan", role: "user" });
```

In `backend/src/routes/apiTokensCsrf.test.ts`, adauga la importuri:

```ts
import { insertUser } from "../db/userRepository.ts";
```

si in `beforeEach`, imediat dupa `getDb();`:

```ts
  // F12-F8: testul 2 verifica faptul ca o cerere same-origin AJUNGE la router
  // (404 pe token inexistent). Fara rand admin pentru "alice" ar primi 401 de la
  // requireRole si testul ar trece din motivul gresit.
  insertUser({ id: "alice", email: "alice@x.ro", displayName: "Alice", role: "admin" });
```

- [ ] **Step 5: Aliniaza specul OpenAPI (finding Codex, MEDIUM)**

Fara asta, specul publicat ramane factual fals: `backend/src/routes/openapi.ts:77` descrie cele patru rute ca
fiind deschise oricarei sesiuni. `openapi.test.ts:49-55` verifica doar mecanismul de autentificare
(`sessionCookie`), nu rolul, deci nu semnaleaza divergenta.

In `backend/src/routes/openapi.ts`, linia 77 devine:

```ts
  const sessionNote =
    "Session-only (cookie/JWT) SI doar rol admin (403 forbidden altfel). Un PAT primeste 403 PAT_CANNOT_MANAGE_TOKENS.";
```

Fara test nou: e un string de documentatie, iar o asertiune pe textul lui ar bloca reformularea fara sa
prinda o regresie reala. Gardul propriu-zis e testat in Step 1.

- [ ] **Step 6: Ruleaza si confirma verde**

```
npx vitest run backend/src/routes/apiTokens.test.ts backend/src/routes/apiTokensCsrf.test.ts backend/src/routes/openapi.test.ts
```

Asteptat: PASS pe tot, inclusiv cele 2 teste noi. Daca `apiTokensCsrf` testul 1 pica cu alt cod decat
`csrf_origin_mismatch`, `originGuard` a ajuns dupa router — verifica ordinea din `buildApp`.

- [ ] **Step 7: Gate + commit**

```bash
npx biome check --write backend/src/routes/apiTokens.ts backend/src/routes/openapi.ts backend/src/routes/apiTokens.test.ts backend/src/routes/apiTokensCsrf.test.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run build
npm test --workspace=backend
git add backend/src/routes/apiTokens.ts backend/src/routes/openapi.ts backend/src/routes/apiTokens.test.ts backend/src/routes/apiTokensCsrf.test.ts
git commit -m "fix(sec): PAT-urile se emit doar de admin (F12-F8)"
```

---

## Task 2: F12-F5 — cheia captcha nu mai iese in raspunsuri si loguri

**Files:**
- Modify: `backend/src/services/captchaSolver.ts` (helper nou + 2 call sites)
- Modify: `backend/src/routes/rnpm.ts:368-370`
- Test: `backend/src/services/captchaSolver.test.ts` (2 teste noi)
- Test: `backend/src/routes/rnpmStorageLimit.routes.test.ts` (1 test nou)

**Interfaces:**
- Produce: `redactCaptchaSecrets(message: string, ...secrets: Array<string | undefined>): string` exportat din
  `backend/src/services/captchaSolver.ts`. Inlocuieste fiecare aparitie a unui secret cu `***`; ignora
  secretele goale sau sub 8 caractere.

**De ce la sursa si nu la `rnpm.ts:370`:** acelasi mesaj de eroare ajunge la client prin SASE cai, nu una.
Verificate individual in cod:

| Sink | Ce trimite |
|------|-----------|
| `backend/src/routes/rnpm.ts:370` | corpul 500 pe `POST /rnpm/search` |
| `backend/src/services/rnpmSearchService.ts:561` | eveniment SSE `error: msg` pe `/rnpm/bulk` |
| `backend/src/services/rnpmSearchService.ts:873` | SSE `message: msg` + `splitStats.reason` pe `/rnpm/search-split` |
| `backend/src/services/rnpmSearchService.ts:986` | idem, calea generica de eroare din split |
| `backend/src/services/rnpmSearchService.ts:961-969` | SSE `message` + `splitStats.reason` pe calea nested tier-2 din split (gasit de Codex, LOW — ratat in prima versiune a planului) |
| `backend/src/routes/rnpm.ts:1501` | corpul 400 `CAPTCHA_BALANCE_UNAVAILABLE` pe `/rnpm/captcha/balance` |

Plus logurile: `rnpm.ts:369` si patru `console.log` din `captchaSolver.ts`. Un fix doar la `:370` ar lasa
finding-ul deschis pe doua din trei rute de cautare. Redactarea la constructia erorii le inchide pe toate
simultan, pentru ca toate stringifica acelasi `Error.message`.

**Lantul, pe scurt:** SDK-ul 2Captcha pune cheia in query string (`node_modules/@2captcha/captcha-solver/dist/structs/2captcha.js:63,172`),
`node-fetch` include URL-ul intreg in mesajul `FetchError` (`node_modules/node-fetch/lib/index.js:1501`),
filtrele din `captchaSolver.ts:80-81` prind doar coduri de aplicatie 2Captcha si nu ating erorile de transport.

**Redactare pe VALOARE, nu pe pattern.** Cheile sunt in scope in ambele functii, deci inlocuirea e exacta.
Un regex `key=([^&]+)` ar fi o presupunere despre numele parametrului folosit de provider.

**Ce NU intra in scope:** `appErrorHandler.ts:57` intoarce deja mesaj generic pe erori neclasificate — nu se
atinge. `splitStats` nu se persista in DB (`rnpm.ts:764` doar il filtreaza pentru raspuns), deci nu exista
secret at-rest de remediat. Calea CapSolver trimite cheia in corpul JSON, nu in URL, deci nu leak-uieste prin
mesaje de transport — helperul o acopera oricum, gratuit.

- [ ] **Step 1: Scrie testele care pica**

In `backend/src/services/captchaSolver.test.ts`, adauga la final:

```ts
describe("F12-F5 — cheia captcha nu ajunge in mesajele de eroare", () => {
  const KEY = "abcdef0123456789abcdef0123456789";

  it("solveRnpmCaptcha redacteaza cheia dintr-o eroare de transport a SDK-ului 2Captcha", async () => {
    vi.doMock("@2captcha/captcha-solver", () => ({
      Solver: class {
        constructor(private readonly apikey: string) {}
        recaptcha(): Promise<never> {
          // Reproduce forma reala a unui FetchError node-fetch: URL-ul complet,
          // cu cheia in query string.
          return Promise.reject(
            new Error(`request to https://2captcha.com/in.php?key=${this.apikey}&json=1 failed, reason: ECONNREFUSED`)
          );
        }
      },
    }));
    vi.resetModules();
    const { solveRnpmCaptcha } = await import("./captchaSolver.ts");

    await expect(solveRnpmCaptcha(KEY, "2captcha")).rejects.toSatisfy((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      return !msg.includes(KEY) && msg.includes("***");
    });
  });

  it("getCaptchaBalance redacteaza cheia dintr-o eroare de transport", async () => {
    vi.doMock("@2captcha/captcha-solver", () => ({
      Solver: class {
        constructor(private readonly apikey: string) {}
        balance(): Promise<never> {
          return Promise.reject(
            new Error(
              `request to https://2captcha.com/res.php?key=${this.apikey}&action=getbalance failed, reason: ENOTFOUND`
            )
          );
        }
      },
    }));
    vi.resetModules();
    const { getCaptchaBalance } = await import("./captchaSolver.ts");

    await expect(getCaptchaBalance(KEY, "2captcha")).rejects.toSatisfy((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      return !msg.includes(KEY) && msg.includes("***");
    });
  });
});
```

Adauga `beforeEach` la nivel de fisier daca nu exista, ca `vi.doMock` sa nu scurga intre teste:

```ts
afterEach(() => {
  vi.doUnmock("@2captcha/captcha-solver");
  vi.resetModules();
});
```

(fisierul are deja un `afterEach` cu `vi.unstubAllGlobals()` — adauga liniile in el, nu al doilea bloc).

- [ ] **Step 2: Ruleaza si confirma ca pica**

```
npx vitest run backend/src/services/captchaSolver.test.ts -t "F12-F5"
```

Asteptat: ambele FAIL — mesajele contin cheia in clar, nu `***`.

- [ ] **Step 3: Adauga helperul de redactare**

In `backend/src/services/captchaSolver.ts`, dupa definitia `CaptchaInsufficientFundsError` (dupa linia 41):

```ts
// F12-F5 (2026-07-26): SDK-ul 2Captcha pune cheia in query string-ul requestului
// (`in.php?key=...`, `res.php?key=...`), iar node-fetch include URL-ul intreg in
// mesajul FetchError pe orice esec de transport (DNS, ECONNREFUSED, TLS). Mesajul
// ajungea verbatim in corpul 500 al rutei, in evenimentele SSE de bulk/split si in
// stdout. In web mode cheia e a TENANTULUI, deci orice user autentificat o putea
// extrage provocand o eroare de retea. Redactam la CONSTRUCTIA erorii, nu la sink:
// exista sase sinkuri care stringifica acelasi Error.message.
// Redactare pe VALOARE (cheile sunt in scope aici), nu pe numele parametrului —
// acela ar fi o presupunere despre API-ul provider-ului.
export function redactCaptchaSecrets(message: string, ...secrets: Array<string | undefined>): string {
  let out = message;
  for (const secret of secrets) {
    const trimmed = secret?.trim();
    // Sub 8 caractere nu e o cheie reala (validateKey cere >= 10) si o
    // inlocuire pe un fragment scurt ar muti mesajul degeaba.
    if (!trimmed || trimmed.length < 8) continue;
    out = out.split(trimmed).join("***");
  }
  return out;
}
```

- [ ] **Step 4: Aplica helperul in cele doua call sites**

In `solveWith2Captcha`, linia 83 devine:

```ts
    throw new CaptchaError(`Eroare 2Captcha: ${redactCaptchaSecrets(msg, apiKey)}`, e);
```

In `balance2Captcha` (linia ~319), rethrow-ul brut se inlocuieste:

```ts
    if (/ERROR_ZERO_BALANCE/i.test(msg)) throw new CaptchaInsufficientFundsError("Balanta 2Captcha insuficienta.", e);
    // Rethrow-ul brut de aici scurgea cheia in corpul 400 al rutei /captcha/balance
    // (rnpm.ts:1501 pune e.message verbatim in envelope).
    throw new CaptchaError(`Eroare 2Captcha: ${redactCaptchaSecrets(msg, apiKey)}`, e);
```

Nu se atinge nimic altundeva in fisier: logurile din `solveRace` si `solveRnpmCaptcha` stringifica erori care
au trecut deja prin cele doua puncte de mai sus, iar calea CapSolver nu pune cheia in URL.

- [ ] **Step 5: Ruleaza si confirma ca trec**

```
npx vitest run backend/src/services/captchaSolver.test.ts
```

Asteptat: PASS pe tot fisierul, inclusiv testele preexistente de abort/race.

- [ ] **Step 6: Scrie testul de raspuns generic pe ruta (defense in depth)**

Testul merge in `backend/src/routes/rnpmStorageLimit.routes.test.ts`, NU in `rnpm.contract.test.ts`. Motivul,
verificat: `rnpm.contract.test.ts` mock-uieste doar `captchaSolver.ts` si `backup.ts`, nu si serviciul de
cautare, deci nu poate forta o eroare din `executeSearch`. `rnpmStorageLimit.routes.test.ts:20-55`
mock-uieste deja `../services/rnpmSearchService.ts` SI `./rnpmGuards.ts` si are `app.onError(appErrorHandler)`
in `buildApp` — exact ce trebuie.

Adauga un describe nou la finalul fisierului:

```ts
describe("F12-F5 — raspunsul 500 nu expune textul erorii interne", () => {
  it("o eroare din executeSearch intoarce mesaj generic cu trimitere la requestId", async () => {
    searchService.mockRejectedValueOnce(new Error("Eroare 2Captcha: request to https://2captcha.com/in.php?key=SECRET"));

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci", params: {}, captchaKey: "x".repeat(32) }),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string }; requestId: string };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("SECRET");
    expect(body.error.message).not.toContain("2captcha.com");
    expect(body.error.message).toContain("requestId");
    expect(body.requestId).toEqual(expect.any(String));
  });
});
```

`searchService` e deja definit la `:66` (`vi.mocked(executeSearch)`), iar `beforeEach`-ul de la `:80-88` il
lasa cu implementarea default care rezolva — `mockRejectedValueOnce` are efect doar pe apelul acestui test.

- [ ] **Step 7: Ruleaza, confirma ca pica, apoi fa mesajul generic**

```
npx vitest run backend/src/routes/rnpmStorageLimit.routes.test.ts -t "F12-F5"
```

Asteptat: FAIL — mesajul contine textul erorii interne.

In `backend/src/routes/rnpm.ts`, liniile 368-370 devin:

```ts
    const msg = e instanceof Error ? e.message : "Eroare necunoscuta";
    // F12-F5: detaliul ramane doar in log. Mesajul brut ajungea in corpul 500 catre
    // client — iar pe calea captcha continea cheia tenantului. Textul generic e cel
    // folosit de celelalte noua apeluri internalError din acest fisier.
    console.error("[rnpm/search]", msg);
    return internalError(c, "Eroare interna. Reincearca sau contacteaza administratorul cu requestId-ul din raspuns.");
```

- [ ] **Step 8: Ruleaza si confirma verde**

```
npx vitest run backend/src/routes/rnpmStorageLimit.routes.test.ts backend/src/routes/rnpm.contract.test.ts backend/src/routes/rnpm.envelope.test.ts
```

Asteptat: PASS. Daca vreun test preexistent astepta mesajul brut in corpul 500, actualizeaza-l — era o
asertie pe comportamentul vulnerabil.

- [ ] **Step 9: Gate + commit**

```bash
npx biome check --write backend/src/services/captchaSolver.ts backend/src/services/captchaSolver.test.ts backend/src/routes/rnpm.ts backend/src/routes/rnpmStorageLimit.routes.test.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run build
npm test --workspace=backend
git add backend/src/services/captchaSolver.ts backend/src/services/captchaSolver.test.ts backend/src/routes/rnpm.ts backend/src/routes/rnpmStorageLimit.routes.test.ts
git commit -m "fix(sec): cheia captcha redactata la sursa, raspuns 500 generic (F12-F5)"
```

---

## Task 3: F12-F3 — limita de stocare se verifica indiferent de `gcode`

**Files:**
- Modify: `backend/src/routes/rnpm.ts:242-246`
- Modify: `backend/src/services/rnpmSearchService.ts:371`
- Test: `backend/src/services/rnpmStorageRecheck.test.ts:96-119` (inversat, nu sters)
- Test: `backend/src/routes/rnpmStorageLimit.routes.test.ts:166-183` (inversat) + 1 test nou

**Interfaces:**
- Consuma: `assertRnpmStorageWithinLimit(ownerId: string): Promise<void>` din
  `backend/src/db/rnpmStorageLimit.ts:107`; arunca `RnpmStorageLimitError` cu `code = "RNPM_STORAGE_LIMIT"`,
  pe care `appErrorHandler.ts:44-54` il mapeaza la 429 `QUOTA_EXCEEDED` cu `usedBytes`/`limitBytes`.
- Produce: blocul de admitere din `/search` fara variabila `previewGcode` — Task 4 lucreaza pe acelasi bloc.

**Ce e gaura:** conditia e pur sintactica (`typeof previewGcode === "string" && previewGcode.length > 0`).
Un `gcode` arbitrar trimis pe o cautare NOUA sare peste verificare la admitere SI peste recheck-ul dintre
paginile interne. Nu e nevoie de un gcode valid.

**Confirmat prin grep, nu re-deriva:** `/bulk` (`rnpm.ts:496`) si `/search-split` (`rnpm.ts:638`) apeleaza deja
`assertRnpmStorageWithinLimit` neconditionat, iar celelalte call sites de `storageLimitCheck`
(`rnpmSearchService.ts:530, 774, 1093`) nu sunt conditionate de `gcode`. Sunt exact doua puncte de editare.

**Capcana:** `rnpmStorageRecheck.test.ts:96` codifica bug-ul ca asteptare. Se INVERSEAZA, nu se sterge —
numarul de teste ramane la baseline.

**Nota de comportament:** o cautare NOUA e deja oprita in zbor cand trece limita (recheck-ul de la `:371`
ruleaza pe `!existingGcode`). Fixul face continuarea sa se comporte identic, nu introduce o taiere noua.

- [ ] **Step 1: Inverseaza testul care codifica bug-ul**

In `backend/src/services/rnpmStorageRecheck.test.ts`, inlocuieste testul de la liniile 96-119:

```ts
  it("continuarea cu existingGcode e supusa aceluiasi recheck de limita (F12-F3)", async () => {
    const client = new PagingClient(2);
    const storageLimitCheck = vi.fn(async () => {
      throw new Error("storage full");
    });

    await expect(
      executeSearch(
        {
          type: "ipoteci",
          ownerId: "u1",
          params: {},
          captchaKey: "stub-key",
          existingGcode: "existing",
          batchSize: 2,
          fetchDetails: false,
          storageLimitCheck,
        },
        client
      )
    ).rejects.toThrow("storage full");
    // Prima pagina se descarca (gcode-ul existent o autorizeaza), a doua e blocata
    // de recheck — inainte de fix continuarea trecea cu recheck-ul complet sarit.
    expect(client.calls).toBe(1);
    expect(storageLimitCheck).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Inverseaza AL DOILEA test care codifica bug-ul**

Finding Codex (MEDIUM): mai exista un test care asserteaza scutirea, pe care versiunea initiala a acestui plan
il rata — `backend/src/routes/rnpmStorageLimit.routes.test.ts:166-183`, "paginarea cu gcode existent este
exceptata", cu `expect(storageGuard).not.toHaveBeenCalled()`. Fara inversare, gate-ul pica.

Inlocuieste-l:

```ts
  it("paginarea cu gcode existent trece prin aceeasi verificare de limita (F12-F3)", async () => {
    captchaGuard.mockResolvedValueOnce({
      ok: true,
      source: "body",
      body: { type: "ipoteci", params: {}, gcode: "existing", captchaKey: "x".repeat(32) },
      captchaKey: "x".repeat(32),
    });

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ipoteci", params: {}, gcode: "existing", captchaKey: "x".repeat(32) }),
    });

    expect(res.status).toBe(200);
    // Inainte de fix: not.toHaveBeenCalled() — continuarea era scutita de limita.
    expect(storageGuard).toHaveBeenCalledWith("u1");
    expect(captchaGuard).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 3: Scrie testul de ruta care pica**

In `backend/src/routes/rnpmStorageLimit.routes.test.ts`, adauga in `describe("limita RNPM ruleaza inainte de captcha", ...)`:

```ts
  it("F12-F3: un gcode arbitrar din body NU scuteste de limita (429, nu 200)", async () => {
    storageGuard.mockRejectedValueOnce(new RnpmStorageLimitError(600 * 1024 * 1024, 500 * 1024 * 1024));

    const res = await buildApp().request("/api/v1/rnpm/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "ipoteci",
        params: {},
        captchaKey: "x".repeat(32),
        gcode: "orice-string-nevid",
      }),
    });

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      data: null,
      error: { code: "QUOTA_EXCEEDED", message: expect.stringContaining("Sterge avize") },
    });
    expect(storageGuard).toHaveBeenCalledWith("u1");
    expect(captchaGuard).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Ruleaza si confirma ca pica toate trei**

```
npx vitest run backend/src/services/rnpmStorageRecheck.test.ts backend/src/routes/rnpmStorageLimit.routes.test.ts
```

Asteptat: testul inversat FAIL (`storageLimitCheck` nu e apelat deloc), testul de ruta FAIL cu 200 in loc de 429.

- [ ] **Step 5: Sterge scutirea din ruta**

In `backend/src/routes/rnpm.ts`, liniile 242-246 devin:

```ts
  const ownerId = getOwnerId(c);
  // F12-F3 (2026-07-26): pana acum un `gcode` nevid din body sarea peste limita de
  // stocare. Conditia era pur sintactica (string nevid), deci orice cerere putea
  // scuti orice cautare, nu doar o continuare reala. Limita se verifica acum
  // intotdeauna; un user peste plafon elibereaza spatiu inainte sa continue.
  await assertRnpmStorageWithinLimit(ownerId);
```

Variabila `previewGcode` dispare complet (biome ar semnala-o ca nefolosita).

- [ ] **Step 6: Sterge scutirea din recheck-ul de paginare**

In `backend/src/services/rnpmSearchService.ts`, linia 371 devine:

```ts
    // F12-F3: recheck-ul ruleaza si pe continuari (existingGcode). Vezi rnpm.ts.
    await input.storageLimitCheck?.(ownerId);
```

- [ ] **Step 7: Ruleaza si confirma verde**

```
npx vitest run backend/src/services/rnpmStorageRecheck.test.ts backend/src/routes/rnpmStorageLimit.routes.test.ts backend/src/routes/rnpm.contract.test.ts
```

Asteptat: PASS. Daca alt test pica pentru ca presupunea ca o continuare nu apeleaza limita, e aceeasi clasa de
asertie pe comportamentul vulnerabil — actualizeaza-l si noteaza-l in mesajul de commit.

- [ ] **Step 8: Gate + commit**

```bash
npx biome check --write backend/src/routes/rnpm.ts backend/src/services/rnpmSearchService.ts backend/src/services/rnpmStorageRecheck.test.ts backend/src/routes/rnpmStorageLimit.routes.test.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run build
npm test --workspace=backend
git add backend/src/routes/rnpm.ts backend/src/services/rnpmSearchService.ts backend/src/services/rnpmStorageRecheck.test.ts backend/src/routes/rnpmStorageLimit.routes.test.ts
git commit -m "fix(sec): limita de stocare RNPM nu mai poate fi ocolita cu gcode din body (F12-F3)"
```

---

## Task 4: CodeRabbit 1.2 — gardul de restore inainte de consumul captcha

**Files:**
- Modify: `backend/src/routes/rnpm.ts` — trei blocuri: `/search` (~:247-261 dupa Task 3), `/bulk` (~:497-506),
  `/search-split` (~:639-648)
- Test: `backend/src/routes/rnpmStorageLimit.routes.test.ts` (3 teste noi, it.each pe cele 3 rute)

**Interfaces:**
- Consuma: `isRnpmRestoreInProgress(ownerId: string): boolean` din `backend/src/db/rnpmActivity.ts:48`.
- Consuma: blocul de admitere lasat de Task 3.

**Problema:** `withRnpmCaptchaGuards` inregistreaza consumul de captcha (`recordCaptchaUsage` /
`reserveTokenCaptcha`, `rnpmGuards.ts:144-206`) INAINTE ca ruta sa verifice daca e un restore in curs. Cererea
pica apoi pe 409 fara sa fi rezolvat vreo captcha, dar userul a fost taxat pe cota.

**Ordinea corecta, identica pe toate trei rutele:**

```
resolveCaptchaKeyForRoute   (ramane primul: pastreaza 501-ul canonic in web mode)
  -> isRnpmRestoreInProgress          <- mutat aici, INAINTE de verificarea de stocare
  -> assertRnpmStorageWithinLimit
  -> withRnpmCaptchaGuards            (abia acum se consuma captcha)
  -> recordAudit("rnpm.captcha.consume")
```

**De ce INAINTE de stocare si nu doar inainte de captcha (finding Codex, HIGH).** Varianta initiala a
acestui plan punea gardul intre stocare si captcha. Ar fi fost cod mort in configuratia default:

`restoreRnpmFromBackup` seteaza SI sterge latch-ul integral in interiorul `withMaintenanceWrite`
(`backend/src/db/backup.ts:940-978`). `assertRnpmStorageWithinLimit` intra prin `measureRnpmStorage` in
`withMaintenanceRead` (`backend/src/db/rnpmStorageLimit.ts:107-111`), iar `RWLock` e writer-preference, deci
cititorul asteapta (`backend/src/util/rwlock.ts:43-58`). Cand cererea trece de lock, restore-ul s-a incheiat
si `endRnpmRestore` a rulat — gardul ar vedea `false` si ar continua spre consumul de captcha.

Lock-free si asezat primul, `isRnpmRestoreInProgress` citeste direct Set-ul in-proces, deci e observabil. In
plus, o cerere care oricum se va opri pe 409 nu mai asteapta pe reader lock.

Exceptia care confirma: `assertRnpmStorageWithinLimit` iese devreme FARA sa ia lock-ul cand limita e
dezactivata (`rnpmStorageLimit.ts:107-109`). Doar in configuratia aia ordinea veche ar fi functionat.

**Efect acceptat pe contractul desktop (finding Codex, MEDIUM).** Cu gardul inaintea lui
`withRnpmCaptchaGuards`, o cerere desktop cu restore activ SI cheie captcha lipsa/invalida primeste 409
`RESTORE_IN_PROGRESS` in loc de 400 `INVALID_CAPTCHA_KEY` (`backend/src/routes/rnpmGuards.ts:222-227`). Nu se
poate evita: acelasi apel valideaza cheia si inregistreaza consumul, deci nu poti sari peste al doilea fara
sa sari si peste primul. Se documenteaza ca efect asumat; nu exista test existent pe combinatia asta.

Gardul ramane inainte de `streamSSE` pe `/bulk` si `/search-split` — un throw dupa pornirea stream-ului ar
insemna 200 deja trimis si eroare in mijlocul stream-ului.

- [ ] **Step 1: Scrie testul care pica**

Tot in `backend/src/routes/rnpmStorageLimit.routes.test.ts` — are deja mock pe `withRnpmCaptchaGuards`, care e
exact asertiunea care conteaza. Starea de restore NU se mock-uieste: `rnpmActivity.ts` e un latch in-proces cu
setter real (`beginRnpmRestore`) si reset pentru teste (`__resetRnpmActivityForTests`).

Adauga la importuri:

```ts
import { __resetRnpmActivityForTests, beginRnpmRestore } from "../db/rnpmActivity.ts";
```

adauga `__resetRnpmActivityForTests();` in `beforeEach` (latch-ul e global pe modul, altfel scurge intre teste),
si adauga describe-ul:

```ts
describe("CR-1.2 — restore in curs nu consuma captcha", () => {
  it.each([
    ["/search", { type: "ipoteci", params: {}, captchaKey: "x".repeat(32) }],
    ["/bulk", { items: [], captchaKey: "x".repeat(32) }],
    ["/search-split", { type: "ipoteci", baseParams: {}, subTypeLabels: [], captchaKey: "x".repeat(32) }],
  ])("POST %s intoarce 409 inainte de guard-ul de captcha", async (route, body) => {
    beginRnpmRestore("u1");

    const res = await buildApp().request(`/api/v1/rnpm${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("RESTORE_IN_PROGRESS");
    // Asertiunea care conteaza: guard-ul care inregistreaza consumul de captcha
    // (recordCaptchaUsage / reserveTokenCaptcha) nu a apucat sa ruleze.
    expect(captchaGuard).not.toHaveBeenCalled();
    // Si dovada ca gardul sta INAINTE de verificarea de stocare: cu ordinea veche
    // (stocare -> restore) storageGuard ar fi rulat primul. Testul foloseste un
    // storageGuard mock-uit, deci nu poate reproduce blocarea pe reader lock —
    // asertiunea pe ORDINE e singurul semnal disponibil aici.
    expect(storageGuard).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ruleaza si confirma ca pica**

```
npx vitest run backend/src/routes/rnpmStorageLimit.routes.test.ts -t "CR-1.2"
```

Asteptat: FAIL — statusul e 409 corect, dar `withRnpmCaptchaGuards` A FOST apelat.

- [ ] **Step 3: Muta gardul in `/search`**

In `backend/src/routes/rnpm.ts`, blocul de admitere devine:

```ts
  const ownerId = getOwnerId(c);
  // CodeRabbit 1.2: gardul de restore sta INAINTE de verificarea de stocare SI de
  // withRnpmCaptchaGuards. Doua motive: (a) guard-ul de captcha inregistreaza consumul
  // (recordCaptchaUsage / reserveTokenCaptcha), deci o cerere respinsa pe 409 taxa cota
  // degeaba; (b) assertRnpmStorageWithinLimit intra in withMaintenanceRead, iar restore-ul
  // tine writer lock-ul si sterge latch-ul inainte sa-l elibereze — pus dupa stocare,
  // gardul ar vedea mereu `false`. Rezolutia de configuratie captcha ramane inaintea
  // tuturor, ca web mode sa-si pastreze 501-ul canonic.
  if (isRnpmRestoreInProgress(ownerId)) {
    return c.json(
      fail("RESTORE_IN_PROGRESS", "Restaurare in curs pentru acest cont; reincearca dupa finalizare", c),
      409
    );
  }
  // F12-F3 (2026-07-26): pana acum un `gcode` nevid din body sarea peste limita de
  // stocare. Conditia era pur sintactica (string nevid), deci orice cerere putea
  // scuti orice cautare, nu doar o continuare reala. Limita se verifica acum
  // intotdeauna; un user peste plafon elibereaza spatiu inainte sa continue.
  await assertRnpmStorageWithinLimit(ownerId);
  const guard = await withRnpmCaptchaGuards(c, parsedBody);
  if (!guard.ok) return guard.response;
  const { body, captchaKey } = guard;
  if (guard.source === "tenant") {
    recordAudit(c, "rnpm.captcha.consume", {
      targetKind: "rnpm_search",
      detail: { provider: guard.captchaProvider ?? null, mode: guard.captchaMode ?? null, route: "search" },
    });
  }
```

Comentariul vechi de la `:250-255` (care descria ordinea anterioara) se inlocuieste cu cel de mai sus. Apelul
duplicat `getOwnerId(c)` din conditie devine `ownerId`.

- [ ] **Step 4: Aceeasi mutare pe `/bulk` si `/search-split`**

In `/bulk` (in jur de `:496-506`) si `/search-split` (in jur de `:638-648`), blocul devine, identic in ambele
(schimba doar `route: "bulk"` / `route: "search-split"` in audit):

```ts
  const ownerId = getOwnerId(c);
  // CodeRabbit 1.2: vezi nota de la POST /search — gardul de restore inaintea verificarii
  // de stocare si a consumului de captcha, dar tot inainte de streamSSE.
  if (isRnpmRestoreInProgress(ownerId)) {
    return c.json(
      fail("RESTORE_IN_PROGRESS", "Restaurare in curs pentru acest cont; reincearca dupa finalizare", c),
      409
    );
  }
  await assertRnpmStorageWithinLimit(ownerId);
  const guard = await withRnpmCaptchaGuards(c, parsedBody);
  if (!guard.ok) return guard.response;
  const { body, captchaKey } = guard;
```

- [ ] **Step 5: Ruleaza si confirma verde**

```
npx vitest run backend/src/routes/rnpmStorageLimit.routes.test.ts backend/src/routes/rnpm.contract.test.ts backend/src/routes/rnpm.split-route.test.ts backend/src/routes/rnpmCaptchaQuota.test.ts
```

Asteptat: PASS. `rnpmCaptchaQuota.test.ts` e cel mai probabil sa reactioneze la reordonare — daca pica,
verifica daca astepta 429 de cota pe o cerere care acum se opreste mai devreme pe 409.

- [ ] **Step 6: Gate + commit**

```bash
npx biome check --write backend/src/routes/rnpm.ts backend/src/routes/rnpmStorageLimit.routes.test.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run build
npm test --workspace=backend
git add backend/src/routes/rnpm.ts backend/src/routes/rnpmStorageLimit.routes.test.ts
git commit -m "fix(rnpm): gardul de restore inaintea consumului de captcha (CodeRabbit 1.2)"
```

---

## Task 5: Inchidere — documentatie si gate complet

**Files:**
- Modify: `HARDENING.md` (sectiunea Faza 12)

**Nu se face bump de versiune.** Nu e release; checklist-ul din CLAUDE.md se aplica la `vX.Y.Z`, nu la
commituri de fix pe branch.

- [ ] **Step 1: Marcheaza cele 3 findings rezolvate in HARDENING.md**

In sectiunea Faza 12, la fiecare din F12-F3, F12-F5, F12-F8, adauga statusul rezolvat cu hash-ul commitului
corespunzator. Pastreaza formatul existent al sectiunii — nu-l rescrie. Celelalte 9 findings raman deschise,
neatinse.

- [ ] **Step 2: Gate complet, tot repo-ul**

```bash
npx biome check .
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
npm run build
npm test --workspace=backend
cd frontend && npm test -- --run && cd ..
```

Asteptat: **2087 teste backend trecute / 8 skipped** (2078 baseline + 9 noi: 2 in Task 1, 3 in Task 2, 1 in
Task 3, 3 in Task 4 — cele DOUA teste inversate din Task 3 si fixul de OpenAPI din Task 1 nu schimba
numarul), **395 teste frontend** neatinse.
Singura eroare acceptabila la biome e falsul pozitiv CRLF din `CLAUDE-SECURITY-20260724-195947/`.

- [ ] **Step 3: Commit documentatie**

```bash
npx biome check --write HARDENING.md
git add HARDENING.md
git commit -m "docs: marcheaza F12-F3, F12-F5, F12-F8 rezolvate in Faza 12"
```

- [ ] **Step 4: Verificare inainte de orice push — OPRESTE-TE si intreaba userul**

```bash
git log --oneline origin/feat/v2.43.0-rnpm-split..HEAD
```

Daca in lista apare commitul de documentatie de securitate (raportul de audit, Faza 12, handoff-urile F12,
triajul CodeRabbit) sau acest fisier de plan, **nu face push fara autorizare explicita**. Publica pe GitLab
inventarul complet al problemelor, cu file:line. Userul nu a decis inca daca urca.

Push-ul, cand e autorizat, merge pe `feat/v2.43.0-rnpm-split`. NICIODATA pe `main`.

---

## Confirmare live (dupa gate, inainte de a considera taskul inchis)

Pentru F12-F5 si F12-F3 confirmarea utila e pe **web mode**, nu pe desktop — ambele isi schimba comportamentul
in functie de `getAuthMode()` si de sursa cheii captcha (tenant vs body). Foloseste scripturile din repo, nu
comenzi inline cu tokenuri.

F12-F8 se confirma pe web mode cu o sesiune de user non-admin: `POST /api/v1/tokens` trebuie sa dea 403.

Daca totusi pornesti Electron: `npm run rebuild:electron` e OBLIGATORIU inainte de `npm run electron:dev` —
ABI-ul `better-sqlite3` e compilat acum pentru Node, dupa ultima rulare de teste.

## Review adversarial Codex (2026-07-26) — integrat

Planul a trecut printr-un review adversarial read-only rulat cu GPT-5.6 SOL. Sase findinguri, toate
re-verificate la sursa si integrate mai sus; niciunul fals pozitiv, niciunul CRITICAL.

| # | Finding | Severitate | Unde s-a integrat |
|---|---------|-----------|-------------------|
| 1 | Gardul de restore pus dupa verificarea de stocare ar fi fost cod mort (reader lock asteapta writer-ul de restore) | HIGH | Task 4, ordinea si cele doua blocuri de cod |
| 2 | `rnpmStorageLimit.routes.test.ts:166-183` codifica si el scutirea pe `gcode` — ar fi picat gate-ul | MEDIUM | Task 3, Step 2 nou |
| 3 | Desktop: restore activ + cheie invalida da 409 in loc de 400 | MEDIUM | Task 4, nota de efect asumat |
| 4 | OpenAPI descrie rutele de tokenuri ca session-only dupa ce devin admin-only | MEDIUM | Task 1, Step 5 nou |
| 5 | Al saselea sink pentru F12-F5 (nested tier-2 din split) lipsea din analiza | LOW | Task 2, tabelul de sinkuri |
| 6 | Linie duplicat in inventarul Task 4 | LOW | sters |

Codex nu a putut rula vitest (sandbox read-only), deci verdictele sunt statice. Primul test real e executia.

## Definition of done

- [ ] F12-F8: `requireRole("admin")` pe `/api/v1/tokens*`, test 403 pe sesiune non-admin, test de ordine care
      apara codul `PAT_CANNOT_MANAGE_TOKENS`, nota OpenAPI aliniata la admin-only
- [ ] F12-F5: cheia redactata la sursa (`solveWith2Captcha` + `balance2Captcha`), raspuns 500 generic pe
      `/rnpm/search`, teste care dovedesc ca cheia nu apare in mesajul erorii pe niciuna din cele doua cai
- [ ] F12-F3: limita verificata indiferent de `gcode`, in ambele puncte; AMBELE teste care codificau scutirea
      inversate (`rnpmStorageRecheck.test.ts:96`, `rnpmStorageLimit.routes.test.ts:166`); test de ruta care
      dovedeste 429 cu `gcode` arbitrar
- [ ] CR-1.2: gardul de restore inaintea verificarii de stocare SI a consumului de captcha, pe toate trei
      rutele; test care dovedeste ca nici storage guard nici captcha guard nu ruleaza
- [ ] Gate complet verde: 2087 backend / 8 skipped, 395 frontend
- [ ] HARDENING.md actualizat pentru cele 3
- [ ] Patru commituri de cod separate + unul de docs, pe `feat/v2.43.0-rnpm-split`, nepushuite pana la
      autorizarea userului
