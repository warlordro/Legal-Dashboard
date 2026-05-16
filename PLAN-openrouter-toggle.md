# PLAN — OpenRouter Toggle cu 2 stack-uri (Vestic / Chinezesc)

**Branch:** `feat/openrouter-toggle-stacks` (NU main)
**Owner:** Codex executa cod; user aproba + merge la final
**Sursa:** consolidarea a 5 rapoarte agenti (Explore, refactor-planner, database-change-reviewer, test-architect, release-readiness-reviewer) pe baza `[[openrouter-migration-exploration]]` din 2026-05-16
**Constrangeri ferme:**
- UI identic ca acum la nivel de layout (3 sloturi vizibile in `ApiKeyDialog`, multi-agent 3-panel)
- Toggle in admin panel = simplu, fara bloat, rapid (max 2 nivele: mode + stack)
- Backend in workspace `backend/`, SQL raw doar in `backend/src/db/**`, `owner_id` pe orice rand nou
- Zero schimbare in contractul HTTP (`POST /analyze`, `POST /analyze-multi`)
- Frontend ramane bit-identic ca structura componenti; doar setul de modele afisat se filtreaza in functie de stack

---

## 1. Decizii arhitecturale inchise

### 1.1. Doua nivele de comutare

```
Mode (top-level)        Stack (sub-toggle, vizibil doar daca Mode = openrouter)
────────────────        ──────────────────────────────────────────────────────
[ Native ]      ←→      (n/a — folosesti cheile native)
[ OpenRouter ]  ←→      [ Vestic ] / [ Chinezesc ]
```

- **Mode = native** (default, backward-compat): foloseste `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_AI_KEY` exact ca azi. Sloturile `ApiKeyDialog` raman 3 (Anthropic / OpenAI / Google).
- **Mode = openrouter**:
  - **Stack = vestic** → mirror exact al modelelor native (claude-sonnet-4.6, gpt-5.4, gemini-3.1-pro-preview etc.), rutat prin `https://openrouter.ai/api/v1`. `ApiKeyDialog` afiseaza **un singur slot vizibil** „OpenRouter API Key" (sk-or-v1-…) — celelalte sloturi native dispar complet (collapse, fara grayed-out).
  - **Stack = chinezesc** → 3 modele premium din 3 providers: GLM 5.1 / Kimi K2.6 / Qwen 3.6 Max. Layout-ul UI in pagina de analiza ramane in 3 panel-uri (analist 1, analist 2, judecator), dar setul de modele afisat in selector se filtreaza la cele 3. Cheia ramane aceeasi un singur slot OpenRouter.
- **Stack mixing interzis** in multi-agent: cand mode=openrouter, analist1+analist2+judge trebuie sa apartina aceluiasi stack. Eroare 400 `STACK_MIX_FORBIDDEN` daca clientul incearca mix.

### 1.2. Stack lock in multi-agent

Cand `Mode = openrouter`, route-ul `POST /analyze-multi` valideaza ca analist1, analist2 si judecator apartin **aceluiasi stack** (vestic sau chinezesc — fara mix). Eroare 400 cu `error.code = "STACK_MIX_FORBIDDEN"` daca clientul incearca mix.

### 1.3. Stocare configuratie

Tabela noua `owner_ai_settings` (migration `0023`), per owner:
- `mode TEXT NOT NULL DEFAULT 'native' CHECK(mode IN ('native','openrouter'))`
- `openrouter_stack TEXT NOT NULL DEFAULT 'western' CHECK(openrouter_stack IN ('western','chinese'))`
- `updated_at INTEGER NOT NULL`

Frontend citeste/scrie via `GET /api/v1/ai/settings` + `PUT /api/v1/ai/settings` (rute noi in `backend/src/routes/ai.ts`). Cheile API raman in `localStorage` (encrypted via `safeStorage`) — neschimbat.

### 1.4. Web-mode storage (BLOCKER #3 rezolvat)

