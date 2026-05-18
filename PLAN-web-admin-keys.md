# PLAN — Web admin: chei AI + captcha centralizate + buget per user

Scop: in modul `AUTH_MODE=web`, adminul tenantului configureaza din UI **toate** cheile (AI + captcha) si seteaza buget zilnic per user. Userii non-admin NU mai vad modalul API keys, NU mai trimit `apiKeys`/`captchaKey` in body, doar consuma pe limita seta de admin. Desktop ramane BYOK identic.

Target version: **v2.30.0**
Branch: `feat/web-admin-keys-budget`
Status decizii: inchise (vezi §0)

---

## §0. Decizii inchise

1. **Opt A** — chei stocate in DB ca ciphertext (tabel `tenant_api_keys`), admin UI le seteaza. NU env-only.
2. **Single-tenant-per-deploy** — PK singleton (`scope = 'tenant'`). NU introducem coloana `tenant_id`; codebase-ul nu are multi-tenant nicaieri si nu o pregatim acum.
3. **Master key in env** — `TENANT_KEY_ENCRYPTION_SECRET` (32 bytes base64). In `AUTH_MODE=web` lipsa = boot fail fast cu mesaj clar. In desktop nu se foloseste (cheile raman pe safeStorage IPC).
4. **Encryption** — AES-256-GCM via `node:crypto`, ciphertext + iv + tag stocate pe coloane separate. Fara dependinte noi npm.
5. **Quota enforcement intra in acelasi PR** — fara enforcement, promisiunea "buget per user" e goala. CRUD-ul deja exista din PR-8.
6. **Captcha server-side in web mode** — provider/mode/cheie din tenant DB; `rnpm.ts` rezolva captcha local in proces, NU mai accepta `captchaKey` in body. `rejectCaptchaKeyInWebMode` devine `useTenantCaptchaKeyInWebMode`.
7. **Fallback chain `getApiKey`** noua: `env > tenant DB > BYOK keys-din-body` (env castiga peste tenant doar daca operatorul a fortat manual; in practica env-ul NU se mai seteaza in web).
8. **Frontend cod minim** — 1 pagina noua `/admin/keys`, 1 hide pe `ApiKeyDialog`, 1 component mic `BudgetIndicator`, 1 hook `useTenantKeys`. Fara redesign global.
9. **Master-key recovery procedure** — `TENANT_KEY_ENCRYPTION_SECRET` se stocheaza separat de DB backups (alt secrets manager / alt canal). Daca operatorul pierde secretul, TOATE ciphertext-urile sunt unrecoverable; singura cale de recuperare este ca adminul sa re-introduca cele 6 chei din UI (`/admin/keys`). Rotation (re-encrypt rows sub un master key nou) NU intra in v2.30.0 — se documenteaza ca procedura manuala one-shot script daca apare nevoia.
10. **Tenant-aggregate cap deferred** — `user_quota_overrides` limiteaza per-user-per-feature. Cap-ul global pe tenant (suma tuturor userilor / zi) NU se implementeaza in v2.30.0. Risc acceptat: admin care seteaza 100 useri × $5/zi = exposure $500/zi. Mitigation operationala: `/admin/quota` arata totalul si admin monitorizeaza manual. Daca devine problema, se adauga `tenant_daily_budget_usd_milli` pe `tenant_api_keys` intr-un PR ulterior.

---

## §1. Migration `0026_tenant_api_keys`

`backend/src/db/migrations/0026_tenant_api_keys.up.sql`

```sql
CREATE TABLE tenant_api_keys (
  scope                    TEXT NOT NULL PRIMARY KEY DEFAULT 'tenant'
                             CHECK(scope = 'tenant'),
  anthropic_cipher         TEXT,
  anthropic_iv             TEXT,
  anthropic_tag            TEXT,
  openai_cipher            TEXT,
  openai_iv                TEXT,
  openai_tag               TEXT,
  google_cipher            TEXT,
  google_iv                TEXT,
  google_tag               TEXT,
  openrouter_cipher        TEXT,
  openrouter_iv            TEXT,
  openrouter_tag           TEXT,
  twocaptcha_cipher        TEXT,
  twocaptcha_iv            TEXT,
  twocaptcha_tag           TEXT,
  capsolver_cipher         TEXT,
  capsolver_iv             TEXT,
  capsolver_tag            TEXT,
  captcha_provider         TEXT NOT NULL DEFAULT '2captcha'
                             CHECK(captcha_provider IN ('2captcha','capsolver')),
  captcha_mode             TEXT NOT NULL DEFAULT 'sequential'
                             CHECK(captcha_mode IN ('sequential','race')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by               TEXT
);

INSERT OR IGNORE INTO tenant_api_keys (scope) VALUES ('tenant');
```