- **Desktop mode**: cheile (Anthropic / OpenAI / Google / OpenRouter) sunt encrypted via `safeStorage` si trimise in body — neschimbat fata de azi.
- **Web mode (`AUTH_MODE=web`)**: `rejectApiKeysFromBodyInWebMode` ramane in vigoare. Singura cale de a folosi AI in web e env-only: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_KEY`, **sau** `OPENROUTER_API_KEY`. Daca env exista, ruteaza prin OpenRouter (override implicit). Daca nu, AI-ul intoarce 501 cu mesaj clar.

---

## 2. Migrations (Stage 1)

### 2.1. `backend/src/db/migrations/0023_owner_ai_settings.up.sql`

```sql
CREATE TABLE owner_ai_settings (
  owner_id          TEXT NOT NULL PRIMARY KEY,
  mode              TEXT NOT NULL DEFAULT 'native'
                      CHECK(mode IN ('native','openrouter')),
  openrouter_stack  TEXT NOT NULL DEFAULT 'western'
                      CHECK(openrouter_stack IN ('western','chinese')),
  updated_at        INTEGER NOT NULL
);
```

### 2.2. `backend/src/db/migrations/0023_owner_ai_settings.down.sql`

```sql
DROP TABLE IF EXISTS owner_ai_settings;
```

### 2.3. `backend/src/db/migrations/0024_ai_usage_openrouter.up.sql`

WARNING header — CHECK constraint widening necesita REBUILD tabela in SQLite (nu putem ALTER pe CHECK existent). Pre-migration backup `schema-upgrade` auto-trigger-uieste prin convention.

```sql
-- 0024 — widen ai_usage.provider CHECK to include 'openrouter'.
-- Rebuild because SQLite cannot ALTER CHECK constraint in place.
-- Pre-migration backup auto-runs via schema-upgrade hook.

CREATE TABLE ai_usage_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id           TEXT NOT NULL DEFAULT 'local',
  created_at         INTEGER NOT NULL,
  provider           TEXT NOT NULL
                       CHECK(provider IN ('anthropic','openai','google','openrouter')),
  model_id           TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cost_usd_milli     INTEGER NOT NULL DEFAULT 0,
  request_id         TEXT,
  status             TEXT NOT NULL DEFAULT 'ok'
                       CHECK(status IN ('ok','error','timeout','aborted')),
  routing_tag        TEXT  -- 'native' | 'openrouter:western' | 'openrouter:chinese'
);

INSERT INTO ai_usage_new (id, owner_id, created_at, provider, model_id,
                           input_tokens, output_tokens, cost_usd_milli, request_id, status)
SELECT id, owner_id, created_at, provider, model_id,
       input_tokens, output_tokens, cost_usd_milli, request_id, status
FROM ai_usage;

DROP TABLE ai_usage;
ALTER TABLE ai_usage_new RENAME TO ai_usage;

CREATE INDEX IF NOT EXISTS idx_ai_usage_owner_created ON ai_usage(owner_id, created_at);
```

### 2.4. `backend/src/db/migrations/0024_ai_usage_openrouter.down.sql`

WARNING: orice rand cu `provider='openrouter'` se PIERDE la downgrade (CHECK constraint nu il mai admite). Pre-rollback backup obligatoriu.

```sql
-- 0024 DOWN — narrow ai_usage.provider CHECK back to 3 values.
-- DATA LOSS WARNING: rows with provider='openrouter' or status='aborted'
-- are dropped. Pre-rollback backup is mandatory.

CREATE TABLE ai_usage_old (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id           TEXT NOT NULL DEFAULT 'local',
  created_at         INTEGER NOT NULL,
  provider           TEXT NOT NULL
                       CHECK(provider IN ('anthropic','openai','google')),
  model_id           TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cost_usd_milli     INTEGER NOT NULL DEFAULT 0,
  request_id         TEXT,
  status             TEXT NOT NULL DEFAULT 'ok'
                       CHECK(status IN ('ok','error','timeout'))
);

INSERT INTO ai_usage_old
SELECT id, owner_id, created_at, provider, model_id,
       input_tokens, output_tokens, cost_usd_milli, request_id, status
FROM ai_usage
WHERE provider IN ('anthropic','openai','google')
  AND status IN ('ok','error','timeout');

DROP TABLE ai_usage;
ALTER TABLE ai_usage_old RENAME TO ai_usage;

CREATE INDEX IF NOT EXISTS idx_ai_usage_owner_created ON ai_usage(owner_id, created_at);
```

### 2.5. Test migration

`backend/src/db/migrations/0024_ai_usage_openrouter.test.ts`:
- ruleaza up + down + up
- verifica `INSERT INTO ai_usage (provider) VALUES ('openrouter')` reuseste dupa UP
- verifica acelasi INSERT esueaza dupa DOWN
- verifica randul cu `provider='openrouter'` se pierde la DOWN

---

## 3. Backend — `backend/src/services/ai.ts` (Stage 2)

### 3.1. OPENROUTER_MODEL_MAP

```ts
// Western stack — mirror EXACT al modelelor native (no version drift).
const OPENROUTER_WESTERN_MAP: Record<string, string> = {
  "claude-haiku":        "anthropic/claude-haiku-4.5",
  "claude-sonnet":       "anthropic/claude-sonnet-4.6",
  "claude-opus":         "anthropic/claude-opus-4.6",
  "gpt-5.4-nano":        "openai/gpt-5.4-nano",
  "gpt-5.4-mini":        "openai/gpt-5.4-mini",
  "gpt-5.4":             "openai/gpt-5.4",
  "gemini-flash-lite-3": "google/gemini-3.1-flash-lite-preview",
  "gemini-flash-3":      "google/gemini-3-flash-preview",
  "gemini-pro-3":        "google/gemini-3.1-pro-preview",
};

// Chinese stack — 3 modele premium per provider.
const OPENROUTER_CHINESE_MAP: Record<string, string> = {
  "glm-5.1":       "z-ai/glm-5.1",
  "kimi-k2.6":     "moonshotai/kimi-k2.6",
  "qwen-3.6-max":  "qwen/qwen3.6-max-preview",
};

// Override env (slug stability — daca OpenRouter redenumeste).
function resolveOpenRouterSlug(modelKey: string, stack: "western" | "chinese"): string | null {
  const override = process.env.OPENROUTER_MODEL_OVERRIDES;
  if (override) {
    // parse "key1:slug1,key2:slug2" → first match wins
    const pairs = override.split(",").map((p) => p.split(":").map((s) => s.trim()));
    const hit = pairs.find(([k]) => k === modelKey);
    if (hit && hit[1]) return hit[1];
  }
  const map = stack === "western" ? OPENROUTER_WESTERN_MAP : OPENROUTER_CHINESE_MAP;
  return map[modelKey] || null;
}
```

### 3.2. `callOpenRouter()`

Foloseste SDK-ul `openai` deja in deps cu `baseURL` override:

```ts
import OpenAI from "openai";

async function callOpenRouter(
  apiKey: string,
  slug: string,
  prompt: string,
  timeout: number,
  tracking?: AiUsageTrackingContext,
  signal?: AbortSignal
): Promise<string> {
  if (process.env.OPENROUTER_DISABLED === "1") {
    throw new Error("OPENROUTER_DISABLED");
  }
  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/warlordro/Legal-Dashboard",
      "X-Title": "Legal Dashboard",
    },
    timeout,
  });
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const completion = await client.chat.completions.create(
      {
        model: slug,
        messages: [{ role: "user", content: prompt }],
        max_tokens: AI_MAX_TOKENS,
        // OpenRouter-specific: cost USD real per call, returns in usage.cost
        // @ts-expect-error — extra_body is OpenRouter extension
        extra_body: { usage: { include: true } },
      },
      { signal: controller.signal }
    );
    const text = completion.choices?.[0]?.message?.content ?? "";
    // Track usage: actual USD if returned, else fallback to MODEL_PRICES table.
    await recordAiUsageSafely({
      provider: "openrouter",
      modelId: slug,
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      // @ts-expect-error — OpenRouter returns `cost` (USD float) when extra_body.usage.include=true
      costUsdMilli: completion.usage?.cost != null
        ? Math.round((completion.usage as any).cost * 1000)
        : null, // null = fallback to MODEL_PRICES lookup in recordAiUsageSafely
      status: "ok",
      tracking,
    });
    return text;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