`0026_tenant_api_keys.down.sql`: `DROP TABLE tenant_api_keys;`

Auto-backup ruleaza prin hook-ul `schema-upgrade` existent.

---

## §2. Crypto helper `tenantKeyCrypto.ts`

`backend/src/util/tenantKeyCrypto.ts` — pure, fara IO:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

let masterKeyCache: Buffer | null = null;

export function getMasterKey(): Buffer {
  if (masterKeyCache) return masterKeyCache;
  const raw = process.env.TENANT_KEY_ENCRYPTION_SECRET;
  if (!raw) throw new Error("TENANT_KEY_ENCRYPTION_SECRET missing");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("TENANT_KEY_ENCRYPTION_SECRET must decode to 32 bytes");
  masterKeyCache = buf;
  return buf;
}

export function encryptKey(plaintext: string): { cipher: string; iv: string; tag: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    cipher: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptKey(parts: { cipher: string; iv: string; tag: string }): string {
  const decipher = createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(parts.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parts.tag, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(parts.cipher, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}

export function resetMasterKeyCacheForTests(): void {
  masterKeyCache = null;
}
```

Boot guard in `backend/src/index.ts`: in `getAuthMode() === "web"`, apeleaza `getMasterKey()` o data la pornire **STRICT dupa** `await runMigrations()`, ca sa fail-fast daca env-ul lipseste.

**Important**: `getMasterKey()` NU se executa ca side-effect al unui import (top-level module). Cache-ul (`masterKeyCache`) e populat lazy la primul apel, deci atata timp cat boot-ul apeleaza explicit functia in ordinea corecta (`runMigrations()` → `if (web) getMasterKey()` → start server), nu exista risc de validation inainte de migrate.

---

## §3. Repository `tenantKeysRepository.ts`

`backend/src/db/tenantKeysRepository.ts`:

- `getTenantKeys(): TenantKeys` — citeste row-ul singleton, decripteaza toate non-null fields, returneaza `{ anthropic, openai, google, openrouter, twocaptcha, capsolver, captchaProvider, captchaMode, updatedAt, updatedBy }`. Cheile lipsa = `""`.
- `setTenantKey(field: TenantKeyField, value: string, updatedBy: string): void` — `value === ""` curata coloanele (`UPDATE ... SET cipher=NULL, iv=NULL, tag=NULL`); altfel encrypt + upsert.
- `setCaptchaSettings({ provider, mode, updatedBy }): void`.
- `getDecryptedKey(field: TenantKeyField): string` — helper pentru `getApiKey()` (lazy, fara payload mare).

Cache in-process: `let cached: TenantKeys | null = null;` + `invalidateCache()` apelat dupa fiecare scriere. Read path AI il foloseste pentru a evita query+decrypt pe fiecare call.

**Atomicity la scriere**: `setTenantKey()` emite UN SINGUR `UPDATE` care seteaza simultan `cipher`, `iv`, `tag` (sau le seteaza pe toate trei la `NULL` la clear). Niciodata 3 statements separate — un `encryptKey()` care esueaza dupa un partial write ar lasa row-ul corupt (ex. cipher fara iv).

**Test isolation**: `invalidateCache()` se exporta din modul si se apeleaza in `beforeEach` pe orice vitest suite care scrie in `tenant_api_keys`. Acelasi pattern ca `resetMasterKeyCacheForTests()` din §2. Risc evitat: test A seteaza cheie, test B citeste stale cache si nu detecteaza bug.

---

## §4. Routes — extensie `routes/admin.ts`

Adauga sub `requireRole("admin")`:

- `GET /api/v1/admin/keys` — returneaza `{ keys: { anthropic: { set: bool, last4: "...abcd" }, ... }, captcha: { provider, mode }, updatedAt, updatedBy }`. NU returneaza ciphertext sau plaintext. `last4` doar pentru afisare.
- `PUT /api/v1/admin/keys/:field` (`field` ∈ `anthropic|openai|google|openrouter|twocaptcha|capsolver`) cu body `{ value: string }` (`""` = clear). 4 KiB body limit.
- `PUT /api/v1/admin/keys/captcha` cu body `{ provider, mode }`.

Audit obligatoriu pe scrieri (`admin.tenantKeys.update`, `admin.tenantKeys.captchaSettings.update`) cu `targetKind=tenant_keys`, `targetId=field`, detail `{ field, hadPrevious: bool, last4After }`. NU loga plaintext.

**Test-on-save (validation pre-persist)**: inainte de `setTenantKey`, ruleaza un ping cheap pe provider ca sa rejectezi early o cheie invalida:

- `anthropic`: `GET https://api.anthropic.com/v1/models` cu header `x-api-key` (sau orice endpoint care valideaza key fara cost token)
- `openai`: `GET https://api.openai.com/v1/models`
- `google`: `GET https://generativelanguage.googleapis.com/v1beta/models?key=<KEY>`
- `openrouter`: `GET https://openrouter.ai/api/v1/auth/key` (sau `/v1/models`)
- `twocaptcha`: `GET https://2captcha.com/res.php?key=<KEY>&action=getbalance`
- `capsolver`: `POST https://api.capsolver.com/getBalance` cu `{ clientKey }`

Timeout 5s, network errors -> accept save cu warning audit (`detail.validationSkipped=true`). 4xx/auth errors -> 422 raspuns `{ error: { code: "INVALID_KEY", message } }`, NU persistate.

Helper nou `backend/src/services/keyValidation.ts` — sigle entry `validateKey(field, value): Promise<{ valid: bool; reason?: string }>`.

Endpoint pentru non-admin (web mode, citire publica a status-ului): `GET /api/v1/me/key-status` in `routes/me.ts`:

```json
{
  "authMode": "web",
  "tenantKeysConfigured": {
    "anthropic": true, "openai": false, "google": true,
    "openrouter": false, "captcha": true
  }
}
```

Frontend foloseste asta ca sa decida daca afiseaza dialog-ul BYOK pe desktop sau "ask admin" message in web.

---

## §5. `getApiKey()` fallback chain

`backend/src/services/ai.ts` — schimba:

```ts
export function getApiKey(provider: string, keys: Record<string, string>): string {
  // Desktop BYOK: cheile din body (keys) au prioritate fata de tenant DB,
  // pentru ca in desktop tabelul tenant_api_keys nu e populat niciodata.
  // Web mode: keys este {} (apiKeys din body sunt deja blocate de 501),
  // deci flow-ul efectiv e: env > tenant DB.
  const envKey = readEnvKey(provider);
  if (envKey) return envKey;
  if (getAuthMode() === "web") {
    return getDecryptedKey(providerToField(provider)) || "";
  }
  return keys[provider] || "";
}
```

`readEnvKey()` extrage map-ul existent (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_KEY`, `OPENROUTER_API_KEY`). Modificare similara pe `shouldRouteViaOpenRouter` ca sa considere tenant DB ca "openrouter available" in web mode.

**Nota citire**: in web mode, leg-ul BYOK (`keys[provider]`) e unreachable pentru ca `rejectApiKeysFromBodyInWebMode` din `routes/ai.ts` returneaza 501 inainte ca `getApiKey()` sa fie apelat. Chain efectiv in web devine `env > tenant DB`. Pastram leg-ul BYOK in cod pentru claritate desktop si pentru defense-in-depth daca cineva sterge guard-ul de 501.

**CRITIC — `rejectApiKeysFromBodyInWebMode` RAMANE ACTIV.** Acest middleware NU se inlocuieste cu noul fallback chain — el continua sa returneze 501 in web mode cand body-ul contine `apiKeys`. Daca cineva il sterge crezand ca noul `getApiKey()` il face redundant, body-ul devine cale de exfiltrare (user trimite cheie proprie si o foloseste pe contul tenantului). Test-ul `web-mode-rejects-body-keys.test.ts` ramane si verifica explicit 501 pe POST `/ai/analyze` cu `apiKeys` in body.

`missingApiKey(c, provider)` in `routes/ai.ts` schimba mesajul cand `authMode === "web"`:

> "Cheia AI nu e configurata. Contacteaza adminul pentru a o seta in /admin/keys."

In loc de "configurati in env-ul serverului".

---

## §6. Quota guard middleware

`backend/src/middleware/quotaGuard.ts`:

```ts
export function quotaGuard(feature: "ai.single" | "ai.multi") {
  return async (c: Context, next: Next) => {
    if (getAuthMode() !== "web") return next();
    const ownerId = getOwnerId(c);
    const override = getOverride(ownerId, feature);
    if (!override) return next(); // fara override = unlimited (statu-quo)
    const usedToday = sumAiUsageMilliToday(ownerId, feature);
    if (usedToday >= override.daily_limit_usd_milli) {
      return c.json(
        fail(
          ErrorCodes.QUOTA_EXCEEDED,
          `Bugetul zilnic pentru ${feature} a fost depasit. Contacteaza adminul.`,
          c,
          { usedMilli: usedToday, limitMilli: override.daily_limit_usd_milli, feature }
        ),
        429
      );
    }
    return next();
  };
}
```

`sumAiUsageMilliToday(ownerId, feature)` in `aiUsageRepository.ts`:
```sql
SELECT COALESCE(SUM(cost_usd_milli), 0) FROM ai_usage
WHERE owner_id = ? AND feature = ? AND date(ts) = date('now');
```

Aplica in `routes/ai.ts`:
- `aiRouter.post("/analyze", quotaGuard("ai.single"), ...)`
- `aiRouter.post("/analyze-multi", quotaGuard("ai.multi"), ...)`
- (orice alt endpoint care apeleaza `callModel`)

Nu se aplica pe desktop pentru ca CRUD-ul nu e expus si `requireRole("admin")` nu poate fi setat efectiv.

Cod nou de eroare: `QUOTA_EXCEEDED = "quota_exceeded"` in `util/envelope.ts`. Status 429 cu `Retry-After: <seconds till midnight>` header pentru clarity.

---

## §7. Captcha server-side flow in web mode

`backend/src/routes/rnpmGuards.ts` — schimba `rejectCaptchaKeyInWebMode`:

```ts
// Returneaza null pe desktop (caller foloseste flow-ul existent din body).
// In web: returneaza descriminated union ok|fail.
export type CaptchaResolution =
  | { source: "body" } // desktop sentinel
  | { source: "tenant"; ok: true; captchaKey: string; provider: CaptchaProvider; mode: CaptchaMode }
  | { source: "tenant"; ok: false; response: Response };

export function resolveCaptchaKeyForRoute(c: Context): CaptchaResolution {
  if (getAuthMode() !== "web") return { source: "body" };
  const tenant = getTenantKeys();
  const provider = tenant.captchaProvider;
  const key = provider === "capsolver" ? tenant.capsolver : tenant.twocaptcha;
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
  return { source: "tenant", ok: true, captchaKey: key, provider, mode: tenant.captchaMode };
}
```

Caller pattern (`POST /rnpm/search`):
```ts
const resolved = resolveCaptchaKeyForRoute(c);
if (resolved.source === "tenant" && !resolved.ok) return resolved.response;
const captchaKey = resolved.source === "tenant" ? resolved.captchaKey : body.captchaKey;
const provider   = resolved.source === "tenant" ? resolved.provider   : body.captchaProvider;
const mode       = resolved.source === "tenant" ? resolved.mode       : body.captchaMode;
```

Body validator accepta in continuare `captchaKey` opt, dar in web mode il dropuieste cu logging.

**CRITIC — `captchaService.ts` integration check.** `resolveCaptchaService(provider, mode, key)` din `backend/src/services/captchaService.ts` (sau echivalent) trebuie sa accepte triplet-ul EXTERN ca parametru, NU sa-l reciteasca din `process.env` sau din body. Daca service-ul are propria logica de citire interna, sustreaba silentios cheia din tenant DB si foloseste alta sursa — captcha pare ca functioneaza dar pe cheia gresita. Inainte de implementare, verifica:
- `captchaService.ts` accepta `{ provider, mode, key }` ca argument explicit din caller
- NU citeste `process.env.TWOCAPTCHA_API_KEY` sau echivalent inside
- NU are fallback la body daca triplet-ul vine din tenant
Daca verificarea pica, primul commit din §10 devine "refactor captchaService.ts pentru triplet extern" inainte de migration.

---

## §8. Frontend (cod minim)

### 8.1 Hook nou `frontend/src/hooks/useAuthMode.ts`

```ts
export type AuthMode = "desktop" | "web";

export function useAuthMode(): AuthMode {
  // citit din /api/v1/me/key-status la prima incarcare, cache pe Zustand sau context
  // (alternativ: window.desktopApi prezent => "desktop")
}
```

Decizie simpla: `window.desktopApi !== undefined` (preload prezent) ⇒ desktop. Web ⇒ `undefined`.

### 8.2 `ApiKeyDialog` — hide pe non-admin web

`frontend/src/components/ApiKeyDialog.tsx`:

```tsx
const authMode = useAuthMode();
const role = useCurrentUserRole(); // existing
if (authMode === "web" && role !== "admin") return null;
```

### 8.3 Pagina noua `frontend/src/pages/admin/Keys.tsx`

Reuse layout-ul din `admin/Users.tsx` / `admin/Quota.tsx`. Form fields:

- Anthropic (input password, mask, "Sterge" btn)
- OpenAI
- Google
- OpenRouter
- 2Captcha
- CapSolver
- Captcha provider (radio: 2captcha / capsolver)
- Captcha mode (radio: sequential / race)

Display: status `set` + last4 + updatedAt + updatedBy.
Submit: `PUT /api/v1/admin/keys/:field` per camp pe blur (sau buton "Salveaza"). `value === ""` = clear.

Routing in `App.tsx`: `<Route path="/admin/keys" element={<AdminKeys />} />` (sub gateway-ul existent care arata `/admin/*` doar adminilor).

### 8.4 `BudgetIndicator` (web, non-admin)

`frontend/src/components/BudgetIndicator.tsx` — mic component care arata `usedToday / limit` pentru feature-ul curent (AI). Polling la 30s sau la fiecare submit AI. Endpoint nou minimal:

`GET /api/v1/me/budget` returneaza `{ items: [{ feature, usedMilli, limitMilli|null }] }` agregat din `ai_usage` + `user_quota_overrides`.

Plasare: footer la `Dosare.tsx` cand `authMode === "web"`. ~30 LOC.

---

## §9. Tests

**Backend (vitest):**

- `tenantKeyCrypto.test.ts` — round-trip encrypt/decrypt, missing master key throws, wrong-length key throws.
- `tenantKeysRepository.test.ts` — upsert, clear (set to `""`), getDecryptedKey cache invalidation.
- `routes/admin.keys.test.ts` — GET returneaza shape-ul fara plaintext; PUT loggeaza audit fara plaintext; non-admin 403.
- `routes/me.test.ts` — `/me/key-status` shape; `/me/budget` matematica.
- `quotaGuard.test.ts` — sub limit pass, peste limita 429, fara override pass; in desktop mode skip.
- `ai.contract.test.ts` — adauga case 429 cand peste buget; case "missing key" web mode mesaj nou.
- `services/captcha-web-flow.test.ts` — in web mode `captchaKey` din body e ignorat, tenant key e folosita; lipsa tenant key = 501.
- `routes/rnpm.contract.test.ts` — adapteaza pentru noul flow.

**Frontend (vitest):**
- `ApiKeyDialog.test.tsx` — hide pe non-admin web; show pe admin web; show pe desktop.
- `admin/Keys.test.tsx` (nou) — form submit per camp, masking, last4 display.
- `BudgetIndicator.test.tsx` (nou) — afiseaza used/limit, ascuns daca limit=null.

---

## §10. Ordine de implementare (commits secventiale)

1. **`feat(db): migration 0026 tenant_api_keys + crypto helper`** — migration up/down + `tenantKeyCrypto.ts` + test crypto + boot fail-fast.
2. **`feat(db): tenantKeysRepository`** — repo + tests, fara routes inca.
3. **`feat(api): admin /keys + me/key-status`** — routes admin extinse + endpoint `/me/key-status`, audit, tests.
4. **`feat(ai): getApiKey fallback chain + tenant DB`** — modificare `services/ai.ts` + `missingApiKey` mesaj, tests.
5. **`feat(ai): quotaGuard middleware + enforcement`** — middleware + `sumAiUsageMilliToday` + cod 429 + `/me/budget`, tests.
6. **`feat(rnpm): server-side captcha in web mode`** — `resolveCaptchaKeyForRoute` + adaptare `rnpm.ts` + tests.
7. **`feat(ui): admin keys page + hide dialog non-admin web + budget indicator`** — frontend bundle, tests vitest frontend.
8. **`docs(v2.30.0): plan livrat, changelog + bump`** — `CHANGELOG.md`, `frontend/src/data/changelog-entries.tsx`, README, STATUS, DOCUMENTATIE, SESSION-HANDOFF, package.json x3 + lockfile.

Fiecare commit = `npx biome check --write` + `tsc --noEmit` + tests in scope inainte de push.

---

## §11. Definition of Done

- [ ] Migration 0026 up/down rulat local + restore din backup verificat.
- [ ] `TENANT_KEY_ENCRYPTION_SECRET` missing in web mode = boot fail cu mesaj clar.
- [ ] `GET /api/v1/admin/keys` NU returneaza plaintext sau ciphertext (verificat manual).
- [ ] `PUT /api/v1/admin/keys/:field` loggeaza audit fara plaintext (verificat in `audit_log`).
- [ ] AI call in web mode fara cheie configurata returneaza 400 cu mesaj "contacteaza adminul".
- [ ] AI call peste buget returneaza 429 + `Retry-After`.
- [ ] Captcha in web mode functioneaza fara `captchaKey` in body.
- [ ] Modal API keys ascuns pe web non-admin.
- [ ] Admin web vede `/admin/keys` si poate seta toate cele 6 chei + provider + mode.
- [ ] BudgetIndicator afiseaza corect pe web non-admin.
- [ ] Desktop comportament identic cu inainte (`tenant_api_keys` ramane gol, env optional).
- [ ] 100% teste pass (`npm test --workspace=backend` + frontend).
- [ ] biome + tsc + build curat.
- [ ] CHANGELOG + in-app changelog + bump versiune.

---

## §12. Riscuri & mitigatii

| Risc | Mitigatie |
|------|-----------|
| Master key pierdut = toate cheile irecuperabile | Document explicit in `.env.example` + recomanda backup separat al env-ului. Adminul re-introduce cheile odata. |
| Race condition pe quotaGuard (2 requests simultan, ambele sub limita, suma peste limita) | Acceptat: SUM e best-effort, overshoot maxim = 1 call. Pentru hard cap am avea nevoie de tranzactie pe insert ai_usage + check, nu merita complexitatea acum. |
| Cache invalidation in proces, multi-instance | Statu-quo: deploy = single-instance per docker container; daca scalam orizontal in viitor, mutam cache-ul in Redis. Nu acum. |
| Captcha tenant key folosit de admin pentru abuse | Audit log + rate limit existent pe `/rnpm/search` raman, plus per-user quota_overrides poate fi extins ulterior pentru `rnpm.search` daca devine problema. |

---

## §13. Out of scope (NU se face in acest PR)

- Multi-tenant (`tenant_id` peste tot)
- Cache distribuit (Redis)
- Quota enforcement pe RNPM/captcha (doar AI)
- Migrare automata din env vars catre DB (operatorul muta manual)
- Rotirea programata a master key-ului
- UI pentru auditul cheilor (deja vizibil in `/admin/audit` generic)

---

Branch tinta: `feat/web-admin-keys-budget`
Target merge: v2.30.0
Estimat Codex: ~6-8 commits, ~1200-1600 LOC backend, ~400-500 LOC frontend, ~600-800 LOC tests.