```

### 3.3. `callModel()` — branch nou

```ts
export async function callModel(
  modelKey: string,
  prompt: string,
  apiKeys: Record<string, string>,
  timeout = AI_TIMEOUT,
  tracking?: AiUsageTrackingContext,
  signal?: AbortSignal,
  // NEW: mode + stack passed from route handler (resolved from owner_ai_settings)
  routing?: { mode: "native" | "openrouter"; stack: "western" | "chinese" }
): Promise<string> {
  const model = AI_MODELS[modelKey];
  if (!model) throw new Error("Model necunoscut");

  const useOpenRouter =
    routing?.mode === "openrouter" ||
    process.env.OPENROUTER_API_KEY ||
    (apiKeys.openrouter && apiKeys.openrouter.startsWith("sk-or-"));

  if (useOpenRouter) {
    const stack = routing?.stack ?? "western";
    const apiKey = process.env.OPENROUTER_API_KEY || apiKeys.openrouter || "";
    if (!apiKey) throw new Error("NO_API_KEY:openrouter");
    const slug = resolveOpenRouterSlug(modelKey, stack);
    if (!slug) throw new Error(`MODEL_NOT_IN_STACK:${modelKey}:${stack}`);
    return callOpenRouter(apiKey, slug, prompt, timeout, tracking, signal);
  }

  // Native fallback (current behavior — unchanged)
  const apiKey = getApiKey(model.provider, apiKeys);
  if (!apiKey) throw new Error(`NO_API_KEY:${model.provider}`);
  if (model.provider === "anthropic") return callAnthropic(apiKey, model.modelId, prompt, timeout, tracking, signal);
  if (model.provider === "openai") return callOpenAI(apiKey, model.modelId, prompt, timeout, tracking, signal);
  if (model.provider === "google") return callGoogle(apiKey, model.modelId, prompt, timeout, tracking, signal);
  throw new Error("Provider necunoscut");
}
```

### 3.4. AI_MODELS extins cu cele 3 chinezesti

```ts
export const AI_MODELS: Record<string, { provider: string; modelId: string; stack?: "western" | "chinese" }> = {
  // Western (default stack — both for native AND openrouter:western)
  "claude-haiku":        { provider: "anthropic", modelId: "claude-haiku-4-5-20251001", stack: "western" },
  "claude-sonnet":       { provider: "anthropic", modelId: "claude-sonnet-4-6",        stack: "western" },
  "claude-opus":         { provider: "anthropic", modelId: "claude-opus-4-6",          stack: "western" },
  "gpt-5.4-nano":        { provider: "openai",    modelId: "gpt-5.4-nano",             stack: "western" },
  "gpt-5.4-mini":        { provider: "openai",    modelId: "gpt-5.4-mini",             stack: "western" },
  "gpt-5.4":             { provider: "openai",    modelId: "gpt-5.4",                  stack: "western" },
  "gemini-flash-lite-3": { provider: "google",    modelId: "gemini-3.1-flash-lite-preview", stack: "western" },
  "gemini-flash-3":      { provider: "google",    modelId: "gemini-3-flash-preview",   stack: "western" },
  "gemini-pro-3":        { provider: "google",    modelId: "gemini-3.1-pro-preview",   stack: "western" },
  // Chinese (openrouter only)
  "glm-5.1":             { provider: "openrouter", modelId: "z-ai/glm-5.1",             stack: "chinese" },
  "kimi-k2.6":           { provider: "openrouter", modelId: "moonshotai/kimi-k2.6",     stack: "chinese" },
  "qwen-3.6-max":        { provider: "openrouter", modelId: "qwen/qwen3.6-max-preview", stack: "chinese" },
};
```

JUDGE_MODELS extins:
```ts
export const JUDGE_MODELS = ["claude-opus", "gpt-5.4", "gemini-pro-3", "qwen-3.6-max"];
```

---

## 4. Backend — `backend/src/services/aiUsage.ts`

### 4.1. Extinde tipul si pretul

```ts
export type AiUsageProvider = "anthropic" | "openai" | "google" | "openrouter";

export const MODEL_PRICES_USD_PER_MILLION = {
  // ... existing entries ...
  openrouter: {
    // Western stack mirror — same as native upstream (small 0-5% markup absorbed)
    "anthropic/claude-haiku-4.5":              { in: 1.00, out: 5.00 },
    "anthropic/claude-sonnet-4.6":             { in: 3.00, out: 15.00 },
    "anthropic/claude-opus-4.6":               { in: 5.00, out: 25.00 },
    "openai/gpt-5.4-nano":                     { in: 0.05, out: 0.40 },
    "openai/gpt-5.4-mini":                     { in: 0.25, out: 2.00 },
    "openai/gpt-5.4":                          { in: 2.50, out: 10.00 },
    "google/gemini-3.1-flash-lite-preview":    { in: 0.075, out: 0.30 },
    "google/gemini-3-flash-preview":           { in: 0.30, out: 2.50 },
    "google/gemini-3.1-pro-preview":           { in: 1.25, out: 10.00 },
    // Chinese stack (verified live on openrouter.ai/models 2026-05-16)
    "z-ai/glm-5.1":                            { in: 0.98, out: 3.08 },
    "moonshotai/kimi-k2.6":                    { in: 0.73, out: 3.49 },
    "qwen/qwen3.6-max-preview":                { in: 1.04, out: 6.24 },
  },
} as const;
```

### 4.2. `recordAiUsageSafely` accepta `costUsdMilli` direct

Daca apelantul (callOpenRouter) trimite `costUsdMilli` non-null (din `usage.cost` real OpenRouter), il foloseste; daca e `null`, calculeaza din `MODEL_PRICES_USD_PER_MILLION` ca fallback. Pattern existent — minim modification.

### 4.3. `routing_tag` la INSERT

`logAiCall()` accepta `routing_tag?: "native" | "openrouter:western" | "openrouter:chinese"` si il scrie in coloana noua adaugata in migration 0024.

---

## 5. Backend — `backend/src/routes/ai.ts` (Stage 3)

### 5.1. Doua rute noi pentru settings

```ts
// GET /api/v1/ai/settings → { mode, openrouter_stack }
// PUT /api/v1/ai/settings  body: { mode, openrouter_stack }
```

Validare cu Zod:
```ts
const aiSettingsSchema = z.object({
  mode: z.enum(["native", "openrouter"]),
  openrouter_stack: z.enum(["western", "chinese"]),
});
```

### 5.2. Stack-purity validation la `/analyze-multi`

```ts
// Cand mode = openrouter, refuza payload-uri cu mix de stack-uri
function assertStackPurity(modelKeys: string[], stack: "western" | "chinese") {
  const wrong = modelKeys.find((k) => AI_MODELS[k]?.stack !== stack);
  if (wrong) {
    throw new HTTPException(400, {
      message: `Model ${wrong} nu apartine stack-ului ${stack}`,
      cause: { code: "STACK_MIX_FORBIDDEN" },
    });
  }
}
```

### 5.3. Pasare `routing` la `callModel`

Route-ul citeste `owner_ai_settings` o data per request si trimite `{ mode, stack }` la fiecare `callModel(...)` din flow-ul SSE.

### 5.4. Web-mode gate

`rejectApiKeysFromBodyInWebMode` ramane neschimbat — daca `AUTH_MODE=web` si user trimite `apiKeys.openrouter` in body → 403. In web mode, doar `OPENROUTER_API_KEY` env merge.

### 5.5. Optional: endpoint diagnostic

`GET /api/v1/ai/openrouter/balance` → proxy spre `https://openrouter.ai/api/v1/auth/key` pentru a afisa balance ramas in UI (read-only, util la onboarding).

---

## 6. Frontend (Stage 4) — pastreaza layout-ul

### 6.1. `ApiKeyDialog.tsx`

- Adauga toggle radio la varful dialog-ului: `Mod: [Native] [OpenRouter]`
- Daca Mode = openrouter, afiseaza al doilea toggle: `Stack: [Vestic] [Chinezesc]`
- Layout-ul 3-slot ramane vizual, dar:
  - Mode = native → 3 sloturi active (Anthropic / OpenAI / Google) — ca acum
  - Mode = openrouter → un singur slot vizibil „OpenRouter API Key (sk-or-v1-…)". Sloturile Anthropic / OpenAI / Google dispar complet (unmount), NU grayed-out
- Tranzitia intre moduri trebuie sa fie instantanee. Cheile native salvate raman in `localStorage` encrypted — la comutarea inapoi pe native, sloturile reapar populate cu valorile salvate.

### 6.2. `dosare-ai-config.ts`

Helper nou `availableModels(mode, stack)` care intoarce setul de keys vizibile:
- `mode=native` → 9 keys vestice
- `mode=openrouter, stack=western` → aceleasi 9 keys (mirror)
- `mode=openrouter, stack=chinese` → 3 keys chinezesti

Multi-agent dropdown-urile (Analist 1, Analist 2, Judecator) folosesc helper-ul. JUDGE_MODELS la fel filtreaza pe stack.

### 6.3. `useApiKey` hook extins

Stocheaza un al 4-lea slot `openrouter` in `localStorage`, encrypted via `safeStorage` la fel ca celelalte 3.

### 6.4. Persistare mode/stack

Hook nou `useAiSettings()` care:
- la mount face `GET /api/v1/ai/settings`
- la schimbare in dialog face `PUT /api/v1/ai/settings` (optimistic)
- expune `{ mode, stack, setMode, setStack }`

---

## 7. Kill switches & ops

### 7.1. `OPENROUTER_DISABLED=1`

Adaugata in `backend/src/services/ai.ts` `callOpenRouter` — throw imediat daca env e `1`. Operatorul poate intoarce toata flota la native fara redeploy. Documentata in CLAUDE.md la sectiunea „Comenzi" (alaturi de `MONITORING_DISABLED_KINDS`).

### 7.2. `OPENROUTER_MODEL_OVERRIDES`

Format: `key1:slug1,key2:slug2`. Permite hot-patch slug-uri (ex. cand OpenRouter redenumeste `qwen3.6-max-preview` in `qwen3.6-max-stable`) fara rebuild backend.

### 7.3. `.env.example` extins

```
# OpenRouter (optional — daca setat, override pe cheile native si ruteaza prin OpenRouter)
OPENROUTER_API_KEY=
OPENROUTER_DISABLED=
OPENROUTER_MODEL_OVERRIDES=
```

---

## 8. Plan teste (~40 teste must-add)

### 8.1. Backend

- `backend/src/db/migrations/0024_ai_usage_openrouter.test.ts` (4 teste)
  - up roundtrip, down data loss warning, INSERT 'openrouter' OK post-up, INSERT 'openrouter' fails post-down
- `backend/src/services/ai.openrouter.test.ts` (12 teste)
  - resolveOpenRouterSlug western, chinese, override env, unknown key
  - callModel branches: env override, prefix detect, mode=openrouter explicit
  - callOpenRouter happy path (mocked fetch)
  - callOpenRouter abort propagation
  - callOpenRouter OPENROUTER_DISABLED=1 throws
  - callOpenRouter usage.cost USD real captured in cost_usd_milli
  - callOpenRouter usage.cost missing → fallback la MODEL_PRICES
  - callOpenRouter NO_API_KEY error path
- `backend/src/routes/ai.settings.test.ts` (6 teste)
  - GET default mode=native, stack=western
  - PUT happy path
  - PUT invalid enum → 400
  - PUT respects owner_id isolation
- `backend/src/routes/ai.stack-purity.test.ts` (5 teste)
  - /analyze-multi rejects mix western+chinese cand mode=openrouter
  - /analyze-multi acepta full-chinese cand stack=chinese
  - /analyze-multi acepta full-western cand stack=western
  - mode=native ignora stack (backward compat)
  - 400 STACK_MIX_FORBIDDEN code stable in envelope
- `backend/src/routes/ai.webmode.test.ts` (4 teste)
  - AUTH_MODE=web + body apiKeys.openrouter → 403
  - AUTH_MODE=web + OPENROUTER_API_KEY env → OK
  - AUTH_MODE=web fara nicio cheie → 501

### 8.2. Frontend

- `frontend/src/components/ApiKeyDialog.test.tsx` (5 teste)
  - render initial 3 sloturi cand mode=native
  - switch la openrouter → primul slot devine sk-or, restul grayed
  - stack toggle vizibil doar daca mode=openrouter
  - save persists via mocked PUT
- `frontend/src/components/dosare-ai-config.test.ts` (4 teste)
  - availableModels(native) returns 9
  - availableModels(openrouter, western) returns 9 (mirror)
  - availableModels(openrouter, chinese) returns 3
  - JUDGE_MODELS filtered per stack

---

## 9. BLOCKERS rezolvati inline

| # | Blocker (din release-readiness-reviewer) | Rezolvare in plan |
|---|------------------------------------------|---------------------|
| 1 | `ai_usage.provider` CHECK refuza 'openrouter' | §2.3 migration 0024 widening |
| 2 | `MODEL_PRICES_USD_PER_MILLION` lipsa entries openrouter | §4.1 sectiune `openrouter:` cu 12 modele |
| 3 | Web-mode key storage nedefinit | §1.4 + §5.4 env-only sau 501 |
| 4 | Lipsa kill switch operational | §7.1 `OPENROUTER_DISABLED=1` |

---

## 10. Workflow Codex

Per `[[codex-opens-prs]]`:
1. User aproba acest plan (final gate inainte de orice cod scris).
2. Eu (Claude) trimit task complet la Codex cu link la acest PLAN si la `[[openrouter-migration-exploration]]` din memory.
3. Codex creeaza branch `feat/openrouter-toggle-stacks` din `main`.
4. Codex implementeaza in ordinea: migration → backend services → backend routes → frontend hook → frontend dialog → teste.
5. Codex ruleaza pe local: `npx biome check --write .`, `npx tsc --noEmit -p backend/tsconfig.json`, `cd frontend && npx tsc --noEmit`, `npm run build`, `npm test --workspace=backend`, `cd frontend && npm test -- --run`. Toate verzi obligatoriu.
6. Codex face `git commit` + `git push origin feat/openrouter-toggle-stacks` + `gh pr create` cu descriere completa (link la PLAN, lista BLOCKERS rezolvati, screenshots UI).
7. User face code review + smoke test desktop + merge in main cand satisfacut.

### Estimare effort Codex

- Migrations + tests: ~1.5h
- Backend services (ai.ts + aiUsage.ts): ~2h
- Backend routes (ai.ts settings + stack purity): ~1.5h
- Frontend (ApiKeyDialog + hook + config): ~2h
- Teste end-to-end smoke: ~1h
- **Total: ~8h Codex work + 1h user smoke**

---

## 11. Stare la deschidere plan

- Branch: NU creat inca (Codex creeaza la kickoff).
- PR: NU deschis inca.
- Plan: in revizuire la user — pending approval inainte de dispatch.
- Memory pointer: `[[openrouter-migration-exploration]]` din 2026-05-16, acest fisier suprapune.

**Action items pentru user:**
1. Citeste sectiunile 1-7.
2. Confirma sau modifica deciziile arhitecturale (mai ales §1.1 — 2 nivele de toggle, §1.4 — web-mode env-only).
3. La OK final, eu trimit task-ul la Codex cu link la acest plan.
